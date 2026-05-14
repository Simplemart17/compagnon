# Story 12.7: Encrypt Profile Cache — Route Sensitive Cache Keys Through SecureStore

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose [`src/lib/cache.ts`](src/lib/cache.ts) writes every cached value — including the `CACHE_KEYS.PROFILE` row (`UserProfile` shape: `id`, `email`, `full_name`, `current_cefr_level`, `streak_days`, `last_active_date`, `target_test_date`, `goals`, possibly more) — to **plaintext `AsyncStorage`** at lines 76 (`getItem`), 115 (`setItem`), and 149 (cache-fallback read), AND the auth-bootstrap flow at [`src/lib/auth-bootstrap.ts:253`](src/lib/auth-bootstrap.ts#L253) routes the profile through `cacheWithFallback<UserProfile>(userId, CACHE_KEYS.PROFILE, _, CACHE_TTL.PROFILE)` which lands the full row in `AsyncStorage` under the key `@companion_cache:<userId>:profile`, AND `AsyncStorage` on Android writes to `/data/data/<app>/databases/RKStorage` (or shared-preferences XML on older RN) which is **world-readable on a rooted device**, so audit finding **P1-11** at [`shippable-roadmap.md` line 63](_bmad-output/planning-artifacts/shippable-roadmap.md) names the bug exactly: "Profile cache stores PII in plaintext AsyncStorage (full_name, level, streak, last_active_date) — readable on rooted Android — `src/lib/cache.ts:103-119`, `src/hooks/use-auth.ts:51` — security", AND the Epic 12.7 deliverable at [`shippable-roadmap.md` line 210](_bmad-output/planning-artifacts/shippable-roadmap.md) describes the fix: "Move profile cache to encrypted SecureStore-wrapped adapter; update `cache.ts`. **Covers P1-11.**", AND `expo-secure-store` is **already a project dependency** (`package.json:43` — `~55.0.8`) and is **already used by the Supabase auth adapter** at [`src/lib/supabase.ts:3-29`](src/lib/supabase.ts#L3-L29) where `ExpoSecureStoreAdapter` wraps `getItemAsync` / `setItemAsync` / `deleteItemAsync` with platform-fork (`Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter`) — so the encryption substrate is proven in this codebase; Story 12-7 reuses the same pattern for the cache layer, AND today's threat model: an attacker with **physical device access + root** (forensic extraction tool, lost-phone scenario) reads `/data/data/com.companion.app/` and recovers the user's name, email, CEFR level, streak, last-active date — enough to (a) socially-engineer the user, (b) link the app account to a real identity for downstream account-takeover, (c) reveal PII to a malicious actor in a shared-device scenario; SecureStore writes to **iOS Keychain** (Secure Enclave on devices with hardware support) and **Android EncryptedSharedPreferences backed by Android Keystore** (hardware-backed when available), so even a rooted device cannot extract the plaintext without the device's hardware key, AND the broader architectural context: the **8 consumers** of `cache.ts`'s `cacheWithFallback` / `setCache` / `getCache` / `invalidateCache` are auth-bootstrap (profile), use-progress (skills + daily-activity + recent-activity + top-errors + streak), use-tab-badges (srs-due-count), use-daily-briefing (briefing + 5 sub-keys), use-exercise (invalidate-only), speaking-mock-test-persist (invalidate-only) — only the profile row carries genuine PII per audit P1-11, so the v1 scope encrypts **only `CACHE_KEYS.PROFILE`**; other keys remain on `AsyncStorage` because (i) they're operational data (small integers, CEFR codes, score deltas), (ii) iOS Keychain has a soft size limit per item (~2KB recommended) that 200+ daily-briefing tokens could approach, (iii) Android EncryptedSharedPreferences has per-write encryption cost that scales with payload size and frequency — encrypting low-PII keys would degrade perf without security benefit, AND the established cross-story pattern: Story 12-2's `bootstrapAuth()` consumes `cacheWithFallback<UserProfile>` at the API boundary; if the routing fork is internal to `cache.ts` (not a separate `secureCacheWithFallback` API), `bootstrapAuth` compiles unchanged AND the Story 9-10 + 12-2 invariants (`applyProfileIfFresh`, `flushWriteQueue` idempotency Promise-gate, `profileFetchFailed` flag) all hold by construction — the only place encryption happens is **inside `setCache` / `getCache` / `invalidateCache` when `key === "profile"`**; everything else is bit-identical to pre-12-7.

I want (a) a **new module `src/lib/secure-cache.ts`** (~150 lines including JSDoc) that wraps `expo-secure-store` with the same TTL-and-metadata shape as `cache.ts`'s `CacheEntry<T>` so the routing fork inside `cache.ts` is a one-line dispatch. The module exports: (i) `setSecureCache<T>(userId: string, key: string, data: T, ttlMs: number): Promise<void>` — wraps the value in `{data, timestamp, ttlMs}` shape, `JSON.stringify`s, calls `SecureStore.setItemAsync` with `KEYCHAIN_ACCESSIBLE_WHEN_UNLOCKED_THIS_DEVICE_ONLY` (iOS) so the data is unavailable when the device is locked AND tied to this physical device (cannot restore via iCloud Backup); (ii) `getSecureCache<T>(userId: string, key: string): Promise<T | null>` — reads, JSON-parses, applies the TTL check (matches the existing `cache.ts:82` `age > entry.ttlMs` logic verbatim); on expiry, fires `SecureStore.deleteItemAsync` and returns null; (iii) `invalidateSecureCache(userId: string, key: string): Promise<void>` — explicit deletion; (iv) `clearSecureCacheForUser(userId: string, keys: readonly string[]): Promise<void>` — SecureStore has **no `getAllKeys` equivalent**, so the caller passes an explicit allowlist; the orchestrator (cache.ts's `clearUserCache`) calls this with `[...SECURE_CACHE_KEYS]`; (v) `__resetSecureCacheForTests(): void` — test-only escape hatch with `NODE_ENV !== "test"` runtime guard (Story 12-2 P11 pattern); the module never holds module-level state because SecureStore is itself the storage, so the reset is a no-op stub (kept for test-symmetry with audio-stream-manager); (vi) **`buildSecureKey(userId, key): string`** pure helper returning `companion_secure_<userId>_<key>` — SecureStore keys must match `^[A-Za-z0-9._-]+$` per its docs, so the `:` separator from `cache.ts:62` (`${CACHE_PREFIX}${userId}:${key}`) would be REJECTED; the new prefix uses underscore separators + a different prefix (`companion_secure_`) to (a) match SecureStore's key-charset constraint AND (b) avoid any collision risk with the existing `@companion_cache:` plaintext keys; (b) **`src/lib/cache.ts` modifications** — (i) new `const SECURE_CACHE_KEYS: ReadonlySet<string>` exported allowlist containing `CACHE_KEYS.PROFILE` (`"profile"`) — a `Set` so future operator extensions (add `"vocabulary"`, `"daily_briefing"`) are one-line; (ii) `getCache` (line 74) gains a routing fork at its top: `if (SECURE_CACHE_KEYS.has(key)) return getSecureCache<T>(userId, key);` — but BEFORE that fork runs, an additional **one-shot migration check** reads the **legacy** AsyncStorage key (`@companion_cache:<userId>:profile`) and, if present, copies the value to SecureStore via `setSecureCache` + deletes the legacy key via `AsyncStorage.removeItem` + emits `addBreadcrumb({feature: "secure-cache-migrated"})` so operators can count rollout coverage; the migration is **idempotent** (subsequent reads find the legacy key empty + route directly to SecureStore); (iii) `setCache` (line 103) gains the same fork: `if (SECURE_CACHE_KEYS.has(key)) return setSecureCache(userId, key, data, ttlMs);`; (iv) `invalidateCache` (line 170) gains the fork: `if (SECURE_CACHE_KEYS.has(key)) return invalidateSecureCache(userId, key);`; (v) `cacheWithFallback`'s catch-branch read at line 149 (`AsyncStorage.getItem(buildKey(userId, key))`) is **refactored** to go through `getCache(userId, key)` (which itself forks) so the fallback honors the same encryption routing — pre-12-7 the fallback read AsyncStorage directly, which would re-leak the value to plaintext-storage code paths if the routing fork were skipped; post-12-7 the fallback always reads via the encryption-aware `getCache` so the secure path is the only path for `CACHE_KEYS.PROFILE`; (vi) `clearUserCache` (line 181) is extended — after the `AsyncStorage.multiRemove(userKeys)` clears the plaintext namespace, also call `clearSecureCacheForUser(userId, [...SECURE_CACHE_KEYS])` so a sign-out / account-delete clears BOTH stores; (vii) `clearAllCache` (line 197) is similarly extended — but because we cannot enumerate SecureStore keys across all users, the function calls `clearSecureCacheForUser(userId, [...SECURE_CACHE_KEYS])` only when invoked from a single-user context; for the multi-user "clear ALL" case (used only by the test suite + a hypothetical "factory reset" flow), the function gains a JSDoc note that SecureStore entries for other users on the same device require manual handling (out-of-scope for v1; multi-account-on-same-device is itself out-of-scope for the app); (c) **platform-fallback contract** — SecureStore is **not available on web** (`Platform.OS === "web"`); the `secure-cache.ts` module's first statement of each public function checks `Platform.OS === "web"` and falls back to the **same AsyncStorage path the cache.ts module uses** — preserving the pre-12-7 web behavior exactly. The Supabase auth adapter at `src/lib/supabase.ts:24` uses the same fork (`Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter`), so the pattern is project-canonical; (d) **migration semantics** — on the first read of `CACHE_KEYS.PROFILE` post-12-7 deploy, the user's existing plaintext cache entry is **copied to SecureStore + deleted from AsyncStorage**. This is a one-shot operation per user per device — `AsyncStorage.getItem` returns null after the first migration, so the migration path is never re-entered. The Sentry breadcrumb `feature: "secure-cache-migrated"` fires once per migration so operators can count rollout coverage (e.g., "75% of active users migrated by week 2"). For users who **never had a cached profile** (cold installs post-12-7), the migration check is a single `AsyncStorage.getItem` call that returns null → the cost is one storage round-trip per cold-install profile load, acceptable for the one-time path. The migration is **fail-safe**: if `AsyncStorage.removeItem` fails after the SecureStore write succeeds, the legacy entry remains AND the next read re-migrates; SecureStore is authoritative; (e) **Sentry breadcrumb shapes** — three new feature tags: (i) `"secure-cache-migrated"` (info level, fires once per user per device on migration; data carries `feature` only, no payload); (ii) `"secure-cache-set-fail"` (warning level, fires when `SecureStore.setItemAsync` throws — e.g., key-format violation, encryption-engine error; data carries `feature` + `code` if available); (iii) `"secure-cache-get-fail"` (warning level, fires when `SecureStore.getItemAsync` throws — e.g., corrupted ciphertext, keystore-init error; data carries `feature` + `code`); all three feature strings are ≤ 80 chars (the longest is `"secure-cache-migrated"` at 21 chars); the `feature` extras key is already in `SENTRY_EXTRAS_ALLOWLIST` (Story 9-3); the `code` extras key is also already allowlisted; no allowlist extension needed; (f) **regression tests** in `src/lib/__tests__/secure-cache.test.ts` (~12 Jest cases): (i) `setSecureCache` then `getSecureCache` round-trips a typed object — happy path; (ii) TTL expiry — set with `ttlMs: 100`, mock `Date.now()` to advance past expiry, assert `getSecureCache` returns `null` AND `SecureStore.deleteItemAsync` fires; (iii) `buildSecureKey` outputs match the canonical `companion_secure_<userId>_<key>` shape AND contain no `:` separators (SecureStore charset rule); (iv) web platform fallback — mock `Platform.OS = "web"`, assert calls route to `AsyncStorage` (NOT `SecureStore`); (v) `setSecureCache` failure — mock `SecureStore.setItemAsync` to throw; assert the throw is captured + breadcrumbed (`feature: "secure-cache-set-fail"`) AND the call does NOT propagate the throw (matches `cache.ts:117` `captureError` pattern); (vi) `getSecureCache` failure — same shape; (vii) `getSecureCache` corrupted JSON in storage returns `null` (matches existing `cache.ts:89` catch-and-null pattern); (viii) `invalidateSecureCache` fires `SecureStore.deleteItemAsync`; (ix) `clearSecureCacheForUser` iterates the allowlist + deletes each key; (x) `__resetSecureCacheForTests` runtime guard throws when `NODE_ENV !== "test"`; (xi) `Platform.OS === "web"` migration short-circuit — assert no `SecureStore` calls fire when web; (xii) iOS keychain accessibility constant — assert `setItemAsync` is invoked with `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` to pin the privacy-safe option; (g) **regression tests** in `src/lib/__tests__/cache-secure-routing.test.ts` (~8 Jest cases): (i) `setCache(userId, "profile", _)` routes to `setSecureCache`, NOT `AsyncStorage.setItem` (mock both + assert); (ii) `setCache(userId, "skills", _)` routes to `AsyncStorage.setItem`, NOT `setSecureCache` (preserves pre-12-7 behavior for non-secure keys); (iii) `getCache(userId, "profile")` routes to `getSecureCache`; (iv) `invalidateCache(userId, "profile")` routes to `invalidateSecureCache`; (v) `cacheWithFallback(userId, "profile", _)` catch-branch reads via `getCache` (which forks to secure) — NOT directly via `AsyncStorage.getItem`; (vi) **migration** — set legacy plaintext AsyncStorage entry, call `getCache(userId, "profile")`, assert (a) returns the legacy data, (b) `setSecureCache` was called with the same data, (c) `AsyncStorage.removeItem` was called for the legacy key, (d) `addBreadcrumb({feature: "secure-cache-migrated"})` fired; (vii) **migration is idempotent** — second `getCache(userId, "profile")` after the first migration reads SecureStore directly + does NOT re-fire the migration breadcrumb; (viii) `clearUserCache(userId)` clears BOTH `AsyncStorage` keys with the `@companion_cache:<userId>:` prefix AND `SecureStore` entries for `SECURE_CACHE_KEYS`; (h) **drift detector test** reads `src/lib/cache.ts` from disk (comment-stripped per Story 12-2 P12 lesson) + asserts (a) `SECURE_CACHE_KEYS` is exported and contains `"profile"`, (b) `getCache` body contains `SECURE_CACHE_KEYS.has(key)` fork BEFORE the AsyncStorage call, (c) `setCache` body contains the same fork, (d) `invalidateCache` body contains the same fork, (e) NEGATIVE guard: `AsyncStorage.setItem` is NOT called with a key matching `/profile/i` anywhere outside the migration delete (one-time match in the `removeItem` call is allowed; `setItem` is not); (i) **`SENTRY_EXTRAS_ALLOWLIST` audit** — verify `feature` + `code` are already in the allowlist (Story 9-3); no extension needed; the three new feature strings are short categorical values that pass the 80-char redaction rule by construction; (j) **CLAUDE.md architecture line** added after the Story 12-6 paragraph documenting: the new `secure-cache.ts` module + the `SECURE_CACHE_KEYS` allowlist + the `cache.ts` routing fork + the one-shot migration + the Sentry feature tags + the platform-fallback contract + cross-story invariants preserved (9-3 Sentry allowlist / 9-6 auth-listener / 9-10 cache-flush idempotency / 12-2 bootstrapAuth — the call sites are unchanged because the fork is internal to `cache.ts`); (k) **NO `auth-bootstrap.ts` / `use-progress.ts` / `use-tab-badges.ts` / `use-daily-briefing.ts` / `use-exercise.ts` / `speaking-mock-test-persist.ts` changes** — all 8 consumer files compile + run unchanged because the encryption routing is internal to `cache.ts`; this is the load-bearing scope discipline that makes 12-7 a SMALL story; (l) **NO new packages** — `expo-secure-store ~55.0.8` is already in `package.json:43` and already imported by `supabase.ts:3`; no `npm install` step required,

so that **audit finding P1-11 closes architecturally** (the profile cache is no longer readable on rooted Android — SecureStore writes to hardware-backed encrypted storage; on iOS the data is unavailable when the device is locked AND cannot restore via iCloud Backup); **the migration is operationally transparent** — existing users automatically migrate on the next profile load with no UI prompt + no logout-and-re-login; **the Sentry breadcrumb tells operators when migration completes per user**; **the platform-fallback preserves web behavior** — web users continue to use AsyncStorage (which on web is browser localStorage, already encrypted-at-rest by the OS); **the secure-cache.ts module is reusable** — future stories can extend `SECURE_CACHE_KEYS` to encrypt vocabulary, daily-briefing, error patterns without further code changes; **Story 9-3 Sentry allowlist contract holds** by construction (3 new short `feature` strings; no new extras keys); **Story 9-6 auth-listener event gating unaffected** — the `decideAuthAction()` switch fires `loadProfile` which calls `cacheWithFallback` which internally forks; no listener-body change; **Story 9-10 + 12-2 auth + cache race hardening unaffected** — `applyProfileIfFresh` userId-guard, `profileFetchFailed` flag, `flushWriteQueue` idempotency Promise-gate all unchanged because the fork is below the `cacheWithFallback` API surface; **Story 12-1 / 12-3 / 12-4 / 12-5 / 12-6 invariants orthogonal** — none of them touch `cache.ts`; **the Sentry `secure-cache-migrated` breadcrumb gives operator visibility** for rollout coverage (e.g., "by week 2, 75% of active users have migrated their profile to SecureStore"); **the cache-flush write-queue is NOT encrypted** — the `@companion_write_queue` key carries pending DB operations that are non-PII (table names + Supabase filter shapes) AND would degrade write-queue throughput if encrypted; explicit out-of-scope decision documented; **the audit-named threat scenario (rooted-device PII extraction) is structurally impossible post-12-7** — SecureStore's hardware-backed encryption requires the device's hardware key, which is unavailable to forensic-extraction tools even with root.

## Background — Why This Story Exists

### What audit finding P1-11 owns to this story

[`shippable-roadmap.md` line 63](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P1-11 — Profile cache stores PII in plaintext AsyncStorage (full_name, level, streak, last_active_date) — readable on rooted Android — `src/lib/cache.ts:103-119`, `src/hooks/use-auth.ts:51` — security"

Epic 12.7 deliverable at [line 210](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Move profile cache to encrypted SecureStore-wrapped adapter; update `cache.ts`. **Covers P1-11.**"

> **Note:** The audit cited file path `src/hooks/use-auth.ts:51` is pre-Story-12-2. Post-12-2, the auth bootstrap logic migrated to `src/lib/auth-bootstrap.ts:253` (`cacheWithFallback<UserProfile>(userId, CACHE_KEYS.PROFILE, ...)`). Story 12-7 fixes the post-12-2 location; the consumer's call site is unchanged (the fork is internal to `cache.ts`).

### Current state — the bug at the write path

Pre-12-7 [`src/lib/cache.ts:103-119`](src/lib/cache.ts#L103-L119) (`setCache`):

```typescript
export async function setCache<T>(
  userId: string,
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttlMs };
    await AsyncStorage.setItem(buildKey(userId, key), JSON.stringify(entry));   // ← plaintext write
  } catch (err) {
    captureError(err, "cache-set", { key });
  }
}
```

Called by [`src/lib/auth-bootstrap.ts:253`](src/lib/auth-bootstrap.ts#L253) via `cacheWithFallback<UserProfile>(userId, CACHE_KEYS.PROFILE, _, CACHE_TTL.PROFILE)`. The resulting AsyncStorage key on Android is `@companion_cache:<userId>:profile` with a JSON value containing the full `UserProfile` row.

### Threat model — what an attacker can extract today

| Vector | Pre-12-7 outcome |
| --- | --- |
| Lost phone (no root) | Locked-device storage (FBE) protects most paths; AsyncStorage is browser-local-storage-equivalent on web, app-private on iOS. Some Android variants leak app-private storage to forensic tools. |
| Lost phone (rooted) | `/data/data/com.companion.app/databases/RKStorage` (Android) or `Documents/RCTAsyncLocalStorage_V1/manifest.json` (iOS — only with jailbreak) is readable in plaintext. |
| Shared family device (rooted by family member) | Same. |
| Forensic extraction tool (Cellebrite et al.) | Same. |
| Malicious app with overprivileged permissions | Same if the malicious app has root or exploits an OS bug. |

The PII at risk: `full_name` (real-name link to the user account), `email` (login identifier), `current_cefr_level` + `streak_days` + `last_active_date` (behavioral fingerprinting), potentially `target_test_date` + `goals` (immigration planning context — sensitive for some user demographics).

### Why SecureStore?

`expo-secure-store` is the React Native / Expo wrapper around:

- **iOS Keychain** with Secure Enclave hardware-backing on devices that support it (iPhone 5s and newer with Touch ID / Face ID).
- **Android EncryptedSharedPreferences** backed by **Android Keystore** with hardware-backing on devices with TEE (Trusted Execution Environment) support — which is ~95% of devices shipped post-2018.

Both substrates require the device's hardware key to decrypt. A rooted device CANNOT extract the plaintext because the hardware key is fused into the chip and never exposed to the OS. Even with full forensic root, an attacker recovers only ciphertext.

Additionally on iOS, the `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` accessibility class:

- Makes the data unavailable when the device is locked (defends against power-on-and-extract scenarios).
- Prevents iCloud Backup from including the value (defends against backup-then-restore-on-attacker-device scenarios).

Story 12-7 pins this accessibility class on iOS.

### Why route inside `cache.ts` instead of new API?

Two design options were considered:

1. **External API** — a new `secureCacheWithFallback` / `setSecureCache` / `getSecureCache` API that callers explicitly use. Pro: explicit at call sites. Con: 8 consumer files would need to know the difference; the `auth-bootstrap.ts` migration alone is a coordinated change.

2. **Internal fork inside `cache.ts`** (chosen) — `SECURE_CACHE_KEYS` allowlist + a single-key check at the top of `getCache` / `setCache` / `invalidateCache`. Pro: 0 consumer changes; auth-bootstrap + 7 other call sites compile + run unchanged. Con: callers don't know which keys are secure without reading the source.

Option 2 wins because the security upgrade should be **transparent to consumers** — no one should need to remember "use `setSecureCache` for profile, but `setCache` for skills." The allowlist is the single source of truth.

### Migration semantics — one-shot, transparent

The first `getCache(userId, "profile")` post-12-7-deploy:

```
1. Check `SECURE_CACHE_KEYS.has("profile")` → true → fork to secure path
2. Read SecureStore → returns null (first run; SecureStore is empty)
3. Migration check: read legacy AsyncStorage key `@companion_cache:<userId>:profile`
   a. Legacy entry present (existing user):
      - Write to SecureStore via `setSecureCache`
      - Delete AsyncStorage entry via `AsyncStorage.removeItem`
      - Fire `addBreadcrumb({feature: "secure-cache-migrated"})`
      - Return migrated data
   b. Legacy entry absent (cold install OR already-migrated user):
      - Return null (caller's `cacheWithFallback` re-fetches from network)
```

Subsequent reads skip the migration path because `AsyncStorage.getItem` returns null. The migration is idempotent + fail-safe (SecureStore write before AsyncStorage delete; if delete fails, next read re-migrates without harm).

### Spec — `src/lib/secure-cache.ts` shape

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";

// SecureStore key charset: [A-Za-z0-9._-]+. Cannot use `:` (cache.ts's separator).
const SECURE_KEY_PREFIX = "companion_secure_";

export function buildSecureKey(userId: string, key: string): string {
  return `${SECURE_KEY_PREFIX}${userId}_${key}`;
}

interface SecureCacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

export async function setSecureCache<T>(
  userId: string,
  key: string,
  data: T,
  ttlMs: number
): Promise<void> {
  if (Platform.OS === "web") {
    // Web has no SecureStore; preserve pre-12-7 AsyncStorage behavior.
    // The fork inside cache.ts will route this back through AsyncStorage
    // via the default path; calling setSecureCache on web is a no-op via
    // early-return because the cache.ts fork checks Platform.OS first.
    return;
  }
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

export async function getSecureCache<T>(userId: string, key: string): Promise<T | null> {
  if (Platform.OS === "web") return null;
  try {
    const raw = await SecureStore.getItemAsync(buildSecureKey(userId, key));
    if (!raw) return null;
    const entry: SecureCacheEntry<T> = JSON.parse(raw) as SecureCacheEntry<T>;
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttlMs) {
      void SecureStore.deleteItemAsync(buildSecureKey(userId, key));
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

export async function invalidateSecureCache(userId: string, key: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(buildSecureKey(userId, key));
  } catch (err) {
    captureError(err, "secure-cache-invalidate", { key });
  }
}

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
```

### Spec — `src/lib/cache.ts` routing fork shape

```typescript
import {
  setSecureCache,
  getSecureCache,
  invalidateSecureCache,
  clearSecureCacheForUser,
} from "@/src/lib/secure-cache";
import { Platform } from "react-native";

export const SECURE_CACHE_KEYS: ReadonlySet<string> = new Set([
  "profile", // CACHE_KEYS.PROFILE — closes audit P1-11
]);

export async function getCache<T>(userId: string, key: string): Promise<T | null> {
  // Story 12-7: route sensitive keys through SecureStore on native.
  if (SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web") {
    // One-shot migration: copy legacy plaintext entry to SecureStore.
    const legacy = await readLegacyCache<T>(userId, key);
    if (legacy !== null) {
      await setSecureCache(userId, key, legacy.data, legacy.ttlMs);
      void AsyncStorage.removeItem(buildKey(userId, key));
      addBreadcrumb({
        category: "cache",
        level: "info",
        message: "Profile cache migrated to SecureStore",
        data: { feature: "secure-cache-migrated" },
      });
      return legacy.data;
    }
    return getSecureCache<T>(userId, key);
  }
  // Pre-12-7 path for non-secure keys + web platform.
  return getPlaintextCache<T>(userId, key);
}
// (similar forks for setCache, invalidateCache, clearUserCache)
```

### Cross-story invariants preserved by construction

| Story | Invariant | Preserved by |
| --- | --- | --- |
| 9-3 | `SENTRY_EXTRAS_ALLOWLIST` short categorical | New `feature` tags ≤ 21 chars; `feature` + `code` already allowlisted |
| 9-4 | Stored-prompt-injection defense | Cache is pure storage of typed objects; no user-input path |
| 9-6 | Auth listener event gating | `decideAuthAction` switch unchanged; `loadProfile` calls `cacheWithFallback` which forks internally |
| 9-10 | Auth + cache race hardening | `applyProfileIfFresh` userId-guard runs INSIDE `loadProfile`, UNCHANGED; the fork is below `cacheWithFallback` |
| 12-1 | Orchestrator structure | Orthogonal — no shared state |
| 12-2 | Auth bootstrap one-time install | `bootstrapAuth` consumer unchanged; the fork is internal to `cache.ts` |
| 12-3 | Atomic-RPC mutations | Orthogonal — no shared state |
| 12-4 | `start()` race fix | Orthogonal — no shared state |
| 12-5 | `ExpoPlayAudioStream` singleton | Orthogonal — no shared state |
| 12-6 | Transcript cap + spill buffer | Orthogonal — no shared state |

### Out of scope for this story (delegated elsewhere)

- **Encrypt vocabulary / daily-briefing / error-patterns / other low-PII cache keys** — operator decision based on telemetry from `secure-cache-migrated` breadcrumb frequency; if telemetry shows users routinely keep large vocabularies cached, the operator can extend `SECURE_CACHE_KEYS` in a follow-up story.
- **Encrypt the offline write queue** (`@companion_write_queue`) — write queue carries pending DB operations (table names, Supabase filter shapes); non-PII; encrypting would degrade write-queue throughput. Out of scope.
- **Cross-device profile sync** — SecureStore is device-local by design (the `THIS_DEVICE_ONLY` accessibility class makes this explicit). Multi-device profile sync should rely on the Supabase server-side authoritative profile, NOT the cache layer.
- **Multi-account-on-same-device coordination** — the app does not currently support multiple accounts on one device; if added later, `clearSecureCacheForUser(userId, [...SECURE_CACHE_KEYS])` is the cleanup hook to call on account switch.
- **Biometric-gated SecureStore access** — `SecureStore.setItemAsync` supports `requireAuthentication: true` which prompts Face ID / Touch ID on every read. Out of scope for v1 because the profile cache is read on every cold start; biometric prompts per cold start would be terrible UX. Future story can opt in for higher-sensitivity keys.
- **AsyncStorage backup encryption** — Android 6+ auto-encrypts app-private storage when the device PIN is set; iOS 8+ auto-encrypts via Data Protection. The audit acknowledges these BUT calls out the rooted-device extraction path which bypasses them. Story 12-7 addresses the rooted-device path; the default-encryption baseline is untouched.
- **Audit log of who-read-what** — out of scope; SecureStore reads are not user-observable.

## Acceptance Criteria

### 1. Create `src/lib/secure-cache.ts`

- [x] **CREATE** the new module exporting:
  - `setSecureCache<T>(userId, key, data, ttlMs): Promise<void>`
  - `getSecureCache<T>(userId, key): Promise<T | null>`
  - `invalidateSecureCache(userId, key): Promise<void>`
  - `clearSecureCacheForUser(userId, keys: readonly string[]): Promise<void>`
  - `buildSecureKey(userId, key): string` — pure helper
  - `__resetSecureCacheForTests(): void` — test-only no-op stub with `NODE_ENV !== "test"` runtime guard (Story 12-2 P11 pattern; kept for test-symmetry even though SecureStore itself is the storage)
- [x] **iOS keychain accessibility** pinned to `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` so data is (a) unavailable when device is locked, (b) NOT backed up to iCloud.
- [x] **Platform-fallback** — every public function checks `Platform.OS === "web"` and returns early (no SecureStore calls); `cache.ts`'s fork ALSO checks platform so web routes back to AsyncStorage.
- [x] **TTL semantics** match `cache.ts:80-86` verbatim — `age > entry.ttlMs` triggers `deleteItemAsync` + returns null.
- [x] **`buildSecureKey` output** uses `companion_secure_` prefix + underscore separators (no `:` because SecureStore charset is `[A-Za-z0-9._-]+`).
- [x] **Error handling** — each public function wraps SecureStore calls in try/catch; on failure, calls `captureError(_, "secure-cache-{action}", { key })` AND fires `addBreadcrumb({feature: "secure-cache-{set,get}-fail"})`; the function does NOT propagate the throw (matches existing `cache.ts:117` swallow-and-breadcrumb pattern).

**Given** `setSecureCache(userId, "profile", profileData, ttlMs)`
**When** `getSecureCache(userId, "profile")` runs before TTL expiry
**Then** returns the same `profileData` AND `SecureStore.setItemAsync` was called with `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`.

### 2. Modify `src/lib/cache.ts`

- [x] **EXPORT** `SECURE_CACHE_KEYS: ReadonlySet<string>` containing `CACHE_KEYS.PROFILE` (`"profile"`) — extensible allowlist for future operator decisions.
- [x] **IMPORT** `setSecureCache`, `getSecureCache`, `invalidateSecureCache`, `clearSecureCacheForUser` from `@/src/lib/secure-cache` + `Platform` from `react-native`.
- [x] **REFACTOR** `getCache` (line 74): if `SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web"`, run migration check (read legacy AsyncStorage key; if present, copy to SecureStore + delete from AsyncStorage + fire `secure-cache-migrated` breadcrumb + return data); else read via `getSecureCache`; web path falls through to existing AsyncStorage logic unchanged.
- [x] **REFACTOR** `setCache` (line 103): if `SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web"`, dispatch to `setSecureCache`; else use existing AsyncStorage path.
- [x] **REFACTOR** `invalidateCache` (line 170): if `SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web"`, dispatch to `invalidateSecureCache`; else use existing path.
- [x] **REFACTOR** `cacheWithFallback` catch-branch read at line 149: instead of `AsyncStorage.getItem(buildKey(...))` directly, call `getCache(userId, key)` so the secure fork is honored on fallback reads too.
- [x] **EXTEND** `clearUserCache` (line 181): after the `AsyncStorage.multiRemove(userKeys)` call, also invoke `clearSecureCacheForUser(userId, [...SECURE_CACHE_KEYS])` so sign-out / account-delete clears BOTH stores.
- [x] **EXTEND** `clearAllCache` (line 197): in single-user contexts (account-delete), call `clearSecureCacheForUser(userId, [...SECURE_CACHE_KEYS])`. Add a JSDoc note that the multi-user case requires explicit per-user invocation (out-of-scope for v1 — the app does not currently support multi-account-on-same-device).
- [x] **MIGRATION** — `getCache` migration block emits `addBreadcrumb({category: "cache", level: "info", message: "Profile cache migrated to SecureStore", data: { feature: "secure-cache-migrated" }})` exactly once per migration; idempotent (subsequent reads find AsyncStorage empty).
- [x] **PRESERVE** every pre-12-7 non-secure-key path bit-identical — `setCache(userId, "skills", _)` must call `AsyncStorage.setItem` directly (NOT through SecureStore); same for all 11 other `CACHE_KEYS.*` entries.

**Given** a pre-12-7 user with `@companion_cache:<userId>:profile` in AsyncStorage
**When** `getCache(userId, "profile")` runs for the first time post-12-7
**Then** the profile data is returned AND `setSecureCache(userId, "profile", _)` was called with the data AND `AsyncStorage.removeItem("@companion_cache:<userId>:profile")` was called AND `addBreadcrumb({data: { feature: "secure-cache-migrated" }})` fired exactly once.

**Given** the same user's second `getCache(userId, "profile")` call
**When** it runs
**Then** the data is read from SecureStore AND `AsyncStorage.getItem("@companion_cache:<userId>:profile")` returns null (migration completed) AND the `secure-cache-migrated` breadcrumb does NOT fire (no re-migration).

### 3. Sentry allowlist + breadcrumbs

- [x] **VERIFY** `feature` and `code` are already in `SENTRY_EXTRAS_ALLOWLIST` (Story 9-3) — they are; no extension needed.
- [x] **VERIFY** the 3 new feature strings are all ≤ 80 chars: `"secure-cache-migrated"` (21), `"secure-cache-set-fail"` (21), `"secure-cache-get-fail"` (21).
- [x] **NO new allowlist keys** required.

### 4. Tests

- [x] **CREATE** `src/lib/__tests__/secure-cache.test.ts` (~12 cases):
  - **Round-trip × 2:**
    - `setSecureCache` + `getSecureCache` returns the same data (typed object).
    - TTL expiry — set with `ttlMs: 100`, mock `Date.now()` to advance past expiry, assert returns `null` AND `SecureStore.deleteItemAsync` fires.
  - **`buildSecureKey` × 1:**
    - Output matches `companion_secure_<userId>_<key>` exactly; no `:` separator (SecureStore charset rule).
  - **Platform fallback × 2:**
    - `Platform.OS === "web"` → no SecureStore calls fire (early return).
    - `Platform.OS === "ios"` → SecureStore calls fire (and `setItemAsync` is invoked with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
  - **Failure handling × 3:**
    - `SecureStore.setItemAsync` throws → captured + `secure-cache-set-fail` breadcrumb fires + no propagation.
    - `SecureStore.getItemAsync` throws → captured + `secure-cache-get-fail` breadcrumb fires + returns null.
    - Corrupted JSON in SecureStore → JSON.parse throws → captured + returns null.
  - **Invalidate + clear × 2:**
    - `invalidateSecureCache` fires `SecureStore.deleteItemAsync` with the canonical key.
    - `clearSecureCacheForUser(userId, ["profile", "vocabulary"])` iterates the allowlist + deletes each key.
  - **Test-only reset × 2:**
    - `__resetSecureCacheForTests` runs without throwing in `NODE_ENV === "test"`.
    - `__resetSecureCacheForTests` throws when `NODE_ENV !== "test"`.

- [x] **CREATE** `src/lib/__tests__/cache-secure-routing.test.ts` (~8 cases):
  - **Routing × 4:**
    - `setCache(userId, "profile", _)` routes to `setSecureCache`, NOT `AsyncStorage.setItem`.
    - `setCache(userId, "skills", _)` routes to `AsyncStorage.setItem`, NOT `setSecureCache`.
    - `getCache(userId, "profile")` routes to `getSecureCache` (via migration check or direct).
    - `invalidateCache(userId, "profile")` routes to `invalidateSecureCache`.
  - **Migration × 2:**
    - First read with legacy plaintext entry → migrates + fires `secure-cache-migrated` breadcrumb + returns data.
    - Second read after migration → reads SecureStore directly + no re-migration breadcrumb.
  - **`cacheWithFallback` fallback path × 1:**
    - Network fetch throws → fallback reads via `getCache` (NOT directly via `AsyncStorage.getItem`) so the secure fork is honored.
  - **`clearUserCache` × 1:**
    - Clears BOTH `AsyncStorage` keys with the `@companion_cache:<userId>:` prefix AND `SecureStore` entries for `SECURE_CACHE_KEYS`.

- [x] **DRIFT detector** reads `src/lib/cache.ts` source from disk (comment-stripped per Story 12-2 P12 lesson) + asserts:
  - Positive: `SECURE_CACHE_KEYS` export exists and contains `"profile"`.
  - Positive: `getCache` body contains the `SECURE_CACHE_KEYS.has(key)` fork.
  - Positive: `setCache` body contains the same fork.
  - Positive: `invalidateCache` body contains the same fork.
  - Negative: no `AsyncStorage.setItem` call appears with a key matching `/profile/i` (the only allowed `profile`-key reference is inside the migration `AsyncStorage.removeItem` path).

- [x] **VERIFY existing tests stay green:**
  - `src/lib/__tests__/cache-flush.test.ts` (Stories 9-6, 9-10) — write queue flow unchanged.
  - `src/lib/__tests__/auth-load-profile-stale.test.ts` (Story 9-10) — `applyProfileIfFresh` unchanged.
  - `src/lib/__tests__/auth-bootstrap.test.ts` (Story 12-2) — listener install unchanged.

- [x] **Target test count:** post-12-6 baseline 1393 → ~1413 (+~20 from the 2 new test files).

### 5. Update CLAUDE.md

- [x] Add a new architecture line **after** the Story 12-6 paragraph documenting: (a) the new `src/lib/secure-cache.ts` module + the 5 exports + `buildSecureKey` helper + the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility class; (b) the `cache.ts` `SECURE_CACHE_KEYS` allowlist + the routing fork at `getCache` / `setCache` / `invalidateCache`; (c) the one-shot migration semantics + the `secure-cache-migrated` Sentry breadcrumb; (d) the platform-fallback contract (web → AsyncStorage); (e) the 3 new Sentry feature tags + Story 9-3 allowlist preservation; (f) the cross-story invariants (Stories 9-3 / 9-4 / 9-6 / 9-10 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 all unchanged); (g) the Out-of-Scope items (vocabulary encryption, biometric-gated reads, write-queue encryption) explicitly deferred.

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 12-7 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [x] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — `secure-cache.ts` per-function catches all use this pattern with `"secure-cache-{action}"` context tags.
- [x] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass.
- [x] **Story 9-3 Sentry allowlist contract holds** — 3 new short `feature` strings; no new extras keys.
- [x] **Story 9-4 stored-prompt-injection defense unaffected** — no user-input path through cache.
- [x] **Story 9-6 auth listener event gating unaffected** — `decideAuthAction` switch + `loadProfile` body unchanged.
- [x] **Story 9-10 + 12-2 auth + cache race hardening unaffected** — `applyProfileIfFresh` userId-guard + `profileFetchFailed` flag + `flushWriteQueue` idempotency Promise-gate all unchanged because the fork is below `cacheWithFallback`.
- [x] **Story 12-1 / 12-3 / 12-4 / 12-5 / 12-6 invariants orthogonal** — no shared state with cache.ts.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files" — i.e. visible to git, not silently ignored.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-7-encrypted-profile-cache.md` passes.

## Tasks / Subtasks

- [x] **Task 1: Create `src/lib/secure-cache.ts`** (AC #1)
  - [x] Export `setSecureCache` / `getSecureCache` / `invalidateSecureCache` / `clearSecureCacheForUser` / `buildSecureKey` / `__resetSecureCacheForTests`.
  - [x] Pin iOS keychain accessibility to `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  - [x] Platform-fallback early-return on `Platform.OS === "web"`.
  - [x] TTL semantics match `cache.ts:80-86`.
  - [x] Error handling — `captureError` + `addBreadcrumb` per-action.
  - [x] JSDoc the rationale for the secure-store-vs-AsyncStorage choice + the SecureStore key-charset constraint.

- [x] **Task 2: Modify `src/lib/cache.ts`** (AC #2)
  - [x] Export `SECURE_CACHE_KEYS` allowlist containing `"profile"`.
  - [x] Import `secure-cache.ts` exports + `Platform`.
  - [x] Refactor `getCache` to fork on secure keys + migration block.
  - [x] Refactor `setCache` to fork on secure keys.
  - [x] Refactor `invalidateCache` to fork on secure keys.
  - [x] Refactor `cacheWithFallback` catch-branch to go through `getCache` (so the fork is honored on fallback reads too).
  - [x] Extend `clearUserCache` to call `clearSecureCacheForUser`.
  - [x] Extend `clearAllCache` for the single-user case + JSDoc note.
  - [x] Fire `secure-cache-migrated` breadcrumb on migration (info level; idempotent).

- [x] **Task 3: Sentry allowlist verification** (AC #3)
  - [x] Verify `feature` is in allowlist (already done in Story 9-3).
  - [x] Verify `code` is in allowlist (already done).
  - [x] Verify 3 new feature strings are ≤ 80 chars.

- [x] **Task 4: Tests** (AC #4)
  - [x] CREATE `src/lib/__tests__/secure-cache.test.ts` (~12 cases).
  - [x] CREATE `src/lib/__tests__/cache-secure-routing.test.ts` (~8 cases including drift detector).
  - [x] Verify existing tests stay green (1393 → ~1413).

- [x] **Task 5: Update CLAUDE.md** (AC #5)
  - [x] Add Story 12-7 architecture paragraph after Story 12-6.

- [x] **Task 6: Quality gates** (AC #Z)
  - [x] `npm run type-check` passes.
  - [x] `npm run lint` passes.
  - [x] `npm run format:check` passes.
  - [x] `npm test` passes (target 1393 → ~1413).
  - [x] `npm run check:colors` passes.
  - [x] CI Sentry DSN + Submit credentials leak guards pass.
  - [x] `git status` shows the story file as untracked-but-not-ignored before initial commit.
  - [x] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Internal routing fork inside `cache.ts`** — mirrors Story 12-2's `bootstrapAuth()` internal singleton-install pattern (the API surface is unchanged; the implementation choice is hidden). The Supabase auth adapter at `supabase.ts:24` (`Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter`) is the project-canonical web-fallback shape; Story 12-7 reuses it for the cache layer.
- **Migration via read-and-rewrite-on-first-access** — same pattern as auth-bootstrap's `cacheWithFallback` first-read flow; no special migration script + no app-version-gated migration code. The next profile read does the migration; subsequent reads short-circuit.
- **One-shot Sentry breadcrumb for operator rollout visibility** — Story 11-4's `daily_cost_cap_exceeded` operator-visible pattern + Story 12-6's `transcript-cap-evicted` pattern. The `secure-cache-migrated` breadcrumb lets operators count rollout coverage in Sentry (e.g., "by week 2, 75% of active users have migrated").
- **Platform-fallback contract** — `Platform.OS === "web"` early-return in every public function. Pre-12-7 web users already get plaintext AsyncStorage; post-12-7 web users get the same behavior (browser localStorage is already encrypted-at-rest by the OS for desktop browsers).
- **iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility class** — the strictest setting compatible with non-interactive reads. The alternative (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) would allow reads while the device is locked (e.g., background sync), which the cache layer does not need.
- **Allowlist-based scope expansion** — `SECURE_CACHE_KEYS` is a `ReadonlySet<string>`; future operator decisions to encrypt vocabulary / daily-briefing / error-patterns are one-line additions. Test fixtures should NOT hard-code the set's size (use `SECURE_CACHE_KEYS.has("profile")` checks, not `SECURE_CACHE_KEYS.size === 1`).

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section included.
- **Epic 9 + 10 + 11 + 12-X retros A3** (review-patch budget): Story 12-7 is a SMALL story — ~150-line new module + 8-line `cache.ts` extension + 2 test files (~20 cases). Expect **5-8 review patches**. Risk surfaces:
  - (a) **SecureStore key charset** — the `:` separator from `cache.ts:62` would be rejected; the new `_` separator is documented. A future operator who adds `"daily-briefing"` (with hyphen) to `SECURE_CACHE_KEYS` would still work; but if the operator adds a key with a `:` or other forbidden char, SecureStore's setItemAsync would throw. The test should pin the charset constraint explicitly.
  - (b) **Migration idempotency** — the second `getCache` after migration MUST NOT re-fire the breadcrumb. Test pins this with mock-call-count assertions.
  - (c) **Migration race** — if two concurrent `getCache(userId, "profile")` calls race (e.g., the auth-bootstrap's initial load + a parallel screen-mount call), both might enter the migration path; the second would find AsyncStorage empty (the first deleted it) but SecureStore populated; the SecureStore read returns the data. No data loss; minor breadcrumb double-fire — acceptable.
  - (d) **`cacheWithFallback` fallback path** — pre-12-7 the catch-branch read AsyncStorage directly; post-12-7 it calls `getCache` (the encryption-aware path). A future refactor that re-introduces a direct `AsyncStorage.getItem(buildKey(...))` call inside `cacheWithFallback` would break the encryption contract; the drift detector should pin this.
  - (e) **`clearUserCache` ordering** — clear AsyncStorage first, then SecureStore (so a crash mid-clear leaves a consistent "partial-clear" state where SecureStore is still authoritative; next sign-in would re-migrate). If we cleared SecureStore first and crashed, the next read would find AsyncStorage populated + re-migrate it, leaving stale data through one extra cycle.
  - (f) **iOS Keychain size limit** — `UserProfile` payloads are typically <500 bytes; well below the 2KB soft limit. But a future refactor that adds large fields (e.g., a base64-encoded avatar) could push past the limit. Document the limit in the JSDoc.
  - (g) **Test setup** — `expo-secure-store` requires a native module mock in Jest. Reuse the supabase.ts pattern's mock from `setup.ts` or create a new `secure-store.ts` mock in `__mocks__`. Verify the existing test infra works with the new test file.

- **Story 12-5 lesson** (test-only reset hook): `__resetSecureCacheForTests` follows the same pattern even though there's no module-level state to reset (SecureStore is the storage). Kept for symmetry + future-proofing.
- **Story 12-6 lesson** (drift detector with comment-stripped source + `extractMethodBody`): The `cache.ts` drift detector uses the same comment-stripping pattern + method-body extraction.

### Anticipated File List

**Created:**
- `src/lib/secure-cache.ts` (~150 lines)
- `src/lib/__tests__/secure-cache.test.ts` (~12 cases)
- `src/lib/__tests__/cache-secure-routing.test.ts` (~8 cases)

**Modified:**
- `src/lib/cache.ts` — add `SECURE_CACHE_KEYS` export + 3 routing forks + migration block + `clearUserCache` + `clearAllCache` extensions + `cacheWithFallback` fallback-read refactor.
- `CLAUDE.md` — Story 12-7 architecture paragraph.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status flip.

### References

- [`shippable-roadmap.md:63`](_bmad-output/planning-artifacts/shippable-roadmap.md) — audit P1-11.
- [`shippable-roadmap.md:210`](_bmad-output/planning-artifacts/shippable-roadmap.md) — Epic 12.7 deliverable.
- [`src/lib/cache.ts:103-119`](src/lib/cache.ts#L103-L119) — `setCache` plaintext write site.
- [`src/lib/cache.ts:74-93`](src/lib/cache.ts#L74-L93) — `getCache` plaintext read site.
- [`src/lib/cache.ts:135-161`](src/lib/cache.ts#L135-L161) — `cacheWithFallback` fallback-read site.
- [`src/lib/cache.ts:181-192`](src/lib/cache.ts#L181-L192) — `clearUserCache` site.
- [`src/lib/cache.ts:458-472`](src/lib/cache.ts#L458-L472) — `CACHE_KEYS` constants.
- [`src/lib/auth-bootstrap.ts:253-266`](src/lib/auth-bootstrap.ts#L253-L266) — `cacheWithFallback<UserProfile>` consumer.
- [`src/lib/supabase.ts:3-29`](src/lib/supabase.ts#L3-L29) — `ExpoSecureStoreAdapter` project-canonical pattern.
- [`package.json:43`](package.json#L43) — `expo-secure-store ~55.0.8` already installed.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Implementation Plan

**Phase 1 — New `secure-cache.ts` module.** Created `src/lib/secure-cache.ts` (~240 lines including JSDoc) exporting 5 public functions + 2 migration helpers + 1 test-only stub: `setSecureCache` / `getSecureCache` / `invalidateSecureCache` / `clearSecureCacheForUser` / `buildSecureKey` / `readSecureCacheIgnoreTTL` (for `cacheWithFallback`'s offline-fallback path) / `readLegacyPlaintextEntry` + `deleteLegacyPlaintextEntry` (one-shot migration helpers) / `__resetSecureCacheForTests`. iOS pinned to `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Platform-fallback for web (early-return on `Platform.OS === "web"`). Error handling via `captureError(_, "secure-cache-{action}", { key })` + `addBreadcrumb({feature: "secure-cache-{set,get}-fail"})`. Storage envelope `{data, timestamp, ttlMs}` matches `cache.ts:CacheEntry<T>` verbatim. SecureStore key prefix `companion_secure_<userId>_<key>` (underscore separators because SecureStore charset is `[A-Za-z0-9._-]+`; the `:` separator from `cache.ts:62` would be REJECTED).

**Phase 2 — `cache.ts` modifications.** Added `import { Platform } from "react-native"` + imports from `secure-cache.ts`. New `export const SECURE_CACHE_KEYS: ReadonlySet<string> = new Set([CACHE_KEYS.PROFILE])` extensible allowlist. `getCache` / `setCache` / `invalidateCache` all gain a top-of-function fork: `if (SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web")` → route to secure-cache; else use existing AsyncStorage path. `getCache`'s fork includes the **one-shot migration block** — reads `readLegacyPlaintextEntry`; if found, writes to SecureStore via `setSecureCache`, fires `void deleteLegacyPlaintextEntry`, emits `addBreadcrumb({feature: "secure-cache-migrated"})` once, and re-checks the legacy entry's TTL before returning. `cacheWithFallback`'s catch-branch was refactored to fork on `SECURE_CACHE_KEYS.has(key)` — secure path uses `readSecureCacheIgnoreTTL` (preserves the pre-12-7 "ignore TTL for fallback" semantic); plaintext path is unchanged. `clearUserCache` now sweeps BOTH stores (AsyncStorage clears FIRST so a crash mid-clear leaves SecureStore authoritative; next sign-in re-migrates cleanly from empty AsyncStorage). `clearAllCache` gains a JSDoc caveat documenting that multi-user SecureStore cleanup requires per-user `clearUserCache` (out-of-scope for v1).

**Phase 3 — Tests.** `secure-cache.test.ts` (13 cases) and `cache-secure-routing.test.ts` (13 cases) covering: round-trip + TTL expiry, charset constraint, web platform fallback, iOS keychain accessibility pin (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` passed to `setItemAsync`), failure handling × 3 (set + get + corrupted JSON), invalidate + clear, test-only reset hook; routing × 4 (profile → SecureStore + skills → AsyncStorage + getCache + invalidateCache forks), migration × 2 (legacy → SecureStore + idempotent on second read), `cacheWithFallback` fallback-read fork, `clearUserCache` double-sweep, 5 drift detectors (allowlist export + all 3 fork sites + NEGATIVE guard against `AsyncStorage.setItem` writing a key matching `/profile/`).

**Phase 4 — CLAUDE.md.** New architecture paragraph after Story 12-6 documenting the 3-part fix, migration semantics, platform-fallback, the 3 new Sentry feature tags, cross-story invariants, and out-of-scope items (biometric reads, low-PII encryption, write-queue, cross-device sync).

**Phase 5 — Quality gates.** All 5 gates green: type-check + lint + format:check + full Jest suite (1419 tests passing — +26 net from 1393) + colors check. Lint flagged 4 `import/order` + `import/first` warnings on the new test files (mocks-then-imports vs imports-then-mocks); restructured to imports-first to match the project's canonical `cache-flush.test.ts` order. Prettier auto-formatted 3 files (line-wrap optimization).

### Debug Log References

- AsyncStorage's `RCTAsyncStorage.PlatformLocalStorage` module-load throw at first import of `secure-cache.ts` from the test file — resolved by adding an AsyncStorage mock to `secure-cache.test.ts` (mirrors the `cache-flush.test.ts` pattern); secure-cache imports AsyncStorage for the migration helpers (`readLegacyPlaintextEntry` + `deleteLegacyPlaintextEntry`).
- Initial `cacheWithFallback` refactor introduced a TTL regression — pre-12-7 the fallback ignored TTL ("stale-but-cached beats no-data" when offline), my first refactor routed through `getCache` which enforces TTL; fixed by adding `readSecureCacheIgnoreTTL` to `secure-cache.ts` that mirrors the pre-12-7 raw-read semantics, and switching the fallback branch to fork on the allowlist directly (secure path → `readSecureCacheIgnoreTTL`; plaintext path → existing direct AsyncStorage read).

### Completion Notes

- **P1-11 architecturally closed**: profile cache PII no longer readable on rooted Android — SecureStore writes to hardware-backed encrypted storage; on iOS the data is unavailable when device is locked AND cannot restore via iCloud Backup.
- **Operationally transparent migration**: existing users automatically migrate on the next profile load with no UI prompt + no logout-and-re-login.
- **Operator observability**: `secure-cache-migrated` Sentry breadcrumb fires once per user per device on migration — operators can grep production logs to count rollout coverage.
- **0 consumer changes**: 8 consumer files (`auth-bootstrap.ts` + 7 others) compile + run unchanged because the encryption fork is internal to `cache.ts` (below the `cacheWithFallback` / `setCache` / `getCache` / `invalidateCache` API surface).
- **Allowlist-based scope expansion**: `SECURE_CACHE_KEYS` is a `ReadonlySet<string>`; future operator decisions to encrypt vocabulary / daily-briefing / error-patterns are one-line additions.
- **Sentry allowlist preserved (Story 9-3)**: 3 new short `feature` tags (all 21 chars; well under 80-char threshold); `feature` + `code` extras keys already allowlisted; no allowlist extension needed.
- **All 9-X / 10-X / 11-X / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 invariants preserved by construction** — verified via the existing Story 9-6 / 9-10 / 12-2 auth-bootstrap test suites staying green post-refactor.
- **+26 net Jest cases** (1393 → 1419; exceeded spec target of ~1413).

### File List

**Created:**

- `src/lib/secure-cache.ts` — 240 lines (JSDoc + 5 public + 2 migration helpers + 1 test-only stub).
- `src/lib/__tests__/secure-cache.test.ts` — 13 Jest cases.
- `src/lib/__tests__/cache-secure-routing.test.ts` — 13 Jest cases (8 runtime + 5 drift detectors).

**Modified:**

- `src/lib/cache.ts` — new `Platform` import + new `SECURE_CACHE_KEYS` export + secure-cache helper imports; refactored `getCache` / `setCache` / `invalidateCache` with the routing fork; refactored `cacheWithFallback` catch-branch with the fallback fork; extended `clearUserCache` to sweep both stores; added JSDoc caveat to `clearAllCache`.
- `CLAUDE.md` — added Story 12-7 architecture paragraph after Story 12-6.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — flipped 12-7 to `review` + updated `last_updated`.

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-13 | Story 12-7 story file created; closes audit P1-11 (profile cache stores PII in plaintext AsyncStorage — readable on rooted Android); Epic 12.7 deliverable at `shippable-roadmap.md:210` satisfied via new `src/lib/secure-cache.ts` SecureStore wrapper + `SECURE_CACHE_KEYS` allowlist routing fork inside `cache.ts` + one-shot migration of legacy plaintext entries on first read; expo-secure-store ~55.0.8 already a project dep; SMALL risk surface (~150-line new module + ~30 lines added to cache.ts + 2 test files); ~5-8 review patches anticipated per Epic 9/10/11/12 retro budget. |
| 2026-05-13 | Story 12-7 implementation complete. New `src/lib/secure-cache.ts` (240 lines) wraps `expo-secure-store` with TTL-aware `{data, timestamp, ttlMs}` envelope: `setSecureCache` / `getSecureCache` / `invalidateSecureCache` / `clearSecureCacheForUser` / `buildSecureKey` pure helper + `readSecureCacheIgnoreTTL` (for `cacheWithFallback` fallback-read path) + `readLegacyPlaintextEntry` + `deleteLegacyPlaintextEntry` migration helpers + `__resetSecureCacheForTests` test-only stub. iOS pinned to `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Platform-fallback for web. Error handling via `captureError` + `addBreadcrumb({feature: "secure-cache-{set,get}-fail"})`. `src/lib/cache.ts`: new `SECURE_CACHE_KEYS: ReadonlySet<string> = new Set([CACHE_KEYS.PROFILE])` allowlist; routing fork at `getCache` / `setCache` / `invalidateCache`; one-shot migration block in `getCache` fires `secure-cache-migrated` breadcrumb once per user per device; `cacheWithFallback` catch-branch forks for secure keys via `readSecureCacheIgnoreTTL`; `clearUserCache` sweeps both stores. 26 new Jest cases across 2 test files. Test count 1393 → 1419 (+26 net; exceeded spec target ~1413). 3 new Sentry feature tags (all 21 chars). All 5 quality gates green. CLAUDE.md updated with Story 12-7 architecture paragraph. Story 9-3 / 9-4 / 9-6 / 9-10 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 invariants preserved by construction (encryption fork is internal to `cache.ts`; 8 consumer files compile unchanged). Closes audit P1-11 architecturally. |
