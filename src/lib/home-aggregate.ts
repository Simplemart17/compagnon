/**
 * Story 13-2 — Home aggregate RPC client helper.
 *
 * Wraps the `get_home_aggregate(p_user_id, p_date)` Postgres RPC
 * (`supabase/migrations/20260515000000_get_home_aggregate_rpc.sql`) and
 * returns a single typed JSONB blob with 9 home-screen-relevant fields.
 * Consolidates 9 of the 11 pre-13-2 home-mount queries into one round-trip
 * (closes audit P2-5).
 *
 * The 2 queries NOT consolidated:
 *   1. `retrieveDailyGreetingMemories` in `src/lib/memory.ts` — requires
 *      a query embedding for `match_memories` vector similarity (kept
 *      separate; client-side module-level cache memoizes the embedding).
 *   2. (none — the aggregate covers everything else.)
 *
 * Cross-story invariants preserved by construction:
 *   - Story 9-3 telemetry allowlist: NEW feature tag `home-aggregate-fetch`
 *     is a short categorical string (well under the 80-char redaction
 *     threshold); no new extras keys.
 *   - Story 9-4 stored-prompt-injection: this helper returns DB rows
 *     verbatim; the consumer (`use-daily-briefing.ts` `composeMessage` +
 *     `buildTodayPlan`) calls `sanitizeMemoryContent` at read-time on any
 *     `error_description` that flows to the UI.
 *   - Story 9-9 SQL hardening: the underlying RPC is SECURITY DEFINER +
 *     SET search_path + auth.uid() check (pinned by the migration drift
 *     detector at `src/lib/__tests__/get-home-aggregate-rpc-migration-drift.test.ts`).
 */

import type { TCFSkill } from "@/src/types/cefr";

import { captureError } from "./sentry";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Types — mirror the SQL function's JSONB output shape exactly.
// ---------------------------------------------------------------------------

export interface HomeAggregateSkill {
  skill: TCFSkill;
  cefr_level: string;
  score: number;
  exercises_completed: number;
  total_time_minutes: number;
}

export interface HomeAggregateDailyActivity {
  date: string;
  minutes_practiced: number;
  exercises_completed: number;
  conversations_completed: number;
  words_learned: number;
}

export interface HomeAggregateError {
  id: string;
  error_type: string;
  error_description: string;
  occurrences: number;
  resolved: boolean;
}

export interface HomeAggregateWeakestSkill {
  skill: TCFSkill;
  average_score: number;
}

export interface HomeAggregateErrorCounts {
  total: number;
  resolved: number;
}

export interface HomeAggregate {
  skills: HomeAggregateSkill[];
  daily_activity_today: HomeAggregateDailyActivity | null;
  recent_activity: HomeAggregateDailyActivity[];
  top_errors: HomeAggregateError[];
  streak_days: number;
  weakest_skill: HomeAggregateWeakestSkill | null;
  srs_due_count: number;
  error_counts: HomeAggregateErrorCounts;
  has_activity_today: boolean;
}

// ---------------------------------------------------------------------------
// Shape guard — defensive against malformed Postgres responses.
// ---------------------------------------------------------------------------

/**
 * Verify that an unknown Postgres response matches the expected
 * `HomeAggregate` shape. Defends against (a) a future RPC version that
 * drops or renames a key, (b) a schema-drift where a count field returns
 * NULL instead of 0, (c) test mocks that forget a key.
 *
 * Returns `false` on any deviation; caller's catch path can route through
 * `cacheWithFallback` for offline-fallback (Story 9-10 resilience pattern).
 */
export function isValidHomeAggregate(value: unknown): value is HomeAggregate {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.skills)) return false;
  // Story 13-2 review-round-1 P8: per-row inner shape validation. Pre-
  // patch the guard only checked `Array.isArray(skills)` — a future RPC
  // dropping `score` from a row would pass the outer guard then crash
  // downstream on `.toFixed()`. Now every skill row must have all 5
  // fields with correct types.
  for (const skill of v.skills) {
    if (typeof skill !== "object" || skill === null) return false;
    const s = skill as Record<string, unknown>;
    if (typeof s.skill !== "string") return false;
    if (typeof s.cefr_level !== "string") return false;
    if (typeof s.score !== "number") return false;
    if (typeof s.exercises_completed !== "number") return false;
    if (typeof s.total_time_minutes !== "number") return false;
  }
  if (
    v.daily_activity_today !== null &&
    (typeof v.daily_activity_today !== "object" || v.daily_activity_today === null)
  ) {
    return false;
  }
  if (!Array.isArray(v.recent_activity)) return false;
  if (!Array.isArray(v.top_errors)) return false;
  // P8 cont'd: top_errors row shape — id + error_type + error_description
  // + occurrences + resolved.
  for (const err of v.top_errors) {
    if (typeof err !== "object" || err === null) return false;
    const e = err as Record<string, unknown>;
    if (typeof e.id !== "string") return false;
    if (typeof e.error_type !== "string") return false;
    if (typeof e.error_description !== "string") return false;
    if (typeof e.occurrences !== "number") return false;
    if (typeof e.resolved !== "boolean") return false;
  }
  if (typeof v.streak_days !== "number") return false;
  if (
    v.weakest_skill !== null &&
    (typeof v.weakest_skill !== "object" || v.weakest_skill === null)
  ) {
    return false;
  }
  // P8 cont'd: weakest_skill row shape (if non-null).
  if (v.weakest_skill !== null) {
    const ws = v.weakest_skill as Record<string, unknown>;
    if (typeof ws.skill !== "string") return false;
    if (typeof ws.average_score !== "number") return false;
  }
  if (typeof v.srs_due_count !== "number") return false;
  if (typeof v.error_counts !== "object" || v.error_counts === null) return false;
  const ec = v.error_counts as Record<string, unknown>;
  if (typeof ec.total !== "number" || typeof ec.resolved !== "number") return false;
  if (typeof v.has_activity_today !== "boolean") return false;
  return true;
}

// ---------------------------------------------------------------------------
// RPC client
// ---------------------------------------------------------------------------

/**
 * Fetch the home aggregate for a user + date via the `get_home_aggregate`
 * RPC. Throws on RPC error or shape-validation failure; the caller's
 * `cacheWithFallback` wrapper provides offline-fallback semantics
 * (Story 9-10 pattern).
 *
 * @param userId The user's UUID (must match `auth.uid()` — server enforces).
 * @param date The local-timezone YYYY-MM-DD date for "today" lookups
 *   (from `getLocalDateString()` in `src/lib/activity.ts`; preserves the
 *   Story 9-2 local-timezone fix).
 */
export async function getHomeAggregate(userId: string, date: string): Promise<HomeAggregate> {
  // Story 13-2 review-round-1 P3: pass client's `now()` as ISO string so
  // the SRS-due cutoff shares the same "now" definition as the local-date
  // used for `daily_activity_today`. Pre-patch the RPC used Postgres-UTC
  // `now()` while the date filter used the client's local-date — mixed
  // definitions near midnight produced UX bugs (user sees has_activity_today
  // = false AND srs_due_count reflecting UTC-now in the same payload).
  const { data, error } = await supabase.rpc("get_home_aggregate", {
    p_user_id: userId,
    p_date: date,
    p_now: new Date().toISOString(),
  });

  if (error) {
    captureError(error, "home-aggregate-fetch");
    throw error;
  }

  if (!isValidHomeAggregate(data)) {
    const err = new Error("get_home_aggregate returned malformed shape");
    captureError(err, "home-aggregate-fetch");
    throw err;
  }

  return data;
}
