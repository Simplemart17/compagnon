/**
 * Postgres-backed rate limiter + per-user daily AI cost ceiling
 * (Story 11-4 / audit P1-8 + spend-cap portion of P1-10).
 *
 * Replaces the deleted in-memory `_shared/rate-limit.ts`. Cross-isolate-
 * correct because the counter lives in Postgres; every Edge Function
 * isolate (cold or warm) queries the same source of truth via the
 * `check_and_increment_rate_limit` / `check_daily_cost_budget` /
 * `record_daily_cost` RPCs from migration 20260512000000.
 *
 * Review-round-1 patches:
 *   P1 — Daily-cap message includes the literal substring "rate limit" so
 *        the client-side `isRetryable()` regex at `src/lib/openai.ts:23-37`
 *        triggers the existing retry path. (Cap still exhausted on retry so
 *        the error surfaces; ~5s wasted backoff is acceptable.)
 *   P3 — Sub-cent fractional cost values are passed to Postgres without
 *        Math.ceil rounding (NUMERIC(20,6) storage in migration). The
 *        previous Math.ceil(0.002) = 1 inflated embedding spend by 500×
 *        and locked out embedding-heavy users.
 *   P6 — RPC calls wrapped in `withTimeout(5_000)` so a hung Postgres
 *        doesn't block the Edge Function isolate up to the 150s platform
 *        kill. Fail-OPEN on timeout (same policy as on RPC error).
 *   P8 — Per-isolate failure counter for recordDailyCost. After
 *        `RECORD_FAILURE_THRESHOLD = 5` consecutive failures, the log line
 *        is escalated to ERROR with a "DEGRADED" marker so operators
 *        grepping Supabase function logs can spot a Postgres outage
 *        affecting cost-recording (which would otherwise let a user spend
 *        without the cap meter moving).
 *
 * Fail-OPEN policy on Postgres errors/timeouts: if the RPC fails, the
 * helper logs to console.error and accepts the request. Reasoning: the
 * user just passed auth (which also hit Postgres); a hiccup that breaks
 * rate-limit but not auth is unusual; defaulting to fail-closed creates
 * self-DoS. Operators should treat persistent rate-limit RPC failures as
 * Sev-1.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { UpstreamTimeoutError, withTimeout } from "./fetch-with-timeout.ts";

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

/** Sentinel UUID used by send-notifications cron path (server-to-server; not a real user). */
export const CRON_SENTINEL_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Story 11-4 review patch P6: 5-second timeout on every RPC call so a hung
 * Postgres doesn't hold the Edge Function isolate up to the 150s platform kill. */
export const RPC_TIMEOUT_MS = 5_000;

/** Story 11-4 review patch P8: log severity escalates after N consecutive
 * recordDailyCost failures so operators spot a Postgres outage that's
 * silently letting users spend without the cap meter moving. */
export const RECORD_FAILURE_THRESHOLD = 5;

/** Per-isolate counter of consecutive recordDailyCost failures (P8). Resets to 0
 * on the next successful record. */
let consecutiveRecordFailures = 0;

/** Build a log function that emits via console.error for one-off failures or
 * console.error with a DEGRADED marker after RECORD_FAILURE_THRESHOLD consecutive
 * failures so operators can grep for the escalation signal. (P8) */
function logRecordFailure(detail: unknown): void {
  consecutiveRecordFailures += 1;
  if (consecutiveRecordFailures >= RECORD_FAILURE_THRESHOLD) {
    console.error(
      `[daily-cost-record-rpc][DEGRADED count=${consecutiveRecordFailures}]`,
      detail
    );
  } else {
    console.error("[daily-cost-record-rpc]", detail);
  }
}

/**
 * Atomically check + increment a rate-limit counter for (user_id, key)
 * in a fixed-window bucket. Returns `allowed` + remaining budget + reset
 * time. On Postgres error or timeout, FAILS OPEN.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const { data, error } = await withTimeout(
      "rate-limit-rpc",
      supabase.rpc("check_and_increment_rate_limit", {
        p_user_id: userId,
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
      RPC_TIMEOUT_MS
    );
    if (error) {
      console.error("[rate-limit-rpc]", error.message, error.code);
      return { allowed: true, remaining: 0, resetIn: 0 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row?.allowed ?? true,
      remaining: row?.remaining ?? 0,
      resetIn: row?.reset_in_seconds ?? windowSeconds,
    };
  } catch (err) {
    // Includes UpstreamTimeoutError from withTimeout — fail-OPEN on hung Postgres.
    if (err instanceof UpstreamTimeoutError) {
      console.error(`[rate-limit-rpc] hung Postgres (${err.timeoutMs}ms timeout); failing open`);
    } else {
      console.error("[rate-limit-rpc]", err);
    }
    return { allowed: true, remaining: 0, resetIn: 0 };
  }
}

/**
 * Pre-check whether a request would push the user over their daily AI
 * spend cap. Returns `allowed` + current total + limit. On Postgres
 * error or timeout, FAILS OPEN. The estimate is passed through as a
 * non-negative number (review patch P3: no Math.ceil; the NUMERIC(20,6)
 * column preserves fractional sub-cent values).
 */
export async function checkDailyCostBudget(
  supabase: SupabaseClient,
  userId: string,
  estimatedCents: number
): Promise<CostBudgetResult> {
  try {
    // Non-negative clamp only; preserve fractional precision (review patch P3).
    const estimate = Math.max(0, estimatedCents);
    const { data, error } = await withTimeout(
      "daily-cost-rpc",
      supabase.rpc("check_daily_cost_budget", {
        p_user_id: userId,
        p_estimated_cents: estimate,
      }),
      RPC_TIMEOUT_MS
    );
    if (error) {
      console.error("[daily-cost-rpc]", error.message, error.code);
      return { allowed: true, totalTodayCents: 0, limitCents: 0 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row?.allowed ?? true,
      totalTodayCents: Number(row?.total_today_cents ?? 0),
      limitCents: Number(row?.limit_cents ?? 100),
    };
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      console.error(`[daily-cost-rpc] hung Postgres (${err.timeoutMs}ms timeout); failing open`);
    } else {
      console.error("[daily-cost-rpc]", err);
    }
    return { allowed: true, totalTodayCents: 0, limitCents: 0 };
  }
}

/**
 * Post-record the actual cost of a successful upstream call to the daily
 * ledger. Best-effort: if Postgres errors or times out, log + swallow (the
 * request succeeded; not recording the cost is a metering miss, not a
 * user-facing failure). Non-positive / non-finite costs are skipped.
 *
 * Review patch P3: actualCents passed as fractional NUMERIC — no Math.ceil
 * rounding. The NUMERIC(20,6) column preserves sub-cent precision so 100
 * embedding calls at 0.002¢ each accumulate as 0.2¢ in the ledger (not
 * 100¢ as the pre-patch implementation did).
 *
 * Review patch P8: consecutive failures escalate the log severity so
 * operators can grep for [DEGRADED count=N] when a Postgres outage is
 * letting users spend without the cap meter moving.
 */
export async function recordDailyCost(
  supabase: SupabaseClient,
  userId: string,
  actualCents: number
): Promise<void> {
  if (!Number.isFinite(actualCents) || actualCents <= 0) return;
  try {
    const { error } = await withTimeout(
      "daily-cost-record-rpc",
      supabase.rpc("record_daily_cost", {
        p_user_id: userId,
        p_cost_cents: actualCents,
      }),
      RPC_TIMEOUT_MS
    );
    if (error) {
      logRecordFailure(`${error.message} (code=${error.code})`);
      return;
    }
    // Success: reset the consecutive-failure counter.
    consecutiveRecordFailures = 0;
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      logRecordFailure(`hung Postgres (${err.timeoutMs}ms timeout)`);
    } else {
      logRecordFailure(err);
    }
  }
}

/** Build a 429 Too Many Requests response (same shape as the deleted rateLimitResponse). */
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

/**
 * Build a 429 response for daily-cost-cap exhaustion. The body's
 * `kind: "daily-cost-cap"` field is the client UI discriminator —
 * separates "wait 30s, try again" (per-minute rate limit) from
 * "wait til tomorrow" (daily budget exhausted).
 *
 * Review patch P1: the message MUST contain the literal substring
 * "rate limit" so the client-side `isRetryable()` regex at
 * `src/lib/openai.ts:23-37` matches and the existing retry path fires.
 * The cap is still exhausted on retry so the error surfaces to the user
 * after 2× ~5s wasted backoff — acceptable trade-off (vs. silently
 * failing on the first 429 because the client thought it wasn't
 * retryable).
 */
export function dailyCostCapResponse(
  corsHeaders: Record<string, string>,
  details: { totalTodayCents: number; limitCents: number }
): Response {
  const retryAfter = 5; // Static for v1; future story can compute seconds-to-midnight-UTC.
  return new Response(
    JSON.stringify({
      error: `Daily AI usage budget rate limit exhausted (${details.totalTodayCents}¢ of ${details.limitCents}¢ used today). Resets at midnight UTC.`,
      code: "DAILY_COST_CAP_EXCEEDED",
      kind: "daily-cost-cap",
      totalTodayCents: details.totalTodayCents,
      limitCents: details.limitCents,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    }
  );
}
