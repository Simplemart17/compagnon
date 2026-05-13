/**
 * Story 12-2 — Auth bootstrap module tests.
 *
 * Pins the central architectural claim of 12-2: the auth listener is
 * installed EXACTLY ONCE per app lifetime, regardless of how many
 * consumers mount `useAuth()`. The pre-12-2 N-listener fan-out (which
 * caused N concurrent `loadProfile` + cache-write races) is structurally
 * impossible.
 *
 * Covers:
 * - Bootstrap idempotence (one-call guard via `bootstrapState`).
 * - Story 9-6 per-event branching invariants preserved (re-tests the
 *   listener's dispatch against `decideAuthAction` output).
 * - Story 9-10 `applyProfileIfFresh` userId-guard + `profileFetchFailed`
 *   flag semantics preserved.
 * - `retryProfileFetch` shape (skips queue flush; pulls user from store).
 */

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import {
  bootstrapAuth,
  retryProfileFetch,
  __resetBootstrapForTests,
} from "@/src/lib/auth-bootstrap";
import { useAuthStore } from "@/src/store/auth-store";

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

// Capture the listener callback registered by bootstrapAuth so tests can
// invoke it directly.
let registeredCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;
const mockUnsubscribe = jest.fn();
const mockOnAuthStateChange = jest.fn(
  (cb: (event: AuthChangeEvent, session: Session | null) => void) => {
    registeredCallback = cb;
    return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
  }
);

const mockGetSession = jest.fn().mockResolvedValue({ data: { session: null }, error: null });

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    auth: {
      onAuthStateChange: (
        cb: (
          event: import("@supabase/supabase-js").AuthChangeEvent,
          session: import("@supabase/supabase-js").Session | null
        ) => void
      ) => mockOnAuthStateChange(cb),
      getSession: () => mockGetSession(),
      signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
      signUp: jest.fn().mockResolvedValue({ data: null, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

// Mock cache module — `cacheWithFallback` resolves with the network value
// produced by the function the caller passes in; `invalidateCache` /
// `flushWriteQueue` / `clearUserCache` are no-ops.
const mockCacheWithFallback = jest.fn(async (_userId, _key, fn, _ttl) => {
  const data = await fn();
  return { data };
});
const mockInvalidateCache = jest.fn().mockResolvedValue(undefined);
const mockFlushWriteQueue = jest.fn().mockResolvedValue(0);
const mockClearUserCache = jest.fn().mockResolvedValue(undefined);

jest.mock("../cache", () => ({
  cacheWithFallback: (...args: unknown[]) =>
    (mockCacheWithFallback as unknown as (...a: unknown[]) => unknown)(...args),
  invalidateCache: (...args: unknown[]) =>
    (mockInvalidateCache as unknown as (...a: unknown[]) => unknown)(...args),
  flushWriteQueue: (...args: unknown[]) =>
    (mockFlushWriteQueue as unknown as (...a: unknown[]) => unknown)(...args),
  clearUserCache: (...args: unknown[]) =>
    (mockClearUserCache as unknown as (...a: unknown[]) => unknown)(...args),
  CACHE_KEYS: { PROFILE: "profile" },
  CACHE_TTL: { PROFILE: 1000 },
}));

const mockCaptureError = jest.fn();
const mockAddBreadcrumb = jest.fn();
jest.mock("../sentry", () => ({
  captureError: (...args: unknown[]) =>
    (mockCaptureError as unknown as (...a: unknown[]) => unknown)(...args),
  addBreadcrumb: (...args: unknown[]) =>
    (mockAddBreadcrumb as unknown as (...a: unknown[]) => unknown)(...args),
}));

function makeSession(userId = "user-A"): Session {
  return { user: { id: userId } } as unknown as Session;
}

function resetStore() {
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: true,
    isOnboarded: false,
    profileFetchFailed: false,
  });
}

beforeEach(() => {
  __resetBootstrapForTests();
  registeredCallback = null;
  mockOnAuthStateChange.mockClear();
  mockUnsubscribe.mockClear();
  mockGetSession.mockClear();
  mockCacheWithFallback.mockClear();
  mockInvalidateCache.mockClear();
  mockFlushWriteQueue.mockClear();
  mockClearUserCache.mockClear();
  mockCaptureError.mockClear();
  mockAddBreadcrumb.mockClear();
  resetStore();
});

afterEach(() => {
  __resetBootstrapForTests();
});

describe("Story 12-2 bootstrap idempotence (the centerpiece architectural claim)", () => {
  it("Case 1: bootstrapAuth() installs the listener exactly once on first call", () => {
    bootstrapAuth();
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it("Case 2: two sequential bootstrapAuth() calls install only ONE subscription", () => {
    bootstrapAuth();
    bootstrapAuth();
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it("Case 3: second bootstrapAuth() returns the SAME teardown closure (referential equality)", () => {
    const teardownA = bootstrapAuth();
    const teardownB = bootstrapAuth();
    expect(teardownA).toBe(teardownB);
  });

  it("Case 4: teardown invocation calls subscription.unsubscribe()", () => {
    const teardown = bootstrapAuth();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    teardown();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("Case 5: __resetBootstrapForTests clears the singleton (next bootstrapAuth re-subscribes)", () => {
    bootstrapAuth();
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    __resetBootstrapForTests();
    bootstrapAuth();
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(2);
  });
});

describe("Story 9-6 per-event branching invariants preserved by the bootstrap listener", () => {
  beforeEach(() => {
    bootstrapAuth();
    expect(registeredCallback).not.toBeNull();
  });

  it("Case 6: INITIAL_SESSION with session → setSession + cacheWithFallback fires (loadProfile dispatch)", async () => {
    const session = makeSession("u1");
    registeredCallback!("INITIAL_SESSION", session);
    expect(useAuthStore.getState().session?.user.id).toBe("u1");
    // loadProfile is dispatched via void; allow the microtask queue to drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCacheWithFallback).toHaveBeenCalledTimes(1);
    // First arg to cacheWithFallback is the userId.
    expect(mockCacheWithFallback.mock.calls[0][0]).toBe("u1");
  });

  it("Case 7: USER_UPDATED → invalidateCache fires AND loadProfile dispatched (flushQueue: false)", async () => {
    const session = makeSession("u2");
    registeredCallback!("USER_UPDATED", session);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvalidateCache).toHaveBeenCalledWith("u2", "profile");
    expect(mockCacheWithFallback).toHaveBeenCalledTimes(1);
    // After loadProfile resolves, flushQueue: false means flushWriteQueue NOT called.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFlushWriteQueue).not.toHaveBeenCalled();
  });

  it("Case 8: SIGNED_OUT → setProfile(null) + setProfileFetchFailed(false) + setLoading(false)", () => {
    useAuthStore.setState({
      profile: { id: "u1" } as never,
      profileFetchFailed: true,
      isLoading: true,
    });
    registeredCallback!("SIGNED_OUT", null);
    expect(useAuthStore.getState().profile).toBeNull();
    expect(useAuthStore.getState().profileFetchFailed).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("Case 9: TOKEN_REFRESHED → setSession only, no loadProfile dispatch, no flushQueue", async () => {
    const session = makeSession("u3");
    registeredCallback!("TOKEN_REFRESHED", session);
    expect(useAuthStore.getState().session?.user.id).toBe("u3");
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCacheWithFallback).not.toHaveBeenCalled();
    expect(mockFlushWriteQueue).not.toHaveBeenCalled();
  });

  it("Case 10: PASSWORD_RECOVERY → session-only (no loadProfile, no flushQueue)", async () => {
    const session = makeSession("u4");
    registeredCallback!("PASSWORD_RECOVERY", session);
    await Promise.resolve();
    expect(mockCacheWithFallback).not.toHaveBeenCalled();
    expect(mockFlushWriteQueue).not.toHaveBeenCalled();
  });

  it("Case 11: null session on TOKEN_REFRESHED (non-SIGNED_OUT) → no-session breadcrumb, profile NOT destroyed", () => {
    useAuthStore.setState({ profile: { id: "u5" } as never });
    registeredCallback!("TOKEN_REFRESHED", null);
    expect(useAuthStore.getState().profile).toEqual({ id: "u5" });
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "auth",
        level: "warning",
        message: "Auth event arrived with null session",
      })
    );
  });
});

describe("Story 9-10 userId-guard + profileFetchFailed semantics preserved", () => {
  beforeEach(() => {
    bootstrapAuth();
  });

  it("Case 12: loadProfile catch path → setProfileFetchFailed(true) when context is still fresh", async () => {
    // Make cacheWithFallback reject so the catch path fires.
    mockCacheWithFallback.mockRejectedValueOnce(new Error("unexpected DB error"));
    // Set the store's current user to the SAME userId as the event so
    // applyProfileIfFresh returns "apply" → flag is set.
    useAuthStore.setState({ user: { id: "u-fresh" } as never });
    registeredCallback!("SIGNED_IN", makeSession("u-fresh"));
    // Drain microtasks until catch + finally complete.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().profileFetchFailed).toBe(true);
  });

  it("Case 13: loadProfile catch path → flag NOT set when user changed mid-flight (stale)", async () => {
    // Simulate a sign-out racing the in-flight loadProfile:
    // cacheWithFallback rejects, but BEFORE the catch resolves we clear
    // the store's user (mimicking SIGNED_OUT firing). The catch then
    // observes currentUserId === undefined → applyProfileIfFresh returns
    // "drop-stale" → flag is NOT set.
    mockCacheWithFallback.mockImplementationOnce(async () => {
      // Mid-flight: clear the user before the rejection propagates.
      useAuthStore.setState({ user: null });
      throw new Error("unexpected DB error");
    });
    useAuthStore.setState({ user: { id: "u-stale" } as never, profileFetchFailed: false });
    registeredCallback!("SIGNED_IN", makeSession("u-stale"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().profileFetchFailed).toBe(false);
  });
});

describe("retryProfileFetch shape (Story 9-10 AC #3)", () => {
  beforeEach(() => {
    bootstrapAuth();
  });

  it("Case 14: retryProfileFetch with no user → resolves no-op (cacheWithFallback NOT called)", async () => {
    useAuthStore.setState({ user: null });
    await retryProfileFetch();
    expect(mockCacheWithFallback).not.toHaveBeenCalled();
  });

  it("Case 15: retryProfileFetch with user → calls cacheWithFallback for that user; flushQueue skipped", async () => {
    useAuthStore.setState({ user: { id: "u-retry" } as never });
    await retryProfileFetch();
    expect(mockCacheWithFallback).toHaveBeenCalledTimes(1);
    expect(mockCacheWithFallback.mock.calls[0][0]).toBe("u-retry");
    // flushQueue: false on retry; flushWriteQueue must not be called.
    expect(mockFlushWriteQueue).not.toHaveBeenCalled();
  });
});

describe("cold-start getSession contract (Story 9-6 unhandled-rejection catch)", () => {
  it("Case 16: bootstrapAuth() calls supabase.auth.getSession() exactly once", () => {
    bootstrapAuth();
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it("Case 17: getSession returning no-session resolves → setLoading(false) fires as safety net", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    bootstrapAuth();
    // Drain microtasks for the .then chain.
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
