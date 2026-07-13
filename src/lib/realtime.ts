/**
 * OpenAI Realtime Voice API WebSocket Manager
 *
 * Manages the WebSocket connection for real-time voice conversations.
 * Uses ephemeral tokens from the Edge Function for security.
 *
 * Targets the GA Realtime API (not the beta interface).
 * See: https://platform.openai.com/docs/guides/realtime-websocket
 *
 * Modality contract (story 9-5): voice sessions configure
 * `output_modalities: ["audio"]` so the GA API emits exactly one terminal
 * transcript event (`response.output_audio_transcript.done`) per AI turn.
 * Enabling `"text"` alongside `"audio"` causes BOTH `response.output_text.done`
 * and `response.output_audio_transcript.done` to fire for the same response,
 * which doubles every AI turn in the UI and DB. Do not re-add `"text"` without
 * the dedup safety net in `src/lib/realtime-transcript.ts` and a follow-up to
 * the regression suite in `src/lib/__tests__/realtime-dedup.test.ts`.
 */

import { addBreadcrumb, captureError } from "./sentry";
import { requireNetwork } from "./network";
import { supabase } from "./supabase";
import { shouldReconnect, type CloseReason } from "./realtime-reconnect";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";

/**
 * Default Realtime model (Story 11-5 / audit P1-10 free-tier cost reduction).
 *
 * `gpt-realtime-mini` is the v1 free-tier baseline: $10/1M input + $20/1M
 * output, which is **3.2× cheaper** than `gpt-realtime` ($32/1M + $64/1M).
 * For the TCF Canada practice use case (5-10 min conversational sessions
 * with French-language tutoring) the quality difference is operator-
 * acceptable per the documented free-tier strategy in CLAUDE.md.
 *
 * The Story 11-4 `realtime-session` Edge Function allowlist already
 * accepts `gpt-realtime-mini` (no server-side change needed). The
 * Story 11-4 `MODEL_RATES["gpt-realtime-mini"]` cost-table entry is
 * already pinned at the rates above; the daily-cost-cap pre-check
 * tightens automatically with this constant change.
 *
 * Story 11-2's reconnect path replays the cached `RealtimeConfig` on
 * each reconnect, so the mini model survives reconnects by construction.
 * Story 11-1's three tools (save_vocabulary, note_error_pattern,
 * report_correction) all work with mini — OpenAI's Realtime API surface
 * is identical for both models.
 *
 * Future paid-tier override (Epic 16.X): when `profiles.tier` lands,
 * this constant becomes a function that reads
 * `useAuthStore.getState().profile?.tier` and returns either
 * `"gpt-realtime-mini"` (free) or `"gpt-realtime"` (paid).
 */
const MODEL = "gpt-realtime-mini";

/** Connection timeout in milliseconds */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * GA Realtime API event types.
 *
 * Audio-related events use the `output_` prefix in the GA API:
 *   response.output_audio.delta, response.output_audio.done,
 *   response.output_audio_transcript.delta, response.output_audio_transcript.done,
 *   response.output_text.delta, response.output_text.done
 */
export type RealtimeEvent =
  | { type: "session.created"; session: Record<string, unknown> }
  | { type: "session.updated"; session: Record<string, unknown> }
  | {
      type: "response.output_audio.delta";
      delta: string;
      response_id?: string;
      item_id?: string;
      content_index?: number;
    }
  | {
      type: "response.output_audio.done";
      response_id?: string;
      item_id?: string;
      content_index?: number;
    }
  | {
      type: "response.output_text.delta";
      delta: string;
      response_id?: string;
      item_id?: string;
      content_index?: number;
    }
  | {
      type: "response.output_text.done";
      text: string;
      response_id?: string;
      item_id?: string;
      content_index?: number;
    }
  | {
      type: "response.output_audio_transcript.delta";
      delta: string;
      response_id?: string;
      item_id?: string;
      content_index?: number;
    }
  | {
      type: "response.output_audio_transcript.done";
      transcript: string;
      response_id?: string;
      item_id?: string;
      content_index?: number;
    }
  | { type: "response.done"; response: Record<string, unknown> }
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" }
  | { type: "input_audio_buffer.committed" }
  | { type: "conversation.item.created"; item: Record<string, unknown> }
  | {
      type: "response.function_call_arguments.done";
      call_id: string;
      name: string;
      arguments: string;
    }
  | { type: "error"; error: { message: string; code: string } }
  // Story 11-2: emitted by `RealtimeSession` when an unexpected post-open
  // close triggers a reconnect attempt. The hook reacts by setting
  // `state.status: "reconnecting"`, draining the Story 11-1 pending
  // tool-correction buffer into `correctionsRef`, and stopping the prior
  // audio subscription.
  | { type: "realtime.reconnecting"; attempt: number }
  // Story 11-2: emitted by `RealtimeSession` when a reconnect attempt
  // successfully re-establishes the WebSocket + replays `configureSession()`.
  // The hook reacts by setting `state.status: "connected"` and re-starting
  // audio streaming for the new WebSocket.
  | { type: "realtime.reconnected" };

export interface RealtimeConfig {
  systemPrompt: string;
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
  turnDetection?: {
    type: "server_vad" | "semantic_vad";
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
  tools?: {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
}

export type RealtimeEventHandler = (event: RealtimeEvent) => void;

export class RealtimeSession {
  private ws: WebSocket | null = null;
  private eventHandlers: Set<RealtimeEventHandler> = new Set();
  private _isConnected = false;
  private config: RealtimeConfig;

  // Story 11-2: reconnect lifecycle state.
  //
  // `reconnectAttempts` counts COMPLETED attempts since the last successful
  // connect (or since `start()` time). Reset to 0 on each successful
  // reconnect.
  //
  // `reconnectTimeoutId` holds the pending setTimeout handle for the next
  // attempt; cleared in `disconnect()` to prevent a stale attempt firing
  // after the user has navigated away.
  //
  // `intentionallyDisconnected` is set true by `disconnect({ reason: "user" })`
  // BEFORE the WebSocket close fires, so the onclose handler can branch
  // off the reconnect path. Reset to false at the start of each
  // `establishConnection()`.
  private reconnectAttempts = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private intentionallyDisconnected = false;
  private wasConnected = false;

  constructor(config: RealtimeConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /** Register an event handler */
  on(handler: RealtimeEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Connect to the Realtime API using an ephemeral token.
   *
   * Resets the reconnect state on entry (so a prior session's exhausted
   * attempt count doesn't leak into a fresh `start()` call) and delegates
   * to `establishConnection()` for the actual WebSocket setup. Reconnect
   * attempts internally call `establishConnection()` directly (NOT through
   * `connect()`) so they don't reset the per-disconnect attempt counter.
   */
  async connect(): Promise<void> {
    this.reconnectAttempts = 0;
    this.intentionallyDisconnected = false;
    this.wasConnected = false;
    await this.establishConnection();
  }

  /**
   * Establish a new WebSocket connection using an ephemeral token. Shared
   * code path between the initial `connect()` and the per-attempt
   * `attemptReconnect()`. Story 11-2.
   *
   * Review-round-2 patch P21 (HIGH): before assigning a new WebSocket to
   * `this.ws`, detach the old socket's event handlers so a queued late
   * `onclose` event from the stale socket cannot trigger a second
   * reconnect chain after a successful reconnect-end. The old socket is
   * also explicitly closed (no-op if already closed) so GC can reclaim it.
   */
  private async establishConnection(): Promise<void> {
    // Detach handlers from the prior WebSocket (if any). Calling .close()
    // on an already-closed socket is a no-op; calling on a still-open
    // socket fires onclose synchronously but we've already nulled the
    // handlers so the close is silent. Both cases prevent the late-fire
    // race documented in the JSDoc above.
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        // Ignore — closing an already-closed socket may throw on some
        // platforms; not actionable.
      }
      this.ws = null;
    }
    // Check network before attempting connection
    await requireNetwork();

    // Refresh the session to ensure a valid access token before calling the Edge Function.
    // supabase.functions.invoke uses the cached token which may be expired.
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      throw new Error("Session expired. Please sign in again.");
    }

    // Get ephemeral token from Edge Function (uses GA /v1/realtime/client_secrets endpoint)
    const { data: sessionData, error } = await supabase.functions.invoke("realtime-session", {
      body: {
        model: MODEL,
        voice: this.config.voice ?? "coral",
      },
    });

    if (error) {
      // Extract the actual error body from the Edge Function response
      let detail = error.message;
      try {
        if (error.context instanceof Response) {
          const body = await error.context.json();
          detail = body?.message || body?.error || detail;
        }
      } catch {
        // Fall back to generic message
      }
      throw new Error(detail);
    }

    // Extract ephemeral token — GA client_secrets endpoint returns token at top level:
    // { value: "ek_...", expires_at: ..., session: { ... } }
    const ephemeralToken = sessionData?.value ?? sessionData?.client_secret?.value;

    if (!ephemeralToken) {
      console.error("[Realtime] Unexpected session response:", JSON.stringify(sessionData));
      throw new Error("Failed to get realtime session token — no client secret returned.");
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      // Timeout: reject if WebSocket doesn't connect in time
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.ws?.close();
          this.ws = null;
          reject(new Error("Connection timed out. Please check your network and try again."));
        }
      }, CONNECT_TIMEOUT_MS);

      const url = `${REALTIME_URL}?model=${MODEL}`;

      // React Native WebSocket accepts headers via 3rd argument (options), not 2nd (protocols)
      const RNWebSocket = WebSocket as unknown as new (
        url: string,
        protocols: string[],
        options: { headers: Record<string, string> }
      ) => WebSocket;
      this.ws = new RNWebSocket(url, [], {
        headers: {
          Authorization: `Bearer ${ephemeralToken}`,
        },
      });

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        // Review-round-2 patch P26 (MED): defense-in-depth check for the
        // disconnect-during-reconnect-await race. If the user called
        // `disconnect({reason:"user"})` between the establishConnection
        // start and the new ws's open, close the new socket immediately
        // WITHOUT running configureSession (which would consume an OpenAI
        // Realtime session billed to the operator). The post-await check
        // in attemptReconnect ALSO handles this race; this is the earlier
        // gate that fires before the server-side session is initialized.
        if (this.intentionallyDisconnected) {
          try {
            this.ws?.close();
          } catch {
            // ignore
          }
          this.ws = null;
          // Don't resolve the connect promise — the attempt was aborted;
          // the post-await check in attemptReconnect handles cleanup.
          return;
        }
        this._isConnected = true;
        // Story 11-2: track that we reached the open state at least once,
        // so the onclose handler can distinguish pre-open closes (existing
        // reject path) from post-open closes (potential reconnect candidate).
        this.wasConnected = true;
        this.configureSession();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(
            typeof event.data === "string" ? event.data : ""
          ) as RealtimeEvent;
          this.emit(data);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onerror = (err: Event) => {
        console.error("[Realtime] WebSocket error:", err);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        }
      };

      this.ws.onclose = () => {
        this._isConnected = false;
        if (!settled) {
          // Pre-open close — existing reject path. NO reconnect: the
          // caller's `connect()` Promise rejects and the UI handles it.
          settled = true;
          clearTimeout(timeout);
          reject(new Error("Connection closed unexpectedly"));
          return;
        }
        // Post-open close. Story 11-2: consult the reconnect-decision
        // helper before falling through to the terminal connection_lost
        // emission.
        const closeReason: CloseReason = this.intentionallyDisconnected ? "user" : "unknown";
        const decision = shouldReconnect(closeReason, this.wasConnected, this.reconnectAttempts);
        if (!decision.reconnect) {
          if (this.intentionallyDisconnected) {
            // User-triggered close (`disconnect({ reason: "user" })`); NO
            // event emitted — `end()` already handles the teardown.
            return;
          }
          // Exhausted attempts OR pre-open path that somehow reached
          // post-settled — emit the terminal connection_lost (existing path).
          this.emit({
            type: "error",
            error: { message: "Connection lost. Please try again.", code: "connection_lost" },
          });
          return;
        }
        // Schedule the next reconnect attempt.
        addBreadcrumb({
          category: "realtime",
          level: "info",
          message: "Realtime reconnect attempt",
          data: { feature: "realtime-reconnect", attempt: decision.attempt },
        });
        this.emit({ type: "realtime.reconnecting", attempt: decision.attempt });
        this.reconnectTimeoutId = setTimeout(() => {
          this.reconnectTimeoutId = null;
          void this.attemptReconnect();
        }, decision.delayMs);
      };
    });
  }

  /**
   * Configure the session with system prompt, voice, and tools.
   *
   * Uses the GA Realtime API format with nested audio configuration
   * and `type: "realtime"` session type.
   *
   * Voice sessions configure `output_modalities: ["audio"]` to ensure
   * exactly one terminal transcript event (`response.output_audio_transcript.done`)
   * fires per response. Enabling `"text"` alongside `"audio"` causes the GA API
   * to emit BOTH `response.output_text.done` and
   * `response.output_audio_transcript.done` for the same response, which doubles
   * the assistant turn in the UI and in `conversation_messages`. See story 9-5.
   *
   * The audio transcript is the canonical text we render and persist; audio-only
   * keeps voice playback working AND yields a single terminal event per turn.
   */
  private configureSession(): void {
    // VAD threshold tuned for real-world use: at 0.5 (the default) the server
    // false-triggers on quiet environmental noise + any residual AI-voice bleed
    // through the mic, producing phantom "user turns" that auto-create new AI
    // responses and stack bubbles indefinitely. 0.7 is loud enough to require
    // intentional user speech while still capturing normal conversational
    // volume. `silence_duration_ms` bumped to 700 to give the user a brief
    // pause to think between sentences without prematurely ending their turn.
    const turnDetection = this.config.turnDetection ?? {
      type: "server_vad" as const,
      threshold: 0.7,
      prefix_padding_ms: 300,
      silence_duration_ms: 700,
    };

    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: this.config.systemPrompt,
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: "gpt-4o-transcribe",
            },
            turn_detection: turnDetection,
          },
          output: {
            format: {
              type: "audio/pcm",
              // OpenAI Realtime API requires `rate` on output.format the same
              // way it does on input.format. Omitting it surfaces as
              // `Missing required parameter: 'session.audio.output.format.rate'`
              // on the first session.update — which fails session bootstrap
              // and tanks the entire conversation flow before any user audio
              // is exchanged. 24kHz is the PCM16 default used by the GA API
              // and matched on the playback side via ExpoPlayAudioStream.
              rate: 24000,
            },
            voice: this.config.voice ?? "coral",
          },
        },
        tools: this.config.tools ?? [],
        tool_choice: "auto",
      },
    });
  }

  /** Send a text message to the conversation */
  sendText(text: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
  }

  /** Append audio data to the input buffer (Base64-encoded 16kHz PCM16 mono) */
  appendAudio(base64Audio: string): void {
    this.send({
      type: "input_audio_buffer.append",
      audio: base64Audio,
    });
  }

  /** Commit the audio buffer and trigger a response */
  commitAudio(): void {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  /** Clear the audio input buffer */
  clearAudioBuffer(): void {
    this.send({ type: "input_audio_buffer.clear" });
  }

  /** Respond to a function call from the model */
  sendFunctionResult(callId: string, result: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: result,
      },
    });
    this.send({ type: "response.create" });
  }

  /**
   * Disconnect from the Realtime API.
   *
   * Story 11-2: accepts an optional `{ reason }` discriminator so the
   * onclose handler can distinguish intentional disconnects (skip
   * reconnect) from unexpected closes (trigger reconnect). Defaults to
   * `{ reason: "user" }` for backwards-compat with all existing callers.
   *
   * Clears any pending reconnect-timeout BEFORE closing the WebSocket so a
   * stale attempt doesn't fire after the user has navigated away.
   */
  disconnect(opts: { reason?: "user" | "reconnect" } = { reason: "user" }): void {
    this.intentionallyDisconnected = opts.reason === "user";
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.eventHandlers.clear();
  }

  /**
   * Attempt to re-establish the WebSocket after an unexpected close.
   * Story 11-2. Called from the onclose handler via `setTimeout(_, delayMs)`.
   *
   * Increments the attempt counter, runs `establishConnection()` (which
   * fetches a fresh ephemeral token + opens a new WebSocket + re-sends
   * `configureSession()` via the existing `ws.onopen`), and on success
   * emits `realtime.reconnected` + resets the counter. On failure the
   * new connection's own `onclose` runs the reconnect-decision helper
   * again with the incremented counter — natural backoff loop.
   */
  private async attemptReconnect(): Promise<void> {
    // Defense: if the user called `end()` / `disconnect({reason:"user"})`
    // between the setTimeout schedule and the actual attempt firing, bail
    // out without consuming a slot or burning an Edge Function call.
    if (this.intentionallyDisconnected) {
      return;
    }
    this.reconnectAttempts++;
    try {
      await this.establishConnection();
      // Defense (post-await race): if the user disconnected DURING the
      // establishConnection await (refreshSession + Edge Function call
      // are both async-await — non-trivial latency), the new WebSocket
      // is alive but the user has navigated away. Close it immediately
      // so we don't consume an OpenAI session unnecessarily.
      if (this.intentionallyDisconnected) {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        this._isConnected = false;
        return;
      }
      // Successful reconnect — reset the per-disconnect attempt counter
      // so a SECOND unexpected close later in the same session starts
      // fresh from `RECONNECT_BACKOFF_MS[0]`.
      this.reconnectAttempts = 0;
      this.emit({ type: "realtime.reconnected" });
      addBreadcrumb({
        category: "realtime",
        level: "info",
        message: "Realtime reconnected",
        data: { feature: "realtime-reconnect" },
      });
    } catch (err) {
      captureError(err, "realtime-reconnect");
      // If `establishConnection` threw BEFORE opening a WebSocket (e.g.,
      // requireNetwork rejected, refreshSession rejected, the Edge
      // Function returned an error), no `ws.onclose` will fire to drive
      // the next backoff cycle. Schedule the next attempt manually here
      // so the backoff loop progresses even on pre-WebSocket failures.
      // If a WebSocket WAS opened then failed (post-open close), the
      // ws.onclose handler already scheduled the next attempt and this
      // path is a no-op (reconnectTimeoutId is already non-null).
      if (this.intentionallyDisconnected) {
        // User-initiated cancel between attempts — bail out.
        return;
      }
      if (this.reconnectTimeoutId !== null) {
        // ws.onclose already scheduled the next attempt — don't double-schedule.
        return;
      }
      const decision = shouldReconnect("unknown", this.wasConnected, this.reconnectAttempts);
      if (!decision.reconnect) {
        this.emit({
          type: "error",
          error: { message: "Connection lost. Please try again.", code: "connection_lost" },
        });
        return;
      }
      addBreadcrumb({
        category: "realtime",
        level: "info",
        message: "Realtime reconnect attempt",
        data: { feature: "realtime-reconnect", attempt: decision.attempt },
      });
      this.emit({ type: "realtime.reconnecting", attempt: decision.attempt });
      this.reconnectTimeoutId = setTimeout(() => {
        this.reconnectTimeoutId = null;
        void this.attemptReconnect();
      }, decision.delayMs);
    }
  }

  /**
   * Send a raw client event to the Realtime API.
   *
   * Story 11-2 — public surface for events that don't have typed wrappers
   * (e.g., `response.cancel`, `conversation.item.truncate` — Story 11-2
   * needs both for barge-in; neither was added by Stories 1-X / 11-1).
   * Use the typed methods (`sendText` / `appendAudio` / `commitAudio` /
   * `clearAudioBuffer` / `sendFunctionResult` / `disconnect`) when one
   * fits; reserve `sendRaw` for one-off events.
   *
   * Review-round-2 patch P27 (MED): if the WebSocket is not OPEN at send
   * time (e.g., barge-in concurrent with a network blip → ws.readyState ===
   * CLOSING), `send()` silently no-ops. Surface this via a Sentry breadcrumb
   * so operators have visibility into dropped barge-in / one-off events.
   */
  sendRaw(event: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "sendRaw dropped (WebSocket not OPEN)",
        data: { feature: "realtime-sendraw-dropped" },
      });
      return;
    }
    this.send(event);
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private emit(event: RealtimeEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        captureError(err, "realtime-event-handler");
        console.error("[Realtime] Event handler error:", err);
      }
    }
  }
}
