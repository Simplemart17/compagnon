import { supabase } from "./supabase";
import { chatCompletionJSON, generateEmbedding } from "./openai";
import { addBreadcrumb, captureError } from "./sentry";
import { MICRO_DRILL_THRESHOLD } from "./constants";
import { sanitizeMemoryContent } from "./memory";
import { errorPatternBatchSchema, microDrillSchema } from "./schemas/ai-responses";

/**
 * Cosine-similarity threshold for semantic dedup of error patterns (Story 11-6 / P1-21).
 * Strict `>` comparison in the `match_error_pattern` RPC — at exact 0.85 → NO match.
 * Operator-spec'd in `_bmad-output/planning-artifacts/shippable-roadmap.md` line 186.
 */
export const ERROR_PATTERN_SIMILARITY_THRESHOLD = 0.85;

/**
 * Expected embedding dimension for `text-embedding-3-small` (and the
 * `error_patterns.embedding` column type `VECTOR(1536)`). A vector with a
 * different length cannot be persisted; `trackError` validates this
 * post-`generateEmbedding` and falls back to string-equality dedup on mismatch.
 */
export const EMBEDDING_DIMENSION = 1536;

/**
 * Validate that an embedding vector is well-shaped before sending it to the
 * RPC / INSERT. P1 + P2 review-round-1 patches:
 *   - P1: reject empty `[]` (API success-with-no-data) or wrong-dim arrays
 *         (a future `dimensions` API param override would return ≠ 1536).
 *   - P2: reject NaN / Infinity components — `JSON.stringify` would emit
 *         `"null"` for those and the Postgres VECTOR cast would fail.
 *
 * Pure: no I/O, no logging. Returns `true` iff the array is a 1536-long
 * Float32-castable sequence with all finite components.
 */
export function isValidEmbedding(vec: unknown): vec is number[] {
  if (!Array.isArray(vec)) return false;
  if (vec.length !== EMBEDDING_DIMENSION) return false;
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i];
    if (typeof x !== "number" || !Number.isFinite(x)) return false;
  }
  return true;
}

/** Error types that get tracked */
export type ErrorType = "grammar" | "pronunciation" | "vocabulary" | "register";

/**
 * Single source of truth for the four `ErrorType` literals. The
 * `Record<ErrorType, true>` annotation enforces compile-time exhaustiveness —
 * adding a new ErrorType variant without updating this record is a TS error.
 */
const ERROR_TYPE_RECORD: Record<ErrorType, true> = {
  grammar: true,
  pronunciation: true,
  vocabulary: true,
  register: true,
};
const ERROR_TYPES: ReadonlySet<ErrorType> = new Set(Object.keys(ERROR_TYPE_RECORD) as ErrorType[]);

/** An error pattern record from the database */
export interface ErrorPattern {
  id: string;
  user_id: string;
  error_type: ErrorType;
  error_description: string;
  occurrences: number;
  last_occurred: string;
  resolved: boolean;
  created_at: string;
}

/**
 * Record a new error occurrence, or increment the count if it already exists.
 *
 * `description` is sanitized via `sanitizeMemoryContent` at the boundary so
 * every writer to `error_patterns.error_description` (not just
 * `extractErrorsFromCorrections`) inherits the 300-char cap and injection-token
 * strip — matches the CLAUDE.md "called on every write" contract.
 *
 * Story 11-6 dedup pipeline (closes audit P1-21):
 *
 *   1. Sanitize description (300-char cap + injection-token strip).
 *   2. Generate an embedding for the sanitized description (`generateEmbedding`).
 *      Ordering is load-bearing: the embedding represents the sanitized stored
 *      text, NOT the pre-sanitized text — same invariant as `persistMemories`
 *      at `src/lib/memory.ts` (Story 11-5).
 *   3. Validate the embedding shape via `isValidEmbedding` (P1+P2: rejects
 *      empty arrays, wrong-dim arrays, and NaN/Infinity components — any of
 *      which would have failed the Postgres VECTOR cast at the RPC).
 *   4. Call `match_error_pattern` RPC — hybrid WHERE clause matches both
 *      embedding rows (cosine > 0.85) AND legacy NULL-embedding rows (exact
 *      string-equality fallback). Returns at most one row (the best match).
 *   5. On RPC match → UPDATE `occurrences + 1` + `last_occurred`. On no match
 *      → INSERT new row WITH the embedding column populated.
 *
 * Fail-OPEN policy: `generateEmbedding` rejection / invalid embedding shape /
 * RPC error / fallback Postgres error all route through `addBreadcrumb` at
 * `warning` level (P6 review-round-1 patch — these are operational signals,
 * not crashes) and fall back to pre-11-6 string-equality dedup. The user's
 * error tracking is uninterrupted on these failures — same policy as Story
 * 11-4's Postgres-error fail-OPEN in `checkRateLimit`. Only truly unexpected
 * exceptions (P4 top-level catch) route through `captureError`.
 *
 * Returns silently if `errorType` is not a known literal or if `description`
 * sanitizes to the empty string (sanitization-driven drops are not anomalies
 * and are not captured to Sentry).
 */
export async function trackError(
  userId: string,
  errorType: ErrorType,
  description: string
): Promise<void> {
  // P4: top-level try/catch — ensures an unexpected throw doesn't escape and
  // abort a `persistErrorPatterns` loop mid-batch. Same defense as Story 11-5's
  // `Promise.allSettled` per-slot isolation.
  try {
    // Defensive runtime checks — keep behavior consistent across all callers.
    if (!ERROR_TYPES.has(errorType)) return;
    const safeDescription =
      typeof description === "string" ? sanitizeMemoryContent(description) : "";
    if (safeDescription.length === 0) return;

    // 1. Generate embedding (fail-OPEN). Ordering invariant: sanitize → embed.
    let queryEmbedding: number[] | null = null;
    try {
      const raw = await generateEmbedding(safeDescription);
      // P1+P2: shape guard. Empty `[]` / wrong-dim / NaN / Infinity all fail
      // the Postgres VECTOR(1536) cast — treat as embedding-unavailable and
      // fall back to string-equality dedup rather than burning an RPC call.
      if (isValidEmbedding(raw)) {
        queryEmbedding = raw;
      } else {
        addBreadcrumb({
          category: "ai",
          level: "warning",
          message: "trackError: generateEmbedding returned malformed vector",
          data: { feature: "track-error-embedding", errorType, description: safeDescription },
        });
      }
    } catch (err) {
      // P6: addBreadcrumb (warning-level) instead of captureError (error-level).
      // P7: include description in the breadcrumb data for operator visibility.
      const errMsg = err instanceof Error ? err.message : String(err);
      addBreadcrumb({
        category: "ai",
        level: "warning",
        message: `trackError: generateEmbedding failed: ${errMsg.slice(0, 80)}`,
        data: { feature: "track-error-embedding", errorType, description: safeDescription },
      });
      // Fall through to string-equality dedup below.
    }

    // 2. Try embedding-first dedup via the hybrid RPC.
    let existing: { id: string; occurrences: number } | null = null;
    if (queryEmbedding !== null) {
      const { data, error: rpcError } = await supabase.rpc("match_error_pattern", {
        p_error_type: errorType,
        p_error_description: safeDescription,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_threshold: ERROR_PATTERN_SIMILARITY_THRESHOLD,
      });
      if (rpcError) {
        // P6: addBreadcrumb (warning) for fail-OPEN. P12: PostgrestError isn't an Error
        // instance — Sentry can drop or mis-frame it; breadcrumb avoids the issue
        // entirely. P7: include description.
        addBreadcrumb({
          category: "ai",
          level: "warning",
          message: `trackError: match_error_pattern RPC error: ${rpcError.message?.slice(0, 80) ?? "unknown"}`,
          data: { feature: "track-error-rpc", errorType, description: safeDescription },
        });
        // Fall through to string-equality fallback below.
      } else if (Array.isArray(data) && data.length > 0) {
        // P5: validate row shape before trusting fields.
        const row = data[0] as { id?: unknown; occurrences?: unknown };
        if (typeof row.id === "string" && typeof row.occurrences === "number") {
          existing = { id: row.id, occurrences: row.occurrences };
        } else {
          addBreadcrumb({
            category: "ai",
            level: "warning",
            message: "trackError: match_error_pattern RPC returned malformed row",
            data: { feature: "track-error-rpc", errorType, description: safeDescription },
          });
        }
      }
    }

    // 3. Fallback dedup (no embedding OR no RPC match): pre-11-6 string-equality.
    //    Re-runs even when embedding succeeded but the RPC found no match — defends
    //    against a brand-new write while a concurrent legacy row exists with the
    //    same exact string but no embedding yet (Arm 2 of the RPC handles this,
    //    but the fallback is also belt-and-braces for the post-RPC-error path).
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
        // P6+P7+P12: warning-level breadcrumb (not captureError); include description.
        addBreadcrumb({
          category: "ai",
          level: "warning",
          message: `trackError: fallback string-eq query failed: ${fallbackError.message?.slice(0, 80) ?? "unknown"}`,
          data: { feature: "track-error-fallback", errorType, description: safeDescription },
        });
      } else if (fallbackRow) {
        // P5: validate fallbackRow shape.
        const fb = fallbackRow as { id?: unknown; occurrences?: unknown };
        if (typeof fb.id === "string" && typeof fb.occurrences === "number") {
          existing = { id: fb.id, occurrences: fb.occurrences };
        } else {
          addBreadcrumb({
            category: "ai",
            level: "warning",
            message: "trackError: fallback string-eq returned malformed row",
            data: { feature: "track-error-fallback", errorType, description: safeDescription },
          });
        }
      }
    }

    // 4. Either UPDATE existing OR INSERT new (with embedding if we have one).
    if (existing) {
      const { error: updateError } = await supabase
        .from("error_patterns")
        .update({
          occurrences: existing.occurrences + 1,
          last_occurred: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        // UPDATE/INSERT failures stay captureError-level — these are
        // unexpected DB write failures, not the embedding-vendor-hiccup class
        // that P6 reclassifies. Preserves the pre-11-6 contract for these
        // routes. `captureError` accepts `unknown` and wraps to Error
        // internally (closes P12 — no client-side wrap needed).
        captureError(updateError, "track-error-update", {
          errorType,
          description: safeDescription,
        });
      }
    } else {
      // Conditionally include the embedding column. ABSENT when we don't have one
      // (NOT `null`, NOT `undefined` — keeps Supabase happy + lets legacy-style
      // fallback rows stay NULL-embedding so future writes can match via Arm 2).
      const insertPayload: {
        user_id: string;
        error_type: ErrorType;
        error_description: string;
        embedding?: string;
      } = {
        user_id: userId,
        error_type: errorType,
        error_description: safeDescription,
      };
      if (queryEmbedding !== null) {
        insertPayload.embedding = JSON.stringify(queryEmbedding);
      }
      const { error: insertError } = await supabase.from("error_patterns").insert(insertPayload);

      if (insertError) {
        captureError(insertError, "track-error-insert", {
          errorType,
          description: safeDescription,
        });
      }
    }
  } catch (unexpected) {
    // P4: top-level guard. Any unforeseen throw (sanitizer regex engine
    // exception, JSON.stringify on a circular vector, etc.) routes here so
    // `persistErrorPatterns` keeps processing the rest of the batch.
    captureError(
      unexpected instanceof Error ? unexpected : new Error(String(unexpected)),
      "track-error-unexpected",
      { errorType }
    );
  }
}

/**
 * Mark an error as resolved after the user demonstrates correct usage.
 */
export async function resolveError(errorId: string): Promise<void> {
  const { error } = await supabase
    .from("error_patterns")
    .update({ resolved: true })
    .eq("id", errorId);

  if (error) {
    captureError(error, "resolve-error", { errorId });
  }
}

/**
 * Get the user's most persistent unresolved errors, sorted by frequency.
 */
export async function getTopErrors(userId: string, limit: number = 5): Promise<ErrorPattern[]> {
  const { data } = await supabase
    .from("error_patterns")
    .select("*")
    .eq("user_id", userId)
    .eq("resolved", false)
    .order("occurrences", { ascending: false })
    .limit(limit);

  return (data as ErrorPattern[]) ?? [];
}

/**
 * Get errors that qualify for micro-drill generation (3+ occurrences).
 */
export async function getErrorsForDrills(userId: string): Promise<ErrorPattern[]> {
  const { data } = await supabase
    .from("error_patterns")
    .select("*")
    .eq("user_id", userId)
    .eq("resolved", false)
    .gte("occurrences", MICRO_DRILL_THRESHOLD)
    .order("occurrences", { ascending: false })
    .limit(3);

  return (data as ErrorPattern[]) ?? [];
}

/**
 * Generate a targeted micro-drill exercise for a specific error pattern.
 */
export async function generateMicroDrill(
  error: ErrorPattern,
  cefrLevel: string
): Promise<MicroDrill> {
  const drill = await chatCompletionJSON(
    [
      {
        role: "system",
        content: `You are a French language tutor. Generate a short, targeted exercise to help fix a specific recurring error. The exercise should be quick (2-3 minutes) and focused.

Error type: ${error.error_type}
Error description: ${error.error_description}
User CEFR level: ${cefrLevel}
Times this error occurred: ${error.occurrences}

Generate a micro-drill with 3-5 focused questions that specifically address this error pattern. Include clear explanations.

Response format JSON:
{
  "title": "<short title in French>",
  "explanation": "<1-2 sentences explaining the rule in French>",
  "questions": [
    {
      "question": "<question with ___ for blank if fill-in>",
      "options": ["<a>", "<b>", "<c>", "<d>"],
      "correctIndex": 0,
      "explanation": "<why this is correct, in French>"
    }
  ],
  "tip": "<one memorable tip to remember the rule>"
}`,
      },
    ],
    microDrillSchema,
    { temperature: 0.5, maxTokens: 1024, feature: "error-tracker-micro-drill" }
  );

  return drill;
}

/** A micro-drill exercise targeting a specific error */
export interface MicroDrill {
  title: string;
  explanation: string;
  questions: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }[];
  tip: string;
}

/** Maximum number of corrections to process per conversation */
const MAX_CORRECTIONS_PER_CONVERSATION = 10;

/**
 * Persist pre-enriched error patterns to the error tracker (Story 11-5).
 *
 * Replaces the embed+insert pipeline that was previously inside
 * `extractErrorsFromCorrections` (now restricted to non-Realtime callers
 * — see below). Each pattern is validated against `ERROR_TYPES` then
 * routed through `trackError`, which handles sanitization + embedding +
 * upsert into `error_patterns`.
 *
 * The Realtime path (`use-realtime-voice.ts` `persistConversation`) now
 * produces these patterns inline as part of `extractPostConversationAnalysis`
 * (the consolidated 3-in-1 AI call). The non-Realtime callers
 * (`use-echo-practice.ts` + `use-translation.ts`) still go through
 * `extractErrorsFromCorrections` which internally calls this helper.
 */
export async function persistErrorPatterns(
  userId: string,
  patterns: readonly {
    original: string;
    corrected: string;
    pattern: string;
    category: string;
  }[]
): Promise<void> {
  if (!Array.isArray(patterns) || patterns.length === 0) return;

  // Track each pattern. `trackError` sanitizes the description via
  // `sanitizeMemoryContent` internally, so call-site validation only
  // needs to check the category literal-union + skip absent patterns.
  // Story 11-5 review patch P9: filter-drops emit a Sentry breadcrumb so
  // operators can grep for systemic category-typo issues (e.g., an echo
  // evaluator that emits `"spelling"` would silently no-op pre-patch;
  // post-patch the operator sees the dropped-category signal in Sentry).
  for (const item of patterns) {
    if (!item.pattern || typeof item.pattern !== "string") {
      addBreadcrumb({
        category: "ai",
        level: "warning",
        message: "persistErrorPatterns dropped item with missing/non-string pattern",
        data: { feature: "error-pattern-pattern-drop" },
      });
      continue;
    }
    if (typeof item.category !== "string" || !ERROR_TYPES.has(item.category as ErrorType)) {
      addBreadcrumb({
        category: "ai",
        level: "warning",
        message: "persistErrorPatterns dropped item with invalid category",
        data: {
          feature: "error-pattern-category-drop",
          // `category` is short categorical; allowlist-safe per Story 9-3.
          category: typeof item.category === "string" ? item.category : "non-string",
        },
      });
      continue;
    }

    try {
      await trackError(userId, item.category as ErrorType, item.pattern);
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), "extract-errors-track", {
        category: item.category,
      });
    }
  }
}

/**
 * Extract error patterns from AI corrections via a dedicated chat call.
 *
 * Story 11-5: this function is still the entry point for **non-Realtime
 * flows** (`use-echo-practice.ts` + `use-translation.ts`) where the
 * corrections come from an echo/translation evaluation and there's no
 * accompanying transcript / feedback to consolidate with. The Realtime
 * post-conversation path uses `extractPostConversationAnalysis`
 * (in `src/lib/post-conversation-analysis.ts`) instead, which folds
 * error patterns into the same combined call that produces facts +
 * feedback (saves ~1.25¢ per conversation on input cost).
 *
 * Batches all corrections into a single AI call for efficiency, capped
 * at `MAX_CORRECTIONS_PER_CONVERSATION` to limit token usage.
 */
export async function extractErrorsFromCorrections(
  userId: string,
  corrections: {
    original: string;
    corrected: string;
    explanation: string;
    category: string;
  }[]
): Promise<void> {
  if (corrections.length === 0) return;

  const capped = corrections.slice(0, MAX_CORRECTIONS_PER_CONVERSATION);

  const correctionsList = capped
    .map(
      (c, i) =>
        `${i + 1}. Original: "${c.original}" | Corrected: "${c.corrected}" | Explanation: "${c.explanation}" | Category: "${c.category}"`
    )
    .join("\n");

  const result = await chatCompletionJSON(
    [
      {
        role: "system",
        content: `Given these French language corrections, identify the general grammar/vocabulary rule that was violated for each one. Describe each pattern in a concise, reusable way (not specific to the sentence).

Corrections:
${correctionsList}

Response format:
{"patterns": [{"original": "<original text>", "corrected": "<corrected text>", "pattern": "<concise description of the error pattern>", "category": "<grammar|pronunciation|vocabulary|register>"}]}

Example pattern: "Confuses passe compose with imparfait for habitual past actions"`,
      },
    ],
    errorPatternBatchSchema,
    { temperature: 0.2, maxTokens: 1024, feature: "error-tracker-batch" }
  );

  await persistErrorPatterns(userId, result.patterns);
}
