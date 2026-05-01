'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const ApiResponse = require('../utils/apiResponse');

const defaultLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,   // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,    // Disable the `X-RateLimit-*` headers
  handler: (_req, res) => ApiResponse.tooManyRequests(res, 'Rate limit exceeded. Please retry later.'),
  keyGenerator: (req) => req.ip,
});

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    ApiResponse.tooManyRequests(res, 'Too many authentication attempts. Please try again later.'),
});

module.exports = { defaultLimiter, authLimiter };
