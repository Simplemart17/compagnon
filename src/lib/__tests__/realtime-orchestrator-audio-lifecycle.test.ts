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

describe("Story 12-5 — orchestrator audio-lifecycle drift detector (audit P1-19 closure)", () => {
  it("Case 1: `ExpoPlayAudioStream.destroy()` does NOT appear in realtime-orchestrator.ts code (negative guard)", () => {
    // The pre-12-5 bug was a direct `ExpoPlayAudioStream.destroy()` call
    // in `dispose()` that killed the singleton native module. Post-12-5
    // it must NEVER appear in code (comments stripped per Story 12-2
    // P12 lesson so JSDoc that mentions the pre-12-5 bug doesn't trip
    // the negative guard).
    expect(ORCHESTRATOR_CODE_ONLY).not.toMatch(/ExpoPlayAudioStream\.destroy\(\)/);
  });

  it("Case 2: `acquireAudioStream()` appears in `startAudioStreaming()` (positive guard)", () => {
    // Loose match for `acquireAudioStream()` somewhere in the file —
    // the function is in startAudioStreaming() but a tighter regex
    // would need to span line boundaries inside the method body.
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(/acquireAudioStream\(\)/);
    // And the import is present.
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(
      /import\s*\{[^}]*acquireAudioStream[^}]*\}\s*from\s*["']@\/src\/lib\/audio-stream-manager["']/
    );
  });

  it("Case 3: `releaseAudioStream()` appears in `dispose()` gated on `acquireWasCalled` (positive guard)", () => {
    // The release call must be guarded by `if (this.acquireWasCalled)`
    // so unmatched releases (start-throws-before-acquire) don't fire.
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(
      /if\s*\(\s*this\.acquireWasCalled\s*\)[\s\S]*?releaseAudioStream\(\)/
    );
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
