'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const QRCode = require('qrcode');

const config = require('../config');
const logger = require('../utils/logger');
const { getSocketManager } = require('../socket/SocketManager');
const { SessionService } = require('./SessionService');
const { WebhookService } = require('./WebhookService');
const connectionHandler = require('../events/connectionHandler');
const messageHandler = require('../events/messageHandler');
const groupHandler = require('../events/groupHandler');
const {
  normalizeCallEvent,
} = require('../utils/payloadNormalizer');

const SESSION_STATUS = {
  INITIALIZING: 'initializing',
  QR_READY: 'qr_ready',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting',
  AUTH_FAILED: 'auth_failed',
  LOGGED_OUT: 'logged_out',
};

class WhatsAppServiceClass extends EventEmitter {
  constructor() {
    super();
    // sessionId -> { socket, status, qr, info, reconnectAttempts, reconnectTimer, store }
    this.sessions = new Map();
    this.MAX_RECONNECT_ATTEMPTS = 10;
    this.RECONNECT_BASE_DELAY = 3000;
  }

  // ─────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────

  async createSession(sessionId, label = '') {
    if (this.sessions.has(sessionId)) {
      const s = this.sessions.get(sessionId);
      if (s.status === SESSION_STATUS.CONNECTED) {
        return { success: false, message: 'Session already connected' };
      }
      await this._cleanupSession(sessionId, false);
    }

    await SessionService.create(sessionId, label);
    await this._initSession(sessionId);
    return { success: true, message: 'Session initializing' };
  }

  async disconnectSession(sessionId, logout = false) {
    const s = this.sessions.get(sessionId);
    if (!s) return { success: false, message: 'Session not found' };

    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);

    try {
      if (s.socket) {
        if (logout) {
          await s.socket.logout().catch(() => {});
        } else {
          s.socket.end(new Error('User requested disconnect'));
        }
      }
    } catch (_) {}

    const newStatus = logout ? SESSION_STATUS.LOGGED_OUT : SESSION_STATUS.DISCONNECTED;
    s.status = newStatus;
    await SessionService.updateStatus(sessionId, newStatus);

    if (logout) {
      await this._cleanupSession(sessionId, true);
    }

    getSocketManager().emitToSession(sessionId, 'status', { status: newStatus, sessionId });
    return { success: true, message: logout ? 'Logged out' : 'Disconnected' };
  }

  async deleteSession(sessionId) {
    await this._cleanupSession(sessionId, true);
    await SessionService.delete(sessionId);
    return { success: true, message: 'Session deleted' };
  }

  async restartSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) {
      if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
      if (s.socket) {
        try { s.socket.end(new Error('Restart requested')); } catch (_) {}
      }
      this.sessions.delete(sessionId);
    }
    await this._initSession(sessionId);
    return { success: true, message: 'Session restarting' };
  }

  getSessionStatus(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return { status: s.status, qr: s.qr, info: s.info };
  }

  getAllSessions() {
    const out = [];
    for (const [id, data] of this.sessions.entries()) {
      out.push({ sessionId: id, status: data.status, info: data.info });
    }
    return out;
  }

  isConnected(sessionId) {
    const s = this.sessions.get(sessionId);
    return s?.status === SESSION_STATUS.CONNECTED;
  }

  getSocket(sessionId) {
    return this.sessions.get(sessionId)?.socket || null;
  }

  // ─────────────────────────────────────────────
  //  Message Sending
  // ─────────────────────────────────────────────

  async sendMessage(sessionId, to, message) {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== SESSION_STATUS.CONNECTED) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    const jid = this._toJid(to);
    const { socket } = s;

    let result;
    switch (message.type) {
      case 'text':
        result = await socket.sendMessage(jid, { text: message.text });
        break;

      case 'image':
        result = await socket.sendMessage(jid, {
          image: message.url ? { url: message.url } : Buffer.from(message.base64 || '', 'base64'),
          caption: message.caption || '',
          mimetype: message.mimetype || 'image/jpeg',
        });
        break;

      case 'video':
        result = await socket.sendMessage(jid, {
          video: message.url ? { url: message.url } : Buffer.from(message.base64 || '', 'base64'),
          caption: message.caption || '',
          mimetype: message.mimetype || 'video/mp4',
          gifPlayback: message.gif || false,
        });
        break;

      case 'audio':
        result = await socket.sendMessage(jid, {
          audio: message.url ? { url: message.url } : Buffer.from(message.base64 || '', 'base64'),
          mimetype: message.mimetype || 'audio/mpeg',
          ptt: message.ptt || false,
        });
        break;

      case 'voice':
        result = await socket.sendMessage(jid, {
          audio: message.url ? { url: message.url } : Buffer.from(message.base64 || '', 'base64'),
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        });
        break;

      case 'document':
        result = await socket.sendMessage(jid, {
          document: message.url ? { url: message.url } : Buffer.from(message.base64 || '', 'base64'),
          mimetype: message.mimetype || 'application/octet-stream',
          fileName: message.fileName || 'document',
          caption: message.caption || '',
        });
        break;

      case 'sticker':
        result = await socket.sendMessage(jid, {
          sticker: message.url ? { url: message.url } : Buffer.from(message.base64 || '', 'base64'),
          mimetype: 'image/webp',
        });
        break;

      case 'location':
        result = await socket.sendMessage(jid, {
          location: {
            degreesLatitude: parseFloat(message.latitude),
            degreesLongitude: parseFloat(message.longitude),
            name: message.name || '',
            address: message.address || '',
          },
        });
        break;

      case 'reaction':
        result = await socket.sendMessage(jid, {
          react: {
            text: message.emoji,
            key: message.key,
          },
        });
        break;

      case 'reply':
        result = await socket.sendMessage(
          jid,
          { text: message.text },
          { quoted: message.quoted }
        );
        break;

      case 'mention':
        result = await socket.sendMessage(jid, {
          text: message.text,
          mentions: message.mentions || [],
        });
        break;

      default:
        throw new Error(`Unsupported message type: ${message.type}`);
    }

    getSocketManager().incrementOutgoing(sessionId);
    return result;
  }

  // ─────────────────────────────────────────────
  //  Group / Contact helpers
  // ─────────────────────────────────────────────

  async getGroups(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== SESSION_STATUS.CONNECTED) {
      throw new Error('Session not connected');
    }
    return s.socket.groupFetchAllParticipating();
  }

  async getContacts(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Session not found');
    return Object.values(s.store?.contacts || {});
  }

  // ─────────────────────────────────────────────
  //  QR / Connection helpers (called from handlers)
  // ─────────────────────────────────────────────

  async handleQR(sessionId, qr) {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, {
        width: 280,
        margin: 2,
        color: { dark: '#128C7E', light: '#FFFFFF' },
      });

      const s = this.sessions.get(sessionId);
      if (s) {
        s.qr = qrDataUrl;
        s.status = SESSION_STATUS.QR_READY;
      }

      const sm = getSocketManager();
      sm.emitToSession(sessionId, 'qr', { qr: qrDataUrl, sessionId });
      sm.emitToSession(sessionId, 'status', { status: 'qr_ready', sessionId });
      sm.streamLog(sessionId, 'info', 'QR code ready. Scan with WhatsApp to connect.');

      await SessionService.updateStatus(sessionId, 'qr_ready');
    } catch (err) {
      logger.error(`QR generation failed for ${sessionId}:`, { error: err.message });
    }
  }

  async handleConnectionOpen(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    s.status = SESSION_STATUS.CONNECTED;
    s.qr = null;
    s.reconnectAttempts = 0;

    const socket = s.socket;
    const info = {
      jid: socket.user?.id || null,
      name: socket.user?.name || null,
      phone: socket.user?.id?.split(':')[0]?.split('@')[0] || null,
    };
    s.info = info;

    const sm = getSocketManager();
    sm.emitToSession(sessionId, 'status', { status: 'connected', sessionId, info });
    sm.streamLog(sessionId, 'info', `Connected as ${info.name} (${info.phone})`);

    await SessionService.updateStatus(sessionId, 'connected', info);
    logger.info(`Session ${sessionId} CONNECTED as ${info.name} (${info.phone})`);

    // Dispatch connected event to webhook
    await WebhookService.dispatch(sessionId, {
      event: 'session.connected',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      info,
    });
  }

  async handleConnectionClose(sessionId, lastDisconnect) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    let DisconnectReason;
    try {
      ({ DisconnectReason } = require('@whiskeysockets/baileys'));
    } catch (_) {
      DisconnectReason = {};
    }

    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
    const isBadSession = statusCode === DisconnectReason.badSession;

    logger.info(`Session ${sessionId} closed. Code: ${statusCode}, loggedOut: ${isLoggedOut}`);

    if (isLoggedOut || isBadSession) {
      s.status = SESSION_STATUS.LOGGED_OUT;
      const sm = getSocketManager();
      sm.emitToSession(sessionId, 'status', {
        status: 'logged_out',
        sessionId,
        message: isLoggedOut ? 'Logged out from WhatsApp' : 'Bad session – please reconnect',
      });
      sm.streamLog(sessionId, 'warn', 'Session logged out.');

      await SessionService.updateStatus(sessionId, 'logged_out');
      await this._cleanupSession(sessionId, true);

      await WebhookService.dispatch(sessionId, {
        event: 'session.logged_out',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
      });
    } else {
      s.status = SESSION_STATUS.RECONNECTING;
      getSocketManager().emitToSession(sessionId, 'status', {
        status: 'reconnecting',
        sessionId,
      });
      await SessionService.updateStatus(sessionId, 'reconnecting');
      await this._scheduleReconnect(sessionId);
    }
  }

  // ─────────────────────────────────────────────
  //  Session restore on startup
  // ─────────────────────────────────────────────

  async restoreActiveSessions() {
    try {
      const sessions = await SessionService.getActiveSessions();
      logger.info(`Restoring ${sessions.length} session(s)...`);

      for (const sess of sessions) {
        const sessionPath = path.join(config.session.basePath, sess.sessionId);
        if (fs.existsSync(sessionPath)) {
          try {
            await this.createSession(sess.sessionId, sess.label);
          } catch (err) {
            logger.error(`Failed to restore session ${sess.sessionId}:`, { error: err.message });
          }
        } else {
          await SessionService.updateStatus(sess.sessionId, 'disconnected');
        }
      }
    } catch (err) {
      logger.error('restoreActiveSessions error:', { error: err.message });
    }
  }

  async disconnectAll() {
    for (const id of [...this.sessions.keys()]) {
      await this._cleanupSession(id, false).catch(() => {});
    }
  }

  // ─────────────────────────────────────────────
  //  Private helpers
  // ─────────────────────────────────────────────

  async _initSession(sessionId) {
    const sessionPath = path.join(config.session.basePath, sessionId);
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    this.sessions.set(sessionId, {
      socket: null,
      status: SESSION_STATUS.INITIALIZING,
      qr: null,
      info: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      store: null,
    });

    getSocketManager().emitToSession(sessionId, 'status', {
      status: 'initializing',
      sessionId,
    });

    // Dynamic import of Baileys
    let makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore;
    try {
      const baileys = require('@whiskeysockets/baileys');
      makeWASocket = baileys.default || baileys.makeWASocket;
      useMultiFileAuthState = baileys.useMultiFileAuthState;
      fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
      makeInMemoryStore = baileys.makeInMemoryStore;
    } catch (err) {
      logger.error('Failed to load @whiskeysockets/baileys:', { error: err.message });
      throw new Error('Baileys package not found. Run: npm install');
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    let version = [2, 3000, 1023625842];
    try {
      const versionInfo = await fetchLatestBaileysVersion();
      version = versionInfo.version;
      logger.debug(`Baileys version: ${version.join('.')}`);
    } catch (_) {
      logger.warn('Could not fetch latest Baileys version, using fallback');
    }

    const silentLogger = require('pino')({ level: 'silent' });

    const store = makeInMemoryStore ? makeInMemoryStore({ logger: silentLogger }) : null;

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['WhatsBridge', 'Chrome', '124.0.6367.82'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 15_000,
      emitOwnEvents: false,
      retryRequestDelayMs: 2_000,
    });

    if (store) store.bind(socket.ev);

    const s = this.sessions.get(sessionId);
    s.socket = socket;
    s.store = store;
    s.status = SESSION_STATUS.CONNECTING;

    this._registerEventHandlers(socket, sessionId, saveCreds, store);
    logger.info(`Session ${sessionId} socket created`);
  }

  _registerEventHandlers(socket, sessionId, saveCreds, store) {
    socket.ev.on('connection.update', async (update) => {
      await connectionHandler.handle(socket, sessionId, update, this);
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('messages.upsert', async (data) => {
      await messageHandler.handleUpsert(socket, sessionId, data, store);
    });

    socket.ev.on('messages.update', async (data) => {
      await messageHandler.handleUpdate(socket, sessionId, data);
    });

    socket.ev.on('messages.delete', async (data) => {
      await messageHandler.handleDelete(socket, sessionId, data);
    });

    socket.ev.on('message-receipt.update', async (data) => {
      await messageHandler.handleReceipt(socket, sessionId, data);
    });

    socket.ev.on('messages.reaction', async (data) => {
      await messageHandler.handleReaction(socket, sessionId, data);
    });

    socket.ev.on('groups.update', async (data) => {
      await groupHandler.handleGroupUpdate(socket, sessionId, data);
    });

    socket.ev.on('group-participants.update', async (data) => {
      await groupHandler.handleParticipantsUpdate(socket, sessionId, data);
    });

    socket.ev.on('call', async (calls) => {
      for (const call of calls) {
        const payload = normalizeCallEvent(sessionId, call);
        await WebhookService.dispatch(sessionId, payload);
        getSocketManager().incrementIncoming(sessionId);
      }
    });

    socket.ev.on('contacts.upsert', () => {});
    socket.ev.on('chats.upsert', () => {});
  }

  async _scheduleReconnect(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    if (s.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error(`Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for ${sessionId}`);
      s.status = SESSION_STATUS.DISCONNECTED;
      getSocketManager().emitToSession(sessionId, 'status', {
        status: 'disconnected',
        sessionId,
        message: 'Max reconnect attempts reached',
      });
      await SessionService.updateStatus(sessionId, 'disconnected');
      return;
    }

    s.reconnectAttempts++;
    await SessionService.incrementReconnects(sessionId);

    const delay = Math.min(
      this.RECONNECT_BASE_DELAY * Math.pow(2, s.reconnectAttempts - 1),
      60_000
    );

    logger.info(
      `Reconnecting session ${sessionId} in ${delay}ms (attempt ${s.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`
    );

    getSocketManager().streamLog(
      sessionId,
      'warn',
      `Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${s.reconnectAttempts})...`
    );

    s.reconnectTimer = setTimeout(async () => {
      if (!this.sessions.has(sessionId)) return;
      try {
        await this._initSession(sessionId);
      } catch (err) {
        logger.error(`Reconnect init failed for ${sessionId}:`, { error: err.message });
        const current = this.sessions.get(sessionId);
        if (current) await this._scheduleReconnect(sessionId);
      }
    }, delay);
  }

  async _cleanupSession(sessionId, deleteAuthFiles = false) {
    const s = this.sessions.get(sessionId);
    if (s) {
      if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
      if (s.socket) {
        try {
          s.socket.ev.removeAllListeners();
          s.socket.end(new Error('Cleanup'));
        } catch (_) {}
      }
    }

    if (deleteAuthFiles) {
      const sessionPath = path.join(config.session.basePath, sessionId);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        logger.info(`Auth files deleted for session ${sessionId}`);
      }
    }

    this.sessions.delete(sessionId);
  }

  _toJid(to) {
    if (!to) throw new Error('Recipient (to) is required');
    if (to.includes('@')) return to;
    // Strip non-digit characters and append default suffix
    const clean = to.replace(/[^0-9]/g, '');
    return `${clean}@s.whatsapp.net`;
  }
}

const WhatsAppService = new WhatsAppServiceClass();
module.exports = { WhatsAppService, SESSION_STATUS };
