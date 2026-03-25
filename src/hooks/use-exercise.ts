/**
 * Exercise Generation & Management Hook
 *
 * Handles AI-generated exercise creation, submission, and evaluation
 * for all four practice skills: listening, reading, writing, grammar.
 */

import { useCallback, useRef, useState } from "react";

import { invalidateCache, CACHE_KEYS } from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
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
import { buildWritingEvaluatorPrompt } from "@/src/lib/prompts/writing";
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
}

export interface UseExerciseReturn extends ExerciseState {
  generateExercise: (skill: TCFSkill, cefrLevel: CEFRLevel) => Promise<void>;
  answerQuestion: (questionIndex: number, answerId: string) => void;
  submitWriting: (text: string, cefrLevel: CEFRLevel) => Promise<void>;
  nextQuestion: () => void;
  previousQuestion: () => void;
  calculateScore: () => number;
  reset: () => void;
}

interface MCQQuestion {
  question: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  explanation: string;
}

interface ListeningResponse {
  passage: string;
  questions: MCQQuestion[];
  vocabularyHighlights?: string[];
}

interface ReadingResponse {
  passage: string;
  questions: MCQQuestion[];
  wordExplanations?: Record<string, string>;
}

interface GrammarResponse {
  questions: MCQQuestion[];
}

/**
 * Validate that an MCQ exercise response from the AI is well-formed.
 *
 * Checks:
 * - `questions` is a non-empty array
 * - Each question has an `options` array with exactly 4 items
 * - Exactly one option per question has `isCorrect: true`
 * - Each question has a non-empty `explanation`
 *
 * Throws a descriptive error if validation fails.
 */
function validateMCQExercise(
  questions: unknown,
  skill: string
): asserts questions is MCQQuestion[] {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(
      `Invalid ${skill} exercise: "questions" must be a non-empty array, got ${typeof questions}`
    );
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] as Record<string, unknown>;
    const label = `${skill} question ${i + 1}`;

    if (!Array.isArray(q.options)) {
      throw new Error(`Invalid ${label}: "options" must be an array`);
    }

    if (q.options.length !== 4) {
      throw new Error(`Invalid ${label}: expected exactly 4 options, got ${q.options.length}`);
    }

    const correctCount = (q.options as { isCorrect?: boolean }[]).filter(
      (o) => o.isCorrect === true
    ).length;

    if (correctCount !== 1) {
      throw new Error(`Invalid ${label}: expected exactly 1 correct option, found ${correctCount}`);
    }

    if (typeof q.explanation !== "string" || q.explanation.trim().length === 0) {
      throw new Error(`Invalid ${label}: "explanation" must be a non-empty string`);
    }
  }
}

export function useExercise(): UseExerciseReturn {
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
  });

  // Ref to avoid stale closures in callbacks that need current state
  const stateRef = useRef(state);
  stateRef.current = state;

  const generateExercise = useCallback(
    async (skill: TCFSkill, cefrLevel: CEFRLevel): Promise<void> => {
      setState((s) => ({
        ...s,
        isGenerating: true,
        exercise: null,
        answers: {},
        score: null,
        evaluation: null,
        error: null,
        currentQuestionIndex: 0,
      }));

      try {
        let exercise: GeneratedExercise;

        switch (skill) {
          case "listening": {
            const prompt = buildListeningExercisePrompt({ cefrLevel, dialect: "metropolitan" });
            const result = await chatCompletionJSON<ListeningResponse>(
              [{ role: "system", content: prompt }],
              { temperature: 0.4 }
            );

            validateMCQExercise(result.questions, "listening");

            // Generate TTS audio for the passage
            let audioBase64: string | undefined;
            try {
              const speed = cefrLevel === "A1" || cefrLevel === "A2" ? 0.85 : 1.0;
              audioBase64 = await generateSpeech(result.passage, {
                voice: "coral",
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
            const result = await chatCompletionJSON<ReadingResponse>(
              [{ role: "system", content: prompt }],
              { temperature: 0.4 }
            );

            validateMCQExercise(result.questions, "reading");

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
            const result = await chatCompletionJSON<GrammarResponse>(
              [{ role: "system", content: prompt }],
              { temperature: 0.4 }
            );

            validateMCQExercise(result.questions, "grammar");

            exercise = {
              skill: "grammar",
              questions: result.questions,
            };
            break;
          }

          case "writing": {
            // For writing, we generate a prompt rather than MCQs
            const cefrIdx = CEFR_ORDER.indexOf(cefrLevel);
            const taskNumber =
              cefrIdx <= CEFR_ORDER.indexOf("A2") ? 1 : cefrIdx <= CEFR_ORDER.indexOf("B2") ? 2 : 3;
            const minWords = taskNumber === 1 ? 50 : taskNumber === 2 ? 120 : 200;
            const maxWords = taskNumber === 1 ? 80 : taskNumber === 2 ? 150 : 300;

            const writingPrompt: WritingContent = {
              prompt: "", // Will be filled by AI
              taskNumber: taskNumber as 1 | 2 | 3,
              minWords,
              maxWords,
            };

            // Generate a writing prompt
            const result = await chatCompletionJSON<{ prompt: string; context: string }>(
              [
                {
                  role: "system",
                  content: `Generate a French writing exercise prompt for CEFR level ${cefrLevel}.
Task type: ${taskNumber === 1 ? "Short message (50-80 words)" : taskNumber === 2 ? "Article/letter (120-150 words)" : "Essay/synthesis (200+ words)"}
Return JSON: { "prompt": "the writing task in French", "context": "brief context in English for the student" }`,
                },
              ],
              { temperature: 0.4 }
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
        const message = err instanceof Error ? err.message : "Failed to generate exercise";
        setState((s) => ({ ...s, isGenerating: false, error: message }));
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

        // 1. Save exercise record
        const { error: exerciseError } = await supabase.from("exercises").insert({
          user_id: userId,
          skill,
          cefr_level: cefrLevel,
          exercise_type: skill === "writing" ? "free_write" : "mcq",
          content: current.exercise,
          user_answer: skill === "writing" ? null : current.answers,
          ai_evaluation: current.evaluation,
          score,
          completed: true,
          completed_at: new Date().toISOString(),
        });
        if (exerciseError) captureError(exerciseError, "persist-exercise-insert");

        // 2. Update skill progress with score (running average)
        await updateSkillProgress(userId, skill, score, 0);

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
      }
    },
    []
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

        const evaluation = await chatCompletionJSON<WritingEvaluation>(
          [
            { role: "system", content: prompt },
            {
              role: "user",
              content: `Task: ${state.exercise.writingPrompt.prompt}\n\nStudent's writing:\n${text}`,
            },
          ],
          { temperature: 0.3 }
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
        const message = err instanceof Error ? err.message : "Evaluation failed";
        setState((s) => ({ ...s, isEvaluating: false, error: message }));
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
  };
}
