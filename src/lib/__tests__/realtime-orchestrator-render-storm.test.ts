/**
 * Story 13-1 — `RealtimeOrchestrator` render-storm fix tests (audit P2-3
 * closure).
 *
 * Pins the post-13-1 wiring of:
 *   (a) The new `scheduleAiTextSetState` + `cancelPendingAiTextRaf`
 *       helpers — both delta handlers route through the schedule helper;
 *       all `.done` + error + barge-in + dispose paths cancel.
 *   (b) The `response.output_audio.delta` state-change guard
 *       (`if (!this.state.isAiSpeaking)`) — cuts ~50 setStates/turn to 1.
 *   (c) Cross-story invariants that MUST NOT regress:
 *       - Story 11-2 P22 synchronous `isAiSpeakingMirror` updates.
 *       - Story 12-1 P7 `isDisposed` short-circuit (extended to async-rAF).
 *       - Story 12-6 `applyTranscriptCap` calls preserved.
 *       - Story 9-5 `acceptDelta` boundary preserved.
 *
 * Drift detectors (Cases 1-9) read orchestrator source from disk + apply
 * targeted regex assertions using the comment-stripped `ORCHESTRATOR_CODE_ONLY`
 * pattern (Story 12-2 P12 lesson) + `extractMethodBody` walker (Story 12-5
 * P12 / 12-10 H1 / 12-12 lessons).
 *
 * Runtime tests (Cases 10-12) drive the orchestrator's `handleEvent` switch
 * directly with synthetic Realtime events + mocked `requestAnimationFrame`
 * to assert (a) state-change guard fires setState exactly once per turn for
 * the audio-delta path, (b) ~50Hz transcript-delta cadence collapses to
 * at-most-one setState per frame, (c) dispose cancels the pending rAF.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { __resetAudioStreamManagerForTests } from "../audio-stream-manager";
import { RealtimeOrchestrator, type RealtimeOrchestratorOptions } from "../realtime-orchestrator";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("../cache", () => ({
  __esModule: true,
  enqueueWrite: jest.fn(async () => undefined),
}));

jest.mock("../network", () => ({
  __esModule: true,
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { id: "convo-storm-test" }, error: null })),
        })),
      })),
      update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
    })),
    rpc: jest.fn(async () => ({ data: null, error: null })),
  },
}));

jest.mock("../audio-stream-manager", () => ({
  __esModule: true,
  acquireAudioStream: jest.fn(),
  releaseAudioStream: jest.fn(async () => undefined),
  __resetAudioStreamManagerForTests: jest.fn(),
}));

jest.mock("../realtime", () => ({
  RealtimeSession: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    isConnected: false,
    sendText: jest.fn(),
    sendFunctionResult: jest.fn(),
    sendRaw: jest.fn(),
    appendAudio: jest.fn(),
  })),
}));

// Block `ExpoPlayAudioStream.playSound` from doing any real work during
// runtime tests (Cases 10-12).
jest.mock("@mykin-ai/expo-audio-stream", () => ({
  __esModule: true,
  ExpoPlayAudioStream: {
    playSound: jest.fn(),
    stopSound: jest.fn(),
    stopRecording: jest.fn(),
    requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
    setSoundConfig: jest.fn(),
    startRecording: jest.fn(),
  },
}));

const baseOptions: RealtimeOrchestratorOptions = {
  user: {
    id: "test-user-13-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01",
  } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetAudioStreamManagerForTests();
});

// ============================================================================
// Drift detectors — read orchestrator source from disk
// ============================================================================

const ORCHESTRATOR_PATH = join(__dirname, "..", "realtime-orchestrator.ts");
const ORCHESTRATOR_SOURCE = readFileSync(ORCHESTRATOR_PATH, "utf-8");

/**
 * Strip block + line comments so JSDoc mentioning the pre-13-1 patterns
 * doesn't trip the negative-guard regexes. Story 12-2 P12 lesson.
 */
const ORCHESTRATOR_CODE_ONLY = ORCHESTRATOR_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/[^\n]*/g,
  ""
);

/**
 * Extract a method body from the comment-stripped orchestrator source by
 * finding the signature substring and slicing forward until the next
 * top-level method signature. Mirrors the helper in
 * `realtime-orchestrator-transcript-cap.test.ts` (Story 12-5 P12 + 12-4 P10).
 */
function extractMethodBody(signatureStart: string): string {
  const idx = ORCHESTRATOR_CODE_ONLY.indexOf(signatureStart);
  if (idx < 0) {
    throw new Error(`Method signature not found: ${signatureStart}`);
  }
  const after = ORCHESTRATOR_CODE_ONLY.slice(idx + signatureStart.length);
  const nextSignatureRe = /\n {2}(?:private |protected |public |async |[a-zA-Z]+\s*\()/;
  const nextMatch = nextSignatureRe.exec(after);
  return nextMatch ? after.slice(0, nextMatch.index) : after;
}

/**
 * Extract a single switch-case arm by anchoring on the case label and
 * slicing forward until the next `case "..."` label, `default:`, or the
 * closing `}` of the switch. Story 13-1 review-round-1 P7 fix: pre-patch
 * Case 7 took a fixed forward window (1000-1500 bytes) from each case
 * label, which could overlap into a sibling case-arm and mask a
 * regression that removed `cancelPendingAiTextRaf()` from one specific
 * arm. Post-patch the case-arm bound is precise.
 */
function extractCaseArm(caseLabel: string): string {
  const idx = ORCHESTRATOR_CODE_ONLY.indexOf(caseLabel);
  if (idx < 0) {
    throw new Error(`Case label not found: ${caseLabel}`);
  }
  const after = ORCHESTRATOR_CODE_ONLY.slice(idx + caseLabel.length);
  // Match: the next `case "..."` label OR `default:` at any indent.
  const nextCaseRe = /\n\s+(?:case\s+["'`]|default:)/;
  const nextMatch = nextCaseRe.exec(after);
  return nextMatch ? after.slice(0, nextMatch.index) : after;
}

describe("Story 13-1 — orchestrator render-storm drift detectors (audit P2-3)", () => {
  // Story 18-4 R1: audio-boundary arms now route through onAiOutputBoundary(),
  // whose body is pinned (avatar-amplitude-source-drift.test.ts) to call
  // cancelPendingAiTextRaf — either form satisfies the 13-1 cancel contract.
  it("Case 1: `scheduleAiTextSetState` method exists + uses `requestAnimationFrame`", () => {
    const body = extractMethodBody("private scheduleAiTextSetState(): void {");
    // Idempotent-schedule guard.
    expect(body).toMatch(/if\s*\(\s*this\.aiTextRafHandle\s*!==\s*null\s*\)\s*return/);
    // rAF schedule.
    expect(body).toMatch(/requestAnimationFrame\s*\(/);
    // The callback reads this.currentAiText at fire-time (NOT at schedule
    // time) so coalesced bursts surface the latest value.
    expect(body).toMatch(/pendingAiText:\s*this\.currentAiText/);
    // isDisposed short-circuit (Story 12-1 P7 contract extension).
    expect(body).toMatch(/if\s*\(\s*this\.isDisposed\s*\)\s*return/);
  });

  it("Case 2: `cancelPendingAiTextRaf` method exists + calls `cancelAnimationFrame`", () => {
    const body = extractMethodBody("private cancelPendingAiTextRaf(): void {");
    expect(body).toMatch(/cancelAnimationFrame\s*\(\s*this\.aiTextRafHandle\s*\)/);
    expect(body).toMatch(/this\.aiTextRafHandle\s*=\s*null/);
  });

  it("Case 3: `response.output_audio.delta` setState is guarded behind state-change check", () => {
    // Story 13-1 review-round-1 P7 fix: use `extractCaseArm` for precise
    // case-body bounding so a regression that removes the guard from
    // THIS arm can't be masked by a sibling arm's matching pattern.
    const arm = extractCaseArm('case "response.output_audio.delta":');
    // Synchronous mirror update is PRESERVED — Story 11-2 P22 invariant.
    expect(arm).toMatch(/this\.isAiSpeakingMirror\s*=\s*true/);
    // Story 13-1 review-round-1 P2: the guard reads the captured
    // pre-mutation mirror value (`wasAiSpeaking`), not `this.state.isAiSpeaking`,
    // so re-entrant subscriber mutations to React state can't re-fire
    // the setState mid-burst.
    expect(arm).toMatch(/const\s+wasAiSpeaking\s*=\s*this\.isAiSpeakingMirror/);
    expect(arm).toMatch(/if\s*\(\s*!\s*wasAiSpeaking\s*\)/);
  });

  it("Case 4: text-delta + audio-transcript-delta routes through `scheduleAiTextSetState()`", () => {
    // Story 13-1 review-round-1 P7 fix: extractCaseArm for both case
    // labels — pre-patch the 1500-byte window could include the next
    // case-arm's matching call, masking a regression in one of the two.
    const textArm = extractCaseArm('case "response.output_text.delta":');
    expect(textArm).toMatch(/this\.scheduleAiTextSetState\s*\(\s*\)/);

    const audioArm = extractCaseArm('case "response.output_audio_transcript.delta":');
    expect(audioArm).toMatch(/this\.scheduleAiTextSetState\s*\(\s*\)/);
  });

  it("Case 5: NEGATIVE — pre-13-1 direct setState pattern (any shape with `pendingAiText:` + a `this.\\w+` value) appears 0 times outside `scheduleAiTextSetState`", () => {
    // Pre-13-1 the two delta handlers inlined this setState directly.
    // Post-13-1 it only appears inside `scheduleAiTextSetState`. Excise
    // that method body before searching the rest of the file.
    //
    // Story 13-1 review-round-1 P6: broaden the negative-guard regex per
    // Story 12-12 M1 lesson. Pre-patch the regex matched ONLY the EXACT
    // pre-13-1 shape `setState((s) => ({ ...s, pendingAiText: this.currentAiText }))`
    // — a benign refactor producing `setState((s) => ({ pendingAiText: this.currentAiText, ...s }))`
    // (property reorder) OR `setState((s) => ({ ...s, pendingAiText: this.someAlias }))`
    // (alias rename) would slip through silently. Post-patch the regex
    // accepts ANY setState whose updater object contains `pendingAiText:`
    // assigned from a `this.<identifier>` reference, in any property
    // order, with optional whitespace.
    const helperBody = extractMethodBody("private scheduleAiTextSetState(): void {");
    const helperIdx = ORCHESTRATOR_CODE_ONLY.indexOf(helperBody);
    const beforeHelper = ORCHESTRATOR_CODE_ONLY.slice(0, helperIdx);
    const afterHelper = ORCHESTRATOR_CODE_ONLY.slice(helperIdx + helperBody.length);
    const withoutHelper = beforeHelper + afterHelper;
    // Loosened regex: matches `setState((s) => ({ ... pendingAiText: this.<anything> ... }))`
    // in any property order with any whitespace. The `[\s\S]{0,200}?` is
    // non-greedy + bounded so it can't span across unrelated setState calls.
    expect(withoutHelper).not.toMatch(
      /setState\s*\(\s*\(s\)\s*=>\s*\(\s*\{[\s\S]{0,200}?pendingAiText:\s*this\.\w+[\s\S]{0,200}?\}\s*\)\s*\)/
    );
  });

  it("Case 6: `cancelPendingAiTextRaf` is called inside `dispose()`", () => {
    const body = extractMethodBody("dispose(): void {");
    expect(body).toMatch(/this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/);
  });

  it("Case 7: `cancelPendingAiTextRaf` is called from every `.done` / error / barge-in / reconnect path", () => {
    // Story 13-1 review-round-1 P7 fix: extractCaseArm for proper
    // case-body bounding — pre-patch the fixed 1000-1500 byte windows
    // could include sibling case-arms' matching `cancelPendingAiTextRaf`
    // calls, masking a regression that removed it from one specific arm.
    const audioDoneArm = extractCaseArm('case "response.output_audio.done":');
    expect(audioDoneArm).toMatch(/this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/);

    const textDoneArm = extractCaseArm('case "response.output_text.done":');
    expect(textDoneArm).toMatch(/this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/);

    const audioTranscriptDoneArm = extractCaseArm('case "response.output_audio_transcript.done":');
    expect(audioTranscriptDoneArm).toMatch(
      /this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/
    );

    // handleResponseDone method body
    const handleResponseDoneBody = extractMethodBody("private handleResponseDone(): void {");
    expect(handleResponseDoneBody).toMatch(
      /this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/
    );

    // handleErrorEvent method body
    const handleErrorBody = extractMethodBody(
      'private handleErrorEvent(event: RealtimeEvent & { type: "error" }): void {'
    );
    expect(handleErrorBody).toMatch(/this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/);

    // handleSpeechStarted (barge-in path)
    const bargeInBody = extractMethodBody("private handleSpeechStarted(): void {");
    expect(bargeInBody).toMatch(/this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/);

    // Story 13-1 review-round-1 P4: handleReconnecting also cancels the
    // pending rAF before clearing pendingAiText (cross-session boundary).
    const reconnectingBody = extractMethodBody("private handleReconnecting(): void {");
    expect(reconnectingBody).toMatch(/this\.(cancelPendingAiTextRaf|onAiOutputBoundary)\s*\(\s*\)/);
  });

  it("Case 8: Story 11-2 P22 invariant — `isAiSpeakingMirror = true` AND `= false` both still present", () => {
    // Synchronous mirror updates MUST remain in the codebase — barge-in
    // relies on them for event-time access without React state lag.
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(/this\.isAiSpeakingMirror\s*=\s*true/);
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(/this\.isAiSpeakingMirror\s*=\s*false/);
  });

  it("Case 9: Story 12-6 invariant — `applyTranscriptCap(this.transcript,` appears ≥ 2 times", () => {
    const matches = ORCHESTRATOR_CODE_ONLY.match(/applyTranscriptCap\(\s*this\.transcript\s*,/g);
    expect(matches).not.toBeNull();
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Runtime cases — drive handleEvent directly with mocked rAF
// ============================================================================

describe("Story 13-1 — orchestrator render-storm runtime contracts (audit P2-3)", () => {
  /**
   * Helper: cast the orchestrator to a shape exposing `handleEvent` so we
   * can drive synthetic Realtime events without going through the
   * `RealtimeSession.on(...)` indirection. Mirrors the pattern used in
   * `realtime-orchestrator-transcript-cap.test.ts`.
   */
  type EventDispatcher = { handleEvent: (event: unknown) => void };
  function asDispatcher(orch: RealtimeOrchestrator): EventDispatcher {
    return orch as unknown as EventDispatcher;
  }

  /**
   * Mock requestAnimationFrame so we can count + manually flush queued
   * callbacks. Each test restores the originals to prevent cross-test
   * leakage. Story 12-5 P4 lesson applies — install in `beforeEach`,
   * restore in `afterEach`.
   *
   * **Story 13-1 review-round-1 P3:** mock cancelAnimationFrame ACTUALLY
   * removes the callback from the pending queue (matching real-browser
   * behavior) — pre-patch the mock only logged the handle, so Case 12
   * couldn't distinguish whether the cancel call worked or whether only
   * the in-callback `isDisposed` guard prevented the post-dispose
   * setState. Post-patch the mock keeps a handle→callback Map and the
   * flush helper iterates only the live (uncancelled) entries — both
   * defense layers are now independently verifiable.
   */
  let rafQueue: Map<number, () => void>;
  let rafHandleCounter: number;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;
  let cancelledHandles: number[];

  beforeEach(() => {
    rafQueue = new Map();
    rafHandleCounter = 0;
    cancelledHandles = [];
    originalRaf = global.requestAnimationFrame;
    originalCancel = global.cancelAnimationFrame;
    global.requestAnimationFrame = ((cb: () => void) => {
      const handle = ++rafHandleCounter;
      rafQueue.set(handle, cb);
      return handle;
    }) as unknown as typeof requestAnimationFrame;
    global.cancelAnimationFrame = ((handle: number) => {
      cancelledHandles.push(handle);
      rafQueue.delete(handle); // P3: real-browser parity — removes from pending queue
    }) as unknown as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancel;
  });

  /**
   * Flush all queued (uncancelled) rAF callbacks in insertion order, then
   * clear the queue. P3 fix: only invokes live entries — a cancelled
   * handle is already removed from `rafQueue`.
   */
  function flushRaf(): void {
    const queue = Array.from(rafQueue.values());
    rafQueue.clear();
    for (const cb of queue) cb();
  }

  /** Number of pending (uncancelled) rAF callbacks. */
  function rafQueueSize(): number {
    return rafQueue.size;
  }

  it("Case 10: 100 `response.output_audio.delta` events fire setState EXACTLY ONCE for the isAiSpeaking flip", () => {
    const orch = new RealtimeOrchestrator(baseOptions);
    const subscriber = jest.fn();
    orch.subscribe(subscriber);
    subscriber.mockClear(); // ignore the initial-sync notification

    const dispatcher = asDispatcher(orch);
    for (let i = 0; i < 100; i++) {
      dispatcher.handleEvent({
        type: "response.output_audio.delta",
        delta: "AAAA",
        item_id: "item-0",
      });
    }

    // Story 13-1 state-change guard: setState only fires on the FIRST
    // delta (when isAiSpeaking transitions false→true). 99 subsequent
    // deltas are no-ops for React state (but `isAiSpeakingMirror`
    // continues to be set synchronously every time — Story 11-2 P22).
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(orch.getState().isAiSpeaking).toBe(true);
    expect(orch.getState().isProcessing).toBe(false);

    orch.dispose();
  });

  it("Case 11: 100 `response.output_audio_transcript.delta` events coalesce to ≤ 1 setState per rAF flush", () => {
    const orch = new RealtimeOrchestrator(baseOptions);
    const subscriber = jest.fn();
    orch.subscribe(subscriber);
    subscriber.mockClear();

    const dispatcher = asDispatcher(orch);
    // Open the AI-speaking response window so acceptDelta accepts the
    // first item_id without bailing.
    dispatcher.handleEvent({
      type: "response.output_audio.delta",
      delta: "AAAA",
      item_id: "item-X",
    });
    subscriber.mockClear(); // drop the isAiSpeaking-flip notification
    const initialRafCount = rafQueueSize();

    for (let i = 0; i < 100; i++) {
      dispatcher.handleEvent({
        type: "response.output_audio_transcript.delta",
        delta: "a",
        item_id: "item-X",
      });
    }

    // Idempotent schedule: 100 deltas → 1 NEW rAF queued.
    expect(rafQueueSize() - initialRafCount).toBe(1);
    // The currentAiText (private) is updated synchronously each delta;
    // the coalesced setState surfaces the final accumulated string on
    // the next rAF tick. State has NOT changed yet — schedule pending.
    expect(subscriber).toHaveBeenCalledTimes(0);

    flushRaf();

    // After flush, exactly ONE setState surfaces the coalesced
    // pendingAiText. Story 13-1 review-round-1 P8 fix: assert the EXACT
    // accumulated string ("a" × 100), not just length — defends against
    // a future regression that produces a 100-char string with different
    // content (e.g., a corrupted acceptDelta adopt-vs-append branch).
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(orch.getState().pendingAiText).toBe("a".repeat(100));

    orch.dispose();
  });

  it("Case 12: `dispose()` cancels pending rAF (cancel layer verified independently)", () => {
    // Story 13-1 review-round-1 P3: this test now verifies the
    // `cancelAnimationFrame` call independently of the in-callback
    // `isDisposed` guard. Pre-patch the mock didn't actually remove the
    // callback from the queue, so a future regression that removed the
    // cancel call would silently pass (the in-callback guard would
    // still catch it). Post-patch the mock DOES remove the entry from
    // `rafQueue` on cancel, so we can directly assert the queue is
    // empty after dispose AND that the in-callback guard remains as
    // belt-and-suspenders defense (verified in Case 13 below).
    const orch = new RealtimeOrchestrator(baseOptions);
    const subscriber = jest.fn();
    orch.subscribe(subscriber);
    subscriber.mockClear();

    const dispatcher = asDispatcher(orch);
    dispatcher.handleEvent({
      type: "response.output_audio.delta",
      delta: "AAAA",
      item_id: "item-Y",
    });
    subscriber.mockClear();

    dispatcher.handleEvent({
      type: "response.output_audio_transcript.delta",
      delta: "should not surface",
      item_id: "item-Y",
    });
    expect(rafQueueSize()).toBe(1);
    const handlesBeforeDispose = cancelledHandles.length;
    const handleScheduled = Array.from(rafQueue.keys())[0];

    orch.dispose();

    // dispose() called cancelAnimationFrame on the EXACT handle that was
    // queued (not just any handle). The mock removes it from the queue.
    expect(cancelledHandles.length).toBeGreaterThan(handlesBeforeDispose);
    expect(cancelledHandles).toContain(handleScheduled);
    expect(rafQueueSize()).toBe(0);

    // No setState fires post-dispose — the queue is empty so flushRaf
    // has nothing to invoke. The cancel layer alone is sufficient.
    subscriber.mockClear();
    flushRaf();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("Case 13: rAF callback's in-callback `isDisposed` guard is the SECOND defense layer (belt-and-suspenders)", () => {
    // Story 13-1 review-round-1 P3: separate test to verify the
    // in-callback `isDisposed` guard works independently of cancel.
    // We simulate a scenario where the cancel call is missing (e.g., a
    // future refactor drops it) by manually setting isDisposed via the
    // orchestrator's public dispose() call BUT then re-injecting the
    // original rAF callback into the queue to bypass the cancel
    // (modeling the regression we're defending against). The
    // in-callback `isDisposed` check should still prevent the setState.
    const orch = new RealtimeOrchestrator(baseOptions);
    const subscriber = jest.fn();
    orch.subscribe(subscriber);
    subscriber.mockClear();

    const dispatcher = asDispatcher(orch);
    dispatcher.handleEvent({
      type: "response.output_audio.delta",
      delta: "AAAA",
      item_id: "item-Z",
    });
    subscriber.mockClear();

    dispatcher.handleEvent({
      type: "response.output_audio_transcript.delta",
      delta: "should still not surface",
      item_id: "item-Z",
    });
    expect(rafQueueSize()).toBe(1);
    const handleScheduled = Array.from(rafQueue.keys())[0];
    const rafCallback = rafQueue.get(handleScheduled)!;

    // Simulate the regression: dispose runs but the cancel call is
    // missing. Re-inject the callback into the queue AFTER dispose so
    // the in-callback guard is the ONLY defense.
    orch.dispose();
    rafQueue.set(handleScheduled, rafCallback);

    subscriber.mockClear();
    flushRaf();
    // The in-callback `if (this.isDisposed) return` guard prevents the
    // setState from firing. Belt-and-suspenders confirmed.
    expect(subscriber).not.toHaveBeenCalled();
  });
});
