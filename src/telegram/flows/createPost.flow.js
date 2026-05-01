'use strict';

/**
 * createPost.flow.js
 * ═══════════════════════════════════════════════════════════════
 * Implements the full multi-step "create a post" wizard.
 *
 * Entry points (registered in registerHandlers.js):
 *   /create or /post    → handleCreatePost  (starts the flow)
 *   callback_query ^cp: → handlePostCallback (button presses)
 *   message:text (step guard) → handleIdeaInput (step 5 free text)
 *
 * Flow steps:
 *   1. AWAITING_POST_TYPE  → user picks from inline keyboard
 *   2. AWAITING_PLATFORMS  → multi-select with toggle buttons + Done
 *   3. AWAITING_TONE       → user picks from inline keyboard
 *   4. AWAITING_AI_MODEL   → user picks from inline keyboard
 *   5. AWAITING_IDEA       → user types free text (max 500 chars)
 *   → READY_TO_GENERATE    → flow complete, hands off to AI service (Step 11)
 *
 * State shape stored in Redis (state.data):
 * {
 *   postType:  'SHORT_FORM' | 'THREAD' | ...
 *   platforms: ['TWITTER', 'LINKEDIN', ...]   ← accumulated via toggles
 *   tone:      'PROFESSIONAL' | ...
 *   aiModel:   'gpt-4o' | ...
 *   idea:      string (max 500 chars)
 * }
 *
 * Error handling strategy
 * ───────────────────────
 * • Button presses that don't match expected values → re-prompt with error
 * • Free text at a button-only step → gentle nudge to use buttons
 * • /cancel always works (registered globally in registerHandlers)
 * • Any Redis / unexpected error → reply with generic error, DO NOT crash
 * ═══════════════════════════════════════════════════════════════
 */

const { FLOWS }         = require('../../services/botState.service');
const { requireIdle, requireStep } = require('../middleware/stateMiddleware');
const { requireLinkedAccount }     = require('../middleware/telegramAuth');
const logger            = require('../../utils/logger');

const {
  CREATE_STEPS,
  POST_TYPE_VALUES,
  PLATFORM_VALUES,
  TONE_VALUES,
  AI_MODEL_VALUES,
  IDEA_MAX_CHARS,
  IDEA_MIN_CHARS,
} = require('./createPost.constants');

const {
  postTypePrompt,
  postTypeKeyboard,
  platformsPrompt,
  platformsKeyboard,
  tonePrompt,
  toneKeyboard,
  aiModelPrompt,
  aiModelKeyboard,
  ideaPrompt,
  confirmationMessage,
  invalidPostTypeMessage,
  noPlatformsSelectedMessage,
  invalidToneMessage,
  invalidAiModelMessage,
  ideaTooShortMessage,
  ideaTooLongMessage,
  unexpectedTextMessage,
} = require('./createPost.formatters');

// ── Entry point: /create or /post ─────────────────────────────

/**
 * Triggered by /create or /post commands.
 * requireLinkedAccount and requireIdle are applied in registerHandlers.
 */
async function handleCreatePost(ctx) {
  try {
    await ctx.replyWithChatAction('typing');

    await ctx.startFlow(FLOWS.CREATE_POST, CREATE_STEPS.AWAITING_POST_TYPE);

    await ctx.reply(postTypePrompt(), {
      parse_mode:   'MarkdownV2',
      reply_markup: postTypeKeyboard(),
    });

    logger.info('create_post flow started', {
      telegramId: ctx.from?.id,
      chatId:     ctx.chat.id,
    });
  } catch (err) {
    logger.error('handleCreatePost error', { error: err.message });
    await ctx.reply('⚠️ Could not start the flow\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

// ── Callback query dispatcher ─────────────────────────────────

/**
 * Routes all callback queries whose data starts with "cp:".
 * Registered as: bot.callbackQuery(/^cp:/, handlePostCallback)
 *
 * Callback data format: "cp:<field>:<value>"
 */
async function handlePostCallback(ctx) {
  // Always acknowledge the callback — removes the loading spinner
  await ctx.answerCallbackQuery();

  const data  = ctx.callbackQuery.data;           // e.g. "cp:post_type:SHORT_FORM"
  const parts = data.split(':');                  // ["cp", "post_type", "SHORT_FORM"]
  const field = parts[1];                         // "post_type"
  const value = parts.slice(2).join(':');         // "SHORT_FORM" (handles colons in values)

  // Verify we're still in a create_post flow (guard against stale callbacks)
  const state = await ctx.getState();
  if (state?.flow !== FLOWS.CREATE_POST) {
    await ctx.editMessageText(
      '⏱️ This session has expired\\. Start a new one with /create\\.',
      { parse_mode: 'MarkdownV2' }
    ).catch(() => {}); // may fail if message is too old
    return;
  }

  try {
    switch (field) {
      case 'post_type': return await handlePostTypeAnswer(ctx, value, state);
      case 'platforms': return await handlePlatformToggle(ctx, value, state);
      case 'tone':      return await handleToneAnswer(ctx, value, state);
      case 'ai_model':  return await handleAiModelAnswer(ctx, value, state);
      default:
        logger.warn('Unknown callback field in create_post flow', { field, value });
    }
  } catch (err) {
    logger.error('handlePostCallback error', { error: err.message, field, value });
    await ctx.reply('⚠️ Something went wrong\\. Please try again or /cancel\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

// ── Step handlers ─────────────────────────────────────────────

/**
 * Step 1 → Step 2: Post type selected.
 */
async function handlePostTypeAnswer(ctx, value, state) {
  if (state.step !== CREATE_STEPS.AWAITING_POST_TYPE) return;

  if (!POST_TYPE_VALUES.has(value)) {
    await ctx.answerCallbackQuery({ text: 'Invalid selection — please use the buttons.' });
    return;
  }

  // Save answer and advance to platforms step
  await ctx.setState({
    step: CREATE_STEPS.AWAITING_PLATFORMS,
    data: { ...state.data, postType: value, platforms: [] },
  });

  // Edit the original message to show the next prompt
  await ctx.editMessageText(platformsPrompt(new Set()), {
    parse_mode:   'MarkdownV2',
    reply_markup: platformsKeyboard(new Set()),
  });

  logger.debug('create_post step 1→2', { chatId: ctx.chat.id, postType: value });
}

/**
 * Step 2: Platform toggle or "done" confirmation.
 * Platforms are multi-select — tapping toggles; "done" advances.
 */
async function handlePlatformToggle(ctx, value, state) {
  if (state.step !== CREATE_STEPS.AWAITING_PLATFORMS) return;

  const selected = new Set(state.data.platforms ?? []);

  if (value === 'done') {
    // Validate at least one platform chosen
    if (selected.size === 0) {
      await ctx.answerCallbackQuery({ text: '⚠️ Select at least one platform first.' });
      return;
    }

    // Save and advance to tone
    await ctx.setState({
      step: CREATE_STEPS.AWAITING_TONE,
      data: { ...state.data, platforms: [...selected] },
    });

    await ctx.editMessageText(tonePrompt(state.data.postType), {
      parse_mode:   'MarkdownV2',
      reply_markup: toneKeyboard(),
    });

    logger.debug('create_post step 2→3', { chatId: ctx.chat.id, platforms: [...selected] });
    return;
  }

  // Toggle platform membership
  if (!PLATFORM_VALUES.has(value)) {
    await ctx.answerCallbackQuery({ text: 'Unknown platform — please use the buttons.' });
    return;
  }

  if (selected.has(value)) {
    selected.delete(value);
  } else {
    selected.add(value);
  }

  // Persist updated selection and refresh the keyboard in-place
  await ctx.setState({
    data: { ...state.data, platforms: [...selected] },
  });

  await ctx.editMessageText(platformsPrompt(selected), {
    parse_mode:   'MarkdownV2',
    reply_markup: platformsKeyboard(selected),
  });

  const tick = selected.has(value) ? 'selected' : 'deselected';
  await ctx.answerCallbackQuery({ text: `${tick === 'selected' ? '✅' : '☐'} ${value} ${tick}` });
}

/**
 * Step 3 → Step 4: Tone selected.
 */
async function handleToneAnswer(ctx, value, state) {
  if (state.step !== CREATE_STEPS.AWAITING_TONE) return;

  if (!TONE_VALUES.has(value)) {
    await ctx.answerCallbackQuery({ text: 'Invalid tone — please use the buttons.' });
    return;
  }

  await ctx.setState({
    step: CREATE_STEPS.AWAITING_AI_MODEL,
    data: { ...state.data, tone: value },
  });

  await ctx.editMessageText(aiModelPrompt(value), {
    parse_mode:   'MarkdownV2',
    reply_markup: aiModelKeyboard(),
  });

  logger.debug('create_post step 3→4', { chatId: ctx.chat.id, tone: value });
}

/**
 * Step 4 → Step 5: AI model selected.
 */
async function handleAiModelAnswer(ctx, value, state) {
  if (state.step !== CREATE_STEPS.AWAITING_AI_MODEL) return;

  if (!AI_MODEL_VALUES.has(value)) {
    await ctx.answerCallbackQuery({ text: 'Invalid model — please use the buttons.' });
    return;
  }

  const nextData = { ...state.data, aiModel: value };

  await ctx.setState({
    step: CREATE_STEPS.AWAITING_IDEA,
    data: nextData,
  });

  // Step 5 is free-text input — send a NEW message (not an edit)
  // so the keyboard disappears and the text prompt is clearly visible.
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  await ctx.reply(ideaPrompt(nextData), { parse_mode: 'MarkdownV2' });

  logger.debug('create_post step 4→5', { chatId: ctx.chat.id, aiModel: value });
}

// ── Step 5: Idea text input ───────────────────────────────────

/**
 * Handles free-text input at the AWAITING_IDEA step.
 * Registered in registerHandlers as:
 *   bot.on('message:text', requireStep(CREATE_STEPS.AWAITING_IDEA, FLOWS.CREATE_POST), handleIdeaInput)
 */
async function handleIdeaInput(ctx) {
  const idea = (ctx.message.text ?? '').trim();
  const state = await ctx.getState();

  if (!state || state.step !== CREATE_STEPS.AWAITING_IDEA) return;

  // Validation
  if (idea.length < IDEA_MIN_CHARS) {
    await ctx.reply(ideaTooShortMessage(IDEA_MIN_CHARS), { parse_mode: 'MarkdownV2' });
    return;
  }

  if (idea.length > IDEA_MAX_CHARS) {
    await ctx.reply(ideaTooLongMessage(IDEA_MAX_CHARS, idea.length), { parse_mode: 'MarkdownV2' });
    return;
  }

  const finalData = { ...state.data, idea };

  // Advance to terminal step
  await ctx.setState({
    step: CREATE_STEPS.READY_TO_GENERATE,
    data: finalData,
  });

  // Show confirmation card — AI generation is Step 11
  await ctx.reply(confirmationMessage(finalData), { parse_mode: 'MarkdownV2' });

  logger.info('create_post flow complete — ready to generate', {
    telegramId: ctx.from?.id,
    chatId:     ctx.chat.id,
    postType:   finalData.postType,
    platforms:  finalData.platforms,
    tone:       finalData.tone,
    aiModel:    finalData.aiModel,
    ideaLen:    idea.length,
  });
}

// ── Unexpected text guard ─────────────────────────────────────

/**
 * Catches plain text sent during button-only steps (1–4).
 * Registered AFTER step-specific handlers so it only fires when
 * none of the requireStep guards matched.
 *
 * Pattern in registerHandlers:
 *   bot.on('message:text', handleUnexpectedInput)  ← last text handler
 */
async function handleUnexpectedFlowInput(ctx) {
  const state = await ctx.getState();

  // Only intervene if we're in the create_post flow at a button step
  const buttonOnlySteps = new Set([
    CREATE_STEPS.AWAITING_POST_TYPE,
    CREATE_STEPS.AWAITING_PLATFORMS,
    CREATE_STEPS.AWAITING_TONE,
    CREATE_STEPS.AWAITING_AI_MODEL,
  ]);

  if (state?.flow !== FLOWS.CREATE_POST) return;
  if (!buttonOnlySteps.has(state.step))  return;

  // Don't intercept commands — let the command handlers run
  if ((ctx.message?.text ?? '').startsWith('/')) return;

  await ctx.reply(unexpectedTextMessage(state.step), { parse_mode: 'MarkdownV2' });
}

// ── Exports ───────────────────────────────────────────────────

module.exports = {
  handleCreatePost,
  handlePostCallback,
  handleIdeaInput,
  handleUnexpectedFlowInput,
};
