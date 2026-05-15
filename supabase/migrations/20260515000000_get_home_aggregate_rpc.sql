-- Story 13-2: get_home_aggregate(p_user_id, p_date) RPC — closes audit P2-5.
--
-- Pre-13-2 the home screen fires 11 parallel Supabase queries on every cold
-- mount (5 from use-progress.ts + 6 from use-daily-briefing.ts) plus 1
-- OpenAI embedding call for the fixed "daily greeting" string. On 4G with
-- ~100ms RTT, the fan-out routinely lands cold-cache first-paint at 2.5-4s.
--
-- This migration adds ONE read-only function that consolidates 9 of the 11
-- queries into a single JSONB-returning RPC. The 10th query (match_memories
-- via vector similarity) stays separate because it requires a query
-- embedding as a parameter; the 11th query (OpenAI embedding for the fixed
-- string "daily greeting") is fixed by the client-side module-level cache
-- in src/lib/memory.ts (retrieveDailyGreetingMemories).
--
-- The aggregate's 9 top-level JSONB keys:
--   skills              — array of {skill, cefr_level, score, exercises_completed, total_time_minutes}
--   daily_activity_today — single row {date, minutes_practiced, ...} or null
--   recent_activity     — array of 7 most recent daily_activity rows
--   top_errors          — array of top 5 unresolved error_patterns
--   streak_days         — integer from profiles
--   weakest_skill       — {skill, average_score} or null (lowest-score skill)
--   srs_due_count       — integer (vocabulary rows with next_review <= now)
--   error_counts        — {total, resolved}
--   has_activity_today  — boolean
--
-- SECURITY DEFINER + SET search_path = public + auth.uid() defense-in-depth.
-- Mirrors Story 9-9 / 11-4 / 11-6 / 12-3 hardening pattern.
--
-- Forward-only. Idempotent re-run safe (CREATE OR REPLACE FUNCTION).
--
-- Closes audit P2-5 architecturally.

CREATE OR REPLACE FUNCTION get_home_aggregate(
  p_user_id uuid,
  p_date    date
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_skills              jsonb;
  v_daily_today         jsonb;
  v_recent_activity     jsonb;
  v_top_errors          jsonb;
  v_streak_days         integer;
  v_weakest_skill       jsonb;
  v_srs_due_count       integer;
  v_total_errors        integer;
  v_resolved_errors     integer;
  v_has_activity_today  boolean;
BEGIN
  -- Defense-in-depth: auth.uid() must match the parameter, on top of RLS.
  -- SECURITY DEFINER runs with the function owner's privileges, so auth.uid()
  -- still resolves to the CALLER's auth context (Story 9-9 / 11-4 / 11-6 /
  -- 12-3 verified pattern).
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- 1. skills — all skill_progress rows for the user.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'skill',                skill,
      'cefr_level',           cefr_level,
      'score',                score,
      'exercises_completed',  exercises_completed,
      'total_time_minutes',   total_time_minutes
    )
  ), '[]'::jsonb)
  INTO v_skills
  FROM skill_progress
  WHERE user_id = p_user_id;

  -- 2. daily_activity_today — the row for p_date (or null).
  SELECT COALESCE(to_jsonb(da.*), 'null'::jsonb)
  INTO v_daily_today
  FROM (
    SELECT date, minutes_practiced, exercises_completed,
           conversations_completed, words_learned
    FROM daily_activity
    WHERE user_id = p_user_id AND date = p_date
    LIMIT 1
  ) da;
  -- Handle "no row" → to_jsonb(NULL) returns NULL, but we want JSONB null.
  IF v_daily_today IS NULL THEN
    v_daily_today := 'null'::jsonb;
  END IF;

  -- 3. recent_activity — last 7 days (most recent first).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',                    date,
      'minutes_practiced',       minutes_practiced,
      'exercises_completed',     exercises_completed,
      'conversations_completed', conversations_completed,
      'words_learned',           words_learned
    ) ORDER BY date DESC
  ), '[]'::jsonb)
  INTO v_recent_activity
  FROM (
    SELECT date, minutes_practiced, exercises_completed,
           conversations_completed, words_learned
    FROM daily_activity
    WHERE user_id = p_user_id
    ORDER BY date DESC
    LIMIT 7
  ) AS recent;

  -- 4. top_errors — top 5 unresolved by occurrences DESC.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                id,
      'error_type',        error_type,
      'error_description', error_description,
      'occurrences',       occurrences,
      'resolved',          resolved
    ) ORDER BY occurrences DESC, id ASC
  ), '[]'::jsonb)
  INTO v_top_errors
  FROM (
    SELECT id, error_type, error_description, occurrences, resolved
    FROM error_patterns
    WHERE user_id = p_user_id AND resolved = false
    ORDER BY occurrences DESC, id ASC
    LIMIT 5
  ) AS errs;

  -- 5. streak_days from profiles.
  SELECT COALESCE(streak_days, 0)
  INTO v_streak_days
  FROM profiles
  WHERE id = p_user_id;
  -- Defensive — a missing profile row should not crash the aggregate;
  -- return 0 instead. The auth.uid() check above ensures the user exists
  -- in auth.users; a missing profiles row is a profile-trigger failure
  -- (separate concern, surfaced elsewhere via Story 9-10 retry path).
  IF v_streak_days IS NULL THEN
    v_streak_days := 0;
  END IF;

  -- 6. weakest_skill — lowest-score row (or null).
  -- skill_progress has `score` column (not `average_score` — that was the
  -- pre-12-3 column name; we read what the schema actually has).
  -- Tiebreaker: alphabetical skill name for deterministic output.
  SELECT to_jsonb(ws.*)
  INTO v_weakest_skill
  FROM (
    SELECT skill, score AS average_score
    FROM skill_progress
    WHERE user_id = p_user_id
    ORDER BY score ASC, skill ASC
    LIMIT 1
  ) ws;
  IF v_weakest_skill IS NULL THEN
    v_weakest_skill := 'null'::jsonb;
  END IF;

  -- 7. srs_due_count — vocabulary with next_review <= now().
  SELECT COUNT(*)::integer
  INTO v_srs_due_count
  FROM vocabulary
  WHERE user_id = p_user_id AND next_review <= now();

  -- 8. error_counts.total + error_counts.resolved (two scalars).
  SELECT COUNT(*)::integer
  INTO v_total_errors
  FROM error_patterns
  WHERE user_id = p_user_id;

  SELECT COUNT(*)::integer
  INTO v_resolved_errors
  FROM error_patterns
  WHERE user_id = p_user_id AND resolved = true;

  -- 9. has_activity_today — derived from daily_activity_today.
  v_has_activity_today := (v_daily_today IS NOT NULL AND v_daily_today != 'null'::jsonb);

  -- Assemble the 9-key JSONB blob.
  RETURN jsonb_build_object(
    'skills',               v_skills,
    'daily_activity_today', v_daily_today,
    'recent_activity',      v_recent_activity,
    'top_errors',           v_top_errors,
    'streak_days',          v_streak_days,
    'weakest_skill',        v_weakest_skill,
    'srs_due_count',        v_srs_due_count,
    'error_counts',         jsonb_build_object(
                              'total',    v_total_errors,
                              'resolved', v_resolved_errors
                            ),
    'has_activity_today',   v_has_activity_today
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_home_aggregate(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_home_aggregate(uuid, date) TO authenticated;
