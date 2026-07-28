'use strict';

const CryptoJS = require('crypto-js');
const crypto = require('crypto');
const config = require('../config');

const ENCRYPTION_KEY = config.session.encryptionKey.padEnd(32, '0').slice(0, 32);

/**
 * Encrypt a plain text string using AES-256
 */
function encrypt(text) {
  if (!text) return text;
  try {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
  } catch (err) {
    throw new Error(`Encryption failed: ${err.message}`);
  }
}

/**
 * Decrypt an AES-256 encrypted string
 */
function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}`);
  }
}

/**
 * Encrypt a JSON object
 */
function encryptObject(obj) {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt a JSON object
 */
function decryptObject(ciphertext) {
  const raw = decrypt(ciphertext);
  return JSON.parse(raw);
}

/**
 * Generate a random API key
 */
function generateApiKey(length = 48) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a webhook signature for a payload
 */
function generateWebhookSignature(payload, secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verify a webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  const expected = generateWebhookSignature(payload, secret);
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expBuffer);
}

/**
 * Hash a password
 */
async function hashPassword(password) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hash(password, 12);
}

/**
 * Compare a password with a hash
 */
async function comparePassword(password, hash) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compare(password, hash);
}

module.exports = {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  generateApiKey,
  generateWebhookSignature,
  verifyWebhookSignature,
  hashPassword,
  comparePassword,
};
