'use strict';

const { v4: uuidv4 } = require('uuid');
const Session = require('../database/models/Session');
const { generateApiKey } = require('../utils/crypto');
const logger = require('../utils/logger');

class SessionServiceClass {
  /**
   * Create a new session record in MongoDB
   */
  async create(sessionId, label = '') {
    const existing = await Session.findOne({ sessionId });
    if (existing) {
      // Backfill token for sessions that pre-date this feature
      if (!existing.apiToken) {
        existing.apiToken = generateApiKey(32);
        await existing.save();
      }
      return existing;
    }
    const session = new Session({
      sessionId,
      label: label || sessionId,
      apiToken: generateApiKey(32),
    });
    await session.save();
    logger.info(`Session record created: ${sessionId}`);
    return session;
  }

  /**
   * Get a session by sessionId
   */
  async getById(sessionId) {
    return Session.findOne({ sessionId });
  }

  /**
   * Get all sessions
   */
  async getAll(filters = {}) {
    const query = {};
    if (filters.status) query.status = filters.status;
    return Session.find(query).sort({ createdAt: -1 });
  }

  /**
   * Get sessions that were connected at last shutdown (auto-restore candidates)
   */
  async getActiveSessions() {
    return Session.find({
      status: { $in: ['connected', 'reconnecting', 'connecting', 'disconnected'] },
    });
  }

  /**
   * Update session status and optional phone/name info
   */
  async updateStatus(sessionId, status, info = {}) {
    const update = { status };

    if (info.phone) update.phone = info.phone;
    if (info.name) update.name = info.name;
    if (info.jid) update.jid = info.jid;

    if (status === 'connected') {
      update.connectedAt = new Date();
      update.reconnectAttempts = 0;
    }
    if (status === 'disconnected' || status === 'logged_out') {
      update.disconnectedAt = new Date();
    }

    update.lastSeenAt = new Date();

    await Session.findOneAndUpdate({ sessionId }, { $set: update }, { upsert: true, new: true });
    logger.debug(`Session ${sessionId} status → ${status}`);
  }

  /**
   * Update last seen timestamp
   */
  async updateLastSeen(sessionId) {
    await Session.updateOne({ sessionId }, { $set: { lastSeenAt: new Date() } });
  }

  /**
   * Increment reconnect attempt counter
   */
  async incrementReconnects(sessionId) {
    await Session.updateOne({ sessionId }, { $inc: { reconnectAttempts: 1 } });
  }

  /**
   * Update session label
   */
  async updateLabel(sessionId, label) {
    return Session.findOneAndUpdate(
      { sessionId },
      { $set: { label } },
      { new: true }
    );
  }

  /**
   * Delete a session record
   */
  async delete(sessionId) {
    await Session.deleteOne({ sessionId });
    logger.info(`Session record deleted: ${sessionId}`);
  }

  /**
   * Find a session by its per-session API token
   */
  async getByToken(token) {
    if (!token) return null;
    return Session.findOne({ apiToken: token });
  }

  /**
   * Rotate (regenerate) a session's API token
   */
  async rotateToken(sessionId) {
    const newToken = generateApiKey(32);
    const session = await Session.findOneAndUpdate(
      { sessionId },
      { $set: { apiToken: newToken } },
      { new: true }
    );
    if (!session) return null;
    logger.info(`API token rotated for session: ${sessionId}`);
    return session;
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId(prefix = 'session') {
    return `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  }

  /**
   * Count sessions by status
   */
  async countByStatus() {
    const result = await Session.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = {};
    for (const r of result) counts[r._id] = r.count;
    return counts;
  }
}

const SessionService = new SessionServiceClass();
module.exports = { SessionService };
