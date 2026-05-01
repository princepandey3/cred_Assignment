'use strict';

/**
 * AuthController
 * ═══════════════════════════════════════════════════════════════
 * Thin HTTP adapter layer.
 * Responsibilities:
 *   • Extract validated input from req.body
 *   • Call the auth service
 *   • Format and return the response
 *
 * NO business logic lives here — everything is delegated to
 * AuthService. Controllers never touch the DB or Redis directly.
 * ═══════════════════════════════════════════════════════════════
 */

const { StatusCodes } = require('http-status-codes');
const authService = require('../services/auth.service');
const ApiResponse = require('../utils/apiResponse');

class AuthController {
  /**
   * POST /api/v1/auth/register
   * Body: { email, password, name }
   */
  async register(req, res, next) {
    try {
      const { email, password, name } = req.body;
      const { user, accessToken, refreshToken } = await authService.register({ email, password, name });

      return ApiResponse.created(res, {
        user,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900, // 15 min in seconds
        },
      }, 'Registration successful');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/auth/login
   * Body: { email, password }
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { user, accessToken, refreshToken } = await authService.login({ email, password });

      return ApiResponse.success(res, {
        user,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900, // 15 min in seconds
        },
      }, 'Login successful', StatusCodes.OK);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/auth/refresh
   * Body: { refreshToken }
   */
  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const { accessToken, refreshToken: newRefreshToken } = await authService.refresh(refreshToken);

      return ApiResponse.success(res, {
        tokens: {
          accessToken,
          refreshToken: newRefreshToken,
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      }, 'Tokens refreshed successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/auth/logout
   * Body: { refreshToken }
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      await authService.logout(refreshToken);

      return ApiResponse.success(res, null, 'Logged out successfully');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
