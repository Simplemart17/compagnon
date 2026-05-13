-- Migration: Postgres-backed rate limit + per-user daily AI cost ceiling
-- Story: 11-4-replace-rate-limit-upstash
-- Closes audit findings P1-8 (in-memory rate limiter bypassable across isolates)
-- and the spend-cap portion of P1-10 (no per-user daily AI cost cap).
--
-- New surface:
--   * rate_limit_counters       — per-(user_id, key, window_start) request counter
--   * daily_cost_ledger         — per-(user_id, day) cumulative AI cost in fractional cents (NUMERIC)
--   * profiles.daily_ai_cost_cents_limit — per-user override (default 100¢ = $1.00)
--   * check_and_increment_rate_limit   — atomic check-and-increment via single UPDATE (review patch P2)
--   * check_daily_cost_budget   — read-only pre-check before each upstream call
--   * record_daily_cost         — post-call atomic increment from OpenAI usage object
--   * cleanup_stale_rate_limits — nightly pg_cron job vacuuming stale rows
--
-- Review-round-1 patches (Blind Hunter + Edge Case Hunter):
--   P2 — Rate-limit check-and-increment is a single atomic UPDATE statement
--        instead of insert+conditional-rollback (eliminates the race where
--        concurrent over-cap denies could decrement past the limit).
--   P3 — `daily_cost_ledger.total_cost_cents` is NUMERIC(20,6) instead of
--        BIGINT, so fractional sub-cent contributions (e.g., 0.002¢
--        embeddings) accumulate accurately. The user-facing limit stays in
--        whole cents (operator-friendly) but the comparison casts to NUMERIC.
--   P4 — `cron.schedule` wrapped in defensive `cron.unschedule` so re-running
--        the migration after `supabase db reset` doesn't fail on
--        duplicate-jobname unique constraint.
--   P9 — Removed dead `IF v_total IS NULL` / `IF v_limit IS NULL` branches
--        after `COALESCE` (cosmetic cleanup).
--
-- Fail-OPEN policy: if Postgres is unreachable, the Edge Function helper at
-- supabase/functions/_shared/rate-limit-db.ts logs to console.error and
-- accepts the request. Documented in CLAUDE.md.

-- =============================================================================
-- 1. rate_limit_counters — per-(user_id, key, window_start) request counter
-- =============================================================================
-- window_start is bucketed to the floor of the window (e.g., minute boundary
-- for 60s windows) so two requests in the same window land on the same row
-- and the atomic check-and-increment serializes correctly. No FK on user_id
-- because send-notifications cron passes a sentinel UUID
-- ('00000000-0000-0000-0000-000000000000') that's not a real profile.

CREATE TABLE rate_limit_counters (
  user_id        uuid        NOT NULL,
  key            text        NOT NULL,
  window_start   timestamptz NOT NULL,
  request_count  integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key, window_start)
);

CREATE INDEX idx_rate_limit_counters_window_start
  ON rate_limit_counters (window_start);

-- No RLS policies → deny-all for anon/authenticated; service_role bypasses.
-- Pattern from notification_log (Story 8-2).
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. daily_cost_ledger — per-(user_id, day) cumulative AI cost in fractional cents
-- =============================================================================
-- Day is UTC date; rollover at 00:00:00 UTC regardless of Postgres session TZ.
-- Story 11-4 review patch P3: `total_cost_cents` is NUMERIC(20,6) (six decimal
-- places of precision) instead of BIGINT, so a 0.002¢ embedding cost
-- accumulates accurately. BIGINT + Math.ceil at the helper layer would have
-- inflated embedding spend by ~500× and locked out embedding-heavy users.

CREATE TABLE daily_cost_ledger (
  user_id           uuid          NOT NULL,
  day               date          NOT NULL,
  total_cost_cents  numeric(20,6) NOT NULL DEFAULT 0,
  request_count     integer       NOT NULL DEFAULT 0,
  last_updated_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX idx_daily_cost_ledger_day ON daily_cost_ledger (day);

ALTER TABLE daily_cost_ledger ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. profiles.daily_ai_cost_cents_limit — per-user override of the daily cap
-- =============================================================================
-- Default 100¢ = $1.00 USD. Operators raise for premium users via:
--   UPDATE profiles SET daily_ai_cost_cents_limit = N WHERE id = '...';
-- Stays INTEGER (whole cents) for operator-UX simplicity; cast to NUMERIC at
-- comparison time in check_daily_cost_budget.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_ai_cost_cents_limit integer NOT NULL DEFAULT 100;

-- =============================================================================
-- 4. check_and_increment_rate_limit — atomic single-statement upsert
-- =============================================================================
-- Story 11-4 review patch P2: replaces the previous insert+conditional-
-- rollback pattern (which had a race where two concurrent over-cap denies
-- could both fire `UPDATE … - 1` and decrement the counter past the limit,
-- re-opening a closed window).
--
-- New pattern:
--   (a) INSERT … ON CONFLICT DO NOTHING returns the new row if there was no
--       existing row.
--   (b) If no row was inserted (i.e., row existed), conditionally UPDATE only
--       when `request_count < p_limit` — Postgres serializable-snapshot
--       isolation guarantees that concurrent UPDATEs serialize, so at most
--       p_limit increments succeed and the (p_limit+1)th caller sees the
--       UPDATE return zero rows.
--
-- No rollback needed: the UPDATE either fires (counter increments by 1) or
-- doesn't (counter unchanged). Cannot drift below or above the limit.
--
-- SECURITY DEFINER + SET search_path = public per Story 9-9 hardening.

CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
  p_user_id        uuid,
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
) RETURNS TABLE (
  allowed          boolean,
  remaining        integer,
  reset_in_seconds integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start  timestamptz;
  v_window_end    timestamptz;
  v_new_count     integer;
BEGIN
  -- Bucket window_start to the floor of the window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds)::bigint * p_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  -- (a) Try fresh insert. ON CONFLICT DO NOTHING returns NULL into v_new_count
  --     when a row already exists; otherwise returns 1 (the new request_count).
  INSERT INTO rate_limit_counters (user_id, key, window_start, request_count)
  VALUES (p_user_id, p_key, v_window_start, 1)
  ON CONFLICT (user_id, key, window_start) DO NOTHING
  RETURNING request_count INTO v_new_count;

  IF v_new_count IS NOT NULL THEN
    -- Fresh row inserted; first request of the window for this (user, key).
    RETURN QUERY SELECT
      true,
      GREATEST(0, p_limit - v_new_count),
      GREATEST(1, EXTRACT(epoch FROM (v_window_end - now()))::integer);
    RETURN;
  END IF;

  -- (b) Row exists. Conditionally UPDATE only when below limit. Postgres
  --     serializable-snapshot isolation ensures concurrent UPDATEs serialize;
  --     at most p_limit increments succeed, and the (p_limit+1)th caller
  --     sees `RETURNING request_count INTO v_new_count` return NULL.
  UPDATE rate_limit_counters
  SET request_count = request_count + 1
  WHERE user_id = p_user_id
    AND key = p_key
    AND window_start = v_window_start
    AND request_count < p_limit
  RETURNING request_count INTO v_new_count;

  IF v_new_count IS NULL THEN
    -- UPDATE didn't fire because request_count was already >= p_limit.
    -- Denied. No rollback needed — we never incremented.
    RETURN QUERY SELECT
      false,
      0,
      GREATEST(1, EXTRACT(epoch FROM (v_window_end - now()))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    GREATEST(0, p_limit - v_new_count),
    GREATEST(1, EXTRACT(epoch FROM (v_window_end - now()))::integer);
END;
$$;

-- =============================================================================
-- 5. check_daily_cost_budget — read-only pre-check before upstream call
-- =============================================================================
-- Returns (allowed, total_today_cents, limit_cents). Read-only: does NOT
-- record the cost (that's record_daily_cost's job after a successful call).
-- Accepts NUMERIC for the estimated cents (sub-cent precision preserved).
--
-- Race condition (acceptable for soft cap): two concurrent calls both
-- pre-check OK then both record → small overshoot. We're catching
-- runaway-loops, not enforcing penny-perfect billing.
--
-- Story 11-4 review patch P9: removed dead `IF v_total IS NULL` /
-- `IF v_limit IS NULL` branches after `COALESCE` (cosmetic cleanup).

CREATE OR REPLACE FUNCTION check_daily_cost_budget(
  p_user_id         uuid,
  p_estimated_cents numeric
) RETURNS TABLE (
  allowed           boolean,
  total_today_cents numeric,
  limit_cents       integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
  v_limit integer;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Read per-user limit; default 100¢ if profile is missing (defensive —
  -- handle_new_user creates profile on signup, but if a Postgres restore
  -- ever leaves a user without a profile row, the cap still works).
  SELECT COALESCE(daily_ai_cost_cents_limit, 100) INTO v_limit
  FROM profiles
  WHERE id = p_user_id;
  v_limit := COALESCE(v_limit, 100);

  -- Read today's cumulative cost (0 if no row yet).
  SELECT COALESCE(total_cost_cents, 0::numeric) INTO v_total
  FROM daily_cost_ledger
  WHERE user_id = p_user_id AND day = v_today;
  v_total := COALESCE(v_total, 0::numeric);

  RETURN QUERY SELECT
    (v_total + p_estimated_cents) <= v_limit::numeric,
    v_total,
    v_limit;
END;
$$;

-- =============================================================================
-- 6. record_daily_cost — post-call atomic increment of today's cost
-- =============================================================================
-- Called AFTER a successful upstream OpenAI/Azure call with the actual cost
-- computed from the response usage object (input + output tokens × per-model
-- rate from supabase/functions/_shared/cost-table.ts).
-- Accepts NUMERIC so fractional sub-cent contributions accumulate accurately.

CREATE OR REPLACE FUNCTION record_daily_cost(
  p_user_id     uuid,
  p_cost_cents  numeric
) RETURNS TABLE (
  total_today_cents numeric
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_total numeric;
BEGIN
  INSERT INTO daily_cost_ledger (user_id, day, total_cost_cents, request_count, last_updated_at)
  VALUES (p_user_id, v_today, p_cost_cents, 1, now())
  ON CONFLICT (user_id, day)
  DO UPDATE SET
    total_cost_cents = daily_cost_ledger.total_cost_cents + p_cost_cents,
    request_count    = daily_cost_ledger.request_count + 1,
    last_updated_at  = now()
  RETURNING daily_cost_ledger.total_cost_cents INTO v_total;

  RETURN QUERY SELECT v_total;
END;
$$;

-- =============================================================================
-- 7. cleanup_stale_rate_limits — nightly cleanup (pg_cron)
-- =============================================================================
-- rate_limit_counters: rows older than 24h are noise (window has long expired)
-- daily_cost_ledger:   rows older than 30d are noise (auditing has been done)
-- REVOKE EXECUTE so only cron/admin can call. Pattern from Story 9-9 hardening.

CREATE OR REPLACE FUNCTION cleanup_stale_rate_limits()
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  DELETE FROM rate_limit_counters
   WHERE window_start < now() - interval '24 hours';
  DELETE FROM daily_cost_ledger
   WHERE day < (now() AT TIME ZONE 'UTC')::date - interval '30 days';
$$;

-- =============================================================================
-- 8. Grants / Revokes
-- =============================================================================
-- User-facing RPCs: callable by authenticated AND service_role (Edge Functions
-- run as service_role; a future client-direct call from authenticated is also
-- safe because the functions take p_user_id as input — but the Edge Function
-- is the canonical caller).

GRANT EXECUTE ON FUNCTION check_and_increment_rate_limit(uuid, text, integer, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_daily_cost_budget(uuid, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION record_daily_cost(uuid, numeric)
  TO authenticated, service_role;

-- Cleanup function: admin/cron only.
REVOKE EXECUTE ON FUNCTION cleanup_stale_rate_limits()
  FROM public, anon, authenticated;

-- =============================================================================
-- 9. Schedule pg_cron nightly cleanup at 02:00 UTC
-- =============================================================================
-- Pattern from Story 8-2 cleanup-notification-log. Low-traffic window.
--
-- Story 11-4 review patch P4: defensive `cron.unschedule` wrapper so a
-- second `supabase db push` against a remote with the job already scheduled
-- doesn't fail on the `cron.job.jobname` unique constraint. The EXCEPTION
-- WHEN OTHERS catches the "job not found" error on fresh installs.

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-rate-limit-and-cost-ledger');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
  'cleanup-rate-limit-and-cost-ledger',
  '0 2 * * *',
  $$SELECT cleanup_stale_rate_limits();$$
);
