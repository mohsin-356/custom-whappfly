'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'bulk_campaigns';

const keyMap = {
  sessionId:   'session_id',
  messageId:   'message_id',
  listId:      'list_id',
  startedAt:   'started_at',
  completedAt: 'completed_at',
  delayMs:     'delay_ms',
  createdAt:   'created_at',
  updatedAt:   'updated_at',
};

function attachMethods(row) {
  if (!row) return null;
  row.sessionId   = row.session_id;
  row.messageId   = row.message_id;
  row.listId      = row.list_id;
  row.delayMs     = row.delay_ms;
  row.startedAt   = row.started_at;
  row.completedAt = row.completed_at;
  row.createdAt   = row.created_at;
  row.updatedAt   = row.updated_at;
  row.toPublic = function () {
    return {
      id:          this.id,
      sessionId:   this.session_id,
      messageId:   this.message_id,
      listId:      this.list_id,
      title:       this.title,
      status:      this.status,
      total:       this.total,
      sent:        this.sent,
      failed:      this.failed,
      skipped:     this.skipped,
      delayMs:     this.delay_ms,
      startedAt:   this.started_at,
      completedAt: this.completed_at,
      createdAt:   this.created_at,
    };
  };
  return row;
}

const BulkCampaign = {
  async find(query = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = keyMap[key] || key;
      q = q.eq(col, val);
    }
    q = q.order('created_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(attachMethods);
  },

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
    const insert = {
      session_id: doc.sessionId,
      message_id: doc.messageId,
      list_id:    doc.listId,
      title:      doc.title || '',
      delay_ms:   doc.delayMs || 1500,
      status:     'pending',
      total:      doc.total || 0,
    };
    const { data, error } = await sb.from(TABLE).insert(insert).select('*').single();
    if (error) throw error;
    return attachMethods(data);
  },

  async updateStatus(id, status, counters = {}) {
    const sb = getSupabase();
    const set = { status };
    if (counters.total   !== undefined) set.total   = counters.total;
    if (counters.sent    !== undefined) set.sent    = counters.sent;
    if (counters.failed  !== undefined) set.failed  = counters.failed;
    if (counters.skipped !== undefined) set.skipped = counters.skipped;
    if (status === 'running')    set.started_at   = new Date().toISOString();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      set.completed_at = new Date().toISOString();
    }
    const { error } = await sb.from(TABLE).update(set).eq('id', id);
    if (error) throw error;
  },

  async deleteOne(id, sessionId) {
    const sb = getSupabase();
    const { error } = await sb.from(TABLE)
      .delete()
      .eq('id', id)
      .eq('session_id', sessionId);
    if (error) throw error;
  },
};

module.exports = BulkCampaign;
