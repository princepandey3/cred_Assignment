'use strict';

const Joi = require('joi');

/**
 * Validation schemas for authentication endpoints.
 * All validation logic lives here — controllers just call these.
 */

const PASSWORD_RULES = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Z]/, 'uppercase letter')
  .pattern(/[a-z]/, 'lowercase letter')
  .pattern(/[0-9]/, 'number')
  .messages({
    'string.pattern.name': '{{#label}} must contain at least one {{#name}}',
    'string.min': 'Password must be at least 8 characters',
    'string.max': 'Password must not exceed 128 characters',
  });

const registerSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).max(255).required().messages({
    'string.email': 'A valid email address is required',
    'any.required': 'Email is required',
  }),
  password: PASSWORD_RULES.required().messages({
    'any.required': 'Password is required',
  }),
  name: Joi.string().trim().min(1).max(150).required().messages({
    'string.min': 'Name cannot be empty',
    'string.max': 'Name must not exceed 150 characters',
    'any.required': 'Name is required',
  }),
});

const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required().messages({
    'string.email': 'A valid email address is required',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
  }),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'any.required': 'Refresh token is required',
  }),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'any.required': 'Refresh token is required',
  }),
});

/**
 * Creates an Express middleware that validates req.body against a Joi schema.
 * On failure it passes a 400 AppError with field-level detail.
 */
function validate(schema) {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      const { AppError } = require('../middlewares/errorHandler');
      const { StatusCodes } = require('http-status-codes');
      return next(Object.assign(new AppError('Validation failed', StatusCodes.BAD_REQUEST), { errors }));
    }

    req.body = value; // replace with sanitised value
    next();
  };
}

module.exports = {
  validateRegister: validate(registerSchema),
  validateLogin: validate(loginSchema),
  validateRefresh: validate(refreshSchema),
  validateLogout: validate(logoutSchema),
};
