/**
 * Daily Briefing Hook
 *
 * Composes a personalized daily briefing from multiple data sources:
 * companion memories, SRS due count, weakest skill, error patterns,
 * and today's activity. Powers the CompanionMessage, TodayPlanItem,
 * and ErrorJourneyBar components on the home screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { cacheWithFallback, CACHE_KEYS, CACHE_TTL, invalidateCache } from "@/src/lib/cache";
import { SKILL_LABELS } from "@/src/lib/constants";
import { Colors, SKILL_COLORS } from "@/src/lib/design";
import { getTopErrors } from "@/src/lib/error-tracker";
import { retrieveMemories } from "@/src/lib/memory";
import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";
import { getLocalDateString } from "@/src/lib/activity";
import { useAuthStore } from "@/src/store/auth-store";
import type { ErrorPattern } from "@/src/lib/error-tracker";
import type { TCFSkill } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodayPlanItem {
  id: string;
  title: string;
  subtitle: string;
  iconColor: string;
  iconEmoji: string;
  badge: "due" | "suggested" | "error";
  route: string;
  params?: Record<string, string>;
}

export interface UseDailyBriefingReturn {
  /** Personalized companion message string */
  companionMessage: string;
  /** Ordered list of recommended activities (max 3) */
  todayPlan: TodayPlanItem[];
  /** Total unresolved error count for ErrorJourneyBar */
  totalErrors: number;
  /** Resolved error count for ErrorJourneyBar */
  resolvedErrors: number;
  /** Number of SRS vocabulary items due for review */
  srsDueCount: number;
  /** Loading state */
  isLoading: boolean;
  /** Error message if data fetching fails */
  error: string | null;
  /** Refresh all briefing data */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WeakestSkill {
  skill: TCFSkill;
  average_score: number;
}

interface BriefingData {
  memories: string[];
  srsDueCount: number;
  weakestSkill: WeakestSkill | null;
  errorPatterns: ErrorPattern[];
  hasActivityToday: boolean;
  totalErrors: number;
  resolvedErrors: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  return hour < 18 ? "Bonjour" : "Bonsoir";
}

function extractFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  return trimmed.split(" ")[0];
}

function composeMessage(name: string | null, data: BriefingData): string {
  const greeting = getGreeting();
  const isFirstTime =
    data.memories.length === 0 && !data.hasActivityToday && data.srsDueCount === 0;

  if (isFirstTime && !name) {
    return "Welcome! Let's start with a conversation.";
  }

  if (isFirstTime && name) {
    return `${greeting}, ${name}! Welcome! Let's start with a conversation.`;
  }

  const parts: string[] = [];

  // Greeting with name
  if (name) {
    parts.push(`${greeting}, ${name}!`);
  } else {
    parts.push(`${greeting}!`);
  }

  // Memory context (first relevant memory)
  if (data.memories.length > 0) {
    const memory = data.memories[0];
    // Truncate long memories to keep the message concise
    const truncated = memory.length > 80 ? memory.slice(0, 77) + "..." : memory;
    parts.push(`I remember: ${truncated}`);
  }

  // Activity context
  if (data.hasActivityToday) {
    if (data.srsDueCount > 0) {
      parts.push(
        `You've already practiced today — great work! How about reviewing those **${data.srsDueCount} vocabulary words**?`
      );
    } else if (data.weakestSkill) {
      const skillName = SKILL_LABELS[data.weakestSkill.skill].en.toLowerCase();
      parts.push(
        `You've already practiced today — great work! Your **${skillName}** could use some attention.`
      );
    } else {
      parts.push("You've already practiced today — great work! Keep it up!");
    }
  } else if (data.srsDueCount > 0) {
    parts.push(
      `You have **${data.srsDueCount} words** to review today — let's keep your streak going!`
    );
  } else if (data.weakestSkill) {
    const skillName = SKILL_LABELS[data.weakestSkill.skill].en.toLowerCase();
    parts.push(`Your **${skillName}** could use some attention today.`);
  } else {
    parts.push("Ready for some practice today?");
  }

  return parts.join(" ");
}

function buildTodayPlan(data: BriefingData): TodayPlanItem[] {
  const items: TodayPlanItem[] = [];
  const usedRoutes = new Set<string>();

  // Priority 1: SRS vocabulary due
  if (data.srsDueCount > 0) {
    const route = "/(tabs)/practice/vocabulary";
    items.push({
      id: "srs-due",
      title: `Review ${data.srsDueCount} words`,
      subtitle: "Vocabulary SRS review",
      iconColor: Colors.skillVocabulary,
      iconEmoji: "📚",
      badge: "due",
      route,
    });
    usedRoutes.add(route);
  }

  // Priority 2: Error pattern drills
  if (data.errorPatterns.length > 0 && items.length < 3) {
    const topError = data.errorPatterns[0];
    const route = "/(tabs)/practice/grammar";
    const desc = topError.error_description;
    const truncatedDesc = desc.length > 40 ? desc.slice(0, 37) + "..." : desc;
    if (!usedRoutes.has(route)) {
      items.push({
        id: `error-${topError.id}`,
        title: `Fix: ${truncatedDesc}`,
        subtitle: "Targeted micro-drill",
        iconColor: Colors.error,
        iconEmoji: "🎯",
        badge: "error",
        route,
        params: { errorId: topError.id },
      });
      usedRoutes.add(route);
    }
  }

  // Priority 3: Weakest skill
  if (data.weakestSkill && items.length < 3) {
    const skill = data.weakestSkill.skill;
    // speaking has no practice screen — route to conversation instead
    const route = skill === "speaking" ? "/(tabs)/conversation" : `/(tabs)/practice/${skill}`;
    const emojiMap: Record<TCFSkill, string> = {
      listening: "🎧",
      reading: "📖",
      writing: "✍️",
      speaking: "💬",
      grammar: "📝",
    };
    if (!usedRoutes.has(route)) {
      items.push({
        id: `skill-${skill}`,
        title: `Practice ${SKILL_LABELS[skill].en}`,
        subtitle: "Your weakest skill this week",
        iconColor: SKILL_COLORS[skill],
        iconEmoji: emojiMap[skill],
        badge: "suggested",
        route,
      });
      usedRoutes.add(route);
    }
  }

  // Priority 4: Fallback — daily conversation
  if (items.length < 3) {
    const route = "/(tabs)/conversation";
    if (!usedRoutes.has(route)) {
      items.push({
        id: "conversation-fallback",
        title: "Daily conversation",
        subtitle: "Practice speaking with your companion",
        iconColor: Colors.skillConversation,
        iconEmoji: "💬",
        badge: "suggested",
        route,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDailyBriefing(): UseDailyBriefingReturn {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);

  const [companionMessage, setCompanionMessage] = useState("");
  const [todayPlan, setTodayPlan] = useState<TodayPlanItem[]>([]);
  const [totalErrors, setTotalErrors] = useState(0);
  const [resolvedErrors, setResolvedErrors] = useState(0);
  const [srsDueCount, setSrsDueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    const userId = user.id;
    const firstName = extractFirstName(profile?.full_name ?? null);

    // Fetch all data in parallel — individual failures don't block others
    const [
      memoriesResult,
      srsResult,
      weakestResult,
      errorsResult,
      activityResult,
      errorCountsResult,
    ] = await Promise.allSettled([
      // 1. Companion memories
      cacheWithFallback<string[]>(
        userId,
        CACHE_KEYS.DAILY_BRIEFING,
        () => retrieveMemories(userId, "daily greeting", 3),
        CACHE_TTL.DAILY_BRIEFING
      ),

      // 2. SRS due count
      cacheWithFallback<number>(
        userId,
        CACHE_KEYS.SRS_DUE_COUNT,
        async () => {
          const { count } = await supabase
            .from("vocabulary")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .lte("next_review", new Date().toISOString());
          return count ?? 0;
        },
        CACHE_TTL.SRS_DUE
      ),

      // 3. Weakest skill
      cacheWithFallback<WeakestSkill | null>(
        userId,
        CACHE_KEYS.WEAKEST_SKILL,
        async () => {
          const { data } = await supabase
            .from("skill_progress")
            .select("skill, average_score")
            .eq("user_id", userId)
            .order("average_score", { ascending: true })
            .limit(1);
          if (data && data.length > 0) {
            return data[0] as WeakestSkill;
          }
          return null;
        },
        CACHE_TTL.SKILLS
      ),

      // 4. Error patterns (unresolved)
      cacheWithFallback<ErrorPattern[]>(
        userId,
        CACHE_KEYS.BRIEFING_ERRORS,
        () => getTopErrors(userId, 3),
        CACHE_TTL.ERRORS
      ),

      // 5. Today's activity
      cacheWithFallback<boolean>(
        userId,
        CACHE_KEYS.BRIEFING_ACTIVITY_TODAY,
        async () => {
          const today = getLocalDateString();
          const { data } = await supabase
            .from("daily_activity")
            .select("id")
            .eq("user_id", userId)
            .eq("date", today)
            .maybeSingle();
          return data !== null;
        },
        CACHE_TTL.DAILY_ACTIVITY
      ),

      // 6. Total + resolved error counts (for ErrorJourneyBar)
      cacheWithFallback<{ total: number; resolved: number }>(
        userId,
        CACHE_KEYS.BRIEFING_ERROR_COUNTS,
        async () => {
          const [totalResult, resolvedResult] = await Promise.all([
            supabase
              .from("error_patterns")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId),
            supabase
              .from("error_patterns")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("resolved", true),
          ]);
          return {
            total: totalResult.count ?? 0,
            resolved: resolvedResult.count ?? 0,
          };
        },
        CACHE_TTL.ERROR_COUNTS
      ),
    ]);

    if (!mountedRef.current) return;

    // Extract results with graceful degradation
    const memories = memoriesResult.status === "fulfilled" ? (memoriesResult.value.data ?? []) : [];
    if (memoriesResult.status === "rejected") {
      captureError(memoriesResult.reason, "daily-briefing-memories");
    }

    const srs = srsResult.status === "fulfilled" ? (srsResult.value.data ?? 0) : 0;
    if (srsResult.status === "rejected") {
      captureError(srsResult.reason, "daily-briefing-srs");
    }

    const weakest =
      weakestResult.status === "fulfilled" ? (weakestResult.value.data ?? null) : null;
    if (weakestResult.status === "rejected") {
      captureError(weakestResult.reason, "daily-briefing-weakest-skill");
    }

    const errors = errorsResult.status === "fulfilled" ? (errorsResult.value.data ?? []) : [];
    if (errorsResult.status === "rejected") {
      captureError(errorsResult.reason, "daily-briefing-errors");
    }

    const hasActivityToday =
      activityResult.status === "fulfilled" ? (activityResult.value.data ?? false) : false;
    if (activityResult.status === "rejected") {
      captureError(activityResult.reason, "daily-briefing-activity");
    }

    const errorCounts =
      errorCountsResult.status === "fulfilled"
        ? (errorCountsResult.value.data ?? { total: 0, resolved: 0 })
        : { total: 0, resolved: 0 };
    if (errorCountsResult.status === "rejected") {
      captureError(errorCountsResult.reason, "daily-briefing-error-counts");
    }

    const briefingData: BriefingData = {
      memories,
      srsDueCount: srs,
      weakestSkill: weakest,
      errorPatterns: errors,
      hasActivityToday,
      totalErrors: errorCounts.total,
      resolvedErrors: errorCounts.resolved,
    };

    setCompanionMessage(composeMessage(firstName, briefingData));
    setTodayPlan(buildTodayPlan(briefingData));
    setTotalErrors(errorCounts.total);
    setResolvedErrors(errorCounts.resolved);
    setSrsDueCount(srs);
    setIsLoading(false);
  }, [user, profile?.full_name]);

  useEffect(() => {
    mountedRef.current = true;
    refresh().catch((err) => {
      if (mountedRef.current) {
        captureError(err, "daily-briefing-init");
        setError(err instanceof Error ? err.message : "Failed to load briefing");
        setIsLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const refreshAndInvalidate = useCallback(async () => {
    if (!user) return;
    await Promise.all([
      invalidateCache(user.id, CACHE_KEYS.DAILY_BRIEFING),
      invalidateCache(user.id, CACHE_KEYS.SRS_DUE_COUNT),
      invalidateCache(user.id, CACHE_KEYS.WEAKEST_SKILL),
      invalidateCache(user.id, CACHE_KEYS.BRIEFING_ERRORS),
      invalidateCache(user.id, CACHE_KEYS.BRIEFING_ACTIVITY_TODAY),
      invalidateCache(user.id, CACHE_KEYS.BRIEFING_ERROR_COUNTS),
    ]);
    await refresh();
  }, [user, refresh]);

  return {
    companionMessage,
    todayPlan,
    totalErrors,
    resolvedErrors,
    srsDueCount,
    isLoading,
    error,
    refresh: refreshAndInvalidate,
  };
}
