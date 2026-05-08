import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { decideAuthAction } from "../auth-events";

/**
 * Build a minimal synthetic Session shaped enough for `decideAuthAction`.
 * The helper only reads `session.user.id`, so we cast the partial object.
 */
function makeSession(userId = "test-user-id"): Session {
  return { user: { id: userId } } as unknown as Session;
}

describe("decideAuthAction", () => {
  // Cases 1–4 — sign-in / cold-start / sign-out branches
  it("INITIAL_SESSION with session → load-profile (flush, no cache invalidation)", () => {
    const session = makeSession("u1");
    expect(decideAuthAction("INITIAL_SESSION", session)).toEqual({
      kind: "load-profile",
      userId: "u1",
      flushQueue: true,
      invalidateCache: false,
    });
  });

  it("INITIAL_SESSION with null session → clear-profile", () => {
    expect(decideAuthAction("INITIAL_SESSION", null)).toEqual({ kind: "clear-profile" });
  });

  it("SIGNED_IN with session → load-profile (flush, no cache invalidation)", () => {
    const session = makeSession("u2");
    expect(decideAuthAction("SIGNED_IN", session)).toEqual({
      kind: "load-profile",
      userId: "u2",
      flushQueue: true,
      invalidateCache: false,
    });
  });

  it("SIGNED_OUT with null session → clear-profile", () => {
    expect(decideAuthAction("SIGNED_OUT", null)).toEqual({ kind: "clear-profile" });
  });

  // Case 5 — defensive SIGNED_OUT carrying a session
  it("SIGNED_OUT with session (defensive) → clear-profile", () => {
    const session = makeSession("u3");
    expect(decideAuthAction("SIGNED_OUT", session)).toEqual({ kind: "clear-profile" });
  });

  // Case 6 — token refresh: the bug we're fixing
  it("TOKEN_REFRESHED with session → session-only (no profile fetch, no flush)", () => {
    const session = makeSession("u4");
    expect(decideAuthAction("TOKEN_REFRESHED", session)).toEqual({ kind: "session-only" });
  });

  // Case 7 — null session on a non-SIGNED_OUT event
  it("TOKEN_REFRESHED with null session → no-session-warning (does NOT destroy profile)", () => {
    expect(decideAuthAction("TOKEN_REFRESHED", null)).toEqual({
      kind: "no-session-warning",
      phase: "TOKEN_REFRESHED",
    });
  });

  // Case 8 — USER_UPDATED: refetch with cache bust, no queue flush
  it("USER_UPDATED with session → load-profile (no flush, WITH cache invalidation)", () => {
    const session = makeSession("u5");
    expect(decideAuthAction("USER_UPDATED", session)).toEqual({
      kind: "load-profile",
      userId: "u5",
      flushQueue: false,
      invalidateCache: true,
    });
  });

  // Case 9 — null on USER_UPDATED
  it("USER_UPDATED with null session → no-session-warning (phase=USER_UPDATED)", () => {
    expect(decideAuthAction("USER_UPDATED", null)).toEqual({
      kind: "no-session-warning",
      phase: "USER_UPDATED",
    });
  });

  // Case 10 — PASSWORD_RECOVERY
  it("PASSWORD_RECOVERY with session → session-only", () => {
    const session = makeSession("u6");
    expect(decideAuthAction("PASSWORD_RECOVERY", session)).toEqual({ kind: "session-only" });
  });

  // Case 11 — MFA_CHALLENGE_VERIFIED
  it("MFA_CHALLENGE_VERIFIED with session → session-only", () => {
    const session = makeSession("u7");
    expect(decideAuthAction("MFA_CHALLENGE_VERIFIED", session)).toEqual({ kind: "session-only" });
  });

  // Case 12 — repeated TOKEN_REFRESHED (24h foreground simulation)
  it("24 sequential TOKEN_REFRESHED events all resolve to session-only", () => {
    const session = makeSession("u8");
    for (let i = 0; i < 24; i++) {
      expect(decideAuthAction("TOKEN_REFRESHED", session)).toEqual({ kind: "session-only" });
    }
  });

  // Defensive: any future Supabase event we don't recognise should fall through
  // to session-only rather than throw or do expensive work.
  it("unrecognised event with session → session-only (exhaustiveness fallback)", () => {
    const session = makeSession("u9");
    const unknownEvent = "FUTURE_EVENT" as AuthChangeEvent;
    expect(decideAuthAction(unknownEvent, session)).toEqual({ kind: "session-only" });
  });
});
