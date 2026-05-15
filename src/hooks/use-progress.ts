/**
 * Progress Tracking Hook
 *
 * Fetches and manages user progress data from Supabase:
 * skill levels, daily activity, streaks, and error patterns.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { cacheWithFallback, invalidateCache, CACHE_KEYS, CACHE_TTL } from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
import { getHomeAggregate, type HomeAggregate } from "@/src/lib/home-aggregate";
import { useAuthStore } from "@/src/store/auth-store";
import { getLocalDateString, incrementDailyActivity, updateStreak } from "@/src/lib/activity";
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
      // Story 13-2: single aggregate RPC replaces 5 parallel queries (audit
      // P2-5 closure). The pre-13-2 per-slot `Promise.all([cacheWithFallback × 5])`
      // shape is DELETED ("delete don't alias" pattern). Skills + daily
      // activity (today + recent) + top errors + streak now arrive in one
      // round-trip. The hook's public `UseProgressReturn` shape is unchanged.
      const aggregateResult = await cacheWithFallback<HomeAggregate>(
        user.id,
        CACHE_KEYS.HOME_AGGREGATE,
        () => getHomeAggregate(user.id, getLocalDateString()),
        CACHE_TTL.HOME_AGGREGATE
      );

      fromCacheRef.current = aggregateResult.fromCache;

      const agg = aggregateResult.data;
      if (agg) {
        setState({
          skills: agg.skills as SkillProgressData[],
          todayActivity: agg.daily_activity_today as DailyActivityData | null,
          recentActivity: agg.recent_activity as DailyActivityData[],
          topErrors: agg.top_errors as ErrorPatternData[],
          streakDays: agg.streak_days,
          isLoading: false,
          error: fromCacheRef.current ? "Showing cached data (offline)" : null,
        });
      } else {
        // Aggregate completely unavailable — both network AND cache miss.
        // Preserve the existing empty-state UX.
        setState({
          skills: [],
          todayActivity: null,
          recentActivity: [],
          topErrors: [],
          streakDays: 0,
          isLoading: false,
          error: "Could not load your progress. Pull down to refresh.",
        });
      }
    } catch (err) {
      captureError(err, "progress-loading");
      setState((s) => ({
        ...s,
        isLoading: false,
        error: "Could not load your progress. Pull down to refresh.",
      }));
    }
  }, [user]);

  const logActivity = useCallback(
    async (minutes: number) => {
      if (!user) return;

      try {
        await incrementDailyActivity(user.id, { minutes });
        await updateStreak(user.id);
        // Story 13-2 review-round-1 P6: only invalidate HOME_AGGREGATE.
        // Pre-patch this list also invalidated DAILY_ACTIVITY_TODAY +
        // RECENT_ACTIVITY + STREAK as "backward-compat eviction" — but
        // those keys are no longer READ by any post-13-2 code path,
        // making the 3 extra invalidateCache calls dead writes that
        // wasted AsyncStorage round-trips. If a future refactor re-
        // introduces those keys, it should re-add invalidation here.
        await invalidateCache(user.id, CACHE_KEYS.HOME_AGGREGATE);
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
