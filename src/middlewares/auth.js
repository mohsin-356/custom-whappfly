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
 * Validate a per-session X-API-Token header.
 * On success sets req.sessionContext = { sessionId, session }
 * so downstream handlers know which session this token belongs to.
 */
async function requireSessionToken(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!token) {
    return res.status(401).json({ success: false, message: 'X-API-Token header is required' });
  }

  try {
    const { SessionService } = require('../services/SessionService');
    const session = await SessionService.getByToken(token);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Invalid X-API-Token' });
    }
    req.sessionContext = { sessionId: session.sessionId, session };
    next();
  } catch (err) {
    logger.error('requireSessionToken error:', { error: err.message });
    return res.status(500).json({ success: false, message: 'Token validation failed' });
  }
}

/**
 * Allow any valid auth method:
 *  1. X-API-Token  — per-session token (WappFly-style); sets req.sessionContext
 *  2. X-API-Key    — global admin key from .env
 *  3. Bearer JWT   — dashboard login token
 */
async function requireAnyAuth(req, res, next) {
  // 1. Per-session token (X-API-Token)
  const sessionToken = req.headers['x-api-token'];
  if (sessionToken) {
    try {
      const { SessionService } = require('../services/SessionService');
      const session = await SessionService.getByToken(sessionToken);
      if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid X-API-Token' });
      }
      req.sessionContext = { sessionId: session.sessionId, session };
      return next();
    } catch (err) {
      logger.error('X-API-Token lookup error:', { error: err.message });
      return res.status(500).json({ success: false, message: 'Token validation failed' });
    }
  }

  // 2. Global API key (X-API-Key)
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) {
    if (apiKey === config.auth.apiKey) return next();
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }

  // 3. Bearer JWT
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearerToken) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Provide X-API-Token, X-API-Key, or Bearer token.',
    });
  }

  try {
    req.user = jwt.verify(bearerToken, config.auth.jwtSecret);
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

module.exports = { requireAuth, requireApiKey, requireSessionToken, requireAnyAuth, issueToken };
