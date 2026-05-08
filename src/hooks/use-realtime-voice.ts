/**
 * Realtime Voice Conversation Hook
 *
 * Orchestrates the full voice conversation experience:
 * - Connects to OpenAI Realtime API via WebSocket
 * - Streams user audio from microphone to WebSocket
 * - Receives and plays AI audio responses
 * - Manages transcript, corrections, and conversation state
 * - Persists conversations and vocabulary to Supabase
 * - Handles AI function calls (save_vocabulary, note_error_pattern)
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

  // Audio recording via expo-audio-stream (full-duplex PCM streaming)
  const subscriptionRef = useRef<EventSubscription | null>(null);
  const turnIdRef = useRef(0);

  /** Infer correction category from explanation text using keyword matching */
  const inferCategory = useCallback((explanation: string): Correction["category"] => {
    const lower = explanation.toLowerCase();
    if (/pronunciation|accent|phonetic/.test(lower)) return "pronunciation";
    if (/vocabulary|word choice|lexical/.test(lower)) return "vocabulary";
    if (/register|formal|informal|tone/.test(lower)) return "register";
    return "grammar";
  }, []);

  /** Parse corrections from AI's text */
  const parseCorrections = useCallback(
    (text: string): Correction[] => {
      const corrections: Correction[] = [];
      const correctionPattern = /"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g;
      let match: RegExpExecArray | null;

      while ((match = correctionPattern.exec(text)) !== null) {
        const explanation = match[3];
        corrections.push({
          original: match[1],
          corrected: match[2],
          explanation,
          category: inferCategory(explanation),
        });
      }

      return corrections;
    },
    [inferCategory]
  );

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
          // Also drop any in-flight delta accumulator so a cancelled or
          // tool-only turn cannot leak its pending text into the prefix of
          // the next turn (whose first delta would otherwise concatenate
          // onto the leftover via `acceptDelta`'s adopt path).
          inflightItemIdRef.current = null;
          currentAiTextRef.current = "";
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

        // 4. Update skill progress for speaking (with score based on corrections ratio)
        // Caps penalty at 30% per correction-to-utterance ratio, with minimum score of 20
        const totalEntries = transcriptRef.current.filter((e) => e.role === "user").length;
        const correctedEntries = correctionsRef.current.length;
        const speakingScore =
          totalEntries > 0
            ? Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))
            : 70; // Default if no user entries
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
