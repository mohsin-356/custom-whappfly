'use strict';

const Joi = require('joi');

/**
 * Returns an Express middleware that validates req.body against a Joi schema.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: details,
      });
    }

    req.body = value;
    next();
  };
}

/**
 * Returns an Express middleware that validates req.query against a Joi schema.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
      });
    }

    req.query = value;
    next();
  };
}

// ── Reusable Joi schemas ──────────────────────────────────────────────────────

const schemas = {
  login: Joi.object({
    password: Joi.string().required(),
  }),

  createSession: Joi.object({
    sessionId: Joi.string().alphanum().min(3).max(64).optional(),
    label: Joi.string().max(100).optional().allow(''),
  }),

  updateWebhook: Joi.object({
    testUrl: Joi.string().uri().allow('', null).optional(),
    productionUrl: Joi.string().uri().allow('', null).optional(),
    mode: Joi.string().valid('testing', 'production').optional(),
    enabled: Joi.boolean().optional(),
    secret: Joi.string().max(256).allow('', null).optional(),
    eventFilters: Joi.array().items(Joi.string()).optional(),
    headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    maxRetries: Joi.number().integer().min(0).max(10).optional(),
    retryDelay: Joi.number().integer().min(500).max(60000).optional(),
    timeoutMs: Joi.number().integer().min(1000).max(120000).optional(),
  }),

  sendMessage: Joi.object({
    sessionId: Joi.string().required(),
    to: Joi.string().required(),
    message: Joi.object({
      type: Joi.string()
        .valid(
          'text', 'image', 'video', 'audio', 'voice', 'document',
          'sticker', 'location', 'reaction', 'reply', 'mention'
        )
        .required(),
      text: Joi.string().when('type', {
        is: Joi.valid('text', 'reply', 'mention'),
        then: Joi.required(),
        otherwise: Joi.optional().allow('', null),
      }),
      caption: Joi.string().allow('', null).optional(),
      url: Joi.string().uri().optional().allow(null),
      base64: Joi.string().optional().allow(null),
      mimetype: Joi.string().optional().allow(null),
      fileName: Joi.string().optional().allow(null),
      latitude: Joi.number().when('type', { is: 'location', then: Joi.required() }),
      longitude: Joi.number().when('type', { is: 'location', then: Joi.required() }),
      name: Joi.string().optional().allow('', null),
      address: Joi.string().optional().allow('', null),
      emoji: Joi.string().when('type', { is: 'reaction', then: Joi.required() }),
      key: Joi.object().when('type', { is: 'reaction', then: Joi.required() }),
      quoted: Joi.object().optional(),
      mentions: Joi.array().items(Joi.string()).optional(),
      ptt: Joi.boolean().optional(),
      gif: Joi.boolean().optional(),
    }).required(),
  }),

  testWebhook: Joi.object({
    url: Joi.string().uri().required(),
  }),
};

module.exports = { validateBody, validateQuery, schemas };
