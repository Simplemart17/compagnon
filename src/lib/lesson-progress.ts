/**
 * Lesson progress persistence + resume pointer — Story 19-2 (lesson engine).
 *
 * Position model: there is NO separate "current lesson" row — the learner's
 * position is DERIVED from the completion set (first spine lesson not yet
 * completed). One fact, one table, no position/completion drift.
 *
 * Write policy: fire-and-forget with `captureError` (Story 12-3 precedent —
 * progress tracking must never block the learning flow). Completion is
 * idempotent via upsert on (user_id, lesson_id).
 */

import { CURRICULUM_LESSONS, entryLessonForLevel } from "@/src/lib/curriculum";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import type { CurriculumLesson } from "@/src/lib/schemas/curriculum";
import type { CEFRLevel } from "@/src/types/cefr";

/** Mark a lesson completed (idempotent — re-completing is a no-op). */
export async function markLessonCompleted(userId: string, lessonId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("lesson_progress")
      .upsert(
        { user_id: userId, lesson_id: lessonId },
        { onConflict: "user_id,lesson_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  } catch (err) {
    captureError(err, "lesson-progress-mark", { lessonId });
  }
}

/** All completed lesson ids for the user (unordered set). */
export async function getCompletedLessonIds(userId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("lesson_progress")
      .select("lesson_id")
      .eq("user_id", userId);
    if (error) throw error;
    return new Set((data ?? []).map((row: { lesson_id: string }) => row.lesson_id));
  } catch (err) {
    captureError(err, "lesson-progress-fetch");
    // Fail-soft: an empty set renders the spine as not-started rather than
    // blocking the lessons surface entirely.
    return new Set();
  }
}

/**
 * Map the learner's CURRENT CEFR level to their curriculum ENTRY lesson id
 * (Story 19-3: "placement maps to a curriculum position").
 *
 * Review R1 ratification: the input is `profiles.current_cefr_level`, which
 * placement SETS but Story 9-2 auto-promotion and the settings editor later
 * MOVE — so the entry deliberately follows the learner's current level, not
 * a frozen placement record. Once A2+ ships, a promoted learner's pointer
 * advances to their new level's content (earlier lessons stay tappable in
 * the list); this is intended pedagogy, re-evaluate at A2 authoring.
 *
 * Undefined level (profile still hydrating — 18-2 R1-P3 lesson: pass the
 * UNCOERCED value, never `?? "A1"`) → undefined → the pointer scans from
 * the spine start. With A1 + A2 + B1 shipped (19-1 slice 6), B2+ levels
 * fall DOWN to the B1 start — the mid-spine entry is a real production path.
 */
export function entryLessonIdForLevel(level: CEFRLevel | undefined): string | undefined {
  return level ? entryLessonForLevel(level)?.id : undefined;
}

/**
 * The learner's resume pointer: the FIRST spine lesson not in the
 * completion set, or undefined when all shipped content is done ("you're
 * ahead of the curriculum — free practice").
 *
 * Story 19-3: with an `entryLessonId` (from `entryLessonIdForLevel`), the
 * scan starts AT the entry lesson — the pointer never regresses below the
 * learner's CURRENT-LEVEL entry (see the ratification note above: the
 * entry follows `current_cefr_level`, not a frozen placement). A B1-level
 * learner who finishes everything at or above their entry point sees
 * "ahead of the curriculum", not a demotion to A1 basics; earlier lessons
 * stay tappable in the list for anyone who wants them. An unknown entry id
 * falls back to the spine start.
 *
 * Pure — callers pass the completion set so list screens can compute
 * positions without re-fetching.
 */
export function nextLessonForUser(
  completedIds: ReadonlySet<string>,
  entryLessonId?: string
): CurriculumLesson | undefined {
  const entryIdx = entryLessonId ? CURRICULUM_LESSONS.findIndex((l) => l.id === entryLessonId) : 0;
  const startIdx = entryIdx > 0 ? entryIdx : 0;
  for (let i = startIdx; i < CURRICULUM_LESSONS.length; i += 1) {
    if (!completedIds.has(CURRICULUM_LESSONS[i].id)) return CURRICULUM_LESSONS[i];
  }
  return undefined;
}
