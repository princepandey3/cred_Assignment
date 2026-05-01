'use strict';

const { Router }   = require('express');
const authenticate = require('../middlewares/authenticate');
const authController = require('../controllers/auth.controller');
const {
  validateRegister,
  validateLogin,
  validateRefresh,
  validateLogout,
} = require('../validators/auth.validator');

const router = Router();

// ── Public endpoints ──────────────────────────────────────────

/**
 * @route   POST /api/v1/auth/register
 * @desc    Create account, receive token pair
 * @access  Public
 */
router.post('/register', validateRegister, (req, res, next) =>
  authController.register(req, res, next)
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate credentials, receive token pair
 * @access  Public
 */
router.post('/login', validateLogin, (req, res, next) =>
  authController.login(req, res, next)
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Rotate refresh token → new access + refresh tokens
 *          (theft detection: replaying an old token revokes the family)
 * @access  Public  (refresh token in body)
 */
router.post('/refresh', validateRefresh, (req, res, next) =>
  authController.refresh(req, res, next)
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Revoke refresh token + blocklist access token
 * @access  Public  (refresh token in body; access token read from Authorization header)
 */
router.post('/logout', validateLogout, (req, res, next) =>
  authController.logout(req, res, next)
);

// ── Protected endpoints ───────────────────────────────────────

/**
 * @route   GET /api/v1/auth/me
 * @desc    Return current user's fresh profile from the DB
 * @access  Private (Bearer access token required)
 */
router.get('/me', authenticate, (req, res, next) =>
  authController.me(req, res, next)
);

module.exports = router;
