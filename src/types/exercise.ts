import type { CEFRLevel, TCFSkill } from "./cefr";

/** Exercise types supported across practice modules */
export type ExerciseType = "mcq" | "fill_blank" | "free_write" | "dictation" | "matching";

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
  content: MCQContent | WritingContent;
  user_answer: unknown | null;
  ai_evaluation: WritingEvaluation | null;
  score: number | null;
  completed: boolean;
  time_spent_seconds: number | null;
  created_at: string;
  completed_at: string | null;
}
