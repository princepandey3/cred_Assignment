'use strict';

const { createClient } = require('redis');
const config = require('./index');
const logger = require('../utils/logger');

let redisClient = null;

/**
 * Returns the singleton Redis client, creating it on first call.
 * Uses the redis v4 API (promise-based).
 */
async function getRedisClient() {
  if (redisClient && redisClient.isOpen) return redisClient;

  redisClient = createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis: max reconnection attempts reached');
          return new Error('Redis: max retries exceeded');
        }
        const delay = Math.min(retries * 100, 3000);
        logger.warn(`Redis: reconnecting in ${delay}ms (attempt ${retries})`);
        return delay;
      },
    },
    password: config.redis.password,
    database: config.redis.db,
  });

  redisClient.on('connect', () => logger.info(`Redis connected → ${config.redis.host}:${config.redis.port}`));
  redisClient.on('error', (err) => logger.error('Redis client error', { error: err.message }));
  redisClient.on('reconnecting', () => logger.warn('Redis: attempting reconnection...'));

  await redisClient.connect();
  return redisClient;
}

/**
 * Gracefully disconnect the Redis client.
 */
async function disconnectRedis() {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed gracefully');
  }
}

module.exports = { getRedisClient, disconnectRedis };
