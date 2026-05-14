/**
 * Story 12-7 — `cache.ts` secure-routing integration tests.
 *
 * Pins the SECURE_CACHE_KEYS routing fork inside getCache / setCache /
 * invalidateCache + the one-shot migration of legacy plaintext entries +
 * the cacheWithFallback fallback-read fork + the clearUserCache double
 * sweep. The load-bearing assertions:
 *   (a) `setCache(userId, "profile", _)` routes to SecureStore (NOT
 *       AsyncStorage) — audit P1-11 closure.
 *   (b) `setCache(userId, "skills", _)` routes to AsyncStorage (NOT
 *       SecureStore) — preserves pre-12-7 behavior for non-secure keys.
 *   (c) First `getCache(userId, "profile")` post-12-7 migrates the legacy
 *       plaintext entry to SecureStore + fires `secure-cache-migrated`
 *       breadcrumb + deletes the plaintext entry.
 *   (d) Second `getCache(userId, "profile")` after migration reads
 *       SecureStore directly (no re-migration breadcrumb).
 *   (e) `cacheWithFallback`'s catch-branch routes through the secure fork
 *       for secure keys.
 *   (f) `clearUserCache(userId)` sweeps BOTH AsyncStorage + SecureStore.
 *   (g) Drift detector: `SECURE_CACHE_KEYS` is exported + the fork
 *       appears in all 3 read/write methods.
 */

import { readFileSync } from "fs";
import { join } from "path";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  CACHE_KEYS,
  cacheWithFallback,
  clearUserCache,
  getCache,
  invalidateCache,
  SECURE_CACHE_KEYS,
  setCache,
} from "../cache";
import { addBreadcrumb } from "../sentry";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("../network", () => ({
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      multiRemove: jest.fn(async (keys: string[]) => {
        for (const k of keys) delete store[k];
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      __reset: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  };
});

jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    __reset: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
});

// react-native Platform mock — default to ios so SecureStore is exercised.
jest.mock("react-native", () => ({
  __esModule: true,
  Platform: { OS: "ios" },
}));

const mockedAsyncStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  multiRemove: jest.Mock;
  getAllKeys: jest.Mock;
  __reset: () => void;
};
const mockedSecureStore = SecureStore as unknown as {
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __reset: () => void;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsyncStorage.__reset();
  mockedSecureStore.__reset();
});

describe("Story 12-7 — cache.ts routing fork", () => {
  it("Case 1: setCache(userId, 'profile', _) routes to SecureStore (NOT AsyncStorage)", async () => {
    await setCache("user-1", CACHE_KEYS.PROFILE, { full_name: "Marie" }, 60_000);
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    // AsyncStorage.setItem must NOT have been called for the profile key.
    const asyncStorageSetCalls = mockedAsyncStorage.setItem.mock.calls.filter((call) =>
      (call[0] as string).includes("profile")
    );
    expect(asyncStorageSetCalls).toHaveLength(0);
  });

  it("Case 2: setCache(userId, 'skills', _) routes to AsyncStorage (NOT SecureStore) — preserves pre-12-7 behavior", async () => {
    await setCache("user-1", CACHE_KEYS.SKILLS, [{ skill: "listening", score: 80 }], 60_000);
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("Case 3: getCache(userId, 'profile') routes to SecureStore (no migration when no legacy entry exists)", async () => {
    // Pre-seed SecureStore with a valid entry.
    const entry = {
      data: { full_name: "Marie", streak_days: 7 },
      timestamp: Date.now(),
      ttlMs: 60_000,
    };
    await mockedSecureStore.setItemAsync("companion_secure_user-1_profile", JSON.stringify(entry));
    mockedSecureStore.setItemAsync.mockClear(); // clear the seed call

    const out = await getCache<typeof entry.data>("user-1", CACHE_KEYS.PROFILE);
    expect(out).toEqual(entry.data);
    expect(mockedSecureStore.getItemAsync).toHaveBeenCalled();
    // No migration breadcrumb (no legacy entry to migrate).
    const migrationBreadcrumbs = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-migrated"
    );
    expect(migrationBreadcrumbs).toHaveLength(0);
  });

  it("Case 4: invalidateCache(userId, 'profile') routes to SecureStore.deleteItemAsync", async () => {
    await invalidateCache("user-1", CACHE_KEYS.PROFILE);
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "companion_secure_user-1_profile"
    );
    // AsyncStorage.removeItem should NOT have been called (no profile-key removal).
    const asyncRemoveCalls = mockedAsyncStorage.removeItem.mock.calls.filter((call) =>
      (call[0] as string).includes("profile")
    );
    expect(asyncRemoveCalls).toHaveLength(0);
  });
});

describe("Story 12-7 — migration (one-shot, idempotent)", () => {
  it("Case 5: first getCache with legacy plaintext entry → migrates + fires `secure-cache-migrated` breadcrumb + deletes legacy", async () => {
    // Seed AsyncStorage with the legacy plaintext profile entry.
    const legacyData = { full_name: "Marie", streak_days: 7 };
    const legacyEntry = {
      data: legacyData,
      timestamp: Date.now(),
      ttlMs: 60_000,
    };
    await mockedAsyncStorage.setItem(
      "@companion_cache:user-1:profile",
      JSON.stringify(legacyEntry)
    );
    mockedAsyncStorage.setItem.mockClear();

    // First read post-12-7 — triggers migration.
    const out = await getCache<typeof legacyData>("user-1", CACHE_KEYS.PROFILE);

    expect(out).toEqual(legacyData);
    // SecureStore was written with the migrated data.
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    // Legacy AsyncStorage entry was deleted.
    expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith("@companion_cache:user-1:profile");
    // Migration breadcrumb fired exactly once.
    const migrationBreadcrumbs = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-migrated"
    );
    expect(migrationBreadcrumbs).toHaveLength(1);
    expect(migrationBreadcrumbs[0][0]).toMatchObject({
      category: "cache",
      level: "info",
      message: "Profile cache migrated to SecureStore",
    });
  });

  it("Case 6: second getCache after migration reads SecureStore directly + does NOT re-fire the migration breadcrumb (idempotent)", async () => {
    // Seed AsyncStorage + perform first migration.
    const legacyData = { full_name: "Marie", streak_days: 7 };
    await mockedAsyncStorage.setItem(
      "@companion_cache:user-1:profile",
      JSON.stringify({ data: legacyData, timestamp: Date.now(), ttlMs: 60_000 })
    );
    await getCache("user-1", CACHE_KEYS.PROFILE);
    (addBreadcrumb as jest.Mock).mockClear();
    mockedSecureStore.setItemAsync.mockClear();
    mockedAsyncStorage.removeItem.mockClear();

    // Second read — should hit SecureStore only, no migration.
    const out = await getCache<typeof legacyData>("user-1", CACHE_KEYS.PROFILE);
    expect(out).toEqual(legacyData);
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockedAsyncStorage.removeItem).not.toHaveBeenCalled();
    const migrationBreadcrumbs = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-migrated"
    );
    expect(migrationBreadcrumbs).toHaveLength(0);
  });
});

describe("Story 12-7 — cacheWithFallback fallback-read fork", () => {
  it("Case 7: cacheWithFallback catch-branch reads SecureStore (not AsyncStorage) for the profile key when network fails", async () => {
    // Seed SecureStore with a stale-but-cached profile entry.
    const profileData = { full_name: "Marie", streak_days: 7 };
    await mockedSecureStore.setItemAsync(
      "companion_secure_user-1_profile",
      JSON.stringify({ data: profileData, timestamp: Date.now() - 9999999, ttlMs: 60_000 })
    );
    mockedSecureStore.getItemAsync.mockClear();

    // Network-failing fetch function.
    const fetchFn = jest.fn(async () => {
      throw new Error("network down");
    });

    const result = await cacheWithFallback<typeof profileData>(
      "user-1",
      CACHE_KEYS.PROFILE,
      fetchFn,
      60_000
    );

    expect(result.fromCache).toBe(true);
    expect(result.data).toEqual(profileData);
    // SecureStore was read on the fallback path.
    expect(mockedSecureStore.getItemAsync).toHaveBeenCalled();
    // AsyncStorage was NOT read for the profile key on fallback.
    const asyncGetCalls = mockedAsyncStorage.getItem.mock.calls.filter((call) =>
      (call[0] as string).includes("profile")
    );
    expect(asyncGetCalls).toHaveLength(0);
  });
});

describe("Story 12-7 — clearUserCache sweeps both stores", () => {
  it("Case 8: clearUserCache(userId) clears BOTH the AsyncStorage @companion_cache:userId: prefix AND the SecureStore SECURE_CACHE_KEYS entries", async () => {
    // Seed AsyncStorage with one non-secure key + write a profile entry to SecureStore.
    await mockedAsyncStorage.setItem(
      "@companion_cache:user-1:skills",
      JSON.stringify({ data: [], timestamp: Date.now(), ttlMs: 60_000 })
    );
    await mockedSecureStore.setItemAsync(
      "companion_secure_user-1_profile",
      JSON.stringify({ data: {}, timestamp: Date.now(), ttlMs: 60_000 })
    );
    mockedAsyncStorage.multiRemove.mockClear();
    mockedSecureStore.deleteItemAsync.mockClear();

    await clearUserCache("user-1");

    // AsyncStorage namespace cleared.
    expect(mockedAsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
    const removedKeys = mockedAsyncStorage.multiRemove.mock.calls[0][0] as string[];
    expect(removedKeys).toContain("@companion_cache:user-1:skills");

    // SecureStore allowlist swept too.
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "companion_secure_user-1_profile"
    );
  });
});

// ============================================================================
// Drift detectors — load-bearing audit-P1-11 closure
// ============================================================================

const CACHE_PATH = join(__dirname, "..", "cache.ts");
const CACHE_SOURCE = readFileSync(CACHE_PATH, "utf-8");
// Strip block + line comments per Story 12-2 P12 lesson so JSDoc that
// mentions pre-12-7 surfaces doesn't false-positive negative guards.
const CACHE_CODE_ONLY = CACHE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Story 12-7 — cache.ts drift detectors (audit P1-11 closure)", () => {
  it("Case 9: SECURE_CACHE_KEYS export exists and contains 'profile'", () => {
    expect(SECURE_CACHE_KEYS.has(CACHE_KEYS.PROFILE)).toBe(true);
    expect(SECURE_CACHE_KEYS.has("profile")).toBe(true);
    // Drift detector — pin the export line so a future refactor can't
    // silently drop the allowlist.
    expect(CACHE_CODE_ONLY).toMatch(/export\s+const\s+SECURE_CACHE_KEYS\s*:[^=]*=\s*new\s+Set\(/);
  });

  it("Case 10: getCache body contains the SECURE_CACHE_KEYS.has(key) fork", () => {
    expect(CACHE_CODE_ONLY).toMatch(/getCache[\s\S]*?SECURE_CACHE_KEYS\.has\(key\)/);
  });

  it("Case 11: setCache body contains the SECURE_CACHE_KEYS.has(key) fork", () => {
    expect(CACHE_CODE_ONLY).toMatch(/setCache[\s\S]*?SECURE_CACHE_KEYS\.has\(key\)/);
  });

  it("Case 12: invalidateCache body contains the SECURE_CACHE_KEYS.has(key) fork", () => {
    expect(CACHE_CODE_ONLY).toMatch(/invalidateCache[\s\S]*?SECURE_CACHE_KEYS\.has\(key\)/);
  });

  it("Case 13: NEGATIVE guard — no `AsyncStorage.setItem` writes a key matching /profile/ verbatim", () => {
    // Walk every `AsyncStorage.setItem(...)` call site and assert none of
    // them write a key that contains the literal substring "profile".
    // The migration block uses `removeItem` (allowed), not setItem.
    const setItemMatches = CACHE_CODE_ONLY.match(/AsyncStorage\.setItem\([^)]+\)/g) ?? [];
    for (const match of setItemMatches) {
      expect(match).not.toMatch(/profile/i);
    }
  });
});
