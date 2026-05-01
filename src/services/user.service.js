'use strict';

/**
 * UserService
 * ═══════════════════════════════════════════════════════════════
 * Owns all business logic for user profile management:
 *
 *   • getProfile  — return the authenticated user's profile
 *   • updateProfile — update name, bio, defaultTone, defaultLanguage
 *
 * Design rules
 * ────────────
 *   1. Never expose passwordHash — all responses use safe projections.
 *   2. Controllers stay thin; all logic lives here.
 *   3. Map camelCase DB fields ↔ snake_case API fields at service boundary.
 * ═══════════════════════════════════════════════════════════════
 */

const { AppError }     = require('../middlewares/errorHandler');
const { StatusCodes }  = require('http-status-codes');
const userRepository   = require('../repositories/user.repository');
const logger           = require('../utils/logger');

class UserService {
  /**
   * Return the authenticated user's current profile.
   *
   * @param {string} userId  UUID from the verified JWT
   * @returns {object}       Safe user profile (no passwordHash)
   */
  async getProfile(userId) {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new AppError('User not found', StatusCodes.NOT_FOUND);
    }

    return this.#toApiShape(user);
  }

  /**
   * Apply a partial update to the user's profile.
   * Only the fields present in `data` are changed.
   *
   * @param {string} userId   UUID from the verified JWT
   * @param {object} data     Validated, sanitised body from the validator
   *                          Keys are snake_case (as sent by client).
   * @returns {object}        Updated safe user profile
   */
  async updateProfile(userId, data) {
    // Confirm the user still exists before attempting the update
    const existing = await userRepository.findById(userId);
    if (!existing) {
      throw new AppError('User not found', StatusCodes.NOT_FOUND);
    }

    // Map snake_case API fields → camelCase Prisma fields
    const dbData = this.#toDbShape(data);

    if (Object.keys(dbData).length === 0) {
      throw new AppError(
        'No valid fields to update',
        StatusCodes.BAD_REQUEST
      );
    }

    logger.info({ userId, fields: Object.keys(dbData) }, 'Updating user profile');

    const updated = await userRepository.update(userId, dbData);

    return this.#toApiShape(updated);
  }

  // ─── Private helpers ─────────────────────────────────────────

  /**
   * Convert snake_case client payload to camelCase Prisma fields.
   * Only whitelisted fields pass through.
   */
  #toDbShape(data) {
    const mapping = {
      name: 'name',
      bio: 'bio',
      default_tone: 'defaultTone',
      default_language: 'defaultLanguage',
    };

    return Object.entries(data).reduce((acc, [key, val]) => {
      if (mapping[key] !== undefined) {
        // Treat empty string bio as null (allow clearing the field)
        acc[mapping[key]] = val === '' ? null : val;
      }
      return acc;
    }, {});
  }

  /**
   * Convert Prisma camelCase record → snake_case API response shape.
   */
  #toApiShape(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      bio: user.bio ?? null,
      default_tone: user.defaultTone,
      default_language: user.defaultLanguage,
      is_active: user.isActive,
      email_verified_at: user.emailVerifiedAt ?? null,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };
  }
}

module.exports = new UserService();
