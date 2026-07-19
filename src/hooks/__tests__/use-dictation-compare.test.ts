/**
 * Story 15-1 — pure unit tests for `compareSentences` from `use-dictation.ts`.
 *
 * The function is a pure data-transform helper (no React, no async, no side
 * effects) despite living in a hook file, so it fits 15-1's pure-function
 * scope.
 *
 * Contract (from src/hooks/use-dictation.ts:88):
 *   - Normalize: lowercase + NFD diacritic strip + punctuation strip + trim
 *   - Tokenize on /\s+/, filter empty
 *   - Iterate ORIGINAL tokens position-by-position:
 *       - user has nothing at position i → "missing"
 *       - normalized tokens match → "correct"
 *       - both have words but differ → "wrong" (with `typed` = raw user word)
 *   - `accuracy` = round(correct / total * 100); 0 when total = 0
 *   - `isFullyCorrect` = correct === total
 *   - `word` in the result uses the ORIGINAL-cased word (preserves accents),
 *     NOT the lowercased+stripped token
 *
 * Note: `analyzeErrorPatterns` is OUT OF SCOPE per spec (less load-bearing
 * than `compareSentences` itself).
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

// `use-dictation.ts` imports `use-audio-player` which transitively imports
// `expo-audio`. expo-audio is native-only and crashes in Jest. We mock the
// hook to short-circuit the chain — `compareSentences` itself has no audio
// dependency.
jest.mock("@/src/hooks/use-audio-player", () => ({
  __esModule: true,
  useAudioPlayer: jest.fn(),
}));

// `use-dictation.ts` also pulls in openai.ts (chatCompletionJSON +
// generateSpeech) and the AI response schema. Mock them away — they're
// not needed for the pure `compareSentences` function.
jest.mock("@/src/lib/openai", () => ({
  __esModule: true,
  chatCompletionJSON: jest.fn(),
  generateSpeech: jest.fn(),
}));

import { compareSentences } from "@/src/hooks/use-dictation";

describe("Story 15-1 — compareSentences (dictation word comparison)", () => {
  describe("Happy paths", () => {
    it("Case 1: perfect match → all words correct, accuracy 100, isFullyCorrect true", () => {
      const result = compareSentences("bonjour le monde", "bonjour le monde");
      expect(result.wordResults).toHaveLength(3);
      expect(result.wordResults.every((w) => w.status === "correct")).toBe(true);
      expect(result.accuracy).toBe(100);
      expect(result.isFullyCorrect).toBe(true);
    });

    it("Case 2: one wrong word → that word marked wrong with `typed`; accuracy = round(2/3 * 100) = 67", () => {
      const result = compareSentences("bonjour le monde", "bonjour la monde");
      expect(result.wordResults).toHaveLength(3);
      expect(result.wordResults[0]).toEqual({ word: "bonjour", status: "correct" });
      expect(result.wordResults[1]).toMatchObject({
        word: "le",
        status: "wrong",
        typed: "la",
      });
      expect(result.wordResults[2]).toEqual({ word: "monde", status: "correct" });
      expect(result.accuracy).toBe(67);
      expect(result.isFullyCorrect).toBe(false);
    });

    it("Case 3: missing word — user shorter than original → the position(s) past user-length are 'missing'", () => {
      // original "bonjour le monde" (3 tokens), user "bonjour monde" (2 tokens)
      // Position 0: "bonjour" vs "bonjour" → correct
      // Position 1: "le" vs "monde" → wrong (typed = "monde")
      // Position 2: "monde" vs (undefined) → missing
      const result = compareSentences("bonjour le monde", "bonjour monde");
      expect(result.wordResults).toHaveLength(3);
      expect(result.wordResults[0].status).toBe("correct");
      expect(result.wordResults[1].status).toBe("wrong");
      expect(result.wordResults[1].typed).toBe("monde");
      expect(result.wordResults[2].status).toBe("missing");
      expect(result.accuracy).toBe(33);
      expect(result.isFullyCorrect).toBe(false);
    });

    it("Case 4: extra word — user longer than original → extra tokens are IGNORED (only original-length is iterated)", () => {
      // original "bonjour monde" (2 tokens), user "bonjour le monde" (3 tokens)
      // Position 0: "bonjour" vs "bonjour" → correct
      // Position 1: "monde" vs "le" → wrong (typed = "le")
      // User's 3rd token ("monde") is never compared.
      const result = compareSentences("bonjour monde", "bonjour le monde");
      expect(result.wordResults).toHaveLength(2);
      expect(result.wordResults[0].status).toBe("correct");
      expect(result.wordResults[1].status).toBe("wrong");
      expect(result.wordResults[1].typed).toBe("le");
      expect(result.accuracy).toBe(50);
      expect(result.isFullyCorrect).toBe(false);
    });

    it("Case 5: empty userInput — all original words marked missing; accuracy 0", () => {
      const result = compareSentences("bonjour monde", "");
      expect(result.wordResults).toHaveLength(2);
      expect(result.wordResults.every((w) => w.status === "missing")).toBe(true);
      expect(result.accuracy).toBe(0);
      expect(result.isFullyCorrect).toBe(false);
    });
  });

  describe("Defensive degenerate inputs", () => {
    it("Case 6: empty original returns empty wordResults; accuracy = 0; isFullyCorrect = true (vacuously — 0/0 is fully correct)", () => {
      // SEMANTIC NOTE (R1-P2): the impl returns `isFullyCorrect: true` for an
      // empty original even when the user typed something — `0 === 0` is a
      // vacuous truth. This test pins the existing behavior; a consumer that
      // gates downstream behavior on `isFullyCorrect` alone (e.g., "mark
      // exercise complete") would incorrectly mark an empty-original exercise
      // complete despite the user having typed real content. The production
      // fix (e.g., `isFullyCorrect = totalWords > 0 && correctCount === totalWords`)
      // belongs in a follow-up story and is OUT OF SCOPE for Story 15-1's
      // test-only AC-F44.
      // TODO(15-1-followup-dictation-empty-original-semantic): tighten the
      // production semantic AND flip this test's assertion to `false`.
      const result = compareSentences("", "bonjour");
      expect(result.wordResults).toEqual([]);
      expect(result.accuracy).toBe(0);
      expect(result.isFullyCorrect).toBe(true);
    });

    it("Case 7: both empty returns empty wordResults; accuracy = 0; isFullyCorrect = true", () => {
      // Both-empty case is the ONE case where `isFullyCorrect: true` is
      // semantically defensible (the user correctly typed an empty string for
      // an empty original). The R1-P2 follow-up should preserve this case's
      // truth value while flipping Case 6.
      const result = compareSentences("", "");
      expect(result.wordResults).toEqual([]);
      expect(result.accuracy).toBe(0);
      expect(result.isFullyCorrect).toBe(true);
    });
  });

  describe("Normalization — case / accents / punctuation / whitespace", () => {
    it("Case 8: case-insensitive comparison ('Bonjour' vs 'bonjour' → correct; display preserves original capitalization)", () => {
      const result = compareSentences("Bonjour", "bonjour");
      expect(result.wordResults).toHaveLength(1);
      expect(result.wordResults[0].status).toBe("correct");
      // Display word preserves the ORIGINAL casing
      expect(result.wordResults[0].word).toBe("Bonjour");
      expect(result.accuracy).toBe(100);
    });

    it("Case 9: accent-insensitive comparison ('café' vs 'cafe' → correct; display preserves accent)", () => {
      const result = compareSentences("café", "cafe");
      expect(result.wordResults).toHaveLength(1);
      expect(result.wordResults[0].status).toBe("correct");
      expect(result.wordResults[0].word).toBe("café");
      expect(result.accuracy).toBe(100);
    });

    it("Case 10: trailing punctuation stripped before comparison", () => {
      const result = compareSentences("Bonjour le monde.", "Bonjour le monde");
      expect(result.wordResults.every((w) => w.status === "correct")).toBe(true);
      expect(result.accuracy).toBe(100);
      // Display word strips the trailing period (the impl uses the same regex for display)
      expect(result.wordResults[2].word).toBe("monde");
    });

    it("Case 11: internal punctuation stripped before comparison ('Salut, Marie' vs 'Salut Marie' → correct)", () => {
      const result = compareSentences("Salut, Marie", "Salut Marie");
      expect(result.wordResults).toHaveLength(2);
      expect(result.wordResults.every((w) => w.status === "correct")).toBe(true);
      expect(result.accuracy).toBe(100);
    });

    it("Case 12: multi-space whitespace collapses to single delimiter", () => {
      const result = compareSentences("bonjour  le   monde", "bonjour le monde");
      expect(result.wordResults).toHaveLength(3);
      expect(result.wordResults.every((w) => w.status === "correct")).toBe(true);
      expect(result.accuracy).toBe(100);
    });

    it("Case 13: leading/trailing whitespace trimmed before tokenization", () => {
      const result = compareSentences("  bonjour monde  ", "bonjour monde");
      expect(result.wordResults).toHaveLength(2);
      expect(result.wordResults.every((w) => w.status === "correct")).toBe(true);
    });

    it("Case 14a: `typed` preserves user's ORIGINAL casing + accents (R1-P5 — load-bearing for UI 'you typed FOO — should be bar' display)", () => {
      // The impl's `typed` field uses the RAW-SPLIT user input (punctuation
      // stripped, but casing + accents PRESERVED) at index i — NOT the
      // normalized lowercased+stripped token. A future refactor that swapped
      // to `userTokens[i]` would silently break this contract. The display
      // surface depends on showing the user EXACTLY what they typed.
      //
      // To probe case-preservation we need a position where original and user
      // tokens DIFFER (so the position is "wrong") AND the user's word has
      // distinctive casing. Using "marie" vs "MARIA" — the lowercased forms
      // also differ ("marie" vs "maria") so the position is marked wrong,
      // and the user's UPPERCASE form is preserved in `typed`.
      const result = compareSentences("bonjour marie", "bonjour MARIA");
      expect(result.wordResults).toHaveLength(2);
      expect(result.wordResults[0].status).toBe("correct");
      expect(result.wordResults[1].status).toBe("wrong");
      // typed preserves the user's UPPERCASE input (not normalized to lower).
      expect(result.wordResults[1].typed).toBe("MARIA");
    });

    it("Case 14 (P2-25 fix): apostrophes are SIGNIFICANT — 'leau' does NOT match 'l'eau'", () => {
      // Audit P2-25: pre-fix the normalize regex stripped apostrophes, so a
      // learner typing `leau` for `l'eau` was graded correct — teaching wrong
      // French. Elision apostrophes (l' / d' / c' / j' / n' / s' / qu') are
      // semantically required and must be graded.
      const result = compareSentences("l'eau", "leau");
      expect(result.wordResults).toHaveLength(1);
      expect(result.wordResults[0].status).toBe("wrong");
    });

    it("Case 14b (P2-25): correctly-typed apostrophe still matches — 'l'eau' vs 'l'eau'", () => {
      const result = compareSentences("l'eau", "l'eau");
      expect(result.wordResults).toHaveLength(1);
      expect(result.wordResults[0].status).toBe("correct");
      expect(result.isFullyCorrect).toBe(true);
    });

    it("Case 14c (P2-25): curly apostrophe (iOS smart punctuation) matches ASCII apostrophe", () => {
      // Original uses U+2019 (what TTS-source text often carries); the user's
      // keyboard produces ASCII '. Keyboard differences must never punish.
      const result = compareSentences("l’eau est fraîche", "l'eau est fraiche");
      expect(result.isFullyCorrect).toBe(true);
    });

    it("Case 14d (P2-25): interior apostrophe words like aujourd'hui stay one significant token", () => {
      const wrong = compareSentences("aujourd'hui", "aujourdhui");
      expect(wrong.wordResults).toHaveLength(1);
      expect(wrong.wordResults[0].status).toBe("wrong");
      const right = compareSentences("aujourd'hui", "aujourd'hui");
      expect(right.isFullyCorrect).toBe(true);
    });

    it("Case 14f (P2-25 review): display word PRESERVES the apostrophe — never 'leau ≠ leau'", () => {
      // Pre-review the display-word strip regex still removed apostrophes,
      // so a wrong `leau` was shown against a displayed original of "leau"
      // — visually identical to the user's input while marked wrong.
      const result = compareSentences("l'eau", "leau");
      expect(result.wordResults[0].word).toBe("l'eau");
      // And the typed echo preserves the user's apostrophe when present.
      const typedResult = compareSentences("le monde", "l'monde");
      expect(typedResult.wordResults[0].typed).toBe("l'monde");
    });

    it("Case 14e (P2-25): edge-of-token apostrophes (quote usage) are still stripped", () => {
      // Single-quote quotation marks around a word must not create a
      // mismatch — only INTERIOR (elision) apostrophes are significant.
      const result = compareSentences("'bonjour'", "bonjour");
      expect(result.wordResults).toHaveLength(1);
      expect(result.wordResults[0].status).toBe("correct");
    });
  });

  describe("No-mutation invariant", () => {
    it("Case 15: input strings are primitive (always immutable); result.wordResults is a fresh array each call", () => {
      const r1 = compareSentences("bonjour monde", "bonjour");
      const r2 = compareSentences("bonjour monde", "bonjour");
      // The function returns a fresh wordResults array each call (no shared
      // module-level cache). Confirm by reference inequality.
      expect(r1.wordResults).not.toBe(r2.wordResults);
      // But contents are equivalent.
      expect(r1.wordResults).toEqual(r2.wordResults);
    });
  });
});
