-- =============================================================
-- WhatsBridge — Bulk Messaging Schema Migration
-- Run this in Supabase SQL Editor after 001_initial_schema.sql
-- =============================================================

-- 1. Bulk Messages (templates / saved messages)
CREATE TABLE IF NOT EXISTS bulk_messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body_text       TEXT NOT NULL DEFAULT '',
  media           JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_messages_session ON bulk_messages (session_id, created_at DESC);

-- 2. Bulk Lead Lists (named collections of contacts)
CREATE TABLE IF NOT EXISTS bulk_lead_lists (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  total_contacts  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_lead_lists_session ON bulk_lead_lists (session_id, created_at DESC);

-- 3. Bulk Leads (individual contacts within a list)
CREATE TABLE IF NOT EXISTS bulk_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id         UUID NOT NULL REFERENCES bulk_lead_lists(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  contact_name    TEXT NOT NULL,
  phone_number    TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_leads_list ON bulk_leads (list_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_bulk_leads_session ON bulk_leads (session_id);
CREATE INDEX IF NOT EXISTS idx_bulk_leads_status ON bulk_leads (list_id, status);

-- 4. Bulk Campaigns (a run: message + list pair)
CREATE TABLE IF NOT EXISTS bulk_campaigns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT NOT NULL,
  message_id      UUID NOT NULL REFERENCES bulk_messages(id) ON DELETE CASCADE,
  list_id         UUID NOT NULL REFERENCES bulk_lead_lists(id) ON DELETE CASCADE,
  title           TEXT DEFAULT '',
  status          TEXT DEFAULT 'pending',
  total           INTEGER DEFAULT 0,
  sent            INTEGER DEFAULT 0,
  failed          INTEGER DEFAULT 0,
  skipped         INTEGER DEFAULT 0,
  delay_ms        INTEGER DEFAULT 1500,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_session ON bulk_campaigns (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_status ON bulk_campaigns (status);

-- 5. Auto-update triggers
CREATE TRIGGER trg_bulk_messages_updated    BEFORE UPDATE ON bulk_messages    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bulk_lead_lists_updated  BEFORE UPDATE ON bulk_lead_lists  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bulk_leads_updated       BEFORE UPDATE ON bulk_leads       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bulk_campaigns_updated   BEFORE UPDATE ON bulk_campaigns   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
