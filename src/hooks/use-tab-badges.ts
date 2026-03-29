/**
 * Tab Badge Hook
 *
 * Computes badge values for the tab bar:
 * - Practice tab: number of SRS vocabulary cards due for review
 * - Talk tab: amber dot when unresolved error patterns exist and
 *   the user hasn't conversed today
 *
 * Refetches on mount and whenever the app returns to the foreground.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { AppState } from "react-native";

import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { cacheWithFallback, invalidateCache, CACHE_KEYS, CACHE_TTL } from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
import { getLocalDateString } from "@/src/lib/activity";

interface TabBadges {
  /** Number of SRS cards due, or null if none */
  practiceBadge: number | null;
  /** Whether to show an amber dot on the Talk tab */
  talkBadge: boolean;
  /** Call after the user reviews vocab or starts a conversation */
  invalidateBadges: () => void;
}

export function useTabBadges(): TabBadges {
  const user = useAuthStore((s) => s.user);
  const [practiceBadge, setPracticeBadge] = useState<number | null>(null);
  const [talkBadge, setTalkBadge] = useState(false);
  const mountedRef = useRef(true);

  const fetchBadges = useCallback(async () => {
    if (!user) return;

    try {
      // SRS due count (reuses the same cache key as daily briefing)
      const { data: dueCount } = await cacheWithFallback<number>(
        user.id,
        CACHE_KEYS.SRS_DUE_COUNT,
        async () => {
          const { count, error } = await supabase
            .from("vocabulary")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id)
            .lte("next_review", new Date().toISOString());
          if (error) throw error;
          return count ?? 0;
        },
        CACHE_TTL.SRS_DUE
      );
      if (mountedRef.current) {
        setPracticeBadge(dueCount && dueCount > 0 ? dueCount : null);
      }
    } catch (err) {
      captureError(err, "tab-badges-srs");
    }

    try {
      // Unresolved error patterns
      const { count: unresolvedCount, error: errErr } = await supabase
        .from("error_patterns")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("resolved", false);
      if (errErr) throw errErr;

      // Recent companion memories (stored since last conversation)
      const todayStr = getLocalDateString();
      const { count: recentMemoryCount, error: memErr } = await supabase
        .from("companion_memory")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", `${todayStr}T00:00:00`);
      if (memErr) throw memErr;

      const hasContext = (unresolvedCount ?? 0) > 0 || (recentMemoryCount ?? 0) > 0;

      if (hasContext) {
        // Check if user has conversed today (using local date to avoid timezone issues)
        const { data: recentConvo, error: convoErr } = await supabase
          .from("conversations")
          .select("created_at")
          .eq("user_id", user.id)
          .gte("created_at", `${todayStr}T00:00:00`)
          .limit(1);
        if (convoErr) throw convoErr;

        if (mountedRef.current) {
          setTalkBadge(!recentConvo || recentConvo.length === 0);
        }
      } else {
        if (mountedRef.current) {
          setTalkBadge(false);
        }
      }
    } catch (err) {
      captureError(err, "tab-badges-talk");
    }
  }, [user]);

  // Fetch on mount
  useEffect(() => {
    mountedRef.current = true;
    void fetchBadges();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchBadges]);

  // Refetch when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void fetchBadges();
      }
    });
    return () => sub.remove();
  }, [fetchBadges]);

  const invalidateBadges = useCallback(async () => {
    if (!user) return;
    await invalidateCache(user.id, CACHE_KEYS.SRS_DUE_COUNT);
    void fetchBadges();
  }, [user, fetchBadges]);

  return { practiceBadge, talkBadge, invalidateBadges };
}
