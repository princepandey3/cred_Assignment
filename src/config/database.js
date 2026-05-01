'use strict';

const { Sequelize } = require('sequelize');
const config = require('./index');
const logger = require('../utils/logger');

const sequelize = new Sequelize({
  dialect: config.db.dialect,
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  schema: config.db.schema,
  pool: config.db.pool,
  logging: config.db.logging,
  define: {
    underscored: true,         // snake_case column names
    timestamps: true,          // createdAt, updatedAt
    paranoid: false,           // set true per-model to enable soft deletes
    freezeTableName: false,    // Sequelize will pluralize table names
  },
  dialectOptions: {
    // ssl: config.isProd ? { require: true, rejectUnauthorized: false } : false,
    statement_timeout: 30000,
    idle_in_transaction_session_timeout: 30000,
  },
});

/**
 * Test the database connection — called once at app startup.
 */
async function connectDatabase() {
  try {
    await sequelize.authenticate();
    logger.info(`PostgreSQL connected → ${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (error) {
    logger.error('PostgreSQL connection failed', { error: error.message });
    throw error;
  }
}

module.exports = { sequelize, connectDatabase };
