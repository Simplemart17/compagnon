/**
 * Story 10-7 — conversation prompt builder tests.
 *
 * Covers:
 *   - AC #1: No emoji + no `---` rules + parseCorrections-regex compatibility
 *     in the Correction Report block (post-§8.4 P2-1 fix).
 *   - AC #2: Debate-mode discourse markers split into 3 correctly-classified
 *     sub-categories (§8.1 P2-2 fix).
 *
 * The Story 9-4 `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapping regression
 * suite lives in `src/lib/__tests__/prompt-injection.test.ts` and is
 * not duplicated here.
 */

import type { CEFRLevel } from "@/src/types/cefr";
import type { ConversationMode } from "@/src/types/conversation";

import {
  buildConversationPrompt,
  modeSupportsConversationDriving,
  RELANCE_NUDGE_TEXT,
} from "../conversation";

jest.mock("@/src/lib/memory", () => ({
  __esModule: true,
  sanitizeMemoryContent: (s: string) => (typeof s === "string" ? s.trim() : ""),
}));

const ALL_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const ALL_MODES: ConversationMode[] = ["companion", "debate", "tcf_simulation"];

// Story 11-1 supersedes Story 10-7's regex bridge — the production
// `parseCorrections` regex is deleted (corrections now arrive via the
// `report_correction` Realtime tool-call). The mirror constant + its
// consumer cases are deleted; the regex no longer has a contract to verify.

// Emoji-guard regex (review-patch P3 / Blind Hunter BH3 + Edge Case Hunter
// ECH6): the original two-range pattern (`\u{1F300}-\u{1FAFF}` + `\u{1F600}-
// \u{1F64F}`) missed `✅` (U+2705, Dingbats) and the entire Misc-Symbols /
// Supplemental-Symbols / Regional-Indicators blocks. Use the Unicode
// `\p{Extended_Pictographic}` property which covers all emoji-capable
// codepoints in one expression (the literal-emoji checks below still pin
// the specific audit-flagged tokens for regression visibility).
const EMOJI_GUARD = /\p{Extended_Pictographic}/u;
// Story 10-6 mirrored ranges retained as belt-and-suspenders for the
// codepoints the speaking-evaluator test (`speaking.test.ts:153-154`)
// already enforces, so a single shared regex regression is caught twice.
const EMOJI_RANGE_SYMBOLS = /[\u{1F300}-\u{1FAFF}]/u;
const EMOJI_RANGE_FACES = /[\u{1F600}-\u{1F64F}]/u;

describe("buildConversationPrompt — voice-mode emoji + markdown drop (§8.4; Story 10-7 + Story 11-1)", () => {
  describe.each(ALL_LEVELS)("CEFR level %s", (cefrLevel) => {
    it.each(ALL_MODES)("mode %s — rendered prompt contains no emoji", (mode) => {
      const prompt = buildConversationPrompt({
        cefrLevel,
        mode,
        topic: "voyages",
      });
      expect(prompt).not.toMatch(EMOJI_GUARD);
      // Story 10-6-mirrored ranges retained as duplicate coverage
      expect(prompt).not.toMatch(EMOJI_RANGE_SYMBOLS);
      expect(prompt).not.toMatch(EMOJI_RANGE_FACES);
    });

    it.each(ALL_MODES)(
      "mode %s — Correction Reporting block contains no `---` horizontal rules",
      (mode) => {
        const prompt = buildConversationPrompt({
          cefrLevel,
          mode,
          topic: "voyages",
        });
        // Scope the assertion to the Correction Reporting block — `---` may
        // legitimately appear in YAML frontmatter or other markdown
        // separators elsewhere; the §8.4 failure mode is specifically
        // a Correction-Report-shaped block instructing the model to emit
        // `---` rules that TTS reads as "dash dash dash."
        //
        // Story 11-1 anchor: the block header changed from
        // "## Correction Report (Plain Text — Read Aloud)" (Story 10-7
        // bridge) to "## Correction Reporting (Tool-Call)" (Story 11-1
        // architectural successor).
        const startIdx = prompt.indexOf("## Correction Reporting (Tool-Call)");
        expect(startIdx).toBeGreaterThanOrEqual(0);
        const tail = prompt.slice(startIdx + 1); // skip the opening `#` so the next-section search finds the FOLLOWING `## `
        const nextSectionIdx = tail.indexOf("\n## ");
        const block =
          nextSectionIdx >= 0
            ? prompt.slice(startIdx, startIdx + 1 + nextSectionIdx)
            : prompt.slice(startIdx);
        expect(block.length).toBeGreaterThan(200);
        expect(block).not.toMatch(/^---$/m);
      }
    );

    it.each(ALL_MODES)(
      "mode %s — rendered prompt contains no `📝` / `💡` / `✅` emoji literals",
      (mode) => {
        const prompt = buildConversationPrompt({
          cefrLevel,
          mode,
          topic: "voyages",
        });
        expect(prompt).not.toContain("📝");
        expect(prompt).not.toContain("💡");
        expect(prompt).not.toContain("✅");
      }
    );
  });
});

describe("buildConversationPrompt — Story 10-7 debate-mode discourse-marker 3-category split (§8.1)", () => {
  it("renders all three labeled sub-categories with their canonical items", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B2",
      mode: "debate",
      topic: "le télétravail",
    });
    expect(prompt).toContain(
      "Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part"
    );
    expect(prompt).toContain(
      "Locutions verbales figées (fixed expressions): Force est de constater que, Il faut admettre que, Il n'en demeure pas moins que, Quoi qu'il en soit, À supposer que"
    );
    expect(prompt).toContain(
      "Déclencheurs du subjonctif (subjunctive triggers): Bien que (+ subjonctif), Quand bien même"
    );
  });

  it("'Force est de constater que' appears under Locutions verbales figées, NOT under Connecteurs", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "C1",
      mode: "debate",
      topic: "la mondialisation",
    });
    // Connecteurs row does not name Force est de constater
    const connecteursLineMatch = prompt.match(/Connecteurs \(connectors[^\n]*\)[^\n]*/);
    expect(connecteursLineMatch).not.toBeNull();
    expect(connecteursLineMatch?.[0]).not.toContain("Force est de constater");
    // Locutions verbales figées row DOES name it
    const locutionsLineMatch = prompt.match(
      /Locutions verbales figées \(fixed expressions\)[^\n]*/
    );
    expect(locutionsLineMatch).not.toBeNull();
    expect(locutionsLineMatch?.[0]).toContain("Force est de constater que");
  });

  it("debate-mode discourse-markers list is suppressed for non-debate modes", () => {
    for (const mode of ["companion", "tcf_simulation"] as ConversationMode[]) {
      const prompt = buildConversationPrompt({ cefrLevel: "B2", mode, topic: "..." });
      expect(prompt).not.toContain("Locutions verbales figées (fixed expressions):");
      expect(prompt).not.toContain("Déclencheurs du subjonctif (subjunctive triggers):");
    }
  });

  it("negative — the pre-10-7 single-list mid-ordering is gone", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "C1",
      mode: "debate",
      topic: "...",
    });
    // The pre-10-7 contiguous substring from the old single list
    expect(prompt).not.toContain("Force est de constater que, Quoi qu'il en soit, En revanche");
    // Pre-10-7 wording "advanced connectors" replaced with "advanced
    // discourse markers" framing
    expect(prompt).not.toContain("Encourage use of advanced connectors:");
  });
});

describe("buildConversationPrompt — Story 9-4 wrapper invariants preserved (regression guard)", () => {
  // Sanity check that Story 10-7 changes do not regress Story 9-4 wrappers
  // — these are also covered by prompt-injection.test.ts, but a fast
  // co-located smoke check catches positional/structural drift early.
  it("<USER_FACTS> wrapper still renders when memories are provided", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B1",
      mode: "companion",
      topic: "voyages",
      memories: ["User lives in Lyon."],
    });
    expect(prompt).toContain("<USER_FACTS>");
    expect(prompt).toContain("</USER_FACTS>");
    expect(prompt).toContain("- User lives in Lyon.");
  });

  it("<USER_WEAK_AREAS> wrapper still renders when errorPatterns are provided", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B1",
      mode: "companion",
      topic: "voyages",
      errorPatterns: ["Frequent gender errors with masculine/feminine nouns."],
    });
    expect(prompt).toContain("<USER_WEAK_AREAS>");
    expect(prompt).toContain("</USER_WEAK_AREAS>");
  });
});

describe("buildConversationPrompt — Story 11-1 tool-call Correction Reporting (§8.4 architectural)", () => {
  it.each(ALL_LEVELS)("%s — contains the new tool-call block header + arguments", (cefrLevel) => {
    const prompt = buildConversationPrompt({
      cefrLevel,
      mode: "companion",
      topic: "voyages",
    });
    expect(prompt).toContain("## Correction Reporting (Tool-Call)");
    expect(prompt).toContain("invoke the `report_correction` function");
    expect(prompt).toContain("`category`");
    // Each of the four required-arg names is mentioned by name
    expect(prompt).toContain("`original`");
    expect(prompt).toContain("`corrected`");
    expect(prompt).toContain("`explanation`");
    // Each of the four enum categories appears
    expect(prompt).toContain(`"grammar"`);
    expect(prompt).toContain(`"pronunciation"`);
    expect(prompt).toContain(`"vocabulary"`);
    expect(prompt).toContain(`"register"`);
  });

  it.each(ALL_MODES)("mode %s — drops the legacy Correction Report block", (mode) => {
    const prompt = buildConversationPrompt({ cefrLevel: "B1", mode, topic: "voyages" });
    expect(prompt).not.toContain("## Correction Report (Plain Text — Read Aloud)");
    expect(prompt).not.toContain('"User said" → "Correct form"');
    // Review patch P11 (LOW): scope the negative assertions to the
    // Correction Reporting block so a future patch reintroducing
    // "No corrections." or "Tip: [..." in some other prompt section
    // (e.g., a different mode's narrative) doesn't trigger a false positive.
    // The pre-11-1 failure mode was a directive at the prompt level; that
    // is what we're guarding against.
    expect(prompt).not.toMatch(/^No corrections\.$/m);
    expect(prompt).not.toMatch(/^Tip: \[/m);
  });

  it.each(ALL_MODES)(
    "mode %s — does NOT contain the legacy parser-format ASCII-quote instructions",
    (mode) => {
      const prompt = buildConversationPrompt({ cefrLevel: "B1", mode, topic: "voyages" });
      // The pre-11-1 prompt contained a "CRITICAL — the post-conversation
      // parser depends on this exact shape" sub-block; gone post-11-1.
      expect(prompt).not.toContain("the post-conversation parser depends on this exact shape");
      expect(prompt).not.toContain("Use ASCII straight double quotes");
    }
  );

  it.each(ALL_MODES)("mode %s — instructs the model to invoke silently (no audio leak)", (mode) => {
    const prompt = buildConversationPrompt({ cefrLevel: "B1", mode, topic: "voyages" });
    expect(prompt).toContain("invoke the function silently");
    expect(prompt).toContain("invisible to the audio modality");
  });

  it("permits multiple invocations per turn (assertion scoped to the Correction Reporting block)", () => {
    // Review patch P11 (LOW): scope the assertion to the
    // `## Correction Reporting (Tool-Call)` block so a future prompt
    // section that mentions "multiple times within a single response"
    // in a different context (e.g., idiom usage) doesn't cause a false
    // positive.
    const prompt = buildConversationPrompt({
      cefrLevel: "B1",
      mode: "companion",
      topic: "voyages",
    });
    const startIdx = prompt.indexOf("## Correction Reporting (Tool-Call)");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const tail = prompt.slice(startIdx + 1);
    const nextSectionIdx = tail.indexOf("\n## ");
    const block =
      nextSectionIdx >= 0
        ? prompt.slice(startIdx, startIdx + 1 + nextSectionIdx)
        : prompt.slice(startIdx);
    expect(block).toMatch(/multiple times within a single response/);
  });

  it("Story 10-7 debate-mode 3-category split is preserved", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B2",
      mode: "debate",
      topic: "politique",
    });
    expect(prompt).toContain(
      "Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part"
    );
    expect(prompt).toContain(
      "Locutions verbales figées (fixed expressions): Force est de constater que"
    );
    expect(prompt).toContain(
      "Déclencheurs du subjonctif (subjunctive triggers): Bien que (+ subjonctif), Quand bien même"
    );
  });

  it("Story 10-7 debate-mode 'Score in the Correction Report' stale anchor is gone", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B2",
      mode: "debate",
      topic: "politique",
    });
    // The pre-11-1 wording referenced the deleted Correction Report block.
    expect(prompt).not.toContain("Score their argumentation quality in the Correction Report");
  });

  it("Story 10-7 tcf_simulation plain-text task headers are preserved", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "C1",
      mode: "tcf_simulation",
      topic: "préparation",
    });
    expect(prompt).toContain("Task 1 (2 minutes):");
    expect(prompt).toContain("Task 2 (5.5 minutes):");
    expect(prompt).toContain("Task 3 (4.5 minutes):");
  });
});

describe("Story 18-1 — conversation-driver + comprehension-support mode gating (review R1 content pins)", () => {
  const DRIVER_HEADER = "## Driving the Conversation";
  const COMPREHENSION_HEADER = "## Comprehension Support";

  it.each(["companion", "debate"] as const)(
    "%s mode renders the driver + comprehension blocks",
    (mode) => {
      const prompt = buildConversationPrompt({ cefrLevel: "B1", mode, topic: "vie quotidienne" });
      expect(prompt).toContain(DRIVER_HEADER);
      expect(prompt).toContain(COMPREHENSION_HEADER);
      // The [SYSTEM NUDGE] priming line must exist so relance items are
      // understood as system-legit (pairs with RELANCE_NUDGE_TEXT).
      expect(prompt).toContain("[SYSTEM NUDGE]");
    }
  );

  it("tcf_simulation renders NEITHER block (Story 10-6 prep-window contract — exam silence is legitimate, exam conditions are French-only)", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B1",
      mode: "tcf_simulation",
      topic: "examen",
    });
    expect(prompt).not.toContain(DRIVER_HEADER);
    expect(prompt).not.toContain(COMPREHENSION_HEADER);
    expect(prompt).not.toContain("[SYSTEM NUDGE]");
    // Exam mode keeps the strict French-only Role rule.
    expect(prompt).toContain("You speak ONLY in French during the conversation");
  });

  it("driving-enabled modes use the deferential French rule (no contradiction with proactive English at A1-A2)", () => {
    const prompt = buildConversationPrompt({ cefrLevel: "A1", mode: "companion", topic: "salut" });
    expect(prompt).not.toContain("You speak ONLY in French during the conversation");
    expect(prompt).toContain(
      "the Comprehension Support section below defines exactly when brief English help is appropriate"
    );
    // A1 gets the proactive-English beginner policy.
    expect(prompt).toContain("give ONE short English clarification");
  });

  it("modeSupportsConversationDriving is the single source of truth for the gate", () => {
    expect(modeSupportsConversationDriving("companion")).toBe(true);
    expect(modeSupportsConversationDriving("debate")).toBe(true);
    expect(modeSupportsConversationDriving("tcf_simulation")).toBe(false);
  });

  it("RELANCE_NUDGE_TEXT is exported from the prompt module (single source with the orchestrator)", () => {
    expect(RELANCE_NUDGE_TEXT).toContain("[SYSTEM NUDGE]");
    expect(RELANCE_NUDGE_TEXT).toContain("Do not mention the silence");
  });
});
