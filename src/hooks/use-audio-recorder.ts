/**
 * Audio Recording Hook
 *
 * Wraps expo-audio's useAudioRecorder for capturing user speech.
 * Outputs Base64-encoded PCM16 chunks for streaming to OpenAI Realtime API.
 */

import { useCallback, useState } from "react";
import {
  useAudioRecorder as useExpoAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  setAudioModeAsync,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

export interface AudioRecorderState {
  isRecording: boolean;
  hasPermission: boolean | null;
  durationMs: number;
  error: string | null;
}

export interface UseAudioRecorderReturn extends AudioRecorderState {
  requestPermission: () => Promise<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  getBase64Audio: () => Promise<string | null>;
}

/**
 * Recording options optimized for speech (16kHz, mono).
 *
 * iOS: Records raw PCM16 (LinearPCM) in a .wav container — ideal for
 * pronunciation assessment and AI processing.
 *
 * Android: MediaRecorder does not support raw PCM output. We use AAC in
 * an MPEG-4 container (.m4a), which the pronunciation-assess Edge Function
 * can handle. The explicit format avoids the unpredictable "default" encoder.
 */
const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    sampleRate: 16000,
  },
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/wav",
    bitsPerSecond: 256000,
  },
};

/**
 * Low-bitrate AAC profile for the speaking mock-test (story 9-8).
 *
 * The speaking test records up to 5.5 minutes per task; the default LinearPCM
 * profile would produce ~10.5 MB raw, exceeding the `ai-proxy` 5 MB cap on
 * audio bodies (`supabase/functions/ai-proxy/index.ts:47`). 32 kbit AAC at
 * 16 kHz mono yields ~4 KB/sec → 5.5 min ≈ 1.3 MB, safely under the cap.
 *
 * Speech intelligibility at 32 kbit is well within Whisper's documented
 * tolerance — pronunciation/fluency grading is unaffected. This profile MUST
 * be used by the speaking screen and SHOULD NOT be used elsewhere (the
 * existing pronunciation/conversation surfaces benefit from the higher-quality
 * default for phoneme-level Azure assessment).
 */
export const RECORDING_OPTIONS_LOW_BITRATE: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    sampleRate: 16000,
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/mp4",
    bitsPerSecond: 32000,
  },
};

/**
 * Audio-recorder hook.
 *
 * @param options Optional `RecordingOptions`. Defaults to the high-quality
 *   `RECORDING_OPTIONS` profile (16 kHz / 16-bit / mono LinearPCM on iOS,
 *   AAC on Android) suitable for pronunciation assessment and conversation
 *   audio. Callers that need a different profile (e.g. `RECORDING_OPTIONS_LOW_BITRATE`
 *   for the speaking mock-test) MUST pass a STABLE reference — a module-level
 *   constant or a `useMemo`-ed object. Passing a fresh inline object literal
 *   per render (`useAudioRecorder({ ... })`) tears down and recreates the
 *   underlying expo-audio recorder on every render, which loses recording
 *   state and may drop in-flight audio. Story 9-8 review patch P13.
 */
export function useAudioRecorder(options?: RecordingOptions): UseAudioRecorderReturn {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    hasPermission: null,
    durationMs: 0,
    error: null,
  });

  const recorder = useExpoAudioRecorder(options ?? RECORDING_OPTIONS);
  // useAudioRecorderState polls the recorder for isRecording and durationMillis,
  // which are on RecorderState — not the event-based RecordingStatus type.
  const recorderState = useAudioRecorderState(recorder, 100);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      setState((s) => ({ ...s, hasPermission: granted }));
      return granted;
    } catch {
      setState((s) => ({ ...s, hasPermission: false, error: "Permission request failed" }));
      return false;
    }
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      if (state.hasPermission === null) {
        const granted = await requestPermission();
        if (!granted) {
          setState((s) => ({ ...s, error: "Microphone permission denied" }));
          return;
        }
      } else if (!state.hasPermission) {
        setState((s) => ({ ...s, error: "Microphone permission denied" }));
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setState((s) => ({ ...s, isRecording: true, durationMs: 0, error: null }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Recording failed";
      setState((s) => ({ ...s, isRecording: false, error: message }));
    }
  }, [state.hasPermission, requestPermission, recorder]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!recorderState.isRecording) {
      return null;
    }

    try {
      await recorder.stop();
      const uri = recorder.uri ?? null;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      });

      return uri;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stop recording failed";
      setState((s) => ({ ...s, error: message }));
      return null;
    }
  }, [recorder, recorderState.isRecording]);

  const getBase64Audio = useCallback(async (): Promise<string | null> => {
    const uri = await stopRecording();
    if (!uri) return null;

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64;
    } catch {
      setState((s) => ({ ...s, error: "Failed to read audio data" }));
      return null;
    }
  }, [stopRecording]);

  return {
    // Derive isRecording and durationMs from recorderState (ground truth from native)
    isRecording: recorderState.isRecording,
    durationMs: recorderState.durationMillis,
    hasPermission: state.hasPermission,
    error: state.error,
    requestPermission,
    startRecording,
    stopRecording,
    getBase64Audio,
  };
}
