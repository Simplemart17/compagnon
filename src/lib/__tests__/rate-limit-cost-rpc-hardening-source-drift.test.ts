/**
 * Ship-blocker hardening — drift detector for the rate-limit + daily-cost RPC
 * security fix (migration 20260518000000).
 *
 * Reads the SQL migration from disk and pins the load-bearing security contract
 * so a future refactor cannot silently reopen the cost-cap bypass:
 *   - all 3 RPCs carry the auth.uid() cross-user-forge guard,
 *   - the guard PERMITS service-role (auth.uid() IS NULL) callers so the
 *     send-notifications cron path keeps working (it uses a service-role client
 *     + the cron sentinel user id),
 *   - record_daily_cost + check_daily_cost_budget clamp their cost param
 *     non-negative (GREATEST(0, ...)) so a negative contribution cannot drive
 *     the ledger down and bypass the daily spend cap,
 *   - SECURITY DEFINER + SET search_path = public are preserved (Story 9-9).
 *
 * Pattern mirrors `atomic-activity-rpcs-migration-drift.test.ts` (Story 12-3)
 * and `error-patterns-migration-drift.test.ts` (Story 11-6) — real-source
 * disk-reading drift detectors that bypass module-level mocks.
 */

import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20260518000000_rate_limit_cost_rpc_hardening.sql"
);

const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

// The authoritative deployment artifact for the shared-project (companion
// schema) migration — carries the actual GRANT/REVOKE for these RPCs.
const COMPANION_SCHEMA_PATH = join(__dirname, "..", "..", "..", "supabase", "companion-schema.sql");
const COMPANION_SCHEMA_SOURCE = readFileSync(COMPANION_SCHEMA_PATH, "utf8");

/** The service-role-permitting cross-user-forge guard, whitespace-tolerant. */
const GUARD_RE =
  /IF\s+auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+auth\.uid\(\)\s+IS\s+DISTINCT\s+FROM\s+p_user_id\s+THEN\s+RAISE\s+EXCEPTION/gi;

describe("rate-limit + cost RPC hardening migration — drift detector", () => {
  it("redefines all 3 rate/cost RPCs via CREATE OR REPLACE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE OR REPLACE FUNCTION check_and_increment_rate_limit\b/i
    );
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION check_daily_cost_budget\b/i);
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION record_daily_cost\b/i);
  });

  it("all 3 functions carry the auth.uid() cross-user-forge guard", () => {
    const matches = MIGRATION_SOURCE.match(GUARD_RE) ?? [];
    expect(matches.length).toBe(3);
  });

  it("guard PERMITS service-role (auth.uid IS NULL) so the notification cron path survives", () => {
    // The guard MUST be `IS NOT NULL AND ... IS DISTINCT FROM`, NOT the stricter
    // bare `IS DISTINCT FROM` (which would RAISE for the NULL service-role caller
    // and break send-notifications' cron rate-limit check).
    expect(MIGRATION_SOURCE).toMatch(/auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND/i);
    // NEGATIVE: no bare `IF auth.uid() IS DISTINCT FROM p_user_id` without the
    // preceding `IS NOT NULL AND` (that would be the service-role-breaking form).
    expect(MIGRATION_SOURCE).not.toMatch(
      /IF\s+auth\.uid\(\)\s+IS\s+DISTINCT\s+FROM\s+p_user_id\s+THEN/i
    );
  });

  it("record_daily_cost clamps p_cost_cents non-negative (closes the negative-bypass)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /p_cost_cents\s*:=\s*GREATEST\(\s*0(::numeric)?\s*,\s*p_cost_cents\s*\)/i
    );
  });

  it("check_daily_cost_budget clamps p_estimated_cents non-negative", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /p_estimated_cents\s*:=\s*GREATEST\(\s*0(::numeric)?\s*,\s*p_estimated_cents\s*\)/i
    );
  });

  it("preserves SECURITY DEFINER + SET search_path = public on all 3 (Story 9-9)", () => {
    const definer = MIGRATION_SOURCE.match(/SECURITY DEFINER/gi) ?? [];
    const searchPath = MIGRATION_SOURCE.match(/SET search_path = public/gi) ?? [];
    expect(definer.length).toBeGreaterThanOrEqual(3);
    expect(searchPath.length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT weaken the ledger increment away from an additive upsert", () => {
    // The ON CONFLICT accumulation must remain additive on the stored value.
    expect(MIGRATION_SOURCE).toMatch(
      /total_cost_cents\s*=\s*daily_cost_ledger\.total_cost_cents\s*\+\s*p_cost_cents/i
    );
  });

  // D3 (code-review): the guard PERMITS `auth.uid() IS NULL` for the
  // service-role/cron caller. That is ONLY safe because `anon` (also
  // auth.uid()=NULL) cannot reach these RPCs. Pin that safety net in the
  // authoritative companion-schema artifact so a future grant to anon/public
  // (which would re-open a cross-user forge + cost bypass) fails CI.
  it("D3: cost/rate RPCs are REVOKE'd from PUBLIC and never granted to anon/public", () => {
    const rpcs = ["check_and_increment_rate_limit", "check_daily_cost_budget", "record_daily_cost"];
    for (const fn of rpcs) {
      // Must be revoked from PUBLIC.
      expect(COMPANION_SCHEMA_SOURCE).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION companion\\.${fn}\\([^)]*\\) FROM PUBLIC`)
      );
      // Every GRANT of this function must target only authenticated/service_role.
      const grants = [
        ...COMPANION_SCHEMA_SOURCE.matchAll(
          new RegExp(`GRANT EXECUTE ON FUNCTION companion\\.${fn}\\([^)]*\\) TO ([^;]+);`, "g")
        ),
      ];
      expect(grants.length).toBeGreaterThan(0);
      for (const g of grants) {
        expect(g[1]).not.toMatch(/\banon\b/);
        expect(g[1]).not.toMatch(/\bpublic\b/i);
      }
    }
  });
});
