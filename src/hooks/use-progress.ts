/**
 * Progress Tracking Hook
 *
 * Fetches and manages user progress data from Supabase:
 * skill levels, daily activity, streaks, and error patterns.
 */

import { useCallback, useEffect, useState } from "react";

import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { incrementDailyActivity, updateStreak } from "@/src/lib/activity";
import type { TCFSkill } from "@/src/types/cefr";

export interface SkillProgressData {
  skill: TCFSkill;
  cefr_level: string;
  score: number;
  exercises_completed: number;
  total_time_minutes: number;
}

export interface DailyActivityData {
  date: string;
  minutes_practiced: number;
  exercises_completed: number;
  conversations_completed: number;
  words_learned: number;
}

export interface ErrorPatternData {
  id: string;
  error_type: string;
  error_description: string;
  occurrences: number;
  resolved: boolean;
}

export interface ProgressState {
  skills: SkillProgressData[];
  todayActivity: DailyActivityData | null;
  recentActivity: DailyActivityData[];
  topErrors: ErrorPatternData[];
  streakDays: number;
  isLoading: boolean;
  error: string | null;
}

export interface UseProgressReturn extends ProgressState {
  refresh: () => Promise<void>;
  logActivity: (minutes: number) => Promise<void>;
  clearError: () => void;
}

export function useProgress(): UseProgressReturn {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<ProgressState>({
    skills: [],
    todayActivity: null,
    recentActivity: [],
    topErrors: [],
    streakDays: 0,
    isLoading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!user) return;

    setState((s) => ({ ...s, isLoading: true }));

    try {
      // Fetch all in parallel
      const [skillsRes, todayRes, recentRes, errorsRes, profileRes] = await Promise.all([
        supabase.from("skill_progress").select("*").eq("user_id", user.id),
        supabase
          .from("daily_activity")
          .select("*")
          .eq("user_id", user.id)
          .eq("date", new Date().toISOString().split("T")[0])
          .maybeSingle(),
        supabase
          .from("daily_activity")
          .select("*")
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(7),
        supabase
          .from("error_patterns")
          .select("*")
          .eq("user_id", user.id)
          .eq("resolved", false)
          .order("occurrences", { ascending: false })
          .limit(5),
        supabase.from("profiles").select("streak_days").eq("id", user.id).single(),
      ]);

      setState({
        skills: (skillsRes.data ?? []) as SkillProgressData[],
        todayActivity: (todayRes.data as DailyActivityData) ?? null,
        recentActivity: (recentRes.data ?? []) as DailyActivityData[],
        topErrors: (errorsRes.data ?? []) as ErrorPatternData[],
        streakDays: profileRes.data?.streak_days ?? 0,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      captureError(err, "progress-loading");
      const message = err instanceof Error ? err.message : "Failed to load progress";
      setState((s) => ({ ...s, isLoading: false, error: message }));
    }
  }, [user]);

  const logActivity = useCallback(
    async (minutes: number) => {
      if (!user) return;

      try {
        await incrementDailyActivity(user.id, { minutes });
        await updateStreak(user.id);
        await refresh();
      } catch (err) {
        captureError(err, "log-activity");
      }
    },
    [user, refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    refresh,
    logActivity,
    clearError,
  };
}
