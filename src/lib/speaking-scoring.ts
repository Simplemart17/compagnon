/**
 * Pure scoring helpers for the TCF Canada Expression Orale mock test.
 *
 * Story 9-8.
 *
 * Lives in its own file (not in `scoring.ts`) because `scoring.ts` carries an
 * explicit "do not edit in story 9-1 / Epic 10.2" guard around `SKILL_WEIGHTS`.
 * Keeping speaking math here avoids any accidental edit of guarded code and
 * makes the new logic discoverable and testable as a standalone unit.
 */

import type { SpeakingTaskEvaluation } from "@/src/lib/schemas/ai-responses";

/** TCF Expression Orale rubric: each dimension is on the 0-20 scale. */
const DIMENSION_MAX = 20;

/** Composite display scale (0-100) used elsewhere in the app. */
const COMPOSITE_MAX = 100;

/** 4 dimensions × 1.25 = 100 (mapping 0-80 rubric sum to 0-100 display). */
const RUBRIC_TO_COMPOSITE = COMPOSITE_MAX / (4 * DIMENSION_MAX);

/** Clamp a numeric input to [0, max]; non-finite values become 0. */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/**
 * Compute the per-task overall score on the 0-100 scale.
 *
 * Prefers the model's `overallScore` when present and within [0, 100];
 * otherwise recomputes deterministically as
 * `(pronunciationFluency + vocabulary + grammar + interaction) × 1.25`.
 *
 * Each dimension is clamped to [0, 20] before recompute, so an out-of-range
 * model emission does not skew the result. (Out-of-range dimensions fail Zod
 * parsing in `chatCompletionJSON` per story 9-7, so they should not normally
 * reach this helper, but the clamp keeps the function safe in isolation.)
 *
 * Returns an integer (rounded). Returns 0 if every input is missing/invalid.
 */
export function computeSpeakingTaskOverall(scores: SpeakingTaskEvaluation): number {
  const modelOverall = scores.overallScore;
  if (
    typeof modelOverall === "number" &&
    Number.isFinite(modelOverall) &&
    modelOverall >= 0 &&
    modelOverall <= COMPOSITE_MAX
  ) {
    return Math.round(modelOverall);
  }

  const pron = clamp(scores.pronunciationFluencyScore, DIMENSION_MAX);
  const vocab = clamp(scores.vocabularyScore, DIMENSION_MAX);
  const grammar = clamp(scores.grammarScore, DIMENSION_MAX);
  const interact = clamp(scores.interactionScore, DIMENSION_MAX);

  const composite = (pron + vocab + grammar + interact) * RUBRIC_TO_COMPOSITE;
  return Math.round(clamp(composite, COMPOSITE_MAX));
}

/**
 * Compute the test composite from 3 task overalls. Equal-weighted (each task
 * counts as 1/3 of the composite), rounded to the nearest integer.
 *
 * Why equal weights: the TCF Canada Expression Orale publisher reports one
 * score per task and the section composite is the simple mean across tasks.
 * Recalibration (per-task weighting, examiner adjustment factors) is owned by
 * Epic 10.2 (`shippable-roadmap.md` line 158) and is explicitly NOT in scope
 * for this story.
 *
 * Each input is clamped to [0, 100] for safety. If a task is missing entirely
 * (e.g. user skipped after a transcription failure), the caller should pass 0
 * for that task — the composite remains a 3-task average so a skipped task
 * pulls the result down, which is the correct pedagogical signal.
 */
export function computeSpeakingComposite(taskOveralls: [number, number, number]): number {
  const t1 = clamp(taskOveralls[0], COMPOSITE_MAX);
  const t2 = clamp(taskOveralls[1], COMPOSITE_MAX);
  const t3 = clamp(taskOveralls[2], COMPOSITE_MAX);
  return Math.round((t1 + t2 + t3) / 3);
}

/**
 * Map 3 task overalls (each on the internal 0–100 scale) to the publisher's
 * 0–20 Speaking scale (Story 10-2).
 *
 * The publisher (per docs/tcf-spec-source.md §2.1) scores Expression Orale on
 * 0–20; the internal 0–100 composite (story 9-8) is the sum-of-4-dimensions
 * × 1.25 — so the inverse mapping is `composite / 5`. Equivalent to averaging
 * the 4 dimensions directly, but routed through the existing 0–100 composite
 * for continuity with story 9-8's task-overall computation.
 *
 * Each input is clamped to [0, 100]; the result is clamped to [0, 20] and
 * rounded to the nearest integer.
 *
 * Used by `src/lib/speaking-mock-test-persist.ts` to persist
 * `mock_tests.total_score` on the publisher scale for `test_type="speaking"`
 * rows. Pre-10-2 historical rows hold legacy 0–699 values from the deleted
 * `rawToTCFScore` path (the discontinuity is documented; Epic 17.1 owns
 * eventual schema versioning).
 */
export function computeSpeakingScore0to20(taskOveralls: [number, number, number]): number {
  const composite = computeSpeakingComposite(taskOveralls);
  const publisherScore = composite / 5;
  return Math.round(clamp(publisherScore, 20));
}
