'use strict';

/**
 * botState.types.js
 * ═══════════════════════════════════════════════════════════════
 * JSDoc typedefs for the bot conversation state system.
 * Import this file in any module that needs IDE autocompletion
 * for ConversationState / StateContext shapes.
 *
 * Usage:
 *   // @ts-check
 *   require('../telegram/botState.types'); // pulls in global typedefs
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * @typedef {object} ConversationState
 * The full conversation state object stored in Redis per chat.
 *
 * @property {string|null} step
 *   The current step within the active flow.
 *   null means the chat is idle (no active wizard).
 *   Use STEPS constants from botState.service for valid values.
 *
 * @property {string|null} flow
 *   The name of the active wizard/flow.
 *   null when idle.
 *   Use FLOWS constants from botState.service for valid values.
 *
 * @property {Record<string, any>} data
 *   Accumulated wizard data — grows as the user answers prompts.
 *   Examples:
 *     { platform: 'TWITTER', topic: 'AI trends' }
 *     { platform: 'LINKEDIN', tone: 'PROFESSIONAL', language: 'EN' }
 *
 * @property {string} createdAt
 *   ISO-8601 timestamp when this state was first created.
 *   Preserved through update() calls — only reset by set() / startFlow().
 *
 * @property {string} updatedAt
 *   ISO-8601 timestamp of the last write.
 *   Reset on every set() / update() call.
 */

/**
 * @typedef {object} StateContext
 * Methods injected onto the grammy Context by injectState middleware.
 * These are available on `ctx` inside any handler registered after
 * bot.use(injectState).
 *
 * @property {() => Promise<ConversationState|null>} getState
 *   Fetch (with caching) the current state for this chat.
 *
 * @property {(patch: Partial<ConversationState>) => Promise<ConversationState>} setState
 *   Shallow-merge patch into state, reset TTL.
 *
 * @property {() => Promise<void>} clearState
 *   Delete the Redis key for this chat.
 *
 * @property {(flow: string, step: string, data?: object) => Promise<ConversationState>} startFlow
 *   Create a fresh state for the given flow+step.
 *
 * @property {() => Promise<void>} endFlow
 *   Alias for clearState — semantic "flow completed" form.
 */

// This file exports nothing — it's a typedefs-only module.
module.exports = {};
