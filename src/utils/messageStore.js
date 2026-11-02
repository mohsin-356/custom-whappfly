'use strict';

class InMemoryMessageStore {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.messages = new Map(); // id -> message proto
    this.chats = new Map();    // jid:id -> message proto
  }

  save(webMessage) {
    if (!webMessage) return;
    const key = webMessage.key || webMessage;
    const id = key?.id || webMessage.id;
    if (!id) return;

    const jid = key?.remoteJid || webMessage.remoteJid;
    // Extract raw message protobuf (proto.IMessage)
    const msg = webMessage.message || webMessage.rawMessage || webMessage;

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
    // Handle single-argument call: load(id)
    if (!id && jid) {
      id = jid;
      jid = null;
    }
    if (!id) return null;

    if (this.messages.has(id)) {
      return this.messages.get(id);
    }
    if (jid && this.chats.has(`${jid}:${id}`)) {
      return this.chats.get(`${jid}:${id}`);
    }
    if (jid) {
      const cleanPhone = jid.split('@')[0];
      if (this.chats.has(`${cleanPhone}:${id}`)) {
        return this.chats.get(`${cleanPhone}:${id}`);
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
  }
}

module.exports = { InMemoryMessageStore };
