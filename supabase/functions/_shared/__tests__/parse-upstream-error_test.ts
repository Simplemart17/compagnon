/**
 * Story 12-11 — parseUpstreamError runtime tests (Deno-runnable).
 *
 * RUN MANUALLY: `deno test --allow-all supabase/functions/_shared/__tests__/parse-upstream-error_test.ts`
 *
 * Epic 15.3 (`15-3-edge-function-deno-tests`) owns CI integration for this
 * directory — Story 12-11 deliberately does NOT modify `ci.yml`. The dev
 * confirms these tests green locally before merge.
 *
 * Companion Jest tests:
 *   - `src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts`
 *     pins the source-level contract (signature + return-value template +
 *     NEGATIVE no-raw-body-return + per-caller label + console.error log).
 *   - `src/lib/__tests__/upstream-error-sanitization.test.ts` pins the
 *     client-side `isRetryable` compatibility — the new generic message
 *     still triggers retry via HTTP-status substring.
 *
 * The tests below pin the RUNTIME behavior — the function actually:
 *   (a) Returns ONLY a generic message (never upstream content).
 *   (b) Logs the full upstream body to `console.error` with the
 *       `[upstream-error]` prefix + the categorical `upstreamLabel`.
 *   (c) Truncates over-cap bodies at 2000 chars with `... (truncated)` marker.
 *   (d) Falls back to `body=body-read-timeout` if the body read times out.
 */

import {
  assertEquals,
  assertStringIncludes,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseUpstreamError } from "../errors.ts";

/**
 * Capture `console.error` invocations during a test and restore the
 * original after. Returns the captured arg arrays so assertions can
 * inspect the log line shape.
 */
function captureConsoleError(): { logs: unknown[][]; restore: () => void } {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  return {
    logs,
    restore: () => {
      console.error = original;
    },
  };
}

Deno.test("parseUpstreamError: JSON-shaped upstream error returns generic message + logs raw JSON", async () => {
  const upstreamBody = JSON.stringify({
    error: {
      message: "The model gpt-4o is overloaded, please try again",
      type: "server_error",
      code: "overloaded",
    },
  });
  const response = new Response(upstreamBody, { status: 503 });
  const { logs, restore } = captureConsoleError();
  try {
    const result = await parseUpstreamError(response, "openai-chat-or-embedding");
    // Return value is generic — no upstream content.
    assertEquals(result, "Upstream API error (status 503)");
    // Log was emitted exactly once with the categorical prefix + label + status + body.
    assertEquals(logs.length, 1);
    const logLine = String(logs[0][0]);
    assertStringIncludes(logLine, "[upstream-error]");
    assertStringIncludes(logLine, "openai-chat-or-embedding");
    assertStringIncludes(logLine, "status=503");
    assertStringIncludes(logLine, "gpt-4o"); // raw upstream body IS in the log (operator-visible)
  } finally {
    restore();
  }
});

Deno.test("parseUpstreamError: plain-text upstream returns generic + logs text", async () => {
  const response = new Response("Service Unavailable: try again later", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
  const { logs, restore } = captureConsoleError();
  try {
    const result = await parseUpstreamError(response, "azure-tts");
    assertEquals(result, "Upstream API error (status 503)");
    assertEquals(logs.length, 1);
    const logLine = String(logs[0][0]);
    assertStringIncludes(logLine, "[upstream-error]");
    assertStringIncludes(logLine, "azure-tts");
    assertStringIncludes(logLine, "Service Unavailable");
  } finally {
    restore();
  }
});

Deno.test("parseUpstreamError: HTML 5xx page returns generic + logs HTML", async () => {
  const html = "<html><body>500 Internal Server Error<br>nginx/1.18.0 (Ubuntu)</body></html>";
  const response = new Response(html, {
    status: 500,
    headers: { "Content-Type": "text/html" },
  });
  const { logs, restore } = captureConsoleError();
  try {
    const result = await parseUpstreamError(response, "azure-pronunciation");
    assertEquals(result, "Upstream API error (status 500)");
    assertEquals(logs.length, 1);
    const logLine = String(logs[0][0]);
    assertStringIncludes(logLine, "[upstream-error]");
    assertStringIncludes(logLine, "azure-pronunciation");
    assertStringIncludes(logLine, "status=500");
    assertStringIncludes(logLine, "nginx/1.18.0");
  } finally {
    restore();
  }
});

Deno.test("parseUpstreamError: empty body returns generic with status + logs body=", async () => {
  const response = new Response("", { status: 502 });
  const { logs, restore } = captureConsoleError();
  try {
    const result = await parseUpstreamError(response, "openai-whisper");
    assertEquals(result, "Upstream API error (status 502)");
    assertEquals(logs.length, 1);
    const logLine = String(logs[0][0]);
    assertStringIncludes(logLine, "[upstream-error]");
    assertStringIncludes(logLine, "openai-whisper");
    assertStringIncludes(logLine, "status=502");
    assertStringIncludes(logLine, "body=");
  } finally {
    restore();
  }
});

Deno.test("parseUpstreamError: body-read timeout returns generic + logs body=body-read-timeout", async () => {
  // Construct a Response whose `.text()` rejects to simulate a body-read
  // timeout. `withTimeout` catches via `Promise.race` so re-throwing
  // synchronously from a custom `text()` is sufficient — the catch arm in
  // parseUpstreamError fires and emits the `body=body-read-timeout` log.
  // Note: the actual `withTimeout` wrapper rejects via `AbortSignal.timeout`,
  // but our test only needs the catch arm to fire, so a fast rejection works.
  const baseResponse = new Response("ignored", { status: 504 });
  // Wrap .text to reject — Deno's Response is read-only after construction,
  // so create a wrapper object that satisfies the parts of `Response` that
  // parseUpstreamError uses (status + text).
  const wrappedResponse = {
    status: baseResponse.status,
    text: () => Promise.reject(new Error("simulated body-read timeout")),
  } as unknown as Response;
  const { logs, restore } = captureConsoleError();
  try {
    const result = await parseUpstreamError(wrappedResponse, "openai-realtime-token");
    assertEquals(result, "Upstream API error (status 504)");
    assertEquals(logs.length, 1);
    const logLine = String(logs[0][0]);
    assertStringIncludes(logLine, "[upstream-error]");
    assertStringIncludes(logLine, "openai-realtime-token");
    assertStringIncludes(logLine, "status=504");
    assertStringIncludes(logLine, "body=body-read-timeout");
  } finally {
    restore();
  }
});

Deno.test("parseUpstreamError: over-cap body is truncated at 2000 chars with `... (truncated)` marker", async () => {
  // Generate a body larger than MAX_LOGGED_BODY_CHARS (2000).
  const oversizedBody = "X".repeat(3000);
  const response = new Response(oversizedBody, { status: 500 });
  const { logs, restore } = captureConsoleError();
  try {
    const result = await parseUpstreamError(response, "openai-chat-or-embedding");
    assertEquals(result, "Upstream API error (status 500)");
    assertEquals(logs.length, 1);
    const logLine = String(logs[0][0]);
    assertStringIncludes(logLine, "... (truncated)");
    // The full 3000-char body is NOT in the log (would NOT be capped if
    // truncation was broken). Verify the truncated body length is bounded
    // by counting the `X`s — should be <= 2000 plus the trailing marker.
    const bodyMatch = logLine.match(/body=(.*)$/);
    if (bodyMatch) {
      const loggedBody = bodyMatch[1];
      // 2000 chars + "... (truncated)" marker = 2015 chars max.
      const xCount = (loggedBody.match(/X/g) || []).length;
      assertEquals(xCount, 2000);
    }
  } finally {
    restore();
  }
});

Deno.test("parseUpstreamError: return value NEVER contains upstream content (P1-14 closure)", async () => {
  // The canonical leak vectors from pre-12-11: model names + prompt fragments.
  // No matter what the upstream body says, the return value should be the
  // generic message only.
  const leakyBodies = [
    JSON.stringify({
      error: { message: "The model gpt-4o is overloaded", type: "server_error" },
    }),
    JSON.stringify({
      error: {
        message:
          "Your message exceeds the 32768 token limit: 'translate this French to English: Bonjour mes amis...'",
        type: "invalid_request_error",
      },
    }),
    JSON.stringify({ message: "Direct top-level message — Internal API endpoint /v1/secret" }),
    "<html><body>500 Internal Server Error<br>nginx/1.18.0 (Ubuntu) running on internal-host-42.svc.cluster.local</body></html>",
    "AZURE_API_KEY_LEAKED_DEBUG_PAYLOAD_DO_NOT_RETURN_THIS",
  ];

  for (const body of leakyBodies) {
    const response = new Response(body, { status: 500 });
    const { logs, restore } = captureConsoleError();
    try {
      const result = await parseUpstreamError(response, "openai-chat-or-embedding");
      // Return value is exactly the generic message — no upstream content.
      assertEquals(result, "Upstream API error (status 500)");
      // Specifically: no sensitive substrings from the upstream body leak through.
      assertNotMatch(result, /gpt-4o/);
      assertNotMatch(result, /token limit/);
      assertNotMatch(result, /Bonjour/);
      assertNotMatch(result, /nginx/);
      assertNotMatch(result, /AZURE_API_KEY/);
      assertNotMatch(result, /internal-host/);
    } finally {
      restore();
    }
  }
});
