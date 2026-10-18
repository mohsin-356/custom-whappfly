'use strict';

const router = require('express').Router();
const BulkMessagingController = require('../controllers/BulkMessagingController');
const { requireAnyAuth } = require('../middlewares/auth');

// All bulk messaging routes require authentication
router.use(requireAnyAuth);

// ─── Media Uploads (Cloudinary) ──────────────────────────────────────────────
router.get ('/:sessionId/media/status',            BulkMessagingController.getCloudinaryStatus);
router.post('/:sessionId/media/upload',            BulkMessagingController.uploadMedia);

// ─── Bulk Messages (saved message templates) ──────────────────────────────────
// GET    /api/bulk/:sessionId/messages
// POST   /api/bulk/:sessionId/messages
// GET    /api/bulk/:sessionId/messages/:messageId
// PATCH  /api/bulk/:sessionId/messages/:messageId
// DELETE /api/bulk/:sessionId/messages/:messageId

router.get ('/:sessionId/messages',                BulkMessagingController.listMessages);
router.post('/:sessionId/messages',                BulkMessagingController.createMessage);
router.get ('/:sessionId/messages/:messageId',     BulkMessagingController.getMessage);
router.patch('/:sessionId/messages/:messageId',    BulkMessagingController.updateMessage);
router.delete('/:sessionId/messages/:messageId',   BulkMessagingController.deleteMessage);

// ─── Lead Lists ──────────────────────────────────────────────────────────────
// GET    /api/bulk/:sessionId/lists
// POST   /api/bulk/:sessionId/lists
// GET    /api/bulk/:sessionId/lists/:listId
// PATCH  /api/bulk/:sessionId/lists/:listId
// DELETE /api/bulk/:sessionId/lists/:listId

router.get ('/:sessionId/lists',              BulkMessagingController.listLeadLists);
router.post('/:sessionId/lists',              BulkMessagingController.createLeadList);
router.get ('/:sessionId/lists/:listId',      BulkMessagingController.getLeadList);
router.patch('/:sessionId/lists/:listId',     BulkMessagingController.updateLeadList);
router.delete('/:sessionId/lists/:listId',    BulkMessagingController.deleteLeadList);

// ─── Leads within a list ─────────────────────────────────────────────────────
// GET    /api/bulk/:sessionId/lists/:listId/leads          ?page=1&limit=100
// POST   /api/bulk/:sessionId/lists/:listId/leads/import   (multipart CSV to list)
// POST   /api/bulk/:sessionId/leads/upload-csv             (multipart CSV, auto-creates or targets list)
// DELETE /api/bulk/:sessionId/lists/:listId/leads          (clear all)
// DELETE /api/bulk/:sessionId/lists/:listId/leads/:leadId

router.get   ('/:sessionId/lists/:listId/leads',            BulkMessagingController.listLeads);
router.post  ('/:sessionId/lists/:listId/leads/import',     BulkMessagingController.importCSV);
router.post  ('/:sessionId/leads/upload-csv',               BulkMessagingController.uploadLeadsCSV);
router.delete('/:sessionId/lists/:listId/leads',            BulkMessagingController.clearLeadList);
router.delete('/:sessionId/lists/:listId/leads/:leadId',    BulkMessagingController.deleteLead);

// ─── Campaigns ───────────────────────────────────────────────────────────────
// GET    /api/bulk/:sessionId/campaigns
// POST   /api/bulk/:sessionId/campaigns            (start)
// GET    /api/bulk/:sessionId/campaigns/:campaignId
// POST   /api/bulk/:sessionId/campaigns/:campaignId/cancel
// DELETE /api/bulk/:sessionId/campaigns/:campaignId

router.get   ('/:sessionId/campaigns',                      BulkMessagingController.listCampaigns);
router.post  ('/:sessionId/campaigns',                      BulkMessagingController.startCampaign);
router.get   ('/:sessionId/campaigns/:campaignId',          BulkMessagingController.getCampaign);
router.post  ('/:sessionId/campaigns/:campaignId/cancel',   BulkMessagingController.cancelCampaign);
router.delete('/:sessionId/campaigns/:campaignId',          BulkMessagingController.deleteCampaign);

module.exports = router;
