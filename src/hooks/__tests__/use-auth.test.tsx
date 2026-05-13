/**
 * Story 12-2 — `useAuth` hook-binding tests.
 *
 * Pre-12-2 the hook installed a `supabase.auth.onAuthStateChange` listener
 * inside `useEffect`, so N mounted consumers ran N listeners. Post-12-2 the
 * hook is a pure consumer of the Zustand auth store, the action methods are
 * static module-level imports, and no listener is installed inside the hook.
 *
 * These tests pin the binding contract via `react-test-renderer` + a tiny
 * consumer component (Story 12-1 P8 pattern). The auth-bootstrap module is
 * mocked so we can observe that the hook does NOT trigger any subscription
 * machinery itself.
 */

import { act, create } from "react-test-renderer";
import { Text } from "react-native";

import { useAuthStore } from "@/src/store/auth-store";

import { useAuth } from "../use-auth";

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

// Mock the bootstrap module so we (a) verify the hook does NOT call
// `bootstrapAuth` itself, and (b) get stable references for the action
// methods so we can assert identity stability across renders.
const mockBootstrapAuth = jest.fn(() => () => undefined);
const mockSignIn = jest.fn(async () => ({ error: null }));
const mockSignUp = jest.fn(async () => ({ data: null, error: null }));
const mockSignOut = jest.fn(async () => ({ error: null }));
const mockUpdateProfile = jest.fn(async () => ({ data: null, error: null }));
const mockRetryProfileFetch = jest.fn(async () => undefined);

// Review-round-1 P9: removed the dead `applyProfileIfFresh` mock — the
// `useAuth` hook re-exports it from `auth-bootstrap` but never invokes it
// (the production code path `loadProfile` calls the local definition
// directly inside `auth-bootstrap.ts`, not via the import shim). A mocked
// value here would never have been consumed; tests that need to assert
// on the helper's behavior should import it from `auth-bootstrap` directly.
jest.mock("@/src/lib/auth-bootstrap", () => ({
  bootstrapAuth: (...args: unknown[]) =>
    (mockBootstrapAuth as unknown as (...a: unknown[]) => unknown)(...args),
  signInWithEmail: (...args: unknown[]) =>
    (mockSignIn as unknown as (...a: unknown[]) => unknown)(...args),
  signUpWithEmail: (...args: unknown[]) =>
    (mockSignUp as unknown as (...a: unknown[]) => unknown)(...args),
  signOut: (...args: unknown[]) =>
    (mockSignOut as unknown as (...a: unknown[]) => unknown)(...args),
  updateProfile: (...args: unknown[]) =>
    (mockUpdateProfile as unknown as (...a: unknown[]) => unknown)(...args),
  retryProfileFetch: (...args: unknown[]) =>
    (mockRetryProfileFetch as unknown as (...a: unknown[]) => unknown)(...args),
}));

function resetStore() {
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: false,
    isOnboarded: false,
    profileFetchFailed: false,
  });
}

let captured: ReturnType<typeof useAuth> | null = null;
function HookHost() {
  captured = useAuth();
  return <Text>{captured.user?.id ?? "no-user"}</Text>;
}

beforeEach(() => {
  resetStore();
  mockBootstrapAuth.mockClear();
  captured = null;
});

afterEach(() => {
  captured = null;
});

describe("Story 12-2 — useAuth hook-binding (pure consumer)", () => {
  it("Case 1: hook does NOT call bootstrapAuth() itself (bootstrap is owned by _layout.tsx module-load)", () => {
    act(() => {
      create(<HookHost />);
    });
    expect(mockBootstrapAuth).not.toHaveBeenCalled();
  });

  it("Case 2: hook returns the verbatim pre-12-2 UseAuthReturn shape", () => {
    act(() => {
      create(<HookHost />);
    });
    expect(captured).not.toBeNull();
    // State fields
    expect(captured).toHaveProperty("session");
    expect(captured).toHaveProperty("user");
    expect(captured).toHaveProperty("profile");
    expect(captured).toHaveProperty("isLoading");
    expect(captured).toHaveProperty("isOnboarded");
    expect(captured).toHaveProperty("profileFetchFailed");
    // Action methods
    expect(typeof captured!.retryProfileFetch).toBe("function");
    expect(typeof captured!.signInWithEmail).toBe("function");
    expect(typeof captured!.signUpWithEmail).toBe("function");
    expect(typeof captured!.signOut).toBe("function");
    expect(typeof captured!.updateProfile).toBe("function");
  });

  it("Case 3: action method identities are stable across renders (module-level imports, not closures)", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<HookHost />);
    });
    const firstSignIn = captured!.signInWithEmail;
    const firstSignOut = captured!.signOut;
    const firstUpdateProfile = captured!.updateProfile;
    const firstRetry = captured!.retryProfileFetch;

    act(() => {
      renderer!.update(<HookHost />);
    });

    expect(captured!.signInWithEmail).toBe(firstSignIn);
    expect(captured!.signOut).toBe(firstSignOut);
    expect(captured!.updateProfile).toBe(firstUpdateProfile);
    expect(captured!.retryProfileFetch).toBe(firstRetry);
  });

  it("Case 4: store state propagates through the hook into the return value", () => {
    useAuthStore.setState({
      user: { id: "u-test" } as never,
      profile: { id: "u-test", onboarding_completed: true } as never,
      isOnboarded: true,
      isLoading: false,
    });
    act(() => {
      create(<HookHost />);
    });
    expect(captured!.user?.id).toBe("u-test");
    expect(captured!.profile?.id).toBe("u-test");
    expect(captured!.isOnboarded).toBe(true);
    expect(captured!.isLoading).toBe(false);
  });

  it("Case 5: multiple HookHost consumers mounted concurrently → bootstrapAuth STILL not called (architectural claim)", () => {
    act(() => {
      create(<HookHost />);
    });
    act(() => {
      create(<HookHost />);
    });
    act(() => {
      create(<HookHost />);
    });
    // The architectural claim: N hook mounts do NOT install N listeners.
    // The bootstrap module is owned by _layout.tsx module-load, not the hook.
    expect(mockBootstrapAuth).not.toHaveBeenCalled();
  });

  it("Case 6: hook action methods forward through to the bootstrap-module imports", async () => {
    act(() => {
      create(<HookHost />);
    });
    await captured!.signInWithEmail("test@example.com", "pw");
    await captured!.signOut();
    await captured!.retryProfileFetch();
    expect(mockSignIn).toHaveBeenCalledWith("test@example.com", "pw");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockRetryProfileFetch).toHaveBeenCalledTimes(1);
  });
});
