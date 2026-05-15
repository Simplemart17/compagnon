/**
 * Story 13-3 — `useSessionFeedbackAggregate` hook.
 *
 * Single chokepoint replacing the pre-13-3 4-effect waterfall in
 * `app/(tabs)/conversation/[sessionId].tsx:242-461`. Fires one RPC
 * (`get_session_feedback_aggregate`) when conversation feedback arrives;
 * derives the same 4 pieces of state (`comparisonMetrics`, `milestone`,
 * `errorJourney`, `nextAction`) from the single aggregate response. Closes
 * audit P2-4.
 *
 * The 4 derivation algorithms are preserved byte-faithful from the
 * pre-13-3 inline logic; only the data SOURCE changes (server-side
 * pre-computed scalars instead of N round-trips to fetch raw rows + N
 * client-side max/filter computations).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getSessionFeedbackAggregate,
  type SessionFeedbackAggregate,
} from "@/src/lib/session-feedback-aggregate";
import { captureError } from "@/src/lib/sentry";
import type { Correction, ConversationFeedback } from "@/src/types/conversation";
import type {
  MilestoneBannerProps,
  MilestoneType,
} from "@/src/components/feedback/MilestoneBanner";
import type { SessionComparisonMetric } from "@/src/components/feedback/SessionComparison";

// ---------------------------------------------------------------------------
// Hook inputs / outputs
// ---------------------------------------------------------------------------

export interface UseSessionFeedbackAggregateOptions {
  /** The user's UUID — null disables the hook (pre-auth render). */
  userId: string | null | undefined;
  /** The just-completed conversation's UUID — null disables the hook. */
  conversationId: string | null | undefined;
  /** CEFR level captured at conversation start (for promotion detection). */
  preConversationCefrLevel: string | null;
  /** The post-conversation AI feedback (Story 11-1 schema). null disables the hook. */
  currentFeedback: ConversationFeedback | null | undefined;
  /** Duration of the just-completed conversation in seconds. */
  currentDurationSeconds: number;
  /** Story 11-1 corrections array — used for next-action category counting. */
  allCorrections: (Correction | string)[] | null | undefined;
}

export interface UseSessionFeedbackAggregateReturn {
  comparisonMetrics: SessionComparisonMetric[] | null;
  milestone: MilestoneBannerProps | null;
  errorJourney: { total: number; resolved: number } | null;
  nextAction: { label: string; route: string; params?: Record<string, string> } | null;
}

// ---------------------------------------------------------------------------
// Pure derivation helpers (byte-faithful from pre-13-3 inline logic)
// ---------------------------------------------------------------------------

function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 1 ? "< 1m" : `${m}m`;
}

function direction(current: number, previous: number): "up" | "down" | "same" {
  return current > previous ? "up" : current < previous ? "down" : "same";
}

/**
 * Pre-13-3 Effect 1 (session-comparison) — byte-faithful. Aggregate's
 * `prev_session` is already gated on the 21-day cutoff server-side
 * (the pre-13-3 client-side filter at line 266-273 is now redundant by
 * construction).
 */
function deriveComparisonMetrics(
  aggregate: SessionFeedbackAggregate,
  currentFeedback: ConversationFeedback,
  currentDurationSeconds: number
): SessionComparisonMetric[] | null {
  const prev = aggregate.prev_session;
  if (!prev) return null;

  const prevFeedback = prev.ai_feedback;
  if (
    prevFeedback?.fluencyRating == null ||
    prevFeedback?.grammarRating == null ||
    currentFeedback.fluencyRating == null ||
    currentFeedback.grammarRating == null
  ) {
    return null;
  }

  return [
    {
      label: "Fluency",
      previous: `${prevFeedback.fluencyRating}/5`,
      current: `${currentFeedback.fluencyRating}/5`,
      direction: direction(currentFeedback.fluencyRating, prevFeedback.fluencyRating),
    },
    {
      label: "Grammar",
      previous: `${prevFeedback.grammarRating}/5`,
      current: `${currentFeedback.grammarRating}/5`,
      direction: direction(currentFeedback.grammarRating, prevFeedback.grammarRating),
    },
    {
      label: "Duration",
      previous: formatMinutes(prev.duration_seconds ?? 0),
      current: formatMinutes(currentDurationSeconds),
      direction: direction(currentDurationSeconds, prev.duration_seconds ?? 0),
    },
  ];
}

/**
 * Pre-13-3 Effect 2 (milestone-detection) — byte-faithful priority order:
 * CEFR promotion > personal best > error resolution > null. The pre-13-3
 * client-side `max(fluencyRating)` / `max(grammarRating)` loop is replaced
 * by the aggregate's pre-computed scalars (the unbounded-query
 * elimination that drives the audit P2-4 win).
 */
function deriveMilestone(
  aggregate: SessionFeedbackAggregate,
  currentFeedback: ConversationFeedback
): MilestoneBannerProps | null {
  // Priority 1: CEFR promotion.
  if (aggregate.cefr_promotion) {
    return {
      icon: "🌟",
      title: "CEFR Promotion!",
      subtitle: `Welcome to ${aggregate.cefr_promotion.to}!`,
      type: "cefr_promotion" satisfies MilestoneType,
    };
  }

  // Priority 2: Personal best — only if there ARE previous conversations
  // (maxFluency > 0 OR maxGrammar > 0 means at least one prev with the
  // rating present). Mirrors pre-13-3 `maxFluency > 0` guard at line 373.
  const maxFluency = aggregate.max_fluency_rating;
  const maxGrammar = aggregate.max_grammar_rating;
  const currentFluency = currentFeedback.fluencyRating ?? 0;
  const currentGrammar = currentFeedback.grammarRating ?? 0;

  const fluencyBest = currentFluency > maxFluency && maxFluency > 0;
  const grammarBest = currentGrammar > maxGrammar && maxGrammar > 0;

  if (fluencyBest || grammarBest) {
    const subtitle =
      fluencyBest && grammarBest
        ? `Fluency ${currentFluency}/5 & Grammar ${currentGrammar}/5`
        : fluencyBest
          ? `Your best fluency score: ${currentFluency}/5`
          : `Your best grammar score: ${currentGrammar}/5`;
    return {
      icon: "🏆",
      title: "New Personal Best!",
      subtitle,
      type: "personal_best" satisfies MilestoneType,
    };
  }

  // Priority 3: Error resolution.
  if (aggregate.recent_resolved_error) {
    return {
      icon: "🎯",
      title: "Pattern Resolved!",
      subtitle: aggregate.recent_resolved_error.error_description,
      type: "error_resolved" satisfies MilestoneType,
    };
  }

  return null;
}

/**
 * Pre-13-3 Effect 3 (error-journey-counts) — byte-faithful. The aggregate's
 * `error_counts` is already an atomic snapshot via COUNT(*) FILTER
 * (Story 13-2 P2 pattern). Pre-13-3 the count race could produce
 * `resolved > total`; post-13-3 atomically consistent by construction.
 */
function deriveErrorJourney(
  aggregate: SessionFeedbackAggregate
): { total: number; resolved: number } | null {
  const total = aggregate.error_counts.total;
  if (total === 0) return null;
  return { total, resolved: aggregate.error_counts.resolved };
}

/**
 * Pre-13-3 Effect 4 (next-action) — byte-faithful. Pure computation from
 * `feedback.improvements` text + corrections category counts; no DB query.
 * Lifted from `[sessionId].tsx:464-508` unchanged.
 */
function deriveNextAction(
  feedback: ConversationFeedback,
  corrections: (Correction | string)[] | null | undefined
): { label: string; route: string; params?: Record<string, string> } {
  const safeCorrections = corrections ?? [];
  const categoryCounts = { pronunciation: 0, grammar: 0, vocabulary: 0, register: 0 };
  for (const c of safeCorrections) {
    if (typeof c !== "string" && c.category) {
      categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
    }
  }

  const improvementsText = (feedback.improvements ?? []).join(" ").toLowerCase();

  if (
    categoryCounts.pronunciation > 0 ||
    improvementsText.includes("prononciation") ||
    improvementsText.includes("pronunciation") ||
    improvementsText.includes("accent")
  ) {
    return { label: "Practice Pronunciation", route: "/(tabs)/practice/pronunciation" };
  } else if (
    categoryCounts.grammar > 0 ||
    improvementsText.includes("grammar") ||
    improvementsText.includes("grammaire")
  ) {
    const firstGrammarError = safeCorrections.find(
      (c) => typeof c !== "string" && c.category === "grammar"
    );
    return {
      label: "Review Grammar",
      route: "/(tabs)/practice/grammar",
      params:
        firstGrammarError && typeof firstGrammarError !== "string"
          ? { errorType: firstGrammarError.explanation }
          : undefined,
    };
  } else if (categoryCounts.vocabulary > 0 || improvementsText.includes("vocabul")) {
    return { label: "Review Vocabulary", route: "/(tabs)/practice/vocabulary" };
  } else {
    return { label: "Continue Practicing", route: "/(tabs)/practice" };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook consolidating the pre-13-3 4-effect waterfall into a single chokepoint.
 * Fires ONE `get_session_feedback_aggregate` RPC per feedback arrival;
 * derives all 4 outputs (`comparisonMetrics`, `milestone`, `errorJourney`,
 * `nextAction`) from the response.
 *
 * Public API byte-identical to the pre-13-3 4-useState pieces — JSX
 * consumer site in `[sessionId].tsx` doesn't change shape.
 *
 * Story 12-9 mountedRef pattern: setState calls are guarded against
 * stale-resolve-after-unmount races (user navigates away mid-fetch).
 */
export function useSessionFeedbackAggregate(
  options: UseSessionFeedbackAggregateOptions
): UseSessionFeedbackAggregateReturn {
  const {
    userId,
    conversationId,
    preConversationCefrLevel,
    currentFeedback,
    currentDurationSeconds,
    allCorrections,
  } = options;

  const [comparisonMetrics, setComparisonMetrics] = useState<SessionComparisonMetric[] | null>(
    null
  );
  const [milestone, setMilestone] = useState<MilestoneBannerProps | null>(null);
  const [errorJourney, setErrorJourney] = useState<{
    total: number;
    resolved: number;
  } | null>(null);
  const [nextAction, setNextAction] = useState<{
    label: string;
    route: string;
    params?: Record<string, string>;
  } | null>(null);

  const mountedRef = useRef(true);

  // Derive next-action synchronously from feedback + corrections — it
  // doesn't depend on the aggregate (pre-13-3 Effect 4 was its own
  // useEffect because the screen split logic into 4 effects; post-13-3
  // we centralize but next-action can resolve before the RPC returns).
  const applyNextAction = useCallback(() => {
    if (!currentFeedback) return;
    if (!mountedRef.current) return;
    setNextAction(deriveNextAction(currentFeedback, allCorrections));
  }, [currentFeedback, allCorrections]);

  useEffect(() => {
    applyNextAction();
  }, [applyNextAction]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId || !conversationId || !currentFeedback) return;

    let cancelled = false;

    void (async () => {
      try {
        const aggregate = await getSessionFeedbackAggregate(
          userId,
          conversationId,
          preConversationCefrLevel
        );
        if (cancelled || !mountedRef.current) return;

        setComparisonMetrics(
          deriveComparisonMetrics(aggregate, currentFeedback, currentDurationSeconds)
        );
        setMilestone(deriveMilestone(aggregate, currentFeedback));
        setErrorJourney(deriveErrorJourney(aggregate));
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        // The RPC layer already captured to Sentry with feature tag
        // "session-feedback-aggregate-fetch"; we just log a separate
        // hook-context breadcrumb here for the failure path. Pre-13-3
        // had 5 distinct catch sites; post-13-3 collapses to one.
        captureError(err, "session-feedback-aggregate-fetch");
        setComparisonMetrics(null);
        setMilestone(null);
        setErrorJourney(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, conversationId, currentFeedback, currentDurationSeconds, preConversationCefrLevel]);

  return { comparisonMetrics, milestone, errorJourney, nextAction };
}
