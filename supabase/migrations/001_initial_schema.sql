-- =============================================================
-- WhatsBridge — Supabase Schema Migration
-- Run this in Supabase SQL Editor (Dashboard > SQL > New Query)
-- =============================================================

-- 1. Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT UNIQUE NOT NULL,
  label           TEXT DEFAULT '',
  status          TEXT DEFAULT 'initializing',
  phone           TEXT,
  name            TEXT,
  jid             TEXT,
  connected_at    TIMESTAMPTZ,
  disconnected_at  TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  reconnect_attempts INTEGER DEFAULT 0,
  metadata        JSONB DEFAULT '{}'::jsonb,
  api_token       TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_status        ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_status_created ON sessions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_api_token      ON sessions (api_token);

-- 2. Webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT UNIQUE NOT NULL,
  mode            TEXT DEFAULT 'testing',
  test_url        TEXT,
  production_url  TEXT,
  active_url      TEXT,
  secret          TEXT,
  enabled         BOOLEAN DEFAULT true,
  event_filters   TEXT[] DEFAULT '{}',
  headers         JSONB DEFAULT '{}'::jsonb,
  max_retries     INTEGER DEFAULT 3,
  retry_delay     INTEGER DEFAULT 5000,
  timeout_ms      INTEGER DEFAULT 30000,
  total_sent      INTEGER DEFAULT 0,
  total_failed    INTEGER DEFAULT 0,
  last_called_at  TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failed_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_session ON webhooks (session_id);

-- 3. Event logs table (7-day TTL)
CREATE TABLE IF NOT EXISTS event_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT NOT NULL,
  direction       TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  message_id      TEXT,
  chat_id         TEXT,
  is_group        BOOLEAN DEFAULT false,
  sender_number   TEXT,
  message_type    TEXT,
  summary         TEXT,
  payload         JSONB DEFAULT '{}'::jsonb,
  error           TEXT,
  processed_at    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_logs_session_processed ON event_logs (session_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_direction_processed ON event_logs (session_id, direction, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_event_type ON event_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_event_logs_chat_id ON event_logs (chat_id);

-- 4. Webhook logs table (30-day TTL)
CREATE TABLE IF NOT EXISTS webhook_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT NOT NULL,
  webhook_url     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB DEFAULT '{}'::jsonb,
  status_code     INTEGER,
  response_body   TEXT,
  response_time   INTEGER,
  success         BOOLEAN DEFAULT false,
  attempts        INTEGER DEFAULT 1,
  error           TEXT,
  triggered_at    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_session_triggered ON webhook_logs (session_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_success_triggered ON webhook_logs (success, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs (event_type);

-- 5. Auto-updating updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_updated  BEFORE UPDATE ON sessions  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_webhooks_updated   BEFORE UPDATE ON webhooks  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_logs_updated BEFORE UPDATE ON event_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_webhook_logs_updated BEFORE UPDATE ON webhook_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. TTL: auto-delete old event logs (7 days) and webhook logs (30 days)
CREATE OR REPLACE FUNCTION delete_old_event_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM event_logs WHERE processed_at < now() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_old_webhook_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM webhook_logs WHERE triggered_at < now() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron (enable in Supabase if available)
-- SELECT cron.schedule('cleanup-event-logs', '0 * * * *', 'SELECT delete_old_event_logs()');
-- SELECT cron.schedule('cleanup-webhook-logs', '0 * * * *', 'SELECT delete_old_webhook_logs()');

-- 7. count_by_status function (replaces MongoDB aggregate)
CREATE OR REPLACE FUNCTION count_sessions_by_status()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT COALESCE(json_object_agg(status, cnt), '{}'::json) INTO result
  FROM (
    SELECT status, COUNT(*)::bigint AS cnt
    FROM sessions
    GROUP BY status
  ) t;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
