'use strict';

const { PrismaClient } = require('@prisma/client');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Global singleton — prevents multiple PrismaClient instances in development
 * (Next.js / nodemon hot-reload safe pattern).
 */
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      config.env === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],
  });

// Forward Prisma log events into Winston
if (config.env === 'development') {
  prisma.$on('query', (e) => {
    logger.debug('Prisma Query', { query: e.query, duration: `${e.duration}ms` });
  });
}

prisma.$on('warn', (e) => logger.warn('Prisma Warning', { message: e.message }));
prisma.$on('error', (e) => logger.error('Prisma Error', { message: e.message }));

if (config.env !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Call once at app startup to verify DB connectivity.
 */
async function connectPrisma() {
  await prisma.$connect();
  logger.info('Prisma connected to PostgreSQL');
}

/**
 * Graceful disconnect — call in shutdown handler.
 */
async function disconnectPrisma() {
  await prisma.$disconnect();
  logger.info('Prisma disconnected');
}

module.exports = { prisma, connectPrisma, disconnectPrisma };
