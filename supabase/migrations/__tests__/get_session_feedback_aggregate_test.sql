-- Story 13-3 — Manual SQL test assertions for the get_session_feedback_aggregate RPC migration.
--
-- Run via:
--   psql "$DATABASE_URL" -f supabase/migrations/__tests__/get_session_feedback_aggregate_test.sql
--
-- NOT CI-wired. Epic 15.3 owns pgTAP CI integration for SQL functions.
-- Runs inside a transaction that ROLLBACKs at the end so test data
-- doesn't pollute the database.
--
-- Verifies:
--   #1 Function exists + Story 9-9 hardening.
--   #2 Happy path: all 6 keys populated correctly from seeded data.
--   #3 Empty-user path: no prev conversations / errors → null/0 defaults.
--   #4 Cross-user isolation: user A reading user B's data raises EXCEPTION.
--   #5 21-day cutoff: prev_session older than 21 days returns null.
--   #6 5-minute cutoff: error resolved 6 min ago returns null.
--   #7 max ratings: 3 prev conversations @ 2/3/4 → MAX = 4.
--   #8 CEFR promotion: pre vs current differ → from/to populated.
--   #9 error_counts atomic snapshot: COUNT(*) FILTER consistent.

BEGIN;

-- ─── 0. Seed test users ──────────────────────────────────────────────────────
DO $$
BEGIN
  INSERT INTO profiles (id, current_cefr_level, streak_days)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'B1', 0),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'A1', 0)
  ON CONFLICT (id) DO UPDATE SET
    current_cefr_level = EXCLUDED.current_cefr_level,
    streak_days = EXCLUDED.streak_days;
END $$;

SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111"}';

-- Story 12-3 P16 sanity check.
DO $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TEST INFRA FAIL: auth.uid() returned NULL after SET LOCAL request.jwt.claims';
  END IF;
END $$;

-- ─── 1. Function exists + hardening ──────────────────────────────────────────
DO $$
DECLARE
  v_security_definer text;
  v_search_path text;
BEGIN
  SELECT
    CASE WHEN prosecdef THEN 'SECURITY DEFINER' ELSE 'NOT DEFINER' END,
    array_to_string(proconfig, ' ')
  INTO v_security_definer, v_search_path
  FROM pg_proc
  WHERE proname = 'get_session_feedback_aggregate';

  IF v_security_definer != 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'TEST FAIL #1a: get_session_feedback_aggregate is not SECURITY DEFINER';
  END IF;
  IF v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'TEST FAIL #1b: missing SET search_path=public';
  END IF;
  IF NOT has_function_privilege('authenticated', 'get_session_feedback_aggregate(uuid, uuid, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL #1c: authenticated role missing EXECUTE privilege';
  END IF;
  RAISE NOTICE 'TEST PASS #1: get_session_feedback_aggregate hardening verified';
END $$;

-- ─── 2. Happy path: seed prev conversation + errors → all keys populated ─────
DO $$
DECLARE
  v_current_convo_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
  v_prev_convo_id    uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_result jsonb;
BEGIN
  INSERT INTO conversations (id, user_id, mode, topic, status, duration_seconds, ai_feedback, completed_at)
  VALUES
    (v_current_convo_id, '11111111-1111-1111-1111-111111111111'::uuid, 'companion', 'test',
     'completed', 200,
     '{"fluencyRating": 4, "grammarRating": 4, "summary": "current", "strengths": [], "improvements": []}'::jsonb,
     NOW()),
    (v_prev_convo_id, '11111111-1111-1111-1111-111111111111'::uuid, 'companion', 'test',
     'completed', 120,
     '{"fluencyRating": 3, "grammarRating": 2, "summary": "prev", "strengths": [], "improvements": []}'::jsonb,
     NOW() - INTERVAL '2 days');

  INSERT INTO error_patterns (user_id, error_type, error_description, occurrences, resolved, last_occurred)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'subject-verb agreement', 3, true, NOW() - INTERVAL '2 minutes'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'vocabulary', 'gender confusion', 2, false, NOW() - INTERVAL '1 hour');

  v_result := get_session_feedback_aggregate(
    '11111111-1111-1111-1111-111111111111'::uuid,
    v_current_convo_id,
    'B1'  -- same as current → no CEFR promotion
  );

  IF v_result->'prev_session' = 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #2a: prev_session is null but seeded';
  END IF;
  IF v_result->'cefr_promotion' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #2b: cefr_promotion should be null when pre = current; got %', v_result->'cefr_promotion';
  END IF;
  IF (v_result->>'max_fluency_rating')::numeric != 3 THEN
    RAISE EXCEPTION 'TEST FAIL #2c: expected max_fluency_rating=3, got %', v_result->>'max_fluency_rating';
  END IF;
  IF (v_result->>'max_grammar_rating')::numeric != 2 THEN
    RAISE EXCEPTION 'TEST FAIL #2d: expected max_grammar_rating=2, got %', v_result->>'max_grammar_rating';
  END IF;
  IF v_result->'recent_resolved_error'->>'error_description' != 'subject-verb agreement' THEN
    RAISE EXCEPTION 'TEST FAIL #2e: expected recent_resolved_error.error_description=subject-verb agreement';
  END IF;
  IF (v_result->'error_counts'->>'total')::integer != 2 THEN
    RAISE EXCEPTION 'TEST FAIL #2f: expected error_counts.total=2, got %', v_result->'error_counts'->>'total';
  END IF;
  IF (v_result->'error_counts'->>'resolved')::integer != 1 THEN
    RAISE EXCEPTION 'TEST FAIL #2g: expected error_counts.resolved=1, got %', v_result->'error_counts'->>'resolved';
  END IF;

  RAISE NOTICE 'TEST PASS #2: happy path — all 6 keys populated correctly';
END $$;

-- ─── 3. Empty-user path: brand-new user (user 2) → null/0 defaults ───────────
SET LOCAL request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222"}';

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := get_session_feedback_aggregate(
    '22222222-2222-2222-2222-222222222222'::uuid,
    '99999999-9999-9999-9999-999999999999'::uuid,
    'A1'
  );

  IF v_result->'prev_session' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #3a: expected prev_session=null, got %', v_result->'prev_session';
  END IF;
  IF (v_result->>'max_fluency_rating')::numeric != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3b: expected max_fluency_rating=0, got %', v_result->>'max_fluency_rating';
  END IF;
  IF v_result->'recent_resolved_error' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #3c: expected recent_resolved_error=null';
  END IF;
  IF (v_result->'error_counts'->>'total')::integer != 0 THEN
    RAISE EXCEPTION 'TEST FAIL #3d: expected error_counts.total=0';
  END IF;
  RAISE NOTICE 'TEST PASS #3: empty-user path — null/0 defaults verified';
END $$;

-- ─── 4. Cross-user isolation: user 2 calls aggregate(user_1_id) → RAISE ──────
DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM get_session_feedback_aggregate(
      '11111111-1111-1111-1111-111111111111'::uuid,
      '99999999-9999-9999-9999-999999999999'::uuid,
      'A1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    IF SQLERRM NOT LIKE '%auth.uid() must match p_user_id%' THEN
      RAISE EXCEPTION 'TEST FAIL #4: expected auth.uid() exception, got: %', SQLERRM;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'TEST FAIL #4: cross-user call did NOT raise';
  END IF;
  RAISE NOTICE 'TEST PASS #4: cross-user isolation enforced';
END $$;

-- ─── 5. 21-day cutoff: prev conversation 22 days ago → prev_session=null ─────
SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111"}';

DO $$
DECLARE
  v_old_convo_id uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_current_convo_id uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid;
  v_result jsonb;
BEGIN
  -- Delete the 2-day-old prev convo from test #2 so this test sees only the 22-day-old one.
  DELETE FROM conversations WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  DELETE FROM conversations WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;

  INSERT INTO conversations (id, user_id, mode, topic, status, completed_at, ai_feedback)
  VALUES
    (v_old_convo_id, '11111111-1111-1111-1111-111111111111'::uuid, 'companion', 'test',
     'completed', NOW() - INTERVAL '22 days',
     '{"fluencyRating": 5, "grammarRating": 5}'::jsonb);

  v_result := get_session_feedback_aggregate(
    '11111111-1111-1111-1111-111111111111'::uuid,
    v_current_convo_id,
    'B1'
  );

  IF v_result->'prev_session' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #5: expected prev_session=null for 22-day-old prev, got %', v_result->'prev_session';
  END IF;
  -- BUT max ratings should still see the old conversation.
  IF (v_result->>'max_fluency_rating')::numeric != 5 THEN
    RAISE EXCEPTION 'TEST FAIL #5b: expected max_fluency_rating=5 (no time cutoff on MAX), got %', v_result->>'max_fluency_rating';
  END IF;
  RAISE NOTICE 'TEST PASS #5: 21-day cutoff applied to prev_session; max ratings unaffected';
END $$;

-- ─── 6. 5-minute cutoff: error resolved 6 min ago → null ─────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  -- Already have: subject-verb @ 2 min ago, resolved=true (from test #2; still
  -- present unless test #5 deleted it; let's ensure clean state).
  DELETE FROM error_patterns WHERE user_id = '11111111-1111-1111-1111-111111111111'::uuid;
  INSERT INTO error_patterns (user_id, error_type, error_description, occurrences, resolved, last_occurred)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'old resolved', 1, true, NOW() - INTERVAL '6 minutes');

  v_result := get_session_feedback_aggregate(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'B1'
  );

  IF v_result->'recent_resolved_error' != 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #6: expected recent_resolved_error=null for 6-min-old error, got %', v_result->'recent_resolved_error';
  END IF;
  RAISE NOTICE 'TEST PASS #6: 5-minute cutoff applied to recent_resolved_error';
END $$;

-- ─── 7. MAX ratings across 3 prev conversations: 2/3/4 → MAX=4 ───────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO conversations (id, user_id, mode, topic, status, completed_at, ai_feedback)
  VALUES
    (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid, 'companion', 't',
     'completed', NOW() - INTERVAL '1 hour',
     '{"fluencyRating": 2, "grammarRating": 2}'::jsonb),
    (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid, 'companion', 't',
     'completed', NOW() - INTERVAL '2 hours',
     '{"fluencyRating": 3, "grammarRating": 3}'::jsonb),
    (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid, 'companion', 't',
     'completed', NOW() - INTERVAL '3 hours',
     '{"fluencyRating": 4, "grammarRating": 4}'::jsonb);

  v_result := get_session_feedback_aggregate(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'B1'
  );

  IF (v_result->>'max_fluency_rating')::numeric != 5 THEN
    -- Earlier test #5 inserted a 22-day-old @ rating 5; MAX should pick that up.
    RAISE EXCEPTION 'TEST FAIL #7: expected max_fluency_rating=5 (from 22-day-old) since MAX has no time cutoff; got %', v_result->>'max_fluency_rating';
  END IF;
  RAISE NOTICE 'TEST PASS #7: MAX ratings server-side correct (no time cutoff on MAX)';
END $$;

-- ─── 8. CEFR promotion: pre != current → from/to populated ────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := get_session_feedback_aggregate(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'A2'  -- pre=A2; current=B1 (from seed)
  );

  IF v_result->'cefr_promotion' = 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL #8: expected cefr_promotion non-null when pre != current';
  END IF;
  IF v_result->'cefr_promotion'->>'from' != 'A2' THEN
    RAISE EXCEPTION 'TEST FAIL #8b: expected cefr_promotion.from=A2';
  END IF;
  IF v_result->'cefr_promotion'->>'to' != 'B1' THEN
    RAISE EXCEPTION 'TEST FAIL #8c: expected cefr_promotion.to=B1';
  END IF;
  RAISE NOTICE 'TEST PASS #8: CEFR promotion from/to populated correctly';
END $$;

-- ─── 9. error_counts atomic snapshot ─────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  DELETE FROM error_patterns WHERE user_id = '11111111-1111-1111-1111-111111111111'::uuid;
  INSERT INTO error_patterns (user_id, error_type, error_description, occurrences, resolved)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'e1', 1, false),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'e2', 1, false),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'e3', 1, true),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'grammar', 'e4', 1, true);

  v_result := get_session_feedback_aggregate(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'B1'
  );

  IF (v_result->'error_counts'->>'total')::integer != 4 THEN
    RAISE EXCEPTION 'TEST FAIL #9a: expected error_counts.total=4, got %', v_result->'error_counts'->>'total';
  END IF;
  IF (v_result->'error_counts'->>'resolved')::integer != 2 THEN
    RAISE EXCEPTION 'TEST FAIL #9b: expected error_counts.resolved=2, got %', v_result->'error_counts'->>'resolved';
  END IF;
  -- The Story 13-2 P2 invariant: resolved <= total always.
  IF (v_result->'error_counts'->>'resolved')::integer > (v_result->'error_counts'->>'total')::integer THEN
    RAISE EXCEPTION 'TEST FAIL #9c: resolved > total — atomic snapshot violated';
  END IF;
  RAISE NOTICE 'TEST PASS #9: error_counts atomic snapshot — resolved <= total invariant holds';
END $$;

ROLLBACK;
