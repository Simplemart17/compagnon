/**
 * Story 12-3 — drift detector for the atomic-activity-RPCs migration.
 *
 * Reads the SQL migration file from disk and pins the load-bearing contract
 * via regex assertions. Catches a future refactor that:
 *   - silently drops one of the 4 RPC functions,
 *   - removes SECURITY DEFINER / SET search_path = public (Story 9-9),
 *   - removes the auth.uid() defense-in-depth check,
 *   - relaxes the compare-and-swap WHERE clause on promote_cefr_level_atomic,
 *   - removes the ON CONFLICT (user_id, skill) DO UPDATE clause that anchors
 *     the row-lock serialization for update_skill_progress_atomic,
 *   - removes REVOKE EXECUTE FROM PUBLIC / GRANT EXECUTE TO authenticated.
 *
 * Pattern mirrors `error-patterns-migration-drift.test.ts` (Story 11-6),
 * `cost-table.test.ts` (Story 11-4), `rate-limit-db.test.ts` (Story 11-4) —
 * all real-source disk-reading drift detectors that bypass module-level mocks.
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
  "20260514000000_atomic_activity_rpcs.sql"
);

const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

describe("atomic-activity-RPCs migration — drift detector (Story 12-3)", () => {
  it("declares all 4 RPC functions via `CREATE OR REPLACE FUNCTION`", () => {
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION update_streak_atomic\b/i);
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION update_skill_progress_atomic\b/i);
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE OR REPLACE FUNCTION increment_daily_activity_atomic\b/i
    );
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION promote_cefr_level_atomic\b/i);
  });

  it("each function is SECURITY DEFINER + SET search_path = public (Story 9-9 hardening)", () => {
    // Count SECURITY DEFINER + SET search_path occurrences — must be ≥ 4 (one per function).
    const securityDefinerMatches = MIGRATION_SOURCE.match(/SECURITY DEFINER/g) ?? [];
    expect(securityDefinerMatches.length).toBeGreaterThanOrEqual(4);
    const searchPathMatches = MIGRATION_SOURCE.match(/SET search_path = public/g) ?? [];
    expect(searchPathMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("each function has the auth.uid() defense-in-depth check that raises on mismatch", () => {
    // Pattern: `IF auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION ...`
    const checks =
      MIGRATION_SOURCE.match(/IF auth\.uid\(\) IS DISTINCT FROM p_user_id THEN/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(4);
    const raises =
      MIGRATION_SOURCE.match(/RAISE EXCEPTION 'auth\.uid\(\) must match p_user_id'/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(4);
  });

  it("each function has REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated (Story 9-9 grant pattern)", () => {
    const revokes =
      MIGRATION_SOURCE.match(/REVOKE EXECUTE ON FUNCTION \w+\(.*?\) FROM PUBLIC/g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(4);
    const grants =
      MIGRATION_SOURCE.match(/GRANT EXECUTE ON FUNCTION \w+\(.*?\) TO authenticated/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(4);
  });

  // ---------------------------------------------------------------------------
  // update_streak_atomic — single-statement streak math
  // ---------------------------------------------------------------------------

  it("update_streak_atomic uses CASE for the today/yesterday/reset branches (single statement)", () => {
    // Must contain all three arms of the CASE expression
    expect(MIGRATION_SOURCE).toMatch(/WHEN last_active_date = p_today THEN/);
    expect(MIGRATION_SOURCE).toMatch(
      /WHEN last_active_date = p_yesterday THEN COALESCE\(streak_days, 0\) \+ 1/
    );
    // The "ELSE 1" branch resets the streak when there's a gap
    expect(MIGRATION_SOURCE).toMatch(/ELSE 1\s+END/);
  });

  // ---------------------------------------------------------------------------
  // update_skill_progress_atomic — INSERT ... ON CONFLICT DO UPDATE
  // ---------------------------------------------------------------------------

  it("update_skill_progress_atomic uses INSERT ... ON CONFLICT (user_id, skill) DO UPDATE (row-lock serialization)", () => {
    // Critical: this is the load-bearing concurrency primitive
    expect(MIGRATION_SOURCE).toMatch(/INSERT INTO skill_progress/i);
    expect(MIGRATION_SOURCE).toMatch(/ON CONFLICT \(user_id, skill\) DO UPDATE/i);
  });

  it("update_skill_progress_atomic computes running-average math server-side", () => {
    // The math: ((prev_score * prev_exercises) + incoming) / (prev_exercises + 1)
    expect(MIGRATION_SOURCE).toMatch(
      /skill_progress\.score \* skill_progress\.exercises_completed[\s\S]+EXCLUDED\.score[\s\S]+skill_progress\.exercises_completed \+ 1/
    );
  });

  it("update_skill_progress_atomic preserves the no-regress CEFR rule via array_position comparison", () => {
    // The inline CASE checks: if EXCLUDED.cefr_level's index > current's index, use EXCLUDED; else keep current
    expect(MIGRATION_SOURCE).toMatch(
      /array_position\(\s*ARRAY\['A1','A2','B1','B2','C1','C2'\],\s*EXCLUDED\.cefr_level/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /array_position\(\s*ARRAY\['A1','A2','B1','B2','C1','C2'\],\s*skill_progress\.cefr_level/
    );
  });

  it("update_skill_progress_atomic clamps incoming score to [0, 100] server-side as belt-and-braces", () => {
    // GREATEST(0, LEAST(100, COALESCE(...))) clamps both ends
    expect(MIGRATION_SOURCE).toMatch(
      /GREATEST\(0, LEAST\(100, COALESCE\(p_incoming_score, 0\)\)\)/
    );
  });

  // ---------------------------------------------------------------------------
  // increment_daily_activity_atomic — atomic cumulative-add upsert
  // ---------------------------------------------------------------------------

  it("increment_daily_activity_atomic uses INSERT ... ON CONFLICT (user_id, date) DO UPDATE (cumulative add)", () => {
    expect(MIGRATION_SOURCE).toMatch(/INSERT INTO daily_activity/i);
    expect(MIGRATION_SOURCE).toMatch(/ON CONFLICT \(user_id, date\) DO UPDATE/i);
    // The 4 cumulative-add patterns
    expect(MIGRATION_SOURCE).toMatch(
      /minutes_practiced\s*=\s*daily_activity\.minutes_practiced\s*\+\s*EXCLUDED\.minutes_practiced/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /exercises_completed\s*=\s*daily_activity\.exercises_completed\s*\+\s*EXCLUDED\.exercises_completed/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /conversations_completed\s*=\s*daily_activity\.conversations_completed\s*\+\s*EXCLUDED\.conversations_completed/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /words_learned\s*=\s*daily_activity\.words_learned\s*\+\s*EXCLUDED\.words_learned/
    );
  });

  // ---------------------------------------------------------------------------
  // promote_cefr_level_atomic — compare-and-swap
  // ---------------------------------------------------------------------------

  it("promote_cefr_level_atomic uses compare-and-swap WHERE clause (current = expected)", () => {
    // Load-bearing: this is the concurrency primitive that prevents level-skipping
    expect(MIGRATION_SOURCE).toMatch(/UPDATE profiles\s+SET current_cefr_level = p_next_level/);
    expect(MIGRATION_SOURCE).toMatch(/AND current_cefr_level = p_expected_current_level/);
  });

  it("promote_cefr_level_atomic returns BOOLEAN via GET DIAGNOSTICS ROW_COUNT (TRUE on swap, FALSE on race)", () => {
    expect(MIGRATION_SOURCE).toMatch(/GET DIAGNOSTICS v_rows_updated = ROW_COUNT/);
    expect(MIGRATION_SOURCE).toMatch(/RETURN v_rows_updated = 1/);
  });

  // ---------------------------------------------------------------------------
  // Migration-level safety
  // ---------------------------------------------------------------------------

  it("migration is idempotent / forward-only (no destructive DROP TABLE / DROP COLUMN statements)", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/DROP TABLE\b/i);
    expect(MIGRATION_SOURCE).not.toMatch(/DROP COLUMN\b/i);
  });

  it("migration uses CREATE OR REPLACE for all functions (re-runnable safely)", () => {
    // No bare `CREATE FUNCTION` — must all be `CREATE OR REPLACE FUNCTION`
    const createOrReplaceCount = (MIGRATION_SOURCE.match(/CREATE OR REPLACE FUNCTION/g) ?? [])
      .length;
    const bareCreateFunctionCount = (
      MIGRATION_SOURCE.match(/(?<!OR REPLACE )CREATE FUNCTION/g) ?? []
    ).length;
    expect(createOrReplaceCount).toBeGreaterThanOrEqual(4);
    expect(bareCreateFunctionCount).toBe(0);
  });

  it("migration docs reference audit P1-18 + Story 12-3 (operator traceability)", () => {
    expect(MIGRATION_SOURCE).toMatch(/Story 12-3/);
    expect(MIGRATION_SOURCE).toMatch(/P1-18/);
  });
});
