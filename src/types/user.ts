import type { CEFRLevel, TCFSkill } from "./cefr";

/** User profile stored in Supabase profiles table */
export interface UserProfile {
  id: string;
  full_name: string | null;
  native_language: string;
  current_cefr_level: CEFRLevel;
  target_cefr_level: CEFRLevel;
  daily_goal_minutes: number;
  streak_days: number;
  last_active_date: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

/** Per-skill progress tracking */
export interface SkillProgress {
  id: string;
  user_id: string;
  skill: TCFSkill;
  cefr_level: CEFRLevel;
  score: number;
  exercises_completed: number;
  total_time_minutes: number;
  last_practiced: string | null;
  updated_at: string;
}

/** Daily activity log entry */
export interface DailyActivity {
  id: string;
  user_id: string;
  date: string;
  minutes_practiced: number;
  exercises_completed: number;
  conversations_completed: number;
  words_learned: number;
}

/** User learning goal options */
export type LearningGoal = "tcf_c1" | "tcf_c2" | "travel" | "work" | "study" | "general";

/** Onboarding data collected during signup flow */
export interface OnboardingData {
  current_level: CEFRLevel;
  goal: LearningGoal;
  daily_minutes: number;
}
