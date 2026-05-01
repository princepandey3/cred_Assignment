'use strict';

/**
 * AuthService
 * ═══════════════════════════════════════════════════════════════
 * Owns the complete authentication lifecycle:
 *
 *   • register  — hash password, persist user, issue token pair
 *   • login     — verify credentials, issue token pair
 *   • refresh   — rotate refresh token with theft detection
 *   • logout    — revoke refresh token + blocklist access token
 *   • getMe     — return fresh user profile from DB
 *
 * Token architecture
 * ──────────────────
 *   Access token   15 min  JWT + jti  (stateless + blocklist on logout)
 *   Refresh token   7 days JWT + Redis (revocable, rotated on use)
 *
 * Refresh token rotation & theft detection
 * ─────────────────────────────────────────
 *   Every refresh token belongs to a "family" (one UUID per login/register).
 *   Redis stores:
 *     auth:refresh:<jti>        userId           (active token jti → owner)
 *     auth:family:<familyId>    <jti>|<userId>   (most recently issued jti)
 *
 *   On /refresh:
 *     1. Verify JWT sig + expiry.
 *     2. Look up auth:refresh:<jti> — missing = already rotated or revoked.
 *     3. If jti is gone but family still has a DIFFERENT current jti →
 *        replay detected → revoke entire family (force re-login).
 *     4. Valid path: delete old jti, write new jti in same family.
 *
 * Access-token blocklist
 * ──────────────────────
 *   On logout the access token's jti is written to auth:blocklist:<jti>
 *   with TTL = remaining lifetime. authenticate() checks this before
 *   accepting any token, stopping revoked tokens immediately.
 *
 * Design rules
 * ────────────
 *   1. All business logic lives here — controllers stay thin.
 *   2. No secret material ever enters a log statement.
 *   3. Timing-safe login path (bcrypt runs even for unknown emails).
 *   4. verifyAccessToken is now async (blocklist check requires Redis).
 * ═══════════════════════════════════════════════════════════════
 */

const jwt            = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config          = require('../config');
const logger          = require('../utils/logger');
const { AppError }    = require('../middlewares/errorHandler');
const { securityService } = require('./security.service');
const userRepository  = require('../repositories/user.repository');
const redisConfig     = require('../config/redis');
const { StatusCodes } = require('http-status-codes');

// ─── Constants ────────────────────────────────────────────────

const ACCESS_TOKEN_TTL       = '15m';
const REFRESH_TOKEN_TTL      = '7d';
const REFRESH_TOKEN_TTL_SEC  = 7 * 24 * 60 * 60;  // 604 800 s

const REDIS_REFRESH_PREFIX   = 'auth:refresh:';    // jti → userId
const REDIS_FAMILY_PREFIX    = 'auth:family:';     // familyId → jti|userId
const REDIS_BLOCKLIST_PREFIX = 'auth:blocklist:';  // jti → '1'

// ─── Redis helpers ────────────────────────────────────────────

async function _redis() {
  return redisConfig.getRedisClient();
}

async function _storeRefreshToken(jti, userId, familyId) {
  const r = await _redis();
  const familyVal = `${jti}|${userId}`;
  await r.set(`${REDIS_REFRESH_PREFIX}${jti}`,      userId,    { EX: REFRESH_TOKEN_TTL_SEC });
  await r.set(`${REDIS_FAMILY_PREFIX}${familyId}`,  familyVal, { EX: REFRESH_TOKEN_TTL_SEC });
}

async function _revokeRefreshToken(jti) {
  const r = await _redis();
  await r.del(`${REDIS_REFRESH_PREFIX}${jti}`);
}

async function _revokeFamilyEntirely(familyId) {
  const r = await _redis();
  const raw = await r.get(`${REDIS_FAMILY_PREFIX}${familyId}`);
  if (raw) {
    const [lastJti] = raw.split('|');
    await r.del(`${REDIS_REFRESH_PREFIX}${lastJti}`);
  }
  await r.del(`${REDIS_FAMILY_PREFIX}${familyId}`);
}

async function _getRefreshOwner(jti) {
  const r = await _redis();
  return r.get(`${REDIS_REFRESH_PREFIX}${jti}`);  // userId | null
}

async function _getFamilyCurrentJti(familyId) {
  const r = await _redis();
  const raw = await r.get(`${REDIS_FAMILY_PREFIX}${familyId}`);
  return raw ? raw.split('|')[0] : null;
}

async function _blocklistAccessToken(jti, remainingSeconds) {
  if (remainingSeconds <= 0) return;
  const r = await _redis();
  await r.set(`${REDIS_BLOCKLIST_PREFIX}${jti}`, '1', { EX: remainingSeconds });
}

async function _isAccessTokenBlocked(jti) {
  const r = await _redis();
  const val = await r.get(`${REDIS_BLOCKLIST_PREFIX}${jti}`);
  return val !== null;
}

// ─── JWT signing helpers ──────────────────────────────────────

/** Returns { token, jti } for a new access token (jti embedded in payload). */
function _signAccessToken(user) {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, type: 'access', jti },
    config.security.jwtSecret,
    { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' }
  );
  return { token, jti };
}

/** Returns { token, jti } for a new refresh token tied to a family. */
function _signRefreshToken(userId, familyId) {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti, familyId, type: 'refresh' },
    config.security.jwtSecret,
    { expiresIn: REFRESH_TOKEN_TTL, algorithm: 'HS256' }
  );
  return { token, jti };
}

/** Seconds remaining until a JWT exp (unix timestamp). */
function _secondsUntilExp(exp) {
  return Math.max(0, exp - Math.floor(Date.now() / 1000));
}

// ─── AuthService ──────────────────────────────────────────────

class AuthService {

  // ──────────────────────────────────────────────────────────
  // register
  // ──────────────────────────────────────────────────────────

  async register({ email, password, name }) {
    const normalizedEmail = email.toLowerCase().trim();

    const exists = await userRepository.emailExists(normalizedEmail);
    if (exists) {
      throw new AppError('Email address is already registered.', StatusCodes.CONFLICT);
    }

    const passwordHash = await securityService.hashPassword(password);
    const user = await userRepository.create({
      email: normalizedEmail,
      passwordHash,
      name: name.trim(),
    });

    const { token: accessToken } = _signAccessToken(user);
    const familyId = uuidv4();
    const { token: refreshToken, jti } = _signRefreshToken(user.id, familyId);
    await _storeRefreshToken(jti, user.id, familyId);

    logger.info('User registered', { userId: user.id });
    return { user, accessToken, refreshToken };
  }

  // ──────────────────────────────────────────────────────────
  // login
  // ──────────────────────────────────────────────────────────

  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();
    const userWithHash    = await userRepository.findByEmail(normalizedEmail);

    // Timing-safe: always run bcrypt even for unknown emails
    const hashToVerify = userWithHash?.passwordHash
      ?? '$2b$12$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const valid = await securityService.verifyPassword(password, hashToVerify);

    if (!userWithHash || !valid) {
      throw new AppError('Invalid email or password.', StatusCodes.UNAUTHORIZED);
    }
    if (!userWithHash.isActive) {
      throw new AppError('Account is deactivated. Contact support.', StatusCodes.FORBIDDEN);
    }

    const { passwordHash: _omit, ...user } = userWithHash;

    const { token: accessToken } = _signAccessToken(user);
    const familyId = uuidv4();
    const { token: refreshToken, jti } = _signRefreshToken(user.id, familyId);
    await _storeRefreshToken(jti, user.id, familyId);

    logger.info('User logged in', { userId: user.id });
    return { user, accessToken, refreshToken };
  }

  // ──────────────────────────────────────────────────────────
  // refresh  (rotation + theft detection)
  // ──────────────────────────────────────────────────────────

  async refresh(refreshToken) {
    // 1. Cryptographic verification
    let payload;
    try {
      payload = jwt.verify(refreshToken, config.security.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new AppError('Invalid or expired refresh token.', StatusCodes.UNAUTHORIZED);
    }

    if (payload.type !== 'refresh') {
      throw new AppError('Invalid token type.', StatusCodes.UNAUTHORIZED);
    }

    const { jti, sub: userId, familyId } = payload;

    // 2. Check Redis — is this jti still the active one?
    const storedUserId = await _getRefreshOwner(jti);

    if (!storedUserId) {
      // Token already rotated or revoked — check for theft
      if (familyId) {
        const currentJti = await _getFamilyCurrentJti(familyId);
        if (currentJti && currentJti !== jti) {
          // Family is still alive but under a newer jti → replay / theft
          logger.warn('Refresh token reuse detected — revoking family', { userId, familyId });
          await _revokeFamilyEntirely(familyId);
        }
      }
      throw new AppError('Refresh token has been revoked or already used.', StatusCodes.UNAUTHORIZED);
    }

    // 3. Ownership check
    if (storedUserId !== userId) {
      await _revokeRefreshToken(jti);
      throw new AppError('Token ownership mismatch.', StatusCodes.UNAUTHORIZED);
    }

    // 4. Load user (confirms account still active + gets fresh profile)
    const user = await userRepository.findById(userId);
    if (!user || !user.isActive) {
      throw new AppError('User not found or account deactivated.', StatusCodes.UNAUTHORIZED);
    }

    // 5. Rotate: delete old, write new in same family
    await _revokeRefreshToken(jti);

    const { token: newAccessToken }                       = _signAccessToken(user);
    const { token: newRefreshToken, jti: newJti }         = _signRefreshToken(userId, familyId);
    await _storeRefreshToken(newJti, userId, familyId);

    logger.info('Tokens rotated', { userId });
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  // ──────────────────────────────────────────────────────────
  // logout
  // ──────────────────────────────────────────────────────────

  /**
   * Revoke a session entirely:
   *   • Refresh token  → deleted from Redis + family key removed
   *   • Access token   → jti added to blocklist until natural expiry
   *
   * Both params are optional so callers can supply whatever they have.
   * All errors are swallowed — logout must always succeed from the
   * client's perspective.
   *
   * @param {{ refreshToken?: string, accessToken?: string }} dto
   */
  async logout({ refreshToken, accessToken } = {}) {
    if (refreshToken) {
      try {
        const p = jwt.verify(refreshToken, config.security.jwtSecret, { algorithms: ['HS256'] });
        if (p.type === 'refresh') {
          await _revokeRefreshToken(p.jti);
          if (p.familyId) {
            const r = await _redis();
            await r.del(`${REDIS_FAMILY_PREFIX}${p.familyId}`);
          }
          logger.info('Session revoked on logout', { userId: p.sub });
        }
      } catch { /* expired / invalid — nothing to revoke */ }
    }

    if (accessToken) {
      try {
        const p = jwt.verify(accessToken, config.security.jwtSecret, { algorithms: ['HS256'] });
        if (p.type === 'access' && p.jti) {
          await _blocklistAccessToken(p.jti, _secondsUntilExp(p.exp));
        }
      } catch { /* already expired — no need to blocklist */ }
    }
  }

  // ──────────────────────────────────────────────────────────
  // getMe
  // ──────────────────────────────────────────────────────────

  /**
   * Fetch the current user's fresh profile from the database.
   * Never returns stale data from the JWT payload.
   *
   * @param {string} userId
   * @returns {object}  Safe user object (no passwordHash)
   */
  async getMe(userId) {
    const user = await userRepository.findById(userId);
    if (!user || !user.isActive) {
      throw new AppError('User not found or account deactivated.', StatusCodes.NOT_FOUND);
    }
    return user;
  }

  // ──────────────────────────────────────────────────────────
  // verifyAccessToken   (used by authenticate middleware)
  // ──────────────────────────────────────────────────────────

  /**
   * Verify an access token and check the blocklist.
   * NOW ASYNC — blocklist check requires a Redis call.
   *
   * @param {string} token
   * @returns {{ sub, email, name, jti, type, exp, iat }}
   */
  async verifyAccessToken(token) {
    let payload;
    try {
      payload = jwt.verify(token, config.security.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      const msg = err.name === 'TokenExpiredError'
        ? 'Access token has expired.'
        : 'Invalid access token.';
      throw new AppError(msg, StatusCodes.UNAUTHORIZED);
    }

    if (payload.type !== 'access') {
      throw new AppError('Invalid token type.', StatusCodes.UNAUTHORIZED);
    }

    if (payload.jti && await _isAccessTokenBlocked(payload.jti)) {
      throw new AppError('Access token has been revoked.', StatusCodes.UNAUTHORIZED);
    }

    return payload;
  }
}

module.exports = new AuthService();
