'use strict';

/**
 * User Profile Routes
 * ═══════════════════════════════════════════════════════════════
 * All routes here are protected — authenticate middleware is applied
 * at the router level so every handler in this file requires a valid
 * Bearer access token.
 *
 * Base path (mounted in routes/index.js): /api/v1/user
 * ═══════════════════════════════════════════════════════════════
 */

const { Router }     = require('express');
const authenticate   = require('../middlewares/authenticate');
const userController = require('../controllers/user.controller');
const { validateUpdateProfile } = require('../validators/user.validator');

const router = Router();

// Apply auth middleware to every route in this file
router.use(authenticate);

/**
 * @route   GET /api/v1/user/profile
 * @desc    Retrieve the authenticated user's profile
 * @access  Private (Bearer access token required)
 *
 * Response 200:
 * {
 *   success: true,
 *   message: "Profile retrieved successfully",
 *   data: {
 *     user: {
 *       id, email, name, bio, default_tone, default_language,
 *       is_active, email_verified_at, created_at, updated_at
 *     }
 *   }
 * }
 */
router.get('/profile', (req, res, next) =>
  userController.getProfile(req, res, next)
);

/**
 * @route   PUT /api/v1/user/profile
 * @desc    Partially update the authenticated user's profile.
 *          Accepted fields: name, bio, default_tone, default_language.
 *          At least one field is required.
 * @access  Private (Bearer access token required)
 *
 * Request body (all optional, min 1 required):
 * {
 *   "name":             "Alice",
 *   "bio":              "I write things.",
 *   "default_tone":     "CASUAL",
 *   "default_language": "EN"
 * }
 *
 * Response 200:
 * {
 *   success: true,
 *   message: "Profile updated successfully",
 *   data: { user: { ... } }
 * }
 */
router.put('/profile', validateUpdateProfile, (req, res, next) =>
  userController.updateProfile(req, res, next)
);

module.exports = router;
