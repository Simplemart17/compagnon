/**
 * Encrypted cache wrapper around `expo-secure-store` (Story 12-7).
 *
 * Closes audit finding **P1-11** at
 * `_bmad-output/planning-artifacts/shippable-roadmap.md` line 63
 * ("Profile cache stores PII in plaintext AsyncStorage — readable on
 * rooted Android"). The Epic 12.7 deliverable at line 210 routes
 * `CACHE_KEYS.PROFILE` through this wrapper via a `SECURE_CACHE_KEYS`
 * allowlist fork inside `cache.ts`, so the auth-bootstrap consumer
 * (`src/lib/auth-bootstrap.ts:253` `cacheWithFallback<UserProfile>`)
 * compiles + runs unchanged.
 *
 * **Encryption substrate:**
 * - iOS: Keychain with Secure Enclave hardware-backing on devices that
 *   support it (iPhone 5s+). Pinned to `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 *   so data is (a) unavailable when the device is locked, (b) NOT
 *   backed up to iCloud (defends against backup-then-restore-on-
 *   attacker-device scenarios).
 * - Android: EncryptedSharedPreferences backed by Android Keystore with
 *   TEE (Trusted Execution Environment) hardware-backing on ~95% of
 *   devices shipped post-2018. Even a rooted device cannot extract the
 *   plaintext because the hardware key is fused into the chip.
 *
 * **Pattern alignment:**
 * - Module-level no state (SecureStore IS the storage) — `__resetSecureCacheForTests`
 *   is a no-op stub kept for test-symmetry with `audio-stream-manager`.
 * - Platform-fallback for web mirrors `src/lib/supabase.ts:24`
 *   (`Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter`).
 * - Error handling mirrors `cache.ts:117` swallow-and-breadcrumb so the
 *   call site is non-failing on storage hiccups.
 *
 * **Cross-story invariants preserved by construction:**
 * - Story 9-3 Sentry allowlist — 3 new `feature` tags, all ≤ 21 chars.
 * - Story 9-6 auth listener — `loadProfile` calls `cacheWithFallback`
 *   which forks internally; listener body unchanged.
 * - Story 9-10 + 12-2 — `applyProfileIfFresh` userId-guard +
 *   `profileFetchFailed` flag + `flushWriteQueue` Promise-gate all run
 *   ABOVE this layer; the encryption fork is below the API surface.
 *
 * **Out of scope (operator-deferred):**
 * - Biometric-gated reads (`requireAuthentication: true`) — the profile
 *   is read on every cold start; biometric per cold-start is bad UX.
 * - Encrypting low-PII keys (vocabulary, daily_briefing, streak) — the
 *   `SECURE_CACHE_KEYS` allowlist is extensible; future operator
 *   decision based on telemetry.
 * - iOS Keychain size limits — `UserProfile` payloads are typically <500
 *   bytes; well below the ~2KB soft limit. A future refactor adding
 *   large fields (e.g., base64 avatar) must reassess.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { addBreadcrumb, captureError } from "@/src/lib/sentry";

// SecureStore key charset: [A-Za-z0-9._-]+. The `cache.ts` separator `:`
// is REJECTED by SecureStore; we use underscore separators + a distinct
// prefix to avoid any collision with the existing `@companion_cache:`
// plaintext keys (which use the colon separator).
const SECURE_KEY_PREFIX = "companion_secure_";

/**
 * Build a fully-qualified SecureStore key for a user + logical cache key.
 *
 * Pure helper — no side effects. Returns the canonical
 * `companion_secure_<userId>_<key>` shape that satisfies SecureStore's
 * `[A-Za-z0-9._-]+` charset constraint.
 */
export function buildSecureKey(userId: string, key: string): string {
  return `${SECURE_KEY_PREFIX}${userId}_${key}`;
}

/**
 * Storage metadata envelope — matches `cache.ts`'s `CacheEntry<T>`
 * shape verbatim so TTL semantics are identical across the routing fork.
 */
interface SecureCacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

/**
 * Store an encrypted cache entry. Wraps `data` in a `{data, timestamp,
 * ttlMs}` envelope (matches the existing `cache.ts:110` shape) so TTL
 * checks behave identically across both stores.
 *
 * Platform fallback: on web, returns immediately without touching
 * SecureStore. The caller (`cache.ts` fork) is expected to route web
 * traffic back to AsyncStorage via the existing plaintext path.
 *
 * Error handling: on `SecureStore.setItemAsync` throw, captures via
 * `captureError(_, "secure-cache-set", { key })` AND emits a Sentry
 * breadcrumb with `feature: "secure-cache-set-fail"` so operators can
 * grep production logs for encryption-engine failures. Never propagates
 * (matches existing `cache.ts:117` swallow-and-breadcrumb pattern).
 *
 * iOS: pinned to `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` for
 * defense-in-depth.
 */
export async function setSecureCache<T>(
  userId: string,
  key: string,
  data: T,
  ttlMs: number
): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const entry: SecureCacheEntry<T> = { data, timestamp: Date.now(), ttlMs };
    await SecureStore.setItemAsync(buildSecureKey(userId, key), JSON.stringify(entry), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (err) {
    captureError(err, "secure-cache-set", { key });
    addBreadcrumb({
      category: "cache",
      level: "warning",
      message: "SecureStore set failed",
      data: { feature: "secure-cache-set-fail" },
    });
  }
}

/**
 * Read an encrypted cache entry IGNORING TTL — for offline-fallback paths
 * where stale-but-cached beats no-data. Mirrors the pre-12-7
 * `cacheWithFallback` catch-branch behavior verbatim. Returns null on
 * miss / parse failure. Web platform: returns null (matches the secure
 * path's platform fallback).
 *
 * Used by `cache.ts:cacheWithFallback` so the secure routing fork is
 * honored on fallback reads too, without re-introducing a TTL check
 * that wasn't there pre-12-7.
 */
export async function readSecureCacheIgnoreTTL<T>(userId: string, key: string): Promise<T | null> {
  if (Platform.OS === "web") return null;
  try {
    const raw = await SecureStore.getItemAsync(buildSecureKey(userId, key));
    if (!raw) return null;
    try {
      const entry: SecureCacheEntry<T> = JSON.parse(raw) as SecureCacheEntry<T>;
      return entry.data;
    } catch {
      return null;
    }
  } catch (err) {
    captureError(err, "secure-cache-get-ignore-ttl", { key });
    return null;
  }
}

/**
 * Read an encrypted cache entry. Returns null on miss, on TTL expiry, or
 * on any read/parse failure. On TTL expiry, asynchronously deletes the
 * stale entry to keep the store tidy (fire-and-forget `void` call —
 * deletion failure does not propagate).
 *
 * Platform fallback: web returns null immediately.
 *
 * Error handling: matches `setSecureCache` — captures + breadcrumbs
 * (`feature: "secure-cache-get-fail"`) + returns null.
 */
export async function getSecureCache<T>(userId: string, key: string): Promise<T | null> {
  if (Platform.OS === "web") return null;
  try {
    const raw = await SecureStore.getItemAsync(buildSecureKey(userId, key));
    if (!raw) return null;
    let entry: SecureCacheEntry<T>;
    try {
      entry = JSON.parse(raw) as SecureCacheEntry<T>;
    } catch {
      // Corrupted JSON — treat as a cache miss and clean up the bad entry.
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key)).catch(() => {});
      return null;
    }
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttlMs) {
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key)).catch(() => {});
      return null;
    }
    return entry.data;
  } catch (err) {
    captureError(err, "secure-cache-get", { key });
    addBreadcrumb({
      category: "cache",
      level: "warning",
      message: "SecureStore get failed",
      data: { feature: "secure-cache-get-fail" },
    });
    return null;
  }
}

/**
 * Delete a single encrypted cache entry. Platform-fallback: web is a
 * no-op. Error handling: captured + swallowed (no breadcrumb because
 * deletion failures are usually benign — entry-not-found etc.).
 */
export async function invalidateSecureCache(userId: string, key: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(buildSecureKey(userId, key));
  } catch (err) {
    captureError(err, "secure-cache-invalidate", { key });
  }
}

/**
 * Delete every SecureStore entry in the given allowlist for a user.
 *
 * SecureStore has NO `getAllKeys` equivalent (unlike AsyncStorage), so
 * the caller MUST pass an explicit list of logical keys to clear. The
 * orchestrator (`cache.ts:clearUserCache`) calls this with
 * `[...SECURE_CACHE_KEYS]` so a sign-out clears BOTH the plaintext +
 * encrypted stores.
 *
 * Platform-fallback: web is a no-op.
 */
export async function clearSecureCacheForUser(
  userId: string,
  keys: readonly string[]
): Promise<void> {
  if (Platform.OS === "web") return;
  for (const key of keys) {
    try {
      await SecureStore.deleteItemAsync(buildSecureKey(userId, key));
    } catch (err) {
      captureError(err, "secure-cache-clear", { key });
    }
  }
}

/**
 * **Legacy AsyncStorage cache prefix** used by `cache.ts:23` for plaintext
 * entries. Exported so the cache.ts migration block can build the legacy
 * key (`@companion_cache:<userId>:<key>`) WITHOUT importing the cache.ts
 * private helper. Story 12-7 introduces this constant here so the
 * migration logic stays in one module (close to the encryption code).
 */
export const LEGACY_PLAINTEXT_CACHE_PREFIX = "@companion_cache:";

/**
 * Build the legacy plaintext cache key for migration lookups. Matches
 * `cache.ts:buildKey` exactly: `@companion_cache:<userId>:<key>`. Used
 * by the cache.ts migration block to read+delete the legacy entry on
 * the first post-12-7 read.
 */
export function buildLegacyCacheKey(userId: string, key: string): string {
  return `${LEGACY_PLAINTEXT_CACHE_PREFIX}${userId}:${key}`;
}

/**
 * Read the legacy plaintext entry if it exists. Returns null on miss
 * OR on parse failure (corrupted legacy entries are treated as
 * non-existent — migration skips them).
 *
 * Used by `cache.ts:getCache` migration block: on the first post-12-7
 * read for a secure key, this helper checks AsyncStorage; if a legacy
 * entry exists, the caller writes it to SecureStore + deletes from
 * AsyncStorage + fires `secure-cache-migrated` breadcrumb.
 */
export async function readLegacyPlaintextEntry<T>(
  userId: string,
  key: string
): Promise<SecureCacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(buildLegacyCacheKey(userId, key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SecureCacheEntry<T>;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Delete the legacy plaintext entry (fire-and-forget — failures are
 * benign because the SecureStore copy is authoritative after migration).
 */
export async function deleteLegacyPlaintextEntry(userId: string, key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(buildLegacyCacheKey(userId, key));
  } catch (err) {
    captureError(err, "secure-cache-legacy-delete", { key });
  }
}

/**
 * @internal — test-only reset hook (Story 12-2 P11 pattern).
 *
 * SecureStore itself is the storage, so there's no module-level state
 * to reset. This function is a no-op kept for test-symmetry with
 * `audio-stream-manager`'s `__resetAudioStreamManagerForTests` — the
 * runtime guard still throws outside test contexts so a future operator
 * who adds module-level state cannot accidentally invoke this from
 * production code.
 */
export function __resetSecureCacheForTests(): void {
  const inJest = typeof jest !== "undefined";
  const inTestEnv = typeof process !== "undefined" && process.env.NODE_ENV === "test";
  if (!inJest || !inTestEnv) {
    throw new Error(
      "__resetSecureCacheForTests must only be called from tests (NODE_ENV must be 'test' AND running under Jest)"
    );
  }
  // No-op: SecureStore is the storage.
}
