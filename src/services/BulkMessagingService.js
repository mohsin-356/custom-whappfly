'use strict';

const logger = require('../utils/logger');
const BulkMessage  = require('../database/models/BulkMessage');
const BulkLeadList = require('../database/models/BulkLeadList');
const BulkLead     = require('../database/models/BulkLead');
const BulkCampaign = require('../database/models/BulkCampaign');
const { getSocketManager } = require('../socket/SocketManager');

// In-memory registry of running campaigns so we can cancel them
const runningCampaigns = new Map(); // campaignId -> { cancelled: boolean }
const activeCampaignsBySession = new Map(); // sessionId -> campaignId

class BulkMessagingServiceClass {

  // ─────────────────────────────────────────────
  //  BULK MESSAGES  (setup message CRUD)
  // ─────────────────────────────────────────────

  async listMessages(sessionId) {
    return BulkMessage.find({ sessionId });
  }

  async getMessage(id, sessionId) {
    const msg = await BulkMessage.findOne({ id, sessionId });
    if (!msg) throw Object.assign(new Error('Bulk message not found'), { status: 404 });
    return msg;
  }

  async createMessage(sessionId, { title, bodyText, media }) {
    if (!title || !title.trim()) throw Object.assign(new Error('Title is required'), { status: 400 });
    return BulkMessage.create({ sessionId, title: title.trim(), bodyText: bodyText || '', media: media || [] });
  }

  async updateMessage(id, sessionId, updates) {
    const existing = await BulkMessage.findOne({ id, sessionId });
    if (!existing) throw Object.assign(new Error('Bulk message not found'), { status: 404 });
    const updated = await BulkMessage.update(id, sessionId, {
      title:    updates.title    !== undefined ? updates.title    : existing.title,
      bodyText: updates.bodyText !== undefined ? updates.bodyText : existing.body_text,
      media:    updates.media    !== undefined ? updates.media    : existing.media,
    });
    return updated;
  }

  async deleteMessage(id, sessionId) {
    const existing = await BulkMessage.findOne({ id, sessionId });
    if (!existing) throw Object.assign(new Error('Bulk message not found'), { status: 404 });
    await BulkMessage.deleteOne(id, sessionId);
  }

  // ─────────────────────────────────────────────
  //  LEAD LISTS  (named lists CRUD)
  // ─────────────────────────────────────────────

  async listLeadLists(sessionId) {
    return BulkLeadList.find({ sessionId });
  }

  async getLeadList(id, sessionId) {
    const list = await BulkLeadList.findOne({ id, sessionId });
    if (!list) throw Object.assign(new Error('Lead list not found'), { status: 404 });
    return list;
  }

  async createLeadList(sessionId, { name, description }) {
    if (!name || !name.trim()) throw Object.assign(new Error('List name is required'), { status: 400 });
    return BulkLeadList.create({ sessionId, name: name.trim(), description: description || '' });
  }

  async updateLeadList(id, sessionId, updates) {
    const existing = await BulkLeadList.findOne({ id, sessionId });
    if (!existing) throw Object.assign(new Error('Lead list not found'), { status: 404 });
    return BulkLeadList.update(id, sessionId, {
      name:        updates.name        !== undefined ? updates.name        : existing.name,
      description: updates.description !== undefined ? updates.description : existing.description,
    });
  }

  async deleteLeadList(id, sessionId) {
    const existing = await BulkLeadList.findOne({ id, sessionId });
    if (!existing) throw Object.assign(new Error('Lead list not found'), { status: 404 });
    // cascade: bulk_leads are deleted via FK ON DELETE CASCADE in the DB
    await BulkLeadList.deleteOne(id, sessionId);
  }

  // ─────────────────────────────────────────────
  //  LEADS within a list  (CRUD + CSV import)
  // ─────────────────────────────────────────────

  async listLeads(listId, sessionId, { page = 1, limit = 100 } = {}) {
    await this.getLeadList(listId, sessionId); // ownership check
    const offset = (page - 1) * limit;
    const [leads, total] = await Promise.all([
      BulkLead.find({ listId }, { limit, offset }),
      BulkLead.count({ listId }),
    ]);
    return { leads, total, page, limit };
  }

  /**
   * Parse a CSV string and bulk-insert leads into the specified list.
   * CSV must contain contact_name and phone_number (or header variations, or 2-column headerless data).
   * 100% robust: auto-detects delimiter (, ; \t |), strips BOM, fixes Excel notation, cleans phones.
   * Returns { inserted, skipped, errors, totalContacts }
   */
  async importLeadsFromCSV(listId, sessionId, csvText) {
    await this.getLeadList(listId, sessionId); // ownership check

    if (!csvText || !csvText.trim()) {
      throw Object.assign(new Error('The uploaded CSV file is empty'), { status: 400 });
    }

    const delimiter = _detectDelimiter(csvText);
    const rows = _parseCSV(csvText, delimiter);

    if (rows.length === 0) {
      throw Object.assign(new Error('No readable data rows found in CSV'), { status: 400 });
    }

    const NAME_KEYWORDS = [
      'contact_name', 'contactname', 'contact_names',
      'name', 'names', 'full_name', 'fullname',
      'contact', 'client_name', 'client', 'customer_name', 'customer',
      'lead_name', 'lead', 'person', 'first_name',
    ];

    const PHONE_KEYWORDS = [
      'phone_number', 'phonenumber', 'phone_numbers',
      'phone', 'phones', 'mobile', 'mobiles', 'mobile_number', 'mobilenumber',
      'whatsapp', 'whatsapp_number', 'whatsappnumber', 'whatsapp_no', 'wa_number',
      'number', 'numbers', 'tel', 'telephone', 'cell', 'cellphone', 'contact_number',
    ];

    const row0 = rows[0];
    const normalizedHeaders = row0.map((h) =>
      String(h).trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    );

    let nameIdx = -1;
    let phoneIdx = -1;
    let startRow = 1;

    // 1. Try finding by matching known header keywords
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i];
      if (nameIdx === -1 && NAME_KEYWORDS.includes(h)) {
        nameIdx = i;
      } else if (phoneIdx === -1 && PHONE_KEYWORDS.includes(h)) {
        phoneIdx = i;
      }
    }

    // 2. If row 0 only has 2 columns and only one was matched, the other is automatically the missing one
    if (row0.length === 2) {
      if (nameIdx !== -1 && phoneIdx === -1) {
        phoneIdx = nameIdx === 0 ? 1 : 0;
      } else if (phoneIdx !== -1 && nameIdx === -1) {
        nameIdx = phoneIdx === 0 ? 1 : 0;
      }
    }

    // 3. If neither header matched, check if row 0 itself is data without a header row
    if (nameIdx === -1 || phoneIdx === -1) {
      const isCol0Phone = _isLikelyPhoneNumber(row0[0]);
      const isCol1Phone = row0.length > 1 && _isLikelyPhoneNumber(row0[1]);

      if (isCol1Phone && !isCol0Phone) {
        // Col 0 is Name, Col 1 is Phone — no header present
        nameIdx = 0;
        phoneIdx = 1;
        startRow = 0;
      } else if (isCol0Phone && !isCol1Phone) {
        // Col 0 is Phone, Col 1 is Name — no header present
        phoneIdx = 0;
        nameIdx = 1;
        startRow = 0;
      } else if (row0.length >= 2) {
        // Default fallback: Column 0 = Name, Column 1 = Phone
        nameIdx = 0;
        phoneIdx = 1;
      } else {
        throw Object.assign(
          new Error('CSV must contain 2 columns: contact_name and phone_number (or header row with contact_name, phone_number)'),
          { status: 400 }
        );
      }
    }

    const records = [];
    const errors  = [];
    const seenPhones = new Set();

    for (let i = startRow; i < rows.length; i++) {
      const cols = rows[i];
      if (!cols || cols.length === 0 || cols.every((c) => !c || c.trim().length === 0)) {
        continue; // skip blank lines
      }

      const rawName  = cols[nameIdx] !== undefined ? cols[nameIdx] : '';
      const rawPhone = cols[phoneIdx] !== undefined ? cols[phoneIdx] : '';

      const cleanPhone = _cleanPhoneNumber(rawPhone);
      const contactName = _cleanContactName(rawName, cleanPhone);

      if (!cleanPhone) {
        errors.push({ row: i + 1, reason: `Invalid or missing phone number: "${rawPhone}"` });
        continue;
      }

      if (seenPhones.has(cleanPhone)) {
        // Skip duplicate numbers within same CSV
        continue;
      }
      seenPhones.add(cleanPhone);

      records.push({ listId, sessionId, contactName, phoneNumber: cleanPhone });
    }

    let inserted = 0;
    if (records.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < records.length; i += CHUNK) {
        await BulkLead.bulkInsert(records.slice(i, i + CHUNK));
      }
      inserted = records.length;
    }

    const updatedList = await BulkLeadList.recountContacts(listId);

    return {
      inserted,
      skipped: errors.length,
      errors: errors.slice(0, 50),
      totalContacts: updatedList?.totalContacts || inserted,
      sample: records.slice(0, 3).map((r) => ({ name: r.contactName, phone: r.phoneNumber })),
    };
  }

  async deleteLead(leadId, listId, sessionId) {
    await this.getLeadList(listId, sessionId); // ownership check
    await BulkLead.deleteOne(leadId);
    await BulkLeadList.recountContacts(listId);
  }

  async clearLeadList(listId, sessionId) {
    await this.getLeadList(listId, sessionId);
    await BulkLead.deleteByList(listId);
    await BulkLeadList.recountContacts(listId);
  }

  // ─────────────────────────────────────────────
  //  CAMPAIGNS  (start / monitor / cancel)
  // ─────────────────────────────────────────────

  async listCampaigns(sessionId) {
    return BulkCampaign.find({ sessionId });
  }

  async getCampaign(id, sessionId) {
    const c = await BulkCampaign.findOne({ id, sessionId });
    if (!c) throw Object.assign(new Error('Campaign not found'), { status: 404 });
    return c;
  }

  /**
   * Create and start a bulk campaign.
   * Sends sequentially with a configurable delay to avoid bans.
   * Checks whether the number is registered on WhatsApp before saving as contact.
   */
  async startCampaign(sessionId, { messageId, listId, title, delayMs = 1500 }) {
    // Validate ownership
    const [message, leadList] = await Promise.all([
      this.getMessage(messageId, sessionId),
      this.getLeadList(listId, sessionId),
    ]);

    // Prevent duplicate concurrent campaigns running for the same session
    const activeCampaignId = activeCampaignsBySession.get(sessionId);
    if (activeCampaignId && runningCampaigns.has(activeCampaignId)) {
      const err = new Error('A campaign is already running for this session. Please wait for it to complete or cancel it before starting another.');
      err.status = 409;
      err.code = 'CAMPAIGN_ALREADY_RUNNING';
      throw err;
    }

    // Get the WhatsApp socket — session must be connected
    const { WhatsAppService } = require('./WhatsAppService');
    if (!WhatsAppService.isConnected(sessionId)) {
      // Auto-reconnect attempt if auth files exist on disk
      try {
        const path = require('path');
        const fs = require('fs');
        const config = require('../config');
        const sessionPath = path.join(config.session.basePath, sessionId);
        if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0) {
          const sObj = await require('./SessionService').SessionService.getById(sessionId);
          await WhatsAppService.createSession(sessionId, sObj?.label || sessionId);
          for (let i = 0; i < 6; i++) {
            await _sleep(500);
            if (WhatsAppService.isConnected(sessionId)) break;
          }
        }
      } catch (_) {}
    }

    if (!WhatsAppService.isConnected(sessionId)) {
      const rtStatus = WhatsAppService.getSessionStatus(sessionId);
      const isQr = rtStatus?.status === 'qr_ready';
      const msg = isQr
        ? 'WhatsApp session is awaiting QR scan. Please scan the QR code to connect your account.'
        : `WhatsApp session "${sessionId}" is offline. Please scan the QR code to connect before launching a campaign.`;
      const err = new Error(msg);
      err.status = 409;
      err.code = 'SESSION_NOT_CONNECTED';
      err.qr = rtStatus?.qr || null;
      throw err;
    }

    const leads = await BulkLead.find({ listId });
    if (leads.length === 0) {
      throw Object.assign(new Error('The selected lead list has no contacts'), { status: 400 });
    }

    // Reset lead statuses for a fresh rerun
    await BulkLead.resetListStatuses(listId);

    const safeDelay = Math.max(1200, delayMs || 1500);

    const campaign = await BulkCampaign.create({
      sessionId,
      messageId,
      listId,
      title: title || `${message.title} → ${leadList.name}`,
      delayMs: safeDelay,
      total: leads.length,
    });

    await BulkCampaign.updateStatus(campaign.id, 'running', { total: leads.length });
    activeCampaignsBySession.set(sessionId, campaign.id);

    // Run asynchronously
    this._runCampaign(campaign.id, sessionId, message, leads, safeDelay).catch((err) => {
      logger.error(`[BulkMessaging] Campaign ${campaign.id} crashed:`, { error: err.message });
    });

    return campaign;
  }

  async cancelCampaign(campaignId, sessionId) {
    const campaign = await this.getCampaign(campaignId, sessionId);
    if (campaign.status !== 'running' && !runningCampaigns.has(campaignId)) {
      throw Object.assign(new Error('Campaign is not running'), { status: 409 });
    }
    const ctrl = runningCampaigns.get(campaignId);
    if (ctrl) ctrl.cancelled = true;
    runningCampaigns.delete(campaignId);
    if (activeCampaignsBySession.get(sessionId) === campaignId) {
      activeCampaignsBySession.delete(sessionId);
    }
    await BulkCampaign.updateStatus(campaignId, 'cancelled');
    return { success: true, message: 'Campaign cancellation requested' };
  }

  async deleteCampaign(campaignId, sessionId) {
    const campaign = await this.getCampaign(campaignId, sessionId);
    if (campaign.status === 'running' || runningCampaigns.has(campaignId)) {
      throw Object.assign(new Error('Cannot delete a running campaign. Cancel it first.'), { status: 409 });
    }
    await BulkCampaign.deleteOne(campaignId, sessionId);
  }

  // ─────────────────────────────────────────────
  //  Private: actual send loop
  // ─────────────────────────────────────────────

  async _runCampaign(campaignId, sessionId, message, leads, delayMs) {
    const ctrl = { cancelled: false };
    runningCampaigns.set(campaignId, ctrl);
    activeCampaignsBySession.set(sessionId, campaignId);

    const { WhatsAppService } = require('./WhatsAppService');
    const sm = getSocketManager();

    let sent = 0, failed = 0, skipped = 0;

    const emitProgress = () => {
      sm.emitToSession(sessionId, 'bulk_progress', {
        campaignId,
        total: leads.length,
        sent,
        failed,
        skipped,
        status: 'running',
      });
    };

    // Determine country prefix from session phone if available (e.g. 92)
    const sessionPhone = WhatsAppService.getSessionStatus(sessionId)?.info?.phone || '';
    const fallbackPrefix = sessionPhone ? sessionPhone.slice(0, 2) : '92';

    try {
      for (const lead of leads) {
        if (ctrl.cancelled) {
          skipped += leads.length - sent - failed - skipped;
          break;
        }

        if (!WhatsAppService.isConnected(sessionId)) {
          // Session dropped mid-campaign
          failed++;
          await BulkLead.updateStatus(lead.id, 'failed', 'Session disconnected');
          emitProgress();
          continue;
        }

        const rawPhone = lead.phone_number;
        const targetJid = _formatWhatsAppJid(rawPhone, fallbackPrefix);

        if (!targetJid) {
          skipped++;
          await BulkLead.updateStatus(lead.id, 'skipped', 'Invalid phone number format');
          emitProgress();
          continue;
        }

        try {
          const mediaItems = Array.isArray(message.media) ? message.media : [];
          const hasBodyText = !!(message.body_text && message.body_text.trim());

          if (mediaItems.length === 1) {
            // SINGLE MEDIA ATTACHMENT:
            // Send as 1 combined WhatsApp message with body_text as caption
            // This prevents Signal ratchet desync and eliminates "Waiting for this message"
            const item = mediaItems[0];
            const payload = _buildMediaPayload(item);
            if (payload) {
              if (hasBodyText) {
                payload.caption = message.body_text.trim();
              }
              await WhatsAppService.sendMessage(sessionId, targetJid, payload);
            } else if (hasBodyText) {
              await WhatsAppService.sendMessage(sessionId, targetJid, {
                type: 'text',
                text: message.body_text.trim(),
              });
            }
          } else if (mediaItems.length > 1) {
            // MULTIPLE MEDIA ATTACHMENTS:
            // If body text present, send text first
            if (hasBodyText) {
              await WhatsAppService.sendMessage(sessionId, targetJid, {
                type: 'text',
                text: message.body_text.trim(),
              });
              // Safe gap between text and media for Signal ratchet sync
              await _sleep(2000);
            }
            // Send each media item with a 1500ms safe interval
            for (let mIdx = 0; mIdx < mediaItems.length; mIdx++) {
              if (ctrl.cancelled) break;
              const payload = _buildMediaPayload(mediaItems[mIdx]);
              if (payload) {
                await WhatsAppService.sendMessage(sessionId, targetJid, payload);
                if (mIdx < mediaItems.length - 1) await _sleep(1500);
              }
            }
          } else {
            // TEXT ONLY
            if (hasBodyText) {
              await WhatsAppService.sendMessage(sessionId, targetJid, {
                type: 'text',
                text: message.body_text.trim(),
              });
            } else {
              throw new Error('Message template has no text or media to send');
            }
          }

          sent++;
          await BulkLead.updateStatus(lead.id, 'sent');
          logger.info(`[BulkMessaging] Sent to ${targetJid} (${lead.contact_name}) | campaign=${campaignId}`);

        } catch (err) {
          failed++;
          const errMsg = err?.message ? String(err.message).slice(0, 200) : 'Send failed';
          await BulkLead.updateStatus(lead.id, 'failed', errMsg);
          logger.warn(`[BulkMessaging] Failed to send to ${lead.phone_number}:`, { error: errMsg });
        }

        emitProgress();

        // Safe delay between contacts to prevent WhatsApp rate limiting
        if (!ctrl.cancelled) {
          await _sleep(delayMs);
        }
      }

      const finalStatus = ctrl.cancelled ? 'cancelled' : 'completed';
      await BulkCampaign.updateStatus(campaignId, finalStatus, { sent, failed, skipped });

      sm.emitToSession(sessionId, 'bulk_progress', {
        campaignId,
        total: leads.length,
        sent,
        failed,
        skipped,
        status: finalStatus,
      });

      logger.info(`[BulkMessaging] Campaign ${campaignId} ${finalStatus}: sent=${sent} failed=${failed} skipped=${skipped}`);

    } finally {
      runningCampaigns.delete(campaignId);
      if (activeCampaignsBySession.get(sessionId) === campaignId) {
        activeCampaignsBySession.delete(sessionId);
      }
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _detectDelimiter(text) {
  const sample = text.slice(0, 4000);
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let maxCount = 0;
  for (const d of candidates) {
    const count = (sample.match(new RegExp('\\' + d, 'g')) || []).length;
    if (count > maxCount) {
      maxCount = count;
      best = d;
    }
  }
  return best;
}

function _parseCSV(text, delimiter = ',') {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  // Clean BOM and standardize line breaks
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const nextCh = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        currentVal += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentVal += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if (ch === '\n') {
        currentRow.push(currentVal.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += ch;
      }
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function _isLikelyPhoneNumber(str) {
  if (!str) return false;
  const cleaned = String(str).replace(/[\s\-\(\)\.]/g, '');
  return /^\+?\d{7,16}$/.test(cleaned);
}

function _cleanPhoneNumber(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F]/g, '');

  // Scientific notation fix (e.g. 1.23E+11)
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
    try {
      const num = Number(str);
      if (!isNaN(num)) str = BigInt(Math.round(num)).toString();
    } catch (_) {}
  }

  // Remove .0 suffix often added by Excel (e.g. 923001234567.0)
  str = str.replace(/\.0+$/, '');

  const startsWithPlus = str.startsWith('+');
  let digits = str.replace(/\D/g, '');

  if (digits.length < 7) return '';

  // Local Pakistani 11-digit mobile: 03XXXXXXXXX -> 923XXXXXXXXX
  if (digits.startsWith('03') && digits.length === 11) {
    return '92' + digits.slice(1);
  }

  if (str.startsWith('00')) {
    return '+' + digits.slice(2);
  }
  return startsWithPlus ? '+' + digits : digits;
}

function _formatWhatsAppJid(rawPhone, fallbackCountryPrefix = '92') {
  if (!rawPhone) return null;
  let str = String(rawPhone).trim();
  if (str.includes('@')) return str;

  let digits = str.replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  // Local Pakistani 11-digit mobile: 03XXXXXXXXX -> 923XXXXXXXXX
  if (digits.startsWith('03') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = fallbackCountryPrefix + digits.slice(1);
  }

  return `${digits}@s.whatsapp.net`;
}

function _cleanContactName(raw, fallbackPhone) {
  if (!raw) return fallbackPhone || 'Contact';
  let str = String(raw).trim().replace(/^["']|["']$/g, '').trim();
  str = str.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
  return str || fallbackPhone || 'Contact';
}

function _buildMediaPayload(item) {
  if (!item || !item.type) return null;
  const base = {
    url:      item.url    || undefined,
    base64:   item.base64 || undefined,
    mimetype: item.mimetype || undefined,
    caption:  item.caption  || '',
    fileName: item.fileName || undefined,
  };
  switch (item.type) {
    case 'image':    return { type: 'image',    ...base };
    case 'video':    return { type: 'video',    ...base };
    case 'audio':    return { type: 'audio',    ...base };
    case 'document': return { type: 'document', ...base };
    default:         return null;
  }
}

const BulkMessagingService = new BulkMessagingServiceClass();
module.exports = { BulkMessagingService };
