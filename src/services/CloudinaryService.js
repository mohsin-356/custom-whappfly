'use strict';

const cloudinary = require('cloudinary').v2;
const config = require('../config');
const logger = require('../utils/logger');

// Configure Cloudinary:
// Check process.env.CLOUDINARY_URL or individual credentials
function initCloudinary() {
  const url = process.env.CLOUDINARY_URL || config.cloudinary?.url;
  if (url && !url.includes('<your_api_key>')) {
    cloudinary.config({
      cloudinary_url: url,
    });
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || config.cloudinary?.cloudName || 'dewgf801n',
      api_key:    process.env.CLOUDINARY_API_KEY    || config.cloudinary?.apiKey || '',
      api_secret: process.env.CLOUDINARY_API_SECRET || config.cloudinary?.apiSecret || 'wp1WXeb__b9Ty4hWqO2ALXzguy4',
      secure: true,
    });
  }
}

// Initialize on module load
initCloudinary();

class CloudinaryServiceClass {
  constructor() {
    this.cloudinary = cloudinary;
  }

  /**
   * Re-initialize if environment variables change
   */
  reloadConfig() {
    initCloudinary();
  }

  /**
   * Check if Cloudinary is fully configured with required credentials
   */
  isConfigured() {
    const conf = cloudinary.config();
    const hasValidKey = conf.api_key && conf.api_key !== '<your_api_key>' && conf.api_key.trim().length > 0;
    const hasValidSecret = conf.api_secret && conf.api_secret.trim().length > 0;
    const hasCloudName = conf.cloud_name && conf.cloud_name.trim().length > 0;
    return !!(hasCloudName && hasValidKey && hasValidSecret);
  }

  /**
   * Determine Cloudinary resource_type based on mime type or file extension
   */
  getResourceType(mimetype, filename = '') {
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';
    
    if (mimetype) {
      if (mimetype.startsWith('image/')) return 'image';
      if (mimetype.startsWith('video/')) return 'video';
      if (mimetype.startsWith('audio/')) return 'video'; // Cloudinary handles audio under video resource_type
      if (mimetype === 'application/pdf') return 'auto'; // allow auto for PDF preview/embed or raw
    }

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'].includes(ext)) return 'video';
    if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus'].includes(ext)) return 'video';

    return 'auto';
  }

  /**
   * Determine WhatsApp message type from mime type or filename
   */
  getWhatsAppType(mimetype, filename = '') {
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';

    if (mimetype) {
      if (mimetype.startsWith('image/')) return 'image';
      if (mimetype.startsWith('video/')) return 'video';
      if (mimetype.startsWith('audio/')) return 'audio';
      return 'document';
    }

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'].includes(ext)) return 'video';
    if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus'].includes(ext)) return 'audio';

    return 'document';
  }

  /**
   * Upload a Buffer to Cloudinary
   * @param {Buffer} buffer - File buffer
   * @param {Object} options - Upload options { folder, filename, mimetype, resourceType }
   * @returns {Promise<Object>} Cloudinary upload result
   */
  async uploadBuffer(buffer, options = {}) {
    if (!this.isConfigured()) {
      throw new Error(
        'Cloudinary is not fully configured. Please provide CLOUDINARY_API_KEY in your .env file or credentials.'
      );
    }

    const filename = options.filename || 'file';
    const cleanFilename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const resourceType = options.resourceType || this.getResourceType(options.mimetype, options.filename);

    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder: options.folder || 'whatsbridge/bulk',
        resource_type: resourceType,
        public_id: `${cleanFilename}_${Date.now()}`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      };

      const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) {
          logger.error('[Cloudinary] Upload error:', { error: error.message });
          return reject(error);
        }

        logger.info(`[Cloudinary] Successfully uploaded: ${result.secure_url} (${result.resource_type})`);
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          resourceType: result.resource_type,
          bytes: result.bytes,
          originalFilename: options.filename || result.original_filename,
          type: this.getWhatsAppType(options.mimetype, options.filename),
          mimetype: options.mimetype || null,
        });
      });

      stream.end(buffer);
    });
  }

  /**
   * Upload from a remote URL or base64 data URI to Cloudinary
   * @param {string} fileSource - URL or base64 data URI
   * @param {Object} options - Upload options
   */
  async uploadSource(fileSource, options = {}) {
    if (!this.isConfigured()) {
      throw new Error(
        'Cloudinary is not fully configured. Please provide CLOUDINARY_API_KEY in your .env file or credentials.'
      );
    }

    const resourceType = options.resourceType || this.getResourceType(options.mimetype, options.filename);

    const result = await cloudinary.uploader.upload(fileSource, {
      folder: options.folder || 'whatsbridge/bulk',
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
      ...options,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      resourceType: result.resource_type,
      bytes: result.bytes,
      originalFilename: options.filename || result.original_filename,
      type: this.getWhatsAppType(options.mimetype, options.filename),
      mimetype: options.mimetype || null,
    };
  }

  /**
   * Delete an asset by its public_id
   */
  async deleteAsset(publicId, resourceType = 'image') {
    if (!this.isConfigured()) return;
    try {
      return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (err) {
      logger.warn(`[Cloudinary] Failed to delete asset ${publicId}:`, { error: err.message });
    }
  }
}

const CloudinaryService = new CloudinaryServiceClass();
module.exports = { CloudinaryService };
