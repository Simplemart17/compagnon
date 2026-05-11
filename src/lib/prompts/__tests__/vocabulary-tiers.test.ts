/**
 * Story 10-4 — vocabulary-tiers.ts helper + builder tests.
 *
 * Pin the per-CEFR vocabulary tier helper outputs against the
 * source-of-truth at docs/tcf-spec-source.md §7.2 (heuristic caps;
 * NOT Beacco-verbatim — Phase-2 replacement deferred per §10b item
 * #5) and §8.1 (forbidden tokens — `force est de constater` is C1+,
 * `néanmoins` / `toutefois` / `en l'occurrence` are C1+, etc.).
 *
 * The contract is "the AI receives this constraint block in the
 * prompt." Substring assertions on the rendered output, not
 * implementation internals. Story 9-4 prompt-injection defense is
 * verified by the determinism check (same input → byte-identical
 * output, no time/randomness/user-input dependencies).
 *
 * Story 10-4 review patch P1 added monotonicity-by-construction tests
 * (forbidden lists derived from `LEXICAL_MIN_LEVEL`); P2 added
 * exemplar-dedup tests; P5 broadened the throw-on-non-CEFR coverage
 * to include null / lowercase / whitespace inputs.
 */

import type { CEFRLevel } from "@/src/types/cefr";

import {
  buildAggregatedVocabularyConstraintTable,
  buildVocabularyConstraintBlock,
  vocabularyTier,
} from "../vocabulary-tiers";

const ALL_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

describe("vocabularyTier(cefrLevel) — per-CEFR data shape (Story 10-4, §7.2)", () => {
  it.each(ALL_LEVELS)("%s: exposes a complete VocabularyTier shape", (level) => {
    const tier = vocabularyTier(level);
    expect(tier.approxWordCap).toBeGreaterThan(0);
    expect(typeof tier.capRationale).toBe("string");
    expect(tier.capRationale.length).toBeGreaterThan(0);
    expect(Array.isArray(tier.exemplars)).toBe(true);
    expect(tier.exemplars.length).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(tier.forbiddenLowerTier)).toBe(true);
  });

  it("A1 cap is 700 (midpoint of §7.2 range 500-900)", () => {
    expect(vocabularyTier("A1").approxWordCap).toBe(700);
  });

  it("A2 cap is 1700 (midpoint of §7.2 range 1500-1800)", () => {
    expect(vocabularyTier("A2").approxWordCap).toBe(1700);
  });

  it("B1 cap is 2800 (midpoint of §7.2 range 2500-3000)", () => {
    expect(vocabularyTier("B1").approxWordCap).toBe(2800);
  });

  it('B2 cap is 5000 (floor of §7.2 "5000+")', () => {
    expect(vocabularyTier("B2").approxWordCap).toBe(5000);
  });

  it("C1 cap is 7500 (§7.2 5000+ specialized; midpoint with C2)", () => {
    expect(vocabularyTier("C1").approxWordCap).toBe(7500);
  });

  it('C2 cap is 10000 (floor of §7.2 "10000+")', () => {
    expect(vocabularyTier("C2").approxWordCap).toBe(10000);
  });

  it("caps are monotonically increasing A1 → C2", () => {
    const caps = ALL_LEVELS.map((level) => vocabularyTier(level).approxWordCap);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThan(caps[i - 1]);
    }
  });

  it("throws on non-CEFR runtime input — Story 10-4 review patch P5", () => {
    // TypeScript narrows the param to `CEFRLevel` at compile time, but a
    // deserialised DB row or deep-link param can escape narrowing. Same
    // defensive pattern as `writingTaskWordRange` (Story 10-3). Exhaustive
    // fall-back coverage so any non-{A1,A2,B1,B2,C1,C2} input fails fast.
    const invalidInputs: unknown[] = [
      "D1",
      "",
      undefined,
      null,
      "a1", // lowercase — case-sensitive lookup must reject
      "A1 ", // whitespace-padded
      " A1",
      0,
      1,
      {},
      [],
    ];
    for (const input of invalidInputs) {
      expect(() => vocabularyTier(input as unknown as CEFRLevel)).toThrow(/unsupported cefrLevel/);
    }
  });
});

describe("forbidden-tier monotonicity (Story 10-4 review patch P1, §8.1)", () => {
  // Forbidden lists are derived from a single `LEXICAL_MIN_LEVEL` map so
  // monotonicity holds by construction: if a token has min-level B1, it
  // is forbidden at A1 AND A2. Pre-patch the spec's hand-coded lists
  // contained `cependant` at A1 but omitted it at A2 — the BH review
  // flagged this; the patch makes monotonicity an invariant.

  it("if token T is forbidden at level X, T is also forbidden at every level lower than X", () => {
    for (let i = 0; i < ALL_LEVELS.length - 1; i++) {
      const lower = ALL_LEVELS[i];
      const higher = ALL_LEVELS[i + 1];
      const lowerForbidden = new Set(vocabularyTier(lower).forbiddenLowerTier);
      const higherForbidden = vocabularyTier(higher).forbiddenLowerTier;
      for (const token of higherForbidden) {
        expect(lowerForbidden.has(token)).toBe(true);
      }
    }
  });

  it("|forbidden(level X)| is monotonically non-increasing as X rises (A1 ≥ A2 ≥ … ≥ C2)", () => {
    const sizes = ALL_LEVELS.map((level) => vocabularyTier(level).forbiddenLowerTier.length);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    }
  });

  it("A1 forbidden list contains all upper-register markers (B1+, B2+, C1+)", () => {
    const forbidden = vocabularyTier("A1").forbiddenLowerTier;
    expect(forbidden).toContain("cependant"); // B1+
    expect(forbidden).toContain("pourtant"); // B1+ (BH-flagged regression target)
    expect(forbidden).toContain("en effet"); // B2+
    expect(forbidden).toContain("par conséquent"); // B2+
    expect(forbidden).toContain("néanmoins"); // C1+
    expect(forbidden).toContain("toutefois"); // C1+
    expect(forbidden).toContain("force est de constater"); // C1+
    expect(forbidden).toContain("en l'occurrence"); // C1+
  });

  it("A2 forbidden list contains every C1+ AND B2+ AND B1+ token (monotonicity guarantee)", () => {
    const forbidden = vocabularyTier("A2").forbiddenLowerTier;
    expect(forbidden).toContain("cependant"); // BH P1: was missing pre-patch
    expect(forbidden).toContain("pourtant"); // BH P1: was missing pre-patch
    expect(forbidden).toContain("en effet"); // BH-implied: B2+ should be forbidden at A2
    expect(forbidden).toContain("par conséquent");
    expect(forbidden).toContain("néanmoins");
    expect(forbidden).toContain("force est de constater");
  });

  it("B1 forbidden list excludes B1-introduced tokens (cependant, pourtant) but contains B2+ and C1+", () => {
    const forbidden = vocabularyTier("B1").forbiddenLowerTier;
    expect(forbidden).not.toContain("cependant");
    expect(forbidden).not.toContain("pourtant");
    expect(forbidden).toContain("en effet");
    expect(forbidden).toContain("par conséquent");
    expect(forbidden).toContain("néanmoins");
    expect(forbidden).toContain("force est de constater");
  });

  it("B2 forbidden list excludes B2-introduced tokens (en effet, par conséquent) but contains C1+", () => {
    const forbidden = vocabularyTier("B2").forbiddenLowerTier;
    expect(forbidden).not.toContain("en effet");
    expect(forbidden).not.toContain("par conséquent");
    expect(forbidden).toContain("néanmoins");
    expect(forbidden).toContain("force est de constater");
    expect(forbidden).toContain("toutefois");
  });

  it("C1 forbidden list is empty (full upper register expected — spec choice)", () => {
    expect(vocabularyTier("C1").forbiddenLowerTier).toEqual([]);
  });

  it("C2 forbidden list is empty (full register expected)", () => {
    expect(vocabularyTier("C2").forbiddenLowerTier).toEqual([]);
  });
});

describe("exemplar deduplication across tiers (Story 10-4 review patch P2)", () => {
  // Pre-patch: `parce que` appeared at A2 + B1; `cependant` appeared at
  // B1 + B2. The BH review flagged that duplication makes calibration
  // anchors meaningless — same anchor at two tiers gives the AI
  // contradictory cues. Patch dedupes; this test prevents regression.

  it("no exemplar token appears at more than one CEFR tier", () => {
    const seen = new Map<string, CEFRLevel>();
    for (const level of ALL_LEVELS) {
      for (const token of vocabularyTier(level).exemplars) {
        const previous = seen.get(token);
        if (previous) {
          throw new Error(
            `Exemplar "${token}" appears at both ${previous} and ${level} — must appear only at its introduction tier (Story 10-4 P2)`
          );
        }
        seen.set(token, level);
      }
    }
  });

  it("`parce que` is an A2 exemplar only (introduced at A2)", () => {
    expect(vocabularyTier("A2").exemplars).toContain("parce que");
    expect(vocabularyTier("B1").exemplars).not.toContain("parce que");
  });

  it("`cependant` is a B1 exemplar only (introduced at B1)", () => {
    expect(vocabularyTier("B1").exemplars).toContain("cependant");
    expect(vocabularyTier("B2").exemplars).not.toContain("cependant");
  });
});

describe("buildVocabularyConstraintBlock(cefrLevel) — rendered prompt block (Story 10-4)", () => {
  it.each(ALL_LEVELS)(
    "%s: renders a Vocabulary Constraint block with the cap + rationale citation",
    (level) => {
      const block = buildVocabularyConstraintBlock(level);
      const tier = vocabularyTier(level);
      expect(block).toContain(
        `## Vocabulary Constraint (${level}, per docs/tcf-spec-source.md §7.2)`
      );
      expect(block).toContain(`${tier.approxWordCap} distinct word-forms`);
      expect(block).toContain(tier.capRationale);
      // Phase-1/Phase-2 caveat MUST appear — defends against a future
      // reader treating the heuristic cap as publisher-grade.
      expect(block).toContain("heuristic, NOT Beacco-verbatim");
    }
  );

  it.each(ALL_LEVELS)(
    "%s: rendered block contains at least one exemplar from the tier list",
    (level) => {
      const block = buildVocabularyConstraintBlock(level);
      const tier = vocabularyTier(level);
      expect(block).toContain(tier.exemplars[0]);
    }
  );

  it("A1 rendered block forbids `cependant`, `néanmoins`, `force est de constater`", () => {
    const block = buildVocabularyConstraintBlock("A1");
    expect(block).toContain("Forbidden when generating content TARGETED at A1");
    expect(block).toContain("cependant");
    expect(block).toContain("néanmoins");
    expect(block).toContain("force est de constater");
  });

  it("A1 rendered block uses generation-vs-grading-clear wording (Story 10-4 review patch P3)", () => {
    // The patch reworded "must NOT appear at this level or lower" (which
    // an AI parsing literally for an A1 evaluation could interpret as
    // "strip these from a B2-aspirational rewriteSuggestion") to
    // "Forbidden when generating content TARGETED at ${level}" — clarifies
    // that the constraint applies to content generated AT this level, not
    // to grading rubrics that reference higher tiers.
    const block = buildVocabularyConstraintBlock("A1");
    expect(block).toContain("Forbidden when generating content TARGETED at A1");
    expect(block).not.toContain("must NOT appear at this level or lower");
  });

  it("B1 rendered block forbids `force est de constater` (still C1+)", () => {
    const block = buildVocabularyConstraintBlock("B1");
    expect(block).toContain("Forbidden when generating content TARGETED at B1");
    expect(block).toContain("force est de constater");
  });

  it("C1 rendered block declares no forbidden tokens (full upper register)", () => {
    const block = buildVocabularyConstraintBlock("C1");
    // The "no forbidden" branch renders a "none — full upper register"
    // sentence rather than an empty list — Story 10-4 review patch P15
    // unifies the wording with the aggregated table.
    expect(block).toContain("Forbidden at C1: none — full upper register");
  });

  it("C2 rendered block declares no forbidden tokens (full register)", () => {
    const block = buildVocabularyConstraintBlock("C2");
    expect(block).toContain("Forbidden at C2: none — full upper register");
  });

  it("renders deterministically — same input produces byte-identical output (Story 9-4 defense)", () => {
    // No time / random / user-input dependencies. Two consecutive calls
    // with the same argument MUST produce identical output, defending
    // against accidental introduction of non-determinism.
    for (const level of ALL_LEVELS) {
      const a = buildVocabularyConstraintBlock(level);
      const b = buildVocabularyConstraintBlock(level);
      expect(a).toBe(b);
    }
  });
});

describe("buildAggregatedVocabularyConstraintTable() — mock-test integration (Story 10-4)", () => {
  it("renders one row per CEFR level under a shared header", () => {
    const table = buildAggregatedVocabularyConstraintTable();
    expect(table).toContain("## Vocabulary Constraints by CEFR Level");
    for (const level of ALL_LEVELS) {
      expect(table).toContain(`- ${level}: ≤`);
    }
  });

  it("renders the Phase-1/Phase-2 caveat", () => {
    const table = buildAggregatedVocabularyConstraintTable();
    expect(table).toContain("NOT Beacco-verbatim");
  });

  it("renders deterministically", () => {
    const a = buildAggregatedVocabularyConstraintTable();
    const b = buildAggregatedVocabularyConstraintTable();
    expect(a).toBe(b);
  });

  it("A1 and A2 rows surface `force est de constater` (Story 10-4 review patch P4: slice 5 + canonicality-sorted)", () => {
    // Pre-patch: aggregated table sliced first 3 forbidden tokens; A1's
    // most diagnostic forbidden token (`force est de constater`) sat at
    // index 6 and was hidden behind `, …`. Patch sorts the underlying
    // LEXICAL_MIN_LEVEL with fixed expressions FIRST + raises slice to 5.
    const table = buildAggregatedVocabularyConstraintTable();
    expect(table).toContain("force est de constater");
  });

  it("uses unified 'none — full upper register' wording for C1/C2 (Story 10-4 review patch P15)", () => {
    const table = buildAggregatedVocabularyConstraintTable();
    expect(table).toContain("forbidden: none — full upper register");
  });
});
