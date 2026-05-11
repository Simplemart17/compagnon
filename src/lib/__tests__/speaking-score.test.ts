/**
 * Story 11-1 — Speaking-score formula baseline pin.
 *
 * The formula at `src/lib/speaking-score.ts` `computeSpeakingScore` is
 * unchanged by Story 11-1, but the input accuracy improves significantly
 * (corrections now arrive via the `report_correction` Realtime tool-call
 * instead of the deleted brittle regex). This suite pins the formula's
 * behavior at 7 canonical inputs so any future tuning story has an
 * explicit baseline to diff against.
 *
 * The behavioral cases are derived from the formula:
 *   - score = max(20, round(100 - (correctedEntries / max(totalEntries, 1)) * 30))
 *   - default = 70 when totalUserEntries == 0
 *   - floor = 20 (penalty cap reached when ratio >= 8/3 ≈ 2.67)
 */

import { computeSpeakingScore } from "../speaking-score";

describe("computeSpeakingScore (Story 11-1 baseline pin)", () => {
  it("returns 70 (default) when there are zero user entries", () => {
    expect(computeSpeakingScore(0, 0)).toBe(70);
  });

  it("returns 70 (default) when totalUserEntries is negative (defensive)", () => {
    expect(computeSpeakingScore(-1, 5)).toBe(70);
  });

  it("returns 100 when there are no corrections", () => {
    expect(computeSpeakingScore(10, 0)).toBe(100);
  });

  it("returns 97 for 1 correction out of 10 entries", () => {
    // 100 - (1/10) * 30 = 100 - 3 = 97
    expect(computeSpeakingScore(10, 1)).toBe(97);
  });

  it("returns 85 for 5 corrections out of 10 entries", () => {
    // 100 - (5/10) * 30 = 100 - 15 = 85
    expect(computeSpeakingScore(10, 5)).toBe(85);
  });

  it("returns 70 for 10 corrections out of 10 entries (1:1 ratio)", () => {
    // 100 - (10/10) * 30 = 100 - 30 = 70
    expect(computeSpeakingScore(10, 10)).toBe(70);
  });

  it("returns 70 for 2 corrections out of 2 entries (small-N boundary)", () => {
    // 100 - (2/2) * 30 = 100 - 30 = 70
    expect(computeSpeakingScore(2, 2)).toBe(70);
  });

  it("floors at 20 when corrections outnumber entries by a wide margin", () => {
    // 100 - (10/1) * 30 = -200 → floor 20
    expect(computeSpeakingScore(1, 10)).toBe(20);
  });

  it("rounds intermediate scores correctly", () => {
    // 100 - (1/3) * 30 = 100 - 10 = 90 (exact)
    expect(computeSpeakingScore(3, 1)).toBe(90);
    // 100 - (1/7) * 30 ≈ 95.714 → round → 96
    expect(computeSpeakingScore(7, 1)).toBe(96);
  });
});
