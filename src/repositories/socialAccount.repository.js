'use strict';

const { prisma } = require('../config/prisma');
const { securityService } = require('../services/security.service');

const { encryptOAuthToken: encrypt, decryptOAuthToken: decrypt } = securityService;

/**
 * SocialAccountRepository — manages OAuth token storage with transparent encryption.
 */
class SocialAccountRepository {
  /**
   * Connect a new social account.
   * Tokens are encrypted before storage.
   */
  async create({ userId, platform, accessToken, refreshToken, handle, tokenExpiresAt }) {
    return prisma.socialAccount.create({
      data: {
        userId,
        platform,
        accessTokenEnc: encrypt(accessToken),
        refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
        handle,
        tokenExpiresAt,
      },
      select: this.#safeSelect(),
    });
  }

  /**
   * Upsert — create or update if the user already has this platform connected.
   */
  async upsert({ userId, platform, accessToken, refreshToken, handle, tokenExpiresAt }) {
    return prisma.socialAccount.upsert({
      where: { userId_platform: { userId, platform } },
      create: {
        userId,
        platform,
        accessTokenEnc: encrypt(accessToken),
        refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
        handle,
        tokenExpiresAt,
      },
      update: {
        accessTokenEnc: encrypt(accessToken),
        refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
        handle,
        tokenExpiresAt,
        isActive: true,
      },
      select: this.#safeSelect(),
    });
  }

  /** All connected accounts for a user. */
  async findByUserId(userId) {
    return prisma.socialAccount.findMany({
      where: { userId, isActive: true },
      select: this.#safeSelect(),
      orderBy: { connectedAt: 'asc' },
    });
  }

  /** Single account by ID — includes decrypted tokens for API calls. */
  async findByIdWithTokens(id) {
    const account = await prisma.socialAccount.findUnique({ where: { id } });
    if (!account) return null;
    return {
      ...account,
      accessToken: decrypt(account.accessTokenEnc),
      refreshToken: account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : null,
      accessTokenEnc: undefined,
      refreshTokenEnc: undefined,
    };
  }

  /** Find accounts with expiring tokens (within the next N minutes). */
  async findExpiringTokens(withinMinutes = 10) {
    const cutoff = new Date(Date.now() + withinMinutes * 60 * 1000);
    return prisma.socialAccount.findMany({
      where: {
        isActive: true,
        tokenExpiresAt: { lte: cutoff },
      },
    });
  }

  /** Update access token after refresh. */
  async updateTokens(id, { accessToken, refreshToken, tokenExpiresAt }) {
    return prisma.socialAccount.update({
      where: { id },
      data: {
        accessTokenEnc: encrypt(accessToken),
        refreshTokenEnc: refreshToken ? encrypt(refreshToken) : undefined,
        tokenExpiresAt,
      },
      select: this.#safeSelect(),
    });
  }

  /** Soft-disconnect — marks isActive false without deleting history. */
  async disconnect(id, userId) {
    return prisma.socialAccount.update({
      where: { id, userId },
      data: { isActive: false },
    });
  }

  #safeSelect() {
    return {
      id: true,
      userId: true,
      platform: true,
      handle: true,
      tokenExpiresAt: true,
      isActive: true,
      connectedAt: true,
      updatedAt: true,
      // Encrypted blobs are never returned to callers by default
    };
  }
}

module.exports = new SocialAccountRepository();
