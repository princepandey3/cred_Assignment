'use strict';

/**
 * link.js — /link command handler
 * ═══════════════════════════════════════════════════════════════
 * Allows a Telegram user to connect their Telegram account to an
 * existing application user account.
 *
 * Flow:
 *   /link                 → shows instructions (no token provided)
 *   /link <token>         → validates token, stores telegramId on User row
 *
 * Token strategy
 * ──────────────
 *   The web app generates a short-lived "link token" (stored in Redis
 *   with a TTL) that maps to a userId.  The user copies it here.
 *   This avoids sending passwords or JWT access tokens over Telegram.
 *
 *   For now we do a lightweight lookup: the token IS the userId
 *   (UUID format) prefixed with "link_".  A real implementation would
 *   use a Redis-backed one-time token.  The handler is structured so
 *   swapping the lookup strategy is a one-line change.
 *
 * telegramId field
 * ────────────────
 *   Stored on the User row as a string.  The Prisma schema migration
 *   for this field is included in the step notes.
 * ═══════════════════════════════════════════════════════════════
 */

const { prisma }  = require('../../config/prisma');
const logger      = require('../../utils/logger');
const {
  linkPromptMessage,
  linkSuccessMessage,
  linkAlreadyLinkedMessage,
  linkInvalidTokenMessage,
} = require('../formatters');

/**
 * /link [token]
 */
async function handleLink(ctx) {
  const from  = ctx.from;
  const text  = ctx.message?.text ?? '';
  const parts = text.trim().split(/\s+/);
  const token = parts[1]; // /link <token>

  // No token provided — show instructions
  if (!token) {
    await ctx.reply(linkPromptMessage(), { parse_mode: 'MarkdownV2' });
    return;
  }

  try {
    await ctx.replyWithChatAction('typing');

    const telegramIdStr = String(from.id);

    // ── Check if THIS Telegram account is already linked ─────
    const existingByTelegram = await prisma.user.findFirst({
      where:  { telegramId: telegramIdStr },
      select: { id: true, name: true },
    });

    if (existingByTelegram) {
      await ctx.reply(linkAlreadyLinkedMessage(existingByTelegram.name), {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    // ── Resolve token → userId ────────────────────────────────
    // Current implementation: token = "link_<userId>" (UUID)
    // Replace this block with a Redis lookup for production.
    const userId = resolveLinkToken(token);

    if (!userId) {
      await ctx.reply(linkInvalidTokenMessage(), { parse_mode: 'MarkdownV2' });
      return;
    }

    // ── Verify the user exists and is not already linked ──────
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, name: true, telegramId: true, isActive: true },
    });

    if (!user || !user.isActive) {
      await ctx.reply(linkInvalidTokenMessage(), { parse_mode: 'MarkdownV2' });
      return;
    }

    if (user.telegramId && user.telegramId !== telegramIdStr) {
      await ctx.reply(
        '⚠️ This account is already linked to a different Telegram user\\.',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // ── Store telegramId on the user row ──────────────────────
    await prisma.user.update({
      where: { id: userId },
      data:  { telegramId: telegramIdStr },
    });

    logger.info('Telegram account linked', { telegramId: telegramIdStr, userId });

    await ctx.reply(linkSuccessMessage(user.name), { parse_mode: 'MarkdownV2' });

  } catch (err) {
    logger.error('Telegram /link error', { error: err.message, telegramId: from?.id });
    await ctx.reply('⚠️ An error occurred\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

// ─── Token resolution ─────────────────────────────────────────

/**
 * Resolve a link token to a userId.
 *
 * Current: simple "link_<uuid>" format — replace with Redis lookup.
 * @param {string} token
 * @returns {string|null} userId or null if invalid
 */
function resolveLinkToken(token) {
  if (typeof token !== 'string') return null;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (token.startsWith('link_')) {
    const maybeId = token.slice(5);
    return UUID_RE.test(maybeId) ? maybeId : null;
  }

  // Also accept a raw UUID for dev convenience
  return UUID_RE.test(token) ? token : null;
}

module.exports = { handleLink };
