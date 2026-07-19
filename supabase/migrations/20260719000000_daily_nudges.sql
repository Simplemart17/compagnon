-- =============================================================================
-- Story 18-3 (v2-vision-roadmap Epic 18): daily conversation nudges
-- ("your pal texts you first").
--
-- Adds per-user nudge preferences to `profiles` + a third notification-target
-- RPC consumed by the hourly `send-notifications` cron (patterns mirror
-- 20260402000000_notification_cron.sql: SECURITY DEFINER + SET search_path +
-- REVOKE from public/anon/authenticated — service_role only).
--
-- Design contract:
--   * At most ONE nudge per user per day — enforced server-side by the
--     20-hour NOT EXISTS window against notification_log (type = 'nudge'),
--     independent of client state.
--   * Sent only at the user's chosen hour (`nudge_utc_hour`, stored in UTC;
--     the CLIENT converts its local preference to UTC on save — Story 9-2
--     precedent: timezone math stays client-side; DST drift self-corrects
--     the next time the user opens settings).
--   * Never nudge a user who already practiced today (`last_active_date`),
--     and never a user who opted out (`daily_nudge = false`).
--   * Context payload: the user's TOP unresolved error pattern (highest
--     occurrences — Story 11-6's embedding dedup guarantees distinct
--     patterns) so the nudge can reference real study context. Deliberately
--     NO companion_memory content in the payload: memories are personal
--     facts and a push notification renders on the LOCK SCREEN — error
--     patterns are study metadata, memories are private life details.
-- =============================================================================

-- 1. Preference columns (pattern: 20260401000000_device_tokens.sql
--    streak_alerts / srs_reminders live on profiles)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_nudge boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nudge_utc_hour smallint NOT NULL DEFAULT 17
    CONSTRAINT profiles_nudge_utc_hour_range CHECK (nudge_utc_hour BETWEEN 0 AND 23);

COMMENT ON COLUMN profiles.daily_nudge IS
  'Story 18-3: opt-in flag for the daily conversation nudge push. Default true; hard opt-out in Settings.';
COMMENT ON COLUMN profiles.nudge_utc_hour IS
  'Story 18-3: UTC hour (0-23) at which the daily nudge may fire. Client converts the user''s local choice to UTC on save. Default 17 UTC (~evening Europe / midday Americas).';

-- 2. Nudge notification targets RPC
CREATE OR REPLACE FUNCTION get_nudge_notification_targets()
RETURNS TABLE (
  user_id uuid,
  streak_days integer,
  token text,
  platform text,
  top_error_description text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.streak_days,
    dt.token,
    dt.platform,
    ep.error_description AS top_error_description
  FROM profiles p
  JOIN device_tokens dt ON dt.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT e.error_description
    FROM error_patterns e
    WHERE e.user_id = p.id
      AND e.resolved = false
    ORDER BY e.occurrences DESC, e.last_occurred DESC
    LIMIT 1
  ) ep ON true
  WHERE p.daily_nudge = true
    AND p.nudge_utc_hour = EXTRACT(HOUR FROM now())::smallint
    AND (p.last_active_date IS NULL OR p.last_active_date < CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1
      FROM notification_log nl
      WHERE nl.user_id = p.id
        AND nl.type = 'nudge'
        AND nl.sent_at > now() - INTERVAL '20 hours'
    );
$$;

-- 3. Revoke public access — only service_role (the cron-invoked Edge
--    Function) may call this (Story 9-9 hardening; mirrors the streak/SRS
--    target RPCs).
REVOKE EXECUTE ON FUNCTION get_nudge_notification_targets() FROM public, anon, authenticated;
