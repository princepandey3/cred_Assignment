'use strict';

/**
 * createPost.formatters.js
 * ═══════════════════════════════════════════════════════════════
 * All message text and InlineKeyboard builders for the create_post
 * conversation flow.
 *
 * Design rules
 * ────────────
 *   • Every exported function returns a plain string or grammy
 *     InlineKeyboard — no ctx calls here.
 *   • User-supplied text (idea, platform names, etc.) always passes
 *     through escMd() before embedding in MarkdownV2.
 *   • Keyboards use callback_data strings in the format:
 *       "cp:<field>:<value>"   — single-select answer
 *       "cp:platforms:<value>" — platform toggle
 *       "cp:platforms:done"    — confirm multi-select
 *   • The "cp:" prefix namespaces callbacks to this flow and lets
 *     registerHandlers filter with bot.callbackQuery(/^cp:/).
 * ═══════════════════════════════════════════════════════════════
 */

const { InlineKeyboard } = require('grammy');
const { escMd }          = require('../formatters');
const {
  POST_TYPES,
  PLATFORMS,
  TONES,
  AI_MODELS,
  STEP_ORDER,
  CREATE_STEPS,
  IDEA_MAX_CHARS,
  formatPlatformList,
} = require('./createPost.constants');

// ── Progress indicator ────────────────────────────────────────

/**
 * Build a progress bar string: "Step 2 / 5 ●●○○○"
 */
function progressBar(currentStep) {
  const idx    = STEP_ORDER.indexOf(currentStep);
  const total  = STEP_ORDER.length;
  const done   = idx + 1;
  const filled = '●'.repeat(done);
  const empty  = '○'.repeat(total - done);
  return `_Step ${done} of ${total}_ ${filled}${empty}`;
}

// ── Step 1: Post type ─────────────────────────────────────────

function postTypePrompt() {
  return (
    `✍️ *Create a Post*\n\n` +
    `${progressBar(CREATE_STEPS.AWAITING_POST_TYPE)}\n\n` +
    `*What type of post do you want to create?*`
  );
}

function postTypeKeyboard() {
  const kb = new InlineKeyboard();
  POST_TYPES.forEach((pt, i) => {
    kb.text(`${pt.label}`, `cp:post_type:${pt.value}`);
    // Two buttons per row
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

// ── Step 2: Platforms ─────────────────────────────────────────

/**
 * @param {Set<string>} selected  Currently selected platform values
 */
function platformsPrompt(selected = new Set()) {
  const selCount = selected.size;
  const hint = selCount === 0
    ? '_Tap platforms to select, then tap_ *Done*_._'
    : `_Selected: ${escMd(formatPlatformList([...selected]))}_`;

  return (
    `📡 *Target Platforms*\n\n` +
    `${progressBar(CREATE_STEPS.AWAITING_PLATFORMS)}\n\n` +
    `*Which platforms should this post go to?*\n` +
    `${hint}`
  );
}

/**
 * Rebuild the platform keyboard with checkmarks reflecting current selection.
 * @param {Set<string>} selected
 */
function platformsKeyboard(selected = new Set()) {
  const kb = new InlineKeyboard();
  PLATFORMS.forEach((p, i) => {
    const tick  = selected.has(p.value) ? '✅ ' : '';
    kb.text(`${tick}${p.label}`, `cp:platforms:${p.value}`);
    if (i % 2 === 1) kb.row();
  });
  // Odd number of platforms → need an extra row before Done
  if (PLATFORMS.length % 2 !== 0) kb.row();
  kb.text('✔️ Done', 'cp:platforms:done');
  return kb;
}

// ── Step 3: Tone ─────────────────────────────────────────────

function tonePrompt(postType) {
  const typeLabel = POST_TYPES.find((pt) => pt.value === postType)?.label ?? postType;
  return (
    `🎨 *Tone of Voice*\n\n` +
    `${progressBar(CREATE_STEPS.AWAITING_TONE)}\n\n` +
    `Post type: *${escMd(typeLabel)}*\n\n` +
    `*What tone should the content use?*`
  );
}

function toneKeyboard() {
  const kb = new InlineKeyboard();
  TONES.forEach((t, i) => {
    kb.text(t.label, `cp:tone:${t.value}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

// ── Step 4: AI model ─────────────────────────────────────────

function aiModelPrompt(tone) {
  const toneLabel = TONES.find((t) => t.value === tone)?.label ?? tone;
  return (
    `🤖 *AI Model*\n\n` +
    `${progressBar(CREATE_STEPS.AWAITING_AI_MODEL)}\n\n` +
    `Tone: *${escMd(toneLabel)}*\n\n` +
    `*Which AI model should generate your content?*`
  );
}

function aiModelKeyboard() {
  const kb = new InlineKeyboard();

  // Group by provider
  const byProvider = {};
  AI_MODELS.forEach((m) => {
    (byProvider[m.provider] ??= []).push(m);
  });

  Object.entries(byProvider).forEach(([provider, models]) => {
    models.forEach((m) => {
      kb.text(m.label, `cp:ai_model:${m.value}`);
    });
    kb.row();
  });

  return kb;
}

// ── Step 5: Idea ─────────────────────────────────────────────

function ideaPrompt(data) {
  const platformsLabel = escMd(formatPlatformList(data.platforms ?? []));
  const toneLabel      = escMd(TONES.find((t) => t.value === data.tone)?.label ?? data.tone ?? '');
  const modelLabel     = escMd(AI_MODELS.find((m) => m.value === data.aiModel)?.label ?? data.aiModel ?? '');

  return (
    `💡 *Your Core Idea*\n\n` +
    `${progressBar(CREATE_STEPS.AWAITING_IDEA)}\n\n` +
    `*Summary so far:*\n` +
    `  📋 Type: *${escMd(POST_TYPES.find((p) => p.value === data.postType)?.label ?? data.postType ?? '')}*\n` +
    `  📡 Platforms: *${platformsLabel}*\n` +
    `  🎨 Tone: *${toneLabel}*\n` +
    `  🤖 Model: *${modelLabel}*\n\n` +
    `*Now, what's your core idea or topic?*\n` +
    `_Type it below \\(max ${IDEA_MAX_CHARS} characters\\)\\._`
  );
}

// ── Confirmation ─────────────────────────────────────────────

/**
 * Final confirmation card shown before handing off to AI generation.
 */
function confirmationMessage(data) {
  const typeLabel      = POST_TYPES.find((p)  => p.value === data.postType)?.label ?? data.postType;
  const platformsLabel = formatPlatformList(data.platforms ?? []);
  const toneLabel      = TONES.find((t)  => t.value === data.tone)?.label      ?? data.tone;
  const modelLabel     = AI_MODELS.find((m) => m.value === data.aiModel)?.label ?? data.aiModel;

  return (
    `✅ *Ready to Generate\\!*\n\n` +
    `Here's what you've configured:\n\n` +
    `  📋 *Type:*      ${escMd(typeLabel)}\n` +
    `  📡 *Platforms:* ${escMd(platformsLabel)}\n` +
    `  🎨 *Tone:*      ${escMd(toneLabel)}\n` +
    `  🤖 *Model:*     ${escMd(modelLabel)}\n` +
    `  💡 *Idea:*      _${escMd(data.idea)}_\n\n` +
    `_AI generation will begin in the next step\\._`
  );
}

// ── Error messages ────────────────────────────────────────────

function invalidPostTypeMessage() {
  return (
    `❌ *Invalid selection\\.*\n\n` +
    `Please tap one of the buttons above to choose a post type\\.`
  );
}

function noPlatformsSelectedMessage() {
  return (
    `⚠️ *No platforms selected\\.*\n\n` +
    `Please select at least one platform before tapping *Done*\\.`
  );
}

function invalidToneMessage() {
  return (
    `❌ *Invalid selection\\.*\n\n` +
    `Please tap one of the tone buttons above\\.`
  );
}

function invalidAiModelMessage() {
  return (
    `❌ *Invalid selection\\.*\n\n` +
    `Please tap one of the AI model buttons above\\.`
  );
}

function ideaTooShortMessage(min) {
  return (
    `⚠️ *Idea too short\\.*\n\n` +
    `Please write at least ${min} characters describing your idea\\.`
  );
}

function ideaTooLongMessage(max, actual) {
  return (
    `⚠️ *Idea too long\\.*\n\n` +
    `Your message is ${actual} characters\\. ` +
    `Please shorten it to ${max} characters or fewer\\.`
  );
}

function unexpectedTextMessage(currentStep) {
  const stepLabels = {
    [CREATE_STEPS.AWAITING_POST_TYPE]: 'a post type',
    [CREATE_STEPS.AWAITING_PLATFORMS]: 'your target platforms',
    [CREATE_STEPS.AWAITING_TONE]:      'a tone',
    [CREATE_STEPS.AWAITING_AI_MODEL]:  'an AI model',
  };
  const expected = stepLabels[currentStep] ?? 'a response';
  return (
    `⚠️ *Unexpected input\\.*\n\n` +
    `I'm waiting for you to select *${expected}* using the buttons above\\.\n` +
    `Send /cancel to exit this flow\\.`
  );
}

module.exports = {
  progressBar,
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
};
