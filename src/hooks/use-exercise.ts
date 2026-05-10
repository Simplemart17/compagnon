/**
 * Exercise Generation & Management Hook
 *
 * Handles AI-generated exercise creation, submission, and evaluation
 * for all four practice skills: listening, reading, writing, grammar.
 */

import { useCallback, useRef, useState } from "react";

import { invalidateCache, enqueueWrite, CACHE_KEYS } from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
import { classifyError } from "@/src/lib/error-messages";
import { useToast } from "@/src/hooks/use-toast";
import {
  updateStreak,
  updateSkillProgress,
  incrementDailyActivity,
  checkCefrPromotion,
} from "@/src/lib/activity";
import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { buildListeningExercisePrompt } from "@/src/lib/prompts/listening";
import { buildReadingExercisePrompt } from "@/src/lib/prompts/reading";
import { buildGrammarExercisePrompt } from "@/src/lib/prompts/grammar";
import { buildWritingEvaluatorPrompt, writingTaskWordRange } from "@/src/lib/prompts/writing";
import {
  listeningExerciseSchema,
  readingExerciseSchema,
  grammarExerciseSchema,
  writingPromptGenerationSchema,
  writingEvaluationSchema,
} from "@/src/lib/schemas/ai-responses";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";
import type { MCQContent, WritingContent, WritingEvaluation } from "@/src/types/exercise";

export interface GeneratedExercise {
  skill: TCFSkill;
  questions: MCQContent[];
  passage?: string;
  audioBase64?: string;
  writingPrompt?: WritingContent;
  wordExplanations?: Record<string, string>;
}

export interface ExerciseState {
  isGenerating: boolean;
  isEvaluating: boolean;
  exercise: GeneratedExercise | null;
  /** The CEFR level for which the current exercise was generated */
  cefrLevel: CEFRLevel | null;
  currentQuestionIndex: number;
  answers: Record<number, string>;
  score: number | null;
  evaluation: WritingEvaluation | null;
  error: string | null;
  /** True when exercise generation failed due to network — show offline fallback UI */
  offlineFallback: boolean;
}

export interface UseExerciseReturn extends ExerciseState {
  generateExercise: (skill: TCFSkill, cefrLevel: CEFRLevel) => Promise<void>;
  answerQuestion: (questionIndex: number, answerId: string) => void;
  submitWriting: (text: string, cefrLevel: CEFRLevel) => Promise<void>;
  nextQuestion: () => void;
  previousQuestion: () => void;
  calculateScore: () => number;
  reset: () => void;
  clearOfflineFallback: () => void;
}

// AI-response shapes are now derived from Zod schemas in
// `src/lib/schemas/ai-responses.ts`. The hand-rolled `validateMCQExercise`
// function (lines 99-133 prior to story 9-7) was deleted — its rules
// (4 options, 1 correct, non-empty explanation) are enforced declaratively
// by `mcqQuestionSchema.superRefine`. Story 9-7.

export function useExercise(): UseExerciseReturn {
  const { showToast } = useToast();

  const [state, setState] = useState<ExerciseState>({
    isGenerating: false,
    isEvaluating: false,
    exercise: null,
    cefrLevel: null,
    currentQuestionIndex: 0,
    answers: {},
    score: null,
    evaluation: null,
    error: null,
    offlineFallback: false,
  });

  // Ref to avoid stale closures in callbacks that need current state
  const stateRef = useRef(state);
  stateRef.current = state;

  const generateExercise = useCallback(
    async (skill: TCFSkill, cefrLevel: CEFRLevel): Promise<void> => {
      if (stateRef.current.isGenerating) return;

      setState((s) => ({
        ...s,
        isGenerating: true,
        exercise: null,
        answers: {},
        score: null,
        evaluation: null,
        error: null,
        offlineFallback: false,
        currentQuestionIndex: 0,
      }));

      try {
        let exercise: GeneratedExercise;

        switch (skill) {
          case "listening": {
            const prompt = buildListeningExercisePrompt({ cefrLevel, dialect: "metropolitan" });
            const result = await chatCompletionJSON(
              [{ role: "system", content: prompt }],
              listeningExerciseSchema,
              { temperature: 0.4, feature: "exercise-listening" }
            );

            // Generate TTS audio for the passage
            let audioBase64: string | undefined;
            try {
              const speed = cefrLevel === "A1" || cefrLevel === "A2" ? 0.85 : 1.0;
              audioBase64 = await generateSpeech(result.passage, {
                speed,
              });
            } catch {
              // TTS generation failed, continue without audio
            }

            exercise = {
              skill: "listening",
              questions: result.questions.map((q) => ({
                ...q,
                passage: result.passage,
              })),
              passage: result.passage,
              audioBase64,
            };
            break;
          }

          case "reading": {
            const prompt = buildReadingExercisePrompt({ cefrLevel });
            const result = await chatCompletionJSON(
              [{ role: "system", content: prompt }],
              readingExerciseSchema,
              { temperature: 0.4, feature: "exercise-reading" }
            );

            exercise = {
              skill: "reading",
              questions: result.questions.map((q) => ({
                ...q,
                passage: result.passage,
              })),
              passage: result.passage,
              wordExplanations: result.wordExplanations,
            };
            break;
          }

          case "grammar": {
            const prompt = buildGrammarExercisePrompt({ cefrLevel });
            const result = await chatCompletionJSON(
              [{ role: "system", content: prompt }],
              grammarExerciseSchema,
              { temperature: 0.4, feature: "exercise-grammar" }
            );

            exercise = {
              skill: "grammar",
              questions: result.questions,
            };
            break;
          }

          case "writing": {
            // For writing, we generate a prompt rather than MCQs
            const cefrIdx = CEFR_ORDER.indexOf(cefrLevel);
            const taskNumber: 1 | 2 | 3 =
              cefrIdx <= CEFR_ORDER.indexOf("A2") ? 1 : cefrIdx <= CEFR_ORDER.indexOf("B2") ? 2 : 3;
            // Per docs/tcf-spec-source.md §5.1 (publisher-verbatim) — single
            // source of truth lives in src/lib/prompts/writing.ts so this hook
            // and the writing.ts TASK_EXPECTATIONS block cannot drift.
            const { min: minWords, max: maxWords } = writingTaskWordRange(taskNumber);

            const writingPrompt: WritingContent = {
              prompt: "", // Will be filled by AI
              taskNumber,
              minWords,
              maxWords,
            };

            // Generate a writing prompt
            const taskTypeDescription =
              taskNumber === 1
                ? `Short message (${minWords}-${maxWords} words)`
                : taskNumber === 2
                  ? `Article/letter (${minWords}-${maxWords} words)`
                  : `Essay/synthesis (${minWords}-${maxWords} words)`;
            const result = await chatCompletionJSON(
              [
                {
                  role: "system",
                  content: `Generate a French writing exercise prompt for CEFR level ${cefrLevel}.
Task type: ${taskTypeDescription}
Return JSON: { "prompt": "the writing task in French", "context": "brief context in English for the student" }`,
                },
              ],
              writingPromptGenerationSchema,
              { temperature: 0.4, feature: "exercise-writing-prompt" }
            );

            writingPrompt.prompt = result.prompt;
            writingPrompt.context = result.context;

            exercise = {
              skill: "writing",
              questions: [],
              writingPrompt,
            };
            break;
          }

          default:
            throw new Error(`Unsupported skill: ${skill}`);
        }

        setState((s) => ({ ...s, isGenerating: false, exercise, cefrLevel }));
      } catch (err) {
        captureError(err, "exercise-generation");
        const classified = classifyError(
          err,
          "Something went wrong generating your exercise. Please try again."
        );
        if (classified.category === "network") {
          setState((s) => ({ ...s, isGenerating: false, offlineFallback: true, error: null }));
        } else {
          setState((s) => ({ ...s, isGenerating: false, error: classified.message }));
        }
      }
    },
    []
  );

  const answerQuestion = useCallback((questionIndex: number, answerId: string): void => {
    setState((s) => ({
      ...s,
      answers: { ...s.answers, [questionIndex]: answerId },
    }));
  }, []);

  /** Persist exercise to Supabase with full error handling */
  const persistExercise = useCallback(
    async (skill: TCFSkill, cefrLevel: CEFRLevel, score: number) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      try {
        const current = stateRef.current;
        // Use a stable completed_at so offline queue replay is deterministic
        const completedAt = new Date().toISOString();
        const exerciseData = {
          user_id: userId,
          skill,
          cefr_level: cefrLevel,
          exercise_type: skill === "writing" ? "free_write" : "mcq",
          content: current.exercise,
          user_answer: skill === "writing" ? null : current.answers,
          ai_evaluation: current.evaluation,
          score,
          completed: true,
          completed_at: completedAt,
        };

        // 1. Save exercise record
        const { error: exerciseError } = await supabase.from("exercises").insert(exerciseData);
        if (exerciseError) {
          // Check if this is a network error — queue for offline sync
          const classified = classifyError(exerciseError, "");
          if (classified.category === "network") {
            await enqueueWrite({
              table: "exercises",
              operation: "insert",
              payload: exerciseData as unknown as Record<string, unknown>,
            });
            showToast({
              type: "warning",
              message:
                "Exercise queued offline — will sync when you're back online. Progress stats will update on your next session.",
            });
            // Side-effects (streak, skill, activity) can't run offline.
            // They are self-correcting on next online session.
            return;
          }
          captureError(exerciseError, "persist-exercise-insert");
        }

        // 2. Update skill progress with score (running average)
        await updateSkillProgress(userId, skill, cefrLevel, score, 0);

        // 3. Increment daily activity counters
        await incrementDailyActivity(userId, { exercises: 1, minutes: 5 });

        // 4. Update streak
        await updateStreak(userId);

        // 5. Check for CEFR level promotion
        await checkCefrPromotion(userId);

        // 6. Invalidate progress caches so next load picks up fresh data
        await Promise.all([
          invalidateCache(userId, CACHE_KEYS.SKILLS),
          invalidateCache(userId, CACHE_KEYS.DAILY_ACTIVITY_TODAY),
          invalidateCache(userId, CACHE_KEYS.RECENT_ACTIVITY),
          invalidateCache(userId, CACHE_KEYS.STREAK),
          invalidateCache(userId, CACHE_KEYS.PROFILE),
        ]);
      } catch (err) {
        captureError(err, "persist-exercise");
        const classified = classifyError(err, "");
        if (classified.category === "network") {
          // Exercise row may already be inserted; side-effects (streak/skill/activity) failed.
          // These are self-correcting on next online session — don't claim data was queued.
          showToast({
            type: "warning",
            message:
              "Exercise saved, but progress stats couldn't update offline. They'll catch up next time.",
          });
        } else {
          setState((s) => ({
            ...s,
            error: "Your progress could not be saved. Please check your connection.",
          }));
        }
      }
    },
    [showToast]
  );

  const submitWriting = useCallback(
    async (text: string, cefrLevel: CEFRLevel): Promise<void> => {
      if (!state.exercise?.writingPrompt) return;

      setState((s) => ({ ...s, isEvaluating: true, error: null }));

      try {
        const prompt = buildWritingEvaluatorPrompt({
          cefrLevel,
          taskNumber: state.exercise.writingPrompt.taskNumber,
          prompt: state.exercise.writingPrompt.prompt,
        });

        const evaluation = await chatCompletionJSON(
          [
            { role: "system", content: prompt },
            {
              role: "user",
              content: `Task: ${state.exercise.writingPrompt.prompt}\n\nStudent's writing:\n${text}`,
            },
          ],
          writingEvaluationSchema,
          { temperature: 0.3, feature: "writing-evaluation" }
        );

        setState((s) => ({
          ...s,
          isEvaluating: false,
          evaluation,
          score: evaluation.overallScore,
        }));

        persistExercise("writing", cefrLevel, evaluation.overallScore).catch((err) =>
          captureError(err, "persist-writing-exercise")
        );
      } catch (err) {
        captureError(err, "writing-evaluation");
        const classified = classifyError(
          err,
          "Something went wrong evaluating your writing. Please try submitting again."
        );
        // For writing evaluation, don't show offlineFallback — the user has already written
        // their essay. Show an error with retry instead of hiding their work.
        setState((s) => ({ ...s, isEvaluating: false, error: classified.message }));
      }
    },
    [state.exercise, persistExercise]
  );

  const nextQuestion = useCallback((): void => {
    setState((s) => ({
      ...s,
      currentQuestionIndex: Math.min(
        s.currentQuestionIndex + 1,
        (s.exercise?.questions.length ?? 1) - 1
      ),
    }));
  }, []);

  const previousQuestion = useCallback((): void => {
    setState((s) => ({
      ...s,
      currentQuestionIndex: Math.max(s.currentQuestionIndex - 1, 0),
    }));
  }, []);

  const calculateScore = useCallback((): number => {
    const current = stateRef.current;
    if (!current.exercise?.questions.length) return 0;

    let correct = 0;
    for (let i = 0; i < current.exercise.questions.length; i++) {
      const answer = current.answers[i];
      const question = current.exercise.questions[i];
      const correctOption = question.options.find((o) => o.isCorrect);
      if (answer === correctOption?.id) correct++;
    }

    const score = Math.round((correct / current.exercise.questions.length) * 100);
    setState((s) => ({ ...s, score }));

    if (current.exercise && current.cefrLevel) {
      persistExercise(current.exercise.skill as TCFSkill, current.cefrLevel, score).catch((err) =>
        captureError(err, "persist-mcq-exercise")
      );
    }

    return score;
  }, [persistExercise]);

  const clearOfflineFallback = useCallback((): void => {
    // Reset to idle state so the user can start fresh or navigate away
    setState({
      isGenerating: false,
      isEvaluating: false,
      exercise: null,
      cefrLevel: null,
      currentQuestionIndex: 0,
      answers: {},
      score: null,
      evaluation: null,
      error: null,
      offlineFallback: false,
    });
  }, []);

  const reset = useCallback((): void => {
    setState({
      isGenerating: false,
      isEvaluating: false,
      exercise: null,
      cefrLevel: null,
      currentQuestionIndex: 0,
      answers: {},
      score: null,
      evaluation: null,
      error: null,
      offlineFallback: false,
    });
  }, []);

  return {
    ...state,
    generateExercise,
    answerQuestion,
    submitWriting,
    nextQuestion,
    previousQuestion,
    calculateScore,
    reset,
    clearOfflineFallback,
  };
}
