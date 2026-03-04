/**
 * OpenAI Realtime Voice API WebSocket Manager
 *
 * Manages the WebSocket connection for real-time voice conversations.
 * Uses ephemeral tokens from the Edge Function for security.
 */

import { captureError } from "./sentry";
import { requireNetwork } from "./network";
import { supabase } from "./supabase";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MODEL = "gpt-4o-realtime-preview";

/** Connection timeout in milliseconds */
const CONNECT_TIMEOUT_MS = 15_000;

export type RealtimeEvent =
  | { type: "session.created"; session: Record<string, unknown> }
  | { type: "session.updated"; session: Record<string, unknown> }
  | { type: "response.audio.delta"; delta: string }
  | { type: "response.audio.done" }
  | { type: "response.text.delta"; delta: string }
  | { type: "response.text.done"; text: string }
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
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  inputAudioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
  outputAudioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
  turnDetection?: {
    type: "server_vad";
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

    // Get ephemeral token from Edge Function
    const { data: sessionData, error } = await supabase.functions.invoke("realtime-session", {
      body: {
        model: MODEL,
        voice: this.config.voice ?? "nova",
      },
    });

    if (error || !sessionData?.client_secret?.value) {
      throw new Error(error?.message ?? "Failed to get realtime session token");
    }

    const ephemeralToken = sessionData.client_secret.value;

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
          "OpenAI-Beta": "realtime=v1",
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

  /** Configure the session with system prompt, voice, and tools */
  private configureSession(): void {
    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: this.config.systemPrompt,
        voice: this.config.voice ?? "nova",
        input_audio_format: this.config.inputAudioFormat ?? "pcm16",
        output_audio_format: this.config.outputAudioFormat ?? "pcm16",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: this.config.turnDetection ?? {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools: this.config.tools ?? [],
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

  /** Append audio data to the input buffer (Base64-encoded PCM) */
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
