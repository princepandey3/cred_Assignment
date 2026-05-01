'use strict';

/**
 * cancel.js — /cancel command handler
 * ═══════════════════════════════════════════════════════════════
 * Exits any active conversation flow and resets state to idle.
 *
 * Always available — works whether or not the user has a linked account,
 * and regardless of which flow or step they are currently in.
 *
 * Design note
 * ───────────
 * This is the "escape hatch" for every wizard. Any multi-step handler
 * must respect the fact that the user can /cancel at any point, so
 * wizards should never assume their flow state still exists after
 * awaiting any user input.
 * ═══════════════════════════════════════════════════════════════
 */

const { botStateService, FLOWS } = require('../../services/botState.service');
const logger = require('../../utils/logger');

/**
 * Flow display names for the confirmation message.
 * Keeps the UX friendly rather than showing raw snake_case identifiers.
 */
const FLOW_LABELS = {
  [FLOWS.CREATE_POST]:   'post creation',
  [FLOWS.SCHEDULE_POST]: 'post scheduling',
  [FLOWS.LINK_ACCOUNT]:  'account linking',
};

/**
 * /cancel
 * Clears conversation state for the current chat.
 * ctx.endFlow() is injected by injectState middleware.
 */
async function handleCancel(ctx) {
  const chatId = ctx.chat.id;

  try {
    // Get current state before clearing — so we can name the flow in the reply
    const state = await ctx.getState();

    if (!state || !state.flow) {
      await ctx.reply(
        `ℹ️ There's nothing to cancel — you're not in any active flow\\.\n` +
        `Use /help to see what you can do\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const flowLabel = FLOW_LABELS[state.flow] ?? state.flow.replace(/_/g, ' ');

    await ctx.endFlow();

    await ctx.reply(
      `✅ *${capitalize(flowLabel)} cancelled\\.*\n\n` +
      `Use /help to see available commands\\.`,
      { parse_mode: 'MarkdownV2' }
    );

    logger.info('Telegram /cancel', {
      telegramId: ctx.from?.id,
      chatId,
      cancelledFlow: state.flow,
      cancelledStep: state.step,
    });

  } catch (err) {
    logger.error('Telegram /cancel error', { error: err.message, chatId });
    await ctx.reply('⚠️ Something went wrong\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { handleCancel };
