import { supabase } from "./supabase";
import { chatCompletionJSON } from "./openai";
import { MICRO_DRILL_THRESHOLD } from "./constants";

/** Error types that get tracked */
export type ErrorType = "grammar" | "pronunciation" | "vocabulary" | "register";

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
 */
export async function trackError(
  userId: string,
  errorType: ErrorType,
  description: string
): Promise<void> {
  // Check if this error pattern already exists
  const { data: existing } = await supabase
    .from("error_patterns")
    .select("id, occurrences")
    .eq("user_id", userId)
    .eq("error_type", errorType)
    .eq("error_description", description)
    .eq("resolved", false)
    .maybeSingle();

  if (existing) {
    // Increment occurrences
    await supabase
      .from("error_patterns")
      .update({
        occurrences: existing.occurrences + 1,
        last_occurred: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    // Create new error pattern
    await supabase.from("error_patterns").insert({
      user_id: userId,
      error_type: errorType,
      error_description: description,
    });
  }
}

/**
 * Mark an error as resolved after the user demonstrates correct usage.
 */
export async function resolveError(errorId: string): Promise<void> {
  await supabase.from("error_patterns").update({ resolved: true }).eq("id", errorId);
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
  const drill = await chatCompletionJSON<MicroDrill>(
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
    { temperature: 0.5, maxTokens: 1024 }
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

/**
 * Extract error patterns from AI corrections in a conversation.
 * Call this after each conversation to feed the error tracker.
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
  for (const correction of corrections) {
    // Generalize the error to a pattern (not the specific instance)
    const pattern = await chatCompletionJSON<{ pattern: string }>(
      [
        {
          role: "system",
          content: `Given this French language correction, identify the general grammar/vocabulary rule that was violated. Describe it in a concise, reusable way (not specific to this sentence).

Original: "${correction.original}"
Corrected: "${correction.corrected}"
Explanation: "${correction.explanation}"

Response: {"pattern": "<concise description of the error pattern>"}
Example: {"pattern": "Confuses passé composé with imparfait for habitual past actions"}`,
        },
      ],
      { temperature: 0.2, maxTokens: 100 }
    );

    if (pattern.pattern) {
      await trackError(userId, correction.category as ErrorType, pattern.pattern);
    }
  }
}
