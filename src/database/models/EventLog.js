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
      _select: null,
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
      select(fields) {
        this._select = fields;
        return this;
      },
      async then(resolve, reject) {
        if (this._sort) q = q.order(this._sort, { ascending: false });
        if (this._limit) q = q.limit(this._limit);
        if (this._skip) q = q.range(this._skip, this._skip + (this._limit || 50) - 1);
        if (this._select === '-payload') q = q.select('id,session_id,direction,event_type,message_id,chat_id,is_group,sender_number,message_type,summary,processed_at,created_at,updated_at');
        const { data, error } = await q;
        if (error) { reject(error); return; }
        resolve(data || []);
      },
    };
  },
};

module.exports = EventLog;
