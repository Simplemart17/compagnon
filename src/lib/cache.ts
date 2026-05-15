/**
 * Offline Cache Module
 *
 * Provides TTL-based caching backed by AsyncStorage, with:
 * - Per-user namespaced cache keys
 * - Configurable TTL per key (default 1 hour)
 * - Network-first with cache fallback pattern (`cacheWithFallback`)
 * - Cache invalidation (single key or all)
 * - Write-through queue for retrying failed Supabase writes when offline
 *
 * All cached values are stored as JSON with metadata (timestamp, TTL).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { isOnline } from "@/src/lib/network";
import {
  clearSecureCacheForUser,
  deleteLegacyPlaintextEntry,
  getSecureCache,
  invalidateSecureCache,
  readLegacyPlaintextEntry,
  readSecureCacheIgnoreTTL,
  setSecureCache,
} from "@/src/lib/secure-cache";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "@companion_cache:";
const WRITE_QUEUE_KEY = "@companion_write_queue";
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata wrapper stored alongside every cached value. */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

/** A queued write operation to retry when network returns. */
export interface QueuedWrite {
  id: string;
  table: string;
  operation: "insert" | "update" | "upsert";
  payload: Record<string, unknown>;
  /** Supabase filter for update/upsert, e.g. { column: "id", value: "abc" } */
  filter?: { column: string; value: string };
  /** Supabase onConflict for upsert operations */
  onConflict?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

/**
 * Build a fully-qualified cache key namespaced to a user.
 *
 * @param userId - The authenticated user's ID
 * @param key    - A logical cache key, e.g. "vocabulary" or "skills"
 */
function buildKey(userId: string, key: string): string {
  return `${CACHE_PREFIX}${userId}:${key}`;
}

// ---------------------------------------------------------------------------
// Core read / write
// ---------------------------------------------------------------------------

/**
 * Story 12-7 review-round-1 P2: module-level in-flight Promise gate for
 * the one-shot migration. Mirrors Story 9-6's `flushWriteQueue let
 * inFlight` pattern. Without this gate, two concurrent `getCache(userId,
 * "profile")` calls (e.g., auth-bootstrap + a parallel screen mount)
 * would both observe the legacy entry, both write to SecureStore, both
 * fire the `secure-cache-migrated` breadcrumb — violating the once-per-
 * device idempotency contract.
 *
 * Keyed by `${userId}:${key}` so two distinct keys can migrate
 * concurrently without serializing each other. Entries are cleared on
 * resolution so a future cold-start can re-enter if needed (e.g., if
 * the delete failed and the legacy entry survived).
 */
const migrationInFlight = new Map<string, Promise<{ data: unknown; ttlMs: number } | null>>();

/**
 * Migrate a single legacy plaintext entry to SecureStore. Returns the
 * migrated data + TTL (so the caller can apply its own TTL check) OR
 * null if no legacy entry exists OR was shape-invalid.
 *
 * **Story 12-7 review-round-1 P1**: TTL check happens BEFORE the
 * SecureStore write. If the legacy entry is expired, we delete it and
 * return null without writing — pre-patch the code would write expired
 * data with a fresh `Date.now()` timestamp, effectively reviving stale
 * data with a reset TTL clock.
 *
 * **Story 12-7 review-round-1 P6**: `deleteLegacyPlaintextEntry` is
 * AWAITED (not fire-and-forget) so the breadcrumb fires only after the
 * delete succeeds. A failed delete would otherwise trigger re-migration
 * on the next cold start, re-firing the `secure-cache-migrated`
 * breadcrumb and inflating the rollout-coverage metric.
 */
async function migrateLegacyToSecure<T>(
  userId: string,
  key: string
): Promise<{ data: T; ttlMs: number } | null> {
  const legacy = await readLegacyPlaintextEntry<T>(userId, key);
  if (legacy === null) return null;

  // P1: re-check TTL BEFORE writing. If expired, only clean up + return null.
  const age = Date.now() - legacy.timestamp;
  if (age > legacy.ttlMs) {
    await deleteLegacyPlaintextEntry(userId, key);
    return null;
  }

  await setSecureCache(userId, key, legacy.data, legacy.ttlMs);
  // P6: await the delete BEFORE the breadcrumb so a failed delete
  // doesn't claim migration succeeded.
  await deleteLegacyPlaintextEntry(userId, key);
  addBreadcrumb({
    category: "cache",
    level: "info",
    message: "Profile cache migrated to SecureStore",
    data: { feature: "secure-cache-migrated" },
  });
  return { data: legacy.data, ttlMs: legacy.ttlMs };
}

/**
 * Retrieve a cached value if it exists and has not expired.
 *
 * @returns The cached data, or `null` if missing / expired.
 */
export async function getCache<T>(userId: string, key: string): Promise<T | null> {
  // Story 12-7: secure keys (CACHE_KEYS.PROFILE) route through SecureStore on
  // native platforms. Web users fall through to AsyncStorage (SecureStore
  // is not available; browser localStorage is encrypted-at-rest by the OS).
  if (SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web") {
    // Story 12-7 one-shot migration with P2 concurrent-read serialization.
    // Idempotent: AsyncStorage.getItem returns null on subsequent reads, so
    // the migration path is never re-entered. Fail-safe: SecureStore write
    // before AsyncStorage delete — a crash mid-migration leaves the legacy
    // entry in place and the next read re-migrates without data loss.
    //
    // P2 review-round-1: serialize concurrent migration attempts via the
    // module-level `migrationInFlight` Map so two parallel `getCache` calls
    // don't both observe the legacy entry + double-fire the breadcrumb.
    const migrationKey = `${userId}:${key}`;
    let migratePromise = migrationInFlight.get(migrationKey) as
      | Promise<{ data: T; ttlMs: number } | null>
      | undefined;
    if (!migratePromise) {
      migratePromise = migrateLegacyToSecure<T>(userId, key);
      migrationInFlight.set(
        migrationKey,
        migratePromise as unknown as Promise<{ data: unknown; ttlMs: number } | null>
      );
      // Clear the in-flight gate on resolution so a future cold start can
      // re-enter if needed (e.g., delete failed and legacy survived).
      void migratePromise.finally(() => migrationInFlight.delete(migrationKey));
    }
    const migrated = await migratePromise;
    if (migrated !== null) {
      return migrated.data;
    }
    return getSecureCache<T>(userId, key);
  }
  // Pre-12-7 path: plaintext AsyncStorage for non-secure keys + web.
  try {
    const raw = await AsyncStorage.getItem(buildKey(userId, key));
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw) as CacheEntry<T>;
    const age = Date.now() - entry.timestamp;

    if (age > entry.ttlMs) {
      // Expired -- clean up asynchronously but don't block the caller
      void AsyncStorage.removeItem(buildKey(userId, key));
      return null;
    }

    return entry.data;
  } catch (err) {
    captureError(err, "cache-get", { key });
    return null;
  }
}

/**
 * Store a value in the cache with an optional TTL.
 *
 * @param userId - The authenticated user's ID
 * @param key    - Logical cache key
 * @param data   - The value to cache (must be JSON-serialisable)
 * @param ttlMs  - Time-to-live in milliseconds (default 1 hour)
 */
export async function setCache<T>(
  userId: string,
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  // Story 12-7: secure keys route to SecureStore on native; web falls through
  // to the plaintext path because SecureStore is unavailable on web.
  if (SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web") {
    return setSecureCache(userId, key, data, ttlMs);
  }
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttlMs,
    };
    await AsyncStorage.setItem(buildKey(userId, key), JSON.stringify(entry));
  } catch (err) {
    captureError(err, "cache-set", { key });
  }
}

// ---------------------------------------------------------------------------
// Network-first with cache fallback
// ---------------------------------------------------------------------------

/**
 * Try to fetch data from the network. On success, cache the result.
 * On network failure, return the cached value (even if expired).
 *
 * @param userId  - The authenticated user's ID
 * @param key     - Logical cache key
 * @param fetchFn - An async function that fetches fresh data from the network
 * @param ttlMs   - TTL for the cached value (default 1 hour)
 * @returns The fetched (or cached) data, or `null` if both fail.
 */
export async function cacheWithFallback<T>(
  userId: string,
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ data: T | null; fromCache: boolean }> {
  try {
    const data = await fetchFn();
    // Network succeeded -- cache the fresh data
    await setCache(userId, key, data, ttlMs);
    return { data, fromCache: false };
  } catch (fetchErr) {
    // Network failed -- try cache (ignore TTL for fallback; stale-but-cached
    // beats no-data when offline). Story 12-7: fork on the secure-keys
    // allowlist so profile reads go through SecureStore even on fallback,
    // closing the audit-P1-11 path that would otherwise re-leak the value
    // back through the plaintext path. The `readSecureCacheIgnoreTTL` helper
    // mirrors the pre-12-7 raw-read-ignoring-TTL semantics for SecureStore.
    try {
      if (SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web") {
        const secureCached = await readSecureCacheIgnoreTTL<T>(userId, key);
        if (secureCached !== null) {
          return { data: secureCached, fromCache: true };
        }
        // P3 review-round-1: cold-launch offline with a legacy plaintext
        // entry still present — `getCache` would have migrated it on the
        // first read, but since this is the FIRST read AND the network
        // failed, the migration block never ran. Fall through to the
        // legacy plaintext entry as a second offline fallback so the
        // user sees their cached profile instead of a hard throw.
        // Migration on the next successful (online or offline) `getCache`
        // call will move this entry to SecureStore.
        const legacy = await readLegacyPlaintextEntry<T>(userId, key);
        if (legacy !== null) {
          return { data: legacy.data, fromCache: true };
        }
      } else {
        const raw = await AsyncStorage.getItem(buildKey(userId, key));
        if (raw) {
          const entry: CacheEntry<T> = JSON.parse(raw) as CacheEntry<T>;
          return { data: entry.data, fromCache: true };
        }
      }
    } catch (cacheErr) {
      captureError(cacheErr, "cache-fallback-read", { key });
    }

    // Both network and cache failed -- rethrow the original error
    throw fetchErr;
  }
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/**
 * Remove a single cached entry. Story 12-7: secure keys route to
 * SecureStore on native (web falls through to AsyncStorage because
 * SecureStore is unavailable on web).
 */
export async function invalidateCache(userId: string, key: string): Promise<void> {
  if (SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web") {
    return invalidateSecureCache(userId, key);
  }
  try {
    await AsyncStorage.removeItem(buildKey(userId, key));
  } catch (err) {
    captureError(err, "cache-invalidate", { key });
  }
}

/**
 * Remove all cache entries for a specific user. Story 12-7: clears BOTH
 * the AsyncStorage plaintext namespace AND the SecureStore allowlist
 * entries, so sign-out / account-delete leaves no encrypted residue
 * behind.
 *
 * **Story 12-7 review-round-1 P7**: SecureStore clears FIRST. The
 * canonical caller is sign-out / account-delete — we want the encrypted
 * PII (the higher-sensitivity store) destroyed first. If the process
 * crashes mid-clear, the partial-clear state leaves the LESS sensitive
 * plaintext layer lingering rather than the encrypted PII. On the next
 * cold start the migration block re-migrates the surviving plaintext
 * entry (idempotent path).
 *
 * **Story 12-7 review-round-1 P11**: `clearSecureCacheForUser` is
 * wrapped in its own try/catch + `captureError` so a Platform-shim
 * sync-throw doesn't reject this function to its caller (sign-out flow
 * surfaces unhandled rejection).
 */
export async function clearUserCache(userId: string): Promise<void> {
  // P7: SecureStore first — sign-out's primary intent is to destroy
  // encrypted PII. No-op on web (`clearSecureCacheForUser` has its own
  // Platform.OS === "web" early-return).
  try {
    await clearSecureCacheForUser(userId, [...SECURE_CACHE_KEYS]);
  } catch (err) {
    captureError(err, "cache-clear-user-secure", { key: "secure-batch" });
  }
  // Then the plaintext namespace.
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userPrefix = `${CACHE_PREFIX}${userId}:`;
    const userKeys = allKeys.filter((k) => k.startsWith(userPrefix));
    if (userKeys.length > 0) {
      await AsyncStorage.multiRemove(userKeys);
    }
  } catch (err) {
    captureError(err, "cache-clear-user");
  }
}

/**
 * Remove ALL cache entries (all users) and the write queue.
 *
 * **Story 12-7 caveat:** SecureStore has no `getAllKeys` equivalent, so
 * this function clears ONLY the plaintext AsyncStorage namespace. Multi-
 * user SecureStore cleanup requires explicit per-user `clearUserCache`
 * calls — out-of-scope for v1 because the app does not currently support
 * multi-account-on-same-device. If a future story introduces account
 * switching, the switch handler must call `clearUserCache(prevUserId)`
 * explicitly to scrub the previous user's encrypted entries.
 */
export async function clearAllCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX) || k === WRITE_QUEUE_KEY);
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch (err) {
    captureError(err, "cache-clear-all");
  }
}

// ---------------------------------------------------------------------------
// Write Queue (write-through with offline retry)
// ---------------------------------------------------------------------------

/**
 * Module-scope in-flight Promise guard for `flushWriteQueue`.
 *
 * Reason (story 9-6, defects D2/D3): the queue itself is single-keyed
 * (`WRITE_QUEUE_KEY`), so concurrent flushes from different callers (auth
 * listener, NetworkBanner reconnect, future call sites) would race each other
 * — both reading the same queue, both replaying each write, both persisting
 * the remaining list. Result on the wire: duplicate inserts/updates.
 *
 * The guard returns the in-flight Promise to concurrent callers so they
 * observe the same `flushed` count from a single replay pass. The reset in
 * `finally` ensures a rejected flush does not permanently lock the function.
 */
let flushInFlight: Promise<number> | null = null;

/**
 * Read the current write queue from storage.
 *
 * Defensive (P8 from 9-10 review): if the persisted JSON is not an array
 * (poison pill from a corrupt storage layer or a future schema migration
 * gone wrong), return `[]` rather than letting downstream `.map`/`.filter`/
 * iteration throw. The on-disk poison pill is left in place so a subsequent
 * `persistQueue` overwrites it with a known-good shape.
 */
async function readQueue(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(WRITE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persist the write queue to storage.
 */
async function persistQueue(queue: QueuedWrite[]): Promise<void> {
  try {
    await AsyncStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    captureError(err, "cache-persist-queue");
  }
}

/**
 * Enqueue a write operation for later retry.
 * Called when a Supabase write fails due to network issues.
 */
export async function enqueueWrite(write: Omit<QueuedWrite, "id" | "createdAt">): Promise<void> {
  const queue = await readQueue();
  const entry: QueuedWrite = {
    ...write,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
  };
  queue.push(entry);
  await persistQueue(queue);
}

/**
 * Flush the write queue by replaying all pending writes against Supabase.
 *
 * Requires the Supabase client to be passed in to avoid circular imports.
 * Successfully replayed writes are removed from the queue; failed writes
 * remain for the next attempt.
 *
 * Idempotency (story 9-6): the function is guarded by a module-scope
 * in-flight Promise. Concurrent callers (auth listener, NetworkBanner
 * reconnect, future sites) observe the same in-flight Promise and resolve
 * with the same `flushed` count — the queue is read, replayed, and persisted
 * exactly once per flush window, never racing itself into double inserts.
 * The guard resets in `finally` so a rejected flush does not permanently
 * lock the function.
 *
 * Story 9-10 hardening:
 * - **AC #2 (atomic merge on persist):** before the terminal `persistQueue`
 *   we re-read the queue and merge any writes whose id was NOT in the flush
 *   snapshot — these were enqueued mid-flight via `enqueueWrite`. Without
 *   this merge, a fire-and-forget `enqueueWrite(w3)` racing a
 *   `flushWriteQueue` that started with `[w1, w2]` would be silently lost
 *   when the flush's `persistQueue([])` overwrites the storage value of
 *   `[w1, w2, w3]`. The merge preserves `w3` for the next flush.
 * - **AC #4 (catch-and-return-0):** the IIFE body is wrapped in `try/catch`.
 *   An internal failure (e.g. `isOnline` throwing, AsyncStorage panic)
 *   resolves to `0` for all concurrent callers and emits
 *   `captureError(_, "cache-flush-internal")`. The public contract is
 *   "returns the count of successfully flushed writes" — `0` is a legal
 *   value meaning "no writes flushed this round." Concurrent callers
 *   awaiting the same in-flight Promise are no longer poisoned by a
 *   transient internal failure.
 *
 * @param supabaseClient - The initialised Supabase client
 * @returns The number of successfully flushed writes.
 */
export async function flushWriteQueue(supabaseClient: {
  from: (table: string) => {
    insert: (payload: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
    update: (payload: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: unknown }>;
    };
    upsert: (
      payload: Record<string, unknown>,
      options?: { onConflict?: string }
    ) => PromiseLike<{ error: unknown }>;
  };
}): Promise<number> {
  // Idempotency guard — concurrent callers share a single replay pass.
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async (): Promise<number> => {
    // P3 (9-10 review): hoist `flushed` and `remaining` so the catch path
    // can persist consumed writes off the queue and report the true count.
    // Returning `0` after partial success would (a) lie to callers about
    // progress and (b) leave already-flushed writes on the queue, where the
    // next flush would replay them as duplicates.
    let flushed = 0;
    const remaining: QueuedWrite[] = [];
    let queueSnapshot: QueuedWrite[] = [];
    let didReplayLoop = false;

    try {
      const online = await isOnline();
      if (!online) return 0;

      const queue = await readQueue();
      queueSnapshot = queue;
      if (queue.length === 0) return 0;

      for (const write of queue) {
        try {
          let result: { error: unknown };

          switch (write.operation) {
            case "insert":
              result = await supabaseClient.from(write.table).insert(write.payload);
              break;
            case "update":
              if (!write.filter) {
                // Cannot update without a filter -- discard
                continue;
              }
              result = await supabaseClient
                .from(write.table)
                .update(write.payload)
                .eq(write.filter.column, write.filter.value);
              break;
            case "upsert":
              result = await supabaseClient
                .from(write.table)
                .upsert(write.payload, { onConflict: write.onConflict });
              break;
            default:
              // Unknown operation -- discard
              continue;
          }

          if (result.error) {
            remaining.push(write);
          } else {
            flushed++;
          }
        } catch {
          remaining.push(write);
        }
      }
      didReplayLoop = true;

      // Story 9-10 AC #2: atomically reconcile with any writes enqueued
      // during the flush. The flush snapshot was `queue` (read at the start).
      // Any write whose id is NOT in the snapshot was enqueued mid-flight by
      // `enqueueWrite` and must survive the post-flush persist. The
      // `remaining` list still carries the failure state of the writes the
      // flush attempted to replay; we append the truly-new writes to it.
      //
      // P2 (9-10 review): the merge step must NOT cause `persistQueue` to be
      // skipped on failure — if `currentQueue` is malformed, falling back to
      // `remaining` alone is preferable to leaving the snapshot's flushed
      // writes on the queue (they would be replayed as duplicates next time).
      let mergedQueue: QueuedWrite[];
      try {
        const snapshotIds = new Set(queue.map((w) => w.id));
        const currentQueue = await readQueue();
        const newWrites = currentQueue.filter((w) => !snapshotIds.has(w.id));
        mergedQueue = [...remaining, ...newWrites];
      } catch (mergeErr) {
        // Defensive: the shape-validation in `readQueue` already protects
        // against most causes here. Capture for visibility, but proceed to
        // persist `remaining` so consumed writes leave the queue.
        captureError(mergeErr, "cache-flush-internal");
        mergedQueue = remaining;
      }
      await persistQueue(mergedQueue);
      return flushed;
    } catch (err) {
      // Story 9-10 AC #4: internal error during flush (e.g. `isOnline` threw,
      // AsyncStorage panic). Capture for visibility and resolve to the true
      // `flushed` count (0 if the failure happened before the replay loop
      // ran) — concurrent callers awaiting the same in-flight Promise must
      // not be poisoned by a transient internal failure. The next call (with
      // the condition cleared) proceeds normally because `finally` resets
      // the guard.
      captureError(err, "cache-flush-internal");
      // P2/P3 (9-10 review): if the replay loop actually ran, persist
      // `remaining` so the writes we consumed are removed from the on-disk
      // queue (otherwise the next flush replays them = duplicate inserts).
      // Mid-flight writes from `enqueueWrite` are reconciled by the
      // best-effort merge; if it fails, we still drop the snapshot's
      // consumed writes so duplicates don't pile up — at the cost of
      // possibly losing one mid-flight enqueue, which is the same trade
      // already accepted by the spec's "out of scope" race window.
      if (didReplayLoop) {
        try {
          const snapshotIds = new Set(queueSnapshot.map((w) => w.id));
          const currentQueue = await readQueue();
          const newWrites = currentQueue.filter((w) => !snapshotIds.has(w.id));
          await persistQueue([...remaining, ...newWrites]);
        } catch {
          // Last-ditch: at minimum drop the consumed writes. `persistQueue`
          // itself swallows storage errors via its own try/catch.
          await persistQueue(remaining);
        }
      }
      return flushed;
    } finally {
      flushInFlight = null;
    }
  })();

  return flushInFlight;
}

/**
 * Get the number of pending writes in the queue.
 */
export async function getPendingWriteCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

// ---------------------------------------------------------------------------
// Well-known cache keys (centralised to avoid typos)
// ---------------------------------------------------------------------------

export const CACHE_KEYS = {
  PROFILE: "profile",
  VOCABULARY: "vocabulary",
  SKILLS: "skills",
  DAILY_ACTIVITY_TODAY: "daily_activity_today",
  RECENT_ACTIVITY: "recent_activity",
  TOP_ERRORS: "top_errors",
  STREAK: "streak",
  DAILY_BRIEFING: "daily_briefing",
  SRS_DUE_COUNT: "srs_due_count",
  WEAKEST_SKILL: "weakest_skill",
  BRIEFING_ERRORS: "briefing_errors",
  BRIEFING_ACTIVITY_TODAY: "briefing_activity_today",
  BRIEFING_ERROR_COUNTS: "briefing_error_counts",
  /** Story 13-2: home aggregate — consolidates 9 of 11 home-mount queries. */
  HOME_AGGREGATE: "home_aggregate",
} as const;

/**
 * Story 12-7: allowlist of cache keys whose data is sensitive PII and
 * must be encrypted via `secure-cache.ts` (SecureStore) rather than
 * plaintext AsyncStorage. Closes audit finding P1-11.
 *
 * Currently routes only `CACHE_KEYS.PROFILE` to SecureStore. Future
 * operator decisions to encrypt vocabulary / daily-briefing / error-
 * patterns are one-line additions here — every consumer call site
 * (`getCache` / `setCache` / `invalidateCache` / `cacheWithFallback`)
 * forks against this allowlist automatically.
 *
 * **Why not encrypt everything?** iOS Keychain has a soft per-item size
 * limit (~2KB recommended); Android EncryptedSharedPreferences has
 * per-write encryption cost that scales with payload size + frequency.
 * Low-PII operational data (skill scores, streak counts, SRS due counts)
 * is short-lived (15-30 min TTLs) and would degrade perf without
 * security benefit. The audit specifically names PROFILE as the
 * sensitive-PII row.
 */
export const SECURE_CACHE_KEYS: ReadonlySet<string> = new Set([CACHE_KEYS.PROFILE]);

// ---------------------------------------------------------------------------
// TTL presets (milliseconds)
// ---------------------------------------------------------------------------

export const CACHE_TTL = {
  /** Profile data -- refreshed infrequently */
  PROFILE: 4 * 60 * 60 * 1000, // 4 hours
  /** Vocabulary list -- moderate staleness OK */
  VOCABULARY: 2 * 60 * 60 * 1000, // 2 hours
  /** Skill progress -- changes after each exercise */
  SKILLS: 30 * 60 * 1000, // 30 minutes
  /** Daily activity -- changes frequently */
  DAILY_ACTIVITY: 15 * 60 * 1000, // 15 minutes
  /** Error patterns -- moderate staleness OK */
  ERRORS: 60 * 60 * 1000, // 1 hour
  /** Streak days -- changes once per day */
  STREAK: 60 * 60 * 1000, // 1 hour
  /** Composite daily briefing data -- short TTL, aggregates multiple sources */
  DAILY_BRIEFING: 10 * 60 * 1000, // 10 minutes
  /** SRS vocabulary due count -- matches daily activity frequency */
  SRS_DUE: 15 * 60 * 1000, // 15 minutes
  /** Error counts (total/resolved) -- changes after exercises */
  ERROR_COUNTS: 30 * 60 * 1000, // 30 minutes
  /**
   * Story 13-2: home aggregate — short TTL so activity logging refreshes
   * feel current, but long enough to dedup within-session re-mounts.
   */
  HOME_AGGREGATE: 5 * 60 * 1000, // 5 minutes
} as const;
