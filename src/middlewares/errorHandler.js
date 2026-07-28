'use strict';

const logger = require('../utils/logger');

/**
 * Central error handling middleware.
 * Must be registered LAST in Express middleware chain.
 */
function errorHandler(err, req, res, next) {
  // Don't log or respond if headers already sent
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';

  // Log server errors
  if (status >= 500) {
    logger.error('Unhandled server error:', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });
  } else {
    logger.debug('Client error:', { message: err.message, url: req.originalUrl });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      })),
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `Duplicate value for ${field}`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    });
  }

  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack }),
  });
}

/**
 * Middleware for 404 not found (register before errorHandler)
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

module.exports = { errorHandler, notFoundHandler };
