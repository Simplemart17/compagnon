/**
 * CEFR History Hook
 *
 * Fetches CEFR level progression data for the chart on the profile screen.
 *
 * Since skill_progress only stores the current state (not a historical log),
 * we synthesize a timeline from:
 * 1. The profile's created_at as the starting point (initial level)
 * 2. Each skill_progress row's cefr_level + updated_at as data points
 *
 * The "overall" level is taken from profiles.current_cefr_level with its
 * updated_at timestamp, representing the most recent CEFR promotion.
 */

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { useAuthStore } from "@/src/store/auth-store";
import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single data point on the CEFR progression timeline. */
export interface CEFRDataPoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** The CEFR level at this point in time */
  level: CEFRLevel;
  /** Label for tooltip/accessibility (e.g. "Overall", "Listening") */
  label: string;
}

export interface CEFRHistoryState {
  /** Ordered list of data points (ascending by date) */
  dataPoints: CEFRDataPoint[];
  /** The user's target CEFR level */
  targetLevel: CEFRLevel;
  /** The user's current overall CEFR level */
  currentLevel: CEFRLevel;
  /** Whether data is being fetched */
  loading: boolean;
  /** Error message, if any */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Extract YYYY-MM-DD from an ISO timestamp string. */
function toDateString(isoTimestamp: string): string {
  return isoTimestamp.split("T")[0];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCefrHistory(): CEFRHistoryState & { refresh: () => Promise<void> } {
  const user = useAuthStore((s) => s.user);

  const [state, setState] = useState<CEFRHistoryState>({
    dataPoints: [],
    targetLevel: "C1",
    currentLevel: "A1",
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!user) return;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Fetch profile and skill_progress in parallel
      const [profileResult, skillsResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("current_cefr_level, target_cefr_level, created_at, updated_at")
          .eq("id", user.id)
          .single(),
        supabase
          .from("skill_progress")
          .select("skill, cefr_level, updated_at")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: true }),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (skillsResult.error) throw skillsResult.error;

      const profile = profileResult.data;
      const skills = skillsResult.data ?? [];

      const currentLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
      const targetLevel = (profile?.target_cefr_level ?? "C1") as CEFRLevel;
      const profileCreatedAt = profile?.created_at ?? new Date().toISOString();

      // Build timeline:
      // 1. Start with the earliest possible level at account creation.
      //    We infer the starting level as the minimum of the current overall
      //    level and the lowest skill level. If no skills exist yet, use current.
      const skillLevels = skills.map((s) => s.cefr_level as CEFRLevel);
      const allLevels = [currentLevel, ...skillLevels];
      const lowestLevelIdx = Math.min(...allLevels.map((l) => CEFR_ORDER.indexOf(l)));
      // The starting level is at most the lowest observed level
      // (users could have started at A1 or self-declared a higher level)
      const startLevel = CEFR_ORDER[Math.max(0, lowestLevelIdx)] as CEFRLevel;

      const points: CEFRDataPoint[] = [];

      // Starting data point: account creation
      points.push({
        date: toDateString(profileCreatedAt),
        level: startLevel,
        label: "Niveau initial",
      });

      // Add a data point for each skill's current state.
      // Group by date to avoid cluttering: if multiple skills updated same day,
      // pick the highest level for that day.
      const byDate = new Map<string, { level: CEFRLevel; labels: string[] }>();

      for (const skill of skills) {
        const date = toDateString(skill.updated_at as string);
        const level = skill.cefr_level as CEFRLevel;
        const skillName = skill.skill as string;
        const existing = byDate.get(date);

        if (existing) {
          const existingIdx = CEFR_ORDER.indexOf(existing.level);
          const newIdx = CEFR_ORDER.indexOf(level);
          if (newIdx > existingIdx) {
            existing.level = level;
          }
          existing.labels.push(skillName);
        } else {
          byDate.set(date, { level, labels: [skillName] });
        }
      }

      // Add grouped skill points, but skip duplicates of the start point
      const startDate = toDateString(profileCreatedAt);
      for (const [date, entry] of byDate) {
        // Skip if this is the same date and level as the start point
        if (date === startDate && entry.level === startLevel) continue;

        points.push({
          date,
          level: entry.level,
          label: entry.labels.join(", "),
        });
      }

      // If the current overall level differs from the last point,
      // add it as the most recent point
      const profileUpdatedAt = profile?.updated_at ?? profileCreatedAt;
      const lastPoint = points[points.length - 1];
      if (
        lastPoint &&
        (lastPoint.level !== currentLevel || toDateString(profileUpdatedAt) !== lastPoint.date)
      ) {
        const profileDate = toDateString(profileUpdatedAt);
        // Only add if it would advance beyond the last point
        const lastIdx = CEFR_ORDER.indexOf(lastPoint.level);
        const currentIdx = CEFR_ORDER.indexOf(currentLevel);
        if (currentIdx > lastIdx || profileDate !== lastPoint.date) {
          points.push({
            date: profileDate,
            level: currentLevel,
            label: "Niveau actuel",
          });
        }
      }

      // Sort by date ascending, then by level ascending for same-day entries
      points.sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return CEFR_ORDER.indexOf(a.level) - CEFR_ORDER.indexOf(b.level);
      });

      // Deduplicate: keep only points where level changes or it's the first/last
      const deduped: CEFRDataPoint[] = [];
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const prev = deduped[deduped.length - 1];
        if (!prev || prev.level !== point.level || i === points.length - 1) {
          deduped.push(point);
        }
      }

      setState({
        dataPoints: deduped,
        targetLevel,
        currentLevel,
        loading: false,
        error: null,
      });
    } catch (err) {
      captureError(err, "cefr-history");
      const message = err instanceof Error ? err.message : "Failed to load progression data";
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
