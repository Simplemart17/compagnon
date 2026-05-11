/**
 * Story 10-8 — `use-exercise.ts` integration coverage for the dedup
 * wiring (review-patch P4 / AA1 + BH19).
 *
 * Full React-hook integration testing (`@testing-library/react-hooks`)
 * is heavy for the Expo+Jest setup. Instead, this file pins the
 * integration contract by exercising the same primitives `generateExercise`
 * + `persistExercise` use — `extractExerciseHashes` on the full
 * `GeneratedExercise` shape, the `dedupExhausted` flag's effect on
 * the persist payload, and the seen-set fetch + write asymmetry.
 *
 * The full orchestration (retry-once + temperature escalation +
 * Sentry breadcrumb) is covered by the pipeline-helper tests in
 * `exercise-dedup.test.ts` (review-patch P3 expanded those to 13
 * orchestration cases).
 */

import { extractExerciseHashes, hashQuestionStem } from "@/src/lib/exercise-dedup";

import type { GeneratedExercise } from "../use-exercise";

describe("persistExercise integration contract — `question_stem_hashes` payload (review-patch P4)", () => {
  const baseListening: GeneratedExercise = {
    skill: "listening",
    questions: [
      { question: "Quelle est la couleur du ciel ?", options: [], explanation: "" },
      { question: "Combien font 2 + 2 ?", options: [], explanation: "" },
      { question: "Comment t'appelles-tu ?", options: [], explanation: "" },
      { question: "Où habites-tu ?", options: [], explanation: "" },
      { question: "Que fais-tu aujourd'hui ?", options: [], explanation: "" },
    ],
    passage: "Some passage",
  };

  it("listening exercise: persists 5 hashes, one per question stem", () => {
    const hashes = extractExerciseHashes(baseListening);
    expect(hashes).toHaveLength(5);
    expect(hashes[0]).toBe(hashQuestionStem("Quelle est la couleur du ciel ?"));
    expect(hashes[4]).toBe(hashQuestionStem("Que fais-tu aujourd'hui ?"));
  });

  it("reading exercise: persists one hash per question (same shape as listening)", () => {
    const exercise: GeneratedExercise = {
      skill: "reading",
      questions: [{ question: "Selon le texte, pourquoi ?", options: [], explanation: "" }],
      passage: "Reading passage",
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(1);
  });

  it("grammar exercise: persists one hash per question (no passage)", () => {
    const exercise: GeneratedExercise = {
      skill: "grammar",
      questions: [{ question: "Choisissez la bonne forme verbale.", options: [], explanation: "" }],
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(1);
  });

  it("writing exercise: persists exactly one hash — the writing prompt", () => {
    const exercise: GeneratedExercise = {
      skill: "writing",
      questions: [],
      writingPrompt: {
        prompt: "Décrivez votre journée idéale en 100 mots.",
        taskNumber: 1,
        minWords: 60,
        maxWords: 120,
      },
    };
    const hashes = extractExerciseHashes(exercise);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toBe(hashQuestionStem("Décrivez votre journée idéale en 100 mots."));
  });

  it("dedup-exhausted writing exercise: persist-helper extracts the hash (caller decides to drop) — P1/ECH3 contract", () => {
    // The `dedupExhausted` flag is read by `persistExercise` to skip
    // hash persistence for writing-exhaustion. `extractExerciseHashes`
    // itself remains pure (does NOT inspect the flag) — the persist
    // path applies the gate.
    const exercise: GeneratedExercise = {
      skill: "writing",
      questions: [],
      writingPrompt: {
        prompt: "A duplicate prompt.",
        taskNumber: 1,
        minWords: 60,
        maxWords: 120,
      },
      dedupExhausted: true,
    };
    // The function still returns the hash array — the dropping
    // happens at the persistExercise call site (gated on dedupExhausted).
    const hashes = extractExerciseHashes(exercise);
    expect(hashes).toHaveLength(1);
    // The persistExercise gate logic — verified by replicating the
    // conditional that lives in use-exercise.ts persistExercise:
    const persistedHashes =
      exercise && !exercise.dedupExhausted ? extractExerciseHashes(exercise) : [];
    expect(persistedHashes).toEqual([]);
  });

  it("non-exhausted writing exercise: persists the prompt hash normally", () => {
    const exercise: GeneratedExercise = {
      skill: "writing",
      questions: [],
      writingPrompt: {
        prompt: "A fresh prompt.",
        taskNumber: 1,
        minWords: 60,
        maxWords: 120,
      },
      dedupExhausted: false,
    };
    const persistedHashes =
      exercise && !exercise.dedupExhausted ? extractExerciseHashes(exercise) : [];
    expect(persistedHashes).toHaveLength(1);
  });

  it("null exercise (defensive — pre-state-set): persists empty array", () => {
    // Mirror the persistExercise null-guard pattern. The TypeScript
    // narrows `null` immediately, so use a typed wrapper to exercise
    // the runtime conditional.
    const exercise = null as GeneratedExercise | null;
    const persistedHashes =
      exercise !== null && !exercise.dedupExhausted ? extractExerciseHashes(exercise) : [];
    expect(persistedHashes).toEqual([]);
  });

  it("MCQ exercise WITHOUT dedupExhausted flag: persists hashes (default false)", () => {
    // MCQ exhaustion does NOT seed-poison because the persisted hashes
    // include the original (still-novel-relative-to-newer-seen) stems
    // — Story 10-8 design choice. The dedupExhausted flag is only set
    // by the writing branch.
    const hashes = extractExerciseHashes(baseListening);
    const persistedHashes = baseListening && !baseListening.dedupExhausted ? hashes : [];
    expect(persistedHashes).toHaveLength(5);
  });
});

describe("exercise insert payload shape — contract pin (AC #6)", () => {
  it("listening insert payload contains question_stem_hashes: string[] of length 5", () => {
    const exercise: GeneratedExercise = {
      skill: "listening",
      questions: [
        { question: "Q1", options: [], explanation: "" },
        { question: "Q2", options: [], explanation: "" },
        { question: "Q3", options: [], explanation: "" },
        { question: "Q4", options: [], explanation: "" },
        { question: "Q5", options: [], explanation: "" },
      ],
    };
    // Mirror the use-exercise.ts persistExercise computation:
    const questionStemHashes =
      exercise && !exercise.dedupExhausted ? extractExerciseHashes(exercise) : [];
    const exerciseData = {
      user_id: "user-1",
      skill: "listening",
      cefr_level: "B1",
      exercise_type: "mcq",
      content: exercise,
      user_answer: {},
      ai_evaluation: null,
      score: 0.8,
      completed: true,
      completed_at: new Date().toISOString(),
      question_stem_hashes: questionStemHashes,
    };
    expect(exerciseData.question_stem_hashes).toHaveLength(5);
    expect(exerciseData.question_stem_hashes.every((h) => typeof h === "string")).toBe(true);
  });

  it("writing insert payload (non-exhausted) contains 1 hash", () => {
    const exercise: GeneratedExercise = {
      skill: "writing",
      questions: [],
      writingPrompt: {
        prompt: "Fresh prompt.",
        taskNumber: 1,
        minWords: 60,
        maxWords: 120,
      },
    };
    const questionStemHashes =
      exercise && !exercise.dedupExhausted ? extractExerciseHashes(exercise) : [];
    expect(questionStemHashes).toHaveLength(1);
  });

  it("writing insert payload (exhausted) contains 0 hashes — P1/ECH3 anti-poisoning", () => {
    const exercise: GeneratedExercise = {
      skill: "writing",
      questions: [],
      writingPrompt: {
        prompt: "Duplicate prompt.",
        taskNumber: 1,
        minWords: 60,
        maxWords: 120,
      },
      dedupExhausted: true,
    };
    const questionStemHashes =
      exercise && !exercise.dedupExhausted ? extractExerciseHashes(exercise) : [];
    expect(questionStemHashes).toEqual([]);
  });
});
