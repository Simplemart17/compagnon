/**
 * Auth bootstrap module (Story 12-2).
 *
 * Installs the `supabase.auth.onAuthStateChange` listener + cold-start
 * `getSession` ONCE per app lifetime. Pre-12-2, this lived inside
 * `useAuth()`'s `useEffect`, so every consumer mount installed its own
 * listener — N consumers mounted concurrently meant N subscribers fan-out
 * on every auth event, N concurrent `loadProfile` calls, N concurrent
 * `cacheWithFallback` races.
 *
 * Post-12-2 a module-level `bootstrapState` one-call guard ensures only one
 * listener exists per app lifetime. `app/_layout.tsx` invokes
 * `bootstrapAuth()` at module-load time (top-level, outside the component
 * body) so the listener installs synchronously during JS bundle parse —
 * before any React render. The 5 action methods (`signInWithEmail` /
 * `signUpWithEmail` / `signOut` / `updateProfile` / `retryProfileFetch`)
 * are module-level static exports, not hook closures, so no per-render
 * allocation happens inside `useAuth()`.
 *
 * Story 9-6 (auth listener event gating) + Story 9-10 (auth + cache race
 * hardening) invariants are preserved verbatim — this story is a pure
 * call-site relocation, not a semantics change. `decideAuthAction` remains
 * the per-event branching helper; `applyProfileIfFresh` remains the
 * userId-guard. The cold-start `getSession()` call moves with the listener.
 *
 * The one-call guard is also defensive against React StrictMode double-mount
 * in dev (module load is cached per JS instance, but `bootstrapAuth()` may
 * still be invoked twice if a consumer accidentally calls it instead of
 * relying on the module-load top-level call).
 *
 * Public surface:
 * - `bootstrapAuth()` — idempotent install; returns teardown closure.
 * - `retryProfileFetch()` — exposed retry action (Story 9-10 AC #3).
 * - `signInWithEmail` / `signUpWithEmail` / `signOut` / `updateProfile` —
 *   static action methods (no React state captured; safe to call from any
 *   render or event handler).
 * - `__resetBootstrapForTests()` — test-only escape hatch to reset the
 *   singleton between tests. Marked `@internal`; must not be called from
 *   production code.
 */
import type { Session } from "@supabase/supabase-js";

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
 * Pure decision helper for the userId-guard on profile loads (Story 9-10
 * AC #1). When a `loadProfile(userIdA)` call is in-flight and `SIGNED_OUT`
 * (or sign-in as `userIdB`) fires before the profile resolves, the result
 * must NOT be applied — the local state has already moved on.
 *
 * Pre-12-2 this helper lived in `src/hooks/use-auth.ts`; Story 12-2 moves
 * it here together with `loadProfile`. `src/hooks/use-auth.ts` re-exports
 * it so existing test imports
 * (`src/lib/__tests__/auth-load-profile-stale.test.ts`) stay valid.
 */
export type ApplyProfileDecision = "apply" | "drop-stale";

export function applyProfileIfFresh(
  loadedUserId: string,
  currentUserId: string | undefined
): ApplyProfileDecision {
  return currentUserId === loadedUserId ? "apply" : "drop-stale";
}

/**
 * Module-level one-call guard. Stores the teardown closure from the
 * first `bootstrapAuth()` invocation so any subsequent call returns the
 * same teardown without re-subscribing.
 *
 * Mirrors Story 9-6's `flushWriteQueue` idempotency pattern
 * (`let inFlight: Promise<number> | null = null`).
 */
let bootstrapState: { teardown: () => void } | null = null;

/**
 * Install the supabase.auth.onAuthStateChange listener + cold-start
 * getSession once per app lifetime. Returns a teardown closure that
 * unsubscribes the listener.
 *
 * Idempotent — a second call returns the cached teardown without
 * re-subscribing. Safe to call from `app/_layout.tsx` module-load time.
 */
export function bootstrapAuth(): () => void {
  if (bootstrapState) return bootstrapState.teardown;

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
        useAuthStore.getState().setLoading(false);
      }
    })
    .catch((err) => {
      captureError(err, "auth-initial-session");
      useAuthStore.getState().setLoading(false);
    });

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    // Always update the session ref so JWT consumers see the freshest token.
    useAuthStore.getState().setSession(session);

    const action = decideAuthAction(event, session as Session | null);
    switch (action.kind) {
      case "load-profile":
        if (action.invalidateCache) {
          void invalidateCache(action.userId, CACHE_KEYS.PROFILE);
        }
        void loadProfile(action.userId, { flushQueue: action.flushQueue });
        return;
      case "clear-profile":
        useAuthStore.getState().setProfile(null);
        // Story 9-10 (P5 from 9-10 review): also clear the failure flag so
        // an auto-emitted `SIGNED_OUT` (token expiry / refresh failure /
        // server-side revocation) — which bypasses `signOut()`'s `reset()`
        // call — does not leave a stale `profileFetchFailed = true` into
        // the next session.
        useAuthStore.getState().setProfileFetchFailed(false);
        useAuthStore.getState().setLoading(false);
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

  bootstrapState = { teardown: () => subscription.unsubscribe() };
  return bootstrapState.teardown;
}

/**
 * Load the user's profile (with offline cache fallback) and optionally
 * flush the offline write queue.
 *
 * Story 9-10 (AC #1, #3) hardening — `applyProfileIfFresh` gates both
 * `setProfile` and `flushWriteQueue` against userId mismatch; the catch
 * path sets `profileFetchFailed = true` only when the context is still
 * fresh. See `applyProfileIfFresh` in `src/hooks/use-auth.ts` for the
 * pure decision helper.
 */
async function loadProfile(userId: string, opts: { flushQueue?: boolean } = { flushQueue: true }) {
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
    // setProfile branch AND the success-side flag clear.
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
      useAuthStore.getState().setProfile(profile);
    }
    // P4 (9-10 review): clear the flag on ANY fresh-context success.
    useAuthStore.getState().setProfileFetchFailed(false);

    // Flush any queued writes now that we have connectivity. The flush is
    // idempotent (story 9-6) so concurrent callers (this hook +
    // NetworkBanner reconnect) do not double-replay.
    if (opts.flushQueue ?? true) {
      void flushWriteQueue(supabase);
    }
  } catch (err) {
    // Expected degradation: both network and cache failed (e.g. offline
    // cold start). Only send to Sentry for unexpected errors.
    const isNetworkError =
      err instanceof Error && /network|fetch|failed to fetch|offline/i.test(err.message);
    if (!isNetworkError) {
      captureError(err, "auth-load-profile");
    }
    // Story 9-10 AC #3 + P1 (9-10 review): only set the flag when the
    // context is still fresh — a catch that fires after sign-out (or
    // sign-in as a different user) must not pollute the new user's session.
    const currentUserIdAfterCatch = useAuthStore.getState().user?.id;
    if (applyProfileIfFresh(userId, currentUserIdAfterCatch) === "apply") {
      useAuthStore.getState().setProfileFetchFailed(true);
    }
  } finally {
    useAuthStore.getState().setLoading(false);
  }
}

/**
 * Retry a previously failed profile load (Story 9-10, AC #3).
 *
 * Wraps `loadProfile(user.id, { flushQueue: false })` — `flushQueue` is
 * false because the failure path implies we are still recovering from an
 * offline state, and the queue flush is owned by reconnection
 * (`NetworkBanner`) rather than this retry surface.
 */
export async function retryProfileFetch(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  await loadProfile(user.id, { flushQueue: false });
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { error };
}

export async function signUpWithEmail(email: string, password: string, fullName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });
  return { data, error };
}

export async function signOut() {
  const userId = useAuthStore.getState().user?.id;
  const { error } = await supabase.auth.signOut();
  if (!error) {
    if (userId) {
      void clearUserCache(userId);
    }
    useAuthStore.getState().reset();
  }
  return { error };
}

export async function updateProfile(updates: Partial<UserProfile>) {
  const user = useAuthStore.getState().user;
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
      useAuthStore.getState().setProfile(updatedProfile);
      void invalidateCache(user.id, CACHE_KEYS.PROFILE);
    }
    return { data: upsertData, error: upsertError };
  }

  if (data && !error) {
    const updatedProfile = data as UserProfile;
    useAuthStore.getState().setProfile(updatedProfile);
    void invalidateCache(user.id, CACHE_KEYS.PROFILE);
  }
  return { data, error };
}

/**
 * @internal — test-only. Resets the one-call guard so tests don't leak
 * subscriptions across test boundaries. Must NOT be called from production
 * code. Pattern matches Story 11-2's `_triggerStateChange` test helper.
 */
export function __resetBootstrapForTests(): void {
  bootstrapState?.teardown();
  bootstrapState = null;
}
