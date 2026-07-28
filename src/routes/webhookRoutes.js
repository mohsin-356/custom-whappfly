'use strict';

const router = require('express').Router({ mergeParams: true });
const WebhookController = require('../controllers/WebhookController');
const { requireAnyAuth } = require('../middlewares/auth');
const { validateBody, schemas } = require('../middlewares/validator');

router.use(requireAnyAuth);

router.get('/', WebhookController.get);
router.put('/', validateBody(schemas.updateWebhook), WebhookController.update);
router.delete('/', WebhookController.delete);
router.post('/test', validateBody(schemas.testWebhook), WebhookController.test);
router.post('/switch', WebhookController.switchMode);
router.get('/logs', WebhookController.getLogs);

module.exports = router;
