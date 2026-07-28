'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { Server } = require('socket.io');

const config = require('./src/config');
const { connectDatabase } = require('./src/database/connection');
const { initializeSocketManager } = require('./src/socket/SocketManager');
const routes = require('./src/routes');
const { errorHandler, notFoundHandler } = require('./src/middlewares/errorHandler');
const logger = require('./src/utils/logger');
const { ensureDirectories } = require('./src/utils/helpers');
const { WhatsAppService } = require('./src/services/WhatsAppService');
const { QueueService } = require('./src/services/QueueService');

async function bootstrap() {
  // 1. Ensure required directories exist
  await ensureDirectories();
  logger.info('Directories ready');

  // 2. Connect to MongoDB
  await connectDatabase();

  // 3. Create Express app
  const app = express();
  const server = http.createServer(app);

  // 4. Initialize Socket.io
  const io = new Server(server, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });
  initializeSocketManager(io);

  // 5. Trust proxy (required for rate-limiter when behind reverse proxy / browser preview)
  app.set('trust proxy', 1);

  // 6. Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'cdn.socket.io'],
          styleSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
          fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
        },
      },
    })
  );

  app.use(cors(config.cors));
  app.use(compression());

  // 7. Body parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 8. Static files
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(
    '/uploads',
    express.static(path.join(__dirname, 'uploads'), { maxAge: '1d' })
  );

  // 9. API routes
  app.use('/api', routes);

  // 10. Dashboard SPA – serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // 11. 404 & error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  // 12. Initialize BullMQ queues
  await QueueService.initialize();

  // 13. Restore sessions that were active before shutdown
  await WhatsAppService.restoreActiveSessions();

  // 14. Start server
  server.listen(config.port, () => {
    logger.info(`═══════════════════════════════════════`);
    logger.info(`  WhatsBridge started`);
    logger.info(`  Dashboard : http://localhost:${config.port}`);
    logger.info(`  API       : http://localhost:${config.port}/api`);
    logger.info(`  API Docs  : http://localhost:${config.port}/api/docs`);
    logger.info(`  Env       : ${config.nodeEnv}`);
    logger.info(`═══════════════════════════════════════`);
  });

  // 15. Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received – shutting down gracefully...`);
    await WhatsAppService.disconnectAll();
    await QueueService.shutdown();
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 15 seconds
    setTimeout(() => {
      logger.error('Forced exit after timeout');
      process.exit(1);
    }, 15_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', { reason: String(reason) });
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
