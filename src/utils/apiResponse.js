'use strict';

const { StatusCodes } = require('http-status-codes');

/**
 * Unified API response envelope.
 * All responses follow:  { success, message, data?, meta?, errors? }
 */
class ApiResponse {
  static success(res, data = null, message = 'Success', statusCode = StatusCodes.OK, meta = null) {
    const payload = { success: true, message };
    if (data !== null) payload.data = data;
    if (meta !== null) payload.meta = meta;
    return res.status(statusCode).json(payload);
  }

  static created(res, data, message = 'Resource created successfully') {
    return ApiResponse.success(res, data, message, StatusCodes.CREATED);
  }

  static noContent(res) {
    return res.status(StatusCodes.NO_CONTENT).send();
  }

  static error(res, message = 'An error occurred', statusCode = StatusCodes.INTERNAL_SERVER_ERROR, errors = null) {
    const payload = { success: false, message };
    if (errors !== null) payload.errors = errors;
    return res.status(statusCode).json(payload);
  }

  static badRequest(res, message = 'Bad Request', errors = null) {
    return ApiResponse.error(res, message, StatusCodes.BAD_REQUEST, errors);
  }

  static unauthorized(res, message = 'Unauthorized') {
    return ApiResponse.error(res, message, StatusCodes.UNAUTHORIZED);
  }

  static forbidden(res, message = 'Forbidden') {
    return ApiResponse.error(res, message, StatusCodes.FORBIDDEN);
  }

  static notFound(res, message = 'Resource not found') {
    return ApiResponse.error(res, message, StatusCodes.NOT_FOUND);
  }

  static conflict(res, message = 'Resource already exists') {
    return ApiResponse.error(res, message, StatusCodes.CONFLICT);
  }

  static tooManyRequests(res, message = 'Too many requests') {
    return ApiResponse.error(res, message, StatusCodes.TOO_MANY_REQUESTS);
  }

  static paginated(res, data, pagination) {
    return ApiResponse.success(res, data, 'Success', StatusCodes.OK, { pagination });
  }
}

module.exports = ApiResponse;
