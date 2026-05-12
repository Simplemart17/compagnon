/**
 * Upstream fetch wrapper with AbortSignal.timeout() (Story 11-3 / audit P1-9).
 *
 * Every upstream fetch in our Edge Functions (OpenAI chat, OpenAI embedding,
 * OpenAI Whisper, OpenAI Realtime token, Azure TTS, Azure pronunciation)
 * routes through this helper so a hung upstream is released within budget
 * instead of holding the Edge Function isolate's concurrency slot until
 * Supabase's platform-level 150s wall-clock kill fires.
 *
 * The message format `"Upstream timeout: {upstream} did not respond within {ms}ms"`
 * contains the literal lowercase substring "timeout" so the client-side
 * `isRetryable()` check at `src/lib/openai.ts:23-37` triggers the existing
 * `MAX_RETRIES = 2` retry-with-backoff path transparently — no client-side
 * code changes needed.
 *
 * Body-read coverage: `fetchWithTimeout` bounds only the request + headers
 * phase. For body consumption (`.arrayBuffer()` / `.text()` / `.json()`), use
 * the companion `withTimeout(label, promise, ms)` helper at call sites that
 * read large or slow bodies (the canonical case is Azure TTS audio buffers
 * and `parseUpstreamError` body reads on non-OK responses).
 */

/** Default upstream timeout — covers chat, embedding, TTS, realtime-token, pronunciation. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Whisper transcription timeout — audio processing scales with duration.
 *
 * 90s budget rationale: the Story 9-8 speaking pipeline uses 32 kbit AAC so a
 * Task-2 recording (5.5 min max per TCF spec) fits the 5 MB ai-proxy cap. At
 * Whisper p99 ≈ ~30s for compact AAC plus model-load tail spikes observed in
 * production (~60s), 90s leaves ~30s headroom before the Supabase 150s
 * platform kill. Bumped from the initial 60s per Story 11-3 review patch D2.
 */
export const WHISPER_UPSTREAM_TIMEOUT_MS = 90_000;

/** Short budget for reading error-response bodies. Error bodies are tiny; a slow read is a hung-upstream signal. */
export const ERROR_BODY_READ_TIMEOUT_MS = 5_000;

/**
 * Typed error thrown by `fetchWithTimeout` (or `withTimeout`) when an
 * upstream call or body read exceeds its budget. The Edge Function catch
 * path uses `isUpstreamTimeoutError` (or `instanceof`) to discriminate this
 * from other fetch failures (network drop, DNS, non-timeout AbortError).
 */
export class UpstreamTimeoutError extends Error {
  readonly upstream: string;
  readonly timeoutMs: number;
  constructor(upstream: string, timeoutMs: number, cause?: unknown) {
    // Message MUST contain the literal lowercase substring "timeout" so the
    // client-side `isRetryable()` check at `src/lib/openai.ts:23-37` triggers
    // a retry. The substring is load-bearing — do not reformat without
    // updating the client-side regex AND the regression test at
    // `src/lib/__tests__/upstream-timeout-error.test.ts`.
    super(`Upstream timeout: ${upstream} did not respond within ${timeoutMs}ms`);
    this.name = "UpstreamTimeoutError";
    this.upstream = upstream;
    this.timeoutMs = timeoutMs;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Typed error thrown synchronously when `fetchWithTimeout` is misused
 * (e.g., caller supplies an `init.signal`, which the v1 helper does NOT
 * combine with `AbortSignal.timeout`). Distinct `name` + `code` so the outer
 * `INTERNAL_ERROR` catch path can surface it in logs without confusion with
 * other internal errors. Story 11-3 review patch P7.
 */
export class FetchWithTimeoutMisuseError extends Error {
  readonly code = "FETCH_WITH_TIMEOUT_MISUSE" as const;
  constructor(message: string) {
    super(message);
    this.name = "FetchWithTimeoutMisuseError";
  }
}

/**
 * Pure type-guard for `UpstreamTimeoutError`. `instanceof` works in Deno
 * but pulling the discrimination into a helper keeps the call-site intent
 * obvious and lets tests assert error shape without `instanceof`.
 *
 * Defensive: also matches by `name === "UpstreamTimeoutError"` so a future
 * realm-boundary case where the constructor identity drifts (cross-isolate
 * imports, polyfilled fetch implementations) still discriminates correctly.
 * Story 11-3 review patch P3.
 */
export function isUpstreamTimeoutError(err: unknown): err is UpstreamTimeoutError {
  if (err instanceof UpstreamTimeoutError) return true;
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "UpstreamTimeoutError"
  );
}

/**
 * Wrap `fetch()` with `AbortSignal.timeout(timeoutMs)`. On timeout, rejects
 * with `UpstreamTimeoutError(upstream, timeoutMs, cause)`. Other fetch
 * failures (network, DNS, non-OK status) fall through unchanged — the
 * caller's existing error handling owns them.
 *
 * Caller-supplied `init.signal` is rejected synchronously: combining
 * signals is out of scope for v1. A future story can adopt
 * `AbortSignal.any([...])` if a caller needs both user-cancel + timeout.
 *
 * NOTE: this bounds only the request-and-headers phase. Body consumption
 * (`response.arrayBuffer()` etc.) is NOT bounded unless the caller wraps
 * the read with `withTimeout`. See module-level JSDoc.
 *
 * @param upstream  Short upstream name for the error message + logs (e.g.,
 *                  "openai-chat", "openai-whisper", "azure-tts").
 * @param input     Standard fetch first-arg.
 * @param init      Standard fetch init. Must not contain `signal`.
 * @param timeoutMs Defaults to `DEFAULT_UPSTREAM_TIMEOUT_MS` (30s).
 */
export async function fetchWithTimeout(
  upstream: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_UPSTREAM_TIMEOUT_MS
): Promise<Response> {
  if (init?.signal) {
    throw new FetchWithTimeoutMisuseError(
      "fetchWithTimeout: caller-supplied signal not supported in v1 (use AbortSignal.any if you need to combine signals)"
    );
  }
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException whose .name === "TimeoutError".
    // See https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static.
    // Defensive: name-check covers the cross-realm case where instanceof can fail
    // even when the underlying error is functionally a TimeoutError.
    const looksLikeTimeout =
      (err instanceof DOMException && err.name === "TimeoutError") ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "TimeoutError");
    if (looksLikeTimeout) {
      // Operability: surface the timeout fire to Supabase function logs so
      // operators can distinguish "upstream slow" from "upstream 5xx" from
      // "network was bad" without correlating against HTTP access logs.
      // Story 11-3 review patch P5.
      console.warn(
        `[upstream-timeout] ${upstream} did not respond within ${timeoutMs}ms`
      );
      throw new UpstreamTimeoutError(upstream, timeoutMs, err);
    }
    throw err;
  }
}

/**
 * Wrap an arbitrary Promise (typically a body-read like `response.arrayBuffer()`,
 * `response.text()`, or `response.json()`) with a timeout. On expiry, rejects
 * with `UpstreamTimeoutError(label, timeoutMs)`. The underlying promise is
 * not cancelled — it's just ignored — so the caller is responsible for any
 * subsequent cleanup. For body reads where the Response is tied to a
 * still-live `AbortSignal`, the body read will also be aborted naturally
 * via the original fetch signal.
 *
 * Story 11-3 review patch P1 (body-read coverage).
 */
export async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_UPSTREAM_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          console.warn(
            `[upstream-timeout] body-read ${label} did not complete within ${timeoutMs}ms`
          );
          reject(new UpstreamTimeoutError(label, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
