'use strict';

const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  app: {
    secret: process.env.APP_SECRET || 'whatsbridge-secret-change-me',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  },

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsbridge',
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  redis: {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'jwt-secret-change-me-in-production',
    jwtExpiry: process.env.JWT_EXPIRY || '24h',
    apiKey: process.env.API_KEY || 'default-api-key-change-me',
    dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin123',
  },

  webhook: {
    secret: process.env.WEBHOOK_SECRET || 'webhook-secret-change-me',
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT || '30000', 10),
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY || '5000', 10),
  },

  session: {
    encryptionKey: process.env.SESSION_ENCRYPTION_KEY || 'session-key-32-chars-change-me!!',
    basePath: path.resolve(process.env.SESSIONS_PATH || './sessions'),
  },

  media: {
    basePath: path.resolve(process.env.UPLOADS_PATH || './uploads'),
    maxSize: process.env.MAX_MEDIA_SIZE || '50mb',
    tempTTL: parseInt(process.env.MEDIA_TEMP_TTL || '86400', 10),
  },

  logs: {
    basePath: path.resolve(process.env.LOGS_PATH || './logs'),
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '14', 10),
    maxSize: process.env.LOG_MAX_SIZE || '20m',
  },

  cors: {
    origin: process.env.CORS_ORIGINS === '*'
      ? '*'
      : (process.env.CORS_ORIGINS || '*').split(',').map((o) => o.trim()),
    credentials: true,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
};

module.exports = config;
