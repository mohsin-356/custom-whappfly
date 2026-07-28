'use strict';

const router = require('express').Router();
const SessionController = require('../controllers/SessionController');
const { requireAnyAuth, requireAuth } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiter');
const { validateBody, schemas } = require('../middlewares/validator');

// Auth (no auth required)
router.post('/auth/login', authLimiter, validateBody(schemas.login), SessionController.login);

// All routes below require authentication
router.use(requireAnyAuth);

router.get('/', SessionController.list);
router.post('/', validateBody(schemas.createSession), SessionController.create);

router.get('/:sessionId/status', SessionController.status);
router.get('/:sessionId/qr', SessionController.getQR);

router.post('/:sessionId/connect', SessionController.connect);
router.post('/:sessionId/disconnect', SessionController.disconnect);
router.post('/:sessionId/logout', SessionController.logout);
router.post('/:sessionId/restart', SessionController.restart);

router.delete('/:sessionId', SessionController.deleteSession);
router.patch('/:sessionId/label', SessionController.updateLabel);

module.exports = router;
