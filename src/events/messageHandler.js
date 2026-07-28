'use strict';

const logger = require('../utils/logger');
const { getSocketManager } = require('../socket/SocketManager');
const { WebhookService } = require('../services/WebhookService');
const { MediaService } = require('../services/MediaService');
const { normalizeMessage, normalizeReceiptUpdate, getContentType } = require('../utils/payloadNormalizer');
const EventLog = require('../database/models/EventLog');

/**
 * Handle `messages.upsert` – new or pending messages
 */
async function handleUpsert(socket, sessionId, data, store) {
  const { messages, type } = data;
  if (!messages || messages.length === 0) return;

  for (const rawMsg of messages) {
    try {
      // Skip empty messages, status updates from self, protocol-only
      if (!rawMsg.message) continue;
      if (rawMsg.key?.remoteJid === 'status@broadcast' && rawMsg.key?.fromMe) continue;

      const contentType = getContentType(rawMsg.message);
      if (!contentType) continue;

      // Normalize into our standard payload
      let payload = normalizeMessage(rawMsg, sessionId, store || {});
      if (!payload) continue;

      // Download media if present
      if (MediaService.isMediaMessage(contentType)) {
        payload = await MediaService.downloadAndAttach(socket, rawMsg, payload);
      }

      // Increment incoming counter and stream to dashboard
      const sm = getSocketManager();
      sm.incrementIncoming(sessionId);
      sm.emitToSession(sessionId, 'message', {
        sessionId,
        event: payload.event,
        messageType: payload.message_type,
        chatId: payload.chat_id,
        senderName: payload.sender_name,
        text: payload.text || payload.caption || '[media]',
        timestamp: payload.timestamp,
      });
      sm.streamLog(
        sessionId,
        'info',
        `↓ ${payload.event} from ${payload.sender_name || payload.sender_number}`
      );

      // Persist to event log
      await _saveEventLog(sessionId, 'incoming', payload);

      // Dispatch to webhook
      await WebhookService.dispatch(sessionId, payload);

    } catch (err) {
      logger.error(`[messageHandler.handleUpsert] Error processing message:`, {
        sessionId,
        error: err.message,
        stack: err.stack,
      });
    }
  }
}

/**
 * Handle `messages.update` – read receipts, edits, soft-deletes
 */
async function handleUpdate(socket, sessionId, updates) {
  for (const update of updates) {
    try {
      // Check if this is an edit (protocolMessage with type 14)
      const msg = update.update?.message;
      if (!msg) continue;

      const contentType = getContentType(msg);
      if (!contentType) continue;

      let payload = normalizeMessage(
        { key: update.key, message: msg, messageTimestamp: Date.now() / 1000 },
        sessionId,
        {}
      );
      if (!payload) continue;

      getSocketManager().incrementIncoming(sessionId);
      await _saveEventLog(sessionId, 'incoming', payload);
      await WebhookService.dispatch(sessionId, payload);

    } catch (err) {
      logger.error('[messageHandler.handleUpdate] Error:', { error: err.message });
    }
  }
}

/**
 * Handle `messages.delete` – hard deletes
 */
async function handleDelete(socket, sessionId, item) {
  try {
    const keys = item.keys || [];
    for (const key of keys) {
      const payload = {
        event: 'message.deleted',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        message_id: key.id,
        chat_id: key.remoteJid,
        is_from_me: key.fromMe || false,
      };

      getSocketManager().incrementIncoming(sessionId);
      await _saveEventLog(sessionId, 'incoming', payload);
      await WebhookService.dispatch(sessionId, payload);
    }
  } catch (err) {
    logger.error('[messageHandler.handleDelete] Error:', { error: err.message });
  }
}

/**
 * Handle `message-receipt.update` – delivery/read receipts
 */
async function handleReceipt(socket, sessionId, updates) {
  for (const update of updates) {
    try {
      const payload = normalizeReceiptUpdate(sessionId, update);
      await WebhookService.dispatch(sessionId, payload);
    } catch (err) {
      logger.error('[messageHandler.handleReceipt] Error:', { error: err.message });
    }
  }
}

/**
 * Handle `messages.reaction` – emoji reactions
 */
async function handleReaction(socket, sessionId, reactions) {
  for (const reaction of reactions) {
    try {
      const payload = {
        event: 'message.reaction',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        message_id: reaction.key?.id || null,
        chat_id: reaction.key?.remoteJid || null,
        reaction: {
          emoji: reaction.reaction?.text || '',
          sender: reaction.key?.participant || reaction.key?.remoteJid || null,
          is_remove: !reaction.reaction?.text,
          message_id: reaction.reaction?.key?.id || null,
        },
      };

      getSocketManager().incrementIncoming(sessionId);
      await _saveEventLog(sessionId, 'incoming', payload);
      await WebhookService.dispatch(sessionId, payload);
    } catch (err) {
      logger.error('[messageHandler.handleReaction] Error:', { error: err.message });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function _saveEventLog(sessionId, direction, payload) {
  try {
    await EventLog.create({
      sessionId,
      direction,
      eventType: payload.event || 'unknown',
      messageId: payload.message_id || null,
      chatId: payload.chat_id || null,
      isGroup: payload.is_group || false,
      senderNumber: payload.sender_number || null,
      messageType: payload.message_type || null,
      summary: payload.text || payload.caption || payload.event || null,
      payload,
    });
  } catch (err) {
    // Non-critical - don't throw
    logger.debug('EventLog save error:', { error: err.message });
  }
}

module.exports = {
  handleUpsert,
  handleUpdate,
  handleDelete,
  handleReceipt,
  handleReaction,
};
