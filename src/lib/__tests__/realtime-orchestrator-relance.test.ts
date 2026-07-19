/**
 * Story 18-1 — silence relance ("your pal keeps the conversation alive").
 *
 * Behavioral tests driving the orchestrator's `handleEvent` switch with
 * synthetic Realtime events + Jest fake timers, pinning the relance
 * contract:
 *
 *   - After `response.done` (AI turn over, waiting for the user), a
 *     RELANCE_DELAY_MS timer arms; on fire it injects a system-role nudge
 *     item + `response.create` so the model re-engages the silent user.
 *   - `input_audio_buffer.speech_started` cancels the pending timer AND
 *     resets the consecutive-relance counter.
 *   - At most MAX_CONSECUTIVE_RELANCES consecutive nudges — after the cap
 *     the companion respects the silence.
 *   - `tcf_simulation` mode NEVER arms (Story 10-6 prep-window contract:
 *     exam silence is legitimate).
 *   - dispose() / end() clear the pending timer (no nudge into a dead
 *     session); fire-time guards skip when a response is already in
 *     flight or the conversation is not in "connected" status.
 *
 * Harness mirrors `realtime-orchestrator-echo-gate.test.ts`.
 */

import { addBreadcrumb } from "../sentry";
import {
  MAX_CONSECUTIVE_RELANCES,
  RELANCE_DELAY_MS,
  RealtimeOrchestrator,
  type RealtimeOrchestratorOptions,
} from "../realtime-orchestrator";

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
          single: jest.fn(async () => ({ data: { id: "convo-relance-test" }, error: null })),
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
    id: "test-user-relance",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01",
  } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

/** Shape exposing the internals the relance tests need. */
type RelanceProbe = {
  handleEvent: (event: unknown) => void;
  session: { sendRaw: jest.Mock; disconnect: jest.Mock } | null;
  responseInFlight: boolean;
};

function makeConnectedProbe(optionOverrides?: Partial<RealtimeOrchestratorOptions>): {
  orch: RealtimeOrchestrator;
  probe: RelanceProbe;
  sendRaw: jest.Mock;
} {
  const orch = new RealtimeOrchestrator({ ...baseOptions, ...optionOverrides });
  const probe = orch as unknown as RelanceProbe;
  const sendRaw = jest.fn();
  // Populate the private session ref so `safeSessionCall` dispatches (the
  // probe never runs `start()`; matches the echo-gate harness approach of
  // driving handleEvent directly).
  probe.session = { sendRaw, disconnect: jest.fn() };
  // Flip status idle → connected.
  probe.handleEvent({ type: "session.created" });
  return { orch, probe, sendRaw };
}

/** Count relance firings = `response.create` sends (each fire = item.create + response.create). */
function relanceFireCount(sendRaw: jest.Mock): number {
  return sendRaw.mock.calls.filter((c) => c[0]?.type === "response.create").length;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Story 18-1 — silence relance", () => {
  it("constants pin: RELANCE_DELAY_MS = 15s, MAX_CONSECUTIVE_RELANCES = 2", () => {
    expect(RELANCE_DELAY_MS).toBe(15_000);
    expect(MAX_CONSECUTIVE_RELANCES).toBe(2);
  });

  it("arms on response.done and fires a system nudge + response.create after RELANCE_DELAY_MS", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    // 1ms before the deadline: nothing sent yet.
    jest.advanceTimersByTime(RELANCE_DELAY_MS - 1);
    expect(sendRaw).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(sendRaw).toHaveBeenCalledTimes(2);
    const [itemCreate, responseCreate] = sendRaw.mock.calls.map((c) => c[0]);
    expect(itemCreate.type).toBe("conversation.item.create");
    expect(itemCreate.item.role).toBe("system");
    expect(itemCreate.item.content[0].text).toContain("quiet");
    // The nudge must not instruct via response.instructions (which would
    // REPLACE the session prompt) — plain response.create only.
    expect(responseCreate).toEqual({ type: "response.create" });
    // Operator observability: breadcrumb with attempt counter.
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feature: "realtime-relance", attempt: 1 }),
      })
    );
  });

  it("user speech before the deadline cancels the pending relance", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS - 1);
    probe.handleEvent({ type: "input_audio_buffer.speech_started" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("caps at MAX_CONSECUTIVE_RELANCES consecutive nudges, then respects the silence", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    // Each relance's own response ends with another response.done, which
    // re-arms the timer — until the cap.
    for (let i = 0; i < MAX_CONSECUTIVE_RELANCES + 2; i += 1) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);
  });

  it("user speech resets the consecutive-relance counter", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    // Exhaust the cap.
    for (let i = 0; i < MAX_CONSECUTIVE_RELANCES; i += 1) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);

    // User finally speaks → streak broken → nudge budget restored.
    probe.handleEvent({ type: "input_audio_buffer.speech_started" });
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES + 1);
  });

  it("tcf_simulation mode NEVER arms (Story 10-6 prep-window contract)", () => {
    const { probe, sendRaw } = makeConnectedProbe({ mode: "tcf_simulation" });

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 3);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("debate mode DOES arm (driver behavior is companion + debate)", () => {
    const { probe, sendRaw } = makeConnectedProbe({ mode: "debate" });

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(1);
  });

  it("dispose() clears the pending relance — no nudge into a disposed session", () => {
    const { orch, probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    orch.dispose();
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("end() clears the pending relance — no nudge after the user ends", () => {
    const { orch, probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    orch.end();
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("fire-time guard: skips when a response is already in flight (VAD race)", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    // User spoke and the server started a response between arm and fire,
    // but the speech_started event was lost/delayed — the inflight flag is
    // the backstop.
    probe.responseInFlight = true;
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("fire-time guard: skips when status is not 'connected'", () => {
    const orch = new RealtimeOrchestrator(baseOptions);
    const probe = orch as unknown as RelanceProbe;
    const sendRaw = jest.fn();
    probe.session = { sendRaw, disconnect: jest.fn() };
    // No session.created → status stays "idle".
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });
});
