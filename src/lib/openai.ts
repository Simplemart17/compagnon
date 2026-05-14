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

/**
 * Network-retry budget shared across all 4 AI helpers (Story 11-8 / Epic 11.8).
 * Each helper's transient-error retry loop runs at most `MAX_RETRIES`
 * additional attempts (so `MAX_RETRIES + 1` total attempts including the
 * original call). Story 11-3's server-side `fetchWithTimeout` is per-attempt:
 * worst-case end-to-end latency = `(MAX_RETRIES + 1) × per-attempt-timeout +
 * Σ RETRY_DELAYS`. Pre-11-8 only `chatCompletion` used this budget; TTS /
 * Whisper / embeddings used a local `maxRetries = 1` (deleted, not aliased).
 *
 * P6 review-round-1 patch: this JSDoc is now the SINGLE anchor referenced by
 * the other helpers' JSDocs (via "see MAX_RETRIES"); per-helper JSDocs no
 * longer hardcode the literal "2" so bumping this value propagates cleanly.
 */
export const MAX_RETRIES = 2;

/**
 * Per-attempt backoff delays in ms, indexed by attempt count (0-indexed).
 * Story 11-8: all 4 helpers consume the same schedule for operator symmetry.
 * Pre-11-8 TTS / Whisper / embedding used a fixed `sleep(1000)`.
 *
 * P7 review-round-1 patch: `Object.freeze`'d so a consumer mutating
 * `RETRY_DELAYS.push(4000)` can't silently corrupt the schedule for all 4
 * helpers globally. Test pins `Object.isFrozen(RETRY_DELAYS) === true`.
 *
 * `?? RETRY_DELAYS[RETRY_DELAYS.length - 1]` fallback at the consumption site
 * protects against future `MAX_RETRIES` bumps to 3+ that out-pace this array.
 */
export const RETRY_DELAYS: readonly number[] = Object.freeze([1000, 2000]) as readonly number[];

/**
 * The four canonical retryable-empty-response error messages emitted by the
 * 4 AI helpers in this module. Story 11-8 review patch P1: the previous
 * `msg.includes("empty")` substring match was too broad — would have
 * spuriously retried legitimate non-recoverable errors that coincidentally
 * contain the word "empty" (e.g., "OpenAI error: empty quota", "Empty
 * request body — 400", "Authentication failed: empty token cookie"). The
 * exact-match allowlist below is the precise contract.
 */
const RETRYABLE_EMPTY_MESSAGES: ReadonlySet<string> = new Set([
  "empty ai response",
  "empty tts response",
  "empty transcription response",
  "empty embedding response",
]);

/**
 * Whether an error is retryable (network/server issues, not auth/validation).
 *
 * Story 11-8: the 4 canonical empty-response sentinels are also retryable
 * (a 200-with-empty-body upstream stutter recovers via the retry loop). The
 * match is exact-message (review patch P1) not substring — see
 * `RETRYABLE_EMPTY_MESSAGES`.
 *
 * P8 review-round-1 patch: exported so runtime tests can assert the matrix
 * of (message, expected-retryable) pairs directly instead of relying on
 * source-string grep.
 */
export function isRetryable(error: unknown): boolean {
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
      msg.includes("rate limit") ||
      // Story 11-8 + review patch P1: exact-match against the canonical
      // sentinel set, NOT a substring check.
      RETRYABLE_EMPTY_MESSAGES.has(msg)
    );
  }
  return false;
}

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a chat completion request and return the assistant's text response.
 *
 * Story 11-5 / audit P1-10: the default `maxTokens` is **800** — a small
 * sentinel that surfaces mis-sized calls via Zod truncation → schema parse
 * failure → Sentry, instead of silently over-budgeting every call to 2048.
 * Every call site SHOULD pass an explicit `maxTokens` sized to its actual
 * output budget (see the per-site table in CLAUDE.md "Cost discipline" line).
 * Story 11-4's `daily_cost_ledger` pre-check uses maxTokens as the pessimistic
 * estimate, so over-large defaults consumed cap budget callers didn't need.
 */
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
          // Story 11-5: sentinel small default; every call site should override.
          maxTokens: options?.maxTokens ?? 800,
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

      // Story 11-8 review patch P10: drop the `?? ""` default so `content` is
      // `string | undefined`, making the `typeof` check below meaningful (pre-
      // patch the default coerced everything to a string, leaving the typeof
      // branch unreachable — a future refactor that removed the default would
      // have silently mis-handled non-string upstream values).
      const content: unknown = data?.choices?.[0]?.message?.content;
      // Story 11-8 (+ review patch P9): empty-response check applies to ALL
      // response formats. P9: use `/\S/u` regex instead of `.trim().length`
      // so Unicode whitespace categories (U+00A0 NBSP, U+2028 line separator,
      // U+2029 paragraph separator, etc.) are also detected as empty.
      // `.trim()` is ASCII-whitespace-only on older JS engines and could leak
      // visually-empty responses through. Throws "Empty AI response" which
      // matches the canonical-sentinel set in `isRetryable` so a one-shot
      // upstream stutter becomes a retry instead of a failure.
      if (typeof content !== "string" || !/\S/u.test(content)) {
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

/**
 * Generate speech audio from text using Azure Neural TTS (returns Base64 string).
 *
 * Story 11-8: retry budget bumped from local `maxRetries = 1` to shared
 * `MAX_RETRIES` (see constant above) for parity with `chatCompletion`.
 * Backoff schedule adopts the shared `RETRY_DELAYS` exponential schedule
 * instead of the pre-11-8 fixed `sleep(1000)`. New empty-Blob and
 * empty-string-fallback checks throw "Empty TTS response" which is
 * retryable via the `RETRYABLE_EMPTY_MESSAGES` allowlist in `isRetryable`.
 */
export async function generateSpeech(
  text: string,
  options?: {
    voice?: FrenchVoice;
    speed?: number;
  }
): Promise<string> {
  await requireNetwork();

  const maxRetries = MAX_RETRIES;
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
        // Story 11-8: empty-Blob check — Azure 200-with-zero-byte-body is rare
        // but possible; would silently propagate empty base64 to the audio
        // player → silent UI failure or crash.
        if (bytes.length === 0) {
          throw new Error("Empty TTS response");
        }
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      }

      if (typeof data === "string") {
        // Story 11-8: empty-string fallback check.
        if (data.length === 0) {
          throw new Error("Empty TTS response");
        }
        return data;
      }

      throw new Error("Unexpected TTS response format");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && isRetryable(lastError)) {
        await sleep(RETRY_DELAYS[attempt] ?? 2000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("TTS request failed");
}

/**
 * Transcribe audio using OpenAI Whisper (returns transcription text).
 *
 * Story 11-8: retry budget bumped from local `maxRetries = 1` to shared
 * `MAX_RETRIES` (see constant above) for parity. Backoff schedule adopts
 * `RETRY_DELAYS`. The pre-existing empty-text check ("Empty transcription
 * response") is unchanged in message but is now in the
 * `RETRYABLE_EMPTY_MESSAGES` allowlist, so a previously non-retried Whisper
 * empty-text response is now retried up to `MAX_RETRIES` times with backoff.
 */
export async function transcribeAudio(
  audioBase64: string,
  language: string = "fr"
): Promise<string> {
  await requireNetwork();

  const maxRetries = MAX_RETRIES;
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
        await sleep(RETRY_DELAYS[attempt] ?? 2000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Transcription request failed");
}

/**
 * Generate text embeddings for companion memory.
 *
 * Story 11-8: retry budget bumped from local `maxRetries = 1` to shared
 * `MAX_RETRIES` (see constant above) for parity. Backoff schedule adopts
 * `RETRY_DELAYS`. Pre-11-8 silently returned `?? []` on missing data —
 * that empty array propagated through `persistMemories` to Postgres
 * `JSON.stringify([])` → VECTOR(1536) cast rejection (delayed write
 * failure noise). Post-11-8 the boundary throws "Empty embedding response"
 * which is in the `RETRYABLE_EMPTY_MESSAGES` allowlist consumed by
 * `isRetryable`.
 *
 * Two-layer defense preserved: Story 11-6 `isValidEmbedding` at
 * `error-tracker.ts` is the consumer-side check (verifies length === 1536
 * + every component is finite). This boundary throw is the coarse-grain
 * "non-empty array" gate; the consumer check catches wrong-dim / NaN /
 * Infinity. Both stay layered (review patch P5 adds an explicit test that
 * imports `isValidEmbedding` and proves it still rejects a 5-element array
 * the boundary accepts).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  await requireNetwork();

  const maxRetries = MAX_RETRIES;
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

      // Story 11-8: replace silent `?? []` return with explicit throw.
      // P2 review-round-1 patch: validate `data?.data` is an Array BEFORE
      // indexing — pre-patch a shape-drift like `data: { data: { 0: ... } }`
      // (plain object with numeric keys) would still pass through the
      // optional chain and reach the embedding-length check via undefined,
      // emitting "Empty embedding response" with no signal that the shape
      // was wrong. The explicit array check makes shape drift fail loudly.
      if (!Array.isArray(data?.data)) {
        throw new Error("Empty embedding response");
      }
      const embedding = data.data[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Empty embedding response");
      }
      return embedding;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && isRetryable(lastError)) {
        await sleep(RETRY_DELAYS[attempt] ?? 2000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Embedding request failed");
}
