/**
 * Story 15-2 — mocked-API integration tests for `usePronunciation` hook.
 *
 * The hook wraps Azure Speech pronunciation assessment (Edge Function call)
 * with a state machine for recording → assess → history-append. Tests use
 * `react-test-renderer` + `act` + `HookHost` consumer pattern (Story 12-1
 * P8 / 12-9 / 14-X precedent).
 *
 * Mocks:
 *   - `use-audio-recorder` → stubbed recorder
 *   - `expo-file-system/legacy` → stubbed readAsStringAsync
 *   - `@/src/lib/pronunciation` → mock `assessPronunciation` only; PASS
 *     THROUGH the real `identifyWeakSounds` (pure aggregator already tested
 *     by Story 15-1 pronunciation.test.ts)
 *   - `@/src/lib/sentry` → captureError + addBreadcrumb stubs
 *   - `@/src/lib/error-messages` → classifyError stub returning {message}
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

jest.mock("@/src/hooks/use-audio-recorder", () => ({
  __esModule: true,
  useAudioRecorder: jest.fn(),
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: "base64" },
}));

jest.mock("@/src/lib/pronunciation", () => {
  // PASS THROUGH the real identifyWeakSounds (pure aggregator, Story 15-1).
  const actual = jest.requireActual("@/src/lib/pronunciation");
  return {
    __esModule: true,
    ...actual,
    assessPronunciation: jest.fn(),
  };
});

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("@/src/lib/error-messages", () => ({
  __esModule: true,
  classifyError: jest.fn((_err: unknown, fallback: string) => ({
    message: fallback,
    category: "network",
  })),
}));

import { readAsStringAsync } from "expo-file-system/legacy";
import React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";

import { useAudioRecorder } from "@/src/hooks/use-audio-recorder";
import { usePronunciation, type UsePronunciationReturn } from "@/src/hooks/use-pronunciation";
import { assessPronunciation, type PronunciationResult } from "@/src/lib/pronunciation";
import { captureError } from "@/src/lib/sentry";

const mockUseAudioRecorder = useAudioRecorder as jest.Mock;
const mockReadAsStringAsync = readAsStringAsync as jest.Mock;
const mockAssessPronunciation = assessPronunciation as jest.Mock;
const mockCaptureError = captureError as jest.Mock;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<PronunciationResult> = {}): PronunciationResult {
  return {
    accuracyScore: 85,
    fluencyScore: 80,
    completenessScore: 90,
    prosodyScore: 75,
    overallScore: 82,
    words: [
      {
        word: "bonjour",
        accuracyScore: 85,
        errorType: "None",
        phonemes: [
          { phoneme: "b", accuracyScore: 90 },
          { phoneme: "ɔ̃", accuracyScore: 80 },
        ],
      },
    ],
    weakPhonemes: [{ phoneme: "ɔ̃", accuracyScore: 50 }],
    ...overrides,
  };
}

function makeRecorderStub(overrides: Record<string, unknown> = {}) {
  return {
    isRecording: false,
    hasPermission: true,
    durationMs: 0,
    error: null,
    requestPermission: jest.fn(async () => true),
    startRecording: jest.fn(async () => undefined),
    stopRecording: jest.fn(async () => "file:///tmp/audio.wav" as string | null),
    getBase64Audio: jest.fn(async () => "stub-base64"),
    ...overrides,
  };
}

interface HookHostProps {
  result: { current: UsePronunciationReturn | null };
}

function HookHost({ result }: HookHostProps): React.ReactElement {
  const value = usePronunciation();
  result.current = value;
  return <Text>host</Text>;
}

const activeRenderers: ReturnType<typeof create>[] = [];

function renderHost() {
  const result: { current: UsePronunciationReturn | null } = { current: null };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<HookHost result={result} />);
  });
  activeRenderers.push(renderer!);
  return { result, renderer: renderer! };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default recorder stub — tests can override with mockReturnValueOnce.
  mockUseAudioRecorder.mockReturnValue(makeRecorderStub());
  mockReadAsStringAsync.mockResolvedValue("stub-base64-audio");
});

afterEach(() => {
  for (const renderer of activeRenderers) {
    try {
      act(() => renderer.unmount());
    } catch {
      // already unmounted
    }
  }
  activeRenderers.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Story 15-2 — usePronunciation", () => {
  describe("Initial state", () => {
    it("Case 1: initial state is { isAssessing:false, result:null, weakSounds:[], history:[], error:null, isRecording:false }", () => {
      const { result } = renderHost();
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.result).toBeNull();
      expect(result.current?.weakSounds).toEqual([]);
      expect(result.current?.history).toEqual([]);
      expect(result.current?.error).toBeNull();
      expect(result.current?.isRecording).toBe(false);
    });
  });

  describe("startAssessment", () => {
    it("Case 2: clears prior result + error AND delegates to recorder.startRecording", async () => {
      const recorderStub = makeRecorderStub();
      mockUseAudioRecorder.mockReturnValue(recorderStub);
      // Seed state with a prior result via finishAssessment happy path
      mockAssessPronunciation.mockResolvedValueOnce(makeResult());
      const { result } = renderHost();
      await act(async () => {
        await result.current!.finishAssessment("bonjour");
      });
      expect(result.current?.result).not.toBeNull();

      // Now call startAssessment — should clear result + error, fire recorder
      await act(async () => {
        await result.current!.startAssessment();
      });
      expect(result.current?.result).toBeNull();
      expect(result.current?.error).toBeNull();
      expect(recorderStub.startRecording).toHaveBeenCalledTimes(1);
    });
  });

  describe("finishAssessment — async path", () => {
    it("Case 3: happy path — recorder URI → readAsStringAsync → assessPronunciation → state updated with result + history + weakSounds", async () => {
      const expectedResult = makeResult({ overallScore: 88 });
      mockAssessPronunciation.mockResolvedValueOnce(expectedResult);
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = null;
      await act(async () => {
        returnedValue = await result.current!.finishAssessment("bonjour le monde");
      });
      // Return value is the resolved result
      expect(returnedValue).toEqual(expectedResult);
      // State is updated
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.result).toEqual(expectedResult);
      expect(result.current?.history).toEqual([expectedResult]);
      expect(result.current?.error).toBeNull();
      // Verify the call chain
      expect(mockReadAsStringAsync).toHaveBeenCalledWith(
        "file:///tmp/audio.wav",
        expect.objectContaining({ encoding: "base64" })
      );
      expect(mockAssessPronunciation).toHaveBeenCalledWith("stub-base64-audio", "bonjour le monde");
    });

    it("Case 4: recorder returns null (no audio) → error set + isAssessing:false + no captureError + no readAsStringAsync call", async () => {
      mockUseAudioRecorder.mockReturnValue(
        makeRecorderStub({ stopRecording: jest.fn(async () => null) })
      );
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = makeResult();
      await act(async () => {
        returnedValue = await result.current!.finishAssessment("bonjour");
      });
      expect(returnedValue).toBeNull();
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.error).toBe("No audio recorded");
      expect(mockCaptureError).not.toHaveBeenCalled();
      expect(mockReadAsStringAsync).not.toHaveBeenCalled();
      expect(mockAssessPronunciation).not.toHaveBeenCalled();
    });

    it("Case 5: assessPronunciation throws → captureError fires with `pronunciation-assessment` feature tag + error set via classifyError + isAssessing:false", async () => {
      const azureErr = new Error("Azure 503 Service Unavailable");
      mockAssessPronunciation.mockRejectedValueOnce(azureErr);
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = makeResult();
      await act(async () => {
        returnedValue = await result.current!.finishAssessment("bonjour");
      });
      expect(returnedValue).toBeNull();
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.error).toBe(
        "Pronunciation assessment failed. Please try recording again."
      );
      expect(mockCaptureError).toHaveBeenCalledWith(azureErr, "pronunciation-assessment");
    });

    it("Case 6: returns the resolved PronunciationResult value (callable contract — not just state update)", async () => {
      const expected = makeResult({ accuracyScore: 99 });
      mockAssessPronunciation.mockResolvedValueOnce(expected);
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = null;
      await act(async () => {
        returnedValue = await result.current!.finishAssessment("test");
      });
      expect(returnedValue).toEqual(expected);
      expect(returnedValue).toBe(expected); // Reference identity preserved
    });
  });

  describe("assessFromUri — async path (skips recording)", () => {
    it("Case 7: happy path — reads from given URI → assessPronunciation → state updated (recorder NOT called)", async () => {
      const expectedResult = makeResult({ overallScore: 70 });
      mockAssessPronunciation.mockResolvedValueOnce(expectedResult);
      const recorderStub = makeRecorderStub();
      mockUseAudioRecorder.mockReturnValue(recorderStub);
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = null;
      await act(async () => {
        returnedValue = await result.current!.assessFromUri("file:///custom/path.wav", "salut");
      });
      expect(returnedValue).toEqual(expectedResult);
      expect(result.current?.result).toEqual(expectedResult);
      expect(result.current?.history).toEqual([expectedResult]);
      // assessFromUri skips recording — neither start nor stop should fire
      expect(recorderStub.startRecording).not.toHaveBeenCalled();
      expect(recorderStub.stopRecording).not.toHaveBeenCalled();
      // But readAsStringAsync IS called with the passed URI
      expect(mockReadAsStringAsync).toHaveBeenCalledWith(
        "file:///custom/path.wav",
        expect.objectContaining({ encoding: "base64" })
      );
    });

    it("Case 8: assessFromUri error path — assessPronunciation throws → captureError + classifyError + isAssessing:false", async () => {
      const err = new Error("Azure timeout");
      mockAssessPronunciation.mockRejectedValueOnce(err);
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = makeResult();
      await act(async () => {
        returnedValue = await result.current!.assessFromUri("file:///x.wav", "test");
      });
      expect(returnedValue).toBeNull();
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.error).toBe(
        "Pronunciation assessment failed. Please try recording again."
      );
      expect(mockCaptureError).toHaveBeenCalledWith(err, "pronunciation-assessment");
    });
  });

  describe("clearResult", () => {
    it("Case 9: clearResult resets result + error but PRESERVES history (Story 12-12 FIFO + Story 15-1 weakSounds aggregation continuity)", async () => {
      mockAssessPronunciation.mockResolvedValueOnce(makeResult());
      const { result } = renderHost();
      await act(async () => {
        await result.current!.finishAssessment("bonjour");
      });
      expect(result.current?.result).not.toBeNull();
      expect(result.current?.history).toHaveLength(1);

      act(() => {
        result.current!.clearResult();
      });
      expect(result.current?.result).toBeNull();
      expect(result.current?.error).toBeNull();
      // history is NOT cleared
      expect(result.current?.history).toHaveLength(1);
    });
  });

  describe("getWeakPhonemes", () => {
    it("Case 10: getWeakPhonemes returns state.result.weakPhonemes when result exists, [] when null", async () => {
      const withWeak = makeResult({
        weakPhonemes: [
          { phoneme: "ʁ", accuracyScore: 40 },
          { phoneme: "ɔ̃", accuracyScore: 50 },
        ],
      });
      mockAssessPronunciation.mockResolvedValueOnce(withWeak);
      const { result } = renderHost();
      // Before any assessment: result is null → []
      expect(result.current!.getWeakPhonemes()).toEqual([]);
      // After assessment: returns weakPhonemes from the result
      await act(async () => {
        await result.current!.finishAssessment("test");
      });
      expect(result.current!.getWeakPhonemes()).toEqual([
        { phoneme: "ʁ", accuracyScore: 40 },
        { phoneme: "ɔ̃", accuracyScore: 50 },
      ]);
    });
  });

  describe("History accumulation + Story 12-12 FIFO cap integration", () => {
    it("Case 11: 3 sequential finishAssessment calls produce history.length === 3", async () => {
      mockAssessPronunciation
        .mockResolvedValueOnce(makeResult({ accuracyScore: 70 }))
        .mockResolvedValueOnce(makeResult({ accuracyScore: 80 }))
        .mockResolvedValueOnce(makeResult({ accuracyScore: 90 }));
      const { result } = renderHost();
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await result.current!.finishAssessment(`test ${i}`);
        });
      }
      expect(result.current?.history).toHaveLength(3);
      expect(result.current?.history[0].accuracyScore).toBe(70);
      expect(result.current?.history[2].accuracyScore).toBe(90);
    });

    it("Case 12: 51 sequential finishAssessment calls → history capped at 50 (Story 12-12 MAX_PRONUNCIATION_HISTORY); oldest evicted", async () => {
      // Pre-load 51 distinct results into the mock queue
      for (let i = 0; i < 51; i++) {
        mockAssessPronunciation.mockResolvedValueOnce(makeResult({ accuracyScore: i }));
      }
      const { result } = renderHost();
      for (let i = 0; i < 51; i++) {
        await act(async () => {
          await result.current!.finishAssessment(`test ${i}`);
        });
      }
      expect(result.current?.history).toHaveLength(50);
      // First entry (accuracyScore=0) was evicted; oldest surviving is accuracyScore=1
      expect(result.current?.history[0].accuracyScore).toBe(1);
      expect(result.current?.history[49].accuracyScore).toBe(50);
    });
  });

  describe("isRecording mirroring", () => {
    it("Case 13: isRecording mirrors recorder.isRecording (live-state delegation)", () => {
      mockUseAudioRecorder.mockReturnValue(makeRecorderStub({ isRecording: true }));
      const { result } = renderHost();
      expect(result.current?.isRecording).toBe(true);
    });
  });
});
