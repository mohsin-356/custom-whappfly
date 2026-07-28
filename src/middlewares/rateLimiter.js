'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/** General API rate limiter */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
});

/** Strict limiter for auth endpoints */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts.' },
});

/** Strict limiter for message send endpoints */
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Message send rate limit exceeded.' },
});

module.exports = { apiLimiter, authLimiter, sendLimiter };
