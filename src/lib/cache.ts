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

import { isOnline } from "@/src/lib/network";
import { captureError } from "@/src/lib/sentry";

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
 * Retrieve a cached value if it exists and has not expired.
 *
 * @returns The cached data, or `null` if missing / expired.
 */
export async function getCache<T>(userId: string, key: string): Promise<T | null> {
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
    // Network failed -- try cache (ignore TTL for fallback)
    try {
      const raw = await AsyncStorage.getItem(buildKey(userId, key));
      if (raw) {
        const entry: CacheEntry<T> = JSON.parse(raw) as CacheEntry<T>;
        return { data: entry.data, fromCache: true };
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
 * Remove a single cached entry.
 */
export async function invalidateCache(userId: string, key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(buildKey(userId, key));
  } catch (err) {
    captureError(err, "cache-invalidate", { key });
  }
}

/**
 * Remove all cache entries for a specific user.
 */
export async function clearUserCache(userId: string): Promise<void> {
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
 * Read the current write queue from storage.
 */
async function readQueue(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(WRITE_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedWrite[];
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
  const online = await isOnline();
  if (!online) return 0;

  const queue = await readQueue();
  if (queue.length === 0) return 0;

  const remaining: QueuedWrite[] = [];
  let flushed = 0;

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

  await persistQueue(remaining);
  return flushed;
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
} as const;

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
} as const;
