'use strict';

const logger = require('./logger');

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options
 * @param {number} options.maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Max delay cap in ms (default: 30000)
 * @param {number} options.factor - Backoff multiplication factor (default: 2)
 * @param {Function} options.onRetry - Called before each retry with (error, attempt)
 * @param {Function} options.shouldRetry - Returns false to stop retrying on specific errors
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    onRetry = null,
    shouldRetry = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      // Check if we should stop retrying
      if (shouldRetry && !shouldRetry(err, attempt)) {
        throw err;
      }

      if (attempt === maxAttempts) {
        throw err;
      }

      // Calculate delay with jitter
      const delay = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
      const jitter = Math.random() * 0.2 * delay; // ±20% jitter
      const actualDelay = Math.floor(delay + jitter);

      logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${actualDelay}ms`, {
        error: err.message,
      });

      if (onRetry) {
        try {
          await onRetry(err, attempt);
        } catch (_) {
          // Ignore errors in onRetry callback
        }
      }

      await sleep(actualDelay);
    }
  }

  throw lastError;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function a fixed number of times with a fixed delay
 */
async function retryFixed(fn, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await sleep(delayMs);
    }
  }
}

module.exports = { retryWithBackoff, retryFixed, sleep };
