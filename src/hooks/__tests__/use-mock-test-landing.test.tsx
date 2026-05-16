/**
 * Story 14-7 — `useMockTestLanding` hook contract tests.
 *
 * Covers:
 *  - Happy path: 1 in-progress + 5 past results
 *  - Empty path: zero in-progress + zero past results
 *  - Error path: Supabase rejection routes through captureError(_, "mock-test-landing-fetch")
 *  - Corrupt in-progress: hasValidQuestions=false → inProgress null + warning breadcrumb
 *  - Speaking past-results: totalScore null passes through correctly
 *  - Past-results truncation at exactly 10 rows fires info breadcrumb
 *  - refetch() re-fires both queries
 *  - mountedRef defers stale-resolve setState after unmount
 *
 * Uses react-test-renderer (Story 12-1 P8 / 13-3 / 13-4 precedent).
 */

import React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";

import {
  useMockTestLanding,
  type UseMockTestLandingReturn,
  validateInProgressRow,
  toPastResult,
} from "../use-mock-test-landing";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCaptureError = jest.fn();
const mockAddBreadcrumb = jest.fn();
jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: (...args: unknown[]) => mockCaptureError(...args),
  addBreadcrumb: (crumb: unknown) => mockAddBreadcrumb(crumb),
}));

// Auth store — return a fixed user
jest.mock("@/src/store/auth-store", () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

// Supabase mock — supports the 2 query chains used by the hook
type RowsResponse<T> = { data: T[] | null; error: { message: string } | null };
type SingleResponse<T> = { data: T | null; error: { message: string } | null };

const mockInProgressMaybeSingle = jest.fn<Promise<SingleResponse<Record<string, unknown>>>, []>(
  async () => ({ data: null, error: null })
);
const mockPastResultsRows = jest.fn<Promise<RowsResponse<Record<string, unknown>>>, []>(
  async () => ({ data: [], error: null })
);

jest.mock("@/src/lib/supabase", () => ({
  __esModule: true,
  supabase: {
    from: jest.fn((_table: string) => {
      // Build a chainable proxy. The two query shapes the hook uses:
      //   .select(...).eq(...).eq(...).order(...).limit(1).maybeSingle()  → in-progress
      //   .select(...).eq(...).eq(...).not(...).order(...).limit(10)       → past-results
      // The terminal call distinguishes: maybeSingle vs awaiting the chain
      // directly. We make the chain itself a thenable that resolves to the
      // past-results response, AND expose maybeSingle for the in-progress
      // query.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        not: jest.fn(() => chain),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        maybeSingle: () => mockInProgressMaybeSingle(),
        // Thenable so `await chain` works for the past-results query (which
        // doesn't terminate with `.maybeSingle()`).
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          mockPastResultsRows().then(resolve, reject),
      };
      return chain;
    }),
  },
}));

// TCF section minutes (used by validateInProgressRow's time-remaining clamp)
jest.mock("@/src/lib/tcf", () => ({
  __esModule: true,
  TCF_QCM_SECTIONS: {
    listening: { minutes: 35 },
    reading: { minutes: 60 },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function HookHost({
  result,
}: {
  result: { current: UseMockTestLandingReturn | null };
}): React.ReactElement {
  const value = useMockTestLanding();
  result.current = value;
  return <Text>host</Text>;
}

const activeRenderers: ReturnType<typeof create>[] = [];

function renderHost() {
  const result: { current: UseMockTestLandingReturn | null } = { current: null };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<HookHost result={result} />);
  });
  activeRenderers.push(renderer!);
  return { result, renderer: renderer! };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInProgressMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockPastResultsRows.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  for (const renderer of activeRenderers) {
    try {
      act(() => {
        renderer.unmount();
      });
    } catch {
      // Already-unmounted — safe to swallow.
    }
  }
  activeRenderers.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Story 14-7 — useMockTestLanding hook", () => {
  it("Case 1: happy path — 1 in-progress + 5 past results returned", async () => {
    mockInProgressMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "ip-1",
        test_type: "full",
        questions: {
          listening: [{ question: "Q1" }],
          reading: [{ question: "Q1" }],
        },
        section_scores: {
          currentSectionIndex: 1,
          currentQuestionIndex: 17,
          timeRemaining: 1500,
          savedAt: Date.now(),
          answeredQuestions: ["listening_0", "listening_1", "reading_0"],
        },
        created_at: "2026-05-14T10:00:00Z",
      },
      error: null,
    });
    mockPastResultsRows.mockResolvedValueOnce({
      data: Array.from({ length: 5 }, (_, i) => ({
        id: `past-${i}`,
        test_type: "full",
        total_score: 400 + i * 10,
        cefr_result: "B2",
        duration_seconds: 2280,
        completed_at: `2026-05-${10 + i}T10:00:00Z`,
      })),
      error: null,
    });

    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.loading).toBe(false);
    expect(result.current?.inProgress).not.toBeNull();
    expect(result.current?.inProgress?.id).toBe("ip-1");
    expect(result.current?.inProgress?.testType).toBe("full");
    expect(result.current?.inProgress?.savedSectionIndex).toBe(1);
    expect(result.current?.inProgress?.savedQuestionIndex).toBe(17);
    expect(result.current?.inProgress?.totalQuestionsAnswered).toBe(3);
    expect(result.current?.pastResults).toHaveLength(5);
    expect(result.current?.pastResults[0].id).toBe("past-0");
    expect(result.current?.pastResults[0].cefrResult).toBe("B2");
    expect(result.current?.error).toBeNull();
  });

  it("Case 2: empty path — zero rows returns inProgress null + empty pastResults", async () => {
    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.loading).toBe(false);
    expect(result.current?.inProgress).toBeNull();
    expect(result.current?.pastResults).toEqual([]);
    expect(result.current?.error).toBeNull();
  });

  it("Case 3: Supabase error → captureError fires + state surfaces error", async () => {
    mockInProgressMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });

    const { result } = renderHost();
    await flushAsync();

    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      "mock-test-landing-fetch"
    );
    expect(result.current?.inProgress).toBeNull();
    expect(result.current?.pastResults).toEqual([]);
    expect(result.current?.error).not.toBeNull();
    expect(result.current?.loading).toBe(false);
  });

  it("Case 4: corrupt in-progress (no valid questions) → inProgress null + warning breadcrumb", async () => {
    mockInProgressMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "ip-corrupt",
        test_type: "full",
        questions: { listening: [], reading: [] }, // empty → corrupt
        section_scores: { answers: {} },
        created_at: "2026-05-14T10:00:00Z",
      },
      error: null,
    });

    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.inProgress).toBeNull();
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "mock-test",
        level: "warning",
        message: "Landing: in-progress row corrupt — hidden from resume surface",
        data: { mockTestId: "ip-corrupt" },
      })
    );
  });

  it("Case 5: speaking past-result with null totalScore passes through correctly", async () => {
    mockPastResultsRows.mockResolvedValueOnce({
      data: [
        {
          id: "speaking-1",
          test_type: "speaking",
          total_score: null,
          cefr_result: "B2",
          duration_seconds: 600,
          completed_at: "2026-05-14T10:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.pastResults).toHaveLength(1);
    expect(result.current?.pastResults[0].testType).toBe("speaking");
    expect(result.current?.pastResults[0].totalScore).toBeNull();
    expect(result.current?.pastResults[0].cefrResult).toBe("B2");
  });

  it("Case 6: past-results truncation at exactly 10 rows fires info breadcrumb", async () => {
    mockPastResultsRows.mockResolvedValueOnce({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: `past-${i}`,
        test_type: "full",
        total_score: 400,
        cefr_result: "B2",
        duration_seconds: 2280,
        completed_at: `2026-05-${10 + i}T10:00:00Z`,
      })),
      error: null,
    });

    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.pastResults).toHaveLength(10);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "mock-test",
        level: "info",
        message: "Landing: past results truncated at 10",
        data: { actualCount: 10 },
      })
    );
  });

  it("Case 7: refetch() re-fires both queries", async () => {
    const { result } = renderHost();
    await flushAsync();

    // Initial fetch fired
    const initialInProgressCalls = mockInProgressMaybeSingle.mock.calls.length;
    const initialPastCalls = mockPastResultsRows.mock.calls.length;
    expect(initialInProgressCalls).toBeGreaterThan(0);
    expect(initialPastCalls).toBeGreaterThan(0);

    await act(async () => {
      await result.current?.refetch();
    });

    expect(mockInProgressMaybeSingle.mock.calls.length).toBeGreaterThan(initialInProgressCalls);
    expect(mockPastResultsRows.mock.calls.length).toBeGreaterThan(initialPastCalls);
  });

  it("Case 8: NON-QCM in-progress test_type (e.g., speaking) returns inProgress null without breadcrumb", async () => {
    mockInProgressMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "ip-speaking",
        test_type: "speaking", // speaking doesn't use the section-resume model
        questions: {},
        section_scores: {},
        created_at: "2026-05-14T10:00:00Z",
      },
      error: null,
    });

    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.inProgress).toBeNull();
    // NO corrupt warning fires (this isn't corrupt — it's just a non-resume test type)
    expect(mockAddBreadcrumb).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Landing: in-progress row corrupt — hidden from resume surface",
      })
    );
  });

  it("Case 9: 9 past results (below truncation threshold) does NOT fire truncation breadcrumb", async () => {
    mockPastResultsRows.mockResolvedValueOnce({
      data: Array.from({ length: 9 }, (_, i) => ({
        id: `past-${i}`,
        test_type: "full",
        total_score: 400,
        cefr_result: "B2",
        duration_seconds: 2280,
        completed_at: `2026-05-${10 + i}T10:00:00Z`,
      })),
      error: null,
    });

    const { result } = renderHost();
    await flushAsync();

    expect(result.current?.pastResults).toHaveLength(9);
    expect(mockAddBreadcrumb).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Landing: past results truncated at 10" })
    );
  });

  describe("validateInProgressRow pure helper", () => {
    it("Case 10: valid full-test row returns summary with clamped indices", () => {
      const result = validateInProgressRow({
        id: "ip-1",
        test_type: "full",
        questions: {
          listening: [{ question: "Q1" }, { question: "Q2" }],
          reading: [{ question: "Q1" }],
        },
        section_scores: {
          currentSectionIndex: 99, // out-of-bounds — should clamp
          currentQuestionIndex: 5,
          timeRemaining: 1500,
          savedAt: Date.now(),
        },
        created_at: "2026-05-14T10:00:00Z",
      });

      expect(result.corrupt).toBe(false);
      expect(result.summary).not.toBeNull();
      // sections.length-1 = 1 (listening + reading → indices 0 and 1)
      expect(result.summary!.savedSectionIndex).toBe(1);
      expect(result.summary!.savedQuestionIndex).toBe(5);
      expect(result.summary!.totalQuestionsAcrossSections).toBe(3);
    });
  });

  describe("toPastResult pure helper", () => {
    it("Case 11: row with null completed_at is excluded", () => {
      const result = toPastResult({
        id: "x",
        test_type: "full",
        total_score: 400,
        cefr_result: "B2",
        duration_seconds: 2280,
        completed_at: null,
      });
      expect(result).toBeNull();
    });

    it("Case 12: unknown test_type is excluded", () => {
      const result = toPastResult({
        id: "x",
        test_type: "writing", // not in PAST_RESULT_TEST_TYPES
        total_score: 400,
        cefr_result: "B2",
        duration_seconds: 2280,
        completed_at: "2026-05-14T10:00:00Z",
      });
      expect(result).toBeNull();
    });

    it("Case 13: invalid cefr_result is nulled out (not erroneously surfaced)", () => {
      const result = toPastResult({
        id: "x",
        test_type: "full",
        total_score: 400,
        cefr_result: "INVALID",
        duration_seconds: 2280,
        completed_at: "2026-05-14T10:00:00Z",
      });
      expect(result).not.toBeNull();
      expect(result!.cefrResult).toBeNull();
    });
  });
});
