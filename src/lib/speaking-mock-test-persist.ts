/**
 * Persistence orchestrator for the TCF Canada Expression Orale mock test.
 *
 * Story 9-8.
 *
 * Extracted from `app/(tabs)/mock-test/speaking.tsx` so the chain can be unit-
 * tested in isolation (no React, no `@testing-library/react-native`). The
 * screen calls this helper after the 3 evaluations resolve and renders the
 * results page from the returned summary.
 *
 * Contract:
 *   1. Insert one `mock_tests` row (`test_type = "speaking"`).
 *   2. Insert 3 `mock_test_answers` rows (per-task transcripts).
 *   3. Run the activity chain (`updateSkillProgress` → `incrementDailyActivity`
 *      → `updateStreak` → `checkCefrPromotion`) — best-effort isolated, so a
 *      failure on one step does not skip the next.
 *   4. Invalidate profile/skills/activity caches so the next read is fresh.
 *
 * All Sentry tags use the existing `feature` / `phase` allowlist keys (story
 * 9-3) — zero changes to `SENTRY_EXTRAS_ALLOWLIST`. No transcripts are ever
 * carried in event payloads.
 */

import { TCF } from "@/src/lib/constants";
import { CACHE_KEYS, invalidateCache } from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
import { rawToTCFScore } from "@/src/lib/scoring";
import { levelFromScore } from "@/src/types/cefr";
import {
  checkCefrPromotion,
  incrementDailyActivity,
  updateSkillProgress,
  updateStreak,
} from "@/src/lib/activity";
import { supabase } from "@/src/lib/supabase";
import type { CEFRLevel } from "@/src/types/cefr";
import type { SpeakingTaskEvaluation } from "@/src/lib/schemas/ai-responses";
import type { SpeakingTaskNumber, SpeakingTaskPromptResult } from "@/src/lib/prompts/speaking";

import { computeSpeakingComposite, computeSpeakingTaskOverall } from "./speaking-scoring";

const TASK_NUMBERS: SpeakingTaskNumber[] = [1, 2, 3];

export interface PersistSpeakingMockTestParams {
  userId: string;
  cefrLevel: CEFRLevel;
  prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
  transcripts: Record<SpeakingTaskNumber, string>;
  evaluations: Record<SpeakingTaskNumber, SpeakingTaskEvaluation>;
  /** Real elapsed seconds from intro to evaluating; defaults to TCF.SPEAKING_MINUTES × 60. */
  durationSeconds?: number;
}

export interface SpeakingMockTestResults {
  totalScore: number;
  cefrResult: CEFRLevel;
  compositeOverall: number;
  taskOveralls: [number, number, number];
  /** Inserted `mock_tests` row id, or null if the insert failed. */
  mockTestId: string | null;
}

/**
 * Run the full persistence chain. Returns a results summary suitable for
 * rendering on the results screen. NEVER throws — every step is wrapped in
 * its own try/catch and reports via Sentry. The caller can always render
 * the user's results from the returned summary even if some DB writes failed.
 */
export async function persistSpeakingMockTest(
  params: PersistSpeakingMockTestParams
): Promise<SpeakingMockTestResults> {
  const { userId, cefrLevel, prompts, transcripts, evaluations } = params;
  const durationSeconds = params.durationSeconds ?? TCF.SPEAKING_MINUTES * 60;

  const taskOveralls: [number, number, number] = [
    computeSpeakingTaskOverall(evaluations[1]),
    computeSpeakingTaskOverall(evaluations[2]),
    computeSpeakingTaskOverall(evaluations[3]),
  ];
  const compositeOverall = computeSpeakingComposite(taskOveralls);
  const totalScore = rawToTCFScore(compositeOverall);
  const cefrResult = levelFromScore(totalScore) ?? "A1";

  const sectionScores = {
    speaking: {
      task1: buildTaskScoreEntry(evaluations[1], taskOveralls[0]),
      task2: buildTaskScoreEntry(evaluations[2], taskOveralls[1]),
      task3: buildTaskScoreEntry(evaluations[3], taskOveralls[2]),
      compositeOverall,
    },
  };

  const questionsJson = TASK_NUMBERS.map((n) => ({
    taskNumber: n,
    instruction: prompts[n].instruction,
    promptFr: prompts[n].promptFr,
  }));

  // Step 1: Insert mock_tests row
  let mockTestId: string | null = null;
  try {
    const { data, error } = await supabase
      .from("mock_tests")
      .insert({
        user_id: userId,
        test_type: "speaking",
        total_score: totalScore,
        section_scores: sectionScores,
        cefr_result: cefrResult,
        duration_seconds: durationSeconds,
        questions: questionsJson,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    mockTestId = data?.id ?? null;
    // P20: insert returned `error: null` but `data` is null → typically RLS
    // denies the implicit post-insert SELECT. Without this branch the
    // mock_test_answers insert is skipped silently with zero diagnostic
    // trail. Surface as its own phase so triage distinguishes it from a
    // throwing insert failure.
    if (!mockTestId) {
      captureError(
        new Error("mock_tests insert returned no row id"),
        "speaking-mock-test-persist",
        { phase: "step-mock-tests-insert-noid" }
      );
    }
  } catch (err) {
    captureError(err, "speaking-mock-test-persist", { phase: "step-mock-tests-insert" });
  }

  // Step 2: Insert 3 mock_test_answers rows (only if parent insert succeeded)
  if (mockTestId) {
    try {
      const rows = TASK_NUMBERS.map((n, idx) => ({
        mock_test_id: mockTestId,
        user_id: userId,
        question_index: idx,
        // mock_test_answers.selected_option is TEXT (no length cap); we use it
        // for the verbatim transcript per AC #5. is_correct = NULL because
        // production tasks have no objective right answer.
        selected_option: transcripts[n],
        is_correct: null as boolean | null,
      }));
      const { error } = await supabase.from("mock_test_answers").insert(rows);
      if (error) throw error;
    } catch (err) {
      captureError(err, "speaking-mock-test-persist", { phase: "step-mock-test-answers-insert" });
    }
  }

  // Steps 3-6: activity chain — best-effort isolated
  try {
    await updateSkillProgress(
      userId,
      "speaking",
      cefrLevel,
      compositeOverall,
      TCF.SPEAKING_MINUTES
    );
  } catch (err) {
    captureError(err, "speaking-mock-test-persist", { phase: "step-skill-progress" });
  }
  try {
    await incrementDailyActivity(userId, { exercises: 1, minutes: TCF.SPEAKING_MINUTES });
  } catch (err) {
    captureError(err, "speaking-mock-test-persist", { phase: "step-daily-activity" });
  }
  try {
    await updateStreak(userId);
  } catch (err) {
    captureError(err, "speaking-mock-test-persist", { phase: "step-streak" });
  }
  try {
    await checkCefrPromotion(userId);
  } catch (err) {
    captureError(err, "speaking-mock-test-persist", { phase: "step-cefr-promotion" });
  }

  // Cache invalidation — non-critical for the user's flow but stale-cache
  // bugs are a recurring source of hard-to-diagnose UI weirdness. P21:
  // log failures rather than swallow them.
  try {
    await Promise.all([
      invalidateCache(userId, CACHE_KEYS.PROFILE),
      invalidateCache(userId, CACHE_KEYS.SKILLS),
      invalidateCache(userId, CACHE_KEYS.DAILY_ACTIVITY_TODAY),
      invalidateCache(userId, CACHE_KEYS.RECENT_ACTIVITY),
    ]);
  } catch (err) {
    captureError(err, "speaking-mock-test-persist", { phase: "step-cache-invalidation" });
  }

  return {
    totalScore,
    cefrResult,
    compositeOverall,
    taskOveralls,
    mockTestId,
  };
}

function buildTaskScoreEntry(evaluation: SpeakingTaskEvaluation, overall: number) {
  // P14: surface strengths / improvements / corrections / estimatedCEFR in
  // `section_scores.speaking.taskN` so the results screen (and any future
  // recap card) can render the qualitative feedback the model already
  // produced. Without this the user records 12 minutes of audio for an
  // evaluation that gets reduced to a single number.
  return {
    pronunciationFluency: Math.round(evaluation.pronunciationFluencyScore),
    vocabulary: Math.round(evaluation.vocabularyScore),
    grammar: Math.round(evaluation.grammarScore),
    interaction: Math.round(evaluation.interactionScore),
    overall,
    estimatedCEFR: evaluation.estimatedCEFR ?? null,
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    corrections: evaluation.corrections ?? null,
  };
}
