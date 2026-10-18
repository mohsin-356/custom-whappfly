'use strict';

const multer = require('multer');
const { BulkMessagingService } = require('../services/BulkMessagingService');
const { CloudinaryService } = require('../services/CloudinaryService');
const logger = require('../utils/logger');

// multer: accept CSV in memory (max 10 MB)
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
}).single('file');

// multer: accept any media (images, videos, audio, documents) in memory up to 50 MB
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 },
]);

// ─── Helper: wrap multer in a promise ────────────────────────────────────────
function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    csvUpload(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function runMediaMulter(req, res) {
  return new Promise((resolve, reject) => {
    mediaUpload(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── Helper: auto-upload any base64 data URIs to Cloudinary ───────────────────
async function processMediaList(mediaList) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) return [];
  if (!CloudinaryService.isConfigured()) return mediaList;

  const processed = [];
  for (const item of mediaList) {
    if (!item) continue;
    if (item.base64 && !item.url) {
      try {
        const dataUri = item.base64.startsWith('data:')
          ? item.base64
          : `data:${item.mimetype || 'image/jpeg'};base64,${item.base64}`;
        const uploaded = await CloudinaryService.uploadSource(dataUri, {
          filename: item.fileName || item.caption || 'upload',
          mimetype: item.mimetype,
        });
        processed.push({
          type: uploaded.type,
          url: uploaded.url,
          caption: item.caption || uploaded.originalFilename,
          mimetype: uploaded.mimetype,
          fileName: uploaded.originalFilename,
        });
        continue;
      } catch (err) {
        logger.warn('[BulkMessaging] Failed to upload base64 item to Cloudinary:', { error: err.message });
      }
    }
    processed.push(item);
  }
  return processed;
}

// ─── Helper: resolve sessionId from context ───────────────────────────────────
function resolveSessionId(req) {
  return (
    req.params.sessionId ||
    req.sessionContext?.sessionId ||
    req.body?.sessionId ||
    req.query?.sessionId
  );
}

class BulkMessagingControllerClass {

  // ── Media & Cloudinary ───────────────────────────────────────────────────

  async getCloudinaryStatus(req, res, next) {
    try {
      const configured = CloudinaryService.isConfigured();
      res.json({
        success: true,
        configured,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'dewgf801n',
        hasApiKey: !!(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_KEY !== '<your_api_key>'),
        hasApiSecret: !!(process.env.CLOUDINARY_API_SECRET),
      });
    } catch (err) { next(err); }
  }

  async uploadMedia(req, res, next) {
    try {
      await runMediaMulter(req, res);

      const uploadedFiles = [];
      if (req.files?.files) uploadedFiles.push(...req.files.files);
      if (req.files?.file) uploadedFiles.push(...req.files.file);
      if (req.file) uploadedFiles.push(req.file);

      if (uploadedFiles.length === 0) {
        return res.status(400).json({ success: false, message: 'No media file provided' });
      }

      if (!CloudinaryService.isConfigured()) {
        return res.status(503).json({
          success: false,
          code: 'CLOUDINARY_NOT_CONFIGURED',
          message: 'Cloudinary is not fully configured. Please set CLOUDINARY_API_KEY in your .env file.',
        });
      }

      const results = [];
      for (const f of uploadedFiles) {
        const item = await CloudinaryService.uploadBuffer(f.buffer, {
          filename: f.originalname,
          mimetype: f.mimetype,
        });
        results.push(item);
      }

      res.status(201).json({
        success: true,
        media: results[0],
        files: results,
      });
    } catch (err) {
      logger.error('[BulkMessagingController] Media upload error:', { error: err.message });
      next(err);
    }
  }

  // ── Bulk Messages ────────────────────────────────────────────────────────

  async listMessages(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const messages = await BulkMessagingService.listMessages(sessionId);
      res.json({ success: true, messages: messages.map((m) => m.toPublic()), total: messages.length });
    } catch (err) { next(err); }
  }

  async getMessage(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const msg = await BulkMessagingService.getMessage(req.params.messageId, sessionId);
      res.json({ success: true, message: msg.toPublic() });
    } catch (err) { next(err); }
  }

  async createMessage(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const { title, bodyText, media } = req.body;
      const processedMedia = await processMediaList(media);
      const msg = await BulkMessagingService.createMessage(sessionId, { title, bodyText, media: processedMedia });
      res.status(201).json({ success: true, message: msg.toPublic() });
    } catch (err) { next(err); }
  }

  async updateMessage(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const data = { ...req.body };
      if (data.media) {
        data.media = await processMediaList(data.media);
      }
      const msg = await BulkMessagingService.updateMessage(req.params.messageId, sessionId, data);
      res.json({ success: true, message: msg.toPublic() });
    } catch (err) { next(err); }
  }

  async deleteMessage(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      await BulkMessagingService.deleteMessage(req.params.messageId, sessionId);
      res.json({ success: true, message: 'Bulk message deleted' });
    } catch (err) { next(err); }
  }

  // ── Lead Lists ────────────────────────────────────────────────────────────

  async listLeadLists(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const lists = await BulkMessagingService.listLeadLists(sessionId);
      res.json({ success: true, lists: lists.map((l) => l.toPublic()), total: lists.length });
    } catch (err) { next(err); }
  }

  async getLeadList(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const list = await BulkMessagingService.getLeadList(req.params.listId, sessionId);
      res.json({ success: true, list: list.toPublic() });
    } catch (err) { next(err); }
  }

  async createLeadList(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const { name, description } = req.body;
      const list = await BulkMessagingService.createLeadList(sessionId, { name, description });
      res.status(201).json({ success: true, list: list.toPublic() });
    } catch (err) { next(err); }
  }

  async updateLeadList(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const list = await BulkMessagingService.updateLeadList(req.params.listId, sessionId, req.body);
      res.json({ success: true, list: list.toPublic() });
    } catch (err) { next(err); }
  }

  async deleteLeadList(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      await BulkMessagingService.deleteLeadList(req.params.listId, sessionId);
      res.json({ success: true, message: 'Lead list deleted' });
    } catch (err) { next(err); }
  }

  // ── Leads ─────────────────────────────────────────────────────────────────

  async listLeads(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const page  = parseInt(req.query.page  || '1',   10);
      const limit = parseInt(req.query.limit || '100', 10);
      const result = await BulkMessagingService.listLeads(req.params.listId, sessionId, { page, limit });
      res.json({ success: true, ...result, leads: result.leads.map((l) => l.toPublic()) });
    } catch (err) { next(err); }
  }

  async importCSV(req, res, next) {
    try {
      await runMulter(req, res);
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No CSV file uploaded' });
      }
      const sessionId = resolveSessionId(req);
      const csvText   = req.file.buffer.toString('utf-8');
      const result    = await BulkMessagingService.importLeadsFromCSV(req.params.listId, sessionId, csvText);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async uploadLeadsCSV(req, res, next) {
    try {
      await runMulter(req, res);
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No CSV file uploaded' });
      }
      const sessionId = resolveSessionId(req);
      let listId = req.body?.listId;
      let listName = req.body?.listName?.trim();

      if (!listId) {
        if (!listName) {
          listName = (req.file.originalname || 'Imported Leads')
            .replace(/\.[^/.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .trim() || 'Imported Leads';
        }
        const newList = await BulkMessagingService.createLeadList(sessionId, {
          name: listName,
          description: `Imported from ${req.file.originalname} on ${new Date().toLocaleDateString()}`,
        });
        listId = newList.id;
      }

      const csvText = req.file.buffer.toString('utf-8');
      const result = await BulkMessagingService.importLeadsFromCSV(listId, sessionId, csvText);
      const leadList = await BulkMessagingService.getLeadList(listId, sessionId);

      res.status(201).json({
        success: true,
        listId,
        list: leadList.toPublic(),
        ...result,
      });
    } catch (err) { next(err); }
  }

  async deleteLead(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      await BulkMessagingService.deleteLead(req.params.leadId, req.params.listId, sessionId);
      res.json({ success: true, message: 'Lead deleted' });
    } catch (err) { next(err); }
  }

  async clearLeadList(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      await BulkMessagingService.clearLeadList(req.params.listId, sessionId);
      res.json({ success: true, message: 'All leads cleared from list' });
    } catch (err) { next(err); }
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────

  async listCampaigns(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const campaigns = await BulkMessagingService.listCampaigns(sessionId);
      res.json({ success: true, campaigns: campaigns.map((c) => c.toPublic()), total: campaigns.length });
    } catch (err) { next(err); }
  }

  async getCampaign(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const c = await BulkMessagingService.getCampaign(req.params.campaignId, sessionId);
      res.json({ success: true, campaign: c.toPublic() });
    } catch (err) { next(err); }
  }

  async startCampaign(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const { messageId, listId, title, delayMs } = req.body;
      const campaign = await BulkMessagingService.startCampaign(sessionId, { messageId, listId, title, delayMs });
      res.status(201).json({ success: true, campaign: campaign.toPublic() });
    } catch (err) {
      if (err.status === 409 && err.code === 'SESSION_NOT_CONNECTED') {
        return res.status(409).json({
          success: false,
          code: 'SESSION_NOT_CONNECTED',
          message: err.message,
          qr: err.qr,
        });
      }
      next(err);
    }
  }

  async cancelCampaign(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      const result = await BulkMessagingService.cancelCampaign(req.params.campaignId, sessionId);
      res.json(result);
    } catch (err) { next(err); }
  }

  async deleteCampaign(req, res, next) {
    try {
      const sessionId = resolveSessionId(req);
      await BulkMessagingService.deleteCampaign(req.params.campaignId, sessionId);
      res.json({ success: true, message: 'Campaign deleted' });
    } catch (err) { next(err); }
  }
}

module.exports = new BulkMessagingControllerClass();
