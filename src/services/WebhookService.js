'use strict';

const axios = require('axios');
const Webhook = require('../database/models/Webhook');
const WebhookLog = require('../database/models/WebhookLog');
const config = require('../config');
const logger = require('../utils/logger');
const { generateWebhookSignature } = require('../utils/crypto');
const { retryWithBackoff } = require('../utils/retry');
const { getSocketManager } = require('../socket/SocketManager');

class WebhookServiceClass {
  /**
   * Dispatch a normalized event payload to the configured webhook for a session.
   * This is the primary entry point called from event handlers.
   */
  async dispatch(sessionId, payload) {
    try {
      const webhook = await Webhook.findOne({ sessionId, enabled: true });
      if (!webhook) return;

      const url = webhook.getActiveUrl();
      if (!url) return;

      // Apply event filter if configured
      if (webhook.eventFilters && webhook.eventFilters.length > 0) {
        if (!webhook.eventFilters.includes(payload.event)) return;
      }

      // Strip raw_event from payload to keep webhook payload clean (raw_event is huge)
      const cleanPayload = { ...payload };
      delete cleanPayload.raw_event;

      await this.send(sessionId, url, cleanPayload, {
        webhookDoc: webhook,
      });
    } catch (err) {
      logger.error(`[WebhookService] dispatch error for session ${sessionId}:`, {
        error: err.message,
      });
    }
  }

  /**
   * Send a payload to a specific URL with retry logic.
   * Can be called directly or from QueueService.
   */
  async send(sessionId, url, payload, opts = {}) {
    const webhookDoc = opts.webhookDoc || (await Webhook.findOne({ sessionId }));
    const timeoutMs = webhookDoc?.timeoutMs || config.webhook.timeout;
    const maxRetries = webhookDoc?.maxRetries || config.webhook.maxRetries;
    const secret = webhookDoc?.secret || config.webhook.secret;
    const customHeaders = webhookDoc?.headers || {};

    const bodyStr = JSON.stringify(payload);
    const signature = generateWebhookSignature(bodyStr, secret);

    const headers = {
      'Content-Type': 'application/json',
      'X-WhatsBridge-Signature': signature,
      'X-WhatsBridge-Session': sessionId,
      'X-WhatsBridge-Event': payload.event || 'unknown',
      'X-WhatsBridge-Timestamp': new Date().toISOString(),
      ...customHeaders,
    };

    let statusCode = null;
    let responseBody = null;
    let responseTime = null;
    let lastError = null;
    let attempts = 0;

    const startTime = Date.now();

    try {
      const result = await retryWithBackoff(
        async (attempt) => {
          attempts = attempt;
          const t0 = Date.now();
          const response = await axios.post(url, payload, {
            headers,
            timeout: timeoutMs,
            validateStatus: (s) => s < 500, // treat 4xx as successful delivery
          });
          responseTime = Date.now() - t0;
          statusCode = response.status;
          responseBody = typeof response.data === 'object'
            ? JSON.stringify(response.data)
            : String(response.data || '');
          return response;
        },
        {
          maxAttempts: maxRetries,
          baseDelay: config.webhook.retryDelay,
          shouldRetry: (err) => {
            // Retry on network errors and 5xx responses
            if (err.response) return err.response.status >= 500;
            return true; // network error
          },
        }
      );

      // Update webhook stats
      await Webhook.updateOne(
        { sessionId },
        {
          $inc: { totalSent: 1 },
          $set: { lastCalledAt: new Date(), lastSuccessAt: new Date() },
        }
      );

      getSocketManager().incrementWebhookSent(sessionId);

      // Log success
      await this._saveLog(sessionId, url, payload.event || 'unknown', payload, {
        statusCode,
        responseBody,
        responseTime: responseTime || (Date.now() - startTime),
        success: true,
        attempts,
      });

      // Process webhook response (e.g. send a reply message back to WhatsApp)
      await this._processWebhookResponse(sessionId, result.data, payload);

      logger.debug(`[WebhookService] Delivered event "${payload.event}" to ${url} (${statusCode})`);

    } catch (err) {
      lastError = err.message;
      statusCode = err.response?.status || null;
      responseTime = Date.now() - startTime;

      await Webhook.updateOne(
        { sessionId },
        {
          $inc: { totalFailed: 1 },
          $set: { lastCalledAt: new Date(), lastFailedAt: new Date() },
        }
      );

      getSocketManager().incrementWebhookFailed(sessionId);

      await this._saveLog(sessionId, url, payload.event || 'unknown', payload, {
        statusCode,
        responseBody,
        responseTime,
        success: false,
        attempts,
        error: lastError,
      });

      logger.error(`[WebhookService] Failed to deliver event "${payload.event}" to ${url}:`, {
        error: lastError,
        attempts,
      });
    }
  }

  /**
   * Process an optional webhook response to send messages back to WhatsApp
   */
  async _processWebhookResponse(sessionId, responseData, originalPayload) {
    if (!responseData || typeof responseData !== 'object') return;
    if (!responseData.type) return;

    try {
      const { WhatsAppService } = require('./WhatsAppService');
      const to = originalPayload.chat_id;
      if (!to) return;

      await WhatsAppService.sendMessage(sessionId, to, responseData);

      getSocketManager().incrementOutgoing(sessionId);

      logger.debug(`[WebhookService] Sent webhook response message to ${to}`);
    } catch (err) {
      logger.error('[WebhookService] Failed to process webhook response:', {
        error: err.message,
      });
    }
  }

  /**
   * Save a webhook delivery attempt to the log collection
   */
  async _saveLog(sessionId, url, eventType, payload, result) {
    try {
      await WebhookLog.create({
        sessionId,
        webhookUrl: url,
        eventType,
        payload,
        statusCode: result.statusCode,
        responseBody: result.responseBody ? result.responseBody.slice(0, 2000) : null,
        responseTime: result.responseTime,
        success: result.success,
        attempts: result.attempts,
        error: result.error || null,
      });
    } catch (err) {
      logger.error('Failed to save webhook log:', { error: err.message });
    }
  }

  /**
   * Get or create the webhook config for a session
   */
  async getOrCreate(sessionId) {
    let webhook = await Webhook.findOne({ sessionId });
    if (!webhook) {
      webhook = await Webhook.create({ sessionId });
    }
    return webhook;
  }

  /**
   * Test a webhook URL by sending a test payload
   */
  async test(sessionId, url) {
    const testPayload = {
      event: 'webhook.test',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      message: 'WhatsBridge webhook test - connection successful!',
    };

    const startTime = Date.now();
    try {
      const response = await axios.post(url, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-WhatsBridge-Event': 'webhook.test',
        },
        timeout: 10000,
        validateStatus: () => true,
      });

      return {
        success: response.status < 400,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
        message: response.status < 400 ? 'Webhook reachable' : `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        success: false,
        statusCode: null,
        responseTime: Date.now() - startTime,
        message: err.message,
      };
    }
  }

  /**
   * Get webhook logs for a session
   */
  async getLogs(sessionId, filters = {}) {
    const query = { sessionId };
    if (filters.success !== undefined) query.success = filters.success;
    if (filters.eventType) query.eventType = filters.eventType;

    const page = parseInt(filters.page || 1, 10);
    const limit = Math.min(parseInt(filters.limit || 50, 10), 200);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      WebhookLog.find(query).sort({ triggeredAt: -1 }).skip(skip).limit(limit),
      WebhookLog.countDocuments(query),
    ]);

    return { logs, total, page, limit };
  }
}

const WebhookService = new WebhookServiceClass();
module.exports = { WebhookService };
