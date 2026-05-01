'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const config = require('./config');
const requestLogger = require('./middlewares/requestLogger');
const { defaultLimiter } = require('./middlewares/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const routes = require('./routes');

function createApp() {
  const app = express();

  // ─── Security ──────────────────────────────────────────────────
  app.use(helmet());                // Sets secure HTTP headers
  app.use(cors({
    origin: config.security.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));

  // ─── Performance ───────────────────────────────────────────────
  app.use(compression());           // Gzip responses

  // ─── Body Parsing ──────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ─── Observability ─────────────────────────────────────────────
  app.use(requestLogger);

  // ─── Rate Limiting ─────────────────────────────────────────────
  app.use(defaultLimiter);

  // ─── API Routes ────────────────────────────────────────────────
  app.use(`/api/${config.server.apiVersion}`, routes);

  // ─── Error Handling (must be last) ────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
