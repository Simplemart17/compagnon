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

/** Recording options optimized for speech (16kHz, mono, PCM) */
const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  android: {
    outputFormat: "default",
    audioEncoder: "default",
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

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    hasPermission: null,
    durationMs: 0,
    error: null,
  });

  const recorder = useExpoAudioRecorder(RECORDING_OPTIONS);
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
