'use strict';

const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const config = require('../config');
const MessageController = require('../controllers/MessageController');
const { requireAnyAuth } = require('../middlewares/auth');
const { validateBody, schemas } = require('../middlewares/validator');
const { sendLimiter } = require('../middlewares/rateLimiter');

// Multer for media uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.media.basePath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `upload_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.use(requireAnyAuth);

router.post('/send', sendLimiter, validateBody(schemas.sendMessage), MessageController.send);
router.post('/send-media', sendLimiter, upload.single('file'), MessageController.sendMedia);

// Session-scoped logs
router.get('/sessions/:sessionId/logs', MessageController.getLogs);

module.exports = router;
