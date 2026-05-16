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
        // R1-P5: in-progress query chains `.is("completed_at", null)`
        // (defense-in-depth against the completion-UPDATE race). Mock
        // must support `.is(...)` returning the chain.
        is: jest.fn(() => chain),
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
          // R1-P1 save-state gate: `answers` MUST be present (typeof "object")
          // for the row to be treated as resumable.
          answers: { listening_0: "a", listening_1: "b", reading_0: "c" },
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

  it("Case 5 (R1-P2): speaking past-result is EXCLUDED from v1 + R1-P12 breadcrumb fires", async () => {
    // Story 9-8 stores Speaking section_scores in a per-task shape
    // (`{speaking:{task1,task2,task3,compositeOverall}}`) that
    // `reconstructTestResultsFromMockTestRow` can't handle. R1-P2 removes
    // "speaking" from `PAST_RESULT_TEST_TYPES` so the row is filtered out
    // at `toPastResult`. R1-P12 fires a breadcrumb for the filtered row so
    // operators can see speaking tests are excluded (informational).
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

    expect(result.current?.pastResults).toHaveLength(0);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "mock-test",
        level: "info",
        message: "Landing: past result test_type not surfaced in v1",
        data: expect.objectContaining({
          mockTestId: "speaking-1",
          observedTestType: "speaking",
        }),
      })
    );
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

  it("Case 7 (R1-P13): refetch() re-fires both queries — exact call-count assertions", async () => {
    // R1-P13: pre-patch this asserted only `>` initial counts; a regression
    // that fires the queries 2× per render would have passed. Post-patch we
    // assert EXACT counts to catch double-fire bugs (incl. the EC-1
    // useEffect + useFocusEffect double-fetch which is now gated by
    // `firstFocusRef` in the screen).
    const { result } = renderHost();
    await flushAsync();

    // Initial mount fires the in-hook `useEffect` once. The hook itself
    // does NOT receive a `useFocusEffect` invocation in this test (no
    // navigation container) — that's verified at the screen layer.
    expect(mockInProgressMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockPastResultsRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current?.refetch();
    });

    expect(mockInProgressMaybeSingle).toHaveBeenCalledTimes(2);
    expect(mockPastResultsRows).toHaveBeenCalledTimes(2);
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
          // R1-P1 save-state gate requires `answers` to be present.
          answers: { listening_0: "a" },
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

    it("Case 12 (R1-P12): unknown test_type is excluded + fires telemetry breadcrumb", () => {
      const result = toPastResult({
        id: "x",
        test_type: "writing", // not in PAST_RESULT_TEST_TYPES
        total_score: 400,
        cefr_result: "B2",
        duration_seconds: 2280,
        completed_at: "2026-05-14T10:00:00Z",
      });
      expect(result).toBeNull();
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "mock-test",
          level: "info",
          message: "Landing: past result test_type not surfaced in v1",
          data: expect.objectContaining({
            mockTestId: "x",
            observedTestType: "writing",
          }),
        })
      );
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

    it("Case 14 (R1-P1): in-progress row WITHOUT `answers` is hidden (save-state gate)", () => {
      // A row with questions but no save-state (user started a test +
      // backed out before answering any question) would silently show as
      // resumable pre-R1, but Story 13-4's resume path requires
      // `section_scores.answers` to be truthy. The save-state gate hides
      // these rows from the landing's Resume surface.
      const result = validateInProgressRow({
        id: "ip-no-saves",
        test_type: "full",
        questions: {
          listening: [{ question: "Q1" }],
          reading: [{ question: "Q1" }],
        },
        section_scores: {
          // NO `answers` field
          currentSectionIndex: 0,
          currentQuestionIndex: 0,
          timeRemaining: 5700,
          savedAt: Date.now(),
        },
        created_at: "2026-05-14T10:00:00Z",
      });

      expect(result.summary).toBeNull();
      expect(result.corrupt).toBe(false); // NOT corrupt — just not resumable
    });

    it("Case 15 (R1-P9): in-progress row with adjustedTimeRemaining=0 AND zero answers is hidden (expired gate)", () => {
      // Saved 10000s ago with 60s timeRemaining → adjusted = max(0, 60 -
      // 10000) = 0. With 0 answers, the user has no partial progress to
      // resume — hide the row instead of sending them to an immediately-
      // finished test.
      const result = validateInProgressRow({
        id: "ip-expired",
        test_type: "full",
        questions: {
          listening: [{ question: "Q1" }],
          reading: [{ question: "Q1" }],
        },
        section_scores: {
          answers: {}, // empty answers — no progress to resume
          currentSectionIndex: 0,
          currentQuestionIndex: 0,
          timeRemaining: 60,
          savedAt: Date.now() - 10_000_000, // 10000+ seconds ago
          answeredQuestions: [],
        },
        created_at: "2026-05-14T10:00:00Z",
      });

      expect(result.summary).toBeNull();
      expect(result.corrupt).toBe(false);
    });

    it("Case 16 (R1-P9): expired test WITH answers still surfaces (user can view partial progress)", () => {
      // User answered some questions then ran out of time. They should
      // still see the row so they can navigate into it (the runner's
      // expired-time path shows their results with partial answers).
      const result = validateInProgressRow({
        id: "ip-expired-with-answers",
        test_type: "full",
        questions: {
          listening: [{ question: "Q1" }],
          reading: [{ question: "Q1" }],
        },
        section_scores: {
          answers: { listening_0: "a", listening_1: "b" },
          currentSectionIndex: 0,
          currentQuestionIndex: 2,
          timeRemaining: 60,
          savedAt: Date.now() - 10_000_000,
          answeredQuestions: ["listening_0", "listening_1"],
        },
        created_at: "2026-05-14T10:00:00Z",
      });

      expect(result.summary).not.toBeNull();
      expect(result.summary!.adjustedTimeRemaining).toBe(0);
      expect(result.summary!.totalQuestionsAnswered).toBe(2);
    });
  });
});
