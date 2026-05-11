/**
 * Realtime Voice Conversation Hook
 *
 * Orchestrates the full voice conversation experience:
 * - Connects to OpenAI Realtime API via WebSocket
 * - Streams user audio from microphone to WebSocket
 * - Receives and plays AI audio responses
 * - Manages transcript, corrections, and conversation state
 * - Persists conversations and vocabulary to Supabase
 * - Handles AI function calls (save_vocabulary, note_error_pattern, report_correction)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";
import type { EventSubscription } from "expo-modules-core";

import { RealtimeSession, type RealtimeConfig, type RealtimeEvent } from "@/src/lib/realtime";
import {
  acceptDelta,
  appendIfNew,
  resolveTranscriptKey,
  type TranscriptEntry,
} from "@/src/lib/realtime-transcript";
import { buildConversationPrompt } from "@/src/lib/prompts/conversation";
import { chatCompletionJSON } from "@/src/lib/openai";
import { conversationFeedbackSchema } from "@/src/lib/schemas/ai-responses";
import {
  drainPendingCorrections,
  MAX_PENDING_CORRECTIONS,
  mergeOrphanCorrections,
  processReportCorrectionCall,
} from "@/src/lib/realtime-corrections";
import { computeSpeakingScore } from "@/src/lib/speaking-score";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { extractAndStoreMemories } from "@/src/lib/memory";
import { trackError, extractErrorsFromCorrections } from "@/src/lib/error-tracker";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";
import { isOnline } from "@/src/lib/network";
import { enqueueWrite } from "@/src/lib/cache";
import {
  updateStreak,
  updateSkillProgress,
  incrementDailyActivity,
  checkCefrPromotion,
} from "@/src/lib/activity";
import type { CEFRLevel } from "@/src/types/cefr";
import type { ConversationFeedback, ConversationMode, Correction } from "@/src/types/conversation";

// Re-exported so existing consumers (e.g. TranscriptView) keep their import path.
// The canonical definition lives in `@/src/lib/realtime-transcript`.
export type { TranscriptEntry };

export interface ConversationState {
  status: "idle" | "connecting" | "connected" | "error" | "disconnected" | "ended";
  isSpeaking: boolean;
  isAiSpeaking: boolean;
  isProcessing: boolean;
  transcript: TranscriptEntry[];
  pendingAiText: string;
  allCorrections: Correction[];
  durationSeconds: number;
  error: string | null;
  feedback: ConversationFeedback | null;
  conversationId: string | null;
}

export interface UseRealtimeVoiceOptions {
  cefrLevel: CEFRLevel;
  mode: ConversationMode;
  topic: string;
  topicDescription?: string;
  memories?: string[];
  errorPatterns?: string[];
  voice?:
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "sage"
    | "shimmer"
    | "verse"
    | "marin"
    | "cedar";
  onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void;
  onConversationEnd?: (transcript: TranscriptEntry[], corrections: Correction[]) => void;
}

export interface UseRealtimeVoiceReturn extends ConversationState {
  start: () => Promise<void>;
  sendText: (text: string) => void;
  end: () => void;
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  const {
    cefrLevel,
    mode,
    topic,
    topicDescription,
    memories,
    errorPatterns,
    voice = "coral",
    onTranscriptUpdate,
    onConversationEnd,
  } = options;

  const user = useAuthStore((s) => s.user);

  const [state, setState] = useState<ConversationState>({
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
  });

  const sessionRef = useRef<RealtimeSession | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endRef = useRef<(() => void) | null>(null);
  const isEndingRef = useRef(false);
  const currentAiTextRef = useRef("");
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const correctionsRef = useRef<Correction[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const durationSecondsRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  /** Set of upstream item/response keys whose terminal `.done` event has already produced a TranscriptEntry. */
  const processedResponseItemsRef = useRef<Set<string>>(new Set());
  /** item_id of the AI response currently being streamed; null between turns. */
  const inflightItemIdRef = useRef<string | null>(null);
  /** Monotonic counter for user-side TranscriptEntry ids; collision-free across same-millisecond bursts. */
  const userTurnCounterRef = useRef(0);
  /**
   * Corrections accumulated during the current AI turn via `report_correction`
   * tool-calls. Drained by the `parseCorrections` callback when `appendIfNew`
   * consumes the terminal `response.output_audio_transcript.done`. Also
   * cleared on `response.done` and on `case "error"` so an orphaned tool-call
   * without a terminating transcript cannot leak into the next turn.
   * Story 11-1.
   */
  const pendingToolCorrectionsRef = useRef<Correction[]>([]);
  /**
   * Tracks the broad AI-response window: set true when the user's turn ends
   * (`speech_stopped` — the AI is about to / is responding) and cleared on
   * `response.done` or `case "error"`. Used by the `report_correction`
   * handler's P1 inflight gate to accept legitimate tool-calls that fire
   * BEFORE the first audio delta (which is what sets `inflightItemIdRef`).
   *
   * Story 11-1 review-round-2 patch P16: the original P1 gate used only
   * `inflightItemIdRef.current !== null`, which is set by the first
   * audio-transcript delta. A tool-only turn (model invokes
   * `report_correction` with no audible response) or a tool-then-audio
   * ordering would have inflightItemIdRef still null at the tool-call
   * moment — the original gate dropped these as "outside turn." The
   * widened gate accepts any tool-call during the response window.
   */
  const responseInFlightRef = useRef(false);

  // Audio recording via expo-audio-stream (full-duplex PCM streaming)
  const subscriptionRef = useRef<EventSubscription | null>(null);
  const turnIdRef = useRef(0);

  /**
   * Drain the per-turn `report_correction` tool-call buffer.
   *
   * Story 11-1 — replaces the pre-11-1 regex parser
   * (`/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g`) and the keyword-matching
   * `inferCategory` heuristic. Both are deleted (Story 10-2 "delete don't
   * alias" pattern). Corrections now arrive structurally via the
   * `report_correction` tool-call; the model classifies `category` directly.
   *
   * Called by `appendIfNew` (`src/lib/realtime-transcript.ts`) when the
   * terminal `response.output_audio_transcript.done` fires for an AI turn.
   * The `AppendOptions.parseCorrections: (text: string) => Correction[]`
   * signature is preserved per Story 9-5 contract; the pure helper module
   * is NOT touched. The `text` parameter is intentionally unused.
   *
   * An earlier draft emitted a `level: "info"` breadcrumb on every empty
   * drain — rejected during review because typical 5–10 min conversations
   * have 15–30 user turns, most of which produce no corrections, which
   * would flood Sentry with low-signal noise. The presence-of-corrections
   * signal is reachable via the tool-call invocation handler's existing
   * breadcrumbs; absence-of-corrections is uninteresting in isolation.
   */
  const parseCorrections = useCallback((_text: string): Correction[] => {
    return drainPendingCorrections(pendingToolCorrectionsRef.current);
  }, []);

  /** Start microphone recording and stream PCM audio to WebSocket */
  const startAudioStreaming = useCallback(async () => {
    try {
      const { granted } = await ExpoPlayAudioStream.requestPermissionsAsync();
      if (!granted) {
        setState((s) => ({ ...s, error: "Microphone permission denied" }));
        return;
      }

      // Configure for conversation mode (full-duplex recording + playback)
      // 24kHz required by OpenAI Realtime GA API for both input and output
      // 24kHz required by OpenAI Realtime API; native audio supports it
      // even though the library's TS types only enumerate 16000|44100|48000
      await ExpoPlayAudioStream.setSoundConfig({
        sampleRate: 24000 as Parameters<typeof ExpoPlayAudioStream.setSoundConfig>[0]["sampleRate"],
        playbackMode: "conversation",
      });

      const { subscription } = await ExpoPlayAudioStream.startRecording({
        sampleRate: 24000 as Parameters<typeof ExpoPlayAudioStream.startRecording>[0]["sampleRate"],
        channels: 1,
        encoding: "pcm_16bit",
        interval: 250,
        onAudioStream: async (event) => {
          if (sessionRef.current?.isConnected && event.data) {
            sessionRef.current.appendAudio(event.data as string);
          }
        },
      });

      subscriptionRef.current = subscription ?? null;
    } catch (err) {
      captureError(err, "realtime-voice-audio");
      const message = err instanceof Error ? err.message : "Microphone error";
      console.error("[RealtimeVoice] Audio streaming error:", err);
      setState((s) => ({ ...s, error: message }));
    }
  }, []);

  /** Stop microphone recording */
  const stopAudioStreaming = useCallback(async () => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    try {
      await ExpoPlayAudioStream.stopRecording();
    } catch {
      // Ignore cleanup errors
    }
  }, []);

  /** Handle AI function calls (vocabulary saving, error tracking) */
  const handleFunctionCall = useCallback(
    async (name: string, args: string, callId: string) => {
      try {
        const parsed = JSON.parse(args);

        if (name === "save_vocabulary" && user) {
          if (!parsed.french_word || !parsed.english_translation) {
            sessionRef.current?.sendFunctionResult(callId, "Missing required fields.");
            return;
          }
          const { error } = await supabase.from("vocabulary").upsert(
            {
              user_id: user.id,
              french_word: parsed.french_word,
              english_translation: parsed.english_translation,
              context_sentence: parsed.context_sentence ?? null,
              cefr_level: cefrLevel,
            },
            { onConflict: "user_id,french_word" }
          );
          if (error) {
            captureError(error, "save-vocabulary");
            sessionRef.current?.sendFunctionResult(callId, "Failed to save vocabulary.");
          } else {
            sessionRef.current?.sendFunctionResult(callId, "Vocabulary saved.");
          }
        } else if (name === "note_error_pattern" && user) {
          if (!parsed.error_type || !parsed.description) {
            sessionRef.current?.sendFunctionResult(callId, "Missing required fields.");
            return;
          }
          await trackError(user.id, parsed.error_type, parsed.description);
          sessionRef.current?.sendFunctionResult(callId, "Error pattern noted.");
        } else if (name === "report_correction") {
          // Story 11-1 — structured tool-call replaces the legacy
          // `parseCorrections` regex bridge. Pure helper at
          // `src/lib/realtime-corrections.ts` owns the safeParse +
          // result-string contract; the hook owns the buffer + breadcrumb
          // + sendFunctionResult side effects.
          //
          // Review patch P1 (HIGH; widened by P16 in review-round-2): gate
          // the push on an in-flight AI turn to defend against tool-calls
          // that land AFTER `response.done` (theoretically possible per
          // the GA API). Without the gate, a late tool-call would pollute
          // the NEXT turn's correction set. The widened gate accepts a
          // tool-call when EITHER `responseInFlightRef.current` is true
          // (the broad response window from `speech_stopped` to
          // `response.done`) OR `inflightItemIdRef.current` is non-null
          // (set on the first audio-transcript delta). The original
          // `inflightItemIdRef`-only gate over-rejected legitimate
          // tool-only turns where the model invokes `report_correction`
          // before any audio delta fires.
          if (!responseInFlightRef.current && inflightItemIdRef.current === null) {
            addBreadcrumb({
              category: "realtime",
              level: "warning",
              message: "report_correction outside in-flight turn dropped",
              data: { feature: "realtime-report-correction" },
            });
            sessionRef.current?.sendFunctionResult(
              callId,
              "Rejected: outside-turn. Tool-call arrived outside the AI response window; correction not recorded."
            );
            return;
          }
          // Review patch P9 (MED): cap the buffer to defend against a
          // runaway model spamming the tool. Per-turn upper bound is
          // `MAX_PENDING_CORRECTIONS` (20); a single AI turn rarely
          // exceeds 3-4 corrections. Review-round-2 patch P20: rejection
          // message shape standardized across the three rejection paths
          // (outside-turn / buffer-full / invalid-shape) — each starts
          // with `"Rejected: <reason>."` so the model can pattern-match
          // and self-correct in a uniform way.
          if (pendingToolCorrectionsRef.current.length >= MAX_PENDING_CORRECTIONS) {
            addBreadcrumb({
              category: "realtime",
              level: "warning",
              message: "report_correction buffer cap reached",
              data: { feature: "realtime-report-correction" },
            });
            sessionRef.current?.sendFunctionResult(
              callId,
              "Rejected: buffer-full. Reached MAX_PENDING_CORRECTIONS for this turn; correction not recorded. Skip further invocations until the next turn."
            );
            return;
          }
          const callResult = processReportCorrectionCall(parsed);
          if (callResult.outcome === "invalid") {
            addBreadcrumb({
              category: "ai",
              level: "warning",
              message: "report_correction args parse failed",
              data: {
                feature: "realtime-report-correction",
                code: callResult.issueCode,
              },
            });
          } else {
            pendingToolCorrectionsRef.current.push(callResult.correction);
          }
          sessionRef.current?.sendFunctionResult(callId, callResult.resultMessage);
        } else {
          sessionRef.current?.sendFunctionResult(callId, "Unknown function.");
        }
      } catch (err) {
        captureError(err, "function-call-handler");
        sessionRef.current?.sendFunctionResult(callId, "Function call failed.");
      }
    },
    [user, cefrLevel]
  );

  /**
   * Append a single AI-turn transcript entry, applying response-id dedup.
   * Returns true if the entry was added, false if it was deduped.
   *
   * Centralized so both the audio-transcript and text-fallback paths route
   * through one append + one parseCorrections call. See story 9-5.
   */
  const appendAiTranscriptEntry = useCallback(
    (text: string, key: string): boolean => {
      const result = appendIfNew(
        {
          processed: processedResponseItemsRef.current,
          transcript: transcriptRef.current,
          corrections: correctionsRef.current,
        },
        key,
        text,
        {
          parseCorrections,
          onDedup: (k) => {
            // Defensive: dedup is expected behavior, not an error. A breadcrumb
            // gives us visibility if the safety net ever fires in production
            // after the modality switch. `key` is on the Sentry allowlist;
            // free-text content is intentionally not logged.
            addBreadcrumb({
              category: "realtime",
              level: "warning",
              message: "Duplicate transcript event suppressed",
              data: { key: k },
            });
          },
        }
      );

      if (!result.appended) return false;

      transcriptRef.current = result.transcript;
      correctionsRef.current = result.corrections;

      // Only clear streaming state if the appended turn IS the in-flight one.
      // This protects a still-streaming turn from being wiped by an out-of-turn
      // terminal event that happens to land first (e.g., a duplicated `.done`
      // for an already-completed earlier turn whose key is still in the Set
      // would never reach here, but a mis-ordered `.done` for a different
      // item_id could).
      const isInflight = inflightItemIdRef.current === null || inflightItemIdRef.current === key;
      if (isInflight) {
        currentAiTextRef.current = "";
        inflightItemIdRef.current = null;
      }

      setState((s) => ({
        ...s,
        transcript: result.transcript,
        pendingAiText: isInflight ? "" : s.pendingAiText,
        allCorrections: result.corrections,
      }));

      onTranscriptUpdate?.(result.transcript);
      return true;
    },
    [parseCorrections, onTranscriptUpdate]
  );

  /** Handle incoming Realtime API events */
  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case "session.created":
          setState((s) => ({ ...s, status: "connected" }));
          break;

        case "input_audio_buffer.speech_started":
          setState((s) => ({ ...s, isSpeaking: true }));
          break;

        case "input_audio_buffer.speech_stopped":
          // Story 11-1 review-round-2 patch P16: the AI's response window
          // opens here (user finished speaking → AI starts processing).
          // P1 inflight gate uses this so a tool-only response (no audio)
          // can still record corrections.
          responseInFlightRef.current = true;
          setState((s) => ({ ...s, isSpeaking: false, isProcessing: true }));
          break;

        // GA API event names use `output_` prefix for response audio/text events
        case "response.output_audio.delta": {
          // Stream each audio chunk immediately for low-latency playback
          const turnId = `turn_${turnIdRef.current}`;
          void ExpoPlayAudioStream.playSound(event.delta, turnId, "pcm_s16le");
          setState((s) => ({ ...s, isAiSpeaking: true, isProcessing: false }));
          break;
        }

        case "response.output_audio.done":
          turnIdRef.current++;
          setState((s) => ({ ...s, isAiSpeaking: false }));
          break;

        // Defensive: with output_modalities=["audio"], this event should not fire.
        // The acceptDelta guard drops it if the audio-transcript path has already
        // adopted an in-flight item_id; if the modality config ever drifts, the
        // .done helper's response-id dedup blocks the duplicate entry.
        case "response.output_text.delta": {
          const result = acceptDelta(
            {
              inflightItemId: inflightItemIdRef.current,
              pendingText: currentAiTextRef.current,
            },
            event.item_id ?? null,
            event.delta
          );
          if (result.accepted) {
            inflightItemIdRef.current = result.state.inflightItemId;
            currentAiTextRef.current = result.state.pendingText;
            setState((s) => ({ ...s, pendingAiText: currentAiTextRef.current }));
          }
          break;
        }

        case "response.output_text.done": {
          const key = resolveTranscriptKey(event, event.text);
          appendAiTranscriptEntry(event.text, key);
          break;
        }

        // In voice mode, the AI responds with audio and the transcript arrives
        // via response.output_audio_transcript events (GA API naming).
        case "response.output_audio_transcript.delta": {
          const result = acceptDelta(
            {
              inflightItemId: inflightItemIdRef.current,
              pendingText: currentAiTextRef.current,
            },
            event.item_id ?? null,
            event.delta
          );
          if (result.accepted) {
            inflightItemIdRef.current = result.state.inflightItemId;
            currentAiTextRef.current = result.state.pendingText;
            setState((s) => ({ ...s, pendingAiText: currentAiTextRef.current }));
          }
          break;
        }

        case "response.output_audio_transcript.done": {
          const key = resolveTranscriptKey(event, event.transcript);
          appendAiTranscriptEntry(event.transcript, key);
          break;
        }

        case "conversation.item.created": {
          const item = event.item as {
            role?: string;
            content?: { type: string; transcript?: string }[];
          };
          if (item?.role === "user" && item?.content) {
            const textContent = item.content.find(
              (c: { type: string; transcript?: string }) => c.type === "input_audio" && c.transcript
            );
            if (textContent?.transcript) {
              const entry: TranscriptEntry = {
                id: `user_${userTurnCounterRef.current++}`,
                role: "user",
                text: textContent.transcript,
                timestamp: Date.now(),
              };

              transcriptRef.current = [...transcriptRef.current, entry];
              setState((s) => ({ ...s, transcript: transcriptRef.current }));
              onTranscriptUpdate?.(transcriptRef.current);
            }
          }
          break;
        }

        case "response.function_call_arguments.done":
          void handleFunctionCall(event.name, event.arguments, event.call_id);
          break;

        case "response.done":
          // Safety reset: clear processing if response completes without audio.
          // Story 11-1 review patch P2 (HIGH): if the turn ends without a
          // terminal `response.output_audio_transcript.done` event firing
          // (e.g., the model invoked `report_correction` but produced no
          // audible response, or the transcript event was suppressed by
          // an upstream defect), the buffered corrections would be silently
          // discarded. Drain them into `correctionsRef.current` instead so
          // the post-conversation pipeline (`extractErrorsFromCorrections`
          // + speaking-score formula) still sees them. The breadcrumb fires
          // only when the buffer is non-empty (the actual signal worth
          // tracking).
          {
            // Review-round-2 patch P18: orphan-drain merge extracted to
            // the pure helper `mergeOrphanCorrections` for testability.
            // Mutates the buffer (drained empty) and returns a new
            // conversation list + breadcrumb-fire signal.
            const merged = mergeOrphanCorrections(
              correctionsRef.current,
              pendingToolCorrectionsRef.current
            );
            if (merged.shouldBreadcrumb) {
              correctionsRef.current = merged.conversation;
              // Review-round-2 patch P17 (MED): pass a snapshot spread of
              // the ref so React's render reads a stable array, not a live
              // alias that could be mutated again before the render commits.
              setState((s) => ({ ...s, allCorrections: [...correctionsRef.current] }));
              addBreadcrumb({
                category: "realtime",
                level: "warning",
                message: "Orphan tool corrections drained at response.done",
                data: { category: "report_correction" },
              });
            }
          }
          // Also drop any in-flight delta accumulator so a cancelled or
          // tool-only turn cannot leak its pending text into the prefix of
          // the next turn (whose first delta would otherwise concatenate
          // onto the leftover via `acceptDelta`'s adopt path).
          inflightItemIdRef.current = null;
          currentAiTextRef.current = "";
          // Review-round-2 patch P16: close the response window so any
          // late-arriving `report_correction` tool-call is rejected by
          // the P1 gate (cleared AFTER the orphan-drain above so the
          // drain's correctionsRef merge captures any pending tool-call
          // results emitted by the same response).
          responseInFlightRef.current = false;
          setState((s) => ({ ...s, isProcessing: false, pendingAiText: "" }));
          break;

        case "error":
          captureError(event.error, "realtime-voice-error");
          // Drop any in-flight delta accumulator on every error path so a
          // mid-stream failure (rate limit, transient API error) cannot leak
          // the cancelled turn's prefix into the next one if the session is
          // resumed without a full `start()`.
          inflightItemIdRef.current = null;
          currentAiTextRef.current = "";
          // Review-round-2 patch P16: close the response window on error
          // so late tool-calls fall to the P1 rejection path. The orphan-
          // drain below preserves any in-buffer corrections from before
          // the error.
          responseInFlightRef.current = false;
          // Story 11-1 review patch P3 (HIGH): on `connection_lost` the
          // `end()` path persists the conversation including
          // `correctionsRef.current`. If we silently cleared the pending
          // tool-correction buffer here, validated corrections from
          // successful tool-calls that landed BEFORE the error would be
          // lost from the persisted record (and from `extractErrorsFromCorrections`
          // + the speaking-score formula). Drain into `correctionsRef.current`
          // first so the persisted snapshot is complete; breadcrumb when
          // non-empty so operators have visibility. The breadcrumb here
          // is distinct from `captureError(event.error, "realtime-voice-error")`
          // at the top of this case — the captureError is for the API
          // failure; this breadcrumb is for the data-preservation event.
          {
            // Review-round-2 patch P18: orphan-drain merge extracted to
            // the pure helper `mergeOrphanCorrections` for testability.
            const merged = mergeOrphanCorrections(
              correctionsRef.current,
              pendingToolCorrectionsRef.current
            );
            if (merged.shouldBreadcrumb) {
              correctionsRef.current = merged.conversation;
              setState((s) => ({ ...s, allCorrections: [...correctionsRef.current] }));
              addBreadcrumb({
                category: "realtime",
                level: "warning",
                message: "Orphan tool corrections drained at error",
                data: { category: "report_correction" },
              });
            }
          }
          if (event.error.code === "connection_lost") {
            // Mark disconnected immediately, then clean up & persist
            setState((s) => ({
              ...s,
              status: "disconnected",
              error: event.error.message,
              isProcessing: false,
              isSpeaking: false,
              isAiSpeaking: false,
              pendingAiText: "",
            }));
            // endRef is set below — triggers full cleanup + persist
            endRef.current?.();
          } else {
            setState((s) => ({
              ...s,
              status: "error",
              error: event.error.message,
              isProcessing: false,
              pendingAiText: "",
            }));
          }
          break;
      }
    },
    [appendAiTranscriptEntry, handleFunctionCall, onTranscriptUpdate]
  );

  /** Create a conversation record in Supabase */
  const createConversationRecord = useCallback(async (): Promise<string | null> => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        topic,
        scenario_description: topicDescription,
        cefr_level: cefrLevel,
        mode,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !data) {
      if (error) captureError(error, "create-conversation-record");
      return null;
    }
    return data.id;
  }, [user, topic, topicDescription, cefrLevel, mode]);

  /** Persist conversation results to Supabase */
  const persistConversation = useCallback(
    async (duration: number) => {
      if (!user || !conversationIdRef.current) {
        if (user && !conversationIdRef.current) {
          captureError(
            new Error("Conversation ID is null — data will not be saved"),
            "persist-conversation"
          );
        }
        return;
      }

      const conversationId = conversationIdRef.current;
      const minutesPracticed = Math.ceil(duration / 60);

      // If offline (e.g., after connection_lost), queue critical data and bail
      const online = await isOnline();
      if (!online) {
        try {
          // Queue conversation completion update
          await enqueueWrite({
            table: "conversations",
            operation: "update",
            payload: {
              duration_seconds: duration,
              status: "completed",
              completed_at: new Date().toISOString(),
            },
            filter: { column: "id", value: conversationId },
          });

          // Queue transcript messages
          const messages = transcriptRef.current.map((entry) => ({
            conversation_id: conversationId,
            role: entry.role,
            content: entry.text,
            corrections: entry.corrections ?? null,
          }));
          for (const msg of messages) {
            await enqueueWrite({
              table: "conversation_messages",
              operation: "insert",
              payload: msg as unknown as Record<string, unknown>,
            });
          }
        } catch (queueErr) {
          captureError(queueErr, "persist-conversation-offline-queue");
        }
        return;
      }

      try {
        // 1. Update conversation record
        const { error: updateError } = await supabase
          .from("conversations")
          .update({
            duration_seconds: duration,
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", conversationId);
        if (updateError) captureError(updateError, "persist-conversation-update");

        // 2. Save transcript messages
        const messages = transcriptRef.current.map((entry) => ({
          conversation_id: conversationId,
          role: entry.role,
          content: entry.text,
          corrections: entry.corrections ?? null,
        }));

        if (messages.length > 0) {
          const { error: msgError } = await supabase.from("conversation_messages").insert(messages);
          if (msgError) captureError(msgError, "persist-conversation-messages");
        }

        // 3. Extract and store companion memories
        const transcript = transcriptRef.current.map((e) => `${e.role}: ${e.text}`).join("\n");

        if (transcript.length > 50) {
          extractAndStoreMemories(user.id, conversationId, transcript).catch((err) =>
            captureError(err, "extract-memories")
          );
        }

        // 3b. Extract error patterns from corrections for targeted drills
        if (correctionsRef.current.length > 0) {
          extractErrorsFromCorrections(user.id, correctionsRef.current).catch((err) =>
            captureError(err, "extract-error-patterns")
          );
        }

        // 4. Update skill progress for speaking (with score based on corrections ratio).
        // Formula extracted to `src/lib/speaking-score.ts` for testability +
        // future-tuning baseline. Caps penalty at 30% per correction-to-utterance
        // ratio, with minimum score of 20 and a 70 default for zero-utterance
        // sessions. Story 11-1 — INPUT accuracy improved (corrections now from
        // `report_correction` tool-call, not the deleted regex); the formula
        // itself is unchanged.
        const totalEntries = transcriptRef.current.filter((e) => e.role === "user").length;
        const correctedEntries = correctionsRef.current.length;
        const speakingScore = computeSpeakingScore(totalEntries, correctedEntries);
        await updateSkillProgress(user.id, "speaking", cefrLevel, speakingScore, minutesPracticed);

        // 5. Increment daily activity
        await incrementDailyActivity(user.id, {
          minutes: minutesPracticed,
          conversations: 1,
        });

        // 6. Update streak
        await updateStreak(user.id);

        // 7. Check for CEFR level promotion
        await checkCefrPromotion(user.id);

        // 8. Generate AI feedback summary (non-blocking for UI)
        if (transcript.length > 50) {
          try {
            const feedback = await chatCompletionJSON(
              [
                {
                  role: "system",
                  content: `Analyze this French conversation transcript and provide feedback. The user's CEFR level is ${cefrLevel}.
Return JSON: {
  "summary": "1-2 sentence overall assessment in English",
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["area for improvement 1", "area for improvement 2"],
  "vocabularyUsed": <number of distinct French words the user used>,
  "fluencyRating": <1-5 scale>,
  "grammarRating": <1-5 scale>
}`,
                },
                { role: "user", content: transcript },
              ],
              conversationFeedbackSchema,
              { temperature: 0.3, feature: "conversation-feedback" }
            );
            setState((s) => ({ ...s, feedback }));

            // Save feedback to conversation record
            await supabase
              .from("conversations")
              .update({ ai_feedback: feedback })
              .eq("id", conversationId);
          } catch (err) {
            captureError(err, "conversation-feedback-generation");
          }
        }
      } catch (err) {
        captureError(err, "persist-conversation");
      }
    },
    [user, cefrLevel]
  );

  /** Start the voice conversation */
  const start = useCallback(async (): Promise<void> => {
    // Guard against concurrent invocations
    if (statusRef.current === "connecting" || statusRef.current === "connected") return;

    // Reset ALL refs and state so retries start clean
    transcriptRef.current = [];
    correctionsRef.current = [];
    currentAiTextRef.current = "";
    durationSecondsRef.current = 0;
    startTimeRef.current = 0;
    conversationIdRef.current = null;
    isEndingRef.current = false;
    processedResponseItemsRef.current = new Set();
    inflightItemIdRef.current = null;
    userTurnCounterRef.current = 0;
    pendingToolCorrectionsRef.current = [];
    responseInFlightRef.current = false;

    setState({
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

    try {
      const convoId = await createConversationRecord();
      if (!convoId) {
        throw new Error("Failed to create conversation record");
      }
      conversationIdRef.current = convoId;
      setState((prev) => ({ ...prev, conversationId: convoId }));

      const systemPrompt = buildConversationPrompt({
        cefrLevel,
        mode,
        topic,
        topicDescription,
        memories,
        errorPatterns,
      });

      const config: RealtimeConfig = {
        systemPrompt,
        voice,
        turnDetection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
        tools: [
          {
            type: "function",
            name: "save_vocabulary",
            description: "Save a new vocabulary word the user learned",
            parameters: {
              type: "object",
              properties: {
                french_word: { type: "string", description: "The French word" },
                english_translation: { type: "string", description: "English translation" },
                context_sentence: { type: "string", description: "Example sentence in French" },
              },
              required: ["french_word", "english_translation"],
            },
          },
          {
            type: "function",
            name: "note_error_pattern",
            description: "Track a recurring error pattern the user is making",
            parameters: {
              type: "object",
              properties: {
                error_type: {
                  type: "string",
                  enum: ["grammar", "pronunciation", "vocabulary", "register"],
                },
                description: { type: "string", description: "Description of the error pattern" },
              },
              required: ["error_type", "description"],
            },
          },
          {
            type: "function",
            name: "report_correction",
            description:
              "Report a French-language correction the user needs. Invoke this whenever the user's French contains a grammar / pronunciation / vocabulary / register error worth correcting. Do NOT emit corrections as text in your audio response — invoke this function instead. The function is silent (your audio response is unaffected). Multiple invocations per turn are allowed (one per distinct error).",
            parameters: {
              type: "object",
              properties: {
                original: {
                  type: "string",
                  description: "The exact French the user said, verbatim (no quotes around it).",
                },
                corrected: {
                  type: "string",
                  description: "The correct French form.",
                },
                explanation: {
                  type: "string",
                  description:
                    "Brief plain-French explanation of why the correction applies. Avoid nested parentheses. 1-2 sentences.",
                },
                category: {
                  type: "string",
                  enum: ["grammar", "pronunciation", "vocabulary", "register"],
                  description: "The error category. Pick the single best fit.",
                },
              },
              required: ["original", "corrected", "explanation", "category"],
            },
          },
        ],
      };

      const session = new RealtimeSession(config);
      session.on(handleEvent);
      await session.connect();
      sessionRef.current = session;

      // Start mic audio streaming to WebSocket
      await startAudioStreaming();

      // Start duration timer using Date.now() to prevent drift
      startTimeRef.current = Date.now();
      durationRef.current = setInterval(() => {
        durationSecondsRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setState((s) => ({ ...s, durationSeconds: durationSecondsRef.current }));
      }, 1000);

      // AI starts the conversation
      session.sendText(
        `Begin the conversation by greeting the user in French and introducing the topic: "${topic}". The user is at ${cefrLevel} level.`
      );
    } catch (err) {
      captureError(err, "realtime-voice-connection");
      const message = err instanceof Error ? err.message : "Connection failed";
      setState((s) => ({ ...s, status: "error", error: message }));
    }
  }, [
    cefrLevel,
    mode,
    topic,
    topicDescription,
    memories,
    errorPatterns,
    voice,
    handleEvent,
    createConversationRecord,
    startAudioStreaming,
  ]);

  /** Send a text message */
  const sendText = useCallback(
    (text: string): void => {
      if (!sessionRef.current?.isConnected) return;

      const entry: TranscriptEntry = {
        id: `user_${userTurnCounterRef.current++}`,
        role: "user",
        text,
        timestamp: Date.now(),
      };

      transcriptRef.current = [...transcriptRef.current, entry];
      setState((s) => ({ ...s, transcript: transcriptRef.current }));
      onTranscriptUpdate?.(transcriptRef.current);

      sessionRef.current.sendText(text);
    },
    [onTranscriptUpdate]
  );

  /** End the conversation */
  const end = useCallback((): void => {
    // Guard against double invocation (e.g., connection_lost → end → disconnect → onclose → end)
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }

    void stopAudioStreaming();
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    void ExpoPlayAudioStream.stopSound();

    const duration = durationSecondsRef.current;
    // Preserve "disconnected" status if already set by connection_lost handler
    setState((s) => ({
      ...s,
      status: s.status === "disconnected" ? "disconnected" : "ended",
      isSpeaking: false,
      isAiSpeaking: false,
      isProcessing: false,
    }));

    persistConversation(duration).catch((err) => captureError(err, "persist-conversation-end"));
    onConversationEnd?.(transcriptRef.current, correctionsRef.current);
  }, [onConversationEnd, stopAudioStreaming, persistConversation]);

  // Keep endRef in sync for use by handleEvent (avoids circular dependency)
  useEffect(() => {
    endRef.current = end;
  }, [end]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationRef.current) clearInterval(durationRef.current);
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      sessionRef.current?.disconnect();
      void ExpoPlayAudioStream.stopRecording().catch(() => {});
      void ExpoPlayAudioStream.stopSound().catch(() => {});
      ExpoPlayAudioStream.destroy();
    };
  }, []);

  return {
    ...state,
    start,
    sendText,
    end,
  };
}
