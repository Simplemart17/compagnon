/**
 * Regression suite for the userId-guard on profile loads (story 9-10, AC #1).
 *
 * Tests the pure decision helper `applyProfileIfFresh` exported from
 * `src/hooks/use-auth.ts`. The helper is the branch decision used at the
 * `loadProfile` call site to drop in-flight results that arrive after the
 * user changed (sign-out, or sign-in as a different user). Keeping the
 * decision pure means we do not need React, Zustand, or Supabase mocks.
 *
 * The hook module transitively pulls in AsyncStorage via `@/src/lib/cache`,
 * which is a native module that throws under Jest without a stub. We mock
 * it to a no-op so the import chain resolves cleanly — none of these tests
 * exercise storage.
 */

import { applyProfileIfFresh } from "@/src/hooks/use-auth";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}));

describe("applyProfileIfFresh — userId guard for in-flight loadProfile", () => {
  // Case 1: in-flight loadProfile resolves while user is still signed in.
  it("returns 'apply' when the current user matches the loaded user", () => {
    expect(applyProfileIfFresh("user-A", "user-A")).toBe("apply");
  });

  // Case 2: in-flight loadProfile resolves AFTER sign-out.
  // useAuthStore.getState().user?.id is `undefined` once SIGNED_OUT clears
  // the session. The guard must drop the result.
  it("returns 'drop-stale' when the user has signed out (undefined currentUserId)", () => {
    expect(applyProfileIfFresh("user-A", undefined)).toBe("drop-stale");
  });

  // Case 3: in-flight loadProfile for user A resolves after sign-in as user B.
  // The guard must drop user A's result so it does not clobber user B's
  // freshly-installed (or about-to-install) profile.
  it("returns 'drop-stale' when a different user has signed in mid-flight", () => {
    expect(applyProfileIfFresh("user-A", "user-B")).toBe("drop-stale");
  });
});
