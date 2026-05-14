# Operator Runbook — Upstream Error Debugging (Story 12-11)

**Last reviewed:** 2026-05-14
**Story:** [12-11-edge-function-error-sanitization](../implementation-artifacts/12-11-edge-function-error-sanitization.md)
**Closes audit finding:** P1-14 (`shippable-roadmap.md` line 66)

This runbook explains the post-12-11 Edge Function upstream-error contract: clients see generic categorized messages; operators see the full upstream body via Supabase function logs.

---

## 1. Post-12-11 contract

**Clients see** (via the Edge Function HTTP response body):

```json
{
  "error": "Azure TTS error: Upstream API error (status 503)",
  "code": "UPSTREAM_ERROR"
}
```

The `error` field is ALWAYS a generic message of shape `"<UI label> error: Upstream API error (status N)"`. The `<UI label>` (e.g., `"Azure TTS error"`) is a server-controlled categorical string that gives the user feedback about which subsystem failed without revealing implementation details. The HTTP status code `N` is preserved so the client-side `isRetryable()` regex at [`src/lib/openai.ts:76-94`](src/lib/openai.ts#L76-L94) can decide whether to retry based on the status (`429` / `500` / `502` / `503` → retry; `400` / `401` / `403` → don't retry).

**Operators see** (via Supabase function logs):

```
[upstream-error] openai-chat-or-embedding status=503 body={"error":{"message":"The model gpt-4o is overloaded, please try gpt-4-turbo","type":"server_error","code":"overloaded"}}
```

The `console.error` line carries the FULL upstream body (truncated at 2000 chars) prefixed with `[upstream-error]` for easy grep, the categorical `upstreamLabel` for filtering, the HTTP status, and the raw body. This channel is **operator-only** — Supabase function logs are accessible only via the Supabase Dashboard + CLI, never through the network response.

**Pre-12-11 (the bug this story closes):** the `error` field of the client-visible response carried the upstream's `error.message` verbatim — leaking model names (`"The model gpt-4o is overloaded"`), prompt fragments (`"Your message exceeds token limit: 'translate French...'"`), and server fingerprints (HTML 5xx pages with `nginx/1.18.0` etc.).

---

## 2. Log retrieval recipes

### Via Supabase CLI

```bash
# Tail the latest 200 lines from a specific function, grep for upstream errors:
supabase functions logs ai-proxy --tail=200 | grep '\[upstream-error\]'
supabase functions logs realtime-session --tail=200 | grep '\[upstream-error\]'
supabase functions logs pronunciation-assess --tail=200 | grep '\[upstream-error\]'

# Filter by upstream label (post-grep):
supabase functions logs ai-proxy --tail=500 | grep '\[upstream-error\] openai-whisper'

# Filter by HTTP status:
supabase functions logs ai-proxy --tail=500 | grep '\[upstream-error\].*status=429'
```

### Via Supabase Dashboard

1. Navigate to `https://supabase.com/dashboard/project/{PROJECT_REF}/functions`.
2. Click the function name (`ai-proxy`, `pronunciation-assess`, or `realtime-session`).
3. Click the **"Logs"** tab.
4. Filter by time range (e.g., `Last 1 hour`).
5. Search for `[upstream-error]` to surface only the upstream-error events.

### Sample log line format

```
[upstream-error] <upstreamLabel> status=<N> body=<truncated-body>
```

Examples:

```
[upstream-error] openai-chat-or-embedding status=429 body={"error":{"message":"Rate limit reached for ...","type":"rate_limit_error","code":"rate_limit_exceeded"}}
[upstream-error] openai-whisper status=413 body={"error":{"message":"File too large","type":"invalid_request_error"}}
[upstream-error] azure-tts status=503 body=<html><body>503 Service Unavailable<br>nginx/1.18.0</body></html>... (truncated)
[upstream-error] azure-pronunciation status=500 body=body-read-timeout
[upstream-error] openai-realtime-token status=401 body={"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}
```

---

## 3. Categorical `upstreamLabel` allowlist

The 5 current labels (Story 12-11 baseline). Future Edge Function additions should use new kebab-case lowercase ASCII labels in the same convention:

| Label | Edge Function | Call site | Upstream service |
| --- | --- | --- | --- |
| `azure-tts` | `ai-proxy` | text-to-speech action | Azure Cognitive Services Speech (TTS) |
| `openai-whisper` | `ai-proxy` | transcribe action | OpenAI Whisper API |
| `openai-chat-or-embedding` | `ai-proxy` | chat + embedding (catch-all) | OpenAI Chat Completions + Embeddings |
| `azure-pronunciation` | `pronunciation-assess` | assessment | Azure Cognitive Services Speech (Pronunciation Assessment) |
| `openai-realtime-token` | `realtime-session` | session token issuance | OpenAI Realtime API (token endpoint) |

**Label naming convention:**

- ASCII only.
- Kebab-case lowercase (`a-z`, `0-9`, `-`).
- Short and categorical — never include user-derived content.
- Specific enough that an operator filtering by label sees only one upstream's failures.

**Adding a new label:** when a new Edge Function call site needs `parseUpstreamError`, pick a label that follows the convention + update the [Story 12-11 source-drift test](../../implementation-artifacts/12-11-edge-function-error-sanitization.md) to extend the per-file caller count.

---

## 4. Cross-story dependencies + drift detector contract

**Cross-story invariants:**

- **Story 9-3** (Sentry telemetry contract): the `code: "UPSTREAM_ERROR"` field of the response body is the categorical signal the client-side `captureError(err, "feature-tag")` records via the allowlisted `feature` extras key. The pre-12-11 leak was on the response body's `error` field — that's the surface this story shuts off.
- **Story 11-3** (Edge Function upstream timeouts): the `withTimeout("error-body-read", ..., ERROR_BODY_READ_TIMEOUT_MS)` flow is preserved byte-for-byte; only the body-handling logic after the read changed.
- **Story 11-8** (`isRetryable` retry parity): the HTTP status code is preserved in the generic message via the `"status N"` substring, so the client-side retry regex still matches (`"429"` / `"500"` / `"502"` / `"503"`) and triggers the standard 2-retry / `RETRY_DELAYS = [1000, 2000]ms` flow.

**Drift detector contract:**

The Jest drift detector at [`src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts`](../../../src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts) reads `supabase/functions/_shared/errors.ts` AND the 3 Edge Function files from disk + asserts:

- `parseUpstreamError` signature contains the `upstreamLabel: string` parameter.
- Return-value template `"Upstream API error (status "` is present (positive guard).
- NEGATIVE: no `return rawText` / `return parsed.message` / pre-12-11 leak patterns.
- Each of the 5 caller sites passes a non-empty kebab-case label as 2nd arg.
- `console.error("[upstream-error]"...)` log call is present.
- Per-file caller count matches: `ai-proxy/index.ts` has 3 calls, `pronunciation-assess/index.ts` has 1, `realtime-session/index.ts` has 1.

A future refactor that re-introduces the leak (e.g., `return parsed.error.message`) or removes the operator log line fails CI loudly.

---

## 5. Operator decision log

Fill in after each significant upstream-error triage event:

| Date | Operator | Action |
| --- | --- | --- |
| 2026-05-14 | Simplemart | Initial runbook landed via Story 12-11. Edge Function refactor deployed. Audit P1-14 closed. |
| YYYY-MM-DD | _operator_ | _upstream-error spike investigation notes_ |
| YYYY-MM-DD | _operator_ | _new upstream label added — context + rationale_ |
| YYYY-MM-DD | _operator_ | _retry-threshold adjustment / rollback notes_ |
