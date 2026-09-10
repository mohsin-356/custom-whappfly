'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');

let supabase = null;
let isConnected = false;

async function connectDatabase() {
  if (isConnected && supabase) return;

  try {
    supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Test the connection with a simple query
    const { error } = await supabase.from('sessions').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    isConnected = true;
    logger.info('Supabase connected successfully');
  } catch (err) {
    logger.error('Supabase connection failed:', { error: err.message });
    logger.info('Retrying Supabase connection in 5 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return connectDatabase();
  }
}

function getSupabase() {
  return supabase;
}

function isConnectionReady() {
  return isConnected && supabase !== null;
}

module.exports = { connectDatabase, getSupabase, isConnectionReady };
