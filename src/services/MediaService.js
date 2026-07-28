'use strict';

const logger = require('../utils/logger');
const { saveMediaBuffer, bufferToBase64, getExtFromMime } = require('../utils/mediaHelper');

class MediaServiceClass {
  /**
   * Download media from a Baileys message and attach file info to the payload.
   * The socket is needed to call downloadMediaMessage.
   */
  async downloadAndAttach(socket, rawMessage, payload) {
    try {
      // Lazy-require Baileys to prevent startup issues
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');

      const buffer = await downloadMediaMessage(
        rawMessage,
        'buffer',
        {},
        {
          logger: require('pino')({ level: 'silent' }),
          reuploadRequest: socket.updateMediaMessage,
        }
      );

      if (!buffer || buffer.length === 0) {
        logger.warn('Media download returned empty buffer');
        return payload;
      }

      const mimeType = payload.mime_type || 'application/octet-stream';
      const originalName = payload.file_name || `media.${getExtFromMime(mimeType)}`;

      // Save to disk and get metadata
      const fileMeta = await saveMediaBuffer(buffer, mimeType, originalName);

      // Attach to payload media object
      if (payload.media) {
        payload.media.url = fileMeta.url;
        payload.media.base64 = bufferToBase64(buffer);
        payload.media.size = fileMeta.size;
        payload.media.extension = fileMeta.extension;
        payload.media.sha256 = fileMeta.sha256;
        payload.media.path = fileMeta.relative_path;
        payload.media.original_name = fileMeta.original_name;
      }

      payload.file_size = fileMeta.size;

      logger.debug(`Media downloaded: ${fileMeta.filename} (${fileMeta.size} bytes)`);
      return payload;
    } catch (err) {
      logger.error('Failed to download media:', { error: err.message });
      // Don't throw - return payload without media data
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
      'stickerMessage',
    ]);
    return mediaTypes.has(contentType);
  }
}

const MediaService = new MediaServiceClass();
module.exports = { MediaService };
