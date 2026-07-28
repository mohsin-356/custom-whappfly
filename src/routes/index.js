'use strict';

const router = require('express').Router();
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const sessionRoutes = require('./sessionRoutes');
const webhookRoutes = require('./webhookRoutes');
const messageRoutes = require('./messageRoutes');
const groupRoutes = require('./groupRoutes');
const metricsRoutes = require('./metricsRoutes');
const SessionController = require('../controllers/SessionController');
const { apiLimiter, authLimiter } = require('../middlewares/rateLimiter');
const { validateBody, schemas } = require('../middlewares/validator');

// Apply rate limiting to all API routes
router.use(apiLimiter);

// Public auth route
router.post('/auth/login', authLimiter, validateBody(schemas.login), SessionController.login);

// Public health check (must be before authenticated route groups)
const MetricsController = require('../controllers/MetricsController');
router.get('/status', MetricsController.status);

// Mount route groups
router.use('/sessions', sessionRoutes);
router.use('/sessions/:sessionId/webhook', webhookRoutes);
router.use('/', messageRoutes);
router.use('/sessions/:sessionId', groupRoutes);
router.use('/', metricsRoutes);

// Swagger documentation
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsBridge API',
      version: '1.0.0',
      description: 'WhatsApp Bridge for n8n — REST API Documentation',
      contact: { name: 'WhatsBridge' },
    },
    servers: [{ url: '/api', description: 'WhatsBridge API' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    security: [{ bearerAuth: [] }, { apiKey: [] }],
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
router.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'WhatsBridge API Docs',
}));

module.exports = router;
