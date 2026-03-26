/**
 * Pronunciation Assessment Hook
 *
 * React hook wrapper around Azure Speech Service pronunciation assessment.
 * Records audio, sends to Azure, returns phoneme-level scoring.
 */

import { useCallback, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";

import { captureError } from "@/src/lib/sentry";
import { classifyError } from "@/src/lib/error-messages";
import {
  assessPronunciation,
  identifyWeakSounds,
  type PronunciationResult,
  type PhonemeScore,
} from "@/src/lib/pronunciation";

import { useAudioRecorder } from "./use-audio-recorder";

export interface PronunciationState {
  isAssessing: boolean;
  result: PronunciationResult | null;
  weakSounds: { phoneme: string; avgScore: number; count: number }[];
  history: PronunciationResult[];
  error: string | null;
}

export interface UsePronunciationReturn extends PronunciationState {
  /** Start recording for pronunciation assessment */
  startAssessment: () => Promise<void>;
  /** Stop recording and assess pronunciation against reference text */
  finishAssessment: (referenceText: string) => Promise<PronunciationResult | null>;
  /** Assess pronunciation from an existing audio file URI */
  assessFromUri: (uri: string, referenceText: string) => Promise<PronunciationResult | null>;
  /** Clear the current result */
  clearResult: () => void;
  /** Get phonemes that need the most work */
  getWeakPhonemes: () => PhonemeScore[];
  /** Is microphone recording active */
  isRecording: boolean;
}

export function usePronunciation(): UsePronunciationReturn {
  const recorder = useAudioRecorder();
  const [state, setState] = useState<PronunciationState>({
    isAssessing: false,
    result: null,
    weakSounds: [],
    history: [],
    error: null,
  });

  const startAssessment = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, result: null, error: null }));
    await recorder.startRecording();
  }, [recorder]);

  const finishAssessment = useCallback(
    async (referenceText: string): Promise<PronunciationResult | null> => {
      setState((prev) => ({ ...prev, isAssessing: true, error: null }));

      try {
        const uri = await recorder.stopRecording();
        if (!uri) {
          setState((prev) => ({ ...prev, isAssessing: false, error: "No audio recorded" }));
          return null;
        }

        // Read audio file as base64
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const result = await assessPronunciation(base64, referenceText);

        // Use functional updater to avoid stale closure over state.history
        setState((prev) => {
          const newHistory = [...prev.history, result];
          const weakSounds = identifyWeakSounds(newHistory);
          return {
            ...prev,
            isAssessing: false,
            result,
            history: newHistory,
            weakSounds,
          };
        });

        return result;
      } catch (err) {
        captureError(err, "pronunciation-assessment");
        const { message } = classifyError(
          err,
          "Pronunciation assessment failed. Please try recording again."
        );
        setState((prev) => ({ ...prev, isAssessing: false, error: message }));
        return null;
      }
    },
    [recorder]
  );

  const assessFromUri = useCallback(
    async (uri: string, referenceText: string): Promise<PronunciationResult | null> => {
      setState((prev) => ({ ...prev, isAssessing: true, error: null }));

      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const result = await assessPronunciation(base64, referenceText);

        // Use functional updater to avoid stale closure over state.history
        setState((prev) => {
          const newHistory = [...prev.history, result];
          const weakSounds = identifyWeakSounds(newHistory);
          return {
            ...prev,
            isAssessing: false,
            result,
            history: newHistory,
            weakSounds,
          };
        });

        return result;
      } catch (err) {
        captureError(err, "pronunciation-assessment");
        const { message } = classifyError(
          err,
          "Pronunciation assessment failed. Please try recording again."
        );
        setState((prev) => ({ ...prev, isAssessing: false, error: message }));
        return null;
      }
    },
    []
  );

  const clearResult = useCallback(() => {
    setState((s) => ({ ...s, result: null, error: null }));
  }, []);

  const getWeakPhonemes = useCallback((): PhonemeScore[] => {
    if (!state.result) return [];
    return state.result.weakPhonemes;
  }, [state.result]);

  return {
    ...state,
    isRecording: recorder.isRecording,
    startAssessment,
    finishAssessment,
    assessFromUri,
    clearResult,
    getWeakPhonemes,
  };
}
