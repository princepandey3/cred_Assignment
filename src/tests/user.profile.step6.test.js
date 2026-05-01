'use strict';

/**
 * user.profile.step6.test.js
 * ═══════════════════════════════════════════════════════════════
 * Integration tests for Step 6 — User Profile Management API
 *
 *   GET  /api/v1/user/profile
 *   PUT  /api/v1/user/profile
 *
 * Test strategy
 * ─────────────
 *   • Mocks userService so no DB / Redis is needed.
 *   • Uses supertest to drive the full Express middleware stack.
 *   • Covers: happy paths, auth guard, validation errors, not-found.
 * ═══════════════════════════════════════════════════════════════
 */

const request  = require('supertest');
const app      = require('../app');

// ── Stub the auth middleware ──────────────────────────────────
// We test auth-guard separately; here we just want it injectable.
jest.mock('../middlewares/authenticate', () =>
  jest.fn((req, _res, next) => {
    req.user = { id: 'test-user-uuid', email: 'alice@example.com', name: 'Alice' };
    next();
  })
);

// ── Stub the user service ─────────────────────────────────────
jest.mock('../services/user.service');
const userService = require('../services/user.service');

// ─── Fixtures ─────────────────────────────────────────────────

const MOCK_PROFILE = {
  id: 'test-user-uuid',
  email: 'alice@example.com',
  name: 'Alice',
  bio: 'Software engineer',
  default_tone: 'PROFESSIONAL',
  default_language: 'EN',
  is_active: true,
  email_verified_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const BEARER = 'Bearer valid.jwt.token';

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/user/profile
// ═══════════════════════════════════════════════════════════════

describe('GET /api/v1/user/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 — returns the authenticated user profile', async () => {
    userService.getProfile.mockResolvedValue(MOCK_PROFILE);

    const res = await request(app)
      .get('/api/v1/user/profile')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Profile retrieved successfully');
    expect(res.body.data.user).toMatchObject({
      id: MOCK_PROFILE.id,
      email: MOCK_PROFILE.email,
      name: MOCK_PROFILE.name,
      default_tone: 'PROFESSIONAL',
      default_language: 'EN',
    });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(userService.getProfile).toHaveBeenCalledWith('test-user-uuid');
  });

  it('401 — rejects request without Authorization header', async () => {
    // Restore real authenticate for this test
    const authenticate = require('../middlewares/authenticate');
    authenticate.mockImplementationOnce((_req, _res, next) => {
      const { AppError } = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      next(new AppError('Authorization header missing or malformed.', StatusCodes.UNAUTHORIZED));
    });

    const res = await request(app).get('/api/v1/user/profile');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('404 — propagates not-found error from service', async () => {
    const { AppError } = require('../middlewares/errorHandler');
    const { StatusCodes } = require('http-status-codes');
    userService.getProfile.mockRejectedValue(
      new AppError('User not found', StatusCodes.NOT_FOUND)
    );

    const res = await request(app)
      .get('/api/v1/user/profile')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('User not found');
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/v1/user/profile
// ═══════════════════════════════════════════════════════════════

describe('PUT /api/v1/user/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 — updates name only', async () => {
    const updated = { ...MOCK_PROFILE, name: 'Alice Updated' };
    userService.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ name: 'Alice Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Profile updated successfully');
    expect(res.body.data.user.name).toBe('Alice Updated');
    expect(userService.updateProfile).toHaveBeenCalledWith(
      'test-user-uuid',
      { name: 'Alice Updated' }
    );
  });

  it('200 — updates bio to empty string (clear bio)', async () => {
    const updated = { ...MOCK_PROFILE, bio: null };
    userService.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ bio: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.bio).toBeNull();
  });

  it('200 — updates default_tone', async () => {
    const updated = { ...MOCK_PROFILE, default_tone: 'CASUAL' };
    userService.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ default_tone: 'CASUAL' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.default_tone).toBe('CASUAL');
  });

  it('200 — updates default_language', async () => {
    const updated = { ...MOCK_PROFILE, default_language: 'ES' };
    userService.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ default_language: 'ES' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.default_language).toBe('ES');
  });

  it('200 — updates multiple fields at once', async () => {
    const updated = {
      ...MOCK_PROFILE,
      name: 'Bob',
      bio: 'New bio',
      default_tone: 'HUMOROUS',
      default_language: 'FR',
    };
    userService.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ name: 'Bob', bio: 'New bio', default_tone: 'HUMOROUS', default_language: 'FR' });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      name: 'Bob',
      bio: 'New bio',
      default_tone: 'HUMOROUS',
      default_language: 'FR',
    });
  });

  // ── Validation failures ─────────────────────────────────────

  it('400 — rejects empty body (no fields)', async () => {
    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(userService.updateProfile).not.toHaveBeenCalled();
  });

  it('400 — rejects name exceeding 150 characters', async () => {
    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ name: 'A'.repeat(151) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })])
    );
  });

  it('400 — rejects bio exceeding 500 characters', async () => {
    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ bio: 'x'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'bio' })])
    );
  });

  it('400 — rejects invalid default_tone', async () => {
    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ default_tone: 'ANGRY' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'default_tone' })])
    );
  });

  it('400 — rejects invalid default_language', async () => {
    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ default_language: 'KLINGON' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'default_language' })])
    );
  });

  it('400 — strips unknown fields and rejects if nothing valid remains', async () => {
    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ unknownField: 'hacked', anotherField: 123 });

    expect(res.status).toBe(400);
    expect(userService.updateProfile).not.toHaveBeenCalled();
  });

  it('401 — rejects request without token', async () => {
    const authenticate = require('../middlewares/authenticate');
    authenticate.mockImplementationOnce((_req, _res, next) => {
      const { AppError } = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      next(new AppError('Unauthorized', StatusCodes.UNAUTHORIZED));
    });

    const res = await request(app)
      .put('/api/v1/user/profile')
      .send({ name: 'Hacker' });

    expect(res.status).toBe(401);
    expect(userService.updateProfile).not.toHaveBeenCalled();
  });

  it('404 — propagates not-found from service', async () => {
    const { AppError } = require('../middlewares/errorHandler');
    const { StatusCodes } = require('http-status-codes');
    userService.updateProfile.mockRejectedValue(
      new AppError('User not found', StatusCodes.NOT_FOUND)
    );

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('does not expose passwordHash in response', async () => {
    userService.updateProfile.mockResolvedValue(MOCK_PROFILE);

    const res = await request(app)
      .put('/api/v1/user/profile')
      .set('Authorization', BEARER)
      .send({ name: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.password_hash).toBeUndefined();
  });
});
