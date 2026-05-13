# Story 11.8: Empty-Response Detection for Non-JSON Chat Completions + Retry Parity Across All 4 AI Helpers

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose `src/lib/openai.ts` AI helpers currently expose **three asymmetric retry budgets** + **two asymmetric empty-response detection surfaces** that produce inconsistent reliability behavior depending on which helper a feature happens to use — specifically (a) `chatCompletion` at [`src/lib/openai.ts:56-123`](src/lib/openai.ts) has `MAX_RETRIES = 2` (3 total attempts) with `RETRY_DELAYS = [1000, 2000]` ms exponential schedule + an **empty-response check that ONLY fires when `responseFormat === "json_object"`** at line 105-107 (`if (!content && options?.responseFormat === "json_object") throw new Error("Empty AI response")`); the bare `chatCompletion` default of `responseFormat: "text"` means a text-mode call returning `""` or `null` from `data?.choices?.[0]?.message?.content ?? ""` silently returns the empty string to the caller — and the only such call sites in production are `chatCompletion`'s internal callers via `chatCompletionJSON` (which always sets json_object) PLUS any future caller that uses the bare text mode (none today but the API surface is exposed); the empty-response error message `"Empty AI response"` does NOT match the existing `isRetryable` regex at line 23-37 (`network|timeout|fetch|500|502|503|429|rate limit`) so even when it fires it's **NOT retried** — a one-shot upstream stutter that returns no content burns a user-visible failure instead of a 1-second retry, (b) `generateSpeech` at [`openai.ts:273-325`](src/lib/openai.ts) has `maxRetries = 1` (2 total attempts) with a **fixed `sleep(1000)`** between retries (NOT the exponential schedule) + **NO empty-response check at all** — a TTS call returning an empty audio blob converts to empty base64 + propagates downstream where the audio player silently fails (`new Sound(audioBase64=""`) → silent failure or React Native crash depending on platform), and a TTS upstream burp at OpenAI's side counts as a hard failure instead of the operator-expected "1 retry with backoff" — the spec roadmap at line 188 specifically calls out **"retry parity (TTS = 2 retries)"** indicating the operator's expectation is parity with `chatCompletion`'s `MAX_RETRIES = 2`, (c) `transcribeAudio` (Whisper) at [`openai.ts:328-369`](src/lib/openai.ts) has `maxRetries = 1` + a fixed `sleep(1000)` + DOES have an empty check (`if (!text || typeof text !== "string") throw new Error("Empty transcription response")` at line 351-353) but the error message doesn't match `isRetryable` so the empty branch is non-retried, (d) `generateEmbedding` at [`openai.ts:372-403`](src/lib/openai.ts) has `maxRetries = 1` + fixed `sleep(1000)` + the WORST empty-handling: returns `data?.data?.[0]?.embedding ?? []` (line 390) — a **silent empty-array return** that fails downstream at the consumer; Story 11-6 added `isValidEmbedding` at `error-tracker.ts` as a consumer-side guard, but `persistMemories` at `src/lib/memory.ts:253-258` rejects an empty-array embedding only via `Promise.allSettled`'s implicit `embeddingResult.status === "rejected"` check — which a silent `[]` return SKIPS because `Promise.allSettled` resolves successfully with `value: []`, so empty embeddings either insert garbage rows OR pass through `JSON.stringify([])` to `pgvector` which would reject the cast (Postgres `VECTOR(1536)` rejects empty input) → noisy `companion_memory` write failures days after the silent empty-embedding return; per audit deliverable **Epic 11.8** ([`_bmad-output/planning-artifacts/shippable-roadmap.md` line 188](_bmad-output/planning-artifacts/shippable-roadmap.md)) "Empty-response detection for non-JSON chat completions; retry parity (TTS = 2 retries). **Covers P2-x ai-integration findings.**" + the catch-all "P2-x ai-integration findings" tag covering scattered ai-tagged audit rows that align with this helper surface,

I want (a) `chatCompletion`'s empty-response check at [`openai.ts:105-107`](src/lib/openai.ts) **extended from the json_object-only gate to ALL response formats** — a missing or empty `content` from `data?.choices?.[0]?.message?.content` is an upstream defect regardless of whether the caller expected JSON or text, and silently returning `""` to a text-mode caller is the same class of bug as silently returning `""` to a JSON-mode caller; new check: `if (!content || (typeof content === "string" && content.trim().length === 0)) throw new Error("Empty AI response")` — covers null / undefined / empty string / whitespace-only; the existing JSON-mode caller (`chatCompletionJSON`) already handles the throw via its catch path so behavior is preserved by construction, (b) the empty-response error messages **become retryable** by extending `isRetryable` at [`openai.ts:23-37`](src/lib/openai.ts) to also match the substring `"empty"` (lowercased) — the existing regex matches via `msg.toLowerCase().includes(...)` so an `"Empty AI response"` / `"Empty transcription response"` / `"Empty embedding response"` error message now matches the retry predicate; a one-shot upstream stutter becomes a 1-second-backoff retry instead of a user-visible failure, (c) `generateSpeech` retry count bumps from `maxRetries = 1` → **`maxRetries = 2`** matching `chatCompletion`'s `MAX_RETRIES = 2`; the spec calls out "TTS = 2 retries" explicitly, (d) `generateSpeech` retry delays adopt the **shared `RETRY_DELAYS = [1000, 2000]` schedule** (per-attempt exponential) instead of the current fixed `sleep(1000)` — operator-consistent backoff across all helpers, (e) `generateSpeech` gains an **empty-response check**: after the `data instanceof Blob` arrayBuffer conversion, `if (bytes.length === 0) throw new Error("Empty TTS response")` — same retryable contract; an empty audio blob (rare but possible on Azure 200-but-no-body) is now retried, (f) `transcribeAudio` retry count bumps from `maxRetries = 1` → **`maxRetries = 2`** for parity (spec's "retry parity" extends to Whisper by symmetry even though it names only TTS explicitly — operator-decision rationale documented), (g) `transcribeAudio` retry delays adopt the shared `RETRY_DELAYS` schedule, (h) `generateEmbedding` retry count bumps from `maxRetries = 1` → **`maxRetries = 2`** for parity, (i) `generateEmbedding` retry delays adopt the shared `RETRY_DELAYS` schedule, (j) `generateEmbedding` empty-response handling **changes from silent `[]` return to throwing** `"Empty embedding response"` — same retryable contract; the consumer-side `isValidEmbedding` from Story 11-6 stays in place as defense-in-depth + log signal, but the boundary now throws on the empty path so the retry loop has a chance to recover, (k) the four helpers' retry budgets are **promoted to one shared exported constant** `MAX_RETRIES = 2` (replacing the local `const maxRetries = 1` in TTS / Whisper / embeddings) + `RETRY_DELAYS` stays as the shared schedule already used by `chatCompletion` — one source of truth so a future operator change to retry behavior propagates atomically across all 4 helpers (Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 "delete don't alias" pattern as applied to constants — replace 4 local literals with 1 module-level export), (l) Story 11-3 `fetchWithTimeout` + `UpstreamTimeoutError` at the Edge Function side is unchanged — 11-8 operates on the CLIENT-SIDE retry loop above the `supabase.functions.invoke` boundary; the 30s / 90s upstream timeouts at `ai-proxy` still apply per call attempt, so the worst-case end-to-end latency for a chat call is now `(30s × 3 attempts) + (1s + 2s backoff) = 93s` (was `(30s × 3) + (1s + 2s) = 93s` — identical; the retry budget is unchanged for chat) + the worst-case for TTS is now `(30s × 3) + (1s + 2s) = 93s` (was `(30s × 2) + 1s = 61s` for TTS — bumped by ~32s for the additional retry attempt; acceptable trade-off for the reliability win), (m) **Story 11-4 daily-cost-cap pre-check is unchanged** — pre-flight estimates the cost of ONE attempt; retried attempts each re-run the pre-check + accumulate against the daily cap; an empty-response retry costs the same as the original call (model is identical) so a user retrying 2× pays 2× per failed call — acceptable + matches the existing chat retry behavior, (n) tests cover: the extended empty-response check in `chatCompletion` (text mode + JSON mode both throw on empty), the `isRetryable` regex now matching "empty" (string contains check), all 4 helpers' `maxRetries === MAX_RETRIES === 2`, all 4 helpers' retry delays consume `RETRY_DELAYS[attempt]`, the new `generateSpeech` empty-blob check fires on `bytes.length === 0`, the new `generateEmbedding` throw path fires when `data?.data?.[0]?.embedding` is falsy / non-array / empty, and the consumer-boundary regression that Story 11-6's `isValidEmbedding` still catches a downstream malformed embedding (defense-in-depth preserved),

so that **roadmap deliverable 11.8 closes architecturally**; the four AI helpers in `openai.ts` have **identical retry budgets** (`MAX_RETRIES = 2`, exponential `[1000, 2000]` ms schedule) so operator reasoning is symmetric ("any upstream stutter → 2 retries with backoff → fail loudly"); empty-response handling is consistent across all 4 helpers (throw + retryable error message + retry loop catches it); the silent-empty-embedding pathology that produced delayed `companion_memory` write failures is closed at the boundary instead of relying on downstream consumer guards; a real-world upstream-stutter (rare 200-with-empty-body responses observed at OpenAI / Azure occasionally) becomes a 3-attempt-with-backoff recovery instead of a user-visible failure; the verified-correct surfaces NOT touched are Story 9-3 Sentry telemetry allowlist (no new `feature` tags — `isRetryable` extension is internal; if a final throw fires after exhausting retries, it routes through the existing `captureError` paths in `chatCompletionJSON` / `persistMemories` / `persistErrorPatterns` consumers), Story 9-4 stored-prompt-injection defense (orthogonal — retry semantics don't affect content sanitization), Story 9-5 voice transcript dedup (orthogonal — Realtime WebSocket path doesn't use these helpers), Story 9-6 auth listener / 9-7 Zod schema retry contract (`chatCompletionJSON`'s parseRetries layer is ABOVE the chatCompletion retry loop; parse-retries still default to 1, separate from the network-retries that this story bumps), Story 9-8 / 10-6 speaking pipeline (consumes `chatCompletionJSON` + `transcribeAudio` — both inherit the new retry budget transparently; behavior change: a TTS / Whisper upstream stutter mid-speaking-task is now recovered instead of failing the task), Story 9-9 deploy substrate (orthogonal), Story 9-10 auth + cache race (orthogonal), Story 10-2 / 10-3 / 10-4 / 10-5 / 10-7 / 10-8 (orthogonal — prompts + scoring + dedup), Story 11-1 correction tool-call protocol (Realtime path; unaffected — Realtime WebSocket doesn't route through `chatCompletion`), Story 11-2 reconnect + barge-in (Realtime path; unaffected; Story 11-3 wraps the `realtime-session` Edge Function fetch which is server-side timeout, unchanged), Story 11-3 Edge Function upstream timeouts (`fetchWithTimeout` is downstream of the client retry; per-attempt timeout unchanged; the only worst-case-latency change is the additional attempt for TTS / Whisper / embedding), Story 11-4 Postgres-backed rate-limit + daily cost cap (pre-flight runs per attempt; retried attempts re-charge cost — same as pre-11-8 for chat; new for TTS / Whisper / embedding but acceptable per the reliability vs cost trade-off), Story 11-5 cost discipline pass (per-call maxTokens right-sizing + 3→1 post-conv consolidation + gpt-realtime-mini all unchanged), Story 11-6 embedding-based dedupe + `isValidEmbedding` (defense-in-depth — Story 11-6 catches malformed embeddings at the `trackError` consumer; Story 11-8 catches them at the `generateEmbedding` boundary; both stay, layered), and Story 11-7 prompt truncation (orthogonal — `truncateToBytes` operates on already-fetched memories + error patterns; helper retry semantics don't affect the truncation boundary).

## Background — Why This Story Exists

### What roadmap deliverable 11.8 owns to this story

[`shippable-roadmap.md` line 188](_bmad-output/planning-artifacts/shippable-roadmap.md): "Empty-response detection for non-JSON chat completions; retry parity (TTS = 2 retries). **Covers P2-x ai-integration findings.**"

The "P2-x ai-integration findings" catch-all refers to scattered ai-tagged audit rows that touch the `openai.ts` helper surface — not a single P2 row. The Epic 11 closing story bundles the cleanup into one pass.

### Current state — 4 helpers, 3 retry budgets, 2 empty-check surfaces

| Helper             | Location                         | maxRetries | Delays           | Empty-response check                | Empty err retryable? |
| ------------------ | -------------------------------- | ---------- | ---------------- | ----------------------------------- | -------------------- |
| `chatCompletion`   | `openai.ts:56-123`               | **2**      | `[1000, 2000]`   | ONLY if `responseFormat === "json_object"` | NO (no "empty" in regex) |
| `generateSpeech`   | `openai.ts:273-325`              | **1**      | fixed 1000       | **NONE**                            | N/A                  |
| `transcribeAudio`  | `openai.ts:328-369`              | **1**      | fixed 1000       | YES (any empty/non-string text)     | NO                   |
| `generateEmbedding`| `openai.ts:372-403`              | **1**      | fixed 1000       | **SILENT** — returns `[]` on missing data | N/A                  |

Post-11-8: all 4 rows align (`maxRetries = MAX_RETRIES = 2`, `[1000, 2000]` schedule, explicit empty check + throw, throw is retryable).

### Current state — `isRetryable` regex

[`openai.ts:23-37`](src/lib/openai.ts):

```typescript
function isRetryable(error: unknown): boolean {
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
      msg.includes("rate limit")
    );
  }
  return false;
}
```

A single new branch — `msg.includes("empty")` — makes ALL of `"Empty AI response"`, `"Empty transcription response"`, `"Empty TTS response"`, `"Empty embedding response"` retryable. Story 11-3's `"Upstream timeout: ..."` message format from `_shared/errors.ts` is already covered via the `"timeout"` substring; Story 11-4's `"rate limit exhausted"` is covered via `"rate limit"`. No cross-story regression risk.

### Current state — `chatCompletion` empty check

[`openai.ts:104-107`](src/lib/openai.ts):

```typescript
const content = data?.choices?.[0]?.message?.content ?? "";
if (!content && options?.responseFormat === "json_object") {
  throw new Error("Empty AI response");
}
return content;
```

The check is **gated on JSON mode**. For text mode (the default), `content = ""` silently returns the empty string. Two callers today reach text mode:

1. `chatCompletionJSON` at line 198 — always sets `responseFormat: "json_object"`, so the existing branch covers it.
2. No other callers in production today — `chatCompletion` is exposed but nothing imports it directly for text mode. Future callers (e.g., a streaming feature) would bypass the empty check.

Defense-in-depth: extend the check to all modes. Adds one line of safety; zero behavior change for current callers.

### Current state — `generateEmbedding` silent empty

[`openai.ts:389-390`](src/lib/openai.ts):

```typescript
return data?.data?.[0]?.embedding ?? [];
```

A missing / undefined `data.data[0].embedding` returns an empty array `[]` — no throw, no retry, silent failure. Story 11-6's `isValidEmbedding` at `error-tracker.ts:43-52` catches this at the `trackError` consumer + falls back to string-equality dedup. But `persistMemories` at `memory.ts:253-258` passes the empty array to `JSON.stringify([])` → empty-string-into-`VECTOR(1536)` → Postgres REJECTS the cast → noisy delayed write failure.

Post-11-8: the boundary throws `"Empty embedding response"` → retry loop catches it (via the new `isRetryable` "empty" branch) → on exhaustion the error surfaces to the caller, which is already wrapped in `Promise.allSettled` at `memory.ts:254` so the empty fact is dropped without polluting `companion_memory`. Clean failure mode.

### Threat / failure model — what cannot happen post-story

After this story:

1. **All 4 AI helpers retry transient upstream stutters consistently.** A 200-with-empty-body response from OpenAI / Azure is no longer a user-visible failure; the client retries up to 2× with `[1000, 2000]` ms backoff before propagating.

2. **`generateEmbedding` no longer silently emits empty arrays.** The Postgres VECTOR cast rejection (a delayed surface noise) is replaced by an early throw at the boundary; Story 11-6's `isValidEmbedding` stays as defense-in-depth.

3. **`isRetryable` extension is additive only.** The existing regex matches network / timeout / fetch / 5xx / 429 / rate-limit. Adding "empty" doesn't widen the retry surface to unrelated errors — operator-emitted error messages don't typically contain the substring "empty" outside this context (verified by grep: zero non-test matches in `src/` for `Error("Empty"` outside `openai.ts`).

4. **Story 9-7 `chatCompletionJSON` `parseRetries` contract is unchanged.** Parse-retries are a SEPARATE layer (above `chatCompletion`); the new network-retry behavior is invisible to parse-retry semantics. A schema parse failure on attempt 1 → retry the WHOLE chain (which may itself burn 2 network retries on each pass) — same as pre-11-8 except the network retry budget is now consistent across the underlying helpers.

5. **Story 11-3 client-side retry stacks cleanly.** `chatCompletion` wraps `supabase.functions.invoke("ai-proxy", ...)`; each invocation goes through `ai-proxy` which itself uses `fetchWithTimeout` (Story 11-3). Per-attempt worst case: 30s timeout. 3 attempts → 90s worst case + 3s backoff = 93s. Acceptable.

6. **Story 11-4 daily-cost-cap pre-check fires per attempt.** A user mid-cap-exhaustion who hits an empty-response error retries 2×; if each retry passes the pre-check, the user spends 3× the cost. This matches the pre-11-8 chat retry behavior; new for TTS / Whisper / embedding but the per-call cost is tiny (~$0.000006 for embeddings, ~$0.001 for TTS at 200 chars). Operator-acceptable per the reliability win.

7. **Story 11-6 `isValidEmbedding` consumer guard is unchanged.** Two boundaries protect the embedding pipeline: (a) `generateEmbedding` boundary throws on empty (new), (b) `trackError` / `persistMemories` consumer-side guard via `isValidEmbedding` (Story 11-6). Defense-in-depth.

8. **No new Sentry tags.** Truncation / retry semantics are pure transformation + control flow; no error-recoverable boundary that doesn't already route through an existing `captureError(_, "feature")` site.

9. **`MAX_RETRIES = 2` shared constant** consolidates 4 local definitions into one. A future operator change (e.g., bump to 3 retries) propagates atomically. Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 "delete don't alias" pattern as applied to numeric constants.

10. **Tests pin the parity contract.** A future regression that re-localizes `maxRetries = 1` in one of the 3 affected helpers fails a parity-pin test reading the source from disk (Story 11-3 / 11-4 / 11-6 / 11-7 drift-detector pattern).

### Out of scope for this story (delegated elsewhere)

- **Streaming response support** for `chatCompletion`. The empty-check is for the final assembled `content` field; if a future story adds streaming, the empty-check semantics shift (partial chunks aren't "empty"). Out of scope.
- **Exponential vs linear backoff schedule.** Spec uses the existing `[1000, 2000]` schedule. A tuning story can experiment later.
- **Per-helper retry budget tuning.** `MAX_RETRIES = 2` is the spec value; if operator-side telemetry shows embeddings benefit from 3 retries but TTS from 2, a future story can de-share the constant. v1 ships parity.
- **`isRetryable` allowlist refactor.** The regex grows with each story; a future story could refactor to a typed error-class hierarchy. Out of scope.
- **Edge Function-side empty-response detection.** `ai-proxy` already returns OpenAI/Azure errors verbatim (Story 11-3 preserves the upstream error shape). Adding a Deno-side empty-check would duplicate logic; the client-side check is the canonical boundary.
- **Idempotency keys for retried calls.** OpenAI doesn't require them for chat / embedding / Whisper / TTS (each call is independent); a 2× retry costs 2× per attempt but doesn't double-charge per call. Out of scope.
- **Replacing `data?.choices?.[0]?.message?.content ?? ""` with Zod validation of the OpenAI response envelope.** Story 9-7's schema validation operates on the AI's output content (after parsing), not the envelope. A future story could schemtize the envelope, but the empty check is sufficient for the spec.
- **`requireNetwork()` at the boundary.** Pre-11-8, `chatCompletion` calls `requireNetwork()` at line 70; the other 3 helpers each call it at the top. No change.
- **Pre-existing `chatCompletionJSON.parseRetries`** semantics (Story 9-7). Layered above `chatCompletion`'s network retry; parse-retries default 1, network-retries default 2. Both stay.

## Acceptance Criteria

### 1. Promote `MAX_RETRIES` + `RETRY_DELAYS` to shared module-level constants

- [x] **VERIFY (no change)** [`src/lib/openai.ts:19-20`](src/lib/openai.ts) already exports `MAX_RETRIES = 2` and `RETRY_DELAYS = [1000, 2000]` at module scope (they're module-private const but used by `chatCompletion`). Promote both to **exported** so they can be imported by tests for parity assertions:

  ```typescript
  /**
   * Network-retry budget shared across all 4 AI helpers (Story 11-8 / Epic 11.8).
   * Each helper's transient-error retry loop runs at most `MAX_RETRIES`
   * additional attempts (so 3 total attempts including the original call).
   * Story 11-7 / 11-3 retry budgets stack with this client-side loop:
   * per-attempt server-side timeout (Story 11-3) × MAX_RETRIES + sum of
   * backoff delays = worst-case end-to-end latency.
   */
  export const MAX_RETRIES = 2;

  /**
   * Per-attempt backoff delays in ms, indexed by attempt count (0-indexed).
   * Story 11-8: all 4 helpers consume the same schedule for operator
   * symmetry. Pre-11-8 TTS / Whisper / embedding used a fixed `sleep(1000)`.
   */
  export const RETRY_DELAYS: readonly number[] = [1000, 2000];
  ```

**Given** a `grep -rn "MAX_RETRIES\|RETRY_DELAYS" src/ app/`
**When** the audit runs post-11-8
**Then** all 4 helpers reference the module-level constants (zero local-literal `maxRetries = 1` / `sleep(1000)` remaining outside `chatCompletion`).

### 2. Extend `chatCompletion` empty-response check to all response formats

- [x] **UPDATE** [`openai.ts:104-107`](src/lib/openai.ts):

  Pre-11-8:

  ```typescript
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content && options?.responseFormat === "json_object") {
    throw new Error("Empty AI response");
  }
  return content;
  ```

  Post-11-8:

  ```typescript
  const content = data?.choices?.[0]?.message?.content ?? "";
  // Story 11-8: empty-response check applies to ALL response formats.
  // Silently returning "" to a text-mode caller is the same defect class
  // as silently returning "" to a JSON-mode caller. `.trim()` catches
  // whitespace-only responses too.
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Empty AI response");
  }
  return content;
  ```

**Given** `chatCompletion` is called in text mode + the upstream returns `data.choices[0].message.content = ""`
**When** the helper processes the response
**Then** it throws `"Empty AI response"` (which is now retryable per AC #3 → retry loop catches it) instead of silently returning `""`.

**Given** `chatCompletion` is called in text mode + the upstream returns `data.choices[0].message.content = "   "` (whitespace only)
**When** the helper processes the response
**Then** it throws `"Empty AI response"` (same retryable path).

**Given** `chatCompletion` is called in JSON mode + the upstream returns valid JSON content
**When** the helper processes the response
**Then** no throw — preserved pre-11-8 happy path.

### 3. Make empty-response errors retryable

- [x] **UPDATE** [`openai.ts:23-37`](src/lib/openai.ts) `isRetryable`:

  Add a new branch matching the substring `"empty"`:

  ```typescript
  function isRetryable(error: unknown): boolean {
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
        // Story 11-8: empty-response upstream stutters are retryable.
        // Matches "Empty AI response" / "Empty transcription response" /
        // "Empty TTS response" / "Empty embedding response".
        msg.includes("empty")
      );
    }
    return false;
  }
  ```

**Given** an `Error("Empty AI response")` is thrown inside a retry loop
**When** `isRetryable(err)` is evaluated
**Then** returns `true` (vs. pre-11-8 `false`) — the loop retries instead of propagating.

**Given** a non-empty-related error like `Error("Schema validation failed")`
**When** `isRetryable(err)` is evaluated
**Then** returns `false` (preserved pre-11-8 behavior — no spurious retry-widening).

### 4. `generateSpeech` retry parity + empty-response check

- [x] **UPDATE** [`openai.ts:273-325`](src/lib/openai.ts) `generateSpeech`:

  - Replace `const maxRetries = 1;` → `const maxRetries = MAX_RETRIES;` (consumes shared constant).
  - Replace `await sleep(1000);` → `await sleep(RETRY_DELAYS[attempt] ?? 2000);` (consumes shared schedule; mirrors `chatCompletion`'s pattern at line 114).
  - Add empty-response check after the Blob → arrayBuffer conversion:

  ```typescript
  if (data instanceof Blob) {
    const buffer = await data.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
      throw new Error("Empty TTS response");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  ```

  - If `data instanceof Blob === false` but `typeof data === "string"` (the existing fallback at line 309), also check for empty:

  ```typescript
  if (typeof data === "string") {
    if (data.length === 0) {
      throw new Error("Empty TTS response");
    }
    return data;
  }
  ```

**Given** Azure returns a Blob with 0 bytes
**When** `generateSpeech` processes the response
**Then** throws `"Empty TTS response"` → retryable → retry loop catches it.

**Given** Azure returns a string base64 of length 0 (rare fallback path)
**When** `generateSpeech` processes the response
**Then** throws `"Empty TTS response"` → retryable.

**Given** `generateSpeech` exhausts both retries (3 total attempts) on an upstream that consistently returns empty
**When** the loop ends
**Then** propagates the final `Error("Empty TTS response")` to the caller (existing `Promise.allSettled` wrappers in `echo-generation.ts:48` + `translation-generation.ts:83` catch it cleanly).

### 5. `transcribeAudio` retry parity

- [x] **UPDATE** [`openai.ts:328-369`](src/lib/openai.ts) `transcribeAudio`:

  - Replace `const maxRetries = 1;` → `const maxRetries = MAX_RETRIES;`.
  - Replace `await sleep(1000);` → `await sleep(RETRY_DELAYS[attempt] ?? 2000);`.
  - Empty check at line 351-353 stays unchanged — error message `"Empty transcription response"` already matches the new `isRetryable` "empty" branch.

**Given** Whisper returns `data.text = ""`
**When** `transcribeAudio` processes the response
**Then** throws `"Empty transcription response"` → retryable → retry loop catches it (pre-11-8 was non-retried).

### 6. `generateEmbedding` retry parity + throw on empty

- [x] **UPDATE** [`openai.ts:372-403`](src/lib/openai.ts) `generateEmbedding`:

  - Replace `const maxRetries = 1;` → `const maxRetries = MAX_RETRIES;`.
  - Replace `await sleep(1000);` → `await sleep(RETRY_DELAYS[attempt] ?? 2000);`.
  - Replace the silent empty return with an explicit throw:

  Pre-11-8:

  ```typescript
  return data?.data?.[0]?.embedding ?? [];
  ```

  Post-11-8:

  ```typescript
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Empty embedding response");
  }
  return embedding;
  ```

  - The Story 11-6 `EMBEDDING_DIMENSION = 1536` consumer-side check at `error-tracker.ts:isValidEmbedding` stays — that's a defense-in-depth check on the FULL shape (length === 1536 + finite components). The boundary check here is a coarse-grain "non-empty array" gate; both layers protect.

**Given** OpenAI's embedding API returns `data.data[0].embedding = undefined`
**When** `generateEmbedding` processes the response
**Then** throws `"Empty embedding response"` → retryable → retry loop catches it.

**Given** OpenAI returns `data.data[0].embedding = []` (zero-length array)
**When** `generateEmbedding` processes the response
**Then** throws `"Empty embedding response"` (same path — both `undefined` and `[]` are caught).

**Given** OpenAI returns a malformed `data.data[0].embedding = [1, 2, ..., 1024 numbers]` (wrong dim)
**When** `generateEmbedding` processes the response
**Then** the boundary check passes (non-empty array) AND returns the array as-is. Story 11-6's `isValidEmbedding` at the `trackError` consumer catches the wrong-dim case via the `length !== 1536` check. **Two-layer defense preserved.**

### 7. Tests

- [x] **CREATE** `src/lib/__tests__/openai-retry-parity.test.ts` (~16 cases):

  - **Constant pins:**
    - `MAX_RETRIES === 2`.
    - `RETRY_DELAYS` equals `[1000, 2000]` and is read-only / frozen.
  - **`isRetryable` extension:**
    - `isRetryable(new Error("Empty AI response"))` returns `true`.
    - `isRetryable(new Error("Empty transcription response"))` returns `true`.
    - `isRetryable(new Error("Empty TTS response"))` returns `true`.
    - `isRetryable(new Error("Empty embedding response"))` returns `true`.
    - Negative guard: `isRetryable(new Error("Schema validation failed"))` returns `false`.
    - Pre-existing branches preserved: `network`, `timeout`, `fetch`, `500`, `502`, `503`, `429`, `rate limit` all still retryable.
  - **`chatCompletion` empty check:**
    - Mock `supabase.functions.invoke` to return `data.choices[0].message.content = ""` in text mode → throws `"Empty AI response"`.
    - Same with `content = "   "` (whitespace-only) → throws.
    - Same with `content = null` → throws.
    - Happy path: `content = "valid response"` returns the string verbatim.
  - **Parity drift detector** (reads `openai.ts` from disk; Story 11-3 / 11-6 / 11-7 pattern):
    - Each of `generateSpeech` / `transcribeAudio` / `generateEmbedding` uses `MAX_RETRIES` (negative-guard against `const maxRetries = 1`).
    - Each of the 3 helpers uses `RETRY_DELAYS[attempt] ?? 2000` (negative-guard against `sleep(1000)` fixed).
    - `chatCompletion` empty-check covers all `responseFormat` modes (negative-guard against the `responseFormat === "json_object"` gate).
    - `generateEmbedding` no longer returns `?? []` silently (negative-guard against `embedding ?? []`).
    - `isRetryable` includes "empty" branch.

- [x] **CREATE** `src/lib/__tests__/openai-empty-response.test.ts` (~8 cases):

  - `chatCompletion` text-mode empty throws + the retry loop fires.
  - `generateSpeech` Blob with 0 bytes throws + retry fires.
  - `generateSpeech` empty-string fallback path throws.
  - `transcribeAudio` empty-text throws (pre-existing) + retry now fires (was non-retried pre-11-8).
  - `generateEmbedding` undefined-data throws + retry fires.
  - `generateEmbedding` empty-array-data throws + retry fires.
  - Three-attempt exhaustion path: mock always-empty → final error propagates after `MAX_RETRIES` retries.
  - Two-layer defense smoke: `generateEmbedding` boundary throws + Story 11-6 `isValidEmbedding` is still called by `trackError` for defense-in-depth.

- [x] **VERIFY existing tests stay green** — no regression. Target test count: 1159 → ~1183 (+~24 from the new modules).

### 8. Update CLAUDE.md

- [x] Add a new architecture line **after** the Story 11-7 "Prompt truncation" line documenting: (a) `MAX_RETRIES = 2` + `RETRY_DELAYS = [1000, 2000]` as shared exported constants, (b) the four helpers' parity (`chatCompletion` + `generateSpeech` + `transcribeAudio` + `generateEmbedding` all at `MAX_RETRIES`), (c) the extended `chatCompletion` empty check (all modes) + `isRetryable` "empty" branch, (d) the `generateEmbedding` silent-empty fix (throw instead of `?? []`), (e) the two-layer defense (`generateEmbedding` boundary throw + Story 11-6 `isValidEmbedding` consumer guard), (f) cross-story invariants (Story 9-7 `parseRetries` layer is ABOVE the network retry layer; Stories 11-1 / 11-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 all unchanged).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 11-8 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [x] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — N/A (no new catch sites introduced; existing call-site catches in consumers continue to wrap the final throw).
- [x] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass (no DSN / credential changes).
- [x] **Story 9-3 Sentry allowlist contract holds** — no new `feature` strings (truncation / retry semantics are pure control flow).
- [x] **Story 9-4 stored-prompt-injection defense holds** — orthogonal.
- [x] **Story 9-5 / 9-6 surfaces** — orthogonal.
- [x] **Story 9-7 Zod schema retry contract holds** — `chatCompletionJSON`'s `parseRetries` layer is ABOVE this network retry layer; parse-retries default `1`, network-retries default `MAX_RETRIES = 2`. Both stay; no semantic collision.
- [x] **Story 9-8 / 10-6 speaking pipeline holds** — consumes `chatCompletionJSON` + `transcribeAudio` — both inherit the new retry budget transparently. Speaking-task evaluation is retried on transient stutters now.
- [x] **Story 9-9 / 9-10 surfaces** — orthogonal.
- [x] **Story 10-X surfaces hold** — orthogonal.
- [x] **Story 11-1 correction tool-call contract holds** — Realtime path; doesn't route through these helpers.
- [x] **Story 11-2 reconnect + barge-in contract holds** — Realtime path; unaffected.
- [x] **Story 11-3 Edge Function upstream timeouts contract holds** — `fetchWithTimeout` is server-side, downstream of the client retry loop. Per-attempt timeout unchanged (30s for chat / TTS / embedding / realtime-session / pronunciation; 90s for Whisper). Stacking math: worst-case client-side end-to-end = 3 attempts × per-attempt timeout + sum of backoff delays.
- [x] **Story 11-4 Postgres-backed rate-limit + daily cost cap contract holds** — pre-flight estimate runs per attempt; retries re-charge cost. Pre-existing behavior for chat; new for TTS / Whisper / embedding (acceptable per cost vs reliability trade-off).
- [x] **Story 11-5 cost discipline contract holds** — per-call maxTokens right-sizing + `gpt-realtime-mini` model + 3→1 post-conv consolidation all unchanged.
- [x] **Story 11-6 embedding-based dedupe + `isValidEmbedding` consumer guard holds** — two-layer defense preserved: `generateEmbedding` boundary throws on empty (new); `isValidEmbedding` consumer-side check at `trackError` catches wrong-dim / NaN / Infinity (Story 11-6).
- [x] **Story 11-7 prompt truncation contract holds** — orthogonal (truncation operates on fetched memories + error patterns; helper retry semantics don't affect the truncation boundary).

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/11-8-empty-response-detection-retry-parity.md`) under "Untracked files".
- [x] `npx prettier --check _bmad-output/implementation-artifacts/11-8-empty-response-detection-retry-parity.md` passes.

## Tasks / Subtasks

- [x] **Task 1: Promote retry constants to exported** (AC #1)
  - [x] Export `MAX_RETRIES = 2` from `openai.ts` (was module-private).
  - [x] Export `RETRY_DELAYS = [1000, 2000]` from `openai.ts` (was module-private).
  - [x] Update JSDoc on both.

- [x] **Task 2: Extend `chatCompletion` empty check** (AC #2)
  - [x] Replace the json_object-gated check with an unconditional non-empty + non-whitespace check.

- [x] **Task 3: Extend `isRetryable`** (AC #3)
  - [x] Add `msg.includes("empty")` branch.
  - [x] Verify pre-existing branches preserved.

- [x] **Task 4: `generateSpeech` parity + empty check** (AC #4)
  - [x] `maxRetries = MAX_RETRIES`.
  - [x] `sleep(RETRY_DELAYS[attempt] ?? 2000)`.
  - [x] Empty Blob check + empty-string fallback check.

- [x] **Task 5: `transcribeAudio` parity** (AC #5)
  - [x] `maxRetries = MAX_RETRIES`.
  - [x] `sleep(RETRY_DELAYS[attempt] ?? 2000)`.

- [x] **Task 6: `generateEmbedding` parity + throw on empty** (AC #6)
  - [x] `maxRetries = MAX_RETRIES`.
  - [x] `sleep(RETRY_DELAYS[attempt] ?? 2000)`.
  - [x] Replace `?? []` with explicit Array.isArray + length > 0 check + throw.

- [x] **Task 7: Tests** (AC #7)
  - [x] CREATE `src/lib/__tests__/openai-retry-parity.test.ts` (~16 cases including drift detector).
  - [x] CREATE `src/lib/__tests__/openai-empty-response.test.ts` (~8 cases).
  - [x] Target test count: 1159 → ~1183.

- [x] **Task 8: Update CLAUDE.md** (AC #8)

- [x] **Task 9: Quality gates** (AC #Z)
  - [x] type-check / lint / format / test / colors all green.
  - [x] CI Sentry DSN + Submit credentials leak guards pass.
  - [x] `git status` shows the story file as untracked-but-not-ignored.
  - [x] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Shared constants over local literals** — Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 pattern. The 4 helpers' retry budgets are promoted to one source of truth so a future operator change propagates atomically.
- **Throw + retryable error message** — Story 11-3 pattern: `"Upstream timeout: ..."` contains the substring `"timeout"` which `isRetryable` matches. Story 11-4 pattern: `"rate limit exhausted"` matches `"rate limit"`. Story 11-8 extends: `"Empty ..."` matches the new `"empty"` branch. Each new retryable class adds one substring to `isRetryable`.
- **Sanitize-first → throw-on-anomaly → retry-loop catches** — Story 9-7 / 11-3 / 11-4 / 11-6 layered defense. Each layer is independent; failures cascade through the loops in order.
- **Boundary throw + consumer-side defense-in-depth** — Story 11-6 `isValidEmbedding` stays as the consumer guard at `error-tracker.ts`; Story 11-8 adds the boundary throw at `generateEmbedding`. Two layers; both stay.
- **No new Sentry tags** — retry semantics are control flow, not error-recoverable boundaries that need new feature tags. Story 9-3 allowlist contract preserved by absence.
- **Drift detector tests** — Story 11-3 / 11-4 / 11-6 / 11-7 pattern: read the source from disk and pin the constants + invariants. Catches future regressions that re-localize values.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section bakes this in.
- **Epic 9 + 10 + 11 retros A3** (review-patch budget): Story 11-8 has LOW risk surface (single-file refactor + constant promotion + 4 retry-loop changes). Expect 5-7 review patches. Low-risk:
  - (a) The `isRetryable` "empty" branch is broad — could over-match if a future error message coincidentally contains "empty" (e.g., `"Empty cache miss"`). Mitigated by grep audit at story-write time (zero non-test matches outside `openai.ts`).
  - (b) The `RETRY_DELAYS[attempt] ?? 2000` fallback — pre-11-8 `chatCompletion` uses the same pattern; for 3-attempt loops `attempt` ranges 0-1 inside the retry branch (after the original call) so `RETRY_DELAYS[0] = 1000` and `RETRY_DELAYS[1] = 2000`. The `?? 2000` is dead code for `MAX_RETRIES = 2` but defensive against future bumps to 3+.
  - (c) The `generateEmbedding` empty-array check is `!Array.isArray() || length === 0` — strict. If OpenAI's response shape ever has `embedding: null`, the `!Array.isArray(null)` branch fires correctly. If `embedding: 0`, same.
  - (d) The `generateSpeech` empty check at `bytes.length === 0` is the canonical case; an Azure 200 with a 1-byte malformed audio response would NOT trigger the empty check but WOULD trigger downstream audio decoding errors. Out of scope; the boundary protects against the canonical empty case.
- **Story 11-3 lesson** (load-bearing error message format): `"Empty AI response"` / `"Empty transcription response"` / `"Empty TTS response"` / `"Empty embedding response"` all share the substring `"empty"` (lowercased). The naming is contractual — a future story renaming one of these messages must preserve the substring.
- **Story 11-6 lesson** (boundary throw + consumer-side defense-in-depth): both layers stay; document the contract.
- **Story 11-7 lesson** (delete-don't-alias for shared constants): `MAX_RETRIES` and `RETRY_DELAYS` become single-source-of-truth; the 3 local-literal `const maxRetries = 1` / `sleep(1000)` lines are DELETED.

### Cost — retry math at `gpt-realtime-mini` rates

Pre-11-8 worst case (chat call hits 2 empty-response stutters in a row):
- 1 original + 2 retries × `chatCompletion` × `gpt-4o` chat cost ≈ ~$0.001 + ~$0.001 + ~$0.001 = ~$0.003 per user-facing failure event.

Post-11-8: same math — the empty path was already retryable for network errors, so adding the "empty" branch doesn't change worst-case cost. The reliability win is the user doesn't see a failed UI; the cost is amortized across the rare upstream-stutter event class.

Pre-11-8 TTS worst case (1 retry):
- 1 original + 1 retry × Azure TTS ≈ ~$0.001 + ~$0.001 = ~$0.002 per failed call.

Post-11-8 TTS worst case (2 retries):
- 1 original + 2 retries × Azure TTS ≈ ~$0.003 per failed call. +50% cost ON FAILURES ONLY (success path unchanged).

Operator-acceptable trade-off. Failed-call frequency is < 0.1% of all TTS calls per OpenAI / Azure reliability SLAs (per Epic 11 retro telemetry — TBD post-deploy).

## Dev Agent Record

### Implementation Plan

Implemented top-down following the Tasks/Subtasks sequence; no deviations from spec.

**Tasks 1+2+3 — Constants + `isRetryable` extension + `chatCompletion` empty check:** Promoted `MAX_RETRIES = 2` and `RETRY_DELAYS: readonly number[] = [1000, 2000]` from module-private to exported constants in `src/lib/openai.ts`. Added `msg.includes("empty")` branch to `isRetryable` regex. Replaced `chatCompletion`'s JSON-mode-gated empty-check with `typeof content !== "string" || content.trim().length === 0` covering all response formats including whitespace-only and null.

**Tasks 4+5+6 — Parity refactor across 3 helpers:** `generateSpeech` / `transcribeAudio` / `generateEmbedding` all switched from local `const maxRetries = 1;` to `const maxRetries = MAX_RETRIES;` and from fixed `sleep(1000)` to `sleep(RETRY_DELAYS[attempt] ?? 2000)`. Added empty-Blob check + empty-string fallback check to `generateSpeech` (throws `"Empty TTS response"`). Replaced `generateEmbedding`'s silent `?? []` return with explicit `!Array.isArray(embedding) || embedding.length === 0` boundary check (throws `"Empty embedding response"`). `transcribeAudio`'s pre-existing empty-text check is unchanged in message but is now retryable via the extended `isRetryable` "empty" branch.

**Task 7 — Tests:** Two new files, 33 net Jest cases.

- `src/lib/__tests__/openai-retry-parity.test.ts` — 15 cases: 3 constant pins (MAX_RETRIES === 2, RETRY_DELAYS === [1000, 2000], length === MAX_RETRIES) + 2 isRetryable source-content checks (new "empty" branch + all pre-11-8 substrings preserved) + 10 drift-detector cases reading `openai.ts` from disk (per-helper `MAX_RETRIES` consumption + `RETRY_DELAYS[attempt]` schedule + negative guards against `const maxRetries = 1` and `sleep(1000)` literals + chatCompletion empty-check covers all modes + generateEmbedding throws-on-empty + generateSpeech empty-Blob throw + transcribeAudio empty-text throw preserved + constants exported).
- `src/lib/__tests__/openai-empty-response.test.ts` — 18 runtime cases driven through mocked `supabase.functions.invoke`: chatCompletion text + JSON + whitespace + null + happy + 1-retry-recovery; generateSpeech empty Blob + empty-string fallback + happy; transcribeAudio empty + missing field + happy; generateEmbedding undefined + empty array + missing field + non-array + happy 1536-dim + 2-layer-defense short-array case. Uses a `globalThis.setTimeout` immediate-callback shim in `beforeAll`/`afterAll` to keep retry-loop semantics intact without paying the wall-clock cost of [1000, 2000]ms backoff.

**Task 8 — CLAUDE.md:** Added architecture paragraph after Story 11-7's line documenting all 8 facets per the AC #8 brief (the 2 new exported constants + 4 helpers' parity + extended chatCompletion empty check + isRetryable extension + generateEmbedding silent-empty fix + two-layer embedding defense + cross-story invariants + Epic 11 closure).

**Task 9 — Quality gates:** All 5 gates green on the first sweep after prettier-write fix on 1 file + import-order fix on 1 file: `npm run type-check` (0 errors), `npm run lint` (0 warnings; `--max-warnings 0`), `npm run format:check` (Prettier), `npm test` (1192/1192 — +33 net 1159 → 1192), `npm run check:colors` (no hardcoded hex).

### Debug Log

No blockers, no HALT conditions, no spec deviations.

Two minor friction points during test development:

1. **First-pass `advanceTimersAndAwait` helper had an infinite-loop bug.** I'd written a fake-timer drain loop with a `Promise.race` against a synchronously-resolved sentinel; microtask ordering meant the race always picked the sentinel, never the actual promise, so the test process consumed 100% CPU indefinitely. Two stuck processes had to be `kill -9`'d. Replaced with a much simpler approach: override `globalThis.setTimeout` to call the callback immediately in `beforeAll`/`afterAll`. The retry-loop's `await sleep(...)` still fires (resolving immediately) so retry semantics are intact, and the suite runs in <1s instead of ~40s.

2. **`import/first` lint warning.** I'd placed the imports AFTER the `beforeAll`/`afterAll` setTimeout-override blocks, which `import/first` rejects. Resolved by moving imports to the top and noting in a comment that `openai.ts`'s `sleep` helper reads `setTimeout` at call time (not module load), so the in-`beforeAll` override applies correctly regardless of import order.

### Completion Notes

- All 9 ACs satisfied + all 16 Z polish items checked.
- Story 9-4 stored-prompt-injection defense holds (orthogonal — retry semantics don't touch content).
- Story 9-7 `chatCompletionJSON.parseRetries` layer is intact (above the network retry layer; parse-retries default 1, network-retries default MAX_RETRIES = 2).
- Story 11-3 server-side `fetchWithTimeout` is per-attempt; stacking math worked out: worst-case end-to-end latency for chat = 3 × 30s + (1s + 2s) = 93s (unchanged for chat); for TTS / Whisper / embedding the worst-case bumps from `2 × per-attempt + 1s` to `3 × per-attempt + 3s` per the spec's accepted reliability vs latency trade-off.
- Story 11-4 `daily_cost_ledger` pre-flight charges per attempt (pre-existing for chat; new for TTS / Whisper / embedding). Bounded; operator-acceptable per cost-cap math.
- Story 11-6 `isValidEmbedding` consumer guard preserved — two-layer defense for embeddings is documented in `generateEmbedding`'s JSDoc.
- No new Sentry tags introduced (Story 9-3 allowlist contract preserved).
- Test count exceeded spec target (~24 spec'd / 33 actual). Excess comes from the runtime empty-response test file (18 cases vs spec'd 8 — added 2-layer-defense short-array case + happy paths for each helper for symmetry) and the drift detector (15 vs spec'd 16 — close enough; one merged into a multi-assertion test).
- **Epic 11 is now fully closed**: 11-1 (P1-6+P2-1), 11-2 (P1-7), 11-3 (P1-9), 11-4 (P1-8+P1-10 spend-cap), 11-5 (P1-10 maxTokens+3-call), 11-6 (P1-21), 11-7 (P2-9), 11-8 (P2-x ai-integration) all done.

### File List



**Created:**

- `src/lib/__tests__/openai-retry-parity.test.ts`
- `src/lib/__tests__/openai-empty-response.test.ts`

**Modified:**

- `src/lib/openai.ts` (constants exported + `isRetryable` extended + `chatCompletion` empty-check widened + 3 helper parity edits; ~30 LOC delta)
- `CLAUDE.md` (architecture paragraph)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status flip)

**Deleted:**

- 3 instances of `const maxRetries = 1;` (replaced with `const maxRetries = MAX_RETRIES;`).
- 3 instances of `sleep(1000)` (replaced with `sleep(RETRY_DELAYS[attempt] ?? 2000)`).
- 1 instance of silent empty-array return `?? []` at `generateEmbedding` (replaced with explicit throw).

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-13 | Story 11-8 story file created; closes roadmap deliverable 11.8 (Empty-response detection for non-JSON chat completions + retry parity TTS = 2 retries) + the catch-all "P2-x ai-integration findings" tag covering scattered ai-tagged audit rows that touch the `openai.ts` helper surface.                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-05-13 | Story 11-8 implementation complete on `feature/11-8-empty-response-detection-retry-parity` (branched from `feature/11-7-prompt-truncation` since 11-7 PR #73 still open). `MAX_RETRIES = 2` + `RETRY_DELAYS = [1000, 2000]` promoted to exported constants. `chatCompletion` empty-check broadened to ALL response formats (text + JSON + whitespace-only + null). `isRetryable` extended with `msg.includes("empty")` branch. `generateSpeech` / `transcribeAudio` / `generateEmbedding` all switched from local `maxRetries = 1` + fixed `sleep(1000)` to shared `MAX_RETRIES` + `RETRY_DELAYS[attempt]` schedule. `generateSpeech` gains empty-Blob + empty-string-fallback checks throwing `"Empty TTS response"`. `generateEmbedding` silent `?? []` replaced with explicit throw `"Empty embedding response"` (two-layer defense preserved: Story 11-6 `isValidEmbedding` consumer guard stays). +33 net tests (1159 → 1192); all 5 quality gates green; CLAUDE.md updated; status → review. **Epic 11 closed.** |
| 2026-05-13 | Story 11-8 review-round-1 complete: 10 of 11 actionable findings patched (HIGH × 3 + MED × 5 + LOW × 2); P11 attempt-count-in-error deferred — clean implementation requires extending the Story 9-3 Sentry allowlist with new `helper` + `attempts` keys; out of scope for this round. **HIGH**: P1 `isRetryable("empty")` substring narrowed to exact-match against `RETRYABLE_EMPTY_MESSAGES = Set([4 canonical sentinels])` allowlist — pre-patch benign upstream errors like `"OpenAI error: empty quota"` would spuriously retry 2× wasting Story 11-4 cost-cap budget on non-recoverable validation/auth errors. P2 explicit `Array.isArray(data?.data)` shape guard in `generateEmbedding` BEFORE indexing — future upstream shape-drift like `data: { data: null }` or `data: { data: {} }` no longer slips through to a misleading throw with no signal. P3 drift detector regex `\bconst\s+maxRetries\s*=\s*1\s*[;\n]` replaces the pre-patch `const maxRetries = 1[^0-9]` — formatter quirks producing double-space or missing-space-around-equals can no longer mask a regression. **MED**: P4 `globalThis.setTimeout` shim install/restore moved from `beforeAll`/`afterAll` to `beforeEach`/`afterEach` for per-test isolation — pre-patch an `afterAll` failure mid-suite would leak the immediate-callback shim across concurrent test files in the same Jest worker. P5 "two-layer defense" test now imports `isValidEmbedding` from `error-tracker.ts` and proves it returns `false` on the 5-element array the boundary accepts (and `true` on a 1536-dim array) — pre-patch the test claimed the two-layer contract but never exercised it. P6 the 3 helper JSDocs no longer hardcode the literal `2` retry count — they reference `MAX_RETRIES (see constant above)` so a future operator bump propagates cleanly. P7 `RETRY_DELAYS` is `Object.freeze`'d + a frozen-contract test pins `Object.isFrozen(RETRY_DELAYS) === true` and asserts mutation throws — pre-patch a consumer mutation could have silently corrupted the schedule globally for all 4 helpers. P8 `isRetryable` is now exported + a parameterized 22-case `it.each` matrix asserts runtime retryability for the 4 canonical sentinels (uppercase + lowercase variants), pre-11-8 retryable substrings (network/timeout/fetch/5xx/429/rate-limit), P1 over-match negative guards, unrelated errors, and non-Error inputs. **LOW**: P9 `chatCompletion`'s empty-response detection switched from `.trim().length === 0` to `!/\S/u.test(content)` — Unicode whitespace categories (NBSP U+00A0, line separator U+2028, paragraph separator U+2029) are now detected as empty. P10 dropped the `?? ""` default at `data?.choices?.[0]?.message?.content` so the post-coercion `typeof content !== "string"` check becomes meaningful (pre-patch the default made the typeof branch dead code). +30 net regression tests (1192 → 1222); all 5 quality gates green. |
