'use strict';

const logger = require('../utils/logger');

let _io = null;

// In-memory metrics per session
const metrics = new Map();

function getDefaultMetrics() {
  return {
    incoming: 0,
    outgoing: 0,
    webhookSent: 0,
    webhookFailed: 0,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Initialize the Socket Manager with an existing Socket.io server instance
 */
function initializeSocketManager(io) {
  _io = io;

  io.on('connection', (socket) => {
    logger.info(`Dashboard client connected: ${socket.id}`);

    // Join a session room to receive session-specific events
    socket.on('join_session', (sessionId) => {
      if (sessionId) {
        socket.join(`session:${sessionId}`);
        logger.debug(`Socket ${socket.id} joined session room: ${sessionId}`);

        // Send current metrics for this session immediately
        const m = metrics.get(sessionId) || getDefaultMetrics();
        socket.emit('metrics', { sessionId, metrics: m });
      }
    });

    // Leave a session room
    socket.on('leave_session', (sessionId) => {
      if (sessionId) {
        socket.leave(`session:${sessionId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Dashboard client disconnected: ${socket.id}`);
    });
  });
}

/**
 * Get the Socket.io server instance
 */
function getSocketManager() {
  return {
    /**
     * Emit an event to all clients subscribed to a session room
     */
    emitToSession(sessionId, event, data) {
      if (!_io) return;
      _io.to(`session:${sessionId}`).emit(event, data);
    },

    /**
     * Emit an event to all connected clients
     */
    emitGlobal(event, data) {
      if (!_io) return;
      _io.emit(event, data);
    },

    /**
     * Increment incoming event counter for a session and broadcast metrics
     */
    incrementIncoming(sessionId) {
      if (!metrics.has(sessionId)) metrics.set(sessionId, getDefaultMetrics());
      const m = metrics.get(sessionId);
      m.incoming++;
      if (_io) _io.to(`session:${sessionId}`).emit('metrics', { sessionId, metrics: m });
    },

    /**
     * Increment outgoing event counter for a session and broadcast metrics
     */
    incrementOutgoing(sessionId) {
      if (!metrics.has(sessionId)) metrics.set(sessionId, getDefaultMetrics());
      const m = metrics.get(sessionId);
      m.outgoing++;
      if (_io) _io.to(`session:${sessionId}`).emit('metrics', { sessionId, metrics: m });
    },

    /**
     * Increment webhook sent counter
     */
    incrementWebhookSent(sessionId) {
      if (!metrics.has(sessionId)) metrics.set(sessionId, getDefaultMetrics());
      metrics.get(sessionId).webhookSent++;
    },

    /**
     * Increment webhook failed counter
     */
    incrementWebhookFailed(sessionId) {
      if (!metrics.has(sessionId)) metrics.set(sessionId, getDefaultMetrics());
      metrics.get(sessionId).webhookFailed++;
    },

    /**
     * Stream a log line to the dashboard log viewer
     */
    streamLog(sessionId, level, message, meta = {}) {
      if (!_io) return;
      _io.to(`session:${sessionId}`).emit('log', {
        sessionId,
        level,
        message,
        meta,
        timestamp: new Date().toISOString(),
      });
    },

    /**
     * Get current metrics for a session
     */
    getMetrics(sessionId) {
      return metrics.get(sessionId) || getDefaultMetrics();
    },

    /**
     * Reset metrics for a session
     */
    resetMetrics(sessionId) {
      metrics.set(sessionId, getDefaultMetrics());
    },

    /**
     * Get the io instance
     */
    getIO() {
      return _io;
    },
  };
}

module.exports = { initializeSocketManager, getSocketManager };
