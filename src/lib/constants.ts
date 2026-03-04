import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";
import type { ConversationTopic } from "@/src/types/conversation";

/** Default daily practice goal in minutes */
export const DEFAULT_DAILY_GOAL = 15;

/** Number of correct uses to mark an error pattern as resolved */
export const ERROR_RESOLVED_THRESHOLD = 5;

/** Number of occurrences before generating a micro-drill */
export const MICRO_DRILL_THRESHOLD = 3;

/** TCF scoring constants */
export const TCF = {
  MIN_SCORE: 0,
  MAX_SCORE: 699,
  C1_MIN: 500,
  LISTENING_QUESTIONS: 29,
  LISTENING_MINUTES: 25,
  READING_QUESTIONS: 29,
  READING_MINUTES: 45,
  GRAMMAR_QUESTIONS: 18,
  GRAMMAR_MINUTES: 15,
  SPEAKING_MINUTES: 12,
  WRITING_MINUTES: 60,
} as const;

/** Skill display names */
export const SKILL_LABELS: Record<TCFSkill, { en: string; fr: string }> = {
  listening: { en: "Listening", fr: "Compréhension orale" },
  reading: { en: "Reading", fr: "Compréhension écrite" },
  speaking: { en: "Speaking", fr: "Expression orale" },
  writing: { en: "Writing", fr: "Expression écrite" },
  grammar: { en: "Grammar & Vocabulary", fr: "Maîtrise des structures" },
};

/** CEFR level colors for UI badges */
export const LEVEL_COLORS: Record<CEFRLevel, string> = {
  A1: "#66BB6A",
  A2: "#10B981",
  B1: "#3B82F6",
  B2: "#1E3A5F",
  C1: "#8B5CF6",
  C2: "#EC4899",
};

/** Conversation topics organized by CEFR level */
export const CONVERSATION_TOPICS: ConversationTopic[] = [
  // A1 Topics
  {
    id: "a1-greetings",
    title: "Introduce Yourself",
    titleFr: "Se présenter",
    description: "Practice basic greetings and self-introduction.",
    cefr_level: "A1",
    category: "daily_life",
  },
  {
    id: "a1-cafe",
    title: "Order at a Café",
    titleFr: "Commander au café",
    description: "Order drinks and snacks at a French café.",
    cefr_level: "A1",
    category: "daily_life",
  },
  {
    id: "a1-directions",
    title: "Ask for Directions",
    titleFr: "Demander son chemin",
    description: "Navigate a French city using basic directions.",
    cefr_level: "A1",
    category: "travel",
  },
  // A2 Topics
  {
    id: "a2-family",
    title: "Describe Your Family",
    titleFr: "Décrire sa famille",
    description: "Talk about family members, relationships, and daily routines.",
    cefr_level: "A2",
    category: "daily_life",
  },
  {
    id: "a2-doctor",
    title: "At the Doctor",
    titleFr: "Chez le médecin",
    description: "Describe symptoms and understand medical advice.",
    cefr_level: "A2",
    category: "daily_life",
  },
  {
    id: "a2-weekend",
    title: "Weekend Plans",
    titleFr: "Plans du week-end",
    description: "Discuss what you did or will do this weekend.",
    cefr_level: "A2",
    category: "daily_life",
  },
  // B1 Topics
  {
    id: "b1-interview",
    title: "Job Interview",
    titleFr: "Entretien d'embauche",
    description: "Practice answering common job interview questions in French.",
    cefr_level: "B1",
    category: "work",
  },
  {
    id: "b1-travel",
    title: "Travel Stories",
    titleFr: "Récits de voyage",
    description: "Share and discuss travel experiences in detail.",
    cefr_level: "B1",
    category: "travel",
  },
  {
    id: "b1-opinion",
    title: "Debate a Topic",
    titleFr: "Débattre d'un sujet",
    description: "Express and defend your opinion on everyday topics.",
    cefr_level: "B1",
    category: "debate",
  },
  // B2 Topics
  {
    id: "b2-cinema",
    title: "French Cinema Discussion",
    titleFr: "Discussion sur le cinéma français",
    description: "Discuss French films, directors, and cultural significance.",
    cefr_level: "B2",
    category: "culture",
  },
  {
    id: "b2-environment",
    title: "Environmental Issues",
    titleFr: "Questions environnementales",
    description: "Discuss climate change, sustainability, and solutions.",
    cefr_level: "B2",
    category: "debate",
  },
  {
    id: "b2-workplace",
    title: "Workplace Conflict",
    titleFr: "Conflit au travail",
    description: "Navigate professional disagreements and find solutions.",
    cefr_level: "B2",
    category: "work",
  },
  // C1 Topics
  {
    id: "c1-politics",
    title: "Political Analysis",
    titleFr: "Analyse politique",
    description: "Analyze current political events with nuanced argumentation.",
    cefr_level: "C1",
    category: "academic",
  },
  {
    id: "c1-education",
    title: "Philosophy of Education",
    titleFr: "Philosophie de l'éducation",
    description: "Discuss education systems, reforms, and pedagogical approaches.",
    cefr_level: "C1",
    category: "academic",
  },
  {
    id: "c1-literature",
    title: "Literary Criticism",
    titleFr: "Critique littéraire",
    description: "Analyze French literature, themes, and writing styles.",
    cefr_level: "C1",
    category: "culture",
  },
  // C2 Topics
  {
    id: "c2-sociolinguistic",
    title: "Sociolinguistic Debate",
    titleFr: "Débat sociolinguistique",
    description: "Explore language evolution, regional dialects, and identity.",
    cefr_level: "C2",
    category: "academic",
  },
  {
    id: "c2-abstract",
    title: "Abstract Argumentation",
    titleFr: "Argumentation abstraite",
    description: "Construct and deconstruct complex philosophical arguments.",
    cefr_level: "C2",
    category: "debate",
  },
  // Free mode
  {
    id: "free",
    title: "Free Conversation",
    titleFr: "Conversation libre",
    description: "Talk about anything you want. The AI adapts to your level.",
    cefr_level: "A1",
    category: "free",
  },
];
