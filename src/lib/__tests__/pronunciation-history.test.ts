/**
 * Story 12-12 — `pronunciation-history` helper-contract unit tests.
 *
 * Pins the `appendCappedHistory` + `MAX_PRONUNCIATION_HISTORY` semantics
 * against regression. Mirrors Story 12-6's `transcript-cap.test.ts`
 * pattern (cap-then-evict sequencing + insertion-order preservation +
 * new-array reference inequality + no-input-mutation).
 *
 * Test budget: 10 cases per Story 12-12 deliverable (d).
 */

import { identifyWeakSounds } from "../pronunciation";
import { appendCappedHistory, MAX_PRONUNCIATION_HISTORY } from "../pronunciation-history";
import type { PronunciationResult, WordScore } from "../pronunciation";

/**
 * Build a minimal `PronunciationResult` with a unique-id-friendly score.
 * The cap helper doesn't inspect contents — we only need distinguishable
 * objects to assert insertion order / eviction-of-oldest / etc.
 */
function makeResult(id: number): PronunciationResult {
  return {
    accuracyScore: id,
    fluencyScore: 0,
    completenessScore: 0,
    prosodyScore: 0,
    overallScore: 0,
    words: [],
    weakPhonemes: [],
  };
}

/**
 * Build a `PronunciationResult` carrying a single phoneme score so the
 * `identifyWeakSounds`-after-eviction case (Case 11, M2 patch) can probe
 * the cap × diagnostic-aggregation interaction. Each result contributes
 * one occurrence of `phoneme` at `accuracyScore` to the running aggregate.
 */
function makeResultWithPhoneme(phoneme: string, accuracyScore: number): PronunciationResult {
  const word: WordScore = {
    word: "test",
    accuracyScore,
    errorType: "None",
    phonemes: [{ phoneme, accuracyScore }],
  };
  return {
    accuracyScore,
    fluencyScore: 0,
    completenessScore: 0,
    prosodyScore: 0,
    overallScore: 0,
    words: [word],
    weakPhonemes: [],
  };
}

describe("pronunciation-history — Story 12-12 helper contract", () => {
  describe("MAX_PRONUNCIATION_HISTORY constant", () => {
    it("Case 1: MAX_PRONUNCIATION_HISTORY equals 50 (drift-catches edits)", () => {
      expect(MAX_PRONUNCIATION_HISTORY).toBe(50);
    });
  });

  describe("appendCappedHistory — append semantics", () => {
    it("Case 2: empty + 1 result → length 1, the result at index 0", () => {
      const r = makeResult(1);
      const result = appendCappedHistory([], r);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(r);
    });

    it("Case 3: 49 + 1 → length 50 (one-below-cap boundary; NO eviction)", () => {
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < 49; i++) prev.push(makeResult(i));
      const newResult = makeResult(49);
      const result = appendCappedHistory(prev, newResult);
      expect(result).toHaveLength(50);
      // No eviction: the first 49 are the original prev entries, last is new.
      expect(result[0]).toBe(prev[0]);
      expect(result[48]).toBe(prev[48]);
      expect(result[49]).toBe(newResult);
    });

    it("Case 3b: at-cap (50 entries) + 1 → length 50 with prev[0] evicted (L3 explicit boundary)", () => {
      // Review-round-1 L3 patch: isolated assertion of the AT-cap boundary
      // semantic. Pre-patch this scenario was implicit in Case 4 (which
      // builds prev to length 50 then appends 51st); post-patch the
      // boundary is also explicitly named so an off-by-one regression
      // (`<` vs `<=` in the cap predicate) fails this case loudly with a
      // clear diagnostic instead of vacuously passing the broader Case 4.
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < MAX_PRONUNCIATION_HISTORY; i++) prev.push(makeResult(i));
      expect(prev).toHaveLength(MAX_PRONUNCIATION_HISTORY);
      const newResult = makeResult(99);
      const result = appendCappedHistory(prev, newResult);
      expect(result).toHaveLength(MAX_PRONUNCIATION_HISTORY);
      // Oldest (prev[0]) MUST be evicted at the AT-cap boundary.
      expect(result).not.toContain(prev[0]);
      // The next-oldest (prev[1]) survives at head.
      expect(result[0]).toBe(prev[1]);
      // Just-appended at tail.
      expect(result.at(-1)).toBe(newResult);
    });

    it("Case 4: 50 + 1 → length 50 with OLDEST evicted + new at tail", () => {
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < 50; i++) prev.push(makeResult(i));
      const newResult = makeResult(50);
      const result = appendCappedHistory(prev, newResult);
      expect(result).toHaveLength(50);
      // Oldest (prev[0]) evicted; insertion order preserved; new at tail.
      expect(result[0]).toBe(prev[1]);
      expect(result[48]).toBe(prev[49]);
      expect(result[49]).toBe(newResult);
    });
  });

  describe("appendCappedHistory — immutability + reference contract", () => {
    it("Case 5: returns a NEW array reference (React Object.is short-circuit safe)", () => {
      const prev: PronunciationResult[] = [makeResult(1), makeResult(2)];
      const result = appendCappedHistory(prev, makeResult(3));
      // The result must NEVER be the same reference as the input — React's
      // setState short-circuits via Object.is and would skip the re-render.
      expect(result).not.toBe(prev);
    });

    it("Case 6: does NOT mutate the input array (full-array snapshot)", () => {
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < 50; i++) prev.push(makeResult(i));
      // Review-round-1 L2 patch: snapshot the FULL array (not just length +
      // first element). Pre-patch the test only verified `prev.length` and
      // `prev[0]` after the call — an implementation that mutated `prev[25]`
      // mid-array (e.g., a future "optimization" swapping slots in place)
      // would pass both assertions. Post-patch `toEqual` does a deep
      // equality check against the snapshot, defending against ANY
      // intermediate-index mutation.
      const snapshot = [...prev];
      appendCappedHistory(prev, makeResult(50));
      expect(prev).toEqual(snapshot);
      // Reference-identity is also preserved (snapshot is a separate array).
      expect(prev.length).toBe(snapshot.length);
      expect(prev[0]).toBe(snapshot[0]);
    });

    it("Case 7: over-cap input (length 60) → output truncated to 50 with FIFO eviction", () => {
      // Defensive: a future caller bypassing this helper could leave the
      // array over-cap. The helper must correctly truncate regardless.
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < 60; i++) prev.push(makeResult(i));
      const newResult = makeResult(60);
      const result = appendCappedHistory(prev, newResult);
      expect(result).toHaveLength(50);
      // The 11 oldest entries (indices 0-10 of the 61-element appended-array)
      // are dropped: result[0] is prev[11]; result[49] is the newResult.
      expect(result[0]).toBe(prev[11]);
      expect(result[48]).toBe(prev[59]);
      expect(result[49]).toBe(newResult);
    });
  });

  describe("appendCappedHistory — load-bearing invariants", () => {
    it("Case 8: the just-appended entry is NEVER evicted in the same operation", () => {
      // Cap-then-evict sequencing (Story 12-6 pattern). Even at 5x cap,
      // the new result is always the last element of the returned array.
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < 250; i++) prev.push(makeResult(i));
      const newResult = makeResult(999);
      const result = appendCappedHistory(prev, newResult);
      expect(result).toHaveLength(50);
      expect(result[result.length - 1]).toBe(newResult);
    });

    it("Case 9: insertion order is preserved (no shuffle / no reverse)", () => {
      const prev: PronunciationResult[] = [makeResult(10), makeResult(20), makeResult(30)];
      const result = appendCappedHistory(prev, makeResult(40));
      expect(result.map((r) => r.accuracyScore)).toEqual([10, 20, 30, 40]);
    });

    it("Case 10: `.at(-1)` is always the just-appended entry", () => {
      const newResult = makeResult(999);
      // Empty case.
      expect(appendCappedHistory([], newResult).at(-1)).toBe(newResult);
      // At-cap case.
      const atCap: PronunciationResult[] = [];
      for (let i = 0; i < 50; i++) atCap.push(makeResult(i));
      expect(appendCappedHistory(atCap, newResult).at(-1)).toBe(newResult);
      // Over-cap case.
      const overCap: PronunciationResult[] = [];
      for (let i = 0; i < 100; i++) overCap.push(makeResult(i));
      expect(appendCappedHistory(overCap, newResult).at(-1)).toBe(newResult);
    });
  });

  describe("appendCappedHistory × identifyWeakSounds interaction (M2 patch)", () => {
    it("Case 11 (M2): cap-boundary eviction reduces identifyWeakSounds count when oldest entries carried a weak phoneme", () => {
      // Review-round-1 M2 patch: pins the LOAD-BEARING rationale documented
      // in the JSDoc on MAX_PRONUNCIATION_HISTORY — the FIFO cap creates a
      // diagnostic-signal trade-off where phonemes appearing only in the
      // evicted-head portion of history disappear from identifyWeakSounds
      // output. A future cap-value adjustment (50 → 30) would silently
      // tighten this floor; this test pins the post-12-12 behavior so
      // operators changing the cap deliberately re-evaluate the threshold.
      //
      // Scenario: "ɑ̃" (nasal vowel) appears in assessments 1-3 with low
      // scores (would meet count>=3 && avgScore<70 → flagged as weak).
      // Then 60 more assessments push it out of the FIFO window — the
      // trailing-50 view has only 0 occurrences. identifyWeakSounds
      // returns an empty list (no count meets the threshold).

      // Build a history of 63 results:
      //   indices 0-2 carry phoneme "ɑ̃" with low score (would flag weak)
      //   indices 3-62 carry phoneme "u" with high score (irrelevant filler)
      const history: PronunciationResult[] = [];
      for (let i = 0; i < 3; i++) {
        history.push(makeResultWithPhoneme("ɑ̃", 40)); // low score → would flag
      }
      for (let i = 3; i < 63; i++) {
        history.push(makeResultWithPhoneme("u", 95)); // high score → never flagged
      }

      // Apply the cap incrementally (FIFO trim-down to 50) the same way
      // the hook would, by appending the last entry through the helper.
      // The first 13 entries get evicted (indices 0-12); the surviving
      // 50 are indices 13-62 — none of which carry "ɑ̃".
      let capped: PronunciationResult[] = [];
      for (const r of history) {
        capped = appendCappedHistory(capped, r);
      }
      expect(capped).toHaveLength(MAX_PRONUNCIATION_HISTORY);
      // None of the surviving entries carry "ɑ̃" — the 3 instances were
      // all in the evicted head (indices 0-2 of the 63-entry history).
      const survivingPhonemes = new Set(
        capped.flatMap((r) => r.words.flatMap((w) => w.phonemes.map((p) => p.phoneme)))
      );
      expect(survivingPhonemes.has("ɑ̃")).toBe(false);
      expect(survivingPhonemes.has("u")).toBe(true);

      // identifyWeakSounds over the capped view should NOT flag "ɑ̃" —
      // count drops to 0 (filter requires count >= 3).
      const weakAfterEviction = identifyWeakSounds(capped);
      expect(weakAfterEviction.find((w) => w.phoneme === "ɑ̃")).toBeUndefined();
      // It should also not flag "u" (score 95 > 70 threshold).
      expect(weakAfterEviction.find((w) => w.phoneme === "u")).toBeUndefined();

      // Sanity: if we had run identifyWeakSounds over the UNCAPPED 63-entry
      // history, "ɑ̃" WOULD have been flagged (count=3, avgScore=40).
      // Documenting the trade-off the cap deliberately accepts.
      const weakUncapped = identifyWeakSounds(history);
      const weakNasal = weakUncapped.find((w) => w.phoneme === "ɑ̃");
      expect(weakNasal).toBeDefined();
      expect(weakNasal?.count).toBe(3);
      expect(weakNasal?.avgScore).toBe(40);
    });
  });
});
