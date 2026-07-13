import { determinePlacementLevel, previousLevel } from "@/src/lib/placement-scoring";
import type { CEFRLevel } from "@/src/types/cefr";

type Counts = Record<CEFRLevel, number>;

const ZERO: Counts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
const counts = (partial: Partial<Counts>): Counts => ({ ...ZERO, ...partial });

describe("determinePlacementLevel", () => {
  describe("stop-early path", () => {
    it("returns the level below where the user failed out", () => {
      expect(determinePlacementLevel(counts({ C1: 2 }), counts({}), true, "C1")).toBe("B2");
      expect(determinePlacementLevel(counts({ A2: 2 }), counts({}), true, "A2")).toBe("A1");
      expect(determinePlacementLevel(counts({ A1: 2 }), counts({}), true, "A1")).toBe("A1");
    });
  });

  describe("full 15-question flow (all levels attempted)", () => {
    it("places at C2 when every level is attempted and passed", () => {
      const corrects = counts({ A1: 3, A2: 3, B1: 3, B2: 3, C1: 2, C2: 1 });
      expect(determinePlacementLevel(ZERO, corrects, false)).toBe("C2");
    });

    it("places at the highest passed level, breaking at a failed mid level", () => {
      // A1/A2 passed, B1 failed (2 wrong) → break at B1 → A2.
      const corrects = counts({ A1: 3, A2: 3, B1: 1 });
      const wrongs = counts({ B1: 2 });
      expect(determinePlacementLevel(wrongs, corrects, false)).toBe("A2");
    });
  });

  describe("REGRESSION: short response drops trailing levels (schema .min(12))", () => {
    it("does NOT over-place a B2 user to C2 when C1/C2 were never asked", () => {
      // 12-question response: A1:3/A2:3/B1:3/B2:3, C1:0, C2:0. User passes all
      // attempted levels. Pre-fix: C1/C2 had 0 wrongs → counted as passed → C2.
      const corrects = counts({ A1: 3, A2: 3, B1: 3, B2: 3 });
      expect(determinePlacementLevel(ZERO, corrects, false)).toBe("B2");
    });

    it("does NOT over-place when only C2 (q15) is dropped (14-question response)", () => {
      // C1 attempted+passed (1 wrong of 2), C2 absent → place at C1, not C2.
      const corrects = counts({ A1: 3, A2: 3, B1: 3, B2: 3, C1: 1 });
      const wrongs = counts({ C1: 1 });
      expect(determinePlacementLevel(wrongs, corrects, false)).toBe("C1");
    });
  });

  describe("attempted-gate boundary", () => {
    it("a level with a single correct answer counts as attempted+passed", () => {
      expect(determinePlacementLevel(ZERO, counts({ A1: 1 }), false)).toBe("A1");
    });

    it("breaks at the first unattempted level even if later levels have data", () => {
      // A1 attempted+passed; A2 unattempted (0/0); B1 has data (shouldn't be
      // reachable in practice, but the gate must break at A2 regardless).
      const corrects = counts({ A1: 3, B1: 3 });
      expect(determinePlacementLevel(ZERO, corrects, false)).toBe("A1");
    });

    it("defaults to A1 when nothing was attempted", () => {
      expect(determinePlacementLevel(ZERO, ZERO, false)).toBe("A1");
    });
  });
});

describe("previousLevel", () => {
  it("returns the prior CEFR level, clamped at A1", () => {
    expect(previousLevel("C2")).toBe("C1");
    expect(previousLevel("B1")).toBe("A2");
    expect(previousLevel("A1")).toBe("A1");
  });
});
