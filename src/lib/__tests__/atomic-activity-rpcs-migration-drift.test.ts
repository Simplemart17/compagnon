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

  it("update_streak_atomic uses CASE for the today/yesterday/future/reset branches (single statement)", () => {
    // Must contain all four arms of the CASE expression
    expect(MIGRATION_SOURCE).toMatch(/WHEN last_active_date = p_today THEN/);
    expect(MIGRATION_SOURCE).toMatch(
      /WHEN last_active_date = p_yesterday THEN COALESCE\(streak_days, 0\) \+ 1/
    );
    // Review-round-1 P11: clock-skew defense — last_active_date in the future
    // preserves the streak instead of resetting to 1.
    expect(MIGRATION_SOURCE).toMatch(
      /WHEN last_active_date > p_today THEN COALESCE\(streak_days, 0\)/
    );
    // The "ELSE 1" branch resets the streak when there's a true gap
    expect(MIGRATION_SOURCE).toMatch(/ELSE 1\s+END/);
  });

  it("update_streak_atomic raises on missing profile row (Review-round-1 P2: no silent NULL)", () => {
    // Pre-patch UPDATE-not-found returned NULL silently; client only checked
    // `error` not `data`, masking the missing-row failure mode.
    expect(MIGRATION_SOURCE).toMatch(
      /IF NOT FOUND THEN\s+RAISE EXCEPTION 'profile not found for user_id %', p_user_id/
    );
  });

  it("promote_cefr_level_atomic validates p_next_level + raises on missing profile (Review-round-1 P7 + P2)", () => {
    // P7: defense-in-depth on `p_next_level`.
    expect(MIGRATION_SOURCE).toMatch(
      /IF p_next_level NOT IN \('A1'\s*,\s*'A2'\s*,\s*'B1'\s*,\s*'B2'\s*,\s*'C1'\s*,\s*'C2'\)\s+THEN/
    );
    // P2: distinguish missing-row (raise) from CAS-mismatch (FALSE).
    expect(MIGRATION_SOURCE).toMatch(
      /SELECT EXISTS \(SELECT 1 FROM profiles WHERE id = p_user_id\)/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /IF NOT v_user_exists THEN[\s\S]*?RAISE EXCEPTION 'profile not found for user_id %', p_user_id/
    );
  });

  // ---------------------------------------------------------------------------
  // update_skill_progress_atomic — INSERT ... ON CONFLICT DO UPDATE
  // ---------------------------------------------------------------------------

  it("update_skill_progress_atomic uses INSERT ... ON CONFLICT (user_id, skill) DO UPDATE (row-lock serialization)", () => {
    // Critical: this is the load-bearing concurrency primitive
    expect(MIGRATION_SOURCE).toMatch(/INSERT INTO skill_progress/i);
    expect(MIGRATION_SOURCE).toMatch(/ON CONFLICT \(user_id, skill\) DO UPDATE/i);
  });

  it("update_skill_progress_atomic computes running-average math server-side AND wraps it in round() (Review-round-1 P10)", () => {
    // The math: ((prev_score * prev_exercises) + incoming) / (prev_exercises + 1)
    expect(MIGRATION_SOURCE).toMatch(
      /skill_progress\.score \* skill_progress\.exercises_completed[\s\S]+EXCLUDED\.score[\s\S]+skill_progress\.exercises_completed \+ 1/
    );
    // Review-round-1 P10: pin `round(` wrapping the running-average. A future
    // refactor that drops `round(...)` would silently produce float scores in
    // the FLOAT column, breaking the integer-stored-historically contract
    // documented in the migration comment.
    expect(MIGRATION_SOURCE).toMatch(/score\s*=\s*round\(/);
  });

  it("update_skill_progress_atomic also rounds the fresh INSERT score (Review-round-1 P5: symmetric rounding)", () => {
    // Pre-patch the fresh INSERT wrote `p_incoming_score` raw while the
    // UPDATE branch rounded. Post-patch both branches round so pre-/post-12-3
    // rows have stable integer semantics.
    expect(MIGRATION_SOURCE).toMatch(/round\(p_incoming_score\)/);
  });

  it("update_skill_progress_atomic preserves the no-regress CEFR rule via array_position comparison (Review-round-1 P8: tolerates multi-line formatting)", () => {
    // The inline CASE checks: if EXCLUDED.cefr_level's index > current's index, use EXCLUDED; else keep current.
    // Review-round-1 P8: the regex tolerates a prettier auto-format that wraps
    // the ARRAY[...] across multiple lines or adds whitespace around the
    // brackets/commas — the SQL semantics are unchanged.
    expect(MIGRATION_SOURCE).toMatch(
      /array_position\(\s*ARRAY\s*\[\s*'A1'\s*,\s*'A2'\s*,\s*'B1'\s*,\s*'B2'\s*,\s*'C1'\s*,\s*'C2'\s*\]\s*,\s*EXCLUDED\.cefr_level/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /array_position\(\s*ARRAY\s*\[\s*'A1'\s*,\s*'A2'\s*,\s*'B1'\s*,\s*'B2'\s*,\s*'C1'\s*,\s*'C2'\s*\]\s*,\s*skill_progress\.cefr_level/
    );
  });

  it("update_skill_progress_atomic COALESCEs the no-regress array_position lookup (Review-round-1 P1: NULL/invalid stored level coerced)", () => {
    // Pre-patch a NULL or out-of-list stored cefr_level made array_position
    // return NULL → `NULL > x` is NULL → CASE fell to ELSE → bogus value
    // preserved. Post-patch both sides are wrapped in COALESCE(..., 0) so an
    // incoming valid level (e.g., "A1") beats a stored NULL/bogus value.
    expect(MIGRATION_SOURCE).toMatch(
      /COALESCE\(\s*array_position\([\s\S]*?EXCLUDED\.cefr_level\s*\),\s*0\s*\)/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /COALESCE\(\s*array_position\([\s\S]*?skill_progress\.cefr_level\s*\),\s*0\s*\)/
    );
  });

  it("update_skill_progress_atomic validates p_cefr_level at entry (Review-round-1 P4)", () => {
    // P4: defense-in-depth — reject invalid CEFR values before they land in
    // the column (which has no CHECK constraint in the initial schema).
    expect(MIGRATION_SOURCE).toMatch(
      /IF p_cefr_level NOT IN \('A1'\s*,\s*'A2'\s*,\s*'B1'\s*,\s*'B2'\s*,\s*'C1'\s*,\s*'C2'\)\s+THEN/
    );
  });

  it("update_skill_progress_atomic has NaN guard on p_incoming_score (Review-round-1 P17)", () => {
    // P17: `COALESCE(NaN, 0) = NaN` because NaN is not NULL. NaN ≠ NaN in
    // IEEE 754; this idiom catches both NaN and SQL NULL, normalizing to 0.
    expect(MIGRATION_SOURCE).toMatch(/NOT \(p_incoming_score = p_incoming_score\)/);
  });

  it("update_skill_progress_atomic clamps incoming score to [0, 100] server-side as belt-and-braces", () => {
    // GREATEST(0, LEAST(100, ...)) clamps both ends. Review-round-1 P17 moved
    // the NULL/NaN normalization to a separate `IF` block before the clamp
    // (see the NaN-guard drift case), so the clamp itself no longer wraps
    // COALESCE — it operates on the post-normalized variable.
    expect(MIGRATION_SOURCE).toMatch(/GREATEST\(0, LEAST\(100, p_incoming_score\)\)/);
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
