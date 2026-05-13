/**
 * Story 12-5 — `RealtimeOrchestrator` audio-stream lifecycle integration tests.
 *
 * Verifies the orchestrator correctly delegates audio-module lifecycle to
 * `audio-stream-manager` (Story 12-5) — `acquireAudioStream()` fires in
 * `startAudioStreaming()` and the matched `releaseAudioStream()` fires in
 * `dispose()`. The load-bearing assertion: `ExpoPlayAudioStream.destroy()`
 * NEVER appears in the orchestrator source (audit P1-19 closure).
 *
 * Two failure-mode tests:
 *   (a) `start()` failing BEFORE `startAudioStreaming()` runs → no unmatched
 *       `releaseAudioStream()` call in `dispose()`.
 *   (b) Double-`dispose()` → `releaseAudioStream()` called EXACTLY ONCE
 *       (idempotent via `isDisposed` short-circuit + `acquireWasCalled` reset).
 */

import { readFileSync } from "fs";
import { join } from "path";

// Capture handle to the mocked native module so per-test failure-injection
// (e.g., requestPermissionsAsync throwing AFTER acquire ran) can be wired up
// for Story 12-5 review-round-1 P3.
import { ExpoPlayAudioStream as MockedExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";
import type { User } from "@supabase/supabase-js";

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

// Capture mock for `createConversationRecord` — controlled per test.
const mockSingle = jest.fn(async () => ({ data: { id: "convo-test-id" }, error: null }));

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: (...args: unknown[]) =>
            (mockSingle as unknown as (...a: unknown[]) => unknown)(...args),
        })),
      })),
    })),
    functions: { invoke: jest.fn() },
    rpc: jest.fn(),
  },
}));

jest.mock("../activity", () => ({
  __esModule: true,
  updateStreak: jest.fn(async () => undefined),
  updateSkillProgress: jest.fn(async () => undefined),
  incrementDailyActivity: jest.fn(async () => undefined),
  checkCefrPromotion: jest.fn(async () => undefined),
}));

jest.mock("../post-conversation-analysis", () => ({
  __esModule: true,
  extractPostConversationAnalysis: jest.fn(async () => ({ facts: [], errorPatterns: [] })),
  persistPostConversationAnalysis: jest.fn(async () => ({ feedback: undefined })),
}));

jest.mock("../error-tracker", () => ({
  __esModule: true,
  persistErrorPatterns: jest.fn(async () => undefined),
  trackError: jest.fn(async () => undefined),
}));

jest.mock("@mykin-ai/expo-audio-stream", () => ({
  ExpoPlayAudioStream: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setSoundConfig: jest.fn(async () => undefined),
    startRecording: jest.fn(async () => ({ subscription: { remove: jest.fn() } })),
    stopRecording: jest.fn(async () => undefined),
    playSound: jest.fn(),
    stopSound: jest.fn(async () => undefined),
    destroy: jest.fn(),
  },
}));

// Capture the audio-stream-manager's acquire / release calls so we can
// assert the orchestrator's lifecycle contract.
const mockAcquire = jest.fn();
const mockRelease = jest.fn(async () => undefined);

jest.mock("../audio-stream-manager", () => ({
  __esModule: true,
  acquireAudioStream: (...args: unknown[]) =>
    (mockAcquire as unknown as (...a: unknown[]) => unknown)(...args),
  releaseAudioStream: (...args: unknown[]) =>
    (mockRelease as unknown as (...a: unknown[]) => unknown)(...args),
}));

jest.mock("../realtime", () => ({
  __esModule: true,
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

const baseOptions: RealtimeOrchestratorOptions = {
  user: { id: "test-user-id" } as User,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Re-seed createConversationRecord happy-path resolution.
  mockSingle.mockImplementation(async () => ({ data: { id: "convo-test-id" }, error: null }));
});

// ============================================================================
// Drift detector — load-bearing audit-P1-19 closure
// ============================================================================

const ORCHESTRATOR_PATH = join(__dirname, "..", "realtime-orchestrator.ts");
const ORCHESTRATOR_SOURCE = readFileSync(ORCHESTRATOR_PATH, "utf-8");
const ORCHESTRATOR_CODE_ONLY = ORCHESTRATOR_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  ""
);

/**
 * Extract a method body from the comment-stripped orchestrator source by
 * finding the signature substring and slicing forward until the next
 * top-level method signature (any line at exactly 2-space indent starting
 * with `private`, `protected`, `public`, `async`, or an identifier followed
 * by `(`). Story 12-5 review-round-1 P12 + P13: anchors the drift regex to
 * a specific method body so a future refactor that moves the audio
 * lifecycle calls to an unrelated method fails CI loudly.
 */
function extractMethodBody(signatureStart: string): string {
  const idx = ORCHESTRATOR_CODE_ONLY.indexOf(signatureStart);
  if (idx < 0) {
    throw new Error(`Method signature not found: ${signatureStart}`);
  }
  // Find the next top-level method signature (or end of file) — this is
  // a heuristic but it's tight enough: any line at exactly 2 spaces
  // followed by an identifier + `(`, with no `}` closing brace on its
  // own at column 0 in between. We use a simple sentinel: search for
  // the NEXT signature line that we'd expect (any of the well-known
  // method names from the orchestrator class).
  const after = ORCHESTRATOR_CODE_ONLY.slice(idx + signatureStart.length);
  const nextSignatureRe = /\n {2}(?:private |protected |public |async |[a-zA-Z]+\s*\()/;
  const nextMatch = nextSignatureRe.exec(after);
  return nextMatch ? after.slice(0, nextMatch.index) : after;
}

describe("Story 12-5 — orchestrator audio-lifecycle drift detector (audit P1-19 closure)", () => {
  it("Case 1: `ExpoPlayAudioStream.destroy()` does NOT appear in realtime-orchestrator.ts code (negative guard)", () => {
    // The pre-12-5 bug was a direct `ExpoPlayAudioStream.destroy()` call
    // in `dispose()` that killed the singleton native module. Post-12-5
    // it must NEVER appear in code (comments stripped per Story 12-2
    // P12 lesson so JSDoc that mentions the pre-12-5 bug doesn't trip
    // the negative guard).
    expect(ORCHESTRATOR_CODE_ONLY).not.toMatch(/ExpoPlayAudioStream\.destroy\(\)/);
  });

  it("Case 2: `acquireAudioStream()` appears INSIDE `startAudioStreaming()` body (positive guard, review-round-1 P13 tightened)", () => {
    // P13: anchor the regex to the `startAudioStreaming` method body so a
    // future refactor that moves the call to an unrelated method (e.g.,
    // the constructor — which would acquire before consent + leak on the
    // permission-denied path) fails CI loudly.
    const body = extractMethodBody("private async startAudioStreaming(): Promise<void> {");
    expect(body).toMatch(/acquireAudioStream\(\)/);
    expect(body).toMatch(/this\.acquireWasCalled\s*=\s*true/);

    // And the import is present.
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(
      /import\s*\{[^}]*acquireAudioStream[^}]*\}\s*from\s*["']@\/src\/lib\/audio-stream-manager["']/
    );
  });

  it("Case 3: `releaseAudioStream()` appears INSIDE `dispose()` body gated on `acquireWasCalled` (positive guard, review-round-1 P12 tightened)", () => {
    // P12: anchor the regex to the `dispose()` method body so a release-call
    // in an unrelated method (e.g., a future cleanup helper) doesn't false-
    // positive the assertion. The body MUST contain the gated
    // `if (this.acquireWasCalled)` → `releaseAudioStream()` sequence.
    const body = extractMethodBody("dispose(): void {");
    expect(body).toMatch(/if\s*\(\s*this\.acquireWasCalled\s*\)[\s\S]*?releaseAudioStream\(\)/);
  });
});

// ============================================================================
// Lifecycle correctness — 1:1 acquire/release contract
// ============================================================================

describe("Story 12-5 — orchestrator audio-lifecycle 1:1 acquire/release contract", () => {
  it("Case 4: constructor → start() → dispose() calls acquireAudioStream once + releaseAudioStream once", async () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    // Drain microtasks for startAudioStreaming to run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();

    orchestrator.dispose();

    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("Case 5: start() failure BEFORE startAudioStreaming runs → dispose() does NOT call releaseAudioStream (no unmatched release)", async () => {
    // Make `createConversationRecord`'s supabase chain throw.
    // The `.single()` Supabase v2 builder returns
    // { data: null, error: { ... } } on Postgres-side failures;
    // `createConversationRecord` returns null on error which makes
    // start() throw before reaching `startAudioStreaming`.
    mockSingle.mockResolvedValueOnce({
      data: null as never,
      error: { message: "simulated insert failure" } as never,
    });

    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Acquire should NOT have run because start() bailed early.
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();

    orchestrator.dispose();

    // Critically: NO release was fired because acquireWasCalled is false.
    // This defends against the refcount-going-negative scenario.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("Case 6: double-dispose() calls releaseAudioStream EXACTLY ONCE (idempotent via isDisposed + acquireWasCalled reset)", async () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcquire).toHaveBeenCalledTimes(1);

    orchestrator.dispose();
    expect(mockRelease).toHaveBeenCalledTimes(1);

    // Second dispose call — the Story 12-1 P7 `isDisposed` short-circuit
    // returns early BEFORE the release block runs.
    orchestrator.dispose();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Story 12-5 review-round-1 patches — additional regression coverage
// ============================================================================

describe("Story 12-5 review-round-1 P3 — startAudioStreaming post-acquire throw still releases on dispose", () => {
  it("Case 7: requestPermissionsAsync throws AFTER acquireAudioStream ran → dispose() still releases (no refcount leak on partial-init)", async () => {
    // Inject a throw at requestPermissionsAsync, which is the FIRST awaited
    // call after the synchronous acquire pair. Pre-patch a throw here would
    // skip the dispose-release if `acquireWasCalled` somehow wasn't set,
    // leaking a refcount. Post-patch the orchestrator sets the flag
    // SYNCHRONOUSLY (right after acquire) so dispose() still releases.
    (
      MockedExpoPlayAudioStream.requestPermissionsAsync as unknown as jest.Mock
    ).mockRejectedValueOnce(new Error("simulated native-module crash"));

    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Acquire ran synchronously BEFORE the throw — and the bookkeeping
    // write ran on the same tick. So dispose() must still fire release.
    expect(mockAcquire).toHaveBeenCalledTimes(1);

    orchestrator.dispose();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("Story 12-5 review-round-1 P1 — start()-retry / end()→start() refcount-leak defense", () => {
  it("Case 8: end()→start() recycle (without dispose) leaves acquireWasCalled=true → start() reset block fires unmatched release before clearing the flag", async () => {
    // The pathological scenario: user ends a conversation (status:"ended")
    // and immediately starts a new one in the same screen. `end()` does NOT
    // fire `releaseAudioStream` (only `dispose()` does), and does NOT clear
    // `acquireWasCalled`. So the second `start()` sees `acquireWasCalled=true`
    // from the prior cycle. Without P1 the reset block would CLEAR the flag
    // without releasing — leaking one refcount per recycle and keeping the
    // singleton allocated for a ghost consumer.
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();

    // end() — sets status to "ended". Importantly: does NOT release, does
    // NOT clear acquireWasCalled, does NOT dispose. The orchestrator
    // instance is reusable for a fresh start().
    orchestrator.end();
    // end() runs persist work as fire-and-forget; drain it without affecting
    // the acquire flag.
    await Promise.resolve();
    await Promise.resolve();

    // The release SHOULD NOT have fired yet — only the reset block in the
    // upcoming start() fires it via the P1 defense.
    expect(mockRelease).not.toHaveBeenCalled();

    // Recycle: start a new conversation. The P1 reset block sees
    // acquireWasCalled=true and fires the rebalancing release BEFORE the
    // new startAudioStreaming() acquires again.
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The P1 reset-block guard fires release for the prior unmatched acquire.
    // The NEW startAudioStreaming() then acquires again, so total acquires = 2
    // and total releases = 1 (the rebalance fired by P1).
    expect(mockAcquire).toHaveBeenCalledTimes(2);
    expect(mockRelease).toHaveBeenCalledTimes(1);

    // Final dispose pairs the second acquire with a second release.
    orchestrator.dispose();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });
});
