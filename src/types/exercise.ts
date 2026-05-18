import type { z } from "zod";

import type {
  echoSentenceSchema,
  translationSentenceSchema,
  translationDimensionScoreSchema,
  translationEvaluationSchema,
  writingEvaluationSchema,
  writingErrorSchema,
} from "@/src/lib/schemas/ai-responses";

import type { CEFRLevel, TCFSkill } from "./cefr";

/** Exercise types supported across practice modules */
export type ExerciseType =
  | "mcq"
  | "fill_blank"
  | "free_write"
  | "dictation"
  | "matching"
  | "echo"
  | "translation";

/** A single MCQ option */
export interface MCQOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

/** MCQ exercise content */
export interface MCQContent {
  question: string;
  passage?: string;
  audioUrl?: string;
  /**
   * Base64-encoded TTS audio of the passage. Populated by the mock-test
   * listening generator (`use-mock-test-generation.ts`) and by the single-skill
   * listening practice screen so both rendering surfaces can play passage
   * audio via `useAudioPlayer.playFromBase64`.
   */
  audioBase64?: string;
  options: MCQOption[];
  explanation: string;
}

/** Writing exercise content */
export interface WritingContent {
  prompt: string;
  taskNumber: 1 | 2 | 3;
  minWords: number;
  maxWords: number;
  context?: string;
}

/**
 * AI-validated types — derived from Zod schemas in
 * `src/lib/schemas/ai-responses.ts`. The interfaces these aliases replace
 * had identical shapes; switching to `z.infer<...>` ensures the type system
 * mirrors runtime validation exactly. Story 9-7.
 */
export type EchoSentence = z.infer<typeof echoSentenceSchema>;

/** Echo practice exercise content (stored in DB) */
export interface EchoContent {
  sentences: EchoSentence[];
}

/** A single translation exercise sentence */
export type TranslationSentence = z.infer<typeof translationSentenceSchema>;

/** Translation exercise content (stored in DB) */
export interface TranslationContent {
  mode: "translation" | "paraphrasing"; // A1-B1 vs B2+
  sentences: TranslationSentence[];
}

/** A single dimension score in translation evaluation */
export type TranslationDimensionScore = z.infer<typeof translationDimensionScoreSchema>;

/**
 * Translation evaluation result from AI.
 *
 * The `expectedTranslation` and `userTranscription` fields are caller-attached
 * after schema parsing — the schema marks them optional, but consumers always
 * see them populated by `evaluateTranslation`. We narrow them to required
 * here since that's the contract for downstream consumers.
 */
export type TranslationEvaluation = z.infer<typeof translationEvaluationSchema> & {
  expectedTranslation: string;
  userTranscription: string;
};

/** Writing evaluation result from AI */
export type WritingEvaluation = z.infer<typeof writingEvaluationSchema>;

/** A specific error found in user's writing */
export type WritingError = z.infer<typeof writingErrorSchema>;

/** Exercise record stored in database */
export interface Exercise {
  id: string;
  user_id: string;
  skill: TCFSkill;
  cefr_level: CEFRLevel;
  exercise_type: ExerciseType;
  content: MCQContent | WritingContent | EchoContent | TranslationContent;
  user_answer: unknown | null;
  ai_evaluation: WritingEvaluation | null;
  score: number | null;
  completed: boolean;
  time_spent_seconds: number | null;
  created_at: string;
  completed_at: string | null;
}
