'use strict';

const logger = require('../utils/logger');
const { getSocketManager } = require('../socket/SocketManager');
const { WebhookService } = require('../services/WebhookService');
const { normalizeGroupUpdate, normalizeGroupParticipantsUpdate } = require('../utils/payloadNormalizer');
const EventLog = require('../database/models/EventLog');

/**
 * Handle `groups.update` – group subject, description, icon changes
 */
async function handleGroupUpdate(socket, sessionId, updates) {
  for (const update of updates) {
    try {
      const payload = normalizeGroupUpdate(sessionId, update);

      getSocketManager().incrementIncoming(sessionId);
      getSocketManager().emitToSession(sessionId, 'group.update', {
        sessionId,
        groupId: payload.group_id,
        groupName: payload.group_name,
      });
      getSocketManager().streamLog(
        sessionId,
        'info',
        `↓ group.update for ${payload.group_name || payload.group_id}`
      );

      await _saveEventLog(sessionId, payload);
      await WebhookService.dispatch(sessionId, payload);
    } catch (err) {
      logger.error('[groupHandler.handleGroupUpdate] Error:', { error: err.message });
    }
  }
}

/**
 * Handle `group-participants.update` – add/remove/promote/demote
 */
async function handleParticipantsUpdate(socket, sessionId, update) {
  try {
    const payload = normalizeGroupParticipantsUpdate(sessionId, update);

    getSocketManager().incrementIncoming(sessionId);
    getSocketManager().emitToSession(sessionId, 'group.participants.update', {
      sessionId,
      groupId: payload.group_id,
      action: payload.action,
      participants: payload.participants,
    });
    getSocketManager().streamLog(
      sessionId,
      'info',
      `↓ group.participants.${payload.action} in ${payload.group_id}`
    );

    await _saveEventLog(sessionId, payload);
    await WebhookService.dispatch(sessionId, payload);
  } catch (err) {
    logger.error('[groupHandler.handleParticipantsUpdate] Error:', { error: err.message });
  }
}

async function _saveEventLog(sessionId, payload) {
  try {
    await EventLog.create({
      sessionId,
      direction: 'incoming',
      eventType: payload.event || 'group.event',
      chatId: payload.group_id || null,
      isGroup: true,
      summary: payload.event || null,
      payload,
    });
  } catch (_) {}
}

module.exports = { handleGroupUpdate, handleParticipantsUpdate };
