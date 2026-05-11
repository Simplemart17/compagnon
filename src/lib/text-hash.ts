/**
 * Shared text-hash helpers.
 *
 * Extracted from `src/lib/realtime-transcript.ts` (Story 9-5) by Story 10-8
 * so the realtime-transcript fallback-key path and the new exercise dedup
 * path share one source of truth — eliminating the future-drift risk of
 * two djb2 implementations.
 */

/**
 * djb2 hash over Unicode code points, base-36-encoded.
 *
 * Iterating with `for...of` walks code points (not UTF-16 code units),
 * so emoji and other surrogate-pair text are handled cleanly. The result
 * is a short opaque string with no embedded free text — safe to pass
 * through Sentry breadcrumb data and to persist in DB columns indexed
 * for membership queries.
 *
 * Used by:
 *   - `src/lib/realtime-transcript.ts` `fallbackKey` (story 9-5 — voice transcript dedup)
 *   - `src/lib/exercise-dedup.ts` `hashQuestionStem` (story 10-8 — exercise question-stem dedup)
 */
export function hashText(text: string): string {
  let hash = 5381;
  for (const ch of text) {
    hash = ((hash << 5) + hash + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}
