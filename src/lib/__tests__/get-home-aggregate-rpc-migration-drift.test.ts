/**
 * Story 13-2 — `get_home_aggregate` RPC migration drift detector
 * (audit P2-5 closure).
 *
 * Pins the post-13-2 SQL contract against silent regression by reading
 * the migration file from disk + applying targeted regex assertions on
 * the SECURITY DEFINER + hardening + structural shape + bounded-budget
 * LIMIT constants.
 *
 * Mirrors Story 11-6 / 12-3 migration-drift detector pattern.
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
  "20260515000000_get_home_aggregate_rpc.sql"
);
const SQL = readFileSync(MIGRATION_PATH, "utf-8");

describe("get_home_aggregate RPC — Story 13-2 migration drift detector (audit P2-5)", () => {
  it("Case 1: function signature `get_home_aggregate(p_user_id uuid, p_date date, p_now timestamptz DEFAULT now())` RETURNS jsonb", () => {
    // Story 13-2 review-round-1 P3: p_now parameter added so SRS-due
    // cutoff shares "now" definition with the client's local-date. The
    // DEFAULT now() preserves 2-arg-call back-compat via Postgres'
    // default-argument resolution.
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION get_home_aggregate\(\s*p_user_id\s+uuid\s*,\s*p_date\s+date\s*,\s*p_now\s+timestamptz\s+DEFAULT\s+now\(\)\s*\)\s+RETURNS\s+jsonb/i
    );
  });

  it("Case 2: SECURITY DEFINER + SET search_path = public (Story 9-9 hardening)", () => {
    expect(SQL).toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/SET search_path = public/);
  });

  it("Case 3: auth.uid() IS DISTINCT FROM p_user_id defense-in-depth + RAISE EXCEPTION", () => {
    expect(SQL).toMatch(/IF\s+auth\.uid\(\)\s+IS DISTINCT FROM\s+p_user_id\s+THEN/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'auth\.uid\(\) must match p_user_id'/);
  });

  it("Case 4: REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated", () => {
    // Story 13-2 review-round-1 P3: signature now (uuid, date, timestamptz).
    expect(SQL).toMatch(
      /REVOKE EXECUTE ON FUNCTION get_home_aggregate\(uuid, date, timestamptz\) FROM PUBLIC/
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION get_home_aggregate\(uuid, date, timestamptz\) TO authenticated/
    );
  });

  it("Case 5: all 9 top-level JSONB keys present in the final RETURN jsonb_build_object", () => {
    // Anchor on the RETURN jsonb_build_object block — the 9 keys MUST
    // appear inside this single object construction.
    const returnMatch = SQL.match(/RETURN\s+jsonb_build_object\(\s*([\s\S]*?)\s*\)\s*;/);
    expect(returnMatch).not.toBeNull();
    const body = returnMatch![1];
    expect(body).toMatch(/'skills'\s*,/);
    expect(body).toMatch(/'daily_activity_today'\s*,/);
    expect(body).toMatch(/'recent_activity'\s*,/);
    expect(body).toMatch(/'top_errors'\s*,/);
    expect(body).toMatch(/'streak_days'\s*,/);
    expect(body).toMatch(/'weakest_skill'\s*,/);
    expect(body).toMatch(/'srs_due_count'\s*,/);
    expect(body).toMatch(/'error_counts'\s*,/);
    expect(body).toMatch(/'has_activity_today'\s*,?/);
  });

  it("Case 6: idempotent migration — CREATE OR REPLACE FUNCTION (not bare CREATE)", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION get_home_aggregate/);
    // Bare CREATE FUNCTION (without OR REPLACE) would fail on re-run.
    expect(SQL).not.toMatch(/CREATE FUNCTION get_home_aggregate/);
  });

  it("Case 7: bounded-budget LIMIT constants pinned — recent_activity LIMIT 7, top_errors LIMIT 5", () => {
    // Story 11-7 bounded-budget cap pattern: every LIMIT is a load-bearing
    // contract that consumers depend on. A future drift to LIMIT 14 / LIMIT 10
    // would change the UI shape without anyone noticing.
    expect(SQL).toMatch(/FROM daily_activity[\s\S]+?LIMIT\s+7/);
    expect(SQL).toMatch(/FROM error_patterns[\s\S]+?LIMIT\s+5/);
  });

  it("Case 8: top_errors WHERE resolved = false (unresolved-only contract)", () => {
    expect(SQL).toMatch(
      /FROM error_patterns\s+WHERE\s+user_id\s*=\s*p_user_id\s+AND\s+resolved\s*=\s*false/
    );
  });

  it("Case 9: weakest_skill ORDER BY score ASC LIMIT 1 (lowest-score wins)", () => {
    expect(SQL).toMatch(/FROM skill_progress[\s\S]+?ORDER BY score ASC[\s\S]+?LIMIT\s+1/);
  });

  it("Case 10: srs_due_count uses `next_review <= p_now` predicate (P3 fix)", () => {
    // Story 13-2 review-round-1 P3: pre-patch used Postgres `now()` UTC,
    // post-patch uses `p_now` from the client (local-timezone-consistent
    // with `p_date`).
    expect(SQL).toMatch(
      /FROM vocabulary\s+WHERE\s+user_id\s*=\s*p_user_id\s+AND\s+next_review\s*<=\s*p_now/
    );
  });

  it("Case 11: top_errors ORDER BY occurrences DESC (highest-occurrence wins)", () => {
    expect(SQL).toMatch(/FROM error_patterns[\s\S]+?ORDER BY occurrences DESC/);
  });

  it("Case 12: recent_activity ORDER BY date DESC (most-recent first)", () => {
    expect(SQL).toMatch(/FROM daily_activity[\s\S]+?ORDER BY date DESC[\s\S]+?LIMIT\s+7/);
  });

  it("Case 13: error_counts uses single-query FILTER (P2 race fix)", () => {
    // Story 13-2 review-round-1 P2: pre-patch used two separate SELECT
    // COUNT(*) queries; concurrent UPDATE could produce `resolved > total`.
    // Post-patch uses a single query with COUNT(*) FILTER (WHERE resolved
    // = true) so both counts come from the same atomic scan.
    expect(SQL).toMatch(/COUNT\(\*\)\s+FILTER\s*\(\s*WHERE\s+resolved\s*=\s*true\s*\)/);
    // Negative guard: the two separate SELECT COUNT(*) queries are GONE.
    expect(SQL).not.toMatch(
      /SELECT\s+COUNT\(\*\)::integer\s+INTO\s+v_resolved_errors\s+FROM\s+error_patterns/
    );
  });

  it("Case 14: p_now parameter wired to vocabulary WHERE clause (P3 fix)", () => {
    // Story 13-2 review-round-1 P3: ensure the new parameter is actually
    // consumed in the SRS-due-count query, not just declared and ignored.
    const args = SQL.match(/get_home_aggregate\(\s*p_user_id[\s\S]*?\)\s+RETURNS/);
    expect(args).not.toBeNull();
    expect(args![0]).toMatch(/p_now\s+timestamptz/);
    expect(SQL).toMatch(/next_review\s*<=\s*p_now/);
  });
});
