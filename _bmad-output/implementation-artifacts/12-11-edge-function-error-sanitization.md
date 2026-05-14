# Story 12.11: Edge Function Error Sanitization — `parseUpstreamError` Returns Generic Categorized Message + Logs Raw Body to Operator-Visible Function Logs

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose audit finding **P1-14** at [`shippable-roadmap.md` line 66](_bmad-output/planning-artifacts/shippable-roadmap.md) names the bug exactly: `"Edge Function parseUpstreamError returns raw upstream body to client — leaks model names and prompt fragments — supabase/functions/_shared/errors.ts:54-79 — security"`, AND whose current [`supabase/functions/_shared/errors.ts:105-146`](supabase/functions/_shared/errors.ts#L105-L146) `parseUpstreamError(response)` implementation reads up to 5 seconds of upstream-error-body content (via Story 11-3's `withTimeout("error-body-read", ..., ERROR_BODY_READ_TIMEOUT_MS)`) and then returns to the client one of three things — (a) for OpenAI / Azure-shaped JSON like `{error: {message, type, code}}` it returns `"message | type=... | code=..."` (i.e., the upstream's literal error message string — e.g., `"The model gpt-4o is not available in your region"` leaks the model name; `"Your message exceeds the 32768 token limit: 'translate this French to English: Bonjour mes amis...'"` leaks the model AND a fragment of the user's prompt), (b) for `{message: "..."}` shape it returns `parsed.message` directly, (c) for unparseable bodies (HTML 5xx pages, XML errors, plain text) it returns `rawText` verbatim (which may carry server hostnames / version strings / internal-config breadcrumbs), AND each of the **5 callers** in 3 Edge Functions wraps the returned message in `errorResponse({code:"UPSTREAM_ERROR", message:"<label> error: ${upstreamMessage}", status: response.status, corsHeaders})` — [`supabase/functions/ai-proxy/index.ts:271-272`](supabase/functions/ai-proxy/index.ts#L271-L272) (Azure TTS) + [`supabase/functions/ai-proxy/index.ts:420-421`](supabase/functions/ai-proxy/index.ts#L420-L421) (OpenAI Whisper) + [`supabase/functions/ai-proxy/index.ts:447-448`](supabase/functions/ai-proxy/index.ts#L447-L448) (OpenAI chat/embedding) + [`supabase/functions/pronunciation-assess/index.ts:164-165`](supabase/functions/pronunciation-assess/index.ts#L164-L165) (Azure Speech) + [`supabase/functions/realtime-session/index.ts:148`](supabase/functions/realtime-session/index.ts#L148) (OpenAI Realtime token issuance) — so an unauthenticated network observer (or an authenticated end-user who triggers an upstream error) sees the raw upstream message in the HTTP response body that ships to the React Native client, AND the Story 9-3 PII / telemetry contract that pins `SENTRY_EXTRAS_ALLOWLIST` + the 80-char redaction rule at `src/lib/sentry.ts:25,67` was designed specifically to prevent this class of leak through the CLIENT-SIDE telemetry pipeline, but the SERVER-SIDE Edge Function response body is an orthogonal leak path that the Story 9-3 scrubber cannot reach (the scrubber operates on `beforeSend` of Sentry events generated client-side; it does NOT proxy or filter outbound Edge Function HTTP responses), AND the client-side `isRetryable()` regex at [`src/lib/openai.ts:76-94`](src/lib/openai.ts#L76-L94) matches on substrings `network` / `timeout` / `fetch` / `500` / `502` / `503` / `429` / `rate limit` plus the 4 `RETRYABLE_EMPTY_MESSAGES` sentinels — note that the HTTP STATUS CODE substring is the load-bearing retry signal, NOT the upstream message text; a generic message like `"Upstream API error (status 429)"` triggers retry via the `"429"` substring with no regression, AND none of the existing Edge Function steps in `.github/workflows/` gate on this leak (Story 9-3's Sentry DSN leak guard at `ci.yml:42-57` covers the DSN in source, NOT outbound response bodies), so a future Edge Function refactor that re-introduces the leak would land on `main` silently, AND the cross-story pattern — Story 12-10 added a CI gate + drift detector for `npm audit`, Story 12-9 added a source-drift detector for `_layout.tsx` Sentry contract, Story 12-8 added a source-drift detector for password-policy regression — suggests Story 12-11 should follow the same pattern and add a drift detector that reads `supabase/functions/**/index.ts` from disk + asserts `parseUpstreamError`'s return value never reaches a client-bound `errorResponse({message})` argument without sanitization, AND `supabase/functions/_shared/__tests__/fetch-with-timeout_test.ts` already establishes the Deno-runnable test precedent (manual-run via `deno test --allow-net=127.0.0.1`; Epic 15.3 owns CI wiring) so a sibling test file for `parseUpstreamError` follows naturally.

I want (a) **the `parseUpstreamError` function at [`supabase/functions/_shared/errors.ts:105-146`](supabase/functions/_shared/errors.ts#L105-L146) refactored** to: (i) signature change from `parseUpstreamError(response: Response): Promise<string>` to `parseUpstreamError(response: Response, upstreamLabel: string): Promise<string>` — the new `upstreamLabel` parameter is a categorical short string the caller passes (e.g., `"openai-chat"`, `"openai-whisper"`, `"openai-embedding"`, `"openai-realtime-token"`, `"azure-tts"`, `"azure-pronunciation"`) that flows ONLY to the operator-visible `console.error` log line, never to the client response (Story 9-3 contract: categorical strings are safe; user-derived content is not — `upstreamLabel` is fully controlled by Edge Function source code), (ii) the body-read flow is preserved verbatim from Story 11-3 — `withTimeout("error-body-read", response.text(), ERROR_BODY_READ_TIMEOUT_MS)` with the 5s cap and the timeout-recovery fallback path, (iii) on successful body read, the FULL raw text is logged via `console.error("[upstream-error]", upstreamLabel, "status=", response.status, "body=", truncatedBody)` where `truncatedBody` is the raw text capped at **2000 characters** with a `... (truncated)` marker if longer (defends against a malformed-mountain-of-HTML upstream blowing out function log storage; 2000 chars is plenty for diagnosis), (iv) the RETURN VALUE to the caller is ALWAYS a generic categorized message of the shape `"Upstream API error (status ${response.status})"` — regardless of whether the body was parseable JSON, plain text, HTML, empty, or timeout-recovered; the upstream's literal error message NEVER flows back through the return path; (v) the body-read-timeout path (line 119-121 today) gets the same console.error + same generic-return treatment so it converges with the parseable-body path (no per-path divergence); (vi) the JSON-shape-parsing logic at lines 123-145 is DELETED ("delete don't alias" pattern per Stories 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 / 12-7 / 12-8 / 12-9 / 12-10) — the operator gets the FULL body via console.error so the parsing-for-prettiness branch loses its value-add; the client only sees the generic message which conveys the load-bearing diagnostic (HTTP status code) for retry decisions; (b) **all 5 caller sites updated to pass the categorical `upstreamLabel`**: (i) `ai-proxy/index.ts:271-272` Azure TTS → `parseUpstreamError(azureTtsResponse, "azure-tts")`, (ii) `ai-proxy/index.ts:420-421` OpenAI Whisper → `parseUpstreamError(openaiResponse, "openai-whisper")`, (iii) `ai-proxy/index.ts:447-448` OpenAI chat/embedding catch-all → `parseUpstreamError(openaiResponse, "openai-chat-or-embedding")` (the catch-all currently handles BOTH chat and embedding switch-arms; a future story can split these but the unified label is sufficient for operator triage today since the per-action context is recoverable from the surrounding `[upstream-error]` log lines AND from the request's `action` field which is already logged elsewhere), (iv) `pronunciation-assess/index.ts:164-165` Azure Pronunciation → `parseUpstreamError(azureResponse, "azure-pronunciation")`, (v) `realtime-session/index.ts:148` OpenAI Realtime → `parseUpstreamError(response, "openai-realtime-token")`; the wrapping `errorResponse({code:"UPSTREAM_ERROR", message: "<UI label> error: ${upstreamMessage}", status, corsHeaders})` STAYS — the UI labels (`"Azure TTS error:"`, `"OpenAI Whisper error:"`, `"OpenAI error:"`, `"Azure Speech error:"`) are our own short-string labels (not upstream content) and provide enough discrimination for the client-side `captureError` feature-tag breadcrumb; (c) **client-side compatibility verification** — the `isRetryable()` at [`src/lib/openai.ts:76-94`](src/lib/openai.ts#L76-L94) substring-matches on `"network"` / `"timeout"` / `"fetch"` / `"500"` / `"502"` / `"503"` / `"429"` / `"rate limit"`; the new generic message `"Upstream API error (status 429)"` contains the substring `"429"` → retry still triggers; `"Upstream API error (status 500)"` contains `"500"` → retry still triggers; `"Upstream API error (status 502)"` contains `"502"` → retry still triggers; the only retry-cohort that LOSES information is the pre-12-11 `"OpenAI error: rate limit exceeded for ..."` whose `"rate limit"` substring matched — post-12-11 the same upstream-429 response surfaces as `"Upstream API error (status 429)"` which matches via the `"429"` substring instead — retry behavior preserved, no client code change needed; **VERIFICATION CASE**: a Jest test in `src/lib/__tests__/upstream-error-sanitization.test.ts` (~6 cases) asserts that for each HTTP status code we route through `isRetryable("Upstream API error (status N)")`, the result matches the pre-12-11 behavior for the same status; (d) **NEW operator runbook `_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md`** (~80 lines, 4 sections) documenting: (i) **Section 1** — the post-12-11 contract: clients see only `"Upstream API error (status N)"`; operators see the full upstream body in Supabase function logs via `[upstream-error]` prefix; (ii) **Section 2** — recipe for retrieving the operator-visible logs: `supabase functions logs <function-name> --tail=200 | grep '\[upstream-error\]'` OR via the Supabase Dashboard → Edge Functions → `<function>` → Logs tab; sample log line format: `[upstream-error] openai-chat status=500 body={"error":{"message":"...","type":"...","code":"..."}}`; (iii) **Section 3** — the categorical `upstreamLabel` allowlist (6 labels: `openai-chat-or-embedding`, `openai-whisper`, `openai-realtime-token`, `azure-tts`, `azure-pronunciation`, plus future labels added as the surface grows) — operators searching the logs for a specific upstream can filter by label; (iv) **Section 4** — cross-story dependencies: the operator-visible-only log channel is the LOAD-BEARING design choice that closes P1-14; if a future story re-introduces a `parseUpstreamError(response).then(msg => errorResponse({message: msg}))` shape, the drift detector in deliverable (e) catches it; (e) **NEW drift detector test** `src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts` (~6 cases) reading the 3 Edge Function files (`ai-proxy/index.ts`, `pronunciation-assess/index.ts`, `realtime-session/index.ts`) AND the shared `errors.ts` from disk + asserting: (i) Case 1 — `errors.ts` `parseUpstreamError` signature contains the second parameter `upstreamLabel: string`, (ii) Case 2 — `errors.ts` `parseUpstreamError` body contains the literal return-value template `"Upstream API error (status "` (positive guard on the generic message path), (iii) Case 3 — NEGATIVE: `errors.ts` `parseUpstreamError` body does NOT contain a `return rawText` / `return parsed.message` / `return ${...message}` pattern (deleted JSON-parsing branch did not regress), (iv) Case 4 — each of the 5 caller sites passes a non-empty string as the 2nd argument to `parseUpstreamError` (regex: `parseUpstreamError\([^,)]+,\s*"[a-z\-]+"\s*\)` — kebab-case lowercase label), (v) Case 5 — `errors.ts` `parseUpstreamError` body contains a `console.error` invocation with the literal `"[upstream-error]"` prefix (positive guard on the operator-log path), (vi) Case 6 — drift across files: list the 5 caller files + assert each contains exactly one `parseUpstreamError(` call so a future caller added without the label arg fails CI; the test uses the Story 12-8 R2-P3 string-literal-aware balanced-paren walker if the regex needs to disambiguate nested calls, but the simpler per-file substring count is sufficient for the current call sites; (f) **NEW Deno-runnable test** `supabase/functions/_shared/__tests__/parse-upstream-error_test.ts` (~7 cases) following Story 11-3's `fetch-with-timeout_test.ts` precedent (manual-run via `deno test`; Epic 15.3 owns CI wiring): (i) JSON-shaped upstream error → return value is generic, console.error records the JSON; (ii) plain-text upstream → return generic, console.error records text; (iii) HTML 5xx page → return generic, console.error records HTML (truncated at 2000); (iv) empty body → return generic with status, console.error records `body=`; (v) body-read timeout → return generic, console.error records `body-read-timeout`; (vi) the 2000-char truncation marker `... (truncated)` appears for over-cap bodies; (vii) the upstream's literal error message (e.g., `"model gpt-4o not available"`) is NEVER in the return value — verified by substring assertion `assert(!result.includes("gpt-4o"))`; (g) **NO new packages** — `withTimeout` + `ERROR_BODY_READ_TIMEOUT_MS` already in `_shared/fetch-with-timeout.ts`; `console.error` is a built-in; (h) **NO migration file** — this is Edge Function source code only; no Postgres schema change; (i) **NO change to client-side `openai.ts`** — `isRetryable` regex still matches the new generic message via the HTTP-status-substring path; the catch-block flow at `openai.ts:172-187` / `:405-407` / `:458-460` / `:526-528` stays verbatim because the client receives the same `{error, code, retryAfter?}` JSON shape; (j) **NO Sentry allowlist changes** — `SENTRY_EXTRAS_ALLOWLIST` at `src/lib/sentry.ts` is zero-diff; the new client-side test verifies that `captureError("upstream-error", {context})` still records the categorical context (the `code` field `"UPSTREAM_ERROR"` is already allowlisted); (k) **CLAUDE.md architecture line** added after the Story 12-10 review-round-1 paragraph documenting: the new `parseUpstreamError(response, upstreamLabel)` signature + the operator-visible-only log channel + the 6 categorical labels + the runbook path + cross-story zero-product-code-side-effects + the closed P1-14 finding,

so that **audit finding P1-14 closes architecturally** — every Edge Function upstream-error path routes through the single `parseUpstreamError` chokepoint, which by construction cannot leak upstream content to clients; **the operator-visible log channel is the LOAD-BEARING design choice** — Supabase function logs are accessible ONLY to project owners with the Supabase dashboard credentials (NOT to network observers, NOT to end users via the response body); **the categorical `upstreamLabel` allowlist gives operators per-upstream filtering** — searching `[upstream-error] openai-chat` in logs surfaces just the chat-completion failures; **the client-side `isRetryable` retry logic is unchanged** — the HTTP-status-code substring is the load-bearing retry signal, NOT the upstream message text; **the drift detector pins the contract against regression** — a future Edge Function refactor that re-introduces `return rawText` or `return parsed.message` fails CI loudly; **the Deno-runnable test pins the runtime behavior** — Epic 15.3 will wire it into CI later; **the operator runbook documents the log-retrieval recipe** + the 6 categorical labels + the per-severity decision tree for triaging upstream errors; **`SENTRY_EXTRAS_ALLOWLIST` is zero-diff** — categorical labels (`"openai-chat-or-embedding"` etc.) are short ASCII strings that pass the Story 9-3 80-char redaction threshold by construction; **the JSON-pretty-parsing branch is deleted** — operators getting raw bodies via console.error is strictly more useful than the prior `"message | type=... | code=..."` lossy reformat; **Story 12-11 closes 1 audit finding (P1-14) as a SMALL discrete story** (1 modified shared module `errors.ts` + 3 modified Edge Function call sites + 1 new operator runbook + 1 new Jest drift detector + 1 new Deno-runnable runtime test + 1 modified CLAUDE.md paragraph + 1 modified sprint-status.yaml; total diff < 600 lines; zero product-code-app/-side-effects; zero new packages; zero migrations).

## Background — Why This Story Exists

### What audit finding P1-14 owns to this story

[`shippable-roadmap.md` line 66](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P1-14 — Edge Function `parseUpstreamError` returns raw upstream body to client — leaks model names and prompt fragments — `supabase/functions/_shared/errors.ts:54-79` — security"

Epic 12.11 deliverable at [`shippable-roadmap.md` line 214](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "12.11 Sanitize Edge Function error responses — never return raw upstream body. **Covers P1-14.**"

### Current state — the leak path

Pre-12-11 [`supabase/functions/_shared/errors.ts:105-146`](supabase/functions/_shared/errors.ts#L105-L146) `parseUpstreamError`:

```typescript
export async function parseUpstreamError(response: Response): Promise<string> {
  let rawText: string;
  try {
    rawText = await withTimeout("error-body-read", response.text(), ERROR_BODY_READ_TIMEOUT_MS);
  } catch {
    return `Upstream returned ${response.status} (body read timed out after ${ERROR_BODY_READ_TIMEOUT_MS}ms)`;
  }

  try {
    const parsed = JSON.parse(rawText);
    // OpenAI / Azure standard shape: { error: { message: "..." } }
    if (parsed?.error?.message) {
      const errObj = parsed.error;
      const parts = [errObj.message];                    // ← LEAK: upstream message
      if (errObj.type) parts.push(`type=${errObj.type}`); // ← LEAK: upstream type
      if (errObj.code) parts.push(`code=${errObj.code}`); // ← LEAK: upstream code
      return parts.join(" | ");
    }
    if (parsed?.message) {
      return parsed.message;                             // ← LEAK: upstream message
    }
    return rawText;                                      // ← LEAK: entire raw body
  } catch {
    return rawText || `Upstream returned ${response.status} with empty body`; // ← LEAK
  }
}
```

The 5 caller sites then pipe the return value through `errorResponse({message: "Azure TTS error: ${upstreamMessage}", ...})` — that becomes the HTTP response body the client receives.

### What actually leaks today — concrete examples

| Upstream response | Pre-12-11 client-visible message | Post-12-11 client-visible | Post-12-11 console.error (operator-only) |
| --- | --- | --- | --- |
| `{"error":{"message":"The model gpt-4o is overloaded","type":"server_error","code":"overloaded"}}` | `"OpenAI error: The model gpt-4o is overloaded | type=server_error | code=overloaded"` → **leaks model name** | `"OpenAI error: Upstream API error (status 503)"` | `[upstream-error] openai-chat status=503 body={"error":{"message":"The model gpt-4o is overloaded",...}}` |
| `{"error":{"message":"Your message exceeds the 32768 token limit: 'translate this French to English: Bonjour mes amis...'"}}` | `"OpenAI error: Your message exceeds ... 'translate this French to English: Bonjour mes amis...'"` → **leaks user's prompt** | `"OpenAI error: Upstream API error (status 400)"` | `[upstream-error] openai-chat status=400 body={"error":{...prompt fragment...}}` |
| `<html><body>500 Internal Server Error<br>nginx/1.18.0 (Ubuntu)</body></html>` | `"Azure TTS error: <html><body>...nginx/1.18.0 (Ubuntu)..."` → **leaks server fingerprint** | `"Azure TTS error: Upstream API error (status 500)"` | `[upstream-error] azure-tts status=500 body=<html>...nginx/1.18.0...` |
| Empty body, status 502 | `"OpenAI error: Upstream returned 502 with empty body"` → benign | `"OpenAI error: Upstream API error (status 502)"` | `[upstream-error] openai-chat status=502 body=` |

The leak is **real today** (verified by reading the code; reproducible by triggering any upstream error against a deployed Edge Function). The post-12-11 design eliminates it at the source.

### Why route through `parseUpstreamError` instead of inlining in 5 places?

Single chokepoint — a future Edge Function adding a 6th caller site automatically inherits the sanitization. Inlining the sanitization at each call site would create 5 places to regress. The drift detector in deliverable (e) Case 4 pins the contract: every caller MUST pass the `upstreamLabel` argument.

### Why log to `console.error` and not Sentry?

Edge Functions run on Supabase's edge runtime (Deno-based). The Sentry SDK for Deno exists but isn't part of the project's current Edge Function deps (`supabase secrets set` covers the upstream API keys; Sentry isn't initialized server-side). `console.error` writes to Supabase's function-log surface, which:

1. Is operator-accessible via the Supabase Dashboard (Edge Functions → `<function-name>` → Logs tab).
2. Is operator-accessible via the Supabase CLI: `supabase functions logs <function-name> --tail=200`.
3. Is NOT accessible to network observers or end-users.
4. Has built-in retention (default 7 days at the Free tier; longer on Pro+).

This is the LOAD-BEARING design choice — operators get full diagnostic detail without exposing it on the wire.

A future story can wire a Sentry-for-Deno integration into Edge Functions (Epic 16.X scope), at which point the `console.error` calls can be augmented (NOT replaced) with `Sentry.captureMessage(...)` calls. The operator-visible-only contract is preserved either way.

### Why a 2000-char truncation on the logged body?

Defensive measure against a hung upstream returning a multi-MB HTML error page. 2000 chars is enough to capture (a) the full JSON error shape from OpenAI / Azure, (b) the top of an HTML 5xx page (status line + first paragraph), (c) the most informative fragment of any plain-text error. Beyond 2000 chars the marginal diagnostic value falls off quickly while log-storage cost rises linearly. Pattern mirrors the Story 9-4 `MAX_MEMORY_CHARS = 300` truncation and Story 11-7 `MAX_PROMPT_ITEM_CHARS = 80` truncation — bounded log/storage budgets are a project-wide discipline.

### Why generic message `"Upstream API error (status N)"` instead of `"Upstream returned N"`?

The pre-12-11 message format `"Upstream returned ${status}"` is similar in spirit but lives only on the body-read-timeout path. The post-12-11 unified format reuses the `"status N"` substring discipline so the client-side `isRetryable()` regex's HTTP-status-code matches (`"500"`, `"502"`, `"503"`, `"429"`) still trigger retries correctly. Pinned by deliverable (c)'s 6-case Jest test.

### Why kebab-case lowercase `upstreamLabel` values?

ASCII-only short categorical strings — safe for log-grep + safe for the Story 9-3 80-char redaction threshold + matches the project's existing feature-tag naming convention (`"email-verification-resend"`, `"email-verification-refresh"`, `"signup"`, etc.). The drift detector pins the format via regex.

### Sentry / client-side telemetry impact

Zero. The `code: "UPSTREAM_ERROR"` field of the response body is the categorical signal the client-side `captureError(err, "feature-tag")` already records via Story 9-3's `feature` extras key. The pre-12-11 leak path went through the response body's `message` field, which the client surfaced via `error.message` in JS — that's the surface this story shuts off.

### Spec — `parseUpstreamError` shape

```typescript
import { ERROR_BODY_READ_TIMEOUT_MS, withTimeout } from "./fetch-with-timeout.ts";

const MAX_LOGGED_BODY_CHARS = 2000;

/**
 * Read an upstream error response body, log it to operator-visible function
 * logs via `console.error` with the `[upstream-error]` prefix, and return a
 * GENERIC message to the caller that contains ONLY the HTTP status code.
 *
 * The return value NEVER carries upstream content — this is Story 12-11's
 * load-bearing security property. Operators retrieve the full diagnostic
 * detail from Supabase function logs (see runbook `upstream-error-debugging.md`).
 *
 * @param upstreamLabel categorical short string (kebab-case ASCII) identifying
 *   which upstream this is — one of: "openai-chat-or-embedding", "openai-whisper",
 *   "openai-realtime-token", "azure-tts", "azure-pronunciation". Flows ONLY to
 *   the console.error log line, never to the client response.
 */
export async function parseUpstreamError(
  response: Response,
  upstreamLabel: string
): Promise<string> {
  const status = response.status;
  let rawText: string;
  try {
    rawText = await withTimeout("error-body-read", response.text(), ERROR_BODY_READ_TIMEOUT_MS);
  } catch {
    console.error(`[upstream-error] ${upstreamLabel} status=${status} body=body-read-timeout`);
    return `Upstream API error (status ${status})`;
  }
  const truncated =
    rawText.length > MAX_LOGGED_BODY_CHARS
      ? rawText.slice(0, MAX_LOGGED_BODY_CHARS) + "... (truncated)"
      : rawText;
  console.error(`[upstream-error] ${upstreamLabel} status=${status} body=${truncated}`);
  return `Upstream API error (status ${status})`;
}
```

The pre-12-11 JSON-parsing branch (lines 123-145) is DELETED — operators get the FULL body via console.error so the JSON-pretty-reformat lost its purpose.

## Acceptance Criteria

1. **`parseUpstreamError` signature updated.** [`supabase/functions/_shared/errors.ts`](supabase/functions/_shared/errors.ts) `parseUpstreamError` accepts a 2nd parameter `upstreamLabel: string`. Body reads upstream content via the existing Story 11-3 `withTimeout`/`ERROR_BODY_READ_TIMEOUT_MS` flow. Body content is logged via `console.error("[upstream-error] ${upstreamLabel} status=${status} body=${truncated}")` with truncation at 2000 chars (`MAX_LOGGED_BODY_CHARS`). Return value is ALWAYS `"Upstream API error (status ${status})"` — NEVER includes upstream content. The pre-12-11 JSON-parsing branch (lines 123-145) is DELETED ("delete don't alias" pattern).

2. **All 5 caller sites updated.** Each of the 5 `parseUpstreamError(...)` calls in `supabase/functions/ai-proxy/index.ts` (3 calls), `supabase/functions/pronunciation-assess/index.ts` (1 call), and `supabase/functions/realtime-session/index.ts` (1 call) passes a non-empty kebab-case lowercase ASCII string as the 2nd argument. Assigned labels: `"azure-tts"` / `"openai-whisper"` / `"openai-chat-or-embedding"` / `"azure-pronunciation"` / `"openai-realtime-token"`. The wrapping `errorResponse({message: "<UI label> error: ${upstreamMessage}", ...})` stays verbatim — only the upstreamMessage value changes (now generic).

3. **Operator runbook exists.** [`_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md`](_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md) is created with at least 4 sections: (§1) post-12-11 contract (clients see generic; operators see full); (§2) log-retrieval recipe via Supabase CLI + Dashboard; (§3) the 6 categorical labels with intent; (§4) cross-story dependencies + the drift detector contract.

4. **Jest drift detector test exists.** [`src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts`](src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts) covers the 6 cases enumerated in deliverable (e). Reads all 3 Edge Function files + `errors.ts` from disk; pins signature + return-value template + deleted-branch absence + per-call-site label + console.error log + per-file caller count. Uses comment-stripping where needed (Story 12-2 P12 lesson).

5. **Deno-runnable runtime test exists.** [`supabase/functions/_shared/__tests__/parse-upstream-error_test.ts`](supabase/functions/_shared/__tests__/parse-upstream-error_test.ts) covers the 7 cases enumerated in deliverable (f). Manual-run via `deno test --allow-all supabase/functions/_shared/__tests__/parse-upstream-error_test.ts`. Epic 15.3 owns CI wiring.

6. **Client-side `isRetryable` compatibility verified.** [`src/lib/__tests__/upstream-error-sanitization.test.ts`](src/lib/__tests__/upstream-error-sanitization.test.ts) covers ≥ 6 cases asserting `isRetryable(new Error("Upstream API error (status N)"))` matches the pre-12-11 retry behavior for N ∈ {429, 500, 502, 503, 400, 401}. Specifically: 429/500/502/503 retry → true; 400/401 retry → false.

7. **Quality gates green.** `npm run type-check && npm run lint && npm run format:check && npx jest` all pass. Total Jest case count rises by ≈ 12 (6 drift + 6 retry-compat).

8. **CLAUDE.md architecture paragraph added** after the Story 12-10 review-round-1 entry documenting: the new signature + operator-visible-only log channel + 6 categorical labels + runbook path + cross-story zero-product-code-app-side-effects + closed P1-14.

9. **Zero client-side `app/` / `src/components/` / `src/hooks/` diff.** `git diff main..HEAD -- app/ src/components/ src/hooks/ src/store/ src/types/` returns empty. The only `src/` change is the 2 new test files at `src/lib/__tests__/`.

10. **No new packages, no migrations.** `package.json` + `package-lock.json` zero-diff. `supabase/migrations/` zero-diff.

11. **Cross-story invariants preserved.**
    - Story 9-3: no new feature tags / extras keys in `SENTRY_EXTRAS_ALLOWLIST`.
    - Story 11-3: `withTimeout("error-body-read", ..., ERROR_BODY_READ_TIMEOUT_MS)` flow preserved.
    - Story 11-4: `daily_cost_ledger` / rate-limit RPCs unchanged.
    - Stories 12-1 through 12-10: orthogonal; zero product-code change.

12. **Sprint-status flipped.** `12-11-edge-function-error-sanitization` transitions `backlog → ready-for-dev → in-progress → review` over the implementation cycle. `last_updated` header bumped.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens — **N/A** (no UI in this story).
- [x] All loading states use skeleton animations — **N/A**.
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — **N/A**.
- [x] Non-obvious interactions have `accessibilityHint` — **N/A**.
- [x] Stateful elements have `accessibilityState` — **N/A**.
- [x] All tappable elements have minimum 44x44pt touch targets — **N/A**.
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — **N/A** (this is Edge Function server-side code; `console.error` is the appropriate channel for the Deno runtime).
- [x] All text uses `Typography.*` presets — **N/A**.
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npx jest`.

### Y. GitHub Actions Injection Vector Check

<!--
  Story 9-9 retro lesson: every workflow-modifying story must pin its injection-vector check. Story 12-11 does NOT modify any workflow file — so this section is N/A. Confirmed by `git diff main..HEAD -- .github/` returning empty in the final diff.
-->

- [x] **N/A** — Story 12-11 modifies Edge Function source code only. No workflow files touched. `git diff main..HEAD -- .github/` MUST return empty.

### Story File Self-Check (run after writing this file)

<!--
  Story 9-9 retro lesson: `_bmad*` blanket gitignore could silently drop story files.
-->

- [x] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-11-edge-function-error-sanitization.md` passes.

## Tasks / Subtasks

- [x] **Task 1 — Refactor `supabase/functions/_shared/errors.ts`** (AC: #1)
  - [x] Subtask 1.1: Add `MAX_LOGGED_BODY_CHARS = 2000` constant.
  - [x] Subtask 1.2: Update `parseUpstreamError` signature to `(response: Response, upstreamLabel: string): Promise<string>`.
  - [x] Subtask 1.3: Preserve the existing `withTimeout("error-body-read", ..., ERROR_BODY_READ_TIMEOUT_MS)` flow.
  - [x] Subtask 1.4: On timeout-read-error: `console.error(...body=body-read-timeout)` + return `"Upstream API error (status ${status})"`.
  - [x] Subtask 1.5: On successful read: truncate at `MAX_LOGGED_BODY_CHARS`, `console.error(...body=${truncated})`, return generic.
  - [x] Subtask 1.6: DELETE the JSON-parsing branch at lines 123-145 ("delete don't alias" pattern).
  - [x] Subtask 1.7: Add JSDoc explaining the contract + log retrieval recipe (cross-reference to the runbook).

- [x] **Task 2 — Update 5 caller sites** (AC: #2)
  - [x] Subtask 2.1: `ai-proxy/index.ts:271-272` Azure TTS → 2nd arg `"azure-tts"`.
  - [x] Subtask 2.2: `ai-proxy/index.ts:420-421` OpenAI Whisper → 2nd arg `"openai-whisper"`.
  - [x] Subtask 2.3: `ai-proxy/index.ts:447-448` OpenAI chat/embedding → 2nd arg `"openai-chat-or-embedding"`.
  - [x] Subtask 2.4: `pronunciation-assess/index.ts:164-165` Azure Speech → 2nd arg `"azure-pronunciation"`.
  - [x] Subtask 2.5: `realtime-session/index.ts:148` OpenAI Realtime token → 2nd arg `"openai-realtime-token"`.
  - [x] Subtask 2.6: Verify the wrapping `errorResponse({code:"UPSTREAM_ERROR", message:"<UI label> error: ${upstreamMessage}", ...})` is preserved byte-for-byte at each site.

- [x] **Task 3 — Create operator runbook** (AC: #3)
  - [x] Subtask 3.1: Create `_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md` with the 4 sections.
  - [x] Subtask 3.2: § 1 — post-12-11 contract (client-visible: generic; operator-visible: full).
  - [x] Subtask 3.3: § 2 — Supabase CLI + Dashboard log-retrieval recipes with sample log lines.
  - [x] Subtask 3.4: § 3 — categorical label allowlist + filter recipes.
  - [x] Subtask 3.5: § 4 — cross-story dependencies + drift detector contract.

- [x] **Task 4 — Add Jest drift detector test** (AC: #4)
  - [x] Subtask 4.1: Create `src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts`.
  - [x] Subtask 4.2: Case 1: `parseUpstreamError` signature contains `upstreamLabel: string`.
  - [x] Subtask 4.3: Case 2: return-value template `"Upstream API error (status "` present.
  - [x] Subtask 4.4: Case 3: NEGATIVE — no `return rawText` / `return parsed.message` / `return ${...message}` patterns.
  - [x] Subtask 4.5: Case 4: each of the 5 caller sites passes a kebab-case lowercase string as 2nd arg.
  - [x] Subtask 4.6: Case 5: `console.error("[upstream-error]"...)` present.
  - [x] Subtask 4.7: Case 6: per-file caller count — `ai-proxy/index.ts` has 3 calls; `pronunciation-assess/index.ts` has 1; `realtime-session/index.ts` has 1.

- [x] **Task 5 — Add Deno-runnable runtime test** (AC: #5)
  - [x] Subtask 5.1: Create `supabase/functions/_shared/__tests__/parse-upstream-error_test.ts`.
  - [x] Subtask 5.2: 7 cases per deliverable (f) — JSON / plain text / HTML / empty / timeout / truncation / no-content-leak.
  - [x] Subtask 5.3: Document the manual-run recipe in the file header (mirror Story 11-3 pattern).

- [x] **Task 6 — Add client-side compatibility test** (AC: #6)
  - [x] Subtask 6.1: Create `src/lib/__tests__/upstream-error-sanitization.test.ts`.
  - [x] Subtask 6.2: 6 cases asserting `isRetryable(new Error("Upstream API error (status N)"))` for N ∈ {429, 500, 502, 503, 400, 401}.

- [x] **Task 7 — Quality gates + CLAUDE.md + sprint-status** (AC: #7, #8, #11, #12)
  - [x] Subtask 7.1: Run `npm run type-check && npm run lint && npm run format:check && npx jest`. All exit 0.
  - [x] Subtask 7.2: Append Story 12-11 paragraph to `CLAUDE.md` after the Story 12-10 review-round-1 entry.
  - [x] Subtask 7.3: Update `sprint-status.yaml` header `last_updated` + flip `12-11` transition at dev-start.

## Dev Notes

### Branching guidance

Per project memory ([`feedback_branch_from_main`](../../../.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/feedback_branch_from_main.md)): branch `feature/12-11-edge-function-error-sanitization` from `origin/main`. Do not stack on the prior story's in-flight branch.

### Project conventions to follow

- **Edge Function code lives under `supabase/functions/`** — Deno runtime, not Node.
- **`console.error` is the operator-visible log channel** for Edge Functions; Sentry-for-Deno is NOT initialized today.
- **Drift detector pattern** — Story 12-9 / 12-10 source-drift tests read source files from disk + apply regex assertions (with comment-stripping per Story 12-2 P12). Reuse for the Edge Function paths.
- **Deno-runnable test pattern** — Story 11-3's `fetch-with-timeout_test.ts` at `supabase/functions/_shared/__tests__/` establishes the manual-run-via-`deno test` precedent. Epic 15.3 owns CI integration.
- **TypeScript strict mode** — all new code passes `tsc --noEmit`.
- **Sentry contract (Story 9-3)** — no new allowlist keys; the `code: "UPSTREAM_ERROR"` field of the response body carries the categorical signal.

### Cross-story invariants worth re-checking before merge

- Story 9-3 `SENTRY_EXTRAS_ALLOWLIST`: zero-diff.
- Story 11-3 `withTimeout` / `ERROR_BODY_READ_TIMEOUT_MS`: preserved byte-for-byte.
- Story 11-4 cost-ledger RPCs: unchanged.
- Stories 12-1 through 12-10: zero product-code-app diff.
- Client-side `isRetryable` regex: unchanged; new generic message matches via HTTP-status substring.

### Known footguns (from prior story retros)

- **Story 9-9 lesson**: any CI workflow modification needs the `Y. GHA Injection Vector Check` section completed. Story 12-11 does NOT modify workflows (`git diff main..HEAD -- .github/` MUST return empty); the section is N/A but kept for template consistency.
- **Story 12-2 P12 lesson**: drift detectors reading source from disk must strip comments first so JSDoc mentioning deprecated patterns doesn't trip negative-guard regexes.
- **Story 12-8 R2-P3 lesson**: if a drift detector needs to count `parseUpstreamError(...)` calls and the args span multiple lines or contain string literals with `)`, use the string-literal-aware balanced-paren walker.
- **Story 12-10 H1 lesson**: drift detector regexes should be anchored to specific lines / functions / blocks, not whole-file substring matches — the latter false-positive on comments and false-negative on disabled code paths.
- **Deno test ESM imports**: the `parse-upstream-error_test.ts` file uses Deno-style relative imports (`../errors.ts`, `https://deno.land/std@.../assert/mod.ts`) — Jest will refuse to load it, hence the separate Deno-runnable test directory.
- **Truncation marker preservation**: a future operator searching logs for `... (truncated)` should be able to filter at-cap bodies; the exact string is pinned by the runtime test (deliverable f case vi).
- **Backward compatibility with isRetryable**: the new generic message `"Upstream API error (status N)"` MUST contain the HTTP status code substring so the client-side regex at `openai.ts:76-94` still triggers retries. Pinned by deliverable (c)'s test.

### Project Structure Notes

| Path | Action | Rationale |
| --- | --- | --- |
| `supabase/functions/_shared/errors.ts` | MODIFY | Refactor `parseUpstreamError`: new signature + console.error logging + delete JSON-parsing branch. |
| `supabase/functions/ai-proxy/index.ts` | MODIFY | 3 caller sites pass new `upstreamLabel` argument. |
| `supabase/functions/pronunciation-assess/index.ts` | MODIFY | 1 caller site. |
| `supabase/functions/realtime-session/index.ts` | MODIFY | 1 caller site. |
| `supabase/functions/_shared/__tests__/parse-upstream-error_test.ts` | NEW | 7 Deno-runnable runtime cases. |
| `src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts` | NEW | 6 Jest drift-detector cases. |
| `src/lib/__tests__/upstream-error-sanitization.test.ts` | NEW | 6 Jest `isRetryable` compatibility cases. |
| `_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md` | NEW | Operator runbook (4 sections). |
| `CLAUDE.md` | MODIFY | Architecture paragraph after Story 12-10 review-round-1 entry. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | MODIFY | 12-11 status transitions + `last_updated` header. |
| `_bmad-output/implementation-artifacts/12-11-edge-function-error-sanitization.md` | MODIFY | Status: ready-for-dev → in-progress → review during impl. |
| `package.json` / `package-lock.json` | **NO CHANGE** | No new deps. |
| `app/`, `src/components/`, `src/hooks/`, `src/store/`, `src/types/` | **NO CHANGE** | Zero product-code diff. |
| `src/lib/openai.ts`, `src/lib/sentry.ts` | **NO CHANGE** | `isRetryable` regex preserved; allowlist preserved. |
| `supabase/migrations/` | **NO CHANGE** | No schema changes. |
| `.github/workflows/` | **NO CHANGE** | Edge Function source changes only; no CI gate changes. |

### References

- [Source: shippable-roadmap.md#66 — P1-14 audit finding]
- [Source: shippable-roadmap.md#214 — Epic 12.11 deliverable]
- [Source: supabase/functions/_shared/errors.ts:105-146 — current `parseUpstreamError` implementation]
- [Source: supabase/functions/_shared/fetch-with-timeout.ts — `withTimeout` + `ERROR_BODY_READ_TIMEOUT_MS` (Story 11-3)]
- [Source: src/lib/openai.ts:76-94 — `isRetryable` regex contract (Story 11-8)]
- [Source: src/lib/sentry.ts:25,67 — `SENTRY_EXTRAS_ALLOWLIST` + 80-char redaction (Story 9-3)]
- [Source: supabase/functions/_shared/__tests__/fetch-with-timeout_test.ts — Deno-runnable test precedent (Story 11-3)]
- [Source: src/lib/__tests__/ci-audit-gate-source-drift.test.ts — drift detector precedent (Story 12-10 review-round-1 H1)]
- [Source: src/lib/__tests__/email-verification-source-drift.test.ts — drift detector precedent (Story 12-9 M5)]
- [Source: _bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md — runbook structure precedent (Story 12-10)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`; sprint-status flipped `backlog → ready-for-dev`.
- Implementation 2026-05-14 on branch `feature/12-11-edge-function-error-sanitization` (branched from `main` post-12-10 PR #85 merge per project memory `feedback_branch_from_main`).
- Drift detector + isRetryable compatibility tests run via Jest; Deno-runnable runtime test is manual-run only (Deno not installed locally; Epic 15.3 owns CI wiring per Story 11-3 precedent).
- All 4 quality gates green: tsc 0 errors, lint 0 warnings, prettier clean, jest 1590/1590.

### Completion Notes List

- **Task 1 done.** [`supabase/functions/_shared/errors.ts`](supabase/functions/_shared/errors.ts) `parseUpstreamError` refactored with new signature `(response: Response, upstreamLabel: string): Promise<string>`. Body content logged via `console.error("[upstream-error] ${upstreamLabel} status=${status} body=${truncated}")`. Truncation at `MAX_LOGGED_BODY_CHARS = 2000` with `... (truncated)` marker. Return value is ALWAYS `"Upstream API error (status ${status})"` — generic, no upstream content. Body-read-timeout path converged with successful-read path via same generic return + `body=body-read-timeout` log marker. Pre-12-11 JSON-parsing branch (lines 123-145) DELETED. Story 11-3 `withTimeout("error-body-read", ..., ERROR_BODY_READ_TIMEOUT_MS)` flow preserved byte-for-byte.
- **Task 2 done.** All 5 caller sites updated with kebab-case labels:
  - `ai-proxy/index.ts:271` → `"azure-tts"`
  - `ai-proxy/index.ts:420` → `"openai-whisper"`
  - `ai-proxy/index.ts:447` → `"openai-chat-or-embedding"`
  - `pronunciation-assess/index.ts:164` → `"azure-pronunciation"`
  - `realtime-session/index.ts:148` → `"openai-realtime-token"`
  Each call site's wrapping `errorResponse({code:"UPSTREAM_ERROR", message:"<UI label> error: ${upstreamMessage}", ...})` shape is preserved verbatim.
- **Task 3 done.** New operator runbook at [`_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md`](_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md) (5 sections: § 1 post-12-11 contract / § 2 Supabase CLI + Dashboard log-retrieval recipes with sample log line shapes / § 3 categorical label allowlist with intent column / § 4 cross-story dependencies + drift detector contract / § 5 operator decision log seeded with Story 12-11 baseline entry).
- **Task 4 done.** New Jest drift detector at [`src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts`](src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts) — 6/6 cases GREEN: signature pin + return-value template positive + NEGATIVE no-`return rawText`/`return parsed.message`/`return errObj.message`/`return parts.join` + per-caller label arg + `console.error("[upstream-error]"...)` operator-log pin + per-file caller counts pinned to 3/1/1. Uses comment-stripping (Story 12-2 P12 lesson) + function-body extraction (Story 12-10 H1 lesson — scoped to function, not whole-file).
- **Task 5 done.** New Deno-runnable runtime test at [`supabase/functions/_shared/__tests__/parse-upstream-error_test.ts`](supabase/functions/_shared/__tests__/parse-upstream-error_test.ts) — 7 cases: JSON-shaped upstream / plain-text / HTML 5xx / empty body / body-read timeout / 2000-char truncation marker / no-content-leak across 5 canonical leak vectors. Manual-run via `deno test --allow-all`. Epic 15.3 owns CI wiring.
- **Task 6 done.** New client-side compatibility test at [`src/lib/__tests__/upstream-error-sanitization.test.ts`](src/lib/__tests__/upstream-error-sanitization.test.ts) — 6/6 cases GREEN: `isRetryable(new Error("Upstream API error (status N)"))` returns the same boolean for N ∈ {429, 500, 502, 503, 400, 401} as it did pre-12-11. Confirms retry parity preserved by construction via HTTP-status substring.
- **Task 7 done.** All 4 quality gates green: `npx tsc --noEmit` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (clean post auto-format), `npx jest` (**1590/1590 passing**, +12 net 1578→1590 — matches spec target exactly). CLAUDE.md gained the Story 12-11 architecture paragraph after the Story 12-10 review-round-1 entry.
- **Cross-story invariants verified clean:** `git diff main..HEAD -- app/ src/components/ src/hooks/ src/store/ src/types/` returns empty. `package.json` + `package-lock.json` zero-diff. `supabase/migrations/` zero-diff. `.github/workflows/` zero-diff. `src/lib/sentry.ts` zero-diff (no allowlist changes).
- **Operator-visible-only log channel** is the LOAD-BEARING design choice that closes P1-14. Operators retrieve full upstream-error context via Supabase function logs (Dashboard or CLI); clients see only the generic message + HTTP status code.
- **Closes audit P1-14** architecturally.

### File List

**New files:**
- `supabase/functions/_shared/__tests__/parse-upstream-error_test.ts` — 7 Deno-runnable runtime cases (manual-run; Epic 15.3 wires CI).
- `src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts` — 6 Jest drift detector cases.
- `src/lib/__tests__/upstream-error-sanitization.test.ts` — 6 Jest isRetryable compatibility cases.
- `_bmad-output/planning-artifacts/runbooks/upstream-error-debugging.md` — operator runbook (5 sections).

**Modified files:**
- `supabase/functions/_shared/errors.ts` — `parseUpstreamError` refactored: new signature + console.error logging + generic return + DELETED JSON-parsing branch + `MAX_LOGGED_BODY_CHARS = 2000` constant.
- `supabase/functions/ai-proxy/index.ts` — 3 caller sites updated with labels.
- `supabase/functions/pronunciation-assess/index.ts` — 1 caller site updated.
- `supabase/functions/realtime-session/index.ts` — 1 caller site updated.
- `CLAUDE.md` — Story 12-11 architecture paragraph appended after Story 12-10 review-round-1 entry.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 12-11 status `backlog → in-progress → review` + `last_updated` header.
- `_bmad-output/implementation-artifacts/12-11-edge-function-error-sanitization.md` — Tasks/Subtasks checked + Dev Agent Record filled + Status: review.

**Explicitly NOT modified:**
- `app/`, `src/components/`, `src/hooks/`, `src/store/`, `src/types/` — zero client-app diff.
- `package.json`, `package-lock.json` — no new deps.
- `src/lib/sentry.ts` — no allowlist changes.
- `src/lib/openai.ts` — `isRetryable` regex preserved; HTTP-status substring still matches new generic message.
- `supabase/migrations/` — no schema changes.
- `.github/workflows/` — no CI changes (Edge Function source only).
- Other Edge Functions (`account-delete`, `notification-register`, `send-notifications`) — they don't use `parseUpstreamError`.
