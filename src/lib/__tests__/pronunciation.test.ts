/**
 * Story 15-1 — pure unit tests for `identifyWeakSounds` aggregator.
 *
 * Contract (from src/lib/pronunciation.ts:133):
 *   - Empty input → []
 *   - Aggregates per-phoneme avgScore + count across all words across all results
 *   - Returns ONLY phonemes with `avgScore < 70 && count >= 3`
 *   - Sort: ASCENDING by avgScore (worst phoneme first)
 *
 * Note: `assessPronunciation` (Edge Function wrapper) is OUT OF SCOPE for 15-1
 * per spec Q1 (deferred to 15-1-followup-pronunciation-edge-wrapper).
 */

import {
  identifyWeakSounds,
  type PhonemeScore,
  type PronunciationResult,
  type WordScore,
} from "@/src/lib/pronunciation";

function makePhoneme(phoneme: string, accuracyScore: number): PhonemeScore {
  return { phoneme, accuracyScore };
}

function makeWord(word: string, phonemes: PhonemeScore[]): WordScore {
  return {
    word,
    accuracyScore: 80,
    errorType: "None",
    phonemes,
  };
}

function makeResult(words: WordScore[]): PronunciationResult {
  return {
    accuracyScore: 80,
    fluencyScore: 80,
    completenessScore: 80,
    prosodyScore: 80,
    overallScore: 80,
    words,
    weakPhonemes: [],
  };
}

describe("Story 15-1 — identifyWeakSounds", () => {
  describe("Empty / no-weak-words paths", () => {
    it("Case 1: empty input returns []", () => {
      expect(identifyWeakSounds([])).toEqual([]);
    });

    it("Case 2: results with all phoneme scores >= 70 returns [] (no weak phonemes flagged)", () => {
      const results: PronunciationResult[] = [
        makeResult([makeWord("bonjour", [makePhoneme("b", 90), makePhoneme("o", 85)])]),
        makeResult([makeWord("salut", [makePhoneme("s", 75), makePhoneme("a", 80)])]),
      ];
      expect(identifyWeakSounds(results)).toEqual([]);
    });

    it("Case 3: phoneme below threshold but count < 3 is NOT flagged", () => {
      // /ʁ/ appears twice with score 40 — count=2 < 3 so it should NOT show up.
      const results: PronunciationResult[] = [
        makeResult([makeWord("rouge", [makePhoneme("ʁ", 40)])]),
        makeResult([makeWord("rire", [makePhoneme("ʁ", 40)])]),
      ];
      expect(identifyWeakSounds(results)).toEqual([]);
    });
  });

  describe("Single-phoneme flagged path", () => {
    it("Case 4: phoneme below threshold with count >= 3 IS flagged", () => {
      // /ʁ/ appears 3 times with average score 40 → should appear in output.
      const results: PronunciationResult[] = [
        makeResult([makeWord("rouge", [makePhoneme("ʁ", 40)])]),
        makeResult([makeWord("rire", [makePhoneme("ʁ", 40)])]),
        makeResult([makeWord("rien", [makePhoneme("ʁ", 40)])]),
      ];
      const out = identifyWeakSounds(results);
      expect(out).toEqual([{ phoneme: "ʁ", avgScore: 40, count: 3 }]);
    });

    it("Case 5: phoneme aggregated across multiple words within ONE result", () => {
      // /ʁ/ appears 3 times in ONE result across 3 words.
      const results: PronunciationResult[] = [
        makeResult([
          makeWord("rouge", [makePhoneme("ʁ", 30)]),
          makeWord("rire", [makePhoneme("ʁ", 40)]),
          makeWord("rien", [makePhoneme("ʁ", 50)]),
        ]),
      ];
      const out = identifyWeakSounds(results);
      // avgScore = (30 + 40 + 50) / 3 = 40
      expect(out).toEqual([{ phoneme: "ʁ", avgScore: 40, count: 3 }]);
    });
  });

  describe("Threshold boundary cases", () => {
    it("Case 6: phoneme with avgScore exactly 70 (boundary) is NOT flagged (strict less-than)", () => {
      const results: PronunciationResult[] = [
        makeResult([makeWord("a", [makePhoneme("ɑ̃", 70)])]),
        makeResult([makeWord("a", [makePhoneme("ɑ̃", 70)])]),
        makeResult([makeWord("a", [makePhoneme("ɑ̃", 70)])]),
      ];
      expect(identifyWeakSounds(results)).toEqual([]);
    });

    it("Case 7: phoneme with avgScore = 69.99 (just below boundary) IS flagged", () => {
      const results: PronunciationResult[] = [
        makeResult([makeWord("a", [makePhoneme("ɑ̃", 69.99)])]),
        makeResult([makeWord("a", [makePhoneme("ɑ̃", 69.99)])]),
        makeResult([makeWord("a", [makePhoneme("ɑ̃", 69.99)])]),
      ];
      const out = identifyWeakSounds(results);
      expect(out).toHaveLength(1);
      expect(out[0].phoneme).toBe("ɑ̃");
      expect(out[0].avgScore).toBeCloseTo(69.99, 5);
    });

    it("Case 8: count exactly 3 (boundary) IS flagged; count = 2 is NOT (covered by Case 3)", () => {
      const results: PronunciationResult[] = [
        makeResult([makeWord("a", [makePhoneme("œ", 50)])]),
        makeResult([makeWord("a", [makePhoneme("œ", 50)])]),
        makeResult([makeWord("a", [makePhoneme("œ", 50)])]),
      ];
      expect(identifyWeakSounds(results)).toEqual([{ phoneme: "œ", avgScore: 50, count: 3 }]);
    });
  });

  describe("Multi-phoneme ranking", () => {
    it("Case 9: multiple weak phonemes are returned ascending by avgScore (worst first)", () => {
      const results: PronunciationResult[] = [
        makeResult([
          makeWord("rouge", [makePhoneme("ʁ", 30), makePhoneme("u", 65), makePhoneme("ʒ", 45)]),
          makeWord("rire", [makePhoneme("ʁ", 30), makePhoneme("i", 65), makePhoneme("ʁ", 30)]),
          makeWord("juger", [makePhoneme("ʒ", 45), makePhoneme("u", 65), makePhoneme("ʒ", 45)]),
        ]),
      ];
      const out = identifyWeakSounds(results);
      // Phonemes:
      //   /ʁ/: appears 3x, scores [30, 30, 30] → avg 30, count 3
      //   /u/: appears 2x scores [65, 65] → count 2 → NOT flagged
      //   /ʒ/: appears 3x, scores [45, 45, 45] → avg 45, count 3
      //   /i/: appears 1x → NOT flagged
      // Ranking: ʁ (30) first, then ʒ (45)
      expect(out).toHaveLength(2);
      expect(out[0].phoneme).toBe("ʁ");
      expect(out[0].avgScore).toBe(30);
      expect(out[1].phoneme).toBe("ʒ");
      expect(out[1].avgScore).toBe(45);
    });
  });

  describe("No-mutation invariant", () => {
    it("Case 10: input results array reference + contents unchanged after call", () => {
      const input: PronunciationResult[] = [
        makeResult([makeWord("rouge", [makePhoneme("ʁ", 40)])]),
        makeResult([makeWord("rire", [makePhoneme("ʁ", 40)])]),
        makeResult([makeWord("rien", [makePhoneme("ʁ", 40)])]),
      ];
      const snapshot = JSON.parse(JSON.stringify(input));
      identifyWeakSounds(input);
      expect(input).toEqual(snapshot);
      // Reference equality of root array preserved
      expect(input.length).toBe(3);
    });
  });
});
