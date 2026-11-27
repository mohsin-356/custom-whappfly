'use strict';

class InMemoryMessageStore {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.messages = new Map(); // id -> { msg, jid, cleanPhone }
    this.chats = new Map();    // `${jid}:${id}` -> id
  }

  save(webMessage) {
    if (!webMessage) return;
    const key = webMessage.key || webMessage;
    const id = key?.id || webMessage.id;
    if (!id) return;

    const jid = key?.remoteJid || webMessage.remoteJid;
    const msg = webMessage.message || webMessage.rawMessage || webMessage;

    // If already exists, delete old entry to reset order and prevent duplicates
    if (this.messages.has(id)) {
      this._deleteEntry(id);
    }

    // Strictly enforce maxSize bounded FIFO/LRU
    while (this.messages.size >= this.maxSize) {
      const oldestId = this.messages.keys().next().value;
      this._deleteEntry(oldestId);
    }

    const cleanPhone = jid ? jid.split('@')[0] : null;
    this.messages.set(id, { msg, jid, cleanPhone });

    if (jid) {
      this.chats.set(`${jid}:${id}`, id);
      if (cleanPhone) {
        this.chats.set(`${cleanPhone}:${id}`, id);
      }
    }
  }

  _deleteEntry(id) {
    const entry = this.messages.get(id);
    if (entry) {
      if (entry.jid) this.chats.delete(`${entry.jid}:${id}`);
      if (entry.cleanPhone) this.chats.delete(`${entry.cleanPhone}:${id}`);
      this.messages.delete(id);
    }
  }

  load(jid, id) {
    // Handle single-argument call: load(id)
    if (!id && jid) {
      id = jid;
      jid = null;
    }
    if (!id) return null;

    if (this.messages.has(id)) {
      return this.messages.get(id).msg;
    }
    if (jid && this.chats.has(`${jid}:${id}`)) {
      const actualId = this.chats.get(`${jid}:${id}`);
      return this.messages.get(actualId)?.msg || null;
    }
    if (jid) {
      const cleanPhone = jid.split('@')[0];
      if (this.chats.has(`${cleanPhone}:${id}`)) {
        const actualId = this.chats.get(`${cleanPhone}:${id}`);
        return this.messages.get(actualId)?.msg || null;
      }
    }
    return null;
  }

  /**
   * Baileys store compatibility helper
   * Returns an object containing the message proto so callers using msg?.message work seamlessly
   */
  async loadMessage(jid, id) {
    const msg = this.load(jid, id);
    if (!msg) return null;
    return {
      key: { id, remoteJid: jid },
      message: msg.message || msg,
    };
  }

  bind(ev) {
    if (!ev || typeof ev.on !== 'function') return;
    ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages || []) {
        this.save(m);
      }
    });
    ev.on('messaging-history.set', ({ messages }) => {
      for (const m of messages || []) {
        this.save(m);
      }
    });
  }
}

module.exports = { InMemoryMessageStore };
