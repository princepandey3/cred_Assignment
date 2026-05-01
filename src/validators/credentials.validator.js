'use strict';

/**
 * credentials.validator.js
 * ═══════════════════════════════════════════════════════════════
 * Joi validation schemas for:
 *   • POST   /api/v1/user/social-accounts
 *   • PUT    /api/v1/user/ai-keys
 *
 * Enum values mirror the Prisma schema exactly.
 * ═══════════════════════════════════════════════════════════════
 */

const Joi            = require('joi');
const { AppError }   = require('../middlewares/errorHandler');
const { StatusCodes } = require('http-status-codes');

// ── Enum mirrors (keep in sync with prisma/schema.prisma) ─────

const VALID_PLATFORMS = [
  'TWITTER',
  'LINKEDIN',
  'INSTAGRAM',
  'FACEBOOK',
  'THREADS',
  'MEDIUM',
  'DEVTO',
];

// ── Schemas ───────────────────────────────────────────────────

/**
 * POST /api/v1/user/social-accounts
 *
 * Required: platform, access_token, handle
 * Optional: refresh_token, token_expires_at
 */
const connectSocialSchema = Joi.object({
  platform: Joi.string()
    .valid(...VALID_PLATFORMS)
    .required()
    .messages({
      'any.only':    `platform must be one of: ${VALID_PLATFORMS.join(', ')}`,
      'any.required': 'platform is required',
    }),

  access_token: Joi.string().trim().min(1).max(4096).required().messages({
    'string.empty':  'access_token cannot be empty',
    'string.max':    'access_token must not exceed 4096 characters',
    'any.required':  'access_token is required',
  }),

  refresh_token: Joi.string().trim().min(1).max(4096).optional().allow(null).messages({
    'string.max': 'refresh_token must not exceed 4096 characters',
  }),

  handle: Joi.string().trim().min(1).max(100).required().messages({
    'string.empty':  'handle cannot be empty',
    'string.max':    'handle must not exceed 100 characters',
    'any.required':  'handle is required',
  }),

  token_expires_at: Joi.date().iso().greater('now').optional().allow(null).messages({
    'date.greater': 'token_expires_at must be a future date',
    'date.format':  'token_expires_at must be an ISO 8601 date string',
  }),
});

/**
 * PUT /api/v1/user/ai-keys
 *
 * All key fields are optional — pass null to clear a stored key.
 * At least one key field must be present.
 * Max length is generous to accommodate different provider key formats.
 */
const upsertAiKeysSchema = Joi.object({
  openai_key: Joi.string().trim().min(1).max(512).optional().allow(null).messages({
    'string.max': 'openai_key must not exceed 512 characters',
  }),

  anthropic_key: Joi.string().trim().min(1).max(512).optional().allow(null).messages({
    'string.max': 'anthropic_key must not exceed 512 characters',
  }),

  gemini_key: Joi.string().trim().min(1).max(512).optional().allow(null).messages({
    'string.max': 'gemini_key must not exceed 512 characters',
  }),
})
  .min(1)
  .messages({
    'object.min': 'Request body must contain at least one AI key field',
  });

// ── Middleware factory ─────────────────────────────────────────

function validate(schema) {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly:   false,
      stripUnknown: true,
      convert:      true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message,
      }));
      return next(
        Object.assign(
          new AppError('Validation failed', StatusCodes.BAD_REQUEST),
          { errors }
        )
      );
    }

    req.body = value;
    next();
  };
}

module.exports = {
  validateConnectSocial: validate(connectSocialSchema),
  validateUpsertAiKeys:  validate(upsertAiKeysSchema),
};
