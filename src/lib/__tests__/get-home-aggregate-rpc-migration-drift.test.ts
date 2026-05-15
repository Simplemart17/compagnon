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
  it("Case 1: function signature `get_home_aggregate(p_user_id uuid, p_date date) RETURNS jsonb`", () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION get_home_aggregate\(\s*p_user_id\s+uuid\s*,\s*p_date\s+date\s*\)\s+RETURNS\s+jsonb/i
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
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION get_home_aggregate\(uuid, date\) FROM PUBLIC/);
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION get_home_aggregate\(uuid, date\) TO authenticated/
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

  it("Case 10: srs_due_count uses `next_review <= now()` predicate", () => {
    expect(SQL).toMatch(
      /FROM vocabulary\s+WHERE\s+user_id\s*=\s*p_user_id\s+AND\s+next_review\s*<=\s*now\(\)/
    );
  });

  it("Case 11: top_errors ORDER BY occurrences DESC (highest-occurrence wins)", () => {
    expect(SQL).toMatch(/FROM error_patterns[\s\S]+?ORDER BY occurrences DESC/);
  });

  it("Case 12: recent_activity ORDER BY date DESC (most-recent first)", () => {
    expect(SQL).toMatch(/FROM daily_activity[\s\S]+?ORDER BY date DESC[\s\S]+?LIMIT\s+7/);
  });
});
