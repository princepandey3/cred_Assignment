'use strict';

const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const {
  validateRegister,
  validateLogin,
  validateRefresh,
  validateLogout,
} = require('../validators/auth.validator');

const router = Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user — returns access + refresh tokens
 * @access  Public
 */
router.post('/register', validateRegister, (req, res, next) =>
  authController.register(req, res, next)
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate credentials — returns access + refresh tokens
 * @access  Public
 */
router.post('/login', validateLogin, (req, res, next) =>
  authController.login(req, res, next)
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Exchange a valid refresh token for a new token pair
 * @access  Public (token in body)
 */
router.post('/refresh', validateRefresh, (req, res, next) =>
  authController.refresh(req, res, next)
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Revoke the refresh token (server-side invalidation)
 * @access  Public (token in body)
 */
router.post('/logout', validateLogout, (req, res, next) =>
  authController.logout(req, res, next)
);

module.exports = router;
