'use strict';

/**
 * SocialAccountService
 * ═══════════════════════════════════════════════════════════════
 * Business logic for connected social/publishing platform accounts.
 *
 * Responsibilities:
 *   • connect     — upsert an account; tokens encrypted by repository
 *   • list        — return all active accounts for the user (no tokens)
 *   • disconnect  — soft-delete (sets isActive = false)
 *
 * Encryption boundary
 * ───────────────────
 * The SocialAccountRepository handles AES-256-GCM encryption via
 * SecurityService before any write to the DB, and decrypts on
 * `findByIdWithTokens`.  This service layer never touches raw tokens —
 * it only receives the safe projection from the repository.
 *
 * Design rules
 * ────────────
 *   1. All business / authorization logic lives here; controllers stay thin.
 *   2. Raw OAuth tokens are NEVER logged or included in API responses.
 *   3. Ownership is verified before every mutating operation.
 * ═══════════════════════════════════════════════════════════════
 */

const { AppError }              = require('../middlewares/errorHandler');
const { StatusCodes }           = require('http-status-codes');
const socialAccountRepository   = require('../repositories/socialAccount.repository');
const logger                    = require('../utils/logger');

class SocialAccountService {

  /**
   * Connect (or re-connect) a social platform account.
   * Uses upsert — if the user already connected this platform, the tokens
   * and handle are refreshed rather than creating a duplicate.
   *
   * @param {string} userId
   * @param {{
   *   platform:       string,
   *   access_token:   string,
   *   refresh_token?: string|null,
   *   handle:         string,
   *   token_expires_at?: Date|null,
   * }} data  — validated, sanitised body from the validator
   * @returns {object}  Safe account record (no token values)
   */
  async connect(userId, data) {
    const account = await socialAccountRepository.upsert({
      userId,
      platform:       data.platform,
      accessToken:    data.access_token,
      refreshToken:   data.refresh_token ?? null,
      handle:         data.handle,
      tokenExpiresAt: data.token_expires_at ?? null,
    });

    logger.info(
      { userId, platform: data.platform, handle: data.handle },
      'Social account connected'
    );

    return this.#toApiShape(account);
  }

  /**
   * List all active social accounts for the authenticated user.
   * Token values are never returned — callers only see metadata.
   *
   * @param {string} userId
   * @returns {object[]}
   */
  async list(userId) {
    const accounts = await socialAccountRepository.findByUserId(userId);
    return accounts.map((a) => this.#toApiShape(a));
  }

  /**
   * Disconnect (soft-delete) a social account.
   * Verifies ownership — a user cannot delete another user's account.
   *
   * @param {string} accountId  UUID of the SocialAccount row
   * @param {string} userId     Authenticated user's UUID
   */
  async disconnect(accountId, userId) {
    // First confirm the account exists and belongs to this user
    const accounts = await socialAccountRepository.findByUserId(userId);
    const owned    = accounts.find((a) => a.id === accountId);

    if (!owned) {
      // Return 404 whether the account doesn't exist OR belongs to another user.
      // Never distinguish between the two — avoids account enumeration.
      throw new AppError('Social account not found', StatusCodes.NOT_FOUND);
    }

    await socialAccountRepository.disconnect(accountId, userId);

    logger.info(
      { userId, accountId, platform: owned.platform },
      'Social account disconnected'
    );
  }

  // ─── Private helpers ─────────────────────────────────────────

  /**
   * Map Prisma camelCase → snake_case API response.
   * Token fields are intentionally excluded.
   */
  #toApiShape(account) {
    return {
      id:               account.id,
      user_id:          account.userId,
      platform:         account.platform,
      handle:           account.handle,
      token_expires_at: account.tokenExpiresAt ?? null,
      is_active:        account.isActive,
      connected_at:     account.connectedAt,
      updated_at:       account.updatedAt,
    };
  }
}

module.exports = new SocialAccountService();
