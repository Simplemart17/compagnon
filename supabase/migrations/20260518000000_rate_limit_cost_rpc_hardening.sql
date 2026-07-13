-- =============================================================================
-- Rate-limit + daily-cost RPC hardening (security + financial)
-- =============================================================================
-- CLOSES a real cost-control bypass in 20260512000000_rate_limit_and_cost_ledger.sql.
--
-- Pre-hardening, `check_and_increment_rate_limit` / `check_daily_cost_budget` /
-- `record_daily_cost` were `GRANT EXECUTE ... TO authenticated` with NO
-- `auth.uid()` guard and NO non-negative clamp. Because the anon key is public
-- and signup is open, any authenticated user could invoke these RPCs directly
-- via PostgREST (`POST /rest/v1/rpc/record_daily_cost`) with the user's JWT and:
--
--   (1) `record_daily_cost(<self>, -99999)` → drive their own ledger negative →
--       PERMANENT daily-AI-spend-cap bypass, billed to the operator's
--       OpenAI/Azure account (`total_cost_cents + p_cost_cents`, no floor).
--   (2) `record_daily_cost(<victim>, 99999)` / `check_and_increment_rate_limit(
--       <victim>, 'ai-proxy', ...)` → grief another user into a spend/rate
--       lockout with a forged `p_user_id`.
--
-- The original migration comment asserted this was "safe because the functions
-- take p_user_id as input" — that reasoning was wrong.
--
-- FIX (defense-in-depth, no Edge Function changes required):
--   (a) auth.uid() guard on all 3 — blocks cross-user forging. The guard is
--       written `auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id`
--       (NOT the stricter `IS DISTINCT FROM` used by the atomic-activity RPCs in
--       20260514000000) because `send-notifications` calls
--       `check_and_increment_rate_limit` with a SERVICE-ROLE client + the cron
--       sentinel user id (00000000-...), where `auth.uid()` resolves to NULL.
--       Permitting the NULL (service-role) caller keeps the notification cron
--       working while still blocking any authenticated user from forging a
--       different p_user_id.
--   (b) GREATEST(0, ...) clamp on the cost params — a negative contribution can
--       no longer drive the ledger down. Legitimate costs are always positive,
--       so this is a no-op for real calls.
--
-- Function bodies are reproduced verbatim from 20260512000000 (concurrency logic
-- byte-identical) with ONLY the guard + clamp prepended after BEGIN.
-- SECURITY DEFINER + SET search_path = public preserved (Story 9-9 hardening).

-- -----------------------------------------------------------------------------
-- check_and_increment_rate_limit
-- -----------------------------------------------------------------------------
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
  -- Hardening: block authenticated users from forging another user's counter.
  -- Service-role callers (cron / send-notifications) have auth.uid() = NULL and
  -- are permitted (they legitimately pass the cron sentinel user id).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

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

  -- (b) Row exists. Conditionally UPDATE only when below limit. Concurrent
  --     UPDATEs serialize on the row lock; at most p_limit increments succeed,
  --     and the (p_limit+1)th caller sees RETURNING return NULL.
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

-- -----------------------------------------------------------------------------
-- check_daily_cost_budget
-- -----------------------------------------------------------------------------
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
  -- Hardening: block cross-user forging (service-role NULL auth.uid permitted).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Hardening: a negative estimate must not trivially pass the pre-check.
  p_estimated_cents := GREATEST(0::numeric, p_estimated_cents);

  -- Read per-user limit; default 100¢ if profile is missing (defensive).
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

-- -----------------------------------------------------------------------------
-- record_daily_cost
-- -----------------------------------------------------------------------------
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
  -- Hardening: block cross-user forging (service-role NULL auth.uid permitted).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Hardening: clamp non-negative. A negative contribution can no longer drive
  -- the ledger down and bypass the daily spend cap. Real costs are positive.
  p_cost_cents := GREATEST(0::numeric, p_cost_cents);

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
