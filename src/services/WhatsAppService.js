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
    // sessionId -> { socket, status, qr, info, reconnectAttempts, loggedOutRetries, reconnectTimer, store }
    this.sessions = new Map();
    this.MAX_RECONNECT_ATTEMPTS = Infinity;
    this.RECONNECT_BASE_DELAY = 3000;
    this._startHealthMonitor();
  }

  /**
   * Check if a Baileys socket is genuinely open.
   * Baileys exposes socket.ws as a WebSocketClient class instance.
   * That class has an `isOpen` getter (returns socket.socket.readyState === OPEN).
   * socket.ws.readyState is ALWAYS undefined, so we must use socket.ws.isOpen.
   */
  _isSocketOpen(socket) {
    if (!socket) return false;
    // Preferred: use the WebSocketClient.isOpen getter
    if (typeof socket.ws?.isOpen === 'boolean') return socket.ws.isOpen;
    // Fallback: check raw socket readyState directly
    if (socket.ws?.socket?.readyState === 1) return true;
    return false;
  }

  /**
   * Session Guardian — runs every 2 minutes.
   * Only triggers reconnect when a session is in RECONNECTING/DISCONNECTED state
   * with a stalled (missing) timer, or when the actual WebSocket is confirmed dead.
   * NEVER triggers reconnect for healthy CONNECTED sessions.
   */
  _startHealthMonitor() {
    setInterval(async () => {
      try {
        for (const [sessionId, s] of this.sessions) {
          if (s.status === SESSION_STATUS.LOGGED_OUT) continue;

          if (s.status === SESSION_STATUS.CONNECTED) {
            // Only reconnect if the WebSocket is genuinely closed/dead
            if (s.socket && !this._isSocketOpen(s.socket)) {
              logger.warn(`[Guardian] Session ${sessionId} WebSocket is dead — triggering reconnect`);
              s.status = SESSION_STATUS.RECONNECTING;
              getSocketManager().emitToSession(sessionId, 'status', { status: 'reconnecting', sessionId });
              getSocketManager().streamLog(sessionId, 'warn', 'Dead connection detected — reconnecting...');
              await SessionService.updateStatus(sessionId, 'reconnecting').catch(() => {});
              if (!s.reconnectTimer) {
                await this._scheduleReconnect(sessionId, 2000).catch(() => {});
              }
            }
            // If socket is open and status is CONNECTED: do nothing — session is healthy
          } else if (
            (s.status === SESSION_STATUS.RECONNECTING || s.status === SESSION_STATUS.DISCONNECTED) &&
            !s.reconnectTimer
          ) {
            // Session is stuck reconnecting with no active timer — revive it
            logger.info(`[Guardian] Reviving stalled reconnect for ${sessionId}`);
            await this._scheduleReconnect(sessionId, 3000).catch(() => {});
          }
        }

        // Restore any session in DB with creds on disk that's not tracked in memory at all
        const dbSessions = await SessionService.getActiveSessions().catch(() => []);
        for (const sess of dbSessions) {
          if (sess.status === 'logged_out') continue;
          if (!this.sessions.has(sess.sessionId)) {
            const credsFile = path.join(config.session.basePath, sess.sessionId, 'creds.json');
            if (fs.existsSync(credsFile)) {
              logger.info(`[Guardian] Restoring untracked session ${sess.sessionId}`);
              await this.createSession(sess.sessionId, sess.label).catch(() => {});
            }
          }
        }
      } catch (err) {
        logger.error('[Guardian] Health check error:', { error: err.message });
      }
    }, 2 * 60 * 1000); // Every 2 minutes — conservative interval to avoid false positives
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

    if (s.reconnectTimer) {
      clearTimeout(s.reconnectTimer);
      s.reconnectTimer = null;
    }

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

    // Only delete auth files on deliberate manual logout
    await this._cleanupSession(sessionId, logout);

    getSocketManager().emitToSession(sessionId, 'status', { status: newStatus, sessionId });
    return { success: true, message: logout ? 'Logged out' : 'Disconnected' };
  }

  async deleteSession(sessionId) {
    // Deliberate manual deletion: wipe auth files and database record
    await this._cleanupSession(sessionId, true);
    await SessionService.delete(sessionId);
    return { success: true, message: 'Session deleted' };
  }

  async restartSession(sessionId) {
    await this._cleanupSession(sessionId, false);
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
    if (!s || s.status !== SESSION_STATUS.CONNECTED) return false;
    // Use the correct WebSocketClient.isOpen getter — readyState on ws is always undefined
    return this._isSocketOpen(s.socket);
  }

  getSocket(sessionId) {
    return this.sessions.get(sessionId)?.socket || null;
  }

  // ─────────────────────────────────────────────
  //  Message Sending
  // ─────────────────────────────────────────────

  async sendMessage(sessionId, to, message) {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== SESSION_STATUS.CONNECTED || !this._isSocketOpen(s.socket)) {
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
    s.loggedOutRetries = 0;

    const socket = s.socket;
    const info = {
      jid: socket?.user?.id || null,
      name: socket?.user?.name || null,
      phone: socket?.user?.id?.split(':')[0]?.split('@')[0] || null,
    };
    s.info = info;

    const sm = getSocketManager();
    sm.emitToSession(sessionId, 'status', { status: 'connected', sessionId, info });
    sm.streamLog(sessionId, 'info', `Connected as ${info.name || 'User'} (${info.phone})`);

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
    const isRestartRequired = statusCode === DisconnectReason.restartRequired;

    logger.info(`Session ${sessionId} closed. Code: ${statusCode}, loggedOut: ${isLoggedOut}, badSession: ${isBadSession}`);

    // Clean up socket instance & listeners cleanly
    if (s.socket) {
      try {
        s.socket.ev.removeAllListeners();
        s.socket.end(undefined);
      } catch (_) {}
      s.socket = null;
    }

    if (isLoggedOut) {
      // WhatsApp can return 401 spuriously during server token renewals or network switch.
      // Attempt up to 2 soft reconnects with existing credentials before declaring logged out.
      s.loggedOutRetries = (s.loggedOutRetries || 0) + 1;
      if (s.loggedOutRetries <= 2) {
        logger.warn(`Session ${sessionId} got 401 (retry ${s.loggedOutRetries}/2) — re-authenticating with saved credentials...`);
        s.status = SESSION_STATUS.RECONNECTING;
        await SessionService.updateStatus(sessionId, 'reconnecting');
        await this._scheduleReconnect(sessionId, 2000);
        return;
      }

      // Explicit WhatsApp logout confirmed from user's phone settings
      s.status = SESSION_STATUS.LOGGED_OUT;
      const sm = getSocketManager();
      sm.emitToSession(sessionId, 'status', {
        status: 'logged_out',
        sessionId,
        message: 'Logged out from phone settings — please scan a new QR code',
      });
      sm.streamLog(sessionId, 'warn', 'Session unlinked from phone.');

      await SessionService.updateStatus(sessionId, 'logged_out');
      // CRITICAL: NEVER automatically delete credentials! Preserve them so user can scan new QR or delete manually
      await this._cleanupSession(sessionId, false);

      await WebhookService.dispatch(sessionId, {
        event: 'session.logged_out',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Reconnect immediately for all other reasons (network drops, server restarts, keepalive timeouts)
      s.loggedOutRetries = 0;
      s.status = SESSION_STATUS.RECONNECTING;
      const sm = getSocketManager();
      sm.emitToSession(sessionId, 'status', { status: 'reconnecting', sessionId });
      if (isBadSession) {
        sm.streamLog(sessionId, 'warn', `Reconnecting with saved credentials (code ${statusCode})...`);
      } else {
        sm.streamLog(sessionId, 'warn', `Reconnecting (code ${statusCode})...`);
      }
      await SessionService.updateStatus(sessionId, 'reconnecting');

      const delay = isRestartRequired ? 1000 : undefined;
      await this._scheduleReconnect(sessionId, delay);
    }
  }

  // ─────────────────────────────────────────────
  //  Session restore on startup
  // ─────────────────────────────────────────────

  async restoreActiveSessions() {
    try {
      const dbSessions = await SessionService.getActiveSessions().catch(() => []);
      const dbIds = new Set(dbSessions.map((s) => s.sessionId));

      // Scan filesystem for any session directory with creds.json
      let diskDirs = [];
      try {
        if (fs.existsSync(config.session.basePath)) {
          diskDirs = fs.readdirSync(config.session.basePath);
        }
      } catch (_) {}

      const allSessionIds = new Set([...dbIds, ...diskDirs]);
      logger.info(`Restoring ${allSessionIds.size} session candidate(s)...`);

      for (const sessionId of allSessionIds) {
        const sessionPath = path.join(config.session.basePath, sessionId);
        const credsFile = path.join(sessionPath, 'creds.json');
        const dbSess = dbSessions.find((s) => s.sessionId === sessionId);

        if (fs.existsSync(credsFile)) {
          try {
            logger.info(`Restoring permanent WhatsApp session: ${sessionId}`);
            await this.createSession(sessionId, dbSess?.label || sessionId);
          } catch (err) {
            logger.error(`Failed to restore session ${sessionId}:`, { error: err.message });
          }
        } else if (dbSess && dbSess.status !== 'logged_out') {
          try {
            await this.createSession(sessionId, dbSess.label || sessionId);
          } catch (err) {
            logger.error(`Failed to init session ${sessionId}:`, { error: err.message });
          }
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

    // Clean up any existing socket/timers for this session first to prevent conflicts
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.reconnectTimer) {
        clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
      }
      if (existing.socket) {
        try {
          existing.socket.ev.removeAllListeners();
          existing.socket.end(undefined);
        } catch (_) {}
        existing.socket = null;
      }
    }

    const reconnectAttempts = existing?.reconnectAttempts || 0;
    const loggedOutRetries = existing?.loggedOutRetries || 0;

    this.sessions.set(sessionId, {
      socket: null,
      status: SESSION_STATUS.INITIALIZING,
      qr: null,
      info: existing?.info || null,
      reconnectAttempts,
      loggedOutRetries,
      reconnectTimer: null,
      store: existing?.store || null,
    });

    getSocketManager().emitToSession(sessionId, 'status', {
      status: 'initializing',
      sessionId,
    });

    // Dynamic import of Baileys
    let makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore, Browsers;
    try {
      const baileys = require('@whiskeysockets/baileys');
      makeWASocket = baileys.default || baileys.makeWASocket;
      useMultiFileAuthState = baileys.useMultiFileAuthState;
      fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
      makeInMemoryStore = baileys.makeInMemoryStore;
      Browsers = baileys.Browsers;
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
    const store = makeInMemoryStore ? (existing?.store || makeInMemoryStore({ logger: silentLogger })) : null;

    // Use standard desktop browser signature to prevent WhatsApp disconnects
    const browserConfig = Browsers ? Browsers.windows('Desktop') : ['Windows', 'Chrome', '124.0.6367.82'];

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: browserConfig,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      emitOwnEvents: false,
      retryRequestDelayMs: 2_000,
      getMessage: async (key) => {
        if (store) {
          const msg = await store.loadMessage(key.remoteJid, key.id);
          return msg?.message || undefined;
        }
        return undefined;
      },
    });

    if (store) store.bind(socket.ev);

    const s = this.sessions.get(sessionId);
    if (!s) return;
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

    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (err) {
        logger.error(`Error saving creds for ${sessionId}:`, { error: err.message });
      }
    });

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

  async _scheduleReconnect(sessionId, forcedDelay) {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    if (s.reconnectTimer) {
      clearTimeout(s.reconnectTimer);
      s.reconnectTimer = null;
    }

    s.reconnectAttempts++;
    await SessionService.incrementReconnects(sessionId).catch(() => {});

    // Fast, resilient reconnect: 2s, 4s, 6s... capped at 10s maximum (NEVER give up)
    const delay = forcedDelay !== undefined
      ? forcedDelay
      : Math.min(this.RECONNECT_BASE_DELAY * Math.min(s.reconnectAttempts, 5), 10_000);

    logger.info(
      `Reconnecting session ${sessionId} in ${delay}ms (attempt ${s.reconnectAttempts})`
    );

    getSocketManager().streamLog(
      sessionId,
      'info',
      `Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${s.reconnectAttempts})...`
    );

    s.reconnectTimer = setTimeout(async () => {
      s.reconnectTimer = null;
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
      if (s.reconnectTimer) {
        clearTimeout(s.reconnectTimer);
        s.reconnectTimer = null;
      }
      if (s.socket) {
        try {
          s.socket.ev.removeAllListeners();
          s.socket.end(undefined);
        } catch (_) {}
        s.socket = null;
      }
    }

    if (deleteAuthFiles) {
      const sessionPath = path.join(config.session.basePath, sessionId);
      if (fs.existsSync(sessionPath)) {
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          logger.info(`Auth files deleted for session ${sessionId}`);
        } catch (err) {
          logger.warn(`Could not delete auth files for ${sessionId}: ${err.message}`);
        }
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
