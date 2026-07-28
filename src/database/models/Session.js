'use strict';

const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: [
        'initializing',
        'qr_ready',
        'connecting',
        'connected',
        'disconnected',
        'reconnecting',
        'auth_failed',
        'logged_out',
      ],
      default: 'initializing',
      index: true,
    },
    phone: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    jid: {
      type: String,
      default: null,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
    disconnectedAt: {
      type: Date,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    reconnectAttempts: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'sessions',
  }
);

SessionSchema.index({ status: 1, createdAt: -1 });

SessionSchema.methods.toPublic = function () {
  return {
    sessionId: this.sessionId,
    label: this.label,
    status: this.status,
    phone: this.phone,
    name: this.name,
    jid: this.jid,
    connectedAt: this.connectedAt,
    disconnectedAt: this.disconnectedAt,
    lastSeenAt: this.lastSeenAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Session', SessionSchema);
