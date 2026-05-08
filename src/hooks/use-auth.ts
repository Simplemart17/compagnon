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
 */
export function useAuth() {
  const { session, user, profile, isLoading, isOnboarded, setSession, setProfile, setLoading } =
    useAuthStore();

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

      if (profile) {
        setProfile(profile);
      }

      // Flush any queued writes now that we have connectivity. The flush is
      // idempotent (story 9-6, `flushWriteQueue` in-flight guard) so concurrent
      // callers (this hook + NetworkBanner reconnect) do not double-replay.
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
    } finally {
      setLoading(false);
    }
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
    signInWithEmail,
    signUpWithEmail,
    signOut,
    updateProfile,
  };
}
