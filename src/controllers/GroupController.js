'use strict';

const { WhatsAppService } = require('../services/WhatsAppService');
const { jidToPhone } = require('../utils/helpers');

class GroupController {
  /**
   * GET /api/sessions/:sessionId/groups
   */
  async list(req, res, next) {
    try {
      const { sessionId } = req.params;

      if (!WhatsAppService.isConnected(sessionId)) {
        return res.status(400).json({ success: false, message: 'Session not connected' });
      }

      const rawGroups = await WhatsAppService.getGroups(sessionId);

      const groups = Object.entries(rawGroups || {}).map(([id, g]) => ({
        group_id: id,
        subject: g.subject || null,
        description: g.desc || null,
        owner: g.owner ? jidToPhone(g.owner) : null,
        creation: g.creation || null,
        restrict: g.restrict || false,
        announce: g.announce || false,
        size: g.size || (g.participants?.length || 0),
        participants: (g.participants || []).map((p) => ({
          jid: p.id,
          phone: jidToPhone(p.id),
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        })),
      }));

      res.json({ success: true, groups, total: groups.length });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions/:sessionId/contacts
   */
  async listContacts(req, res, next) {
    try {
      const { sessionId } = req.params;

      if (!WhatsAppService.isConnected(sessionId)) {
        return res.status(400).json({ success: false, message: 'Session not connected' });
      }

      const contacts = await WhatsAppService.getContacts(sessionId);

      const formatted = (contacts || [])
        .filter((c) => c.id && !c.id.endsWith('@g.us'))
        .map((c) => ({
          jid: c.id,
          phone: jidToPhone(c.id),
          name: c.name || c.notify || null,
          verifiedName: c.verifiedName || null,
          imgUrl: c.imgUrl || null,
          status: c.status || null,
        }));

      res.json({ success: true, contacts: formatted, total: formatted.length });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new GroupController();
