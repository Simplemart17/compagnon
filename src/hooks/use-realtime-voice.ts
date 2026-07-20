/**
 * Realtime Voice Conversation Hook
 *
 * Story 12.1 / audit P1-17: thin React binding around `RealtimeOrchestrator`
 * (`src/lib/realtime-orchestrator.ts`). Pre-12-1 this was a 1,354-line "god
 * hook" running 14 responsibilities; post-12-1 the orchestrator class owns
 * all business logic and this file is purely state-binding + lifecycle.
 *
 * Public surface (`UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn`) is
 * IDENTICAL to pre-12-1 — the conversation screen at
 * `app/(tabs)/conversation/[sessionId].tsx` consumes this hook with zero
 * changes. The refactor is a private-implementation relocation.
 *
 * Line budget: spec target `≤ 250 lines` (`shippable-roadmap.md` line 218).
 * Drift detector at `src/hooks/__tests__/use-realtime-voice-line-budget.test.ts`
 * pins this; a future regression that grows the hook past the budget fails CI.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  INITIAL_STATE,
  RealtimeOrchestrator,
  type ConversationState,
  type RealtimeOrchestratorOptions,
  type TranscriptEntry,
  type VoiceName,
} from "@/src/lib/realtime-orchestrator";
import { useAuthStore } from "@/src/store/auth-store";
import type { CEFRLevel } from "@/src/types/cefr";
import type { ConversationMode, Correction } from "@/src/types/conversation";

// Re-exported so existing consumers (e.g. TranscriptView) keep their import path.
export type { TranscriptEntry, ConversationState };

export interface UseRealtimeVoiceOptions {
  cefrLevel: CEFRLevel;
  mode: ConversationMode;
  topic: string;
  topicDescription?: string;
  memories?: string[];
  errorPatterns?: string[];
  voice?: VoiceName;
  onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void;
  onConversationEnd?: (transcript: TranscriptEntry[], corrections: Correction[]) => void;
  /** Story 18-4: avatar mouth drive — see RealtimeOrchestratorOptions. */
  onAudioAmplitude?: (level: number) => void;
}

export interface UseRealtimeVoiceReturn extends ConversationState {
  start: () => Promise<void>;
  sendText: (text: string) => void;
  end: () => void;
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  // Lazy-construct orchestrator on first render. The orchestrator captures
  // its options at construction time; subsequent prop changes are NOT
  // propagated — matches the pre-12-1 behavior where the hook's
  // `useCallback` deps would re-create the start callback, but the
  // underlying session was already started so option changes were de-facto
  // immutable post-`start()`.
  //
  // Story 12-1 review-round-1 P17: read user via `useAuthStore.getState()`
  // at construction time instead of `useAuthStore((s) => s.user)`
  // subscription. The pre-patch subscription caused a hook re-render on
  // every auth change for zero behavioral benefit (the orchestrator's
  // user is fixed at construction; subsequent auth changes don't propagate).
  const orchestratorRef = useRef<RealtimeOrchestrator | null>(null);
  if (!orchestratorRef.current) {
    const orchestratorOptions: RealtimeOrchestratorOptions = {
      user: useAuthStore.getState().user,
      cefrLevel: options.cefrLevel,
      mode: options.mode,
      topic: options.topic,
      topicDescription: options.topicDescription,
      voice: options.voice,
      memories: options.memories,
      errorPatterns: options.errorPatterns,
      onTranscriptUpdate: options.onTranscriptUpdate,
      onConversationEnd: options.onConversationEnd,
      onAudioAmplitude: options.onAudioAmplitude,
    };
    orchestratorRef.current = new RealtimeOrchestrator(orchestratorOptions);
  }

  const [state, setState] = useState<ConversationState>(INITIAL_STATE);

  // Subscribe to orchestrator state updates on mount; clean up on unmount.
  useEffect(() => {
    const unsubscribe = orchestratorRef.current?.subscribe(setState);
    return unsubscribe;
  }, []);

  // Dispose orchestrator on unmount (cleans up timer, audio subscription,
  // session, subscribers).
  useEffect(() => {
    return () => {
      orchestratorRef.current?.dispose();
      orchestratorRef.current = null;
    };
  }, []);

  // Public surface — pure pass-throughs to orchestrator methods.
  const start = useCallback(async (): Promise<void> => {
    await orchestratorRef.current?.start();
  }, []);

  const sendText = useCallback((text: string): void => {
    orchestratorRef.current?.sendText(text);
  }, []);

  const end = useCallback((): void => {
    orchestratorRef.current?.end();
  }, []);

  return {
    ...state,
    start,
    sendText,
    end,
  };
}
