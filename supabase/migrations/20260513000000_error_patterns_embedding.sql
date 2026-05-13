-- Story 11-6: Embedding-based dedupe in error_patterns.
--
-- Pre-11-6 `trackError` uses byte-exact string-equality on `error_description` to
-- decide whether to increment an existing row's `occurrences` counter or insert a
-- new row. The AI-emitted patterns "Confuses passé composé with imparfait",
-- "Mixes passé composé and imparfait", "Uses passé composé where imparfait is
-- needed" all describe the SAME mistake but produce three separate rows with
-- `occurrences = 1` each — so the `MICRO_DRILL_THRESHOLD = 3` engine that surfaces
-- targeted-drill candidates never fires for users with semantically-clustered
-- errors. Audit finding P1-21 (`shippable-roadmap.md` line 73).
--
-- This migration adds:
--   1. `embedding VECTOR(1536)` column (NULL on existing rows; no backfill).
--   2. HNSW index for sub-100ms cosine-similarity queries
--      (mirrors `idx_companion_memory_embedding` from `20260301000002`).
--   3. `match_error_pattern` RPC with a hybrid WHERE clause that handles BOTH new
--      rows (Arm 1: embedding NOT NULL, cosine > p_threshold) AND legacy
--      pre-11-6 rows (Arm 2: embedding NULL, exact string-equality fallback) —
--      so existing data continues working without a one-shot backfill script.
--
-- SECURITY DEFINER + SET search_path = public + auth.uid() filter — mirrors the
-- Story 9-9 hardening pattern from `match_memories` (`20260301000002`).
--
-- Forward-only. Idempotent re-run safe (ADD COLUMN IF NOT EXISTS, DROP FUNCTION
-- IF EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION).
--
-- Review-round-1 patches:
--   P10 — Defensive `CREATE EXTENSION IF NOT EXISTS vector` at the top so the
--         migration self-contains its idempotency contract even if executed
--         out of order against a stripped DB.
--   P8  — `ORDER BY similarity DESC, last_occurred DESC, id` tiebreaker
--         on the match_error_pattern RPC so multiple Arm-2 legacy rows tied
--         at similarity=1.0 resolve deterministically (last-occurred-most-
--         recent wins → ID is the final stable tiebreaker).
--   P15 — Note for future operators: on a populated table this index build
--         takes an ACCESS EXCLUSIVE lock that blocks writes. Initial deploy
--         is safe (column starts empty); a future re-create on real data
--         should use `CREATE INDEX CONCURRENTLY` instead.

-- ─── 0. Ensure pgvector extension is loaded (P10 defensive prepend) ──────────
-- Already enabled by `20260301000000_initial_schema.sql` for
-- `companion_memory.embedding`. This idempotent re-create is belt-and-braces
-- in case the migration is run against a stripped / out-of-order DB.

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 1. Add VECTOR(1536) column ──────────────────────────────────────────────

ALTER TABLE error_patterns
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- ─── 2. HNSW index ───────────────────────────────────────────────────────────
-- Mirrors `idx_companion_memory_embedding` from `20260301000002_production_fixes.sql`.
-- HNSW chosen over ivfflat because ivfflat with lists=100 requires ~4,000 rows
-- for accurate recall; HNSW has no minimum row count and performs better on
-- the small per-user partitions typical for `error_patterns`.
--
-- P15 note: a non-CONCURRENTLY index build takes an ACCESS EXCLUSIVE lock on
-- error_patterns and blocks writes for the duration. Initial deploy is safe
-- because the embedding column starts empty (instant). If a future operator
-- needs to re-create this index against a populated table, switch to
-- `CREATE INDEX CONCURRENTLY` (forfeiting the IF NOT EXISTS idempotency
-- inside a transaction — must run outside BEGIN/COMMIT in that case).

CREATE INDEX IF NOT EXISTS idx_error_patterns_embedding
  ON error_patterns USING hnsw (embedding vector_cosine_ops);

-- ─── 3. Drop any prior match_error_pattern signature (idempotent re-run) ─────

DROP FUNCTION IF EXISTS match_error_pattern(TEXT, TEXT, VECTOR, FLOAT);

-- ─── 4. Hybrid embedding + string-equality dedup RPC ─────────────────────────
-- Boundary semantics: `> p_threshold` (strict). At exact 0.85 → NO match. Forces
-- a slightly-higher-than-threshold to trigger merge; defends against false
-- positives at the spec boundary. Tests pin this.

CREATE OR REPLACE FUNCTION match_error_pattern(
  p_error_type        TEXT,
  p_error_description TEXT,
  p_query_embedding   VECTOR(1536),
  p_threshold         FLOAT DEFAULT 0.85
)
RETURNS TABLE (
  id          UUID,
  occurrences INTEGER,
  similarity  FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ep.id,
    ep.occurrences,
    CASE
      WHEN ep.embedding IS NOT NULL THEN 1 - (ep.embedding <=> p_query_embedding)
      WHEN ep.error_description = p_error_description THEN 1.0
      ELSE 0.0
    END AS similarity
  FROM error_patterns ep
  WHERE ep.user_id = auth.uid()
    AND ep.error_type = p_error_type
    AND ep.resolved = FALSE
    AND (
      -- Arm 1: new rows with embedding → cosine threshold (strict greater-than)
      (ep.embedding IS NOT NULL AND 1 - (ep.embedding <=> p_query_embedding) > p_threshold)
      OR
      -- Arm 2: legacy NULL-embedding rows → string-equality fallback
      (ep.embedding IS NULL AND ep.error_description = p_error_description)
    )
  -- P8 tiebreaker: multiple Arm-2 legacy rows all have similarity=1.0 and would
  -- tie under naive ORDER BY similarity DESC. Add last_occurred DESC (most-
  -- recently-active row wins — prefer "the one user actually still makes") and
  -- id ASC (stable final tiebreaker for fully-tied legacy duplicates). Also
  -- covers Arm-1 cosine ties at floating-point precision.
  ORDER BY similarity DESC, ep.last_occurred DESC, ep.id
  LIMIT 1;
END;
$$;
