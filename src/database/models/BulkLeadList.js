'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'bulk_lead_lists';

function attachMethods(row) {
  if (!row) return null;
  row.sessionId     = row.session_id;
  row.totalContacts = row.total_contacts;
  row.createdAt     = row.created_at;
  row.updatedAt     = row.updated_at;
  row.toPublic = function () {
    return {
      id:            this.id,
      sessionId:     this.session_id,
      name:          this.name,
      description:   this.description,
      totalContacts: this.total_contacts,
      createdAt:     this.created_at,
      updatedAt:     this.updated_at,
    };
  };
  return row;
}

const BulkLeadList = {
  async find(query = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = key === 'sessionId' ? 'session_id' : key;
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
      const col = key === 'sessionId' ? 'session_id' : key;
      q = q.eq(col, val);
    }
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return attachMethods(data);
  },

  async create(doc) {
    const sb = getSupabase();
    const insert = {
      session_id:   doc.sessionId,
      name:         doc.name,
      description:  doc.description || '',
      total_contacts: 0,
    };
    const { data, error } = await sb.from(TABLE).insert(insert).select('*').single();
    if (error) throw error;
    return attachMethods(data);
  },

  async update(id, sessionId, updates) {
    const sb = getSupabase();
    const setValues = {};
    if (updates.name        !== undefined) setValues.name        = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description;
    const { data, error } = await sb.from(TABLE)
      .update(setValues)
      .eq('id', id)
      .eq('session_id', sessionId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return attachMethods(data);
  },

  async incrementContactCount(id, amount = 1) {
    const sb = getSupabase();
    const { data: existing } = await sb.from(TABLE).select('total_contacts').eq('id', id).maybeSingle();
    const current = existing?.total_contacts || 0;
    const { error } = await sb.from(TABLE).update({ total_contacts: current + amount }).eq('id', id);
    if (error) throw error;
  },

  async recountContacts(id) {
    const sb = getSupabase();
    const { count, error } = await sb.from('bulk_leads').select('*', { count: 'exact', head: true }).eq('list_id', id);
    if (error) throw error;
    await sb.from(TABLE).update({ total_contacts: count || 0 }).eq('id', id);
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

module.exports = BulkLeadList;
