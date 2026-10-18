'use strict';

const { getSupabase } = require('../connection');

const TABLE = 'bulk_messages';

function attachMethods(row) {
  if (!row) return null;
  row.sessionId = row.session_id;
  row.bodyText  = row.body_text;
  row.createdAt = row.created_at;
  row.updatedAt = row.updated_at;
  row.toPublic = function () {
    return {
      id:        this.id,
      sessionId: this.session_id,
      title:     this.title,
      bodyText:  this.body_text,
      media:     this.media || [],
      createdAt: this.created_at,
      updatedAt: this.updated_at,
    };
  };
  return row;
}

const BulkMessage = {
  async find(query = {}, opts = {}) {
    const sb = getSupabase();
    let q = sb.from(TABLE).select('*');
    for (const [key, val] of Object.entries(query)) {
      const col = key === 'sessionId' ? 'session_id' : key;
      q = q.eq(col, val);
    }
    q = q.order('created_at', { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
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
      session_id: doc.sessionId,
      title:      doc.title,
      body_text:  doc.bodyText || '',
      media:      doc.media || [],
    };
    const { data, error } = await sb.from(TABLE).insert(insert).select('*').single();
    if (error) throw error;
    return attachMethods(data);
  },

  async update(id, sessionId, updates) {
    const sb = getSupabase();
    const setValues = {};
    if (updates.title    !== undefined) setValues.title     = updates.title;
    if (updates.bodyText !== undefined) setValues.body_text = updates.bodyText;
    if (updates.media    !== undefined) setValues.media     = updates.media;
    const { data, error } = await sb.from(TABLE)
      .update(setValues)
      .eq('id', id)
      .eq('session_id', sessionId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return attachMethods(data);
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

module.exports = BulkMessage;
