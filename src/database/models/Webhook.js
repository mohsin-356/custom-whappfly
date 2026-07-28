'use strict';

const mongoose = require('mongoose');

const WebhookSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ['testing', 'production'],
      default: 'testing',
    },
    testUrl: {
      type: String,
      default: null,
    },
    productionUrl: {
      type: String,
      default: null,
    },
    activeUrl: {
      type: String,
      default: null,
    },
    secret: {
      type: String,
      default: null,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    // Event filters - which event types to forward (empty = all)
    eventFilters: {
      type: [String],
      default: [],
    },
    // Custom headers to include in webhook requests
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Retry configuration
    maxRetries: {
      type: Number,
      default: 3,
    },
    retryDelay: {
      type: Number,
      default: 5000,
    },
    timeoutMs: {
      type: Number,
      default: 30000,
    },
    // Stats
    totalSent: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
    lastCalledAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastFailedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'webhooks',
  }
);

WebhookSchema.index({ sessionId: 1 }, { unique: true });

WebhookSchema.methods.getActiveUrl = function () {
  return this.mode === 'production' ? this.productionUrl : this.testUrl;
};

WebhookSchema.methods.toPublic = function () {
  return {
    sessionId: this.sessionId,
    mode: this.mode,
    testUrl: this.testUrl,
    productionUrl: this.productionUrl,
    activeUrl: this.getActiveUrl(),
    enabled: this.enabled,
    eventFilters: this.eventFilters,
    maxRetries: this.maxRetries,
    retryDelay: this.retryDelay,
    timeoutMs: this.timeoutMs,
    stats: {
      totalSent: this.totalSent,
      totalFailed: this.totalFailed,
      lastCalledAt: this.lastCalledAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailedAt: this.lastFailedAt,
    },
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Webhook', WebhookSchema);
