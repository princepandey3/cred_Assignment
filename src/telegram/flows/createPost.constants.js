'use strict';

/**
 * createPost.constants.js
 * ═══════════════════════════════════════════════════════════════
 * Single source of truth for every choice in the create_post wizard.
 *
 * All option arrays drive BOTH keyboard rendering AND input validation,
 * so adding a new choice is always a one-line change here.
 *
 * Step order:
 *   1. AWAITING_POST_TYPE    — Announcement / Thread / etc.
 *   2. AWAITING_PLATFORMS    — multi-select: Twitter / LinkedIn / etc.
 *   3. AWAITING_TONE         — Professional / Casual / etc.
 *   4. AWAITING_AI_MODEL     — GPT-4o / Claude Sonnet / Gemini Pro
 *   5. AWAITING_IDEA         — freeform text (max 500 chars)
 *   → READY_TO_GENERATE      — terminal step, hands off to AI service
 * ═══════════════════════════════════════════════════════════════
 */

// ── Step identifiers (extend STEPS from botState.service) ─────

const CREATE_STEPS = Object.freeze({
  AWAITING_POST_TYPE: 'awaiting_post_type',
  AWAITING_PLATFORMS: 'awaiting_platforms',
  AWAITING_TONE:      'awaiting_tone',
  AWAITING_AI_MODEL:  'awaiting_ai_model',
  AWAITING_IDEA:      'awaiting_idea',
  READY_TO_GENERATE:  'ready_to_generate',
});

// ── Step ordering (used for progress indicator) ───────────────

const STEP_ORDER = [
  CREATE_STEPS.AWAITING_POST_TYPE,
  CREATE_STEPS.AWAITING_PLATFORMS,
  CREATE_STEPS.AWAITING_TONE,
  CREATE_STEPS.AWAITING_AI_MODEL,
  CREATE_STEPS.AWAITING_IDEA,
];

// ── Post types ────────────────────────────────────────────────
// Values mirror the Prisma PostType enum exactly.

const POST_TYPES = [
  { value: 'SHORT_FORM',   label: '⚡ Short Form',    desc: 'Tweet-length, punchy'         },
  { value: 'THREAD',       label: '🧵 Thread',        desc: 'Multi-part story or argument'  },
  { value: 'LONG_FORM',    label: '📝 Long Form',     desc: 'Article or newsletter'         },
  { value: 'ANNOUNCEMENT', label: '📢 Announcement',  desc: 'Product or company news'       },
  { value: 'CAROUSEL',     label: '🎠 Carousel',      desc: 'Slide-based visual content'    },
  { value: 'STORY',        label: '🎬 Story',         desc: 'Ephemeral / narrative format'  },
];

// Add ANNOUNCEMENT to PostType enum values (free-form validated here,
// Prisma has SHORT_FORM/THREAD/LONG_FORM/CAROUSEL/STORY — ANNOUNCEMENT maps to LONG_FORM)
const POST_TYPE_VALUES = new Set(POST_TYPES.map((p) => p.value));

// ── Target platforms ─────────────────────────────────────────
// Subset of connected platforms the user can choose in the wizard.

const PLATFORMS = [
  { value: 'TWITTER',   label: '🐦 Twitter / X',  short: 'TW' },
  { value: 'LINKEDIN',  label: '💼 LinkedIn',      short: 'LI' },
  { value: 'INSTAGRAM', label: '📸 Instagram',     short: 'IG' },
  { value: 'THREADS',   label: '🧵 Threads',       short: 'TH' },
];

const PLATFORM_VALUES = new Set(PLATFORMS.map((p) => p.value));

/** Label to display when multiple platforms are selected */
function formatPlatformList(values) {
  return values
    .map((v) => PLATFORMS.find((p) => p.value === v)?.label ?? v)
    .join(', ');
}

// ── Tones ─────────────────────────────────────────────────────
// Mirrors the Prisma Tone enum.

const TONES = [
  { value: 'PROFESSIONAL',  label: '👔 Professional',  desc: 'Formal and authoritative'  },
  { value: 'CASUAL',        label: '😊 Casual',        desc: 'Friendly and conversational'},
  { value: 'HUMOROUS',      label: '😄 Humorous',      desc: 'Witty and entertaining'     },
  { value: 'INSPIRATIONAL', label: '✨ Inspirational',  desc: 'Motivating and uplifting'   },
  { value: 'EDUCATIONAL',   label: '🎓 Educational',   desc: 'Clear and informative'      },
  { value: 'PERSUASIVE',    label: '🎯 Persuasive',    desc: 'Compelling call to action'  },
  { value: 'STORYTELLING',  label: '📖 Storytelling',  desc: 'Narrative-driven content'   },
];

const TONE_VALUES = new Set(TONES.map((t) => t.value));

// ── AI models ─────────────────────────────────────────────────
// modelUsed is a free String in the DB — these are the supported values.

const AI_MODELS = [
  { value: 'gpt-4o',                  label: '🤖 GPT-4o',          provider: 'OpenAI'    },
  { value: 'gpt-4o-mini',             label: '⚡ GPT-4o Mini',      provider: 'OpenAI'    },
  { value: 'claude-sonnet-4-5',       label: '🔷 Claude Sonnet',   provider: 'Anthropic' },
  { value: 'claude-haiku-4-5',        label: '🔹 Claude Haiku',    provider: 'Anthropic' },
  { value: 'gemini-1.5-pro',          label: '💎 Gemini Pro',      provider: 'Google'    },
  { value: 'gemini-1.5-flash',        label: '💡 Gemini Flash',    provider: 'Google'    },
];

const AI_MODEL_VALUES = new Set(AI_MODELS.map((m) => m.value));

// ── Idea constraints ──────────────────────────────────────────

const IDEA_MAX_CHARS = 500;
const IDEA_MIN_CHARS = 10;

// ── Exports ───────────────────────────────────────────────────

module.exports = {
  CREATE_STEPS,
  STEP_ORDER,
  POST_TYPES,
  POST_TYPE_VALUES,
  PLATFORMS,
  PLATFORM_VALUES,
  TONES,
  TONE_VALUES,
  AI_MODELS,
  AI_MODEL_VALUES,
  IDEA_MAX_CHARS,
  IDEA_MIN_CHARS,
  formatPlatformList,
};
