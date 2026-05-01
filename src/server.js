'use strict';

require('dotenv').config();

const createApp = require('./app');
const { connectDatabase } = require('./config/database');
const { getRedisClient, disconnectRedis } = require('./config/redis');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();
let server;

async function bootstrap() {
  try {
    logger.info(`Starting AI Content Publishing API in [${config.env}] mode...`);

    // 1. Establish database connection
    await connectDatabase();

    // 2. Establish Redis connection
    await getRedisClient();

    // 3. Start HTTP server
    server = app.listen(config.server.port, () => {
      logger.info(`✓ Server listening on http://localhost:${config.server.port}/api/${config.server.apiVersion}`);
      logger.info(`✓ Health check → http://localhost:${config.server.port}/api/${config.server.apiVersion}/health`);
    });

    server.on('error', (err) => {
      logger.error('HTTP server error', { error: err.message });
      process.exit(1);
    });
  } catch (err) {
    logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnectRedis();
      const { sequelize } = require('./config/database');
      await sequelize.close();
      logger.info('All connections closed. Goodbye.');
      process.exit(0);
    });

    // Force kill after 15 s
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 15_000).unref();
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

bootstrap();
