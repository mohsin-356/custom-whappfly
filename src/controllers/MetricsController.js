'use strict';

const { WhatsAppService } = require('../services/WhatsAppService');
const { SessionService } = require('../services/SessionService');
const EventLog = require('../database/models/EventLog');
const WebhookLog = require('../database/models/WebhookLog');
const { getSocketManager } = require('../socket/SocketManager');
const { isConnectionReady } = require('../database/connection');

class MetricsController {
  /**
   * GET /api/status
   * Application health check
   */
  async status(req, res, next) {
    try {
      const sessions = WhatsAppService.getAllSessions();
      const connected = sessions.filter((s) => s.status === 'connected').length;
      const dbOk = isConnectionReady();

      res.json({
        success: true,
        status: 'running',
        version: require('../../package.json').version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: dbOk ? 'connected' : 'disconnected',
        sessions: {
          total: sessions.length,
          connected,
        },
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
          heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/metrics
   * Aggregated metrics across all sessions or a specific session
   */
  async metrics(req, res, next) {
    try {
      const { sessionId } = req.query;
      const query = sessionId ? { sessionId } : {};

      const [
        totalIncoming,
        totalOutgoing,
        webhookSuccess,
        webhookFailed,
        sessionCounts,
      ] = await Promise.all([
        EventLog.countDocuments({ ...query, direction: 'incoming' }),
        EventLog.countDocuments({ ...query, direction: 'outgoing' }),
        WebhookLog.countDocuments({ ...query, success: true }),
        WebhookLog.countDocuments({ ...query, success: false }),
        SessionService.countByStatus(),
      ]);

      // Per-session runtime metrics from memory
      const runtimeMetrics = sessionId
        ? { [sessionId]: getSocketManager().getMetrics(sessionId) }
        : {};

      res.json({
        success: true,
        metrics: {
          sessions: sessionCounts,
          events: {
            incoming: totalIncoming,
            outgoing: totalOutgoing,
          },
          webhooks: {
            success: webhookSuccess,
            failed: webhookFailed,
            total: webhookSuccess + webhookFailed,
            successRate: webhookSuccess + webhookFailed > 0
              ? ((webhookSuccess / (webhookSuccess + webhookFailed)) * 100).toFixed(1) + '%'
              : 'N/A',
          },
          runtime: runtimeMetrics,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions/:sessionId/metrics
   */
  async sessionMetrics(req, res, next) {
    try {
      const { sessionId } = req.params;
      const rtMetrics = getSocketManager().getMetrics(sessionId);

      const [
        dbIncoming,
        dbOutgoing,
        wSuccess,
        wFailed,
      ] = await Promise.all([
        EventLog.countDocuments({ sessionId, direction: 'incoming' }),
        EventLog.countDocuments({ sessionId, direction: 'outgoing' }),
        WebhookLog.countDocuments({ sessionId, success: true }),
        WebhookLog.countDocuments({ sessionId, success: false }),
      ]);

      res.json({
        success: true,
        sessionId,
        metrics: {
          runtime: rtMetrics,
          persisted: {
            incoming: dbIncoming,
            outgoing: dbOutgoing,
            webhookSuccess: wSuccess,
            webhookFailed: wFailed,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MetricsController();
