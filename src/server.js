'use strict';

require('dotenv').config();

const createApp               = require('./app');
const { connectDatabase }     = require('./config/database');
const { getRedisClient, disconnectRedis } = require('./config/redis');
const { disconnectPrisma }    = require('./config/prisma');
const config                  = require('./config');
const logger                  = require('./utils/logger');
const { bot, initBot }        = require('./telegram/bot');
const { registerHandlers }    = require('./telegram/registerHandlers');

const app = createApp();
let server;

async function bootstrap() {
  try {
    logger.info(`Starting AI Content Publishing API in [${config.env}] mode...`);

    // 1. Establish database connection
    await connectDatabase();

    // 2. Establish Redis connection
    await getRedisClient();

    // 3. Register Telegram bot handlers (must happen before first webhook arrives)
    registerHandlers(bot);

    // 4. Initialise bot — verifies token with Telegram API
    //    Skip in test mode to avoid real network calls
    if (config.env !== 'test' && config.telegram.botToken) {
      await initBot();

      // 5. Register webhook URL with Telegram if domain is configured
      if (config.telegram.webhookDomain) {
        const webhookUrl =
          `${config.telegram.webhookDomain}/api/${config.server.apiVersion}/telegram/webhook`;

        await bot.api.setWebhook(webhookUrl, {
          secret_token: config.telegram.webhookSecret || undefined,
          allowed_updates: ['message', 'callback_query', 'inline_query'],
          drop_pending_updates: false,
        });

        logger.info(`Telegram webhook registered: ${webhookUrl}`);
      } else {
        logger.warn(
          'TELEGRAM_WEBHOOK_DOMAIN not set — webhook not registered with Telegram. ' +
          'Set it in .env when deploying to a public server.'
        );
      }
    }

    // 6. Start HTTP server
    server = app.listen(config.server.port, () => {
      logger.info(`✓ Server listening on http://localhost:${config.server.port}/api/${config.server.apiVersion}`);
      logger.info(`✓ Health check → http://localhost:${config.server.port}/api/${config.server.apiVersion}/health`);
      logger.info(`✓ Telegram webhook → POST /api/${config.server.apiVersion}/telegram/webhook`);
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

// ─── Graceful Shutdown ────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnectRedis();
      await disconnectPrisma();
      logger.info('All connections closed. Goodbye.');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 15_000).unref();
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

bootstrap();
