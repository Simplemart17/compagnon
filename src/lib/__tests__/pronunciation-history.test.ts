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

import { appendCappedHistory, MAX_PRONUNCIATION_HISTORY } from "../pronunciation-history";
import type { PronunciationResult } from "../pronunciation";

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

    it("Case 6: does NOT mutate the input array", () => {
      const prev: PronunciationResult[] = [];
      for (let i = 0; i < 50; i++) prev.push(makeResult(i));
      const prevLengthBefore = prev.length;
      const prevFirstBefore = prev[0];
      appendCappedHistory(prev, makeResult(50));
      // Input length unchanged.
      expect(prev.length).toBe(prevLengthBefore);
      // Input first-element reference unchanged.
      expect(prev[0]).toBe(prevFirstBefore);
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
});
