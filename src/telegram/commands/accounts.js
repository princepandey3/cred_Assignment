'use strict';

/**
 * accounts.js — /accounts command handler
 * ═══════════════════════════════════════════════════════════════
 * Shows the authenticated user's connected social platform accounts.
 *
 * Requires a linked account (requireLinkedAccount middleware applied
 * in registerHandlers before this handler runs).
 *
 * Pipeline:
 *   1. ctx.appUser is already populated by telegramAuth middleware.
 *   2. Fetch all active social accounts for that user from the DB.
 *   3. Format and reply.  Token values never appear in output.
 * ═══════════════════════════════════════════════════════════════
 */

const socialAccountRepository = require('../../repositories/socialAccount.repository');
const { accountsMessage }     = require('../formatters');
const logger                  = require('../../utils/logger');

/**
 * /accounts command handler.
 * ctx.appUser must be set by requireLinkedAccount middleware.
 */
async function handleAccounts(ctx) {
  const { id: userId, name } = ctx.appUser;

  try {
    // Send a typing indicator while we fetch from DB
    await ctx.replyWithChatAction('typing');

    const accounts = await socialAccountRepository.findByUserId(userId);

    // Map repository shape → API shape (snake_case, no tokens)
    const formatted = accounts.map((a) => ({
      id:               a.id,
      platform:         a.platform,
      handle:           a.handle,
      token_expires_at: a.tokenExpiresAt ?? null,
      is_active:        a.isActive,
      connected_at:     a.connectedAt,
    }));

    await ctx.reply(accountsMessage(formatted, name), { parse_mode: 'MarkdownV2' });

    logger.info('Telegram /accounts', {
      telegramId: ctx.from?.id,
      userId,
      accountCount: formatted.length,
    });

  } catch (err) {
    logger.error('Telegram /accounts error', { error: err.message, userId });
    await ctx.reply('⚠️ Could not load your accounts\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

module.exports = { handleAccounts };
