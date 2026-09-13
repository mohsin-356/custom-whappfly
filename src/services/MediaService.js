'use strict';

const logger = require('../utils/logger');
const config = require('../config');
const {
  saveMediaBuffer,
  bufferToBase64,
  getExtFromMime,
  parseMaxMediaSize,
  saveProxyMedia,
  buildProxyMediaUrl,
  createBaileysLogger,
} = require('../utils/mediaHelper');

// Reuse a single pino-compatible logger adapter across all download calls.
const baileysLogger = createBaileysLogger(logger);

class MediaServiceClass {
  /**
   * Download (decrypt) media from a Baileys message and attach the decrypted
   * bytes to the payload as base64. The raw encrypted CDN `.url` is replaced
   * with `null` once decrypted bytes are available.
   *
   * When the decrypted buffer exceeds MAX_MEDIA_SIZE, the bytes are NOT inlined
   * (to avoid oversized webhook bodies). Instead the buffer is saved to disk
   * under UPLOADS_PATH/proxy/<sessionId>/<messageId>.<ext> and `media.url` is
   * set to an authenticated proxy download URL.
   *
   * This runs once at the shared point where the media object is built, so it
   * applies to BOTH incoming and outgoing (is_from_me) messages.
   */
  async downloadAndAttach(socket, rawMessage, payload) {
    const messageId = payload.message_id;
    const sessionId = payload.session_id;

    try {
      // Lazy-require Baileys to prevent startup issues
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');

      const buffer = await downloadMediaMessage(
        rawMessage,
        'buffer',
        {},
        {
          logger: baileysLogger,
          reuploadRequest: socket.updateMediaMessage,
        }
      );

      if (!buffer || buffer.length === 0) {
        logger.warn({ messageId, sessionId }, 'Media download returned empty buffer');
        if (payload.media) {
          payload.media.base64 = null;
          payload.media.url = null;
          payload.media.error = 'empty_buffer';
        }
        return payload;
      }

      const mimeType = payload.media?.mimetype || payload.mime_type || 'application/octet-stream';
      const maxSizeBytes = parseMaxMediaSize(config.media.maxSize);

      if (buffer.length > maxSizeBytes) {
        // Oversized: persist to disk for the proxy route, do NOT inline base64.
        const { filename } = saveProxyMedia(sessionId, messageId, buffer, mimeType);
        const proxyUrl = buildProxyMediaUrl(sessionId, messageId);

        if (payload.media) {
          payload.media.base64 = null;
          payload.media.url = proxyUrl;
          payload.media.error = null;
          payload.media.size = buffer.length;
          payload.media.stored_file = filename;
        }
        payload.file_size = buffer.length;

        logger.info(
          { messageId, sessionId, size: buffer.length, maxSize: maxSizeBytes },
          'Media exceeds MAX_MEDIA_SIZE, saved to disk for proxy download'
        );
        return payload;
      }

      // Inline the decrypted bytes as base64.
      const base64 = bufferToBase64(buffer);

      if (payload.media) {
        payload.media.base64 = base64;
        payload.media.url = null; // no longer needed once base64 is present
        payload.media.error = null;
        payload.media.size = buffer.length;
      }
      payload.file_size = buffer.length;

      // Best-effort: also persist to disk for the dashboard / local_url.
      try {
        const originalName = payload.media?.file_name || `media.${getExtFromMime(mimeType)}`;
        const fileMeta = await saveMediaBuffer(buffer, mimeType, originalName);
        if (payload.media) {
          payload.media.local_url = fileMeta.url;
          payload.media.mimetype = payload.media.mimetype || mimeType;
          payload.media.mime = payload.media.mime || mimeType;
          if (!payload.media.file_name || payload.media.file_name === 'receipt.jpg') {
            payload.media.file_name = fileMeta.original_name || fileMeta.filename;
          }
          if (!payload.media.filename || payload.media.filename === 'receipt.jpg') {
            payload.media.filename = fileMeta.original_name || fileMeta.filename;
          }
          payload.media.extension = fileMeta.extension;
          payload.media.sha256 = fileMeta.sha256;
          payload.media.path = fileMeta.relative_path;
          payload.media.original_name = fileMeta.original_name;
        }
      } catch (saveErr) {
        logger.debug(
          { messageId, error: saveErr.message },
          'Optional disk save failed (non-critical)'
        );
      }

      logger.debug(
        { messageId, sessionId, size: buffer.length, mime: mimeType },
        'Media decrypted and attached as base64'
      );
      return payload;
    } catch (err) {
      logger.error({ err, messageId, sessionId }, 'Media decrypt failed');
      if (payload.media) {
        payload.media.base64 = null;
        payload.media.url = null;
        payload.media.error = 'decrypt_failed';
      }
      // Still return the payload so the webhook is dispatched (fail safe).
      return payload;
    }
  }

  /**
   * Process a queued media download job (called from QueueService)
   */
  async processAndAttach(sessionId, messageData) {
    // This is a stub for queue-based processing.
    // The actual download is done inline in messageHandler for latency reasons.
    logger.debug(`[MediaService] processAndAttach called for session ${sessionId}`);
  }

  /**
   * Check whether a message type contains downloadable media
   */
  isMediaMessage(contentType) {
    const mediaTypes = new Set([
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
      'documentWithCaptionMessage',
      'stickerMessage',
    ]);
    return mediaTypes.has(contentType);
  }
}

const MediaService = new MediaServiceClass();
module.exports = { MediaService };
