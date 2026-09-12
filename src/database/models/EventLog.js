'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'event_logs';

const keyMap = {
  sessionId: 'session_id',
  messageId: 'message_id',
  chatId: 'chat_id',
  isGroup: 'is_group',
  senderNumber: 'sender_number',
  messageType: 'message_type',
  eventType: 'event_type',
  processedAt: 'processed_at',
};

const EventLog = {
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
    if (options.select === '-payload') {
      q = q.select('id,session_id,direction,event_type,message_id,chat_id,is_group,sender_number,message_type,summary,processed_at,created_at,updated_at');
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
};

module.exports = EventLog;
