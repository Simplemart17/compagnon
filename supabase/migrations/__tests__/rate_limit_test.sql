-- Story 11-4 — Manual SQL test assertions for rate-limit + cost-cap RPCs.
--
-- Run via:
--   psql "$DATABASE_URL" -f supabase/migrations/__tests__/rate_limit_test.sql
--
-- NOT CI-wired. Epic 15.3 owns pgTAP CI integration for SQL functions.
-- This file is a smoke-test for the dev to verify the migration is healthy
-- before pushing to remote. Run inside a transaction that ROLLBACKS at the
-- end so the test data doesn't pollute the database.
--
-- Post-review-round-1 patches:
--   P2 — Rate-limit denial no longer needs rollback because the new UPDATE
--        is guarded by `request_count < p_limit`. The 6th call DOES NOT
--        increment the counter.
--   P3 — Ledger storage is NUMERIC(20,6); sub-cent contributions accumulate
--        accurately. Test #4-#6 use fractional values to confirm.

BEGIN;

-- ─── 1. Seed a test user ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  INSERT INTO profiles (id, daily_ai_cost_cents_limit)
  VALUES (v_test_uid, 100)
  ON CONFLICT (id) DO UPDATE SET daily_ai_cost_cents_limit = EXCLUDED.daily_ai_cost_cents_limit;
END $$;

-- ─── 2. Rate-limit: first 5 calls allowed at limit=5 ─────────────────────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_row record;
  i integer;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO v_row FROM check_and_increment_rate_limit(v_test_uid, 'test-key', 5, 60);
    IF NOT v_row.allowed THEN
      RAISE EXCEPTION 'TEST FAIL: call #% denied at limit=5 (expected allowed)', i;
    END IF;
    IF v_row.remaining != (5 - i) THEN
      RAISE EXCEPTION 'TEST FAIL: call #% returned remaining=%, expected %', i, v_row.remaining, (5 - i);
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST PASS: 5 consecutive allow';
END $$;

-- ─── 3. Rate-limit: 6th call DENIED, request_count stays at 5 (P2 patch) ────
-- The new single-statement UPDATE only fires when `request_count < p_limit`.
-- A denied 6th call does NOT increment the counter (no rollback needed).
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_row record;
  v_count integer;
BEGIN
  SELECT * INTO v_row FROM check_and_increment_rate_limit(v_test_uid, 'test-key', 5, 60);
  IF v_row.allowed THEN
    RAISE EXCEPTION 'TEST FAIL: 6th call allowed at limit=5 (expected denied)';
  END IF;
  IF v_row.remaining != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: denied call returned remaining=%, expected 0', v_row.remaining;
  END IF;

  -- P2 patch: counter stays at 5 (the UPDATE was guarded by < p_limit; no
  -- rollback path because no increment occurred).
  SELECT request_count INTO v_count
  FROM rate_limit_counters
  WHERE user_id = v_test_uid AND key = 'test-key'
  ORDER BY window_start DESC LIMIT 1;
  IF v_count != 5 THEN
    RAISE EXCEPTION 'TEST FAIL: request_count is % after denied call (expected 5 — guard failed)', v_count;
  END IF;
  RAISE NOTICE 'TEST PASS: deny + counter remains at 5 (P2 atomic guard)';
END $$;

-- ─── 4. Cost-cap: default 100¢ limit allows 50¢ + 49¢, denies 50¢ + 51¢ ──────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_row record;
BEGIN
  DELETE FROM daily_cost_ledger WHERE user_id = v_test_uid;

  PERFORM record_daily_cost(v_test_uid, 50::numeric);

  -- Pre-check 49¢ → allowed (50+49 = 99 ≤ 100).
  SELECT * INTO v_row FROM check_daily_cost_budget(v_test_uid, 49::numeric);
  IF NOT v_row.allowed THEN
    RAISE EXCEPTION 'TEST FAIL: pre-check 49¢ on 50¢ existing denied (expected allowed)';
  END IF;
  IF v_row.total_today_cents != 50 OR v_row.limit_cents != 100 THEN
    RAISE EXCEPTION 'TEST FAIL: pre-check totals mismatch (got total=%, limit=%; expected 50/100)',
      v_row.total_today_cents, v_row.limit_cents;
  END IF;

  -- Pre-check 51¢ → denied (50+51 = 101 > 100).
  SELECT * INTO v_row FROM check_daily_cost_budget(v_test_uid, 51::numeric);
  IF v_row.allowed THEN
    RAISE EXCEPTION 'TEST FAIL: pre-check 51¢ on 50¢ existing allowed (expected denied)';
  END IF;
  RAISE NOTICE 'TEST PASS: cost-cap 100¢ default boundary';
END $$;

-- ─── 4b. P3: fractional sub-cent contributions accumulate accurately ─────────
-- The previous BIGINT + Math.ceil pattern inflated 100 embedding calls
-- (0.002¢ each = 0.2¢ real) to 100¢, locking out the user. The new
-- NUMERIC(20,6) column preserves fractional values exactly.
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_total numeric;
  i integer;
BEGIN
  DELETE FROM daily_cost_ledger WHERE user_id = v_test_uid;

  -- 100 embedding-sized contributions of 0.002¢ each.
  FOR i IN 1..100 LOOP
    PERFORM record_daily_cost(v_test_uid, 0.002::numeric);
  END LOOP;

  SELECT total_cost_cents INTO v_total
  FROM daily_cost_ledger
  WHERE user_id = v_test_uid AND day = (now() AT TIME ZONE 'UTC')::date;

  -- Expected: 100 × 0.002 = 0.2¢. NUMERIC(20,6) preserves this exactly.
  -- (Pre-patch: 100¢ due to Math.ceil; would have locked user out.)
  IF v_total != 0.2 THEN
    RAISE EXCEPTION 'TEST FAIL: 100 × 0.002¢ accumulated as % (expected 0.2)', v_total;
  END IF;
  RAISE NOTICE 'TEST PASS: P3 fractional accumulation (0.002 × 100 = 0.2)';
END $$;

-- ─── 5. Cost-cap: per-user override (raise to 500¢ via profiles update) ──────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_row record;
BEGIN
  UPDATE profiles SET daily_ai_cost_cents_limit = 500 WHERE id = v_test_uid;

  -- Existing total = 0.2¢ from test 4b. Now limit = 500¢. Pre-check 400¢ → allowed.
  SELECT * INTO v_row FROM check_daily_cost_budget(v_test_uid, 400::numeric);
  IF NOT v_row.allowed THEN
    RAISE EXCEPTION 'TEST FAIL: pre-check 400¢ with limit=500 denied (expected allowed)';
  END IF;
  IF v_row.limit_cents != 500 THEN
    RAISE EXCEPTION 'TEST FAIL: limit_cents = % (expected 500)', v_row.limit_cents;
  END IF;
  RAISE NOTICE 'TEST PASS: per-user limit override honored';
END $$;

-- ─── 6. record_daily_cost: atomic increment with fractional values ───────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_total numeric;
BEGIN
  DELETE FROM daily_cost_ledger WHERE user_id = v_test_uid;

  PERFORM record_daily_cost(v_test_uid, 10.5::numeric);
  PERFORM record_daily_cost(v_test_uid, 15.25::numeric);
  PERFORM record_daily_cost(v_test_uid, 25.125::numeric);

  SELECT total_cost_cents INTO v_total
  FROM daily_cost_ledger
  WHERE user_id = v_test_uid AND day = (now() AT TIME ZONE 'UTC')::date;

  -- Expected: 10.5 + 15.25 + 25.125 = 50.875
  IF v_total != 50.875 THEN
    RAISE EXCEPTION 'TEST FAIL: total_cost_cents = % after 10.5+15.25+25.125 (expected 50.875)', v_total;
  END IF;
  RAISE NOTICE 'TEST PASS: record_daily_cost fractional atomic increment';
END $$;

-- ─── 7. cleanup_stale_rate_limits: removes 25h-old rows; leaves fresh ────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_old_count integer;
  v_fresh_count integer;
BEGIN
  INSERT INTO rate_limit_counters (user_id, key, window_start, request_count)
  VALUES (v_test_uid, 'cleanup-test', now() - interval '25 hours', 1),
         (v_test_uid, 'cleanup-test', now() - interval '1 hour', 1)
  ON CONFLICT DO NOTHING;

  PERFORM cleanup_stale_rate_limits();

  SELECT COUNT(*) INTO v_old_count
  FROM rate_limit_counters
  WHERE user_id = v_test_uid
    AND key = 'cleanup-test'
    AND window_start < now() - interval '24 hours';

  SELECT COUNT(*) INTO v_fresh_count
  FROM rate_limit_counters
  WHERE user_id = v_test_uid
    AND key = 'cleanup-test'
    AND window_start >= now() - interval '24 hours';

  IF v_old_count != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: cleanup left % stale rows', v_old_count;
  END IF;
  IF v_fresh_count != 1 THEN
    RAISE EXCEPTION 'TEST FAIL: cleanup removed % fresh rows (expected 1 fresh)', v_fresh_count;
  END IF;
  RAISE NOTICE 'TEST PASS: cleanup_stale_rate_limits';
END $$;

-- ─── 8. CRON_SENTINEL_USER_ID flow: cron path uses all-zeros UUID + "cron" key ──
DO $$
DECLARE
  v_sentinel uuid := '00000000-0000-0000-0000-000000000000';
  v_row record;
  i integer;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO v_row FROM check_and_increment_rate_limit(v_sentinel, 'cron', 5, 60);
    IF NOT v_row.allowed THEN
      RAISE EXCEPTION 'TEST FAIL: cron sentinel call #% denied at limit=5', i;
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM check_and_increment_rate_limit(v_sentinel, 'cron', 5, 60);
  IF v_row.allowed THEN
    RAISE EXCEPTION 'TEST FAIL: cron sentinel 6th call allowed at limit=5';
  END IF;
  RAISE NOTICE 'TEST PASS: cron sentinel rate-limit honored';
END $$;

ROLLBACK;

\echo 'All SQL assertions passed (transaction rolled back; no test data persisted).'
