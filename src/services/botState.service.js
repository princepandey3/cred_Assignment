'use strict';

/**
 * BotStateService
 * ═══════════════════════════════════════════════════════════════
 * Manages multi-step Telegram conversation state via Redis.
 *
 * Architecture
 * ────────────
 * Each Telegram chat gets exactly ONE state object in Redis:
 *
 *   Key:   bot:state:<chatId>
 *   Value: JSON-serialised ConversationState
 *   TTL:   30 minutes (reset on every write → sliding window)
 *
 * ConversationState shape:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ {                                                           │
 * │   step:      string | null,   // current flow step         │
 * │   flow:      string | null,   // which wizard is active    │
 * │   data:      object,          // accumulated wizard data   │
 * │   createdAt: ISO string,      // when the state was born   │
 * │   updatedAt: ISO string,      // last mutation timestamp   │
 * │ }                             //                           │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Flow/Step naming conventions
 * ────────────────────────────
 * Flow names identify the wizard:    'create_post', 'link_account'
 * Step names identify where in it:   'awaiting_platform', 'awaiting_tone'
 * Both are free-form strings — handlers define their own constants
 * (see FLOWS / STEPS exports at the bottom of this file).
 *
 * TTL strategy
 * ────────────
 * The TTL is a SLIDING window — every write (set / update) resets it.
 * Reads do NOT extend the TTL; an idle session naturally expires.
 * This matches user expectations: inactivity for 30 min = clean slate.
 *
 * Redis client
 * ────────────
 * The service lazy-gets the client via getRedisClient() so it works
 * both when the server bootstraps normally and in tests (where the
 * client is mocked before the first call).
 * ═══════════════════════════════════════════════════════════════
 */

const { getRedisClient } = require('../config/redis');
const logger             = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────

/** Key prefix — all bot state keys share this namespace. */
const KEY_PREFIX = 'bot:state:';

/** Session TTL in seconds (30 minutes). */
const STATE_TTL_SECONDS = 30 * 60; // 1800

/**
 * Conversation flow identifiers.
 * Imported by command handlers so there are no magic strings anywhere.
 */
const FLOWS = Object.freeze({
  CREATE_POST:    'create_post',
  SCHEDULE_POST:  'schedule_post',
  LINK_ACCOUNT:   'link_account',
});

/**
 * Step identifiers shared across flows.
 * Flow-specific steps live in their own command files; these are the
 * cross-cutting ones used in middleware / state guards.
 */
const STEPS = Object.freeze({
  // create_post flow
  AWAITING_PLATFORM:  'awaiting_platform',
  AWAITING_TOPIC:     'awaiting_topic',
  AWAITING_TONE:      'awaiting_tone',
  AWAITING_LANGUAGE:  'awaiting_language',
  AWAITING_CONFIRM:   'awaiting_confirm',

  // schedule_post flow
  AWAITING_DATETIME:  'awaiting_datetime',

  // Generic
  IDLE: null,
});

// ── Helpers ───────────────────────────────────────────────────

/**
 * Build the Redis key for a given Telegram chat ID.
 * @param {number|string} chatId
 * @returns {string}
 */
function stateKey(chatId) {
  return `${KEY_PREFIX}${chatId}`;
}

/**
 * Return a fresh, empty ConversationState.
 * @returns {ConversationState}
 */
function emptyState() {
  const now = new Date().toISOString();
  return {
    step:      null,
    flow:      null,
    data:      {},
    createdAt: now,
    updatedAt: now,
  };
}

// ── Service class ─────────────────────────────────────────────

class BotStateService {

  // ── Primitive Redis operations ───────────────────────────────

  /**
   * Retrieve the current conversation state for a chat.
   * Returns null if no state exists (expired or never set).
   *
   * @param {number|string} chatId  Telegram chat ID
   * @returns {Promise<ConversationState|null>}
   */
  async get(chatId) {
    try {
      const redis = await getRedisClient();
      const raw   = await redis.get(stateKey(chatId));

      if (!raw) return null;

      return JSON.parse(raw);
    } catch (err) {
      logger.error('BotStateService.get failed', { chatId, error: err.message });
      return null; // degrade gracefully — don't crash the bot
    }
  }

  /**
   * Persist a complete ConversationState, replacing any existing value.
   * Always resets the TTL to STATE_TTL_SECONDS.
   *
   * @param {number|string} chatId
   * @param {Partial<ConversationState>} state  Fields merged into emptyState()
   * @returns {Promise<ConversationState>}      The stored state
   */
  async set(chatId, state) {
    try {
      const redis    = await getRedisClient();
      const now      = new Date().toISOString();
      const existing = emptyState();

      const next = {
        ...existing,
        ...state,
        updatedAt: now,
        // Preserve createdAt if caller supplied it; otherwise use now
        createdAt: state.createdAt ?? now,
      };

      await redis.set(stateKey(chatId), JSON.stringify(next), { EX: STATE_TTL_SECONDS });

      logger.debug('BotStateService.set', { chatId, step: next.step, flow: next.flow });
      return next;
    } catch (err) {
      logger.error('BotStateService.set failed', { chatId, error: err.message });
      throw err;
    }
  }

  /**
   * Shallow-merge `patch` into the existing state.
   * If no state exists a new one is created before patching.
   * Data sub-object is also shallow-merged (not replaced).
   * Always resets the TTL.
   *
   * @param {number|string} chatId
   * @param {Partial<ConversationState>} patch
   * @returns {Promise<ConversationState>}  The resulting state after merge
   */
  async update(chatId, patch) {
    try {
      const current = (await this.get(chatId)) ?? emptyState();
      const now     = new Date().toISOString();

      const next = {
        ...current,
        ...patch,
        // Deep-merge data so callers can add keys without wiping others
        data:      { ...current.data, ...(patch.data ?? {}) },
        updatedAt: now,
      };

      const redis = await getRedisClient();
      await redis.set(stateKey(chatId), JSON.stringify(next), { EX: STATE_TTL_SECONDS });

      logger.debug('BotStateService.update', { chatId, step: next.step, flow: next.flow });
      return next;
    } catch (err) {
      logger.error('BotStateService.update failed', { chatId, error: err.message });
      throw err;
    }
  }

  /**
   * Delete the conversation state entirely.
   * Called when a flow completes, is cancelled, or on /cancel.
   *
   * @param {number|string} chatId
   * @returns {Promise<void>}
   */
  async clear(chatId) {
    try {
      const redis = await getRedisClient();
      await redis.del(stateKey(chatId));
      logger.debug('BotStateService.clear', { chatId });
    } catch (err) {
      logger.error('BotStateService.clear failed', { chatId, error: err.message });
      throw err;
    }
  }

  // ── Convenience helpers ──────────────────────────────────────

  /**
   * Transition to a specific step within the current or a new flow.
   * Shorthand for the common pattern: update step + optionally set flow.
   *
   * @param {number|string} chatId
   * @param {string}        step   New step name (use STEPS constants)
   * @param {string|null}  [flow]  If provided, also sets/changes the flow
   * @returns {Promise<ConversationState>}
   */
  async setStep(chatId, step, flow = undefined) {
    const patch = { step };
    if (flow !== undefined) patch.flow = flow;
    return this.update(chatId, patch);
  }

  /**
   * Merge additional data into state.data without changing step/flow.
   * Useful for accumulating wizard answers across multiple messages.
   *
   * @param {number|string} chatId
   * @param {object}        data   Key/value pairs to merge into state.data
   * @returns {Promise<ConversationState>}
   */
  async setData(chatId, data) {
    return this.update(chatId, { data });
  }

  /**
   * Start a new conversation flow from scratch.
   * Clears any previous state and sets flow + initial step atomically.
   *
   * @param {number|string} chatId
   * @param {string}        flow   Flow identifier (use FLOWS constants)
   * @param {string}        step   Initial step within the flow
   * @param {object}       [data]  Any seed data for the flow
   * @returns {Promise<ConversationState>}
   */
  async startFlow(chatId, flow, step, data = {}) {
    return this.set(chatId, { flow, step, data });
  }

  /**
   * End the current flow and reset to idle.
   * Alias for clear() — both remove the Redis key entirely.
   * Provided as a semantic counterpart to startFlow().
   *
   * @param {number|string} chatId
   * @returns {Promise<void>}
   */
  async endFlow(chatId) {
    return this.clear(chatId);
  }

  /**
   * Check whether a chat is currently inside a specific flow.
   *
   * @param {number|string} chatId
   * @param {string}        flow
   * @returns {Promise<boolean>}
   */
  async inFlow(chatId, flow) {
    const state = await this.get(chatId);
    return state?.flow === flow;
  }

  /**
   * Check whether a chat is at a specific step (optionally within a flow).
   *
   * @param {number|string} chatId
   * @param {string}        step
   * @param {string|null}  [flow]  If provided, also checks the flow matches
   * @returns {Promise<boolean>}
   */
  async atStep(chatId, step, flow = undefined) {
    const state = await this.get(chatId);
    if (!state) return false;
    const stepMatch = state.step === step;
    const flowMatch = flow === undefined || state.flow === flow;
    return stepMatch && flowMatch;
  }

  /**
   * Return the remaining TTL (in seconds) for a chat's state.
   * Returns -2 if the key doesn't exist, -1 if it has no expiry.
   *
   * @param {number|string} chatId
   * @returns {Promise<number>}
   */
  async ttl(chatId) {
    try {
      const redis = await getRedisClient();
      return redis.ttl(stateKey(chatId));
    } catch (err) {
      logger.error('BotStateService.ttl failed', { chatId, error: err.message });
      return -2;
    }
  }

  /**
   * Return all chat IDs with active bot state.
   * Intended for debugging / admin use only — not for hot paths.
   *
   * @returns {Promise<string[]>}  Array of chatId strings
   */
  async listActiveSessions() {
    try {
      const redis = await getRedisClient();
      const keys  = await redis.keys(`${KEY_PREFIX}*`);
      return keys.map((k) => k.slice(KEY_PREFIX.length));
    } catch (err) {
      logger.error('BotStateService.listActiveSessions failed', { error: err.message });
      return [];
    }
  }
}

// ── Exports ───────────────────────────────────────────────────

module.exports = {
  botStateService: new BotStateService(),
  STATE_TTL_SECONDS,
  KEY_PREFIX,
  FLOWS,
  STEPS,
};
