/**
 * Shared activity tracking utilities.
 *
 * Handles streak calculation, last_active_date updates,
 * and CEFR level auto-promotion — called after any user activity
 * (exercises, conversations, mock tests).
 */

import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";

import { supabase } from "./supabase";
import { captureError, addBreadcrumb } from "./sentry";

/** TCF skills in TCF_SKILLS_IN_ORDER — used for stable ordering of missingSkills. */
const TCF_SKILLS_IN_ORDER: TCFSkill[] = ["listening", "reading", "speaking", "writing", "grammar"];

/** Type guard for `CEFRLevel` strings — guards against stale enum values read from the DB. */
function isCEFRLevel(value: unknown): value is CEFRLevel {
  return typeof value === "string" && (CEFR_ORDER as readonly string[]).includes(value);
}

/** Clamp a numeric score into the canonical 0..100 range; non-finite values become 0. */
function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

/**
 * Get the local date as a YYYY-MM-DD string.
 * Uses the device's local timezone instead of UTC to avoid
 * streak resets near midnight in non-UTC timezones.
 */
export function getLocalDateString(date?: Date): string {
  const d = date ?? new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Update the user's streak and last_active_date.
 *
 * Logic (Story 9-2; preserved server-side post-12-3):
 * - If last_active_date is today → do nothing (already counted)
 * - If last_active_date is yesterday → increment streak
 * - Otherwise → reset streak to 1
 *
 * Story 12-3: the SELECT-then-UPDATE pipeline is replaced by a single
 * server-side `update_streak_atomic` RPC. The math runs inside Postgres
 * under a row-level lock acquired by the UPDATE, so two concurrent callers
 * (phone + web) serialize and the second observes the post-first state
 * (no double-increment). Audit P1-18 closed architecturally.
 *
 * Fail-OPEN: RPC error routes through captureError + returns silently.
 * Never block a fire-and-forget activity tick on tracking-pipeline failure.
 */
export async function updateStreak(userId: string): Promise<void> {
  try {
    const today = getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    const { error } = await supabase.rpc("update_streak_atomic", {
      p_user_id: userId,
      p_today: today,
      p_yesterday: yesterdayStr,
    });

    if (error) {
      captureError(error, "update-streak");
    }
  } catch (err) {
    captureError(err, "update-streak");
  }
}

/**
 * Update skill_progress with the score from an exercise.
 *
 * Accumulates exercises_completed, total_time_minutes, and updates score
 * as a running average. Writes `cefr_level` on every upsert so that
 * `checkCefrPromotion` (which filters rows by cefr_level) can re-fire on
 * subsequent promotions; never regresses an existing higher level (e.g.,
 * a B2 user reviewing A1 leaves the row's stored level at B2).
 *
 * Story 12-3: the SELECT-then-UPSERT pipeline is replaced by a single
 * server-side `update_skill_progress_atomic` RPC. `INSERT ... ON CONFLICT
 * (user_id, skill) DO UPDATE` acquires a row-level lock on conflict
 * resolution, serializing concurrent writes; the running-average math +
 * no-regress CEFR rule both run server-side inside one statement. The
 * pre-12-3 `TODO(epic-10-schema-hardening)` debt is paid down here.
 *
 * Note: `clampScore` is still applied client-side as defense-in-depth so
 * malformed scores are caught at the boundary; the SQL also clamps via
 * GREATEST/LEAST as belt-and-braces.
 *
 * Fail-OPEN: RPC error routes through captureError + returns silently.
 */
export async function updateSkillProgress(
  userId: string,
  skill: TCFSkill,
  cefrLevel: CEFRLevel,
  score: number,
  timeMinutes: number
): Promise<void> {
  try {
    const incomingScore = clampScore(score);

    const { error } = await supabase.rpc("update_skill_progress_atomic", {
      p_user_id: userId,
      p_skill: skill,
      p_cefr_level: cefrLevel,
      p_incoming_score: incomingScore,
      p_time_minutes: timeMinutes,
    });

    if (error) {
      // Review-round-1 P12: pass `incomingScore` (clamped) not the raw
      // `score` — the RPC saw the clamped value, so Sentry should mirror
      // that for diagnostic fidelity on clamp-related errors.
      captureError(error, "update-skill-progress", { skill, score: incomingScore, cefrLevel });
    }
  } catch (err) {
    captureError(err, "update-skill-progress", { skill, cefrLevel });
  }
}

/**
 * Increment daily activity counters.
 * Adds to existing values rather than overwriting.
 *
 * Story 12-3: the SELECT-then-UPSERT pipeline is replaced by a single
 * `increment_daily_activity_atomic` RPC. `INSERT ... ON CONFLICT
 * (user_id, date) DO UPDATE SET x = daily_activity.x + EXCLUDED.x`
 * serializes concurrent increments at the row lock; both deltas land.
 *
 * Fail-OPEN: RPC error routes through captureError + returns silently.
 */
export async function incrementDailyActivity(
  userId: string,
  fields: {
    minutes?: number;
    exercises?: number;
    conversations?: number;
    words?: number;
  }
): Promise<void> {
  try {
    const today = getLocalDateString();

    const { error } = await supabase.rpc("increment_daily_activity_atomic", {
      p_user_id: userId,
      p_date: today,
      p_minutes: fields.minutes ?? 0,
      p_exercises: fields.exercises ?? 0,
      p_conversations: fields.conversations ?? 0,
      p_words: fields.words ?? 0,
    });

    if (error) {
      captureError(error, "increment-daily-activity");
    }
  } catch (err) {
    captureError(err, "increment-daily-activity");
  }
}

/** A single skill_progress row at the user's current_cefr_level. */
export interface PromotionEvidence {
  skill: TCFSkill;
  score: number;
  exercisesCompleted: number;
}

/** Decision returned by evaluatePromotion(). */
export interface PromotionDecision {
  promote: boolean;
  /** Reason the gate did not fire — used by Sentry breadcrumbs and tests. */
  reason: "ok" | "already-c2" | "missing-skills" | "too-few-passing-skills" | "too-few-exercises";
  missingSkills: TCFSkill[];
}

/**
 * Score threshold a skill row must clear to count as "passing" for promotion.
 *
 * Note (Story 10-2): this is on the internal 0–100 `skill_progress.score`
 * scale (clamped by `clampScore`), NOT on the publisher's IRCC scales
 * (0–699 for Listening/Reading, 0–20 for Writing/Speaking — see
 * `src/lib/ircc-bands.ts`). The promotion gate is intentionally UX-soft and
 * uses an internal-percent threshold rather than a per-skill IRCC CLB band
 * lookup; switching to `IRCC_CLB_BANDS` would change CEFR promotion behavior
 * in subtle ways that need their own pedagogy review (deferred follow-up).
 */
const PASSING_SCORE = 85;
/** Number of distinct skills (out of 5) that must clear PASSING_SCORE. */
const MIN_PASSING_SKILLS = 3;
/** Sum of exercises_completed across all 5 skill rows. */
const MIN_TOTAL_EXERCISES = 10;

/**
 * Pure decision helper for CEFR promotion. No Supabase access, no side effects —
 * exhaustively unit-tested by `src/lib/__tests__/activity.test.ts`.
 *
 * Gate order (first failure short-circuits):
 *   1. already-c2          → user is already at the terminal level
 *   2. missing-skills      → fewer than 5 distinct TCF skills represented
 *   3. too-few-passing-skills → all 5 present, but < 3 score ≥ 85
 *   4. too-few-exercises   → ≥ 3 passing, but sum(exercises) < 10
 *   5. ok                  → all gates pass, promote one level
 *
 * Any score counts as "evidence" for breadth — the 85% bar only applies to
 * the count-of-passing-skills gate. This is intentional so users are not
 * punished for being weak at speaking/writing while they build the habit.
 *
 * Robustness: duplicate rows for the same skill are deduped (last-wins), and
 * non-finite scores are coerced to 0 — neither shape can occur via the
 * Supabase wrapper today, but keeping the helper defensive lets it stand
 * alone for tests and future callers.
 */
export function evaluatePromotion(
  currentLevel: CEFRLevel,
  rowsAtLevel: PromotionEvidence[]
): PromotionDecision {
  if (currentLevel === "C2") {
    return { promote: false, reason: "already-c2", missingSkills: [] };
  }

  // Dedupe by skill (last-wins). Defends the helper against malformed input
  // even though the DB schema's `UNIQUE(user_id, skill)` makes this unreachable today.
  const bySkill = new Map<TCFSkill, PromotionEvidence>();
  for (const row of rowsAtLevel) {
    bySkill.set(row.skill, row);
  }

  const missingSkills = TCF_SKILLS_IN_ORDER.filter((s) => !bySkill.has(s));
  if (missingSkills.length > 0) {
    return { promote: false, reason: "missing-skills", missingSkills };
  }

  const dedupedRows = Array.from(bySkill.values());
  const passingSkills = dedupedRows.filter((r) => clampScore(r.score) >= PASSING_SCORE).length;
  if (passingSkills < MIN_PASSING_SKILLS) {
    return { promote: false, reason: "too-few-passing-skills", missingSkills: [] };
  }

  const totalExercises = dedupedRows.reduce(
    (sum, r) => sum + (Number.isFinite(r.exercisesCompleted) ? r.exercisesCompleted : 0),
    0
  );
  if (totalExercises < MIN_TOTAL_EXERCISES) {
    return { promote: false, reason: "too-few-exercises", missingSkills: [] };
  }

  return { promote: true, reason: "ok", missingSkills: [] };
}

/**
 * Last (userId, level, reason) emitted as a "promotion-skipped" breadcrumb,
 * keyed by userId. Used to suppress duplicates so the breadcrumb buffer is not
 * dominated by the same skip reason on every activity tick — Sentry's default
 * buffer is ~100 entries and a typical user emits 20+ skipped breadcrumbs/day.
 */
const lastSkippedBreadcrumb = new Map<string, string>();

/**
 * Check if user should be promoted to next CEFR level.
 *
 * Promotion criteria (all must hold at the user's current_cefr_level):
 * - Evidence in all 5 TCF skills (listening, reading, speaking, writing, grammar)
 * - ≥3 of those 5 skills with running-average score ≥ 85
 * - ≥10 total exercises_completed across the 5 skill rows
 *
 * One-step promotion only. C2 is terminal. See `evaluatePromotion` for the
 * pure decision helper exercised by activity.test.ts.
 *
 * Story 12-3: the final UPDATE step is replaced by a server-side
 * `promote_cefr_level_atomic(p_user_id, p_expected_current_level, p_next_level)`
 * RPC that performs a compare-and-swap UPDATE. The pre-step SELECT
 * pipeline (SELECT current_cefr_level + SELECT skill_progress rows +
 * `evaluatePromotion`) stays client-side because `evaluatePromotion` is a
 * pure helper unit-tested by activity.test.ts (Story 9-2). Two concurrent
 * promotion workers race: first wins (RPC returns TRUE), second observes a
 * mismatch and the UPDATE no-ops (RPC returns FALSE); the FALSE path is
 * silent because the next promotion check will re-evaluate from the
 * post-promotion state. The pre-12-3 `TODO(epic-10-schema-hardening)`
 * debt is paid down here.
 */
export async function checkCefrPromotion(userId: string): Promise<void> {
  let currentLevel: CEFRLevel | null = null;
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_cefr_level")
      .eq("id", userId)
      .single();

    if (!profile) return;

    // Validate the stored value rather than blindly casting — the DB column has
    // a CHECK constraint today, but we still guard against null and unexpected
    // strings (a stale enum value would silently mis-classify the user as A1).
    if (!isCEFRLevel(profile.current_cefr_level)) {
      captureError(new Error("invalid current_cefr_level"), "cefr-promotion", {
        userId,
        value: profile.current_cefr_level,
      });
      return;
    }
    currentLevel = profile.current_cefr_level;
    const currentIdx = CEFR_ORDER.indexOf(currentLevel);
    if (currentIdx >= CEFR_ORDER.length - 1) return; // Already at C2 — no breadcrumb needed.

    // Only consider skill_progress rows that match the user's current CEFR level
    const { data: skills } = await supabase
      .from("skill_progress")
      .select("skill, score, exercises_completed")
      .eq("user_id", userId)
      .eq("cefr_level", currentLevel);

    const evidence: PromotionEvidence[] = (skills ?? []).map((s) => ({
      skill: s.skill as TCFSkill,
      score: s.score ?? 0,
      exercisesCompleted: s.exercises_completed ?? 0,
    }));

    const decision = evaluatePromotion(currentLevel, evidence);

    if (decision.promote) {
      const nextLevel = CEFR_ORDER[currentIdx + 1];
      // Story 12-3: compare-and-swap UPDATE via RPC. Returns TRUE if the
      // swap landed, FALSE if a concurrent worker already promoted (in
      // which case we breadcrumb but stay silent in error tier — the next
      // promotion check will re-evaluate from the post-promotion state).
      // Only true RPC errors (Postgres down, RLS denial, schema drift,
      // post-12-3 missing-profile-row from P2) route through captureError.
      const { data: swapped, error } = await supabase.rpc("promote_cefr_level_atomic", {
        p_user_id: userId,
        p_expected_current_level: currentLevel,
        p_next_level: nextLevel,
      });

      if (error) {
        captureError(error, "cefr-promotion", { fromLevel: currentLevel, toLevel: nextLevel });
      } else if (swapped === false) {
        // Review-round-1 P6: distinguish a real successful promotion from
        // a CAS-mismatch (concurrent worker already promoted). Pre-patch
        // both cases fell through to `lastSkippedBreadcrumb.delete(...)`,
        // misclassifying the race as a successful promotion in observability.
        // Emit an info-level breadcrumb so operators can see the race
        // frequency. Do NOT clear the throttle — the user did not actually
        // advance via this worker.
        addBreadcrumb({
          category: "cefr-promotion",
          level: "info",
          message: "cefr-promotion-raced (concurrent worker won the CAS)",
          data: { fromLevel: currentLevel, toLevel: nextLevel },
        });
      } else {
        lastSkippedBreadcrumb.delete(userId); // real promotion fired — reset throttle.
      }
      return;
    }

    // Non-promoting outcomes are expected, not failures — emit an info breadcrumb
    // so we can see why a user did not advance. Suppress duplicate skips for the
    // same (level, reason) so we don't flood the breadcrumb buffer.
    if (decision.reason !== "already-c2") {
      const fingerprint = `${currentLevel}:${decision.reason}`;
      if (lastSkippedBreadcrumb.get(userId) !== fingerprint) {
        addBreadcrumb({
          category: "cefr-promotion",
          level: "info",
          message: `cefr-promotion-skipped: ${decision.reason}`,
          data: {
            currentLevel,
            // Stringify the array — scrubber gates on primitives only.
            missingSkills: decision.missingSkills.join(","),
          },
        });
        lastSkippedBreadcrumb.set(userId, fingerprint);
      }
    }
  } catch (err) {
    captureError(err, "cefr-promotion", { currentLevel });
  }
}
