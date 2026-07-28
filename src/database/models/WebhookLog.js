'use strict';

const mongoose = require('mongoose');

const WebhookLogSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    webhookUrl: {
      type: String,
      required: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    statusCode: {
      type: Number,
      default: null,
    },
    responseBody: {
      type: String,
      default: null,
    },
    responseTime: {
      type: Number, // ms
      default: null,
    },
    success: {
      type: Boolean,
      default: false,
      index: true,
    },
    attempts: {
      type: Number,
      default: 1,
    },
    error: {
      type: String,
      default: null,
    },
    triggeredAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'webhook_logs',
    // TTL index - auto-delete logs after 30 days
    timestamps: true,
  }
);

WebhookLogSchema.index({ sessionId: 1, triggeredAt: -1 });
WebhookLogSchema.index({ success: 1, triggeredAt: -1 });
// TTL: remove logs older than 30 days
WebhookLogSchema.index({ triggeredAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('WebhookLog', WebhookLogSchema);
