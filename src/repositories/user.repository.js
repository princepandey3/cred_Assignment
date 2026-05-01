'use strict';

const { prisma } = require('../config/prisma');

/**
 * UserRepository — all DB operations for the User model.
 * Controllers/services never call prisma directly for User data.
 */
class UserRepository {
  /**
   * Create a new user.
   * @param {{ email, passwordHash, name, bio?, defaultTone?, defaultLanguage? }} data
   */
  async create(data) {
    return prisma.user.create({
      data,
      select: this.#safeSelect(),
    });
  }

  /**
   * Find a user by their primary key.
   * @param {string} id UUID
   * @param {boolean} includePassword Whether to include passwordHash (default false)
   */
  async findById(id, includePassword = false) {
    return prisma.user.findUnique({
      where: { id },
      select: includePassword ? undefined : this.#safeSelect(),
    });
  }

  /**
   * Find a user by email — used during login.
   * Always returns passwordHash so the auth layer can verify.
   */
  async findByEmail(email) {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  /**
   * Update user profile fields.
   * @param {string} id
   * @param {{ name?, bio?, defaultTone?, defaultLanguage? }} data
   */
  async update(id, data) {
    return prisma.user.update({
      where: { id },
      data,
      select: this.#safeSelect(),
    });
  }

  /**
   * Mark email as verified.
   */
  async markEmailVerified(id) {
    return prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
      select: this.#safeSelect(),
    });
  }

  /**
   * Soft-deactivate a user (sets isActive = false).
   */
  async deactivate(id) {
    return prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: this.#safeSelect(),
    });
  }

  /**
   * Check whether an email is already registered.
   */
  async emailExists(email) {
    const count = await prisma.user.count({
      where: { email: email.toLowerCase().trim() },
    });
    return count > 0;
  }

  // ─── Private helpers ─────────────────────────────────────

  /** Returns only safe fields — never exposes passwordHash by default. */
  #safeSelect() {
    return {
      id: true,
      email: true,
      name: true,
      bio: true,
      defaultTone: true,
      defaultLanguage: true,
      isActive: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}

module.exports = new UserRepository();
