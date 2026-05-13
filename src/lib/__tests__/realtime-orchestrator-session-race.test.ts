/**
 * Story 12-4 — RealtimeOrchestrator.start() race fix tests.
 *
 * Pre-12-4 the orchestrator assigned `this.session = session` AFTER
 * `await session.connect()` resolved, leaving a microtask window where
 * WebSocket messages arriving via `handleEvent` referenced a null
 * `this.session` and 13 sites in `handleEvent`-reachable paths
 * (sendFunctionResult × 11, sendRaw × 2) silently no-op'd via optional
 * chaining. Audit P2-21 closed by:
 *   (a) early-assign `this.session = session` BEFORE `await session.connect()`
 *   (b) catch-path cleanup `this.session = null` + reset synchronous mirrors
 *   (c) new `safeSessionCall(fn, context)` helper that emits a Sentry
 *       breadcrumb when `this.session === null` instead of silently no-op'ing
 *   (d) drift detector pins the early-assign source pattern
 */

import { readFileSync } from "fs";
import { join } from "path";

import { RealtimeOrchestrator, type RealtimeOrchestratorOptions } from "../realtime-orchestrator";
import { addBreadcrumb } from "../sentry";

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
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: { id: "convo-test-id" },
            error: null,
          }),
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

// Capture the registered handleEvent + the most recent mock session so tests
// can synchronize against them.
let mockRegisteredHandleEvent: ((event: unknown) => void) | null = null;
let mockLastSession: {
  on: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
  isConnected: boolean;
  sendText: jest.Mock;
  sendFunctionResult: jest.Mock;
  sendRaw: jest.Mock;
  appendAudio: jest.Mock;
} | null = null;

let mockConnectImpl: () => Promise<void> = async () => undefined;

jest.mock("../realtime", () => ({
  __esModule: true,
  RealtimeSession: jest.fn().mockImplementation(() => {
    mockLastSession = {
      on: jest.fn((cb: (event: unknown) => void) => {
        mockRegisteredHandleEvent = cb;
      }),
      connect: jest.fn(() => mockConnectImpl()),
      disconnect: jest.fn(),
      isConnected: false,
      sendText: jest.fn(),
      sendFunctionResult: jest.fn(),
      sendRaw: jest.fn(),
      appendAudio: jest.fn(),
    };
    return mockLastSession;
  }),
}));

const baseOptions: RealtimeOrchestratorOptions = {
  user: { id: "test-user-id" } as never,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRegisteredHandleEvent = null;
  mockLastSession = null;
  mockConnectImpl = async () => undefined;
});

// ============================================================================
// Drift detector — reads orchestrator source from disk + pins the early-assign
// invariant. Catches a future refactor that swaps the order.
// ============================================================================

const ORCHESTRATOR_PATH = join(__dirname, "..", "realtime-orchestrator.ts");
const ORCHESTRATOR_SOURCE = readFileSync(ORCHESTRATOR_PATH, "utf-8");

/**
 * Strip block comments and line comments before regex-matching so JSDoc that
 * mentions the patterns we're pinning (e.g., "// Pre-12-4 the assignment
 * happened AFTER the await...") doesn't trip the drift detector. Mirrors
 * Story 12-2's `HOOK_CODE_ONLY` pattern.
 */
const ORCHESTRATOR_CODE_ONLY = ORCHESTRATOR_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  ""
);

describe("Story 12-4 — drift detector: assign-before-await invariant", () => {
  it("Case 1: `this.session = session` appears BEFORE `await session.connect()` (positive guard)", () => {
    // Find the index of the assignment + the await in CODE-ONLY (comments stripped)
    const assignMatch = ORCHESTRATOR_CODE_ONLY.match(/this\.session\s*=\s*session\s*;/);
    const awaitMatch = ORCHESTRATOR_CODE_ONLY.match(/await\s+session\.connect\(\)/);
    expect(assignMatch).not.toBeNull();
    expect(awaitMatch).not.toBeNull();
    const assignIdx = ORCHESTRATOR_CODE_ONLY.indexOf(assignMatch![0]);
    const awaitIdx = ORCHESTRATOR_CODE_ONLY.indexOf(awaitMatch![0]);
    expect(assignIdx).toBeLessThan(awaitIdx);
  });

  it("Case 2: no `await session.connect();` followed by `this.session = session` (negative guard against pre-12-4)", () => {
    // The pre-12-4 pattern was `await session.connect();\n  this.session = session`.
    // Make sure that pattern doesn't exist anywhere in the code (comments stripped).
    expect(ORCHESTRATOR_CODE_ONLY).not.toMatch(
      /await\s+session\.connect\(\)\s*;\s*\n\s*this\.session\s*=\s*session\s*;/
    );
  });

  it("Case 3: catch path on connect() failure clears `this.session = null` + resets synchronous mirrors", () => {
    // The try/catch block around `await session.connect()` includes the cleanup
    expect(ORCHESTRATOR_SOURCE).toMatch(
      /try\s*\{\s*await\s+session\.connect\(\)\s*;\s*\}\s*catch[\s\S]+?this\.session\s*=\s*null/
    );
    expect(ORCHESTRATOR_SOURCE).toMatch(/catch[\s\S]+?this\.isAiSpeakingMirror\s*=\s*false/);
    expect(ORCHESTRATOR_SOURCE).toMatch(/catch[\s\S]+?this\.responseInFlight\s*=\s*false/);
  });

  it("Case 4: safeSessionCall helper exists with the expected signature", () => {
    expect(ORCHESTRATOR_SOURCE).toMatch(
      /private safeSessionCall<T>\(\s*fn:\s*\(session:\s*RealtimeSession\)\s*=>\s*T,\s*context:\s*string\s*\):\s*T\s*\|\s*undefined/
    );
  });

  it("Case 5: safeSessionCall emits the canonical breadcrumb when session is null", () => {
    expect(ORCHESTRATOR_SOURCE).toMatch(/message:\s*"orchestrator-session-null-on-event"/);
    expect(ORCHESTRATOR_SOURCE).toMatch(/feature:\s*"orchestrator-session-null-on-event"/);
  });
});

// ============================================================================
// Runtime: connect-failure cleanup
// ============================================================================

describe("Story 12-4 — connect-failure cleanup", () => {
  it("Case 6: failed connect() leaves this.session === null (no orphan reference)", async () => {
    mockConnectImpl = async () => {
      throw new Error("simulated connect failure");
    };
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    // Allow microtasks to settle so the catch path runs.
    await Promise.resolve();
    await Promise.resolve();
    // Use a probe to read the private state: a fresh `safeSessionCall` ping
    // from outside is impossible; instead infer from a follow-up `end()` call
    // that disconnect is NOT called on a stale session.
    orchestrator.end();
    expect(mockLastSession?.disconnect).not.toHaveBeenCalled();
    orchestrator.dispose();
  });
});

// ============================================================================
// safeSessionCall helper behavior (exercised via the orchestrator's tool-call
// dispatch). We can't construct the helper directly because it's private, so
// we exercise it through the public surface.
// ============================================================================

describe("Story 12-4 — safeSessionCall helper behavior", () => {
  it("Case 7: with non-null session, tool-call dispatch invokes sendFunctionResult and does NOT emit the null breadcrumb", async () => {
    mockConnectImpl = async () => undefined;
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();

    // After start() succeeds, this.session is populated. Simulate an OpenAI
    // function-call event dispatching through handleEvent.
    expect(mockRegisteredHandleEvent).not.toBeNull();
    expect(mockLastSession).not.toBeNull();

    // Dispatch a save_vocabulary tool call with missing fields → triggers the
    // first `safeSessionCall` site at `tool-call-save-vocabulary`.
    mockRegisteredHandleEvent!({
      type: "response.function_call_arguments.done",
      name: "save_vocabulary",
      arguments: JSON.stringify({}), // missing fields
      call_id: "test-call-1",
    });

    // Allow microtasks to drain the async handleFunctionCall.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLastSession!.sendFunctionResult).toHaveBeenCalledWith(
      "test-call-1",
      "Missing required fields."
    );
    // No null-session breadcrumb fired because session was populated.
    const breadcrumbCalls = (addBreadcrumb as jest.Mock).mock.calls;
    const nullBreadcrumbs = breadcrumbCalls.filter(
      (c) => c[0]?.message === "orchestrator-session-null-on-event"
    );
    expect(nullBreadcrumbs).toHaveLength(0);

    orchestrator.dispose();
  });

  it("Case 8: with null session (post-end), tool-call dispatch emits the null-breadcrumb AND does NOT invoke sendFunctionResult", async () => {
    mockConnectImpl = async () => undefined;
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();

    // Capture the handler reference + mock session BEFORE end() nulls them.
    const handler = mockRegisteredHandleEvent;
    const sessionMock = mockLastSession;
    expect(handler).not.toBeNull();
    expect(sessionMock).not.toBeNull();

    // end() nulls this.session WITHOUT setting isDisposed (unlike dispose
    // which short-circuits handleEvent via the Story 12-1 P7 isDisposed guard).
    // This gives us a clean null-session-but-still-dispatching scenario.
    orchestrator.end();

    // Clear breadcrumb mock calls + sendFunctionResult from prior setup.
    (addBreadcrumb as jest.Mock).mockClear();
    sessionMock!.sendFunctionResult.mockClear();

    // Dispatch a tool-call AFTER end(). The handler still runs but
    // `this.session === null` → safeSessionCall emits the breadcrumb.
    handler!({
      type: "response.function_call_arguments.done",
      name: "save_vocabulary",
      arguments: JSON.stringify({}),
      call_id: "test-call-2",
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The null breadcrumb should have fired.
    const breadcrumbCalls = (addBreadcrumb as jest.Mock).mock.calls;
    const nullBreadcrumb = breadcrumbCalls.find(
      (c) => c[0]?.message === "orchestrator-session-null-on-event"
    );
    expect(nullBreadcrumb).toBeDefined();
    expect(nullBreadcrumb![0]).toMatchObject({
      category: "realtime",
      level: "warning",
      message: "orchestrator-session-null-on-event",
      data: expect.objectContaining({
        feature: "orchestrator-session-null-on-event",
        context: "tool-call-save-vocabulary",
      }),
    });
    // And sendFunctionResult was NOT called on the (now-nulled) session.
    expect(sessionMock!.sendFunctionResult).not.toHaveBeenCalled();

    orchestrator.dispose();
  });
});

// ============================================================================
// Story 11-1 + Story 11-2 path regressions through the helper
// ============================================================================

describe("Story 12-4 — Story 11-1 / 11-2 paths preserved via helper", () => {
  it("Case 9: report_correction tool-call routes through safeSessionCall (Story 11-1)", async () => {
    mockConnectImpl = async () => undefined;
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();

    // First inject a response.created so responseInFlight = true; otherwise
    // the report_correction call would short-circuit on "outside-turn".
    mockRegisteredHandleEvent!({ type: "response.created", response: { id: "resp-1" } });
    // Inject a content delta to set inflightItemId.
    mockRegisteredHandleEvent!({
      type: "response.output_audio_transcript.delta",
      item_id: "item-1",
      delta: "Bonjour",
    });

    // Now invoke report_correction with valid args.
    mockRegisteredHandleEvent!({
      type: "response.function_call_arguments.done",
      name: "report_correction",
      arguments: JSON.stringify({
        original: "je suis allée",
        corrected: "je suis allé",
        explanation: "agreement",
        category: "grammar",
      }),
      call_id: "test-correction-1",
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The function-result ack should fire via the helper.
    expect(mockLastSession!.sendFunctionResult).toHaveBeenCalledWith(
      "test-correction-1",
      expect.any(String)
    );

    orchestrator.dispose();
  });

  it("Case 10: barge-in path's sendRaw routes through safeSessionCall (Story 11-2)", async () => {
    mockConnectImpl = async () => undefined;
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    await orchestrator.start();
    await Promise.resolve();
    await Promise.resolve();

    // Stage: AI is speaking with a known inflight item + startedAt.
    // Dispatch response.created + output_audio_transcript.delta to set up state.
    mockRegisteredHandleEvent!({ type: "response.created", response: { id: "resp-bargein" } });
    mockRegisteredHandleEvent!({
      type: "response.output_audio.delta",
      item_id: "item-bargein",
      delta: "audio-base64",
    });

    // Now user starts speaking → barge-in fires sendRaw(response.cancel).
    mockRegisteredHandleEvent!({ type: "input_audio_buffer.speech_started" });

    await Promise.resolve();

    // sendRaw should be called via safeSessionCall (helper passes through).
    expect(mockLastSession!.sendRaw).toHaveBeenCalledWith(
      expect.objectContaining({ type: "response.cancel" })
    );

    orchestrator.dispose();
  });
});
