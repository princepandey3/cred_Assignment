'use strict';

/**
 * CredentialsController
 * ═══════════════════════════════════════════════════════════════
 * Thin HTTP adapter for credential management endpoints.
 * Extracts validated input, delegates to services, formats responses.
 * Zero business logic here — zero token values ever touch this layer.
 *
 * Endpoints covered:
 *   POST   /api/v1/user/social-accounts         connectSocial
 *   GET    /api/v1/user/social-accounts          listSocial
 *   DELETE /api/v1/user/social-accounts/:id      disconnectSocial
 *   PUT    /api/v1/user/ai-keys                  upsertAiKeys
 * ═══════════════════════════════════════════════════════════════
 */

const { StatusCodes }       = require('http-status-codes');
const socialAccountService  = require('../services/socialAccount.service');
const aiKeyService          = require('../services/aiKey.service');
const ApiResponse            = require('../utils/apiResponse');

class CredentialsController {

  // ── Social Accounts ────────────────────────────────────────

  /**
   * POST /api/v1/user/social-accounts
   * Connect (or re-connect) a social platform account.
   */
  async connectSocial(req, res, next) {
    try {
      const account = await socialAccountService.connect(req.user.id, req.body);
      return ApiResponse.created(res, { account }, 'Social account connected successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/user/social-accounts
   * List all active connected accounts — no token values exposed.
   */
  async listSocial(req, res, next) {
    try {
      const accounts = await socialAccountService.list(req.user.id);
      return ApiResponse.success(
        res,
        { accounts, count: accounts.length },
        'Social accounts retrieved successfully'
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/user/social-accounts/:id
   * Soft-disconnect a social account.
   * Ownership is verified inside the service layer.
   */
  async disconnectSocial(req, res, next) {
    try {
      await socialAccountService.disconnect(req.params.id, req.user.id);
      return ApiResponse.success(res, null, 'Social account disconnected successfully');
    } catch (err) {
      next(err);
    }
  }

  // ── AI Keys ────────────────────────────────────────────────

  /**
   * PUT /api/v1/user/ai-keys
   * Save / update encrypted AI provider keys.
   * Response returns only boolean provider-status flags — never key values.
   */
  async upsertAiKeys(req, res, next) {
    try {
      const status = await aiKeyService.upsertKeys(req.user.id, req.body);
      return ApiResponse.success(
        res,
        { ai_keys: status },
        'AI keys updated successfully',
        StatusCodes.OK
      );
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new CredentialsController();
