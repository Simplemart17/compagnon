/**
 * Progress Tracking Hook
 *
 * Fetches and manages user progress data from Supabase:
 * skill levels, daily activity, streaks, and error patterns.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { cacheWithFallback, invalidateCache, CACHE_KEYS, CACHE_TTL } from "@/src/lib/cache";
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

  /** Track whether any data was served from cache so we can show a subtle indicator */
  const fromCacheRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!user) return;

    setState((s) => ({ ...s, isLoading: true }));

    try {
      // Fetch all in parallel, each with its own cache fallback
      const [skillsResult, todayResult, recentResult, errorsResult, streakResult] =
        await Promise.all([
          cacheWithFallback<SkillProgressData[]>(
            user.id,
            CACHE_KEYS.SKILLS,
            async () => {
              const { data, error } = await supabase
                .from("skill_progress")
                .select("*")
                .eq("user_id", user.id);
              if (error) throw error;
              return (data ?? []) as SkillProgressData[];
            },
            CACHE_TTL.SKILLS
          ),
          cacheWithFallback<DailyActivityData | null>(
            user.id,
            CACHE_KEYS.DAILY_ACTIVITY_TODAY,
            async () => {
              const { data, error } = await supabase
                .from("daily_activity")
                .select("*")
                .eq("user_id", user.id)
                .eq("date", new Date().toISOString().split("T")[0])
                .maybeSingle();
              if (error) throw error;
              return (data as DailyActivityData) ?? null;
            },
            CACHE_TTL.DAILY_ACTIVITY
          ),
          cacheWithFallback<DailyActivityData[]>(
            user.id,
            CACHE_KEYS.RECENT_ACTIVITY,
            async () => {
              const { data, error } = await supabase
                .from("daily_activity")
                .select("*")
                .eq("user_id", user.id)
                .order("date", { ascending: false })
                .limit(7);
              if (error) throw error;
              return (data ?? []) as DailyActivityData[];
            },
            CACHE_TTL.DAILY_ACTIVITY
          ),
          cacheWithFallback<ErrorPatternData[]>(
            user.id,
            CACHE_KEYS.TOP_ERRORS,
            async () => {
              const { data, error } = await supabase
                .from("error_patterns")
                .select("*")
                .eq("user_id", user.id)
                .eq("resolved", false)
                .order("occurrences", { ascending: false })
                .limit(5);
              if (error) throw error;
              return (data ?? []) as ErrorPatternData[];
            },
            CACHE_TTL.ERRORS
          ),
          cacheWithFallback<number>(
            user.id,
            CACHE_KEYS.STREAK,
            async () => {
              const { data, error } = await supabase
                .from("profiles")
                .select("streak_days")
                .eq("id", user.id)
                .single();
              if (error) throw error;
              return data?.streak_days ?? 0;
            },
            CACHE_TTL.STREAK
          ),
        ]);

      fromCacheRef.current =
        skillsResult.fromCache ||
        todayResult.fromCache ||
        recentResult.fromCache ||
        errorsResult.fromCache ||
        streakResult.fromCache;

      setState({
        skills: skillsResult.data ?? [],
        todayActivity: todayResult.data ?? null,
        recentActivity: recentResult.data ?? [],
        topErrors: errorsResult.data ?? [],
        streakDays: streakResult.data ?? 0,
        isLoading: false,
        error: fromCacheRef.current ? "Showing cached data (offline)" : null,
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
        // Invalidate caches that were just mutated
        await Promise.all([
          invalidateCache(user.id, CACHE_KEYS.DAILY_ACTIVITY_TODAY),
          invalidateCache(user.id, CACHE_KEYS.RECENT_ACTIVITY),
          invalidateCache(user.id, CACHE_KEYS.STREAK),
        ]);
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
