'use strict';

const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const { getSocketManager } = require('../socket/SocketManager');
const { WebhookService } = require('../services/WebhookService');
const { MediaService } = require('../services/MediaService');
const { normalizeMessage, normalizeReceiptUpdate, getContentType } = require('../utils/payloadNormalizer');
const EventLog = require('../database/models/EventLog');

// Cache processed message IDs for 24 hours to prevent duplicate webhook dispatches
const processedMsgCache = new NodeCache({ stdTTL: 86400, checkperiod: 600, maxKeys: 50000 });

/**
 * Common processor for individual incoming or synced WhatsApp messages
 */
async function processSingleMessage(socket, sessionId, rawMsg, store, isHistory = false) {
  if (!rawMsg || !rawMsg.message) return;

  // Skip status updates from self
  if (rawMsg.key?.remoteJid === 'status@broadcast' && rawMsg.key?.fromMe) return;

  // Deduplication check: prevent processing the same message twice
  const messageId = rawMsg.key?.id;
  if (messageId) {
    const dedupKey = `${sessionId}:${messageId}`;
    if (processedMsgCache.has(dedupKey)) {
      logger.debug(`[messageHandler] Skipping already-processed message: ${messageId}`);
      return;
    }
    processedMsgCache.set(dedupKey, true);
  }

  // For history-sync (offline recovered) messages, skip messages older than 7 days
  if (isHistory && rawMsg.messageTimestamp) {
    const ts = typeof rawMsg.messageTimestamp === 'object'
      ? (rawMsg.messageTimestamp?.low || rawMsg.messageTimestamp?.toNumber?.() || 0)
      : (Number(rawMsg.messageTimestamp) || 0);
    if (ts > 0) {
      const ageMs = Date.now() - (ts * 1000);
      if (ageMs > 7 * 24 * 60 * 60 * 1000) {
        logger.debug(`[messageHandler] Skipping ancient history message: ${messageId}`);
        return;
      }
    }
  }

  // Normalize into our standard payload (unwraps ephemeral, view-once, captioned documents, etc.)
  let payload = normalizeMessage(rawMsg, sessionId, store || {});
  if (!payload) {
    return;
  }

  const contentType = payload.content_type || getContentType(rawMsg.message);
  logger.info(`[messageHandler] Normalized: event=${payload.event}, type=${payload.message_type}, session=${sessionId}, chat=${payload.chat_id}${isHistory ? ' (recovered)' : ''}`);

  // Download media if present (with 15s timeout protection)
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
    `↓ ${payload.event} from ${payload.sender_name || payload.sender_number}${isHistory ? ' (offline recovered)' : ''}`
  );

  // Persist to event log
  await _saveEventLog(sessionId, 'incoming', payload);

  // Dispatch to webhook (asynchronous non-blocking queue)
  await WebhookService.dispatch(sessionId, payload);
}

/**
 * Handle `messages.upsert` – live or newly appended messages
 */
async function handleUpsert(socket, sessionId, data, store) {
  const { messages } = data || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;

  for (const rawMsg of messages) {
    try {
      await processSingleMessage(socket, sessionId, rawMsg, store, false);
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
 * Handle `messaging-history.set` – missed messages during offline / reconnecting window
 */
async function handleHistorySync(socket, sessionId, data, store) {
  const { messages, syncType } = data || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;

  logger.info(`[messageHandler.handleHistorySync] Processing ${messages.length} recovered offline messages (syncType=${syncType}) for session ${sessionId}`);

  for (const rawMsg of messages) {
    try {
      await processSingleMessage(socket, sessionId, rawMsg, store, true);
    } catch (err) {
      logger.error(`[messageHandler.handleHistorySync] Error processing recovered message:`, {
        sessionId,
        error: err.message,
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
      summary: payload.message_body || payload.text || payload.caption || payload.event || null,
      payload,
    });
  } catch (err) {
    // Non-critical - don't throw
    logger.debug('EventLog save error:', { error: err.message });
  }
}

module.exports = {
  handleUpsert,
  handleHistorySync,
  handleUpdate,
  handleDelete,
  handleReceipt,
  handleReaction,
};
