'use strict';

const router = require('express').Router();
const MetricsController = require('../controllers/MetricsController');
const { requireAnyAuth } = require('../middlewares/auth');

router.use(requireAnyAuth);

router.get('/metrics', MetricsController.metrics);
router.get('/sessions/:sessionId/metrics', MetricsController.sessionMetrics);

module.exports = router;
