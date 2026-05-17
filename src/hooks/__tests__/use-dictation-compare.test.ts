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
      const result = compareSentences("", "bonjour");
      expect(result.wordResults).toEqual([]);
      expect(result.accuracy).toBe(0);
      // 0 of 0 words correct → trivially "fully correct"
      expect(result.isFullyCorrect).toBe(true);
    });

    it("Case 7: both empty returns empty wordResults; accuracy = 0; isFullyCorrect = true", () => {
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

    it("Case 14: apostrophe stripped — 'l'eau' compared as 'leau' against user 'leau'", () => {
      // The normalize regex strips standard apostrophe + curly quotes. So
      // l'eau (normalized: "leau") matches "leau" exactly when user types it
      // without the apostrophe.
      const result = compareSentences("l'eau", "leau");
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
