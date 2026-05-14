/**
 * Pure consumer hook (Story 12-2).
 *
 * Post-12-2 `useAuth()` is a thin React binding over `useAuthStore` +
 * static action methods imported from `src/lib/auth-bootstrap.ts`. The
 * `supabase.auth.onAuthStateChange` listener + cold-start `getSession()`
 * + `loadProfile` dispatch all live in the bootstrap module and run
 * exactly ONCE per app lifetime via the `bootstrapState` one-call guard
 * (mounted from `app/_layout.tsx` module-load time).
 *
 * Pre-12-2 this hook (a) installed its own listener inside `useEffect`,
 * which meant 7 mounted consumers ran 7 listeners simultaneously, and
 * (b) allocated 7 fresh closures per render. Post-12-2 the hook has zero
 * `useEffect` and zero closures — action methods are module-level static
 * imports.
 *
 * Action methods (`signInWithEmail` / `signUpWithEmail` / `signOut` /
 * `updateProfile` / `retryProfileFetch`) are re-exported from this module
 * so the public hook return shape matches pre-12-2 verbatim — all 7
 * existing `useAuth()` call sites compile unchanged.
 *
 * `applyProfileIfFresh` is re-exported from `auth-bootstrap.ts` to keep
 * the existing `src/lib/__tests__/auth-load-profile-stale.test.ts` import
 * path valid (it imports `applyProfileIfFresh` from `@/src/hooks/use-auth`).
 *
 * Per-field selectors (`useAuthStore((s) => s.X)`) replace the pre-12-2
 * single destructure — consumers re-render only when their consumed field
 * changes, not on any store-field write (Zustand idiom).
 */
import { useAuthStore } from "@/src/store/auth-store";
import {
  refreshSessionAfterVerification,
  resendVerificationEmail,
  retryProfileFetch,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  updateProfile,
} from "@/src/lib/auth-bootstrap";

export {
  applyProfileIfFresh,
  refreshSessionAfterVerification,
  resendVerificationEmail,
  retryProfileFetch,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  updateProfile,
  type ApplyProfileDecision,
} from "@/src/lib/auth-bootstrap";

export function useAuth() {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isOnboarded = useAuthStore((s) => s.isOnboarded);
  const profileFetchFailed = useAuthStore((s) => s.profileFetchFailed);

  return {
    session,
    user,
    profile,
    isLoading,
    isOnboarded,
    profileFetchFailed,
    refreshSessionAfterVerification,
    resendVerificationEmail,
    retryProfileFetch,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    updateProfile,
  };
}
