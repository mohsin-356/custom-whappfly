'use strict';

const Webhook = require('../database/models/Webhook');
const { WebhookService } = require('../services/WebhookService');
const logger = require('../utils/logger');

class WebhookController {
  /**
   * GET /api/sessions/:sessionId/webhook
   */
  async get(req, res, next) {
    try {
      const { sessionId } = req.params;
      const webhook = await WebhookService.getOrCreate(sessionId);
      res.json({ success: true, webhook: webhook.toPublic() });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/sessions/:sessionId/webhook
   */
  async update(req, res, next) {
    try {
      const { sessionId } = req.params;
      const updates = req.body;

      // Recompute active URL based on mode
      if (updates.mode || updates.testUrl !== undefined || updates.productionUrl !== undefined) {
        const existing = await WebhookService.getOrCreate(sessionId);
        const mode = updates.mode || existing.mode;
        const testUrl = updates.testUrl !== undefined ? updates.testUrl : existing.testUrl;
        const prodUrl = updates.productionUrl !== undefined ? updates.productionUrl : existing.productionUrl;
        updates.activeUrl = mode === 'production' ? prodUrl : testUrl;
      }

      const webhook = await Webhook.findOneAndUpdate(
        { sessionId },
        { $set: updates },
        { new: true, upsert: true, runValidators: true }
      );

      res.json({ success: true, webhook: webhook.toPublic() });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/sessions/:sessionId/webhook
   */
  async delete(req, res, next) {
    try {
      const { sessionId } = req.params;
      await Webhook.deleteOne({ sessionId });
      res.json({ success: true, message: 'Webhook configuration deleted' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions/:sessionId/webhook/test
   */
  async test(req, res, next) {
    try {
      const { sessionId } = req.params;
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ success: false, message: 'URL is required' });
      }

      const result = await WebhookService.test(sessionId, url);
      res.json({ success: result.success, ...result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions/:sessionId/webhook/switch
   * Toggle between testing and production mode
   */
  async switchMode(req, res, next) {
    try {
      const { sessionId } = req.params;
      const { mode } = req.body;

      if (!['testing', 'production'].includes(mode)) {
        return res.status(400).json({ success: false, message: 'mode must be testing or production' });
      }

      const webhook = await WebhookService.getOrCreate(sessionId);
      const activeUrl = mode === 'production' ? webhook.productionUrl : webhook.testUrl;

      const updated = await Webhook.findOneAndUpdate(
        { sessionId },
        { $set: { mode, activeUrl } },
        { new: true }
      );

      res.json({ success: true, mode, activeUrl, webhook: updated.toPublic() });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions/:sessionId/webhook/logs
   */
  async getLogs(req, res, next) {
    try {
      const { sessionId } = req.params;
      const { page, limit, success, eventType } = req.query;

      const result = await WebhookService.getLogs(sessionId, {
        page,
        limit,
        success: success !== undefined ? success === 'true' : undefined,
        eventType,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new WebhookController();
