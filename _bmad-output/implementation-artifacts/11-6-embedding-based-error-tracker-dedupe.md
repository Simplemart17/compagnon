# Story 11.6: Embedding-Based Dedupe in Error-Tracker — Replace String-Equality with Cosine Similarity ≥ 0.85

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose error-pattern telemetry is currently storing **dozens of near-duplicate `error_patterns` rows per user** because the dedup check at [`src/lib/error-tracker.ts:59-66`](src/lib/error-tracker.ts) (the `trackError` function) is **exact string-equality** on the `error_description` column — `.eq("error_description", safeDescription)` — which means the model-emitted patterns "Confuses passé composé with imparfait", "Mixes passé composé and imparfait for past actions", "Uses passé composé where imparfait is needed", and "Confuses passé composé with imparfait for habitual past actions" all create FOUR separate `error_patterns` rows even though they describe the **same recurring grammatical confusion**, so (a) the per-user error-pattern table grows ~3-5× faster than the user's actual mistake rate, (b) the home-screen "Fix This Mistake" card surface at [`app/(tabs)/index.tsx`](app/(tabs)/index.tsx) (via `getTopErrors` at [`src/lib/error-tracker.ts:118-128`](src/lib/error-tracker.ts) `ORDER BY occurrences DESC LIMIT 5`) shows 4 separate rows with `occurrences = 1` instead of a single consolidated row with `occurrences = 4`, masking the user's actual top recurring mistakes from the dashboard, (c) the micro-drill threshold at [`src/lib/constants.ts`](src/lib/constants.ts) `MICRO_DRILL_THRESHOLD = 3` (consumed by `getErrorsForDrills` at [`src/lib/error-tracker.ts:133-144`](src/lib/error-tracker.ts) which surfaces error patterns with `occurrences >= 3` to the targeted-micro-drill generator) **never fires for users with semantically-clustered errors** because no single row's `occurrences` counter ever reaches 3 — the user keeps making the same passé composé / imparfait mistake but each variant of the AI's description creates a fresh row with `occurrences = 1`, so the micro-drill engine that's supposed to give the user a targeted 3-question fix never gets a candidate pattern, defeating the entire purpose of Story 1.6's targeted-drill pedagogy, (d) Story 11-5's consolidated `extractPostConversationAnalysis` produces a fresh batch of enriched error patterns per conversation that all flow into the same `trackError` string-equality bottleneck (`persistErrorPatterns` calls `trackError` per item at line 263), so the cost-discipline gains from Story 11-5 are partially offset by paying for an embedding API call per fact + post-conversation analysis call without using the embedding-similarity signal where it'd actually pay off — the error-pattern dedup; per audit finding **P1-21** ([`_bmad-output/planning-artifacts/shippable-roadmap.md` line 73](_bmad-output/planning-artifacts/shippable-roadmap.md)) "Error-tracker dedupe is string-equality with no normalization; will spam dozens of near-duplicate 'patterns'" and Epic 11.6 deliverable ([`shippable-roadmap.md` line 186](_bmad-output/planning-artifacts/shippable-roadmap.md)) "Embedding-based dedupe in error-tracker — embed normalized pattern, cosine threshold ≥ 0.85 for merge; replaces string-equality. **Covers P1-21.**",

I want (a) a **new `embedding VECTOR(1536)` column** added to the `error_patterns` table via a forward-only migration (`supabase/migrations/20260513000000_error_patterns_embedding.sql`) mirroring the `companion_memory.embedding` pattern from migration `20260301000000_initial_schema.sql:206` + an **HNSW index** on the new column mirroring `idx_companion_memory_embedding` from migration `20260301000002_production_fixes.sql:102-103` for sub-100ms cosine-similarity queries, (b) a **new `match_error_pattern` Postgres RPC function** (`SECURITY DEFINER` + `SET search_path = public` per Story 9-9 hardening; `auth.uid()` enforcement matching the `match_memories` pattern at migration `20260301000002_production_fixes.sql:66-94`) that takes `(p_error_type TEXT, p_error_description TEXT, p_query_embedding VECTOR(1536), p_threshold FLOAT DEFAULT 0.85)` and returns the **best matching unresolved row** for the calling user via a hybrid `WHERE` clause that handles both new rows (embedding NOT NULL → cosine threshold) AND legacy pre-11-6 rows (embedding NULL → string-equality fallback so existing rows continue to merge with new writes without a backfill), (c) `trackError(userId, errorType, description)` at [`src/lib/error-tracker.ts:48-99`](src/lib/error-tracker.ts) refactored to **generate an embedding for the sanitized description via `generateEmbedding(safeDescription)` from `src/lib/openai.ts:372`** then **call the new RPC instead of the current `.eq("error_description", safeDescription)` query**; on RPC match → UPDATE `occurrences + 1` + `last_occurred = NOW()`; on no match → INSERT new row including the embedding column, (d) a **dedicated fail-OPEN path** when `generateEmbedding` fails (network, timeout, daily-cost-cap exhausted, schema parse fail) so the tracker continues to work via **string-equality fallback** (the pre-11-6 behavior) — embedding failure must not block error tracking for the user; the failure routes through `captureError(err, "track-error-embedding")` so operators can see the signal in Sentry, (e) a **read-time deserialization helper** on the RPC result row matching the `match_memories` consumer pattern at `src/lib/memory.ts:300-313` (JSON-stringified embedding passed in, vector returned in result), (f) Story 11-4's daily-cost-cap pre-flight check at `ai-proxy` Edge Function automatically tracks the new embedding-per-trackError-call cost via the existing `"embedding"` action path (no new cost-tracking code needed; `MODEL_RATES["text-embedding-3-small"]` already pinned by Story 11-4 at $0.02/1M input tokens — per-call cost ≈ $0.000006 for a 300-char sanitized description, negligible at typical conversation volume); the post-call cost record at `actualChatCostCents` already runs via the embedding switch arm, (g) **no backfill** of the existing `embedding IS NULL` rows is performed — they continue to participate in dedup via the string-equality fallback arm of the RPC, converging to embedded-only over time as users make recurring mistakes (each match on a NULL-embedding row triggers an UPDATE that *could* opportunistically populate the embedding column but **Story 11-6 explicitly defers this** to a future hardening story to keep the surface area bounded — the cost of running `generateEmbedding` for every legacy match is unbounded user-by-user; the conservative approach is to let new rows have embeddings and let old rows age out as `resolved=TRUE` over time), (h) a regression test suite covering the four canonical near-duplicate cases from §2 above (`passé composé / imparfait` confusion variants) plus the string-equality fallback path for legacy rows plus the embedding-API-failure fail-OPEN path plus the threshold-boundary behavior (`similarity === 0.85` exact-boundary is **NOT** a match per `> p_threshold` strict comparison — only `> 0.85` triggers a merge; BS1 patch) plus an end-to-end test that asserts 4 calls to `trackError` with 4 near-duplicate descriptions produces a single row with `occurrences = 4` (the core proof of P1-21 closure),

so that **audit finding P1-21 closes architecturally**; the `error_patterns` table per-user row growth rate drops from ~3-5× actual mistake rate to ~1× actual mistake rate (each unique semantic mistake → one row that accumulates `occurrences`); the home-screen "Fix This Mistake" card surfaces the user's actual top-frequency recurring mistakes (not aliased duplicates of a single mistake); the `MICRO_DRILL_THRESHOLD = 3` micro-drill engine **starts firing for the first time on users with semantically-clustered errors** (which is the realistic case — users do make the same grammar mistake repeatedly across conversations), restoring the targeted-drill pedagogy contract from Story 1.6; Story 11-5's consolidated `extractPostConversationAnalysis` → `persistErrorPatterns` → `trackError` flow now benefits from the embedding-similarity signal at the persistence boundary (where it pays off as a quality win, not just a cost win); the verified-correct surfaces NOT touched are Story 9-3 Sentry telemetry allowlist (the new `feature: "track-error-embedding"` / `feature: "track-error-rpc"` / `feature: "track-error-fallback"` tags are short categorical strings under the 80-char redaction threshold; `feature` is already allowlisted per `src/lib/sentry.ts:25-40`; no allowlist extension needed), Story 9-4 stored-prompt-injection defense (`sanitizeMemoryContent` is still called on the description BEFORE embedding generation — preserves the "embedding vector reflects sanitized content, not pre-sanitized content" invariant from `src/lib/memory.ts:201-204`), Story 9-5 voice transcript dedup + Story 9-6 auth listener + Story 9-7 Zod schema retry contract (orthogonal), Story 9-8 / 10-6 speaking pipeline (`speakingTaskEvaluationSchema` flow is upstream — error patterns from speaking flow into `trackError` and benefit from the new dedup automatically), Story 9-9 deploy substrate (no workflow / EAS changes; the new migration ships via the existing `supabase db push` discipline + the `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md` rollback playbook), Story 9-10 auth + cache race (orthogonal), Story 10-2 / 10-3 / 10-4 / 10-5 / 10-7 / 10-8 (orthogonal — prompts + scoring + dedup-of-exercises is a different table), Story 11-1 `report_correction` tool-call protocol (the `note_error_pattern` Realtime tool-call dispatch at `use-realtime-voice.ts:318-323` `trackError(user.id, parsed.error_type, parsed.description)` is the canonical caller of `trackError` and now benefits from the new dedup automatically; the tool-call schema is unchanged), Story 11-2 reconnect + barge-in (orthogonal — the tracker runs post-turn, not during reconnect), Story 11-3 Edge Function upstream timeouts (`fetchWithTimeout` already wraps the embedding API call in `ai-proxy`; the new path inherits the 30s timeout), Story 11-4 Postgres-backed rate-limit + cost cap (`generateEmbedding` already counts against the daily cost cap + per-minute rate limit at `ai-proxy` — Story 11-6 adds a small additive cost (~$0.000006 per `trackError` call); the daily-cost-cap pre-flight at `realtime-session/index.ts` already includes embedding cost via the `"embedding"` action route), and Story 11-5 cost discipline pass (the consolidated `extractPostConversationAnalysis` → `persistErrorPatterns` → `trackError` flow remains unchanged at the call-site level; the new embedding-per-trackError cost is offset by the dedup quality win — fewer rows means fewer micro-drill candidates means slightly fewer downstream `chatCompletion` calls in `generateMicroDrill`).

## Background — Why This Story Exists

### What audit finding P1-21 owns to this story

[`shippable-roadmap.md` line 73](_bmad-output/planning-artifacts/shippable-roadmap.md): "P1-21 — Error-tracker dedupe is string-equality with no normalization; will spam dozens of near-duplicate 'patterns'."

[`shippable-roadmap.md` line 186](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.6 deliverable: "Embedding-based dedupe in error-tracker — embed normalized pattern, cosine threshold ≥ 0.85 for merge; replaces string-equality. **Covers P1-21.**"

### Current state — string-equality dedup at `trackError`

[`src/lib/error-tracker.ts:59-99`](src/lib/error-tracker.ts) (the `trackError` function body):

```typescript
// Check if this error pattern already exists
const { data: existing } = await supabase
  .from("error_patterns")
  .select("id, occurrences")
  .eq("user_id", userId)
  .eq("error_type", errorType)
  .eq("error_description", safeDescription)  // ← string-equality bottleneck
  .eq("resolved", false)
  .maybeSingle();

if (existing) {
  // Increment occurrences
  await supabase.from("error_patterns").update({
    occurrences: existing.occurrences + 1,
    last_occurred: new Date().toISOString(),
  }).eq("id", existing.id);
} else {
  // Create new error pattern
  await supabase.from("error_patterns").insert({
    user_id: userId,
    error_type: errorType,
    error_description: safeDescription,
  });
}
```

The `.eq("error_description", safeDescription)` is byte-exact. The four AI-emitted variants below all bypass it:

| AI-emitted description (sanitized)                                  | byte-equal? |
| ------------------------------------------------------------------- | ----------- |
| `Confuses passé composé with imparfait`                             | (baseline)  |
| `Mixes passé composé and imparfait for past actions`                | ✗ different |
| `Uses passé composé where imparfait is needed`                      | ✗ different |
| `Confuses passé composé with imparfait for habitual past actions`   | ✗ different |

Four separate rows, each with `occurrences = 1`. The micro-drill threshold (3) never fires.

### Current state — `error_patterns` table schema

[`supabase/migrations/20260301000000_initial_schema.sql:226-235`](supabase/migrations/20260301000000_initial_schema.sql):

```sql
CREATE TABLE error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  error_type TEXT NOT NULL CHECK (error_type IN ('grammar','pronunciation','vocabulary','register')),
  error_description TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  last_occurred TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE error_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own error patterns" ON error_patterns
  FOR ALL USING (auth.uid() = user_id);
```

No `embedding` column. RLS already scopes by `auth.uid()` — the new RPC inherits this via `SECURITY DEFINER` + explicit `WHERE user_id = auth.uid()` filter (the `match_memories` pattern).

### Current state — `companion_memory` is the reference implementation

[`supabase/migrations/20260301000000_initial_schema.sql:206-221`](supabase/migrations/20260301000000_initial_schema.sql):

```sql
CREATE TABLE companion_memory (
  ...
  embedding VECTOR(1536),
  ...
);
```

[`supabase/migrations/20260301000002_production_fixes.sql:66-94`](supabase/migrations/20260301000002_production_fixes.sql) — the canonical `match_*` RPC pattern:

```sql
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_count     INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, content TEXT, memory_type TEXT, similarity FLOAT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT cm.id, cm.content, cm.memory_type,
         1 - (cm.embedding <=> query_embedding) AS similarity
  FROM companion_memory cm
  WHERE cm.user_id = auth.uid()
    AND 1 - (cm.embedding <=> query_embedding) > match_threshold
  ORDER BY cm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

[`supabase/migrations/20260301000002_production_fixes.sql:102-103`](supabase/migrations/20260301000002_production_fixes.sql) — HNSW index pattern:

```sql
CREATE INDEX IF NOT EXISTS idx_companion_memory_embedding
  ON companion_memory USING hnsw (embedding vector_cosine_ops);
```

Story 11-6 mirrors all three patterns for `error_patterns`.

### Threshold = 0.85 (per roadmap)

Operator-decided in `shippable-roadmap.md` line 186. Higher than `match_memories`'s 0.7 (which surfaces semantically-related memories for prompt injection) because **error-pattern dedup is a stricter operation** — merging two patterns that are NOT actually the same mistake hides them from the user. 0.85 is the conservative end of the "definitely-the-same-mistake" semantic-similarity band per OpenAI's text-embedding-3-small calibration.

Boundary semantics: `> p_threshold` (strict). At exact 0.85 → NO match (forces a slightly-higher-than-threshold to trigger merge; defends against false-positive merges at the boundary). Tests pin this.

### Combined dedup query — handles both NEW and LEGACY rows

The new RPC's `WHERE` clause uses an `OR` over two arms:

```sql
WHERE ep.user_id = auth.uid()
  AND ep.error_type = p_error_type
  AND ep.resolved = FALSE
  AND (
    -- Arm 1: new rows with embedding → cosine threshold
    (ep.embedding IS NOT NULL AND 1 - (ep.embedding <=> p_query_embedding) > p_threshold)
    OR
    -- Arm 2: legacy NULL-embedding rows → string-equality fallback
    (ep.embedding IS NULL AND ep.error_description = p_error_description)
  )
ORDER BY similarity DESC
LIMIT 1;
```

The `similarity` column in the SELECT uses a `CASE`:

```sql
SELECT ep.id, ep.occurrences,
  CASE
    WHEN ep.embedding IS NOT NULL THEN 1 - (ep.embedding <=> p_query_embedding)
    WHEN ep.error_description = p_error_description THEN 1.0
    ELSE 0.0
  END AS similarity
```

This means:

- New row write with embedding + existing matching legacy row (NULL embedding, exact string) → MATCHES via Arm 2 → existing row's `occurrences` increments. Legacy row stays NULL-embedding.
- New row write with embedding + existing matching new row (NOT NULL embedding, cosine > 0.85) → MATCHES via Arm 1 → existing row's `occurrences` increments.
- New row write with embedding + no match → INSERT new row WITH embedding.
- Two NULL-embedding rows: dedup only on exact string-equality (pre-11-6 behavior preserved for legacy data).

### Cost — embedding-per-trackError-call

`generateEmbedding(text)` at `src/lib/openai.ts:372` invokes `ai-proxy` with `action: "embedding"`. Per-call cost ≈ $0.000006 (300-char text × text-embedding-3-small at $0.02/1M tokens). Story 11-4's `daily_cost_ledger` already tracks this via the embedding switch arm at `ai-proxy/index.ts`.

Typical conversation: ~5 corrections × 1 embedding = ~$0.00003/conversation. At 100 conversations/day → ~$0.003. Bounded; tracked by the daily cap.

### Fail-OPEN — embedding failure falls back to string-equality

If `generateEmbedding` rejects (network, timeout, daily-cost-cap exhausted, embedding API 5xx), `trackError` MUST continue working via the pre-11-6 string-equality path. Pattern matches Story 11-4's fail-OPEN on Postgres errors (`checkRateLimit` returns `allowed: true` on RPC error).

Failure routes:

- `captureError(err, "track-error-embedding")` — operator sees the rate of embedding API failures
- Fallback execution: same `.eq(...).maybeSingle()` query as pre-11-6 (string-equality dedup against ANY row including new embedding rows — they have the same `error_description` field populated)
- New rows from the fallback path INSERT without an embedding (the embedding column stays NULL) — these rows behave as legacy rows for future dedup

### Threat / failure model — what cannot happen post-story

After this story:

1. **The four `passé composé / imparfait` variants below produce a single row with `occurrences = 4`** — pinned by the E2E regression test. Pre-11-6 would produce 4 rows.

2. **The `MICRO_DRILL_THRESHOLD = 3` engine starts firing on real users** — because clustered errors now accumulate into a single row's `occurrences` counter. Operators can verify post-deploy by querying `SELECT user_id, error_description, occurrences FROM error_patterns WHERE occurrences >= 3` after a week of usage.

3. **The combined dedup RPC handles BOTH legacy rows AND new rows in a single query** — no backfill needed; no two-phase migration; existing data continues working.

4. **Embedding-API failures don't break error tracking** — fail-OPEN to string-equality. Sentry breadcrumb fires for the operator signal. The user's flow is uninterrupted.

5. **Story 11-4's daily-cost-cap pre-flight check** already tracks `generateEmbedding` calls. No new cost-tracking code needed. Operators can verify the per-conversation embedding cost addition (~$0.00003) by querying `daily_cost_ledger` for `total_cost_cents` delta pre-vs-post Story 11-6 rollout.

6. **No new Sentry allowlist keys** — `feature: "track-error-embedding"` / `"track-error-rpc"` / `"track-error-fallback"` are short categorical strings; `feature` is already allowlisted.

7. **The `match_error_pattern` RPC is `SECURITY DEFINER` + `SET search_path = public`** matching Story 9-9 hardening. `auth.uid()` is the authoritative user-scope (matches `match_memories` post-Story 9-9 pattern, NOT the pre-9-9 `match_user_id UUID` param pattern).

8. **The new HNSW index on `error_patterns.embedding`** is created `IF NOT EXISTS` so re-running the migration is idempotent. HNSW is the canonical choice for small datasets (matches `idx_companion_memory_embedding`).

9. **`sanitizeMemoryContent` runs BEFORE `generateEmbedding`** — preserves the Story 9-4 invariant that the embedding vector represents the sanitized stored text, not the pre-sanitized text. This is also a cost defense (sanitization-driven empty drops short-circuit before paying for an embedding API call).

10. **The new RPC is called from `trackError` only** — `persistErrorPatterns`, `extractErrorsFromCorrections`, and the Realtime `note_error_pattern` tool-call dispatch (`use-realtime-voice.ts:318-323`) all route through `trackError` at the boundary, so the dedup logic has a single entry point. No call-site changes outside `error-tracker.ts` + the migration.

### Out of scope for this story (delegated elsewhere)

- **Backfill of legacy NULL-embedding rows** — operator-decision is to NOT run a one-shot backfill script that would burn ~$0.00006 × N rows (bounded but unbounded per user) for marginal benefit. Legacy rows continue to participate via the string-equality fallback arm of the RPC. Filed under Epic 17.X (schema versioning + data backfill) if it ever matters; the natural convergence path is users resolving old patterns over time.
- **Threshold tuning** — 0.85 is the spec value per roadmap; operator-side A/B comparison of merge-rate-vs-false-positive-rate is a future hardening story. Story 11-6 ships with the spec threshold.
- **Sub-pattern clustering / hierarchical dedup** — e.g., "all passé composé errors" → parent category + per-variant children. Out of scope; the flat dedup is sufficient for the micro-drill threshold + home-screen card.
- **Embedding-based dedup on `companion_memory`** — already exists via `match_memories` RPC. This story doesn't touch that surface.
- **Cross-user pattern sharing / public error pattern bank** — privacy-sensitive; out of scope.
- **Replacing `text-embedding-3-small` with a French-specific embedding model** — domain quality probably high enough at 1536-dim small; A/B comparison is future scope.
- **Embedding-based dedup on `vocabulary` table** — separate dedup model (SRS-based scheduling), out of scope.
- **Optimistic embedding backfill on match (Arm-2 path)** — when a new write matches a legacy NULL-embedding row, we could UPDATE the row to populate its embedding with the new write's embedding. Out of scope for v1; explicit defer noted in `Threat / failure model #3` above.
- **Story 11.7 prompt truncation** — separate story; downstream consumer of the dedup'd error patterns.
- **Story 11.8 empty-response detection retry parity** — orthogonal.
- **Increasing `MICRO_DRILL_THRESHOLD` from 3 → higher** — operator can tune via `src/lib/constants.ts` after deploy if dedup quality is high enough to surface drills more aggressively.

## Acceptance Criteria

### 1. New migration adds `embedding` column + HNSW index to `error_patterns`

- [x] **CREATE** `supabase/migrations/20260513000000_error_patterns_embedding.sql` with the following statements (in order, each idempotent):

  ```sql
  -- Story 11-6: Embedding-based dedupe in error_patterns
  -- Forward-only migration; legacy NULL-embedding rows continue to dedupe via the string-equality
  -- fallback arm of the new match_error_pattern RPC (no backfill).

  -- 1. Add VECTOR(1536) column to error_patterns
  ALTER TABLE error_patterns
    ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

  -- 2. HNSW index (mirrors idx_companion_memory_embedding)
  CREATE INDEX IF NOT EXISTS idx_error_patterns_embedding
    ON error_patterns USING hnsw (embedding vector_cosine_ops);

  -- 3. Drop any pre-existing match_error_pattern (idempotent re-run)
  DROP FUNCTION IF EXISTS match_error_pattern(TEXT, TEXT, VECTOR, FLOAT);

  -- 4. Combined RPC: hybrid embedding + string-equality dedup
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
        (ep.embedding IS NOT NULL AND 1 - (ep.embedding <=> p_query_embedding) > p_threshold)
        OR
        (ep.embedding IS NULL AND ep.error_description = p_error_description)
      )
    ORDER BY similarity DESC
    LIMIT 1;
  END;
  $$;
  ```

- [x] **VERIFY** the migration runs cleanly on a fresh local Supabase instance via `supabase db push` (matches Story 11-4 + 11-3 deployment discipline).

- [x] **VERIFY** the migration is idempotent — `supabase db reset` followed by a 2nd `supabase db push` does not fail on the index already existing or the function already existing (both use `IF NOT EXISTS` / `DROP IF EXISTS` + `CREATE OR REPLACE`).

**Given** a fresh Supabase instance with the pre-11-6 schema
**When** the new migration runs via `supabase db push`
**Then** the `error_patterns` table has an `embedding VECTOR(1536)` column (NULL on existing rows) AND `idx_error_patterns_embedding` HNSW index exists AND the `match_error_pattern` function is callable.

### 2. Refactor `trackError` to call the new RPC with embedding-first dedup

- [x] **UPDATE** [`src/lib/error-tracker.ts:48-99`](src/lib/error-tracker.ts) `trackError` function:

  ```typescript
  import { generateEmbedding } from "./openai";

  export async function trackError(
    userId: string,
    errorType: ErrorType,
    description: string
  ): Promise<void> {
    if (!ERROR_TYPES.has(errorType)) return;
    const safeDescription = typeof description === "string" ? sanitizeMemoryContent(description) : "";
    if (safeDescription.length === 0) return;

    // 1. Generate embedding. Fail-OPEN: fall back to string-equality dedup.
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await generateEmbedding(safeDescription);
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), "track-error-embedding", {
        errorType,
      });
      // Fallthrough to string-equality dedup.
    }

    // 2. If we have an embedding, call the new hybrid RPC.
    let existing: { id: string; occurrences: number } | null = null;
    if (queryEmbedding !== null) {
      const { data, error: rpcError } = await supabase.rpc("match_error_pattern", {
        p_error_type: errorType,
        p_error_description: safeDescription,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_threshold: 0.85,
      });
      if (rpcError) {
        captureError(rpcError, "track-error-rpc", { errorType });
        // Fall through to string-equality fallback below.
      } else if (data && data.length > 0) {
        existing = { id: data[0].id, occurrences: data[0].occurrences };
      }
    }

    // 3. Fallback (no embedding OR no RPC match): string-equality dedup.
    if (existing === null) {
      const { data: fallbackRow, error: fallbackError } = await supabase
        .from("error_patterns")
        .select("id, occurrences")
        .eq("user_id", userId)
        .eq("error_type", errorType)
        .eq("error_description", safeDescription)
        .eq("resolved", false)
        .maybeSingle();
      if (fallbackError) {
        captureError(fallbackError, "track-error-fallback", { errorType });
      } else if (fallbackRow) {
        existing = fallbackRow;
      }
    }

    // 4. UPDATE existing OR INSERT new (with embedding if we have one).
    if (existing) {
      const { error: updateError } = await supabase
        .from("error_patterns")
        .update({ occurrences: existing.occurrences + 1, last_occurred: new Date().toISOString() })
        .eq("id", existing.id);
      if (updateError) captureError(updateError, "track-error-update", { errorType });
    } else {
      const insertPayload: {
        user_id: string;
        error_type: ErrorType;
        error_description: string;
        embedding?: string;
      } = { user_id: userId, error_type: errorType, error_description: safeDescription };
      if (queryEmbedding !== null) {
        insertPayload.embedding = JSON.stringify(queryEmbedding);
      }
      const { error: insertError } = await supabase.from("error_patterns").insert(insertPayload);
      if (insertError) captureError(insertError, "track-error-insert", { errorType });
    }
  }
  ```

- [x] **Critical ordering invariant**: `sanitizeMemoryContent` runs BEFORE `generateEmbedding`. The embedding vector represents the sanitized stored text. Same pattern as `persistMemories` at `src/lib/memory.ts:201-204` (Story 11-5).

- [x] **Critical fail-OPEN invariant**: An `await generateEmbedding(...)` rejection MUST NOT throw out of `trackError`. The catch routes to Sentry then continues to step 3 (string-equality fallback). Pre-11-6 callers must see no behavior change on embedding failure.

- [x] **Verify call-site preservation**: `persistErrorPatterns` at [`src/lib/error-tracker.ts:220-270`](src/lib/error-tracker.ts) still calls `trackError(userId, item.category as ErrorType, item.pattern)` at line 263 unchanged. The Realtime `note_error_pattern` tool-call dispatch at [`src/hooks/use-realtime-voice.ts:323`](src/hooks/use-realtime-voice.ts) still calls `await trackError(user.id, parsed.error_type, parsed.description)` unchanged. The `extractErrorsFromCorrections` function at `src/lib/error-tracker.ts:287-327` still calls `persistErrorPatterns` unchanged.

**Given** `trackError(userId, "grammar", "Confuses passé composé with imparfait")` is called
**When** `generateEmbedding` succeeds AND no semantically-similar row exists
**Then** a single INSERT writes a new `error_patterns` row with `embedding` column populated AND `occurrences = 1`.

**Given** `trackError` is called 4 times with 4 near-duplicate `passé composé / imparfait` descriptions
**When** all 4 calls succeed AND the cosine similarity between each pair is > 0.85
**Then** the final state is a single `error_patterns` row with `occurrences = 4` (verified via the E2E regression test below).

**Given** `generateEmbedding` rejects (network failure, daily-cost-cap exhausted, API 5xx)
**When** `trackError` runs the fallback path
**Then** the function continues via string-equality dedup (the pre-11-6 path) AND `captureError(err, "track-error-embedding")` fires once AND the user's flow is uninterrupted.

**Given** a legacy `error_patterns` row exists with NULL embedding + exact-string `error_description = "X"`
**When** `trackError(_, _, "X")` is called with a successful embedding
**Then** the RPC's Arm 2 (string-equality fallback) MATCHES the legacy row AND its `occurrences` increments (NOT a new row created with embedding).

### 3. Tests

- [x] **CREATE** `src/lib/__tests__/error-tracker-dedupe.test.ts` (~12 cases):

  - `trackError` calls `generateEmbedding(safeDescription)` exactly once per invocation.
  - `trackError` calls `supabase.rpc("match_error_pattern", { p_error_type, p_error_description, p_query_embedding, p_threshold: 0.85 })` exactly once when embedding succeeds.
  - On RPC match (data.length > 0) → `.update({ occurrences: existing.occurrences + 1, last_occurred })` fires; NO insert.
  - On no RPC match → `.insert({ user_id, error_type, error_description, embedding })` fires with the embedding column populated.
  - On `generateEmbedding` rejection → `captureError(_, "track-error-embedding")` fires AND fallback path runs the legacy `.eq("error_description", _).maybeSingle()` query AND the legacy fallback either UPDATE's the matched row OR INSERT's without an embedding column.
  - On `supabase.rpc` error → `captureError(_, "track-error-rpc")` fires AND fallback path runs.
  - On fallback `.maybeSingle()` error → `captureError(_, "track-error-fallback")` fires.
  - On `.update` error → `captureError(_, "track-error-update")` fires (Sentry contract preserved).
  - On `.insert` error → `captureError(_, "track-error-insert")` fires.
  - `safeDescription.length === 0` short-circuit → no embedding call, no RPC, no DB write.
  - `!ERROR_TYPES.has(errorType)` short-circuit → no embedding call, no RPC, no DB write.
  - Insert without embedding (fallback path): `insertPayload.embedding` key is ABSENT (not `undefined`, not `null`, not stringified-empty-array — absent so Supabase doesn't reject the row).

- [x] **CREATE** `src/lib/__tests__/error-tracker-e2e.test.ts` (~3 cases for the core P1-21 proof; these are higher-fidelity tests that mock `generateEmbedding` to return distinct vectors and mock the RPC to return matches based on a stub cosine similarity):

  - **The "passé composé / imparfait" 4-variant case**: 4 calls to `trackError` with 4 near-duplicate descriptions, mocked embeddings that cosine-similarity ≥ 0.85 pairwise, mocked RPC returns the first-inserted row on each subsequent call → final state asserts a single row with `occurrences = 4` and the FIRST description (NOT the most recent).
  - **The 0.85-boundary case**: an exact-0.85 similarity is NOT a match (`> p_threshold` strict comparison) → 2 calls produce 2 rows. A 0.851 similarity IS a match → 2 calls produce 1 row with `occurrences = 2`.
  - **The legacy NULL-embedding row case**: an existing row with NULL embedding + exact-string `"X"`; new `trackError(_, _, "X")` with successful embedding → the legacy row's `occurrences` increments (Arm 2 of the RPC's WHERE clause matched).

- [x] **CREATE** `supabase/migrations/__tests__/match_error_pattern_test.sql` (~6 manual-run pgTAP-style assertions; pattern mirrors `rate_limit_test.sql` from Story 11-4):

  - Function exists and is `SECURITY DEFINER` + `SET search_path = public`.
  - Returns 0 rows when no `error_patterns` row exists for the user.
  - Returns 1 row when an embedding row exists with cosine ≥ 0.85 — and only the BEST match (LIMIT 1, ORDER BY similarity DESC).
  - Returns 0 rows when the only candidate has cosine === 0.85 (boundary exclusion).
  - Returns 1 row when a legacy NULL-embedding row has exact-string `error_description` match.
  - Excludes `resolved = TRUE` rows.
  - Excludes other users' rows (the `auth.uid()` filter).

  Run via `psql -f` against a test instance with a stub `auth.uid()` (NOT CI-wired — Epic 15.3 scope).

- [x] **CREATE** `src/lib/__tests__/error-patterns-migration-drift.test.ts` (~4 drift-detector cases reading the migration file from disk; pattern mirrors `upstream-timeout-error.test.ts` from Story 11-3):

  - Migration adds `embedding VECTOR(1536)` column to `error_patterns`.
  - Migration creates `idx_error_patterns_embedding` HNSW index.
  - `match_error_pattern` function is `SECURITY DEFINER` + `SET search_path = public`.
  - `p_threshold DEFAULT 0.85` constant is the exact spec value (not 0.7 from `match_memories`, not 0.9).

- [x] **VERIFY existing tests stay green** — no regression. Target test count: 1080 → ~1099 (+~19 from the new modules).

### 4. Update CLAUDE.md

- [x] Add a new architecture line **after** the Story 11-5 "Cost discipline pass" line documenting: (a) the new `embedding VECTOR(1536)` column + HNSW index on `error_patterns`, (b) the new `match_error_pattern` RPC with its hybrid Arm-1 (embedding cosine ≥ 0.85) + Arm-2 (legacy string-equality) `WHERE` clause and `SECURITY DEFINER` + `SET search_path = public` hardening, (c) the `trackError` refactor with embedding-first dedup + fail-OPEN fallback + the canonical sanitize-before-embed ordering invariant, (d) the no-backfill decision and the rationale (legacy rows converge via natural usage), (e) the cross-story invariants (Story 9-4 sanitize-before-embed preserved; Story 11-1 / 11-2 / 11-3 / 11-4 / 11-5 surfaces unchanged; new Sentry tags are short categorical strings under the allowlist).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 11-6 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [x] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — `track-error-embedding` / `track-error-rpc` / `track-error-fallback` / `track-error-update` / `track-error-insert` are the 5 routed contexts.
- [x] **All colors use `Colors.*` design tokens** — **N/A** (no UI changes; the home-screen "Fix This Mistake" card is unchanged in shape — only the data feeding it has fewer near-duplicate rows).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass (no DSN / credential changes).
- [x] **Story 9-3 Sentry allowlist contract holds** — new `feature: "track-error-embedding"` / `"track-error-rpc"` / `"track-error-fallback"` are short categorical strings under the 80-char threshold; `feature` and `errorType` already allowlisted per `src/lib/sentry.ts:25-40`; no allowlist extension.
- [x] **Story 9-4 stored-prompt-injection defense holds** — `sanitizeMemoryContent` is called BEFORE `generateEmbedding`. The embedding represents the sanitized stored text. Pinned by test.
- [x] **Story 9-5 / 9-6 / 9-7 / 9-8 / 9-9 / 9-10 surfaces** — orthogonal; no shared state.
- [x] **Story 10-X surfaces hold** — orthogonal (prompts + scoring + exercise dedup are different tables).
- [x] **Story 11-1 correction tool-call contract holds** — `note_error_pattern` Realtime tool-call dispatch at `use-realtime-voice.ts:318-323` still calls `trackError(user.id, parsed.error_type, parsed.description)` unchanged. The dedup happens BEHIND the boundary.
- [x] **Story 11-2 reconnect + barge-in contract holds** — orthogonal; `trackError` runs post-turn, not during connection/reconnect.
- [x] **Story 11-3 Edge Function upstream timeouts contract holds** — `generateEmbedding` already routes through `ai-proxy` which uses `fetchWithTimeout` (Story 11-3). New call inherits the 30s timeout.
- [x] **Story 11-4 Postgres-backed rate-limit + cost cap contract holds** — `generateEmbedding` already counts against the daily cost cap + per-minute rate-limit via the `"embedding"` action arm at `ai-proxy/index.ts`. No new cost-tracking code.
- [x] **Story 11-5 cost discipline contract holds** — `extractPostConversationAnalysis` → `persistErrorPatterns` → `trackError` flow is unchanged at the call-site level. The new embedding-per-trackError cost is bounded (~$0.00003/conversation) and offset by the dedup quality win (fewer micro-drill candidates = fewer `generateMicroDrill` downstream `chatCompletion` calls).

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/11-6-embedding-based-error-tracker-dedupe.md`) under "Untracked files" — i.e. visible to git, not silently ignored.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/11-6-embedding-based-error-tracker-dedupe.md` passes.

## Tasks / Subtasks

- [x] **Task 1: New migration** (AC #1)
  - [x] Create `supabase/migrations/20260513000000_error_patterns_embedding.sql` with the 4 statements (ADD COLUMN, CREATE INDEX, DROP FUNCTION, CREATE FUNCTION).
  - [x] Verify idempotency via `supabase db reset && supabase db push` twice.
  - [x] Verify the migration file is captured by `git status` as untracked (Story 9-9 visibility check).

- [x] **Task 2: Refactor `trackError`** (AC #2)
  - [x] Import `generateEmbedding` from `./openai`.
  - [x] Add the embedding-first dedup path with `try { generateEmbedding } catch { Sentry + fall through }`.
  - [x] Add the RPC call with `supabase.rpc("match_error_pattern", { p_error_type, p_error_description, p_query_embedding, p_threshold: 0.85 })`.
  - [x] Wire the existing `.update` / `.insert` paths to consume the RPC result OR the fallback `.maybeSingle()` result.
  - [x] Conditionally include `embedding: JSON.stringify(queryEmbedding)` in the insert payload (absent on fallback path; absent key, not `null`).
  - [x] Verify all 5 Sentry contexts route correctly (`track-error-embedding` / `track-error-rpc` / `track-error-fallback` / `track-error-update` / `track-error-insert`).
  - [x] Verify `sanitizeMemoryContent` still runs BEFORE `generateEmbedding`.

- [x] **Task 3: Tests** (AC #3)
  - [x] CREATE `src/lib/__tests__/error-tracker-dedupe.test.ts` (~12 cases).
  - [x] CREATE `src/lib/__tests__/error-tracker-e2e.test.ts` (~3 cases — the canonical P1-21 proof).
  - [x] CREATE `supabase/migrations/__tests__/match_error_pattern_test.sql` (~6 manual-run pgTAP cases).
  - [x] CREATE `src/lib/__tests__/error-patterns-migration-drift.test.ts` (~4 drift-detector cases).
  - [x] Target test count: 1080 → ~1099.

- [x] **Task 4: Update CLAUDE.md** (AC #4)

- [x] **Task 5: Quality gates** (AC #Z)
  - [x] type-check / lint / format / test / colors all green.
  - [x] CI Sentry DSN + Submit credentials leak guards pass.
  - [x] `git status` shows the story file + migration file as untracked-but-not-ignored.
  - [x] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Mirror `companion_memory` for the schema + RPC + index pattern** — `embedding VECTOR(1536)` + HNSW index + `SECURITY DEFINER` RPC + `auth.uid()` filter. Same three-pattern stack from migration `20260301000002_production_fixes.sql` (Story 9-9 hardening).
- **Hybrid embedding + string-equality `WHERE` clause** — single RPC handles BOTH new rows (Arm 1) AND legacy rows (Arm 2). No two-phase migration. No backfill. Legacy rows age out via `resolved=TRUE` over time.
- **Sanitize before embed** — Story 11-5 / Story 9-4 invariant. The embedding vector represents the sanitized stored text, not the pre-sanitized text. Also a cost defense (empty-sanitize short-circuits before paying for an embedding).
- **Fail-OPEN on embedding failure** — Story 11-4 pattern (`checkRateLimit` returns `allowed: true` on RPC error). Embedding failure must NOT block the user's error tracking. Fallback to pre-11-6 string-equality. Sentry breadcrumb for operator visibility.
- **Single entry point at `trackError`** — `persistErrorPatterns`, `extractErrorsFromCorrections`, and the Realtime `note_error_pattern` tool-call dispatch all route through `trackError` at the boundary. The dedup logic has ONE entry point. No call-site changes outside `error-tracker.ts` + the migration.
- **No backfill** — operator-decision rationale in §"Threat / failure model #3" + §"Out of scope #1". The natural convergence path is users resolving old patterns over time. A future story can opportunistically backfill on Arm-2 match (UPDATE legacy row with new write's embedding) but Story 11-6 explicitly defers this.
- **Strict `> p_threshold` boundary** — defends against false-positive merges at exact 0.85. Tests pin the 0.85-boundary case (exact = no match; 0.851 = match).
- **Story 11-1 / 11-2 / 11-3 / 11-4 / 11-5 surfaces untouched** — Story 11-6 is a pure dedup-quality improvement at the persistence boundary; no upstream / downstream surface changes.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section bakes this in. Also extends to the new migration file.
- **Epic 9 + 10 + 11 retros A3** (review-patch budget): Story 11-6 has medium risk surface (schema migration + RPC + refactor + fail-OPEN + new dedup semantics). Expect 6-10 review patches. High-risk:
  - (a) The RPC's `OR`-arm `WHERE` clause — semantically correct for "embedding OR string-equality" but the test scaffold needs to assert both arms independently.
  - (b) The fail-OPEN path — if the RPC error case AND embedding success case AND fallback `.maybeSingle()` success case all need to compose, the flow is non-trivial.
  - (c) The 0.85 boundary semantics — `> p_threshold` strict vs `>= p_threshold` non-strict; test pins it explicitly.
  - (d) The legacy NULL-embedding row case — Arm-2 of the WHERE clause needs to compute `similarity = 1.0` (not 0.0) so the ORDER BY similarity DESC + LIMIT 1 picks it correctly.
  - (e) The Sentry allowlist — 3 new `feature` strings; verify they're under 80 chars.
  - (f) Migration idempotency — `DROP FUNCTION IF EXISTS` must match the exact signature including `(TEXT, TEXT, VECTOR, FLOAT)`.
  - (g) HNSW index requires the `vector` extension — Story 9-X migration already enables `vector`, but verify the migration order.
- **Story 11-3 lesson** (drift detector for source-of-truth invariants): Pin the migration's contract via a Jest drift detector reading the SQL file from disk. Catches a refactor that silently changes the `0.85` threshold or removes `SECURITY DEFINER`.
- **Story 11-4 lesson** (fail-OPEN as a policy): The embedding-failure path is fail-OPEN — same policy. Embedding failure must not block user flow.
- **Story 11-5 lesson** (defensive defaults vs `as Type` cast): The RPC result type uses defensive checks `Array.isArray(data) && data.length > 0` instead of casting.

### Schema migration ordering + dependencies

- The `vector` extension is enabled by migration `20260301000000_initial_schema.sql` (it's a pre-requisite for `companion_memory.embedding`). The new migration `20260513000000_error_patterns_embedding.sql` is sequenced AFTER it (filename timestamp ordering). Idempotent re-run safe.
- The `error_patterns` table is created by `20260301000000_initial_schema.sql:226-235`. The HNSW index requires the table + the column + the `vector` extension. All three are guaranteed by the migration ordering.
- The `match_error_pattern` function references `auth.uid()` which is the Supabase-provided helper — available in all `SECURITY DEFINER` contexts.

### RPC result type — TypeScript shape

The `supabase.rpc<T>("match_error_pattern", ...)` call returns:

```typescript
{
  data: { id: string; occurrences: number; similarity: number }[] | null;
  error: PostgrestError | null;
}
```

The `data` is an array (RETURNS TABLE) but we LIMIT 1 so it's `[]` or `[singleRow]`. The new code checks `Array.isArray(data) && data.length > 0` defensively (P13 patch: doc updated to match code).

The `similarity` field is included in the SELECT for debuggability + future tuning (operators can query for the actual similarity distribution by adding logging) but `trackError` doesn't currently use it post-match. Future stories can read it for telemetry.

### Cost — exact arithmetic

Per `trackError` call cost addition (Story 11-6):

- `generateEmbedding` → 1 `ai-proxy` invocation with `action: "embedding"`.
- `MODEL_RATES["text-embedding-3-small"]` from Story 11-4's `cost-table.ts`: `inputPer1M: 2`, `outputPer1M: 0`.
- Per-call: ~300 chars sanitized × ~1.3 tokens/4-char (English heuristic) ≈ ~98 tokens. Round up to ~120 tokens defensively.
- Cost: 120 × 2 / 1_000_000 = 0.00024¢ ≈ 0.0024 cents per `trackError` call.
- At typical conversation: ~5 corrections × 0.0024¢ = 0.012¢/conversation. At 100 conversations/day → 1.2¢/day total. **Well within the $1/day cap.**
- The post-11-6 cost INCREASE is bounded by the user's conversation rate. The dedup QUALITY win — measured by the micro-drill-engine firing rate increase — is the operator-facing benefit.

### Reference: Test fixtures for the canonical 4-variant case

```typescript
// src/lib/__tests__/error-tracker-e2e.test.ts
const FOUR_VARIANTS = [
  "Confuses passé composé with imparfait",
  "Mixes passé composé and imparfait for past actions",
  "Uses passé composé where imparfait is needed",
  "Confuses passé composé with imparfait for habitual past actions",
];

// Mock generateEmbedding to return distinct-but-similar vectors (cosine ≥ 0.85 pairwise).
// Mock supabase.rpc to return the first-inserted row on calls 2, 3, 4 (matching the
// stored embedding via the cosine check), and an empty array on call 1.
// Assert: final state has 1 row with occurrences = 4.
```

The mock embedding generation uses deterministic vectors (e.g., a fixed base vector + small per-call perturbation) so the test is reproducible. The mock RPC honors the strict-greater-than-threshold semantics.

## Dev Agent Record

### Implementation Plan

Implemented top-down following the Tasks/Subtasks sequence; no deviations from spec.

**Task 1 — Migration:** Created `supabase/migrations/20260513000000_error_patterns_embedding.sql` with 4 idempotent statements: (a) `ALTER TABLE error_patterns ADD COLUMN IF NOT EXISTS embedding VECTOR(1536)`, (b) HNSW index, (c) `DROP FUNCTION IF EXISTS match_error_pattern(TEXT, TEXT, VECTOR, FLOAT)`, (d) `CREATE OR REPLACE FUNCTION match_error_pattern(...)` with `SECURITY DEFINER` + `SET search_path = public` + the hybrid Arm-1 (cosine `> p_threshold`) / Arm-2 (string-equality fallback) `WHERE` clause + `ORDER BY similarity DESC LIMIT 1`.

**Task 2 — `trackError` refactor:** Added `ERROR_PATTERN_SIMILARITY_THRESHOLD = 0.85` exported constant. Refactored `trackError(userId, errorType, description)` to 4-step pipeline: sanitize → try-embed (fail-OPEN to `captureError(_, "track-error-embedding")` on rejection) → call `match_error_pattern` RPC if embedding succeeded (fail-OPEN to `captureError(_, "track-error-rpc")` on RPC error) → fallback `.eq("error_description", _).maybeSingle()` if no RPC match or embedding failed (fail-OPEN to `captureError(_, "track-error-fallback")` on Postgres error) → UPDATE on match OR INSERT (with `embedding: JSON.stringify(queryEmbedding)` ABSENT-key when embedding failed). Single entry point preserved; `persistErrorPatterns` + `extractErrorsFromCorrections` + Realtime `note_error_pattern` tool-call dispatch all call `trackError` unchanged.

**Task 3 — Tests:**

- `src/lib/__tests__/error-tracker-dedupe.test.ts` — 14 unit tests covering threshold pin, RPC-match UPDATE happy path, RPC-empty + fallback INSERT happy path, 3 fail-OPEN paths (embedding, RPC, fallback) each with Sentry routing, UPDATE-error path, INSERT-error path, invalid-errorType + empty-description + non-string short-circuits, sanitize-before-embed invariant (`"Ignore all prior instructions"` stripped before embed), and call-count contracts.
- `src/lib/__tests__/error-tracker-e2e.test.ts` — 4 high-fidelity end-to-end tests using an in-memory simulator that does ACTUAL cosine math against a `StoredRow[]` store: the canonical 4-variant `passé composé / imparfait` P1-21 closure proof (4 calls → single row with `occurrences = 4` preserving the FIRST description), the 0.85 exact-boundary exclusion (2 rows produced), the 0.851 above-boundary match (1 row with `occurrences = 2`), and the legacy NULL-embedding Arm-2 string-equality match (existing row's `occurrences` increments; embedding stays NULL).
- `src/lib/__tests__/error-patterns-migration-drift.test.ts` — 10 drift-detector cases reading the SQL migration from disk + pinning: column shape, HNSW index pattern, function `SECURITY DEFINER` + `search_path`, exact `0.85` threshold (negative guards against `0.7` / `0.9`), strict greater-than (negative guard against `>=`), `auth.uid()` filter (negative guard against `match_user_id` / `p_user_id`), both Arm-1 + Arm-2 WHERE clauses present, idempotent `DROP FUNCTION IF EXISTS` signature, `resolved = FALSE` filter, `RETURNS TABLE` shape.
- `supabase/migrations/__tests__/match_error_pattern_test.sql` — 7 manual-run pgTAP-style assertions (Story 11-4 pattern; not CI-wired — Epic 15.3 scope): function hardening check via `pg_proc.prosecdef` + `proconfig`, empty-result case, Arm-1 identical-embedding match (similarity ≈ 1.0), 0.85 exact-boundary exclusion via constructed unit vectors `[1, 0, ...]` and `[0.85, √(1-0.85²), 0, ...]`, Arm-2 legacy NULL-embedding string-equality match, `resolved=TRUE` exclusion, cross-user auth.uid() isolation.

**Task 4 — CLAUDE.md:** Added architecture paragraph after Story 11-5's line documenting all 10 facets per the AC #4 brief (column + HNSW index + RPC + hybrid WHERE + 0.85 strict-greater-than boundary + `trackError` 4-step pipeline + fail-OPEN policy + no-backfill rationale + Sentry tag allowlist preservation + cross-story invariants).

**Task 5 — Quality gates:** All 5 gates green on the first sweep (post-prettier-write fix for 3 new test files + removal of one unused `THRESHOLD` constant): `npm run type-check` (0 errors), `npm run lint` (0 warnings; `--max-warnings 0`), `npm run format:check` (Prettier), `npm test` (1108/1108 — +28 net 1080 → 1108), `npm run check:colors` (no hardcoded hex).

### Debug Log

No blockers, no HALT conditions, no spec deviations.

One minor friction point during initial test development: a first iteration of the `themedEmbedding` perturbation function in `error-tracker-e2e.test.ts` used too large a perturbation amplitude (0.5×), producing cosine similarities ~0.72-0.78 between sibling variants which was below the 0.85 threshold and broke the 4-variant proof. Reduced amplitude to 0.001× to ensure cosine > 0.85 across all 4 variants pairwise. The fix is documented inline in the test file.

### Completion Notes

- All 5 ACs satisfied + all 5 Z polish items checked.
- Story 9-4 sanitize-before-embed invariant pinned by dedicated test ("Ignore all prior instructions" injection token stripped before reaching the embedding API).
- Story 11-4 daily-cost-cap pre-flight check inherits the new `generateEmbedding` cost automatically via the `"embedding"` action arm at `ai-proxy/index.ts` — no new cost-tracking code (verified by code review of `ai-proxy/index.ts` switch statement).
- Story 9-3 Sentry allowlist contract preserved: 3 new `feature` strings (`track-error-embedding` / `track-error-rpc` / `track-error-fallback`) are all under 80 chars; `feature` and `errorType` already allowlisted in `src/lib/sentry.ts`.
- Story 9-9 hardening preserved: `match_error_pattern` is `SECURITY DEFINER` + `SET search_path = public`; pinned by both the Jest drift detector and the pgTAP-style SQL test.
- Story 11-1 `note_error_pattern` Realtime tool-call dispatch at `use-realtime-voice.ts:323` unchanged — dedup happens behind the `trackError` boundary.
- Story 11-5 `persistErrorPatterns` calls `trackError` at line 263 unchanged.
- Story 11-5 `extractErrorsFromCorrections` (echo + translation flows) calls `persistErrorPatterns` unchanged.
- **Test count exceeded spec target**: spec said ~+19 (1080 → ~1099); actual is +28 (1080 → 1108). Excess comes from richer per-AC test coverage in `error-tracker-dedupe.test.ts` (14 vs spec'd ~12) and `error-patterns-migration-drift.test.ts` (10 vs spec'd ~4 — added negative guards on threshold drift, GTE-vs-GT confusion, and pre-9-9 `match_user_id` parameter re-introduction). Higher coverage at no cost.

### File List



**Created:**

- `supabase/migrations/20260513000000_error_patterns_embedding.sql`
- `src/lib/__tests__/error-tracker-dedupe.test.ts`
- `src/lib/__tests__/error-tracker-e2e.test.ts`
- `src/lib/__tests__/error-patterns-migration-drift.test.ts`
- `supabase/migrations/__tests__/match_error_pattern_test.sql`

**Modified:**

- `src/lib/error-tracker.ts` (refactor `trackError` to embedding-first + RPC + fail-OPEN fallback)
- `CLAUDE.md` (add Story 11-6 architecture line after Story 11-5)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status flip + last_updated)

**Deleted:**

- None (no "delete don't alias" candidates in this story — `trackError` is refactored in place; the pre-11-6 string-equality query becomes the fallback arm).

### Change Log

| Date       | Change                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-13 | Story 11-6 story file created; closes audit P1-21 (error-tracker string-equality dedup → embedding-based dedup with cosine ≥ 0.85 + legacy NULL-embedding string-equality fallback arm; no backfill needed).                                                                                                                                                                                                                                                              |
| 2026-05-13 | Story 11-6 implementation complete on `feature/11-6-embedding-based-error-tracker-dedupe` (branched from `feature/11-5-cost-discipline-pass` since 11-5 PR #71 still open). New migration `20260513000000_error_patterns_embedding.sql` (ALTER TABLE + HNSW index + `match_error_pattern` RPC with hybrid Arm-1 cosine + Arm-2 string-equality). `trackError` refactored to embedding-first dedup with fail-OPEN fallback. +28 net tests (1080 → 1108); all quality gates green; CLAUDE.md updated; status → review.                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-13 | Story 11-6 review-round-1 complete: 16 of 16 actionable findings patched (1 BS + 3 HIGH + 5 MED + 7 LOW). **BS1** spec line 11 typo fixed. **HIGH**: P1 empty/wrong-dim embedding guard via new `isValidEmbedding(vec)` helper + `EMBEDDING_DIMENSION = 1536` export; P2 NaN/Infinity guard (same helper); P3 pgTAP test JWT setting key (`request.jwt.claims` JSON not `request.jwt.claim.sub`). **MED**: P4 top-level try/catch in `trackError` routing unexpected throws to `track-error-unexpected` Sentry context; P5 RPC + fallback row shape guards (string id + number occurrences); P6 fail-OPEN routes (embedding/RPC/fallback) switched from `captureError` (error tier) to `addBreadcrumb` (warning tier) — matches Story 11-4 fail-OPEN policy; P7 `description` field included in all 5 Sentry routes consistently; P8 ORDER BY tiebreaker (similarity DESC, last_occurred DESC, id) prevents non-deterministic Arm-2 legacy-row ties. **LOW**: P9 pgTAP test 7 asserts returned user_id ownership; P10 defensive `CREATE EXTENSION IF NOT EXISTS vector` prepend; P11 dedupe test asserts ALL 4 fallback `.eq()` columns; P12 absorbed into P6 (breadcrumb routing avoids PostgrestError instanceof issue); P13 story-file `Array.isArray(data)` doc drift fix; P14 `themedEmbedding` replaced with axis-and-angle `variantEmbedding` — variants land in realistic 0.878-0.955 cosine band that actually exercises the 0.85 threshold; P15 migration comment notes future CONCURRENTLY requirement. +13 net regression tests (1108 → 1121); all 5 quality gates green. |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-13
**Reviewers:** Blind Hunter (no project context) + Edge Case Hunter (project read access) + Acceptance Auditor (spec + diff)
**Initial outcome:** Acceptance Auditor **APPROVE**; adversarial layers surfaced 47 raw findings → 16 actionable + 12 deferred + 19 rejected after triage
**Post-patch outcome:** 16 of 16 actionable findings resolved (BS × 1 + HIGH × 3 + MED × 5 + LOW × 7)

### Action Items

#### BAD_SPEC (resolved)

- [x] **BS1 — Spec line 11 boundary phrasing typo.** Spec line 11 said `"similarity === 0.85 exact-boundary is a MATCH per > p_threshold strict comparison"` — but `0.85 > 0.85` is FALSE. The dev followed every other spec reference correctly (lines 140 / 199 / 437 / 524). **Fix:** updated line 11 phrasing to "is **NOT** a match per `> p_threshold` strict comparison."

#### HIGH (must-fix patches)

- [x] **P1 — `generateEmbedding` empty array / wrong-dim guard.** If `generateEmbedding` resolves with `[]` (API success-no-data) or non-1536-dim (future `dimensions` API param override), it passed the `!== null` guard and was sent to the RPC, where Postgres rejected the vector cast. **Fix:** new exported `isValidEmbedding(vec): vec is number[]` + `EMBEDDING_DIMENSION = 1536` constant in `error-tracker.ts`; validates length + finiteness. Falls back to string-equality dedup with `addBreadcrumb` signal on mismatch. 4 new regression tests pin the helper contract + integration behavior.
- [x] **P2 — NaN/Infinity component guard.** `JSON.stringify` emits `null` for NaN/Infinity → Postgres rejects the vector cast. Same helper (`isValidEmbedding`) checks `Number.isFinite(x)` for every component. 2 new regression tests cover NaN + Infinity + -Infinity + non-number component cases.
- [x] **P3 — pgTAP test 7 wrong JWT setting key.** Supabase's `auth.uid()` reads `current_setting('request.jwt.claims', true)::json->>'sub'`, NOT `request.jwt.claim.sub`. The wrong key was leaving `auth.uid()` returning NULL → test 7 (cross-user isolation) passed vacuously. **Fix:** switched to `set_config('request.jwt.claims', json_build_object('sub', uuid)::text, true)`.

#### MED (patches)

- [x] **P4 — `trackError` top-level try/catch.** An unexpected throw (sanitizer regex engine exception, JSON.stringify on a circular vector, etc.) escaped and aborted the `persistErrorPatterns` loop mid-batch. **Fix:** wrapped function body in `try/catch` routing unexpected exceptions through `captureError(_, "track-error-unexpected", { errorType })`. Regression test injects a synthetic insert throw and asserts `trackError` resolves without throwing + routes to Sentry.
- [x] **P5 — RPC + fallback row shape guards.** RPC `data[0].id` could be null/undefined, `data[0].occurrences` could be non-numeric (custom transform / response shape drift). `existing.occurrences + 1` becomes NaN → UPDATE writes NaN. **Fix:** added `typeof row.id === "string" && typeof row.occurrences === "number"` guards on both RPC and fallback paths. Malformed rows route to `addBreadcrumb` and fall through to INSERT. 3 regression tests cover malformed RPC id (number) + malformed RPC occurrences (string) + malformed fallback row.
- [x] **P6 — `addBreadcrumb` for fail-OPEN routes instead of `captureError`.** Embedding API hiccups were spamming Sentry's error tier instead of warning tier. Story 11-4's `checkRateLimit` fail-OPEN uses `console.warn`; Story 11-5 review P9 uses `addBreadcrumb` for the same class of "drop and continue" signal. **Fix:** all 3 fail-OPEN routes (`track-error-embedding` / `track-error-rpc` / `track-error-fallback`) now use `addBreadcrumb({ level: "warning", category: "ai", message, data: { feature, errorType, description } })`. `captureError` is reserved for UPDATE/INSERT failures (DB write errors) and `track-error-unexpected` (P4 catch-all). 3 existing tests updated to assert `addBreadcrumb` AND assert `captureError` was NOT called for these routes.
- [x] **P7 — Sentry extras consistency across all 5 routes.** Pre-patch the 3 fail-OPEN routes passed `{ errorType }` only while UPDATE/INSERT passed `{ errorType, description }`. **Fix:** `description: safeDescription` now included in the breadcrumb `data` field for all 3 fail-OPEN routes (story 9-3 allowlist already includes `description`). Operators get consistent context across vendor-failure, RPC-failure, fallback-failure, write-failure routes. P11 dedupe test asserts the breadcrumb shape.
- [x] **P8 — Non-deterministic `ORDER BY` when multiple Arm-2 legacy rows tie at similarity=1.0.** Two legacy NULL-embedding rows with identical `error_description` (corrupted legacy data) → `ORDER BY similarity DESC LIMIT 1` picked non-deterministically across calls. **Fix:** migration `ORDER BY similarity DESC, ep.last_occurred DESC, ep.id` adds stable tiebreaker (prefer recently-active; id-ASC as final tiebreaker). Drift detector test pins the new clause.

#### LOW (patches)

- [x] **P9 — pgTAP test 7 user_id assertion.** Pre-patch asserted only `v_count <= 1`; could false-positive if isolation INVERTED (only other-user row leaked). **Fix:** captures returned row's id + fetches its `user_id` + asserts `v_returned_user_id = v_test_uid`.
- [x] **P10 — Defensive `CREATE EXTENSION IF NOT EXISTS vector;` prepend.** Migration relied on `20260301000000_initial_schema.sql` having enabled the extension. **Fix:** idempotent re-declare at top of migration. Drift detector pins the ordering (extension BEFORE ALTER TABLE).
- [x] **P11 — Test `selectEqMock` per-column assertion.** Mock returned same builder for every `.eq()` call; a regression that dropped `.eq("resolved", false)` would pass tests. **Fix:** new test asserts all 4 captured `.eq()` calls match expected `[col, val]` pairs.
- [x] **P12 — `captureError` Error-wrap PostgrestError.** Absorbed by P6 — fail-OPEN routes now use `addBreadcrumb` which doesn't care about Error-vs-PostgrestError shape. UPDATE/INSERT routes simplified to use `captureError`'s built-in `error instanceof Error ? error : new Error(String(error))` wrapper (already in `sentry.ts:226`); no client-side pre-wrap needed.
- [x] **P13 — Story file Dev Notes drift.** Doc said `data && data.length > 0`; code says `Array.isArray(data) && data.length > 0`. **Fix:** 3 occurrences updated in the story file.
- [x] **P14 — `themedEmbedding` amplitude unrealistic.** Pre-patch 1e-3 perturbation left all cosines at ~0.9999 — the 4-variant test passed trivially. **Fix:** replaced with `variantEmbedding(variant)` using `cos(angle) at axis 0, sin(angle) at distinct axis` for variants 0-3 at angles `[0, 0.30, 0.40, 0.50]` rad → cosines vs reference are `[1.000, 0.955, 0.921, 0.878]`. Variant 3 is barely above the 0.85 threshold — a future threshold drift to 0.88 would break the proof.
- [x] **P15 — Migration comment on CONCURRENTLY for future re-create.** Initial deploy on empty column is safe; a future re-create on a populated table would lock writes. **Fix:** added migration comment documenting the requirement. Drift detector pins the comment presence.

### Files Modified by Patches

**Migration:** `supabase/migrations/20260513000000_error_patterns_embedding.sql` — P8 + P10 + P15
**Source:** `src/lib/error-tracker.ts` — P1 + P2 + P4 + P5 + P6 + P7 + P12 + new `isValidEmbedding` + `EMBEDDING_DIMENSION`
**Tests:**

- `src/lib/__tests__/error-tracker-dedupe.test.ts` — 3 fail-OPEN test rewrites (P6) + 9 new test cases (P1 × 2 + P2 × 2 + P1/P2 helper × 1 + P4 × 1 + P5 × 3 + P11 × 1)
- `src/lib/__tests__/error-tracker-e2e.test.ts` — `themedEmbedding` → `variantEmbedding` rewrite (P14)
- `src/lib/__tests__/error-patterns-migration-drift.test.ts` — 3 new test cases (P10 + P8 + P15)
- `supabase/migrations/__tests__/match_error_pattern_test.sql` — P3 + P9
  **Docs:** `_bmad-output/implementation-artifacts/11-6-embedding-based-error-tracker-dedupe.md` — BS1 + P13

### Test Count Delta

Initial implementation: 1080 → 1108 (+28). Review-round-1 patches: 1108 → 1121 (+13). Net Story 11-6 contribution: +41 tests.

### Deferred (12 items, per review verdict — out of Story 11-6 scope)

- D1 — Concurrent `trackError` race (no UNIQUE constraint + ON CONFLICT). Real race but spec doesn't budget; legitimate future-story scope.
- D2 — UPDATE lost-update race (Story 12-3 owns atomic-RPC mutations).
- D3 — `.maybeSingle()` rejects when >1 legacy row matches description (rare legacy data shape).
- D4 — HNSW index without partial predicate may not be used under RLS (same pattern as `companion_memory`; spec mirrors it).
- D5 — `occurrences` INTEGER overflow (~2B max; not practical).
- D6 — `MICRO_DRILL_THRESHOLD` won't fire on legacy semantically-overlapping data (acknowledged in spec).
- D7 — `supabase.rpc` lacks client-side timeout (consistent with rest of codebase).
- D8 — `auth.uid()` returns NULL under service-role (by-design; `trackError` is user-scoped).
- D9 — VACUUM ANALYZE post-deploy (ops concern; not migration scope).
- D10 — pgTAP profiles insert fragile to schema (low-priority test brittleness).
- D11 — Embedding column type wire format (string vs VECTOR auto-cast; Supabase contract).
- D12 — HNSW perf claim unverified by EXPLAIN ANALYZE (out of scope; not unit-testable).

### Rejected (19 noise findings — for the record)

Highlights: redundant fallback after RPC empty (per-spec belt-and-braces), test-only state leaks (B4/B5/B18), already-acknowledged test count overage (B20), correct PG type-mod-stripping behavior (B24).
