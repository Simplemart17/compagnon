/**
 * Story 9-8 — pure-function tests for the speaking composite math.
 * Story 10-6 — extended to 5 dimensions (added Sociolinguistique per
 * `docs/tcf-spec-source.md §6.3`); `RUBRIC_TO_COMPOSITE` updated `1.25 → 1.0`.
 *
 * No Supabase, no mocks. The helpers in `speaking-scoring.ts` are pure and
 * stand alone; this file exercises every branch of `computeSpeakingTaskOverall`,
 * `computeSpeakingComposite`, and `computeSpeakingScore0to20`.
 */

import {
  computeSpeakingComposite,
  computeSpeakingScore0to20,
  computeSpeakingTaskOverall,
  RUBRIC_TO_COMPOSITE,
} from "../speaking-scoring";
import type { SpeakingTaskEvaluation } from "../schemas/ai-responses";

function evalOf(partial: Partial<SpeakingTaskEvaluation>): SpeakingTaskEvaluation {
  return {
    pronunciationFluencyScore: 0,
    vocabularyScore: 0,
    grammarScore: 0,
    interactionScore: 0,
    sociolinguisticScore: 0,
    strengths: ["ok"],
    improvements: ["ok"],
    ...partial,
  };
}

describe("RUBRIC_TO_COMPOSITE (story 10-6 constant pin)", () => {
  it("equals 1.0 (5 dimensions × 0-20 sum → 0-100 display, no scaling)", () => {
    // Story 10-6: the constant changed from 1.25 (4-dim) to 1.0 (5-dim).
    // Pin the value so an accidental revert (or a future 6th-dimension add)
    // fails this test loudly with a clear migration signal.
    expect(RUBRIC_TO_COMPOSITE).toBe(1.0);
  });

  it("derivation matches `100 / (5 * 20)` rule", () => {
    // The derivation is the single source of truth: the constant equals
    // `COMPOSITE_MAX / (N_DIMENSIONS * DIMENSION_MAX)`. If a future story
    // changes either the composite scale or the number of dimensions, this
    // test must be updated alongside the constant — keeping them in lockstep.
    expect(RUBRIC_TO_COMPOSITE).toBe(100 / (5 * 20));
  });
});

describe("computeSpeakingTaskOverall (story 9-8 + 10-6)", () => {
  it("Case 1: model overall in range → returned as-is (rounded)", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 18,
        vocabularyScore: 16,
        grammarScore: 17,
        interactionScore: 15,
        sociolinguisticScore: 14,
        overallScore: 80,
      })
    );
    expect(result).toBe(80);
  });

  it("Case 2: model overall null → recomputed from 5 dimensions × 1.0 (story 10-6)", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 18,
        vocabularyScore: 16,
        grammarScore: 17,
        interactionScore: 15,
        sociolinguisticScore: 14,
        overallScore: null,
      })
    );
    // (18 + 16 + 17 + 15 + 14) × 1.0 = 80 → rounds to 80
    expect(result).toBe(80);
  });

  it("Case 3: model overall out of range (e.g. 110) → recomputed from 5 dimensions", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 18,
        vocabularyScore: 16,
        grammarScore: 17,
        interactionScore: 15,
        sociolinguisticScore: 14,
        overallScore: 110,
      })
    );
    // (18 + 16 + 17 + 15 + 14) × 1.0 = 80
    expect(result).toBe(80);
  });

  it("Case 4: all 5 dimensions at max (20 each) → overall = 100", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 20,
        grammarScore: 20,
        interactionScore: 20,
        sociolinguisticScore: 20,
        overallScore: null,
      })
    );
    expect(result).toBe(100);
  });

  it("Case 5: all 5 dimensions at 0 → overall = 0", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 0,
        vocabularyScore: 0,
        grammarScore: 0,
        interactionScore: 0,
        sociolinguisticScore: 0,
        overallScore: null,
      })
    );
    expect(result).toBe(0);
  });

  it("Case 5b (story 10-6): all 5 dimensions at 10 → overall = 50", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 10,
        vocabularyScore: 10,
        grammarScore: 10,
        interactionScore: 10,
        sociolinguisticScore: 10,
        overallScore: null,
      })
    );
    // 5 × 10 × 1.0 = 50
    expect(result).toBe(50);
  });

  it("Case 5c (story 10-6): mixed dimensions (20/15/10/5/0) → overall = 50", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 15,
        grammarScore: 10,
        interactionScore: 5,
        sociolinguisticScore: 0,
        overallScore: null,
      })
    );
    // 20 + 15 + 10 + 5 + 0 = 50 × 1.0 = 50
    expect(result).toBe(50);
  });

  it("Case 5d (story 10-6): sociolinguistic dimension drags down an otherwise-strong response", () => {
    // Pedagogically meaningful regression: a candidate who scores 20 on the
    // four linguistic+pragmatic dimensions but 0 on Sociolinguistique (e.g.,
    // wrong register for the scenario) gets 80, not 100. Pre-10-6 they would
    // have scored 100 because Sociolinguistique didn't exist.
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 20,
        grammarScore: 20,
        interactionScore: 20,
        sociolinguisticScore: 0,
        overallScore: null,
      })
    );
    // (20 + 20 + 20 + 20 + 0) × 1.0 = 80
    expect(result).toBe(80);
  });

  it("Case 6: negative or non-finite dimension is clamped to 0", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: -5,
        vocabularyScore: NaN as unknown as number,
        grammarScore: 20,
        interactionScore: 20,
        sociolinguisticScore: 20,
        overallScore: null,
      })
    );
    // Clamped: 0 + 0 + 20 + 20 + 20 = 60 × 1.0 = 60
    expect(result).toBe(60);
  });

  it("Case 6b (story 10-6): non-finite sociolinguistic is clamped to 0", () => {
    // Defensive: the schema rejects NaN at runtime, but the clamp keeps the
    // function safe in isolation. Mirrors the Case 6 contract for the new dim.
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 20,
        grammarScore: 20,
        interactionScore: 20,
        sociolinguisticScore: NaN as unknown as number,
        overallScore: null,
      })
    );
    // 20 + 20 + 20 + 20 + 0 = 80 × 1.0 = 80
    expect(result).toBe(80);
  });

  it("undefined model overall path mirrors the null path", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 10,
        vocabularyScore: 10,
        grammarScore: 10,
        interactionScore: 10,
        sociolinguisticScore: 10,
        // overallScore: undefined (omitted)
      })
    );
    // 5 × 10 × 1.0 = 50
    expect(result).toBe(50);
  });

  it("model overall non-finite (NaN) → recomputed from 5 dimensions", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 12,
        vocabularyScore: 12,
        grammarScore: 12,
        interactionScore: 12,
        sociolinguisticScore: 12,
        overallScore: NaN as unknown as number,
      })
    );
    // 5 × 12 × 1.0 = 60
    expect(result).toBe(60);
  });
});

describe("computeSpeakingComposite (story 9-8 — dimension-agnostic, untouched by 10-6)", () => {
  it("Case 7: composite of [100, 100, 100] = 100", () => {
    expect(computeSpeakingComposite([100, 100, 100])).toBe(100);
  });

  it("Case 8: composite of [0, 50, 100] = 50 (rounds correctly)", () => {
    expect(computeSpeakingComposite([0, 50, 100])).toBe(50);
  });

  it("composite of [83, 76, 71] = 77 (matches AC #6 example)", () => {
    expect(computeSpeakingComposite([83, 76, 71])).toBe(77);
  });

  it("composite clamps individual inputs over 100 to 100", () => {
    expect(computeSpeakingComposite([150, 50, 0])).toBe(50);
  });

  it("composite treats negative inputs as 0", () => {
    expect(computeSpeakingComposite([-30, 60, 60])).toBe(40);
  });
});

describe("computeSpeakingScore0to20 (story 10-2 — dimension-agnostic, untouched by 10-6)", () => {
  it("[100, 100, 100] → composite 100 → publisher 20", () => {
    expect(computeSpeakingScore0to20([100, 100, 100])).toBe(20);
  });

  it("[0, 0, 0] → composite 0 → publisher 0", () => {
    expect(computeSpeakingScore0to20([0, 0, 0])).toBe(0);
  });

  it("[80, 75, 70] → composite 75 → publisher 15 (CLB 9, C1)", () => {
    expect(computeSpeakingScore0to20([80, 75, 70])).toBe(15);
  });

  it("[50, 50, 50] → composite 50 → publisher 10 (CLB 7 — Express Entry)", () => {
    expect(computeSpeakingScore0to20([50, 50, 50])).toBe(10);
  });

  it("clamps individual inputs over 100 → final result still in [0, 20]", () => {
    expect(computeSpeakingScore0to20([150, 150, 150])).toBe(20);
  });

  it("treats negative inputs as 0 → final result floors at 0", () => {
    expect(computeSpeakingScore0to20([-10, 0, 0])).toBe(0);
  });

  it("rounds correctly: [80, 90, 75] → composite 82 (rounded from 81.67) → 82/5 = 16.4 → 16", () => {
    // computeSpeakingComposite rounds to 82 internally; computeSpeakingScore0to20
    // then divides 82/5 = 16.4 → Math.round → 16.
    expect(computeSpeakingScore0to20([80, 90, 75])).toBe(16);
  });

  it("composite 5 → publisher 1 (just above CLB-1 floor)", () => {
    expect(computeSpeakingScore0to20([5, 5, 5])).toBe(1);
  });
});

describe("Story 10-6 — end-to-end 5-dim → publisher-scale routing", () => {
  // Validate that the 5-dim recompute → composite → 0-20 mapping holds across
  // realistic per-task evaluations. These are the integration cases the
  // production pipeline runs: 3 task evaluations → composite 0-100 → 0-20 scale.
  it("3 tasks at 5×20 each → all overalls 100 → composite 100 → publisher 20", () => {
    const t1 = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 20,
        grammarScore: 20,
        interactionScore: 20,
        sociolinguisticScore: 20,
        overallScore: null,
      })
    );
    const t2 = t1;
    const t3 = t1;
    expect(computeSpeakingComposite([t1, t2, t3])).toBe(100);
    expect(computeSpeakingScore0to20([t1, t2, t3])).toBe(20);
  });

  it("3 tasks at 5×10 each → all overalls 50 → composite 50 → publisher 10 (CLB 7)", () => {
    const t = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 10,
        vocabularyScore: 10,
        grammarScore: 10,
        interactionScore: 10,
        sociolinguisticScore: 10,
        overallScore: null,
      })
    );
    expect(t).toBe(50);
    expect(computeSpeakingComposite([t, t, t])).toBe(50);
    expect(computeSpeakingScore0to20([t, t, t])).toBe(10);
  });

  it("Sociolinguistic-blind candidate (4 strong dims + 0 socio) — pulled down by the 5th dim", () => {
    // Pedagogically meaningful: a candidate strong on linguistique+pragmatique
    // but wrong-register on every task now drops a tier vs the pre-10-6 4-dim
    // scoring that would have scored them 20/20.
    const t = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 20,
        grammarScore: 20,
        interactionScore: 20,
        sociolinguisticScore: 0,
        overallScore: null,
      })
    );
    expect(t).toBe(80);
    expect(computeSpeakingScore0to20([t, t, t])).toBe(16);
  });
});
