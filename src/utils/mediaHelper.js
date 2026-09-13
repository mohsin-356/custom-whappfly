'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('./logger');

/**
 * Get file extension from mime type
 */
function getExtFromMime(mimeType) {
  if (!mimeType) return 'bin';
  const cleaned = mimeType.split(';')[0].trim();
  return mime.extension(cleaned) || 'bin';
}

/**
 * Determine the storage subdirectory from mime type
 */
function getSubdirFromMime(mimeType) {
  if (!mimeType) return 'documents';
  if (mimeType.startsWith('image/')) return 'images';
  if (mimeType.startsWith('video/')) return 'videos';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'image/webp') return 'stickers';
  return 'documents';
}

/**
 * Save a buffer to disk and return file metadata
 */
async function saveMediaBuffer(buffer, mimeType, originalName = null) {
  const ext = getExtFromMime(mimeType);
  const subdir = getSubdirFromMime(mimeType);
  const filename = `${uuidv4()}.${ext}`;
  const dirPath = path.join(config.media.basePath, subdir);
  const filePath = path.join(dirPath, filename);

  // Ensure directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFileSync(filePath, buffer);

  const stat = fs.statSync(filePath);
  const relativePath = path.join(subdir, filename).replace(/\\/g, '/');
  const publicUrl = `${config.app.baseUrl}/uploads/${relativePath}`;

  return {
    filename,
    original_name: originalName || filename,
    mime_type: mimeType,
    extension: ext,
    size: stat.size,
    path: filePath,
    relative_path: relativePath,
    url: publicUrl,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

/**
 * Convert a buffer to base64 data URI
 */
function bufferToDataUri(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Convert a buffer to plain base64 string
 */
function bufferToBase64(buffer) {
  return buffer.toString('base64');
}

/**
 * Delete a media file from disk
 */
function deleteMediaFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn(`Failed to delete media file: ${filePath}`, { error: err.message });
  }
}

/**
 * Parse a human-readable size string ("70mb", "5gb", "1024") into bytes.
 * Falls back to 50MB when the value cannot be parsed.
 */
function parseMaxMediaSize(size) {
  if (typeof size === 'number' && Number.isFinite(size)) return size;
  if (!size) return 50 * 1024 * 1024;
  const match = String(size).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!match) return 50 * 1024 * 1024;
  const num = parseFloat(match[1]);
  const unit = match[2] || 'b';
  const mult = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024, tb: 1024 * 1024 * 1024 * 1024 }[unit];
  return Math.floor(num * mult);
}

/**
 * Directory used to store oversized decrypted media that is served via the
 * authenticated proxy route (/api/media/:sessionId/:messageId).
 */
function getProxyDir(sessionId) {
  return path.join(config.media.basePath, 'proxy', sessionId);
}

/**
 * Save a decrypted buffer for proxy download as `{messageId}.{ext}`.
 * Returns the on-disk filename and absolute path.
 */
function saveProxyMedia(sessionId, messageId, buffer, mimeType) {
  const ext = getExtFromMime(mimeType);
  const dirPath = getProxyDir(sessionId);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const filename = `${messageId}.${ext}`;
  const filePath = path.join(dirPath, filename);
  fs.writeFileSync(filePath, buffer);
  return { filename, filePath, ext };
}

/**
 * Resolve the on-disk path of a proxied media file by sessionId + messageId.
 * Returns null when no matching file exists (expired or never saved).
 */
function getProxyMediaPath(sessionId, messageId) {
  const dirPath = getProxyDir(sessionId);
  if (!fs.existsSync(dirPath)) return null;
  const match = fs.readdirSync(dirPath).find((f) => f.startsWith(`${messageId}.`));
  return match ? path.join(dirPath, match) : null;
}

/**
 * Build the authenticated proxy download URL for a message.
 */
function buildProxyMediaUrl(sessionId, messageId) {
  return `${config.app.baseUrl}/api/media/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}`;
}

/**
 * Wrap the project's winston logger into a minimal pino-compatible interface
 * so it can be handed to Baileys' downloadMediaMessage() (which expects pino).
 */
function createBaileysLogger(winLogger) {
  const levelMap = { trace: 'silly', debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error' };
  const shim = {};
  for (const pinoLevel of Object.keys(levelMap)) {
    const winLevel = levelMap[pinoLevel];
    shim[pinoLevel] = (arg1, arg2) => {
      if (typeof winLogger[winLevel] !== 'function') return;
      // pino signatures: logger.info(obj, 'msg') | logger.info('msg') | logger.info(obj)
      if (typeof arg1 === 'string') {
        winLogger[winLevel](arg2 !== undefined ? `${arg1} ${JSON.stringify(arg2)}` : arg1);
      } else if (arg2 !== undefined) {
        winLogger[winLevel](arg2, arg1 || {});
      } else {
        winLogger[winLevel](arg1 || {});
      }
    };
  }
  shim.child = () => shim;
  return shim;
}

/**
 * Clean up media files older than TTL seconds
 */
async function cleanupExpiredMedia(ttlSeconds = config.media.tempTTL) {
  const now = Date.now();
  const subdirs = ['images', 'videos', 'audio', 'documents', 'stickers'];

  let deleted = 0;
  for (const subdir of subdirs) {
    const dirPath = path.join(config.media.basePath, subdir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        const ageSeconds = (now - stat.mtimeMs) / 1000;
        if (ageSeconds > ttlSeconds) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (_) {
        // Ignore stat/unlink errors
      }
    }
  }

  // Also clean up proxied (oversized) media stored under uploads/proxy/<sessionId>/
  deleted += cleanupExpiredProxyMedia(ttlSeconds);

  if (deleted > 0) {
    logger.info(`Media cleanup: deleted ${deleted} expired files`);
  }
  return deleted;
}

/**
 * Recursively delete proxied media files older than TTL seconds.
 */
function cleanupExpiredProxyMedia(ttlSeconds = config.media.tempTTL) {
  const root = path.join(config.media.basePath, 'proxy');
  if (!fs.existsSync(root)) return 0;

  let deleted = 0;
  const now = Date.now();

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        // Remove the session directory once it's empty
        try {
          if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
        } catch (_) {}
      } else {
        try {
          const stat = fs.statSync(fullPath);
          const ageSeconds = (now - stat.mtimeMs) / 1000;
          if (ageSeconds > ttlSeconds) {
            fs.unlinkSync(fullPath);
            deleted++;
          }
        } catch (_) {}
      }
    }
  };

  walk(root);
  return deleted;
}

module.exports = {
  getExtFromMime,
  getSubdirFromMime,
  saveMediaBuffer,
  bufferToDataUri,
  bufferToBase64,
  deleteMediaFile,
  cleanupExpiredMedia,
  parseMaxMediaSize,
  getProxyDir,
  saveProxyMedia,
  getProxyMediaPath,
  buildProxyMediaUrl,
  createBaileysLogger,
};
