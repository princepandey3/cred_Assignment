'use strict';

/**
 * bot.js — grammy Bot singleton
 * ═══════════════════════════════════════════════════════════════
 * Creates and exports a single Bot instance shared across the app.
 *
 * Why a singleton?
 *   grammy Bot objects hold internal state (middleware stack, handler
 *   tree, the underlying API client).  Creating one per request would
 *   leak memory and re-register handlers on every webhook call.
 *
 * Webhook vs polling
 * ──────────────────
 *   In production the bot is driven by Telegram POSTing to our Express
 *   route (/api/v1/telegram/webhook).  grammy's `webhookCallback()`
 *   adapter bridges that Express route to the bot's update pipeline.
 *
 *   In development/test the bot is created the same way — we just never
 *   call bot.start() (polling).  Tests call webhookCallback() directly
 *   with mock updates.
 *
 * Bot token validation
 * ────────────────────
 *   grammy defers the token check to the first API call, which happens
 *   when we call `bot.init()` in the startup sequence.  If the token is
 *   missing we throw early here so the server never starts misconfigured.
 * ═══════════════════════════════════════════════════════════════
 */

const { Bot } = require('grammy');
const logger  = require('../utils/logger');

// ── Validate token presence at module load time ───────────────
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token && process.env.NODE_ENV !== 'test') {
  throw new Error(
    'TELEGRAM_BOT_TOKEN is not set. ' +
    'Get a token from @BotFather and add it to your .env file.'
  );
}

// In test mode use a placeholder token so the Bot object can be
// constructed without making real API calls.
const bot = new Bot(token || 'test:token_placeholder_for_unit_tests');

// ── Lifecycle helpers ─────────────────────────────────────────

/**
 * Called once at server startup.
 * Verifies the token is valid by fetching bot info from Telegram.
 * Throws on any network or auth error so the server fails fast.
 */
async function initBot() {
  await bot.init();
  logger.info(`Telegram bot ready: @${bot.botInfo.username} (id: ${bot.botInfo.id})`);
}

module.exports = { bot, initBot };
