'use strict';

/**
 * createPost.step10.test.js
 * ═══════════════════════════════════════════════════════════════
 * Integration + unit tests for Step 10 — Multi-Step Publishing Flow
 *
 * Coverage:
 *   Constants
 *     • POST_TYPES, PLATFORMS, TONES, AI_MODELS — correct values & counts
 *     • All value Sets contain expected members
 *     • IDEA_MAX_CHARS = 500, IDEA_MIN_CHARS = 10
 *
 *   Formatters
 *     • progressBar() — correct step number and filled/empty dots
 *     • postTypePrompt() — contains step indicator
 *     • platformsPrompt() — shows selected platforms
 *     • confirmationMessage() — contains all collected data
 *     • Error messages — each contains descriptive text
 *
 *   Flow handlers (mocked Redis + Telegram API)
 *     • handleCreatePost   — starts flow, sends post-type keyboard
 *     • Step 1 → 2         — valid post_type advances to platforms
 *     • Step 2 toggle      — platforms toggle and keyboard refreshes
 *     • Step 2 done        — no platforms selected → error; valid → advances
 *     • Step 3 → 4         — valid tone advances to AI model prompt
 *     • Step 4 → 5         — valid AI model advances to idea prompt
 *     • Step 5 idea input  — short / long / valid idea handling
 *     • Expired session    — stale callback on non-create_post state
 *     • Wrong step         — callback for step 1 while at step 3 is ignored
 *     • Unexpected text    — text at button-only step triggers nudge
 *     • requireIdle guard  — /create blocked while flow is active
 * ═══════════════════════════════════════════════════════════════
 */

process.env.NODE_ENV           = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test:placeholder_token';
process.env.ENCRYPTION_SECRET  = 'test_enc_secret_32_chars_minimum_here!!!';
process.env.JWT_SECRET         = 'test_jwt_secret_at_least_32_chars_here_yes';

// ── Mock Redis ────────────────────────────────────────────────
const mockRedis = {
  get:  jest.fn(),
  set:  jest.fn(),
  del:  jest.fn(),
  ttl:  jest.fn(),
  keys: jest.fn(),
};
jest.mock('../config/redis', () => ({
  getRedisClient:  jest.fn(async () => mockRedis),
  disconnectRedis: jest.fn(),
}));

// ── Mock Prisma ───────────────────────────────────────────────
jest.mock('../config/prisma', () => ({
  prisma:           { user: { findFirst: jest.fn() } },
  connectPrisma:    jest.fn(),
  disconnectPrisma: jest.fn(),
}));

// ── Mock socialAccount repository ────────────────────────────
jest.mock('../repositories/socialAccount.repository', () => ({
  findByUserId: jest.fn(),
}));

// ── Imports ───────────────────────────────────────────────────
const {
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
} = require('../telegram/flows/createPost.constants');

const {
  progressBar,
  postTypePrompt,
  platformsPrompt,
  platformsKeyboard,
  tonePrompt,
  aiModelPrompt,
  ideaPrompt,
  confirmationMessage,
  noPlatformsSelectedMessage,
  ideaTooShortMessage,
  ideaTooLongMessage,
  unexpectedTextMessage,
} = require('../telegram/flows/createPost.formatters');

const {
  handleCreatePost,
  handlePostCallback,
  handleIdeaInput,
  handleUnexpectedFlowInput,
} = require('../telegram/flows/createPost.flow');

const { FLOWS, STATE_TTL_SECONDS } = require('../services/botState.service');
const { requireIdle }              = require('../telegram/middleware/stateMiddleware');

// ── Helpers ───────────────────────────────────────────────────

const CHAT_ID = 88888;

function makeState(overrides = {}) {
  return {
    step: null, flow: null, data: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a mock grammy ctx with all methods the flow handlers call.
 */
function makeCtx({ stateOverride = null, callbackData = null, text = '' } = {}) {
  let _state = stateOverride;
  const replies = [];
  const edits   = [];

  const ctx = {
    chat:    { id: CHAT_ID },
    from:    { id: 999, first_name: 'Alice' },
    message: text ? { text } : undefined,
    callbackQuery: callbackData ? { data: callbackData } : undefined,
    appUser: { id: 'user-001', name: 'Alice', defaultTone: 'CASUAL', isActive: true },

    reply:              jest.fn(async (msg, _opts) => { replies.push(msg); return {}; }),
    editMessageText:    jest.fn(async (msg, _opts) => { edits.push(msg); return {}; }),
    editMessageReplyMarkup: jest.fn(async () => {}),
    answerCallbackQuery: jest.fn(async () => {}),
    replyWithChatAction: jest.fn(async () => {}),

    _replies: replies,
    _edits:   edits,

    // State methods (injected by injectState in real usage, mocked here)
    getState: jest.fn(async () => _state),
    setState: jest.fn(async (patch) => {
      _state = {
        ...(_state ?? makeState()),
        ...patch,
        data: { ...(_state?.data ?? {}), ...(patch.data ?? {}) },
        updatedAt: new Date().toISOString(),
      };
      // Reflect to Redis mock
      mockRedis.set.mockResolvedValue('OK');
      return _state;
    }),
    clearState: jest.fn(async () => { _state = null; }),
    startFlow:  jest.fn(async (flow, step, data = {}) => {
      _state = makeState({ flow, step, data });
      mockRedis.set.mockResolvedValue('OK');
      return _state;
    }),
    endFlow: jest.fn(async () => { _state = null; }),

    // Expose current state for assertions
    get _currentState() { return _state; },
  };

  return ctx;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.get.mockResolvedValue(null);
  mockRedis.del.mockResolvedValue(1);
});

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

describe('createPost constants', () => {
  it('has 6 post types matching Prisma PostType enum', () => {
    expect(POST_TYPES).toHaveLength(6);
    expect(POST_TYPE_VALUES.has('SHORT_FORM')).toBe(true);
    expect(POST_TYPE_VALUES.has('THREAD')).toBe(true);
    expect(POST_TYPE_VALUES.has('LONG_FORM')).toBe(true);
    expect(POST_TYPE_VALUES.has('CAROUSEL')).toBe(true);
    expect(POST_TYPE_VALUES.has('STORY')).toBe(true);
    expect(POST_TYPE_VALUES.has('ANNOUNCEMENT')).toBe(true);
  });

  it('has exactly 4 target platforms', () => {
    expect(PLATFORMS).toHaveLength(4);
    expect(PLATFORM_VALUES.has('TWITTER')).toBe(true);
    expect(PLATFORM_VALUES.has('LINKEDIN')).toBe(true);
    expect(PLATFORM_VALUES.has('INSTAGRAM')).toBe(true);
    expect(PLATFORM_VALUES.has('THREADS')).toBe(true);
  });

  it('has 7 tones matching Prisma Tone enum', () => {
    expect(TONES).toHaveLength(7);
    ['PROFESSIONAL','CASUAL','HUMOROUS','INSPIRATIONAL','EDUCATIONAL','PERSUASIVE','STORYTELLING']
      .forEach(t => expect(TONE_VALUES.has(t)).toBe(true));
  });

  it('has 6 AI models across 3 providers', () => {
    expect(AI_MODELS).toHaveLength(6);
    expect(AI_MODEL_VALUES.has('gpt-4o')).toBe(true);
    expect(AI_MODEL_VALUES.has('claude-sonnet-4-5')).toBe(true);
    expect(AI_MODEL_VALUES.has('gemini-1.5-pro')).toBe(true);
  });

  it('enforces correct IDEA_MAX_CHARS and IDEA_MIN_CHARS', () => {
    expect(IDEA_MAX_CHARS).toBe(500);
    expect(IDEA_MIN_CHARS).toBe(10);
  });

  it('STEP_ORDER has 5 steps in correct sequence', () => {
    expect(STEP_ORDER).toHaveLength(5);
    expect(STEP_ORDER[0]).toBe(CREATE_STEPS.AWAITING_POST_TYPE);
    expect(STEP_ORDER[4]).toBe(CREATE_STEPS.AWAITING_IDEA);
  });

  it('formatPlatformList renders display labels', () => {
    const result = formatPlatformList(['TWITTER', 'LINKEDIN']);
    expect(result).toContain('Twitter');
    expect(result).toContain('LinkedIn');
  });
});

// ═══════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════

describe('createPost formatters', () => {
  describe('progressBar()', () => {
    it('shows "Step 1 of 5" for first step', () => {
      const bar = progressBar(CREATE_STEPS.AWAITING_POST_TYPE);
      expect(bar).toContain('1');
      expect(bar).toContain('5');
      expect(bar).toContain('●');
      expect(bar).toContain('○');
    });

    it('shows fully filled bar at last step', () => {
      const bar = progressBar(CREATE_STEPS.AWAITING_IDEA);
      expect(bar).toContain('5');
      expect(bar).not.toContain('○'); // all filled
    });
  });

  describe('postTypePrompt()', () => {
    it('contains step indicator and heading', () => {
      const msg = postTypePrompt();
      expect(msg).toContain('Create a Post');
      expect(msg).toContain('Step 1');
      expect(msg).toContain('type of post');
    });
  });

  describe('platformsPrompt()', () => {
    it('shows empty hint when nothing selected', () => {
      const msg = platformsPrompt(new Set());
      expect(msg).toContain('Target Platforms');
      expect(msg).toContain('Tap platforms');
    });

    it('shows selected platforms when some are chosen', () => {
      const msg = platformsPrompt(new Set(['TWITTER', 'LINKEDIN']));
      expect(msg).toContain('Twitter');
      expect(msg).toContain('LinkedIn');
    });
  });

  describe('platformsKeyboard()', () => {
    it('marks selected platforms with checkmark', () => {
      const kb = platformsKeyboard(new Set(['TWITTER']));
      const flatButtons = kb.inline_keyboard.flat();
      const twitterBtn = flatButtons.find(b => b.callback_data === 'cp:platforms:TWITTER');
      expect(twitterBtn.text).toContain('✅');
    });

    it('includes a Done button', () => {
      const kb = platformsKeyboard(new Set());
      const flatButtons = kb.inline_keyboard.flat();
      expect(flatButtons.some(b => b.callback_data === 'cp:platforms:done')).toBe(true);
    });
  });

  describe('tonePrompt()', () => {
    it('includes post type label and step indicator', () => {
      const msg = tonePrompt('SHORT_FORM');
      expect(msg).toContain('Short Form');
      expect(msg).toContain('Step 3');
    });
  });

  describe('aiModelPrompt()', () => {
    it('includes tone label and step indicator', () => {
      const msg = aiModelPrompt('CASUAL');
      expect(msg).toContain('Casual');
      expect(msg).toContain('Step 4');
    });
  });

  describe('ideaPrompt()', () => {
    it('shows all collected data and character limit', () => {
      const data = {
        postType: 'SHORT_FORM', platforms: ['TWITTER'],
        tone: 'CASUAL', aiModel: 'gpt-4o',
      };
      const msg = ideaPrompt(data);
      expect(msg).toContain('Short Form');
      expect(msg).toContain('Twitter');
      expect(msg).toContain('Casual');
      expect(msg).toContain('GPT-4o');
      expect(msg).toContain('500');
    });
  });

  describe('confirmationMessage()', () => {
    it('includes all 5 data fields', () => {
      const data = {
        postType: 'THREAD', platforms: ['LINKEDIN', 'TWITTER'],
        tone: 'PROFESSIONAL', aiModel: 'claude-sonnet-4-5',
        idea: 'Why async programming matters',
      };
      const msg = confirmationMessage(data);
      expect(msg).toContain('Thread');
      expect(msg).toContain('LinkedIn');
      expect(msg).toContain('Professional');
      expect(msg).toContain('Claude Sonnet');
      expect(msg).toContain('Why async programming matters');
      expect(msg).toContain('Ready to Generate');
    });
  });

  describe('error messages', () => {
    it('noPlatformsSelectedMessage contains helpful text', () => {
      expect(noPlatformsSelectedMessage()).toContain('No platforms selected');
    });

    it('ideaTooShortMessage includes min chars', () => {
      expect(ideaTooShortMessage(10)).toContain('10');
    });

    it('ideaTooLongMessage includes max and actual chars', () => {
      expect(ideaTooLongMessage(500, 523)).toContain('500');
      expect(ideaTooLongMessage(500, 523)).toContain('523');
    });

    it('unexpectedTextMessage names the expected input type', () => {
      expect(unexpectedTextMessage(CREATE_STEPS.AWAITING_TONE)).toContain('tone');
      expect(unexpectedTextMessage(CREATE_STEPS.AWAITING_PLATFORMS)).toContain('platforms');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Flow: /create entry point
// ═══════════════════════════════════════════════════════════════

describe('handleCreatePost()', () => {
  it('starts create_post flow and sends post-type keyboard', async () => {
    const ctx = makeCtx();
    await handleCreatePost(ctx);

    expect(ctx.startFlow).toHaveBeenCalledWith(
      FLOWS.CREATE_POST,
      CREATE_STEPS.AWAITING_POST_TYPE
    );
    expect(ctx.reply).toHaveBeenCalled();
    expect(ctx._replies[0]).toContain('Create a Post');
    expect(ctx._currentState.flow).toBe(FLOWS.CREATE_POST);
    expect(ctx._currentState.step).toBe(CREATE_STEPS.AWAITING_POST_TYPE);
  });

  it('sends a typing action before the prompt', async () => {
    const ctx = makeCtx();
    await handleCreatePost(ctx);
    expect(ctx.replyWithChatAction).toHaveBeenCalledWith('typing');
  });

  it('replies with error message on unexpected failure', async () => {
    const ctx = makeCtx();
    ctx.startFlow.mockRejectedValueOnce(new Error('Redis down'));
    await handleCreatePost(ctx);
    expect(ctx._replies[0]).toContain('Could not start');
  });
});

// ═══════════════════════════════════════════════════════════════
// Step 1 → 2: Post type
// ═══════════════════════════════════════════════════════════════

describe('Step 1 — post type selection', () => {
  it('advances to step 2 (platforms) on valid post type', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_POST_TYPE });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:post_type:SHORT_FORM' });

    await handlePostCallback(ctx);

    expect(ctx.setState).toHaveBeenCalledWith(expect.objectContaining({
      step: CREATE_STEPS.AWAITING_PLATFORMS,
      data: expect.objectContaining({ postType: 'SHORT_FORM', platforms: [] }),
    }));
    expect(ctx._edits[0]).toContain('Target Platforms');
  });

  it('acknowledges and ignores invalid post_type value', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_POST_TYPE });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:post_type:INVALID_TYPE' });

    await handlePostCallback(ctx);

    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Invalid') })
    );
  });

  it('accepts all 6 post types', async () => {
    for (const pt of POST_TYPES) {
      const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_POST_TYPE });
      const ctx = makeCtx({ stateOverride: state, callbackData: `cp:post_type:${pt.value}` });
      await handlePostCallback(ctx);
      expect(ctx.setState).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ postType: pt.value }) })
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Step 2: Platform multi-select
// ═══════════════════════════════════════════════════════════════

describe('Step 2 — platform selection', () => {
  it('toggles a platform ON when not yet selected', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_PLATFORMS,
      data: { postType: 'SHORT_FORM', platforms: [] },
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:platforms:TWITTER' });

    await handlePostCallback(ctx);

    expect(ctx.setState).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ platforms: ['TWITTER'] }) })
    );
    // Keyboard refreshed in-place
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it('toggles a platform OFF when already selected', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_PLATFORMS,
      data: { postType: 'THREAD', platforms: ['TWITTER', 'LINKEDIN'] },
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:platforms:TWITTER' });

    await handlePostCallback(ctx);

    const saved = ctx.setState.mock.calls[0][0].data.platforms;
    expect(saved).not.toContain('TWITTER');
    expect(saved).toContain('LINKEDIN');
  });

  it('rejects "done" when no platforms selected', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_PLATFORMS,
      data: { postType: 'SHORT_FORM', platforms: [] },
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:platforms:done' });

    await handlePostCallback(ctx);

    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('at least one') })
    );
  });

  it('advances to step 3 (tone) on "done" with platforms selected', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_PLATFORMS,
      data: { postType: 'SHORT_FORM', platforms: ['TWITTER', 'LINKEDIN'] },
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:platforms:done' });

    await handlePostCallback(ctx);

    expect(ctx.setState).toHaveBeenCalledWith(expect.objectContaining({
      step: CREATE_STEPS.AWAITING_TONE,
      data: expect.objectContaining({ platforms: ['TWITTER', 'LINKEDIN'] }),
    }));
    expect(ctx._edits[0]).toContain('Tone');
  });

  it('accepts all 4 valid platforms', async () => {
    for (const p of PLATFORMS) {
      const state = makeState({
        flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_PLATFORMS,
        data: { postType: 'SHORT_FORM', platforms: [] },
      });
      const ctx = makeCtx({ stateOverride: state, callbackData: `cp:platforms:${p.value}` });
      await handlePostCallback(ctx);
      expect(ctx.setState).toHaveBeenCalled();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Step 3 → 4: Tone
// ═══════════════════════════════════════════════════════════════

describe('Step 3 — tone selection', () => {
  it('advances to step 4 (AI model) on valid tone', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_TONE,
      data: { postType: 'SHORT_FORM', platforms: ['TWITTER'] },
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:tone:CASUAL' });

    await handlePostCallback(ctx);

    expect(ctx.setState).toHaveBeenCalledWith(expect.objectContaining({
      step: CREATE_STEPS.AWAITING_AI_MODEL,
      data: expect.objectContaining({ tone: 'CASUAL' }),
    }));
    expect(ctx._edits[0]).toContain('AI Model');
  });

  it('rejects invalid tone value', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_TONE, data: {} });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:tone:ANGRY' });

    await handlePostCallback(ctx);

    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Invalid') })
    );
  });

  it('accepts all 7 valid tones', async () => {
    for (const t of TONES) {
      const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_TONE, data: {} });
      const ctx = makeCtx({ stateOverride: state, callbackData: `cp:tone:${t.value}` });
      await handlePostCallback(ctx);
      expect(ctx.setState).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tone: t.value }) })
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Step 4 → 5: AI model
// ═══════════════════════════════════════════════════════════════

describe('Step 4 — AI model selection', () => {
  it('advances to step 5 (idea) on valid model', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_AI_MODEL,
      data: { postType: 'SHORT_FORM', platforms: ['TWITTER'], tone: 'CASUAL' },
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:ai_model:gpt-4o' });

    await handlePostCallback(ctx);

    expect(ctx.setState).toHaveBeenCalledWith(expect.objectContaining({
      step: CREATE_STEPS.AWAITING_IDEA,
      data: expect.objectContaining({ aiModel: 'gpt-4o' }),
    }));
    // Sends a NEW message (not just an edit) for the free-text step
    expect(ctx._replies.some(r => r.includes('Core Idea'))).toBe(true);
  });

  it('rejects invalid AI model value', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_AI_MODEL, data: {} });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:ai_model:gpt-2' });

    await handlePostCallback(ctx);

    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Invalid') })
    );
  });

  it('accepts all 6 AI models', async () => {
    for (const m of AI_MODELS) {
      const state = makeState({
        flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_AI_MODEL,
        data: { postType: 'SHORT_FORM', platforms: ['TWITTER'], tone: 'CASUAL' },
      });
      const ctx = makeCtx({ stateOverride: state, callbackData: `cp:ai_model:${m.value}` });
      await handlePostCallback(ctx);
      expect(ctx.setState).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ aiModel: m.value }) })
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Step 5: Idea free-text input
// ═══════════════════════════════════════════════════════════════

describe('Step 5 — idea input', () => {
  function makeIdeaCtx(idea, stateData = {}) {
    return makeCtx({
      stateOverride: makeState({
        flow: FLOWS.CREATE_POST,
        step: CREATE_STEPS.AWAITING_IDEA,
        data: { postType: 'SHORT_FORM', platforms: ['TWITTER'], tone: 'CASUAL', aiModel: 'gpt-4o', ...stateData },
      }),
      text: idea,
    });
  }

  it('advances to READY_TO_GENERATE on valid idea', async () => {
    const idea = 'Why async programming is the future of backend development';
    const ctx = makeIdeaCtx(idea);

    await handleIdeaInput(ctx);

    expect(ctx.setState).toHaveBeenCalledWith(expect.objectContaining({
      step: CREATE_STEPS.READY_TO_GENERATE,
      data: expect.objectContaining({ idea }),
    }));
    expect(ctx._replies[0]).toContain('Ready to Generate');
  });

  it('rejects idea below IDEA_MIN_CHARS', async () => {
    const ctx = makeIdeaCtx('too short');  // 9 chars
    await handleIdeaInput(ctx);

    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx._replies[0]).toContain('too short');
  });

  it('rejects idea exactly at IDEA_MIN_CHARS boundary (9 chars)', async () => {
    const ctx = makeIdeaCtx('123456789');
    await handleIdeaInput(ctx);
    expect(ctx.setState).not.toHaveBeenCalled();
  });

  it('accepts idea exactly at IDEA_MIN_CHARS boundary (10 chars)', async () => {
    const ctx = makeIdeaCtx('1234567890');
    await handleIdeaInput(ctx);
    expect(ctx.setState).toHaveBeenCalled();
  });

  it('rejects idea above IDEA_MAX_CHARS', async () => {
    const ctx = makeIdeaCtx('x'.repeat(501));
    await handleIdeaInput(ctx);

    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx._replies[0]).toContain('too long');
    expect(ctx._replies[0]).toContain('501');
  });

  it('accepts idea exactly at IDEA_MAX_CHARS (500 chars)', async () => {
    const ctx = makeIdeaCtx('x'.repeat(500));
    await handleIdeaInput(ctx);
    expect(ctx.setState).toHaveBeenCalled();
  });

  it('trims whitespace before validation', async () => {
    const ctx = makeIdeaCtx('  ' + 'x'.repeat(10) + '  ');
    await handleIdeaInput(ctx);
    expect(ctx.setState).toHaveBeenCalled();
  });

  it('confirmation message contains the idea text', async () => {
    const idea = 'The power of Redis in real-time applications';
    const ctx = makeIdeaCtx(idea);
    await handleIdeaInput(ctx);
    expect(ctx._replies[0]).toContain(idea);
  });

  it('does nothing when state is null (guards against stale messages)', async () => {
    const ctx = makeCtx({ stateOverride: null, text: 'some idea text here' });
    await handleIdeaInput(ctx);
    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Stale / expired session
// ═══════════════════════════════════════════════════════════════

describe('stale callback handling', () => {
  it('shows expiry message when callback arrives for non-create_post flow', async () => {
    const state = makeState({ flow: 'some_other_flow', step: 'some_step' });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:post_type:SHORT_FORM' });

    await handlePostCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx._edits[0]).toContain('expired');
    expect(ctx.setState).not.toHaveBeenCalled();
  });

  it('shows expiry message when state is null', async () => {
    const ctx = makeCtx({ stateOverride: null, callbackData: 'cp:post_type:SHORT_FORM' });

    await handlePostCallback(ctx);

    expect(ctx._edits[0]).toContain('expired');
  });
});

// ═══════════════════════════════════════════════════════════════
// Wrong-step callback (ignored)
// ═══════════════════════════════════════════════════════════════

describe('wrong-step callbacks', () => {
  it('ignores post_type callback when at tone step', async () => {
    const state = makeState({
      flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_TONE, data: {},
    });
    const ctx = makeCtx({ stateOverride: state, callbackData: 'cp:post_type:SHORT_FORM' });

    await handlePostCallback(ctx);

    // handlePostTypeAnswer exits early because step !== AWAITING_POST_TYPE
    expect(ctx.setState).not.toHaveBeenCalled();
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Unexpected text at button-only steps
// ═══════════════════════════════════════════════════════════════

describe('handleUnexpectedFlowInput()', () => {
  it('sends nudge message at AWAITING_POST_TYPE', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_POST_TYPE });
    const ctx = makeCtx({ stateOverride: state, text: 'I want a tweet' });

    await handleUnexpectedFlowInput(ctx);

    expect(ctx._replies[0]).toContain('Unexpected input');
    expect(ctx._replies[0]).toContain('/cancel');
  });

  it('sends nudge message at AWAITING_PLATFORMS', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_PLATFORMS });
    const ctx = makeCtx({ stateOverride: state, text: 'Twitter please' });

    await handleUnexpectedFlowInput(ctx);

    expect(ctx._replies[0]).toContain('platforms');
  });

  it('sends nudge at AWAITING_TONE', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_TONE });
    const ctx = makeCtx({ stateOverride: state, text: 'casual' });

    await handleUnexpectedFlowInput(ctx);

    expect(ctx._replies[0]).toContain('tone');
  });

  it('does NOT intercept text at AWAITING_IDEA (free-text step)', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_IDEA });
    const ctx = makeCtx({ stateOverride: state, text: 'My great idea' });

    await handleUnexpectedFlowInput(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('does NOT intercept when not in create_post flow', async () => {
    const state = makeState({ flow: null });
    const ctx = makeCtx({ stateOverride: state, text: 'Hello' });

    await handleUnexpectedFlowInput(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('does NOT intercept slash commands', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_POST_TYPE });
    const ctx = makeCtx({ stateOverride: state, text: '/cancel' });

    await handleUnexpectedFlowInput(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// requireIdle guard
// ═══════════════════════════════════════════════════════════════

describe('requireIdle guard on /create', () => {
  it('blocks /create when create_post flow is already active', async () => {
    const state = makeState({ flow: FLOWS.CREATE_POST, step: CREATE_STEPS.AWAITING_TONE });
    const ctx = makeCtx({ stateOverride: state });
    const next = jest.fn();

    await requireIdle(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx._replies[0]).toContain('create post');
    expect(ctx._replies[0]).toContain('/cancel');
  });

  it('allows /create when no flow is active', async () => {
    const ctx = makeCtx({ stateOverride: null });
    const next = jest.fn();

    await requireIdle(ctx, next);

    expect(next).toHaveBeenCalled();
  });
});
