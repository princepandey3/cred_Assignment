'use strict';

/**
 * AuthService
 * ═══════════════════════════════════════════════════════════════
 * Owns the complete authentication lifecycle:
 *   • User registration (email uniqueness, password hashing)
 *   • Login (credential verification, dual-token issuance)
 *   • Token refresh (rotate refresh token on every use)
 *   • Logout (revoke refresh token in Redis)
 *
 * Design rules:
 *   1. Controllers are kept thin — all logic lives here.
 *   2. Passwords are hashed via SecurityService (bcrypt, cost ≥ 12).
 *   3. Access tokens are short-lived (15 min).
 *   4. Refresh tokens are long-lived (7 days) and stored in Redis
 *      so they can be revoked server-side at any time.
 *   5. On refresh, the old token is invalidated and a new pair issued
 *      (single-use / rotation pattern).
 *   6. No sensitive material is ever logged.
 * ═══════════════════════════════════════════════════════════════
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('../middlewares/errorHandler');
const { securityService } = require('./security.service');
const userRepository = require('../repositories/user.repository');
const redisClient = require('../config/redis');
const { StatusCodes } = require('http-status-codes');

// ─── Token configuration ──────────────────────────────────────

const ACCESS_TOKEN_TTL = '15m';           // short-lived
const REFRESH_TOKEN_TTL = '7d';           // long-lived
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800 s for Redis TTL

const REDIS_REFRESH_PREFIX = 'auth:refresh:';

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Signs a JWT access token.
 * Payload: { sub, email, name, type }
 */
function _signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      type: 'access',
    },
    config.security.jwtSecret,
    { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' }
  );
}

/**
 * Signs a JWT refresh token.
 * Payload: { sub, jti (unique token ID), type }
 * The jti is the Redis key suffix — allows per-token revocation.
 */
function _signRefreshToken(userId) {
  const jti = uuidv4();
  const token = jwt.sign(
    {
      sub: userId,
      jti,
      type: 'refresh',
    },
    config.security.jwtSecret,
    { expiresIn: REFRESH_TOKEN_TTL, algorithm: 'HS256' }
  );
  return { token, jti };
}

/**
 * Persists a refresh token's jti in Redis so it can be validated/revoked.
 * Key: auth:refresh:<jti>  →  userId
 */
async function _storeRefreshToken(jti, userId) {
  const redis = await redisClient.getRedisClient();
  await redis.set(
    `${REDIS_REFRESH_PREFIX}${jti}`,
    userId,
    { EX: REFRESH_TOKEN_TTL_SECONDS }
  );
}

/**
 * Deletes a refresh token's jti from Redis (revocation).
 */
async function _revokeRefreshToken(jti) {
  const redis = await redisClient.getRedisClient();
  await redis.del(`${REDIS_REFRESH_PREFIX}${jti}`);
}

/**
 * Verifies the refresh token's jti still exists in Redis
 * (guards against replay after logout / rotation).
 */
async function _validateRefreshTokenInRedis(jti, userId) {
  const redis = await redisClient.getRedisClient();
  const stored = await redis.get(`${REDIS_REFRESH_PREFIX}${jti}`);
  return stored === userId;
}

// ─── Service class ────────────────────────────────────────────

class AuthService {
  /**
   * Register a new user.
   *
   * @param {{ email: string, password: string, name: string }} dto
   * @returns {{ user, accessToken, refreshToken }}
   */
  async register({ email, password, name }) {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Guard: duplicate email
    const exists = await userRepository.emailExists(normalizedEmail);
    if (exists) {
      throw new AppError('Email address is already registered.', StatusCodes.CONFLICT);
    }

    // 2. Hash password
    const passwordHash = await securityService.hashPassword(password);

    // 3. Persist user
    const user = await userRepository.create({
      email: normalizedEmail,
      passwordHash,
      name: name.trim(),
    });

    // 4. Issue tokens
    const accessToken = _signAccessToken(user);
    const { token: refreshToken, jti } = _signRefreshToken(user.id);
    await _storeRefreshToken(jti, user.id);

    logger.info('User registered', { userId: user.id });

    return { user, accessToken, refreshToken };
  }

  /**
   * Authenticate an existing user.
   *
   * @param {{ email: string, password: string }} dto
   * @returns {{ user, accessToken, refreshToken }}
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Load user (with passwordHash)
    const userWithHash = await userRepository.findByEmail(normalizedEmail);

    // Use constant-time comparison path even when user not found
    // (prevents user enumeration via timing)
    const passwordHash = userWithHash?.passwordHash ?? '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const passwordValid = await securityService.verifyPassword(password, passwordHash);

    if (!userWithHash || !passwordValid) {
      throw new AppError('Invalid email or password.', StatusCodes.UNAUTHORIZED);
    }

    if (!userWithHash.isActive) {
      throw new AppError('Account is deactivated. Please contact support.', StatusCodes.FORBIDDEN);
    }

    // 2. Strip passwordHash before returning
    const { passwordHash: _omit, ...user } = userWithHash;

    // 3. Issue tokens
    const accessToken = _signAccessToken(user);
    const { token: refreshToken, jti } = _signRefreshToken(user.id);
    await _storeRefreshToken(jti, user.id);

    logger.info('User logged in', { userId: user.id });

    return { user, accessToken, refreshToken };
  }

  /**
   * Refresh an access token using a valid refresh token.
   * Old refresh token is revoked and a new pair is issued (rotation).
   *
   * @param {string} refreshToken
   * @returns {{ accessToken, refreshToken }}
   */
  async refresh(refreshToken) {
    // 1. Verify JWT signature and expiry
    let payload;
    try {
      payload = jwt.verify(refreshToken, config.security.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new AppError('Invalid or expired refresh token.', StatusCodes.UNAUTHORIZED);
    }

    if (payload.type !== 'refresh') {
      throw new AppError('Invalid token type.', StatusCodes.UNAUTHORIZED);
    }

    // 2. Validate against Redis (revocation check)
    const isValid = await _validateRefreshTokenInRedis(payload.jti, payload.sub);
    if (!isValid) {
      throw new AppError('Refresh token has been revoked.', StatusCodes.UNAUTHORIZED);
    }

    // 3. Load user to get current profile for access token
    const user = await userRepository.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AppError('User account not found or deactivated.', StatusCodes.UNAUTHORIZED);
    }

    // 4. Rotate: revoke old, issue new
    await _revokeRefreshToken(payload.jti);

    const newAccessToken = _signAccessToken(user);
    const { token: newRefreshToken, jti: newJti } = _signRefreshToken(user.id);
    await _storeRefreshToken(newJti, user.id);

    logger.info('Tokens refreshed', { userId: user.id });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  /**
   * Revoke a refresh token (logout).
   *
   * @param {string} refreshToken
   */
  async logout(refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, config.security.jwtSecret, { algorithms: ['HS256'] });
      if (payload.type === 'refresh') {
        await _revokeRefreshToken(payload.jti);
        logger.info('User logged out', { userId: payload.sub });
      }
    } catch {
      // Silently ignore invalid/expired tokens on logout — idempotent
    }
  }

  /**
   * Verify an access token and return its payload.
   * Used by the authenticate middleware.
   *
   * @param {string} token
   * @returns {{ sub, email, name, type }}
   */
  verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, config.security.jwtSecret, { algorithms: ['HS256'] });
      if (payload.type !== 'access') {
        throw new AppError('Invalid token type.', StatusCodes.UNAUTHORIZED);
      }
      return payload;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Invalid or expired access token.', StatusCodes.UNAUTHORIZED);
    }
  }
}

module.exports = new AuthService();
