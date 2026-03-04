/**
 * Structured error codes for Edge Functions.
 *
 * Every error response includes a machine-readable `code` field
 * so the client can handle errors programmatically.
 */

export type ErrorCode =
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "BODY_TOO_LARGE"
  | "INVALID_PARAMS"
  | "UNKNOWN_ACTION"
  | "UPSTREAM_ERROR"
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
