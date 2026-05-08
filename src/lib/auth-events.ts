/**
 * Auth Event Decision Helper
 *
 * Pure decision logic for the Supabase auth listener. Given a Supabase
 * `AuthChangeEvent` plus the current `Session | null`, returns a discriminated
 * `AuthEventAction` describing the side-effects the listener should perform.
 *
 * Decoupled from React state, the Supabase client, and cache I/O so it can be
 * unit-tested by replaying synthetic event sequences. See
 * `src/lib/__tests__/auth-events.test.ts`.
 *
 * Per-event branch table (see story 9-6):
 *
 *   event                       | session  | action
 *   ─────────────────────────── | ──────── | ──────────────────────────────────
 *   INITIAL_SESSION             | present  | load-profile (flushQueue=true,  invalidateCache=false)
 *   INITIAL_SESSION             | null     | clear-profile
 *   SIGNED_IN                   | present  | load-profile (flushQueue=true,  invalidateCache=false)
 *   SIGNED_OUT                  | any      | clear-profile
 *   USER_UPDATED                | present  | load-profile (flushQueue=false, invalidateCache=true)
 *   USER_UPDATED                | null     | no-session-warning
 *   TOKEN_REFRESHED             | present  | session-only
 *   TOKEN_REFRESHED             | null     | no-session-warning
 *   PASSWORD_RECOVERY           | present  | session-only
 *   PASSWORD_RECOVERY           | null     | no-session-warning
 *   MFA_CHALLENGE_VERIFIED      | present  | session-only
 *   MFA_CHALLENGE_VERIFIED      | null     | no-session-warning
 *
 * Rationale (story 9-6):
 * - `setSession(session)` is ALWAYS run by the caller (every event), so JWT
 *   consumers see the freshest token. This helper does not return that — it's
 *   implicit in the listener wiring.
 * - `TOKEN_REFRESHED` was the cause of P0-7: it fires roughly every hour for
 *   any active session and was triggering a full profile fetch + queue flush.
 *   It now resolves to `session-only` — no expensive work.
 * - `USER_UPDATED` is the only `load-profile` action that invalidates the
 *   profile cache, since it's the case where the DB row genuinely changed.
 * - Null-session events that are NOT `SIGNED_OUT` resolve to
 *   `no-session-warning` so the listener can breadcrumb to Sentry without
 *   destroying the local profile (defects D7).
 */

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

/**
 * Discriminated side-effect description for the auth listener.
 *
 * - `load-profile` — fetch profile (with optional cache invalidation) and
 *   optionally flush the offline write queue.
 * - `clear-profile` — clear local profile, set isLoading=false; do NOT flush.
 * - `session-only` — no profile work; `setSession(session)` already happened
 *   in the caller.
 * - `no-session-warning` — null session arrived on a non-`SIGNED_OUT` event
 *   (rare refresh failure). Caller breadcrumbs to Sentry; does NOT destroy
 *   local profile state.
 */
export type AuthEventAction =
  | { kind: "load-profile"; userId: string; flushQueue: boolean; invalidateCache: boolean }
  | { kind: "clear-profile" }
  | { kind: "session-only" }
  | { kind: "no-session-warning"; phase: AuthChangeEvent };

/**
 * Pure decision: given a Supabase auth event + session, what side-effect
 * should the listener perform?
 *
 * @param event   The Supabase AuthChangeEvent discriminator.
 * @param session The current session, or null.
 * @returns A discriminated AuthEventAction describing what the caller should do.
 */
export function decideAuthAction(event: AuthChangeEvent, session: Session | null): AuthEventAction {
  // SIGNED_OUT always clears the profile, regardless of whether Supabase
  // happened to pass a session (defensive — Supabase typically passes null).
  if (event === "SIGNED_OUT") {
    return { kind: "clear-profile" };
  }

  if (!session) {
    if (event === "INITIAL_SESSION") {
      return { kind: "clear-profile" };
    }
    return { kind: "no-session-warning", phase: event };
  }

  switch (event) {
    case "INITIAL_SESSION":
    case "SIGNED_IN":
      return {
        kind: "load-profile",
        userId: session.user.id,
        flushQueue: true,
        invalidateCache: false,
      };
    case "USER_UPDATED":
      return {
        kind: "load-profile",
        userId: session.user.id,
        flushQueue: false,
        invalidateCache: true,
      };
    case "TOKEN_REFRESHED":
    case "PASSWORD_RECOVERY":
    case "MFA_CHALLENGE_VERIFIED":
      return { kind: "session-only" };
    default: {
      // Compile-time exhaustiveness check: if Supabase adds a new
      // AuthChangeEvent member, the assignment below fails to type-check
      // (the new value won't be assignable to `never`), forcing a code update.
      // Runtime fallback: return `session-only` so the listener still updates
      // the JWT ref and does not crash on an unrecognised event in the wild.
      const _exhaustive: never = event;
      void _exhaustive;
      return { kind: "session-only" };
    }
  }
}
