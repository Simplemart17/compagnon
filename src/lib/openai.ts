/**
 * OpenAI API Client (via Supabase Edge Functions)
 *
 * All API calls route through Edge Functions so API keys
 * never leave the server.
 */

import type { z } from "zod";

import { supabase } from "./supabase";
import { requireNetwork } from "./network";
import { addBreadcrumb, captureError } from "./sentry";

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

/**
 * Options for `chatCompletionJSON`. The `feature` tag is required so every
 * Sentry event emitted by a parse failure is grep-able by call-site
 * (`feature: "exercise-listening"`, `feature: "writing-evaluation"`, …).
 * `parseRetries` defaults to 1 (matches story 9-7 spec: "retry once, then
 * fail loudly"); the placement-test call site overrides to 2.
 */
export interface ChatCompletionJSONOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tag passed to Sentry on parse failure for observability. Required. */
  feature: string;
  /** Per-call-site retry budget for parse failures. Default 1 (= one retry). */
  parseRetries?: number;
}

/**
 * Send a chat completion request, parse it as JSON, and validate the result
 * against the supplied Zod schema.
 *
 * Contract — story 9-7:
 *   1. Calls `chatCompletion(messages, { ...options, responseFormat: "json_object" })`.
 *      The existing network-retry logic inside `chatCompletion` (transient
 *      HTTP/timeout retries via `isRetryable`) is preserved.
 *   2. `JSON.parse` errors are NOT parse-retried — a non-JSON response from a
 *      JSON-mode request is an upstream invariant break, not a schema drift,
 *      and re-prompting will not change it. Captured and rethrown.
 *   3. Runs `schema.safeParse(parsed)`. On `success: true`, returns
 *      `result.data`.
 *   4. On `success: false`, emits a Sentry breadcrumb (`category: "ai"`,
 *      `level: "warning"`, `data: { feature, attempt, code }`) and retries
 *      the entire chain (chat call + parse + safeParse) up to `parseRetries`
 *      more times. Default budget = 1.
 *   5. After exhausting retries, calls
 *      `captureError(new Error(...), "ai-schema-parse-failed",
 *      { feature, attempt, code })` and throws the constructed Error.
 *
 * The constructed Error message is short and allowlist-safe (per the GDPR
 * scrubber's 80-char rule): `"AI schema parse failed: <path> — <issue.message>"`.
 * The raw `ZodError` is NOT included — it could echo user-derived field values.
 *
 * @example
 * ```ts
 * import { writingEvaluationSchema } from "@/src/lib/schemas/ai-responses";
 *
 * const evaluation = await chatCompletionJSON(
 *   messages,
 *   writingEvaluationSchema,
 *   { feature: "writing-evaluation", temperature: 0.3 }
 * );
 * // `evaluation` is typed as `z.infer<typeof writingEvaluationSchema>`.
 * ```
 */
export async function chatCompletionJSON<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  options: ChatCompletionJSONOptions
): Promise<T> {
  const { feature, model, temperature, maxTokens } = options;
  // Clamp parseRetries to a non-negative integer (story 9-7 review, P5).
  // A negative value would yield `totalAttempts = 0` — the loop would never
  // run, and the function would throw with `lastIssue: null` and a
  // misleading "AI schema parse failed: <root> — unknown" message despite
  // zero AI calls being made.
  const parseRetries = Math.max(0, Math.floor(options.parseRetries ?? 1));
  const totalAttempts = parseRetries + 1;

  let lastIssue: { path: string; message: string; code: string } | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    let raw: string;
    try {
      raw = await chatCompletion(messages, {
        model,
        temperature,
        maxTokens,
        responseFormat: "json_object",
      });
    } catch (err) {
      // Story 9-7 review (P6): preserve the schema-layer `feature` tag in
      // Sentry observability when the underlying chatCompletion exhausts its
      // own retry layer and throws. Without this breadcrumb, the only Sentry
      // tag is whatever the outer caller passes (e.g., "writing-evaluation"
      // from the call site), losing the schema-layer correlation.
      addBreadcrumb({
        category: "ai",
        level: "error",
        message: "chatCompletion threw inside chatCompletionJSON",
        data: { feature, attempt },
      });
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Non-JSON response from a JSON-mode call is an upstream defect; no
      // retry — re-prompting won't fix it.
      captureError(err, "ai-proxy-json-parse", { feature });
      throw err;
    }

    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    const firstIssue = result.error.issues[0];
    // Story 9-7 review (P13): use `||` not `??` so an empty-array path
    // (Zod's root-level error case, where issues[0].path is `[]`) falls
    // back to "<root>" rather than rendering as a literal empty string
    // (which produces "AI schema parse failed:  — <message>" — the
    // double space is observability noise).
    const issuePath = firstIssue?.path.join(".") || "<root>";
    lastIssue = {
      path: issuePath,
      message: firstIssue?.message || "unknown",
      code: firstIssue?.code || "unknown",
    };

    if (attempt < totalAttempts) {
      addBreadcrumb({
        category: "ai",
        level: "warning",
        message: "AI schema parse failed — retrying",
        data: { feature, attempt, code: lastIssue.code },
      });
      // Loop continues — retry the whole chain.
    }
  }

  const finalError = new Error(
    `AI schema parse failed: ${lastIssue?.path || "<root>"} — ${lastIssue?.message || "unknown"}`
  );
  captureError(finalError, "ai-schema-parse-failed", {
    feature,
    attempt: totalAttempts,
    code: lastIssue?.code || "unknown",
  });
  throw finalError;
}

/** Azure French neural voice (server maps short name → full Azure voice name) */
export type FrenchVoice = "denise" | "henri" | "vivienne" | "brigitte" | "remy" | "eloise";

/** Generate speech audio from text using Azure Neural TTS (returns Base64 string) */
export async function generateSpeech(
  text: string,
  options?: {
    voice?: FrenchVoice;
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
          voice: options?.voice ?? "denise",
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

/** Transcribe audio using OpenAI Whisper (returns transcription text) */
export async function transcribeAudio(
  audioBase64: string,
  language: string = "fr"
): Promise<string> {
  await requireNetwork();

  const maxRetries = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-proxy", {
        body: {
          action: "transcribe",
          audio: audioBase64,
          language,
        },
      });

      if (error) throw new Error(`Transcription error: ${error.message}`);
      if (data?.error) throw new Error(`Whisper error: ${data.error}`);

      const text = data?.text;
      if (!text || typeof text !== "string") {
        throw new Error("Empty transcription response");
      }

      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && isRetryable(lastError)) {
        await sleep(1000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Transcription request failed");
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
