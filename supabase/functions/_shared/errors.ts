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
 * Parse an upstream API error response into a human-readable message.
 *
 * OpenAI returns: { "error": { "message": "...", "type": "...", "code": "..." } }
 * Azure returns:  { "error": { "message": "...", "code": "..." } } or plain text/XML
 *
 * This function tries to extract the nested message. If the body is not JSON
 * or does not match the expected shape, it falls back to the raw text.
 */
export async function parseUpstreamError(response: Response): Promise<string> {
  // The body of an error response should be tiny. If it isn't, the upstream
  // is hung mid-body and we shouldn't let the read consume the rest of the
  // isolate's wall-clock budget. Cap at ERROR_BODY_READ_TIMEOUT_MS (5s).
  // If the read times out, fall back to a generic message so the caller's
  // structured-error pipeline still surfaces something sensible.
  // Story 11-3 review patch P1 (body-read coverage).
  let rawText: string;
  try {
    rawText = await withTimeout(
      "error-body-read",
      response.text(),
      ERROR_BODY_READ_TIMEOUT_MS
    );
  } catch {
    return `Upstream returned ${response.status} (body read timed out after ${ERROR_BODY_READ_TIMEOUT_MS}ms)`;
  }

  try {
    const parsed = JSON.parse(rawText);

    // OpenAI / Azure standard shape: { error: { message: "..." } }
    if (parsed?.error?.message) {
      const errObj = parsed.error;
      const parts = [errObj.message];
      if (errObj.type) parts.push(`type=${errObj.type}`);
      if (errObj.code) parts.push(`code=${errObj.code}`);
      return parts.join(" | ");
    }

    // Some APIs return { message: "..." } directly
    if (parsed?.message) {
      return parsed.message;
    }

    // Fallback: return the raw JSON as a string
    return rawText;
  } catch {
    // Not JSON — return raw text (could be XML, HTML error page, etc.)
    return rawText || `Upstream returned ${response.status} with empty body`;
  }
}
