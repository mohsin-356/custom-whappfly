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

  async find(query) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = keyMap[key] || key;
      q = q.eq(col, val);
    }
    return {
      _q: q,
      _sort: null,
      _skip: 0,
      _limit: 0,
      sort(field) {
        const col = keyMap[field] || field;
        this._sort = col;
        return this;
      },
      skip(n) {
        this._skip = n;
        return this;
      },
      limit(n) {
        this._limit = n;
        return this;
      },
      async then(resolve, reject) {
        if (this._sort) q = q.order(this._sort, { ascending: false });
        if (this._limit) q = q.limit(this._limit);
        if (this._skip) q = q.range(this._skip, this._skip + (this._limit || 50) - 1);
        const { data, error } = await q;
        if (error) { reject(error); return; }
        resolve(data || []);
      },
    };
  },
};

module.exports = WebhookLog;
