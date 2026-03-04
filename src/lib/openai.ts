/**
 * OpenAI API Client (via Supabase Edge Functions)
 *
 * All API calls route through Edge Functions so API keys
 * never leave the server.
 */

import { supabase } from "./supabase";
import { requireNetwork } from "./network";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 2000]; // ms delay before each retry

/** Whether an error is retryable (network/server issues, not auth/validation) */
function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("fetch") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("429") ||
      msg.includes("rate limit")
    );
  }
  return false;
}

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send a chat completion request and return the assistant's text response */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: "text" | "json_object";
    retries?: number;
  }
): Promise<string> {
  const maxRetries = options?.retries ?? MAX_RETRIES;
  let lastError: Error | null = null;

  // Check connectivity before making API calls
  await requireNetwork();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-proxy", {
        body: {
          action: "chat",
          messages,
          model: options?.model ?? "gpt-4o",
          temperature: options?.temperature ?? 0.7,
          maxTokens: options?.maxTokens ?? 2048,
          responseFormat: options?.responseFormat,
        },
      });

      if (error) {
        // Extract the real error from the Edge Function response
        let detail = error.message;
        try {
          // FunctionsHttpError has a `context` Response we can read
          const ctx = (error as { context?: unknown }).context;
          if (ctx instanceof Response) {
            const body = await ctx.json();
            detail = body?.error ?? JSON.stringify(body);
          }
        } catch {
          // context wasn't readable — fall through to generic message
        }
        console.error("[ai-proxy]", detail);
        throw new Error(`AI proxy error: ${detail}`);
      }
      if (data?.error) throw new Error(`OpenAI error: ${data.error}`);

      const content = data?.choices?.[0]?.message?.content ?? "";
      if (!content && options?.responseFormat === "json_object") {
        throw new Error("Empty AI response");
      }

      return content;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && isRetryable(lastError)) {
        await sleep(RETRY_DELAYS[attempt] ?? 2000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("AI request failed");
}

/** Send a chat completion request and parse the JSON response */
export async function chatCompletionJSON<T>(
  messages: ChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<T> {
  const raw = await chatCompletion(messages, {
    ...options,
    responseFormat: "json_object",
  });

  return JSON.parse(raw) as T;
}

/** Generate speech audio from text using OpenAI TTS (returns Base64 string) */
export async function generateSpeech(
  text: string,
  options?: {
    voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
    speed?: number;
  }
): Promise<string> {
  await requireNetwork();

  const maxRetries = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-proxy", {
        body: {
          action: "tts",
          input: text,
          voice: options?.voice ?? "nova",
          speed: options?.speed ?? 1.0,
        },
      });

      if (error) throw new Error(`TTS error: ${error.message}`);

      // Edge function returns binary audio — convert to base64
      if (data instanceof Blob) {
        const buffer = await data.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      }

      if (typeof data === "string") return data;

      throw new Error("Unexpected TTS response format");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && isRetryable(lastError)) {
        await sleep(1000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("TTS request failed");
}

/** Generate text embeddings for companion memory */
export async function generateEmbedding(text: string): Promise<number[]> {
  await requireNetwork();

  const maxRetries = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-proxy", {
        body: {
          action: "embedding",
          input: text,
        },
      });

      if (error) throw new Error(`Embedding error: ${error.message}`);
      if (data?.error) throw new Error(`OpenAI error: ${data.error}`);

      return data?.data?.[0]?.embedding ?? [];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && isRetryable(lastError)) {
        await sleep(1000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Embedding request failed");
}
