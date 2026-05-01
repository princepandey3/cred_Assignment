'use strict';

/**
 * AuthController
 * ═══════════════════════════════════════════════════════════════
 * Thin HTTP adapter — extracts validated input, delegates to
 * AuthService, and formats responses.  Zero business logic here.
 *
 * Endpoints:
 *   POST   /api/v1/auth/register
 *   POST   /api/v1/auth/login
 *   POST   /api/v1/auth/refresh
 *   POST   /api/v1/auth/logout
 *   GET    /api/v1/auth/me        ← NEW (Step 5)
 * ═══════════════════════════════════════════════════════════════
 */

const { StatusCodes } = require('http-status-codes');
const authService  = require('../services/auth.service');
const ApiResponse  = require('../utils/apiResponse');

/** Shared token envelope shape — keeps responses consistent. */
function _tokenEnvelope(accessToken, refreshToken) {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn:  900,   // access token lifetime in seconds (15 min)
  };
}

class AuthController {

  // ── POST /register ────────────────────────────────────────
  async register(req, res, next) {
    try {
      const { email, password, name } = req.body;
      const { user, accessToken, refreshToken } =
        await authService.register({ email, password, name });

      return ApiResponse.created(res, {
        user,
        tokens: _tokenEnvelope(accessToken, refreshToken),
      }, 'Registration successful');
    } catch (err) { next(err); }
  }

  // ── POST /login ───────────────────────────────────────────
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { user, accessToken, refreshToken } =
        await authService.login({ email, password });

      return ApiResponse.success(res, {
        user,
        tokens: _tokenEnvelope(accessToken, refreshToken),
      }, 'Login successful', StatusCodes.OK);
    } catch (err) { next(err); }
  }

  // ── POST /refresh ─────────────────────────────────────────
  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const { accessToken, refreshToken: newRefreshToken } =
        await authService.refresh(refreshToken);

      return ApiResponse.success(res, {
        tokens: _tokenEnvelope(accessToken, newRefreshToken),
      }, 'Tokens refreshed successfully');
    } catch (err) { next(err); }
  }

  // ── POST /logout ──────────────────────────────────────────
  /**
   * Accepts both the refresh token (body) and access token (header).
   * The access token is extracted from the Authorization header so
   * callers don't have to duplicate it in the body.
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;

      // Extract access token from header if present (may not be there
      // if it has already expired, which is fine)
      const authHeader = req.headers.authorization || '';
      const accessToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

      await authService.logout({ refreshToken, accessToken });

      return ApiResponse.success(res, null, 'Logged out successfully');
    } catch (err) { next(err); }
  }

  // ── GET /me ───────────────────────────────────────────────
  /**
   * Returns the authenticated user's current profile.
   * req.user is set by the authenticate middleware.
   * Profile is always fetched fresh from the DB — never from JWT.
   */
  async me(req, res, next) {
    try {
      const user = await authService.getMe(req.user.id);
      return ApiResponse.success(res, { user }, 'Profile retrieved successfully');
    } catch (err) { next(err); }
  }
}

module.exports = new AuthController();
