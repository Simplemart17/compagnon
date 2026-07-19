/**
 * Story 18-1 — silence relance ("your pal keeps the conversation alive").
 *
 * Behavioral tests driving the orchestrator's `handleEvent` switch with
 * synthetic Realtime events + Jest fake timers, pinning the relance
 * contract (post-review-round-1 hardened form):
 *
 *   - After `response.done` (AI turn over, waiting for the user), a
 *     RELANCE_DELAY_MS timer arms; on fire it injects a system-role nudge
 *     item (client-generated id) + `response.create`.
 *   - `input_audio_buffer.speech_started` cancels the pending timer but
 *     does NOT reset the consecutive counter (R1: ambient-noise VAD blips
 *     must not re-open the nudge budget — unbounded-spend defense).
 *   - The consecutive counter resets ONLY on a COMMITTED user turn: a
 *     created user item with non-empty transcript, or sendText().
 *   - Two caps: MAX_CONSECUTIVE_RELANCES (streak) and
 *     MAX_RELANCES_PER_SESSION (lifetime, never resets mid-session — the
 *     economic bound for this client-initiated unmetered spend path).
 *   - Arm-time + fire-time guards: user speaking (state.isSpeaking),
 *     app not foregrounded (AppState), response in flight, status,
 *     disposal; counters only increment on a DELIVERED send.
 *   - `tcf_simulation` mode NEVER arms (Story 10-6 prep-window contract).
 *   - `realtime.reconnected` re-arms (fresh server context produces no
 *     response.done on its own).
 *   - The nudge item is deleted from server context once served
 *     (response.done) or when the scoped
 *     conversation_already_has_active_response race fires; that race is
 *     benign ONLY within RELANCE_RACE_WINDOW_MS of a delivered relance.
 *
 * Harness mirrors `realtime-orchestrator-echo-gate.test.ts`.
 */

import { AppState } from "react-native";

import { addBreadcrumb, captureError } from "../sentry";
import {
  MAX_CONSECUTIVE_RELANCES,
  MAX_RELANCES_PER_SESSION,
  RELANCE_DELAY_MS,
  RELANCE_RACE_WINDOW_MS,
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
  session: {
    sendRaw: jest.Mock;
    sendText: jest.Mock;
    disconnect: jest.Mock;
    isConnected: boolean;
  } | null;
  responseInFlight: boolean;
  setState: (updater: (s: Record<string, unknown>) => Record<string, unknown>) => void;
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
  // driving handleEvent directly). isConnected: true — the R1 delivery
  // check requires it before the nudge budget is spent.
  probe.session = { sendRaw, sendText: jest.fn(), disconnect: jest.fn(), isConnected: true };
  // Flip status idle → connected.
  probe.handleEvent({ type: "session.created" });
  return { orch, probe, sendRaw };
}

/** A committed user turn: created user item with non-empty transcript. */
function commitUserTurn(probe: RelanceProbe, text = "Bonjour, je vais bien"): void {
  probe.handleEvent({
    type: "conversation.item.created",
    item: { role: "user", content: [{ type: "input_audio", transcript: text }] },
  });
}

/** Count relance firings = `response.create` sends. */
function relanceFireCount(sendRaw: jest.Mock): number {
  return sendRaw.mock.calls.filter((c) => c[0]?.type === "response.create").length;
}

/** Count nudge-item deletions. */
function itemDeleteCount(sendRaw: jest.Mock): number {
  return sendRaw.mock.calls.filter((c) => c[0]?.type === "conversation.item.delete").length;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Default foregrounded — individual tests override.
  (AppState as unknown as { currentState: string }).currentState = "active";
});

afterEach(() => {
  jest.useRealTimers();
  (AppState as unknown as { currentState: string }).currentState = "active";
});

describe("Story 18-1 — silence relance (post-R1 contract)", () => {
  it("constants pin: 15s delay, 2 consecutive, 4 per session, 5s race window", () => {
    expect(RELANCE_DELAY_MS).toBe(15_000);
    expect(MAX_CONSECUTIVE_RELANCES).toBe(2);
    expect(MAX_RELANCES_PER_SESSION).toBe(4);
    expect(RELANCE_RACE_WINDOW_MS).toBe(5_000);
  });

  it("arms on response.done and fires a system nudge (with client item id) + response.create", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS - 1);
    expect(sendRaw).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(sendRaw).toHaveBeenCalledTimes(2);
    const [itemCreate, responseCreate] = sendRaw.mock.calls.map((c) => c[0]);
    expect(itemCreate.type).toBe("conversation.item.create");
    expect(itemCreate.item.role).toBe("system");
    expect(itemCreate.item.id).toMatch(/^relance_1_/);
    expect(itemCreate.item.content[0].text).toContain("quiet");
    expect(responseCreate).toEqual({ type: "response.create" });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feature: "realtime-relance", attempt: 1, total: 1 }),
      })
    );
  });

  it("R1: the served nudge item is deleted from server context on the next response.done", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS); // fire 1
    const nudgeId = sendRaw.mock.calls.find((c) => c[0]?.type === "conversation.item.create")?.[0]
      .item.id;

    // The relance's own response completes.
    probe.handleEvent({ type: "response.done" });
    const del = sendRaw.mock.calls.find((c) => c[0]?.type === "conversation.item.delete")?.[0];
    expect(del).toBeDefined();
    expect(del.item_id).toBe(nudgeId);
  });

  it("user speech (VAD) before the deadline cancels the pending relance", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS - 1);
    probe.handleEvent({ type: "input_audio_buffer.speech_started" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("caps at MAX_CONSECUTIVE_RELANCES consecutive nudges, then respects the silence", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    for (let i = 0; i < MAX_CONSECUTIVE_RELANCES + 2; i += 1) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);
  });

  it("R1: raw VAD speech_started does NOT reset the consecutive counter (ambient-noise defense)", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    // Exhaust the consecutive cap.
    for (let i = 0; i < MAX_CONSECUTIVE_RELANCES; i += 1) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);

    // Ambient noise blip: speech_started fires but NO committed turn follows.
    probe.handleEvent({ type: "input_audio_buffer.speech_started" });
    probe.handleEvent({ type: "input_audio_buffer.speech_stopped" });
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    // Pre-R1 this fired again (noise reset the budget → unbounded chain).
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);
  });

  it("a COMMITTED user turn (non-empty transcript) restores the consecutive budget", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    for (let i = 0; i < MAX_CONSECUTIVE_RELANCES; i += 1) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);

    commitUserTurn(probe);
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES + 1);
  });

  it("R1: sendText() clears the pending relance and restores the budget (text users are engaged users)", () => {
    const { orch, probe, sendRaw } = makeConnectedProbe();

    // Pending relance armed…
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS - 1);
    // …user sends a text message instead of speaking.
    orch.sendText("Bonjour !");
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    expect(relanceFireCount(sendRaw)).toBe(0);

    // And after exhausting the consecutive cap, sendText restores it.
    for (let i = 0; i < MAX_CONSECUTIVE_RELANCES; i += 1) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES);
    orch.sendText("Et toi ?");
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(MAX_CONSECUTIVE_RELANCES + 1);
  });

  it("R1: MAX_RELANCES_PER_SESSION is a hard lifetime cap — committed turns do NOT restore it", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    // Burn the lifetime budget in consecutive-cap-sized chunks, restoring
    // the streak counter between chunks via committed user turns.
    let safety = 0;
    while (relanceFireCount(sendRaw) < MAX_RELANCES_PER_SESSION && safety < 20) {
      probe.handleEvent({ type: "response.done" });
      jest.advanceTimersByTime(RELANCE_DELAY_MS);
      if (relanceFireCount(sendRaw) % MAX_CONSECUTIVE_RELANCES === 0) {
        commitUserTurn(probe, `tour ${safety}`);
      }
      safety += 1;
    }
    expect(relanceFireCount(sendRaw)).toBe(MAX_RELANCES_PER_SESSION);

    // Even with a fresh committed turn, the lifetime cap holds.
    commitUserTurn(probe, "encore un tour");
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    expect(relanceFireCount(sendRaw)).toBe(MAX_RELANCES_PER_SESSION);
  });

  it("R1: does not arm while the user is speaking (barge-in cancelled response.done)", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    // User barges in: speech_started flips state.isSpeaking true; the
    // cancelled response's terminal response.done then arrives while the
    // user is still mid-utterance.
    probe.handleEvent({ type: "input_audio_buffer.speech_started" });
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 2);
    // Pre-R1 this nudged the user mid-sentence.
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("R1: fire-time isSpeaking guard blocks a fire armed before speech began", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" }); // arms (not speaking)
    // Simulate isSpeaking flipping true through a path that does NOT clear
    // the timer (defensive backstop).
    probe.setState((s) => ({ ...s, isSpeaking: true }));
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("R1: no fire while the app is backgrounded (no paid unhearable audio)", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "response.done" });
    (AppState as unknown as { currentState: string }).currentState = "background";
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("R1: realtime.reconnected re-arms (fresh server context yields no response.done)", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.handleEvent({ type: "realtime.reconnecting" });
    probe.handleEvent({ type: "realtime.reconnected" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(1);
  });

  it("R1: undelivered send (socket not OPEN) does NOT burn the nudge budget", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    probe.session!.isConnected = false;
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(sendRaw).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Silence relance fired" })
    );

    // Socket recovers: the full budget is still available.
    probe.session!.isConnected = true;
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(1);
  });

  it("R1: conversation_already_has_active_response is benign ONLY within the relance race window", () => {
    const { probe, sendRaw } = makeConnectedProbe();

    // Fire a relance → inside the window the race is suppressed AND the
    // stale nudge item is cleaned up.
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(1);
    probe.handleEvent({
      type: "error",
      error: { code: "conversation_already_has_active_response", message: "already active" },
    });
    expect(captureError).not.toHaveBeenCalled();
    expect(itemDeleteCount(sendRaw)).toBe(1);

    // Far outside the window (no recent relance): the same error is REAL
    // and must reach Sentry (double-response bugs stay visible).
    jest.advanceTimersByTime(RELANCE_RACE_WINDOW_MS * 10);
    probe.handleEvent({
      type: "error",
      error: { code: "conversation_already_has_active_response", message: "already active" },
    });
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("tcf_simulation mode NEVER arms (Story 10-6 prep-window contract)", () => {
    const { probe, sendRaw } = makeConnectedProbe({ mode: "tcf_simulation" });

    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS * 3);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("debate mode DOES arm (driving behavior is companion + debate)", () => {
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
    probe.responseInFlight = true;
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });

  it("fire-time guard: skips when status is not 'connected'", () => {
    const orch = new RealtimeOrchestrator(baseOptions);
    const probe = orch as unknown as RelanceProbe;
    const sendRaw = jest.fn();
    probe.session = { sendRaw, sendText: jest.fn(), disconnect: jest.fn(), isConnected: true };
    // No session.created → status stays "idle".
    probe.handleEvent({ type: "response.done" });
    jest.advanceTimersByTime(RELANCE_DELAY_MS);
    expect(relanceFireCount(sendRaw)).toBe(0);
  });
});
