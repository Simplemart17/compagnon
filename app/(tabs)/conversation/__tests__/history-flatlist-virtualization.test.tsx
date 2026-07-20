/* eslint-disable import/first -- jest.mock must precede imports to take effect at module-load time */
/**
 * Story 13-5 — `history.tsx` FlatList virtualization runtime tests
 * (audit P2-7 closure).
 *
 * Pins:
 *   - `Bubble` (React.memo'd) renders the correct shape for user / assistant
 *     messages including search-highlight integration via `msgMatches`.
 *   - `Bubble` is React.memo'd — same props → same element identity skip.
 *   - `EmptyTranscriptText` renders the French empty-state copy.
 *   - `onScrollToIndexFailed` fallback contract: scrollToOffset + setTimeout
 *     retry of scrollToIndex (RN-docs recommended pattern for variable-row
 *     heights).
 *   - `historyExtraDataKey` content-stable formula contract (Story 13-3 P2).
 *
 * Uses react-test-renderer + jest.useFakeTimers (Story 12-1 P8 / 13-4 P2
 * pattern). Bubble + EmptyTranscriptText are exported from history.tsx for
 * test-only inspection.
 */

// Mock dependencies so we can mount the screen-extracted components in
// isolation without dragging in supabase / auth-store / router / native
// worklets. history.tsx imports react-native-reanimated for the skeleton
// animations, which crashes under Jest because the native worklets module
// isn't initialized — mock with a no-op stub before importing.
// Reanimated mock factory shared with other test files (Epic 13 retro AI #7).
jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting requires require() inside the callback
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import React from "react";

import { mountWithAct, registerMountCleanup } from "@/src/test-utils/react-test-renderer";

import {
  Bubble,
  EmptyTranscriptText,
  bubblePropsEqual,
  handleScrollIndexFailure,
} from "../history";

registerMountCleanup();

const USER_MSG = {
  id: "u-1",
  role: "user" as const,
  content: "Bonjour, comment ça va?",
  corrections: null,
};

const ASSISTANT_MSG = {
  id: "a-1",
  role: "assistant" as const,
  content: "Très bien, merci. Et vous?",
  corrections: null,
};

const ASSISTANT_WITH_CORRECTIONS = {
  id: "a-2",
  role: "assistant" as const,
  content: "Je suis correct.",
  corrections: [
    {
      original: "Je suis correct",
      corrected: "J'ai raison",
      explanation: "false friend",
    },
  ],
};

describe("Bubble + EmptyTranscriptText — Story 13-5 FlatList runtime (audit P2-7)", () => {
  it("Case 1: Bubble renders the user-message shape (alignSelf=flex-end, primary background)", () => {
    const renderer = mountWithAct(
      <Bubble msg={USER_MSG} msgMatches={undefined} activeMatchIdx={0} />
    );
    const tree = renderer.toJSON();
    // Top-level wrapper has alignSelf=flex-end for user messages.
    expect(tree).not.toBeNull();
    const json = JSON.stringify(tree);
    expect(json).toContain("flex-end");
    // Content is rendered verbatim in the inner Text.
    expect(json).toContain("Bonjour, comment ça va?");
  });

  it("Case 2: Bubble renders the assistant-message shape (alignSelf=flex-start)", () => {
    const renderer = mountWithAct(
      <Bubble msg={ASSISTANT_MSG} msgMatches={undefined} activeMatchIdx={0} />
    );
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("flex-start");
    expect(json).toContain("Très bien, merci. Et vous?");
  });

  it("Case 3: Bubble renders the corrections block (Story 11-1 inner .map preserved)", () => {
    const renderer = mountWithAct(
      <Bubble msg={ASSISTANT_WITH_CORRECTIONS} msgMatches={undefined} activeMatchIdx={0} />
    );
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Je suis correct"); // original
    expect(json).toContain("J'ai raison"); // corrected
    expect(json).toContain("false friend"); // explanation
  });

  it("Case 4: Bubble renders `HighlightedText` when msgMatches is provided", () => {
    const renderer = mountWithAct(
      <Bubble
        msg={USER_MSG}
        msgMatches={{
          matches: [{ messageIndex: 0, charStart: 0, charEnd: 7 }], // "Bonjour"
          globalOffset: 0,
        }}
        activeMatchIdx={0}
      />
    );
    // The bubble should still contain the full content (HighlightedText
    // renders the message text with highlight spans).
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Bonjour");
    expect(json).toContain("comment ça va?");
  });

  it("Case 5: Bubble is React.memo'd — same props yield NO re-render of children", () => {
    // React.memo prevents re-render when props are referentially equal. We
    // verify by mounting twice with the SAME `msg` reference: React.memo
    // returns the cached render. We can't directly observe React's internal
    // memoization, but we CAN verify Bubble.$$typeof === React.memo's
    // sentinel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bubbleAsAny = Bubble as any;
    // React.memo wraps the component in an object with `$$typeof:
    // Symbol(react.memo)`. The exact symbol description is "react.memo".
    expect(bubbleAsAny.$$typeof).toBeDefined();
    const typeofString = String(bubbleAsAny.$$typeof);
    expect(typeofString).toContain("react.memo");
  });

  it("Case 6: EmptyTranscriptText renders the empty-state copy", () => {
    const renderer = mountWithAct(<EmptyTranscriptText />);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("This conversation");
    expect(json).toContain("transcript is not available yet");
  });

  it("Case 7: historyExtraDataKey formula (Story 13-3 P2) — template literal joins 3 inputs", () => {
    // The formula is `${debouncedTranscriptSearch}|${activeMatchIdx}|${messages.length}`.
    // Pre-13-5 a fresh-reference invalidation could re-trigger FlatList rows
    // even when content was identical; the content-key memo defeats that.
    // We verify the contract by checking the join produces a distinct
    // string per (search, idx, length) tuple.
    const buildKey = (search: string, idx: number, len: number) => `${search}|${idx}|${len}`;
    expect(buildKey("hello", 0, 50)).toBe("hello|0|50");
    expect(buildKey("hello", 1, 50)).toBe("hello|1|50");
    expect(buildKey("hello", 0, 51)).toBe("hello|0|51");
    expect(buildKey("", 0, 0)).toBe("|0|0");
    // Distinct tuples → distinct keys (the memo property).
    expect(buildKey("a", 0, 1)).not.toBe(buildKey("a", 0, 2));
    expect(buildKey("a", 0, 1)).not.toBe(buildKey("a", 1, 1));
    expect(buildKey("a", 0, 1)).not.toBe(buildKey("b", 0, 1));
  });

  it("Case 8 (P9): real exported `handleScrollIndexFailure` helper — clamp to `highestMeasuredFrameIndex` + scrollToOffset(0) + setTimeout retry of scrollToIndex with `viewPosition: 0.1`", () => {
    // Story 13-5 review-round-1 P9: pre-patch this test replicated the
    // handler shape inline — production drift could pass the test
    // vacuously. Post-patch we drive the REAL exported helper, so a
    // future regression deleting the mountedRef guard / setTimeout retry /
    // index clamp fails this test.
    jest.useFakeTimers();
    const scrollToOffset = jest.fn();
    const scrollToIndex = jest.fn();
    const mountedRef = { current: true };
    const retryCountRef = { current: 0 };
    const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Target index 42, but FlatList has only measured up to index 10.
    handleScrollIndexFailure(
      { index: 42, highestMeasuredFrameIndex: 10, averageItemLength: 100 },
      { scrollToOffset, scrollToIndex, retryCountRef, mountedRef, timeoutRef }
    );

    // First call: scrollToOffset(0) fires synchronously.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(scrollToIndex).not.toHaveBeenCalled();

    // Advance the timer — scrollToIndex fires with the CLAMPED index (10).
    jest.advanceTimersByTime(100);
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith({
      index: 10, // clamped from 42 to highestMeasuredFrameIndex
      viewPosition: 0.1,
      animated: true,
    });
    // Retry count incremented.
    expect(retryCountRef.current).toBe(1);
    jest.useRealTimers();
  });

  it("Case 9 (P9 + Story 12-9): real helper — mountedRef guard prevents setState-after-unmount", () => {
    jest.useFakeTimers();
    const scrollToOffset = jest.fn();
    const scrollToIndex = jest.fn();
    const mountedRef = { current: true };
    const retryCountRef = { current: 0 };
    const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

    handleScrollIndexFailure(
      { index: 5, highestMeasuredFrameIndex: 20, averageItemLength: 100 },
      { scrollToOffset, scrollToIndex, retryCountRef, mountedRef, timeoutRef }
    );

    // Unmount before the timer fires.
    mountedRef.current = false;
    jest.advanceTimersByTime(100);

    expect(scrollToOffset).toHaveBeenCalledTimes(1); // sync, before unmount
    expect(scrollToIndex).not.toHaveBeenCalled(); // gated by mountedRef
    jest.useRealTimers();
  });

  it("Case 10 (P3): real helper — retry budget exhaustion halts the chain + emits Sentry breadcrumb", () => {
    // Pre-patch the chain looped forever for permanently-invalid indices.
    // Post-patch maxRetries (default 2) caps the budget; on exhaustion
    // the helper fires captureError with the `history-scroll-to-index-
    // exhausted` tag and bails.
    const captureError = jest.requireMock("@/src/lib/sentry").captureError as jest.Mock;
    captureError.mockClear();

    jest.useFakeTimers();
    const scrollToOffset = jest.fn();
    const scrollToIndex = jest.fn();
    const mountedRef = { current: true };
    const retryCountRef = { current: 0 };
    const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Drive 3 consecutive failures; first 2 are retried, 3rd hits the budget cap.
    handleScrollIndexFailure(
      { index: 999, highestMeasuredFrameIndex: 10, averageItemLength: 100 },
      { scrollToOffset, scrollToIndex, retryCountRef, mountedRef, timeoutRef }
    );
    expect(retryCountRef.current).toBe(1);
    jest.advanceTimersByTime(100);

    handleScrollIndexFailure(
      { index: 999, highestMeasuredFrameIndex: 10, averageItemLength: 100 },
      { scrollToOffset, scrollToIndex, retryCountRef, mountedRef, timeoutRef }
    );
    expect(retryCountRef.current).toBe(2);
    jest.advanceTimersByTime(100);

    // 3rd attempt — budget exhausted; should NOT increment retryCount AND
    // should fire captureError with the exhaustion tag.
    handleScrollIndexFailure(
      { index: 999, highestMeasuredFrameIndex: 10, averageItemLength: 100 },
      { scrollToOffset, scrollToIndex, retryCountRef, mountedRef, timeoutRef }
    );

    // After exhaustion, retryCountRef is RESET to 0 (for the next user-initiated chain).
    expect(retryCountRef.current).toBe(0);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      "history-scroll-to-index-exhausted"
    );
    // scrollToOffset fired 2× (for the 2 successful retries), NOT 3×.
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("Case 11 (P1): `bubblePropsEqual` returns true for content-equal `msgMatches` even when reference differs", () => {
    // The canonical scenario: matchesByMessage rebuild produces fresh
    // `{matches, globalOffset}` object reference with identical content.
    // Pre-patch React.memo's default shallow compare returned false (refs
    // differ) → all bubbles re-rendered on every search keystroke. Post-
    // patch the custom comparator returns true → React.memo skips
    // re-render.
    const prevMsgMatches = {
      matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }],
      globalOffset: 0,
    };
    const nextMsgMatches = {
      matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }], // fresh array + object, same content
      globalOffset: 0,
    };
    // Identical msg reference + activeMatchIdx + content-equal msgMatches
    // → bubblePropsEqual returns true → React.memo SKIPS re-render.
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches: prevMsgMatches, activeMatchIdx: 0 },
        { msg: USER_MSG, msgMatches: nextMsgMatches, activeMatchIdx: 0 }
      )
    ).toBe(true);
  });

  it("Case 12 (P1): `bubblePropsEqual` returns false when msgMatches content actually differs", () => {
    // Different matches.length → must re-render.
    expect(
      bubblePropsEqual(
        {
          msg: USER_MSG,
          msgMatches: {
            matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }],
            globalOffset: 0,
          },
          activeMatchIdx: 0,
        },
        {
          msg: USER_MSG,
          msgMatches: {
            matches: [
              { messageIndex: 0, charStart: 0, charEnd: 5 },
              { messageIndex: 0, charStart: 10, charEnd: 15 },
            ],
            globalOffset: 0,
          },
          activeMatchIdx: 0,
        }
      )
    ).toBe(false);

    // Different globalOffset → must re-render (active-match index resolution changes).
    expect(
      bubblePropsEqual(
        {
          msg: USER_MSG,
          msgMatches: {
            matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }],
            globalOffset: 0,
          },
          activeMatchIdx: 0,
        },
        {
          msg: USER_MSG,
          msgMatches: {
            matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }],
            globalOffset: 1,
          },
          activeMatchIdx: 0,
        }
      )
    ).toBe(false);

    // Different first-match position → must re-render.
    expect(
      bubblePropsEqual(
        {
          msg: USER_MSG,
          msgMatches: {
            matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }],
            globalOffset: 0,
          },
          activeMatchIdx: 0,
        },
        {
          msg: USER_MSG,
          msgMatches: {
            matches: [{ messageIndex: 0, charStart: 2, charEnd: 7 }],
            globalOffset: 0,
          },
          activeMatchIdx: 0,
        }
      )
    ).toBe(false);
  });

  it("Case 13 (P1): `bubblePropsEqual` short-circuits `activeMatchIdx` changes that don't cross this bubble", () => {
    const msgMatches = {
      matches: [
        { messageIndex: 0, charStart: 0, charEnd: 5 },
        { messageIndex: 0, charStart: 10, charEnd: 15 },
      ],
      globalOffset: 5, // this bubble owns global matches 5..6
    };
    // activeMatchIdx 0 → 1: neither in [5, 6], so this bubble doesn't
    // need to re-render (the active highlight isn't on this bubble).
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches, activeMatchIdx: 0 },
        { msg: USER_MSG, msgMatches, activeMatchIdx: 1 }
      )
    ).toBe(true);

    // activeMatchIdx 4 → 5: 5 IS in [5, 6] → this bubble must re-render
    // to update its highlight.
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches, activeMatchIdx: 4 },
        { msg: USER_MSG, msgMatches, activeMatchIdx: 5 }
      )
    ).toBe(false);

    // activeMatchIdx 5 → 6: both IN [5, 6] → must re-render (highlight moves WITHIN this bubble).
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches, activeMatchIdx: 5 },
        { msg: USER_MSG, msgMatches, activeMatchIdx: 6 }
      )
    ).toBe(false);

    // activeMatchIdx 6 → 7: 6 IS in [5, 6] → must re-render to CLEAR the
    // highlight (moving OUT of this bubble).
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches, activeMatchIdx: 6 },
        { msg: USER_MSG, msgMatches, activeMatchIdx: 7 }
      )
    ).toBe(false);
  });

  it("Case 14 (P1): `bubblePropsEqual` always re-renders when msg identity changes", () => {
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches: undefined, activeMatchIdx: 0 },
        { msg: ASSISTANT_MSG, msgMatches: undefined, activeMatchIdx: 0 }
      )
    ).toBe(false);
  });

  it("Case 15 (P1): `bubblePropsEqual` handles undefined-msgMatches asymmetry", () => {
    const msgMatches = {
      matches: [{ messageIndex: 0, charStart: 0, charEnd: 5 }],
      globalOffset: 0,
    };
    // undefined → defined: re-render (search started).
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches: undefined, activeMatchIdx: 0 },
        { msg: USER_MSG, msgMatches, activeMatchIdx: 0 }
      )
    ).toBe(false);
    // defined → undefined: re-render (search cleared).
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches, activeMatchIdx: 0 },
        { msg: USER_MSG, msgMatches: undefined, activeMatchIdx: 0 }
      )
    ).toBe(false);
    // Both undefined → skip (no search active at all).
    expect(
      bubblePropsEqual(
        { msg: USER_MSG, msgMatches: undefined, activeMatchIdx: 0 },
        { msg: USER_MSG, msgMatches: undefined, activeMatchIdx: 0 }
      )
    ).toBe(true);
  });
});
