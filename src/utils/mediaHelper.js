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

  if (deleted > 0) {
    logger.info(`Media cleanup: deleted ${deleted} expired files`);
  }
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
};
