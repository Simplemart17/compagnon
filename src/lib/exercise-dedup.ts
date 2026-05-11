/**
 * Story 10-8 — pure-helper module for exercise question-stem dedup.
 *
 * All functions are pure (no I/O, no Date / Math.random, no Supabase
 * calls). The Supabase query layer lives in `exercise-dedup-db.ts`;
 * the wiring lives in `src/hooks/use-exercise.ts` `generateExercise`.
 *
 * Source of truth for the djb2 hash is `src/lib/text-hash.ts` (Story
 * 10-8 extracted it from `src/lib/realtime-transcript.ts` so the
 * voice-transcript and exercise-dedup paths share one implementation).
 */

import { hashText } from "@/src/lib/text-hash";
import type { TCFSkill } from "@/src/types/cefr";

/**
 * Per-skill minimum fresh-question count after dedup filtering.
 *
 * Listening / reading / grammar request 5 MCQ questions per
 * generation; accepting >= 4 fresh after dedup keeps the UX
 * consistent with the pre-10-8 question count and only triggers
 * the retry when the user has seen 2+ of the 5 generated stems.
 *
 * Review-patch P8 (Blind Hunter BH12 + Edge Case Hunter ECH7):
 * `writing` and `speaking` are NOT in this map — writing dedup is
 * a single-prompt "regenerate-once-on-any-duplicate" contract
 * (`runWritingDedupPipeline` does not take a `minFresh` parameter)
 * and speaking has its own per-bucket dedup contract (Story 9-8
 * `computeTopicBucket`, not this module). Including dead values
 * here was misleading — a maintainer reading `MIN_FRESH_QUESTIONS_PER_SKILL.writing
 * = 1` could reasonably assume changing it to 2 would alter
 * behavior, but the writing pipeline ignores the constant.
 */
export const MIN_FRESH_QUESTIONS_PER_SKILL: Record<"listening" | "reading" | "grammar", number> = {
  listening: 4,
  reading: 4,
  grammar: 4,
};

/**
 * Narrow structural shape of a generated exercise for hash extraction.
 *
 * Inlined here (rather than imported from `src/hooks/use-exercise.ts`
 * `GeneratedExercise`) to avoid a circular import — `use-exercise.ts`
 * imports from this module via `extractExerciseHashes`.
 */
export interface ExerciseHashSource {
  skill: TCFSkill;
  questions?: { question?: string | null }[];
  writingPrompt?: { prompt?: string | null };
}

// Zero-width / invisible format characters: ZWSP (U+200B), ZWNJ
// (U+200C), ZWJ (U+200D), ZWNBSP / BOM (U+FEFF), word-joiner
// (U+2060). These can sneak into AI output from upstream tokenizer
// artifacts and would otherwise produce hash false-negatives (two
// visually-identical stems → different hashes).
const ZERO_WIDTH_CHARS = /[​-‍﻿⁠]/gu;

/**
 * Normalize a question stem for hash-based dedup.
 *
 * (a) NFC-normalize so visually-identical strings with different
 *     code-point compositions hash to the same value (Story 9-4
 *     `sanitizeMemoryContent` precedent).
 * (b) Strip zero-width / invisible format characters (review-patch
 *     P15 / ECH8) before lowercase so two visually-identical stems
 *     differing only by an invisible tokenizer artifact hash to the
 *     same value.
 * (c) lowercase via `toLocaleLowerCase("fr")` so French diacritics
 *     fold predictably (avoids Turkish-locale dotted-i drift if a
 *     future device runs with a non-French locale).
 * (d) trim leading / trailing whitespace.
 * (e) collapse all interior whitespace (NBSP, tab, newline, multiple
 *     spaces) to a single ASCII space.
 *
 * Idempotent: `normalize(normalize(x)) === normalize(x)`.
 */
export function normalizeQuestionStem(text: string): string {
  return text
    .normalize("NFC")
    .replace(ZERO_WIDTH_CHARS, "")
    .toLocaleLowerCase("fr")
    .trim()
    .replace(/\s+/gu, " ");
}

/** djb2 hash over the normalized stem. Short opaque base-36 string. */
export function hashQuestionStem(text: string): string {
  return hashText(normalizeQuestionStem(text));
}

/**
 * Extract question-stem hashes from a generated exercise across all
 * 4 skill shapes (listening / reading / grammar MCQ + writing single
 * prompt). Returns an empty array for unknown skills or for exercises
 * missing the expected shape (defensive — never throws).
 */
export function extractExerciseHashes(exercise: ExerciseHashSource): string[] {
  if (exercise.skill === "writing") {
    const promptText = exercise.writingPrompt?.prompt ?? "";
    return promptText ? [hashQuestionStem(promptText)] : [];
  }
  // listening / reading / grammar share the same MCQ question[] shape
  const questions = exercise.questions ?? [];
  return questions
    .map((q) => q.question ?? "")
    .filter((s) => s.length > 0)
    .map(hashQuestionStem);
}

/**
 * Filter MCQ questions, dropping any whose normalized stem hash
 * appears in the seen set. Operates on the schema-conformant
 * question array AFTER Zod validation (Story 9-7); never sees
 * partial / malformed data.
 *
 * If `seen` is empty (first-time user or empty look-back window),
 * the input array is returned unchanged — no work done.
 */
export function filterUnseenQuestions<T extends { question: string }>(
  generated: T[],
  seen: ReadonlySet<string>
): T[] {
  if (seen.size === 0) return generated;
  return generated.filter((q) => !seen.has(hashQuestionStem(q.question)));
}

/**
 * Test a single writing prompt for repetition. Returns true if the
 * prompt's normalized hash is in the seen set (and should trigger
 * a regenerate).
 *
 * Returns false for empty / whitespace-only prompts (defensive —
 * the AI should not have produced an empty prompt, but if it did,
 * we don't want to retry needlessly).
 */
export function isWritingPromptSeen(prompt: string, seen: ReadonlySet<string>): boolean {
  if (seen.size === 0 || prompt.trim().length === 0) return false;
  return seen.has(hashQuestionStem(prompt));
}

/**
 * Result of running the MCQ dedup pipeline (Story 10-8).
 *
 * `result` is the AI's generation output (initial or retry, whichever
 * had more fresh questions); `filtered` is the question array after
 * seen-set filtering; `exhausted` is true when dedup ran out of fresh
 * questions and accepted duplicates as a fallback.
 */
export interface DedupPipelineOutput<R extends { questions: { question: string }[] }> {
  result: R;
  filtered: R["questions"];
  retries: number;
  exhausted: boolean;
}

/**
 * Run the MCQ dedup pipeline: generate → filter → (if too few fresh,
 * retry with higher temperature) → filter again → return the best
 * filtered set. On retry-exhausted, returns the unfiltered original
 * result with `exhausted: true` so the caller can fire the Sentry
 * breadcrumb.
 *
 * Pure orchestration — accepts a generation function so it can be
 * tested without mocking the OpenAI client or React state.
 */
export async function runMcqDedupPipeline<R extends { questions: { question: string }[] }>(
  generateFn: (params: { temperature: number; isRetry: boolean }) => Promise<R>,
  seenHashes: ReadonlySet<string>,
  minFreshQuestions: number
): Promise<DedupPipelineOutput<R>> {
  let result = await generateFn({ temperature: 0.4, isRetry: false });
  let filtered = filterUnseenQuestions(result.questions, seenHashes);
  let retries = 0;
  if (filtered.length < minFreshQuestions && seenHashes.size > 0) {
    retries = 1;
    const retryResult = await generateFn({ temperature: 0.6, isRetry: true });
    const retryFiltered = filterUnseenQuestions(retryResult.questions, seenHashes);
    if (retryFiltered.length > filtered.length) {
      filtered = retryFiltered;
      result = retryResult;
    }
  }
  const exhausted = filtered.length < minFreshQuestions && seenHashes.size > 0;
  if (exhausted) {
    filtered = result.questions; // fall back to unfiltered
  }
  return { result, filtered, retries, exhausted };
}

/**
 * Run the writing-prompt dedup pipeline: generate → if seen, regenerate
 * once → return the chosen result. On retry-exhausted, returns the
 * second (still-duplicate) result with `exhausted: true`.
 */
export interface WritingDedupPipelineOutput<R extends { prompt: string }> {
  result: R;
  retries: number;
  exhausted: boolean;
}

export async function runWritingDedupPipeline<R extends { prompt: string }>(
  generateFn: (params: { temperature: number; isRetry: boolean }) => Promise<R>,
  seenHashes: ReadonlySet<string>
): Promise<WritingDedupPipelineOutput<R>> {
  let result = await generateFn({ temperature: 0.4, isRetry: false });
  let retries = 0;
  let exhausted = false;
  if (isWritingPromptSeen(result.prompt, seenHashes)) {
    retries = 1;
    const retryResult = await generateFn({ temperature: 0.6, isRetry: true });
    if (!isWritingPromptSeen(retryResult.prompt, seenHashes)) {
      result = retryResult;
    } else {
      exhausted = true;
      result = retryResult; // accept the retry's dup (newer)
    }
  }
  return { result, retries, exhausted };
}
