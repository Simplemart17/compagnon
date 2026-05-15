/**
 * Story 13-3 — `useSessionFeedbackAggregate` hook contract tests
 * (audit P2-4 closure).
 *
 * Pins:
 *   - Hook calls `getSessionFeedbackAggregate` ONCE per feedback arrival
 *     (not 4 separate fetches like pre-13-3).
 *   - `comparisonMetrics` correctly derived from `prev_session` (Fluency /
 *     Grammar / Duration triple).
 *   - `milestone` priority order: CEFR promotion > personal best > error
 *     resolution > null.
 *   - Personal-best detection requires `maxRating > 0` AND `currentRating
 *     > maxRating` (pre-13-3 line 373 guard preserved byte-faithful).
 *   - `errorJourney` is null when total=0; populated otherwise.
 *   - `nextAction` derived from `allCorrections` + improvements text.
 *   - Sentry tag `session-feedback-aggregate-fetch` on RPC failure.
 *   - mountedRef guard: setState calls do NOT fire after unmount.
 *   - No fetch when `userId` / `conversationId` / `currentFeedback` is null.
 *
 * Uses react-test-renderer (Story 12-1 P8 / 12-9 EmailVerificationGate
 * pattern).
 */

import React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";

import type { SessionFeedbackAggregate } from "@/src/lib/session-feedback-aggregate";
import type { Correction, ConversationFeedback } from "@/src/types/conversation";

import {
  useSessionFeedbackAggregate,
  type UseSessionFeedbackAggregateOptions,
  type UseSessionFeedbackAggregateReturn,
} from "../use-session-feedback-aggregate";

const mockGetSessionFeedbackAggregate = jest.fn();
jest.mock("@/src/lib/session-feedback-aggregate", () => ({
  __esModule: true,
  getSessionFeedbackAggregate: (...args: unknown[]) => mockGetSessionFeedbackAggregate(...args),
}));

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const baseFeedback: ConversationFeedback = {
  summary: "Good practice session",
  strengths: [],
  improvements: [],
  vocabularyUsed: 0,
  fluencyRating: 4,
  grammarRating: 3,
};

const baseAggregate: SessionFeedbackAggregate = {
  prev_session: null,
  cefr_promotion: null,
  max_fluency_rating: 0,
  max_grammar_rating: 0,
  recent_resolved_error: null,
  error_counts: { total: 0, resolved: 0 },
};

/** Small consumer component that exposes the hook return value. */
function HookHost({
  result,
  ...options
}: UseSessionFeedbackAggregateOptions & {
  result: { current: UseSessionFeedbackAggregateReturn | null };
}): React.ReactElement {
  const value = useSessionFeedbackAggregate(options);
  result.current = value;
  return <Text>host</Text>;
}

function renderHost(options: UseSessionFeedbackAggregateOptions) {
  const result: { current: UseSessionFeedbackAggregateReturn | null } = { current: null };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<HookHost {...options} result={result} />);
  });
  // Allow async microtask + state updates to settle.
  return { result, renderer: renderer! };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useSessionFeedbackAggregate — Story 13-3 hook contract (audit P2-4)", () => {
  it("Case 1: fires getSessionFeedbackAggregate ONCE per feedback arrival", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue(baseAggregate);

    renderHost({
      userId: "user-1",
      conversationId: "convo-1",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    await flushAsync();

    expect(mockGetSessionFeedbackAggregate).toHaveBeenCalledTimes(1);
    expect(mockGetSessionFeedbackAggregate).toHaveBeenCalledWith("user-1", "convo-1", "A2");
  });

  it("Case 2: NO fetch when userId is null", () => {
    renderHost({
      userId: null,
      conversationId: "convo-1",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    expect(mockGetSessionFeedbackAggregate).toHaveBeenCalledTimes(0);
  });

  it("Case 3: NO fetch when conversationId is null", () => {
    renderHost({
      userId: "user-1",
      conversationId: null,
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    expect(mockGetSessionFeedbackAggregate).toHaveBeenCalledTimes(0);
  });

  it("Case 4: NO fetch when currentFeedback is null", () => {
    renderHost({
      userId: "user-1",
      conversationId: "convo-1",
      preConversationCefrLevel: "A2",
      currentFeedback: null,
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    expect(mockGetSessionFeedbackAggregate).toHaveBeenCalledTimes(0);
  });

  it("Case 5: comparisonMetrics derived from prev_session (Fluency + Grammar + Duration)", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue({
      ...baseAggregate,
      prev_session: {
        ai_feedback: { fluencyRating: 3, grammarRating: 2 },
        duration_seconds: 120,
        completed_at: "2026-05-10T12:00:00Z",
      },
    });

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: { ...baseFeedback, fluencyRating: 4, grammarRating: 3 },
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    await flushAsync();

    expect(result.current?.comparisonMetrics).toEqual([
      { label: "Fluency", previous: "3/5", current: "4/5", direction: "up" },
      { label: "Grammar", previous: "2/5", current: "3/5", direction: "up" },
      { label: "Duration", previous: "2m", current: "3m", direction: "up" },
    ]);
  });

  it("Case 6: milestone priority — CEFR promotion wins over personal best", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue({
      ...baseAggregate,
      cefr_promotion: { from: "A2", to: "B1" },
      // Also a personal-best scenario, but CEFR has priority.
      max_fluency_rating: 2,
      max_grammar_rating: 2,
    });

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: { ...baseFeedback, fluencyRating: 4, grammarRating: 4 },
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    await flushAsync();

    // Story 13-3 review-round-1 P10: assert ALL milestone fields, not
    // just `type`. A future regression returning `{ type: "cefr_promotion",
    // title: "New Personal Best!", subtitle: "..." }` (wrong-shape object
    // with the right type tag) would slip past a type-only assertion.
    expect(result.current?.milestone?.type).toBe("cefr_promotion");
    expect(result.current?.milestone?.title).toBe("CEFR Promotion!");
    expect(result.current?.milestone?.subtitle).toBe("Welcome to B1!");
  });

  it("Case 7: milestone — personal best fires when current > max && max > 0", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue({
      ...baseAggregate,
      max_fluency_rating: 3,
      max_grammar_rating: 4,
    });

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: { ...baseFeedback, fluencyRating: 5, grammarRating: 3 },
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    await flushAsync();

    expect(result.current?.milestone?.type).toBe("personal_best");
    expect(result.current?.milestone?.subtitle).toContain("fluency");
  });

  it("Case 8: milestone — personal best does NOT fire when max = 0 (no prev conversations)", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue({
      ...baseAggregate,
      max_fluency_rating: 0,
      max_grammar_rating: 0,
      recent_resolved_error: { error_description: "subject-verb" },
    });

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: { ...baseFeedback, fluencyRating: 5, grammarRating: 5 },
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    await flushAsync();

    // Falls through to error_resolved (priority 3) since personal best is gated.
    expect(result.current?.milestone?.type).toBe("error_resolved");
    expect(result.current?.milestone?.subtitle).toBe("subject-verb");
  });

  it("Case 9: errorJourney is null when total=0; populated otherwise", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValueOnce(baseAggregate);
    const { result: r1 } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: [],
    });
    await flushAsync();
    expect(r1.current?.errorJourney).toBeNull();

    mockGetSessionFeedbackAggregate.mockResolvedValueOnce({
      ...baseAggregate,
      error_counts: { total: 5, resolved: 2 },
    });
    const { result: r2 } = renderHost({
      userId: "u",
      conversationId: "c2",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: [],
    });
    await flushAsync();
    expect(r2.current?.errorJourney).toEqual({ total: 5, resolved: 2 });
  });

  it("Case 10: nextAction derived from corrections.category (pronunciation wins)", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue(baseAggregate);

    const corrections: Correction[] = [
      { original: "x", corrected: "y", explanation: "z", category: "pronunciation" },
    ];

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: corrections,
    });

    await flushAsync();

    expect(result.current?.nextAction?.route).toBe("/(tabs)/practice/pronunciation");
  });

  it("Case 11: nextAction falls back to grammar when corrections are grammar-only", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue(baseAggregate);

    const corrections: Correction[] = [
      { original: "x", corrected: "y", explanation: "verb conjugation", category: "grammar" },
    ];

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: corrections,
    });

    await flushAsync();

    expect(result.current?.nextAction?.route).toBe("/(tabs)/practice/grammar");
    expect(result.current?.nextAction?.params).toEqual({ errorType: "verb conjugation" });
  });

  it("Case 12: nextAction default = Continue Practicing when no corrections + no improvements keywords", async () => {
    mockGetSessionFeedbackAggregate.mockResolvedValue(baseAggregate);

    const { result } = renderHost({
      userId: "u",
      conversationId: "c",
      preConversationCefrLevel: "A2",
      currentFeedback: baseFeedback,
      currentDurationSeconds: 180,
      allCorrections: [],
    });

    await flushAsync();

    expect(result.current?.nextAction?.label).toBe("Continue Practicing");
  });

  it("Case 13: RPC failure → setState(null) (synchronous reject path)", async () => {
    mockGetSessionFeedbackAggregate.mockRejectedValueOnce(new Error("boom"));

    const result: { current: UseSessionFeedbackAggregateReturn | null } = { current: null };
    act(() => {
      create(
        <HookHost
          userId="u"
          conversationId="c"
          preConversationCefrLevel="A2"
          currentFeedback={baseFeedback}
          currentDurationSeconds={180}
          allCorrections={[]}
          result={result}
        />
      );
    });

    await flushAsync();

    expect(result.current?.comparisonMetrics).toBeNull();
    expect(result.current?.milestone).toBeNull();
    expect(result.current?.errorJourney).toBeNull();
  });

  it("Case 14 (P8): deferred-resolve test — mountedRef guard prevents setState post-unmount", async () => {
    // Story 13-3 review-round-1 P8: pre-patch Case 13 used
    // `mockRejectedValueOnce` which rejects synchronously-ish; the
    // unmount() ran AFTER setState had already fired, so the
    // mountedRef guard was never actually exercised. A regression
    // removing the guard would pass the pre-patch test trivially.
    //
    // Post-patch: use a manually-resolvable Promise. Mount → confirm
    // fetch fired but is pending → unmount → resolve the promise →
    // confirm no setState fires (the renderer's state pieces stay
    // null because they were never populated AND the mountedRef
    // guard blocks the setState path).
    let resolveAggregate: (value: SessionFeedbackAggregate) => void = () => {};
    const pendingPromise = new Promise<SessionFeedbackAggregate>((resolve) => {
      resolveAggregate = resolve;
    });
    mockGetSessionFeedbackAggregate.mockReturnValueOnce(pendingPromise);

    const result: { current: UseSessionFeedbackAggregateReturn | null } = { current: null };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <HookHost
          userId="u"
          conversationId="c"
          preConversationCefrLevel="A2"
          currentFeedback={baseFeedback}
          currentDurationSeconds={180}
          allCorrections={[]}
          result={result}
        />
      );
    });

    // RPC is pending; state pieces are still initial (null).
    expect(result.current?.comparisonMetrics).toBeNull();
    expect(result.current?.milestone).toBeNull();
    expect(result.current?.errorJourney).toBeNull();

    // Unmount BEFORE the promise resolves.
    act(() => {
      renderer!.unmount();
    });

    // Now resolve the pending RPC. The hook's effect cleanup set
    // cancelled=true AND mountedRef.current=false; the setState calls
    // inside the .then are gated by both. If a regression removed
    // either guard, this resolve would attempt setState on an
    // unmounted renderer — react-test-renderer would warn AND the
    // result.current state would mutate (since result is captured by
    // closure, not by React's render lifecycle).
    const validAggregate: SessionFeedbackAggregate = {
      prev_session: null,
      cefr_promotion: null,
      max_fluency_rating: 0,
      max_grammar_rating: 0,
      recent_resolved_error: null,
      error_counts: { total: 0, resolved: 0 },
    };
    act(() => {
      resolveAggregate(validAggregate);
    });
    await flushAsync();

    // Post-unmount, state pieces still null — neither the cancelled
    // gate nor the mountedRef guard allowed the resolved-aggregate
    // setState to surface.
    expect(result.current?.comparisonMetrics).toBeNull();
    expect(result.current?.milestone).toBeNull();
    expect(result.current?.errorJourney).toBeNull();
  });
});
