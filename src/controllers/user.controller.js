'use strict';

/**
 * UserController
 * ═══════════════════════════════════════════════════════════════
 * Thin HTTP adapter for user profile management.
 * Extracts validated input, delegates to UserService, formats responses.
 * Zero business logic here.
 *
 * Endpoints:
 *   GET  /api/v1/user/profile   ← getProfile
 *   PUT  /api/v1/user/profile   ← updateProfile
 * ═══════════════════════════════════════════════════════════════
 */

const userService = require('../services/user.service');
const ApiResponse = require('../utils/apiResponse');

class UserController {
  /**
   * GET /api/v1/user/profile
   * Returns the authenticated user's current profile.
   * req.user is populated by the authenticate middleware.
   */
  async getProfile(req, res, next) {
    try {
      const user = await userService.getProfile(req.user.id);
      return ApiResponse.success(res, { user }, 'Profile retrieved successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/user/profile
   * Partially updates the authenticated user's profile.
   * Only fields present in the body are modified.
   */
  async updateProfile(req, res, next) {
    try {
      const user = await userService.updateProfile(req.user.id, req.body);
      return ApiResponse.success(res, { user }, 'Profile updated successfully');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new UserController();
