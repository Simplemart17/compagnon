-- Migration: device_tokens table + notification preference columns
-- Story: 8-1-device-token-registration-edge-function

-- =============================================================================
-- 1. Create device_tokens table
-- =============================================================================

CREATE TABLE device_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text        NOT NULL,
  platform   text        NOT NULL CHECK (platform IN ('ios', 'android')),
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

-- Index for fast user lookups
CREATE INDEX idx_device_tokens_user_id ON device_tokens (user_id);

-- Reuse existing set_updated_at() trigger function
CREATE TRIGGER set_device_tokens_updated_at
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. Enable RLS with 4 separate policies
-- =============================================================================

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own device tokens"
  ON device_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own device tokens"
  ON device_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own device tokens"
  ON device_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own device tokens"
  ON device_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 3. Add notification preference columns to profiles
-- =============================================================================

ALTER TABLE profiles
  ADD COLUMN streak_alerts  boolean NOT NULL DEFAULT true,
  ADD COLUMN srs_reminders  boolean NOT NULL DEFAULT true;
