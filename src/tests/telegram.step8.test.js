'use strict';

/**
 * telegram.step8.test.js
 * ═══════════════════════════════════════════════════════════════
 * Tests for Step 8 — Telegram Webhook & Core Commands
 *
 * Coverage:
 *   • POST /api/v1/telegram/webhook  — update delivery, secret validation
 *   • GET  /api/v1/telegram/health   — bot status endpoint
 *   • /start command  — welcome message, no auth required
 *   • /help  command  — command reference, no auth required
 *   • /accounts command — requires linked account, fetches from DB
 *   • /link  command  — account linking flow
 *   • Unknown command  — fallback reply
 *   • formatters unit  — message content helpers
 *
 * Strategy
 * ────────
 *   • The grammy bot is constructed with a placeholder token (NODE_ENV=test).
 *   • Bot API calls are intercepted — bot.api is mocked to avoid real HTTP.
 *   • Prisma calls are mocked — no real DB.
 *   • Webhook updates are injected directly via webhookCallback.
 * ═══════════════════════════════════════════════════════════════
 */

process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN      = 'test:placeholder_token';
process.env.TELEGRAM_WEBHOOK_SECRET = '';
process.env.ENCRYPTION_SECRET       = 'test_encryption_secret_32_chars_minimum_here!!';
process.env.JWT_SECRET              = 'test_jwt_secret_at_least_32_chars_here_yes';

const request = require('supertest');

// ── Mock prisma before any imports that use it ────────────────
jest.mock('../config/prisma', () => ({
  prisma: {
    user: {
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
  },
  connectPrisma:    jest.fn(),
  disconnectPrisma: jest.fn(),
}));

jest.mock('../repositories/socialAccount.repository', () => ({
  findByUserId: jest.fn(),
}));

// ── Import after mocks ────────────────────────────────────────
const createApp              = require('../app');
const { bot }                = require('../telegram/bot');
const { registerHandlers }   = require('../telegram/registerHandlers');
const { prisma }             = require('../config/prisma');
const socialAccountRepository = require('../repositories/socialAccount.repository');
const {
  helpMessage,
  accountsMessage,
  startMessage,
  escMd,
  platformLabel,
} = require('../telegram/formatters');

// ── Wire bot handlers once ────────────────────────────────────
registerHandlers(bot);
// Stub bot.isInited() for the health endpoint
bot.isInited = jest.fn(() => true);
bot.botInfo  = { id: 123456789, username: 'TestBot', first_name: 'Test Bot' };

// ── Create Express app ────────────────────────────────────────
const app = createApp();

// ── Helper: build a Telegram Update object ───────────────────
function makeUpdate(id, text, fromOverride = {}) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: 'private' },
      from: {
        id:         999,
        is_bot:     false,
        first_name: 'Alice',
        username:   'alice_test',
        ...fromOverride,
      },
      text,
      entities: text.startsWith('/')
        ? [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }]
        : [],
    },
  };
}

// ── Capture replies sent by the bot ──────────────────────────
let lastReply = null;

beforeEach(() => {
  lastReply = null;
  jest.clearAllMocks();

  // Intercept ctx.reply → capture text, return ok
  bot.api.sendMessage = jest.fn(async (_chatId, text, _opts) => {
    lastReply = text;
    return { message_id: 1, chat: { id: 100 }, text, date: 0 };
  });
  // Also intercept sendChatAction (typing indicator)
  bot.api.sendChatAction = jest.fn(async () => ({ ok: true }));
});

// ═══════════════════════════════════════════════════════════════
// Webhook route
// ═══════════════════════════════════════════════════════════════

describe('POST /api/v1/telegram/webhook', () => {

  it('200 — accepts a valid update and returns ok', async () => {
    const update = makeUpdate(1, '/start');

    const res = await request(app)
      .post('/api/v1/telegram/webhook')
      .set('Content-Type', 'application/json')
      .send(update);

    expect(res.status).toBe(200);
  });

  it('200 — returns ok even for unknown update shapes (no retry storm)', async () => {
    const res = await request(app)
      .post('/api/v1/telegram/webhook')
      .set('Content-Type', 'application/json')
      .send({ update_id: 999 }); // no message

    expect(res.status).toBe(200);
  });

  it('403 — rejects request with wrong secret token', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';

    const res = await request(app)
      .post('/api/v1/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'wrong-secret')
      .send(makeUpdate(2, '/start'));

    expect(res.status).toBe(403);

    process.env.TELEGRAM_WEBHOOK_SECRET = '';
  });

  it('200 — accepts request with correct secret token', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';

    const res = await request(app)
      .post('/api/v1/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'correct-secret')
      .send(makeUpdate(3, '/start'));

    expect(res.status).toBe(200);

    process.env.TELEGRAM_WEBHOOK_SECRET = '';
  });
});

// ═══════════════════════════════════════════════════════════════
// Bot health endpoint
// ═══════════════════════════════════════════════════════════════

describe('GET /api/v1/telegram/health', () => {

  it('200 — returns bot info when initialised', async () => {
    bot.isInited.mockReturnValue(true);

    const res = await request(app).get('/api/v1/telegram/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.bot).toMatchObject({
      username: 'TestBot',
      id:       123456789,
    });
  });

  it('503 — returns not-ready when bot not initialised', async () => {
    bot.isInited.mockReturnValue(false);

    const res = await request(app).get('/api/v1/telegram/health');

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// /start command
// ═══════════════════════════════════════════════════════════════

describe('/start command', () => {

  it('sends a welcome message with the user\'s first name', async () => {
    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(10, '/start', { first_name: 'Alice' }));

    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(lastReply).toContain('Welcome');
  });

  it('sends a welcome message even without a first_name', async () => {
    const update = makeUpdate(11, '/start');
    delete update.message.from.first_name;

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(update);

    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(lastReply).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// /help command
// ═══════════════════════════════════════════════════════════════

describe('/help command', () => {

  it('sends the help message listing all commands', async () => {
    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(20, '/help'));

    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(lastReply).toContain('/accounts');
    expect(lastReply).toContain('/link');
    expect(lastReply).toContain('/start');
  });

  it('help message includes coming-soon section', async () => {
    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(21, '/help'));

    expect(lastReply).toContain('/create');
  });
});

// ═══════════════════════════════════════════════════════════════
// /accounts command
// ═══════════════════════════════════════════════════════════════

describe('/accounts command', () => {

  it('shows connected accounts for a linked user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id:              'user-uuid-001',
      name:            'Alice',
      defaultTone:     'PROFESSIONAL',
      defaultLanguage: 'EN',
      isActive:        true,
    });

    socialAccountRepository.findByUserId.mockResolvedValue([
      {
        id:            'acct-001',
        platform:      'TWITTER',
        handle:        '@alice',
        tokenExpiresAt: null,
        isActive:      true,
        connectedAt:   new Date(),
      },
      {
        id:            'acct-002',
        platform:      'LINKEDIN',
        handle:        'alice-li',
        tokenExpiresAt: null,
        isActive:      true,
        connectedAt:   new Date(),
      },
    ]);

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(30, '/accounts'));

    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(lastReply).toContain('Twitter');
    expect(lastReply).toContain('@alice');
    expect(lastReply).toContain('LinkedIn');
    // Raw token fields must never appear
    expect(lastReply).not.toMatch(/accessToken/i);
    expect(lastReply).not.toMatch(/refreshToken/i);
    expect(lastReply).not.toMatch(/_enc/);
  });

  it('shows empty-state message when no accounts connected', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-uuid-001', name: 'Alice', isActive: true,
    });
    socialAccountRepository.findByUserId.mockResolvedValue([]);

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(31, '/accounts'));

    expect(lastReply).toContain('No accounts connected');
  });

  it('prompts to link when Telegram user has no linked app account', async () => {
    prisma.user.findFirst.mockResolvedValue(null); // not linked

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(32, '/accounts'));

    expect(lastReply).toContain('not linked');
    expect(socialAccountRepository.findByUserId).not.toHaveBeenCalled();
  });

  it('blocks deactivated users', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-uuid-002', name: 'Bob', isActive: false,
    });

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(33, '/accounts'));

    expect(lastReply).toContain('deactivated');
    expect(socialAccountRepository.findByUserId).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// /link command
// ═══════════════════════════════════════════════════════════════

describe('/link command', () => {

  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('shows instructions when no token provided', async () => {
    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(40, '/link'));

    expect(lastReply).toContain('Link Your Account');
  });

  it('links account successfully with valid link_<uuid> token', async () => {
    prisma.user.findFirst.mockResolvedValue(null); // not yet linked
    prisma.user.findUnique.mockResolvedValue({
      id:         VALID_UUID,
      name:       'Alice',
      telegramId: null,
      isActive:   true,
    });
    prisma.user.update.mockResolvedValue({ id: VALID_UUID, telegramId: '999' });

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(41, `/link link_${VALID_UUID}`));

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VALID_UUID },
        data:  { telegramId: '999' },
      })
    );
    expect(lastReply).toContain('linked successfully');
  });

  it('rejects invalid token format', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(42, '/link not-a-valid-token'));

    expect(lastReply).toContain('Invalid');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('tells user when their Telegram is already linked', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: VALID_UUID, name: 'Alice' });

    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(43, `/link link_${VALID_UUID}`));

    expect(lastReply).toContain('already linked');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Unknown commands fallback
// ═══════════════════════════════════════════════════════════════

describe('Unknown command fallback', () => {

  it('replies with an "unknown command" message for unregistered /commands', async () => {
    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(50, '/nonexistent'));

    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(lastReply).toContain('Unknown command');
    expect(lastReply).toContain('/help');
  });

  it('does not reply to plain text (no slash)', async () => {
    await request(app)
      .post('/api/v1/telegram/webhook')
      .send(makeUpdate(51, 'Hello there'));

    // sendMessage should NOT have been called for plain text
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Formatters unit tests
// ═══════════════════════════════════════════════════════════════

describe('formatters', () => {

  describe('escMd()', () => {
    it('escapes MarkdownV2 special characters', () => {
      expect(escMd('hello.world')).toBe('hello\\.world');
      expect(escMd('user_name')).toBe('user\\_name');
      expect(escMd('1+1=2')).toBe('1\\+1\\=2');
    });

    it('returns empty string for falsy input', () => {
      expect(escMd('')).toBe('');
      expect(escMd(null)).toBe('');
    });
  });

  describe('helpMessage()', () => {
    it('includes all expected commands', () => {
      const msg = helpMessage();
      ['/start', '/link', '/help', '/accounts', '/create', '/drafts', '/schedule']
        .forEach((cmd) => expect(msg).toContain(cmd));
    });
  });

  describe('startMessage()', () => {
    it('personalises with first name', () => {
      expect(startMessage('Alice')).toContain('Alice');
    });

    it('works without a name', () => {
      const msg = startMessage(null);
      expect(msg).toContain('Welcome');
    });
  });

  describe('accountsMessage()', () => {
    it('renders accounts list', () => {
      const accounts = [
        { platform: 'TWITTER', handle: '@alice', token_expires_at: null },
        { platform: 'LINKEDIN', handle: 'alice-li', token_expires_at: null },
      ];
      const msg = accountsMessage(accounts, 'Alice');
      expect(msg).toContain('Twitter');
      expect(msg).toContain('@alice');
      expect(msg).toContain('2 platforms connected');
    });

    it('renders empty-state message', () => {
      const msg = accountsMessage([], 'Alice');
      expect(msg).toContain('No accounts connected');
    });
  });

  describe('platformLabel()', () => {
    it('returns emoji and label for known platforms', () => {
      expect(platformLabel('TWITTER')).toContain('🐦');
      expect(platformLabel('LINKEDIN')).toContain('LinkedIn');
    });

    it('falls back gracefully for unknown platforms', () => {
      expect(platformLabel('MYSPACE')).toContain('MYSPACE');
    });
  });
});
