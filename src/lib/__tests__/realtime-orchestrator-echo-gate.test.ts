/**
 * Ship-blocker voice fixes — behavioral proof of the echo/turn-taking gate.
 *
 * These tests drive the orchestrator's `handleEvent` switch directly with
 * synthetic Realtime events + a controlled `Date.now()` and assert the actual
 * mic-forwarding gate timing (`isMicForwardingSuppressed()`), NOT just source
 * structure. They pin the two criticals found in the flagship voice audit:
 *
 *   C2 — the post-`audio.done` speaker-drain cooldown must ACTUALLY keep the
 *        mic gated through the ~800ms tail. Pre-fix the cooldown was inert: the
 *        gate read `isAiSpeakingMirror`, `setState` re-synced the mirror false
 *        on `audio.done`, and the gate reopened instantly → speaker tail bled
 *        into the mic → server VAD → stacked "Companion" bubbles.
 *
 *   C3 — `response.output_audio.done` is NOT guaranteed (cancelled / content-
 *        filtered / incomplete responses skip it). If it's skipped, the
 *        terminal `response.done` must still reset AI-speaking so the mic gate
 *        cannot latch closed forever (unrecoverable "dead mic").
 *
 * Harness mirrors `realtime-orchestrator-render-storm.test.ts`.
 */

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
          single: jest.fn(async () => ({ data: { id: "convo-echo-test" }, error: null })),
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
    id: "test-user-echo-gate",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01",
  } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

/** Shape exposing the private gate internals for behavioral assertions. */
type EchoProbe = {
  handleEvent: (event: unknown) => void;
  isMicForwardingSuppressed: () => boolean;
  endAiSpeechWindow: () => void;
  getState: () => { isAiSpeaking: boolean; status: string };
  setState: (updater: (s: Record<string, unknown>) => Record<string, unknown>) => void;
};

const COOLDOWN_MS = 800; // must match RealtimeOrchestrator.AI_SPEECH_COOLDOWN_MS

let nowMs = 0;
let dateNowSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  __resetAudioStreamManagerForTests();
  nowMs = 1_000_000;
  dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => nowMs);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

function makeProbe(): { orch: RealtimeOrchestrator; probe: EchoProbe } {
  const orch = new RealtimeOrchestrator(baseOptions);
  return { orch, probe: orch as unknown as EchoProbe };
}

describe("voice echo/turn-taking gate — behavioral (ship-blocker C2/C3)", () => {
  it("C2: mic stays gated through the full speaker-drain window AFTER audio.done", () => {
    const { orch, probe } = makeProbe();

    // AI starts speaking → mic suppressed while audio streams.
    probe.handleEvent({ type: "response.output_audio.delta", delta: "AAAA" });
    expect(orch.getState().isAiSpeaking).toBe(true);
    expect(probe.isMicForwardingSuppressed()).toBe(true);

    // audio.done arrives. UI must flip "not speaking" immediately (orb stops)…
    nowMs = 2_000_000;
    probe.handleEvent({ type: "response.output_audio.done" });
    expect(orch.getState().isAiSpeaking).toBe(false);

    // …BUT the mic gate must stay CLOSED through the speaker tail. This is the
    // exact behavior the pre-fix (inert) cooldown failed to provide — the gate
    // reopened the instant audio.done fired.
    expect(probe.isMicForwardingSuppressed()).toBe(true);

    // Still gated 1ms before the window closes.
    nowMs = 2_000_000 + COOLDOWN_MS - 1;
    expect(probe.isMicForwardingSuppressed()).toBe(true);

    // Reopens exactly at the cooldown boundary.
    nowMs = 2_000_000 + COOLDOWN_MS;
    expect(probe.isMicForwardingSuppressed()).toBe(false);
  });

  it("C3: response.done without audio.done resets AI-speaking + applies cooldown (no dead mic)", () => {
    const { orch, probe } = makeProbe();

    probe.handleEvent({ type: "response.output_audio.delta", delta: "AAAA" });
    expect(probe.isMicForwardingSuppressed()).toBe(true);

    // Terminal response.done arrives but audio.done was SKIPPED (cancelled /
    // content-filtered / packet loss).
    nowMs = 3_000_000;
    probe.handleEvent({ type: "response.done" });

    // AI-speaking is reset (pre-fix it latched true forever → dead mic).
    expect(orch.getState().isAiSpeaking).toBe(false);
    // Cooldown applied because we were mid-speech → tail still defended.
    expect(probe.isMicForwardingSuppressed()).toBe(true);
    // And critically, the gate DOES reopen after the window — not stuck.
    nowMs = 3_000_000 + COOLDOWN_MS;
    expect(probe.isMicForwardingSuppressed()).toBe(false);
  });

  it("C3: response.done AFTER audio.done does not re-arm / extend the cooldown", () => {
    const { probe } = makeProbe();

    probe.handleEvent({ type: "response.output_audio.delta", delta: "AAAA" });

    nowMs = 4_000_000;
    probe.handleEvent({ type: "response.output_audio.done" }); // cooldown → 4_000_800

    // response.done lands 100ms later; mirror already false, so it must NOT
    // push the cooldown out to 4_000_900.
    nowMs = 4_000_100;
    probe.handleEvent({ type: "response.done" });

    nowMs = 4_000_000 + COOLDOWN_MS - 1; // 4_000_799 — still gated
    expect(probe.isMicForwardingSuppressed()).toBe(true);
    nowMs = 4_000_000 + COOLDOWN_MS; // 4_000_800 — reopens (NOT extended)
    expect(probe.isMicForwardingSuppressed()).toBe(false);
  });

  it("lifecycle reset (barge-in / error / reconnect) reopens the mic immediately", () => {
    const { probe } = makeProbe();

    probe.handleEvent({ type: "response.output_audio.delta", delta: "AAAA" });
    expect(probe.isMicForwardingSuppressed()).toBe(true);

    // endAiSpeechWindow is the reset used by barge-in / error / reconnect /
    // end / dispose — it must clear both the mirror and the cooldown so the
    // user can be heard instantly (barge-in is an intentional interrupt).
    probe.endAiSpeechWindow();
    expect(probe.isMicForwardingSuppressed()).toBe(false);
  });

  it("P2: a late session.created does NOT overwrite an error status (mic-denied race)", () => {
    const { orch, probe } = makeProbe();
    // Simulate the mic-denied abort having flipped status to "error".
    probe.setState((s) => ({ ...s, status: "error", error: "Microphone access is required." }));
    expect(orch.getState().status).toBe("error");
    // A network-delivered session.created arriving AFTER the error flip must
    // NOT resurrect the silent-broken "connected" screen.
    probe.handleEvent({ type: "session.created" });
    expect(orch.getState().status).toBe("error");
  });

  it("session.created still flips to connected from a non-error status (control)", () => {
    const { orch, probe } = makeProbe();
    probe.handleEvent({ type: "session.created" });
    expect(orch.getState().status).toBe("connected");
  });
});
