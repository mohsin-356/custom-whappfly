'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'bulk_leads';

function attachMethods(row) {
  if (!row) return null;
  row.listId       = row.list_id;
  row.sessionId    = row.session_id;
  row.contactName  = row.contact_name;
  row.phoneNumber  = row.phone_number;
  row.sentAt       = row.sent_at;
  row.createdAt    = row.created_at;
  row.updatedAt    = row.updated_at;
  row.toPublic = function () {
    return {
      id:          this.id,
      listId:      this.list_id,
      sessionId:   this.session_id,
      contactName: this.contact_name,
      phoneNumber: this.phone_number,
      status:      this.status,
      error:       this.error,
      sentAt:      this.sent_at,
      createdAt:   this.created_at,
    };
  };
  return row;
}

const BulkLead = {
  async find(query = {}, opts = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = key === 'listId' ? 'list_id'
        : key === 'sessionId' ? 'session_id'
        : key;
      q = q.eq(col, val);
    }
    q = q.order('created_at', { ascending: true });
    if (opts.limit) q = q.limit(opts.limit);
    if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit || 50) - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(attachMethods);
  },

  async count(query = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*', { count: 'exact', head: true });
    for (const [key, val] of Object.entries(query)) {
      const col = key === 'listId' ? 'list_id'
        : key === 'sessionId' ? 'session_id'
        : key;
      q = q.eq(col, val);
    }
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  },

  async bulkInsert(records) {
    if (!records || records.length === 0) return [];
    const sb = getSupabase();
    const rows = records.map((r) => ({
      list_id:      r.listId,
      session_id:   r.sessionId,
      contact_name: r.contactName,
      phone_number: r.phoneNumber,
      status:       'pending',
    }));
    const { data, error } = await sb.from(TABLE).insert(rows).select('*');
    if (error) throw error;
    return (data || []).map(attachMethods);
  },

  async updateStatus(id, status, errorMsg = null) {
    const sb = getSupabase();
    const setValues = { status, sent_at: status === 'sent' ? new Date().toISOString() : null };
    if (errorMsg) setValues.error = errorMsg;
    const { error } = await sb.from(TABLE).update(setValues).eq('id', id);
    if (error) throw error;
  },

  async resetListStatuses(listId) {
    const sb = getSupabase();
    const { error } = await sb.from(TABLE)
      .update({ status: 'pending', error: null, sent_at: null })
      .eq('list_id', listId);
    if (error) throw error;
  },

  async deleteByList(listId) {
    const sb = getSupabase();
    const { error } = await sb.from(TABLE).delete().eq('list_id', listId);
    if (error) throw error;
  },

  async deleteOne(id) {
    const sb = getSupabase();
    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};

module.exports = BulkLead;
