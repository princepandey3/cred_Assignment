'use strict';

const morgan = require('morgan');
const logger = require('../utils/logger');
const config = require('../config');

// Stream Morgan output into Winston
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Development: colourful readable format
// Production: JSON structured format
const format = config.isDev
  ? ':method :url :status :res[content-length] - :response-time ms'
  : ':remote-addr - :method :url HTTP/:http-version :status :res[content-length] :response-time ms';

const requestLogger = morgan(format, {
  stream,
  skip: (req) => req.url === '/health' || req.url === '/favicon.ico',
});

module.exports = requestLogger;
