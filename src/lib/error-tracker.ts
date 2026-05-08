import { supabase } from "./supabase";
import { chatCompletionJSON } from "./openai";
import { captureError } from "./sentry";
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
 * Extract error patterns from AI corrections in a conversation.
 * Call this after each conversation to feed the error tracker.
 *
 * Batches all corrections into a single AI call for efficiency,
 * capped at MAX_CORRECTIONS_PER_CONVERSATION to limit token usage.
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

  // Cap corrections to avoid excessively large prompts
  const capped = corrections.slice(0, MAX_CORRECTIONS_PER_CONVERSATION);

  // Build a single prompt containing all corrections
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

  if (result.patterns.length === 0) return;

  // Track each extracted error pattern. trackError sanitizes the description
  // via sanitizeMemoryContent internally, so call-site validation only needs
  // to check the category literal-union and skip absent patterns. Sanitizer
  // is idempotent — calling it again here would be redundant.
  for (const item of result.patterns) {
    if (!item.pattern || typeof item.pattern !== "string") continue;
    if (typeof item.category !== "string" || !ERROR_TYPES.has(item.category as ErrorType)) {
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
