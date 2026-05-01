'use strict';

/**
 * stateMiddleware.js
 * ═══════════════════════════════════════════════════════════════
 * grammy middleware that bridges BotStateService ↔ handler context.
 *
 * Provides three composable middleware functions:
 *
 *   injectState      — adds ctx.state (lazy-loaded) to every update
 *   requireIdle      — blocks commands while a flow is in progress
 *   requireStep      — guards a handler to only run at a specific step
 *
 * Usage in registerHandlers.js:
 *   bot.use(injectState);                            // global
 *   bot.command('cancel', handleCancel);             // global
 *   bot.on('message:text', requireStep(...), handler); // per-step
 * ═══════════════════════════════════════════════════════════════
 */

const { botStateService, FLOWS } = require('../../services/botState.service');
const logger = require('../../utils/logger');

/**
 * Global middleware — attaches a lazy `ctx.state` accessor to every update.
 *
 * `ctx.state` is a Promise-backed proxy:
 *   await ctx.state          → current ConversationState | null
 *   await ctx.getState()     → same (explicit form)
 *   await ctx.setState(p)    → update(chatId, patch) and return new state
 *   await ctx.clearState()   → clear(chatId)
 *   await ctx.startFlow(...) → startFlow(chatId, ...)
 *   await ctx.endFlow()      → endFlow(chatId)
 */
function injectState(ctx, next) {
  const chatId = ctx.chat?.id;

  if (!chatId) return next(); // channel posts etc.

  // Lazy getter — only hits Redis if the handler actually reads it
  let _cached = undefined;

  const load = async () => {
    if (_cached === undefined) {
      _cached = await botStateService.get(chatId);
    }
    return _cached;
  };

  // Invalidate cache after writes so subsequent reads in the same
  // handler see the updated value.
  const invalidate = () => { _cached = undefined; };

  ctx.getState  = load;

  ctx.setState  = async (patch) => {
    const next = await botStateService.update(chatId, patch);
    _cached = next;
    return next;
  };

  ctx.clearState = async () => {
    await botStateService.clear(chatId);
    _cached = null;
  };

  ctx.startFlow = async (flow, step, data = {}) => {
    const next = await botStateService.startFlow(chatId, flow, step, data);
    _cached = next;
    return next;
  };

  ctx.endFlow = async () => {
    await botStateService.endFlow(chatId);
    _cached = null;
  };

  // Define ctx.state as a thenable so `await ctx.state` works naturally
  Object.defineProperty(ctx, 'state', {
    get: () => load(),
    enumerable: true,
    configurable: true,
  });

  return next();
}

/**
 * Guard: only continue if the chat has NO active flow.
 * Use on commands that start a new flow (/create, /schedule) to prevent
 * a user mid-flow from accidentally triggering a conflicting wizard.
 *
 * If a flow IS active, sends a "you're in the middle of something" prompt.
 */
async function requireIdle(ctx, next) {
  const state = await ctx.getState?.() ?? await botStateService.get(ctx.chat?.id);

  if (state?.flow) {
    const flowLabel = state.flow.replace(/_/g, ' ');
    await ctx.reply(
      `⚡ You're currently in the *${flowLabel}* flow\\.\n\n` +
      `Send /cancel to exit it first, or continue where you left off\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    return; // stop chain
  }

  return next();
}

/**
 * Guard: only continue if the chat is at `expectedStep` (and optionally `expectedFlow`).
 * Use on `message:text` handlers that consume wizard input at a specific step.
 *
 * Falls through silently if the step doesn't match so the unknown-command
 * fallback can handle it.
 *
 * @param {string}      expectedStep
 * @param {string|null} [expectedFlow]
 */
function requireStep(expectedStep, expectedFlow = undefined) {
  return async (ctx, next) => {
    const state = await ctx.getState?.() ?? await botStateService.get(ctx.chat?.id);

    if (!state) return; // no active flow at all — silently stop

    const stepMatch = state.step === expectedStep;
    const flowMatch = expectedFlow === undefined || state.flow === expectedFlow;

    if (stepMatch && flowMatch) return next();

    // Wrong step — don't reply, just let the fallback handler take it
  };
}

module.exports = { injectState, requireIdle, requireStep };
