-- Story 13-3: get_session_feedback_aggregate RPC — closes audit P2-4.
--
-- Pre-13-3 `app/(tabs)/conversation/[sessionId].tsx:242-461` fires 4
-- useEffect blocks when `conversation.feedback` arrives. Each effect
-- runs 1-3 queries against Supabase:
--   - Effect 1 (session comparison): 1 query — prev conversation.
--   - Effect 2 (milestone detection): 3 queries — profile.current_cefr_level,
--     ALL previous conversations.ai_feedback (UNBOUNDED — the audit's
--     worst case: 200+ JSONBs over the wire to compute 2 scalars),
--     recent resolved error pattern.
--   - Effect 3 (error journey counts): 2 queries — total + resolved
--     COUNT(*) (race-prone: concurrent UPDATE could produce resolved
--     > total; identical to Story 13-2 P2).
--   - Effect 4 (next action): 0 queries (pure computation).
-- Total: 6 queries per feedback arrival.
--
-- This migration adds ONE read-only function that consolidates the 6
-- queries into a single JSONB-returning RPC. Critical improvements:
--
--   1. Server-side MAX scalars replace the unbounded conversations.select
--      query. Returns 2 numbers instead of N JSONBs.
--   2. Server-side 21-day + 5-minute cutoffs (pre-13-3 was client-side
--      filter-after-fetch).
--   3. Single-query COUNT(*) FILTER atomic snapshot for error_counts
--      (Story 13-2 review-round-1 P2 pattern — eliminates the
--      total/resolved race).
--   4. p_now timestamptz parameter for timezone consistency with client's
--      local-date definition (Story 13-2 review-round-1 P3 pattern).
--
-- The aggregate's 5 top-level JSONB keys:
--   prev_session         — { ai_feedback, duration_seconds, completed_at } or null
--                          (gated on completed_at >= p_now - INTERVAL '21 days')
--   cefr_promotion       — { from, to } or null (only if p_pre_cefr_level differs
--                          from current profiles.current_cefr_level)
--   max_fluency_rating   — number (server-side MAX of ai_feedback->>'fluencyRating'
--                          across all OTHER completed conversations; 0 if none)
--   max_grammar_rating   — number (same for grammarRating)
--   recent_resolved_error — { error_description } or null (most-recent resolved=true
--                           with last_occurred >= p_now - INTERVAL '5 minutes')
--   error_counts         — { total, resolved } via COUNT(*) FILTER (atomic snapshot)
--
-- SECURITY DEFINER + SET search_path = public + auth.uid() defense-in-depth.
-- Mirrors Story 9-9 / 11-4 / 11-6 / 12-3 / 13-2 hardening pattern.
--
-- Forward-only. Idempotent re-run safe (CREATE OR REPLACE FUNCTION).
--
-- Closes audit P2-4 architecturally.

CREATE OR REPLACE FUNCTION get_session_feedback_aggregate(
  p_user_id          uuid,
  p_conversation_id  uuid,
  p_pre_cefr_level   text,
  p_now              timestamptz DEFAULT now()
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_session            jsonb;
  v_cefr_promotion          jsonb;
  v_max_fluency_rating      numeric;
  v_max_grammar_rating      numeric;
  v_recent_resolved_error   jsonb;
  v_total_errors            integer;
  v_resolved_errors         integer;
  v_current_cefr_level      text;
BEGIN
  -- Story 9-9 / 11-4 / 11-6 / 12-3 / 13-2 verified pattern: defense-in-depth
  -- auth.uid() check on top of RLS. SECURITY DEFINER runs with the function
  -- owner's privileges, so auth.uid() still resolves to the CALLER's auth
  -- context.
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Story 13-3 review-round-1 P5: validate p_pre_cefr_level against the
  -- 6-level CEFR enum. Pre-patch a typo at the call site (`'B11'`, `'b1'`,
  -- `'xyz'`) would flow verbatim into the cefr_promotion `from` field,
  -- producing a UI banner with garbage data. NULL is allowed (the caller
  -- explicitly passes null when no pre-conversation level was captured).
  -- Mirrors Story 12-3 review-round-1 P4 defense-in-depth on CEFR input.
  IF p_pre_cefr_level IS NOT NULL
     AND p_pre_cefr_level NOT IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2') THEN
    RAISE EXCEPTION 'invalid CEFR level: %', p_pre_cefr_level
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. prev_session — most-recent OTHER completed conversation, gated on
  --    21-day cutoff (server-side; pre-13-3 was client-side post-fetch).
  --
  --    Story 13-3 review-round-1 P12: cutoff is INCLUSIVE (`>=`). A
  --    conversation at exactly `p_now - 21 days` is INCLUDED in the
  --    prev_session window. A future maintainer changing to exclusive
  --    `>` should also update the pgTAP test #5 (currently seeds at
  --    22 days to land OUTSIDE the inclusive window).
  SELECT to_jsonb(ps.*)
  INTO v_prev_session
  FROM (
    SELECT ai_feedback, duration_seconds, completed_at
    FROM conversations
    WHERE user_id = p_user_id
      AND status = 'completed'
      AND id <> p_conversation_id
      AND completed_at >= p_now - INTERVAL '21 days'
    ORDER BY completed_at DESC
    LIMIT 1
  ) ps;
  IF v_prev_session IS NULL THEN
    v_prev_session := 'null'::jsonb;
  END IF;

  -- 2. cefr_promotion — non-null only if p_pre_cefr_level differs from
  --    the user's CURRENT profile level. Read profiles row once.
  SELECT current_cefr_level
  INTO v_current_cefr_level
  FROM profiles
  WHERE id = p_user_id;

  IF v_current_cefr_level IS NOT NULL
     AND p_pre_cefr_level IS NOT NULL
     AND v_current_cefr_level <> p_pre_cefr_level THEN
    v_cefr_promotion := jsonb_build_object(
      'from', p_pre_cefr_level,
      'to',   v_current_cefr_level
    );
  ELSE
    v_cefr_promotion := 'null'::jsonb;
  END IF;

  -- 3 + 4. max_fluency_rating + max_grammar_rating — server-side MAX
  --        across all OTHER completed conversations. Returns 2 scalars
  --        instead of N JSONB rows (the unbounded-query elimination
  --        that drives the audit P2-4 win). COALESCE to 0 when no
  --        previous conversations exist.
  --
  --        Story 13-3 review-round-1 P1: defensive JSONB type-check.
  --        Pre-patch `(ai_feedback->>'fluencyRating')::numeric` would
  --        raise `invalid_text_representation` if ANY historical row
  --        stored the rating as a non-numeric string (e.g., a future
  --        schema drift, malformed write, or AI-emitted "four") or as
  --        a JSONB array/object — and the entire aggregate RPC would
  --        fail, forcing the client into the catch-arm setState(null)
  --        path. Post-patch the CASE filters to JSONB-typed numbers
  --        ONLY; non-numeric entries are skipped per-row. Mirrors
  --        Story 12-3 P17 NaN-guard defense-in-depth pattern.
  SELECT
    COALESCE(MAX(CASE WHEN jsonb_typeof(ai_feedback->'fluencyRating') = 'number'
                       THEN (ai_feedback->>'fluencyRating')::numeric
                       ELSE NULL END), 0),
    COALESCE(MAX(CASE WHEN jsonb_typeof(ai_feedback->'grammarRating') = 'number'
                       THEN (ai_feedback->>'grammarRating')::numeric
                       ELSE NULL END), 0)
  INTO v_max_fluency_rating, v_max_grammar_rating
  FROM conversations
  WHERE user_id = p_user_id
    AND status = 'completed'
    AND id <> p_conversation_id
    AND ai_feedback IS NOT NULL;

  -- 5. recent_resolved_error — most-recent resolved=true error with
  --    last_occurred within the 5-minute window. Server-side cutoff
  --    (pre-13-3 was client-side `new Date(Date.now() - 5 * 60 * 1000)
  --    .toISOString()`); using p_now keeps the cutoff consistent with
  --    the client's "now" perception (Story 13-2 P3 pattern).
  SELECT to_jsonb(re.*)
  INTO v_recent_resolved_error
  FROM (
    SELECT error_description
    FROM error_patterns
    WHERE user_id = p_user_id
      AND resolved = true
      AND last_occurred >= p_now - INTERVAL '5 minutes'
    ORDER BY last_occurred DESC
    LIMIT 1
  ) re;
  IF v_recent_resolved_error IS NULL THEN
    v_recent_resolved_error := 'null'::jsonb;
  END IF;

  -- 6. error_counts — Story 13-2 review-round-1 P2: single-query atomic
  --    snapshot via COUNT(*) FILTER. Pre-13-3 two separate COUNT(*)
  --    queries could produce resolved > total under concurrent UPDATE.
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE resolved = true)::integer
  INTO v_total_errors, v_resolved_errors
  FROM error_patterns
  WHERE user_id = p_user_id;

  -- Assemble the 5-key JSONB blob (note: error_counts is the 6th
  -- top-level field but is wrapped as a sub-object).
  RETURN jsonb_build_object(
    'prev_session',          v_prev_session,
    'cefr_promotion',        v_cefr_promotion,
    'max_fluency_rating',    v_max_fluency_rating,
    'max_grammar_rating',    v_max_grammar_rating,
    'recent_resolved_error', v_recent_resolved_error,
    'error_counts',          jsonb_build_object(
                               'total',    v_total_errors,
                               'resolved', v_resolved_errors
                             )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_session_feedback_aggregate(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_session_feedback_aggregate(uuid, uuid, text, timestamptz) TO authenticated;
