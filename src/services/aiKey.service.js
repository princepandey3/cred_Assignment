'use strict';

/**
 * AiKeyService
 * ═══════════════════════════════════════════════════════════════
 * Business logic for managing encrypted AI provider API keys.
 *
 * Responsibilities:
 *   • upsertKeys     — save/update keys; encryption handled by repository
 *   • getStatus      — return which providers are configured (no key values)
 *
 * Encryption boundary
 * ───────────────────
 * AiKeyRepository encrypts every key with AES-256-GCM (via SecurityService)
 * before writing to the DB.  `getDecryptedKeys()` on the repository is for
 * the AI content-generation service only — it is NEVER called from here.
 * This service only ever returns provider status (boolean flags), not values.
 *
 * Design rules
 * ────────────
 *   1. Raw API key values never appear in logs or HTTP responses.
 *   2. Passing null for a key clears it from the DB.
 *   3. Omitting a key field leaves the existing value untouched.
 * ═══════════════════════════════════════════════════════════════
 */

const aiKeyRepository = require('../repositories/aiKey.repository');
const logger          = require('../utils/logger');

class AiKeyService {

  /**
   * Save or update AI keys for the authenticated user.
   * Fields absent from `data` are not touched.
   * Fields explicitly set to null are cleared.
   *
   * @param {string} userId
   * @param {{
   *   openai_key?:    string|null,
   *   anthropic_key?: string|null,
   *   gemini_key?:    string|null,
   * }} data  — validated, sanitised body from the validator
   * @returns {object}  Provider status object (no key values)
   */
  async upsertKeys(userId, data) {
    // Map snake_case API names → camelCase repository parameter names.
    // Only include keys that were actually sent — undefined = untouched.
    const repoPayload = {};
    if ('openai_key'    in data) repoPayload.openaiKey    = data.openai_key;
    if ('anthropic_key' in data) repoPayload.anthropicKey = data.anthropic_key;
    if ('gemini_key'    in data) repoPayload.geminiKey    = data.gemini_key;

    await aiKeyRepository.upsert(userId, repoPayload);

    logger.info(
      { userId, providers: Object.keys(repoPayload) },
      'AI keys updated'
    );

    // Return status — never the key values
    return this.getStatus(userId);
  }

  /**
   * Return which AI providers are currently configured for a user.
   * Safe to expose in API responses — contains only boolean flags.
   *
   * @param {string} userId
   * @returns {{ openai: boolean, anthropic: boolean, gemini: boolean, updated_at: Date|null }}
   */
  async getStatus(userId) {
    const status = await aiKeyRepository.getProviderStatus(userId);

    if (!status) {
      return {
        openai:     false,
        anthropic:  false,
        gemini:     false,
        updated_at: null,
      };
    }

    return {
      openai:     status.openai,
      anthropic:  status.anthropic,
      gemini:     status.gemini,
      updated_at: status.updatedAt,
    };
  }
}

module.exports = new AiKeyService();
