/**
 * Story 15-1 — pure unit tests for `cache.ts` core API
 * (`getCache` / `setCache` / `invalidateCache` / `cacheWithFallback`).
 *
 * Existing coverage NOT duplicated here:
 *   - `cache-flush.test.ts` covers `flushWriteQueue` idempotency
 *   - `cache-secure-routing.test.ts` covers the SecureStore fork for
 *     `CACHE_KEYS.PROFILE` (the only entry in `SECURE_CACHE_KEYS`)
 *
 * Tests here exercise the AsyncStorage plaintext path. We use a NON-secure
 * key (`"skills"`) to avoid the SecureStore fork. The `react-native`
 * `Platform.OS` mock returns `"ios"` (the SecureStore fork is gated on
 * `SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web"` — using a non-secure
 * key short-circuits before the platform check).
 *
 * Cache-key format pinned: `@companion_cache:<userId>:<key>`.
 * Cache entry envelope: `{ data, timestamp, ttlMs }` JSON.
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    getAllKeys: jest.fn(),
    multiRemove: jest.fn(),
  },
}));

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// network.ts is touched by enqueueWrite/flushWriteQueue but not by the
// core API tested here. Mock defensively to keep the module evaluation clean.
jest.mock("@/src/lib/network", () => ({
  __esModule: true,
  isOnline: jest.fn(async () => true),
}));

// secure-cache.ts is imported by cache.ts but only invoked when the key is
// in SECURE_CACHE_KEYS. Our tests use non-secure keys; mocks return null/no-op.
jest.mock("@/src/lib/secure-cache", () => ({
  __esModule: true,
  clearSecureCacheForUser: jest.fn(async () => undefined),
  deleteLegacyPlaintextEntry: jest.fn(async () => undefined),
  getSecureCache: jest.fn(async () => null),
  invalidateSecureCache: jest.fn(async () => undefined),
  readLegacyPlaintextEntry: jest.fn(async () => null),
  readSecureCacheIgnoreTTL: jest.fn(async () => null),
  setSecureCache: jest.fn(async () => undefined),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CACHE_KEYS,
  CACHE_TTL,
  SECURE_CACHE_KEYS,
  cacheWithFallback,
  getCache,
  invalidateCache,
  setCache,
} from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockCaptureError = captureError as jest.Mock;

const USER_ID = "user-abc";
const TEST_KEY = "skills"; // NON-secure key — exercises AsyncStorage path
const FULL_KEY = `@companion_cache:${USER_ID}:${TEST_KEY}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Story 15-1 — cache.ts core API", () => {
  describe("getCache — read path", () => {
    it("Case 1: empty storage returns null", async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);
      const out = await getCache<{ score: number }>(USER_ID, TEST_KEY);
      expect(out).toBeNull();
      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(FULL_KEY);
    });

    it("Case 2: fresh entry returned with original data", async () => {
      const payload = { score: 42 };
      const entry = { data: payload, timestamp: Date.now(), ttlMs: 60_000 };
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(entry));
      const out = await getCache<{ score: number }>(USER_ID, TEST_KEY);
      expect(out).toEqual(payload);
      expect(mockAsyncStorage.removeItem).not.toHaveBeenCalled();
    });

    it("Case 3: TTL boundary — entry exactly 1ms below ttlMs is returned fresh", async () => {
      const ttlMs = 60_000;
      const entry = { data: { v: 1 }, timestamp: Date.now() - (ttlMs - 1), ttlMs };
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(entry));
      const out = await getCache<{ v: number }>(USER_ID, TEST_KEY);
      expect(out).toEqual({ v: 1 });
    });

    it("Case 4: TTL boundary — entry expired (age > ttlMs) returns null AND triggers async removeItem cleanup", async () => {
      const ttlMs = 60_000;
      const entry = { data: { v: 1 }, timestamp: Date.now() - (ttlMs + 1), ttlMs };
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(entry));
      const out = await getCache<{ v: number }>(USER_ID, TEST_KEY);
      expect(out).toBeNull();
      // Cleanup is fired-and-forget; verify it was called for the right key.
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(FULL_KEY);
    });

    it("Case 5: corrupted JSON returns null AND routes through captureError (Story 9-3 cache-get tag)", async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce("not valid json{{{");
      const out = await getCache(USER_ID, TEST_KEY);
      expect(out).toBeNull();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.any(Error),
        "cache-get",
        expect.objectContaining({ key: TEST_KEY })
      );
    });

    it("Case 6: AsyncStorage.getItem throws — returns null + captureError fires", async () => {
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error("storage offline"));
      const out = await getCache(USER_ID, TEST_KEY);
      expect(out).toBeNull();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.any(Error),
        "cache-get",
        expect.objectContaining({ key: TEST_KEY })
      );
    });
  });

  describe("setCache — write path", () => {
    it("Case 7: setCache writes a {data, timestamp, ttlMs} envelope to the namespaced key", async () => {
      mockAsyncStorage.setItem.mockResolvedValueOnce(undefined);
      const before = Date.now();
      await setCache(USER_ID, TEST_KEY, { foo: "bar" }, 5_000);
      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
      const [key, value] = mockAsyncStorage.setItem.mock.calls[0];
      expect(key).toBe(FULL_KEY);
      const parsed = JSON.parse(value);
      expect(parsed.data).toEqual({ foo: "bar" });
      expect(parsed.ttlMs).toBe(5_000);
      expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
      expect(parsed.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("Case 8: setCache uses DEFAULT_TTL_MS (1 hour) when ttlMs omitted", async () => {
      mockAsyncStorage.setItem.mockResolvedValueOnce(undefined);
      await setCache(USER_ID, TEST_KEY, { foo: "bar" });
      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed.ttlMs).toBe(60 * 60 * 1000);
    });

    it("Case 9: setCache silently swallows AsyncStorage.setItem error + captureError fires", async () => {
      mockAsyncStorage.setItem.mockRejectedValueOnce(new Error("disk full"));
      await expect(setCache(USER_ID, TEST_KEY, { foo: "bar" })).resolves.toBeUndefined();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.any(Error),
        "cache-set",
        expect.objectContaining({ key: TEST_KEY })
      );
    });

    it("Case 10: cache-key namespacing — different userIds with the same logical key DO NOT collide", async () => {
      mockAsyncStorage.setItem.mockResolvedValue(undefined);
      await setCache("user-A", TEST_KEY, { v: 1 });
      await setCache("user-B", TEST_KEY, { v: 2 });
      const calls = mockAsyncStorage.setItem.mock.calls;
      expect(calls.length).toBe(2);
      const keyA = calls[0][0];
      const keyB = calls[1][0];
      expect(keyA).toBe(`@companion_cache:user-A:${TEST_KEY}`);
      expect(keyB).toBe(`@companion_cache:user-B:${TEST_KEY}`);
      expect(keyA).not.toBe(keyB);
    });
  });

  describe("setCache → getCache round-trip", () => {
    it("Case 11: setCache → getCache round-trip returns the original data structure", async () => {
      // Capture what setCache writes, then feed it back via getCache.
      mockAsyncStorage.setItem.mockResolvedValueOnce(undefined);
      const payload = { nested: { a: 1, b: [2, 3], c: "x" } };
      await setCache(USER_ID, TEST_KEY, payload, 60_000);
      const writtenValue = mockAsyncStorage.setItem.mock.calls[0][1];
      mockAsyncStorage.getItem.mockResolvedValueOnce(writtenValue);
      const readBack = await getCache<typeof payload>(USER_ID, TEST_KEY);
      expect(readBack).toEqual(payload);
    });
  });

  describe("invalidateCache", () => {
    it("Case 12: invalidateCache calls AsyncStorage.removeItem for the namespaced key", async () => {
      mockAsyncStorage.removeItem.mockResolvedValueOnce(undefined);
      await invalidateCache(USER_ID, TEST_KEY);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(FULL_KEY);
    });

    it("Case 13: invalidateCache silently swallows removeItem error + captureError fires", async () => {
      mockAsyncStorage.removeItem.mockRejectedValueOnce(new Error("io failure"));
      await expect(invalidateCache(USER_ID, TEST_KEY)).resolves.toBeUndefined();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.any(Error),
        "cache-invalidate",
        expect.objectContaining({ key: TEST_KEY })
      );
    });
  });

  describe("cacheWithFallback — 4 happy + offline paths", () => {
    it("Case 14: fetcher succeeds → returns {data, fromCache:false} AND writes to cache", async () => {
      const fetched = { score: 99 };
      const fetchFn = jest.fn(async () => fetched);
      mockAsyncStorage.setItem.mockResolvedValueOnce(undefined);
      const result = await cacheWithFallback(USER_ID, TEST_KEY, fetchFn);
      expect(result.fromCache).toBe(false);
      expect(result.data).toEqual(fetched);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      // Verify setCache was called (via AsyncStorage.setItem)
      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    });

    it("Case 15: fetcher throws AND stale cache exists → returns cached value with fromCache:true (ignores TTL)", async () => {
      // Stale entry far past TTL
      const stale = { v: "stale" };
      const expiredEntry = { data: stale, timestamp: Date.now() - 999_999_999, ttlMs: 1_000 };
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(expiredEntry));
      const fetchFn = jest.fn(async () => {
        throw new Error("offline");
      });
      const result = await cacheWithFallback(USER_ID, TEST_KEY, fetchFn);
      expect(result.fromCache).toBe(true);
      expect(result.data).toEqual(stale);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("Case 16: fetcher throws AND no cache exists → rethrows the original fetch error", async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);
      const fetchErr = new Error("network down");
      const fetchFn = jest.fn(async () => {
        throw fetchErr;
      });
      await expect(cacheWithFallback(USER_ID, TEST_KEY, fetchFn)).rejects.toBe(fetchErr);
    });

    it("Case 17: fetcher throws AND cache read also throws → captureError fires for fallback-read + rethrows original error", async () => {
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error("cache read also fails"));
      const fetchErr = new Error("network down");
      const fetchFn = jest.fn(async () => {
        throw fetchErr;
      });
      await expect(cacheWithFallback(USER_ID, TEST_KEY, fetchFn)).rejects.toBe(fetchErr);
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.any(Error),
        "cache-fallback-read",
        expect.objectContaining({ key: TEST_KEY })
      );
    });
  });

  describe("Exported constants — CACHE_KEYS, CACHE_TTL, SECURE_CACHE_KEYS", () => {
    it("Case 18: CACHE_KEYS contains the documented operator-readable keys", () => {
      // Spot-check the load-bearing keys without freezing the full enum.
      expect(CACHE_KEYS.PROFILE).toBe("profile");
      expect(CACHE_KEYS.VOCABULARY).toBe("vocabulary");
      expect(CACHE_KEYS.SKILLS).toBe("skills");
      expect(CACHE_KEYS.DAILY_BRIEFING).toBe("daily_briefing");
      expect(CACHE_KEYS.HOME_AGGREGATE).toBe("home_aggregate");
    });

    it("Case 19: CACHE_TTL values match documented durations (in ms)", () => {
      expect(CACHE_TTL.PROFILE).toBe(4 * 60 * 60 * 1000); // 4 hours
      expect(CACHE_TTL.VOCABULARY).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(CACHE_TTL.SKILLS).toBe(30 * 60 * 1000); // 30 minutes
      expect(CACHE_TTL.DAILY_ACTIVITY).toBe(15 * 60 * 1000); // 15 minutes
      expect(CACHE_TTL.DAILY_BRIEFING).toBe(10 * 60 * 1000); // 10 minutes
      expect(CACHE_TTL.HOME_AGGREGATE).toBe(5 * 60 * 1000); // 5 minutes (Story 13-2)
    });

    it("Case 20: SECURE_CACHE_KEYS pins exactly CACHE_KEYS.PROFILE (Story 12-7 allowlist)", () => {
      expect(SECURE_CACHE_KEYS.has(CACHE_KEYS.PROFILE)).toBe(true);
      // Non-secure keys should NOT be in the allowlist.
      expect(SECURE_CACHE_KEYS.has(CACHE_KEYS.SKILLS)).toBe(false);
      expect(SECURE_CACHE_KEYS.has(CACHE_KEYS.VOCABULARY)).toBe(false);
      expect(SECURE_CACHE_KEYS.size).toBe(1);
    });
  });
});
