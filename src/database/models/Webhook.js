'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'webhooks';

function attachMethods(row) {
  if (!row) return null;
  // Add camelCase aliases for direct property access
  row.sessionId = row.session_id;
  row.testUrl = row.test_url;
  row.productionUrl = row.production_url;
  row.activeUrl = row.active_url;
  row.eventFilters = row.event_filters || [];
  row.maxRetries = row.max_retries;
  row.retryDelay = row.retry_delay;
  row.timeoutMs = row.timeout_ms;
  row.totalSent = row.total_sent;
  row.totalFailed = row.total_failed;
  row.lastCalledAt = row.last_called_at;
  row.lastSuccessAt = row.last_success_at;
  row.lastFailedAt = row.last_failed_at;
  row.getActiveUrl = function () {
    return this.mode === 'production' ? this.production_url : this.test_url;
  };
  row.toPublic = function () {
    return {
      sessionId: this.session_id,
      mode: this.mode,
      testUrl: this.test_url,
      productionUrl: this.production_url,
      activeUrl: this.getActiveUrl(),
      enabled: this.enabled,
      eventFilters: this.event_filters || [],
      maxRetries: this.max_retries,
      retryDelay: this.retry_delay,
      timeoutMs: this.timeout_ms,
      stats: {
        totalSent: this.total_sent,
        totalFailed: this.total_failed,
        lastCalledAt: this.last_called_at,
        lastSuccessAt: this.last_success_at,
        lastFailedAt: this.last_failed_at,
      },
      createdAt: this.created_at,
      updatedAt: this.updated_at,
    };
  };
  return row;
}

function toDb(obj) {
  return {
    session_id: obj.sessionId,
    mode: obj.mode,
    test_url: obj.testUrl,
    production_url: obj.productionUrl,
    active_url: obj.activeUrl,
    secret: obj.secret,
    enabled: obj.enabled,
    event_filters: obj.eventFilters || [],
    headers: obj.headers || {},
    max_retries: obj.maxRetries,
    retry_delay: obj.retryDelay,
    timeout_ms: obj.timeoutMs,
  };
}

// Map camelCase keys to snake_case columns
const keyMap = {
  sessionId: 'session_id',
  testUrl: 'test_url',
  productionUrl: 'production_url',
  activeUrl: 'active_url',
  eventFilters: 'event_filters',
  maxRetries: 'max_retries',
  retryDelay: 'retry_delay',
  timeoutMs: 'timeout_ms',
  totalSent: 'total_sent',
  totalFailed: 'total_failed',
  lastCalledAt: 'last_called_at',
  lastSuccessAt: 'last_success_at',
  lastFailedAt: 'last_failed_at',
};

const Webhook = {
  async findOne(query) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = keyMap[key] || key;
      q = q.eq(col, val);
    }
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return attachMethods(data);
  },

  async create(doc) {
    const sb = getSupabase();
    const insert = toDb(doc);
    const { data, error } = await sb.from(TABLE).insert(insert).select('*').single();
    if (error) throw error;
    return attachMethods(data);
  },

  async findOneAndUpdate(filter, update, opts = {}) {
    const sb = getSupabase();
    const setValues = {};

    if (update.$set) {
      for (const [key, val] of Object.entries(update.$set)) {
        const col = keyMap[key] || key;
        setValues[col] = val;
      }
    }

    const filterCol = keyMap[Object.keys(filter)[0]] || Object.keys(filter)[0];
    const filterVal = Object.values(filter)[0];

    const { data, error } = await sb.from(TABLE)
      .update(setValues)
      .eq(filterCol, filterVal)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    if (!data && opts.upsert) {
      const insert = toDb({ sessionId: filter.sessionId, ...update.$set });
      const { data: inserted, error: insErr } = await sb.from(TABLE)
        .insert(insert)
        .select('*')
        .single();
      if (insErr) throw insErr;
      return attachMethods(inserted);
    }

    return attachMethods(data);
  },

  async updateOne(filter, update) {
    const sb = getSupabase();
    const filterCol = keyMap[Object.keys(filter)[0]] || Object.keys(filter)[0];
    const filterVal = Object.values(filter)[0];

    const setValues = {};

    if (update.$set) {
      for (const [key, val] of Object.entries(update.$set)) {
        const col = keyMap[key] || key;
        setValues[col] = val;
      }
    }

    if (update.$inc) {
      const existing = await Webhook.findOne(filter);
      for (const [key, incVal] of Object.entries(update.$inc)) {
        const col = keyMap[key] || key;
        setValues[col] = (existing?.[col] || 0) + incVal;
      }
    }

    if (Object.keys(setValues).length > 0) {
      const { error } = await sb.from(TABLE).update(setValues).eq(filterCol, filterVal);
      if (error) throw error;
    }
  },

  async deleteOne(filter) {
    const sb = getSupabase();
    const filterCol = keyMap[Object.keys(filter)[0]] || Object.keys(filter)[0];
    const filterVal = Object.values(filter)[0];
    const { error } = await sb.from(TABLE).delete().eq(filterCol, filterVal);
    if (error) throw error;
  },
};

module.exports = Webhook;
