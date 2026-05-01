'use strict';

/**
 * botState.step9.test.js
 * ═══════════════════════════════════════════════════════════════
 * Tests for Step 9 — Redis Conversation State Manager
 *
 * Coverage:
 *   BotStateService
 *     • get()            — hit, miss, Redis error degrades gracefully
 *     • set()            — stores full state, resets TTL, returns stored value
 *     • update()         — merges patch, deep-merges data, creates if absent
 *     • clear()          — deletes key
 *     • setStep()        — changes step ± flow
 *     • setData()        — merges data without touching step/flow
 *     • startFlow()      — fresh state with flow+step+seed data
 *     • endFlow()        — alias for clear
 *     • inFlow()         — boolean flow membership check
 *     • atStep()         — boolean step check ± flow guard
 *     • ttl()            — returns remaining TTL, -2 on error
 *     • listActiveSessions() — scans KEY_PREFIX* keys
 *     • TTL sliding window — set() and update() both call EX
 *
 *   stateMiddleware
 *     • injectState      — attaches ctx helpers, lazy-loads, caches
 *     • requireIdle      — blocks when flow active, passes when idle
 *     • requireStep      — passes at correct step, stops at wrong step
 *
 *   /cancel command
 *     • no active flow   — sends "nothing to cancel" message
 *     • active flow      — clears state, confirms with flow name
 *     • unknown flow id  — falls back to slug-formatted name
 *
 *   FLOWS / STEPS constants
 *     • all expected constants are exported and frozen
 *
 * Strategy
 * ────────
 *   Redis client is fully mocked — no real Redis needed.
 *   All mock return values are set per-test in beforeEach/each assertion.
 * ═══════════════════════════════════════════════════════════════
 */

// ── Environment ───────────────────────────────────────────────
process.env.NODE_ENV            = 'test';
process.env.TELEGRAM_BOT_TOKEN  = 'test:placeholder_token';
process.env.ENCRYPTION_SECRET   = 'test_encryption_secret_32_chars_minimum_here!!';
process.env.JWT_SECRET          = 'test_jwt_secret_at_least_32_chars_here_yes';

// ── Mock Redis before any imports touch it ────────────────────
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

// Mock prisma (needed by telegramAuth which is transitively required)
jest.mock('../config/prisma', () => ({
  prisma: { user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() } },
  connectPrisma:    jest.fn(),
  disconnectPrisma: jest.fn(),
}));

// Mock socialAccount repo (needed by accounts command)
jest.mock('../repositories/socialAccount.repository', () => ({
  findByUserId: jest.fn(),
}));

// ── Imports ───────────────────────────────────────────────────
const {
  botStateService,
  STATE_TTL_SECONDS,
  KEY_PREFIX,
  FLOWS,
  STEPS,
} = require('../services/botState.service');

const {
  injectState,
  requireIdle,
  requireStep,
} = require('../telegram/middleware/stateMiddleware');

const { handleCancel } = require('../telegram/commands/cancel');

// ── Helpers ───────────────────────────────────────────────────

const CHAT_ID = 12345;

/** Build a minimal state object with sensible defaults */
function makeState(overrides = {}) {
  return {
    step:      null,
    flow:      null,
    data:      {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a mock grammy ctx suitable for testing middleware/handlers */
function makeCtx(overrides = {}) {
  const replies = [];
  return {
    chat:    { id: CHAT_ID },
    from:    { id: 999, first_name: 'Alice' },
    message: { text: '' },
    reply:   jest.fn(async (text) => { replies.push(text); return {}; }),
    _replies: replies,
    getState:   null, // set after injectState runs
    setState:   null,
    clearState: null,
    startFlow:  null,
    endFlow:    null,
    ...overrides,
  };
}

/** Run injectState middleware on a ctx and return it */
async function withState(ctx) {
  await new Promise((resolve) => injectState(ctx, resolve));
  return ctx;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
  mockRedis.ttl.mockResolvedValue(STATE_TTL_SECONDS);
  mockRedis.keys.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

describe('FLOWS / STEPS constants', () => {
  it('exports all expected FLOWS and they are frozen', () => {
    expect(FLOWS.CREATE_POST).toBe('create_post');
    expect(FLOWS.SCHEDULE_POST).toBe('schedule_post');
    expect(FLOWS.LINK_ACCOUNT).toBe('link_account');
    expect(Object.isFrozen(FLOWS)).toBe(true);
  });

  it('exports all expected STEPS and they are frozen', () => {
    expect(STEPS.AWAITING_PLATFORM).toBe('awaiting_platform');
    expect(STEPS.AWAITING_TOPIC).toBe('awaiting_topic');
    expect(STEPS.AWAITING_TONE).toBe('awaiting_tone');
    expect(STEPS.AWAITING_LANGUAGE).toBe('awaiting_language');
    expect(STEPS.AWAITING_CONFIRM).toBe('awaiting_confirm');
    expect(STEPS.AWAITING_DATETIME).toBe('awaiting_datetime');
    expect(STEPS.IDLE).toBeNull();
    expect(Object.isFrozen(STEPS)).toBe(true);
  });

  it('KEY_PREFIX and STATE_TTL_SECONDS are exported', () => {
    expect(KEY_PREFIX).toBe('bot:state:');
    expect(STATE_TTL_SECONDS).toBe(1800);
  });
});

// ═══════════════════════════════════════════════════════════════
// BotStateService.get()
// ═══════════════════════════════════════════════════════════════

describe('BotStateService.get()', () => {
  it('returns null when key does not exist', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await botStateService.get(CHAT_ID);
    expect(result).toBeNull();
    expect(mockRedis.get).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
  });

  it('returns parsed state when key exists', async () => {
    const state = makeState({ step: 'awaiting_platform', flow: 'create_post' });
    mockRedis.get.mockResolvedValue(JSON.stringify(state));
    const result = await botStateService.get(CHAT_ID);
    expect(result).toEqual(state);
  });

  it('returns null and logs error on Redis failure (graceful degrade)', async () => {
    mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await botStateService.get(CHAT_ID);
    expect(result).toBeNull(); // never throws
  });
});

// ═══════════════════════════════════════════════════════════════
// BotStateService.set()
// ═══════════════════════════════════════════════════════════════

describe('BotStateService.set()', () => {
  it('writes JSON with correct key and EX TTL', async () => {
    await botStateService.set(CHAT_ID, { step: 'awaiting_topic', flow: 'create_post' });

    expect(mockRedis.set).toHaveBeenCalledWith(
      `bot:state:${CHAT_ID}`,
      expect.any(String),
      { EX: STATE_TTL_SECONDS }
    );

    const stored = JSON.parse(mockRedis.set.mock.calls[0][1]);
    expect(stored.step).toBe('awaiting_topic');
    expect(stored.flow).toBe('create_post');
    expect(stored.data).toEqual({});
  });

  it('returns the stored state object', async () => {
    const result = await botStateService.set(CHAT_ID, {
      step: 'awaiting_tone',
      flow: 'create_post',
      data: { platform: 'TWITTER' },
    });

    expect(result.step).toBe('awaiting_tone');
    expect(result.flow).toBe('create_post');
    expect(result.data).toEqual({ platform: 'TWITTER' });
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it('always sets EX (sliding TTL) — even on repeated writes', async () => {
    await botStateService.set(CHAT_ID, { step: 'a' });
    await botStateService.set(CHAT_ID, { step: 'b' });

    expect(mockRedis.set).toHaveBeenCalledTimes(2);
    mockRedis.set.mock.calls.forEach((call) => {
      expect(call[2]).toEqual({ EX: STATE_TTL_SECONDS });
    });
  });

  it('throws when Redis write fails', async () => {
    mockRedis.set.mockRejectedValue(new Error('OOM'));
    await expect(botStateService.set(CHAT_ID, { step: 'x' })).rejects.toThrow('OOM');
  });
});

// ═══════════════════════════════════════════════════════════════
// BotStateService.update()
// ═══════════════════════════════════════════════════════════════

describe('BotStateService.update()', () => {
  it('shallow-merges patch into existing state', async () => {
    const existing = makeState({ step: 'awaiting_topic', flow: 'create_post', data: { platform: 'TWITTER' } });
    mockRedis.get.mockResolvedValue(JSON.stringify(existing));

    const result = await botStateService.update(CHAT_ID, { step: 'awaiting_tone' });

    expect(result.step).toBe('awaiting_tone');
    expect(result.flow).toBe('create_post');       // unchanged
    expect(result.data.platform).toBe('TWITTER');  // preserved
  });

  it('deep-merges the data sub-object', async () => {
    const existing = makeState({ data: { platform: 'TWITTER', topic: 'AI' } });
    mockRedis.get.mockResolvedValue(JSON.stringify(existing));

    const result = await botStateService.update(CHAT_ID, { data: { tone: 'CASUAL' } });

    expect(result.data).toEqual({ platform: 'TWITTER', topic: 'AI', tone: 'CASUAL' });
  });

  it('creates fresh state when no existing state', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await botStateService.update(CHAT_ID, { step: 'awaiting_topic', flow: 'create_post' });

    expect(result.step).toBe('awaiting_topic');
    expect(result.flow).toBe('create_post');
    expect(result.data).toEqual({});
  });

  it('resets the TTL on every update', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState()));
    await botStateService.update(CHAT_ID, { step: 'x' });
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { EX: STATE_TTL_SECONDS }
    );
  });

  it('updates the updatedAt timestamp', async () => {
    const old = makeState({ updatedAt: '2020-01-01T00:00:00.000Z' });
    mockRedis.get.mockResolvedValue(JSON.stringify(old));

    const result = await botStateService.update(CHAT_ID, { step: 'x' });

    expect(result.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

// ═══════════════════════════════════════════════════════════════
// BotStateService.clear()
// ═══════════════════════════════════════════════════════════════

describe('BotStateService.clear()', () => {
  it('deletes the Redis key', async () => {
    await botStateService.clear(CHAT_ID);
    expect(mockRedis.del).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
  });

  it('throws when Redis del fails', async () => {
    mockRedis.del.mockRejectedValue(new Error('READONLY'));
    await expect(botStateService.clear(CHAT_ID)).rejects.toThrow('READONLY');
  });
});

// ═══════════════════════════════════════════════════════════════
// Convenience methods
// ═══════════════════════════════════════════════════════════════

describe('BotStateService.setStep()', () => {
  it('sets step only when flow is omitted', async () => {
    const existing = makeState({ flow: 'create_post', step: 'a' });
    mockRedis.get.mockResolvedValue(JSON.stringify(existing));

    const result = await botStateService.setStep(CHAT_ID, 'awaiting_tone');

    expect(result.step).toBe('awaiting_tone');
    expect(result.flow).toBe('create_post'); // unchanged
  });

  it('sets both step and flow when flow is provided', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await botStateService.setStep(CHAT_ID, 'awaiting_platform', 'create_post');

    expect(result.step).toBe('awaiting_platform');
    expect(result.flow).toBe('create_post');
  });
});

describe('BotStateService.setData()', () => {
  it('merges data without changing step or flow', async () => {
    const existing = makeState({ step: 'awaiting_tone', flow: 'create_post', data: { platform: 'TWITTER' } });
    mockRedis.get.mockResolvedValue(JSON.stringify(existing));

    const result = await botStateService.setData(CHAT_ID, { topic: 'AI trends' });

    expect(result.data).toEqual({ platform: 'TWITTER', topic: 'AI trends' });
    expect(result.step).toBe('awaiting_tone');
    expect(result.flow).toBe('create_post');
  });
});

describe('BotStateService.startFlow()', () => {
  it('creates a fresh state overriding any existing one', async () => {
    // Even if something was there before, startFlow replaces it completely
    const result = await botStateService.startFlow(CHAT_ID, FLOWS.CREATE_POST, STEPS.AWAITING_PLATFORM, { draft: true });

    const stored = JSON.parse(mockRedis.set.mock.calls[0][1]);
    expect(stored.flow).toBe('create_post');
    expect(stored.step).toBe('awaiting_platform');
    expect(stored.data).toEqual({ draft: true });
    // createdAt must be fresh (not from old state)
    expect(new Date(stored.createdAt).getTime()).toBeGreaterThan(Date.now() - 2000);
  });
});

describe('BotStateService.endFlow()', () => {
  it('deletes the Redis key (same as clear)', async () => {
    await botStateService.endFlow(CHAT_ID);
    expect(mockRedis.del).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
  });
});

describe('BotStateService.inFlow()', () => {
  it('returns true when state.flow matches', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ flow: 'create_post' })));
    expect(await botStateService.inFlow(CHAT_ID, 'create_post')).toBe(true);
  });

  it('returns false when state.flow differs', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ flow: 'schedule_post' })));
    expect(await botStateService.inFlow(CHAT_ID, 'create_post')).toBe(false);
  });

  it('returns false when no state exists', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await botStateService.inFlow(CHAT_ID, 'create_post')).toBe(false);
  });
});

describe('BotStateService.atStep()', () => {
  it('returns true when step matches and no flow guard', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ step: 'awaiting_tone', flow: 'create_post' })));
    expect(await botStateService.atStep(CHAT_ID, 'awaiting_tone')).toBe(true);
  });

  it('returns true when both step and flow match', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ step: 'awaiting_tone', flow: 'create_post' })));
    expect(await botStateService.atStep(CHAT_ID, 'awaiting_tone', 'create_post')).toBe(true);
  });

  it('returns false when step matches but flow does not', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ step: 'awaiting_tone', flow: 'schedule_post' })));
    expect(await botStateService.atStep(CHAT_ID, 'awaiting_tone', 'create_post')).toBe(false);
  });

  it('returns false when no state exists', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await botStateService.atStep(CHAT_ID, 'awaiting_tone')).toBe(false);
  });
});

describe('BotStateService.ttl()', () => {
  it('returns the TTL from Redis', async () => {
    mockRedis.ttl.mockResolvedValue(1234);
    expect(await botStateService.ttl(CHAT_ID)).toBe(1234);
    expect(mockRedis.ttl).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
  });

  it('returns -2 on error (graceful degrade)', async () => {
    mockRedis.ttl.mockRejectedValue(new Error('timeout'));
    expect(await botStateService.ttl(CHAT_ID)).toBe(-2);
  });
});

describe('BotStateService.listActiveSessions()', () => {
  it('returns chatId strings extracted from keys', async () => {
    mockRedis.keys.mockResolvedValue(['bot:state:111', 'bot:state:222', 'bot:state:333']);
    const result = await botStateService.listActiveSessions();
    expect(result).toEqual(['111', '222', '333']);
    expect(mockRedis.keys).toHaveBeenCalledWith('bot:state:*');
  });

  it('returns empty array when no sessions exist', async () => {
    mockRedis.keys.mockResolvedValue([]);
    expect(await botStateService.listActiveSessions()).toEqual([]);
  });

  it('returns empty array on error (graceful degrade)', async () => {
    mockRedis.keys.mockRejectedValue(new Error('cluster error'));
    expect(await botStateService.listActiveSessions()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// injectState middleware
// ═══════════════════════════════════════════════════════════════

describe('injectState middleware', () => {
  it('attaches getState / setState / clearState / startFlow / endFlow to ctx', async () => {
    const ctx = makeCtx();
    await withState(ctx);

    expect(typeof ctx.getState).toBe('function');
    expect(typeof ctx.setState).toBe('function');
    expect(typeof ctx.clearState).toBe('function');
    expect(typeof ctx.startFlow).toBe('function');
    expect(typeof ctx.endFlow).toBe('function');
  });

  it('ctx.state resolves to the current state', async () => {
    const state = makeState({ step: 'awaiting_platform', flow: 'create_post' });
    mockRedis.get.mockResolvedValue(JSON.stringify(state));

    const ctx = makeCtx();
    await withState(ctx);

    const result = await ctx.state;
    expect(result).toMatchObject({ step: 'awaiting_platform', flow: 'create_post' });
  });

  it('lazy-loads — Redis is NOT called until state is accessed', async () => {
    const ctx = makeCtx();
    await withState(ctx);

    expect(mockRedis.get).not.toHaveBeenCalled();

    await ctx.getState();
    expect(mockRedis.get).toHaveBeenCalledTimes(1);
  });

  it('caches the result — Redis called only once for multiple reads', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState()));
    const ctx = makeCtx();
    await withState(ctx);

    await ctx.getState();
    await ctx.getState();
    await ctx.getState();

    expect(mockRedis.get).toHaveBeenCalledTimes(1);
  });

  it('ctx.setState writes to Redis and updates the cache', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState()));
    const ctx = makeCtx();
    await withState(ctx);

    await ctx.setState({ step: 'awaiting_tone', flow: 'create_post' });

    expect(mockRedis.set).toHaveBeenCalledWith(
      `bot:state:${CHAT_ID}`,
      expect.any(String),
      { EX: STATE_TTL_SECONDS }
    );
    // Cache is updated — next read should NOT call Redis again
    const result = await ctx.getState();
    expect(result.step).toBe('awaiting_tone');
    expect(mockRedis.get).not.toHaveBeenCalled(); // cache hit
  });

  it('ctx.clearState deletes the key and sets cache to null', async () => {
    const ctx = makeCtx();
    await withState(ctx);

    await ctx.clearState();

    expect(mockRedis.del).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
    const result = await ctx.getState();
    expect(result).toBeNull();
  });

  it('skips injection (calls next) when ctx has no chat', async () => {
    const ctx = makeCtx({ chat: null });
    const next = jest.fn();
    await injectState(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.getState).toBeNull(); // not injected
  });
});

// ═══════════════════════════════════════════════════════════════
// requireIdle middleware
// ═══════════════════════════════════════════════════════════════

describe('requireIdle middleware', () => {
  it('calls next when no active flow (state is null)', async () => {
    mockRedis.get.mockResolvedValue(null);
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireIdle(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('calls next when flow is null in state', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ flow: null })));
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireIdle(ctx, next);

    expect(next).toHaveBeenCalled();
  });

  it('blocks and replies when a flow is active', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ flow: 'create_post', step: 'awaiting_topic' })));
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireIdle(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
    expect(ctx._replies[0]).toContain('create post');
    expect(ctx._replies[0]).toContain('/cancel');
  });
});

// ═══════════════════════════════════════════════════════════════
// requireStep middleware
// ═══════════════════════════════════════════════════════════════

describe('requireStep middleware', () => {
  it('calls next when step matches', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ step: 'awaiting_tone', flow: 'create_post' }))
    );
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireStep('awaiting_tone')(ctx, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next when both step and flow match', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ step: 'awaiting_tone', flow: 'create_post' }))
    );
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireStep('awaiting_tone', 'create_post')(ctx, next);

    expect(next).toHaveBeenCalled();
  });

  it('stops (no next, no reply) when step does not match', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ step: 'awaiting_platform', flow: 'create_post' }))
    );
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireStep('awaiting_tone')(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled(); // silent fallthrough
  });

  it('stops when flow does not match even if step does', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ step: 'awaiting_tone', flow: 'schedule_post' }))
    );
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireStep('awaiting_tone', 'create_post')(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it('stops silently when no state exists at all', async () => {
    mockRedis.get.mockResolvedValue(null);
    const ctx = makeCtx();
    await withState(ctx);
    const next = jest.fn();

    await requireStep('awaiting_tone')(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// /cancel command
// ═══════════════════════════════════════════════════════════════

describe('/cancel command', () => {
  it('replies "nothing to cancel" when no active flow', async () => {
    mockRedis.get.mockResolvedValue(null);
    const ctx = makeCtx();
    await withState(ctx);

    await handleCancel(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    expect(ctx._replies[0]).toContain("nothing to cancel");
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('replies "nothing to cancel" when state exists but flow is null', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(makeState({ flow: null })));
    const ctx = makeCtx();
    await withState(ctx);

    await handleCancel(ctx);

    expect(ctx._replies[0]).toContain("nothing to cancel");
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('clears state and confirms cancellation of create_post flow', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ flow: FLOWS.CREATE_POST, step: STEPS.AWAITING_TONE }))
    );
    const ctx = makeCtx();
    await withState(ctx);

    await handleCancel(ctx);

    expect(mockRedis.del).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
    expect(ctx._replies[0]).toContain('post creation cancelled');
  });

  it('clears state and confirms cancellation of schedule_post flow', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ flow: FLOWS.SCHEDULE_POST, step: STEPS.AWAITING_DATETIME }))
    );
    const ctx = makeCtx();
    await withState(ctx);

    await handleCancel(ctx);

    expect(mockRedis.del).toHaveBeenCalledWith(`bot:state:${CHAT_ID}`);
    expect(ctx._replies[0]).toContain('post scheduling cancelled');
  });

  it('formats unknown flow IDs as human-readable slugs', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify(makeState({ flow: 'some_custom_flow', step: 'step_one' }))
    );
    const ctx = makeCtx();
    await withState(ctx);

    await handleCancel(ctx);

    expect(ctx._replies[0]).toContain('some custom flow cancelled');
  });

  it('replies with error message on unexpected failure', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis gone'));
    const ctx = makeCtx({ getState: async () => { throw new Error('Redis gone'); } });
    await withState(ctx);
    // Override getState to simulate failure after inject
    ctx.getState = async () => { throw new Error('Redis gone'); };

    await handleCancel(ctx);

    expect(ctx._replies[0]).toContain('Something went wrong');
  });
});
