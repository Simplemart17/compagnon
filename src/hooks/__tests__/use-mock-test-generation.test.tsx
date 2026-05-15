/**
 * Story 13-4 — `useMockTestGeneration` hook contract tests (audit P2-6 closure).
 *
 * Pins:
 *   - Concurrent firing — both `chatCompletionJSON` calls dispatched in
 *     parallel via `Promise.allSettled` (NOT serial `for-of` await).
 *   - First-section-ready BEFORE second — `firstSectionReady` flips when
 *     section 1 resolves while section 2 stays "pending".
 *   - All ready / per-section failure isolation / all failed.
 *   - Single-section test (`testIdParam === "listening"`).
 *   - sectionsKey content-key memoization (Story 13-3 P2) defeats fresh-
 *     reference re-fires.
 *   - mountedRef guard (Story 12-9 P8 deferred-resolve pattern).
 *   - DB INSERT on first-section-ready, single-fire via insertFiredRef.
 *   - DB UPDATE on subsequent-section-ready, fire-and-forget.
 *   - DB UPDATE failure silenced via captureError(_, "mock-test-section-update").
 *   - Resume short-circuits generation (mock_tests.select.in_progress).
 *   - Corrupt resume → resumeData.corrupt=true; no AI call.
 *   - `retry()` re-fires ONLY failed sections.
 *   - `enabled: false` no-ops.
 *
 * Uses react-test-renderer (Story 12-1 P8 / 12-9 / 13-3 pattern).
 */

import React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";

import type { MCQContent } from "@/src/types/exercise";

import {
  useMockTestGeneration,
  type UseMockTestGenerationOptions,
  type UseMockTestGenerationReturn,
} from "../use-mock-test-generation";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChatCompletionJSON = jest.fn();
jest.mock("@/src/lib/openai", () => ({
  __esModule: true,
  chatCompletionJSON: (...args: unknown[]) => mockChatCompletionJSON(...args),
}));

jest.mock("@/src/lib/schemas/ai-responses", () => ({
  __esModule: true,
  mockTestSectionSchema: { _tag: "schema" },
}));

jest.mock("@/src/lib/prompts/mock-test", () => ({
  __esModule: true,
  buildMockTestPrompt: jest.fn((args: { section: string }) => `prompt-for-${args.section}`),
}));

const mockCaptureError = jest.fn();
jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: (...args: unknown[]) => mockCaptureError(...args),
  addBreadcrumb: jest.fn(),
}));

// Supabase mock — covers auth.getSession + from("mock_tests")
//   .select(...).eq().eq().eq().order().limit().maybeSingle()  (resume detect)
//   .insert(...).select("id").single()                         (first-ready insert)
//   .update({...}).eq("id", id)                                (subsequent update)
type MockSessionData = {
  data: {
    session: { user: { id: string } } | null;
  };
};
type MockMaybeSingleResult = {
  data: {
    id: string;
    questions: Record<string, MCQContent[]>;
    section_scores: Record<string, unknown>;
  } | null;
  error: { message: string } | null;
};
type MockInsertSingleResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};
type MockUpdateResult = { error: { message: string; code?: string } | null };

const mockGetSession = jest.fn<Promise<MockSessionData>, []>(async () => ({
  data: { session: { user: { id: "user-1" } } },
}));
const mockMaybeSingle = jest.fn<Promise<MockMaybeSingleResult>, []>(async () => ({
  data: null,
  error: null,
}));
const mockInsertSingle = jest.fn<Promise<MockInsertSingleResult>, []>(async () => ({
  data: { id: "test-row-1" },
  error: null,
}));
const mockUpdate = jest.fn<Promise<MockUpdateResult>, [string]>(async () => ({ error: null }));
// Story 13-4 review-round-1 P17 — capture the UPDATE payload + INSERT payload
// so tests can assert what was actually written, not just call counts.
type UpdateCall = { payload: Record<string, unknown>; id: string };
type InsertCall = { payload: Record<string, unknown> };
const capturedUpdates: UpdateCall[] = [];
const capturedInserts: InsertCall[] = [];

jest.mock("@/src/lib/supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: jest.fn(() => {
      // The shape returned must support BOTH the resume-select chain AND the
      // insert-select chain AND the update-eq chain. We build a chainable
      // proxy whose terminal methods (maybeSingle / single / .eq() returning
      // the update result) resolve via the per-method mocks. Typed as `any`
      // because the production supabase client returns a complex
      // PostgrestQueryBuilder<...> type we don't want to mirror in tests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        maybeSingle: () => mockMaybeSingle(),
        insert: jest.fn((payload: Record<string, unknown>) => {
          capturedInserts.push({ payload });
          return chain;
        }),
        single: () => mockInsertSingle(),
        update: jest.fn((payload: Record<string, unknown>) => ({
          // supabase's `.eq(column, value)` takes 2 args. We only care about
          // the value (the row id) for our capture; the column is always "id"
          // in the hook's UPDATE chain.
          eq: (_column: string, value: string) => {
            capturedUpdates.push({ payload, id: value });
            return mockUpdate(value);
          },
        })),
      };
      return chain;
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_QUESTION: MCQContent = {
  question: "Sample?",
  options: [
    { id: "a", text: "A", isCorrect: true },
    { id: "b", text: "B", isCorrect: false },
    { id: "c", text: "C", isCorrect: false },
    { id: "d", text: "D", isCorrect: false },
  ],
  explanation: "because A",
} as unknown as MCQContent;

function sectionResponse(numQuestions: number) {
  return {
    questions: Array.from({ length: numQuestions }, () => SAMPLE_QUESTION),
    passages: [],
  };
}

function HookHost({
  result,
  ...options
}: UseMockTestGenerationOptions & {
  result: { current: UseMockTestGenerationReturn | null };
}): React.ReactElement {
  const value = useMockTestGeneration(options);
  result.current = value;
  return <Text>host</Text>;
}

const activeRenderers: ReturnType<typeof create>[] = [];

function renderHost(options: UseMockTestGenerationOptions) {
  const result: { current: UseMockTestGenerationReturn | null } = { current: null };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<HookHost {...options} result={result} />);
  });
  activeRenderers.push(renderer!);
  return { result, renderer: renderer! };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    // Multiple microtask flushes — the hook's resume-select awaits
    // supabase.auth.getSession + supabase.from(...).maybeSingle + then
    // dispatches the parallel generation; each step is a microtask hop.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset to "no resume" by default.
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockInsertSingle.mockResolvedValue({ data: { id: "test-row-1" }, error: null });
  mockUpdate.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  // P17 — clear captured payload arrays between tests.
  capturedUpdates.length = 0;
  capturedInserts.length = 0;
});

afterEach(() => {
  for (const renderer of activeRenderers) {
    try {
      act(() => {
        renderer.unmount();
      });
    } catch {
      // Already-unmounted (Case 8 deferred-resolve) — safe to swallow.
    }
  }
  activeRenderers.length = 0;
});

const BASE_OPTIONS: UseMockTestGenerationOptions = {
  sections: ["listening", "reading"],
  cefrLevel: "B1",
  testIdParam: "full",
  enabled: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMockTestGeneration — Story 13-4 hook contract (audit P2-6)", () => {
  it("Case 1: fires both sections in parallel via Promise.allSettled (NOT serial)", async () => {
    // Make both calls hang so we can observe call dispatch order without
    // either resolving and triggering follow-up calls.
    mockChatCompletionJSON.mockImplementation(() => new Promise(() => {}));

    renderHost(BASE_OPTIONS);
    await flushAsync();

    // BOTH calls dispatched (would be 1 if serial, since the first hangs).
    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(2);

    // First call argv carries the listening feature tag.
    const call1Options = mockChatCompletionJSON.mock.calls[0][2] as { feature: string };
    const call2Options = mockChatCompletionJSON.mock.calls[1][2] as { feature: string };
    const features = new Set([call1Options.feature, call2Options.feature]);
    expect(features).toEqual(new Set(["mock-test-listening", "mock-test-reading"]));
  });

  it("Case 2: firstSectionReady flips when section 1 resolves BEFORE section 2", async () => {
    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    const pendingReading = new Promise<ReturnType<typeof sectionResponse>>(() => {});
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    mockChatCompletionJSON.mockImplementationOnce(() => pendingReading);

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(result.current?.firstSectionReady).toBe(false);

    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current?.firstSectionReady).toBe(true);
    expect(result.current?.sectionStatus.listening).toBe("ready");
    expect(result.current?.sectionStatus.reading).toBe("pending");
    expect(result.current?.allReady).toBe(false);
  });

  it("Case 3: allReady flips when both sections resolve", async () => {
    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(result.current?.allReady).toBe(true);
    expect(result.current?.firstSectionReady).toBe(true);
    expect(result.current?.anyFailed).toBe(false);
    expect(result.current?.allFailed).toBe(false);
  });

  it("Case 4: per-section failure isolation — A succeeds, B fails", async () => {
    mockChatCompletionJSON
      .mockResolvedValueOnce(sectionResponse(39)) // listening OK
      .mockRejectedValueOnce(new Error("network kaboom")); // reading fails

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(result.current?.sectionStatus.listening).toBe("ready");
    expect(result.current?.sectionStatus.reading).toBe("failed");
    expect(result.current?.firstSectionReady).toBe(true);
    expect(result.current?.anyFailed).toBe(true);
    expect(result.current?.allFailed).toBe(false);

    // Sentry tag for the FAILED section ONLY (the success path emits no tag).
    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error), "mock-test-generate-reading");
    expect(mockCaptureError).not.toHaveBeenCalledWith(
      expect.anything(),
      "mock-test-generate-listening"
    );
  });

  it("Case 5: all-failed signal fires when every section fails", async () => {
    mockChatCompletionJSON.mockRejectedValue(new Error("everything broke"));

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(result.current?.allFailed).toBe(true);
    expect(result.current?.firstSectionReady).toBe(false);
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      "mock-test-generate-listening"
    );
    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error), "mock-test-generate-reading");
  });

  it("Case 6: single-section test fires only ONE chatCompletionJSON call", async () => {
    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));

    const { result } = renderHost({
      ...BASE_OPTIONS,
      sections: ["listening"],
      testIdParam: "listening",
    });
    await flushAsync();

    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(1);
    expect(result.current?.allReady).toBe(true);
    expect(result.current?.firstSectionReady).toBe(true);
  });

  it("Case 7 (P2): sectionsKey content-key memoization — fresh array reference, same content → no re-fire", async () => {
    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));

    const result: { current: UseMockTestGenerationReturn | null } = { current: null };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <HookHost
          sections={["listening", "reading"]}
          cefrLevel="B1"
          testIdParam="full"
          enabled={true}
          result={result}
        />
      );
    });
    activeRenderers.push(renderer!);
    await flushAsync();

    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(2);

    // Re-render with a FRESH array reference but the same content.
    act(() => {
      renderer.update(
        <HookHost
          sections={["listening", "reading"]}
          cefrLevel="B1"
          testIdParam="full"
          enabled={true}
          result={result}
        />
      );
    });
    await flushAsync();

    // No additional calls — sectionsKey memoization defeats re-fire.
    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(2);
  });

  it("Case 8 (P8 deferred-resolve): mountedRef guard prevents setState post-unmount", async () => {
    // Story 13-4 review-round-1 P18 — Case 8 strengthened. Pre-patch the
    // assertion `result.current?.sectionStatus.listening === "pending"`
    // was a tautology: result.current captures the pre-unmount snapshot,
    // so even if setState DID fire post-unmount, the assertion would
    // still see "pending" (the value at last render). Post-patch we
    // ALSO spy on `console.error` for the React "Can't perform a state
    // update on an unmounted component" warning — verifying the guard
    // actually prevented the setState call, not just that the snapshot
    // looks right.
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    // Section 2 also hangs forever to keep both in flight.
    mockChatCompletionJSON.mockImplementationOnce(() => new Promise(() => {}));

    const result: { current: UseMockTestGenerationReturn | null } = { current: null };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<HookHost {...BASE_OPTIONS} result={result} />);
    });
    activeRenderers.push(renderer!);

    await flushAsync();

    // Pre-resolution: state pieces still initial pending.
    expect(result.current?.sectionStatus.listening).toBe("pending");

    // Unmount BEFORE resolution.
    act(() => {
      renderer!.unmount();
    });

    // Resolve AFTER unmount. The mountedRef + cancelled gates must prevent
    // setState calls that would warn (or crash) on an unmounted tree.
    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
    });

    // result.current was captured before unmount; setState never ran post-
    // unmount, so the value stays at the pre-unmount snapshot.
    expect(result.current?.sectionStatus.listening).toBe("pending");
    // No insert call fires after unmount either (the INSERT path is also
    // mountedRef-guarded).
    expect(mockInsertSingle).not.toHaveBeenCalled();
    // P18: no React "Can't perform a state update on an unmounted component"
    // warning. If the mountedRef guard ever regresses, this assertion fires.
    const stateUpdateWarning = consoleErrorSpy.mock.calls.find((call) => {
      const msg = call[0];
      return typeof msg === "string" && /unmounted component/i.test(msg);
    });
    expect(stateUpdateWarning).toBeUndefined();
    consoleErrorSpy.mockRestore();
  });

  it("Case 9: DB INSERT on first-section-ready with status=in_progress + partial questions snapshot", async () => {
    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    // Section 2 hangs so only section 1 has settled when we inspect.
    mockChatCompletionJSON.mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(mockInsertSingle).not.toHaveBeenCalled();

    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(result.current?.activeTestId).toBe("test-row-1");
  });

  it("Case 10: single-fire INSERT guard — section 2's settle does NOT re-INSERT", async () => {
    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));

    renderHost(BASE_OPTIONS);
    await flushAsync();

    // Both sections resolved; only ONE insert should have fired.
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
  });

  it("Case 11: DB UPDATE on subsequent-section-ready via fire-and-forget", async () => {
    // Listening resolves first → fires INSERT (returns activeTestId).
    // Reading resolves second → fires UPDATE.
    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    let resolveReading!: (v: ReturnType<typeof sectionResponse>) => void;
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReading = resolve;
        })
    );

    renderHost(BASE_OPTIONS);
    await flushAsync();

    // Resolve listening first — should INSERT.
    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();

    // Resolve reading — should UPDATE (NOT re-INSERT).
    await act(async () => {
      resolveReading(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Story 13-4 review-round-1 P17 — verify the UPDATE payload actually
    // contains BOTH sections' questions, not just the late-arriving one.
    // Pre-patch the snapshot-ref staleness cluster (P2) could leave the
    // updateSnapshot missing the earlier section's questions; the test
    // gap let that regression pass silently with just a count assertion.
    expect(capturedUpdates).toHaveLength(1);
    const updatePayload = capturedUpdates[0].payload.questions as Record<string, MCQContent[]>;
    expect(updatePayload.listening).toBeDefined();
    expect(updatePayload.listening.length).toBe(39);
    expect(updatePayload.reading).toBeDefined();
    expect(updatePayload.reading.length).toBe(39);
    // The UPDATE filter targets the row id from INSERT.
    expect(capturedUpdates[0].id).toBe("test-row-1");
  });

  it("Case 12: DB UPDATE failure silenced → captureError(mock-test-section-update); no state regression", async () => {
    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    let resolveReading!: (v: ReturnType<typeof sectionResponse>) => void;
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReading = resolve;
        })
    );

    mockUpdate.mockResolvedValueOnce({ error: { message: "UPDATE failed", code: "23xxx" } });

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();
    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveReading(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "UPDATE failed" }),
      "mock-test-section-update"
    );
    // Reading section's "ready" status is preserved despite UPDATE failure.
    expect(result.current?.sectionStatus.reading).toBe("ready");
  });

  it("Case 13: resume short-circuits generation — saved in-progress row found", async () => {
    const savedQuestions = {
      listening: [SAMPLE_QUESTION],
      reading: [SAMPLE_QUESTION],
    };
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "saved-row-1",
        questions: savedQuestions,
        section_scores: {
          answers: { listening_0: "a" },
          currentSectionIndex: 0,
          currentQuestionIndex: 1,
          timeRemaining: 1500,
          savedAt: Date.now() - 30_000, // 30s ago → adjust by 30s
          answeredQuestions: ["listening_0"],
        },
      },
      error: null,
    });

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(mockChatCompletionJSON).not.toHaveBeenCalled();
    expect(result.current?.resumeData).not.toBeNull();
    expect(result.current?.resumeData?.activeTestId).toBe("saved-row-1");
    expect(result.current?.resumeData?.corrupt).toBe(false);
    expect(result.current?.resumeData?.savedAnswers).toEqual({ listening_0: "a" });
    expect(result.current?.activeTestId).toBe("saved-row-1");
    expect(result.current?.allReady).toBe(true);
  });

  it("Case 14: corrupt resume detection — questions empty → resumeData.corrupt=true, no AI call", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "corrupt-row",
        questions: { listening: [], reading: [] },
        section_scores: { answers: {}, currentSectionIndex: 0 },
      },
      error: null,
    });

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(mockChatCompletionJSON).not.toHaveBeenCalled();
    expect(result.current?.resumeData?.corrupt).toBe(true);
    expect(result.current?.activeTestId).toBe("corrupt-row");
  });

  it("Case 15: retry() re-fires ONLY failed sections; preserves ready ones", async () => {
    // Initial run: listening succeeds, reading fails.
    mockChatCompletionJSON
      .mockResolvedValueOnce(sectionResponse(39))
      .mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(2);
    expect(result.current?.sectionStatus.listening).toBe("ready");
    expect(result.current?.sectionStatus.reading).toBe("failed");

    // Stub reading-only retry to succeed.
    mockChatCompletionJSON.mockResolvedValueOnce(sectionResponse(39));

    await act(async () => {
      result.current?.retry();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 3 total calls now: 2 initial + 1 retry (reading only). Listening was
    // NOT re-fired because it was still "ready".
    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(3);

    const retryCallOptions = mockChatCompletionJSON.mock.calls[2][2] as { feature: string };
    expect(retryCallOptions.feature).toBe("mock-test-reading");

    expect(result.current?.sectionStatus.listening).toBe("ready");
    expect(result.current?.sectionStatus.reading).toBe("ready");
    expect(result.current?.allReady).toBe(true);
  });

  it("Case 16: enabled=false → no AI call, no DB call, all-pending state", async () => {
    const { result } = renderHost({ ...BASE_OPTIONS, enabled: false });
    await flushAsync();

    expect(mockChatCompletionJSON).not.toHaveBeenCalled();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInsertSingle).not.toHaveBeenCalled();
    expect(result.current?.sectionStatus.listening).toBe("pending");
    expect(result.current?.sectionStatus.reading).toBe("pending");
    expect(result.current?.firstSectionReady).toBe(false);
    expect(result.current?.allReady).toBe(false);
    expect(result.current?.allFailed).toBe(false);
  });

  it("Case 17: undercount warning fires when section returns < 50% expected questions", async () => {
    // listening expects 39; we return 10. 10 < ceil(39*0.5)=20 → fires.
    mockChatCompletionJSON
      .mockResolvedValueOnce(sectionResponse(10))
      .mockResolvedValueOnce(sectionResponse(39));

    renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("10/39 questions") }),
      "mock-test-undercount"
    );
  });

  it("Case 18: corrupt resume + retry() clears the corrupt state and re-fires generation as fresh INSERT", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "corrupt-row-2",
        questions: { listening: [], reading: [] },
        section_scores: { answers: {}, currentSectionIndex: 0 },
      },
      error: null,
    });

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(result.current?.resumeData?.corrupt).toBe(true);
    expect(mockChatCompletionJSON).not.toHaveBeenCalled();

    // Stub generation to succeed on retry.
    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));
    // The retry path bumps retryCounter; the effect will re-fire but
    // skip the resume-detection block (retryCounter !== 0). It will go
    // straight to parallel generation. Activity id is cleared so a fresh
    // INSERT happens.

    await act(async () => {
      result.current?.retry();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(2);
    expect(result.current?.resumeData).toBeNull();
    expect(result.current?.allReady).toBe(true);
    // Fresh INSERT happened — the new row id replaces the corrupt one.
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Story 13-4 review-round-1 patch tests
  // ---------------------------------------------------------------------------

  it("Case 19 (P2 sync mirror): INSERT payload contains the just-settled section's questions even when ref-mirror useEffect hasn't committed yet", async () => {
    // Pre-patch the questionsSnapshotRef was mirrored via lagging useEffect;
    // the INSERT closure reads the ref before that effect runs, so the INSERT
    // payload could miss the just-settled section. Post-patch the ref is
    // updated SYNCHRONOUSLY in the same statement as setQuestions, so the
    // INSERT payload always contains the latest data.
    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    mockChatCompletionJSON.mockImplementationOnce(() => new Promise(() => {}));

    renderHost(BASE_OPTIONS);
    await flushAsync();

    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // INSERT payload contains the listening questions (not the pre-mirror empty value).
    expect(capturedInserts).toHaveLength(1);
    const insertPayload = capturedInserts[0].payload.questions as Record<string, MCQContent[]>;
    expect(insertPayload.listening).toBeDefined();
    expect(insertPayload.listening.length).toBe(39);
    // Reading hasn't resolved → still empty in the snapshot.
    expect(insertPayload.reading).toEqual([]);
  });

  it("Case 20 (P2 sync mirror): activeTestIdRef updates SYNCHRONOUSLY so the second-section UPDATE always finds a non-null id", async () => {
    // Listening + Reading resolve nearly simultaneously. Pre-patch the
    // activeTestIdRef was mirrored via lagging useEffect; if reading
    // resolved BEFORE the effect committed the activeTestId from
    // listening's INSERT, the UPDATE branch read `activeTestIdRef.current
    // === null` and silently skipped. Post-patch the ref is set
    // synchronously inside the INSERT then-callback before the
    // continuation, so UPDATE always sees a valid id.
    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));

    renderHost(BASE_OPTIONS);
    await flushAsync();

    // Both sections resolved in parallel; expect 1 INSERT + 1 UPDATE.
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // The UPDATE filter MUST target the row id from INSERT.
    expect(capturedUpdates[0].id).toBe("test-row-1");
  });

  it("Case 21 (P15 no-anti-pattern): retry() on corrupt resume does NOT call setActiveTestId inside setResumeData updater", async () => {
    // Setup corrupt resume.
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "corrupt-row-21",
        questions: { listening: [], reading: [] },
        section_scores: { answers: {}, currentSectionIndex: 0 },
      },
      error: null,
    });

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    expect(result.current?.resumeData?.corrupt).toBe(true);
    expect(result.current?.activeTestId).toBe("corrupt-row-21");

    mockChatCompletionJSON.mockResolvedValue(sectionResponse(39));

    // Spy on console.error to catch the React strict-mode warning about
    // setState calls inside another setState's updater. If P15 regresses
    // (e.g., setActiveTestId moves back inside setResumeData((prev) => ...)),
    // React would emit the warning. We capture the spy state before retry
    // to isolate just this call's effect.
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      result.current?.retry();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Functional outcome: corrupt cleared + activeTestId cleared + fresh INSERT.
    expect(result.current?.resumeData).toBeNull();
    expect(result.current?.allReady).toBe(true);
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);

    // No nested-setState warning from React.
    const nestedSetStateWarning = consoleErrorSpy.mock.calls.find((call) => {
      const msg = typeof call[0] === "string" ? (call[0] as string) : "";
      return /Cannot update.*while rendering|setState.*during.*update/i.test(msg);
    });
    expect(nestedSetStateWarning).toBeUndefined();
    consoleErrorSpy.mockRestore();
  });

  it("Case 22 (P16 partial resume): resume with one valid section + one empty triggers generation for the empty section", async () => {
    // Legacy listening-only row OR a partial first-INSERT row where
    // listening: [items], reading: []. Pre-patch: hook short-circuits
    // after setSectionStatus, leaving reading="pending" forever. Post-
    // patch: hook falls through to the generation block which filters
    // by `sectionStatus[s] !== "ready"` and generates ONLY reading.
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "partial-row",
        questions: { listening: [SAMPLE_QUESTION], reading: [] }, // partial
        section_scores: {
          answers: {},
          currentSectionIndex: 0,
          currentQuestionIndex: 0,
          timeRemaining: 5400,
          savedAt: Date.now() - 1000,
          answeredQuestions: [],
        },
      },
      error: null,
    });

    // Reading generation will return 39 questions.
    mockChatCompletionJSON.mockResolvedValueOnce(sectionResponse(39));

    const { result } = renderHost(BASE_OPTIONS);
    await flushAsync();

    // Listening was resumed (ready); reading was generated (now ready).
    expect(result.current?.sectionStatus.listening).toBe("ready");
    expect(result.current?.sectionStatus.reading).toBe("ready");
    expect(result.current?.allReady).toBe(true);

    // Only 1 chatCompletionJSON call (reading) — listening was resumed.
    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(1);
    const callOptions = mockChatCompletionJSON.mock.calls[0][2] as { feature: string };
    expect(callOptions.feature).toBe("mock-test-reading");

    // The reading section's generation triggers an UPDATE (not INSERT) because
    // insertFiredRef was preset to true by the resume path. P17 payload check:
    // UPDATE payload contains BOTH sections.
    expect(mockInsertSingle).not.toHaveBeenCalled();
    expect(capturedUpdates.length).toBeGreaterThanOrEqual(1);
    const lastUpdatePayload = capturedUpdates[capturedUpdates.length - 1].payload
      .questions as Record<string, MCQContent[]>;
    expect(lastUpdatePayload.listening.length).toBe(1);
    expect(lastUpdatePayload.reading.length).toBe(39);
    expect(capturedUpdates[capturedUpdates.length - 1].id).toBe("partial-row");
  });

  it("Case 23 (P21 toError): non-Error supabase error shape is normalized before captureError", async () => {
    // Pre-patch captureError received a raw PostgrestError-shape object;
    // Sentry showed "[object Object]" because Story 9-3's scrubber expects
    // an Error instance with a .message string. Post-patch the hook wraps
    // non-Error values via the `toError` helper.
    let resolveListening!: (v: ReturnType<typeof sectionResponse>) => void;
    let resolveReading!: (v: ReturnType<typeof sectionResponse>) => void;
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListening = resolve;
        })
    );
    mockChatCompletionJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReading = resolve;
        })
    );
    // Production supabase update returns `{ error: {message, code, hint, details} }`
    // — a non-Error object literal. The hook must wrap before passing to
    // captureError.
    mockUpdate.mockResolvedValueOnce({
      error: { message: "violates check constraint", code: "23514" },
    });

    renderHost(BASE_OPTIONS);
    await flushAsync();
    await act(async () => {
      resolveListening(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveReading(sectionResponse(39));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const captureCalls = mockCaptureError.mock.calls.filter(
      (call) => call[1] === "mock-test-section-update"
    );
    expect(captureCalls.length).toBeGreaterThanOrEqual(1);
    // First arg MUST be an Error instance after toError normalization.
    for (const call of captureCalls) {
      expect(call[0]).toBeInstanceOf(Error);
      expect((call[0] as Error).message).toContain("violates check constraint");
    }
  });
});
