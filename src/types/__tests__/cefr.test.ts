/**
 * Story 10-7 — CEFR_LEVELS `nameFr` Alliance Française school convention
 * (docs/tcf-spec-source.md §8.2).
 *
 * §8.2 lists four institutional French CEFR-naming conventions and directs
 * Epic 10.7 to pick one and apply it uniformly to all six levels. Alliance
 * Française was chosen (preserves the 3-family structure Élémentaire /
 * Intermédiaire / Avancé; uses a natural 1/2 sub-level distinguisher;
 * familiar to FLE students).
 *
 * Negative assertions pin the audit's "drop 'Élémentaire avancé'" and
 * "drop 'Maîtrise' (mixed in Eduscol parenthetical)" deletion claims.
 */

import { CEFR_LEVELS, CEFR_ORDER } from "../cefr";

describe("CEFR_LEVELS nameFr — Alliance Française convention (Story 10-7 / §8.2)", () => {
  it("A1.nameFr = 'Élémentaire 1'", () => {
    expect(CEFR_LEVELS.A1.nameFr).toBe("Élémentaire 1");
  });

  it("A2.nameFr = 'Élémentaire 2' (NOT the pre-10-7 audit-flagged 'Élémentaire avancé')", () => {
    expect(CEFR_LEVELS.A2.nameFr).toBe("Élémentaire 2");
    expect(CEFR_LEVELS.A2.nameFr).not.toBe("Élémentaire avancé");
  });

  it("B1.nameFr = 'Intermédiaire 1'", () => {
    expect(CEFR_LEVELS.B1.nameFr).toBe("Intermédiaire 1");
  });

  it("B2.nameFr = 'Intermédiaire 2'", () => {
    expect(CEFR_LEVELS.B2.nameFr).toBe("Intermédiaire 2");
    expect(CEFR_LEVELS.B2.nameFr).not.toBe("Intermédiaire avancé");
  });

  it("C1.nameFr = 'Avancé 1'", () => {
    expect(CEFR_LEVELS.C1.nameFr).toBe("Avancé 1");
  });

  it("C2.nameFr = 'Avancé 2' (NOT the pre-10-7 'Maîtrise')", () => {
    expect(CEFR_LEVELS.C2.nameFr).toBe("Avancé 2");
    expect(CEFR_LEVELS.C2.nameFr).not.toBe("Maîtrise");
  });

  it("all 6 nameFr follow the same '<Élémentaire|Intermédiaire|Avancé> <1|2>' convention", () => {
    for (const level of CEFR_ORDER) {
      const label = CEFR_LEVELS[level].nameFr;
      expect(label).toMatch(/^(Élémentaire|Intermédiaire|Avancé) [12]$/);
    }
  });

  it("English `name` fields are NOT changed by Story 10-7", () => {
    // Defensive guard: the audit only flags `nameFr`. English labels are
    // stable across this story. A future patch that touches `name`
    // should be deliberate.
    expect(CEFR_LEVELS.A1.name).toBe("Beginner");
    expect(CEFR_LEVELS.A2.name).toBe("Elementary");
    expect(CEFR_LEVELS.B1.name).toBe("Intermediate");
    expect(CEFR_LEVELS.B2.name).toBe("Upper Intermediate");
    expect(CEFR_LEVELS.C1.name).toBe("Advanced");
    expect(CEFR_LEVELS.C2.name).toBe("Mastery");
  });

  it("tcfScoreMin / tcfScoreMax bands are NOT changed by Story 10-7", () => {
    // Story 10-2 owns the per-skill TCF scoring scales. Story 10-7 must
    // not regress the UI-display round-number bands.
    expect(CEFR_LEVELS.A1.tcfScoreMin).toBe(100);
    expect(CEFR_LEVELS.A1.tcfScoreMax).toBe(199);
    expect(CEFR_LEVELS.C2.tcfScoreMin).toBe(600);
    expect(CEFR_LEVELS.C2.tcfScoreMax).toBe(699);
  });
});
