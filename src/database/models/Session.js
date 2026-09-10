'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'sessions';

function attachMethods(row) {
  if (!row) return null;
  // Add camelCase aliases for direct property access
  row.sessionId = row.session_id;
  row.connectedAt = row.connected_at;
  row.disconnectedAt = row.disconnected_at;
  row.lastSeenAt = row.last_seen_at;
  row.reconnectAttempts = row.reconnect_attempts;
  row.apiToken = row.api_token;
  row.createdAt = row.created_at;
  row.updatedAt = row.updated_at;
  row.toPublic = function () {
    return {
      sessionId: row.session_id,
      label: row.label,
      status: row.status,
      phone: row.phone,
      name: row.name,
      jid: row.jid,
      connectedAt: row.connected_at,
      disconnectedAt: row.disconnected_at,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hasToken: !!row.api_token,
    };
  };
  row.toPublicWithToken = function () {
    return {
      ...row.toPublic(),
      apiToken: row.api_token || null,
    };
  };
  return row;
}

function toDb(obj) {
  return {
    session_id: obj.sessionId,
    label: obj.label,
    status: obj.status,
    phone: obj.phone,
    name: obj.name,
    jid: obj.jid,
    connected_at: obj.connectedAt,
    disconnected_at: obj.disconnectedAt,
    last_seen_at: obj.lastSeenAt,
    reconnect_attempts: obj.reconnectAttempts,
    metadata: obj.metadata,
    api_token: obj.apiToken,
  };
}

const Session = {
  async findOne(query) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = key === 'sessionId' ? 'session_id' : key === 'apiToken' ? 'api_token' : key;
      q = q.eq(col, val);
    }
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return attachMethods(data);
  },

  async find(query = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = key === 'sessionId' ? 'session_id' : key;
      if (key === 'status' && Array.isArray(val.$in)) {
        q = q.in(col, val.$in);
      } else {
        q = q.eq(col, val);
      }
    }
    q = q.order('created_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(attachMethods);
  },

  async create(doc) {
    const sb = getSupabase();
    const { data, error } = await sb.from(TABLE).insert(toDb(doc)).select('*').single();
    if (error) throw error;
    return attachMethods(data);
  },

  async findOneAndUpdate(filter, update, opts = {}) {
    const sb = getSupabase();

    // Build SET values from $set
    const setValues = {};
    if (update.$set) {
      for (const [key, val] of Object.entries(update.$set)) {
        const col = key === 'sessionId' ? 'session_id'
          : key === 'connectedAt' ? 'connected_at'
          : key === 'disconnectedAt' ? 'disconnected_at'
          : key === 'lastSeenAt' ? 'last_seen_at'
          : key === 'reconnectAttempts' ? 'reconnect_attempts'
          : key === 'apiToken' ? 'api_token'
          : key;
        setValues[col] = val;
      }
    }

    // Build INC values from $inc
    if (update.$inc) {
      // Need to fetch current value first
      const existing = await Session.findOne(filter);
      for (const [key, incVal] of Object.entries(update.$inc)) {
        const col = key === 'reconnectAttempts' ? 'reconnect_attempts' : key;
        setValues[col] = (existing?.[col] || 0) + incVal;
      }
    }

    const filterCol = filter.sessionId ? 'session_id' : Object.keys(filter)[0];
    const filterVal = filter.sessionId || filter[Object.keys(filter)[0]];

    const { data, error } = await sb.from(TABLE)
      .update(setValues)
      .eq(filterCol, filterVal)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    if (!data && opts.upsert) {
      const newDoc = { ...toDb({ sessionId: filter.sessionId, ...update.$set }) };
      const { data: inserted, error: insErr } = await sb.from(TABLE)
        .insert(newDoc)
        .select('*')
        .single();
      if (insErr) throw insErr;
      return attachMethods(inserted);
    }

    return attachMethods(data);
  },

  async updateOne(filter, update) {
    const sb = getSupabase();
    const filterCol = filter.sessionId ? 'session_id' : Object.keys(filter)[0];
    const filterVal = filter.sessionId || filter[Object.keys(filter)[0]];

    if (update.$set) {
      const setValues = {};
      for (const [key, val] of Object.entries(update.$set)) {
        const col = key === 'lastSeenAt' ? 'last_seen_at'
          : key === 'reconnectAttempts' ? 'reconnect_attempts'
          : key === 'status' ? 'status'
          : key === 'phone' ? 'phone'
          : key === 'name' ? 'name'
          : key === 'jid' ? 'jid'
          : key === 'connectedAt' ? 'connected_at'
          : key === 'disconnectedAt' ? 'disconnected_at'
          : key;
        setValues[col] = val;
      }
      const { error } = await sb.from(TABLE).update(setValues).eq(filterCol, filterVal);
      if (error) throw error;
    }

    if (update.$inc) {
      const existing = await Session.findOne(filter);
      const setValues = {};
      for (const [key, incVal] of Object.entries(update.$inc)) {
        const col = key === 'reconnectAttempts' ? 'reconnect_attempts' : key;
        setValues[col] = (existing?.[col] || 0) + incVal;
      }
      const { error } = await sb.from(TABLE).update(setValues).eq(filterCol, filterVal);
      if (error) throw error;
    }
  },

  async deleteOne(filter) {
    const sb = getSupabase();
    const filterCol = filter.sessionId ? 'session_id' : Object.keys(filter)[0];
    const filterVal = filter.sessionId || filter[Object.keys(filter)[0]];
    const { error } = await sb.from(TABLE).delete().eq(filterCol, filterVal);
    if (error) throw error;
  },

  async countByStatus() {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('count_sessions_by_status');
    if (error) throw error;
    return data || {};
  },
};

module.exports = Session;
