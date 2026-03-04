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
import { captureError } from "./sentry";

/**
 * Get the local date as a YYYY-MM-DD string.
 * Uses the device's local timezone instead of UTC to avoid
 * streak resets near midnight in non-UTC timezones.
 */
function getLocalDateString(date?: Date): string {
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
 * Accumulates exercises_completed, total_time_minutes, and
 * updates the score as a running average. Also checks if user
 * should be promoted to the next CEFR level for this skill.
 */
export async function updateSkillProgress(
  userId: string,
  skill: TCFSkill,
  score: number,
  timeMinutes: number
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("skill_progress")
      .select("score, exercises_completed, total_time_minutes, cefr_level")
      .eq("user_id", userId)
      .eq("skill", skill)
      .maybeSingle();

    const prevCompleted = existing?.exercises_completed ?? 0;
    const prevScore = existing?.score ?? 0;
    const prevTime = existing?.total_time_minutes ?? 0;

    // Running average: ((prevScore * prevCount) + newScore) / (prevCount + 1)
    const newAvgScore =
      prevCompleted > 0
        ? Math.round((prevScore * prevCompleted + score) / (prevCompleted + 1))
        : score;

    const { error } = await supabase.from("skill_progress").upsert(
      {
        user_id: userId,
        skill,
        score: newAvgScore,
        exercises_completed: prevCompleted + 1,
        total_time_minutes: prevTime + timeMinutes,
        last_practiced: new Date().toISOString(),
      },
      { onConflict: "user_id,skill" }
    );

    if (error) {
      captureError(error, "update-skill-progress", { skill, score });
    }
  } catch (err) {
    captureError(err, "update-skill-progress");
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

/**
 * Check if user should be promoted to next CEFR level.
 *
 * Promotion criteria:
 * - At least 10 total exercises completed at the current CEFR level
 * - At least 3 different skills practiced at the current level
 * - Average score across all practiced skills at the current level >= 85%
 *
 * Only promotes one level at a time. Updates profiles.current_cefr_level.
 */
export async function checkCefrPromotion(userId: string): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_cefr_level")
      .eq("id", userId)
      .single();

    if (!profile) return;

    const currentLevel = profile.current_cefr_level as CEFRLevel;
    const currentIdx = CEFR_ORDER.indexOf(currentLevel);
    if (currentIdx >= CEFR_ORDER.length - 1) return; // Already at C2

    // Only consider skill_progress rows that match the user's current CEFR level
    const { data: skills } = await supabase
      .from("skill_progress")
      .select("skill, score, exercises_completed")
      .eq("user_id", userId)
      .eq("cefr_level", currentLevel);

    if (!skills || skills.length === 0) return;

    // Require at least 3 different skills practiced
    const distinctSkills = new Set(skills.map((s) => s.skill));
    if (distinctSkills.size < 3) return;

    const totalExercises = skills.reduce((sum, s) => sum + (s.exercises_completed ?? 0), 0);
    if (totalExercises < 10) return; // Too few exercises to judge

    const avgScore = skills.reduce((sum, s) => sum + (s.score ?? 0), 0) / skills.length;

    if (avgScore >= 85) {
      const nextLevel = CEFR_ORDER[currentIdx + 1];
      const { error } = await supabase
        .from("profiles")
        .update({
          current_cefr_level: nextLevel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        captureError(error, "cefr-promotion");
      }
    }
  } catch (err) {
    captureError(err, "cefr-promotion");
  }
}
