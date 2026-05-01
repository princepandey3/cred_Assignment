'use strict';

/**
 * authenticate middleware
 * ═══════════════════════════════════════════════════════════════
 * Validates the Bearer access token on every protected route.
 *
 * Pipeline:
 *   1. Extract "Authorization: Bearer <token>" header.
 *   2. Call authService.verifyAccessToken() — this verifies the JWT
 *      signature AND checks the Redis blocklist (handles logout).
 *   3. Attach req.user = { id, email, name } for downstream handlers.
 *   4. On any failure pass a 401 AppError to the error handler.
 *
 * verifyAccessToken is now async (blocklist check) so this
 * middleware is also async.
 *
 * Usage:
 *   router.get('/protected', authenticate, controller.handler);
 * ═══════════════════════════════════════════════════════════════
 */

const authService  = require('../services/auth.service');
const { AppError } = require('./errorHandler');
const { StatusCodes } = require('http-status-codes');

async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        'Authorization header missing or malformed. Expected: Bearer <token>',
        StatusCodes.UNAUTHORIZED
      );
    }

    const token   = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError('Bearer token is empty.', StatusCodes.UNAUTHORIZED);
    }

    // verifyAccessToken checks signature, expiry, token type, AND blocklist
    const payload = await authService.verifyAccessToken(token);

    // Expose a clean, minimal user object — no JWT internals leak into req
    req.user = {
      id:    payload.sub,
      email: payload.email,
      name:  payload.name,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticate;
