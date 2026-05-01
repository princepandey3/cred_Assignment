'use strict';

/**
 * credentials.step7.test.js
 * ═══════════════════════════════════════════════════════════════
 * Integration tests for Step 7 — Social Accounts & AI Keys API
 *
 *   POST   /api/v1/user/social-accounts
 *   GET    /api/v1/user/social-accounts
 *   DELETE /api/v1/user/social-accounts/:id
 *   PUT    /api/v1/user/ai-keys
 *
 * Test strategy
 * ─────────────
 *   • authenticate middleware is stubbed → req.user injected cleanly.
 *   • All service methods are mocked → no DB / Redis / crypto needed.
 *   • Covers: happy paths, auth guard (401), validation (400),
 *     not-found (404), ownership guard, secret-never-in-response.
 * ═══════════════════════════════════════════════════════════════
 */

const request = require('supertest');
const app     = require('../app');

// ── Stub authenticate ────────────────────────────────────────
jest.mock('../middlewares/authenticate', () =>
  jest.fn((req, _res, next) => {
    req.user = { id: 'user-uuid-001', email: 'alice@example.com', name: 'Alice' };
    next();
  })
);

// ── Stub services ────────────────────────────────────────────
jest.mock('../services/socialAccount.service');
jest.mock('../services/aiKey.service');

const socialAccountService = require('../services/socialAccount.service');
const aiKeyService         = require('../services/aiKey.service');

// ─── Fixtures ─────────────────────────────────────────────────

const BEARER = 'Bearer valid.access.token';

const MOCK_ACCOUNT = {
  id:               'acct-uuid-001',
  user_id:          'user-uuid-001',
  platform:         'TWITTER',
  handle:           '@alice',
  token_expires_at: null,
  is_active:        true,
  connected_at:     new Date().toISOString(),
  updated_at:       new Date().toISOString(),
};

const MOCK_ACCOUNT_2 = {
  id:               'acct-uuid-002',
  user_id:          'user-uuid-001',
  platform:         'LINKEDIN',
  handle:           'alice-li',
  token_expires_at: null,
  is_active:        true,
  connected_at:     new Date().toISOString(),
  updated_at:       new Date().toISOString(),
};

const MOCK_AI_STATUS = {
  openai:     true,
  anthropic:  false,
  gemini:     false,
  updated_at: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════
// POST /api/v1/user/social-accounts
// ═══════════════════════════════════════════════════════════════

describe('POST /api/v1/user/social-accounts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('201 — connects a new social account', async () => {
    socialAccountService.connect.mockResolvedValue(MOCK_ACCOUNT);

    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({
        platform:     'TWITTER',
        access_token: 'oauth-access-token-xyz',
        handle:       '@alice',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Social account connected successfully');
    expect(res.body.data.account).toMatchObject({
      platform: 'TWITTER',
      handle:   '@alice',
    });
    expect(socialAccountService.connect).toHaveBeenCalledWith(
      'user-uuid-001',
      expect.objectContaining({ platform: 'TWITTER', access_token: 'oauth-access-token-xyz' })
    );
  });

  it('201 — connects with optional refresh_token and token_expires_at', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const accountWithExpiry = { ...MOCK_ACCOUNT, token_expires_at: futureDate };
    socialAccountService.connect.mockResolvedValue(accountWithExpiry);

    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({
        platform:         'LINKEDIN',
        access_token:     'access-token',
        refresh_token:    'refresh-token',
        handle:           'alice-li',
        token_expires_at: futureDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.account.token_expires_at).toBe(futureDate);
  });

  it('does not return access_token or refresh_token in response', async () => {
    socialAccountService.connect.mockResolvedValue(MOCK_ACCOUNT);

    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({ platform: 'TWITTER', access_token: 'secret', handle: '@alice' });

    expect(res.status).toBe(201);
    const account = res.body.data.account;
    expect(account.access_token).toBeUndefined();
    expect(account.refresh_token).toBeUndefined();
    expect(account.accessToken).toBeUndefined();
    expect(account.accessTokenEnc).toBeUndefined();
    expect(account.refreshTokenEnc).toBeUndefined();
  });

  // ── Validation failures ─────────────────────────────────────

  it('400 — rejects missing platform', async () => {
    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({ access_token: 'tok', handle: '@alice' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'platform' })])
    );
    expect(socialAccountService.connect).not.toHaveBeenCalled();
  });

  it('400 — rejects invalid platform value', async () => {
    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({ platform: 'MYSPACE', access_token: 'tok', handle: '@alice' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'platform' })])
    );
  });

  it('400 — rejects missing access_token', async () => {
    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({ platform: 'TWITTER', handle: '@alice' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'access_token' })])
    );
  });

  it('400 — rejects missing handle', async () => {
    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({ platform: 'TWITTER', access_token: 'tok' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'handle' })])
    );
  });

  it('400 — rejects past token_expires_at', async () => {
    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({
        platform:         'TWITTER',
        access_token:     'tok',
        handle:           '@alice',
        token_expires_at: '2020-01-01T00:00:00Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'token_expires_at' })])
    );
  });

  it('400 — strips unknown fields (empty body after strip)', async () => {
    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .set('Authorization', BEARER)
      .send({ sneaky: 'payload' });

    expect(res.status).toBe(400);
    expect(socialAccountService.connect).not.toHaveBeenCalled();
  });

  it('401 — rejects unauthenticated request', async () => {
    const authenticate = require('../middlewares/authenticate');
    authenticate.mockImplementationOnce((_req, _res, next) => {
      const { AppError }    = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      next(new AppError('Unauthorized', StatusCodes.UNAUTHORIZED));
    });

    const res = await request(app)
      .post('/api/v1/user/social-accounts')
      .send({ platform: 'TWITTER', access_token: 'tok', handle: '@x' });

    expect(res.status).toBe(401);
    expect(socialAccountService.connect).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/user/social-accounts
// ═══════════════════════════════════════════════════════════════

describe('GET /api/v1/user/social-accounts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 — returns list of connected accounts', async () => {
    socialAccountService.list.mockResolvedValue([MOCK_ACCOUNT, MOCK_ACCOUNT_2]);

    const res = await request(app)
      .get('/api/v1/user/social-accounts')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accounts).toHaveLength(2);
    expect(res.body.data.count).toBe(2);
    expect(socialAccountService.list).toHaveBeenCalledWith('user-uuid-001');
  });

  it('200 — returns empty list when no accounts connected', async () => {
    socialAccountService.list.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/user/social-accounts')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.data.accounts).toEqual([]);
    expect(res.body.data.count).toBe(0);
  });

  it('does not expose any token values in list response', async () => {
    socialAccountService.list.mockResolvedValue([MOCK_ACCOUNT]);

    const res = await request(app)
      .get('/api/v1/user/social-accounts')
      .set('Authorization', BEARER);

    const account = res.body.data.accounts[0];
    expect(account.access_token).toBeUndefined();
    expect(account.refresh_token).toBeUndefined();
    expect(account.accessTokenEnc).toBeUndefined();
    expect(account.refreshTokenEnc).toBeUndefined();
  });

  it('401 — rejects unauthenticated request', async () => {
    const authenticate = require('../middlewares/authenticate');
    authenticate.mockImplementationOnce((_req, _res, next) => {
      const { AppError }    = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      next(new AppError('Unauthorized', StatusCodes.UNAUTHORIZED));
    });

    const res = await request(app)
      .get('/api/v1/user/social-accounts');

    expect(res.status).toBe(401);
    expect(socialAccountService.list).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/v1/user/social-accounts/:id
// ═══════════════════════════════════════════════════════════════

describe('DELETE /api/v1/user/social-accounts/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 — disconnects an owned account', async () => {
    socialAccountService.disconnect.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/v1/user/social-accounts/acct-uuid-001')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Social account disconnected successfully');
    expect(socialAccountService.disconnect).toHaveBeenCalledWith(
      'acct-uuid-001',
      'user-uuid-001'
    );
  });

  it('404 — returns not-found for a foreign or missing account', async () => {
    const { AppError }    = require('../middlewares/errorHandler');
    const { StatusCodes } = require('http-status-codes');
    socialAccountService.disconnect.mockRejectedValue(
      new AppError('Social account not found', StatusCodes.NOT_FOUND)
    );

    const res = await request(app)
      .delete('/api/v1/user/social-accounts/not-my-account-id')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Social account not found');
  });

  it('401 — rejects unauthenticated request', async () => {
    const authenticate = require('../middlewares/authenticate');
    authenticate.mockImplementationOnce((_req, _res, next) => {
      const { AppError }    = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      next(new AppError('Unauthorized', StatusCodes.UNAUTHORIZED));
    });

    const res = await request(app)
      .delete('/api/v1/user/social-accounts/acct-uuid-001');

    expect(res.status).toBe(401);
    expect(socialAccountService.disconnect).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/v1/user/ai-keys
// ═══════════════════════════════════════════════════════════════

describe('PUT /api/v1/user/ai-keys', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 — saves an OpenAI key and returns provider status', async () => {
    aiKeyService.upsertKeys.mockResolvedValue(MOCK_AI_STATUS);

    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ openai_key: 'sk-openai-test-key' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('AI keys updated successfully');
    expect(res.body.data.ai_keys).toMatchObject({
      openai:    true,
      anthropic: false,
      gemini:    false,
    });
    expect(aiKeyService.upsertKeys).toHaveBeenCalledWith(
      'user-uuid-001',
      { openai_key: 'sk-openai-test-key' }
    );
  });

  it('200 — saves an Anthropic key', async () => {
    const status = { ...MOCK_AI_STATUS, anthropic: true };
    aiKeyService.upsertKeys.mockResolvedValue(status);

    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ anthropic_key: 'sk-ant-test' });

    expect(res.status).toBe(200);
    expect(res.body.data.ai_keys.anthropic).toBe(true);
  });

  it('200 — saves multiple keys in one request', async () => {
    const status = { openai: true, anthropic: true, gemini: true, updated_at: new Date().toISOString() };
    aiKeyService.upsertKeys.mockResolvedValue(status);

    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ openai_key: 'sk-o', anthropic_key: 'sk-a', gemini_key: 'gem-g' });

    expect(res.status).toBe(200);
    expect(res.body.data.ai_keys).toMatchObject({ openai: true, anthropic: true, gemini: true });
  });

  it('200 — clears a key by passing null', async () => {
    const status = { openai: false, anthropic: true, gemini: false, updated_at: new Date().toISOString() };
    aiKeyService.upsertKeys.mockResolvedValue(status);

    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ openai_key: null });

    expect(res.status).toBe(200);
    expect(res.body.data.ai_keys.openai).toBe(false);
    expect(aiKeyService.upsertKeys).toHaveBeenCalledWith(
      'user-uuid-001',
      { openai_key: null }
    );
  });

  it('does not return raw key values in response', async () => {
    aiKeyService.upsertKeys.mockResolvedValue(MOCK_AI_STATUS);

    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ openai_key: 'sk-super-secret' });

    expect(res.status).toBe(200);
    const aiKeys = res.body.data.ai_keys;
    expect(aiKeys.openai_key).toBeUndefined();
    expect(aiKeys.anthropic_key).toBeUndefined();
    expect(aiKeys.gemini_key).toBeUndefined();
    expect(aiKeys.openaiKeyEnc).toBeUndefined();
    // The actual key string should not appear anywhere in the response body
    expect(JSON.stringify(res.body)).not.toContain('sk-super-secret');
  });

  // ── Validation failures ─────────────────────────────────────

  it('400 — rejects empty body', async () => {
    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(aiKeyService.upsertKeys).not.toHaveBeenCalled();
  });

  it('400 — rejects body with only unknown fields', async () => {
    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ cohere_key: 'whatever' });

    expect(res.status).toBe(400);
    expect(aiKeyService.upsertKeys).not.toHaveBeenCalled();
  });

  it('400 — rejects openai_key exceeding max length', async () => {
    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .set('Authorization', BEARER)
      .send({ openai_key: 'x'.repeat(513) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'openai_key' })])
    );
  });

  it('401 — rejects unauthenticated request', async () => {
    const authenticate = require('../middlewares/authenticate');
    authenticate.mockImplementationOnce((_req, _res, next) => {
      const { AppError }    = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      next(new AppError('Unauthorized', StatusCodes.UNAUTHORIZED));
    });

    const res = await request(app)
      .put('/api/v1/user/ai-keys')
      .send({ openai_key: 'sk-test' });

    expect(res.status).toBe(401);
    expect(aiKeyService.upsertKeys).not.toHaveBeenCalled();
  });
});
