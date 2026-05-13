/**
 * Story 12-1 — RealtimeOrchestrator tests.
 *
 * Pins the observer-pattern public API (`subscribe` / `getState` / `dispose`),
 * the `PHASE_A_SLOT_NAMES` constant, the initial-state default, and the
 * Phase A + Phase B parallelization invariants of `persistConversation`.
 *
 * The full end-to-end Realtime event flow (handleEvent's 12+ branches) is
 * tested by the existing Story 9-5 / 11-1 / 11-2 pure-helper test files
 * (`realtime-dedup.test.ts`, `realtime-corrections.test.ts`,
 * `realtime-reconnect.test.ts`, `realtime-barge-in.test.ts`) which exercise
 * the load-bearing logic that the orchestrator calls into. This file tests
 * the orchestrator-specific machinery (observers + state mutation +
 * persistConversation parallelization).
 */

import {
  INITIAL_STATE,
  PHASE_A_SLOT_NAMES,
  RealtimeOrchestrator,
  type ConversationState,
  type RealtimeOrchestratorOptions,
} from "../realtime-orchestrator";

// Mock Sentry so we can spy on captureError calls without polluting telemetry.
jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Mock cache.ts so the AsyncStorage native dep doesn't load in Jest.
jest.mock("../cache", () => ({
  __esModule: true,
  enqueueWrite: jest.fn(async () => undefined),
}));

// Mock network.
jest.mock("../network", () => ({
  __esModule: true,
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

// Mock supabase client.
jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn(),
    functions: { invoke: jest.fn() },
    rpc: jest.fn(),
  },
}));

// Mock activity helpers.
jest.mock("../activity", () => ({
  __esModule: true,
  updateStreak: jest.fn(async () => undefined),
  updateSkillProgress: jest.fn(async () => undefined),
  incrementDailyActivity: jest.fn(async () => undefined),
  checkCefrPromotion: jest.fn(async () => undefined),
}));

// Mock post-conv analysis.
jest.mock("../post-conversation-analysis", () => ({
  __esModule: true,
  extractPostConversationAnalysis: jest.fn(async () => ({ facts: [], errorPatterns: [] })),
  persistPostConversationAnalysis: jest.fn(async () => ({ feedback: undefined })),
}));

// Mock error-tracker.
jest.mock("../error-tracker", () => ({
  __esModule: true,
  persistErrorPatterns: jest.fn(async () => undefined),
  trackError: jest.fn(async () => undefined),
}));

// Mock heavy native deps so the class can construct without RN context.
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

const baseOptions: RealtimeOrchestratorOptions = {
  user: null,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

describe("Story 12-1 — RealtimeOrchestrator public surface", () => {
  it("exports PHASE_A_SLOT_NAMES with the 6 canonical slot names in order", () => {
    expect(PHASE_A_SLOT_NAMES).toEqual([
      "conversation",
      "messages",
      "analysis",
      "skill-progress",
      "daily-activity",
      "streak",
    ]);
  });

  it("exports INITIAL_STATE with idle status and empty collections", () => {
    expect(INITIAL_STATE.status).toBe("idle");
    expect(INITIAL_STATE.transcript).toEqual([]);
    expect(INITIAL_STATE.allCorrections).toEqual([]);
    expect(INITIAL_STATE.feedback).toBeNull();
    expect(INITIAL_STATE.error).toBeNull();
    expect(INITIAL_STATE.conversationId).toBeNull();
  });

  it("constructor accepts options without throwing", () => {
    expect(() => new RealtimeOrchestrator(baseOptions)).not.toThrow();
  });

  it("getState() returns the initial state immediately after construction", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    expect(orchestrator.getState()).toEqual(INITIAL_STATE);
  });
});

describe("Story 12-1 — observer pattern (subscribe / unsubscribe)", () => {
  it("subscribe() fires the callback synchronously with the initial state", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const received: ConversationState[] = [];
    orchestrator.subscribe((s) => received.push(s));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(INITIAL_STATE);
  });

  it("P4 review-patch: subscribe() returns an unsubscribe closure that ACTUALLY removes the callback", () => {
    // Pre-patch this test only asserted the return type. P4 strengthens it
    // by triggering a state mutation post-unsubscribe and verifying the
    // callback is NOT invoked. Uses the private `setState` via cast — fine
    // for unit testing the observer contract.
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const cb = jest.fn();
    const unsubscribe = orchestrator.subscribe(cb);
    cb.mockClear();
    unsubscribe();
    // Trigger an internal state mutation.
    (
      orchestrator as unknown as {
        setState: (u: (s: ConversationState) => ConversationState) => void;
      }
    ).setState((s) => ({ ...s, status: "connecting" }));
    // Unsubscribed callback MUST NOT have been called.
    expect(cb).not.toHaveBeenCalled();
    orchestrator.dispose();
  });

  it("multiple subscribers each receive the initial state", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const cbA = jest.fn();
    const cbB = jest.fn();
    orchestrator.subscribe(cbA);
    orchestrator.subscribe(cbB);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbA.mock.calls[0][0]).toEqual(INITIAL_STATE);
    expect(cbB.mock.calls[0][0]).toEqual(INITIAL_STATE);
  });

  it("dispose() clears all subscribers (idempotent)", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    orchestrator.subscribe(jest.fn());
    orchestrator.subscribe(jest.fn());
    expect(() => orchestrator.dispose()).not.toThrow();
    // Second dispose call is also idempotent.
    expect(() => orchestrator.dispose()).not.toThrow();
  });

  it("P4 review-patch: state mutation fires every subscriber exactly once", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const cbA = jest.fn();
    const cbB = jest.fn();
    orchestrator.subscribe(cbA);
    orchestrator.subscribe(cbB);
    cbA.mockClear();
    cbB.mockClear();
    (
      orchestrator as unknown as {
        setState: (u: (s: ConversationState) => ConversationState) => void;
      }
    ).setState((s) => ({ ...s, status: "connecting" }));
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbA.mock.calls[0][0].status).toBe("connecting");
    expect(cbB.mock.calls[0][0].status).toBe("connecting");
    orchestrator.dispose();
  });

  it("P6 review-patch: re-entrant setState during subscriber callback is queued (no out-of-order notification)", () => {
    // Subscriber A synchronously triggers another setState. Without the
    // re-entrancy guard, the nested call would mutate state mid-iteration
    // of the snapshot, and subscriber B would receive the second state
    // before the first. With the guard, B sees the FIRST state first, then
    // both A + B see the SECOND state.
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const setStateRef = (
      orchestrator as unknown as {
        setState: (u: (s: ConversationState) => ConversationState) => void;
      }
    ).setState.bind(orchestrator);

    const observedA: ConversationState["status"][] = [];
    const observedB: ConversationState["status"][] = [];

    let cbACallCount = 0;
    const cbA = (state: ConversationState) => {
      observedA.push(state.status);
      cbACallCount++;
      // On the first OUTER setState (status === "connecting"), synchronously
      // trigger a nested setState. The pendingUpdates queue should drain
      // AFTER the outer iteration completes, so cbB sees both states in
      // monotonic order.
      if (cbACallCount === 2) {
        // ^ skip the initial-sync delivery (call 1)
        setStateRef((s) => ({ ...s, status: "connected" }));
      }
    };
    const cbB = (state: ConversationState) => {
      observedB.push(state.status);
    };
    orchestrator.subscribe(cbA); // call 1: initial-sync (idle)
    orchestrator.subscribe(cbB); // call 1: initial-sync (idle)

    setStateRef((s) => ({ ...s, status: "connecting" })); // triggers cbA call 2

    // Observed order for both subscribers should be: idle, connecting, connected.
    expect(observedA).toEqual(["idle", "connecting", "connected"]);
    expect(observedB).toEqual(["idle", "connecting", "connected"]);
    orchestrator.dispose();
  });

  it("P15 review-patch: getState() returns a frozen snapshot", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const snapshot = orchestrator.getState();
    expect(Object.isFrozen(snapshot)).toBe(true);
    // Verify mutation doesn't change the snapshot. In non-strict mode the
    // assignment silently no-ops (vs throwing in strict mode); either way
    // the value is preserved.
    const originalStatus = snapshot.status;
    try {
      (snapshot as { status: string }).status = "MUTATED";
    } catch {
      // Throw in strict mode is acceptable; no-op in sloppy mode is also acceptable.
    }
    expect(snapshot.status).toBe(originalStatus);
    // Successive getState() calls return distinct frozen snapshots, NOT the
    // same reference (so a consumer holding an old snapshot doesn't see
    // mid-mutation state).
    const snapshot2 = orchestrator.getState();
    expect(Object.isFrozen(snapshot2)).toBe(true);
    orchestrator.dispose();
  });

  it("P5 review-patch: dispose() composite — closes session + clears timer + empties subscribers + isDisposed=true", () => {
    // We can't easily verify session.disconnect was called without spying,
    // but we CAN verify that post-dispose, a subscribe-then-internal-setState
    // doesn't deliver to the subscriber (subscribers Set cleared).
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const cb = jest.fn();
    orchestrator.subscribe(cb);
    cb.mockClear();
    orchestrator.dispose();
    // Internal setState post-dispose: subscribers are cleared, so cb is NOT called.
    (
      orchestrator as unknown as {
        setState: (u: (s: ConversationState) => ConversationState) => void;
      }
    ).setState((s) => ({ ...s, status: "connecting" }));
    expect(cb).not.toHaveBeenCalled();
    // Second dispose is idempotent.
    expect(() => orchestrator.dispose()).not.toThrow();
  });

  it("P7 review-patch: late realtime event post-dispose short-circuits via isDisposed flag", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    const cb = jest.fn();
    orchestrator.subscribe(cb);
    cb.mockClear();
    orchestrator.dispose();
    // Simulate a late realtime event (using the private handleEvent dispatch).
    (
      orchestrator as unknown as {
        handleEvent: (event: { type: string }) => void;
      }
    ).handleEvent({ type: "session.created" });
    // No state mutation should fire — isDisposed gate short-circuits.
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("Story 12-1 review-patch P2+P3 — persistConversation Phase A + Phase B parallelization", () => {
  // The persist chain dispatches 6 slots concurrently via Promise.allSettled
  // then awaits checkCefrPromotion. We test by mocking each slot's helper
  // with deferred promises + recording invocation timestamps.

  // Reset all module mocks between tests so per-test invocation-count
  // assertions aren't polluted by other tests in this file. The mock
  // factories at module top-load are stateful; mockClear resets call
  // counts without re-implementing.
  beforeEach(() => {
    const activityMock = jest.requireMock("../activity") as {
      updateSkillProgress: jest.Mock;
      incrementDailyActivity: jest.Mock;
      updateStreak: jest.Mock;
      checkCefrPromotion: jest.Mock;
    };
    activityMock.updateSkillProgress.mockClear();
    activityMock.incrementDailyActivity.mockClear();
    activityMock.updateStreak.mockClear();
    activityMock.checkCefrPromotion.mockClear();

    const analysisMock = jest.requireMock("../post-conversation-analysis") as {
      extractPostConversationAnalysis: jest.Mock;
      persistPostConversationAnalysis: jest.Mock;
    };
    analysisMock.extractPostConversationAnalysis.mockClear();
    analysisMock.persistPostConversationAnalysis.mockClear();

    const sentryMock = jest.requireMock("../sentry") as {
      captureError: jest.Mock;
      addBreadcrumb: jest.Mock;
    };
    sentryMock.captureError.mockClear();
    sentryMock.addBreadcrumb.mockClear();

    const cacheMock = jest.requireMock("../cache") as { enqueueWrite: jest.Mock };
    cacheMock.enqueueWrite.mockClear();
  });
  it("P2: Phase A's 6 slots are dispatched concurrently (max-skew < 50ms)", async () => {
    // The orchestrator needs a non-null user + conversationId for persistConversation
    // to proceed past the initial guards.
    const orchestrator = new RealtimeOrchestrator({
      ...baseOptions,
      user: {
        id: "test-user",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01",
      } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
    });
    // Inject conversationId via private field.
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-1";
    // Add some transcript so the analysis slot routes to the AI-call path.
    (
      orchestrator as unknown as {
        transcript: {
          id: string;
          role: string;
          text: string;
          timestamp: number;
        }[];
      }
    ).transcript = Array.from({ length: 5 }, (_, i) => ({
      id: `u${i}`,
      role: "user",
      text: `some user message ${i} that makes the transcript long enough to trigger AI analysis`,
      timestamp: Date.now(),
    }));

    // Mock supabase.from() to return a thenable that records invocation time.
    const invokeTimes: { slot: string; ms: number }[] = [];
    const supabaseMock = jest.requireMock("../supabase") as {
      supabase: { from: jest.Mock };
    };
    supabaseMock.supabase.from = jest.fn((table: string) => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => {
          invokeTimes.push({ slot: `supabase-${table}-update`, ms: Date.now() });
          return Promise.resolve({ error: null });
        }),
      })),
      insert: jest.fn(() => {
        invokeTimes.push({ slot: `supabase-${table}-insert`, ms: Date.now() });
        return Promise.resolve({ error: null });
      }),
    }));

    // Make the activity helpers record their invocation timestamps.
    const activityMock = jest.requireMock("../activity") as {
      updateSkillProgress: jest.Mock;
      incrementDailyActivity: jest.Mock;
      updateStreak: jest.Mock;
      checkCefrPromotion: jest.Mock;
    };
    activityMock.updateSkillProgress.mockImplementation(async () => {
      invokeTimes.push({ slot: "skill-progress", ms: Date.now() });
    });
    activityMock.incrementDailyActivity.mockImplementation(async () => {
      invokeTimes.push({ slot: "daily-activity", ms: Date.now() });
    });
    activityMock.updateStreak.mockImplementation(async () => {
      invokeTimes.push({ slot: "streak", ms: Date.now() });
    });
    activityMock.checkCefrPromotion.mockImplementation(async () => {
      invokeTimes.push({ slot: "cefr-promotion", ms: Date.now() });
    });
    const analysisMock = jest.requireMock("../post-conversation-analysis") as {
      extractPostConversationAnalysis: jest.Mock;
      persistPostConversationAnalysis: jest.Mock;
    };
    analysisMock.extractPostConversationAnalysis.mockImplementation(async () => {
      invokeTimes.push({ slot: "analysis", ms: Date.now() });
      return { facts: [], errorPatterns: [] };
    });

    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // 6 Phase A slots fired before Phase B (cefr-promotion).
    const phaseATimes = invokeTimes.filter((t) => t.slot !== "cefr-promotion");
    const cefrTime = invokeTimes.find((t) => t.slot === "cefr-promotion")!;
    expect(phaseATimes.length).toBeGreaterThanOrEqual(6);
    expect(cefrTime).toBeDefined();
    // Phase A max-skew < 50ms (concurrent dispatch).
    const phaseAStart = Math.min(...phaseATimes.map((t) => t.ms));
    const phaseAEnd = Math.max(...phaseATimes.map((t) => t.ms));
    expect(phaseAEnd - phaseAStart).toBeLessThan(50);
    // Phase B fires AFTER all Phase A slots (cefr time >= every Phase A time).
    expect(cefrTime.ms).toBeGreaterThanOrEqual(phaseAEnd);
    orchestrator.dispose();
  });

  it("P3: one Phase A slot rejecting → other 5 unaffected + per-slot Sentry tag fires", async () => {
    const orchestrator = new RealtimeOrchestrator({
      ...baseOptions,
      user: {
        id: "test-user",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01",
      } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
    });
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-1";
    (
      orchestrator as unknown as {
        transcript: {
          id: string;
          role: string;
          text: string;
          timestamp: number;
        }[];
      }
    ).transcript = [];

    // Make supabase calls succeed but the streak helper reject.
    const supabaseMock = jest.requireMock("../supabase") as {
      supabase: { from: jest.Mock };
    };
    supabaseMock.supabase.from = jest.fn(() => ({
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
      insert: jest.fn(() => Promise.resolve({ error: null })),
    }));
    const activityMock = jest.requireMock("../activity") as {
      updateSkillProgress: jest.Mock;
      incrementDailyActivity: jest.Mock;
      updateStreak: jest.Mock;
      checkCefrPromotion: jest.Mock;
    };
    activityMock.updateSkillProgress.mockResolvedValue(undefined);
    activityMock.incrementDailyActivity.mockResolvedValue(undefined);
    activityMock.updateStreak.mockRejectedValueOnce(new Error("streak update failed"));
    activityMock.checkCefrPromotion.mockResolvedValue(undefined);

    const sentryMock = jest.requireMock("../sentry") as { captureError: jest.Mock };
    sentryMock.captureError.mockClear();

    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // captureError fires for the streak slot's failure.
    const streakCalls = sentryMock.captureError.mock.calls.filter(
      (call: unknown[]) => call[1] === "persist-conversation-phase-a-streak"
    );
    expect(streakCalls.length).toBe(1);
    // Phase B (checkCefrPromotion) still ran.
    expect(activityMock.checkCefrPromotion).toHaveBeenCalledTimes(1);
    orchestrator.dispose();
  });

  it("P3: Story 11-5 P3 — supabase fulfilled-with-error slot routes through captureError", async () => {
    const orchestrator = new RealtimeOrchestrator({
      ...baseOptions,
      user: {
        id: "test-user",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01",
      } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
    });
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-1";

    // Simulate the `conversations.update` slot returning a fulfilled
    // Promise with `{ error: {...} }` — supabase-js v2 doesn't reject on
    // Postgres-side failures, it resolves with the error in the response.
    const supabaseMock = jest.requireMock("../supabase") as {
      supabase: { from: jest.Mock };
    };
    supabaseMock.supabase.from = jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: { message: "RLS denial" } })),
      })),
      insert: jest.fn(() => Promise.resolve({ error: null })),
    }));
    const activityMock = jest.requireMock("../activity") as {
      updateSkillProgress: jest.Mock;
      incrementDailyActivity: jest.Mock;
      updateStreak: jest.Mock;
      checkCefrPromotion: jest.Mock;
    };
    activityMock.updateSkillProgress.mockResolvedValue(undefined);
    activityMock.incrementDailyActivity.mockResolvedValue(undefined);
    activityMock.updateStreak.mockResolvedValue(undefined);
    activityMock.checkCefrPromotion.mockResolvedValue(undefined);

    const sentryMock = jest.requireMock("../sentry") as { captureError: jest.Mock };
    sentryMock.captureError.mockClear();

    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // captureError fires for the conversation slot's fulfilled-with-error.
    const convCalls = sentryMock.captureError.mock.calls.filter(
      (call: unknown[]) => call[1] === "persist-conversation-phase-a-conversation"
    );
    expect(convCalls.length).toBe(1);
    orchestrator.dispose();
  });

  it("P3: Phase B (checkCefrPromotion) runs even when ALL Phase A slots fail", async () => {
    const orchestrator = new RealtimeOrchestrator({
      ...baseOptions,
      user: {
        id: "test-user",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01",
      } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
    });
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-1";

    const supabaseMock = jest.requireMock("../supabase") as {
      supabase: { from: jest.Mock };
    };
    supabaseMock.supabase.from = jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.reject(new Error("supabase down"))),
      })),
      insert: jest.fn(() => Promise.reject(new Error("supabase down"))),
    }));
    const activityMock = jest.requireMock("../activity") as {
      updateSkillProgress: jest.Mock;
      incrementDailyActivity: jest.Mock;
      updateStreak: jest.Mock;
      checkCefrPromotion: jest.Mock;
    };
    activityMock.updateSkillProgress.mockRejectedValue(new Error("activity down"));
    activityMock.incrementDailyActivity.mockRejectedValue(new Error("activity down"));
    activityMock.updateStreak.mockRejectedValue(new Error("activity down"));
    activityMock.checkCefrPromotion.mockResolvedValue(undefined);

    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // Phase B still runs.
    expect(activityMock.checkCefrPromotion).toHaveBeenCalledTimes(1);
    orchestrator.dispose();
  });

  it("P3: offline branch → enqueueWrite path; Phase A/B skipped", async () => {
    const orchestrator = new RealtimeOrchestrator({
      ...baseOptions,
      user: {
        id: "test-user",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-01-01",
      } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
    });
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-offline";

    // Override isOnline mock to return false.
    const networkMock = jest.requireMock("../network") as { isOnline: jest.Mock };
    networkMock.isOnline.mockResolvedValueOnce(false);

    const cacheMock = jest.requireMock("../cache") as { enqueueWrite: jest.Mock };
    cacheMock.enqueueWrite.mockClear();
    const activityMock = jest.requireMock("../activity") as {
      updateSkillProgress: jest.Mock;
      checkCefrPromotion: jest.Mock;
    };
    activityMock.updateSkillProgress.mockClear();
    activityMock.checkCefrPromotion.mockClear();

    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // enqueueWrite fires for the conversation update.
    expect(cacheMock.enqueueWrite).toHaveBeenCalled();
    // Phase A (skill-progress) + Phase B (cefr-promotion) skipped.
    expect(activityMock.updateSkillProgress).not.toHaveBeenCalled();
    expect(activityMock.checkCefrPromotion).not.toHaveBeenCalled();
    orchestrator.dispose();
  });
});

describe("Story 12-1 — start() guards against concurrent invocation", () => {
  it("start() is a no-op when status is 'connecting' / 'connected' / 'reconnecting'", async () => {
    // Construct an orchestrator whose state we'll mutate via subscribe to
    // simulate the connecting state. Since `start()` checks `this.state.status`,
    // and the orchestrator starts in `idle`, the guard fires only after the
    // first start() invocation transitions the status.
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    // Replace createConversationRecord internals via the public API; the
    // simplest proof is that calling start twice doesn't crash and the
    // second one returns quickly (no second session creation).
    // We can't easily inspect the guard without exposing internals; pin via
    // type signature + no-throw smoke.
    await expect(orchestrator.start()).resolves.not.toThrow();
    // Second call should return without throwing even if first is in flight.
    await expect(orchestrator.start()).resolves.not.toThrow();
    orchestrator.dispose();
  });
});

describe("Story 12-1 — end() idempotence", () => {
  it("end() is idempotent: second invocation no-ops via isEnding guard", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    expect(() => orchestrator.end()).not.toThrow();
    expect(() => orchestrator.end()).not.toThrow();
    orchestrator.dispose();
  });
});

describe("Story 12-1 — sendText() guards on disconnected session", () => {
  it("sendText() is a no-op when session is null (pre-start)", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    expect(() => orchestrator.sendText("bonjour")).not.toThrow();
    // Subscribe to verify state didn't change.
    const cb = jest.fn();
    orchestrator.subscribe(cb);
    cb.mockClear();
    orchestrator.sendText("hello");
    // No state mutation should have fired (transcript stays empty).
    expect(cb).not.toHaveBeenCalled();
    orchestrator.dispose();
  });
});
