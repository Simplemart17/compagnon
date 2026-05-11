/**
 * Story 10-4 — Vocabulary Constraint integration tests.
 *
 * For every CEFR-aware prompt builder × every CEFR level (6), assert
 * the prompt output contains the Vocabulary Constraint block (positive
 * surface check). Parameterized via `it.each` so a future scope-to-A1-
 * only refactor (e.g. accidentally `if (cefrLevel === "A1")`) fails the
 * build before merge.
 *
 * Builders covered:
 *   - listening.ts          buildListeningExercisePrompt
 *   - reading.ts            buildReadingExercisePrompt
 *   - writing.ts            buildWritingEvaluatorPrompt
 *   - conversation.ts       buildConversationPrompt
 *   - echo.ts               buildEchoPracticePrompt
 *   - translation.ts        buildTranslationPrompt          (paraphrasing branch B2-C2)
 *   - translation.ts        buildTranslationPrompt          (translation branch A1-B1)
 *   - translation.ts        buildTranslationEvaluationPrompt
 *   - speaking.ts           buildSpeakingEvaluatorPrompt
 *   - mock-test.ts          buildMockTestPrompt              (uses aggregated table)
 *
 * `buildSpeakingTaskPrompt` is intentionally NOT tested — it returns
 * user-facing UI chrome, not an AI prompt; vocab tiers don't apply
 * (documented in `src/lib/prompts/speaking.ts` top-of-file JSDoc).
 */

// Mock memory before imports (conversation.ts pulls in sanitizeMemoryContent
// which would otherwise drag in the full Supabase dep chain).
import type { CEFRLevel } from "@/src/types/cefr";

import { buildConversationPrompt } from "../conversation";
import { buildEchoPracticePrompt } from "../echo";
import { buildListeningExercisePrompt } from "../listening";
import { buildMockTestPrompt } from "../mock-test";
import { buildPlacementTestPrompt } from "../placement";
import { buildReadingExercisePrompt } from "../reading";
import { buildSpeakingEvaluatorPrompt } from "../speaking";
import { buildTranslationEvaluationPrompt, buildTranslationPrompt } from "../translation";
import { vocabularyTier } from "../vocabulary-tiers";
import { buildWritingEvaluatorPrompt } from "../writing";

jest.mock("@/src/lib/memory", () => ({
  __esModule: true,
  sanitizeMemoryContent: (s: string) => (typeof s === "string" ? s.trim() : ""),
}));

const ALL_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Helper: assert the rendered prompt carries both the Vocabulary
 * Constraint header (signals the block is present) and the §7.2
 * citation (signals it came from the helper, not a stray comment).
 */
function assertVocabularyConstraintPresent(prompt: string, level: CEFRLevel): void {
  expect(prompt).toContain(`## Vocabulary Constraint (${level}, per docs/tcf-spec-source.md §7.2)`);
  expect(prompt).toContain("distinct word-forms");
  expect(prompt).toContain("heuristic, NOT Beacco-verbatim");
  // Story 10-4 review patch P7: tie the assertion to the actual
  // `vocabularyTier(level)` call by checking that a level-specific
  // exemplar is present in the rendered prompt. The exemplar list is
  // curated per-tier and deduped (Story 10-4 P2) — so finding e.g.
  // `bonjour` (A1) in an A1 prompt confirms the helper actually ran
  // for this level. Defends against a regression that copies the
  // literal header string into a comment without invoking the helper.
  const sentinelExemplarByLevel: Record<CEFRLevel, string> = {
    A1: "bonjour",
    A2: "parce que",
    B1: "cependant",
    B2: "en effet",
    C1: "paradigme",
    C2: "palimpseste",
  };
  expect(prompt).toContain(sentinelExemplarByLevel[level]);
}

describe("buildListeningExercisePrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)("%s: prompt carries the Vocabulary Constraint block", (level) => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: level });
    assertVocabularyConstraintPresent(prompt, level);
  });
});

describe("buildReadingExercisePrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)("%s: prompt carries the Vocabulary Constraint block", (level) => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: level });
    assertVocabularyConstraintPresent(prompt, level);
  });
});

describe("buildWritingEvaluatorPrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)("%s: prompt carries the Vocabulary Constraint block", (level) => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: level,
      taskNumber: 2,
      prompt: "Décrivez votre routine quotidienne.",
    });
    assertVocabularyConstraintPresent(prompt, level);
  });
});

describe("buildConversationPrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)("%s: prompt carries the Vocabulary Constraint block", (level) => {
    const prompt = buildConversationPrompt({
      cefrLevel: level,
      mode: "companion",
      topic: "Une journée typique",
    });
    assertVocabularyConstraintPresent(prompt, level);
  });
});

describe("buildEchoPracticePrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)("%s: prompt carries the Vocabulary Constraint block", (level) => {
    const prompt = buildEchoPracticePrompt({ cefrLevel: level });
    assertVocabularyConstraintPresent(prompt, level);
  });
});

describe("buildTranslationPrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)(
    "%s: prompt carries the Vocabulary Constraint block (both translation + paraphrasing branches)",
    (level) => {
      // Translation branch (A1-B1) and paraphrasing branch (B2-C2) are
      // selected internally based on CEFR level — exercising every level
      // covers both branches.
      const prompt = buildTranslationPrompt({ cefrLevel: level });
      assertVocabularyConstraintPresent(prompt, level);
    }
  );
});

describe("buildTranslationEvaluationPrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  it.each(ALL_LEVELS)("%s: evaluator prompt carries the Vocabulary Constraint block", (level) => {
    const prompt = buildTranslationEvaluationPrompt({
      source: "Hello, how are you?",
      expectedTarget: "Bonjour, comment ça va?",
      userTranscription: "Bonjour, ça va?",
      cefrLevel: level,
      mode: "translation",
    });
    assertVocabularyConstraintPresent(prompt, level);
  });
});

describe("buildSpeakingEvaluatorPrompt — Vocabulary Constraint integration (Story 10-4)", () => {
  // Story 10-4 review patch P8: parameterize over (level × taskNumber)
  // so a future refactor that branches on `taskNumber` and accidentally
  // omits the constraint block at task 2 or 3 fails the build. Pre-patch
  // the test only exercised taskNumber: 1 across all 6 levels (1/3 of
  // the surface).
  const LEVEL_TASK_MATRIX = ALL_LEVELS.flatMap((level) =>
    ([1, 2, 3] as const).map((task) => [level, task] as const)
  );
  it.each(LEVEL_TASK_MATRIX)(
    "%s task %i: evaluator prompt carries the Vocabulary Constraint block",
    (level, taskNumber) => {
      const prompt = buildSpeakingEvaluatorPrompt({
        cefrLevel: level,
        taskNumber,
        taskInstruction: "Parlez de votre routine quotidienne.",
        transcript: "Le matin, je prends un café et je vais au travail.",
      });
      assertVocabularyConstraintPresent(prompt, level);
    }
  );
});

describe("buildMockTestPrompt — aggregated Vocabulary Constraints integration (Story 10-4)", () => {
  // mock-test spans A1-C2 in a single section, so we use the aggregated
  // table (one row per level under one shared header) instead of a
  // single per-level block. Run for both sections to cover the
  // listening/reading split.
  it.each(["listening", "reading"] as const)(
    "%s section: prompt carries the aggregated vocabulary table covering all 6 levels",
    (section) => {
      const prompt = buildMockTestPrompt({ section, targetLevel: "B1" });
      expect(prompt).toContain("## Vocabulary Constraints by CEFR Level");
      for (const level of ALL_LEVELS) {
        expect(prompt).toContain(`- ${level}: ≤`);
      }
      expect(prompt).toContain("NOT Beacco-verbatim");
    }
  );
});

describe("buildPlacementTestPrompt — aggregated Vocabulary Constraints integration (Story 10-5)", () => {
  // Like mock-test, the placement test spans A1-C2 in a single AI call
  // (one 15-question test stretching from A1:1-3 to C2:15-15), so it
  // uses the same aggregated-table renderer rather than a per-level
  // block. Per-level surface check on the single nullary builder.
  it.each(ALL_LEVELS)("%s row: aggregated table surfaces the per-level cap line", (level) => {
    const prompt = buildPlacementTestPrompt();
    const tier = vocabularyTier(level);
    expect(prompt).toContain(`- ${level}: ≤ ${tier.approxWordCap}`);
  });

  it("renders the shared aggregated-table header + §7.2 citation + Beacco caveat", () => {
    const prompt = buildPlacementTestPrompt();
    expect(prompt).toContain("## Vocabulary Constraints by CEFR Level");
    expect(prompt).toContain("docs/tcf-spec-source.md §7.2");
    expect(prompt).toContain("NOT Beacco-verbatim");
  });
});

describe("Story 10-4 review patch P9 — cross-check existing per-level guidance vs forbidden tokens", () => {
  // Edge Case Hunter Finding 3: the new vocab block forbids tokens like
  // `force est de constater` at A1-B2, but existing per-level guidance
  // maps inside `listening.ts` / `reading.ts` / `conversation.ts` /
  // `echo.ts` / `translation.ts` may contain those tokens in example
  // strings. Future drift (someone adds `force est de constater` to a
  // B2 echo example) would silently contradict the vocab block. This
  // test scans each builder's full rendered prompt at each level and
  // asserts NONE of the level's forbidden tokens appears OUTSIDE the
  // Vocabulary Constraint block itself (which legitimately lists them
  // as forbidden examples).
  //
  // We achieve "outside the constraint block" by stripping the block
  // before substring-checking. The constraint block starts with
  // `## Vocabulary Constraint (` and runs until the next `\n\n`.

  function stripConstraintBlock(prompt: string, level: CEFRLevel): string {
    const headerStart = prompt.indexOf(
      `## Vocabulary Constraint (${level}, per docs/tcf-spec-source.md §7.2)`
    );
    if (headerStart === -1) return prompt;
    // The block ends at the next blank line ("\n\n").
    const blockEnd = prompt.indexOf("\n\n", headerStart);
    if (blockEnd === -1) return prompt.slice(0, headerStart);
    return prompt.slice(0, headerStart) + prompt.slice(blockEnd);
  }

  function assertNoForbiddenInLegacyContent(prompt: string, level: CEFRLevel): void {
    const stripped = stripConstraintBlock(prompt, level);
    const forbidden = vocabularyTier(level).forbiddenLowerTier;
    for (const token of forbidden) {
      // Whole-word boundary not enforced here — French apostrophes and
      // multi-word tokens make a regex flaky. Substring check is enough
      // to flag genuine pedagogical contradictions; the test maintainer
      // can suppress an exemption with an explicit allowlist if needed.
      expect(stripped).not.toContain(token);
    }
  }

  it.each(ALL_LEVELS)(
    "%s listening prompt: legacy LEVEL_CONTENT does not contain any forbidden token",
    (level) => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: level });
      assertNoForbiddenInLegacyContent(prompt, level);
    }
  );

  it.each(ALL_LEVELS)(
    "%s reading prompt: legacy LEVEL_CONTENT does not contain any forbidden token",
    (level) => {
      const prompt = buildReadingExercisePrompt({ cefrLevel: level });
      assertNoForbiddenInLegacyContent(prompt, level);
    }
  );

  it.each(ALL_LEVELS)(
    "%s echo prompt: legacy ECHO_LEVEL_GUIDANCE does not contain any forbidden token",
    (level) => {
      const prompt = buildEchoPracticePrompt({ cefrLevel: level });
      assertNoForbiddenInLegacyContent(prompt, level);
    }
  );

  it.each(ALL_LEVELS)(
    "%s translation prompt: legacy LEVEL_GUIDANCE does not contain any forbidden token",
    (level) => {
      const prompt = buildTranslationPrompt({ cefrLevel: level });
      assertNoForbiddenInLegacyContent(prompt, level);
    }
  );

  // NOTE: conversation.ts is intentionally excluded from this guard
  // because it contains the audit's known "Force est de constater"
  // misclassification at the C1-C2 connector example list. That fix is
  // owned by Epic 10.7 (linguistic accuracy pass) per the story's
  // Anti-pattern Prevention rules. Including conversation.ts here would
  // turn a known-out-of-scope item into a 10-4 blocker.

  // Story 10-5: placement.ts joins the cross-check as the 5th builder.
  // Because the placement prompt aggregates A1-C2 in a single document
  // (the C1 competencies row legitimately names `force est de constater`
  // as a C1 nuanced-connector example — that's pedagogically correct,
  // not drift), the substring-strip approach used for the per-level
  // builders cannot be applied at the whole-prompt level. Instead we
  // extract each level's guidance row (Competencies + Distractors
  // lines) and assert THAT row does not contain any token forbidden at
  // THAT level. This is the regression invariant we actually want: a
  // future patch that adds `force est de constater` to the A1
  // competencies row would fail this test.
  function extractPlacementLevelGuidance(prompt: string, level: CEFRLevel): string {
    // Review patch P3 (Blind Hunter B1): tolerate any leading whitespace
    // before the `- ` bullet, not just two spaces. A Prettier setting
    // change or template-literal reflow would otherwise silently break
    // the regex.
    // Review patch P6 (Blind Hunter B9): no `^`/`$` anchors in the
    // pattern, so the multiline `m` flag was inert. Dropped.
    const headerRegex = new RegExp(
      // Match either "Questions X-Y: LEVEL level (N questions)" or
      // "Question X: LEVEL level (1 question)", followed by 1-3
      // indented "  - Competencies/Distractors" bullet lines.
      `(?:Questions \\d+(?:-\\d+)?|Question \\d+): ${level} level \\([^)]+\\)\\n((?:[ \\t]+- [^\\n]+\\n?){1,3})`
    );
    const match = prompt.match(headerRegex);
    return match ? match[1] : "";
  }

  it.each(ALL_LEVELS)(
    "%s placement prompt: per-level guidance row does not contain any forbidden token",
    (level) => {
      const prompt = buildPlacementTestPrompt();
      const guidance = extractPlacementLevelGuidance(prompt, level);
      // Sanity: the regex must actually have matched. If the row format
      // ever changes, this assertion fires before the forbidden-token
      // check runs and the test fails loudly with a useful message.
      expect(guidance.length).toBeGreaterThan(0);
      const forbidden = vocabularyTier(level).forbiddenLowerTier;
      // Review patch P7 (Blind Hunter B10): word-bounded match instead
      // of a raw `not.toContain(token)`. Substring checking is fragile:
      // a future allowed phrase that incidentally contains a forbidden
      // lexeme as a substring would false-positive. We assemble a
      // regex of the form `(?<![A-Za-zÀ-ÿ'])TOKEN(?![A-Za-zÀ-ÿ'])` per
      // token, escaping regex meta-characters first.
      for (const token of forbidden) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordBounded = new RegExp(`(?<![A-Za-zÀ-ÿ'])${escaped}(?![A-Za-zÀ-ÿ'])`, "i");
        expect(guidance).not.toMatch(wordBounded);
      }
    }
  );
});

describe("Story 10-4 forbidden-token surfacing (regression guard)", () => {
  // Wording aligned with Story 10-4 review patch P3 ("Forbidden when
  // generating content TARGETED at ${level}" — clarifies that the
  // constraint scopes to AI-generated content at this level, not to
  // grading rubrics that reference higher tiers).

  it("A1 listening prompt explicitly forbids `cependant` and `force est de constater`", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "A1" });
    expect(prompt).toContain("Forbidden when generating content TARGETED at A1");
    expect(prompt).toContain("cependant");
    expect(prompt).toContain("force est de constater");
  });

  it("A1 conversation prompt explicitly forbids upper-register connectors", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "A1",
      mode: "companion",
      topic: "Saluer quelqu'un",
    });
    expect(prompt).toContain("Forbidden when generating content TARGETED at A1");
    expect(prompt).toContain("néanmoins");
  });

  it("C1 listening prompt declares no forbidden tokens (full upper register)", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "C1" });
    expect(prompt).toContain("Forbidden at C1: none — full upper register");
  });
});
