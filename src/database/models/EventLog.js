'use strict';

const mongoose = require('mongoose');

const EventLogSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ['incoming', 'outgoing'],
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      default: null,
    },
    chatId: {
      type: String,
      default: null,
      index: true,
    },
    isGroup: {
      type: Boolean,
      default: false,
    },
    senderNumber: {
      type: String,
      default: null,
    },
    messageType: {
      type: String,
      default: null,
    },
    summary: {
      type: String,
      default: null,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    error: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'event_logs',
    timestamps: true,
  }
);

EventLogSchema.index({ sessionId: 1, processedAt: -1 });
EventLogSchema.index({ sessionId: 1, direction: 1, processedAt: -1 });
// TTL: remove event logs older than 7 days
EventLogSchema.index({ processedAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('EventLog', EventLogSchema);
