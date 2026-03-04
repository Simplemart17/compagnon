/**
 * Audio Playback Hook
 *
 * Wraps expo-audio's useAudioPlayer for playing AI voice responses.
 * Supports playing from URI or Base64 data.
 */

import { useCallback, useRef, useState } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

export interface AudioPlayerState {
  isPlaying: boolean;
  durationMs: number;
  positionMs: number;
  error: string | null;
}

export interface UseAudioPlayerReturn extends AudioPlayerState {
  playFromUri: (uri: string) => Promise<void>;
  playFromBase64: (base64: string, format?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  setPlaybackSpeed: (rate: number) => Promise<void>;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
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

  const configurePlayback = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
  }, []);

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

  const playFromBase64 = useCallback(
    async (base64: string, format = "mp3"): Promise<void> => {
      try {
        await configurePlayback();
        await cleanupTempFile();

        const tempUri = `${FileSystem.cacheDirectory}playback_${Date.now()}.${format}`;
        await FileSystem.writeAsStringAsync(tempUri, base64, {
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
