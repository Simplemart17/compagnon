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

import { buildConversationPrompt } from "../conversation";

jest.mock("@/src/lib/memory", () => ({
  __esModule: true,
  sanitizeMemoryContent: (s: string) => (typeof s === "string" ? s.trim() : ""),
}));

const ALL_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const ALL_MODES: ConversationMode[] = ["companion", "debate", "tcf_simulation"];

// `parseCorrections` regex at src/hooks/use-realtime-voice.ts:155 — mirrored
// here. Story 10-7 preserves this contract; the new plain-text Correction
// Report must still be regex-extractable.
const PARSE_CORRECTIONS_REGEX = /"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g;

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

describe("buildConversationPrompt — Story 10-7 voice-mode emoji + markdown drop (§8.4)", () => {
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
      "mode %s — Correction Report block contains no `---` horizontal rules",
      (mode) => {
        const prompt = buildConversationPrompt({
          cefrLevel,
          mode,
          topic: "voyages",
        });
        // Scope the assertion to the Correction Report block — `---` may
        // legitimately appear in YAML frontmatter or other markdown
        // separators elsewhere; the §8.4 failure mode is specifically
        // the Correction Report block instructing the model to emit
        // `---` rules that TTS reads as "dash dash dash."
        //
        // Review-patch P2 (Blind Hunter BH1): the prior regex used
        // `(?=^## |$)` with the `m` flag, which matched end-of-line
        // (not end-of-string) and combined with lazy `[\s\S]*?` captured
        // only the header line. JavaScript regex does not support `\Z`;
        // anchor on the explicit `\n## ` boundary or end-of-string
        // instead. The sanity check on block length defends against a
        // future regression that reduces the block to its header alone.
        const startIdx = prompt.indexOf("## Correction Report (Plain Text — Read Aloud)");
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
      "mode %s — Correction Report block contains no `📝` / `💡` / `✅` emoji literals",
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

  it("Correction Report instructs the model that responses are read aloud", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B1",
      mode: "companion",
      topic: "voyages",
    });
    expect(prompt).toContain("## Correction Report (Plain Text — Read Aloud)");
    expect(prompt).toContain("text-to-speech");
    expect(prompt).toContain("Do NOT use markdown formatting");
    expect(prompt).toContain("do NOT use emoji");
  });

  it("parseCorrections regex (use-realtime-voice.ts:155) still matches the new plain-text format", () => {
    // Construct a sample model response that mirrors what the new prompt
    // instructs the model to emit. The regex must extract exactly one
    // match with the expected capture groups — this is the load-bearing
    // contract Story 10-7 preserves while Epic 11.1 designs the
    // tool-call successor.
    const sampleModelResponse =
      'Bonjour ! C\'est une bonne question. "je suis allé" → "je suis allée" (feminine agreement)\nTip: review past participle agreement with être verbs.';
    const re = new RegExp(PARSE_CORRECTIONS_REGEX.source, PARSE_CORRECTIONS_REGEX.flags);
    const match = re.exec(sampleModelResponse);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("je suis allé");
    expect(match?.[2]).toBe("je suis allée");
    expect(match?.[3]).toBe("feminine agreement");
  });

  it("parseCorrections regex matches multiple corrections in a single response", () => {
    const sampleModelResponse =
      'Tu as dit "je vais à la magasin" → "je vais au magasin" (au = à + le) et aussi "j\'ai 20 ans vieux" → "j\'ai 20 ans" (vieux is redundant).\nTip: drop the redundant adjective when stating age.';
    const re = new RegExp(PARSE_CORRECTIONS_REGEX.source, PARSE_CORRECTIONS_REGEX.flags);
    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(sampleModelResponse)) !== null) matches.push(m);
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe("je vais à la magasin");
    expect(matches[1][1]).toBe("j'ai 20 ans vieux");
  });

  it("renders the plain-text `No corrections.` instruction for the empty-error path", () => {
    const prompt = buildConversationPrompt({
      cefrLevel: "B1",
      mode: "companion",
      topic: "voyages",
    });
    expect(prompt).toContain("No corrections.");
    // Negative: the pre-10-7 `✅ **Parfait !** No corrections needed.`
    // string is gone (emoji + markdown stripped).
    expect(prompt).not.toContain("Parfait !** No corrections");
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
