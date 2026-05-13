-- Story 11-6 — Manual SQL test assertions for `match_error_pattern` RPC.
--
-- Run via:
--   psql "$DATABASE_URL" -f supabase/migrations/__tests__/match_error_pattern_test.sql
--
-- NOT CI-wired. Epic 15.3 owns pgTAP CI integration for SQL functions. This
-- file is a smoke-test for the dev to verify the migration is healthy before
-- pushing to remote. Runs inside a transaction that ROLLBACKS at the end so
-- the test data doesn't pollute the database.
--
-- The RPC uses `auth.uid()` for user scope. Since direct psql sessions don't
-- have a real authenticated session, we use the `SET LOCAL request.jwt.claim.sub`
-- pattern to stub `auth.uid()` for the duration of the transaction (mirrors
-- the Supabase test convention).
--
-- Coverage:
--   1. Function exists with SECURITY DEFINER + SET search_path = public
--   2. Returns 0 rows when no error_patterns row exists for the user
--   3. Returns 1 row when an embedding row exists with cosine > 0.85
--   4. STRICT boundary: cosine === 0.85 is NOT a match
--   5. Arm 2: legacy NULL-embedding row + exact-string match → row returned
--   6. Excludes resolved=TRUE rows
--   7. Cross-user isolation (auth.uid() filter)
--
-- Review-round-1 patches:
--   P3 — Use the correct JWT claims setting key. Supabase's `auth.uid()`
--        reads `current_setting('request.jwt.claims', true)::json->>'sub'`,
--        NOT `request.jwt.claim.sub`. The wrong key was leaving auth.uid()
--        returning NULL → every test ran unscoped → test 7 (cross-user
--        isolation) was passing vacuously.
--   P9 — Test 7 now asserts which user_id row was returned, not just the
--        count. Catches the inverted-isolation false-positive case.

BEGIN;

-- ─── 0. Stub a test user via JWT claim (P3 — correct setting key) ───────────
-- The `match_error_pattern` RPC calls `auth.uid()` which Supabase implements
-- by reading the `sub` field from the `request.jwt.claims` JSON setting.
-- The setting must be a JSON-stringified object, not a sub-key on its own.

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- Ensure test user profile exists (FK from error_patterns.user_id)
  INSERT INTO profiles (id) VALUES (v_test_uid) ON CONFLICT (id) DO NOTHING;
END $$;

-- ─── 1. Function exists with proper hardening ───────────────────────────────
DO $$
DECLARE
  v_security text;
  v_search_path text;
BEGIN
  SELECT
    CASE WHEN prosecdef THEN 'definer' ELSE 'invoker' END,
    array_to_string(proconfig, ',')
  INTO v_security, v_search_path
  FROM pg_proc
  WHERE proname = 'match_error_pattern';

  IF v_security IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: match_error_pattern does not exist';
  END IF;
  IF v_security != 'definer' THEN
    RAISE EXCEPTION 'TEST FAIL: expected SECURITY DEFINER, got %', v_security;
  END IF;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'TEST FAIL: SET search_path = public missing (got: %)', v_search_path;
  END IF;
  RAISE NOTICE 'TEST 1 PASS: function exists with SECURITY DEFINER + search_path=public';
END $$;

-- ─── 2. Empty case: no rows ─────────────────────────────────────────────────
DO $$
DECLARE
  v_count integer;
  v_zero_embedding text;
BEGIN
  -- Build a zero-vector as the query embedding (1536 zeros)
  v_zero_embedding := '[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']';

  SELECT count(*) INTO v_count
  FROM match_error_pattern('grammar', 'nonexistent', v_zero_embedding::vector, 0.85);

  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 0 rows for empty table, got %', v_count;
  END IF;
  RAISE NOTICE 'TEST 2 PASS: empty result on no candidate rows';
END $$;

-- ─── 3. Arm 1: embedding row with cosine > 0.85 → MATCH ─────────────────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_embedding text;
  v_count integer;
  v_similarity float;
BEGIN
  -- Build a normalized unit vector: [1, 0, 0, ...]
  v_embedding := '[1' || repeat(',0', 1535) || ']';

  -- Insert a row with this exact embedding
  INSERT INTO error_patterns (user_id, error_type, error_description, embedding)
  VALUES (v_test_uid, 'grammar', 'passé composé confusion', v_embedding::vector);

  -- Query with the SAME embedding → cosine similarity = 1.0 → STRICTLY > 0.85
  SELECT count(*), max(similarity)
  INTO v_count, v_similarity
  FROM match_error_pattern('grammar', 'different description', v_embedding::vector, 0.85);

  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 1 match for identical embedding, got %', v_count;
  END IF;
  IF v_similarity < 0.999 THEN
    RAISE EXCEPTION 'TEST FAIL: expected similarity ~1.0, got %', v_similarity;
  END IF;
  RAISE NOTICE 'TEST 3 PASS: embedding cosine match (similarity=%)', v_similarity;
END $$;

-- ─── 4. STRICT boundary: cosine === 0.85 → NO match ─────────────────────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_existing_embedding text;
  v_query_embedding text;
  v_count integer;
BEGIN
  -- Clean prior test rows for this assertion
  DELETE FROM error_patterns WHERE user_id = v_test_uid AND error_type = 'vocabulary';

  -- Existing row's embedding: [1, 0, 0, ...]
  v_existing_embedding := '[1' || repeat(',0', 1535) || ']';
  -- Query embedding tuned so cosine(existing, query) = exactly 0.85
  -- For unit vectors a=[1,0,...] and b=[0.85, sqrt(1-0.85²), 0,...], cos = 0.85.
  -- sqrt(1 - 0.7225) = sqrt(0.2775) ≈ 0.5267827...
  v_query_embedding := '[0.85,0.52678271075393714' || repeat(',0', 1534) || ']';

  INSERT INTO error_patterns (user_id, error_type, error_description, embedding)
  VALUES (v_test_uid, 'vocabulary', 'boundary case', v_existing_embedding::vector);

  -- Expect zero matches: 0.85 > 0.85 is FALSE (strict comparison).
  SELECT count(*) INTO v_count
  FROM match_error_pattern('vocabulary', 'other', v_query_embedding::vector, 0.85);

  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: boundary 0.85 should NOT match (strict >), but matched %', v_count;
  END IF;
  RAISE NOTICE 'TEST 4 PASS: boundary 0.85 exclusion (strict greater-than)';
END $$;

-- ─── 5. Arm 2: legacy NULL-embedding row + exact-string match ──────────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_query_embedding text;
  v_count integer;
  v_similarity float;
BEGIN
  -- Insert a LEGACY-style row with NULL embedding
  INSERT INTO error_patterns (user_id, error_type, error_description, embedding)
  VALUES (v_test_uid, 'register', 'tu/vous mixup', NULL);

  -- Query with any embedding + EXACT string match → Arm 2 fires
  v_query_embedding := '[0.5' || repeat(',0', 1535) || ']';

  SELECT count(*), max(similarity)
  INTO v_count, v_similarity
  FROM match_error_pattern('register', 'tu/vous mixup', v_query_embedding::vector, 0.85);

  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST FAIL: expected Arm-2 string-match, got % rows', v_count;
  END IF;
  IF v_similarity != 1.0 THEN
    RAISE EXCEPTION 'TEST FAIL: Arm-2 string-match similarity should be 1.0, got %', v_similarity;
  END IF;
  RAISE NOTICE 'TEST 5 PASS: legacy NULL-embedding string-equality fallback';
END $$;

-- ─── 6. Excludes resolved=TRUE rows ─────────────────────────────────────────
DO $$
DECLARE
  v_test_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_embedding text;
  v_count integer;
BEGIN
  v_embedding := '[1' || repeat(',0', 1535) || ']';

  -- Insert a resolved row that would otherwise match
  INSERT INTO error_patterns (user_id, error_type, error_description, embedding, resolved)
  VALUES (v_test_uid, 'pronunciation', 'resolved-pattern', v_embedding::vector, TRUE);

  SELECT count(*) INTO v_count
  FROM match_error_pattern('pronunciation', 'resolved-pattern', v_embedding::vector, 0.85);

  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: resolved=TRUE row should be excluded, got % rows', v_count;
  END IF;
  RAISE NOTICE 'TEST 6 PASS: resolved=TRUE rows excluded';
END $$;

-- ─── 7. Cross-user isolation via auth.uid() ─────────────────────────────────
-- P9: assert which user_id row was actually returned, not just the count.
-- Defends against the inverted-isolation false-positive case (count=1 because
-- only the cross-user row leaked).
DO $$
DECLARE
  v_test_uid  uuid := '11111111-1111-1111-1111-111111111111';
  v_other_uid uuid := '22222222-2222-2222-2222-222222222222';
  v_embedding text;
  v_returned_id          uuid;
  v_returned_occurrences integer;
  v_row_count            integer;
  v_returned_user_id     uuid;
BEGIN
  -- Other user's row that would otherwise match the active session's query
  INSERT INTO profiles (id) VALUES (v_other_uid) ON CONFLICT (id) DO NOTHING;
  v_embedding := '[1' || repeat(',0', 1535) || ']';
  INSERT INTO error_patterns (user_id, error_type, error_description, embedding)
  VALUES (v_other_uid, 'grammar', 'cross-user-test', v_embedding::vector);

  -- Active session is still user 11111... → must NOT see the other user's row.
  -- Use the RPC's returned id to fetch the row's user_id and assert ownership.
  SELECT id, occurrences INTO v_returned_id, v_returned_occurrences
  FROM match_error_pattern('grammar', 'cross-user-test', v_embedding::vector, 0.85)
  LIMIT 1;

  SELECT count(*) INTO v_row_count
  FROM match_error_pattern('grammar', 'cross-user-test', v_embedding::vector, 0.85);

  -- We expect 1 row (the TEST 3 row for the active user, which also uses the
  -- same 'grammar' + [1,0,0,...] embedding). The cross-user row from 22222...
  -- must NOT be counted.
  IF v_row_count > 1 THEN
    RAISE EXCEPTION 'TEST FAIL: cross-user isolation broken; saw % rows', v_row_count;
  END IF;

  -- P9: verify which user owns the returned row. If isolation inverted (only
  -- the other-user row leaked), the count would still be 1 but the ownership
  -- check below catches it.
  IF v_returned_id IS NOT NULL THEN
    SELECT user_id INTO v_returned_user_id FROM error_patterns WHERE id = v_returned_id;
    IF v_returned_user_id != v_test_uid THEN
      RAISE EXCEPTION 'TEST FAIL: cross-user isolation INVERTED — returned row owned by %, expected %',
        v_returned_user_id, v_test_uid;
    END IF;
  END IF;

  RAISE NOTICE 'TEST 7 PASS: cross-user isolation via auth.uid() (returned row owned by active user)';
END $$;

ROLLBACK;
