/**
 * Story 9-8 — pure-function tests for the speaking composite math.
 *
 * No Supabase, no mocks. The helpers in `speaking-scoring.ts` are pure and
 * stand alone; this file exercises every branch of `computeSpeakingTaskOverall`
 * and `computeSpeakingComposite`.
 */

import {
  computeSpeakingComposite,
  computeSpeakingScore0to20,
  computeSpeakingTaskOverall,
} from "../speaking-scoring";
import type { SpeakingTaskEvaluation } from "../schemas/ai-responses";

function evalOf(partial: Partial<SpeakingTaskEvaluation>): SpeakingTaskEvaluation {
  return {
    pronunciationFluencyScore: 0,
    vocabularyScore: 0,
    grammarScore: 0,
    interactionScore: 0,
    strengths: ["ok"],
    improvements: ["ok"],
    ...partial,
  };
}

describe("computeSpeakingTaskOverall (story 9-8)", () => {
  it("Case 1: model overall in range → returned as-is (rounded)", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 18,
        vocabularyScore: 16,
        grammarScore: 17,
        interactionScore: 15,
        overallScore: 80,
      })
    );
    expect(result).toBe(80);
  });

  it("Case 2: model overall null → recomputed from 4 dimensions × 1.25", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 18,
        vocabularyScore: 16,
        grammarScore: 17,
        interactionScore: 15,
        overallScore: null,
      })
    );
    // (18 + 16 + 17 + 15) × 1.25 = 82.5 → rounds to 83
    expect(result).toBe(83);
  });

  it("Case 3: model overall out of range (e.g. 110) → recomputed from dimensions", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 18,
        vocabularyScore: 16,
        grammarScore: 17,
        interactionScore: 15,
        overallScore: 110,
      })
    );
    expect(result).toBe(83);
  });

  it("Case 4: all 4 dimensions at max (20 each) → overall = 100", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 20,
        vocabularyScore: 20,
        grammarScore: 20,
        interactionScore: 20,
        overallScore: null,
      })
    );
    expect(result).toBe(100);
  });

  it("Case 5: all 4 dimensions at 0 → overall = 0", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 0,
        vocabularyScore: 0,
        grammarScore: 0,
        interactionScore: 0,
        overallScore: null,
      })
    );
    expect(result).toBe(0);
  });

  it("Case 6: negative or non-finite dimension is clamped to 0", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: -5,
        vocabularyScore: NaN as unknown as number,
        grammarScore: 20,
        interactionScore: 20,
        overallScore: null,
      })
    );
    // Clamped: 0 + 0 + 20 + 20 = 40 × 1.25 = 50
    expect(result).toBe(50);
  });

  it("undefined model overall path mirrors the null path", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 10,
        vocabularyScore: 10,
        grammarScore: 10,
        interactionScore: 10,
        // overallScore: undefined (omitted)
      })
    );
    // 40 × 1.25 = 50
    expect(result).toBe(50);
  });

  it("model overall non-finite (NaN) → recomputed from dimensions", () => {
    const result = computeSpeakingTaskOverall(
      evalOf({
        pronunciationFluencyScore: 12,
        vocabularyScore: 12,
        grammarScore: 12,
        interactionScore: 12,
        overallScore: NaN as unknown as number,
      })
    );
    // 48 × 1.25 = 60
    expect(result).toBe(60);
  });
});

describe("computeSpeakingComposite (story 9-8)", () => {
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

describe("computeSpeakingScore0to20 (story 10-2)", () => {
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

  it("rounds correctly: composite 81.67 (from 80/90/75) → 82/5 = 16.4 → 16", () => {
    expect(computeSpeakingScore0to20([80, 90, 75])).toBe(16);
  });

  it("composite 5 → publisher 1 (just above CLB-1 floor)", () => {
    expect(computeSpeakingScore0to20([5, 5, 5])).toBe(1);
  });
});
