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

import { CURRICULUM_LESSONS } from "@/src/lib/curriculum";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import type { CurriculumLesson } from "@/src/lib/schemas/curriculum";

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
 * The learner's resume pointer: the FIRST spine lesson not in the
 * completion set, or undefined when all shipped content is done ("you're
 * ahead of the curriculum — free practice").
 *
 * Pure — callers pass the completion set so list screens can compute
 * positions without re-fetching.
 */
export function nextLessonForUser(completedIds: ReadonlySet<string>): CurriculumLesson | undefined {
  return CURRICULUM_LESSONS.find((lesson) => !completedIds.has(lesson.id));
}
