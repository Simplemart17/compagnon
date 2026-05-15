/**
 * Story 13-5 — `history.tsx` source-drift detector (audit P2-7 closure).
 *
 * Pins the post-13-5 contract by reading the screen source from disk +
 * asserting:
 *   (1) POSITIVE — `FlatList` import from `react-native`.
 *   (2) POSITIVE — `useRef<FlatList<ConversationMessage>>` ref type.
 *   (3) POSITIVE — `<FlatList` element rendered for the transcript modal
 *       with `data={messages}` + `keyExtractor` + `renderItem` +
 *       `extraData=` + `ListEmptyComponent`.
 *   (4) POSITIVE — `scrollToIndex` called inside `scrollToActiveMatch`.
 *   (5) POSITIVE — `onScrollToIndexFailed` prop present.
 *   (6) POSITIVE — virtualization props (`initialNumToRender`,
 *       `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`)
 *       all present.
 *   (7) POSITIVE — `historyExtraDataKey` template-literal includes the
 *       3 search-state inputs (debouncedTranscriptSearch, activeMatchIdx,
 *       messages.length).
 *   (8) NEGATIVE — pre-13-5 `<ScrollView ref={transcriptScrollRef}`
 *       opening tag GONE.
 *   (9) NEGATIVE — pre-13-5 `messages.map((msg, msgIdx) =>` pattern GONE
 *       (the inline transcript render).
 *   (10) NEGATIVE — pre-13-5 `messageLayoutMap` ref declaration GONE.
 *   (11) NEGATIVE — pre-13-5 `useRef<ScrollView>` type-arg GONE from the
 *        `transcriptScrollRef` declaration.
 *   (12) NEGATIVE — pre-13-5 `scrollTo({ y:` direct call GONE (replaced
 *        by scrollToIndex).
 *
 * Story 12-2 P12 lesson: strip comments so JSDoc that mentions pre-13-5
 * patterns doesn't trip the negative guards.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_PATH = join(__dirname, "..", "history.tsx");
const SCREEN_SOURCE = readFileSync(SCREEN_PATH, "utf-8");

const SCREEN_CODE_ONLY = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("history.tsx — Story 13-5 source-drift detector (audit P2-7)", () => {
  it("Case 1: POSITIVE — imports `FlatList` from `react-native`", () => {
    // FlatList appears in the destructured react-native import block.
    expect(SCREEN_CODE_ONLY).toMatch(
      /import\s*\{[^}]*\bFlatList\b[^}]*\}\s*from\s*["']react-native["']/
    );
  });

  it("Case 2: POSITIVE — `transcriptScrollRef` typed as `useRef<FlatList<ConversationMessage>>`", () => {
    expect(SCREEN_CODE_ONLY).toMatch(
      /transcriptScrollRef\s*=\s*useRef\s*<\s*FlatList\s*<\s*ConversationMessage\s*>\s*>/
    );
  });

  /**
   * Helper: find the transcript-modal FlatList element body (the one
   * with `data={messages}` — NOT the outer conversations-list FlatList
   * with `data=` something else). Scans ALL `<FlatList ...` matches and
   * returns the body whose props include `data={messages}`.
   */
  function findTranscriptFlatListBody(): string {
    const matches = [...SCREEN_CODE_ONLY.matchAll(/<FlatList[\s\S]*?\/>/g)];
    const transcriptBody = matches.find((m) => /data=\{messages\}/.test(m[0]));
    if (!transcriptBody) {
      throw new Error("No FlatList element with `data={messages}` found in history.tsx");
    }
    return transcriptBody[0];
  }

  it("Case 3: POSITIVE — `<FlatList` element rendered for the transcript modal with required props", () => {
    const body = findTranscriptFlatListBody();
    expect(body).toMatch(/data=\{messages\}/);
    expect(body).toMatch(/keyExtractor=\{transcriptKeyExtractor\}/);
    expect(body).toMatch(/renderItem=\{renderBubble\}/);
    expect(body).toMatch(/extraData=\{historyExtraDataKey\}/);
    expect(body).toMatch(/ListEmptyComponent=\{EmptyTranscriptText\}/);
  });

  it("Case 4: POSITIVE — `scrollToIndex` called inside `scrollToActiveMatch` with viewPosition + Story 13-5 review-round-1 P2 clamp + P3 retry-reset", () => {
    // Locate scrollToActiveMatch body and verify scrollToIndex with
    // viewPosition: 0.1 (the audit-spec'd offset).
    const fn = SCREEN_CODE_ONLY.match(/scrollToActiveMatch\s*=\s*useCallback[\s\S]*?\)\s*;\s*\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/scrollToIndex\s*\(\s*\{/);
    expect(fn![0]).toMatch(/viewPosition\s*:\s*0\.1/);
    // Story 13-5 review-round-1 P2: clamp the target index against
    // messages.length - 1. The fetch-race window with stale
    // transcriptMatches must NOT pass an out-of-range index to scrollToIndex.
    expect(fn![0]).toMatch(
      /Math\.min\s*\(\s*match\.messageIndex\s*,\s*messages\.length\s*-\s*1\s*\)/
    );
    // Story 13-5 review-round-1 P3: reset retry budget on each fresh
    // user-initiated scroll. Without this, a prior retry-exhaustion would
    // poison the next attempt.
    expect(fn![0]).toMatch(/scrollIndexRetryCountRef\.current\s*=\s*0/);
  });

  it("Case 5: POSITIVE — `onScrollToIndexFailed` prop present on FlatList + handler delegates to pure `handleScrollIndexFailure` helper (review-round-1 P3 + P9)", () => {
    const body = findTranscriptFlatListBody();
    expect(body).toMatch(/onScrollToIndexFailed=\{handleScrollToIndexFailed\}/);
    // Story 13-5 review-round-1 P3 + P9: handler now delegates to the
    // exported pure `handleScrollIndexFailure` helper (which encapsulates
    // the retry budget + clamp + setTimeout retry + mountedRef guard).
    // Pre-round-1 the handler inlined scrollToOffset + setTimeout +
    // scrollToIndex directly; post-round-1 those primitives live inside
    // the helper so the handler body is a thin delegation.
    expect(SCREEN_CODE_ONLY).toMatch(
      /handleScrollToIndexFailed\s*=\s*useCallback[\s\S]*?handleScrollIndexFailure\s*\(/
    );
    // The pure helper itself is exported for testability + contains the
    // retry-budget + clamp + setTimeout primitives.
    expect(SCREEN_CODE_ONLY).toMatch(/export function handleScrollIndexFailure\s*\(/);
    expect(SCREEN_CODE_ONLY).toMatch(
      /handleScrollIndexFailure[\s\S]*?retryCountRef[\s\S]*?maxRetries[\s\S]*?setTimeout[\s\S]*?scrollToIndex/
    );
  });

  it("Case 6: POSITIVE — all 4 FlatList virtualization perf props present", () => {
    const body = findTranscriptFlatListBody();
    expect(body).toMatch(/initialNumToRender=\{20\}/);
    expect(body).toMatch(/windowSize=\{10\}/);
    expect(body).toMatch(/maxToRenderPerBatch=\{10\}/);
    expect(body).toMatch(/removeClippedSubviews=\{true\}/);
  });

  it("Case 7: POSITIVE — `historyExtraDataKey` template literal includes 3 search-state inputs (Story 13-3 P2)", () => {
    // useMemo'd template literal joining 3 inputs.
    expect(SCREEN_CODE_ONLY).toMatch(/historyExtraDataKey\s*=\s*useMemo/);
    // The template literal must reference all 3 axes.
    const memo = SCREEN_CODE_ONLY.match(/historyExtraDataKey\s*=\s*useMemo[\s\S]*?\]\s*\)/);
    expect(memo).not.toBeNull();
    expect(memo![0]).toMatch(/debouncedTranscriptSearch/);
    expect(memo![0]).toMatch(/activeMatchIdx/);
    expect(memo![0]).toMatch(/messages\.length/);
  });

  it("Case 8: NEGATIVE — pre-13-5 `<ScrollView ref={transcriptScrollRef}` GONE", () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(/<ScrollView\s+ref=\{transcriptScrollRef\}/);
  });

  it("Case 9: NEGATIVE — pre-13-5 inline `messages.map((msg, msgIdx) =>` transcript-render pattern GONE", () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(/messages\.map\s*\(\s*\(\s*msg\s*,\s*msgIdx\s*\)\s*=>/);
  });

  it("Case 10: NEGATIVE — pre-13-5 `messageLayoutMap` ref declaration GONE", () => {
    // The pre-13-5 ref was `messageLayoutMap = useRef<Map<number, number>>`.
    expect(SCREEN_CODE_ONLY).not.toMatch(/messageLayoutMap\s*=\s*useRef/);
    // And no calls to messageLayoutMap.current.set / .clear / .get remain.
    expect(SCREEN_CODE_ONLY).not.toMatch(/messageLayoutMap\.current\.(set|get|clear)\s*\(/);
  });

  it("Case 11: NEGATIVE — pre-13-5 `useRef<ScrollView>` type-arg GONE from `transcriptScrollRef`", () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(/transcriptScrollRef\s*=\s*useRef\s*<\s*ScrollView\s*>/);
  });

  it("Case 12: NEGATIVE — pre-13-5 `scrollTo({ y:` direct call GONE", () => {
    // The pre-13-5 search-jump used `transcriptScrollRef.current.scrollTo({ y: ..., animated: ... })`.
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /transcriptScrollRef\.current\.scrollTo\s*\(\s*\{\s*y\s*:/
    );
  });

  // ---------------------------------------------------------------------------
  // Story 13-5 review-round-1 patch pins
  // ---------------------------------------------------------------------------

  it("Case 13 (P1): POSITIVE — `Bubble` exports a custom `bubblePropsEqual` arePropsEqual + `React.memo` invokes it", () => {
    // Pre-patch React.memo's default shallow comparison flipped on every
    // search keystroke (matchesByMessage rebuild → fresh {matches, globalOffset}
    // object reference). Post-patch the custom comparator hashes by content
    // (length + globalOffset + first/last match positions) + short-circuits
    // activeMatchIdx changes that don't cross this bubble's match range.
    expect(SCREEN_CODE_ONLY).toMatch(
      /export function bubblePropsEqual\s*\(\s*prev\s*:\s*BubbleProps\s*,\s*next\s*:\s*BubbleProps\s*\)/
    );
    // React.memo is called with the comparator as the 2nd arg.
    expect(SCREEN_CODE_ONLY).toMatch(/React\.memo\s*\(\s*[\s\S]*?,\s*bubblePropsEqual\s*\)/);
    // The comparator's load-bearing content-hash checks.
    expect(SCREEN_CODE_ONLY).toMatch(/prev\.msg\s*!==\s*next\.msg/);
    expect(SCREEN_CODE_ONLY).toMatch(/p\.globalOffset\s*!==\s*n\.globalOffset/);
    expect(SCREEN_CODE_ONLY).toMatch(/p\.matches\.length\s*!==\s*n\.matches\.length/);
    // activeMatchIdx short-circuit when the change doesn't cross this bubble.
    expect(SCREEN_CODE_ONLY).toMatch(/prev\.activeMatchIdx\s*!==\s*next\.activeMatchIdx/);
    expect(SCREEN_CODE_ONLY).toMatch(/containsActive\s*=/);
  });

  it("Case 14 (P3): POSITIVE — `handleScrollIndexFailure` enforces retry budget + clamps to `info.highestMeasuredFrameIndex` + emits Sentry breadcrumb on exhaustion", () => {
    // Story 13-5 review-round-1 P3: pre-patch the handler's setTimeout
    // retried info.index unconditionally → if scrollToIndex also failed
    // on retry, the chain re-fired endlessly. Post-patch the helper caps
    // retries at maxRetries (default 2) + clamps the target index to
    // info.highestMeasuredFrameIndex (the largest measured frame).
    const helper = SCREEN_CODE_ONLY.match(/export function handleScrollIndexFailure[\s\S]*?\n\}\n/);
    expect(helper).not.toBeNull();
    const body = helper![0];
    // Retry budget check (default 2).
    expect(body).toMatch(/maxRetries\s*=\s*ctx\.maxRetries\s*\?\?\s*2/);
    expect(body).toMatch(/ctx\.retryCountRef\.current\s*>=\s*maxRetries/);
    // Index clamp to highestMeasuredFrameIndex (RN-docs pattern).
    expect(body).toMatch(/Math\.min\s*\(\s*info\.index\s*,\s*info\.highestMeasuredFrameIndex\s*\)/);
    // Sentry breadcrumb on exhaustion (Story 9-3 telemetry allowlist).
    expect(body).toMatch(/captureError[\s\S]*?["']history-scroll-to-index-exhausted["']/);
  });

  it("Case 15 (P4): POSITIVE — `scrollIndexTimeoutRef` declared + cleanup effect clears the timeout on unmount", () => {
    // Story 13-5 review-round-1 P4: pre-patch the setTimeout fired even
    // after unmount (the mountedRef guard bailed inside the callback, but
    // the timer itself wasn't cleared → minor RN warning + wasted JS work).
    // Post-patch the timer id is tracked in a ref + cleared in the
    // cleanup effect.
    expect(SCREEN_CODE_ONLY).toMatch(
      /scrollIndexTimeoutRef\s*=\s*useRef\s*<\s*ReturnType\s*<\s*typeof\s+setTimeout\s*>\s*\|\s*null\s*>/
    );
    // Cleanup effect clears the timeout.
    expect(SCREEN_CODE_ONLY).toMatch(/clearTimeout\s*\(\s*scrollIndexTimeoutRef\.current\s*\)/);
  });

  it("Case 16 (L1): NEGATIVE — pre-patch redundant `mountedRef.current = true` inside `useEffect` body GONE", () => {
    // Story 13-5 review-round-1 L1: useRef(true) initializes once at hook
    // creation. The in-effect re-assignment was redundant + StrictMode-
    // cleanup-then-remount window incorrectly toggled the ref false→true.
    // Post-patch the effect body ONLY tracks cleanup; the `mountedRef =
    // useRef(true)` declaration is the single source of truth.
    // We assert the effect body does NOT re-assign mountedRef.current to true.
    // The effect arrow body is `() => { return () => { mountedRef.current = false; ... } }`.
    // Pre-patch was: `() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }`.
    // We pin via NEGATIVE: no `mountedRef.current = true` outside the initial useRef call.
    const setToTrueOutsideRef = SCREEN_CODE_ONLY.match(/mountedRef\.current\s*=\s*true/g);
    expect(setToTrueOutsideRef).toBeNull();
  });

  it('Case 17 (L2): POSITIVE — `Bubble.displayName = "Bubble"` set so DevTools shows the name', () => {
    expect(SCREEN_CODE_ONLY).toMatch(/Bubble\.displayName\s*=\s*["']Bubble["']/);
  });
});
