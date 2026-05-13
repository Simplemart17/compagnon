/**
 * Story 12-1 review-round-1 P8 — hook-binding tests for `useRealtimeVoice`.
 *
 * The hook is a thin React binding around `RealtimeOrchestrator` (Story 12-1).
 * These tests pin the binding contract: lazy construction, shared-instance
 * across renders, state propagation via subscription, dispose-on-unmount,
 * start/end/sendText pass-through, and public-surface TypeScript pin.
 *
 * Uses `react-test-renderer` (already a dep) to mount a tiny consumer
 * component that calls the hook + exposes its return value to assertions.
 * The orchestrator is mocked so we observe the hook's interactions with
 * it without exercising the full Realtime stack.
 */

import { act, create } from "react-test-renderer";
import { Text } from "react-native";

import { useRealtimeVoice, type UseRealtimeVoiceOptions } from "../use-realtime-voice";

// Mock the orchestrator BEFORE importing the hook so the hook picks up the mock.
jest.mock("@/src/lib/realtime-orchestrator", () => {
  // Stable mock instance shared across all `new RealtimeOrchestrator(...)` calls
  // within a single test — lets us verify lazy-construction + shared-instance.
  const mockInstances: {
    subscribe: jest.Mock;
    getState: jest.Mock;
    dispose: jest.Mock;
    start: jest.Mock;
    end: jest.Mock;
    sendText: jest.Mock;
    options: unknown;
  }[] = [];
  const initial = {
    status: "idle",
    isSpeaking: false,
    isAiSpeaking: false,
    isProcessing: false,
    transcript: [],
    pendingAiText: "",
    allCorrections: [],
    durationSeconds: 0,
    error: null,
    feedback: null,
    conversationId: null,
  };
  return {
    __esModule: true,
    INITIAL_STATE: initial,
    RealtimeOrchestrator: jest.fn().mockImplementation((options: unknown) => {
      let cb: ((s: unknown) => void) | null = null;
      const instance = {
        subscribe: jest.fn((c: (s: unknown) => void) => {
          cb = c;
          c(initial); // initial-sync delivery
          return () => {
            cb = null;
          };
        }),
        getState: jest.fn(() => initial),
        dispose: jest.fn(),
        start: jest.fn(async () => undefined),
        end: jest.fn(),
        sendText: jest.fn(),
        options,
        // Test helper: synthesize a state-mutation event (lets us verify
        // setState fan-out through the hook's subscriber callback).
        _triggerStateChange: (next: unknown) => cb?.(next),
      };
      mockInstances.push(instance);
      return instance;
    }),
    __getMockInstances: () => mockInstances,
    __resetMockInstances: () => {
      mockInstances.length = 0;
    },
  };
});

jest.mock("@/src/store/auth-store", () => ({
  useAuthStore: Object.assign(() => null, {
    getState: () => ({ user: { id: "test-user" } }),
  }),
}));

const orchestratorModule = jest.requireMock("@/src/lib/realtime-orchestrator") as {
  RealtimeOrchestrator: jest.Mock;
  __getMockInstances: () => {
    subscribe: jest.Mock;
    dispose: jest.Mock;
    start: jest.Mock;
    end: jest.Mock;
    sendText: jest.Mock;
    _triggerStateChange: (s: unknown) => void;
  }[];
  __resetMockInstances: () => void;
};

const baseOptions: UseRealtimeVoiceOptions = {
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

beforeEach(() => {
  orchestratorModule.RealtimeOrchestrator.mockClear();
  orchestratorModule.__resetMockInstances();
});

/**
 * Tiny consumer component that calls the hook and exposes its return value
 * via a module-level capture variable. The component renders nothing
 * meaningful — it's just a hook host.
 */
let captured: ReturnType<typeof useRealtimeVoice> | null = null;
function HookHost({ options }: { options: UseRealtimeVoiceOptions }) {
  captured = useRealtimeVoice(options);
  return <Text>{captured.status}</Text>;
}

afterEach(() => {
  captured = null;
});

describe("Story 12-1 review-patch P8 — useRealtimeVoice hook-binding tests", () => {
  it("constructs the orchestrator lazily on first render (exactly once)", () => {
    act(() => {
      create(<HookHost options={baseOptions} />);
    });
    expect(orchestratorModule.RealtimeOrchestrator).toHaveBeenCalledTimes(1);
  });

  it("multiple renders share the same orchestrator instance (via useRef)", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<HookHost options={baseOptions} />);
    });
    // Force a re-render of the same instance.
    act(() => {
      renderer!.update(<HookHost options={baseOptions} />);
    });
    // Orchestrator constructor still called exactly once across both renders.
    expect(orchestratorModule.RealtimeOrchestrator).toHaveBeenCalledTimes(1);
  });

  it("state propagates from orchestrator subscribe callback through React state", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<HookHost options={baseOptions} />);
    });
    // Initial state delivered via subscribe initial-sync.
    expect(captured?.status).toBe("idle");

    // Trigger a state mutation via the mock's helper.
    const instance = orchestratorModule.__getMockInstances()[0];
    act(() => {
      instance._triggerStateChange({
        status: "connecting",
        isSpeaking: false,
        isAiSpeaking: false,
        isProcessing: false,
        transcript: [],
        pendingAiText: "",
        allCorrections: [],
        durationSeconds: 0,
        error: null,
        feedback: null,
        conversationId: null,
      });
    });

    expect(captured?.status).toBe("connecting");
    renderer!.unmount();
  });

  it("unmount calls orchestrator.dispose()", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<HookHost options={baseOptions} />);
    });
    const instance = orchestratorModule.__getMockInstances()[0];
    expect(instance.dispose).not.toHaveBeenCalled();
    act(() => {
      renderer!.unmount();
    });
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });

  it("hook.start() / hook.end() / hook.sendText() forward to orchestrator methods", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<HookHost options={baseOptions} />);
    });
    const instance = orchestratorModule.__getMockInstances()[0];

    void captured!.start();
    expect(instance.start).toHaveBeenCalledTimes(1);

    captured!.sendText("bonjour");
    expect(instance.sendText).toHaveBeenCalledWith("bonjour");

    captured!.end();
    expect(instance.end).toHaveBeenCalledTimes(1);

    renderer!.unmount();
  });

  it("public hook return surface matches UseRealtimeVoiceReturn shape (TypeScript pin + runtime check)", () => {
    act(() => {
      create(<HookHost options={baseOptions} />);
    });
    // All ConversationState fields are present.
    expect(captured).not.toBeNull();
    expect(captured).toHaveProperty("status");
    expect(captured).toHaveProperty("isSpeaking");
    expect(captured).toHaveProperty("isAiSpeaking");
    expect(captured).toHaveProperty("isProcessing");
    expect(captured).toHaveProperty("transcript");
    expect(captured).toHaveProperty("pendingAiText");
    expect(captured).toHaveProperty("allCorrections");
    expect(captured).toHaveProperty("durationSeconds");
    expect(captured).toHaveProperty("error");
    expect(captured).toHaveProperty("feedback");
    expect(captured).toHaveProperty("conversationId");
    // Public action surface.
    expect(typeof captured!.start).toBe("function");
    expect(typeof captured!.sendText).toBe("function");
    expect(typeof captured!.end).toBe("function");
  });
});
