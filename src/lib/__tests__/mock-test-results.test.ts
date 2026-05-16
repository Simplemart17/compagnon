/**
 * Story 14-7 — pure-helper tests for mock-test-results.ts.
 *
 * Covers:
 *  - `formatTimeRemaining` boundaries (negative, 0, 1, 59, 60, 61, 1499, 1500, NaN, Infinity)
 *  - `formatPastResultDate` (valid ISO, invalid ISO, undefined-shaped input)
 *  - `formatPastResultDuration` (null, 0, 59, 60, 1799, 2400, negative)
 *  - `reconstructTestResultsFromMockTestRow` (valid section_scores; missing field; malformed; null cefr_result fallback; null total_score fallback)
 */

import {
  formatTimeRemaining,
  formatPastResultDate,
  formatPastResultDuration,
  reconstructTestResultsFromMockTestRow,
  type MockTestRow,
} from "@/src/lib/mock-test-results";

// Mock sentry to assert breadcrumb behaviour without depending on the real module
const mockAddBreadcrumb = jest.fn();
jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  addBreadcrumb: (crumb: unknown) => mockAddBreadcrumb(crumb),
}));

describe("Story 14-7 — mock-test-results pure helpers", () => {
  beforeEach(() => {
    mockAddBreadcrumb.mockClear();
  });

  describe("formatTimeRemaining", () => {
    it("Case 1: negative seconds → 'Time's up'", () => {
      expect(formatTimeRemaining(-1)).toBe("Time's up");
      expect(formatTimeRemaining(-3600)).toBe("Time's up");
    });

    it("Case 2: zero → 'Time's up'", () => {
      expect(formatTimeRemaining(0)).toBe("Time's up");
    });

    it("Case 3: 1-59 seconds → '<1 min remaining'", () => {
      expect(formatTimeRemaining(1)).toBe("<1 min remaining");
      expect(formatTimeRemaining(30)).toBe("<1 min remaining");
      expect(formatTimeRemaining(59)).toBe("<1 min remaining");
    });

    it("Case 4: 60-90 seconds → '~1 min remaining'", () => {
      expect(formatTimeRemaining(60)).toBe("~1 min remaining");
      expect(formatTimeRemaining(89)).toBe("~1 min remaining");
    });

    it("Case 5: 1499 seconds rounds to 25 min", () => {
      expect(formatTimeRemaining(1499)).toBe("~25 min remaining");
    });

    it("Case 6: 1500 seconds rounds to 25 min", () => {
      expect(formatTimeRemaining(1500)).toBe("~25 min remaining");
    });

    it("Case 7: NaN / Infinity defensive → 'Time's up'", () => {
      expect(formatTimeRemaining(NaN)).toBe("Time's up");
      expect(formatTimeRemaining(Infinity)).toBe("Time's up");
      expect(formatTimeRemaining(-Infinity)).toBe("Time's up");
    });
  });

  describe("formatPastResultDate", () => {
    it("Case 8: valid ISO timestamp formats to short en-locale date", () => {
      // Use a UTC midday timestamp so timezone offsets don't roll the date
      const result = formatPastResultDate("2026-05-14T12:00:00Z");
      // toLocaleDateString output varies slightly across platforms but
      // should always contain "May" + "14" in en locale
      expect(result).toMatch(/May/);
      expect(result).toMatch(/14/);
    });

    it("Case 9: invalid ISO string returns '—'", () => {
      expect(formatPastResultDate("not-a-date")).toBe("—");
      expect(formatPastResultDate("")).toBe("—");
    });

    it("Case 10: NEVER calls toLocaleDateString with 'fr' (Story 14-1 R1-M5 chrome rule)", () => {
      // Defensive runtime check: the format helper uses "en" locale.
      // We assert this indirectly by verifying the output uses English
      // month abbreviations (May, Jan, Dec) — not French ("mai", "janv.", "déc.").
      const result = formatPastResultDate("2026-01-15T12:00:00Z");
      expect(result).toMatch(/Jan/);
      expect(result).not.toMatch(/janv/);
    });
  });

  describe("formatPastResultDuration", () => {
    it("Case 11: null → '—'", () => {
      expect(formatPastResultDuration(null)).toBe("—");
    });

    it("Case 12: zero → '0 min'", () => {
      expect(formatPastResultDuration(0)).toBe("0 min");
    });

    it("Case 13: 59 seconds rounds to 1 min", () => {
      expect(formatPastResultDuration(59)).toBe("1 min");
    });

    it("Case 14: 60 seconds → 1 min; 1799 → 30 min; 2400 → 40 min", () => {
      expect(formatPastResultDuration(60)).toBe("1 min");
      expect(formatPastResultDuration(1799)).toBe("30 min");
      expect(formatPastResultDuration(2400)).toBe("40 min");
    });

    it("Case 15: negative seconds clamps to 0", () => {
      expect(formatPastResultDuration(-30)).toBe("0 min");
    });
  });

  describe("reconstructTestResultsFromMockTestRow", () => {
    const validSectionScore = {
      score: 80,
      correct: 32,
      total: 39,
      tcfScore: 450,
      cefrLevel: "B2",
    };

    function makeRow(overrides: Partial<MockTestRow> = {}): MockTestRow {
      return {
        id: "test-row-1",
        user_id: "user-1",
        test_type: "full",
        total_score: 450,
        section_scores: {
          listening: validSectionScore,
          reading: { ...validSectionScore, tcfScore: 470 },
          // save-state fields that should be IGNORED
          answers: { listening_0: "a", reading_0: "b" },
          currentSectionIndex: 1,
          savedAt: Date.now(),
        },
        cefr_result: "B2",
        duration_seconds: 2280,
        questions: { listening: [], reading: [] },
        status: "completed",
        created_at: "2026-05-14T10:00:00Z",
        completed_at: "2026-05-14T10:38:00Z",
        ...overrides,
      };
    }

    it("Case 16: valid section_scores returns full TestResultsPayload", () => {
      const result = reconstructTestResultsFromMockTestRow(makeRow());
      expect(result).not.toBeNull();
      expect(result!.testType).toBe("full");
      expect(result!.overallTcfScore).toBe(450);
      expect(result!.overallCefrLevel).toBe("B2");
      // Only the section keys are surfaced — save-state keys are filtered out
      expect(Object.keys(result!.sections).sort()).toEqual(["listening", "reading"]);
      expect(result!.sections.listening.tcfScore).toBe(450);
      expect(result!.sections.reading.tcfScore).toBe(470);
    });

    it("Case 17: missing section_scores returns null + fires breadcrumb", () => {
      const result = reconstructTestResultsFromMockTestRow(makeRow({ section_scores: null }));
      expect(result).toBeNull();
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "mock-test",
          level: "warning",
          data: expect.objectContaining({
            mockTestId: "test-row-1",
            reason: "missing-section-scores",
          }),
        })
      );
    });

    it("Case 18: section_scores without any section payloads returns null + fires breadcrumb", () => {
      const result = reconstructTestResultsFromMockTestRow(
        makeRow({
          section_scores: {
            // only save-state keys, no per-section result payloads
            answers: {},
            currentSectionIndex: 0,
          },
        })
      );
      expect(result).toBeNull();
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: "no-section-results" }),
        })
      );
    });

    it("Case 19: null cefr_result falls back to 'A1'", () => {
      const result = reconstructTestResultsFromMockTestRow(makeRow({ cefr_result: null }));
      expect(result).not.toBeNull();
      expect(result!.overallCefrLevel).toBe("A1");
    });

    it("Case 20: null total_score falls back to averaged section tcfScores", () => {
      const result = reconstructTestResultsFromMockTestRow(makeRow({ total_score: null }));
      expect(result).not.toBeNull();
      // Average of 450 + 470 = 460
      expect(result!.overallTcfScore).toBe(460);
    });

    it("Case 21: malformed section payload (missing tcfScore) is skipped without crashing", () => {
      const result = reconstructTestResultsFromMockTestRow(
        makeRow({
          section_scores: {
            listening: validSectionScore, // valid
            reading: { score: 80, correct: 32, total: 39, cefrLevel: "B2" }, // missing tcfScore
          },
        })
      );
      expect(result).not.toBeNull();
      // Only the valid section is surfaced
      expect(Object.keys(result!.sections)).toEqual(["listening"]);
    });

    it("Case 22: invalid cefr_result (not in A1-C2 set) falls back to 'A1'", () => {
      const result = reconstructTestResultsFromMockTestRow(
        makeRow({ cefr_result: "INVALID_LEVEL" })
      );
      expect(result).not.toBeNull();
      expect(result!.overallCefrLevel).toBe("A1");
    });

    it("Case 23 (R1-P11): invalid cefr_result fires a warning breadcrumb (operator visibility)", () => {
      // Pre-R1 the silent fallback hid logical inconsistencies (e.g.,
      // TCF 450 B2-range score next to A1 CEFR badge). The fallback is
      // preserved (screen stays renderable) but operators get a breadcrumb
      // to grep for corrupted historical rows.
      mockAddBreadcrumb.mockClear();
      reconstructTestResultsFromMockTestRow(makeRow({ cefr_result: "INVALID_LEVEL" }));
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "mock-test",
          level: "warning",
          message: "Landing: reconstructTestResultsFromMockTestRow invalid cefr_result",
          data: expect.objectContaining({
            mockTestId: "test-row-1",
            observedCefr: "INVALID_LEVEL",
          }),
        })
      );
    });

    it("Case 24 (R1-P11): null cefr_result does NOT fire the invalid-cefr breadcrumb", () => {
      // The breadcrumb is for MALFORMED non-null values, not for legitimate
      // null. Null is a clean "score wasn't computed" signal.
      mockAddBreadcrumb.mockClear();
      reconstructTestResultsFromMockTestRow(makeRow({ cefr_result: null }));
      expect(mockAddBreadcrumb).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Landing: reconstructTestResultsFromMockTestRow invalid cefr_result",
        })
      );
    });
  });
});
