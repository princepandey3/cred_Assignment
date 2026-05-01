'use strict';

const { Router } = require('express');
const { sequelize } = require('../config/database');
const { getRedisClient } = require('../config/redis');
const ApiResponse = require('../utils/apiResponse');
const config = require('../config');

const router = Router();

/**
 * GET /health
 * Liveness probe — is the process alive?
 */
router.get('/', (_req, res) => {
  ApiResponse.success(res, { status: 'ok', env: config.env, uptime: process.uptime() }, 'Service is running');
});

/**
 * GET /health/ready
 * Readiness probe — are all dependencies healthy?
 */
router.get('/ready', async (_req, res) => {
  const checks = { postgres: 'unknown', redis: 'unknown' };

  try {
    await sequelize.authenticate();
    checks.postgres = 'healthy';
  } catch {
    checks.postgres = 'unhealthy';
  }

  try {
    const redis = await getRedisClient();
    await redis.ping();
    checks.redis = 'healthy';
  } catch {
    checks.redis = 'unhealthy';
  }

  const allHealthy = Object.values(checks).every((v) => v === 'healthy');
  const statusCode = allHealthy ? 200 : 503;
  const message = allHealthy ? 'All systems operational' : 'One or more dependencies unhealthy';

  res.status(statusCode).json({ success: allHealthy, message, data: checks });
});

module.exports = router;
