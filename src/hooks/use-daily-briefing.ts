/**
 * Daily Briefing Hook
 *
 * Composes a personalized daily briefing from multiple data sources:
 * companion memories, SRS due count, weakest skill, error patterns,
 * and today's activity. Powers the CompanionMessage, TodayPlanItem,
 * and ErrorJourneyBar components on the home screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

import { cacheWithFallback, CACHE_KEYS, CACHE_TTL, invalidateCache } from "@/src/lib/cache";
import { SKILL_LABELS } from "@/src/lib/constants";
import { Colors, SKILL_COLORS } from "@/src/lib/design";
import {
  getHomeAggregate,
  type HomeAggregate,
  type HomeAggregateError,
} from "@/src/lib/home-aggregate";
import {
  entryLessonIdForLevel,
  getCompletedLessonIds,
  nextLessonForUser,
} from "@/src/lib/lesson-progress";
import { retrieveDailyGreetingMemories, sanitizeMemoryContent } from "@/src/lib/memory";
import { captureError } from "@/src/lib/sentry";
import { getLocalDateString } from "@/src/lib/activity";
import { useAuthStore } from "@/src/store/auth-store";
import type { TCFSkill } from "@/src/types/cefr";
import type { IconName } from "@/src/components/common/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodayPlanItem {
  id: string;
  title: string;
  subtitle: string;
  iconColor: string;
  /** Story 14-3: typed icon name (rendered via shared `<Icon>` component). */
  iconName: IconName;
  badge: "due" | "suggested" | "error";
  route: string;
  params?: Record<string, string>;
  /** Review R1: the lesson player renders bundled in-repo content — the
   * only plan target that works fully offline; home's blanket
   * `disabled={!isConnected}` honors this flag. */
  offlineCapable?: boolean;
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

/** @internal exported for buildTodayPlan runtime tests (Story 19-3). */
export interface BriefingData {
  memories: string[];
  srsDueCount: number;
  weakestSkill: WeakestSkill | null;
  /**
   * Story 13-2 review-round-1 P5: typed as `HomeAggregateError[]` (the
   * RPC's own row-shape) rather than the broader `ErrorPattern[]`. Pre-
   * patch the cast `as ErrorPattern[]` lied to TypeScript — `HomeAggregateError`
   * omits `user_id`, `last_occurred`, `created_at` that `ErrorPattern` has.
   * The structural compatibility held today (consumers only read `.id`
   * + `.error_description`, both in the narrower shape) but a future
   * consumer reading `.last_occurred` would crash on undefined. Narrowing
   * here keeps the type honest.
   */
  errorPatterns: HomeAggregateError[];
  hasActivityToday: boolean;
  totalErrors: number;
  resolvedErrors: number;
  /** Story 19-3: the learner's next uncompleted curriculum lesson (from
   * the placement-aware resume pointer), or null when the spine is done
   * or the fetch failed soft. */
  nextLesson: { id: string; canDoEn: string } | null;
}

function getGreeting(): string {
  // Story 14-1: converted from "Bonjour"/"Bonsoir" to English greetings
  // under the EN-UI rule (Decision Matrix row D1).
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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

  // Memory context (first relevant memory). Read-time sanitize defends against
  // any pre-9-4 row, future-bug-introduced row, or directly-edited DB row
  // surfacing instruction-like text into the UI greeting.
  if (data.memories.length > 0) {
    const memory = sanitizeMemoryContent(data.memories[0]);
    if (memory.length > 0) {
      // Truncate long memories to keep the message concise
      const truncated = memory.length > 80 ? memory.slice(0, 77) + "..." : memory;
      parts.push(`I remember: ${truncated}`);
    }
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

/** @internal exported for runtime tests (Story 19-3) — pure plan builder. */
export function buildTodayPlan(data: BriefingData): TodayPlanItem[] {
  const items: TodayPlanItem[] = [];
  const usedRoutes = new Set<string>();

  // Priority 1 (Story 19-3): the guided path leads — Today's Plan pulls the
  // learner's next curriculum lesson (teach → drill → apply loop).
  if (data.nextLesson) {
    const route = `/(tabs)/practice/lesson/${data.nextLesson.id}`;
    // Code-POINT-safe truncation (18-3 R1-P7 class — a bare .slice can
    // split a surrogate pair into U+FFFD).
    const canDoChars = [...data.nextLesson.canDoEn];
    items.push({
      id: `lesson-${data.nextLesson.id}`,
      title: "Continue your lessons",
      subtitle:
        canDoChars.length > 48 ? canDoChars.slice(0, 45).join("") + "..." : data.nextLesson.canDoEn,
      iconColor: Colors.accent,
      iconName: "book-open",
      badge: "suggested",
      route,
      offlineCapable: true,
    });
    usedRoutes.add(route);
  }

  // Priority 2: SRS vocabulary due
  if (data.srsDueCount > 0 && items.length < 3) {
    const route = "/(tabs)/practice/vocabulary";
    items.push({
      id: "srs-due",
      title: `Review ${data.srsDueCount} words`,
      subtitle: "Vocabulary SRS review",
      iconColor: Colors.skillVocabulary,
      iconName: "book",
      badge: "due",
      route,
    });
    usedRoutes.add(route);
  }

  // Priority 3: Error pattern drills. Read-time sanitize on error_description
  // — same reasoning as the memory greeting above. Skip the slot if the
  // sanitized description is empty (don't early-return — Priority 3+ still apply).
  if (data.errorPatterns.length > 0 && items.length < 3) {
    const topError = data.errorPatterns[0];
    const route = "/(tabs)/practice/grammar";
    const desc = sanitizeMemoryContent(topError.error_description);
    if (desc.length > 0 && !usedRoutes.has(route)) {
      const truncatedDesc = desc.length > 40 ? desc.slice(0, 37) + "..." : desc;
      items.push({
        id: `error-${topError.id}`,
        title: `Fix: ${truncatedDesc}`,
        subtitle: "Targeted micro-drill",
        iconColor: Colors.error,
        iconName: "target",
        badge: "error",
        route,
        params: { errorId: topError.id },
      });
      usedRoutes.add(route);
    }
  }

  // Priority 4: Weakest skill
  if (data.weakestSkill && items.length < 3) {
    const skill = data.weakestSkill.skill;
    // speaking has no practice screen — route to conversation instead
    const route = skill === "speaking" ? "/(tabs)/conversation" : `/(tabs)/practice/${skill}`;
    const iconMap: Record<TCFSkill, IconName> = {
      listening: "headphones",
      reading: "book-open",
      writing: "edit-3",
      speaking: "message-circle",
      grammar: "file-text",
    };
    if (!usedRoutes.has(route)) {
      items.push({
        id: `skill-${skill}`,
        title: `Practice ${SKILL_LABELS[skill].en}`,
        subtitle: "Your weakest skill this week",
        iconColor: SKILL_COLORS[skill],
        iconName: iconMap[skill],
        badge: "suggested",
        route,
      });
      usedRoutes.add(route);
    }
  }

  // Priority 5: Fallback — daily conversation
  if (items.length < 3) {
    const route = "/(tabs)/conversation";
    if (!usedRoutes.has(route)) {
      items.push({
        id: "conversation-fallback",
        title: "Daily conversation",
        subtitle: "Practice speaking with your companion",
        iconColor: Colors.skillConversation,
        iconName: "message-circle",
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

  // Review R1: `silent` skips the loading flag so the focus-driven refetch
  // below updates the plan IN PLACE without flashing the home skeletons.
  const runRefresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user) return;

      if (!opts?.silent) setIsLoading(true);
      setError(null);

      const userId = user.id;
      const firstName = extractFirstName(profile?.full_name ?? null);
      // Story 19-3: uncoerced profile level (18-2 R1-P3 — never `?? "A1"`);
      // undefined during hydration means the pointer scans from the spine start.
      const entryLessonId = entryLessonIdForLevel(profile?.current_cefr_level);

      // Story 13-2: 6-slot Promise.allSettled DELETED ("delete don't alias"
      // pattern). 5 of the 6 slots (SRS due / weakest skill / errors / today
      // activity / error counts) are now backed by the single
      // get_home_aggregate RPC; the memories slot uses retrieveDailyGreetingMemories
      // with module-level embedding memoization. Net: 6 slots → 2; closes
      // audit P2-5.
      const [aggregateResult, memoriesResult, completedLessonsResult] = await Promise.allSettled([
        // 1. Home aggregate (shared with use-progress.ts via CACHE_KEYS.HOME_AGGREGATE)
        cacheWithFallback<HomeAggregate>(
          userId,
          CACHE_KEYS.HOME_AGGREGATE,
          () => getHomeAggregate(userId, getLocalDateString()),
          CACHE_TTL.HOME_AGGREGATE
        ),

        // 2. Companion memories with module-level embedding cache
        cacheWithFallback<string[]>(
          userId,
          CACHE_KEYS.DAILY_BRIEFING,
          () => retrieveDailyGreetingMemories(userId, 3),
          CACHE_TTL.DAILY_BRIEFING
        ),

        // 3. Story 19-3: completed lesson ids for the next-lesson plan item.
        // Deliberately UNCACHED — one cheap indexed select, and a stale set
        // would keep pointing the plan at an already-completed lesson; the
        // helper itself fails soft to an empty set (Story 19-2).
        getCompletedLessonIds(userId),
      ]);

      if (!mountedRef.current) return;

      // Extract aggregate with graceful degradation. Single Sentry tag
      // "daily-briefing-aggregate" replaces the pre-13-2 5-tag fan-out
      // (Story 9-3 telemetry allowlist preserved — no new tags added; the
      // existing `feature` extras key already accepts categorical strings).
      const aggregate: HomeAggregate | null =
        aggregateResult.status === "fulfilled" ? (aggregateResult.value.data ?? null) : null;
      if (aggregateResult.status === "rejected") {
        captureError(aggregateResult.reason, "daily-briefing-aggregate");
      }

      const memories =
        memoriesResult.status === "fulfilled" ? (memoriesResult.value.data ?? []) : [];
      if (memoriesResult.status === "rejected") {
        captureError(memoriesResult.reason, "daily-briefing-memories");
      }

      // Story 19-3: placement-aware resume pointer → the plan's lesson item.
      // getCompletedLessonIds never rejects (fail-soft), so the fallback arm
      // is belt-and-suspenders only.
      const completedLessons =
        completedLessonsResult.status === "fulfilled"
          ? completedLessonsResult.value
          : new Set<string>();
      const pointer = nextLessonForUser(completedLessons, entryLessonId);

      // Map the aggregate (or null/empty fallback) to BriefingData. Shape
      // is byte-identical to pre-13-2 — composeMessage + buildTodayPlan
      // consumer paths unchanged. Story 9-4 sanitizeMemoryContent calls at
      // those consumer sites still run at read-time on every memory +
      // error_description that flows to the UI.
      const briefingData: BriefingData = {
        memories,
        srsDueCount: aggregate?.srs_due_count ?? 0,
        weakestSkill: aggregate?.weakest_skill
          ? {
              skill: aggregate.weakest_skill.skill,
              average_score: aggregate.weakest_skill.average_score,
            }
          : null,
        errorPatterns: (aggregate?.top_errors ?? []).slice(0, 3),
        hasActivityToday: aggregate?.has_activity_today ?? false,
        totalErrors: aggregate?.error_counts?.total ?? 0,
        resolvedErrors: aggregate?.error_counts?.resolved ?? 0,
        nextLesson: pointer ? { id: pointer.id, canDoEn: pointer.canDoEn } : null,
      };

      const errorCounts = {
        total: briefingData.totalErrors,
        resolved: briefingData.resolvedErrors,
      };
      const srs = briefingData.srsDueCount;

      setCompanionMessage(composeMessage(firstName, briefingData));
      setTodayPlan(buildTodayPlan(briefingData));
      setTotalErrors(errorCounts.total);
      setResolvedErrors(errorCounts.resolved);
      setSrsDueCount(srs);
      setIsLoading(false);
    },
    [user, profile?.full_name, profile?.current_cefr_level]
  );

  useEffect(() => {
    mountedRef.current = true;
    runRefresh().catch((err) => {
      if (mountedRef.current) {
        captureError(err, "daily-briefing-init");
        setError(err instanceof Error ? err.message : "Failed to load briefing");
        setIsLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
    };
  }, [runRefresh]);

  // Review R1: the "deliberately UNCACHED" completion slot only stays fresh
  // if the fetch RE-RUNS — tab screens stay mounted, so without a focus
  // hook the flagship "Continue your lessons" item kept pointing at a
  // lesson the user just completed (both sibling 19-3 surfaces refetch on
  // focus; the highest-visibility one didn't). Silent so cached aggregate/
  // memories serve instantly and only the plan updates in place. The first
  // focus after mount is skipped — the mount effect above already fetched.
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      runRefresh({ silent: true }).catch((err) => {
        captureError(err, "daily-briefing-focus-refresh");
      });
    }, [runRefresh])
  );

  const refreshAndInvalidate = useCallback(async () => {
    if (!user) return;
    // Story 13-2 review-round-1 P6: only invalidate HOME_AGGREGATE +
    // DAILY_BRIEFING (the 2 keys this hook actually reads). Pre-patch
    // the legacy per-slot keys (SRS_DUE_COUNT, WEAKEST_SKILL,
    // BRIEFING_ERRORS, BRIEFING_ACTIVITY_TODAY, BRIEFING_ERROR_COUNTS)
    // were also invalidated as "backward-compat eviction" — but those
    // keys are no longer READ by any post-13-2 code path, making the 5
    // extra invalidateCache calls dead writes wasting AsyncStorage
    // round-trips. If a future refactor re-introduces them, it should
    // re-add invalidation here.
    await Promise.all([
      invalidateCache(user.id, CACHE_KEYS.HOME_AGGREGATE),
      invalidateCache(user.id, CACHE_KEYS.DAILY_BRIEFING),
    ]);
    await runRefresh();
  }, [user, runRefresh]);

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
