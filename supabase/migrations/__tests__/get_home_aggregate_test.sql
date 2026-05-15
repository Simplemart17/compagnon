-- Story 13-2 — Manual SQL test assertions for the get_home_aggregate RPC migration.
--
-- Run via:
--   psql "$DATABASE_URL" -f supabase/migrations/__tests__/get_home_aggregate_test.sql
--
-- NOT CI-wired. Epic 15.3 owns pgTAP CI integration for SQL functions.
-- This file is a smoke-test for the dev to verify the migration is healthy
-- before pushing to remote. Runs inside a transaction that ROLLBACKs at the
-- end so the test data doesn't pollute the database.
--
-- Verifies:
--   #1 Function exists + Story 9-9 hardening (SECURITY DEFINER, search_path,
--      GRANT EXECUTE TO authenticated).
--   #2 Happy path: seeded user → all 9 JSONB keys populated correctly.
--   #3 Empty-user path: brand-new user with no rows → empty arrays + null
--      weakest_skill + 0 counts (no NULL crashes).
--   #4 Cross-user isolation: user A calling get_home_aggregate(user_B_id)
--      raises EXCEPTION (auth.uid defense-in-depth).
--   #5 weakest_skill lowest-score-wins: 3 skills @ scores 50/60/70 → returns 50.
--   #6 top_errors ORDER BY occurrences DESC: 5 errors @ 1/2/3/4/5 → returns [5,4,3,2,1].
--   #7 recent_activity LIMIT 7: 10 activity rows → returns most-recent 7.

BEGIN;

-- ─── 0. Seed test users ──────────────────────────────────────────────────────
-- Two distinct UUIDs so the cross-user defense test (#4) is meaningful.
DO $$
BEGIN
  INSERT INTO profiles (id, current_cefr_level, streak_days, last_active_date)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'A1', 7, CURRENT_DATE),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'A1', 0, NULL)
  ON CONFLICT (id) DO UPDATE SET
    current_cefr_level = EXCLUDED.current_cefr_level,
    streak_days = EXCLUDED.streak_days,
    last_active_date = EXCLUDED.last_active_date;
END $$;

-- Set JWT auth context to user-1 for the rest of the tests.
SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111"}';

-- Sanity-check (mirrors Story 12-3 P16 lesson): if auth.uid() returns NULL,
-- the cross-user defense test (#4) would pass vacuously.
DO $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TEST INFRA FAIL: auth.uid() returned NULL after SET LOCAL request.jwt.claims';
  END IF;
END $$;

-- ─── 1. Function exists + Story 9-9 hardening ──────────────────────────────
DO $$
DECLARE
  v_security_definer text;
  v_search_path text;
  v_grant_count integer;
BEGIN
  SELECT
    CASE WHEN prosecdef THEN 'SECURITY DEFINER' ELSE 'NOT DEFINER' END,
    array_to_string(proconfig, ' ')
  INTO v_security_definer, v_search_path
  FROM pg_proc
  WHERE proname = 'get_home_aggregate';

  IF v_security_definer != 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'TEST FAIL #1a: get_home_aggregate is not SECURITY DEFINER';
  END IF;

  IF v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'TEST FAIL #1b: get_home_aggregate is missing SET search_path=public';
  END IF;

  -- GRANT EXECUTE TO authenticated is verified via has_function_privilege.
  IF NOT has_function_privilege('authenticated', 'get_home_aggregate(uuid, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL #1c: authenticated role is missing EXECUTE privilege on get_home_aggregate';
  END IF;

  RAISE NOTICE 'TEST PASS #1: get_home_aggregate hardening (SECURITY DEFINER + search_path + GRANT EXECUTE)';
END $$;

-- ─── 2. Happy path: seeded user → all 9 keys populated ───────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  -- Seed 1 skill + 1 activity row + 2 errors + 1 vocabulary row.
  INSERT INTO skill_progress (user_id, skill, cefr_level, score, exercises_completed, total_time_minutes)
  VALUES ('11111111-1111-1111-1111-111111111111'::uuid, 'listening', 'B1', 75, 12, 60);

  INSERT INTO daily_activity (user_id, date, minutes_practiced, exercises_completed)
  VALUES ('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE, 20, 3);

  INSERT INTO error_patterns (user_id, error_type, error_description, occurrences, resolved)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'subject-verb agreement', 5, false),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'vocabulary', 'gender confusion', 3, false);

  INSERT INTO vocabulary (user_id, french_word, english_translation, cefr_level, next_review)
  VALUES ('11111111-1111-1111-1111-111111111111'::uuid, 'bonjour', 'hello', 'A1', NOW() - INTERVAL '1 hour');

  v_result := get_home_aggregate('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE);

  -- Assert all 9 top-level keys present.
  IF NOT (v_result ? 'skills' AND v_result ? 'daily_activity_today' AND v_result ? 'recent_activity'
       AND v_result ? 'top_errors' AND v_result ? 'streak_days' AND v_result ? 'weakest_skill'
       AND v_result ? 'srs_due_count' AND v_result ? 'error_counts' AND v_result ? 'has_activity_today') THEN
    RAISE EXCEPTION 'TEST FAIL #2a: get_home_aggregate missing one or more required keys: %', v_result;
  END IF;

  -- Skills array has 1 entry.
  IF jsonb_array_length(v_result->'skills') != 1 THEN
    RAISE EXCEPTION 'TEST FAIL #2b: expected skills.length=1, got %', jsonb_array_length(v_result->'skills');
  END IF;

  -- top_errors has 2 entries.
  IF jsonb_array_length(v_result->'top_errors') != 2 THEN
    RAISE EXCEPTION 'TEST FAIL #2c: expected top_errors.length=2, got %', jsonb_array_length(v_result->'top_errors');
  END IF;

  -- streak_days = 7 (seeded above).
  IF (v_result->>'streak_days')::integer != 7 THEN
    RAISE EXCEPTION 'TEST FAIL #2d: expected streak_days=7, got %', v_result->>'streak_days';
  END IF;

  -- srs_due_count = 1.
  IF (v_result->>'srs_due_count')::integer != 1 THEN
    RAISE EXCEPTION 'TEST FAIL #2e: expected srs_due_count=1, got %', v_result->>'srs_due_count';
  END IF;

  -- has_activity_today = true.
  IF (v_result->>'has_activity_today')::boolean != true THEN
    RAISE EXCEPTION 'TEST FAIL #2f: expected has_activity_today=true, got %', v_result->>'has_activity_today';
  END IF;

  -- error_counts.total = 2, resolved = 0.
  IF (v_result->'error_counts'->>'total')::integer != 2
     OR (v_result->'error_counts'->>'resolved')::integer != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #2g: expected error_counts={total:2, resolved:0}, got %', v_result->'error_counts';
  END IF;

  RAISE NOTICE 'TEST PASS #2: happy path — all 9 keys populated correctly';
END $$;

-- ─── 3. Empty-user path: brand-new user → no NULL crashes ────────────────────
-- Switch JWT to user-2 for this section.
SET LOCAL request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222"}';

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := get_home_aggregate('22222222-2222-2222-2222-222222222222'::uuid, CURRENT_DATE);

  -- Empty arrays.
  IF jsonb_array_length(v_result->'skills') != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3a: expected empty skills array, got %', v_result->'skills';
  END IF;
  IF jsonb_array_length(v_result->'recent_activity') != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3b: expected empty recent_activity, got %', v_result->'recent_activity';
  END IF;
  IF jsonb_array_length(v_result->'top_errors') != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3c: expected empty top_errors, got %', v_result->'top_errors';
  END IF;

  -- null daily_activity_today + weakest_skill.
  IF v_result->'daily_activity_today' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #3d: expected daily_activity_today=null, got %', v_result->'daily_activity_today';
  END IF;
  IF v_result->'weakest_skill' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #3e: expected weakest_skill=null, got %', v_result->'weakest_skill';
  END IF;

  -- 0 counts.
  IF (v_result->>'streak_days')::integer != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3f: expected streak_days=0, got %', v_result->>'streak_days';
  END IF;
  IF (v_result->>'srs_due_count')::integer != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3g: expected srs_due_count=0, got %', v_result->>'srs_due_count';
  END IF;
  IF (v_result->>'has_activity_today')::boolean != false THEN
    RAISE EXCEPTION 'TEST FAIL #3h: expected has_activity_today=false, got %', v_result->>'has_activity_today';
  END IF;

  RAISE NOTICE 'TEST PASS #3: empty-user path — no NULL crashes, all defaults populated';
END $$;

-- ─── 4. Cross-user isolation: user-2 attempts to read user-1 → RAISE ─────────
DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM get_home_aggregate('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    IF SQLERRM NOT LIKE '%auth.uid() must match p_user_id%' THEN
      RAISE EXCEPTION 'TEST FAIL #4: expected auth.uid() exception, got: %', SQLERRM;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'TEST FAIL #4: cross-user call did NOT raise — defense-in-depth check failed';
  END IF;
  RAISE NOTICE 'TEST PASS #4: cross-user isolation — auth.uid() defense-in-depth fires correctly';
END $$;

-- Back to user-1 JWT for #5-#7.
SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111"}';

-- ─── 5. weakest_skill ordering: 3 skills @ 50/60/70 → returns 50 ────────────
DO $$
DECLARE
  v_result jsonb;
  v_weakest_score integer;
BEGIN
  INSERT INTO skill_progress (user_id, skill, cefr_level, score, exercises_completed)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'reading', 'A2', 60, 5),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'writing', 'A1', 50, 3);
  -- 'listening' @ 75 was seeded in test #2.

  v_result := get_home_aggregate('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE);
  v_weakest_score := (v_result->'weakest_skill'->>'average_score')::integer;

  IF v_weakest_score != 50 THEN
    RAISE EXCEPTION 'TEST FAIL #5: expected weakest_skill.average_score=50, got %', v_weakest_score;
  END IF;

  IF v_result->'weakest_skill'->>'skill' != 'writing' THEN
    RAISE EXCEPTION 'TEST FAIL #5b: expected weakest_skill.skill=writing, got %', v_result->'weakest_skill'->>'skill';
  END IF;

  RAISE NOTICE 'TEST PASS #5: weakest_skill ordering — lowest-score wins (writing @ 50)';
END $$;

-- ─── 6. top_errors ORDER BY occurrences DESC ─────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_first_occ integer;
BEGIN
  -- Add 3 more errors so we have 5 unresolved total with occurrences 5/3/1/2/4.
  -- (Test #2 seeded 2 errors with occurrences 5 and 3.)
  INSERT INTO error_patterns (user_id, error_type, error_description, occurrences, resolved)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'wrong tense', 1, false),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'preposition', 2, false),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'article', 4, false);

  v_result := get_home_aggregate('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE);

  IF jsonb_array_length(v_result->'top_errors') != 5 THEN
    RAISE EXCEPTION 'TEST FAIL #6a: expected top_errors.length=5, got %', jsonb_array_length(v_result->'top_errors');
  END IF;

  -- First entry should be the highest-occurrence (5).
  v_first_occ := (v_result->'top_errors'->0->>'occurrences')::integer;
  IF v_first_occ != 5 THEN
    RAISE EXCEPTION 'TEST FAIL #6b: expected first top_error.occurrences=5, got %', v_first_occ;
  END IF;

  -- Last entry should be the lowest-occurrence (1).
  IF ((v_result->'top_errors'->(jsonb_array_length(v_result->'top_errors') - 1))->>'occurrences')::integer != 1 THEN
    RAISE EXCEPTION 'TEST FAIL #6c: expected last top_error.occurrences=1';
  END IF;

  RAISE NOTICE 'TEST PASS #6: top_errors ordering — [5,4,3,2,1] descending';
END $$;

-- ─── 7. recent_activity LIMIT 7 ──────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  i integer;
BEGIN
  -- Seed 9 more daily_activity rows for past dates (test #2 has 1 for today).
  -- Total: 10 rows. RPC should return 7.
  FOR i IN 1..9 LOOP
    INSERT INTO daily_activity (user_id, date, minutes_practiced)
    VALUES ('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE - i, 10 + i);
  END LOOP;

  v_result := get_home_aggregate('11111111-1111-1111-1111-111111111111'::uuid, CURRENT_DATE);

  IF jsonb_array_length(v_result->'recent_activity') != 7 THEN
    RAISE EXCEPTION 'TEST FAIL #7a: expected recent_activity.length=7, got %', jsonb_array_length(v_result->'recent_activity');
  END IF;

  -- Most recent should be today (CURRENT_DATE).
  IF v_result->'recent_activity'->0->>'date' != CURRENT_DATE::text THEN
    RAISE EXCEPTION 'TEST FAIL #7b: expected recent_activity[0].date=today, got %', v_result->'recent_activity'->0->>'date';
  END IF;

  RAISE NOTICE 'TEST PASS #7: recent_activity LIMIT 7 — most-recent-first ordering verified';
END $$;

ROLLBACK;
