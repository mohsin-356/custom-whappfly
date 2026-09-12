'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'webhook_logs';

const keyMap = {
  sessionId: 'session_id',
  webhookUrl: 'webhook_url',
  eventType: 'event_type',
  statusCode: 'status_code',
  responseBody: 'response_body',
  responseTime: 'response_time',
  triggeredAt: 'triggered_at',
};

const WebhookLog = {
  async create(doc) {
    const sb = getSupabase();
    const insert = {};
    for (const [key, val] of Object.entries(doc)) {
      const col = keyMap[key] || key;
      insert[col] = val;
    }
    const { error } = await sb.from(TABLE).insert(insert);
    if (error) throw error;
  },

  async countDocuments(query) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('id', { count: 'exact', head: true });
    for (const [key, val] of Object.entries(query)) {
      const col = keyMap[key] || key;
      q = q.eq(col, val);
    }
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  },

  async find(query, options = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = keyMap[key] || key;
      q = q.eq(col, val);
    }
    if (options.sort) {
      const col = keyMap[options.sort] || options.sort;
      q = q.order(col, { ascending: false });
    }
    if (options.limit) q = q.limit(options.limit);
    if (options.skip) q = q.range(options.skip, options.skip + (options.limit || 50) - 1);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
};

module.exports = WebhookLog;
