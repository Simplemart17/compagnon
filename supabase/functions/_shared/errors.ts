/**
 * Structured error codes for Edge Functions.
 *
 * Every error response includes a machine-readable `code` field
 * so the client can handle errors programmatically.
 */

import { ERROR_BODY_READ_TIMEOUT_MS, withTimeout } from "./fetch-with-timeout.ts";

export type ErrorCode =
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "DAILY_COST_CAP_EXCEEDED"
  | "BODY_TOO_LARGE"
  | "INVALID_PARAMS"
  | "UNKNOWN_ACTION"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL_ERROR";

interface ErrorResponseOptions {
  code: ErrorCode;
  message: string;
  status: number;
  corsHeaders: Record<string, string>;
  retryAfter?: number;
}

export function errorResponse({
  code,
  message,
  status,
  corsHeaders,
  retryAfter,
}: ErrorResponseOptions): Response {
  const body: Record<string, unknown> = { error: message, code };
  if (retryAfter !== undefined) body.retryAfter = retryAfter;

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
  };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);

  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Build a 504 Gateway Timeout response for an upstream that exceeded its
 * `fetchWithTimeout` budget (Story 11-3 / audit P1-9).
 *
 * The message contains the literal lowercase substring "timeout" so the
 * client-side `isRetryable()` check at `src/lib/openai.ts:23-37` triggers
 * a retry. Re-uses the existing `errorResponse` shape so the `retryAfter`
 * field and `Retry-After` header are populated consistently, and adds
 * structured `upstream` + `timeoutMs` top-level body fields so clients
 * and analytics consumers can filter by upstream label without regex'ing
 * the message (Story 11-3 review patch P6).
 *
 * `retryAfter` is the seconds-to-wait-before-retry value the client should
 * honor. Defaults to 5; callers can override (Story 11-3 review patch D1).
 */
export function timeoutResponse(
  corsHeaders: Record<string, string>,
  details: { upstream: string; timeoutMs: number; retryAfter?: number }
): Response {
  const retryAfter = details.retryAfter ?? 5;
  const code: ErrorCode = "UPSTREAM_TIMEOUT";
  // Message MUST contain the literal lowercase substring "timeout" so the
  // client-side `isRetryable()` check at `src/lib/openai.ts:23-37` triggers
  // a retry. Mirrors the format used by `UpstreamTimeoutError`.
  const message = `Upstream timeout: ${details.upstream} did not respond within ${details.timeoutMs}ms`;

  // Structured body shape — extends the standard `errorResponse` payload with
  // explicit `upstream` + `timeoutMs` fields so future clients/analytics can
  // filter without parsing the message string.
  const body = {
    error: message,
    code,
    retryAfter,
    upstream: details.upstream,
    timeoutMs: details.timeoutMs,
  };

  return new Response(JSON.stringify(body), {
    status: 504,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    },
  });
}

/**
 * Cap for the raw upstream-error body that flows into operator-visible
 * function logs (Story 12-11). 2000 chars is enough to capture the full
 * JSON error shape from OpenAI / Azure, the top of an HTML 5xx page, and
 * the most-informative fragment of plain-text errors — while preventing
 * a malformed mountain of HTML from blowing out log storage. Mirrors the
 * Story 9-4 `MAX_MEMORY_CHARS = 300` and Story 11-7 `MAX_PROMPT_ITEM_CHARS = 80`
 * bounded-budget pattern (the budget is larger here because the consumer
 * is a log file, not a render path).
 */
export const MAX_LOGGED_BODY_CHARS = 2000;

/**
 * Read an upstream error response body, log it to operator-visible function
 * logs via `console.error` with the `[upstream-error]` prefix, and return a
 * GENERIC categorized message to the caller — Story 12-11 / closes audit P1-14.
 *
 * **Load-bearing security property:** the return value NEVER carries upstream
 * content. Pre-12-11 the function returned `parsed.error.message` (leaks
 * model names like `"The model gpt-4o is overloaded"` AND prompt fragments
 * like `"Your message exceeds token limit: 'translate French...'"`) OR raw
 * text (leaks HTML 5xx pages with server fingerprints). Post-12-11 the
 * return value is ALWAYS `"Upstream API error (status N)"`. Operators get
 * the full upstream body via Supabase function logs; clients see only the
 * generic message + HTTP status code.
 *
 * **Client-side retry compatibility:** the HTTP status code is preserved
 * in the returned string, so the client-side `isRetryable()` regex at
 * `src/lib/openai.ts:76-94` substring-matches on `"500"` / `"502"` / `"503"`
 * / `"429"` and triggers retry exactly as it did pre-12-11. No client code
 * change required.
 *
 * **Log retrieval recipe** (see `_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md` for the full operator runbook):
 *   - Supabase CLI: `supabase functions logs <function-name> --tail=200 | grep '\[upstream-error\]'`
 *   - Supabase Dashboard: Edge Functions → `<function-name>` → Logs tab
 *
 * @param response The upstream error Response (non-OK status).
 * @param upstreamLabel Categorical kebab-case short string identifying which
 *   upstream this is — one of: `"openai-chat-or-embedding"`, `"openai-whisper"`,
 *   `"openai-realtime-token"`, `"azure-tts"`, `"azure-pronunciation"`. Flows
 *   ONLY to the `console.error` log line, NEVER to the client response.
 * @returns A generic message of the shape `"Upstream API error (status N)"`.
 */
export async function parseUpstreamError(
  response: Response,
  upstreamLabel: string
): Promise<string> {
  const status = response.status;
  const genericMessage = `Upstream API error (status ${status})`;

  // The body of an error response should be tiny. If it isn't, the upstream
  // is hung mid-body and we shouldn't let the read consume the rest of the
  // isolate's wall-clock budget. Cap at ERROR_BODY_READ_TIMEOUT_MS (5s) via
  // the Story 11-3 `withTimeout` helper.
  let rawText: string;
  try {
    rawText = await withTimeout("error-body-read", response.text(), ERROR_BODY_READ_TIMEOUT_MS);
  } catch {
    console.error(
      `[upstream-error] ${upstreamLabel} status=${status} body=body-read-timeout`
    );
    return genericMessage;
  }

  const truncated =
    rawText.length > MAX_LOGGED_BODY_CHARS
      ? rawText.slice(0, MAX_LOGGED_BODY_CHARS) + "... (truncated)"
      : rawText;
  console.error(`[upstream-error] ${upstreamLabel} status=${status} body=${truncated}`);
  return genericMessage;
}
