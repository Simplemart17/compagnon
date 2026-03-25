/**
 * OpenAI Realtime Voice API WebSocket Manager
 *
 * Manages the WebSocket connection for real-time voice conversations.
 * Uses ephemeral tokens from the Edge Function for security.
 *
 * Targets the GA Realtime API (not the beta interface).
 * See: https://platform.openai.com/docs/guides/realtime-websocket
 */

import { captureError } from "./sentry";
import { requireNetwork } from "./network";
import { supabase } from "./supabase";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MODEL = "gpt-realtime";

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
  | { type: "response.output_audio.delta"; delta: string }
  | { type: "response.output_audio.done" }
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.output_text.done"; text: string }
  | { type: "response.output_audio_transcript.delta"; delta: string }
  | { type: "response.output_audio_transcript.done"; transcript: string }
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
  | { type: "error"; error: { message: string; code: string } };

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

  /** Connect to the Realtime API using an ephemeral token */
  async connect(): Promise<void> {
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
        this._isConnected = true;
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
          settled = true;
          clearTimeout(timeout);
          reject(new Error("Connection closed unexpectedly"));
        } else {
          // Connection dropped after initial open — notify listeners
          this.emit({
            type: "error",
            error: { message: "Connection lost. Please try again.", code: "connection_lost" },
          });
        }
      };
    });
  }

  /**
   * Configure the session with system prompt, voice, and tools.
   *
   * Uses the GA Realtime API format with nested audio configuration
   * and `type: "realtime"` session type.
   */
  private configureSession(): void {
    const turnDetection = this.config.turnDetection ?? {
      type: "server_vad" as const,
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
    };

    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["text", "audio"],
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

  /** Disconnect from the Realtime API */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.eventHandlers.clear();
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
