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

describe("Story 13-1 — orchestrator render-storm drift detectors (audit P2-3)", () => {
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
    // Slice the relevant case-arm out of handleEvent. Anchor on the
    // canonical case label so a future code reformat doesn't break this.
    const idx = ORCHESTRATOR_CODE_ONLY.indexOf('case "response.output_audio.delta":');
    expect(idx).toBeGreaterThan(0);
    // Take a generous window forward (~1.5KB) — large enough to span the
    // whole case body but well under the next sibling case.
    const armSlice = ORCHESTRATOR_CODE_ONLY.slice(idx, idx + 1500);
    // Synchronous mirror update is PRESERVED before any guard (Story 11-2
    // P22 invariant).
    expect(armSlice).toMatch(/this\.isAiSpeakingMirror\s*=\s*true/);
    // State-change guard wraps the setState — the load-bearing post-13-1
    // pattern that cuts ~50 setStates/turn to 1.
    expect(armSlice).toMatch(/if\s*\(\s*!\s*this\.state\.isAiSpeaking\s*\)/);
  });

  it("Case 4: text-delta + audio-transcript-delta routes through `scheduleAiTextSetState()`", () => {
    // Both delta handlers must dispatch through the rAF helper, NOT
    // direct setState. Anchor on each case label individually.
    const textArmIdx = ORCHESTRATOR_CODE_ONLY.indexOf('case "response.output_text.delta":');
    expect(textArmIdx).toBeGreaterThan(0);
    const textArm = ORCHESTRATOR_CODE_ONLY.slice(textArmIdx, textArmIdx + 1500);
    expect(textArm).toMatch(/this\.scheduleAiTextSetState\s*\(\s*\)/);

    const audioArmIdx = ORCHESTRATOR_CODE_ONLY.indexOf(
      'case "response.output_audio_transcript.delta":'
    );
    expect(audioArmIdx).toBeGreaterThan(0);
    const audioArm = ORCHESTRATOR_CODE_ONLY.slice(audioArmIdx, audioArmIdx + 1500);
    expect(audioArm).toMatch(/this\.scheduleAiTextSetState\s*\(\s*\)/);
  });

  it("Case 5: NEGATIVE — pre-13-1 direct setState pattern `setState((s) => ({ ...s, pendingAiText: this.currentAiText }))` appears 0 times outside `scheduleAiTextSetState`", () => {
    // Pre-13-1 the two delta handlers inlined this setState directly.
    // Post-13-1 it only appears inside `scheduleAiTextSetState`. Excise
    // that method body before searching the rest of the file.
    const helperBody = extractMethodBody("private scheduleAiTextSetState(): void {");
    const helperIdx = ORCHESTRATOR_CODE_ONLY.indexOf(helperBody);
    const beforeHelper = ORCHESTRATOR_CODE_ONLY.slice(0, helperIdx);
    const afterHelper = ORCHESTRATOR_CODE_ONLY.slice(helperIdx + helperBody.length);
    const withoutHelper = beforeHelper + afterHelper;
    // Whitespace-tolerant negative guard against the pre-13-1 shape.
    expect(withoutHelper).not.toMatch(
      /setState\s*\(\s*\(s\)\s*=>\s*\(\s*\{\s*\.\.\.s\s*,\s*pendingAiText:\s*this\.currentAiText\s*\}\s*\)\s*\)/
    );
  });

  it("Case 6: `cancelPendingAiTextRaf` is called inside `dispose()`", () => {
    const body = extractMethodBody("dispose(): void {");
    expect(body).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);
  });

  it("Case 7: `cancelPendingAiTextRaf` is called from every `.done` / error / barge-in path", () => {
    // response.output_audio.done case arm
    const audioDoneIdx = ORCHESTRATOR_CODE_ONLY.indexOf('case "response.output_audio.done":');
    expect(audioDoneIdx).toBeGreaterThan(0);
    const audioDoneArm = ORCHESTRATOR_CODE_ONLY.slice(audioDoneIdx, audioDoneIdx + 1000);
    expect(audioDoneArm).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);

    // response.output_text.done case arm
    const textDoneIdx = ORCHESTRATOR_CODE_ONLY.indexOf('case "response.output_text.done":');
    expect(textDoneIdx).toBeGreaterThan(0);
    const textDoneArm = ORCHESTRATOR_CODE_ONLY.slice(textDoneIdx, textDoneIdx + 1500);
    expect(textDoneArm).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);

    // response.output_audio_transcript.done case arm
    const audioTranscriptDoneIdx = ORCHESTRATOR_CODE_ONLY.indexOf(
      'case "response.output_audio_transcript.done":'
    );
    expect(audioTranscriptDoneIdx).toBeGreaterThan(0);
    const audioTranscriptDoneArm = ORCHESTRATOR_CODE_ONLY.slice(
      audioTranscriptDoneIdx,
      audioTranscriptDoneIdx + 1500
    );
    expect(audioTranscriptDoneArm).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);

    // handleResponseDone method body
    const handleResponseDoneBody = extractMethodBody("private handleResponseDone(): void {");
    expect(handleResponseDoneBody).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);

    // handleErrorEvent method body
    const handleErrorBody = extractMethodBody(
      'private handleErrorEvent(event: RealtimeEvent & { type: "error" }): void {'
    );
    expect(handleErrorBody).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);

    // handleSpeechStarted (barge-in path)
    const bargeInBody = extractMethodBody("private handleSpeechStarted(): void {");
    expect(bargeInBody).toMatch(/this\.cancelPendingAiTextRaf\s*\(\s*\)/);
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
   */
  let rafCallbacks: (() => void)[];
  let rafHandleCounter: number;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;
  let cancelledHandles: number[];

  beforeEach(() => {
    rafCallbacks = [];
    rafHandleCounter = 0;
    cancelledHandles = [];
    originalRaf = global.requestAnimationFrame;
    originalCancel = global.cancelAnimationFrame;
    global.requestAnimationFrame = ((cb: () => void) => {
      const handle = ++rafHandleCounter;
      rafCallbacks.push(cb);
      return handle;
    }) as unknown as typeof requestAnimationFrame;
    global.cancelAnimationFrame = ((handle: number) => {
      cancelledHandles.push(handle);
    }) as unknown as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancel;
  });

  /** Flush all queued rAF callbacks in order, then clear the queue. */
  function flushRaf(): void {
    const queue = [...rafCallbacks];
    rafCallbacks.length = 0;
    for (const cb of queue) cb();
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
    const initialRafCount = rafCallbacks.length;

    for (let i = 0; i < 100; i++) {
      dispatcher.handleEvent({
        type: "response.output_audio_transcript.delta",
        delta: "a",
        item_id: "item-X",
      });
    }

    // Idempotent schedule: 100 deltas → 1 NEW rAF queued.
    expect(rafCallbacks.length - initialRafCount).toBe(1);
    // The currentAiText (private) is updated synchronously each delta;
    // the coalesced setState surfaces the final accumulated string on
    // the next rAF tick. State has NOT changed yet — schedule pending.
    expect(subscriber).toHaveBeenCalledTimes(0);

    flushRaf();

    // After flush, exactly ONE setState surfaces the coalesced
    // pendingAiText (the 100-character accumulated string).
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(orch.getState().pendingAiText.length).toBe(100);

    orch.dispose();
  });

  it("Case 12: `dispose()` cancels pending rAF before it fires", () => {
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

    // Schedule a pendingAiText rAF via a transcript-delta event.
    dispatcher.handleEvent({
      type: "response.output_audio_transcript.delta",
      delta: "should not surface",
      item_id: "item-Y",
    });
    expect(rafCallbacks.length).toBeGreaterThan(0);
    const handlesBeforeDispose = cancelledHandles.length;

    orch.dispose();

    // dispose() called cancelAnimationFrame on the pending handle.
    expect(cancelledHandles.length).toBeGreaterThan(handlesBeforeDispose);
    subscriber.mockClear();

    // Now flush — the rAF callback may still run (we mock the cancel
    // call, but the queued callbacks remain in `rafCallbacks` so the
    // flush helper invokes them). The orchestrator's INTERNAL guard
    // (`if (this.isDisposed) return` in the rAF callback) prevents the
    // setState from firing even though the test harness flushes the
    // queue. Belt-and-suspenders: cancel call AND in-callback guard.
    flushRaf();
    expect(subscriber).not.toHaveBeenCalled();
  });
});
