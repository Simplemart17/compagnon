import { useEffect } from "react";

import { decideAuthAction } from "@/src/lib/auth-events";
import {
  cacheWithFallback,
  invalidateCache,
  clearUserCache,
  flushWriteQueue,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/src/lib/cache";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import type { UserProfile } from "@/src/types/user";

/**
 * Pure decision helper for the userId-guard on profile loads (story 9-10, AC #1).
 *
 * When a `loadProfile(userIdA)` call is in-flight and `SIGNED_OUT` (or sign-in
 * as `userIdB`) fires before the profile resolves, the result must NOT be
 * applied — the local state has already moved on. This helper is the branch
 * decision; the call site in `loadProfile` wires it to `setProfile` /
 * `flushWriteQueue` / `addBreadcrumb`.
 *
 * Pure so it can be unit-tested without React or Zustand. See
 * `src/lib/__tests__/auth-load-profile-stale.test.ts`.
 *
 * @param loadedUserId   The userId that originated the in-flight `loadProfile`.
 * @param currentUserId  The userId currently held in `useAuthStore` (or
 *                       `undefined` if signed out).
 * @returns `"apply"` when the load is still fresh, `"drop-stale"` otherwise.
 */
export type ApplyProfileDecision = "apply" | "drop-stale";

export function applyProfileIfFresh(
  loadedUserId: string,
  currentUserId: string | undefined
): ApplyProfileDecision {
  return currentUserId === loadedUserId ? "apply" : "drop-stale";
}

/**
 * Initialize auth listener and load user profile.
 *
 * Auth listener event gating (story 9-6): the `onAuthStateChange` callback
 * delegates per-event side-effect decisions to `decideAuthAction()` so that
 * `TOKEN_REFRESHED` (fires roughly every hour for active sessions) does NOT
 * trigger a profile fetch or write-queue flush. Only `INITIAL_SESSION` /
 * `SIGNED_IN` / `USER_UPDATED` re-load the profile, and only `INITIAL_SESSION`
 * / `SIGNED_IN` flush the offline write queue. `SIGNED_OUT` clears the local
 * profile. `PASSWORD_RECOVERY` / `MFA_CHALLENGE_VERIFIED` only update the
 * session ref (so JWT consumers see the freshest token). The per-event
 * decision is unit-tested in `src/lib/__tests__/auth-events.test.ts`.
 *
 * The cold-start `supabase.auth.getSession()` call is wrapped with a
 * `captureError(_, "auth-initial-session")` catch so a corrupted SecureStore
 * does not surface as an unhandled promise rejection. Cold-start profile
 * loading is delegated to the listener's `INITIAL_SESSION` branch — the
 * initial `getSession()` only warms the session ref before paint.
 *
 * Auth + cache race hardening (story 9-10):
 * - `loadProfile` wraps `setProfile` and `flushWriteQueue` with a userId-guard
 *   (`applyProfileIfFresh`) so an in-flight load that resolves after
 *   `SIGNED_OUT` (or a sign-in as a different user) does not clobber the
 *   cleared profile or flush the previous user's queue. The dropped result is
 *   breadcrumbed with `phase: "load-profile-stale"`.
 * - `loadProfile`'s catch path sets `profileFetchFailed = true` so the auth
 *   guard at `app/_layout.tsx` can route to a retry surface (rather than
 *   `/onboarding`) when both network and cache reads fail. Successful loads
 *   clear the flag; `reset()` clears it on sign-out.
 * - `retryProfileFetch` is exposed for the retry CTA — a flush-skipping
 *   re-invocation of `loadProfile(user.id)`.
 */
export function useAuth() {
  const {
    session,
    user,
    profile,
    isLoading,
    isOnboarded,
    profileFetchFailed,
    setSession,
    setProfile,
    setLoading,
  } = useAuthStore();

  useEffect(() => {
    // Cold-start: capture any AuthError surfaced through the resolved Promise
    // and protect against unhandled rejection on a corrupted SecureStore.
    //
    // We do NOT call `setSession(session)` here — `onAuthStateChange` emits
    // `INITIAL_SESSION` synchronously inside the `.subscribe` call below
    // (Supabase auth-js contract), so the listener installs the session
    // before this `.then` microtask resolves. Calling `setSession` here
    // would race with the listener and could overwrite a fresher session.
    // The `setLoading(false)` no-session bail-out is kept as a safety net
    // in case the listener fails to fire `INITIAL_SESSION` for any reason.
    void supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          captureError(error, "auth-initial-session");
        }
        if (!session) {
          setLoading(false);
        }
      })
      .catch((err) => {
        captureError(err, "auth-initial-session");
        setLoading(false);
      });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Always update the session ref so JWT consumers see the freshest token.
      setSession(session);

      const action = decideAuthAction(event, session);
      switch (action.kind) {
        case "load-profile":
          if (action.invalidateCache) {
            void invalidateCache(action.userId, CACHE_KEYS.PROFILE);
          }
          void loadProfile(action.userId, { flushQueue: action.flushQueue });
          return;
        case "clear-profile":
          setProfile(null);
          // Story 9-10 (P5 from 9-10 review): also clear the failure flag so
          // an auto-emitted `SIGNED_OUT` (token expiry / refresh failure /
          // server-side revocation) — which bypasses `signOut()`'s `reset()`
          // call — does not leave a stale `profileFetchFailed = true` into
          // the next session.
          useAuthStore.getState().setProfileFetchFailed(false);
          setLoading(false);
          return;
        case "session-only":
          // Token refreshes / password recovery / MFA verification — session
          // ref already updated above; no profile fetch, no flush.
          return;
        case "no-session-warning":
          // Null session arrived on a non-SIGNED_OUT event (rare refresh
          // failure). Breadcrumb to Sentry but do NOT destroy local profile.
          addBreadcrumb({
            category: "auth",
            level: "warning",
            message: "Auth event arrived with null session",
            data: { phase: action.phase },
          });
          return;
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Load the user's profile (with offline cache fallback) and optionally
   * flush the offline write queue.
   *
   * Story 9-10 (AC #1, #3) hardening:
   * - Both `setProfile` and `flushWriteQueue` are wrapped in a userId-guard
   *   (`applyProfileIfFresh`). If the current user in `useAuthStore` no
   *   longer matches the `userId` that originated this load (sign-out raced
   *   the in-flight fetch, or a new user signed in), the result is dropped
   *   silently with a `phase: "load-profile-stale"` breadcrumb — no
   *   `setProfile` and no queue flush on behalf of the wrong user.
   * - The catch path sets `profileFetchFailed = true` so the auth guard at
   *   `app/_layout.tsx` can route to a retry surface (rather than
   *   `/onboarding`) when both network and cache reads fail. The flag is
   *   cleared on a successful applied load and on `reset()`.
   *
   * @param userId  The authenticated user's ID.
   * @param opts.flushQueue  When true (default), flush the write queue after
   *   the profile load. The auth listener sets this to false on
   *   `USER_UPDATED` to avoid duplicating the queue flush on metadata edits.
   */
  async function loadProfile(
    userId: string,
    opts: { flushQueue?: boolean } = { flushQueue: true }
  ) {
    try {
      const { data: profile } = await cacheWithFallback<UserProfile | null>(
        userId,
        CACHE_KEYS.PROFILE,
        async () => {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();
          if (error) throw error;
          return data as UserProfile;
        },
        CACHE_TTL.PROFILE
      );

      // Story 9-10 AC #1 + P4 (9-10 review): once cacheWithFallback resolves
      // we are on a successful path regardless of whether `profile` is truthy
      // (a successful network call can legitimately return null when the row
      // is missing or RLS-filtered). Apply the userId-guard to BOTH the
      // setProfile branch AND the success-side flag clear so:
      //  - a stale-context resolution does not clobber the cleared profile
      //    (and emits a `phase: "load-profile-stale"` breadcrumb);
      //  - a fresh-context successful resolution always clears the failure
      //    flag, even when the resolved profile is null — otherwise a retry
      //    that happens to return null leaves the user pinned on
      //    `ProfileRetryScreen` forever.
      const currentUserIdAfterFetch = useAuthStore.getState().user?.id;
      if (applyProfileIfFresh(userId, currentUserIdAfterFetch) === "drop-stale") {
        addBreadcrumb({
          category: "auth",
          level: "info",
          message: "loadProfile result dropped — user changed mid-flight",
          data: { phase: "load-profile-stale" },
        });
        return; // do not apply or flush — the in-flight context is stale
      }

      if (profile) {
        setProfile(profile);
      }
      // P4 (9-10 review): clear the flag on ANY fresh-context success, not
      // only when `profile` is truthy.
      useAuthStore.getState().setProfileFetchFailed(false);

      // Flush any queued writes now that we have connectivity. The flush is
      // idempotent (story 9-6, `flushWriteQueue` in-flight guard) so concurrent
      // callers (this hook + NetworkBanner reconnect) do not double-replay.
      // The userId-guard above already proved freshness for the current
      // microtask; an interleaved sign-out between this point and
      // `flushWriteQueue` is a pre-existing race acknowledged in 9-6.
      if (opts.flushQueue ?? true) {
        void flushWriteQueue(supabase);
      }
    } catch (err) {
      // Expected degradation: both network and cache failed (e.g. offline cold start).
      // Only send to Sentry for unexpected errors, not routine network failures.
      const isNetworkError =
        err instanceof Error && /network|fetch|failed to fetch|offline/i.test(err.message);
      if (!isNetworkError) {
        captureError(err, "auth-load-profile");
      }
      // Story 9-10 AC #3: mark profile fetch as failed so the auth guard
      // routes to a retry surface instead of misrouting an already-onboarded
      // user to `/onboarding`.
      // P1 (9-10 review): only set the flag when the context is still fresh
      // — a catch that fires after sign-out (or sign-in as a different user)
      // must not pollute the new user's session with the stale failure.
      const currentUserIdAfterCatch = useAuthStore.getState().user?.id;
      if (applyProfileIfFresh(userId, currentUserIdAfterCatch) === "apply") {
        useAuthStore.getState().setProfileFetchFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * Retry a previously failed profile load (story 9-10, AC #3).
   *
   * Wraps `loadProfile(user.id, { flushQueue: false })` — `flushQueue` is
   * false because the failure path implies we are still recovering from an
   * offline state, and the queue flush is owned by reconnection
   * (`NetworkBanner`) rather than this retry surface.
   */
  async function retryProfileFetch(): Promise<void> {
    if (!user) return;
    await loadProfile(user.id, { flushQueue: false });
  }

  async function signInWithEmail(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }

  async function signUpWithEmail(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    return { data, error };
  }

  async function signOut() {
    const userId = user?.id;
    const { error } = await supabase.auth.signOut();
    if (!error) {
      if (userId) {
        void clearUserCache(userId);
      }
      useAuthStore.getState().reset();
    }
    return { error };
  }

  async function updateProfile(updates: Partial<UserProfile>) {
    if (!user) return { error: new Error("Not authenticated") };

    const { data, error } = await supabase
      .from("profiles")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single();

    // If update found no row (profile wasn't created by trigger), upsert instead
    if (error && !data) {
      const { data: upsertData, error: upsertError } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          full_name: user.user_metadata?.full_name ?? null,
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (upsertData && !upsertError) {
        const updatedProfile = upsertData as UserProfile;
        setProfile(updatedProfile);
        void invalidateCache(user.id, CACHE_KEYS.PROFILE);
      }
      return { data: upsertData, error: upsertError };
    }

    if (data && !error) {
      const updatedProfile = data as UserProfile;
      setProfile(updatedProfile);
      void invalidateCache(user.id, CACHE_KEYS.PROFILE);
    }
    return { data, error };
  }

  return {
    session,
    user,
    profile,
    isLoading,
    isOnboarded,
    profileFetchFailed,
    retryProfileFetch,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    updateProfile,
  };
}
