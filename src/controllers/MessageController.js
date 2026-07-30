'use strict';

const { WhatsAppService } = require('../services/WhatsAppService');
const EventLog = require('../database/models/EventLog');
const { paginate } = require('../utils/helpers');
const logger = require('../utils/logger');

class MessageController {
  /**
   * POST /api/send
   * Send any supported message type
   */
  async send(req, res, next) {
    try {
      // If authenticated via X-API-Token, sessionId is derived from the token automatically
      const sessionId = req.sessionContext?.sessionId || req.body.sessionId;
      const { to, message } = req.body;

      if (!sessionId) {
        return res.status(400).json({ success: false, message: 'sessionId is required' });
      }

      if (!WhatsAppService.isConnected(sessionId)) {
        return res.status(400).json({
          success: false,
          message: `Session ${sessionId} is not connected`,
        });
      }

      const result = await WhatsAppService.sendMessage(sessionId, to, message);

      // Log outgoing
      await EventLog.create({
        sessionId,
        direction: 'outgoing',
        eventType: `message.${message.type}`,
        chatId: to,
        messageType: message.type,
        summary: message.text || message.caption || `[${message.type}]`,
        payload: { to, message },
      });

      res.json({ success: true, messageId: result?.key?.id || null, result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/send-media
   * Send media with optional base64 body
   * Supports multipart/form-data via multer or JSON with base64
   */
  async sendMedia(req, res, next) {
    try {
      const sessionId = req.sessionContext?.sessionId || req.body.sessionId || req.query.sessionId;
      const to = req.body.to;
      const type = req.body.type || 'document';
      const caption = req.body.caption || '';

      if (!sessionId || !to) {
        return res.status(400).json({ success: false, message: 'sessionId and to are required' });
      }

      if (!WhatsAppService.isConnected(sessionId)) {
        return res.status(400).json({ success: false, message: 'Session not connected' });
      }

      let message;

      if (req.file) {
        // Uploaded via multipart
        const fs = require('fs');
        const mime = require('mime-types');
        const fileMime = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
        const buffer = fs.readFileSync(req.file.path);

        message = {
          type,
          base64: buffer.toString('base64'),
          mimetype: fileMime,
          fileName: req.file.originalname,
          caption,
        };

        // Clean up temp upload
        fs.unlink(req.file.path, () => {});
      } else if (req.body.base64) {
        message = {
          type,
          base64: req.body.base64,
          mimetype: req.body.mimetype || 'application/octet-stream',
          fileName: req.body.fileName || 'file',
          caption,
        };
      } else if (req.body.url) {
        message = {
          type,
          url: req.body.url,
          mimetype: req.body.mimetype,
          fileName: req.body.fileName,
          caption,
        };
      } else {
        return res.status(400).json({ success: false, message: 'Provide url, base64, or file upload' });
      }

      const result = await WhatsAppService.sendMessage(sessionId, to, message);
      res.json({ success: true, messageId: result?.key?.id || null });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions/:sessionId/logs
   * Get event logs for a session
   */
  async getLogs(req, res, next) {
    try {
      const { sessionId } = req.params;
      const page = parseInt(req.query.page || '1', 10);
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
      const direction = req.query.direction; // 'incoming' | 'outgoing'
      const eventType = req.query.eventType;

      const query = { sessionId };
      if (direction) query.direction = direction;
      if (eventType) query.eventType = eventType;

      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        EventLog.find(query)
          .sort({ processedAt: -1 })
          .skip(skip)
          .limit(limit)
          .select('-payload'), // exclude full payload for list view
        EventLog.countDocuments(query),
      ]);

      res.json({ success: true, logs, pagination: paginate(total, page, limit) });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MessageController();
