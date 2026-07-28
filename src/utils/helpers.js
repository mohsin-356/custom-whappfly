'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Ensure all required application directories exist
 */
async function ensureDirectories() {
  const dirs = [
    config.session.basePath,
    config.media.basePath,
    config.logs.basePath,
    path.join(config.media.basePath, 'images'),
    path.join(config.media.basePath, 'videos'),
    path.join(config.media.basePath, 'audio'),
    path.join(config.media.basePath, 'documents'),
    path.join(config.media.basePath, 'stickers'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Format bytes into a human-readable string
 */
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}

/**
 * Extract phone number from a WhatsApp JID
 */
function jidToPhone(jid) {
  if (!jid) return null;
  return jid.split('@')[0].split(':')[0];
}

/**
 * Check if a JID is a group
 */
function isGroupJid(jid) {
  return jid?.endsWith('@g.us');
}

/**
 * Check if a JID is a broadcast list
 */
function isBroadcastJid(jid) {
  return jid?.endsWith('@broadcast');
}

/**
 * Check if a JID is a status broadcast
 */
function isStatusJid(jid) {
  return jid === 'status@broadcast';
}

/**
 * Generate a pagination object
 */
function paginate(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Pick specific keys from an object
 */
function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 */
function omit(obj, keys) {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Deep clone an object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Truncate a string to a max length
 */
function truncate(str, max = 100) {
  if (!str) return str;
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

module.exports = {
  ensureDirectories,
  formatBytes,
  sanitizeFilename,
  jidToPhone,
  isGroupJid,
  isBroadcastJid,
  isStatusJid,
  paginate,
  pick,
  omit,
  deepClone,
  truncate,
};
