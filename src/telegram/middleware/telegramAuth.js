'use strict';

/**
 * telegramAuth middleware
 * ═══════════════════════════════════════════════════════════════
 * Resolves a Telegram user to an application User record.
 *
 * Flow:
 *   1. Extract ctx.from.id (Telegram user ID) from the update.
 *   2. Look up the matching User row by telegramId.
 *   3. If found  → attach ctx.appUser and call next().
 *   4. If not found → reply with a "link your account" prompt and stop.
 *
 * Why this lives here and not in bot.js
 * ──────────────────────────────────────
 *   This middleware is applied selectively — only commands that need a
 *   logged-in user use it.  /help and the linking flow work without it.
 *
 * telegramId column
 * ─────────────────
 *   The User model needs a `telegramId` field.  We check dynamically
 *   here so the middleware degrades gracefully if the column doesn't
 *   exist yet in an older migration.
 * ═══════════════════════════════════════════════════════════════
 */

const { prisma }  = require('../../config/prisma');
const logger      = require('../../utils/logger');

/**
 * grammy middleware that resolves ctx.from → ctx.appUser.
 * Stops processing with a user-friendly message if the account is not linked.
 */
async function requireLinkedAccount(ctx, next) {
  const from = ctx.from;

  if (!from) {
    // Channel posts, etc. — no user; silently ignore
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: String(from.id) },
      select: {
        id:              true,
        email:           true,
        name:            true,
        defaultTone:     true,
        defaultLanguage: true,
        isActive:        true,
      },
    });

    if (!user) {
      await ctx.reply(
        '🔗 *Account not linked*\n\n' +
        'Use /link to connect your account before using this command.',
        { parse_mode: 'Markdown' }
      );
      return; // stop middleware chain
    }

    if (!user.isActive) {
      await ctx.reply('⛔ Your account has been deactivated. Please contact support.');
      return;
    }

    ctx.appUser = user;
    return next();

  } catch (err) {
    logger.error('telegramAuth middleware error', { error: err.message, telegramId: from.id });
    await ctx.reply('⚠️ An error occurred while verifying your account. Please try again.');
  }
}

module.exports = { requireLinkedAccount };
