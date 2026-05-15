/**
 * Story 13-3 — `get_session_feedback_aggregate` RPC migration drift detector
 * (audit P2-4 closure).
 *
 * Pins the post-13-3 SQL contract against silent regression by reading
 * the migration file from disk + applying targeted regex assertions on:
 *   - Story 9-9 hardening (SECURITY DEFINER + search_path + auth.uid + REVOKE/GRANT).
 *   - All 6 top-level JSONB keys (5 + error_counts sub-object).
 *   - Server-side 21-day + 5-minute cutoffs (not client-side filter).
 *   - Story 13-2 P2 single-query `COUNT(*) FILTER` atomic snapshot.
 *   - Server-side MAX scalars (the unbounded-query elimination).
 *   - p_now timestamptz DEFAULT now() (Story 13-2 P3 timezone consistency).
 *   - Idempotent CREATE OR REPLACE FUNCTION.
 *
 * Mirrors Story 11-6 / 12-3 / 13-2 migration-drift detector pattern.
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
  "20260516000000_get_session_feedback_aggregate_rpc.sql"
);
const SQL = readFileSync(MIGRATION_PATH, "utf-8");

describe("get_session_feedback_aggregate RPC — Story 13-3 migration drift detector (audit P2-4)", () => {
  it("Case 1: function signature `get_session_feedback_aggregate(p_user_id uuid, p_conversation_id uuid, p_pre_cefr_level text, p_now timestamptz DEFAULT now())` RETURNS jsonb", () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION get_session_feedback_aggregate\(\s*p_user_id\s+uuid\s*,\s*p_conversation_id\s+uuid\s*,\s*p_pre_cefr_level\s+text\s*,\s*p_now\s+timestamptz\s+DEFAULT\s+now\(\)\s*\)\s+RETURNS\s+jsonb/i
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
    expect(SQL).toMatch(
      /REVOKE EXECUTE ON FUNCTION get_session_feedback_aggregate\(uuid, uuid, text, timestamptz\) FROM PUBLIC/
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION get_session_feedback_aggregate\(uuid, uuid, text, timestamptz\) TO authenticated/
    );
  });

  it("Case 5: all 6 top-level JSONB keys present in the final RETURN jsonb_build_object", () => {
    const returnMatch = SQL.match(/RETURN\s+jsonb_build_object\(\s*([\s\S]*?)\n\s*\);/);
    expect(returnMatch).not.toBeNull();
    const body = returnMatch![1];
    expect(body).toMatch(/'prev_session'\s*,/);
    expect(body).toMatch(/'cefr_promotion'\s*,/);
    expect(body).toMatch(/'max_fluency_rating'\s*,/);
    expect(body).toMatch(/'max_grammar_rating'\s*,/);
    expect(body).toMatch(/'recent_resolved_error'\s*,/);
    expect(body).toMatch(/'error_counts'\s*,?/);
  });

  it("Case 6: idempotent migration — CREATE OR REPLACE FUNCTION (not bare CREATE)", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION get_session_feedback_aggregate/);
    expect(SQL).not.toMatch(/(?<!OR REPLACE )CREATE FUNCTION get_session_feedback_aggregate/);
  });

  it("Case 7: server-side 21-day cutoff for prev_session", () => {
    // Story 13-3 spec: client-side filter-after-fetch DELETED; server enforces.
    expect(SQL).toMatch(/completed_at\s*>=\s*p_now\s*-\s*INTERVAL\s+'21 days'/);
  });

  it("Case 8: server-side 5-minute cutoff for recent_resolved_error", () => {
    expect(SQL).toMatch(/last_occurred\s*>=\s*p_now\s*-\s*INTERVAL\s+'5 minutes'/);
  });

  it("Case 9: error_counts uses single-query COUNT(*) FILTER (P2 atomic-snapshot pattern)", () => {
    expect(SQL).toMatch(/COUNT\(\*\)\s+FILTER\s*\(\s*WHERE\s+resolved\s*=\s*true\s*\)/);
    // NEGATIVE: no separate SELECT COUNT(*) ... INTO v_resolved_errors query.
    expect(SQL).not.toMatch(
      /SELECT\s+COUNT\(\*\)::integer\s+INTO\s+v_resolved_errors\s+FROM\s+error_patterns/
    );
  });

  it("Case 10: server-side MAX scalars eliminate the unbounded conversations.select", () => {
    // The audit P2-4 critical win — MAX of ai_feedback->>'fluencyRating' /
    // 'grammarRating' computed server-side; the client receives 2 numbers
    // instead of N JSONB rows.
    expect(SQL).toMatch(/MAX\(\(ai_feedback->>'fluencyRating'\)::numeric\)/);
    expect(SQL).toMatch(/MAX\(\(ai_feedback->>'grammarRating'\)::numeric\)/);
    expect(SQL).toMatch(/COALESCE\(MAX\(\(ai_feedback->>'fluencyRating'\)::numeric\),\s*0\)/);
    expect(SQL).toMatch(/COALESCE\(MAX\(\(ai_feedback->>'grammarRating'\)::numeric\),\s*0\)/);
  });

  it("Case 11: p_now parameter wired to both cutoff predicates (Story 13-2 P3 pattern)", () => {
    // Both INTERVAL expressions reference `p_now`, not raw `now()`.
    expect(SQL).toMatch(/p_now\s*-\s*INTERVAL\s+'21 days'/);
    expect(SQL).toMatch(/p_now\s*-\s*INTERVAL\s+'5 minutes'/);
  });

  it("Case 12: cefr_promotion compares p_pre_cefr_level vs current profile level", () => {
    // The from/to fields wire p_pre_cefr_level → v_current_cefr_level.
    expect(SQL).toMatch(/v_current_cefr_level\s*<>\s*p_pre_cefr_level/);
    expect(SQL).toMatch(/'from',\s*p_pre_cefr_level/);
    expect(SQL).toMatch(/'to',\s*v_current_cefr_level/);
  });
});
