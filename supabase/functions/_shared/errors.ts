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
  const rawText = await response.text();

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
