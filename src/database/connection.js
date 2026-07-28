'use strict';

const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

let isConnected = false;

async function connectDatabase() {
  if (isConnected) return;

  try {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    isConnected = true;
    logger.info('MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', { error: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnect...');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      isConnected = true;
    });

  } catch (err) {
    logger.error('MongoDB initial connection failed:', { error: err.message });
    // Retry after 5 seconds
    logger.info('Retrying MongoDB connection in 5 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return connectDatabase();
  }
}

function getConnection() {
  return mongoose.connection;
}

function isConnectionReady() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = { connectDatabase, getConnection, isConnectionReady };
