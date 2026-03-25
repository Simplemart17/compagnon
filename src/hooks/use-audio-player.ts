/**
 * Audio Playback Hook
 *
 * Wraps expo-audio's useAudioPlayer for playing AI voice responses.
 * Supports playing from URI or Base64 data.
 *
 * When `skipAudioModeConfig` is true, the hook will not call setAudioModeAsync
 * before playback. This prevents killing an active recording during voice
 * conversations (the audio mode is already configured by the recorder).
 */

import { useCallback, useRef, useState } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

import { prependWavHeader } from "@/src/lib/wav";

export interface AudioPlayerState {
  isPlaying: boolean;
  durationMs: number;
  positionMs: number;
  error: string | null;
}

export interface UseAudioPlayerOptions {
  /**
   * When true, skip calling setAudioModeAsync before playback.
   * Use this during active voice conversations where the recorder
   * has already configured the audio session and calling
   * setAudioModeAsync({ allowsRecording: false }) would kill the recording.
   */
  skipAudioModeConfig?: boolean;
}

export interface UseAudioPlayerReturn extends AudioPlayerState {
  playFromUri: (uri: string) => Promise<void>;
  playFromBase64: (base64: string, format?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  setPlaybackSpeed: (rate: number) => Promise<void>;
}

export function useAudioPlayer(options?: UseAudioPlayerOptions): UseAudioPlayerReturn {
  const skipAudioModeConfig = options?.skipAudioModeConfig ?? false;

  const [error, setError] = useState<string | null>(null);
  const tempUriRef = useRef<string | null>(null);

  const player = useExpoAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  /** Delete the current temp file if one exists */
  const cleanupTempFile = useCallback(async () => {
    if (tempUriRef.current) {
      await FileSystem.deleteAsync(tempUriRef.current, { idempotent: true }).catch(() => {});
      tempUriRef.current = null;
    }
  }, []);

  /**
   * Configure audio mode for playback.
   * Skipped when skipAudioModeConfig is true (during active voice conversations)
   * to avoid killing the active recording by setting allowsRecording to false.
   */
  const configurePlayback = useCallback(async () => {
    if (skipAudioModeConfig) return;

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
  }, [skipAudioModeConfig]);

  const playFromUri = useCallback(
    async (uri: string): Promise<void> => {
      try {
        await configurePlayback();
        player.replace({ uri });
        player.play();
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Playback failed";
        setError(message);
      }
    },
    [player, configurePlayback]
  );

  /**
   * Play audio from base64-encoded data.
   *
   * When format is "wav" or "pcm", the data is treated as raw PCM16 audio
   * and a proper 44-byte RIFF/WAV header is prepended before writing to disk.
   * This is required on Android where MediaPlayer cannot play headerless PCM.
   * The header specifies 24kHz mono 16-bit PCM (matching OpenAI Realtime API output).
   */
  const playFromBase64 = useCallback(
    async (base64: string, format = "mp3"): Promise<void> => {
      try {
        await configurePlayback();
        await cleanupTempFile();

        let audioData = base64;
        let fileExtension = format;

        // Raw PCM from OpenAI Realtime API needs a WAV header for Android playback
        if (format === "wav" || format === "pcm") {
          audioData = prependWavHeader(base64, 24000, 1, 16);
          fileExtension = "wav";
        }

        const tempUri = `${FileSystem.cacheDirectory}playback_${Date.now()}.${fileExtension}`;
        await FileSystem.writeAsStringAsync(tempUri, audioData, {
          encoding: FileSystem.EncodingType.Base64,
        });
        tempUriRef.current = tempUri;

        player.replace({ uri: tempUri });
        player.play();
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Playback failed";
        setError(message);
      }
    },
    [player, configurePlayback, cleanupTempFile]
  );

  const pause = useCallback(async (): Promise<void> => {
    player.pause();
  }, [player]);

  const resume = useCallback(async (): Promise<void> => {
    player.play();
  }, [player]);

  const stop = useCallback(async (): Promise<void> => {
    player.pause();
    void player.seekTo(0);
    await cleanupTempFile();
  }, [player, cleanupTempFile]);

  const setPlaybackSpeed = useCallback(
    async (rate: number): Promise<void> => {
      player.setPlaybackRate(rate);
    },
    [player]
  );

  return {
    isPlaying: status.playing,
    durationMs: (status.duration ?? 0) * 1000,
    positionMs: (status.currentTime ?? 0) * 1000,
    error,
    playFromUri,
    playFromBase64,
    pause,
    resume,
    stop,
    setPlaybackSpeed,
  };
}
