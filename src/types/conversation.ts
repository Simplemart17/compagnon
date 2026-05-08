import type { z } from "zod";

import type { conversationFeedbackSchema } from "@/src/lib/schemas/ai-responses";

import type { CEFRLevel } from "./cefr";

/** Conversation session stored in database */
export interface Conversation {
  id: string;
  user_id: string;
  topic: string;
  scenario_description: string | null;
  cefr_level: CEFRLevel;
  duration_seconds: number;
  ai_feedback: ConversationFeedback | null;
  status: "active" | "completed" | "abandoned";
  created_at: string;
  completed_at: string | null;
}

/** A single message in a conversation */
export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  audio_storage_path: string | null;
  corrections: Correction[] | null;
  created_at: string;
}

/** An AI correction for something the user said */
export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  category: "grammar" | "pronunciation" | "vocabulary" | "register";
}

/**
 * Post-conversation AI feedback summary. Derived from
 * `conversationFeedbackSchema` in `src/lib/schemas/ai-responses.ts` so the
 * type system mirrors runtime validation. Story 9-7.
 */
export type ConversationFeedback = z.infer<typeof conversationFeedbackSchema>;

/** Vocabulary item suggested during or after conversation */
export interface VocabSuggestion {
  french: string;
  english: string;
  context: string;
  level: CEFRLevel;
}

/** Conversation topic card shown in topic selector */
export interface ConversationTopic {
  id: string;
  title: string;
  titleFr: string;
  description: string;
  cefr_level: CEFRLevel;
  category: TopicCategory;
  systemPromptExtra?: string;
}

/** Topic categories */
export type TopicCategory =
  | "daily_life"
  | "travel"
  | "work"
  | "culture"
  | "debate"
  | "academic"
  | "free";

/** Conversation mode types */
export type ConversationMode = "companion" | "debate" | "tcf_simulation";
