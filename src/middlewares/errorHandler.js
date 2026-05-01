'use strict';

const { StatusCodes } = require('http-status-codes');
const logger = require('../utils/logger');
const ApiResponse = require('../utils/apiResponse');
const config = require('../config');

/**
 * Central error-handling middleware — must be the LAST middleware registered.
 * Catches anything passed to next(err) anywhere in the app.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // Log the error with full context
  logger.error('Unhandled error', {
    message: err.message,
    stack: config.isDev ? err.stack : undefined,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    statusCode: err.statusCode,
  });

  // Sequelize validation errors
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    const errors = err.errors.map((e) => ({ field: e.path, message: e.message }));
    return ApiResponse.badRequest(res, 'Validation failed', errors);
  }

  // Sequelize connection errors
  if (err.name === 'SequelizeConnectionError') {
    return ApiResponse.error(res, 'Database connection error', StatusCodes.SERVICE_UNAVAILABLE);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') return ApiResponse.unauthorized(res, 'Invalid token');
  if (err.name === 'TokenExpiredError') return ApiResponse.unauthorized(res, 'Token expired');

  // Operational / known errors (thrown intentionally)
  if (err.isOperational) {
    return ApiResponse.error(res, err.message, err.statusCode || StatusCodes.BAD_REQUEST);
  }

  // Unknown / programmer errors — don't leak details in production
  return ApiResponse.error(
    res,
    config.isProd ? 'An unexpected error occurred' : err.message,
    err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR
  );
}

/**
 * 404 handler — registered before the error handler.
 */
function notFoundHandler(req, res) {
  return ApiResponse.notFound(res, `Route ${req.method} ${req.originalUrl} not found`);
}

/**
 * Custom operational error class.
 */
class AppError extends Error {
  constructor(message, statusCode = StatusCodes.INTERNAL_SERVER_ERROR) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, notFoundHandler, AppError };
