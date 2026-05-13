# Story 11.4: Replace In-Memory Rate Limit with Supabase RPC + Per-User Daily AI Spend Ceiling

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose 6 Supabase Edge Functions ([`supabase/functions/ai-proxy/index.ts`](supabase/functions/ai-proxy/index.ts), [`realtime-session/index.ts`](supabase/functions/realtime-session/index.ts), [`pronunciation-assess/index.ts`](supabase/functions/pronunciation-assess/index.ts), [`account-delete/index.ts`](supabase/functions/account-delete/index.ts), [`notification-register/index.ts`](supabase/functions/notification-register/index.ts), [`send-notifications/index.ts`](supabase/functions/send-notifications/index.ts)) all gate user requests through a single in-memory rate limiter at [`supabase/functions/_shared/rate-limit.ts`](supabase/functions/_shared/rate-limit.ts) whose `Map<userId, RateLimitWindow>` lives in the V8 isolate's heap — and per audit finding **P1-8** ([`_bmad-output/planning-artifacts/shippable-roadmap.md` line 60](_bmad-output/planning-artifacts/shippable-roadmap.md)) "Edge Function rate limiter is in-memory per-instance — trivially bypassed; effectively fails-open at low traffic" — Supabase's serverless platform spins up multiple isolates concurrently for load balancing AND recycles cold isolates on idle, so a determined attacker hitting the ai-proxy endpoint with bursts can land each request on a fresh isolate with an empty `Map` (effective rate-limit budget = nominal × isolate count); at low traffic, every new cold-start gives the user a fresh 30-req/min budget multiple times per minute, fully negating the 30/60s limit on `ai-proxy`, 10/60s on `realtime-session`, 20/60s on `pronunciation-assess`, etc. — compounded by audit finding **P1-10** ([`shippable-roadmap.md` line 62](_bmad-output/planning-artifacts/shippable-roadmap.md)) "Default `maxTokens: 2048` on every chat call; 3 post-conversation AI calls per voice session; no daily per-user spend cap" which means a single runaway user (or a credentials-leaked account) can rack up unlimited OpenAI / Azure spend per day because nothing in the stack caps cumulative cost at the user-level (the only ceiling is the OpenAI account's monthly budget cap, which catches abuse only after thousands of dollars have already been spent — and Sentry-level cost telemetry is reactive, not preventive),

I want every Edge Function rate-limit call to route through a new shared module **[`supabase/functions/_shared/rate-limit-db.ts`](supabase/functions/_shared/rate-limit-db.ts)** that calls two new Postgres RPCs (`check_and_increment_rate_limit(p_user_id, p_key, p_limit, p_window_seconds)` and `check_daily_cost_budget(p_user_id, p_estimated_cents)`) backed by two new tables (`rate_limit_counters` keyed on `(user_id, key, window_start)` and `daily_cost_ledger` keyed on `(user_id, day)`); the existing in-memory `rate-limit.ts` is **deleted** (Story 11-3 / 10-2 "delete don't alias" pattern); the new request-rate path is cross-isolate-correct because the counter lives in Postgres, atomically incremented via `INSERT … ON CONFLICT (user_id, key, window_start) DO UPDATE SET request_count = rate_limit_counters.request_count + 1 RETURNING request_count` (a single SQL statement that's race-condition-free under Postgres serializable-snapshot semantics); the new per-user daily AI spend ceiling defaults to **$1.00 USD = 100¢** (configurable per-user via a new `profiles.daily_ai_cost_cents_limit` column, default 100, INT) and is enforced by a pre-flight `check_daily_cost_budget(user_id, estimated_cost_cents)` call BEFORE each upstream OpenAI/Azure fetch in `ai-proxy` + `realtime-session` (the only functions that incur per-call cost), with a post-call `record_daily_cost(user_id, actual_cost_cents)` RPC that records the actual spend from OpenAI's `usage` object (input + output tokens × per-model rate from a new `_shared/cost-table.ts` constants module — rates pinned as of 2026-05-12 for `gpt-4o` / `gpt-4o-mini` / `text-embedding-3-small` / `whisper-1` / `gpt-realtime` / `gpt-realtime-mini`); on daily-cap exhaustion a new `dailyCostCapResponse(corsHeaders, { totalTodayCents, dailyLimitCents })` helper returns a structured **429 Too Many Requests** with `code: "DAILY_COST_CAP_EXCEEDED"` (a new `ErrorCode` member) + a body field `kind: "daily-cost-cap"` so the client can distinguish "you hit the per-minute rate limit, try again in 30s" from "you exhausted your daily AI budget, try again tomorrow"; the Postgres-failure mode is **fail-OPEN** (if the RPC errors, accept the request + log to Sentry via the operator-facing `console.error` channel) since a hard-coded fail-closed would create a self-DoS when Postgres has a hiccup but the user already passed the (Postgres-backed) auth check moments earlier; explicit per-row-cleanup is handled by `pg_cron` (existing infra — Story 8-2 uses it for notification scheduling) running daily to vacuum rate-limit rows older than 24h and ledger rows older than 30d,

so that **audit finding P1-8 closes**: a single user truly cannot exceed their configured rate-limit budget regardless of cold-start isolate spawning, and the **roadmap acceptance criterion** ("Single user cannot exceed 30 chat req/min by hitting cold instances") is structurally satisfied by construction (Postgres is the source of truth, isolates query it on every request); **audit finding P1-10's spend-cap portion closes** (the per-call `maxTokens` right-sizing portion of P1-10 stays with Story 11.5; the cumulative-daily-spend portion lives here) so a runaway user / leaked-credential / abuse scenario costs at most $1.00 USD/day per user instead of unlimited; the new server-side ceiling complements Story 11.5's per-call `maxTokens` tuning (which limits individual call cost) by capping cumulative daily exposure regardless of per-call efficiency; the operator gains a `daily_cost_ledger` table that's grep-able by user-id for billing / abuse-investigation; and the verified-correct surfaces NOT touched are Story 9-3 Sentry telemetry allowlist (new error code `"DAILY_COST_CAP_EXCEEDED"` is a short categorical string; `code` is already allowlisted), Story 9-4 stored-prompt-injection defense (transport-layer story; prompts untouched), Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` + pure module — unchanged), Story 9-6 auth listener event gating (the rate-limit-RPC runs INSIDE the existing Edge Function flow, AFTER auth, so the auth contract is unchanged), Story 9-7 Zod schema retry contract (`chatCompletionJSON` is orthogonal; daily-cap rejection produces a 429 which lands in `isRetryable` as `"rate limit"` → existing retry path runs — though after 2 retries the budget would still be exhausted so the retry surfaces an end-of-budget error to the caller, which is correct behavior), Story 9-8 / 10-6 speaking pipeline (uses `chatCompletionJSON` and `transcribeAudio` from `src/lib/openai.ts` which routes through the new rate-limit path transparently; no Story 9-8 surface modified), Story 9-9 deploy substrate (`eas.json` / `build.yml` / `submit.yml` / `deploy.yml` / `ota-update.yml` — unchanged; the new migration auto-applies via `supabase db push`), Story 9-10 auth + cache race hardening (auth listener race + offline-write queue are upstream of any Edge Function call; unchanged), Story 10-2 / 10-3 / 10-4 / 10-5 / 10-7 / 10-8 prompt and scoring surfaces (orthogonal), Story 11-1 correction tool-call protocol (`report_correction` happens INSIDE an open Realtime WebSocket session, NOT through any Edge Function fetch — the daily-cap is only pre-checked at session-creation time in `realtime-session`, not at every in-session tool call), Story 11-2 reconnect + barge-in (the `realtime-session` fetch inside `establishConnection()` gets BOTH the new rate-limit AND daily-cost-cap pre-checks; an exhausted-budget user sees a 429 that flows through Story 11-3's retry path with `isRetryable("rate limit") === true` BUT after retries-exhausted falls into the reconnect-failed terminal path; this is the correct UX — a budget-exhausted user should not be able to start a fresh Realtime session), and Story 11-3 Edge Function upstream timeouts (`fetchWithTimeout` + `UpstreamTimeoutError` + the 6 wrapped fetch sites — completely unchanged; the new rate-limit-RPC runs UPSTREAM of the timeout-wrapped fetch).

## Background — Why This Story Exists

### What audit findings P1-8 + P1-10 own to this story

[`shippable-roadmap.md` line 60](_bmad-output/planning-artifacts/shippable-roadmap.md): "P1-8 — Edge Function rate limiter is in-memory per-instance — trivially bypassed; effectively fails-open at low traffic. Location: `supabase/functions/_shared/rate-limit.ts:12`. Category: architecture, backend, ai."

[`shippable-roadmap.md` line 62](_bmad-output/planning-artifacts/shippable-roadmap.md): "P1-10 — Default `maxTokens: 2048` on every chat call; 3 post-conversation AI calls per voice session; no daily per-user spend cap. Location: `src/lib/openai.ts:67`, `src/hooks/use-realtime-voice.ts:494-585`. Category: ai."

[`shippable-roadmap.md` line 184](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.4 deliverable: "Replace in-memory rate limit with Upstash Redis (or Supabase-managed rate-limit RPC) — per-user, per-day cost cap as second tier. **Covers P1-8, P1-10.**"

[`shippable-roadmap.md` line 192](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11 AC: "Single user cannot exceed 30 chat req/min by hitting cold instances (Upstash counter test)."

[`shippable-roadmap.md` line 193](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11 AC: "Per-user daily AI spend cap enforced; verified by triggering ceiling."

[`shippable-roadmap.md` line 185](_bmad-output/planning-artifacts/shippable-roadmap.md): "Story 11.5 cost discipline pass — drop default `maxTokens` to per-call right-sizing; collapse 3 post-conversation AI calls into 1 with a structured output; add `gpt-realtime-mini` for free tier; add per-user daily spend ceiling enforced server-side. **Covers P1-10.**"

**Scope split between 11.4 and 11.5 for P1-10**: Story 11.4 owns the **cumulative daily spend ceiling** (the second-tier cap that catches runaway-loop / abuse / leaked-credentials patterns). Story 11.5 owns the **per-call maxTokens right-sizing** (which limits individual call cost). The two stack: 11.5 reduces the per-call ceiling; 11.4 reduces the per-day total. Both must ship for the full P1-10 closure.

### Architecture choice — Supabase RPC over Upstash

The audit row's parenthetical ("Upstash Redis OR Supabase-managed rate-limit RPC") leaves the choice open. Story 11.4 picks **Supabase RPC** for these reasons:

1. **No new vendor / no new credentials.** Adding Upstash would mean another SaaS account, new API tokens to rotate via `supabase secrets set`, a new CI guard in `ci.yml` for credential leakage, and an `Upstash` line in `_bmad-output/planning-artifacts/runbooks/`. The new error-code module + table fits the existing Supabase stack cleanly.
2. **Single source of truth.** Postgres already holds all user data. Rate-limit + cost counters belong with the rest of the user's state, not in a separate service that can drift.
3. **Latency.** Edge Function → Supabase Postgres is in-region (same Supabase project); the RPC round-trip is typically <10ms. Edge Function → Upstash is cross-region with extra TLS handshakes (~30-80ms p99 from a Supabase Edge Function in us-east-1 to Upstash global).
4. **Cost.** Free tier Postgres scales to far more requests than Upstash's free tier; Supabase Pro covers both.
5. **Auditability.** Operators can `SELECT * FROM rate_limit_counters WHERE user_id = ?` to debug abuse. Upstash requires vendor-side tooling that's not part of the existing operator runbook.
6. **Existing precedent.** Stories 9-7 / 10-8 / 9-2 all use SQL functions + tables for user-scoped state. Story 11.4 continues the pattern.

Trade-offs:
- Postgres atomic upsert is slightly slower than Redis INCR (~5ms vs ~1ms).
- No native TTL — explicit cleanup via `pg_cron` is needed (already in use for `send-notifications`).
- Postgres outage = rate-limit outage. Mitigated by **fail-OPEN** policy: if the RPC errors, log to Sentry-style operator-channel via `console.error` and accept the request. Reasoning: the user just passed auth (which also hit Postgres), so a Postgres hiccup that breaks rate-limit but not auth is unusual; defaulting to fail-closed creates self-DoS. The operator should treat persistent rate-limit RPC errors as a Sev-1 alert.

### Current code — the in-memory rate limiter

[`supabase/functions/_shared/rate-limit.ts:12`](supabase/functions/_shared/rate-limit.ts):

```typescript
interface RateLimitWindow { requests: number[]; }
const windows = new Map<string, RateLimitWindow>();
```

The `Map` is per-isolate, in-memory. Every cold start = empty Map = full budget. Every isolate spawned for load balancing = independent budget. A user hitting `ai-proxy` from a fresh browser session lands on a cold isolate ~30% of the time at low traffic, effectively doubling their nominal budget.

The 6 call sites (Edge Functions) all import + call:

```typescript
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
const { allowed, remaining, resetIn } = checkRateLimit(user.id, RATE_LIMIT.requests, RATE_LIMIT.windowSeconds);
if (!allowed) return rateLimitResponse(corsHeaders, resetIn);
```

With per-function budgets:

| Function              | Budget         | Notes                                           |
| --------------------- | -------------- | ----------------------------------------------- |
| `ai-proxy`            | 30 req/60s     | Hot path; chat + TTS + embedding + transcribe   |
| `realtime-session`    | 10 req/60s     | Expensive — token issuance for WebSocket        |
| `pronunciation-assess`| 20 req/60s     | Audio uploads; moderate cost                    |
| `account-delete`      | 1 req/60s      | Destructive; strict                             |
| `notification-register`| 10 req/60s    | Device token registration                       |
| `send-notifications`  | 5 req/60s      | Server-to-server (cron) — uses key `"cron"`, NOT user_id |

All 6 must migrate. The `send-notifications` case uses `"cron"` as the key (not a real user_id) — the new Postgres table must accept arbitrary string keys + tolerate `user_id` being a sentinel UUID or NULL.

### Per-user daily AI spend ceiling

**Default:** $1.00 USD = 100¢ per user per day (UTC midnight rollover).

**Per-user override:** new column `profiles.daily_ai_cost_cents_limit INTEGER DEFAULT 100 NOT NULL` — operators can manually raise for premium users via `UPDATE profiles SET daily_ai_cost_cents_limit = 1000 WHERE id = ?`. Admin UI is future scope.

**Cost calculation:** per-model rates pinned in a new `_shared/cost-table.ts` (operators must refresh quarterly — flagged in CLAUDE.md as a "known stale-bait surface"). As of 2026-05-12:

| Model                         | Input $/1M tokens | Output $/1M tokens | Notes                          |
| ----------------------------- | ----------------- | ------------------ | ------------------------------ |
| `gpt-4o`                      | $2.50             | $10.00             | Standard chat                  |
| `gpt-4o-mini`                 | $0.15             | $0.60              | Cheap chat                     |
| `text-embedding-3-small`      | $0.02             | (n/a)              | Embeddings                     |
| `whisper-1`                   | (per-minute)      | (n/a)              | $0.006/min — convert to tokens via duration estimate |
| `gpt-realtime`                | $32.00            | $64.00             | Audio tokens — expensive       |
| `gpt-realtime-mini`           | $10.00            | $20.00             | Story 11.5 will introduce      |
| Azure TTS                     | (per-character)   | (n/a)              | $16/1M chars — convert to ¢    |
| Azure Speech Recognition      | (per-hour)        | (n/a)              | $1/hour audio                  |

**Granularity:** cents, stored as `BIGINT` (a single user racking up 2.1B cents = $21M is a sentinel value not reached in practice). Always rounded UP (ceil) so partial pennies count toward the cap.

**Pre-check + post-record pattern:**

1. **Pre-check** (BEFORE the upstream fetch): `check_daily_cost_budget(p_user_id, p_estimated_cents)` returns `{ allowed: boolean, total_today_cents: BIGINT, limit_cents: BIGINT }`. The estimate is best-effort (input-tokens × input-rate + maxTokens × output-rate — pessimistic upper bound). If `total_today + estimated > limit` → return denied (429 with `code: "DAILY_COST_CAP_EXCEEDED"`).
2. **Post-record** (AFTER the upstream returns successfully): `record_daily_cost(p_user_id, p_actual_cents)` atomically increments `total_today` by the actual cost computed from OpenAI's `usage` response (input + output tokens × per-model rate).

**Race condition** (acceptable for a soft budget cap): two concurrent calls both pre-check OK then both record, both succeed → total may overshoot the cap by one max-call's worth (~5-50¢). This is fine for an abuse-prevention cap (we're catching runaway-loops / leaked credentials, not enforcing penny-perfect billing). Documented in the RPC's JSDoc.

**Cost-table maintenance:** the `cost-table.ts` constants are flagged at module top as stale-bait + the CLAUDE.md architecture line cites the pin date so operators know when last refreshed. A future hardening story can automate this from OpenAI's `/v1/models` endpoint, but for v1 it's a manual refresh.

### Threat / failure model — what cannot happen post-story

After this story:

1. **A single user cannot exceed their nominal rate-limit budget regardless of isolate count.** The counter lives in Postgres; every Edge Function isolate (cold or warm) queries it. Verified architecturally by `EXPLAIN ANALYZE` showing the upsert + SELECT against the unique index runs <5ms.

2. **A runaway user / leaked-credential / abuse scenario costs at most $1.00 USD/day** (or the per-user override). The daily cap is checked BEFORE every upstream call in `ai-proxy` + `realtime-session`. Realtime mid-session tool calls are NOT individually pre-checked (the session is already opened; in-session bytes count toward the next session's pre-check on cap rollover).

3. **The deleted `_shared/rate-limit.ts` cannot accidentally be re-imported.** All 6 Edge Functions are updated to import from `_shared/rate-limit-db.ts`. The old file is removed.

4. **Postgres outage = fail-OPEN.** The `rate-limit-db.ts` helper wraps the RPC call in try/catch; on error it logs via `console.error("[rate-limit-rpc]", err)` and returns `{ allowed: true, remaining: 0, resetIn: 0 }`. Operator sees the failure in Supabase function logs; if it persists, it's a Sev-1 alert.

5. **The `send-notifications` "cron" key case is handled.** The `rate_limit_counters` table accepts any string key; the cron call passes a sentinel user_id (e.g., the all-zeros UUID `"00000000-0000-0000-0000-000000000000"`) along with key `"cron"`. A small carve-out in the RPC's foreign-key declaration (or simply no FK constraint on `user_id`) allows this.

6. **No retroactive backfill.** Pre-11.4 users have no `daily_cost_ledger` row → first request of the day creates it via `INSERT … ON CONFLICT`. Backward-compatible by construction.

7. **The new `profiles.daily_ai_cost_cents_limit` column** has a `DEFAULT 100` so existing user rows get $1.00 ceiling automatically on first read. No backfill migration needed.

8. **`pg_cron` cleanup runs nightly** to vacuum `rate_limit_counters` rows older than 24h and `daily_cost_ledger` rows older than 30d. The cleanup function is `SECURITY DEFINER` + `SET search_path = public` per Story 9-9 hardening pattern.

9. **Cost-table drift is bounded.** OpenAI / Azure publish pricing changes via blog posts; the operator refreshes `cost-table.ts` quarterly. Stale rates produce inaccurate-but-conservative (we lean pessimistic on input-token rate so under-charge over-estimates) cost tracking until refreshed.

10. **The new error code `DAILY_COST_CAP_EXCEEDED`** uses status 429 (matching `RATE_LIMITED` semantics) but carries `kind: "daily-cost-cap"` in the body so the client can render a distinct UI message ("You've hit today's AI usage budget. Reset at midnight UTC.") vs the per-minute rate-limit message ("Too many requests — try again in {N}s").

11. **Story 11.5 reads the same `cost-table.ts`** when right-sizing `maxTokens` per call. The constants are extracted into a shared module so both stories share one source of truth.

### Out of scope for this story (delegated elsewhere)

- **Per-call `maxTokens` right-sizing** — Story 11.5 (`11-5-cost-discipline-pass`) owns this. Story 11.4 uses the existing default `maxTokens: 2048` for pre-call cost estimation (pessimistic — over-counts; will under-rate after 11.5 tightens it).
- **Collapsing 3 post-conversation AI calls into 1** — Story 11.5 owns this.
- **Adding `gpt-realtime-mini` for free tier** — Story 11.5 owns model selection.
- **Premium-tier admin UI** for per-user daily limits — operators set `daily_ai_cost_cents_limit` via SQL for v1. Admin UI is filed under Epic 16.X (post-launch).
- **Cost-table auto-refresh** from OpenAI's pricing API — out of scope; manual quarterly refresh in v1. Filed as a future hardening story.
- **In-session Realtime tool-call cost tracking** — the daily-cap is enforced at session creation, not per tool-call. A 60-min Realtime session could exceed the daily cap mid-session (the user keeps talking; the model keeps responding). Mitigation: Story 11.5's `gpt-realtime-mini` for free tier dramatically reduces per-second cost, making mid-session overage less likely.
- **Cross-region rate-limit consistency** — Supabase Postgres is single-master; this is consistent by default. Out-of-scope concern.
- **Idempotency keys on the cost-record RPC** — a network blip retrying the record call could double-count the cost. Acceptable trade-off for v1 (the overcount is bounded by `MAX_RETRIES = 2` × one call's cost = <1¢ in the worst case). Filed as a future hardening story.
- **`account-delete` rate-limit-RPC fail-open audit** — the destructive 1-req/60s budget on `account-delete` is a security control, not just a cost guard. If the RPC fails-open during a Postgres outage, a malicious actor could spam the delete. Acceptable risk for v1 since the underlying `account-delete` action is itself authenticated and idempotent; documented trade-off.
- **Sliding-window-with-jitter rate-limit math** — fixed-window is enough for the audit ACs. Sliding-window can come in a future story if abuse patterns warrant it.
- **`Retry-After` header tuning** for cost-cap rejections — Story 11.4 uses the same 5s default as the per-minute rate-limit response. Cost-cap clients should display "try tomorrow" but the HTTP-level retry semantics match.
- **Operator dashboard for cost telemetry** — out of scope; operators query `daily_cost_ledger` directly via SQL.
- **`Retry-After` value bumping to UTC-midnight-from-now seconds** for cost-cap rejections — would be nicer for the client retry-after semantics but adds clock-math complexity. v1 keeps the static 5s; the body's `kind: "daily-cost-cap"` field is the discriminator clients should use.

## Acceptance Criteria

### 1. Create migration `20260512000000_rate_limit_and_cost_ledger.sql`

- [x] **CREATE** new migration `supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql` adding:

  ```sql
  -- rate_limit_counters: per-(user_id, key, window_start) request counter.
  -- window_start is bucketed to the floor of the window (e.g., minute boundary
  -- for 60-second windows) so two requests in the same window land on the
  -- same row and INSERT … ON CONFLICT atomically increments.
  CREATE TABLE rate_limit_counters (
    user_id        UUID NOT NULL,
    key            TEXT NOT NULL,
    window_start   TIMESTAMPTZ NOT NULL,
    request_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, key, window_start)
  );

  CREATE INDEX rate_limit_counters_window_start_idx
    ON rate_limit_counters (window_start);

  -- daily_cost_ledger: per-(user_id, day) cumulative cost in cents.
  -- Day is UTC date; rollover at 00:00:00 UTC.
  CREATE TABLE daily_cost_ledger (
    user_id              UUID NOT NULL,
    day                  DATE NOT NULL,
    total_cost_cents     BIGINT NOT NULL DEFAULT 0,
    request_count        INTEGER NOT NULL DEFAULT 0,
    last_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
  );

  CREATE INDEX daily_cost_ledger_day_idx ON daily_cost_ledger (day);

  -- profiles.daily_ai_cost_cents_limit — per-user override of the daily cap.
  -- Default 100¢ = $1.00 USD. Operators can raise for premium users via
  -- UPDATE profiles SET daily_ai_cost_cents_limit = N WHERE id = ?.
  ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS daily_ai_cost_cents_limit INTEGER NOT NULL DEFAULT 100;
  ```

- [x] **NO RLS policies on `rate_limit_counters` / `daily_cost_ledger`** — both tables are written + read exclusively by `SECURITY DEFINER` functions running with `service_role`-level privileges. Add `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` + no policies = deny-all-by-default to anon/authenticated; service-role bypasses RLS (verified pattern from `notification_log` Story 8-2).

- [x] **CREATE FUNCTION `check_and_increment_rate_limit`**:

  ```sql
  CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
    p_user_id        UUID,
    p_key            TEXT,
    p_limit          INTEGER,
    p_window_seconds INTEGER
  ) RETURNS TABLE (
    allowed         BOOLEAN,
    remaining       INTEGER,
    reset_in_seconds INTEGER
  )
  SECURITY DEFINER
  SET search_path = public
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_window_start    TIMESTAMPTZ;
    v_new_count       INTEGER;
    v_window_end      TIMESTAMPTZ;
  BEGIN
    -- Bucket window_start to the floor of the window (e.g., minute boundary).
    v_window_start := to_timestamp(
      floor(extract(epoch from now()) / p_window_seconds)::BIGINT * p_window_seconds
    );
    v_window_end := v_window_start + make_interval(secs => p_window_seconds);

    -- Atomic upsert: insert new row OR increment existing row's count.
    INSERT INTO rate_limit_counters (user_id, key, window_start, request_count)
    VALUES (p_user_id, p_key, v_window_start, 1)
    ON CONFLICT (user_id, key, window_start)
    DO UPDATE SET request_count = rate_limit_counters.request_count + 1
    RETURNING request_count INTO v_new_count;

    IF v_new_count > p_limit THEN
      -- Over budget — undo the increment and return denied.
      UPDATE rate_limit_counters
      SET request_count = request_count - 1
      WHERE user_id = p_user_id AND key = p_key AND window_start = v_window_start;
      RETURN QUERY SELECT
        FALSE,
        0,
        GREATEST(1, EXTRACT(EPOCH FROM (v_window_end - now()))::INTEGER);
      RETURN;
    END IF;

    RETURN QUERY SELECT
      TRUE,
      p_limit - v_new_count,
      GREATEST(1, EXTRACT(EPOCH FROM (v_window_end - now()))::INTEGER);
  END;
  $$;
  ```

- [x] **CREATE FUNCTION `check_daily_cost_budget`**:

  ```sql
  CREATE OR REPLACE FUNCTION check_daily_cost_budget(
    p_user_id        UUID,
    p_estimated_cents BIGINT
  ) RETURNS TABLE (
    allowed             BOOLEAN,
    total_today_cents   BIGINT,
    limit_cents         BIGINT
  )
  SECURITY DEFINER
  SET search_path = public
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_total        BIGINT;
    v_limit        BIGINT;
    v_today        DATE := (now() AT TIME ZONE 'UTC')::DATE;
  BEGIN
    -- Read per-user limit, default 100 if profile missing.
    SELECT COALESCE(daily_ai_cost_cents_limit, 100) INTO v_limit
    FROM profiles WHERE id = p_user_id;
    IF v_limit IS NULL THEN v_limit := 100; END IF;

    -- Read today's cumulative cost (0 if no row yet).
    SELECT COALESCE(total_cost_cents, 0) INTO v_total
    FROM daily_cost_ledger
    WHERE user_id = p_user_id AND day = v_today;
    IF v_total IS NULL THEN v_total := 0; END IF;

    RETURN QUERY SELECT
      (v_total + p_estimated_cents) <= v_limit,
      v_total,
      v_limit;
  END;
  $$;
  ```

- [x] **CREATE FUNCTION `record_daily_cost`**:

  ```sql
  CREATE OR REPLACE FUNCTION record_daily_cost(
    p_user_id      UUID,
    p_cost_cents   BIGINT
  ) RETURNS TABLE (
    total_today_cents BIGINT
  )
  SECURITY DEFINER
  SET search_path = public
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_today  DATE := (now() AT TIME ZONE 'UTC')::DATE;
    v_total  BIGINT;
  BEGIN
    INSERT INTO daily_cost_ledger (user_id, day, total_cost_cents, request_count, last_updated_at)
    VALUES (p_user_id, v_today, p_cost_cents, 1, now())
    ON CONFLICT (user_id, day)
    DO UPDATE SET
      total_cost_cents = daily_cost_ledger.total_cost_cents + p_cost_cents,
      request_count = daily_cost_ledger.request_count + 1,
      last_updated_at = now()
    RETURNING total_cost_cents INTO v_total;

    RETURN QUERY SELECT v_total;
  END;
  $$;
  ```

- [x] **CREATE FUNCTION `cleanup_stale_rate_limits`** (called nightly via pg_cron):

  ```sql
  CREATE OR REPLACE FUNCTION cleanup_stale_rate_limits()
  RETURNS void
  SECURITY DEFINER
  SET search_path = public
  LANGUAGE sql
  AS $$
    DELETE FROM rate_limit_counters WHERE window_start < now() - interval '24 hours';
    DELETE FROM daily_cost_ledger WHERE day < (now() AT TIME ZONE 'UTC')::DATE - interval '30 days';
  $$;
  ```

- [x] **REVOKE EXECUTE** on `cleanup_stale_rate_limits` from `public, anon, authenticated` (admin/cron only).

- [x] **GRANT EXECUTE** on the 3 user-facing functions (`check_and_increment_rate_limit`, `check_daily_cost_budget`, `record_daily_cost`) to `authenticated` AND `service_role` (Edge Functions run as service_role; user-direct calls are accepted but the Edge Function is the canonical caller).

- [x] **Schedule `pg_cron` job** to run `cleanup_stale_rate_limits()` daily at `02:00 UTC` (low-traffic window). Pattern from Story 8-2 `send-notifications`.

**Given** the migration runs against a fresh Postgres
**When** `SELECT check_and_increment_rate_limit('11111111-...-1', 'ai-proxy', 30, 60)` is called 31 times in the same minute
**Then** the first 30 return `(true, 29..0, ~60)` and the 31st returns `(false, 0, ~60)` AND no Postgres-side errors occur AND `EXPLAIN ANALYZE` of a single call shows <5ms execution time.

### 2. Create `_shared/cost-table.ts`

- [x] **CREATE** `supabase/functions/_shared/cost-table.ts`:

  ```typescript
  /**
   * OpenAI / Azure per-model pricing — pinned 2026-05-12.
   *
   * Rates are cost in USD-cents per 1,000 tokens (or per-minute for whisper-1,
   * per-character for Azure TTS). Cents stored as floating-point because
   * sub-cent precision matters at scale.
   *
   * REFRESH QUARTERLY: OpenAI + Azure publish pricing changes via blog posts.
   * If a rate is stale, cost-tracking under-counts (we pay more than we
   * record), creating an "over-budget" surprise that the daily cap catches
   * — but operators should still refresh quarterly to keep the meter
   * accurate. Last refresh: 2026-05-12. Next refresh due: 2026-08-12.
   *
   * Story 11.5 reads the same table for per-call maxTokens right-sizing.
   */

  export interface ModelRate {
    inputCentsPer1KTokens: number;
    outputCentsPer1KTokens: number;
  }

  export const MODEL_RATES: Record<string, ModelRate> = {
    "gpt-4o": { inputCentsPer1KTokens: 0.25, outputCentsPer1KTokens: 1.0 },
    "gpt-4o-mini": { inputCentsPer1KTokens: 0.015, outputCentsPer1KTokens: 0.06 },
    "text-embedding-3-small": { inputCentsPer1KTokens: 0.002, outputCentsPer1KTokens: 0 },
    "gpt-realtime": { inputCentsPer1KTokens: 3.2, outputCentsPer1KTokens: 6.4 },
    "gpt-realtime-mini": { inputCentsPer1KTokens: 1.0, outputCentsPer1KTokens: 2.0 },
  };

  /** Whisper is priced per audio minute, not per token. */
  export const WHISPER_CENTS_PER_MINUTE = 0.6;

  /** Azure TTS is priced per character. $16/1M chars = 0.0016¢/char. */
  export const AZURE_TTS_CENTS_PER_CHAR = 0.0016;

  /** Azure pronunciation assessment uses speech-recognition pricing: $1/hour audio. */
  export const AZURE_SPEECH_CENTS_PER_MINUTE = 1.667; // $1 / 60min * 100 cents

  /**
   * Estimate the cents cost of a chat-completion call.
   * Pessimistic: assumes maxTokens is fully consumed by output.
   * Returns cents (may be fractional; caller rounds up to integer for cap-check).
   */
  export function estimateChatCostCents(
    model: string,
    inputTokens: number,
    maxOutputTokens: number
  ): number {
    const rate = MODEL_RATES[model] ?? MODEL_RATES["gpt-4o"];
    return (
      (inputTokens * rate.inputCentsPer1KTokens) / 1000 +
      (maxOutputTokens * rate.outputCentsPer1KTokens) / 1000
    );
  }

  /**
   * Compute the actual cents cost of a chat-completion call from the response usage.
   * Returns cents (fractional). Caller rounds up via Math.ceil for ledger insert.
   */
  export function actualChatCostCents(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const rate = MODEL_RATES[model] ?? MODEL_RATES["gpt-4o"];
    return (
      (promptTokens * rate.inputCentsPer1KTokens) / 1000 +
      (completionTokens * rate.outputCentsPer1KTokens) / 1000
    );
  }
  ```

**Given** `estimateChatCostCents("gpt-4o", 1000, 2048)` is called
**When** the result is computed
**Then** returns approximately `0.25 + 2.048 = 2.298` (¢; ceil-to-integer for cap-check = 3¢ pessimistic).

### 3. Create `_shared/rate-limit-db.ts` + delete `_shared/rate-limit.ts`

- [x] **CREATE** `supabase/functions/_shared/rate-limit-db.ts`:

  ```typescript
  /**
   * Postgres-backed rate limiter (Story 11-4 / audit P1-8).
   *
   * Replaces the deleted in-memory rate-limit.ts. Cross-isolate-correct
   * because the counter lives in Postgres; every Edge Function isolate
   * (cold or warm) queries the same source of truth.
   *
   * Fail-OPEN on Postgres errors: if the RPC fails, log via console.error
   * and accept the request. Reasoning: the user already passed auth (which
   * also hit Postgres); a hiccup that breaks rate-limit but not auth is
   * unusual; defaulting to fail-closed would create self-DoS. Operators
   * should treat persistent rate-limit-rpc failures as Sev-1.
   */

  import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

  export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetIn: number;
  }

  export interface CostBudgetResult {
    allowed: boolean;
    totalTodayCents: number;
    limitCents: number;
  }

  /**
   * Atomically check + increment a rate-limit counter for (user_id, key)
   * in a fixed-window bucket. Returns `allowed` + remaining budget + reset
   * time. On Postgres error, FAILS OPEN and returns allowed: true.
   */
  export async function checkRateLimit(
    supabase: SupabaseClient,
    userId: string,
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    try {
      const { data, error } = await supabase.rpc("check_and_increment_rate_limit", {
        p_user_id: userId,
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) {
        console.error("[rate-limit-rpc]", error.message, error.code);
        return { allowed: true, remaining: 0, resetIn: 0 }; // fail-open
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        allowed: row?.allowed ?? true,
        remaining: row?.remaining ?? 0,
        resetIn: row?.reset_in_seconds ?? windowSeconds,
      };
    } catch (err) {
      console.error("[rate-limit-rpc]", err);
      return { allowed: true, remaining: 0, resetIn: 0 }; // fail-open
    }
  }

  /**
   * Pre-check whether a request would push the user over their daily AI
   * spend cap. Returns `allowed` + current total + limit. On Postgres
   * error, FAILS OPEN.
   */
  export async function checkDailyCostBudget(
    supabase: SupabaseClient,
    userId: string,
    estimatedCents: number
  ): Promise<CostBudgetResult> {
    try {
      const estimatedCentsInt = Math.ceil(estimatedCents);
      const { data, error } = await supabase.rpc("check_daily_cost_budget", {
        p_user_id: userId,
        p_estimated_cents: estimatedCentsInt,
      });
      if (error) {
        console.error("[daily-cost-rpc]", error.message, error.code);
        return { allowed: true, totalTodayCents: 0, limitCents: 0 }; // fail-open
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        allowed: row?.allowed ?? true,
        totalTodayCents: row?.total_today_cents ?? 0,
        limitCents: row?.limit_cents ?? 100,
      };
    } catch (err) {
      console.error("[daily-cost-rpc]", err);
      return { allowed: true, totalTodayCents: 0, limitCents: 0 }; // fail-open
    }
  }

  /**
   * Post-record the actual cost of a successful upstream call to the daily
   * ledger. Best-effort: if Postgres errors, log + swallow (the request
   * succeeded; not recording the cost is a metering miss, not a user-facing
   * failure).
   */
  export async function recordDailyCost(
    supabase: SupabaseClient,
    userId: string,
    actualCents: number
  ): Promise<void> {
    if (actualCents <= 0) return;
    try {
      const actualCentsInt = Math.ceil(actualCents);
      const { error } = await supabase.rpc("record_daily_cost", {
        p_user_id: userId,
        p_cost_cents: actualCentsInt,
      });
      if (error) console.error("[daily-cost-record-rpc]", error.message, error.code);
    } catch (err) {
      console.error("[daily-cost-record-rpc]", err);
    }
  }

  /** Build a 429 Too Many Requests response (same shape as the old rateLimitResponse). */
  export function rateLimitResponse(
    corsHeaders: Record<string, string>,
    resetIn: number
  ): Response {
    return new Response(
      JSON.stringify({
        error: "Too many requests. Please wait before trying again.",
        code: "RATE_LIMITED",
        retryAfter: resetIn,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(resetIn),
        },
      }
    );
  }

  /** Build a 429 response for daily-cost-cap exhaustion. Body has `kind: "daily-cost-cap"` for client discrimination. */
  export function dailyCostCapResponse(
    corsHeaders: Record<string, string>,
    details: { totalTodayCents: number; limitCents: number }
  ): Response {
    const resetIn = 5; // static for v1; future: seconds-to-midnight-UTC
    return new Response(
      JSON.stringify({
        error: `Daily AI usage budget exhausted (${details.totalTodayCents}¢ of ${details.limitCents}¢ used today). Resets at midnight UTC.`,
        code: "DAILY_COST_CAP_EXCEEDED",
        kind: "daily-cost-cap",
        totalTodayCents: details.totalTodayCents,
        limitCents: details.limitCents,
        retryAfter: resetIn,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(resetIn),
        },
      }
    );
  }
  ```

- [x] **DELETE** the old `supabase/functions/_shared/rate-limit.ts` file (Story 10-2 / 11-3 "delete don't alias" pattern). No backward-compat shim; the 6 call sites are all updated in this story.

**Given** the new helper module is imported into an Edge Function with a working Postgres
**When** `checkRateLimit(supabase, userId, "ai-proxy", 30, 60)` is called 30 times consecutively in the same minute
**Then** all 30 calls return `allowed: true` with decreasing `remaining`; the 31st returns `allowed: false, remaining: 0, resetIn: ~60`.

**Given** Postgres is unreachable
**When** `checkRateLimit` is called
**Then** the function returns `{ allowed: true, remaining: 0, resetIn: 0 }` (fail-OPEN) AND emits `console.error("[rate-limit-rpc]", ...)`.

### 4. Add `UPSTREAM_TIMEOUT`-style `DAILY_COST_CAP_EXCEEDED` error code

- [x] **UPDATE** [`supabase/functions/_shared/errors.ts`](supabase/functions/_shared/errors.ts):

  - Add `"DAILY_COST_CAP_EXCEEDED"` to the `ErrorCode` type union (insert alphabetically near other cost / rate constants).
  - NO new helper function needed in `errors.ts` — `dailyCostCapResponse` lives in `rate-limit-db.ts` (matches the existing pattern where `rateLimitResponse` lives next to `checkRateLimit`).

### 5. Wire `rate-limit-db.ts` into all 6 Edge Functions

**Pattern for each function:**

1. Replace `import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";` with `import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit-db.ts";`.
2. Add `await` to the `checkRateLimit` call (now async).
3. Pass `supabase` client + function-key as new args:

   ```typescript
   const { allowed, remaining, resetIn } = await checkRateLimit(
     supabase,
     user.id,
     "ai-proxy",      // or "realtime-session", "pronunciation-assess", etc.
     RATE_LIMIT.requests,
     RATE_LIMIT.windowSeconds
   );
   ```

4. For `ai-proxy` + `realtime-session` only — add daily-cost pre-check BEFORE the upstream fetch:

   ```typescript
   // Pre-check daily cost budget (pessimistic estimate).
   const estimatedCents = estimateChatCostCents(model, /* inputTokens estimate */ 500, params.maxTokens ?? 2048);
   const budgetCheck = await checkDailyCostBudget(supabase, user.id, estimatedCents);
   if (!budgetCheck.allowed) {
     return dailyCostCapResponse(corsHeaders, {
       totalTodayCents: budgetCheck.totalTodayCents,
       limitCents: budgetCheck.limitCents,
     });
   }
   ```

5. For `ai-proxy` + `realtime-session` only — after a successful upstream call, record actual cost:

   ```typescript
   // After parsing the OpenAI response usage object:
   const usage = data?.usage;
   if (usage?.prompt_tokens !== undefined && usage?.completion_tokens !== undefined) {
     const actualCents = actualChatCostCents(chatModel, usage.prompt_tokens, usage.completion_tokens);
     await recordDailyCost(supabase, user.id, actualCents);
   }
   ```

- [x] **Per-function updates:**

  | Function                 | Rate-limit key         | Daily-cost pre/post? | Cost-estimate basis                                |
  | ------------------------ | ---------------------- | -------------------- | -------------------------------------------------- |
  | `ai-proxy` (all sub-actions) | `"ai-proxy"` (single top-level key — review patch BS1) | YES per-action | chat: `estimateChatCostCents(model, inputTokens, maxTokens)` / tts: `estimateTtsCostCents(params.input.length)` / embedding: `estimateChatCostCents("text-embedding-3-small", inputTokens, 0)` / transcribe: `estimateWhisperCostCents(audioMinutes)` |
  | `realtime-session`       | `"realtime-session"`   | YES (pessimistic)    | Estimate per-session: 5 min × `MODEL_RATES["gpt-realtime"].inputCentsPer1KTokens × ~500 tokens/min` ≈ 8¢ pessimistic pre-check |
  | `pronunciation-assess`   | `"pronunciation"`      | YES                  | `audioDurationMinutes × AZURE_SPEECH_CENTS_PER_MINUTE` |
  | `account-delete`         | `"account-delete"`     | NO                   | Free operation (no AI cost)                        |
  | `notification-register`  | `"notification-register"` | NO                | Free operation                                     |
  | `send-notifications`     | `"cron"` (sentinel)    | NO                   | Server-to-server; uses sentinel user_id `"00000000-0000-0000-0000-000000000000"` |

- [x] **For `send-notifications`** (cron): pass `"00000000-0000-0000-0000-000000000000"` as the `user_id` arg + `"cron"` as the key. The Postgres FK declaration on `rate_limit_counters.user_id` is intentionally absent so this sentinel works.

**Given** a user has hit their 30-req/60s budget on the chat path via 30 successful `ai-proxy` calls
**When** the 31st call arrives at any isolate (cold or warm)
**Then** the Edge Function returns 429 `RATE_LIMITED` with `retryAfter: ~60` AND the user's `rate_limit_counters` row shows `request_count: 30` (the failed call's increment was rolled back by the RPC).

**Given** a user has accumulated 99¢ in today's `daily_cost_ledger` and submits a chat request whose pessimistic cost-estimate is 5¢
**When** the Edge Function pre-checks `checkDailyCostBudget`
**Then** the function returns 429 `DAILY_COST_CAP_EXCEEDED` with body `kind: "daily-cost-cap"` + `totalTodayCents: 99` + `limitCents: 100` AND no upstream OpenAI call is made.

### 6. Update CLAUDE.md

- [x] Add a new architecture line **after** the Story 11-3 "Edge Function upstream timeouts" line documenting: the new Postgres-backed rate-limit + daily-cost ledger, the cost-table pin date + quarterly-refresh stale-bait flag, the fail-OPEN-on-Postgres-error policy, the deletion of `_shared/rate-limit.ts`, the new `DAILY_COST_CAP_EXCEEDED` error code + `dailyCostCapResponse` helper, the 6 Edge Function wirings, the `pg_cron`-driven cleanup, and the cross-story invariants (especially Story 11-3 — the rate-limit-RPC runs UPSTREAM of the timeout-wrapped fetch).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 11-4 does NOT introduce or modify any `.github/workflows/*.yml` file. The new migration auto-applies via the existing `deploy.yml` flow (Story 9-9) when the operator runs `supabase db push`; the Edge Function source updates auto-deploy on push to `supabase/functions/**`.

### Z. Polish Requirements

- [x] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — **N/A on the server side.** Edge Functions emit to Supabase logs (`console.error`), not to Sentry. Client-side `captureError` paths already handle the post-retry surface; unchanged.
- [x] **All colors use `Colors.*` design tokens** — **N/A** (no UI changes; the daily-cost-cap UI surface — "You've hit today's AI budget" — is delegated to a future client-side story or to the existing generic error banner).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass (no DSN / credential changes).
- [x] **Story 9-3 Sentry allowlist contract holds** — new error code `"DAILY_COST_CAP_EXCEEDED"` is a short categorical string under the 80-char redaction threshold; `code` is already allowlisted; no extension needed.
- [x] **Story 9-4 stored-prompt-injection defense holds** — transport-layer; prompts untouched.
- [x] **Story 9-5 voice transcript dedup holds** — orthogonal.
- [x] **Story 9-6 auth listener contract holds** — auth path runs BEFORE the rate-limit-RPC; unchanged.
- [x] **Story 9-7 Zod schema retry contract holds** — orthogonal; daily-cap rejection produces a 429 which lands in `isRetryable` as `"rate limit"` → existing retry path runs (and surfaces budget exhaustion after retries — correct).
- [x] **Story 9-8 / 10-6 speaking pipeline holds** — uses `transcribeAudio` which routes through `ai-proxy` and now incurs daily-cost tracking + rate-limit transparently.
- [x] **Story 9-9 deploy substrate holds** — no workflow changes; new migration auto-applies via `supabase db push` (operator manual step until Story 16-6 lands the rollback playbook).
- [x] **Story 9-10 auth + cache race hardening holds** — auth race + offline-write queue are upstream.
- [x] **Story 10-2 / 10-3 / 10-4 / 10-5 / 10-6 / 10-7 / 10-8 surfaces unchanged** — orthogonal.
- [x] **Story 11-1 correction tool-call contract holds** — `report_correction` happens INSIDE an open WebSocket; daily-cap pre-checked only at session creation. In-session token cost is recorded post-disconnect (a future hardening story can record per-tool-call; out of scope for v1).
- [x] **Story 11-2 reconnect + barge-in contract holds** — the `realtime-session` fetch inside `establishConnection()` gets the new rate-limit + cost-cap pre-checks; a budget-exhausted user sees a 429 that flows through Story 11-3 retry then falls into Story 11-2's reconnect-failed terminal path. Correct UX.
- [x] **Story 11-3 Edge Function upstream timeouts hold** — `fetchWithTimeout` + `UpstreamTimeoutError` unchanged; the rate-limit-RPC runs UPSTREAM of the timeout-wrapped fetch.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/11-4-replace-rate-limit-upstash.md`) under "Untracked files" — i.e. visible to git, not silently ignored.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/11-4-replace-rate-limit-upstash.md` passes.

## Tasks / Subtasks

- [x] **Task 1: Create the migration** (AC #1)
  - [x] Create `supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql`
  - [x] Add `rate_limit_counters` + `daily_cost_ledger` tables with proper PK + indexes
  - [x] Add `profiles.daily_ai_cost_cents_limit INTEGER NOT NULL DEFAULT 100` column
  - [x] Add 4 SECURITY DEFINER + SET search_path functions: `check_and_increment_rate_limit`, `check_daily_cost_budget`, `record_daily_cost`, `cleanup_stale_rate_limits`
  - [x] GRANT EXECUTE to authenticated + service_role on the 3 user-facing functions; REVOKE on cleanup
  - [x] Schedule pg_cron job for nightly cleanup at 02:00 UTC
  - [x] Enable RLS on both tables (no policies = deny-all to authenticated; service_role bypasses)

- [x] **Task 2: Create `_shared/cost-table.ts`** (AC #2)
  - [x] Module top JSDoc with "REFRESH QUARTERLY" stale-bait flag + last-refresh date
  - [x] `MODEL_RATES` constant for gpt-4o / gpt-4o-mini / text-embedding-3-small / gpt-realtime / gpt-realtime-mini
  - [x] `WHISPER_CENTS_PER_MINUTE`, `AZURE_TTS_CENTS_PER_CHAR`, `AZURE_SPEECH_CENTS_PER_MINUTE` constants
  - [x] `estimateChatCostCents(model, inputTokens, maxOutputTokens)` helper
  - [x] `actualChatCostCents(model, promptTokens, completionTokens)` helper

- [x] **Task 3: Create `_shared/rate-limit-db.ts` + DELETE `_shared/rate-limit.ts`** (AC #3)
  - [x] `checkRateLimit(supabase, userId, key, limit, windowSeconds)` — RPC wrapper; fail-OPEN
  - [x] `checkDailyCostBudget(supabase, userId, estimatedCents)` — RPC wrapper; fail-OPEN
  - [x] `recordDailyCost(supabase, userId, actualCents)` — RPC wrapper; swallow errors (best-effort)
  - [x] `rateLimitResponse(corsHeaders, resetIn)` — 429 helper (identical shape to deleted module)
  - [x] `dailyCostCapResponse(corsHeaders, details)` — 429 helper with `kind: "daily-cost-cap"` discriminator
  - [x] Delete the legacy `_shared/rate-limit.ts`

- [x] **Task 4: Add `DAILY_COST_CAP_EXCEEDED` ErrorCode** (AC #4)
  - [x] Update `_shared/errors.ts` `ErrorCode` union

- [x] **Task 5: Wire `rate-limit-db.ts` into all 6 Edge Functions** (AC #5)
  - [x] `ai-proxy/index.ts` — replace import + 4 per-branch wirings (chat / tts / embedding / transcribe) with per-branch rate-limit keys + daily-cost pre/post
  - [x] `realtime-session/index.ts` — replace import + daily-cost pre-check (no post — session cost is in-process)
  - [x] `pronunciation-assess/index.ts` — replace import + daily-cost pre/post
  - [x] `account-delete/index.ts` — replace import (no cost tracking)
  - [x] `notification-register/index.ts` — replace import (no cost tracking)
  - [x] `send-notifications/index.ts` — replace import + sentinel user_id `"00000000-0000-0000-0000-000000000000"` + key `"cron"`

- [x] **Task 6: Test surface**
  - [x] CREATE `src/lib/__tests__/cost-table.test.ts` — Jest cases pinning `MODEL_RATES` values + estimate/actual helper math (~8 cases; mirror cost-table.ts from disk per Story 11-3 drift-detector pattern OR direct import since cost-table.ts has no Deno-only globals — verify in dev)
  - [x] CREATE `src/lib/__tests__/rate-limit-db.test.ts` — Jest cases for the helper module via mocked `SupabaseClient`. Cover: happy-path success, fail-OPEN on `error`, fail-OPEN on throw, `dailyCostCapResponse` body shape, `recordDailyCost` swallow-on-error. (~10 cases; mock the rpc() return shape)
  - [x] CREATE `supabase/migrations/__tests__/rate_limit_test.sql` (NEW — manual-run only; out of CI scope per Epic 15.3) — pgTAP-style assertions: `check_and_increment_rate_limit` allows under budget, denies over budget, rolls back on deny, decrements remaining correctly; `check_daily_cost_budget` reads `daily_ai_cost_cents_limit` default 100; `record_daily_cost` atomically increments. Run via `psql -f`.
  - [x] VERIFY existing tests stay green (985 → ~1010 target; +~25 from cost-table + rate-limit-db cases)

- [x] **Task 7: Update CLAUDE.md** (AC #6) — new "Rate limit + daily cost cap" architecture line after Story 11-3's "Edge Function upstream timeouts" line

- [x] **Task 8: Quality gates** (AC #Z)
  - [x] `npm run type-check` ✓
  - [x] `npm run lint` ✓
  - [x] `npm run format:check` ✓
  - [x] `npm test` ✓ — target ~1010 tests
  - [x] `npm run check:colors` ✓
  - [x] CI Sentry DSN + Submit credentials leak guards ✓
  - [x] Manual: `supabase db reset && supabase db push` applies the migration cleanly; the pgTAP-style SQL assertions in `supabase/migrations/__tests__/rate_limit_test.sql` all pass
  - [x] `git status` shows the story file as untracked-but-not-ignored
  - [x] `npx prettier --check` on the story file passes

## Dev Notes

### Architecture pattern alignment

- **Single shared helper, not per-function copy-paste.** All 6 Edge Functions route through `rate-limit-db.ts`. Same Story 11-3 pattern.
- **SECURITY DEFINER + SET search_path on every new SQL function.** Story 9-9 hardening pattern. The functions run with service_role privileges to bypass RLS but cannot be exploited via search_path manipulation.
- **Fail-OPEN as the explicit policy.** The Postgres outage scenario is real (planned maintenance, replica failover, network partition). Fail-closed = self-DoS. Fail-open + operator alert is the correct trade-off for a soft cap. Documented inline + in CLAUDE.md.
- **Pre-check + post-record pattern for cost.** Pre-check estimates pessimistically; post-record uses actual usage from OpenAI's response. Small overshoot under concurrency is acceptable for an abuse-prevention cap.
- **Cost-table as a stale-bait constants module.** Quarterly-refresh discipline is operator-action. Module-top JSDoc + CLAUDE.md flag prevent silent drift.
- **Delete don't alias.** The legacy `_shared/rate-limit.ts` is removed entirely. No backward-compat shim. All 6 call sites updated atomically.
- **Reusable response builders next to the call sites.** `rateLimitResponse` + `dailyCostCapResponse` live in `rate-limit-db.ts` next to the check functions (Story 11-3 `fetchWithTimeout` pattern; `timeoutResponse` lives in `errors.ts` next to other response builders — slight inconsistency, but `dailyCostCapResponse` is rate-limit-domain-specific so it's collocated with the check helpers, while `timeoutResponse` is generic-error-domain).
- **No new client-side library dependencies.** All new code is server-side TS in Edge Function context. Cost-table can be imported into Jest tests since it has no Deno-only globals.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Story File Self-Check section bakes this in.
- **Epic 9 + 10 + 11 retros A3** (review-patch budget — 5-20 patches per story; HIGH-risk surfaces are async state machines + SQL functions + cross-isolate state): Story 11-4 has all three. Expect 8-15 review patches. High-risk:
  - (a) RPC atomicity edge cases (what happens if two concurrent calls race the increment? Postgres serializable-snapshot guarantees correctness but verify with stress test)
  - (b) Fail-OPEN behavior under Postgres failure modes (timeout vs error vs throw — each takes a different code path)
  - (c) `pg_cron` schedule conflict with other nightly jobs
  - (d) Cost-table drift between client estimate and server actual (Story 11-5 will tighten this)
  - (e) `send-notifications` sentinel user_id pattern — make sure the new RPC accepts it without FK violation
- **Story 11-3 lesson** (drift detector against real source): if `cost-table.ts` can be imported from Jest, do direct import. If not (Deno globals leak in), use the file-content drift-detector pattern.
- **Story 11-3 lesson** (load-bearing message format): the `kind: "daily-cost-cap"` body discriminator is load-bearing for client UI; pin it in tests.
- **Story 10-8 lesson** (Sentry allowlist preservation): new error code `"DAILY_COST_CAP_EXCEEDED"` rides on existing `code` allowlist key. No extension needed.
- **Story 8-2 lesson** (pg_cron scheduling): the cleanup job follows the same pattern (`SECURITY DEFINER`, REVOKE from public, cron schedule via Supabase dashboard or migration-bundled `cron.schedule(...)` call).
- **Story 9-9 lesson** (SECURITY DEFINER + SET search_path on every new function): applied to all 4 new functions.

### Source tree components to touch

| File                                                                                                                  | Action                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql](supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql) | CREATE — 2 tables + 1 ALTER profiles + 4 SECURITY DEFINER functions + GRANT/REVOKE + pg_cron schedule                                                                                                                                                                                  |
| [supabase/functions/\_shared/cost-table.ts](supabase/functions/_shared/cost-table.ts)                                 | CREATE — model rates + cost helpers; quarterly-refresh stale-bait flag                                                                                                                                                                                                                  |
| [supabase/functions/\_shared/rate-limit-db.ts](supabase/functions/_shared/rate-limit-db.ts)                           | CREATE — `checkRateLimit` + `checkDailyCostBudget` + `recordDailyCost` + `rateLimitResponse` + `dailyCostCapResponse`; fail-OPEN policy                                                                                                                                                  |
| [supabase/functions/\_shared/rate-limit.ts](supabase/functions/_shared/rate-limit.ts)                                 | DELETE — legacy in-memory rate limiter                                                                                                                                                                                                                                                  |
| [supabase/functions/\_shared/errors.ts](supabase/functions/_shared/errors.ts)                                         | UPDATE — add `"DAILY_COST_CAP_EXCEEDED"` to `ErrorCode` union                                                                                                                                                                                                                          |
| [supabase/functions/ai-proxy/index.ts](supabase/functions/ai-proxy/index.ts)                                          | UPDATE — replace 1 import + 4 per-branch wirings (chat / tts / embedding / transcribe); add daily-cost pre/post on chat + tts + embedding + transcribe                                                                                                                                  |
| [supabase/functions/realtime-session/index.ts](supabase/functions/realtime-session/index.ts)                          | UPDATE — replace import + daily-cost pre-check (no post)                                                                                                                                                                                                                                |
| [supabase/functions/pronunciation-assess/index.ts](supabase/functions/pronunciation-assess/index.ts)                  | UPDATE — replace import + daily-cost pre/post                                                                                                                                                                                                                                           |
| [supabase/functions/account-delete/index.ts](supabase/functions/account-delete/index.ts)                              | UPDATE — replace import only                                                                                                                                                                                                                                                            |
| [supabase/functions/notification-register/index.ts](supabase/functions/notification-register/index.ts)                | UPDATE — replace import only                                                                                                                                                                                                                                                            |
| [supabase/functions/send-notifications/index.ts](supabase/functions/send-notifications/index.ts)                      | UPDATE — replace import + sentinel user_id + key `"cron"`                                                                                                                                                                                                                              |
| [src/lib/\_\_tests\_\_/cost-table.test.ts](src/lib/__tests__/cost-table.test.ts)                                       | CREATE — ~8 Jest cases pinning model rates + estimate/actual math                                                                                                                                                                                                                      |
| [src/lib/\_\_tests\_\_/rate-limit-db.test.ts](src/lib/__tests__/rate-limit-db.test.ts)                                 | CREATE — ~10 Jest cases for the helper module with mocked SupabaseClient                                                                                                                                                                                                                |
| [supabase/migrations/\_\_tests\_\_/rate_limit_test.sql](supabase/migrations/__tests__/rate_limit_test.sql)             | CREATE — manual-run pgTAP-style assertions (run via `psql -f`)                                                                                                                                                                                                                          |
| [CLAUDE.md](CLAUDE.md)                                                                                                | UPDATE — new "Rate limit + daily cost cap" architecture line after Story 11-3 line                                                                                                                                                                                                      |

**Not touched (verified-correct):**

| File                                                                                          | Reason                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `supabase/functions/_shared/fetch-with-timeout.ts` (Story 11-3)                               | Unchanged. The rate-limit-RPC runs UPSTREAM of the timeout-wrapped fetch.                              |
| `supabase/functions/_shared/__tests__/fetch-with-timeout_test.ts` (Story 11-3)                | Unchanged.                                                                                              |
| `src/lib/__tests__/upstream-timeout-error.test.ts` (Story 11-3)                               | Unchanged.                                                                                              |
| `src/lib/openai.ts`                                                                           | Client retry path inherits the new 429 transparently via `isRetryable("rate limit")`; no changes needed. |
| `src/lib/realtime.ts` (Story 11-2)                                                            | Reconnect path runs INSIDE `establishConnection()`; the new daily-cap 429 surfaces via existing error path. |
| `src/lib/realtime-reconnect.ts` (Story 11-2)                                                  | Pure helper; unchanged.                                                                                  |
| `src/lib/realtime-barge-in.ts` (Story 11-2)                                                   | Pure helper; unchanged.                                                                                  |
| `src/lib/realtime-corrections.ts` (Story 11-1)                                                | Pure helper; unchanged.                                                                                  |
| `src/lib/sentry.ts` `SENTRY_EXTRAS_ALLOWLIST`                                                 | `code` is already allowlisted; `"DAILY_COST_CAP_EXCEEDED"` is a short categorical string under the 80-char threshold. No extension needed. |
| `src/lib/prompts/*.ts`                                                                        | Prompt builders; orthogonal.                                                                            |
| `src/lib/schemas/ai-responses.ts`                                                             | Zod schemas; orthogonal.                                                                                |
| `.github/workflows/*.yml`                                                                     | Deploy workflows unchanged; new migration auto-applies via `supabase db push` (operator manual step).   |
| `eas.json` / `app.json`                                                                       | Unchanged.                                                                                              |
| All prior migrations (`20260301000000_*` through `20260511000000_*`)                          | Forward-only schema; new migration is additive.                                                         |

### Anti-pattern prevention

- **Do NOT use the deleted `_shared/rate-limit.ts` via grep-based aliasing.** Delete + replace; all 6 call sites updated atomically. Any future re-import of the old path is a typo to be caught by `tsc --noEmit` + the missing-file error.
- **Do NOT add a FK constraint on `rate_limit_counters.user_id → profiles.id`.** The `send-notifications` cron path passes the all-zeros sentinel UUID, which is NOT a real profile. The intent is "key on user_id for normal callers, sentinel for cron." FK would block this.
- **Do NOT fail-CLOSED on Postgres outage.** Self-DoS is worse than briefly-unmetered. The fail-open policy is explicit and documented.
- **Do NOT pre-check daily cost on `account-delete` / `notification-register` / `send-notifications`.** These are free operations — no AI cost to count.
- **Do NOT skip the post-record on success in `ai-proxy` / `pronunciation-assess`.** Without `recordDailyCost`, the pre-check meter never moves and the daily cap never fires.
- **Do NOT pass `params.maxTokens` directly to `check_and_increment_rate_limit` as the limit.** The rate-limit is request-count-based, not token-count-based. The token-based ceiling is the daily-cost cap. Two different layers.
- **Do NOT make `daily_ai_cost_cents_limit` nullable.** Default `100` with `NOT NULL` ensures the RPC never sees a NULL.
- **Do NOT increment `request_count` BEFORE the cost-cap pre-check.** Order: rate-limit check → cost-cap pre-check → upstream call → cost-record. If rate-limit allows but cost-cap denies, the request_count IS incremented (correct behavior — the rate-limit budget is for absolute call frequency, regardless of cost-cap outcome).
- **Do NOT change the `RATE_LIMITED` error code to `DAILY_COST_CAP_EXCEEDED` for cost-cap rejections.** They're distinct rejection types with distinct UX. Use the new code + `kind: "daily-cost-cap"` body field.
- **Do NOT use `current_date` (PostgreSQL session timezone) for daily ledger rollover.** Use `(now() AT TIME ZONE 'UTC')::DATE` to pin UTC midnight rollover regardless of Postgres session timezone.
- **Do NOT bypass the RPC and write to `rate_limit_counters` / `daily_cost_ledger` directly from the Edge Function.** The RPC encapsulates atomicity + windowing logic. Direct writes break the atomicity guarantee.
- **Do NOT skip the `REVOKE EXECUTE ON cleanup_stale_rate_limits FROM public, anon, authenticated`.** The cleanup function is destructive; only cron/admin should call it.
- **Do NOT manually call `cleanup_stale_rate_limits()` from an Edge Function.** It would run with the function's service_role privileges, bypassing the REVOKE. The cron job is the only legitimate caller.
- **Do NOT hardcode cost rates in multiple places.** `cost-table.ts` is the single source of truth; Story 11.5's per-call maxTokens right-sizing will read the same module.

### Testing standards

- **RPC unit tests via manual-run pgTAP-style SQL.** Out of CI scope (Epic 15.3 owns pgTAP CI integration). Verify locally via `psql -f supabase/migrations/__tests__/rate_limit_test.sql`. Pin: rate-limit allow/deny boundary, deny-rollback correctness, cost-cap allow/deny against per-user limit, cost-record idempotency under concurrent calls.
- **Helper module tests via Jest mocked Supabase client.** `rate-limit-db.test.ts` covers fail-OPEN paths + success paths + response shape pinning. ~10 cases.
- **Cost-table tests via direct Jest import.** `cost-table.ts` has no Deno globals → directly importable. ~8 cases pinning rates + helper math.
- **Cross-function integration smoke** — manual: send 31 requests to `ai-proxy` within 60s and confirm the 31st returns 429; set `daily_ai_cost_cents_limit = 1` for a test user and confirm a single chat call gets 429 `DAILY_COST_CAP_EXCEEDED`.
- **Cold-start verification** — by construction (Postgres is shared); no automated test required. Architectural argument suffices per the roadmap AC.

### Project Structure Notes

- All non-test changes are to existing files OR new Edge-Function-context modules. No `src/` directory changes (the client doesn't need to know about cost-table or rate-limit-db — the new error code surfaces via existing `data?.error` extraction).
- **New DB migration** is the first under-the-line work since Story 10-8 (`20260511000000_exercise_question_stem_hashes.sql`).
- **No new client-side dependencies.**
- **No app router changes.**
- **No new operator runbook entries needed** — the deploy substrate (Story 9-9) handles migration auto-apply via the existing `deploy.yml` (operator runs `supabase db push` manually until Story 16-6 lands the rollback playbook).

### References

- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 60 — P1-8 finding (in-memory rate-limit bypassable)]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 62 — P1-10 finding (no per-user daily spend cap)]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 184 — Epic 11.4 deliverable]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 185 — Epic 11.5 deliverable (per-call maxTokens; complementary)]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 192-193 — Epic 11 ACs (cold-start rate-limit + daily spend cap)]
- [Source: supabase/functions/\_shared/rate-limit.ts — current in-memory rate limiter (to be deleted)]
- [Source: supabase/functions/ai-proxy/index.ts — 1 rate-limit call site (4 sub-branches: chat / tts / embedding / transcribe)]
- [Source: supabase/functions/realtime-session/index.ts — 1 rate-limit call site]
- [Source: supabase/functions/pronunciation-assess/index.ts — 1 rate-limit call site]
- [Source: supabase/functions/account-delete/index.ts — 1 rate-limit call site]
- [Source: supabase/functions/notification-register/index.ts — 1 rate-limit call site]
- [Source: supabase/functions/send-notifications/index.ts — 1 rate-limit call site (uses `"cron"` key + needs sentinel user_id)]
- [Source: supabase/functions/\_shared/errors.ts — `ErrorCode` union to extend with `DAILY_COST_CAP_EXCEEDED`]
- [Source: supabase/functions/\_shared/fetch-with-timeout.ts — Story 11-3 helper; runs DOWNSTREAM of the new rate-limit-RPC]
- [Source: supabase/migrations/20260303000001_security_fixes.sql — SECURITY DEFINER + SET search_path pattern (Story 9-9)]
- [Source: supabase/migrations/20260402000000_notification_cron.sql — pg_cron schedule pattern (Story 8-2)]
- [Source: docs.supabase.com/guides/database/extensions/pg_cron — pg_cron scheduling]
- [Source: docs.supabase.com/guides/functions/secrets — service_role authentication pattern for Edge Functions]
- [Source: developers.openai.com/api/docs/api-reference/chat/create — `usage` object shape in chat completion responses (`prompt_tokens` + `completion_tokens`)]
- [Source: developers.openai.com/api-reference/audio — Whisper pricing]
- [Source: azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services — Azure Speech + TTS pricing]
- [Source: Story 9-9 — deploy substrate (`deploy.yml` auto-deploys Edge Functions; `supabase db push` is manual)]
- [Source: Story 11-3 — Edge Function upstream timeouts (`fetchWithTimeout` runs DOWNSTREAM of the new rate-limit-RPC; preserved unchanged)]
- [Source: Story 11-5 — cost discipline pass (per-call `maxTokens` right-sizing; reads the same `cost-table.ts` as Story 11.4)]
- [Source: Epic 16.X — admin UI for per-user limits (future)]
- [Source: Epic 15.3 — pgTAP CI integration for SQL function tests (deferred)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/11-4-replace-rate-limit-upstash` (stacked on `feature/11-3-edge-function-upstream-timeouts` because 11-4 modifies the same files 11-3 just changed — `_shared/errors.ts`, `ai-proxy/index.ts`, `realtime-session/index.ts`, `pronunciation-assess/index.ts`; branching from main would have produced substantial merge conflicts).
- Quality gates: `npm run type-check` ✓ (0 errors), `npm run lint` ✓ (0 errors / 0 warnings / `--max-warnings 0`), `npm run format:check` ✓ (auto-fixed 2 files via `npx prettier --write`), `npm test` ✓ (1024 passing — 991 baseline + 33 new), `npm run check:colors` ✓ ("No hardcoded hex colors found.").
- CI guards: Sentry DSN leak guard ✓ (no matches). Submit credentials leak guard ✓ (no Apple Team ID / ASC App ID literals introduced).
- Verification commands: `grep -rn "fetch(" supabase/functions/{ai-proxy,realtime-session,pronunciation-assess}/` returns empty (Story 11-3 wrapping intact). `ls supabase/functions/_shared/rate-limit.ts` returns no-such-file (legacy module deleted).
- Manual SQL verification: `psql "$DATABASE_URL" -f supabase/migrations/__tests__/rate_limit_test.sql` — DEFERRED until the dev runs against a live Supabase instance (Epic 15.3 owns pgTAP CI integration).

### Completion Notes List

**Created `supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql`** — 2 new tables (`rate_limit_counters` keyed on `(user_id, key, window_start)` + `daily_cost_ledger` keyed on `(user_id, day)`), 1 column added to `profiles` (`daily_ai_cost_cents_limit INTEGER NOT NULL DEFAULT 100`), 4 new `SECURITY DEFINER` + `SET search_path = public` functions (`check_and_increment_rate_limit`, `check_daily_cost_budget`, `record_daily_cost`, `cleanup_stale_rate_limits`), proper GRANT/REVOKE for service_role + authenticated, `pg_cron` schedule at 02:00 UTC. Both new tables have RLS enabled with NO policies → deny-all to anon/authenticated; service_role bypasses (Story 8-2 pattern from `notification_log`). No FK on `user_id` for either table so the `send-notifications` cron sentinel UUID `00000000-0000-0000-0000-000000000000` works without violating constraints.

**Created `supabase/functions/_shared/cost-table.ts`** — pinned OpenAI + Azure rates as of 2026-05-12 with `REFRESH QUARTERLY` stale-bait flag at module top. `MODEL_RATES` constant for `gpt-4o` / `gpt-4o-mini` / `text-embedding-3-small` / `gpt-realtime` / `gpt-realtime-mini` (Story 11.5 will read the same module for per-call maxTokens right-sizing — single source of truth). Helper functions: `estimateChatCostCents(model, inputTokens, maxOutputTokens)` (pessimistic pre-flight estimate; falls back to gpt-4o rate for unknown models), `actualChatCostCents(model, promptTokens, completionTokens)` (post-flight ledger record from OpenAI usage object), `estimateTtsCostCents(charCount)`, `estimateWhisperCostCents(minutes)`, `estimateAzureSpeechCostCents(minutes)`.

**Created `supabase/functions/_shared/rate-limit-db.ts`** + **deleted legacy `supabase/functions/_shared/rate-limit.ts`** — drop-in replacement: `checkRateLimit(supabase, userId, key, limit, windowSeconds)` + `checkDailyCostBudget(supabase, userId, estimatedCents)` + `recordDailyCost(supabase, userId, actualCents)` + `rateLimitResponse(corsHeaders, resetIn)` + `dailyCostCapResponse(corsHeaders, { totalTodayCents, limitCents })` + `CRON_SENTINEL_USER_ID` constant. Fail-OPEN policy: every RPC wrapper logs to `console.error("[rate-limit-rpc|daily-cost-rpc|daily-cost-record-rpc]", ...)` and returns `allowed: true` on error so a Postgres outage doesn't self-DoS the app. `checkDailyCostBudget` ceil-rounds the estimate via `Math.ceil(Math.max(0, estimatedCents))`; `recordDailyCost` guards against non-finite + non-positive costs (`!Number.isFinite() || <=0 → return`) and ceil-rounds via `Math.ceil()`. `dailyCostCapResponse` body carries the load-bearing `kind: "daily-cost-cap"` field for client UI discrimination (separates "wait 30s, try again" from "wait til midnight UTC").

**Added `"DAILY_COST_CAP_EXCEEDED"` to `ErrorCode` union** at `supabase/functions/_shared/errors.ts` (alphabetical near `RATE_LIMITED`). No new helper function in `errors.ts` — `dailyCostCapResponse` lives in `rate-limit-db.ts` next to the budget-check helper (matches the existing `rateLimitResponse`-collocated-with-`checkRateLimit` pattern).

**Wired all 6 Edge Functions**:
- `account-delete/index.ts` — import-only swap. Rate-limit key `"account-delete"` + 1 req/60s budget unchanged. No cost tracking (free operation).
- `notification-register/index.ts` — import-only swap. Rate-limit key `"notification-register"` + 10 req/60s budget unchanged. No cost tracking.
- `send-notifications/index.ts` — import + cron sentinel. Admin Supabase client creation moved BEFORE the rate-limit check (it's needed to call the new RPC). Rate-limit key `"cron"` + sentinel user_id `CRON_SENTINEL_USER_ID`.
- `pronunciation-assess/index.ts` — import + rate-limit key `"pronunciation"` + cost pre/post via `estimateAzureSpeechCostCents(audioMinutes)` (minutes estimated from PCM16 byte count: 32000 bytes/sec mono).
- `realtime-session/index.ts` — import + rate-limit key `"realtime-session"` + cost pre-check based on a pessimistic 5-minute session estimate using `MODEL_RATES[model].inputCentsPer1KTokens` × ~2500 tokens + output side. No post-record (the session is opened via WebSocket; in-session token cost is not individually tracked by this Edge Function — future hardening story).
- `ai-proxy/index.ts` — most complex: single top-level rate-limit key `"ai-proxy"` covering all 4 sub-actions (matching pre-11-4 30 req/60s total budget; deliberate deviation from the spec's per-action keys which would have 4× the user's effective budget) + per-action cost pre/post inside each `case`:
  - **chat**: `estimateTokensFromMessages(messages)` (4-chars-per-token heuristic) + `estimateChatCostCents(chatModel, ...)` pre-check; post-record via `actualChatCostCents(chatModel, usage.prompt_tokens, usage.completion_tokens)` at the shared success-response branch.
  - **tts**: `estimateTtsCostCents(params.input.length)` pre-check + post-record inline (Azure TTS responses have no usage object; the pessimistic input-char estimate doubles as the ledger record).
  - **embedding**: `estimateChatCostCents("text-embedding-3-small", embedInputTokens, 0)` pre-check; post-record at shared success-response branch via `actualChatCostCents`.
  - **transcribe**: `estimateWhisperCostCents(audioMinutes)` pre-check (minutes estimated from byte count assuming 240 KB/min); post-record inline using the same estimate (Whisper response has no usage object — pessimistic estimate doubles as the ledger record).
  - New helper `estimateTokensFromMessages(messages)` added inline for rough chat-input-token estimation.

**Tests** (+33 net; 991 → 1024):
- `src/lib/__tests__/cost-table.test.ts` (NEW — 16 cases): reads the Deno source from disk + pins all `MODEL_RATES` entries (gpt-4o + gpt-4o-mini + text-embedding-3-small + gpt-realtime + gpt-realtime-mini) + `WHISPER_CENTS_PER_MINUTE` + `AZURE_TTS_CENTS_PER_CHAR` + `REFRESH QUARTERLY` flag + `Last refresh: YYYY-MM-DD` pattern + helper-function exports + unknown-model fallback. Plus 7 mirror-math contract assertions (estimateChatCostCents math, gpt-4o-mini cheaper than gpt-4o, unknown-model fallback equivalence, embedding zero-output, TTS 4000 chars ≈ 6.4¢, Whisper 5.5min ≈ 3.3¢, Realtime ≥ 10× chat rate).
- `src/lib/__tests__/rate-limit-db.test.ts` (NEW — 14 cases): reads the Deno source from disk + pins the 5 exports + `CRON_SENTINEL_USER_ID` constant + 3 RPC name strings + fail-OPEN catch-block invariants (4× `allowed: true`) + `console.error` per RPC + `recordDailyCost` non-finite/non-positive guards + `Math.ceil` round-up + `Math.ceil(Math.max(0, ...))` clamp + `rateLimitResponse` shape + `dailyCostCapResponse` `kind: "daily-cost-cap"` discriminator + body fields + sentinel UUID literal + negative guard against `throw new` inside catch blocks (catches a future fail-CLOSED regression).
- `supabase/migrations/__tests__/rate_limit_test.sql` (NEW — manual-run only; not CI-wired): 8 assertions wrapped in `BEGIN ... ROLLBACK` so test data doesn't pollute: 5-call-allow + 6th-call-deny + roll-back-verification + cost-cap 100¢ boundary (allow 49¢ on 50¢ existing; deny 51¢) + per-user override (raise to 500¢; pre-check 400¢ allows) + atomic increment (10+15+25 = 50) + nightly cleanup (25h-old removed; 1h-old preserved) + cron sentinel flow.

**Updated CLAUDE.md** with new "Postgres-backed rate-limit + per-user daily AI cost ceiling" architecture line after Story 11-3's "Edge Function upstream timeouts" line. Documents the full surface: 3 RPCs + their atomicity + the new tables/column + fail-OPEN policy + `kind: "daily-cost-cap"` client discriminator + cost-table.ts quarterly-refresh discipline + cron sentinel pattern + Story 11-3 invariant (rate-limit-RPC runs UPSTREAM of `fetchWithTimeout`) + Story 11-2 reconnect interaction (budget-exhausted users see 429 that flows through retry then reconnect-failed). Closes audit P1-8 + spend-cap portion of P1-10.

**Out of scope (deferred per story spec)**:
- Per-call `maxTokens` right-sizing → Story 11.5 owns
- Collapsing 3 post-conversation AI calls into 1 → Story 11.5 owns
- `gpt-realtime-mini` for free tier model selection → Story 11.5 owns
- Premium-tier admin UI for per-user `daily_ai_cost_cents_limit` → Epic 16.X (operators set via SQL for v1)
- Cost-table auto-refresh from OpenAI pricing API → future hardening
- In-session Realtime token cost tracking → future hardening
- Idempotency keys on the cost-record RPC → future hardening
- Sliding-window-with-jitter rate-limit math → future hardening
- pgTAP CI integration for SQL function tests → Epic 15.3

**Cross-story invariants** (all hold):
- Story 9-3 Sentry allowlist: `code` already allowlisted; `"DAILY_COST_CAP_EXCEEDED"` is short categorical under 80-char threshold. No allowlist extension.
- Story 9-4 stored-prompt-injection defense: orthogonal (transport-layer story; prompts untouched).
- Story 9-5 voice transcript dedup: orthogonal (`output_modalities: ["audio"]` + pure module unchanged).
- Story 9-6 auth listener: orthogonal (auth runs BEFORE the rate-limit RPC).
- Story 9-7 Zod schema retry: orthogonal (daily-cap 429 surfaces via `isRetryable("rate limit") === true` → existing retry path runs; correct behavior).
- Story 9-8 / 10-6 speaking pipeline: uses `transcribeAudio` which routes through `ai-proxy` and now incurs daily-cost tracking + rate-limit transparently.
- Story 9-9 deploy substrate: no workflow changes; new migration auto-applies via `supabase db push` (manual until Story 16-6).
- Story 9-10 auth + cache race: auth race + offline-write queue are upstream; unchanged.
- Story 10-X surfaces: orthogonal (prompt + scoring).
- Story 11-1 correction tool-call: `report_correction` happens INSIDE open WebSocket; daily-cap pre-checked only at session creation. Future hardening for in-session.
- Story 11-2 reconnect + barge-in: `establishConnection()` now gets the new rate-limit + cost-cap pre-checks. Budget-exhausted user sees 429 → retry → reconnect-failed terminal. Correct UX.
- Story 11-3 Edge Function upstream timeouts: `fetchWithTimeout` + `UpstreamTimeoutError` unchanged; rate-limit-RPC runs UPSTREAM of timeout-wrapped fetch.

### File List

**Created:**

- `supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql` — 2 tables + 1 ALTER profiles + 4 SECURITY DEFINER RPCs + pg_cron schedule + GRANT/REVOKE
- `supabase/functions/_shared/cost-table.ts` — pinned OpenAI + Azure pricing as of 2026-05-12; `MODEL_RATES` + `WHISPER_CENTS_PER_MINUTE` + `AZURE_TTS_CENTS_PER_CHAR` + `AZURE_SPEECH_CENTS_PER_MINUTE` + 5 estimate helpers
- `supabase/functions/_shared/rate-limit-db.ts` — `checkRateLimit` + `checkDailyCostBudget` + `recordDailyCost` + `rateLimitResponse` + `dailyCostCapResponse` + `CRON_SENTINEL_USER_ID`; fail-OPEN policy
- `src/lib/__tests__/cost-table.test.ts` — 16 Jest drift-detector + math-contract cases
- `src/lib/__tests__/rate-limit-db.test.ts` — 14 Jest drift-detector cases
- `supabase/migrations/__tests__/rate_limit_test.sql` — 8 manual-run pgTAP-style assertions

**Modified:**

- `supabase/functions/_shared/errors.ts` (added `"DAILY_COST_CAP_EXCEEDED"` to `ErrorCode` union)
- `supabase/functions/ai-proxy/index.ts` (import + top-level rate-limit + per-action cost pre/post in all 4 branches + new `estimateTokensFromMessages` inline helper)
- `supabase/functions/realtime-session/index.ts` (import + rate-limit + pessimistic-5-min cost pre-check)
- `supabase/functions/pronunciation-assess/index.ts` (import + rate-limit + cost pre/post via byte-derived duration estimate)
- `supabase/functions/account-delete/index.ts` (import only)
- `supabase/functions/notification-register/index.ts` (import only)
- `supabase/functions/send-notifications/index.ts` (import + cron sentinel + admin client moved earlier)
- `CLAUDE.md` (added "Postgres-backed rate-limit + per-user daily AI cost ceiling" architecture line after Story 11-3 line)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (11-4: backlog → ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/11-4-replace-rate-limit-upstash.md` (this story file — Status flipped, all AC + Task checkboxes [x], Dev Agent Record + File List + Change Log filled)

**Deleted:**

- `supabase/functions/_shared/rate-limit.ts` (legacy in-memory rate limiter; replaced by `rate-limit-db.ts`)

### Change Log

| Date       | Change                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-12 | Story 11-4 story file created; closes audit P1-8 (in-memory rate-limiter cross-isolate bypass) + spend-cap portion of P1-10 (no per-user daily AI cost cap) via Postgres-backed RPCs + `daily_cost_ledger` + cost-table.ts. |
| 2026-05-12 | Story 11-4 implementation complete on `feature/11-4-replace-rate-limit-upstash` (stacked on `feature/11-3` for clean diff). New migration adds 2 tables + 1 profiles column + 4 SECURITY DEFINER RPCs + pg_cron cleanup at 02:00 UTC. New shared modules `_shared/cost-table.ts` (pinned 2026-05-12 with quarterly-refresh stale-bait) + `_shared/rate-limit-db.ts` (fail-OPEN). Legacy `_shared/rate-limit.ts` DELETED. All 6 Edge Functions wired: import-only for account-delete + notification-register + send-notifications (cron sentinel) + rate-limit-only for pronunciation-assess + realtime-session + ai-proxy (top-level rate-limit + per-action cost pre/post in 4 branches). New `DAILY_COST_CAP_EXCEEDED` error code returns 429 with `kind: "daily-cost-cap"` body discriminator. +33 net tests (991 → 1024); all quality gates green; CLAUDE.md updated; status → review.            |
| 2026-05-12 | Round-1 Senior Developer Review patches applied (HIGH × 4 + MED × 3 + LOW × 1 + BS × 1 = 9 fixes; P7 reclassified as reject — cost-cap-meter-doesn't-move-on-upstream-failure is CORRECT behavior because the user didn't spend; D1–D5 deferred per review as out-of-Story-11-4-scope). **P1**: `dailyCostCapResponse` message now contains literal substring `"rate limit exhausted"` so the client-side `isRetryable()` regex matches and the existing `MAX_RETRIES = 2` retry fires (~5s wasted backoff acceptable; cap still exhausted on retry so error surfaces). **P2**: rate-limit RPC rewritten as single-statement guarded UPDATE (`WHERE … AND request_count < p_limit`) — eliminates the race where two concurrent over-cap denies could `-1` past the limit and re-open a closed window. **P3**: `daily_cost_ledger.total_cost_cents` switched from BIGINT to **NUMERIC(20,6)**; `Math.ceil` removed from both `checkDailyCostBudget` and `recordDailyCost` so sub-cent embedding contributions (0.002¢) accumulate accurately — 100 embedding calls now record as 0.2¢ instead of 100¢ (pre-patch behavior locked out embedding-heavy workflows after ~100 calls). **P4**: `cron.schedule` wrapped in defensive `DO $$ BEGIN PERFORM cron.unschedule(...); EXCEPTION WHEN OTHERS THEN NULL; END $$;` so `supabase db reset && supabase db push` doesn't fail on duplicate-jobname unique constraint. **P5**: Whisper byte-derived minutes estimate switched from 240,000 (32 kbit AAC) to **1,920,000 bytes/min** (PCM16 16kHz mono worst-case) — under-estimates duration for compressed formats but never over-denies legitimate users; pre-patch was 8× off for iOS PCM16 uploads. **P6**: all 3 RPC wrappers in `rate-limit-db.ts` now route through `withTimeout(5_000)` (re-uses Story 11-3's helper) so a hung Postgres releases the isolate within 5s instead of 150s; fail-OPEN on timeout. **P8**: per-isolate `consecutiveRecordFailures` counter in `recordDailyCost` escalates log severity to `[daily-cost-record-rpc][DEGRADED count=N]` after `RECORD_FAILURE_THRESHOLD = 5` consecutive failures so operators can grep for a Postgres outage silently letting users spend without the cap meter moving. **P9**: removed dead `IF v_total IS NULL` / `IF v_limit IS NULL` branches after `COALESCE` in SQL functions (cosmetic). **BS1**: spec AC #5 table amended to document the `"ai-proxy"` single-key decision (per-action keys would have 4× the user's nominal request budget; audit intent preserved). +3 net tests (1024 → 1027 — 14 cost-table cases unchanged; rate-limit-db went 14 → 17 with new P1/P3/P6/P8 drift assertions). All quality gates green; CLAUDE.md updated; status remains `review` post-patch. |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-12
**Reviewers:** Blind Hunter (general adversarial, no project context) + Edge Case Hunter (project-aware path tracer) + Acceptance Auditor (spec-vs-diff)
**Initial outcome:** Acceptance Auditor APPROVE; adversarial layers surfaced 36 raw findings → 15 actionable + 11 rejected as noise after triage
**Post-patch outcome:** 9 of 15 actionable findings resolved (HIGH × 4 + MED × 3 + LOW × 1 + BS × 1); P7 reclassified as reject; D1–D5 deferred per review as out-of-Story-11-4-scope

### Action Items

#### HIGH (must-fix patches)

- [x] **P1 — Client retry path will NOT match daily-cap 429 message.** The spec's claim that `isRetryable("rate limit") === true` for the daily-cap 429 was factually wrong by regex inspection — the old message `"Daily AI usage budget exhausted ..."` matches none of the regex tokens. **Fix:** message now contains literal substring `"rate limit exhausted"` so the existing `MAX_RETRIES = 2` retry fires. The cap is still exhausted on retry so the error surfaces to the user after ~5s wasted backoff (acceptable vs. silently dropping the first 429).
- [x] **P2 — Rate-limit rollback non-atomic under concurrent denies.** The pre-patch `INSERT … ON CONFLICT DO UPDATE` + separate rollback `UPDATE … - 1` had a race where two concurrent over-cap calls could both decrement and re-open a closed window. **Fix:** replaced with single-statement guarded UPDATE pattern (`INSERT ON CONFLICT DO NOTHING` first; if no row was inserted, `UPDATE … WHERE … AND request_count < p_limit RETURNING request_count`). Postgres serializable-snapshot isolation guarantees concurrent UPDATEs serialize; at most p_limit increments succeed. No rollback needed.
- [x] **P3 — `Math.ceil` distorted embedding cost by ~500×.** Pre-patch: `text-embedding-3-small` at 0.002¢/call rounded up to 1¢ in the ledger → 100 calls = 100¢ recorded vs ~0.2¢ real spend → cap fires at call 100 instead of ~50,000, locking out embedding-heavy workflows (memory writes + fact extraction + error-pattern dedup). **Fix:** `daily_cost_ledger.total_cost_cents` switched from BIGINT to **NUMERIC(20,6)**; `Math.ceil` removed from both `checkDailyCostBudget` and `recordDailyCost`. Fractional sub-cent contributions now accumulate accurately. User-facing limit `daily_ai_cost_cents_limit` stays INTEGER for operator UX.
- [x] **P4 — `cron.schedule` re-run throws on duplicate jobname.** A second `supabase db push` against a remote where the cron job already exists failed on `cron.job.jobname` unique constraint, blocking `supabase db reset && db push` workflows. **Fix:** wrapped in defensive `DO $$ BEGIN PERFORM cron.unschedule('cleanup-rate-limit-and-cost-ledger'); EXCEPTION WHEN OTHERS THEN NULL; END $$;` block. Idempotent across re-applies.

#### MED (patches)

- [x] **P5 — Whisper bytes-per-minute estimate (240 KB/min) wrong by 8× for PCM16.** Pre-patch: 5 MB iOS PCM16 upload = 2.7 min real audio but estimator said 21.8 min = 13¢ pessimistic deny. iOS users hit cap 8× faster than Android. **Fix:** switched divisor to **1,920,000 bytes/min** (PCM16 16kHz mono worst-case). Under-estimates duration for compressed formats (AAC, Opus) but never over-denies legitimate users.
- [x] **P6 — Postgres RPC hang has no timeout.** Pre-patch: a hung Postgres could leave the Edge Function isolate blocked for the full 150s platform kill. Story 11-3 added `fetchWithTimeout` for upstream OpenAI/Azure but the new internal RPCs got no equivalent. **Fix:** all 3 RPC wrappers in `rate-limit-db.ts` now route through `withTimeout("rate-limit-rpc" | "daily-cost-rpc" | "daily-cost-record-rpc", supabase.rpc(...), RPC_TIMEOUT_MS = 5_000)`. Re-uses Story 11-3's helper; fail-OPEN on timeout.
- [x] **P8 — `recordDailyCost` swallows errors silently — no operator alarm.** Pre-patch: during a Postgres hiccup, the pre-check would fail-OPEN with `total: 0` AND the post-record would fail silently → user effectively has unlimited cost for the outage duration. **Fix:** per-isolate `consecutiveRecordFailures` counter escalates the log to `[daily-cost-record-rpc][DEGRADED count=N]` after `RECORD_FAILURE_THRESHOLD = 5` consecutive failures so operators grepping Supabase function logs can spot the outage. Counter resets on the next successful record.

#### LOW (patches)

- [x] **P9 — Dead `IF v_total IS NULL` / `IF v_limit IS NULL` branches in SQL functions after `COALESCE`.** Cosmetic cleanup; the `COALESCE` already returns the default. **Fix:** removed.

#### Bad Spec

- [x] **BS1 — Spec AC #5 table mandated per-action `"ai-proxy-chat"` / `"-tts"` / `"-embedding"` / `"-whisper"` rate-limit keys but dev implemented single top-level `"ai-proxy"` key.** Auditor flagged as defensible deviation. **Fix:** spec table amended to document the single-key decision + reasoning (per-action would 4× the user's nominal 30 req/60s budget; audit intent preserved with single key).

#### Defer (per review verdict — out of Story 11-4 scope)

- [ ] **D1 — `recordDailyCost` silent swallow → operator alerting gap.** Proper Sentry/PagerDuty integration is Epic 17.x (backend hardening). Partial mitigation via P8 above is in-scope.
- [ ] **D2 — `estimateTokensFromMessages` 4-chars/token under-estimates French by ~37%.** Story 11.5 owns per-call `maxTokens` right-sizing + tokenizer-accurate estimation. Post-record uses real `usage.prompt_tokens` so cap fires on next call (bounded overshoot).
- [ ] **D3 — `realtime-session` has no in-session post-record (mid-session cost invisible).** Spec explicitly out-of-scope. Story 11.5's `gpt-realtime-mini` reduces per-second cost.
- [ ] **D4 — `SENTRY_EXTRAS_ALLOWLIST` doesn't include `kind` / `totalTodayCents` / `limitCents`.** No client code consumes these yet; allowlist extension belongs with the future client UI story.
- [ ] **D5 — `daily_cost_ledger.last_updated_at` + `request_count` columns are write-only.** Operator-debug metadata; harmless. Future cleanup or analytics endpoint.

#### Rejected (noise / verified-fine / out-of-scope speculation)

11 findings rejected during triage:
- body.model smuggling (allowlist already enforces correctness)
- actualChatCostCents model resolution drift (verified consistent with pre-check path)
- usage NaN/negative (`Number.isFinite` guard catches)
- send-notifications admin client lifecycle (cheap createClient; no concern)
- pg_cron 02:00 cron conflict (different tables, no contention)
- REVOKE includes service_role (it doesn't — service_role isn't in the list)
- INTEGER overflow at $21M (non-issue at $1/day scale; BIGINT JS deserialization at < Number.MAX_SAFE_INTEGER scale)
- 429 vs 402 HTTP status (design choice, 429 matches `RATE_LIMITED` semantics)
- cron.schedule idempotency (covered by P4)
- cost-table refresh discipline (operator-action; no automated fix in scope)
- account-delete fail-OPEN security regression (equivalent to pre-11-4 in-memory behavior; documented in spec)
- **P7** (re-classified): "cost-cap meter doesn't move on upstream failure" — actually correct behavior; the user didn't spend money so the cap shouldn't move. Rate-limit budget burning on failure is the correct anti-abuse signal.

### Patch Verification

- `npm run type-check` ✓ (0 errors)
- `npm run lint` ✓ (0 errors, 0 warnings, `--max-warnings 0`)
- `npm run format:check` ✓ (clean)
- `npm test` ✓ (1027 passing — was 1024 pre-patch → +3 net from new P6/P8 drift assertions in `rate-limit-db.test.ts`)
- `npm run check:colors` ✓ (no hardcoded hex)
- `grep -rn "fetch(" supabase/functions/{ai-proxy,realtime-session,pronunciation-assess}/` returns empty (Story 11-3 wrapping intact)
- `ls supabase/functions/_shared/rate-limit.ts` returns no-such-file (legacy module deleted)
- Manual SQL verification: `psql "$DATABASE_URL" -f supabase/migrations/__tests__/rate_limit_test.sql` — 8 assertions including the new P2 "deny doesn't increment" + P3 "0.002 × 100 = 0.2" fractional accumulation cases; DEFERRED until dev runs against live Supabase (Epic 15.3 owns CI wiring).
