'use strict';

const { v4: uuidv4 } = require('uuid');
const { WhatsAppService } = require('../services/WhatsAppService');
const { SessionService } = require('../services/SessionService');
const { issueToken } = require('../middlewares/auth');
const config = require('../config');
const logger = require('../utils/logger');

class SessionController {
  /**
   * POST /api/auth/login
   * Dashboard login – returns a JWT
   */
  async login(req, res, next) {
    try {
      const { password } = req.body;
      if (password !== config.auth.dashboardPassword) {
        return res.status(401).json({ success: false, message: 'Invalid password' });
      }
      const token = issueToken({ role: 'admin' });
      res.json({ success: true, token, expiresIn: config.auth.jwtExpiry });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions
   */
  async list(req, res, next) {
    try {
      const dbSessions = await SessionService.getAll();
      const runtimeSessions = WhatsAppService.getAllSessions();
      const runtimeMap = new Map(runtimeSessions.map((s) => [s.sessionId, s]));

      const sessions = dbSessions.map((s) => {
        const rt = runtimeMap.get(s.sessionId);
        return {
          ...s.toPublic(),
          runtimeStatus: rt?.status || 'offline',
          info: rt?.info || null,
        };
      });

      res.json({ success: true, sessions, total: sessions.length });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions/:sessionId/status
   */
  async status(req, res, next) {
    try {
      const { sessionId } = req.params;
      const dbSession = await SessionService.getById(sessionId);
      const rtStatus = WhatsAppService.getSessionStatus(sessionId);

      if (!dbSession && !rtStatus) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      res.json({
        success: true,
        sessionId,
        status: rtStatus?.status || dbSession?.status || 'unknown',
        qr: rtStatus?.qr || null,
        info: rtStatus?.info || { phone: dbSession?.phone, name: dbSession?.name },
        connectedAt: dbSession?.connectedAt || null,
        lastSeenAt: dbSession?.lastSeenAt || null,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions/:sessionId/qr
   */
  async getQR(req, res, next) {
    try {
      const { sessionId } = req.params;
      const rtStatus = WhatsAppService.getSessionStatus(sessionId);

      if (!rtStatus) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      if (!rtStatus.qr) {
        return res.status(404).json({
          success: false,
          message: 'QR not available. Session may already be connected.',
          status: rtStatus.status,
        });
      }

      res.json({ success: true, qr: rtStatus.qr, status: rtStatus.status });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions
   * Create / initialize a new WhatsApp session
   */
  async create(req, res, next) {
    try {
      const { sessionId, label } = req.body;
      const id = sessionId || `wb_${uuidv4().replace(/-/g, '').slice(0, 10)}`;

      const result = await WhatsAppService.createSession(id, label || id);

      res.status(201).json({ success: true, sessionId: id, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions/:sessionId/connect
   */
  async connect(req, res, next) {
    try {
      const { sessionId } = req.params;
      const existing = await SessionService.getById(sessionId);
      const label = existing?.label || sessionId;

      const result = await WhatsAppService.createSession(sessionId, label);
      res.json({ success: true, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions/:sessionId/disconnect
   */
  async disconnect(req, res, next) {
    try {
      const { sessionId } = req.params;
      const result = await WhatsAppService.disconnectSession(sessionId, false);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions/:sessionId/logout
   */
  async logout(req, res, next) {
    try {
      const { sessionId } = req.params;
      const result = await WhatsAppService.disconnectSession(sessionId, true);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions/:sessionId/restart
   */
  async restart(req, res, next) {
    try {
      const { sessionId } = req.params;
      const result = await WhatsAppService.restartSession(sessionId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/sessions/:sessionId
   */
  async deleteSession(req, res, next) {
    try {
      const { sessionId } = req.params;
      const result = await WhatsAppService.deleteSession(sessionId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/sessions/:sessionId/label
   */
  async updateLabel(req, res, next) {
    try {
      const { sessionId } = req.params;
      const { label } = req.body;
      const session = await SessionService.updateLabel(sessionId, label);
      if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
      res.json({ success: true, session: session.toPublic() });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SessionController();
