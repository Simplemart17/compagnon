/**
 * Story 13-3 — Session feedback aggregate RPC client helper.
 *
 * Wraps the `get_session_feedback_aggregate(p_user_id, p_conversation_id,
 * p_pre_cefr_level, p_now)` Postgres RPC
 * (`supabase/migrations/20260516000000_get_session_feedback_aggregate_rpc.sql`)
 * and returns a single typed JSONB blob with 5 (+1 nested) keys consolidating
 * the pre-13-3 4-effect waterfall in `[sessionId].tsx`. Closes audit P2-4.
 *
 * Critical improvement over the pre-13-3 fan-out: server-side `MAX` returns
 * 2 scalars (max_fluency_rating + max_grammar_rating) instead of the
 * unbounded `conversations.select(ai_feedback)` query that previously
 * transferred ALL of a user's prev ai_feedback JSONBs (~200KB for a power
 * user with 200+ conversations) just to compute 2 maxes client-side.
 *
 * Cross-story invariants preserved by construction:
 *   - Story 9-3 telemetry allowlist: NEW feature tag
 *     `session-feedback-aggregate-fetch` is a short categorical string
 *     under the 80-char redaction threshold; no new extras keys.
 *   - Story 9-9 SQL hardening: underlying RPC is SECURITY DEFINER + SET
 *     search_path + auth.uid() check (pinned by migration drift detector).
 *   - Story 13-2 P2 atomic-snapshot pattern: error_counts uses COUNT(*)
 *     FILTER server-side; eliminates the pre-13-3 two-query race.
 *   - Story 13-2 P3 timezone-consistency pattern: p_now ISO string passed
 *     from client so the 21-day + 5-minute cutoffs share the client's
 *     "now" definition.
 *   - Story 13-2 P5 unsafe-cast lesson: typed via dedicated interface;
 *     no `as` widening at consumer sites.
 *   - Story 13-2 P7/P8 lessons: per-key + per-nested-row validation in
 *     `isValidSessionFeedbackAggregate`.
 */

import { captureError } from "./sentry";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Types — mirror the SQL function's JSONB output shape exactly.
// ---------------------------------------------------------------------------

export interface SessionFeedbackAiFeedback {
  fluencyRating?: number;
  grammarRating?: number;
  // Other fields exist on conversations.ai_feedback but are not
  // structurally required for milestone/comparison logic — left as
  // permissive partial.
  [key: string]: unknown;
}

export interface SessionFeedbackPrevSession {
  ai_feedback: SessionFeedbackAiFeedback | null;
  duration_seconds: number | null;
  completed_at: string;
}

export interface SessionFeedbackCefrPromotion {
  from: string;
  to: string;
}

export interface SessionFeedbackResolvedError {
  error_description: string;
}

export interface SessionFeedbackErrorCounts {
  total: number;
  resolved: number;
}

export interface SessionFeedbackAggregate {
  prev_session: SessionFeedbackPrevSession | null;
  cefr_promotion: SessionFeedbackCefrPromotion | null;
  max_fluency_rating: number;
  max_grammar_rating: number;
  recent_resolved_error: SessionFeedbackResolvedError | null;
  error_counts: SessionFeedbackErrorCounts;
}

// ---------------------------------------------------------------------------
// Shape guard — Story 13-2 P7/P8 lesson: per-key + per-nested-row validation.
// ---------------------------------------------------------------------------

/**
 * Verify that an unknown Postgres response matches the expected
 * `SessionFeedbackAggregate` shape. Defends against (a) a future RPC
 * version dropping/renaming a key, (b) a schema drift where a count
 * field returns NULL instead of 0, (c) test mocks forgetting a key.
 *
 * Returns `false` on ANY deviation; the caller throws. The hook's catch
 * branch routes through `captureError` so the malformed response is
 * observable.
 */
export function isValidSessionFeedbackAggregate(value: unknown): value is SessionFeedbackAggregate {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  // prev_session — null or object with the 3 expected fields.
  if (v.prev_session !== null) {
    if (typeof v.prev_session !== "object" || v.prev_session === null) return false;
    const ps = v.prev_session as Record<string, unknown>;
    if (typeof ps.completed_at !== "string") return false;
    // ai_feedback can be null or object; duration_seconds can be null or number.
    if (
      ps.ai_feedback !== null &&
      (typeof ps.ai_feedback !== "object" || ps.ai_feedback === null)
    ) {
      return false;
    }
    if (ps.duration_seconds !== null && typeof ps.duration_seconds !== "number") {
      return false;
    }
  }

  // cefr_promotion — null or object with from + to strings.
  if (v.cefr_promotion !== null) {
    if (typeof v.cefr_promotion !== "object" || v.cefr_promotion === null) return false;
    const cp = v.cefr_promotion as Record<string, unknown>;
    if (typeof cp.from !== "string" || typeof cp.to !== "string") return false;
  }

  // max_fluency_rating + max_grammar_rating — numbers (server returns 0 when
  // no previous conversations exist).
  if (typeof v.max_fluency_rating !== "number") return false;
  if (typeof v.max_grammar_rating !== "number") return false;

  // recent_resolved_error — null or object with error_description string.
  if (v.recent_resolved_error !== null) {
    if (typeof v.recent_resolved_error !== "object" || v.recent_resolved_error === null) {
      return false;
    }
    const re = v.recent_resolved_error as Record<string, unknown>;
    if (typeof re.error_description !== "string") return false;
  }

  // error_counts — object with total + resolved as numbers.
  if (typeof v.error_counts !== "object" || v.error_counts === null) return false;
  const ec = v.error_counts as Record<string, unknown>;
  if (typeof ec.total !== "number" || typeof ec.resolved !== "number") return false;

  return true;
}

// ---------------------------------------------------------------------------
// RPC client
// ---------------------------------------------------------------------------

/**
 * Fetch the session-feedback aggregate via the `get_session_feedback_aggregate`
 * RPC. Throws on RPC error or shape-validation failure; the caller (the
 * `useSessionFeedbackAggregate` hook) catches + Sentry-routes + falls back
 * to null state.
 *
 * @param userId The user's UUID (must match `auth.uid()` — server enforces).
 * @param conversationId The just-completed conversation's UUID — excluded
 *   from prev-session lookup + max-rating computation (Story 13-3 spec).
 * @param preCefrLevel The CEFR level captured at conversation start. Server
 *   compares against current `profiles.current_cefr_level`; differing values
 *   trigger the `cefr_promotion` arm of the return blob.
 */
export async function getSessionFeedbackAggregate(
  userId: string,
  conversationId: string,
  preCefrLevel: string | null
): Promise<SessionFeedbackAggregate> {
  // Story 13-2 P3 timezone-consistency: pass client's "now" so the
  // server-side 21-day + 5-minute cutoffs share the client's clock
  // perception. DEFAULT now() in the RPC preserves 2-arg back-compat
  // for any future caller that omits it.
  const { data, error } = await supabase.rpc("get_session_feedback_aggregate", {
    p_user_id: userId,
    p_conversation_id: conversationId,
    p_pre_cefr_level: preCefrLevel,
    p_now: new Date().toISOString(),
  });

  if (error) {
    captureError(error, "session-feedback-aggregate-fetch");
    throw error;
  }

  if (!isValidSessionFeedbackAggregate(data)) {
    const err = new Error("get_session_feedback_aggregate returned malformed shape");
    captureError(err, "session-feedback-aggregate-fetch");
    throw err;
  }

  return data;
}
