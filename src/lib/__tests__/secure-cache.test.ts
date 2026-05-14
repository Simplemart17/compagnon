/**
 * Story 12-7 — `secure-cache` unit tests.
 *
 * Pins the SecureStore wrapper contract for the encrypted profile cache.
 * The load-bearing assertions:
 *   (a) Round-trip — set + get returns the same data within TTL.
 *   (b) TTL expiry — expired entries return `null` AND fire `deleteItemAsync`.
 *   (c) iOS keychain accessibility pinned to `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 *       so data is unavailable when device is locked AND NOT backed up to
 *       iCloud (audit P1-11 closure).
 *   (d) Platform fallback — `Platform.OS === "web"` early-returns; no
 *       SecureStore calls fire.
 *   (e) Failure handling — SecureStore throws are captured + breadcrumbed
 *       (`feature: "secure-cache-{set,get}-fail"`) + do NOT propagate.
 *   (f) `buildSecureKey` charset constraint — uses `_` separators, never `:`.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  __resetSecureCacheForTests,
  buildSecureKey,
  clearSecureCacheForUser,
  getSecureCache,
  invalidateSecureCache,
  setSecureCache,
} from "../secure-cache";
import { addBreadcrumb, captureError } from "../sentry";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// AsyncStorage mock — `secure-cache.ts` imports AsyncStorage for the
// migration helpers (`readLegacyPlaintextEntry` + `deleteLegacyPlaintextEntry`).
// In-memory store; tests reset via `__reset`.
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
      __reset: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  };
});

// SecureStore mock — in-memory store keyed by SecureStore key. Tests can
// override individual methods via jest.spyOn or mockImplementationOnce.
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
    // SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY is a string constant in the
    // real SDK; pin a recognizable value so the test can assert it's passed.
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    __reset: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
});

// Platform mock — default to iOS so SecureStore is exercised; tests that
// need web behavior toggle via `mockPlatform("web")`.
jest.mock("react-native", () => ({
  __esModule: true,
  Platform: { OS: "ios" },
}));

function mockPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

const mockedSecureStore = SecureStore as unknown as {
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __reset: () => void;
};

const mockedAsyncStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  __reset: () => void;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSecureStore.__reset();
  mockedAsyncStorage.__reset();
  mockPlatform("ios"); // default
});

describe("Story 12-7 — secure-cache round-trip", () => {
  it("Case 1: setSecureCache + getSecureCache round-trips a typed object", async () => {
    interface ProfileLike {
      id: string;
      full_name: string;
      streak_days: number;
    }
    const data: ProfileLike = { id: "user-1", full_name: "Marie", streak_days: 7 };
    await setSecureCache("user-1", "profile", data, 60 * 60 * 1000 /* 1h */);
    const out = await getSecureCache<ProfileLike>("user-1", "profile");
    expect(out).toEqual(data);
  });

  it("Case 2: TTL expiry — set with ttlMs:100, advance Date.now past expiry, get returns null + deleteItemAsync fires", async () => {
    const realNow = Date.now;
    let frozenNow = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => frozenNow);
    try {
      await setSecureCache("user-1", "profile", { id: "user-1" }, 100);
      // Advance past expiry.
      frozenNow += 200;
      const out = await getSecureCache("user-1", "profile");
      expect(out).toBeNull();
      // deleteItemAsync was called to clean up the expired entry.
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(
        buildSecureKey("user-1", "profile")
      );
    } finally {
      Date.now = realNow;
    }
  });
});

describe("Story 12-7 — buildSecureKey charset constraint", () => {
  it("Case 3: output uses `companion_secure_<userId>_<key>` shape — no `:` separators (SecureStore charset rule)", () => {
    const key = buildSecureKey("user-abc-123", "profile");
    expect(key).toBe("companion_secure_user-abc-123_profile");
    expect(key).not.toContain(":");
    // SecureStore charset: [A-Za-z0-9._-]+
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("Story 12-7 — platform fallback (web)", () => {
  it("Case 4: Platform.OS === 'web' — setSecureCache early-returns, no SecureStore calls fire", async () => {
    mockPlatform("web");
    await setSecureCache("user-1", "profile", { id: "user-1" }, 60_000);
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("Case 5: Platform.OS === 'web' — getSecureCache returns null without calling SecureStore", async () => {
    mockPlatform("web");
    const out = await getSecureCache("user-1", "profile");
    expect(out).toBeNull();
    expect(mockedSecureStore.getItemAsync).not.toHaveBeenCalled();
  });
});

describe("Story 12-7 — iOS keychain accessibility pin (audit P1-11 closure)", () => {
  it("Case 6: setSecureCache invokes SecureStore.setItemAsync with keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY", async () => {
    await setSecureCache("user-1", "profile", { id: "user-1" }, 60_000);
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    const [, , options] = mockedSecureStore.setItemAsync.mock.calls[0] as [
      string,
      string,
      { keychainAccessible: string },
    ];
    expect(options).toMatchObject({
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
});

describe("Story 12-7 — failure handling (captureError + breadcrumb + no propagation)", () => {
  it("Case 7: SecureStore.setItemAsync throws → captured + `secure-cache-set-fail` breadcrumb + no propagation", async () => {
    mockedSecureStore.setItemAsync.mockRejectedValueOnce(new Error("keystore error"));
    // The call must NOT throw upstream.
    await expect(
      setSecureCache("user-1", "profile", { id: "user-1" }, 60_000)
    ).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), "secure-cache-set", {
      key: "profile",
    });
    const breadcrumbCalls = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-set-fail"
    );
    expect(breadcrumbCalls).toHaveLength(1);
  });

  it("Case 8: SecureStore.getItemAsync throws → captured + `secure-cache-get-fail` breadcrumb + returns null", async () => {
    mockedSecureStore.getItemAsync.mockRejectedValueOnce(new Error("keystore error"));
    const out = await getSecureCache("user-1", "profile");
    expect(out).toBeNull();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), "secure-cache-get", {
      key: "profile",
    });
    const breadcrumbCalls = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === "secure-cache-get-fail"
    );
    expect(breadcrumbCalls).toHaveLength(1);
  });

  it("Case 9: corrupted JSON in SecureStore — getSecureCache returns null without throwing", async () => {
    // Directly poison the store with non-JSON.
    mockedSecureStore.getItemAsync.mockResolvedValueOnce("{ not-valid-json");
    const out = await getSecureCache("user-1", "profile");
    expect(out).toBeNull();
  });
});

describe("Story 12-7 — invalidate + clear", () => {
  it("Case 10: invalidateSecureCache fires SecureStore.deleteItemAsync with the canonical key", async () => {
    await invalidateSecureCache("user-1", "profile");
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "companion_secure_user-1_profile"
    );
  });

  it("Case 11: clearSecureCacheForUser iterates the keys allowlist and deletes each", async () => {
    await clearSecureCacheForUser("user-1", ["profile", "vocabulary"]);
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "companion_secure_user-1_profile"
    );
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "companion_secure_user-1_vocabulary"
    );
  });
});

describe("Story 12-7 — test-only reset hook (Story 12-2 P11 pattern)", () => {
  it("Case 12: __resetSecureCacheForTests runs without throwing under NODE_ENV === 'test'", () => {
    // jest sets NODE_ENV === "test" automatically; this should not throw.
    expect(() => __resetSecureCacheForTests()).not.toThrow();
  });

  it("Case 13: __resetSecureCacheForTests throws when NODE_ENV !== 'test' (Story 12-2 P11 runtime guard)", () => {
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      expect(() => __resetSecureCacheForTests()).toThrow(
        "__resetSecureCacheForTests must only be called from tests"
      );
    } finally {
      env.NODE_ENV = originalNodeEnv;
    }
  });
});
