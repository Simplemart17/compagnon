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

/** A single echo practice sentence */
export interface EchoSentence {
  sentence: string; // The French sentence to echo
  translation: string; // English translation
  expectedSpelling: string; // Canonical spelling for comparison
  difficulty: "easy" | "medium" | "hard";
  grammarFocus?: string; // Grammar point this sentence targets
}

/** Echo practice exercise content (stored in DB) */
export interface EchoContent {
  sentences: EchoSentence[];
}

/** A single translation exercise sentence */
export interface TranslationSentence {
  source: string; // English sentence (A1-B1) or French sentence (B2+ paraphrasing)
  target: string; // Expected French translation or paraphrase
  explanation: string; // Why this translation is correct / key grammar notes
  difficulty: CEFRLevel; // Sentence difficulty level
  grammarFocus: string; // Primary grammar structure being tested
}

/** Translation exercise content (stored in DB) */
export interface TranslationContent {
  mode: "translation" | "paraphrasing"; // A1-B1 vs B2+
  sentences: TranslationSentence[];
}

/** A single dimension score in translation evaluation */
export interface TranslationDimensionScore {
  score: number; // 0-100
  feedback: string; // Specific dimension feedback
}

/** Translation evaluation result from AI */
export interface TranslationEvaluation {
  accuracy: TranslationDimensionScore;
  fluency: TranslationDimensionScore;
  naturalness: TranslationDimensionScore;
  overallScore: number; // Weighted average
  corrections?: string; // Key mistakes and how to fix them
  expectedTranslation: string;
  userTranscription: string;
}

/** Writing evaluation result from AI */
export interface WritingEvaluation {
  overallScore: number;
  grammarScore: number;
  cohesionScore: number;
  lexicalRichnessScore: number;
  registerScore: number;
  errors: WritingError[];
  suggestions: string[];
  rewriteSuggestion?: string;
  tcfEstimatedScore?: number;
  vocabularyDiversityRatio?: number;
  connectorsUsed?: string[];
  connectorsMissing?: string[];
  summary?: string;
}

/** A specific error found in user's writing */
export interface WritingError {
  original: string;
  correction: string;
  explanation: string;
  category: "grammar" | "cohesion" | "vocabulary" | "register";
}

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
