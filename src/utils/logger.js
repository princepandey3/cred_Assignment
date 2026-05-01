'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');
const config = require('../config');

const { combine, timestamp, errors, json, colorize, printf } = format;

// Human-readable format for development console output
const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${ts} [${level}]: ${stack || message}${metaStr}`;
});

const logger = createLogger({
  level: config.logging.level,
  defaultMeta: { service: 'ai-content-api' },
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  transports: [
    // Always write JSON to file (machine-readable)
    new transports.File({
      filename: config.logging.filePath,
      format: json(),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    // Separate error log
    new transports.File({
      filename: path.join(path.dirname(config.logging.filePath), 'error.log'),
      level: 'error',
      format: json(),
    }),
  ],
});

// Pretty console output in non-production environments
if (config.env !== 'production') {
  logger.add(
    new transports.Console({
      format: combine(colorize({ all: true }), timestamp({ format: 'HH:mm:ss' }), devFormat),
    })
  );
}

module.exports = logger;
