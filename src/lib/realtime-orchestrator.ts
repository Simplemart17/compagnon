/**
 * Realtime Voice Conversation Orchestrator
 *
 * Plain TypeScript class (NOT a React hook) that owns the full Realtime voice
 * conversation lifecycle. The thin hook at `src/hooks/use-realtime-voice.ts`
 * is now a pure React binding layer: lazily constructs an orchestrator,
 * subscribes to state changes, returns the public surface.
 *
 * Story 12.1 / audit P1-17: decomposed from the pre-12-1 1,354-line "god hook"
 * into this class + ≤ 250-line hook. The migration is a pure call-site
 * relocation of business logic; every Story 9-X / 10-X / 11-X invariant is
 * preserved by construction.
 *
 * The 14 responsibilities absorbed:
 *   1. State management (16 fields formerly hook-level useRefs + a useState)
 *   2. WebSocket connection lifecycle (start/end + Story 11-2 reconnect)
 *   3. ExpoPlayAudioStream subscription management
 *   4. handleEvent (12+ Realtime event types)
 *   5. handleFunctionCall (Story 11-1 three tools: save_vocabulary,
 *      note_error_pattern, report_correction)
 *   6. appendAiTranscriptEntry + Story 9-5 dedup
 *   7. Correction collection (correctionsRef + Story 11-1 pendingToolCorrections orphan buffer)
 *   8. AI-speaking state tracking + Story 11-2 barge-in trigger timing
 *   9. createConversationRecord (Supabase write)
 *  10. persistConversation 8-step chain — Story 12-1 parallelizes into
 *      Phase A (6-way Promise.allSettled) + Phase B (checkCefrPromotion)
 *  11. Duration tracking
 *  12. Inflight response tracking
 *  13. Pending tool-corrections orphan buffer (Story 11-1 P2/P3)
 *  14. Reconnect state coordination (Story 11-2)
 *
 * Public surface — observer pattern (mirrors Story 11-2's RealtimeSession):
 *   - constructor(options)
 *   - start(): Promise<void>
 *   - sendText(text): void
 *   - end(): void
 *   - subscribe(cb): () => void  ← React hook subscribes here
 *   - getState(): ConversationState
 *   - dispose(): void  ← cleanup on hook unmount
 */

import { ExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";
import type { EventSubscription } from "expo-modules-core";
import type { User } from "@supabase/supabase-js";

import { acquireAudioStream, releaseAudioStream } from "@/src/lib/audio-stream-manager";
import { RealtimeSession, type RealtimeConfig, type RealtimeEvent } from "@/src/lib/realtime";
import {
  applyTranscriptCap,
  toMessagePayload,
  SPILLED_MESSAGES_HIGH_WATER_MARK,
  TRANSCRIPT_CAP_FEATURE_TAG,
  TRANSCRIPT_CAP_HIGH_WATER_FEATURE_TAG,
  type ConversationMessagePayload,
} from "@/src/lib/transcript-cap";
import {
  acceptDelta,
  appendIfNew,
  resolveTranscriptKey,
  type TranscriptEntry,
} from "@/src/lib/realtime-transcript";
import { buildConversationPrompt } from "@/src/lib/prompts/conversation";
import {
  drainPendingCorrections,
  MAX_PENDING_CORRECTIONS,
  mergeOrphanCorrections,
  processReportCorrectionCall,
} from "@/src/lib/realtime-corrections";
import { computeBargeInDirective } from "@/src/lib/realtime-barge-in";
import { computeSpeakingScore } from "@/src/lib/speaking-score";
import { supabase } from "@/src/lib/supabase";
// Story 11-5: consolidated post-conversation analysis replaces the pre-11-5
// 3-call pipeline. Non-Realtime flows (echo + translation) still use
// `extractErrorsFromCorrections` directly.
import {
  extractPostConversationAnalysis,
  persistPostConversationAnalysis,
} from "@/src/lib/post-conversation-analysis";
import { persistErrorPatterns, trackError } from "@/src/lib/error-tracker";
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

// Re-exported so existing consumers keep their import path.
export type { TranscriptEntry };

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ConversationState {
  // Story 11-2: "reconnecting" signals the auto-reconnect window between an
  // unexpected WebSocket close and the next successful open.
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error" | "disconnected" | "ended";
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

export type VoiceName =
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

export interface RealtimeOrchestratorOptions {
  user: User | null;
  cefrLevel: CEFRLevel;
  mode: ConversationMode;
  topic: string;
  topicDescription?: string;
  voice?: VoiceName;
  memories?: string[];
  errorPatterns?: string[];
  onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void;
  onConversationEnd?: (transcript: TranscriptEntry[], corrections: Correction[]) => void;
}

/**
 * Phase A slot names — the 6 independent persist operations dispatched
 * concurrently by `persistConversation`. Exported for test pinning + Sentry
 * tag construction. Story 12-1.
 */
export const PHASE_A_SLOT_NAMES = [
  "conversation",
  "messages",
  "analysis",
  "skill-progress",
  "daily-activity",
  "streak",
] as const;

export type PhaseASlotName = (typeof PHASE_A_SLOT_NAMES)[number];

/** Initial conversation state — exported for tests + hook initialization. */
export const INITIAL_STATE: ConversationState = {
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
};

// ────────────────────────────────────────────────────────────────────────
// RealtimeOrchestrator class
// ────────────────────────────────────────────────────────────────────────

export class RealtimeOrchestrator {
  // ─── State + observers ────────────────────────────────────────────────
  private state: ConversationState = INITIAL_STATE;
  private readonly subscribers = new Set<(state: ConversationState) => void>();
  /**
   * Story 12-1 review-round-1 P6: re-entrant `setState` guard. If a
   * subscriber callback synchronously calls another orchestrator method
   * (which calls `setState` internally), the nested call would mutate
   * state mid-iteration of the snapshot, producing out-of-order observer
   * notifications. The flag detects re-entrance and queues the nested
   * updater for drainage after the outer setState's iteration completes.
   */
  private isSetStating = false;
  private pendingUpdates: ((s: ConversationState) => ConversationState)[] = [];
  /**
   * Story 12-1 review-round-1 P7: dispose-safety flag. Late events firing
   * in the same tick as `dispose()` (e.g., `disconnect()` triggers a final
   * `close` event) would otherwise call `handleEvent` → `setState` → mutate
   * state but reach zero subscribers (silent data loss). The handleEvent
   * dispatcher early-returns when `isDisposed` is true.
   */
  private isDisposed = false;

  // ─── Connection + audio ───────────────────────────────────────────────
  private session: RealtimeSession | null = null;
  private subscription: EventSubscription | null = null;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Story 12-5: tracks whether `acquireAudioStream()` ran for this
   * orchestrator instance. Defends `dispose()` from firing an unmatched
   * `releaseAudioStream()` (which would emit the release-when-zero
   * breadcrumb but more importantly indicates a `start()` failure
   * BEFORE `startAudioStreaming()` ran). Reset to false in `start()`'s
   * reset block (Story 12-1 P1 pattern) and after release in `dispose()`
   * for double-dispose idempotence.
   */
  private acquireWasCalled = false;

  // ─── Conversation lifecycle ───────────────────────────────────────────
  private isEnding = false;
  private conversationId: string | null = null;
  private durationSeconds = 0;
  private startTimeMs = 0;

  // ─── Per-turn / streaming state ───────────────────────────────────────
  private currentAiText = "";
  /** Story 9-5: set of upstream item/response keys whose terminal `.done` event has already produced a TranscriptEntry. */
  private processedResponseItems = new Set<string>();
  /** item_id of the AI response currently being streamed; null between turns. */
  private inflightItemId: string | null = null;
  /** Monotonic counter for user-side TranscriptEntry ids; collision-free across same-millisecond bursts. */
  private userTurnCounter = 0;
  /** Audio turn counter for `ExpoPlayAudioStream.playSound` chunk ordering. */
  private turnIdCounter = 0;

  // ─── Transcript + corrections ─────────────────────────────────────────
  private transcript: TranscriptEntry[] = [];
  /**
   * Story 12-6: evicted transcript entries in DB-payload shape
   * (`conversation_id` + `role` + `content` + `corrections`). The
   * in-memory `transcript` array is FIFO-capped at
   * `MAX_TRANSCRIPT_ENTRIES = 200`; when an append would exceed the cap,
   * the evicted entries are pushed here so the persist-time batch insert
   * sees the COMPLETE conversation regardless of in-memory eviction.
   * Cleared in `start()`'s reset block alongside `this.transcript`.
   *
   * **Residual unboundedness (Story 12-6 review-round-1 P3):** this
   * buffer grows monotonically with conversation length. The cap bounds
   * `state.transcript` (FlatList input) at 200 entries, but
   * `spilledMessages` itself accumulates ~80 bytes per evicted entry
   * for the session's lifetime. A 24-hour pathological session at 1
   * turn/5s yields ~1.4MB in this buffer alone. AsyncStorage / mid-
   * session DB-streaming spill is deferred to Epic 13.X / 17.X
   * follow-up; the high-water-mark breadcrumb below surfaces in-prod
   * frequency so operators can decide on the next move.
   */
  private spilledMessages: ConversationMessagePayload[] = [];
  /**
   * Story 12-6 review-round-1 P3: idempotency flag for the high-water-
   * mark breadcrumb. Set true once `spilledMessages.length` first
   * exceeds `SPILLED_MESSAGES_HIGH_WATER_MARK`, so the breadcrumb fires
   * EXACTLY ONCE per orchestrator instance regardless of how many
   * additional evictions follow. Reset to false in `start()`'s reset
   * block.
   */
  private spillHighWaterMarkBreached = false;
  private corrections: Correction[] = [];
  /**
   * Story 11-1: corrections accumulated during the current AI turn via
   * `report_correction` tool-calls. Drained by `parseCorrections` when
   * `appendIfNew` consumes the terminal `response.output_audio_transcript.done`.
   * Also cleared on `response.done` + `case "error"` + `realtime.reconnecting`
   * via `mergeOrphanCorrections` orphan-drain.
   */
  private pendingToolCorrections: Correction[] = [];

  // ─── AI-response window tracking (Story 11-1 + 11-2) ──────────────────
  /**
   * Story 11-1 review-round-2 P16: tracks the broad AI-response window — set
   * true on `speech_stopped` (user finished, AI starts processing) and cleared
   * on `response.done` / `case "error"`. Used by the `report_correction`
   * inflight gate to accept legitimate tool-calls that fire BEFORE the first
   * audio delta (which is what sets `inflightItemId`).
   */
  private responseInFlight = false;
  /**
   * Story 11-2: `Date.now()` captured when the FIRST `response.output_audio.delta`
   * fires for the current response. Used by the barge-in pure helper to compute
   * `audio_end_ms = Date.now() - aiSpeakingStartedAtMs` for the
   * `conversation.item.truncate` event.
   */
  private aiSpeakingStartedAtMs: number | null = null;
  /**
   * Story 11-2 review-round-2 P22: synchronous mirror of `state.isAiSpeaking`
   * for event-time access. Pre-12-1 the hook's `isAiSpeakingRef.current = state.isAiSpeaking`
   * had a stale window between setState enqueue + React commit. Post-12-1
   * the orchestrator's `setState` updates this field synchronously so the
   * barge-in handler reads up-to-date values regardless of React render timing.
   */
  private isAiSpeakingMirror = false;

  // ────────────────────────────────────────────────────────────────────
  // Construction + observer pattern
  // ────────────────────────────────────────────────────────────────────

  constructor(private readonly options: RealtimeOrchestratorOptions) {
    // Bind methods passed as callbacks so `this` is preserved across closure
    // boundaries (Story 12-1 review-lesson: closure-vs-this semantics).
    this.handleEvent = this.handleEvent.bind(this);
    this.handleFunctionCall = this.handleFunctionCall.bind(this);
    this.parseCorrections = this.parseCorrections.bind(this);
    this.end = this.end.bind(this);
  }

  /**
   * Subscribe to state changes. Fires the callback synchronously with the
   * current state (initial sync), then on every subsequent state mutation.
   * Returns an unsubscribe closure.
   */
  subscribe(callback: (state: ConversationState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.state);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Synchronous state read. Returns a frozen snapshot — the orchestrator's
   * canonical state mutation flows through `setState` which replaces the
   * whole object, so the freeze is defensive against direct external
   * mutation attempts (Story 12-1 review-round-1 P15).
   */
  getState(): ConversationState {
    return Object.freeze({ ...this.state });
  }

  /**
   * Cleanup on hook unmount: clear timer, remove audio subscription, close
   * session, drop all subscribers. Idempotent — second dispose call no-ops.
   *
   * Story 12-1 review-round-1 P7: sets `isDisposed = true` so any late
   * realtime event firing post-dispose short-circuits in `handleEvent`.
   * Story 12-1 review-round-1 P12: explicit `{reason: "user"}` on session
   * disconnect so a future RealtimeSession default-arg change doesn't
   * silently re-open the reconnect chain.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    this.subscription?.remove();
    this.subscription = null;
    this.session?.disconnect({ reason: "user" });
    this.session = null;
    // Story 12-5: delegate the audio-stream lifecycle to the
    // reference-counted manager. The manager invokes `stopRecording()`
    // + `stopSound()` only on the LAST release (when refcount hits 0)
    // so concurrent orchestrators don't interrupt each other's audio.
    // **`ExpoPlayAudioStream.destroy()` is DELETED** (audit P1-19) —
    // pre-12-5 the orchestrator destroyed the singleton native module
    // on every unmount, breaking the next mount's audio until app
    // reload. The OS handles native-module teardown on app exit.
    if (this.acquireWasCalled) {
      this.acquireWasCalled = false;
      void releaseAudioStream();
    }
    this.subscribers.clear();
  }

  // ────────────────────────────────────────────────────────────────────
  // Private state mutation
  // ────────────────────────────────────────────────────────────────────

  /**
   * Internal state update + observer fan-out. Subscribers are snapshotted
   * before iteration so a subscriber unsubscribing during its own callback
   * doesn't mutate the live Set mid-iteration.
   *
   * Story 11-2 review-round-2 P22 lesson: the `isAiSpeakingMirror` field
   * stays in sync with `state.isAiSpeaking` synchronously here so event-time
   * reads (barge-in handler) see the up-to-date value regardless of when
   * React commits the render.
   *
   * Story 12-1 review-round-1 P6: re-entrant setState guard. If a
   * subscriber callback synchronously calls back into the orchestrator
   * (triggering another setState), the nested updater is queued and
   * drained AFTER the outer iteration completes — preserves monotonic
   * observer ordering.
   */
  private setState(updater: (s: ConversationState) => ConversationState): void {
    if (this.isSetStating) {
      this.pendingUpdates.push(updater);
      return;
    }
    this.isSetStating = true;
    try {
      this.state = updater(this.state);
      this.isAiSpeakingMirror = this.state.isAiSpeaking;
      const snapshot = Array.from(this.subscribers);
      for (const cb of snapshot) cb(this.state);
    } finally {
      this.isSetStating = false;
    }
    // Drain queued updates non-recursively.
    while (this.pendingUpdates.length > 0) {
      const next = this.pendingUpdates.shift()!;
      this.setState(next);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Story 11-1: drain per-turn report_correction buffer
  // ────────────────────────────────────────────────────────────────────

  /**
   * Drain the per-turn tool-call buffer. Called by `appendIfNew` (`realtime-transcript.ts`)
   * when the terminal `response.output_audio_transcript.done` fires for an AI
   * turn. The `AppendOptions.parseCorrections: (text: string) => Correction[]`
   * signature is preserved per Story 9-5 contract; the pure helper module is
   * NOT touched. The `text` parameter is intentionally unused.
   */
  private parseCorrections(_text: string): Correction[] {
    return drainPendingCorrections(this.pendingToolCorrections);
  }

  // ────────────────────────────────────────────────────────────────────
  // Story 12-4 — uniform wrapper for session-method dispatch from inside
  // `handleEvent`-reachable paths
  // ────────────────────────────────────────────────────────────────────

  /**
   * Uniform wrapper for the 13 `this.session?.method()` call sites inside
   * `handleEvent`-reachable paths. When `this.session === null` (race with
   * `start()` / `dispose()` / `disconnect()`), the method is skipped AND a
   * Sentry breadcrumb fires so the silent-no-op failure mode is observable.
   *
   * Pre-12-4 these call sites used `this.session?.method()` which silently
   * no-op'd. Audit P2-21 closes the race architecturally via the early-
   * assignment in `start()`; this wrapper is the post-fix telemetry hook
   * that catches any future regression where a similar race appears.
   *
   * Used inside `handleFunctionCall` (Story 11-1 tool-call acks) and
   * `handleSpeechStarted` (Story 11-2 barge-in) and the audio-stream
   * callback. NOT used at `dispose` / `sendText` / `end` public-API entry
   * points — those are called from React event handlers, not from inside
   * `handleEvent`, so the race doesn't apply.
   *
   * **Synchronous-fn invariant (Review-round-1 P9):** `fn` MUST be
   * synchronous. The helper returns `T | undefined` — if a future caller
   * passes an async `fn`, the resulting `Promise<T> | undefined` would be
   * silently dropped by call sites that don't `await` the helper's return
   * (re-introducing the silent-no-op failure mode this helper sets out to
   * fix). All 13 current call sites pass synchronous methods
   * (`sendFunctionResult`, `sendRaw`, `appendAudio` all return `void`).
   *
   * **TOCTOU defense (Review-round-1 P5):** the `this.session` reference is
   * captured into a local `const session` BEFORE the null check so a
   * synchronous re-entrant `end()` / `dispose()` between the guard and the
   * call cannot null the captured ref mid-flight. (All current callers are
   * sync; this is defense-in-depth for future async-fn migrations.)
   *
   * Throws from `fn` are passed through (the helper only null-guards
   * `this.session`, not the inner method's exceptions).
   */
  private safeSessionCall<T>(fn: (session: RealtimeSession) => T, context: string): T | undefined {
    // Review-round-1 P5: capture the ref so a re-entrant null-out between
    // the guard and the call sees the same instance.
    const session = this.session;
    if (session === null) {
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        // Review-round-1 P13: descriptive message; `feature` extras key
        // carries the categorical tag for Sentry grep.
        message: "Session ref null when handler dispatched",
        data: { feature: "orchestrator-session-null-on-event", context },
      });
      return undefined;
    }
    return fn(session);
  }

  // ────────────────────────────────────────────────────────────────────
  // Audio streaming (ExpoPlayAudioStream subscription)
  // ────────────────────────────────────────────────────────────────────

  /** Start microphone recording and stream PCM audio to WebSocket */
  private async startAudioStreaming(): Promise<void> {
    // Story 12-5: acquire a reference to the audio-stream singleton
    // BEFORE the orchestrator interacts with it. The matched
    // `releaseAudioStream()` runs in `dispose()`; the manager handles
    // refcount-based cleanup so the singleton native module survives
    // across orchestrator instances (audit P1-19). Synchronous +
    // idempotent — safe to call before the permission check.
    acquireAudioStream();
    this.acquireWasCalled = true;
    try {
      const { granted } = await ExpoPlayAudioStream.requestPermissionsAsync();
      if (!granted) {
        this.setState((s) => ({ ...s, error: "Microphone permission denied" }));
        return;
      }

      // 24kHz required by OpenAI Realtime GA API for both input and output.
      // Native audio supports it even though the library's TS types only
      // enumerate 16000|44100|48000.
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
          // Story 11-2 P24: the `isConnected` gate here is what lets the
          // subscription stay alive across reconnects — bytes during the
          // reconnect window are silently dropped without us needing to
          // tear down + restart the subscription.
          //
          // Story 12-4 + review-round-1 P1: route through `safeSessionCall`
          // so a null `this.session` (race with `dispose()` mid-stream,
          // post-disconnect) emits a Sentry breadcrumb instead of silently
          // dropping audio. The `isConnected` check MUST live inside the
          // closure — pre-patch had `if (this.session?.isConnected && ...)`
          // BEFORE the helper which made the null path dead-code (the
          // optional chain short-circuited to `undefined` BEFORE reaching
          // `safeSessionCall`, so the breadcrumb could never fire).
          if (event.data) {
            this.safeSessionCall((s) => {
              if (s.isConnected) {
                s.appendAudio(event.data as string);
              }
            }, "audio-stream");
          }
        },
      });

      this.subscription = subscription ?? null;
    } catch (err) {
      captureError(err, "realtime-voice-audio");
      const message = err instanceof Error ? err.message : "Microphone error";
      console.error("[RealtimeVoice] Audio streaming error:", err);
      this.setState((s) => ({ ...s, error: message }));
    }
  }

  /** Stop microphone recording */
  private async stopAudioStreaming(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    try {
      await ExpoPlayAudioStream.stopRecording();
    } catch {
      // Ignore cleanup errors
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Story 11-1: handle 3 tool-call types
  // ────────────────────────────────────────────────────────────────────

  /** Handle AI function calls (vocabulary saving, error tracking, corrections) */
  private async handleFunctionCall(name: string, args: string, callId: string): Promise<void> {
    const user = this.options.user;
    try {
      const parsed = JSON.parse(args);

      if (name === "save_vocabulary" && user) {
        if (!parsed.french_word || !parsed.english_translation) {
          this.safeSessionCall(
            (s) => s.sendFunctionResult(callId, "Missing required fields."),
            "tool-call-save-vocabulary"
          );
          return;
        }
        const { error } = await supabase.from("vocabulary").upsert(
          {
            user_id: user.id,
            french_word: parsed.french_word,
            english_translation: parsed.english_translation,
            context_sentence: parsed.context_sentence ?? null,
            cefr_level: this.options.cefrLevel,
          },
          { onConflict: "user_id,french_word" }
        );
        if (error) {
          captureError(error, "save-vocabulary");
          this.safeSessionCall(
            (s) => s.sendFunctionResult(callId, "Failed to save vocabulary."),
            "tool-call-save-vocabulary"
          );
        } else {
          this.safeSessionCall(
            (s) => s.sendFunctionResult(callId, "Vocabulary saved."),
            "tool-call-save-vocabulary"
          );
        }
      } else if (name === "note_error_pattern" && user) {
        if (!parsed.error_type || !parsed.description) {
          this.safeSessionCall(
            (s) => s.sendFunctionResult(callId, "Missing required fields."),
            "tool-call-note-error-pattern"
          );
          return;
        }
        await trackError(user.id, parsed.error_type, parsed.description);
        this.safeSessionCall(
          (s) => s.sendFunctionResult(callId, "Error pattern noted."),
          "tool-call-note-error-pattern"
        );
      } else if (name === "report_correction") {
        // Story 11-1 — structured tool-call replaces the legacy
        // `parseCorrections` regex bridge. Pure helper at
        // `src/lib/realtime-corrections.ts` owns the safeParse +
        // result-string contract; the orchestrator owns the buffer +
        // breadcrumb + sendFunctionResult side effects.
        //
        // Review patch P1 (HIGH; widened by P16 in review-round-2): gate
        // the push on an in-flight AI turn. The widened gate accepts a
        // tool-call when EITHER `responseInFlight` is true (broad response
        // window from `speech_stopped` to `response.done`) OR
        // `inflightItemId` is non-null (set on first audio-transcript
        // delta). The original `inflightItemId`-only gate over-rejected
        // legitimate tool-only turns.
        if (!this.responseInFlight && this.inflightItemId === null) {
          addBreadcrumb({
            category: "realtime",
            level: "warning",
            message: "report_correction outside in-flight turn dropped",
            data: { feature: "realtime-report-correction" },
          });
          this.safeSessionCall(
            (s) =>
              s.sendFunctionResult(
                callId,
                "Rejected: outside-turn. Tool-call arrived outside the AI response window; correction not recorded."
              ),
            "tool-call-report-correction"
          );
          return;
        }
        // Review patch P9 (MED): cap the buffer at MAX_PENDING_CORRECTIONS.
        // Review-round-2 P20: rejection message shape standardized.
        if (this.pendingToolCorrections.length >= MAX_PENDING_CORRECTIONS) {
          addBreadcrumb({
            category: "realtime",
            level: "warning",
            message: "report_correction buffer cap reached",
            data: { feature: "realtime-report-correction" },
          });
          this.safeSessionCall(
            (s) =>
              s.sendFunctionResult(
                callId,
                "Rejected: buffer-full. Reached MAX_PENDING_CORRECTIONS for this turn; correction not recorded. Skip further invocations until the next turn."
              ),
            "tool-call-report-correction"
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
          this.pendingToolCorrections.push(callResult.correction);
        }
        this.safeSessionCall(
          (s) => s.sendFunctionResult(callId, callResult.resultMessage),
          "tool-call-report-correction"
        );
      } else {
        this.safeSessionCall(
          (s) => s.sendFunctionResult(callId, "Unknown function."),
          "tool-call-unknown"
        );
      }
    } catch (err) {
      captureError(err, "function-call-handler");
      this.safeSessionCall(
        (s) => s.sendFunctionResult(callId, "Function call failed."),
        "tool-call-handler-error"
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Story 9-5: append AI-turn transcript entry with dedup
  // ────────────────────────────────────────────────────────────────────

  /**
   * Append a single AI-turn transcript entry, applying response-id dedup.
   * Returns true if the entry was added, false if it was deduped. Story 9-5.
   */
  private appendAiTranscriptEntry(text: string, key: string): boolean {
    const result = appendIfNew(
      {
        processed: this.processedResponseItems,
        transcript: this.transcript,
        corrections: this.corrections,
      },
      key,
      text,
      {
        parseCorrections: this.parseCorrections,
        onDedup: (k) => {
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

    // Story 12-6: cap `this.transcript` at 200 entries via FIFO eviction.
    // `appendIfNew` already produced `result.transcript = [...this.transcript, result.entry]`
    // but DID NOT cap. We re-derive the capped tail from the same base + entry —
    // `appendIfNew`'s contract guarantees `result.appended === true` implies
    // `result.entry !== undefined`. Evicted entries spill to `spilledMessages`
    // in DB-payload shape so persist-time sees the COMPLETE conversation.
    //
    // Story 12-6 review-round-1 P2: explicit narrow instead of non-null `!`
    // assertion. If a future `appendIfNew` refactor ever returns
    // `{appended: true, entry: undefined}` (e.g., a new branch path), the
    // non-null assertion would silently propagate `undefined` into the
    // transcript array and crash downstream at `toMessagePayload(undefined)`.
    // The explicit check costs one branch and eliminates the lying contract.
    if (!result.entry) return false;
    const capResult = applyTranscriptCap(this.transcript, result.entry);
    this.transcript = capResult.transcript;
    if (capResult.evicted.length > 0) {
      this.handleTranscriptEviction(capResult.evicted);
    }
    this.corrections = result.corrections;

    // Only clear streaming state if the appended turn IS the in-flight one.
    const isInflight = this.inflightItemId === null || this.inflightItemId === key;
    if (isInflight) {
      this.currentAiText = "";
      this.inflightItemId = null;
    }

    this.setState((s) => ({
      ...s,
      transcript: this.transcript,
      pendingAiText: isInflight ? "" : s.pendingAiText,
      allCorrections: result.corrections,
    }));

    this.options.onTranscriptUpdate?.(this.transcript);
    return true;
  }

  /**
   * Story 12-6: handle FIFO-evicted transcript entries. Pushes each
   * evicted entry's DB-payload shape (via `toMessagePayload`) into
   * `this.spilledMessages` so the persist-time batch insert sees the
   * COMPLETE conversation regardless of in-memory cap eviction.
   *
   * Emits a Sentry breadcrumb (`feature: TRANSCRIPT_CAP_FEATURE_TAG`) per
   * eviction event so operators can grep production logs for cap-fire
   * frequency. Breadcrumb level is `info` because eviction is
   * bounded-by-design behavior, not an anomaly (Story 11-6 review P6
   * lesson — reserve `error` tier for unexpected failures).
   *
   * **Story 12-6 review-round-1 P1**: when `this.conversationId` is null,
   * undefined, OR empty string (a pathological invariant violation — the
   * cap has already committed `this.transcript = capResult.transcript`
   * BEFORE this handler runs, so the evicted entries are GONE from
   * memory), we route the data loss through `captureError` instead of
   * returning silently. Pre-patch the silent return dropped 50+ entries
   * with zero operator signal; post-patch the loss is visible in Sentry.
   * The empty-string check is belt-and-suspenders against a future
   * supabase mock or test path producing `conversationId === ""` (passes
   * the falsy guard).
   *
   * **Story 12-6 review-round-1 P3**: when `spilledMessages.length` first
   * crosses `SPILLED_MESSAGES_HIGH_WATER_MARK`, fires a one-shot operator
   * breadcrumb so pathological-session sessions are visible in prod
   * before they OOM. Idempotent via `this.spillHighWaterMarkBreached`.
   */
  private handleTranscriptEviction(evicted: TranscriptEntry[]): void {
    if (
      this.conversationId === null ||
      this.conversationId === undefined ||
      this.conversationId === ""
    ) {
      captureError(
        new Error("Transcript eviction with null conversationId"),
        "transcript-cap-eviction-no-convo-id",
        { evictedCount: evicted.length }
      );
      return;
    }
    for (const entry of evicted) {
      this.spilledMessages.push(toMessagePayload(entry, this.conversationId));
    }
    addBreadcrumb({
      category: "realtime",
      level: "info",
      message: "Transcript cap eviction",
      data: {
        feature: TRANSCRIPT_CAP_FEATURE_TAG,
        evictedCount: evicted.length,
        totalEntries: this.transcript.length + this.spilledMessages.length,
      },
    });
    // P3 high-water-mark check fires AFTER the push so the count is
    // accurate. Idempotent — fires once per orchestrator instance.
    if (
      !this.spillHighWaterMarkBreached &&
      this.spilledMessages.length >= SPILLED_MESSAGES_HIGH_WATER_MARK
    ) {
      this.spillHighWaterMarkBreached = true;
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "Transcript spill buffer high-water-mark breached",
        data: {
          feature: TRANSCRIPT_CAP_HIGH_WATER_FEATURE_TAG,
          totalEntries: this.spilledMessages.length,
        },
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Realtime event handler (12+ event types)
  // ────────────────────────────────────────────────────────────────────

  /** Handle incoming Realtime API events */
  private handleEvent(event: RealtimeEvent): void {
    // Story 12-1 review-round-1 P7: late events post-dispose short-circuit
    // so a final WebSocket `close` event after dispose doesn't trigger
    // setState into a cleared-subscribers Set (silent data loss).
    if (this.isDisposed) return;
    switch (event.type) {
      case "session.created":
        this.setState((s) => ({ ...s, status: "connected" }));
        break;

      case "input_audio_buffer.speech_started":
        this.handleSpeechStarted();
        break;

      case "input_audio_buffer.speech_stopped":
        // Story 11-1 review-round-2 P16: the AI's response window opens
        // here (user finished speaking → AI starts processing).
        this.responseInFlight = true;
        this.setState((s) => ({ ...s, isSpeaking: false, isProcessing: true }));
        break;

      case "response.output_audio.delta": {
        // Stream each audio chunk immediately for low-latency playback.
        const turnId = `turn_${this.turnIdCounter}`;
        void ExpoPlayAudioStream.playSound(event.delta, turnId, "pcm_s16le");
        // Story 11-2 barge-in: capture AI-speaking start time on first delta.
        if (this.aiSpeakingStartedAtMs === null) {
          this.aiSpeakingStartedAtMs = Date.now();
        }
        // Story 11-2 review-round-2 P22: synchronous mirror update.
        this.isAiSpeakingMirror = true;
        this.setState((s) => ({ ...s, isAiSpeaking: true, isProcessing: false }));
        break;
      }

      case "response.output_audio.done":
        this.turnIdCounter++;
        // Story 11-2: reset AI-speaking start time on natural turn end.
        this.aiSpeakingStartedAtMs = null;
        // Story 11-2 review-round-2 P22: synchronous mirror update.
        this.isAiSpeakingMirror = false;
        this.setState((s) => ({ ...s, isAiSpeaking: false }));
        break;

      // Defensive: with output_modalities=["audio"], this event should not fire.
      case "response.output_text.delta": {
        const result = acceptDelta(
          { inflightItemId: this.inflightItemId, pendingText: this.currentAiText },
          event.item_id ?? null,
          event.delta
        );
        if (result.accepted) {
          this.inflightItemId = result.state.inflightItemId;
          this.currentAiText = result.state.pendingText;
          this.setState((s) => ({ ...s, pendingAiText: this.currentAiText }));
        }
        break;
      }

      case "response.output_text.done": {
        const key = resolveTranscriptKey(event, event.text);
        this.appendAiTranscriptEntry(event.text, key);
        break;
      }

      // In voice mode, AI transcript arrives via audio_transcript events.
      case "response.output_audio_transcript.delta": {
        const result = acceptDelta(
          { inflightItemId: this.inflightItemId, pendingText: this.currentAiText },
          event.item_id ?? null,
          event.delta
        );
        if (result.accepted) {
          this.inflightItemId = result.state.inflightItemId;
          this.currentAiText = result.state.pendingText;
          this.setState((s) => ({ ...s, pendingAiText: this.currentAiText }));
        }
        break;
      }

      case "response.output_audio_transcript.done": {
        const key = resolveTranscriptKey(event, event.transcript);
        this.appendAiTranscriptEntry(event.transcript, key);
        break;
      }

      case "conversation.item.created":
        this.handleItemCreated(event);
        break;

      case "response.function_call_arguments.done":
        void this.handleFunctionCall(event.name, event.arguments, event.call_id);
        break;

      case "response.done":
        this.handleResponseDone();
        break;

      case "error":
        this.handleErrorEvent(event);
        break;

      case "realtime.reconnecting":
        this.handleReconnecting();
        break;

      case "realtime.reconnected":
        // Story 11-2: WebSocket re-established + configureSession() replayed.
        // Audio subscription was never stopped (P24); it auto-resumes via the
        // `isConnected` gate inside `onAudioStream`.
        this.setState((s) => ({ ...s, status: "connected", error: null }));
        break;
    }
  }

  /**
   * Story 11-2 barge-in: if the user starts speaking WHILE the AI is already
   * playing audio (interrupted mid-sentence), (1) stop local playback,
   * (2) send response.cancel, (3) send conversation.item.truncate to
   * synchronize server-side transcript with what was actually played.
   */
  private handleSpeechStarted(): void {
    const directive = computeBargeInDirective(
      {
        isAiSpeaking: this.isAiSpeakingMirror,
        inflightItemId: this.inflightItemId,
        aiSpeakingStartedAtMs: this.aiSpeakingStartedAtMs,
      },
      Date.now()
    );
    if (directive.shouldCancelResponse) {
      void ExpoPlayAudioStream.stopSound();
      this.safeSessionCall((s) => s.sendRaw({ type: "response.cancel" }), "barge-in-cancel");
      if (directive.shouldTruncate && directive.itemId !== null && directive.audioEndMs !== null) {
        const itemId = directive.itemId;
        const audioEndMs = directive.audioEndMs;
        this.safeSessionCall(
          (s) =>
            s.sendRaw({
              type: "conversation.item.truncate",
              item_id: itemId,
              content_index: 0,
              audio_end_ms: audioEndMs,
            }),
          "barge-in-truncate"
        );
        addBreadcrumb({
          category: "realtime",
          level: "info",
          message: "Barge-in: response cancelled + transcript truncated",
          data: { feature: "realtime-barge-in" },
        });
      } else {
        addBreadcrumb({
          category: "realtime",
          level: "warning",
          message: "Barge-in: response cancelled without truncate (missing item_id or start time)",
          data: { feature: "realtime-barge-in" },
        });
      }
      // Reset AI-speaking refs since the response is over.
      this.aiSpeakingStartedAtMs = null;
      this.inflightItemId = null;
      // Story 11-2 review-round-2 P22: synchronous mirror update.
      this.isAiSpeakingMirror = false;
      // Story 11-2 review-round-2 P30: clear streaming text accumulator so
      // next turn doesn't accidentally prefix with stale unplayed text via
      // `acceptDelta`'s adopt path.
      this.currentAiText = "";
      this.setState((s) => ({
        ...s,
        isSpeaking: true,
        isAiSpeaking: false,
        pendingAiText: "",
      }));
    } else {
      // No AI response to interrupt — existing pre-11-2 behavior.
      this.setState((s) => ({ ...s, isSpeaking: true }));
    }
  }

  private handleItemCreated(event: RealtimeEvent & { type: "conversation.item.created" }): void {
    const item = event.item as {
      role?: string;
      content?: { type: string; transcript?: string }[];
    };
    if (item?.role === "user" && item?.content) {
      const textContent = item.content.find(
        (c: { type: string; transcript?: string }) => c.type === "input_audio" && c.transcript
      );
      // Story 12-1 review-round-1 P9: reject whitespace-only transcripts.
      // `" "` is truthy and would have created an entry; the `.trim().length`
      // check filters it out.
      if (textContent?.transcript && textContent.transcript.trim().length > 0) {
        const entry: TranscriptEntry = {
          id: `user_${this.userTurnCounter++}`,
          role: "user",
          text: textContent.transcript,
          timestamp: Date.now(),
        };
        // Story 12-6: cap-then-evict via the pure helper. Spill any
        // evicted entries to `spilledMessages` for persist-time insert.
        const capResult = applyTranscriptCap(this.transcript, entry);
        this.transcript = capResult.transcript;
        if (capResult.evicted.length > 0) {
          this.handleTranscriptEviction(capResult.evicted);
        }
        this.setState((s) => ({ ...s, transcript: this.transcript }));
        this.options.onTranscriptUpdate?.(this.transcript);
      }
    }
  }

  /**
   * Story 11-1 P2/P3 + review-round-2 P18: drain orphan tool corrections
   * (corrections accumulated mid-turn but not yet promoted to
   * `correctionsRef` via `appendIfNew`) into the conversation list on
   * `response.done` so the post-conversation pipeline sees them.
   */
  private handleResponseDone(): void {
    const merged = mergeOrphanCorrections(this.corrections, this.pendingToolCorrections);
    if (merged.shouldBreadcrumb) {
      this.corrections = merged.conversation;
      // Review-round-2 P17: snapshot spread so React reads stable array.
      this.setState((s) => ({ ...s, allCorrections: [...this.corrections] }));
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "Orphan tool corrections drained at response.done",
        data: { category: "report_correction" },
      });
    }
    // Drop in-flight delta accumulator so cancelled/tool-only turn doesn't
    // leak its pending text into the next turn.
    this.inflightItemId = null;
    this.currentAiText = "";
    // Review-round-2 P16: close response window (after orphan-drain).
    this.responseInFlight = false;
    // Story 11-2: reset AI-speaking start time.
    this.aiSpeakingStartedAtMs = null;
    this.setState((s) => ({ ...s, isProcessing: false, pendingAiText: "" }));
  }

  private handleErrorEvent(event: RealtimeEvent & { type: "error" }): void {
    // Review-round-2 P28: suppress known-benign barge-in race codes.
    if (
      event.error.code === "no_response_to_cancel" ||
      event.error.code === "invalid_truncate_audio" ||
      event.error.code === "item_not_found"
    ) {
      addBreadcrumb({
        category: "realtime",
        level: "info",
        message: "Benign barge-in race suppressed",
        data: { feature: "realtime-barge-in", code: event.error.code },
      });
      return;
    }
    captureError(event.error, "realtime-voice-error");
    this.inflightItemId = null;
    this.currentAiText = "";
    // Review-round-2 P16: close response window on error.
    this.responseInFlight = false;
    // Story 11-2: reset AI-speaking start time on error.
    this.aiSpeakingStartedAtMs = null;
    // Story 11-1 P3: drain orphan corrections BEFORE end() so the persisted
    // record is complete on connection_lost.
    const merged = mergeOrphanCorrections(this.corrections, this.pendingToolCorrections);
    if (merged.shouldBreadcrumb) {
      this.corrections = merged.conversation;
      this.setState((s) => ({ ...s, allCorrections: [...this.corrections] }));
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "Orphan tool corrections drained at error",
        data: { category: "report_correction" },
      });
    }
    if (event.error.code === "connection_lost") {
      this.setState((s) => ({
        ...s,
        status: "disconnected",
        error: event.error.message,
        isProcessing: false,
        isSpeaking: false,
        isAiSpeaking: false,
        pendingAiText: "",
      }));
      // Trigger full cleanup + persist.
      this.end();
    } else {
      this.setState((s) => ({
        ...s,
        status: "error",
        error: event.error.message,
        isProcessing: false,
        pendingAiText: "",
      }));
    }
  }

  private handleReconnecting(): void {
    // Story 11-2: drain Story 11-1 pending tool buffer into corrections BEFORE
    // the cross-session boundary so any in-flight tool-call data from before
    // the disconnect is preserved.
    const merged = mergeOrphanCorrections(this.corrections, this.pendingToolCorrections);
    if (merged.shouldBreadcrumb) {
      this.corrections = merged.conversation;
      this.setState((s) => ({ ...s, allCorrections: [...this.corrections] }));
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "Orphan tool corrections drained at reconnect-start",
        data: { category: "report_correction" },
      });
    }
    // Reset per-turn state — new WebSocket session has no in-flight response.
    // transcript + corrections + duration + conversationId are preserved.
    this.inflightItemId = null;
    this.responseInFlight = false;
    this.currentAiText = "";
    this.aiSpeakingStartedAtMs = null;
    // Review-round-2 P22: synchronous mirror update.
    this.isAiSpeakingMirror = false;
    this.setState((s) => ({
      ...s,
      status: "reconnecting",
      isAiSpeaking: false,
      isProcessing: false,
      pendingAiText: "",
    }));
    // Review-round-2 P24: do NOT stop audio subscription on reconnect.
    // The `isConnected` gate inside `onAudioStream` drops bytes during the
    // reconnect window automatically; the subscription resumes on
    // `realtime.reconnected`.
  }

  // ────────────────────────────────────────────────────────────────────
  // Conversation record creation
  // ────────────────────────────────────────────────────────────────────

  private async createConversationRecord(): Promise<string | null> {
    const user = this.options.user;
    if (!user) return null;

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        topic: this.options.topic,
        scenario_description: this.options.topicDescription,
        cefr_level: this.options.cefrLevel,
        mode: this.options.mode,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !data) {
      if (error) captureError(error, "create-conversation-record");
      return null;
    }
    return data.id;
  }

  // ────────────────────────────────────────────────────────────────────
  // persistConversation — Phase A (parallel) + Phase B (sequential)
  // Story 12-1: replaces the pre-12-1 8-step sequential chain
  // ────────────────────────────────────────────────────────────────────

  private async persistConversation(duration: number): Promise<void> {
    const user = this.options.user;
    if (!user || !this.conversationId) {
      if (user && !this.conversationId) {
        captureError(
          new Error("Conversation ID is null — data will not be saved"),
          "persist-conversation"
        );
      }
      return;
    }

    const conversationId = this.conversationId;
    const cefrLevel = this.options.cefrLevel;
    const minutesPracticed = Math.ceil(duration / 60);

    // Offline branch: queue critical data + bail (pre-12-1 behavior preserved).
    const online = await isOnline();
    if (!online) {
      try {
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
        // Story 12-6: prepend the spill buffer so offline-queue persists
        // the COMPLETE conversation regardless of in-memory cap eviction.
        const messages = [
          ...this.spilledMessages,
          ...this.transcript.map((entry) => toMessagePayload(entry, conversationId)),
        ];
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

    // ── Online: Phase A (6 independent slots in parallel) ────────────
    // Story 12-6: combine the spill buffer with the live tail so the
    // AI-analysis input + speaking-score count + Slot 1 batch insert all
    // see the COMPLETE conversation regardless of in-memory cap eviction.
    // Story 12-6 review-round-1 P8: filter-then-join is cleaner than the
    // pre-patch ternary on `&&`. Empty segments (no spilled OR no live)
    // drop out before the `\n` separator joins the remaining, so we get
    // no leading / trailing newline corner cases under future
    // `toMessagePayload` changes.
    const spilledAsText = this.spilledMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const liveAsText = this.transcript.map((e) => `${e.role}: ${e.text}`).join("\n");
    const transcript = [spilledAsText, liveAsText].filter((s) => s.length > 0).join("\n");
    const hasCorrections = this.corrections.length > 0;
    const hasLongTranscript = transcript.length > 50;
    const spilledUserEntries = this.spilledMessages.filter((m) => m.role === "user").length;
    const liveUserEntries = this.transcript.filter((e) => e.role === "user").length;
    const totalEntries = spilledUserEntries + liveUserEntries;
    const correctedEntries = this.corrections.length;
    const speakingScore = computeSpeakingScore(totalEntries, correctedEntries);
    const messages = [
      ...this.spilledMessages,
      ...this.transcript.map((entry) => toMessagePayload(entry, conversationId)),
    ];

    // Story 11-5 P5: short-transcript fallback persists corrections directly.
    const analysisSlot = (): Promise<unknown> => {
      if (hasLongTranscript) {
        return extractPostConversationAnalysis({
          transcript,
          corrections: this.corrections,
          cefrLevel,
        })
          .then((analysis) =>
            persistPostConversationAnalysis({
              userId: user.id,
              conversationId,
              analysis,
            })
          )
          .then((result) => {
            // Story 12-1 review-round-1 P10: drop the `as ConversationFeedback`
            // cast. `persistPostConversationAnalysis` already returns the
            // typed shape `{ feedback: ConversationFeedback | undefined }`
            // (Story 11-5); rely on the source-of-truth type instead of a
            // call-site assertion that could silently lie post-refactor.
            // Defensive object check defends against a null-feedback shape
            // that a future transform might emit.
            if (result.feedback && typeof result.feedback === "object") {
              const fb: ConversationFeedback = result.feedback;
              this.setState((s) => ({ ...s, feedback: fb }));
            }
            return result;
          });
      }
      if (hasCorrections) {
        const patterns = this.corrections.map((c) => ({
          original: c.original,
          corrected: c.corrected,
          pattern: c.explanation,
          category: c.category,
        }));
        return persistErrorPatterns(user.id, patterns);
      }
      return Promise.resolve();
    };

    const phaseAResults = await Promise.allSettled([
      // Slot 0: conversation completion update
      supabase
        .from("conversations")
        .update({
          duration_seconds: duration,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", conversationId),
      // Slot 1: transcript messages batch insert
      messages.length > 0
        ? supabase.from("conversation_messages").insert(messages)
        : Promise.resolve({ error: null }),
      // Slot 2: AI analysis + persist (Story 11-5)
      analysisSlot(),
      // Slot 3: skill progress
      updateSkillProgress(user.id, "speaking", cefrLevel, speakingScore, minutesPracticed),
      // Slot 4: daily activity
      incrementDailyActivity(user.id, { minutes: minutesPracticed, conversations: 1 }),
      // Slot 5: streak
      updateStreak(user.id),
    ]);

    // Per-slot failure isolation (Story 11-5 P3 pattern: also inspect
    // `value.error` on fulfilled supabase slots).
    for (let i = 0; i < phaseAResults.length; i++) {
      const r = phaseAResults[i];
      const slot = PHASE_A_SLOT_NAMES[i];
      if (r.status === "rejected") {
        captureError(
          r.reason instanceof Error ? r.reason : new Error(String(r.reason)),
          `persist-conversation-phase-a-${slot}`
        );
        continue;
      }
      // Supabase v2 query builders resolve with { data, error } even on failure.
      const v = r.value as { error?: { message?: string } | null } | undefined;
      if (v && typeof v === "object" && "error" in v && v.error) {
        captureError(
          new Error(v.error.message ?? `phase-a-${slot} supabase error`),
          `persist-conversation-phase-a-${slot}`
        );
      }
    }

    // ── Phase B: checkCefrPromotion (depends on Phase A's skill-progress UPDATE)
    try {
      await checkCefrPromotion(user.id);
    } catch (err) {
      captureError(err, "persist-conversation-cefr-promotion");
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Public API: start / sendText / end
  // ────────────────────────────────────────────────────────────────────

  /** Start the voice conversation */
  async start(): Promise<void> {
    // Review-round-2 P25: guard against concurrent invocations AND against
    // `start()` being called while a reconnect is in progress.
    if (
      this.state.status === "connecting" ||
      this.state.status === "connected" ||
      this.state.status === "reconnecting"
    ) {
      return;
    }

    // Reset ALL state so retries start clean.
    this.transcript = [];
    // Story 12-6: clear the spill buffer alongside `transcript` so a
    // `start()` retry / `end()`→`start()` recycle lands in a clean state
    // (Story 12-1 P13 / Story 12-5 P1 reset-all-state pattern).
    this.spilledMessages = [];
    // Story 12-6 review-round-1 P3: reset the high-water-mark
    // idempotency flag so a fresh conversation can fire its own
    // breadcrumb if it accumulates enough spilled entries.
    this.spillHighWaterMarkBreached = false;
    this.corrections = [];
    this.currentAiText = "";
    this.durationSeconds = 0;
    this.startTimeMs = 0;
    this.conversationId = null;
    this.isEnding = false;
    this.processedResponseItems = new Set();
    this.inflightItemId = null;
    this.userTurnCounter = 0;
    this.pendingToolCorrections = [];
    this.responseInFlight = false;
    this.aiSpeakingStartedAtMs = null;
    // Story 12-1 review-round-1 P1: reset the synchronous mirror so a
    // previous conversation's stuck `true` value (e.g., barge-in path that
    // bypassed `handleResponseDone`) doesn't trigger a spurious barge-in
    // on this conversation's first `speech_started`.
    this.isAiSpeakingMirror = false;
    // Story 12-5 + review-round-1 P1: reset audio-stream lifecycle tracking.
    // Same Story 12-1 P1 reset-mirrors-on-start pattern so a pathological
    // `start()` retry after a partial prior `start()` (or an `end()`→`start()`
    // recycle that didn't clear the flag) lands in a clean state for the audio
    // refcount handshake. Critically: if `acquireWasCalled === true` here,
    // a previous lifecycle leaked an unmatched acquire — fire the matching
    // release BEFORE clearing the flag so the refcount stays balanced.
    // Without this, every retry would leak one refcount and the singleton
    // would stay open for an active consumer that no longer exists.
    if (this.acquireWasCalled) {
      this.acquireWasCalled = false;
      void releaseAudioStream();
    }

    // Story 12-1 review-round-1 P13: spread INITIAL_STATE explicitly so a
    // future field added to ConversationState propagates cleanly. Pre-patch
    // the literal omitted any new field and silently kept the old value.
    this.setState(() => ({ ...INITIAL_STATE, status: "connecting" }));

    try {
      const convoId = await this.createConversationRecord();
      if (!convoId) {
        throw new Error("Failed to create conversation record");
      }
      this.conversationId = convoId;
      this.setState((prev) => ({ ...prev, conversationId: convoId }));

      const systemPrompt = buildConversationPrompt({
        cefrLevel: this.options.cefrLevel,
        mode: this.options.mode,
        topic: this.options.topic,
        topicDescription: this.options.topicDescription,
        memories: this.options.memories,
        errorPatterns: this.options.errorPatterns,
      });

      const config: RealtimeConfig = {
        systemPrompt,
        voice: this.options.voice ?? "coral",
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

      // Story 12-4: populate `this.session` BEFORE `await session.connect()`
      // so any WebSocket message arriving during the await window (OpenAI's
      // `session.updated` ack, an early function-call from a very-fast turn,
      // etc.) sees the correct ref when `handleEvent` runs. Pre-12-4 the
      // assignment happened AFTER the await, leaving 13 `this.session?.foo()`
      // call sites in `handleEvent`-reachable paths to silently no-op via
      // optional-chaining when an event landed during the microtask gap
      // between `ws.onopen → resolve()` and the orchestrator's continuation.
      // Audit P2-21 closed architecturally.
      //
      // Review-round-1 patches applied:
      // - **P7 (handler-before-ref ordering):** `session.on(handler)` is
      //   called BEFORE `this.session = session` so any synchronous re-entrant
      //   code path that reads `this.session` and dispatches a method sees
      //   the session WITH its handler already wired. The early-assign still
      //   closes the await race because both statements run synchronously
      //   before `await session.connect()` either way.
      // - **P8 (session.on throw defense):** `session.on(handler)` is wrapped
      //   inside the same try/catch as the await so a synchronous throw
      //   from the registration (Set.add OOM, future SDK validation) is
      //   handled by the same cleanup path instead of leaving `this.session`
      //   pointing to a half-initialized session.
      // - **P3 (disconnect on connect failure):** the inner catch calls
      //   `session.disconnect({reason:"user"})` BEFORE nulling `this.session`
      //   so a partially-opened WebSocket doesn't leak with its `onclose` /
      //   `onmessage` handlers still wired to the orchestrator's
      //   `handleEvent` — late events from the failed session can't drive
      //   state mutations on a "disposed" orchestrator instance.
      // - Cleanup on connect failure clears `this.session = null` + resets
      //   synchronous mirrors so a failure-then-retry sequence starts clean
      //   (Story 12-1 P1 pattern).
      const session = new RealtimeSession(config);
      try {
        session.on(this.handleEvent);
        this.session = session;
        await session.connect();
      } catch (err) {
        try {
          session.disconnect({ reason: "user" });
        } catch {
          // disconnect on a half-open WS may throw on some platforms;
          // swallow because we're already in the error path.
        }
        this.session = null;
        this.isAiSpeakingMirror = false;
        this.responseInFlight = false;
        throw err;
      }

      await this.startAudioStreaming();

      // Start duration timer using Date.now() to prevent drift.
      this.startTimeMs = Date.now();
      this.durationTimer = setInterval(() => {
        this.durationSeconds = Math.floor((Date.now() - this.startTimeMs) / 1000);
        this.setState((s) => ({ ...s, durationSeconds: this.durationSeconds }));
      }, 1000);

      // AI starts the conversation.
      session.sendText(
        `Begin the conversation by greeting the user in French and introducing the topic: "${this.options.topic}". The user is at ${this.options.cefrLevel} level.`
      );
    } catch (err) {
      captureError(err, "realtime-voice-connection");
      const message = err instanceof Error ? err.message : "Connection failed";
      this.setState((s) => ({ ...s, status: "error", error: message }));
    }
  }

  /** Send a text message */
  sendText(text: string): void {
    if (!this.session?.isConnected) return;

    const entry: TranscriptEntry = {
      id: `user_${this.userTurnCounter++}`,
      role: "user",
      text,
      timestamp: Date.now(),
    };

    this.transcript = [...this.transcript, entry];
    this.setState((s) => ({ ...s, transcript: this.transcript }));
    this.options.onTranscriptUpdate?.(this.transcript);

    this.session.sendText(text);
  }

  /** End the conversation */
  end(): void {
    // Guard against double invocation.
    if (this.isEnding) return;
    this.isEnding = true;

    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }

    void this.stopAudioStreaming();
    // Story 12-1 review-round-1 P12: explicit `{reason: "user"}` so a
    // future RealtimeSession default-arg change doesn't silently re-open
    // the reconnect chain.
    this.session?.disconnect({ reason: "user" });
    this.session = null;
    void ExpoPlayAudioStream.stopSound();

    const duration = this.durationSeconds;
    this.setState((s) => ({
      ...s,
      status: s.status === "disconnected" ? "disconnected" : "ended",
      isSpeaking: false,
      isAiSpeaking: false,
      isProcessing: false,
    }));

    this.persistConversation(duration).catch((err) =>
      captureError(err, "persist-conversation-end")
    );
    // Story 12-1 review-round-1 P11: wrap caller's onConversationEnd in
    // try/catch so a throwing user callback doesn't leak out of `end()`
    // (which would leave `isEnding=true` permanently AND skip any further
    // cleanup callers might expect).
    try {
      this.options.onConversationEnd?.(this.transcript, this.corrections);
    } catch (err) {
      captureError(err, "on-conversation-end-callback");
    }
  }
}
