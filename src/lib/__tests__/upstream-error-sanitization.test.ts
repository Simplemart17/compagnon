/**
 * Story 12-11 — client-side `isRetryable` compatibility against the new
 * generic upstream-error message format.
 *
 * Post-12-11 the Edge Function's `parseUpstreamError` returns
 * `"Upstream API error (status N)"` instead of the upstream's raw message.
 * The client-side caller wraps this as `"<UI label> error: Upstream API
 * error (status N)"` (e.g., `"OpenAI error: Upstream API error (status 429)"`).
 *
 * The client-side `isRetryable()` regex at `src/lib/openai.ts:76-94`
 * substring-matches on `"network"` / `"timeout"` / `"fetch"` / `"500"` /
 * `"502"` / `"503"` / `"429"` / `"rate limit"`. The new generic message
 * preserves the HTTP status code as a substring, so retry-on-5xx and
 * retry-on-429 behavior is preserved post-12-11 — verified by the 6 cases
 * below.
 *
 * The cases assert the pre-12-11 vs post-12-11 retry decision is identical
 * for the same HTTP status code: 429/500/502/503 → retry true; 400/401 →
 * retry false.
 */

import { isRetryable } from "../openai";

describe("Story 12-11: isRetryable compatibility against generic upstream message", () => {
  it("Case 1: 429 (rate limit) — generic message triggers retry via `429` substring", () => {
    const err = new Error("OpenAI error: Upstream API error (status 429)");
    expect(isRetryable(err)).toBe(true);
  });

  it("Case 2: 500 (server error) — retry true", () => {
    const err = new Error("OpenAI error: Upstream API error (status 500)");
    expect(isRetryable(err)).toBe(true);
  });

  it("Case 3: 502 (bad gateway) — retry true", () => {
    const err = new Error("Azure TTS error: Upstream API error (status 502)");
    expect(isRetryable(err)).toBe(true);
  });

  it("Case 4: 503 (service unavailable) — retry true", () => {
    const err = new Error("OpenAI Whisper error: Upstream API error (status 503)");
    expect(isRetryable(err)).toBe(true);
  });

  it("Case 5: 400 (bad request) — retry false (no 4xx-other status triggers retry)", () => {
    // 400 / 401 / 403 / 404 are NOT in the isRetryable substring set —
    // they're permanent client errors, not transient. The new generic
    // message preserves this behavior.
    const err = new Error("OpenAI error: Upstream API error (status 400)");
    expect(isRetryable(err)).toBe(false);
  });

  it("Case 6: 401 (unauthorized) — retry false", () => {
    const err = new Error("OpenAI Realtime error: Upstream API error (status 401)");
    expect(isRetryable(err)).toBe(false);
  });
});
