'use strict';

/**
 * registerHandlers.js
 * ═══════════════════════════════════════════════════════════════
 * Registers all command and event handlers on the grammy Bot instance.
 *
 * Called once during app startup (before the first webhook arrives).
 * Keeps bot.js clean — all handler wiring lives here.
 *
 * Middleware stack (applied globally, in order):
 *   1. injectState   — attaches ctx.getState / ctx.setState / ctx.endFlow
 *
 * Handler map:
 *   /start    → handleStart          (public)
 *   /help     → handleHelp           (public)
 *   /cancel   → handleCancel         (public — always available)
 *   /link     → handleLink           (public)
 *   /accounts → handleAccounts       (requires linked account)
 *   unknown   → fallback reply
 * ═══════════════════════════════════════════════════════════════
 */

const { injectState }             = require('./middleware/stateMiddleware');
const { requireLinkedAccount }    = require('./middleware/telegramAuth');
const { handleStart, handleHelp } = require('./commands/start');
const { handleCancel }            = require('./commands/cancel');
const { handleLink }              = require('./commands/link');
const { handleAccounts }          = require('./commands/accounts');
const logger                      = require('../utils/logger');

/**
 * Register all handlers on the provided bot instance.
 * @param {import('grammy').Bot} bot
 */
function registerHandlers(bot) {

  // ── Global error handler ────────────────────────────────────
  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error('Telegram bot unhandled error', {
      updateId:   ctx?.update?.update_id,
      telegramId: ctx?.from?.id,
      error:      err.error?.message ?? String(err),
    });

    ctx?.reply('⚠️ An unexpected error occurred\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    }).catch(() => {});
  });

  // ── Global middleware ────────────────────────────────────────
  // injectState runs on EVERY update so ctx.getState / ctx.setState
  // are always available, regardless of which handler fires.
  bot.use(injectState);

  // ── Public commands (no account link required) ──────────────
  bot.command('start',  handleStart);
  bot.command('help',   handleHelp);
  bot.command('link',   handleLink);

  // /cancel is always available — must be registered BEFORE protected
  // commands so a user can escape a flow regardless of link status.
  bot.command('cancel', handleCancel);

  // ── Protected commands (linked account required) ────────────
  bot.command('accounts', requireLinkedAccount, handleAccounts);

  // ── Unknown command fallback ────────────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';

    // Only respond to unhandled slash commands — ignore plain text
    // (plain text is consumed by flow step handlers; if we're here
    // with plain text it means no flow is active, so silently ignore)
    if (text.startsWith('/')) {
      await ctx.reply(
        `❓ Unknown command\\. Use /help to see available commands\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  });

  logger.info('Telegram bot handlers registered');
}

module.exports = { registerHandlers };
