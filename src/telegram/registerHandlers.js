'use strict';

/**
 * registerHandlers.js
 * ═══════════════════════════════════════════════════════════════
 * Registers all command and event handlers on the grammy Bot instance.
 *
 * Called once during app startup (before the first webhook arrives).
 * Keeps bot.js clean — all handler wiring lives here.
 *
 * Handler map:
 *   /start    → handleStart         (public)
 *   /help     → handleHelp          (public)
 *   /link     → handleLink          (public)
 *   /accounts → handleAccounts      (requires linked account)
 *   unknown   → fallback reply
 * ═══════════════════════════════════════════════════════════════
 */

const { requireLinkedAccount } = require('./middleware/telegramAuth');
const { handleStart, handleHelp } = require('./commands/start');
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

    // Best-effort reply — may fail if the original error was network-related
    ctx?.reply('⚠️ An unexpected error occurred\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    }).catch(() => {});
  });

  // ── Public commands (no account link required) ──────────────

  bot.command('start', handleStart);
  bot.command('help',  handleHelp);
  bot.command('link',  handleLink);

  // ── Protected commands (linked account required) ────────────
  // requireLinkedAccount resolves ctx.appUser or sends an error reply and stops.

  bot.command('accounts', requireLinkedAccount, handleAccounts);

  // ── Unknown command fallback ────────────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';

    // Only respond to unhandled slash commands — ignore plain text
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
