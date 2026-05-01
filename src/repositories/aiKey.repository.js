'use strict';

const { prisma } = require('../config/prisma');
const { securityService } = require('../services/security.service');

const encrypt = (k) => securityService.encryptAiKey(k);
const decrypt = (k) => securityService.decryptAiKey(k);

/**
 * AiKeyRepository — one row per user, upserted on save.
 * Keys are always encrypted at rest; decryption only happens when
 * the AI service layer needs to make an outbound API call.
 */
class AiKeyRepository {
  /**
   * Save (create or update) AI keys for a user.
   * Pass null to clear a specific key.
   *
   * @param {string} userId
   * @param {{ openaiKey?: string|null, anthropicKey?: string|null, geminiKey?: string|null }} keys
   */
  async upsert(userId, { openaiKey, anthropicKey, geminiKey } = {}) {
    const data = {};
    if (openaiKey !== undefined)    data.openaiKeyEnc    = openaiKey    ? encrypt(openaiKey)    : null;
    if (anthropicKey !== undefined) data.anthropicKeyEnc = anthropicKey ? encrypt(anthropicKey) : null;
    if (geminiKey !== undefined)    data.geminiKeyEnc    = geminiKey    ? encrypt(geminiKey)    : null;

    return prisma.aiKey.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: this.#safeSelect(),
    });
  }

  /**
   * Returns which providers are configured for a user (no key values).
   */
  async getProviderStatus(userId) {
    const record = await prisma.aiKey.findUnique({
      where: { userId },
      select: {
        openaiKeyEnc: true,
        anthropicKeyEnc: true,
        geminiKeyEnc: true,
        updatedAt: true,
      },
    });
    if (!record) return null;

    return {
      openai: !!record.openaiKeyEnc,
      anthropic: !!record.anthropicKeyEnc,
      gemini: !!record.geminiKeyEnc,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Retrieve decrypted keys — ONLY for internal AI service calls.
   * Never expose the return value of this method to HTTP responses.
   */
  async getDecryptedKeys(userId) {
    const record = await prisma.aiKey.findUnique({ where: { userId } });
    if (!record) return null;

    return {
      openai:    record.openaiKeyEnc    ? decrypt(record.openaiKeyEnc)    : null,
      anthropic: record.anthropicKeyEnc ? decrypt(record.anthropicKeyEnc) : null,
      gemini:    record.geminiKeyEnc    ? decrypt(record.geminiKeyEnc)    : null,
    };
  }

  /** Hard delete all AI keys for a user (on account deletion). */
  async deleteByUserId(userId) {
    return prisma.aiKey.delete({ where: { userId } });
  }

  #safeSelect() {
    return {
      id: true,
      userId: true,
      updatedAt: true,
      createdAt: true,
      // Encrypted key blobs are NEVER returned
    };
  }
}

module.exports = new AiKeyRepository();
