-- Migration: pg_cron scheduling for push notifications + query functions
-- Story: 8-2-streak-srs-notification-delivery

-- =============================================================================
-- 1. Enable required extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- 2. Create notification query functions (called via RPC from Edge Function)
-- =============================================================================

-- Streak-at-risk: users with active streak who haven't practiced today
CREATE OR REPLACE FUNCTION get_streak_notification_targets()
RETURNS TABLE (
  user_id uuid,
  streak_days integer,
  token text,
  platform text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS user_id, p.streak_days, dt.token, dt.platform
  FROM profiles p
  JOIN device_tokens dt ON dt.user_id = p.id
  WHERE p.streak_days > 0
    AND p.last_active_date < CURRENT_DATE
    AND p.streak_alerts = true;
$$;

-- SRS due cards: users with 10+ vocabulary cards due for review
CREATE OR REPLACE FUNCTION get_srs_notification_targets()
RETURNS TABLE (
  user_id uuid,
  due_count bigint,
  token text,
  platform text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.user_id, COUNT(*) AS due_count, dt.token, dt.platform
  FROM vocabulary v
  JOIN profiles p ON p.id = v.user_id
  JOIN device_tokens dt ON dt.user_id = v.user_id
  WHERE v.next_review <= NOW()
    AND p.srs_reminders = true
  GROUP BY v.user_id, dt.token, dt.platform
  HAVING COUNT(*) >= 10;
$$;

-- Revoke public access — only service_role should call these
REVOKE EXECUTE ON FUNCTION get_streak_notification_targets() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_srs_notification_targets() FROM public, anon, authenticated;

-- =============================================================================
-- 3. Notification log for cross-run idempotency
-- =============================================================================

CREATE TABLE notification_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text        NOT NULL CHECK (type IN ('streak', 'srs')),
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_log_dedup
  ON notification_log (user_id, type, sent_at);

-- No RLS — only accessed by service_role via Edge Function
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup: remove log entries older than 24 hours (runs daily at 3 AM)
SELECT cron.schedule(
  'cleanup-notification-log',
  '0 3 * * *',
  $$DELETE FROM notification_log WHERE sent_at < now() - interval '24 hours';$$
);

-- =============================================================================
-- 3. Schedule cron job using Vault for secrets
-- =============================================================================
-- NOTE: Before applying this migration, the deployer must insert Vault secrets:
--   SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   SELECT vault.create_secret('<cron-secret-value>', 'cron_secret');
--
-- The CRON_SECRET must match what is set via: supabase secrets set CRON_SECRET=<value>

SELECT cron.schedule(
  'send-push-notifications',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := jsonb_build_object('time', now()::text),
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
