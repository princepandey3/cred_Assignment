'use strict';

/**
 * registerHandlers.js
 * ═══════════════════════════════════════════════════════════════
 * Registers all command and message/callback handlers on the grammy Bot.
 *
 * Middleware stack (global, applied in order):
 *   1. injectState  — attaches ctx.getState / ctx.setState / ctx.endFlow
 *
 * Handler map:
 *   /start, /help         → public
 *   /cancel               → public — always available to exit any flow
 *   /link                 → public
 *   /accounts             → requires linked account
 *   /create, /post        → requires linked account + idle (no active flow)
 *   callback ^cp:         → create_post flow button presses
 *   message:text guards   → per-step free-text input handlers
 *   message:text fallback → unexpected input nudge + unknown command reply
 * ═══════════════════════════════════════════════════════════════
 */

const { FLOWS }                   = require('../services/botState.service');
const { injectState, requireIdle, requireStep } = require('./middleware/stateMiddleware');
const { requireLinkedAccount }    = require('./middleware/telegramAuth');
const { handleStart, handleHelp } = require('./commands/start');
const { handleCancel }            = require('./commands/cancel');
const { handleLink }              = require('./commands/link');
const { handleAccounts }          = require('./commands/accounts');
const {
  handleCreatePost,
  handlePostCallback,
  handleIdeaInput,
  handleUnexpectedFlowInput,
} = require('./flows/createPost.flow');
const { CREATE_STEPS }            = require('./flows/createPost.constants');
const logger                      = require('../utils/logger');

function registerHandlers(bot) {

  // ── Global error handler ──────────────────────────────────
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

  // ── Global middleware ─────────────────────────────────────
  bot.use(injectState);

  // ── Public commands ───────────────────────────────────────
  bot.command('start',  handleStart);
  bot.command('help',   handleHelp);
  bot.command('link',   handleLink);
  bot.command('cancel', handleCancel);

  // ── Protected commands ────────────────────────────────────
  bot.command('accounts', requireLinkedAccount, handleAccounts);

  // /create and /post both start the same flow.
  // requireIdle prevents starting a second flow mid-wizard.
  bot.command('create',
    requireLinkedAccount,
    requireIdle,
    handleCreatePost
  );
  bot.command('post',
    requireLinkedAccount,
    requireIdle,
    handleCreatePost
  );

  // ── Inline keyboard callbacks (create_post flow) ──────────
  // All create_post buttons use "cp:<field>:<value>" callback data.
  bot.callbackQuery(/^cp:/, handlePostCallback);

  // ── Step-guarded text input handlers ─────────────────────
  // Each handler only fires at its exact step; others fall through.
  bot.on('message:text',
    requireStep(CREATE_STEPS.AWAITING_IDEA, FLOWS.CREATE_POST),
    handleIdeaInput
  );

  // ── Unexpected text during button-only steps ──────────────
  // Fires when user types text while we're waiting for a button press.
  bot.on('message:text', handleUnexpectedFlowInput);

  // ── Unknown command fallback ──────────────────────────────
  // Must be last — only triggers for unhandled /commands.
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';
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
