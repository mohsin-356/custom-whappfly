'use strict';

const config = require('../config');
const logger = require('../utils/logger');

// In-memory fallback queue when Redis is unavailable
class InMemoryQueue {
  constructor(name, processFn) {
    this.name = name;
    this.processFn = processFn;
    this.queue = [];
    this.running = false;
  }

  async add(data, opts = {}) {
    this.queue.push({ data, opts, addedAt: Date.now() });
    if (!this.running) this._process();
  }

  async _process() {
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      try {
        await this.processFn({ data: item.data });
      } catch (err) {
        logger.error(`[InMemoryQueue:${this.name}] Job failed:`, { error: err.message });
        // Re-queue with retry if attempts < max
        const attempts = (item.opts._attempts || 0) + 1;
        const maxAttempts = item.opts.attempts || 3;
        if (attempts < maxAttempts) {
          const delay = 2000 * Math.pow(2, attempts);
          setTimeout(() => {
            this.queue.push({ ...item, opts: { ...item.opts, _attempts: attempts } });
            if (!this.running) this._process();
          }, delay);
        }
      }
    }
    this.running = false;
  }

  async close() {}
  async obliterate() { this.queue = []; }
}

// BullMQ-backed queue (when Redis is available)
class BullQueue {
  constructor(name, processFn, redisOpts) {
    const { Queue, Worker } = require('bullmq');
    this.queue = new Queue(name, { connection: redisOpts });
    this.worker = new Worker(
      name,
      async (job) => processFn(job),
      { connection: redisOpts, concurrency: 5 }
    );

    this.worker.on('failed', (job, err) => {
      logger.error(`[BullQueue:${name}] Job ${job?.id} failed:`, { error: err.message });
    });
  }

  async add(data, opts = {}) {
    return this.queue.add('job', data, {
      attempts: opts.attempts || 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
      ...opts,
    });
  }

  async close() {
    await this.worker.close();
    await this.queue.close();
  }

  async obliterate() {
    await this.queue.obliterate({ force: true });
  }
}

class QueueServiceClass {
  constructor() {
    this.queues = {};
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    if (config.redis.enabled) {
      logger.info('QueueService: Using BullMQ (Redis-backed) queues');
      this._setupBullQueues();
    } else {
      logger.info('QueueService: Using in-memory queues (set REDIS_ENABLED=true for BullMQ)');
      this._setupInMemoryQueues();
    }

    this.initialized = true;
  }

  _setupBullQueues() {
    const redisOpts = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: null,
    };

    // Webhook delivery queue
    this.queues.webhook = new BullQueue(
      'whatsbridge:webhook',
      (job) => this._processWebhookJob(job),
      redisOpts
    );

    // Media download queue
    this.queues.media = new BullQueue(
      'whatsbridge:media',
      (job) => this._processMediaJob(job),
      redisOpts
    );
  }

  _setupInMemoryQueues() {
    this.queues.webhook = new InMemoryQueue(
      'webhook',
      (job) => this._processWebhookJob(job)
    );
    this.queues.media = new InMemoryQueue(
      'media',
      (job) => this._processMediaJob(job)
    );
  }

  /**
   * Enqueue a webhook delivery job
   */
  async enqueueWebhook(sessionId, url, payload, opts = {}) {
    await this.queues.webhook.add(
      { sessionId, url, payload, enqueuedAt: new Date().toISOString() },
      { attempts: opts.retries || config.webhook.maxRetries }
    );
  }

  /**
   * Enqueue a media download job
   */
  async enqueueMediaDownload(sessionId, messageData, opts = {}) {
    await this.queues.media.add(
      { sessionId, messageData, enqueuedAt: new Date().toISOString() },
      { attempts: 2 }
    );
  }

  /**
   * Process a webhook delivery job
   * Actual send logic is delegated to WebhookService to avoid circular deps
   */
  async _processWebhookJob(job) {
    // Lazy-require to avoid circular dependency
    const { WebhookService } = require('./WebhookService');
    const { sessionId, url, payload } = job.data;
    await WebhookService.send(sessionId, url, payload);
  }

  /**
   * Process a media download job
   * Delegated to MediaService
   */
  async _processMediaJob(job) {
    const { MediaService } = require('./MediaService');
    const { sessionId, messageData } = job.data;
    await MediaService.processAndAttach(sessionId, messageData);
  }

  async shutdown() {
    for (const q of Object.values(this.queues)) {
      await q.close();
    }
    logger.info('QueueService: all queues closed');
  }
}

const QueueService = new QueueServiceClass();
module.exports = { QueueService };
