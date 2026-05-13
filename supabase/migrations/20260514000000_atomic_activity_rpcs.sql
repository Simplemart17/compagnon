-- Story 12-3: Atomic Postgres RPCs for activity-mutation race elimination.
--
-- Pre-12-3 `src/lib/activity.ts` uses client-side SELECT-then-UPDATE for
-- streak / skill / daily-activity / CEFR-promotion writes. Two concurrent
-- callers (phone + web in the upcoming paid tier) read the same pre-update
-- state, compute the same `prev + delta`, and both UPDATE — silently
-- dropping one increment per race. Audit finding P1-18 names this
-- (`shippable-roadmap.md` line 70).
--
-- This migration adds 4 RPC functions:
--   1. update_streak_atomic            — single-statement UPDATE with the
--                                        "today / yesterday / reset" math
--                                        inlined as a CASE expression.
--   2. update_skill_progress_atomic    — INSERT … ON CONFLICT (user_id, skill)
--                                        DO UPDATE running-average math
--                                        server-side; no-regress CEFR rule
--                                        preserved.
--   3. increment_daily_activity_atomic — INSERT … ON CONFLICT (user_id, date)
--                                        DO UPDATE cumulative add.
--   4. promote_cefr_level_atomic       — compare-and-swap UPDATE; returns
--                                        TRUE if the swap landed, FALSE if a
--                                        concurrent worker already promoted.
--
-- SECURITY DEFINER + SET search_path = public + auth.uid() defense-in-depth.
-- Mirrors Story 9-9 hardening pattern (match_memories at
-- `20260301000002_production_fixes.sql`) + Story 11-4's
-- check_and_increment_rate_limit + Story 11-6's match_error_pattern.
--
-- Forward-only. Idempotent re-run safe (CREATE OR REPLACE FUNCTION).
--
-- Closes audit P1-18 architecturally.

-- =============================================================================
-- 1. update_streak_atomic — single-statement streak increment / reset
-- =============================================================================
-- Replaces the pre-12-3 client-side SELECT streak_days/last_active_date →
-- compute newStreak → UPDATE pipeline. Two concurrent callers serialize at
-- the row lock acquired by the UPDATE; the second observes the post-first
-- state (last_active_date = today) and short-circuits via the CASE arm,
-- so streak_days is incremented at most once per day even under contention.
--
-- Date math is passed from the client as DATE params (p_today, p_yesterday)
-- so the local-timezone fix from Story 9-2 (`getLocalDateString`) is
-- preserved — Postgres `CURRENT_DATE` would be UTC and could double-fire or
-- skip the streak across midnight in non-UTC timezones.

CREATE OR REPLACE FUNCTION update_streak_atomic(
  p_user_id    uuid,
  p_today      date,
  p_yesterday  date
) RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_streak integer;
BEGIN
  -- Defense-in-depth: auth.uid() must match the parameter, on top of RLS.
  -- SECURITY DEFINER runs with the function owner's privileges, so auth.uid()
  -- still resolves to the CALLER's auth context (verified pattern from
  -- check_and_increment_rate_limit / match_error_pattern).
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  UPDATE profiles
  SET streak_days = CASE
        WHEN last_active_date = p_today THEN COALESCE(streak_days, 0)
        WHEN last_active_date = p_yesterday THEN COALESCE(streak_days, 0) + 1
        -- Review-round-1 P11: clock-skew / DST / timezone-roaming defense.
        -- If `last_active_date` is in the future relative to `p_today`
        -- (user traveled west, device clock skew, DST fall-back), none of
        -- the first two arms match and we'd otherwise reset to 1. Preserve
        -- the existing streak instead — the user's activity is real.
        WHEN last_active_date > p_today THEN COALESCE(streak_days, 0)
        ELSE 1
      END,
      last_active_date = p_today,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING streak_days INTO v_new_streak;

  -- Review-round-1 P2: raise on missing profile row instead of silently
  -- returning NULL. Pre-patch the client wrapper only checked `error`, not
  -- `data`, so a user whose profile-creation trigger failed would get a
  -- silent no-op forever with no observability into the failure mode.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found for user_id %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_new_streak;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_streak_atomic(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_streak_atomic(uuid, date, date) TO authenticated;

-- =============================================================================
-- 2. update_skill_progress_atomic — atomic upsert with running-average
-- =============================================================================
-- Replaces the pre-12-3 client-side SELECT score/exercises → running-avg →
-- UPSERT pipeline. The INSERT ... ON CONFLICT (user_id, skill) DO UPDATE
-- acquires a row-level lock on conflict resolution, serializing concurrent
-- writes. The running-average math runs server-side against the post-lock
-- state on each call:
--
--   newAvg = ((prev_score * prev_exercises) + incoming) / (prev_exercises + 1)
--
-- The no-regress CEFR rule (Story 9-2) is preserved via an inline CASE
-- comparing array_position of each level in the canonical ordering. A row
-- practiced at B2 + an incoming A1 review keeps the row at B2.
--
-- Score is rounded to the nearest integer at write-time to match the pre-12-3
-- client-side Math.round behavior (skill_progress.score is FLOAT in the
-- schema but historically stored as integers via Math.round in activity.ts).

CREATE OR REPLACE FUNCTION update_skill_progress_atomic(
  p_user_id        uuid,
  p_skill          text,
  p_cefr_level     text,
  p_incoming_score numeric,
  p_time_minutes   integer
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Review-round-1 P4: validate p_cefr_level early. `skill_progress.cefr_level`
  -- has NO CHECK constraint in the initial schema (line 53), so without this
  -- guard a malformed/typo CEFR value (e.g., 'a1' lowercase, 'B2 ' with
  -- whitespace, 'undefined') would land in the column and permanently break
  -- the no-regress array_position comparison (NULL > x → NULL → ELSE keeps
  -- the bogus value forever).
  IF p_cefr_level NOT IN ('A1','A2','B1','B2','C1','C2') THEN
    RAISE EXCEPTION 'invalid CEFR level: %', p_cefr_level
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Review-round-1 P17: NaN guard. `COALESCE(NaN, 0) = NaN` (NaN is not NULL),
  -- so a future caller bypassing the client wrapper could write NaN into the
  -- FLOAT score column. NaN ≠ NaN in IEEE 754; this idiom catches both NaN
  -- and SQL NULL, normalizing to 0.
  IF p_incoming_score IS NULL OR NOT (p_incoming_score = p_incoming_score) THEN
    p_incoming_score := 0;
  END IF;

  -- Clamp incoming score to [0, 100] server-side (mirrors clampScore from
  -- activity.ts). Defensive against malformed client input.
  p_incoming_score := GREATEST(0, LEAST(100, p_incoming_score));

  INSERT INTO skill_progress (
    user_id, skill, cefr_level, score, exercises_completed,
    total_time_minutes, last_practiced
  )
  VALUES (
    -- Review-round-1 P5: round on the fresh INSERT branch too so pre- and
    -- post-12-3 rows have symmetric integer-rounded semantics. Pre-patch
    -- only the UPDATE branch rounded; a fresh insert with 95.5 would land
    -- as 95.5 while the same row's next update would round.
    p_user_id, p_skill, p_cefr_level, round(p_incoming_score), 1,
    COALESCE(p_time_minutes, 0), now()
  )
  ON CONFLICT (user_id, skill) DO UPDATE
  SET
    -- Running-average: round at write-time so the integer column has stable
    -- semantics across pre- and post-12-3 rows.
    score = round(
      (
        (skill_progress.score * skill_progress.exercises_completed)
        + EXCLUDED.score
      ) / (skill_progress.exercises_completed + 1)::numeric
    ),
    exercises_completed = skill_progress.exercises_completed + 1,
    total_time_minutes  = skill_progress.total_time_minutes + EXCLUDED.total_time_minutes,
    last_practiced      = EXCLUDED.last_practiced,
    -- No-regress CEFR: keep the higher level. Inline array_position
    -- comparison against the canonical CEFR ordering avoids a helper
    -- function (one call site).
    --
    -- Review-round-1 P1: COALESCE the stored-side array_position to 0 so a
    -- NULL or out-of-list `skill_progress.cefr_level` (corruption from a
    -- legacy migration, NULL default before the schema added it, etc.) is
    -- treated as "below A1" — the incoming valid level then wins via the
    -- strict-greater-than comparison. Pre-patch a bogus stored value made
    -- the LHS `array_position(..., bogus)` return NULL; `NULL > x` is NULL;
    -- CASE fell to ELSE; bogus value preserved forever. P4 above prevents
    -- new bad values; this defends against legacy rows.
    cefr_level = CASE
      WHEN COALESCE(
             array_position(
               ARRAY['A1','A2','B1','B2','C1','C2'],
               EXCLUDED.cefr_level
             ),
             0
           ) > COALESCE(
             array_position(
               ARRAY['A1','A2','B1','B2','C1','C2'],
               skill_progress.cefr_level
             ),
             0
           )
        THEN EXCLUDED.cefr_level
      ELSE skill_progress.cefr_level
    END,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION update_skill_progress_atomic(uuid, text, text, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_skill_progress_atomic(uuid, text, text, numeric, integer) TO authenticated;

-- =============================================================================
-- 3. increment_daily_activity_atomic — atomic cumulative-add upsert
-- =============================================================================
-- Replaces the pre-12-3 client-side SELECT counters → SUM → UPSERT pipeline.
-- Two concurrent increments serialize at the (user_id, date) row lock; both
-- deltas land in the cumulative total.

CREATE OR REPLACE FUNCTION increment_daily_activity_atomic(
  p_user_id        uuid,
  p_date           date,
  p_minutes        integer,
  p_exercises      integer,
  p_conversations  integer,
  p_words          integer
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  INSERT INTO daily_activity (
    user_id, date,
    minutes_practiced, exercises_completed, conversations_completed, words_learned
  )
  VALUES (
    p_user_id, p_date,
    COALESCE(p_minutes, 0),
    COALESCE(p_exercises, 0),
    COALESCE(p_conversations, 0),
    COALESCE(p_words, 0)
  )
  ON CONFLICT (user_id, date) DO UPDATE
  SET
    minutes_practiced       = daily_activity.minutes_practiced       + EXCLUDED.minutes_practiced,
    exercises_completed     = daily_activity.exercises_completed     + EXCLUDED.exercises_completed,
    conversations_completed = daily_activity.conversations_completed + EXCLUDED.conversations_completed,
    words_learned           = daily_activity.words_learned           + EXCLUDED.words_learned;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_daily_activity_atomic(uuid, date, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_daily_activity_atomic(uuid, date, integer, integer, integer, integer) TO authenticated;

-- =============================================================================
-- 4. promote_cefr_level_atomic — compare-and-swap CEFR promotion
-- =============================================================================
-- Replaces the pre-12-3 client-side `UPDATE profiles SET current_cefr_level
-- = next` pipeline. The WHERE clause includes `current_cefr_level =
-- p_expected_current_level` so two concurrent promotion workers cannot skip
-- a level: the first wins, the second observes a mismatch and the UPDATE
-- no-ops (0 rows affected). The pre-step pipeline (SELECT current level +
-- SELECT skill_progress rows + evaluatePromotion in JS) stays client-side
-- because evaluatePromotion is a pure helper unit-tested by activity.test.ts
-- (Story 9-2). Only the final atomic CAS write moves server-side.
--
-- Returns TRUE if the swap landed, FALSE otherwise. The client treats FALSE
-- as "another worker promoted first" — no error breadcrumb needed; the
-- next promotion check will re-evaluate from the post-promotion state.

CREATE OR REPLACE FUNCTION promote_cefr_level_atomic(
  p_user_id                 uuid,
  p_expected_current_level  text,
  p_next_level              text
) RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_updated integer;
  v_user_exists  boolean;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  -- Review-round-1 P7: validate p_next_level early so a typo or malicious
  -- input fails with a clear error message instead of a generic
  -- `check_violation` from the profiles.current_cefr_level CHECK constraint.
  IF p_next_level NOT IN ('A1','A2','B1','B2','C1','C2') THEN
    RAISE EXCEPTION 'invalid CEFR level: %', p_next_level
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Review-round-1 P2: distinguish "row missing" (raise) from "CAS mismatch"
  -- (return FALSE silently). Pre-patch both cases returned FALSE; the client
  -- treats FALSE as "concurrent worker promoted first" → silent — but a
  -- missing profile row is a real failure that should surface in Sentry.
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    RAISE EXCEPTION 'profile not found for user_id %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE profiles
  SET current_cefr_level = p_next_level,
      updated_at = now()
  WHERE id = p_user_id
    AND current_cefr_level = p_expected_current_level;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION promote_cefr_level_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_cefr_level_atomic(uuid, text, text) TO authenticated;

-- =============================================================================
-- Notes for future operators
-- =============================================================================
-- * All 4 functions take their date / timezone inputs as DATE params from the
--   client. The local-timezone fix from Story 9-2 (`getLocalDateString` using
--   device-local time) is preserved by construction — switching to
--   `CURRENT_DATE` would silently break streaks for non-UTC users.
--
-- * The running-average math in `update_skill_progress_atomic` operates on
--   the internal 0–100 `skill_progress.score` scale (Story 9-2). Story 10-2
--   moved publisher-anchored TCF scoring to a separate per-skill conversion
--   path; the running-avg here is intentionally UX-soft.
--
-- * Fail-OPEN policy: the client wrapper in src/lib/activity.ts logs RPC
--   errors via captureError and returns silently. Activity tracking is
--   fire-and-forget from Story 12-1's Phase A Promise.allSettled — never
--   block the user-facing flow on a tracking-pipeline write failure.
--
-- * Concurrency contract verified via the pgTAP-style assertion test at
--   supabase/migrations/__tests__/atomic_activity_rpcs_test.sql
--   (manual-run via `psql -f`; Epic 15.3 owns CI integration).
