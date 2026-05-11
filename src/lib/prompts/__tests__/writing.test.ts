/**
 * Story 10-7 — writing evaluator prompt tests for discourse-markers
 * framing change (§8.1).
 *
 * The pre-10-7 "Expected connectors by level" header misclassified
 * `force est de constater` (a locution verbale figée) as a connector.
 * Story 10-7 rebrands the header to "Expected discourse markers
 * (connectors + fixed expressions) by level" without changing the
 * per-level item content. Story 10-4's per-CEFR filter still applies.
 *
 * Per-task word-range / §5.3 enforcement assertions live in
 * `passage-calibration.test.ts` (Story 10-3) — not duplicated here.
 */

import { buildWritingEvaluatorPrompt } from "../writing";

describe("buildWritingEvaluatorPrompt — discourse-markers framing (Story 10-7 / §8.1)", () => {
  it("C1 prompt renders the new 'Expected discourse markers (connectors + fixed expressions)' header", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "C1",
      taskNumber: 3,
      prompt: "Discutez des avantages et inconvénients du télétravail.",
    });
    expect(prompt).toContain(
      "Expected discourse markers (connectors + fixed expressions) by level"
    );
  });

  it("C1-C2 discourse-markers row still includes 'force est de constater' alongside actual connectors", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "C2",
      taskNumber: 3,
      prompt: "...",
    });
    // Review-patch P5 (Blind Hunter BH4): the unscoped assertion
    // `expect(prompt).toContain("force est de constater")` passes for
    // the wrong reason at C1/C2 because Story 10-4's
    // `buildVocabularyConstraintBlock` legitimately surfaces the token
    // in the C2 exemplars list and in the forbidden-lower-tier listings
    // at multiple levels. Scope the assertion to the per-level
    // discourse-markers block via the same regex extraction the A1
    // per-level filter test uses below.
    const discourseBlockMatch = prompt.match(
      /Expected discourse markers \(connectors \+ fixed expressions\) by level[\s\S]*?(?=^- Logical flow|^### )/m
    );
    expect(discourseBlockMatch).not.toBeNull();
    const block = discourseBlockMatch?.[0] ?? "";
    // Story 10-7 review-patch P10: C1-C2 row split into Connecteurs vs
    // Locutions verbales figées — assert each item appears under its
    // correctly-classified sub-row, mirroring conversation.ts (AC #2).
    expect(block).toContain("C1-C2 connecteurs: néanmoins, toutefois, en l'occurrence");
    expect(block).toContain(
      "C1-C2 locutions verbales figées: force est de constater, il n'en demeure pas moins, quoi qu'il en soit"
    );
    // Negative: `force est de constater` must NOT appear in the C1-C2
    // connecteurs row (it is a locution verbale figée, not a connector).
    const connecteursLine = block.match(/C1-C2 connecteurs:[^\n]*/);
    expect(connecteursLine).not.toBeNull();
    expect(connecteursLine?.[0]).not.toContain("force est de constater");
  });

  it("negative — the pre-10-7 'Expected connectors by level' header is gone", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "C1",
      taskNumber: 3,
      prompt: "...",
    });
    expect(prompt).not.toContain("Expected connectors by level");
  });

  it("Story 10-4 per-level filter still applies — A1 prompt's discourse-markers block does not surface B1-B2 / C1-C2 rows", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "A1",
      taskNumber: 1,
      prompt: "Décrivez votre journée.",
    });
    // A1 row present
    expect(prompt).toContain("A1-A2: et, mais, parce que, alors, aussi");
    // Scope the negative assertion to the "Expected discourse markers"
    // sub-block — Story 10-4's vocab-tier `buildVocabularyConstraintBlock`
    // legitimately surfaces `force est de constater` in the A1 forbidden-
    // tokens list elsewhere in the prompt; the per-level filter only
    // governs the discourse-markers rubric block.
    const discourseBlockMatch = prompt.match(
      /Expected discourse markers \(connectors \+ fixed expressions\) by level[\s\S]*?(?=^- Logical flow|^### )/m
    );
    expect(discourseBlockMatch).not.toBeNull();
    const block = discourseBlockMatch?.[0] ?? "";
    expect(block).not.toContain("force est de constater");
    expect(block).not.toContain("néanmoins");
    // B1-B2 connectors are also filtered out for an A1 target
    expect(block).not.toContain("cependant");
  });

  it("Story 10-4 per-level filter — B1 prompt surfaces A1-A2 + B1-B2 rows but NOT C1-C2 rows (review-patch P9)", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "B1",
      taskNumber: 2,
      prompt: "Racontez un voyage récent.",
    });
    const discourseBlockMatch = prompt.match(
      /Expected discourse markers \(connectors \+ fixed expressions\) by level[\s\S]*?(?=^- Logical flow|^### )/m
    );
    expect(discourseBlockMatch).not.toBeNull();
    const block = discourseBlockMatch?.[0] ?? "";
    // A1-A2 + B1-B2 rows present
    expect(block).toContain("A1-A2: et, mais, parce que, alors, aussi");
    expect(block).toContain("B1-B2: cependant, en effet, par conséquent");
    // C1-C2 rows (both connecteurs sub-row and locutions sub-row) absent
    expect(block).not.toContain("C1-C2 connecteurs:");
    expect(block).not.toContain("C1-C2 locutions verbales figées:");
    expect(block).not.toContain("force est de constater");
  });

  it("Story 10-4 per-level filter — C1 prompt surfaces all three levels of discourse markers (review-patch P9)", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "C1",
      taskNumber: 3,
      prompt: "Discutez d'un problème de société.",
    });
    const discourseBlockMatch = prompt.match(
      /Expected discourse markers \(connectors \+ fixed expressions\) by level[\s\S]*?(?=^- Logical flow|^### )/m
    );
    expect(discourseBlockMatch).not.toBeNull();
    const block = discourseBlockMatch?.[0] ?? "";
    expect(block).toContain("A1-A2: et, mais, parce que, alors, aussi");
    expect(block).toContain("B1-B2: cependant, en effet, par conséquent");
    expect(block).toContain("C1-C2 connecteurs: néanmoins, toutefois, en l'occurrence");
    expect(block).toContain(
      "C1-C2 locutions verbales figées: force est de constater, il n'en demeure pas moins, quoi qu'il en soit"
    );
  });
});
