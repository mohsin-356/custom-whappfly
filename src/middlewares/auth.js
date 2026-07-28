'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verify a JWT token from the Authorization header or cookie.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    logger.debug('JWT verification failed:', { error: err.message });
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Verify an API key from the X-API-Key header or ?api_key query param.
 */
function requireApiKey(req, res, next) {
  const apiKey =
    req.headers['x-api-key'] ||
    req.query.api_key;

  if (!apiKey || apiKey !== config.auth.apiKey) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }

  next();
}

/**
 * Allow either JWT auth OR API key.
 * Dashboard uses JWT; external integrations (n8n, etc.) use API key.
 */
function requireAnyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (apiKey) {
    if (apiKey === config.auth.apiKey) return next();
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }

  // Fall through to JWT
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    req.user = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Issue a JWT for the dashboard login
 */
function issueToken(payload = {}) {
  return jwt.sign(
    { ...payload, iat: Math.floor(Date.now() / 1000) },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiry }
  );
}

module.exports = { requireAuth, requireApiKey, requireAnyAuth, issueToken };
