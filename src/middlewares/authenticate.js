'use strict';

/**
 * authenticate middleware
 * ═══════════════════════════════════════════════════════════════
 * Protects routes by validating the Bearer access token.
 * On success: attaches req.user = { id, email, name }
 * On failure: passes a 401 AppError to the error handler.
 *
 * Usage:
 *   router.get('/protected', authenticate, controller.handler);
 * ═══════════════════════════════════════════════════════════════
 */

const authService = require('../services/auth.service');
const { AppError } = require('./errorHandler');
const { StatusCodes } = require('http-status-codes');

function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authorization header missing or malformed.', StatusCodes.UNAUTHORIZED);
    }

    const token = authHeader.slice(7); // strip "Bearer "
    const payload = authService.verifyAccessToken(token);

    // Attach a clean user object — no JWT internals leak into req
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticate;
