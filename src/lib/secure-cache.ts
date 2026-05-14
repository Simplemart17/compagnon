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
 * - Module is stateless — SecureStore IS the storage; no module-level
 *   variables to reset between tests (P17 review-round-1 grammar fix).
 *   Test files reset the SecureStore in-memory mock via the mock's own
 *   `__reset()` helper, not via this module.
 * - Platform-fallback for web mirrors `src/lib/supabase.ts:24`
 *   (`Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter`).
 * - Error handling mirrors `cache.ts:117` swallow-and-breadcrumb so the
 *   call site is non-failing on storage hiccups.
 *
 * **iOS passcode requirement (P10 review-round-1 caveat):**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` requires the user to have a device
 * passcode set. iOS rejects `setItemAsync` with this accessibility
 * class when no passcode is configured. The current catch-branch
 * swallows the failure to a warning breadcrumb (`secure-cache-set-fail`)
 * — operators monitoring this breadcrumb's frequency can identify
 * passcode-less users whose profile cache never persists. Downgrading
 * to `WHEN_UNLOCKED` would work without passcode but allows iCloud
 * Backup inclusion (rejected — defeats the P1-11 backup-restore-on-
 * attacker-device defense). Deferred to future story if telemetry
 * shows meaningful passcode-less user population.
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
 * SecureStore key charset (P12 review-round-1): SecureStore.setItemAsync
 * rejects keys containing any char outside this set with a runtime
 * error. Supabase user-IDs are typically UUIDs (safe), but defense-in-
 * depth against legacy OIDC subs that may contain `:` or other chars.
 */
const SECURE_KEY_CHARSET = /^[A-Za-z0-9._-]+$/;

/**
 * Sanitize a user-id or key segment for SecureStore's charset constraint.
 * Replaces every character outside `[A-Za-z0-9._-]` with `_`. This is
 * deterministic + bijective enough for cache use (the userId is opaque
 * to the cache layer; collisions across users are impossible because
 * Supabase guarantees unique user-IDs, and the sanitization is the same
 * for a given userId).
 */
function sanitizeSecureKeySegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Build a fully-qualified SecureStore key for a user + logical cache key.
 *
 * Pure helper — no side effects. Returns the canonical
 * `companion_secure_<userId>_<key>` shape that satisfies SecureStore's
 * `[A-Za-z0-9._-]+` charset constraint.
 *
 * **P12 review-round-1 defenses:**
 * - Throws on empty `userId` or empty `key` — collidable keys like
 *   `companion_secure__profile` would otherwise allow multiple empty-
 *   userId callers to overwrite each other.
 * - Sanitizes both segments through `sanitizeSecureKeySegment` so a
 *   future OIDC sub containing `:`, spaces, or unicode doesn't cause
 *   SecureStore to reject the call at runtime (deterministic — same
 *   input → same key).
 */
export function buildSecureKey(userId: string, key: string): string {
  if (!userId || !key) {
    throw new Error("buildSecureKey requires non-empty userId and key");
  }
  const safeUserId = SECURE_KEY_CHARSET.test(userId) ? userId : sanitizeSecureKeySegment(userId);
  const safeKey = SECURE_KEY_CHARSET.test(key) ? key : sanitizeSecureKeySegment(key);
  return `${SECURE_KEY_PREFIX}${safeUserId}_${safeKey}`;
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
 * P4 review-round-1: validate that a JSON.parse-d value matches the
 * envelope shape `{data, timestamp: number, ttlMs: number}`.
 *
 * Without this guard, a stored entry of `42`, `null`, `{}`, or `{x:1}`
 * (manually poisoned, partial write, future schema migration) parses
 * cleanly but produces `entry.timestamp === undefined`. Downstream:
 * `Date.now() - undefined = NaN`, `NaN > ttlMs = false` → caller
 * receives `entry.data` (which may be `undefined`) as a "fresh cache
 * hit," violating the `Promise<T | null>` type contract.
 *
 * Pure helper — no side effects. Defensive value check, not a real type
 * predicate (we use `unknown` then check fields manually because the
 * compile-time `T` could be anything).
 */
function isValidEnvelope(
  value: unknown
): value is { data: unknown; timestamp: number; ttlMs: number } {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    "data" in obj &&
    typeof obj.timestamp === "number" &&
    Number.isFinite(obj.timestamp) &&
    typeof obj.ttlMs === "number" &&
    Number.isFinite(obj.ttlMs)
  );
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    // P4 review-round-1: shape-validate the envelope so non-envelope
    // payloads (`42`, `null`, `{}`, `{x:1}`) don't silently return
    // `undefined` as a cache hit.
    if (!isValidEnvelope(parsed)) {
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key)).catch(() => {});
      return null;
    }
    return parsed.data as T;
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupted JSON — treat as a cache miss and clean up the bad entry.
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key)).catch(() => {});
      return null;
    }
    // P4 review-round-1: shape-validate the envelope so non-envelope
    // payloads (`42`, `null`, `{}`, `{x:1}`) don't pass through to the
    // TTL math with `undefined` timestamp/ttlMs producing `NaN > ttlMs
    // = false` and returning `entry.data === undefined` as fresh.
    if (!isValidEnvelope(parsed)) {
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key)).catch(() => {});
      return null;
    }
    const age = Date.now() - parsed.timestamp;
    if (age > parsed.ttlMs) {
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key)).catch(() => {});
      return null;
    }
    return parsed.data as T;
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
 * @internal — Legacy AsyncStorage cache prefix used by `cache.ts:23` for
 * pre-12-7 plaintext entries. Internal-only — only the migration block
 * in `cache.ts:getCache` may use this; new callers MUST go through the
 * encryption fork. Marked `@internal` to discourage direct use that
 * would bypass audit P1-11's protection (P8 review-round-1).
 */
const LEGACY_PLAINTEXT_CACHE_PREFIX = "@companion_cache:";

/**
 * @internal — Build the legacy plaintext cache key for migration
 * lookups. Matches `cache.ts:buildKey` exactly:
 * `@companion_cache:<userId>:<key>`. Used by the cache.ts migration
 * block to read+delete the legacy entry on the first post-12-7 read.
 *
 * Module-private — not exported. Migration helpers below close over it.
 */
function buildLegacyCacheKey(userId: string, key: string): string {
  return `${LEGACY_PLAINTEXT_CACHE_PREFIX}${userId}:${key}`;
}

/**
 * @internal — Read the legacy plaintext entry if it exists. Returns
 * null on miss OR on parse failure (corrupted legacy entries are
 * treated as non-existent — migration skips them).
 *
 * **P4 review-round-1**: parsed-but-non-envelope shapes (`42`, `null`,
 * `{}`, `{x:1}`) return null so the migration block does NOT write
 * undefined data + undefined ttlMs to SecureStore.
 *
 * **P8 review-round-1**: exported (TypeScript can't model "module-
 * scope export") but JSDoc-marked `@internal` so reviewers know any
 * non-`cache.ts` caller is bypassing the encryption fork — exactly
 * the P1-11 leak vector. New callers MUST use `getCache(userId, key)`
 * instead, which forks on `SECURE_CACHE_KEYS`.
 */
export async function readLegacyPlaintextEntry<T>(
  userId: string,
  key: string
): Promise<SecureCacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(buildLegacyCacheKey(userId, key));
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    // P4 review-round-1: shape-validate so non-envelope payloads don't
    // poison the migration write path.
    if (!isValidEnvelope(parsed)) {
      return null;
    }
    return parsed as SecureCacheEntry<T>;
  } catch {
    return null;
  }
}

/**
 * @internal — Delete the legacy plaintext entry. Returns a Promise the
 * caller MUST await before firing the `secure-cache-migrated`
 * breadcrumb (P6 review-round-1) so a failed delete doesn't trigger
 * re-migration + re-fire on the next cold start.
 *
 * **P8 review-round-1**: marked `@internal` for the same reason as
 * `readLegacyPlaintextEntry` above — direct use bypasses encryption.
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
 * **P13 review-round-1**: The function is genuinely a no-op because
 * SecureStore IS the storage (no module-level state to reset). Test
 * files reset the SecureStore in-memory mock via the mock's own
 * `__reset()` helper, NOT via this function. Kept for ergonomic
 * symmetry with `__resetAudioStreamManagerForTests` AND for future-
 * proofing: if a future operator adds module-level state (e.g., a
 * migration-in-flight `Map`), they can populate this function without
 * touching call sites. The runtime guard still throws outside test
 * contexts so the function can't accidentally run in production.
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
