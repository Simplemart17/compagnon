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

/** Return whichever of `a` and `b` is the higher CEFR level. */
function maxLevel(a: CEFRLevel, b: CEFRLevel): CEFRLevel {
  return CEFR_ORDER.indexOf(a) >= CEFR_ORDER.indexOf(b) ? a : b;
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
 * Logic:
 * - If last_active_date is today → do nothing (already counted)
 * - If last_active_date is yesterday → increment streak
 * - Otherwise → reset streak to 1
 */
export async function updateStreak(userId: string): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("streak_days, last_active_date")
      .eq("id", userId)
      .single();

    if (!profile) return;

    const today = getLocalDateString();
    if (profile.last_active_date === today) return; // Already counted today

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    const newStreak =
      profile.last_active_date === yesterdayStr ? (profile.streak_days ?? 0) + 1 : 1;

    const { error } = await supabase
      .from("profiles")
      .update({
        streak_days: newStreak,
        last_active_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

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
 * TODO(epic-10-schema-hardening): The read-modify-write pattern below is
 * not atomic. Two concurrent calls for the same (user, skill) can clobber
 * each other's running-average update. Fix requires either an RPC with
 * `SELECT ... FOR UPDATE` or a Postgres function that does the running-avg
 * math server-side. Out of scope for story 9-2 (AC #5 forbids schema changes).
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
    const { data: existing } = await supabase
      .from("skill_progress")
      .select("score, exercises_completed, total_time_minutes, cefr_level")
      .eq("user_id", userId)
      .eq("skill", skill)
      .maybeSingle();

    const prevCompleted = existing?.exercises_completed ?? 0;
    const prevScore = clampScore(existing?.score ?? 0);
    const prevTime = existing?.total_time_minutes ?? 0;

    // Running average: ((prevScore * prevCount) + newScore) / (prevCount + 1)
    const newAvgScore =
      prevCompleted > 0
        ? Math.round((prevScore * prevCompleted + incomingScore) / (prevCompleted + 1))
        : incomingScore;

    // No-regress rule: a row practiced at a higher level keeps that level
    // even when the user does a lower-level review. `existing.cefr_level`
    // has no DB CHECK constraint, so we validate it here before comparing.
    const existingLevel = isCEFRLevel(existing?.cefr_level) ? existing.cefr_level : "A1";
    const mergedLevel = maxLevel(existingLevel, cefrLevel);

    const { error } = await supabase.from("skill_progress").upsert(
      {
        user_id: userId,
        skill,
        cefr_level: mergedLevel,
        score: newAvgScore,
        exercises_completed: prevCompleted + 1,
        total_time_minutes: prevTime + timeMinutes,
        last_practiced: new Date().toISOString(),
      },
      { onConflict: "user_id,skill" }
    );

    if (error) {
      captureError(error, "update-skill-progress", { skill, score, cefrLevel });
    }
  } catch (err) {
    captureError(err, "update-skill-progress", { skill, cefrLevel });
  }
}

/**
 * Increment daily activity counters.
 * Adds to existing values rather than overwriting.
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
    const { data: existing } = await supabase
      .from("daily_activity")
      .select("minutes_practiced, exercises_completed, conversations_completed, words_learned")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    const { error } = await supabase.from("daily_activity").upsert(
      {
        user_id: userId,
        date: today,
        minutes_practiced: (existing?.minutes_practiced ?? 0) + (fields.minutes ?? 0),
        exercises_completed: (existing?.exercises_completed ?? 0) + (fields.exercises ?? 0),
        conversations_completed:
          (existing?.conversations_completed ?? 0) + (fields.conversations ?? 0),
        words_learned: (existing?.words_learned ?? 0) + (fields.words ?? 0),
      },
      { onConflict: "user_id,date" }
    );

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

/** Score threshold a skill row must clear to count as "passing" for promotion. */
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
 * TODO(epic-10-schema-hardening): Two concurrent invocations could both
 * promote (idempotent same-level write) or, in pathological timing, skip a
 * level. A row-level lock or `UPDATE ... WHERE current_cefr_level = $expected`
 * compare-and-swap would close this. Out of scope for story 9-2 (AC #5).
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
      const { error } = await supabase
        .from("profiles")
        .update({
          current_cefr_level: nextLevel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        captureError(error, "cefr-promotion", { fromLevel: currentLevel, toLevel: nextLevel });
      } else {
        lastSkippedBreadcrumb.delete(userId); // promotion fired — reset throttle.
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
          data: { currentLevel, missingSkills: decision.missingSkills },
        });
        lastSkippedBreadcrumb.set(userId, fingerprint);
      }
    }
  } catch (err) {
    captureError(err, "cefr-promotion", { currentLevel });
  }
}
