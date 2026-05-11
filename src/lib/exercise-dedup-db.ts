/**
 * Story 10-8 — Supabase I/O layer for exercise question-stem dedup.
 *
 * Reads the user's last N completed exercises matching the given
 * (skill, cefr_level) tuple and returns the union of their
 * `question_stem_hashes` array columns as a `Set<string>`.
 *
 * Resilience contract (Story 9-10 auth-cache pattern): on Supabase
 * error or thrown exception, log via `captureError(_, "exercise-dedup-fetch")`
 * and return an empty set so generation proceeds unfiltered —
 * never block the user on a dedup query failure.
 */

import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";
import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";

/** Default look-back window — the last N completed exercises matching (skill, cefr_level). */
export const DEFAULT_SEEN_LIMIT = 100;

interface ExerciseHashRow {
  question_stem_hashes: string[] | null;
}

/**
 * Fetch the question-stem hashes the user has seen across their
 * last N completed exercises at the given (skill, cefr_level).
 *
 * Returns an empty set on Supabase error so generation proceeds
 * unfiltered. Sentry breadcrumb fires via `captureError(_, "exercise-dedup-fetch")`.
 *
 * Pre-Story-10-8 rows with NULL `question_stem_hashes` silently
 * contribute nothing to the seen set (forward-only growth pattern,
 * Story 10-6 precedent).
 */
export async function getSeenHashes(
  userId: string,
  skill: TCFSkill,
  cefrLevel: CEFRLevel,
  opts: { limit?: number } = {}
): Promise<Set<string>> {
  const limit = opts.limit ?? DEFAULT_SEEN_LIMIT;
  // Review-patch P2 (ECH1+ECH2): explicitly scope to MCQ + writing
  // exercise types so future echo / translation / dictation flows
  // (which insert into the same `exercises` table with NULL hashes
  // today) cannot silently contaminate the dedup seen-set if they
  // ever start populating `question_stem_hashes`. Makes the
  // dedup contract self-documenting in the query itself.
  const exerciseType = skill === "writing" ? "free_write" : "mcq";
  try {
    const { data, error } = await supabase
      .from("exercises")
      .select("question_stem_hashes")
      .eq("user_id", userId)
      .eq("skill", skill)
      .eq("cefr_level", cefrLevel)
      .eq("exercise_type", exerciseType)
      .eq("completed", true)
      .order("completed_at", { ascending: false })
      .limit(limit);
    if (error) {
      captureError(error, "exercise-dedup-fetch", { skill, cefrLevel });
      return new Set();
    }
    const seen = new Set<string>();
    for (const row of (data ?? []) as ExerciseHashRow[]) {
      const hashes = row.question_stem_hashes;
      if (Array.isArray(hashes)) {
        for (const h of hashes) seen.add(h);
      }
    }
    return seen;
  } catch (err) {
    captureError(err, "exercise-dedup-fetch", { skill, cefrLevel });
    return new Set();
  }
}
