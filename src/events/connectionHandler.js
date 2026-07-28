'use strict';

const logger = require('../utils/logger');
const { getSocketManager } = require('../socket/SocketManager');

/**
 * Handle Baileys `connection.update` events.
 * Delegates QR, open and close states to WhatsAppService.
 */
async function handle(socket, sessionId, update, whatsAppService) {
  const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;

  // Emit raw connection update to dashboard
  getSocketManager().emitToSession(sessionId, 'connection.update', {
    sessionId,
    connection,
    hasQr: !!qr,
    isNewLogin: isNewLogin || false,
  });

  if (qr) {
    await whatsAppService.handleQR(sessionId, qr);
    return;
  }

  if (connection === 'open') {
    await whatsAppService.handleConnectionOpen(sessionId);
    if (receivedPendingNotifications) {
      logger.debug(`Session ${sessionId} received pending notifications`);
    }
    return;
  }

  if (connection === 'close') {
    await whatsAppService.handleConnectionClose(sessionId, lastDisconnect);
    return;
  }

  if (connection === 'connecting') {
    getSocketManager().emitToSession(sessionId, 'status', {
      status: 'connecting',
      sessionId,
    });
    getSocketManager().streamLog(sessionId, 'info', 'Connecting to WhatsApp...');
  }
}

module.exports = { handle };
