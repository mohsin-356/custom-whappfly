'use strict';

const { jidToPhone, isGroupJid, isStatusJid, isBroadcastJid } = require('./helpers');

/**
 * Normalize a raw Baileys message into the standard WhatsBridge webhook payload.
 * Every incoming event is passed through this normalizer before being forwarded.
 */
function normalizeMessage(rawMessage, sessionId, store) {
  const { key, message, messageTimestamp, pushName, participant, broadcast } = rawMessage;

  if (!key || !message) return null;

  const contentType = getContentType(message);
  if (!contentType) return null;

  const content = message[contentType] || {};

  // JID resolution
  const remoteJid = key.remoteJid;
  const isGroup = isGroupJid(remoteJid);
  const isStatus = isStatusJid(remoteJid);
  const isBroadcast = isBroadcastJid(remoteJid) && !isStatus;

  // Sender resolution
  const senderJid = isGroup
    ? (key.participant || participant || '')
    : (key.fromMe ? (store?.state?.creds?.me?.id || '') : remoteJid);

  const senderPhone = jidToPhone(senderJid);
  const senderName = pushName || store?.contacts?.[senderJid]?.name || senderPhone;

  // Group metadata
  const groupId = isGroup ? remoteJid : null;
  const groupName = store?.chats?.[remoteJid]?.name || null;

  // Message ID
  const messageId = key.id;
  const chatId = remoteJid;
  const phone = jidToPhone(isGroup ? senderJid : remoteJid);

  // Timestamp
  const ts = typeof messageTimestamp === 'object'
    ? messageTimestamp?.low || messageTimestamp?.toNumber?.() || Date.now() / 1000
    : (messageTimestamp || Date.now() / 1000);
  const timestamp = new Date(ts * 1000).toISOString();

  // Context / Quoted message
  const contextInfo = content.contextInfo || message.extendedTextMessage?.contextInfo || null;
  const quotedMessage = contextInfo?.quotedMessage
    ? normalizeQuotedMessage(contextInfo)
    : null;

  // Mentions
  const mentions = contextInfo?.mentionedJid || [];

  // Base payload
  const payload = {
    event: mapEventType(contentType),
    session_id: sessionId,
    timestamp,
    message_id: messageId,
    chat_id: chatId,
    phone,
    group_id: groupId,
    group_name: groupName,
    sender_name: senderName,
    sender_number: senderPhone,
    is_group: isGroup,
    is_broadcast: isBroadcast,
    is_status: isStatus,
    is_from_me: key.fromMe || false,
    message_type: contentType,
    quoted_message: quotedMessage,
    mentions,
    text: null,
    caption: null,
    media: null,
    mime_type: null,
    file_name: null,
    file_size: null,
    duration: null,
    width: null,
    height: null,
    thumbnail: null,
    latitude: null,
    longitude: null,
    sticker_pack: null,
    poll: null,
    reaction: null,
    contact: null,
    buttons: null,
    list: null,
    order: null,
    forwarded: contextInfo?.isForwarded || false,
    forward_score: contextInfo?.forwardingScore || 0,
    raw_event: rawMessage,
  };

  // Populate type-specific fields
  populateTypeFields(payload, contentType, content, message);

  return payload;
}

/**
 * Map Baileys content type to a human-readable event name
 */
function mapEventType(contentType) {
  const typeMap = {
    conversation: 'message.text',
    extendedTextMessage: 'message.text',
    imageMessage: 'message.image',
    videoMessage: 'message.video',
    audioMessage: 'message.audio',
    documentMessage: 'message.document',
    stickerMessage: 'message.sticker',
    contactMessage: 'message.contact',
    contactsArrayMessage: 'message.contacts',
    locationMessage: 'message.location',
    liveLocationMessage: 'message.live_location',
    pollCreationMessage: 'message.poll',
    pollUpdateMessage: 'message.poll_update',
    reactionMessage: 'message.reaction',
    protocolMessage: 'message.protocol',
    ephemeralMessage: 'message.ephemeral',
    buttonsMessage: 'message.buttons',
    buttonsResponseMessage: 'message.buttons_response',
    templateMessage: 'message.template',
    templateButtonReplyMessage: 'message.template_reply',
    listMessage: 'message.list',
    listResponseMessage: 'message.list_response',
    orderMessage: 'message.order',
    productMessage: 'message.product',
    interactiveMessage: 'message.interactive',
    interactiveResponseMessage: 'message.interactive_response',
  };
  return typeMap[contentType] || `message.${contentType}`;
}

/**
 * Populate type-specific fields on the payload
 */
function populateTypeFields(payload, contentType, content, message) {
  switch (contentType) {
    case 'conversation':
      payload.text = message.conversation || '';
      break;

    case 'extendedTextMessage':
      payload.text = content.text || '';
      if (content.matchedText) {
        payload.link_preview = {
          url: content.matchedText,
          title: content.title || null,
          description: content.description || null,
          thumbnail_url: content.jpegThumbnail
            ? `data:image/jpeg;base64,${Buffer.from(content.jpegThumbnail).toString('base64')}`
            : null,
        };
      }
      break;

    case 'imageMessage':
      payload.caption = content.caption || null;
      payload.mime_type = content.mimetype || 'image/jpeg';
      payload.file_size = content.fileLength?.low || content.fileLength || null;
      payload.width = content.width || null;
      payload.height = content.height || null;
      payload.media = {
        type: 'image',
        url: null, // Filled after download
        base64: null,
        buffer: null,
        mime: content.mimetype || 'image/jpeg',
        sha256: content.fileSha256 ? Buffer.from(content.fileSha256).toString('hex') : null,
      };
      if (content.jpegThumbnail) {
        payload.thumbnail = `data:image/jpeg;base64,${Buffer.from(content.jpegThumbnail).toString('base64')}`;
      }
      break;

    case 'videoMessage':
      payload.caption = content.caption || null;
      payload.mime_type = content.mimetype || 'video/mp4';
      payload.file_size = content.fileLength?.low || content.fileLength || null;
      payload.width = content.width || null;
      payload.height = content.height || null;
      payload.duration = content.seconds || null;
      payload.media = {
        type: 'video',
        url: null,
        base64: null,
        buffer: null,
        mime: content.mimetype || 'video/mp4',
        sha256: content.fileSha256 ? Buffer.from(content.fileSha256).toString('hex') : null,
        is_gif: content.gifPlayback || false,
      };
      if (content.jpegThumbnail) {
        payload.thumbnail = `data:image/jpeg;base64,${Buffer.from(content.jpegThumbnail).toString('base64')}`;
      }
      break;

    case 'audioMessage':
      payload.mime_type = content.mimetype || 'audio/ogg; codecs=opus';
      payload.file_size = content.fileLength?.low || content.fileLength || null;
      payload.duration = content.seconds || null;
      payload.media = {
        type: content.ptt ? 'voice_note' : 'audio',
        url: null,
        base64: null,
        buffer: null,
        mime: content.mimetype || 'audio/ogg; codecs=opus',
        ptt: content.ptt || false,
        sha256: content.fileSha256 ? Buffer.from(content.fileSha256).toString('hex') : null,
      };
      break;

    case 'documentMessage':
      payload.caption = content.caption || null;
      payload.mime_type = content.mimetype || 'application/octet-stream';
      payload.file_name = content.fileName || 'document';
      payload.file_size = content.fileLength?.low || content.fileLength || null;
      payload.media = {
        type: 'document',
        url: null,
        base64: null,
        buffer: null,
        mime: content.mimetype || 'application/octet-stream',
        file_name: content.fileName || 'document',
        sha256: content.fileSha256 ? Buffer.from(content.fileSha256).toString('hex') : null,
      };
      if (content.jpegThumbnail) {
        payload.thumbnail = `data:image/jpeg;base64,${Buffer.from(content.jpegThumbnail).toString('base64')}`;
      }
      break;

    case 'stickerMessage':
      payload.mime_type = content.mimetype || 'image/webp';
      payload.file_size = content.fileLength?.low || content.fileLength || null;
      payload.sticker_pack = {
        id: content.stickerSentTs || null,
        pack_id: content.stickerSentTs || null,
        is_animated: content.isAnimated || false,
        is_avatar: content.isAvatar || false,
      };
      payload.media = {
        type: 'sticker',
        url: null,
        base64: null,
        buffer: null,
        mime: content.mimetype || 'image/webp',
      };
      break;

    case 'contactMessage':
      payload.contact = {
        display_name: content.displayName || null,
        vcard: content.vcard || null,
      };
      break;

    case 'contactsArrayMessage':
      payload.contact = {
        contacts: (content.contacts || []).map((c) => ({
          display_name: c.displayName || null,
          vcard: c.vcard || null,
        })),
      };
      break;

    case 'locationMessage':
      payload.latitude = content.degreesLatitude || null;
      payload.longitude = content.degreesLongitude || null;
      payload.text = content.name || null;
      if (content.jpegThumbnail) {
        payload.thumbnail = `data:image/jpeg;base64,${Buffer.from(content.jpegThumbnail).toString('base64')}`;
      }
      break;

    case 'liveLocationMessage':
      payload.latitude = content.degreesLatitude || null;
      payload.longitude = content.degreesLongitude || null;
      payload.text = content.caption || null;
      payload.duration = content.timeOffset || null;
      break;

    case 'pollCreationMessage':
      payload.poll = {
        name: content.name || '',
        options: (content.options || []).map((o) => ({
          name: o.optionName || '',
        })),
        selectable_count: content.selectableOptionsCount || 1,
      };
      break;

    case 'pollUpdateMessage':
      payload.poll = {
        poll_creation_key: content.pollCreationMessageKey || null,
        votes: (content.vote?.selectedOptions || []).map((o) =>
          Buffer.from(o).toString('hex')
        ),
      };
      break;

    case 'reactionMessage':
      payload.reaction = {
        message_id: content.key?.id || null,
        emoji: content.text || '',
        is_remove: !content.text,
      };
      break;

    case 'protocolMessage':
      if (content.type === 0) {
        // Revoke / Delete
        payload.event = 'message.deleted';
        payload.deleted_message_id = content.key?.id || null;
      } else if (content.type === 14) {
        // Edit
        payload.event = 'message.edited';
        payload.edited_message_id = content.key?.id || null;
        payload.text = content.editedMessage?.conversation
          || content.editedMessage?.extendedTextMessage?.text
          || null;
      }
      break;

    case 'buttonsMessage':
      payload.text = content.contentText || null;
      payload.caption = content.headerText || null;
      payload.buttons = (content.buttons || []).map((b) => ({
        id: b.buttonId || null,
        text: b.buttonText?.displayText || null,
        type: b.type || 0,
      }));
      break;

    case 'buttonsResponseMessage':
      payload.text = content.selectedDisplayText || null;
      payload.buttons = [{
        id: content.selectedButtonId || null,
        text: content.selectedDisplayText || null,
      }];
      break;

    case 'templateMessage':
      payload.text = content.hydratedTemplate?.hydratedContentText || null;
      break;

    case 'templateButtonReplyMessage':
      payload.text = content.selectedDisplayText || null;
      payload.buttons = [{ id: content.selectedId || null, text: content.selectedDisplayText || null }];
      break;

    case 'listMessage':
      payload.text = content.description || null;
      payload.caption = content.title || null;
      payload.list = {
        title: content.title || null,
        button_text: content.buttonText || null,
        sections: (content.sections || []).map((s) => ({
          title: s.title || null,
          rows: (s.rows || []).map((r) => ({
            row_id: r.rowId || null,
            title: r.title || null,
            description: r.description || null,
          })),
        })),
      };
      break;

    case 'listResponseMessage':
      payload.text = content.title || null;
      payload.list = {
        row_id: content.singleSelectReply?.selectedRowId || null,
        title: content.title || null,
        description: content.description || null,
      };
      break;

    default:
      // Unknown type - include raw content
      payload.raw_content = content;
      break;
  }
}

/**
 * Normalize a quoted/replied-to message context
 */
function normalizeQuotedMessage(contextInfo) {
  if (!contextInfo?.quotedMessage) return null;

  const quotedContentType = getContentType(contextInfo.quotedMessage);
  const quotedContent = quotedContentType
    ? contextInfo.quotedMessage[quotedContentType]
    : {};

  return {
    message_id: contextInfo.stanzaId || null,
    sender: contextInfo.participant || null,
    type: quotedContentType || null,
    text: quotedContent?.text
      || quotedContent?.caption
      || contextInfo.quotedMessage?.conversation
      || null,
  };
}

/**
 * Normalize a group update event
 */
function normalizeGroupUpdate(sessionId, update) {
  return {
    event: 'group.update',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    group_id: update.id || null,
    group_name: update.subject || null,
    description: update.desc || null,
    restrict: update.restrict || null,
    announce: update.announce || null,
    subject_time: update.subjectTime || null,
    subject_owner: update.subjectOwner || null,
    raw_event: update,
  };
}

/**
 * Normalize group participants update
 */
function normalizeGroupParticipantsUpdate(sessionId, update) {
  return {
    event: `group.participants.${update.action}`,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    group_id: update.id || null,
    action: update.action || null,
    participants: update.participants || [],
    raw_event: update,
  };
}

/**
 * Normalize a call event
 */
function normalizeCallEvent(sessionId, call) {
  return {
    event: 'call',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    call_id: call.id || null,
    from: call.from || null,
    from_phone: jidToPhone(call.from),
    is_video: call.isVideo || false,
    is_group: call.isGroup || false,
    status: call.status || null,
    raw_event: call,
  };
}

/**
 * Normalize a message receipt/read update
 */
function normalizeReceiptUpdate(sessionId, receipt) {
  return {
    event: 'message.receipt',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    message_id: receipt.key?.id || null,
    chat_id: receipt.key?.remoteJid || null,
    receipt_type: receipt.receipt?.receiptTimestamp ? 'read' : 'delivered',
    raw_event: receipt,
  };
}

/**
 * Safely determine the content type of a Baileys message
 * Mirrors Baileys' getContentType but with safe null handling
 */
function getContentType(message) {
  if (!message) return undefined;

  const keys = Object.keys(message);
  const ignoredKeys = new Set([
    'messageContextInfo', 'senderKeyDistributionMessage',
    'messageStubType', 'messageStubParameters',
    'clearChatMessage', 'peerDataOperationRequestMessage',
    'peerDataOperationResponseMessage', 'requestPaymentMessage',
    'sendPaymentMessage', 'receiptMessage',
  ]);

  for (const key of keys) {
    if (!ignoredKeys.has(key) && message[key]) {
      return key;
    }
  }
  return undefined;
}

module.exports = {
  normalizeMessage,
  normalizeGroupUpdate,
  normalizeGroupParticipantsUpdate,
  normalizeCallEvent,
  normalizeReceiptUpdate,
  getContentType,
  mapEventType,
};
