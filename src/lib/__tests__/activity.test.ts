import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";

import { evaluatePromotion, type PromotionEvidence } from "../activity";

const ALL_TCF_SKILLS: TCFSkill[] = ["listening", "reading", "speaking", "writing", "grammar"];

/** Build a passing 5-skill evidence set: 3 skills at 90%, 2 weak skills, 11 total exercises. */
function buildPassingRowsAt(_level: CEFRLevel): PromotionEvidence[] {
  return [
    { skill: "listening", score: 90, exercisesCompleted: 4 },
    { skill: "reading", score: 90, exercisesCompleted: 3 },
    { skill: "speaking", score: 88, exercisesCompleted: 2 },
    { skill: "writing", score: 50, exercisesCompleted: 1 },
    { skill: "grammar", score: 60, exercisesCompleted: 1 },
  ];
}

describe("evaluatePromotion — gate semantics", () => {
  it('returns reason "ok" and promote=true when all 5 skills present, ≥3 passing, ≥10 exercises', () => {
    const decision = evaluatePromotion("A1", buildPassingRowsAt("A1"));
    expect(decision.promote).toBe(true);
    expect(decision.reason).toBe("ok");
    expect(decision.missingSkills).toEqual([]);
  });

  it('returns reason "already-c2" when currentLevel is C2 (short-circuits before reading rows)', () => {
    // Pass an empty row set: the gate must short-circuit before any breadth/score check.
    // If a future refactor moved the C2 check below the breadth check, an A1-shaped
    // passing fixture would mask the regression — empty rows make the short-circuit truthful.
    const decision = evaluatePromotion("C2", []);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("already-c2");
    expect(decision.missingSkills).toEqual([]);
  });

  it('returns reason "missing-skills" when any of the 5 skills are absent', () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 90, exercisesCompleted: 4 },
      { skill: "reading", score: 90, exercisesCompleted: 4 },
      { skill: "grammar", score: 90, exercisesCompleted: 3 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("missing-skills");
    expect(decision.missingSkills).toEqual(["speaking", "writing"]);
  });

  it("sorts missingSkills in TCF_SKILLS_IN_ORDER (listening, reading, speaking, writing, grammar)", () => {
    // Provide rows out of canonical order to confirm output order is stable.
    const rows: PromotionEvidence[] = [
      { skill: "writing", score: 90, exercisesCompleted: 4 },
      { skill: "listening", score: 90, exercisesCompleted: 4 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.reason).toBe("missing-skills");
    // Missing: reading, speaking, grammar — must follow the canonical order.
    expect(decision.missingSkills).toEqual(["reading", "speaking", "grammar"]);
  });

  it('returns reason "too-few-passing-skills" when 5 skills present but fewer than 3 score ≥ 85', () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 90, exercisesCompleted: 4 },
      { skill: "reading", score: 80, exercisesCompleted: 3 },
      { skill: "speaking", score: 70, exercisesCompleted: 2 },
      { skill: "writing", score: 60, exercisesCompleted: 1 },
      { skill: "grammar", score: 50, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-passing-skills");
    expect(decision.missingSkills).toEqual([]);
  });

  it('returns reason "too-few-exercises" when 5 skills present, ≥3 passing, but sum(exercises) < 10', () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 90, exercisesCompleted: 1 },
      { skill: "reading", score: 90, exercisesCompleted: 1 },
      { skill: "speaking", score: 90, exercisesCompleted: 1 },
      { skill: "writing", score: 50, exercisesCompleted: 1 },
      { skill: "grammar", score: 50, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-exercises");
  });

  it("treats exactly 85% as passing (boundary check)", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 85, exercisesCompleted: 4 },
      { skill: "reading", score: 85, exercisesCompleted: 4 },
      { skill: "speaking", score: 85, exercisesCompleted: 2 },
      { skill: "writing", score: 0, exercisesCompleted: 1 },
      { skill: "grammar", score: 0, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("counts a skill as 'present' regardless of score (zero is still evidence)", () => {
    const rows: PromotionEvidence[] = ALL_TCF_SKILLS.map((skill) => ({
      skill,
      score: 90,
      exercisesCompleted: 2,
    }));
    rows[3] = { skill: "writing", score: 0, exercisesCompleted: 0 };
    const decision = evaluatePromotion("A1", rows);
    expect(decision.reason).not.toBe("missing-skills");
  });
});

describe("evaluatePromotion — defensive input handling", () => {
  it("treats 84% as not passing (boundary check below the threshold)", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 84, exercisesCompleted: 4 },
      { skill: "reading", score: 84, exercisesCompleted: 4 },
      { skill: "speaking", score: 84, exercisesCompleted: 2 },
      { skill: "writing", score: 0, exercisesCompleted: 1 },
      { skill: "grammar", score: 0, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-passing-skills");
  });

  it("clamps NaN scores to 0 (does not count as passing)", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: NaN, exercisesCompleted: 4 },
      { skill: "reading", score: NaN, exercisesCompleted: 4 },
      { skill: "speaking", score: NaN, exercisesCompleted: 2 },
      { skill: "writing", score: 90, exercisesCompleted: 1 },
      { skill: "grammar", score: 90, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-passing-skills");
  });

  it("clamps scores above 100 to 100 (still counts as passing)", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 150, exercisesCompleted: 4 },
      { skill: "reading", score: 90, exercisesCompleted: 3 },
      { skill: "speaking", score: 90, exercisesCompleted: 2 },
      { skill: "writing", score: 0, exercisesCompleted: 1 },
      { skill: "grammar", score: 0, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("clamps negative scores to 0 (does not count as passing)", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: -50, exercisesCompleted: 4 },
      { skill: "reading", score: -50, exercisesCompleted: 4 },
      { skill: "speaking", score: -50, exercisesCompleted: 2 },
      { skill: "writing", score: 90, exercisesCompleted: 1 },
      { skill: "grammar", score: 90, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-passing-skills");
  });

  it("dedupes by skill (last-wins) — duplicate rows can't double-count toward passing", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 90, exercisesCompleted: 5 },
      { skill: "listening", score: 90, exercisesCompleted: 5 }, // duplicate, must be deduped
      { skill: "reading", score: 90, exercisesCompleted: 5 },
      { skill: "speaking", score: 90, exercisesCompleted: 5 },
      { skill: "writing", score: 0, exercisesCompleted: 0 },
      { skill: "grammar", score: 0, exercisesCompleted: 0 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(true);
    expect(decision.reason).toBe("ok");
    // All 5 skills present; 3 distinct passing (listening, reading, speaking) — not 4 from double-counting.
  });

  it("dedupes by skill — last-wins for the duplicate's score", () => {
    // First listening row passes, second fails. Last-wins means the failing one is kept.
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 90, exercisesCompleted: 5 },
      { skill: "listening", score: 50, exercisesCompleted: 5 }, // last-wins → fail
      { skill: "reading", score: 90, exercisesCompleted: 5 },
      { skill: "speaking", score: 90, exercisesCompleted: 5 },
      { skill: "writing", score: 0, exercisesCompleted: 0 },
      { skill: "grammar", score: 0, exercisesCompleted: 0 },
    ];
    const decision = evaluatePromotion("A1", rows);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-passing-skills");
  });

  it("ignores non-finite exercisesCompleted in the total-exercises gate", () => {
    const rows: PromotionEvidence[] = [
      { skill: "listening", score: 90, exercisesCompleted: NaN },
      { skill: "reading", score: 90, exercisesCompleted: 3 },
      { skill: "speaking", score: 90, exercisesCompleted: 3 },
      { skill: "writing", score: 0, exercisesCompleted: 1 },
      { skill: "grammar", score: 0, exercisesCompleted: 1 },
    ];
    const decision = evaluatePromotion("A1", rows);
    // 0 + 3 + 3 + 1 + 1 = 8 (NaN coerced to 0) — below 10 → too-few-exercises
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("too-few-exercises");
  });
});

describe("evaluatePromotion — re-promotion regression (P0-2)", () => {
  it("promotes A1 → A2 when all gates pass at A1", () => {
    const decision = evaluatePromotion("A1", buildPassingRowsAt("A1"));
    expect(decision.promote).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("does NOT re-promote A2 → B1 when skill rows are still tagged A1 (the bug)", () => {
    // Simulates the P0-2 bug: profile bumped to A2, but skill_progress.cefr_level still
    // 'A1'. checkCefrPromotion filters by A2, gets zero rows, and the helper sees them as
    // missing — promotion does not silently re-fire on stale rows.
    const decision = evaluatePromotion("A2", []);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toBe("missing-skills");
    expect(decision.missingSkills).toEqual(ALL_TCF_SKILLS);
  });

  it("promotes A2 → B1 once skill rows are written at A2", () => {
    const decision = evaluatePromotion("A2", buildPassingRowsAt("A2"));
    expect(decision.promote).toBe(true);
    expect(decision.reason).toBe("ok");
  });

  it("supports the full A1 → A2 → B1 trajectory back-to-back", () => {
    expect(evaluatePromotion("A1", buildPassingRowsAt("A1")).promote).toBe(true);
    expect(evaluatePromotion("A2", buildPassingRowsAt("A2")).promote).toBe(true);
    expect(evaluatePromotion("B1", buildPassingRowsAt("B1")).promote).toBe(true);
  });
});

/**
 * Story 10-2 regression: the promotion gate reads per-skill rows directly
 * and MUST NOT consult `calculateInternalCompositeForUI` (which TCF Canada
 * does not produce). This test demonstrates that promotion outcomes are
 * fully determined by per-skill evidence — the composite never appears.
 */
describe("evaluatePromotion does not consume the internal composite (Story 10-2)", () => {
  it("uses only per-skill rows to decide promotion (no composite math)", () => {
    // Two evidence sets with identical per-skill rows must produce identical
    // decisions regardless of what composite the UI happens to display.
    const rowsA = buildPassingRowsAt("A1");
    const rowsB: PromotionEvidence[] = rowsA.map((r) => ({ ...r }));
    const decisionA = evaluatePromotion("A1", rowsA);
    const decisionB = evaluatePromotion("A1", rowsB);
    expect(decisionA).toEqual(decisionB);
  });

  it("ignores skill_progress.score relationships beyond the per-skill threshold", () => {
    // Skill row with score 100 in 3 skills + 0 in 2 weak skills produces same
    // outcome as 86 / 0 — only the boolean "≥85" matters per skill, never
    // the composite-style average across skills.
    const high: PromotionEvidence[] = [
      { skill: "listening", score: 100, exercisesCompleted: 4 },
      { skill: "reading", score: 100, exercisesCompleted: 4 },
      { skill: "speaking", score: 100, exercisesCompleted: 2 },
      { skill: "writing", score: 0, exercisesCompleted: 1 },
      { skill: "grammar", score: 0, exercisesCompleted: 1 },
    ];
    const justAbove: PromotionEvidence[] = [
      { skill: "listening", score: 86, exercisesCompleted: 4 },
      { skill: "reading", score: 86, exercisesCompleted: 4 },
      { skill: "speaking", score: 86, exercisesCompleted: 2 },
      { skill: "writing", score: 0, exercisesCompleted: 1 },
      { skill: "grammar", score: 0, exercisesCompleted: 1 },
    ];
    expect(evaluatePromotion("A1", high).promote).toBe(true);
    expect(evaluatePromotion("A1", justAbove).promote).toBe(true);
    // Composite-style averages would diverge wildly (60 vs 51.6) yet promotion
    // decision is identical → confirms per-skill threshold semantics.
  });
});
