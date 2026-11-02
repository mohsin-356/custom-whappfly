'use strict';

class InMemoryMessageStore {
  constructor(maxSize = 5000) {
    this.maxSize = maxSize;
    this.messages = new Map(); // id -> message proto
    this.chats = new Map();    // jid:id -> message proto
  }

  save(webMessage) {
    if (!webMessage?.key?.id) return;
    const id = webMessage.key.id;
    const jid = webMessage.key.remoteJid;
    const msg = webMessage.message || webMessage;

    if (this.messages.size >= this.maxSize) {
      const firstKey = this.messages.keys().next().value;
      this.messages.delete(firstKey);
    }

    this.messages.set(id, msg);

    if (jid) {
      this.chats.set(`${jid}:${id}`, msg);
      const cleanPhone = jid.split('@')[0];
      this.chats.set(`${cleanPhone}:${id}`, msg);
    }
  }

  load(jid, id) {
    if (!id) return null;
    if (this.messages.has(id)) return this.messages.get(id);
    if (jid && this.chats.has(`${jid}:${id}`)) return this.chats.get(`${jid}:${id}`);
    if (jid) {
      const cleanPhone = jid.split('@')[0];
      if (this.chats.has(`${cleanPhone}:${id}`)) return this.chats.get(`${cleanPhone}:${id}`);
    }
    return null;
  }

  bind(ev) {
    ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages || []) {
        this.save(m);
      }
    });
  }
}

module.exports = { InMemoryMessageStore };
