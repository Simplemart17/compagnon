/**
 * Lesson quick-drill state machine — Story 19-2 (drill slice).
 *
 * teach → DRILL → apply: a 3-question MCQ round scoped to one lesson,
 * generated on demand. Deliberately practice-only in v1: no `exercises`
 * row, no `skill_progress` write — the lesson's conversation step owns the
 * activity/progress pipeline, and double-counting the same lesson via two
 * channels would skew the promotion engine's evidence (Story 9-2).
 * Analytics: one `exercise_completed` event on finish (skill "grammar",
 * banded score) — consistent with the practice screens.
 */

import { useCallback, useRef, useState } from "react";

import { ANALYTICS_EVENTS, scoreBand, trackEvent } from "@/src/lib/analytics";
import { chatCompletionJSON } from "@/src/lib/openai";
import { buildLessonDrillPrompt } from "@/src/lib/prompts/lesson-drill";
import { lessonDrillSchema } from "@/src/lib/schemas/ai-responses";
import type { CurriculumLesson } from "@/src/lib/schemas/curriculum";
import { captureError } from "@/src/lib/sentry";
import type { MCQContent } from "@/src/types/exercise";

/** Right-sized for 3 MCQs (~120 tokens each + envelope). Story 11-5
 * discipline: every chatCompletionJSON call site sets an explicit
 * maxTokens; the maxtokens-audit drift test pins this value. */
export const LESSON_DRILL_MAX_TOKENS = 900;

export type LessonDrillState =
  | { kind: "idle" }
  | { kind: "generating" }
  | {
      kind: "active";
      questions: MCQContent[];
      index: number;
      selected: string | null;
      showResult: boolean;
      correctCount: number;
    }
  | { kind: "done"; correctCount: number; total: number }
  | { kind: "error"; message: string };

export interface UseLessonDrillReturn {
  state: LessonDrillState;
  generate: () => Promise<void>;
  select: (answerId: string) => void;
  next: () => void;
  reset: () => void;
}

export function useLessonDrill(lesson: CurriculumLesson | undefined): UseLessonDrillReturn {
  const [state, setState] = useState<LessonDrillState>({ kind: "idle" });
  // Synchronous double-tap guard (Story 9-10 / 12-9 ref pattern).
  const generatingRef = useRef(false);

  const generate = useCallback(async () => {
    if (!lesson || generatingRef.current) return;
    generatingRef.current = true;
    setState({ kind: "generating" });
    try {
      const result = await chatCompletionJSON(
        [{ role: "system", content: buildLessonDrillPrompt(lesson) }],
        lessonDrillSchema,
        { temperature: 0.4, maxTokens: LESSON_DRILL_MAX_TOKENS, feature: "lesson-drill" }
      );
      setState({
        kind: "active",
        questions: result.questions,
        index: 0,
        selected: null,
        showResult: false,
        correctCount: 0,
      });
    } catch (err) {
      captureError(err, "lesson-drill-generate", { lessonId: lesson.id });
      setState({ kind: "error", message: "Could not load the drill. Please try again." });
    } finally {
      generatingRef.current = false;
    }
  }, [lesson]);

  const select = useCallback((answerId: string) => {
    setState((prev) => {
      if (prev.kind !== "active" || prev.showResult) return prev;
      const question = prev.questions[prev.index];
      const correct = question.options.find((o) => o.isCorrect)?.id === answerId;
      return {
        ...prev,
        selected: answerId,
        showResult: true,
        correctCount: prev.correctCount + (correct ? 1 : 0),
      };
    });
  }, []);

  const next = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== "active" || !prev.showResult) return prev;
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.questions.length) {
        const total = prev.questions.length;
        trackEvent(ANALYTICS_EVENTS.EXERCISE_COMPLETED, {
          skill: "grammar",
          cefr_level: "A1",
          score_band: scoreBand(Math.round((prev.correctCount / total) * 100)),
        });
        return { kind: "done", correctCount: prev.correctCount, total };
      }
      return { ...prev, index: nextIndex, selected: null, showResult: false };
    });
  }, []);

  const reset = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  return { state, generate, select, next, reset };
}
