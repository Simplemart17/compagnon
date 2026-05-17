/**
 * Story 15-1 — pure unit tests for `calculateNextReview` SM-2 algorithm.
 *
 * Covers the full quality boundary (0..5), easeFactor 1.3 floor clamp,
 * repetition-driven interval progression (1 → 6 → ef*prev), the 365-day
 * maximum interval cap, midnight-snap of `nextReview`, and the no-mutation
 * invariant on the input `current` state.
 *
 * SM-2 ease-factor update formula:
 *   easeFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
 *   floor at 1.3
 *
 * Per-quality ease-factor delta (start 2.5 → result before clamp):
 *   q=5: +0.10
 *   q=4:  0.00
 *   q=3: -0.14
 *   q=2: -0.32
 *   q=1: -0.54
 *   q=0: -0.80
 */

import { calculateNextReview, type SRSState } from "@/src/lib/srs";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// R1-P1: pin `new Date()` + `Date.now()` to a fixed moment so the
// `nextReview` math (Case 12 + Case 14) is deterministic and cannot flake
// across midnight or DST boundaries. Use a noon-UTC timestamp so we sit
// safely in the middle of a day for all timezones the CI might run in.
const FROZEN_NOW = new Date("2026-05-17T12:00:00Z");

beforeAll(() => {
  jest.useFakeTimers({ now: FROZEN_NOW });
});

afterAll(() => {
  jest.useRealTimers();
});

function makeState(overrides: Partial<SRSState> = {}): SRSState {
  return { easeFactor: 2.5, intervalDays: 1, repetitions: 0, ...overrides };
}

describe("Story 15-1 — calculateNextReview (SM-2)", () => {
  describe("Quality 0..2 — incorrect response: reset path", () => {
    it("Case 1: quality 0 resets repetitions=0, intervalDays=1, easeFactor -= 0.80 (clamped at 1.3 if needed)", () => {
      const input = makeState({ easeFactor: 2.5, intervalDays: 12, repetitions: 4 });
      const result = calculateNextReview(input, 0);
      expect(result.repetitions).toBe(0);
      expect(result.intervalDays).toBe(1);
      expect(result.easeFactor).toBeCloseTo(2.5 - 0.8, 5);
    });

    it("Case 2: quality 1 resets repetitions + intervalDays; easeFactor -= 0.54", () => {
      const input = makeState({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 });
      const result = calculateNextReview(input, 1);
      expect(result.repetitions).toBe(0);
      expect(result.intervalDays).toBe(1);
      expect(result.easeFactor).toBeCloseTo(2.5 - 0.54, 5);
    });

    it("Case 3: quality 2 resets repetitions + intervalDays; easeFactor -= 0.32", () => {
      const input = makeState({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 });
      const result = calculateNextReview(input, 2);
      expect(result.repetitions).toBe(0);
      expect(result.intervalDays).toBe(1);
      expect(result.easeFactor).toBeCloseTo(2.5 - 0.32, 5);
    });
  });

  describe("Quality 3..5 — correct response: progression path", () => {
    it("Case 4: quality 3 from repetitions=0 → repetitions=1, intervalDays=1; easeFactor -= 0.14", () => {
      const input = makeState({ easeFactor: 2.5, intervalDays: 1, repetitions: 0 });
      const result = calculateNextReview(input, 3);
      expect(result.repetitions).toBe(1);
      expect(result.intervalDays).toBe(1);
      expect(result.easeFactor).toBeCloseTo(2.5 - 0.14, 5);
    });

    it("Case 5: quality 4 from repetitions=1 → repetitions=2, intervalDays=6; easeFactor unchanged (delta 0)", () => {
      const input = makeState({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 });
      const result = calculateNextReview(input, 4);
      expect(result.repetitions).toBe(2);
      expect(result.intervalDays).toBe(6);
      expect(result.easeFactor).toBeCloseTo(2.5, 5);
    });

    it("Case 6: quality 5 from repetitions=2+ → repetitions+1, intervalDays = round(prev * ef); easeFactor += 0.10", () => {
      const input = makeState({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 });
      const result = calculateNextReview(input, 5);
      expect(result.repetitions).toBe(3);
      expect(result.intervalDays).toBe(Math.round(6 * 2.5)); // = 15
      expect(result.easeFactor).toBeCloseTo(2.5 + 0.1, 5);
    });
  });

  describe("easeFactor 1.3 floor clamping", () => {
    it("Case 7: easeFactor=1.4 + quality=0 (delta -0.80) → clamped at exactly 1.3", () => {
      const input = makeState({ easeFactor: 1.4, intervalDays: 1, repetitions: 0 });
      const result = calculateNextReview(input, 0);
      expect(result.easeFactor).toBe(1.3);
    });

    it("Case 8: easeFactor=1.3 + quality=0 (would go below 1.3) → stays at 1.3", () => {
      const input = makeState({ easeFactor: 1.3, intervalDays: 1, repetitions: 0 });
      const result = calculateNextReview(input, 0);
      expect(result.easeFactor).toBe(1.3);
    });

    it("Case 9: easeFactor=1.45 + quality=3 (delta -0.14 → 1.31) does NOT clamp (above 1.3)", () => {
      const input = makeState({ easeFactor: 1.45, intervalDays: 1, repetitions: 1 });
      const result = calculateNextReview(input, 3);
      expect(result.easeFactor).toBeCloseTo(1.31, 5);
    });
  });

  describe("Interval progression on 3 consecutive correct reviews", () => {
    it("Case 10: first correct (rep=0→1) → 1 day; second correct (rep=1→2) → 6 days; third (rep=2→3) → round(6*ef)", () => {
      // Walk the chain manually
      const r1 = calculateNextReview(
        { easeFactor: 2.5, intervalDays: 1, repetitions: 0 },
        4 // quality 4 leaves ef unchanged
      );
      expect(r1.repetitions).toBe(1);
      expect(r1.intervalDays).toBe(1);

      const r2 = calculateNextReview(
        { easeFactor: r1.easeFactor, intervalDays: r1.intervalDays, repetitions: r1.repetitions },
        4
      );
      expect(r2.repetitions).toBe(2);
      expect(r2.intervalDays).toBe(6);

      const r3 = calculateNextReview(
        { easeFactor: r2.easeFactor, intervalDays: r2.intervalDays, repetitions: r2.repetitions },
        4
      );
      expect(r3.repetitions).toBe(3);
      // For q=4 ease-factor stays at 2.5; intervalDays = round(6 * 2.5) = 15
      expect(r3.intervalDays).toBe(15);
    });
  });

  describe("365-day interval cap", () => {
    it("Case 11: a long-tenure item near the cap doesn't exceed 365 days", () => {
      // prev=400, ef=2.5, quality=5 → would be round(400*2.5)=1000; capped at 365
      const input = makeState({ easeFactor: 2.5, intervalDays: 400, repetitions: 5 });
      const result = calculateNextReview(input, 5);
      expect(result.intervalDays).toBe(365);
    });
  });

  describe("nextReview math (midnight-snap of target day)", () => {
    it("Case 12: nextReview is midnight local time on Date.now() + intervalDays days", () => {
      // The impl uses `new Date()` + setDate + setHours(0,0,0,0). We assert
      // that the returned Date is at midnight local AND that it falls on the
      // expected calendar day (today's date + intervalDays).
      const before = new Date();
      const result = calculateNextReview(
        makeState({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 }),
        4
      );
      // q=4 + reps=1 → intervalDays becomes 6
      expect(result.intervalDays).toBe(6);
      // nextReview is at midnight local
      expect(result.nextReview.getHours()).toBe(0);
      expect(result.nextReview.getMinutes()).toBe(0);
      expect(result.nextReview.getSeconds()).toBe(0);
      expect(result.nextReview.getMilliseconds()).toBe(0);
      // And the calendar-day delta is 6 (allowing for the midnight snap
      // shaving up to ~24h off the "before" timestamp).
      const deltaMs = result.nextReview.getTime() - before.getTime();
      const deltaDays = deltaMs / MS_PER_DAY;
      // Midnight-snap means deltaDays is in (5, 6] depending on time-of-day
      expect(deltaDays).toBeGreaterThan(5);
      expect(deltaDays).toBeLessThanOrEqual(6);
    });
  });

  describe("No-mutation invariant", () => {
    it("Case 13: input `current` state is NOT mutated after the call", () => {
      const input: SRSState = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
      const snapshot = { ...input };
      calculateNextReview(input, 5);
      expect(input).toEqual(snapshot);
      // Verify each property individually for clarity
      expect(input.easeFactor).toBe(2.5);
      expect(input.intervalDays).toBe(6);
      expect(input.repetitions).toBe(2);
    });

    it("Case 14: calling twice on the same input returns equivalent results (deterministic / no hidden state) AND returns DISTINCT Date references (R1-P4 memoization defense)", () => {
      const input: SRSState = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
      const r1 = calculateNextReview(input, 5);
      const r2 = calculateNextReview(input, 5);
      expect(r1.easeFactor).toBe(r2.easeFactor);
      expect(r1.intervalDays).toBe(r2.intervalDays);
      expect(r1.repetitions).toBe(r2.repetitions);
      // With fake timers pinned to FROZEN_NOW, both calls produce the same
      // calendar day at midnight.
      expect(r1.nextReview.toDateString()).toBe(r2.nextReview.toDateString());
      expect(r1.nextReview.getTime()).toBe(r2.nextReview.getTime());
      // R1-P4: returned Date references MUST be distinct objects. A future
      // refactor that memoizes the Date (e.g., a module-level "today" cache)
      // would break consumers that mutate the returned Date in place.
      expect(r1.nextReview).not.toBe(r2.nextReview);
    });
  });
});
