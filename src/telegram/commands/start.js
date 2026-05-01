'use strict';

/**
 * start.js & help.js handlers
 * ═══════════════════════════════════════════════════════════════
 * /start — Welcome message, always available (no auth required).
 * /help  — Command reference, always available.
 * ═══════════════════════════════════════════════════════════════
 */

const { startMessage, helpMessage } = require('../formatters');
const logger = require('../../utils/logger');

/**
 * /start
 * Shown when a user first opens the bot or types /start.
 * No account linking required.
 */
async function handleStart(ctx) {
  try {
    const firstName = ctx.from?.first_name ?? null;
    await ctx.reply(startMessage(firstName), { parse_mode: 'MarkdownV2' });
    logger.info('Telegram /start', { telegramId: ctx.from?.id });
  } catch (err) {
    logger.error('Telegram /start error', { error: err.message });
    await ctx.reply('👋 Welcome\\! Use /help to see available commands\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /help
 * Full command reference.  Works without a linked account so new users
 * can discover /link before they've set anything up.
 */
async function handleHelp(ctx) {
  try {
    await ctx.reply(helpMessage(), { parse_mode: 'MarkdownV2' });
    logger.info('Telegram /help', { telegramId: ctx.from?.id });
  } catch (err) {
    logger.error('Telegram /help error', { error: err.message });
    await ctx.reply('Use /link to connect your account, then /accounts to view platforms.');
  }
}

module.exports = { handleStart, handleHelp };
