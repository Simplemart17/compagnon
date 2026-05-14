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
import { Platform } from "react-native";

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
  // P18 review-round-1: explicit reset to "ios" so any future test that
  // toggles Platform.OS (e.g., via mockPlatform("web")) doesn't leak the
  // OS state into subsequent cases within the same file.
  (Platform as unknown as { OS: string }).OS = "ios";
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
    // P5 review-round-1: explicitly verify the value passed to
    // SecureStore.setItemAsync contains the legacy data — pre-patch
    // Case 5 only asserted call count, so a regression writing
    // `setSecureCache(_, _, undefined, _)` would have passed vacuously.
    const setItemCall = mockedSecureStore.setItemAsync.mock.calls[0] as [string, string, unknown];
    expect(setItemCall[0]).toBe("companion_secure_user-1_profile");
    const writtenEnvelope = JSON.parse(setItemCall[1]) as {
      data: typeof legacyData;
      timestamp: number;
      ttlMs: number;
    };
    expect(writtenEnvelope.data).toEqual(legacyData);
    expect(typeof writtenEnvelope.timestamp).toBe("number");
    expect(writtenEnvelope.ttlMs).toBe(60_000);
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

  it("Case 13: NEGATIVE guard — no `AsyncStorage.setItem` call uses CACHE_KEYS.PROFILE verbatim (literal-string regression check)", () => {
    // Walk every `AsyncStorage.setItem(...)` call site (regex tolerates
    // nested parens in `buildKey(userId, key)` by allowing one level of
    // balanced parens). Assert none of them pass `CACHE_KEYS.PROFILE`
    // or `"profile"` as a literal — those would indicate a regression
    // that bypassed the SECURE_CACHE_KEYS fork.
    //
    // **P20 review-round-1 scope clarification**: the pre-12-7 plaintext
    // write path uses `AsyncStorage.setItem(buildKey(userId, key), ...)`
    // where `key` is a variable, NOT the literal "profile". This regex
    // pins LITERAL-STRING regressions only (e.g., `AsyncStorage.setItem(
    // buildKey(userId, "profile"), ...)` or `AsyncStorage.setItem(
    // buildKey(userId, CACHE_KEYS.PROFILE), ...)`). The structural
    // fork-presence is pinned by Cases 9-12 above (those check that
    // `SECURE_CACHE_KEYS.has(key)` appears in each write/read fork
    // body); Case 13 is the literal-key escape hatch.
    const setItemMatches =
      CACHE_CODE_ONLY.match(/AsyncStorage\.setItem\((?:[^()]|\([^()]*\))+\)/g) ?? [];
    for (const match of setItemMatches) {
      expect(match).not.toMatch(/CACHE_KEYS\.PROFILE/);
      expect(match).not.toMatch(/["']profile["']/);
    }
  });
});

// ============================================================================
// Story 12-7 review-round-1 patches — additional regression coverage
// ============================================================================

describe("Story 12-7 review-round-1 P1 — expired legacy entry is NOT written to SecureStore", () => {
  it("Case 14: legacy entry past TTL → return null + delete legacy + NO setSecureCache call + NO migration breadcrumb", async () => {
    // Pre-patch: getCache would (a) write expired data to SecureStore with a
    // fresh Date.now() timestamp (effectively reviving stale data), (b) fire
    // the migration breadcrumb as success, (c) return null. The next read
    // would return the now-"fresh" stale data.
    const legacyData = { full_name: "Marie", streak_days: 7 };
    const expiredEntry = {
      data: legacyData,
      timestamp: Date.now() - 9_999_999, // way past expiry
      ttlMs: 60_000,
    };
    await mockedAsyncStorage.setItem(
      "@companion_cache:user-1:profile",
      JSON.stringify(expiredEntry)
    );

    const out = await getCache<typeof legacyData>("user-1", CACHE_KEYS.PROFILE);

    // Cache miss returned to caller.
    expect(out).toBeNull();
    // SecureStore was NOT written (pre-patch would have written expired data).
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    // Legacy entry was deleted (cleanup happens regardless of TTL).
    expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith("@companion_cache:user-1:profile");
    // Migration breadcrumb did NOT fire (pre-patch would have inflated the
    // operator rollout-coverage metric with this expired entry).
    const migrationBreadcrumbs = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-migrated"
    );
    expect(migrationBreadcrumbs).toHaveLength(0);
  });
});

describe("Story 12-7 review-round-1 P2 — concurrent migration is serialized via in-flight Promise gate", () => {
  it("Case 15: two parallel getCache calls during migration → SecureStore written ONCE + breadcrumb fires ONCE", async () => {
    // Pre-patch: both parallel calls would observe the legacy entry, both
    // call setSecureCache, both fire `secure-cache-migrated`. Post-P2:
    // module-level Map keys on `${userId}:${key}` so the second caller
    // awaits the first caller's migration result.
    const legacyData = { full_name: "Marie", streak_days: 7 };
    await mockedAsyncStorage.setItem(
      "@companion_cache:user-1:profile",
      JSON.stringify({ data: legacyData, timestamp: Date.now(), ttlMs: 60_000 })
    );

    // Kick off two parallel reads.
    const [outA, outB] = await Promise.all([
      getCache<typeof legacyData>("user-1", CACHE_KEYS.PROFILE),
      getCache<typeof legacyData>("user-1", CACHE_KEYS.PROFILE),
    ]);

    // Both calls return the migrated data.
    expect(outA).toEqual(legacyData);
    expect(outB).toEqual(legacyData);
    // SecureStore was written EXACTLY ONCE (serialized by the in-flight gate).
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    // Migration breadcrumb fired EXACTLY ONCE.
    const migrationBreadcrumbs = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-migrated"
    );
    expect(migrationBreadcrumbs).toHaveLength(1);
  });
});

describe("Story 12-7 review-round-1 P3 — offline cold-launch with legacy entry falls back through legacy plaintext", () => {
  it("Case 16: cacheWithFallback with offline fetchFn + legacy plaintext entry only → returns legacy data (no migration runs)", async () => {
    // Pre-patch: cacheWithFallback's catch-branch called readSecureCacheIgnoreTTL,
    // which returned null because no migration had run yet. The function then
    // re-threw fetchErr — user got a hard error despite having a cached profile
    // in plaintext AsyncStorage. Post-P3: the catch-branch now also tries
    // readLegacyPlaintextEntry as a second fallback for secure keys.
    const legacyData = { full_name: "Marie", streak_days: 7 };
    await mockedAsyncStorage.setItem(
      "@companion_cache:user-1:profile",
      JSON.stringify({ data: legacyData, timestamp: Date.now(), ttlMs: 60_000 })
    );
    // SecureStore is empty — no prior migration has run.
    const fetchFn = jest.fn(async () => {
      throw new Error("network down");
    });

    const result = await cacheWithFallback<typeof legacyData>(
      "user-1",
      CACHE_KEYS.PROFILE,
      fetchFn,
      60_000
    );

    expect(result.fromCache).toBe(true);
    expect(result.data).toEqual(legacyData);
    // SecureStore was NOT written during the fallback path (migration runs on
    // the NEXT getCache, not during this offline-fallback).
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

describe("Story 12-7 review-round-1 P9 — end-to-end round-trip via the real setCache + cacheWithFallback flow", () => {
  it("Case 17: setCache → fetchFn-fails → cacheWithFallback returns the secured value (full production flow)", async () => {
    // Pre-patch Case 7 seeded SecureStore directly via mockedSecureStore.setItemAsync,
    // bypassing the keychainAccessible pin in production setSecureCache. Case 17
    // drives the full flow: production setCache fires real setItemAsync (with the
    // accessibility option), then cacheWithFallback's catch-branch reads it back.
    const profileData = { full_name: "Marie", streak_days: 7 };

    // Drive the real production write path.
    await setCache("user-1", CACHE_KEYS.PROFILE, profileData, 60_000);
    // Verify the production write passed the iOS keychain accessibility pin.
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    const [, , options] = mockedSecureStore.setItemAsync.mock.calls[0] as [
      string,
      string,
      { keychainAccessible: unknown },
    ];
    expect(options).toMatchObject({
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    // Now drive a fetchFn-fails read.
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
  });
});

describe("Story 12-7 review-round-1 P19 — web platform fork (cache.ts runtime verification)", () => {
  it("Case 18: Platform.OS === 'web' + setCache for profile → AsyncStorage.setItem fires + SecureStore NOT called", async () => {
    // Pre-patch the AC #2 wording required this fork to exist but no
    // runtime test verified it at the cache.ts level. A future refactor
    // dropping `&& Platform.OS !== 'web'` from the fork conditional would
    // route web users to SecureStore (which early-returns silently).
    (Platform as unknown as { OS: string }).OS = "web";

    await setCache("user-1", CACHE_KEYS.PROFILE, { full_name: "Marie" }, 60_000);

    expect(mockedAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(mockedAsyncStorage.setItem.mock.calls[0][0]).toBe("@companion_cache:user-1:profile");
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
