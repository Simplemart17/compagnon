/**
 * Story 11-3 — fetchWithTimeout integration tests (Deno-runnable).
 *
 * RUN MANUALLY: `deno test --allow-net=127.0.0.1 supabase/functions/_shared/__tests__/`
 *
 * Epic 15.3 (`15-3-edge-function-deno-tests`) owns CI integration for this
 * directory — Story 11-3 deliberately does NOT modify `ci.yml`. The dev
 * confirms these tests green locally before merge.
 *
 * Companion Jest tests at `src/lib/__tests__/upstream-timeout-error.test.ts`
 * pin the pure-helper contract (error shape, type-guard, constant tiers).
 * The tests below pin the full `fetch + AbortSignal.timeout` integration
 * behavior — a hung upstream actually triggers `UpstreamTimeoutError` within
 * the configured budget, and a fast upstream returns the `Response` intact.
 */

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  ERROR_BODY_READ_TIMEOUT_MS,
  FetchWithTimeoutMisuseError,
  fetchWithTimeout,
  isUpstreamTimeoutError,
  UpstreamTimeoutError,
  WHISPER_UPSTREAM_TIMEOUT_MS,
  withTimeout,
} from "../fetch-with-timeout.ts";

Deno.test("fetchWithTimeout: rejects with UpstreamTimeoutError when upstream hangs past budget", async () => {
  // A TCP listener that does NOT accept connections leaves the kernel-level
  // accept queue holding the connection — fetch will succeed at TCP SYN/ACK
  // (because the kernel handles the handshake) and then block forever waiting
  // for HTTP response bytes. AbortSignal.timeout(50) fires the abort within
  // budget and our helper rethrows as UpstreamTimeoutError.
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  try {
    const err = await assertRejects(
      () => fetchWithTimeout("test-upstream", `http://127.0.0.1:${port}/`, undefined, 50),
      UpstreamTimeoutError,
      "did not respond within 50ms"
    );
    assertEquals(err.upstream, "test-upstream");
    assertEquals(err.timeoutMs, 50);
    assertEquals(err.name, "UpstreamTimeoutError");
    // The cause is the underlying DOMException("TimeoutError").
    const cause = (err as Error & { cause?: unknown }).cause;
    assertInstanceOf(cause, DOMException);
  } finally {
    listener.close();
  }
});

Deno.test("fetchWithTimeout: returns Response intact when upstream completes within budget", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen: () => {} },
    () => new Response("ok", { status: 200 })
  );
  try {
    const port = (server.addr as Deno.NetAddr).port;
    const res = await fetchWithTimeout(
      "test-upstream",
      `http://127.0.0.1:${port}/`,
      undefined,
      5_000
    );
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("fetchWithTimeout: rejects caller-supplied signal with FetchWithTimeoutMisuseError (P7 review patch)", async () => {
  // The v1 helper deliberately rejects caller-supplied signals; combining
  // signals is out of scope. A future story can adopt AbortSignal.any([...]).
  // The error is a typed FetchWithTimeoutMisuseError (not bare Error) so the
  // outer catch path can discriminate via `instanceof` or `code`.
  const err = await assertRejects(
    () =>
      fetchWithTimeout("test-upstream", "https://example.com", {
        signal: new AbortController().signal,
      }),
    FetchWithTimeoutMisuseError,
    "caller-supplied signal not supported"
  );
  assertEquals(err.code, "FETCH_WITH_TIMEOUT_MISUSE");
  assertEquals(err.name, "FetchWithTimeoutMisuseError");
});

Deno.test("fetchWithTimeout: error message contains literal 'timeout' substring for client-retry contract", async () => {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  try {
    const err = await assertRejects(
      () => fetchWithTimeout("openai-chat", `http://127.0.0.1:${port}/`, undefined, 50),
      UpstreamTimeoutError
    );
    // Load-bearing assertion: the client at src/lib/openai.ts:23-37 uses
    // `msg.includes("timeout")` to decide retry eligibility. If the message
    // format ever drops "timeout", the client retry path silently breaks.
    assertStringIncludes(err.message.toLowerCase(), "timeout");
    assertEquals(isUpstreamTimeoutError(err), true);
  } finally {
    listener.close();
  }
});

Deno.test("Constants are tiered: default 30s, Whisper 90s (bumped from 60s per D2 review patch), error-body 5s", () => {
  assertEquals(DEFAULT_UPSTREAM_TIMEOUT_MS, 30_000);
  // Whisper bumped to 90s to cover the Story 9-8 speaking-task pipeline
  // (32 kbit AAC, up to 5.5 min audio = ~30s p99 server-side with model-
  // load tail spikes observed up to ~60s).
  assertEquals(WHISPER_UPSTREAM_TIMEOUT_MS, 90_000);
  // Error-response body reads should be tiny; cap at 5s.
  assertEquals(ERROR_BODY_READ_TIMEOUT_MS, 5_000);
});

Deno.test("withTimeout: rejects with UpstreamTimeoutError when promise exceeds budget (P1 body-read coverage)", async () => {
  // Story 11-3 review patch P1: bound body consumption in addition to
  // request-and-headers. This test pins that withTimeout produces the
  // same UpstreamTimeoutError shape as fetchWithTimeout on timeout.
  const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));
  const err = await assertRejects(
    () => withTimeout("body-read-test", slowPromise, 50),
    UpstreamTimeoutError,
    "did not respond within 50ms"
  );
  assertEquals(err.upstream, "body-read-test");
  assertEquals(err.timeoutMs, 50);
});

Deno.test("withTimeout: resolves with the promise value when it completes within budget", async () => {
  const fastPromise = Promise.resolve("ok");
  const result = await withTimeout("body-read-test", fastPromise, 1_000);
  assertEquals(result, "ok");
});
