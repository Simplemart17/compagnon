import { supabase } from "./supabase";
import { chatCompletionJSON } from "./openai";
import { addBreadcrumb, captureError } from "./sentry";
import { MICRO_DRILL_THRESHOLD } from "./constants";
import { sanitizeMemoryContent } from "./memory";
import { errorPatternBatchSchema, microDrillSchema } from "./schemas/ai-responses";

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
 * Returns silently if `errorType` is not a known literal or if `description`
 * sanitizes to the empty string (sanitization-driven drops are not anomalies
 * and are not captured to Sentry).
 */
export async function trackError(
  userId: string,
  errorType: ErrorType,
  description: string
): Promise<void> {
  // Defensive runtime checks — keep behavior consistent across all callers.
  if (!ERROR_TYPES.has(errorType)) return;
  const safeDescription = typeof description === "string" ? sanitizeMemoryContent(description) : "";
  if (safeDescription.length === 0) return;

  // Check if this error pattern already exists
  const { data: existing } = await supabase
    .from("error_patterns")
    .select("id, occurrences")
    .eq("user_id", userId)
    .eq("error_type", errorType)
    .eq("error_description", safeDescription)
    .eq("resolved", false)
    .maybeSingle();

  if (existing) {
    // Increment occurrences
    const { error: updateError } = await supabase
      .from("error_patterns")
      .update({
        occurrences: existing.occurrences + 1,
        last_occurred: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      captureError(updateError, "track-error-update", {
        errorType,
        description: safeDescription,
      });
    }
  } else {
    // Create new error pattern
    const { error: insertError } = await supabase.from("error_patterns").insert({
      user_id: userId,
      error_type: errorType,
      error_description: safeDescription,
    });

    if (insertError) {
      captureError(insertError, "track-error-insert", {
        errorType,
        description: safeDescription,
      });
    }
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
