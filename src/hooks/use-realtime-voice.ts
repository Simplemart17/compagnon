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
import {
  useAudioRecorder as useExpoAudioRecorder,
  AudioModule,
  setAudioModeAsync,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

import { RealtimeSession, type RealtimeConfig, type RealtimeEvent } from "@/src/lib/realtime";
import { buildConversationPrompt } from "@/src/lib/prompts/conversation";
import { chatCompletionJSON } from "@/src/lib/openai";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { extractAndStoreMemories } from "@/src/lib/memory";
import { trackError, extractErrorsFromCorrections } from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import {
  updateStreak,
  updateSkillProgress,
  incrementDailyActivity,
  checkCefrPromotion,
} from "@/src/lib/activity";
import type { CEFRLevel } from "@/src/types/cefr";
import type { ConversationFeedback, ConversationMode, Correction } from "@/src/types/conversation";

import { useAudioPlayer } from "./use-audio-player";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  corrections?: Correction[];
  timestamp: number;
}

export interface ConversationState {
  status: "idle" | "connecting" | "connected" | "error" | "ended";
  isSpeaking: boolean;
  isAiSpeaking: boolean;
  transcript: TranscriptEntry[];
  pendingAiText: string;
  allCorrections: Correction[];
  durationSeconds: number;
  error: string | null;
  feedback: ConversationFeedback | null;
}

export interface UseRealtimeVoiceOptions {
  cefrLevel: CEFRLevel;
  mode: ConversationMode;
  topic: string;
  topicDescription?: string;
  memories?: string[];
  errorPatterns?: string[];
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void;
  onConversationEnd?: (transcript: TranscriptEntry[], corrections: Correction[]) => void;
}

export interface UseRealtimeVoiceReturn extends ConversationState {
  start: () => Promise<void>;
  sendText: (text: string) => void;
  end: () => void;
}

/** Recording config for streaming to Realtime API (16kHz PCM16 mono) */
const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: false,
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

/** Interval for reading audio chunks from recording file (ms) */
const AUDIO_STREAM_INTERVAL_MS = 250;

export function useRealtimeVoice(options: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  const {
    cefrLevel,
    mode,
    topic,
    topicDescription,
    memories,
    errorPatterns,
    voice = "nova",
    onTranscriptUpdate,
    onConversationEnd,
  } = options;

  const user = useAuthStore((s) => s.user);

  const [state, setState] = useState<ConversationState>({
    status: "idle",
    isSpeaking: false,
    isAiSpeaking: false,
    transcript: [],
    pendingAiText: "",
    allCorrections: [],
    durationSeconds: 0,
    error: null,
    feedback: null,
  });

  const sessionRef = useRef<RealtimeSession | null>(null);
  const audioPlayer = useAudioPlayer();
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<string[]>([]);
  const currentAiTextRef = useRef("");
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const correctionsRef = useRef<Correction[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const durationSecondsRef = useRef(0);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  // Audio recording
  const recorder = useExpoAudioRecorder(RECORDING_OPTIONS);
  const isStreamingRef = useRef(false);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastReadPositionRef = useRef(0);

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

  /** Start microphone recording and stream audio to WebSocket */
  const startAudioStreaming = useCallback(async () => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
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
      isStreamingRef.current = true;
      lastReadPositionRef.current = 0;

      // Periodically read recorded audio and send to WebSocket
      streamIntervalRef.current = setInterval(async () => {
        if (!isStreamingRef.current || !sessionRef.current?.isConnected) return;

        try {
          const uri = recorder.uri;
          if (!uri) return;

          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });

          if (base64 && base64.length > lastReadPositionRef.current) {
            const newAudio = base64.substring(lastReadPositionRef.current);
            if (newAudio.length > 0) {
              sessionRef.current.appendAudio(newAudio);
              lastReadPositionRef.current = base64.length;
            }
          }
        } catch {
          // Ignore read errors during streaming
        }
      }, AUDIO_STREAM_INTERVAL_MS);
    } catch (err) {
      captureError(err, "realtime-voice-audio");
      const message = err instanceof Error ? err.message : "Microphone error";
      console.error("[RealtimeVoice] Audio streaming error:", err);
      setState((s) => ({ ...s, error: message }));
    }
  }, [recorder]);

  /** Stop microphone recording */
  const stopAudioStreaming = useCallback(async () => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }

    isStreamingRef.current = false;

    try {
      await recorder.stop();
    } catch {
      // Ignore cleanup errors
    }

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
  }, [recorder]);

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
          setState((s) => ({ ...s, isSpeaking: false }));
          break;

        case "response.audio.delta":
          audioChunksRef.current.push(event.delta);
          setState((s) => ({ ...s, isAiSpeaking: true }));
          break;

        case "response.audio.done":
          if (audioChunksRef.current.length > 0) {
            const fullAudio = audioChunksRef.current.join("");
            void audioPlayer.playFromBase64(fullAudio, "wav");
            audioChunksRef.current = [];
          }
          setState((s) => ({ ...s, isAiSpeaking: false }));
          break;

        case "response.text.delta":
          currentAiTextRef.current += event.delta;
          setState((s) => ({ ...s, pendingAiText: currentAiTextRef.current }));
          break;

        case "response.text.done": {
          const fullText = event.text;
          const corrections = parseCorrections(fullText);

          const entry: TranscriptEntry = {
            id: `ai_${Date.now()}`,
            role: "assistant",
            text: fullText,
            corrections: corrections.length > 0 ? corrections : undefined,
            timestamp: Date.now(),
          };

          transcriptRef.current = [...transcriptRef.current, entry];
          correctionsRef.current = [...correctionsRef.current, ...corrections];
          currentAiTextRef.current = "";

          setState((s) => ({
            ...s,
            transcript: transcriptRef.current,
            pendingAiText: "",
            allCorrections: correctionsRef.current,
          }));

          onTranscriptUpdate?.(transcriptRef.current);
          break;
        }

        // In voice mode, the AI responds with audio and the transcript arrives
        // via response.audio_transcript events, not response.text events.
        case "response.audio_transcript.delta":
          currentAiTextRef.current += event.delta;
          setState((s) => ({ ...s, pendingAiText: currentAiTextRef.current }));
          break;

        case "response.audio_transcript.done": {
          const audioTranscriptText = event.transcript;
          const audioCorrections = parseCorrections(audioTranscriptText);

          const audioEntry: TranscriptEntry = {
            id: `ai_${Date.now()}`,
            role: "assistant",
            text: audioTranscriptText,
            corrections: audioCorrections.length > 0 ? audioCorrections : undefined,
            timestamp: Date.now(),
          };

          transcriptRef.current = [...transcriptRef.current, audioEntry];
          correctionsRef.current = [...correctionsRef.current, ...audioCorrections];
          currentAiTextRef.current = "";

          setState((s) => ({
            ...s,
            transcript: transcriptRef.current,
            pendingAiText: "",
            allCorrections: correctionsRef.current,
          }));

          onTranscriptUpdate?.(transcriptRef.current);
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
                id: `user_${Date.now()}`,
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

        case "error":
          console.error("[RealtimeVoice] Error:", event.error);
          setState((s) => ({ ...s, status: "error", error: event.error.message }));
          break;
      }
    },
    [audioPlayer, parseCorrections, onTranscriptUpdate, handleFunctionCall]
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

    if (error || !data) return null;
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
        await updateSkillProgress(user.id, "speaking", speakingScore, minutesPracticed);

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
            const feedback = await chatCompletionJSON<ConversationFeedback>(
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
              { temperature: 0.3 }
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

    setState((s) => ({ ...s, status: "connecting", error: null }));

    try {
      const convoId = await createConversationRecord();
      if (!convoId) {
        throw new Error("Failed to create conversation record");
      }
      conversationIdRef.current = convoId;

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
        inputAudioFormat: "pcm16",
        outputAudioFormat: "pcm16",
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

      // Start duration timer
      durationRef.current = setInterval(() => {
        durationSecondsRef.current += 1;
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
        id: `user_${Date.now()}`,
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
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }

    void stopAudioStreaming();
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    void audioPlayer.stop();

    const duration = durationSecondsRef.current;
    setState((s) => ({ ...s, status: "ended", isSpeaking: false, isAiSpeaking: false }));

    persistConversation(duration).catch((err) => captureError(err, "persist-conversation-end"));
    onConversationEnd?.(transcriptRef.current, correctionsRef.current);
  }, [audioPlayer, onConversationEnd, stopAudioStreaming, persistConversation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationRef.current) clearInterval(durationRef.current);
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
      sessionRef.current?.disconnect();
      isStreamingRef.current = false;
      void recorder.stop().catch(() => {});
      void audioPlayer.stop();
    };
  }, [audioPlayer, recorder]);

  return {
    ...state,
    start,
    sendText,
    end,
  };
}
