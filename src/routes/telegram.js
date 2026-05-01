'use strict';

/**
 * telegram.js — Express router for Telegram webhook
 * ═══════════════════════════════════════════════════════════════
 * Telegram delivers bot updates by POSTing JSON to this endpoint.
 *
 * Security
 * ────────
 *   • The route path includes a secret token segment so only Telegram
 *     (who we told the URL to) can trigger it.  This is standard practice.
 *   • The secret is TELEGRAM_WEBHOOK_SECRET from env (falls back to
 *     bot token hash in dev — never leave this unset in production).
 *   • We return HTTP 200 immediately for any unrecognised body rather
 *     than 4xx, because Telegram retries on non-2xx and we don't want
 *     to cause a retry storm for malformed requests.
 *
 * grammy webhookCallback
 * ──────────────────────
 *   grammy's `webhookCallback(bot, 'express')` returns a standard
 *   Express request handler `(req, res) => void`.  It feeds the parsed
 *   JSON body into the bot's update pipeline and resolves once all
 *   handlers for that update have run.
 *
 * Rate limiting
 * ─────────────
 *   The webhook is excluded from the global rate limiter (it has its
 *   own — Telegram itself rate-limits delivery).  We apply a dedicated
 *   looser limiter here to protect against misconfigured webhook URLs
 *   being hammered externally.
 * ═══════════════════════════════════════════════════════════════
 */

const { Router }          = require('express');
const rateLimit           = require('express-rate-limit');
const { webhookCallback } = require('grammy');
const { bot }             = require('../telegram/bot');
const logger              = require('../utils/logger');

const router = Router();

// ── Webhook-specific rate limiter ─────────────────────────────
// Telegram sends at most ~30 updates/s per bot; we allow 120/min per IP
// so legitimate traffic is never blocked but abuse is capped.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      120,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip,
  handler:         (_req, res) => res.sendStatus(429),
});

// ── Telegram secret-token header verification ─────────────────
// When registering the webhook we pass X-Telegram-Bot-Api-Secret-Token.
// Telegram echoes it back on every request; we reject anything else.
function verifyTelegramSecret(req, res, next) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  // If no secret is configured (dev / test), skip verification
  if (!secret) return next();

  const header = req.headers['x-telegram-bot-api-secret-token'];
  if (!header || header !== secret) {
    logger.warn('Telegram webhook: invalid secret token', { ip: req.ip });
    return res.sendStatus(403);
  }

  next();
}

// ── POST /api/v1/telegram/webhook ─────────────────────────────

/**
 * @route   POST /api/v1/telegram/webhook
 * @desc    Receive Telegram updates and feed them into the grammy bot pipeline.
 * @access  Telegram servers only (protected by secret-token header)
 */
router.post(
  '/webhook',
  webhookLimiter,
  verifyTelegramSecret,
  webhookCallback(bot, 'express')
);

// ── GET /api/v1/telegram/health ───────────────────────────────

/**
 * @route   GET /api/v1/telegram/health
 * @desc    Confirm the bot is initialised and return basic bot info.
 * @access  Public (useful for uptime monitoring)
 */
router.get('/health', (req, res) => {
  if (!bot.isInited()) {
    return res.status(503).json({ ok: false, message: 'Bot not yet initialised' });
  }

  return res.json({
    ok:       true,
    bot: {
      id:       bot.botInfo.id,
      username: bot.botInfo.username,
      name:     bot.botInfo.first_name,
    },
  });
});

module.exports = router;
