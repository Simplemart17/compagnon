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
    it("Case 2: clears prior result + error AND delegates to recorder.startRecording (R1 BH-6: also asserts isAssessing stays false during recording phase)", async () => {
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
      // R1 BH-6: `startAssessment` does NOT set isAssessing — "assessing" means
      // Azure call in-flight (set by finishAssessment), not recording. Pinning
      // this contract so a future refactor moving the flag earlier is caught.
      expect(result.current?.isAssessing).toBe(false);
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
      // R1 BH-1: weakSounds is the aggregated-across-history field (not
      // result.weakPhonemes which is per-call). The default fixture has all
      // phonemes scoring ≥ 80, so identifyWeakSounds returns [] (its filter
      // requires count ≥ 3 AND avgScore < 70). Pinning the empty case so a
      // future refactor that breaks the `identifyWeakSounds(newHistory)`
      // wiring is caught.
      expect(result.current?.weakSounds).toEqual([]);
    });

    it("Case 3b: weakSounds aggregator wired correctly — 3+ same-phoneme low-scoring entries produce non-empty weakSounds (R1 BH-1 + EH-7 + EH-10)", async () => {
      // identifyWeakSounds threshold is `count >= 3 && avgScore < 70`.
      // Each result contributes 1 occurrence of the weak phoneme "ʁ" with
      // score 40. After 3 assessments the aggregate is count=3, avg=40 →
      // weakSounds should contain "ʁ".
      const lowScoringFixture = () =>
        makeResult({
          words: [
            {
              word: "rouge",
              accuracyScore: 40,
              errorType: "Mispronunciation",
              phonemes: [{ phoneme: "ʁ", accuracyScore: 40 }],
            },
          ],
        });
      mockAssessPronunciation
        .mockResolvedValueOnce(lowScoringFixture())
        .mockResolvedValueOnce(lowScoringFixture())
        .mockResolvedValueOnce(lowScoringFixture());
      const { result } = renderHost();
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await result.current!.finishAssessment(`rouge ${i}`);
        });
      }
      // After 3 assessments with the same low-scoring phoneme, the
      // aggregator returns a non-empty weakSounds list.
      expect(result.current?.weakSounds.length).toBeGreaterThan(0);
      // The weak phoneme "ʁ" must appear in the aggregated list.
      expect(result.current?.weakSounds.some((w) => w.phoneme === "ʁ")).toBe(true);
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

    it("Case 4b: audio-permission-denied surface — recorder.hasPermission=false + recorder.error set + stopRecording returns null (R1 EH-1)", async () => {
      // Real-world iOS/Android first-run scenario: user taps mic, denies
      // permission. `useAudioRecorder` returns hasPermission:false +
      // error: "Microphone permission denied" + stopRecording → null.
      // The hook's permission-denied path routes through the same
      // null-audio branch (Case 4 above) — pinning that contract.
      mockUseAudioRecorder.mockReturnValue(
        makeRecorderStub({
          hasPermission: false,
          error: "Microphone permission denied",
          stopRecording: jest.fn(async () => null),
        })
      );
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = makeResult();
      await act(async () => {
        returnedValue = await result.current!.finishAssessment("bonjour");
      });
      expect(returnedValue).toBeNull();
      expect(result.current?.isAssessing).toBe(false);
      // Hook currently surfaces "No audio recorded" (Case 4 contract).
      // Filed `15-2-followup-permission-denied-distinct-error` if operators
      // want a distinct user-visible message vs no-audio. Until then this
      // pins the current behavior.
      expect(result.current?.error).toBe("No audio recorded");
      // captureError should NOT fire on the permission-denied path (it's
      // user-driven, not a system error worth Sentry-paging on).
      expect(mockCaptureError).not.toHaveBeenCalled();
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

    it("Case 6b: transient isAssessing — set true synchronously before Azure call, reset false after settle (R1 EH-9 deferred-resolve pattern)", async () => {
      // Hand-rolled deferred promise so we can observe the mid-flight state
      // before the assessment resolves (Story 13-3 P8 pattern).
      let resolveAssess!: (v: PronunciationResult) => void;
      const deferred = new Promise<PronunciationResult>((resolve) => {
        resolveAssess = resolve;
      });
      mockAssessPronunciation.mockReturnValueOnce(deferred);
      const { result } = renderHost();
      // Fire finishAssessment WITHOUT awaiting — captures the in-flight state.
      let finishPromise!: Promise<PronunciationResult | null>;
      await act(async () => {
        finishPromise = result.current!.finishAssessment("test");
      });
      // At this point: readAsStringAsync has resolved, assessPronunciation
      // has been called but its promise is still pending. The hook's
      // setState({...prev, isAssessing: true, error: null}) should have
      // already committed.
      expect(result.current?.isAssessing).toBe(true);
      // Resolve the assessment.
      await act(async () => {
        resolveAssess(makeResult({ accuracyScore: 77 }));
        await finishPromise;
      });
      // Post-settle: isAssessing is false again.
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.result).not.toBeNull();
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

    it("Case 8b: readAsStringAsync rejection — file gone / permissions → captureError + error surfaced (R1 EH-6)", async () => {
      // Real-world scenario: cached audio file deleted by an OS background
      // cleaner between recording and assess. readAsStringAsync rejects;
      // the hook's catch arm at use-pronunciation.ts wraps both file-read
      // and assessment errors with the same feature tag.
      const fsErr = new Error("ENOENT: file not found");
      mockReadAsStringAsync.mockRejectedValueOnce(fsErr);
      const { result } = renderHost();
      let returnedValue: PronunciationResult | null = makeResult();
      await act(async () => {
        returnedValue = await result.current!.assessFromUri("file:///deleted.wav", "test");
      });
      expect(returnedValue).toBeNull();
      expect(result.current?.isAssessing).toBe(false);
      expect(result.current?.error).toBe(
        "Pronunciation assessment failed. Please try recording again."
      );
      // Sentry captures the FS error with the same `pronunciation-assessment`
      // feature tag. If operators want distinct telemetry for file-read vs
      // assessment errors, file `15-2-followup-distinct-fs-error-tag`.
      expect(mockCaptureError).toHaveBeenCalledWith(fsErr, "pronunciation-assessment");
      expect(mockAssessPronunciation).not.toHaveBeenCalled();
    });

    it("Case 8c: assessFromUri callback reference is stable across re-renders (R1 BH-5: pins useCallback empty-deps contract)", async () => {
      const { result, renderer } = renderHost();
      const ref1 = result.current!.assessFromUri;
      // Force a re-render by mutating a recorder stub that triggers no
      // state change. The useAudioRecorder mock returns the same stub.
      act(() => {
        renderer.update(<HookHost result={result} />);
      });
      const ref2 = result.current!.assessFromUri;
      // Pin reference stability — useCallback([]) deps mean the function
      // should be identical across renders unless a future maintainer adds
      // a dep (which would silently re-render consumers that depend on it).
      expect(ref2).toBe(ref1);
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

    it("Case 9b: clearResult on initial empty state is a no-op (R1 EH-4 pre-init defense)", () => {
      // User taps "Clear" before any assessment — should not crash, should
      // leave the empty state unchanged.
      const { result } = renderHost();
      // Initial empty state pin
      expect(result.current?.result).toBeNull();
      expect(result.current?.error).toBeNull();
      expect(result.current?.history).toEqual([]);
      // Invoke clearResult against empty state
      act(() => {
        result.current!.clearResult();
      });
      // Post-state: still empty, history still []
      expect(result.current?.result).toBeNull();
      expect(result.current?.error).toBeNull();
      expect(result.current?.history).toEqual([]);
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
      // R1 EH-8: explicit non-containment so a future regression that
      // evicts from the tail (LIFO) or fails to evict at all is caught.
      // The original accuracyScore=0 entry must NOT appear anywhere.
      expect(result.current?.history.some((h) => h.accuracyScore === 0)).toBe(false);
    });
  });

  describe("isRecording mirroring", () => {
    it("Case 13: isRecording mirrors recorder.isRecording at first render (snapshot)", () => {
      mockUseAudioRecorder.mockReturnValue(makeRecorderStub({ isRecording: true }));
      const { result } = renderHost();
      expect(result.current?.isRecording).toBe(true);
    });

    it("Case 13b: isRecording mirrors recorder state changes across re-renders (R1 BH-2 live-state delegation)", () => {
      // Two mock returns: first render = false, second render = true.
      // After forcing a re-render, the hook should reflect the new state.
      mockUseAudioRecorder
        .mockReturnValueOnce(makeRecorderStub({ isRecording: false }))
        .mockReturnValue(makeRecorderStub({ isRecording: true }));
      const { result, renderer } = renderHost();
      expect(result.current?.isRecording).toBe(false);
      // Force a re-render by re-invoking renderer.update — the second
      // useAudioRecorder mock return fires.
      act(() => {
        renderer.update(<HookHost result={result} />);
      });
      // The hook should now reflect the new recorder state, NOT the
      // snapshot-at-mount value. Pin this so a future refactor caching
      // `isRecording` into local state breaks the mirroring contract.
      expect(result.current?.isRecording).toBe(true);
    });
  });
});
