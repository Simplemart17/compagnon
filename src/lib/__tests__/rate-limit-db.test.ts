/**
 * Story 11-4 — rate-limit-db drift detector + helper contract test.
 *
 * Reads the Deno source at `supabase/functions/_shared/rate-limit-db.ts`
 * from disk (Deno context is excluded from `tsconfig.json`) and pins the
 * load-bearing invariants: fail-OPEN policy, sentinel UUID for cron path,
 * response-builder body shapes including the `kind: "daily-cost-cap"`
 * client UI discriminator, the per-helper RPC name constants, and the
 * post-review-round-1 patches (P1 message format / P3 fractional cents /
 * P6 withTimeout / P8 failure counter).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const RATE_LIMIT_DB_PATH = resolve(
  __dirname,
  "../../../supabase/functions/_shared/rate-limit-db.ts"
);
const RATE_LIMIT_DB_SOURCE = readFileSync(RATE_LIMIT_DB_PATH, "utf-8");

describe("rate-limit-db (Story 11-4) — Deno-source drift detector", () => {
  it("source file exists and is readable", () => {
    expect(RATE_LIMIT_DB_SOURCE.length).toBeGreaterThan(500);
  });

  it("exports the 5 helper functions + the cron sentinel constant + new patch constants", () => {
    expect(RATE_LIMIT_DB_SOURCE).toMatch(
      /export const CRON_SENTINEL_USER_ID\s*=\s*"00000000-0000-0000-0000-000000000000"/
    );
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export async function checkRateLimit\(/);
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export async function checkDailyCostBudget\(/);
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export async function recordDailyCost\(/);
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export function rateLimitResponse\(/);
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export function dailyCostCapResponse\(/);
    // P6: RPC timeout constant exported
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export const RPC_TIMEOUT_MS\s*=\s*5_000/);
    // P8: failure counter threshold constant exported
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/export const RECORD_FAILURE_THRESHOLD\s*=\s*5/);
  });

  it("checkRateLimit invokes the check_and_increment_rate_limit RPC", () => {
    expect(RATE_LIMIT_DB_SOURCE).toContain('"check_and_increment_rate_limit"');
  });

  it("checkDailyCostBudget invokes the check_daily_cost_budget RPC", () => {
    expect(RATE_LIMIT_DB_SOURCE).toContain('"check_daily_cost_budget"');
  });

  it("recordDailyCost invokes the record_daily_cost RPC", () => {
    expect(RATE_LIMIT_DB_SOURCE).toContain('"record_daily_cost"');
  });

  it("fail-OPEN policy is explicit in all 3 RPC wrappers (returns allowed: true on error)", () => {
    // Each helper's catch block must return allowed: true so a Postgres
    // outage doesn't self-DoS the user. Count the literal `allowed: true`
    // occurrences in the fail-OPEN branches.
    const failOpenMatches = RATE_LIMIT_DB_SOURCE.match(/allowed:\s*true/g) ?? [];
    // Two for checkRateLimit (error branch + catch branch), two for
    // checkDailyCostBudget = 4 total. Loosen to >= 4 in case of comment drift.
    expect(failOpenMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("all 3 RPC wrappers log to console.error on failure (operator visibility)", () => {
    expect(RATE_LIMIT_DB_SOURCE).toContain('console.error("[rate-limit-rpc]"');
    expect(RATE_LIMIT_DB_SOURCE).toContain('console.error("[daily-cost-rpc]"');
    // P8: daily-cost-record uses the logRecordFailure helper which prefixes
    // [daily-cost-record-rpc] (and adds [DEGRADED count=N] after threshold).
    expect(RATE_LIMIT_DB_SOURCE).toContain("[daily-cost-record-rpc]");
  });

  it("recordDailyCost guards against negative or NaN costs (no-op)", () => {
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/actualCents\s*<=\s*0/);
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/Number\.isFinite\(actualCents\)/);
  });

  it("P3 — checkDailyCostBudget clamps non-negative but does NOT Math.ceil (fractional cents preserved)", () => {
    // Story 11-4 review patch P3: `daily_cost_ledger.total_cost_cents` is
    // NUMERIC(20,6); the helper passes through fractional sub-cent values.
    // The previous `Math.ceil(Math.max(0, estimatedCents))` inflated
    // embeddings by 500× by rounding 0.002¢ up to 1¢.
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/Math\.max\(0,\s*estimatedCents\)/);
    // Negative guard: the specific pre-patch nested-ceil pattern.
    expect(RATE_LIMIT_DB_SOURCE).not.toMatch(/Math\.ceil\(Math\.max\(0,\s*estimatedCents\)\)/);
  });

  it("P3 — recordDailyCost does NOT call Math.ceil on the cost (fractional cents preserved)", () => {
    // Negative guard against the specific pre-patch call patterns. JSDoc may
    // reference Math.ceil historically (documenting the patch); only the
    // actual call expressions matter here.
    expect(RATE_LIMIT_DB_SOURCE).not.toMatch(/Math\.ceil\(actualCents\)/);
    expect(RATE_LIMIT_DB_SOURCE).not.toMatch(/Math\.ceil\(Math\.max\(0/);
  });

  it("P6 — all 3 RPC wrappers route through `withTimeout` from fetch-with-timeout.ts", () => {
    // Story 11-4 review patch P6: hung Postgres must release the isolate
    // within RPC_TIMEOUT_MS (5s) instead of holding it for the 150s
    // platform kill. `withTimeout` is imported from Story 11-3's helper
    // module and called around every `supabase.rpc(...)` invocation.
    expect(RATE_LIMIT_DB_SOURCE).toContain(
      'import { UpstreamTimeoutError, withTimeout } from "./fetch-with-timeout.ts"'
    );
    const withTimeoutCalls = RATE_LIMIT_DB_SOURCE.match(/withTimeout\(/g) ?? [];
    expect(withTimeoutCalls.length).toBeGreaterThanOrEqual(3);
    // The catch path discriminates UpstreamTimeoutError so the log message
    // can distinguish "Postgres hung" from "Postgres errored".
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/err instanceof UpstreamTimeoutError/);
  });

  it("P8 — recordDailyCost escalates log severity after RECORD_FAILURE_THRESHOLD consecutive failures", () => {
    // Story 11-4 review patch P8: per-isolate failure counter that emits a
    // [DEGRADED count=N] marker after N consecutive failures so operators
    // grepping Supabase function logs can spot a Postgres outage that's
    // silently letting users spend without the cap meter moving.
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/consecutiveRecordFailures\s*\+?=\s*1?/);
    expect(RATE_LIMIT_DB_SOURCE).toContain("[DEGRADED count=");
    // Success resets the counter.
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/consecutiveRecordFailures\s*=\s*0/);
  });

  it("rateLimitResponse returns 429 + RATE_LIMITED + Retry-After header", () => {
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/status:\s*429/);
    expect(RATE_LIMIT_DB_SOURCE).toContain('"RATE_LIMITED"');
    expect(RATE_LIMIT_DB_SOURCE).toContain('"Retry-After"');
  });

  it("dailyCostCapResponse uses code DAILY_COST_CAP_EXCEEDED + kind discriminator", () => {
    expect(RATE_LIMIT_DB_SOURCE).toContain('"DAILY_COST_CAP_EXCEEDED"');
    expect(RATE_LIMIT_DB_SOURCE).toContain('kind: "daily-cost-cap"');
  });

  it("P1 — dailyCostCapResponse message contains the literal 'rate limit' substring", () => {
    // Story 11-4 review patch P1: the client-side `isRetryable()` regex at
    // `src/lib/openai.ts:23-37` is `/network|timeout|fetch|500|502|503|429|rate limit/`.
    // Without "rate limit" in the message, the client doesn't retry the
    // daily-cap 429 even though the response code is 429. Cap still
    // exhausted on retry so error surfaces; ~5s wasted backoff is OK.
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/rate limit exhausted/i);
  });

  it("dailyCostCapResponse body carries totalTodayCents + limitCents for the client banner copy", () => {
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/totalTodayCents:\s*details\.totalTodayCents/);
    expect(RATE_LIMIT_DB_SOURCE).toMatch(/limitCents:\s*details\.limitCents/);
  });

  it("CRON_SENTINEL_USER_ID is the all-zeros UUID (send-notifications cron path)", () => {
    expect(RATE_LIMIT_DB_SOURCE).toContain('"00000000-0000-0000-0000-000000000000"');
  });

  it("does NOT throw on Postgres error (fail-OPEN by construction)", () => {
    // Negative guard: a future refactor that changes fail-OPEN to fail-CLOSED
    // would introduce `throw new Error(...)` inside the catch blocks. Catch
    // it before merge.
    const catchBlocks = RATE_LIMIT_DB_SOURCE.match(/catch\s*\([^)]+\)\s*\{[^}]*\}/g) ?? [];
    for (const block of catchBlocks) {
      expect(block).not.toMatch(/throw\s+new/);
    }
  });
});
