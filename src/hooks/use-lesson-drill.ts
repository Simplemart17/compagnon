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

import { useCallback, useEffect, useRef, useState } from "react";

import { ANALYTICS_EVENTS, scoreBand, trackEvent } from "@/src/lib/analytics";
import { getUnitForLesson } from "@/src/lib/curriculum";
import { getItemBank, selectDrillItems } from "@/src/lib/item-bank";
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

/** Questions per drill round — matches `lessonDrillSchema.length(3)`. */
export const DRILL_ITEM_COUNT = 3;

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
  // Review R1: unmount guard (12-9/13-3/13-4 convention) — the awaited AI
  // response must not setState against a dead screen.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );
  // Review R1: one analytics emission per drill ROUND (reset by generate).
  const completionTrackedRef = useRef(false);
  // Story 19-4: rotates curated-bank items across rounds so each "New round"
  // shows fresh questions before the bank cycles. Session-scoped (a fresh
  // mount restarts at 0).
  const drillRoundRef = useRef(0);
  // Review R1: reset the rotation when the lesson changes so a hook instance
  // reused across lessons (a future same-route swap) opens the new lesson at
  // round 0, not mid-rotation. (The player mounts fresh per lesson today, so
  // this is defensive.)
  useEffect(() => {
    drillRoundRef.current = 0;
  }, [lesson?.id]);

  // Review R1: the lesson's CEFR level comes from its UNIT — hardcoding
  // "A1" would mislabel every post-A1 drill (prompt difficulty AND the
  // analytics funnel; the 21-2 R2 banding-bug class).
  const level = lesson ? (getUnitForLesson(lesson.id)?.level ?? "A1") : "A1";

  const generate = useCallback(async () => {
    if (!lesson || generatingRef.current) return;
    generatingRef.current = true;
    completionTrackedRef.current = false;

    // Story 19-4: prefer the curated bank — serve pre-authored, reviewed
    // items INSTANTLY (no AI call, no "generating" flash, zero cost/
    // repetition). Rotate across rounds so "New round" is fresh. Only
    // lessons without a bank fall through to live AI generation below.
    const bank = getItemBank(lesson.id);
    if (bank) {
      const items = selectDrillItems(bank.items, DRILL_ITEM_COUNT, drillRoundRef.current);
      drillRoundRef.current += 1;
      generatingRef.current = false;
      setState({
        kind: "active",
        questions: items,
        index: 0,
        selected: null,
        showResult: false,
        correctCount: 0,
      });
      return;
    }

    setState({ kind: "generating" });
    try {
      const earlierVocabFr = getUnitForLesson(lesson.id)
        ?.lessons.filter((l) => l.order < lesson.order)
        .flatMap((l) => l.vocab.map((v) => v.fr));
      const result = await chatCompletionJSON(
        [
          {
            role: "system",
            content: buildLessonDrillPrompt(lesson, level, earlierVocabFr ?? []),
          },
        ],
        lessonDrillSchema,
        { temperature: 0.4, maxTokens: LESSON_DRILL_MAX_TOKENS, feature: "lesson-drill" }
      );
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
      setState({ kind: "error", message: "Could not load the drill. Please try again." });
    } finally {
      generatingRef.current = false;
    }
  }, [lesson, level]);

  // Review R1: the completion analytics live in an EFFECT, not inside the
  // setState updater — updaters must be pure (StrictMode double-invokes
  // them and concurrent React replays queued updaters; the exact
  // Story 13-4 R1-P15 anti-pattern). The per-round ref guarantees one
  // emission even across re-renders of the done state.
  useEffect(() => {
    if (state.kind === "done" && !completionTrackedRef.current) {
      completionTrackedRef.current = true;
      trackEvent(ANALYTICS_EVENTS.EXERCISE_COMPLETED, {
        skill: "grammar",
        cefr_level: level,
        score_band: scoreBand(Math.round((state.correctCount / state.total) * 100)),
      });
    }
  }, [state, level]);

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
        // Pure transition only — the completion analytics fire from the
        // effect above (review R1: no side effects inside updaters).
        return { kind: "done", correctCount: prev.correctCount, total: prev.questions.length };
      }
      return { ...prev, index: nextIndex, selected: null, showResult: false };
    });
  }, []);

  const reset = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  return { state, generate, select, next, reset };
}
