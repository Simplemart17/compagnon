/**
 * Story 10-5 — Placement test prompt extraction.
 *
 * Pins the contract of `buildPlacementTestPrompt()` +
 * `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` so the inline
 * `SYSTEM_PROMPT` deletion at `app/onboarding/placement-test.tsx` is
 * regression-safe. Negative assertions guard against re-introducing
 * the `top-500` / `top-1000` / `top-3000` / `top-5000` drift that
 * vocabulary-tiers.ts (Story 10-4) made canonical.
 *
 * Helper-contract cases (3) — distribution invariants.
 * Substring cases (12) — verbatim-preserved content from the original
 * inline prompt.
 * Negative-assertion cases (within #14) — guards against re-inlined
 * vocab tiers.
 * Determinism case (1) — Story 9-4 prompt-injection-defense contract.
 */

import { readFileSync } from "fs";
import { join } from "path";

import type { CEFRLevel } from "@/src/types/cefr";

import {
  buildPlacementTestPrompt,
  PLACEMENT_LEVEL_RANGES,
  TOTAL_PLACEMENT_QUESTIONS,
} from "../placement";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

describe("PLACEMENT_LEVEL_RANGES (Story 10-5)", () => {
  it("has exactly 6 entries with the verified-production CEFR order", () => {
    const orderedLevels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
    expect(PLACEMENT_LEVEL_RANGES.map((r) => r.level)).toEqual(orderedLevels);
  });

  it("ranges sum to exactly 15 questions (A1:3 / A2:3 / B1:3 / B2:3 / C1:2 / C2:1)", () => {
    const total = PLACEMENT_LEVEL_RANGES.reduce(
      (acc, range) => acc + (range.end - range.start + 1),
      0
    );
    expect(total).toBe(15);
  });

  it("TOTAL_PLACEMENT_QUESTIONS equals the sum derived from PLACEMENT_LEVEL_RANGES (single source of truth)", () => {
    const derivedTotal = PLACEMENT_LEVEL_RANGES.reduce(
      (acc, range) => acc + (range.end - range.start + 1),
      0
    );
    expect(TOTAL_PLACEMENT_QUESTIONS).toBe(15);
    expect(TOTAL_PLACEMENT_QUESTIONS).toBe(derivedTotal);
  });

  // Review patch P2 (Edge Case Hunter E3 + Blind Hunter B2): assert
  // each range has start <= end, ranges are contiguous (no gaps), and
  // no question numbers overlap between ranges. A future edit like
  // `{ level: "B1", start: 7, end: 10 }` (overlapping B2) would still
  // sum to 15 if another range shrank to compensate — only an
  // invariant assertion catches the misclassification before
  // `levelForQuestion` silently routes B2 questions to B1.
  it("each range has start <= end", () => {
    for (const range of PLACEMENT_LEVEL_RANGES) {
      expect(range.start).toBeLessThanOrEqual(range.end);
    }
  });

  it("ranges are contiguous — no gaps and no overlaps between consecutive CEFR levels", () => {
    for (let i = 1; i < PLACEMENT_LEVEL_RANGES.length; i++) {
      const prev = PLACEMENT_LEVEL_RANGES[i - 1];
      const curr = PLACEMENT_LEVEL_RANGES[i];
      expect(curr.start).toBe(prev.end + 1);
    }
  });

  it("first range starts at question 1 and last range ends at TOTAL_PLACEMENT_QUESTIONS", () => {
    expect(PLACEMENT_LEVEL_RANGES[0].start).toBe(1);
    expect(PLACEMENT_LEVEL_RANGES[PLACEMENT_LEVEL_RANGES.length - 1].end).toBe(
      TOTAL_PLACEMENT_QUESTIONS
    );
  });
});

describe("buildPlacementTestPrompt — surface assertions (Story 10-5)", () => {
  it("contains the TCF + CEFR alignment statement", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("TCF");
    expect(prompt).toContain("CEFR");
  });

  it("contains the 4-competency rubric headers (Grammar / Vocabulary / Reading comprehension / Pragmatics)", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("- Grammar (");
    expect(prompt).toContain("- Vocabulary (");
    expect(prompt).toContain("- Reading comprehension (");
    expect(prompt).toContain("- Pragmatics (");
  });

  it("contains the per-level question-count breakdown headers derived from PLACEMENT_LEVEL_RANGES", () => {
    const prompt = buildPlacementTestPrompt();
    // Plural form for A1 (1-3) and C1 (13-14)
    expect(prompt).toContain("Questions 1-3: A1 level (3 questions)");
    expect(prompt).toContain("Questions 4-6: A2 level (3 questions)");
    expect(prompt).toContain("Questions 7-9: B1 level (3 questions)");
    expect(prompt).toContain("Questions 10-12: B2 level (3 questions)");
    expect(prompt).toContain("Questions 13-14: C1 level (2 questions)");
    // Singular form for C2 (15-15)
    expect(prompt).toContain("Question 15: C2 level (1 question)");
  });

  it("contains the aggregated Vocabulary Constraint table header from buildAggregatedVocabularyConstraintTable", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("## Vocabulary Constraints by CEFR Level");
  });

  it("contains the §7.2 citation from the aggregated table renderer", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("docs/tcf-spec-source.md §7.2");
  });

  it("contains the per-level vocab-tier cap rows for all 6 CEFR levels", () => {
    const prompt = buildPlacementTestPrompt();
    // Caps anchored to vocabulary-tiers.ts (Story 10-4); these are
    // sentinel-cap values that would fail if a future replacement
    // drifts the numbers — defends the citations-matrix §9 row.
    expect(prompt).toContain("A1: ≤ 700");
    expect(prompt).toContain("A2: ≤ 1700");
    expect(prompt).toContain("B1: ≤ 2800");
    expect(prompt).toContain("B2: ≤ 5000");
    expect(prompt).toContain("C1: ≤ 7500");
    expect(prompt).toContain("C2: ≤ 10000");
  });

  it("contains the distractor-quality language (plausible mistake + vary correct-answer position)", () => {
    const prompt = buildPlacementTestPrompt();
    // Original wording is "PLAUSIBLE mistake" (uppercase); use case-
    // insensitive substring check via toLowerCase() so a future
    // sentence-case rewrite doesn't break the test for cosmetic reasons.
    expect(prompt.toLowerCase()).toContain("plausible mistake");
    expect(prompt.toLowerCase()).toContain("correct answer position");
    expect(prompt.toLowerCase()).toContain("varied");
  });

  it("contains the explanation-format language (1-2 sentences in English)", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("1-2 sentences in English");
  });

  it("contains the JSON output contract keys (questions, isCorrect, explanation)", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain('"questions"');
    expect(prompt).toContain('"isCorrect"');
    expect(prompt).toContain('"explanation"');
  });

  it("contains the schema-matching invariants (exactly 4 options + exactly 1 correct)", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("exactly 4 options");
    expect(prompt).toContain("exactly 1 correct answer");
    // Story 9-7 schema-shape assertion (matches `placementQuestionSchema.superRefine`)
    expect(prompt).toContain('Exactly ONE option per question must have "isCorrect": true');
  });

  it("does NOT re-inline deleted vocab-tier strings (top-500 / top-1000 / top-3000 / top-5000)", () => {
    // Story 10-5 deletes these inline drift sites. Regression guard:
    // a future "let me re-add the tier hints inline for clarity" patch
    // fails this assertion before merge.
    const prompt = buildPlacementTestPrompt();
    expect(prompt).not.toMatch(/top-?500\b/);
    expect(prompt).not.toMatch(/top-?1000\b/);
    expect(prompt).not.toMatch(/top-?3000\b/);
    expect(prompt).not.toMatch(/top-?5000\b/);
  });

  it("does not contain smart quotes or NBSP (review patch P5)", () => {
    // Guard against a future copy-paste from a word processor that
    // introduces "smart" punctuation or non-breaking spaces — both
    // forms derail downstream tokenizers / search / log filters.
    // En/em dashes are legitimately emitted by the aggregated-table
    // renderer (Story 10-4 prose at vocabulary-tiers.ts) so they are
    // NOT banned here. The aggregated-table renderer also legitimately
    // emits U+2264 (≤) and U+2026 (…) — both asserted-present elsewhere
    // in this suite.
    const prompt = buildPlacementTestPrompt();
    expect(prompt).not.toContain("‘"); // ‘ left single quote
    expect(prompt).not.toContain("’"); // ’ right single quote
    expect(prompt).not.toContain("“"); // “ left double quote
    expect(prompt).not.toContain("”"); // ” right double quote
    expect(prompt).not.toContain(" "); // non-breaking space
  });
});

describe("buildPlacementTestPrompt — determinism (Story 10-5; Story 9-4 + 10-4 P8 pattern)", () => {
  it("two consecutive calls return byte-identical strings", () => {
    const first = buildPlacementTestPrompt();
    const second = buildPlacementTestPrompt();
    expect(second).toBe(first);
  });
});

describe("Story 10-5 call-site regression guards (review patches P8 + P12)", () => {
  // Read the call-site once for both checks; avoids two separate Reads
  // and keeps the failure messages co-located with their setup.
  const callSite = readFileSync(join(REPO_ROOT, "app", "onboarding", "placement-test.tsx"), "utf8");

  // Review patch P8 (Blind Hunter B14): assert the inline `SYSTEM_PROMPT`
  // const is actually gone from `placement-test.tsx`. The story's
  // "delete don't alias" claim (Story 10-2 pattern) and CLAUDE.md
  // architecture line both promise this. Without a regression guard, a
  // future "let me re-inline the prompt for clarity" patch could
  // silently land. The grep is intentionally narrow (a `const` definition,
  // not any mention of the string) so legitimate breadcrumb comments
  // that reference the deleted const by name still pass.
  it("`placement-test.tsx` does NOT contain a `const SYSTEM_PROMPT =` definition", () => {
    expect(callSite).not.toMatch(/\bconst\s+SYSTEM_PROMPT\s*=/);
  });

  it("`placement-test.tsx` does NOT contain `const LEVEL_RANGES =` or `const TOTAL_QUESTIONS =`", () => {
    expect(callSite).not.toMatch(/\bconst\s+LEVEL_RANGES\s*=/);
    // Anchor TOTAL_QUESTIONS to whitespace before to avoid matching
    // `TOTAL_PLACEMENT_QUESTIONS` (the new symbol that legitimately
    // appears at the call site).
    expect(callSite).not.toMatch(/\bconst\s+TOTAL_QUESTIONS\s*=/);
  });

  // Review patch P12 (Blind Hunter B20): pin the chatCompletionJSON
  // call params so a future tuning patch that drops `parseRetries: 2`
  // (the high-stakes single-shot retry budget, Story 9-7) or changes
  // the model from gpt-4o fails this guard. The story's CLAUDE.md
  // line promises these are unchanged; the test enforces it.
  it("`placement-test.tsx` chatCompletionJSON call preserves model / temperature / maxTokens / parseRetries", () => {
    expect(callSite).toContain('model: "gpt-4o"');
    expect(callSite).toContain("temperature: 0.5");
    expect(callSite).toContain("maxTokens: 4096");
    expect(callSite).toContain("parseRetries: 2");
    expect(callSite).toContain('feature: "placement-test"');
  });

  it("`placement-test.tsx` passes buildPlacementTestPrompt() as the system content (not an inlined string)", () => {
    expect(callSite).toMatch(/role:\s*"system"\s*,\s*content:\s*buildPlacementTestPrompt\(\)/);
  });
});
