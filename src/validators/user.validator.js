'use strict';

/**
 * Validation schemas for user profile endpoints.
 * Mirrors the User model fields that are user-updatable.
 */

const Joi = require('joi');
const { AppError } = require('../middlewares/errorHandler');
const { StatusCodes } = require('http-status-codes');

// ── Allowed enum values (mirror Prisma schema) ────────────────

const VALID_TONES = [
  'PROFESSIONAL',
  'CASUAL',
  'HUMOROUS',
  'INSPIRATIONAL',
  'EDUCATIONAL',
  'PERSUASIVE',
  'STORYTELLING',
];

const VALID_LANGUAGES = ['EN', 'ES', 'FR', 'DE', 'PT', 'HI', 'ZH', 'JA', 'AR'];

// ── Schemas ───────────────────────────────────────────────────

/**
 * PUT /api/v1/user/profile
 *
 * All fields are optional — partial updates are allowed.
 * At least one field must be present.
 */
const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).messages({
    'string.empty': 'Name cannot be empty',
    'string.min': 'Name must be at least 1 character',
    'string.max': 'Name must not exceed 150 characters',
  }),

  bio: Joi.string().trim().max(500).allow('', null).messages({
    'string.max': 'Bio must not exceed 500 characters',
  }),

  default_tone: Joi.string()
    .valid(...VALID_TONES)
    .messages({
      'any.only': `default_tone must be one of: ${VALID_TONES.join(', ')}`,
    }),

  default_language: Joi.string()
    .valid(...VALID_LANGUAGES)
    .messages({
      'any.only': `default_language must be one of: ${VALID_LANGUAGES.join(', ')}`,
    }),
})
  .min(1) // at least one key required
  .messages({
    'object.min': 'Request body must contain at least one updatable field',
  });

// ── Middleware factory ─────────────────────────────────────────

function validate(schema) {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(
        Object.assign(new AppError('Validation failed', StatusCodes.BAD_REQUEST), { errors })
      );
    }

    req.body = value;
    next();
  };
}

module.exports = {
  validateUpdateProfile: validate(updateProfileSchema),
};
