/**
 * Story 11-6 — drift detector for the `error_patterns` embedding migration.
 *
 * Reads the SQL migration file from disk and pins the load-bearing contract via
 * regex assertions. Catches a future refactor that:
 *   - silently changes the 0.85 cosine threshold,
 *   - removes SECURITY DEFINER / SET search_path = public (Story 9-9 hardening),
 *   - removes the HNSW index pattern,
 *   - changes VECTOR(1536) dimension.
 *
 * Pattern mirrors `upstream-timeout-error.test.ts` (Story 11-3) and
 * `cost-table.test.ts` (Story 11-4) — both real-source disk-reading drift
 * detectors that bypass module-level mocks.
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
  "20260513000000_error_patterns_embedding.sql"
);

const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

describe("error_patterns embedding migration — drift detector (Story 11-6)", () => {
  it("adds `embedding VECTOR(1536)` column to error_patterns (idempotent)", () => {
    expect(MIGRATION_SOURCE).toMatch(/ALTER TABLE error_patterns/i);
    expect(MIGRATION_SOURCE).toMatch(/ADD COLUMN IF NOT EXISTS embedding VECTOR\(1536\)/i);
  });

  it("creates HNSW index `idx_error_patterns_embedding` (mirrors companion_memory pattern)", () => {
    expect(MIGRATION_SOURCE).toMatch(/CREATE INDEX IF NOT EXISTS idx_error_patterns_embedding/i);
    expect(MIGRATION_SOURCE).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/i);
  });

  it("match_error_pattern function is SECURITY DEFINER + SET search_path = public (Story 9-9 hardening)", () => {
    // Function definition with all hardening markers
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION match_error_pattern\b/i);
    expect(MIGRATION_SOURCE).toMatch(/SECURITY DEFINER/);
    expect(MIGRATION_SOURCE).toMatch(/SET search_path = public/);
  });

  it("match_error_pattern has p_threshold DEFAULT 0.85 (spec value, not 0.7 nor 0.9)", () => {
    expect(MIGRATION_SOURCE).toMatch(/p_threshold\s+FLOAT\s+DEFAULT\s+0\.85/i);
    // Negative: explicit guard against accidental drift to 0.7 (match_memories) or 0.9
    expect(MIGRATION_SOURCE).not.toMatch(/p_threshold\s+FLOAT\s+DEFAULT\s+0\.7\b/i);
    expect(MIGRATION_SOURCE).not.toMatch(/p_threshold\s+FLOAT\s+DEFAULT\s+0\.9\b/i);
  });

  it("WHERE clause uses STRICT greater-than `> p_threshold` (not `>=`)", () => {
    // Boundary defense: at exact 0.85, no match. Strict comparison only.
    expect(MIGRATION_SOURCE).toMatch(/<=> p_query_embedding\) > p_threshold/);
    // Negative: explicit guard against accidental relaxation to >=
    expect(MIGRATION_SOURCE).not.toMatch(/<=> p_query_embedding\) >= p_threshold/);
  });

  it("RLS via auth.uid() in WHERE clause (not a caller-supplied param)", () => {
    // The Story 9-9 pattern: auth.uid() is the authoritative scope.
    // Pre-9-9 pattern (match_memories with match_user_id UUID param) MUST NOT be re-introduced.
    expect(MIGRATION_SOURCE).toMatch(/WHERE ep\.user_id = auth\.uid\(\)/);
    expect(MIGRATION_SOURCE).not.toMatch(/p_user_id\s+UUID/i);
    expect(MIGRATION_SOURCE).not.toMatch(/match_user_id/i);
  });

  it("hybrid WHERE clause has BOTH Arm 1 (embedding cosine) AND Arm 2 (string-equality fallback)", () => {
    // Arm 1: new rows with embedding → cosine threshold
    expect(MIGRATION_SOURCE).toMatch(
      /ep\.embedding IS NOT NULL AND 1 - \(ep\.embedding <=> p_query_embedding\) > p_threshold/
    );
    // Arm 2: legacy NULL-embedding rows → string-equality
    expect(MIGRATION_SOURCE).toMatch(
      /ep\.embedding IS NULL AND ep\.error_description = p_error_description/
    );
  });

  it("idempotent re-run guards: DROP FUNCTION IF EXISTS + CREATE OR REPLACE", () => {
    // DROP FUNCTION must match the exact signature including types
    expect(MIGRATION_SOURCE).toMatch(
      /DROP FUNCTION IF EXISTS match_error_pattern\(TEXT,\s*TEXT,\s*VECTOR,\s*FLOAT\)/i
    );
    expect(MIGRATION_SOURCE).toMatch(/CREATE OR REPLACE FUNCTION match_error_pattern/i);
  });

  it("excludes resolved rows from dedup (resolved = FALSE)", () => {
    expect(MIGRATION_SOURCE).toMatch(/ep\.resolved = FALSE/i);
  });

  it("RETURNS TABLE shape: id UUID + occurrences INTEGER + similarity FLOAT", () => {
    // Three columns, in this order, are what the client consumes via supabase.rpc.
    expect(MIGRATION_SOURCE).toMatch(/RETURNS TABLE/);
    expect(MIGRATION_SOURCE).toMatch(/id\s+UUID/i);
    expect(MIGRATION_SOURCE).toMatch(/occurrences\s+INTEGER/i);
    expect(MIGRATION_SOURCE).toMatch(/similarity\s+FLOAT/i);
  });

  it("P10 review-patch: defensive `CREATE EXTENSION IF NOT EXISTS vector;` at top", () => {
    // The vector extension is enabled by 20260301000000_initial_schema.sql, but
    // re-declaring here makes this migration self-contained on a stripped DB.
    expect(MIGRATION_SOURCE).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    // Must appear BEFORE the ALTER TABLE so the VECTOR(1536) column type works
    // even if migrations run out of order.
    const extIdx = MIGRATION_SOURCE.search(/CREATE EXTENSION IF NOT EXISTS vector/i);
    const alterIdx = MIGRATION_SOURCE.search(/ALTER TABLE error_patterns/i);
    expect(extIdx).toBeGreaterThan(-1);
    expect(alterIdx).toBeGreaterThan(-1);
    expect(extIdx).toBeLessThan(alterIdx);
  });

  it("P8 review-patch: ORDER BY tiebreaker (similarity DESC, last_occurred DESC, id)", () => {
    // Multiple Arm-2 legacy rows all have similarity=1.0; naive `ORDER BY
    // similarity DESC` ties non-deterministically across calls. Add
    // last_occurred DESC (prefer recently-active) + id (stable final).
    expect(MIGRATION_SOURCE).toMatch(
      /ORDER BY similarity DESC,\s*ep\.last_occurred DESC,\s*ep\.id/i
    );
    // Negative guard: the unqualified pre-patch form must NOT appear standalone.
    expect(MIGRATION_SOURCE).not.toMatch(/ORDER BY similarity DESC\s*\n\s*LIMIT 1/);
  });

  it("P15 review-patch: comment notes that future re-create on populated table needs CONCURRENTLY", () => {
    // Initial deploy is safe (empty column). Future operators re-creating the
    // index against real data must use `CONCURRENTLY` to avoid blocking writes.
    expect(MIGRATION_SOURCE).toMatch(/CONCURRENTLY/);
  });
});
