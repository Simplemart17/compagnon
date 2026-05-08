/**
 * Regression suite for the `profileFetchFailed` flag wiring on `auth-store`
 * (story 9-10, AC #3).
 *
 * The flag is set by `loadProfile`'s catch path when both network and cache
 * reads fail (e.g. offline cold start with corrupted cache). The auth guard
 * at `app/_layout.tsx` reads it to route to a retry surface instead of
 * misrouting an already-onboarded user to `/onboarding`.
 *
 * These tests cover the store contract; the auth-guard route branch is
 * integration territory verified by the manual smoke test in AC #7.
 */

import { useAuthStore } from "@/src/store/auth-store";

describe("auth-store: profileFetchFailed flag", () => {
  // Reset the store to its initial shape between tests so cases do not leak.
  // We re-apply the initial values rather than calling `reset()` because
  // `reset()` is itself under test (Case 3).
  beforeEach(() => {
    useAuthStore.setState({
      session: null,
      user: null,
      profile: null,
      isLoading: true,
      isOnboarded: false,
      profileFetchFailed: false,
    });
  });

  // Case 1: a fresh store starts with the flag cleared.
  it("initial state — profileFetchFailed is false", () => {
    expect(useAuthStore.getState().profileFetchFailed).toBe(false);
  });

  // Case 2: the setter flips the flag in both directions.
  it("setProfileFetchFailed flips the flag true → false → true", () => {
    const { setProfileFetchFailed } = useAuthStore.getState();

    setProfileFetchFailed(true);
    expect(useAuthStore.getState().profileFetchFailed).toBe(true);

    setProfileFetchFailed(false);
    expect(useAuthStore.getState().profileFetchFailed).toBe(false);

    setProfileFetchFailed(true);
    expect(useAuthStore.getState().profileFetchFailed).toBe(true);
  });

  // Case 3: reset() clears the flag along with all other auth state.
  // This is what runs on sign-out (`signOut()` calls `useAuthStore.getState().reset()`).
  it("reset() clears the flag back to false", () => {
    useAuthStore.getState().setProfileFetchFailed(true);
    expect(useAuthStore.getState().profileFetchFailed).toBe(true);

    useAuthStore.getState().reset();
    expect(useAuthStore.getState().profileFetchFailed).toBe(false);
  });
});
