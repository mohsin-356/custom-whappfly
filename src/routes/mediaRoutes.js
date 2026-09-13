'use strict';

const router = require('express').Router();
const fs = require('fs');
const mime = require('mime-types');
const { requireAnyAuth } = require('../middlewares/auth');
const { getProxyMediaPath } = require('../utils/mediaHelper');
const logger = require('../utils/logger');

// All proxy media downloads require a valid API key / JWT / session token.
router.use(requireAnyAuth);

/**
 * GET /api/media/:sessionId/:messageId
 * Streams a previously-saved decrypted media file back to the caller with the
 * correct Content-Type. Files are removed automatically after MEDIA_TEMP_TTL
 * seconds by the scheduled cleanup, so expired media returns 404.
 */
router.get('/:sessionId/:messageId', async (req, res) => {
  const { sessionId, messageId } = req.params;

  // Guard against path traversal: only allow safe filename characters.
  if (!/^[\w.-]+$/.test(sessionId) || !/^[\w.-]+$/.test(messageId)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }

  try {
    const filePath = getProxyMediaPath(sessionId, messageId);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Media not found or expired' });
    }

    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      logger.error({ err, sessionId, messageId }, 'Error streaming proxy media');
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Stream error' });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    logger.error({ err, sessionId, messageId }, 'Proxy media route error');
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
});

module.exports = router;
