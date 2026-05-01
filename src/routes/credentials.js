'use strict';

/**
 * Credentials Routes — Social Accounts & AI Keys
 * ═══════════════════════════════════════════════════════════════
 * All routes are protected: authenticate middleware is applied at
 * router level — every handler here requires a valid Bearer token.
 *
 * Base path (mounted in routes/index.js): /api/v1/user
 *
 * Routes:
 *   POST   /social-accounts        Connect a platform account
 *   GET    /social-accounts        List connected accounts
 *   DELETE /social-accounts/:id    Disconnect an account (soft-delete)
 *   PUT    /ai-keys                Save / update encrypted AI keys
 * ═══════════════════════════════════════════════════════════════
 */

const { Router }              = require('express');
const authenticate            = require('../middlewares/authenticate');
const credentialsController   = require('../controllers/credentials.controller');
const {
  validateConnectSocial,
  validateUpsertAiKeys,
} = require('../validators/credentials.validator');

const router = Router();

// Every route in this file requires authentication
router.use(authenticate);

// ── Social Accounts ──────────────────────────────────────────

/**
 * @route   POST /api/v1/user/social-accounts
 * @desc    Connect (or re-connect) a social platform account.
 *          Uses upsert — re-posting the same platform refreshes tokens.
 * @access  Private
 *
 * Request body:
 * {
 *   "platform":         "TWITTER",          // required — see Platform enum
 *   "access_token":     "oauth-access-...", // required — stored encrypted
 *   "refresh_token":    "oauth-refresh-..", // optional
 *   "handle":           "@alice",           // required
 *   "token_expires_at": "2026-01-01T00:00:00Z" // optional ISO date
 * }
 *
 * Response 201:
 * { success: true, data: { account: { id, platform, handle, ... } } }
 * Token values are NEVER returned.
 */
router.post(
  '/social-accounts',
  validateConnectSocial,
  (req, res, next) => credentialsController.connectSocial(req, res, next)
);

/**
 * @route   GET /api/v1/user/social-accounts
 * @desc    List all active connected accounts for the current user.
 *          Token values are never exposed.
 * @access  Private
 *
 * Response 200:
 * { success: true, data: { accounts: [...], count: N } }
 */
router.get(
  '/social-accounts',
  (req, res, next) => credentialsController.listSocial(req, res, next)
);

/**
 * @route   DELETE /api/v1/user/social-accounts/:id
 * @desc    Soft-disconnect a social account (sets isActive = false).
 *          Verifies ownership — returns 404 for missing or foreign accounts.
 * @access  Private
 *
 * Response 200:
 * { success: true, message: "Social account disconnected successfully" }
 */
router.delete(
  '/social-accounts/:id',
  (req, res, next) => credentialsController.disconnectSocial(req, res, next)
);

// ── AI Keys ──────────────────────────────────────────────────

/**
 * @route   PUT /api/v1/user/ai-keys
 * @desc    Save or update encrypted AI provider API keys.
 *          Pass null for a key to clear it.
 *          Fields omitted from the body are not touched.
 * @access  Private
 *
 * Request body (all optional, at least one required):
 * {
 *   "openai_key":    "sk-...",   // null to clear
 *   "anthropic_key": "sk-ant-..", // null to clear
 *   "gemini_key":    "AI..."      // null to clear
 * }
 *
 * Response 200:
 * {
 *   success: true,
 *   data: {
 *     ai_keys: {
 *       openai: true,      // boolean — key is stored
 *       anthropic: false,
 *       gemini: false,
 *       updated_at: "2026-..."
 *     }
 *   }
 * }
 * Raw key values are NEVER returned.
 */
router.put(
  '/ai-keys',
  validateUpsertAiKeys,
  (req, res, next) => credentialsController.upsertAiKeys(req, res, next)
);

module.exports = router;
