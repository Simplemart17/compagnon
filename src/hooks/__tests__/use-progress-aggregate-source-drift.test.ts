/**
 * Story 13-2 — `use-progress.ts` source-drift detector (audit P2-5 closure).
 *
 * Pins the post-13-2 contract by reading the hook source from disk + asserting:
 *   (1) `getHomeAggregate` is imported from `@/src/lib/home-aggregate`.
 *   (2) POSITIVE: `getHomeAggregate(` call site present.
 *   (3) NEGATIVE: the pre-13-2 5-query `Promise.all([cacheWithFallback × 5])`
 *       pattern is GONE — no direct `supabase.from("skill_progress")`, no
 *       `supabase.from("profiles").select("streak_days")`, no per-slot
 *       fetches of `daily_activity` / `error_patterns` (the aggregate
 *       handles all of these server-side now).
 *   (4) Sentry tag `progress-loading` preserved at the catch site.
 *   (5) `CACHE_KEYS.HOME_AGGREGATE` is invalidated on `logActivity`.
 */

import { readFileSync } from "fs";
import { join } from "path";

const HOOK_PATH = join(__dirname, "..", "use-progress.ts");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf-8");

/** Strip block + line comments per Story 12-2 P12 lesson so JSDoc mentioning
 *  pre-13-2 patterns doesn't trip the negative-guard regexes. */
const HOOK_CODE_ONLY = HOOK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("use-progress.ts — Story 13-2 source-drift detector (audit P2-5)", () => {
  it("Case 1: imports `getHomeAggregate` from `@/src/lib/home-aggregate`", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /import\s*\{[^}]*getHomeAggregate[^}]*\}\s*from\s*["']@\/src\/lib\/home-aggregate["']/
    );
  });

  it("Case 2: POSITIVE — `getHomeAggregate(` call site present", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /getHomeAggregate\s*\(\s*user\.id\s*,\s*getLocalDateString\(\)\s*\)/
    );
  });

  it("Case 3: NEGATIVE — pre-13-2 direct supabase.from() reads are GONE", () => {
    // Pre-13-2 the hook fired 5 parallel queries against these tables.
    // Post-13-2 all reads route through get_home_aggregate.
    expect(HOOK_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']skill_progress["']\s*\)\s*\.\s*select/
    );
    expect(HOOK_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']daily_activity["']\s*\)\s*\.\s*select/
    );
    expect(HOOK_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']error_patterns["']\s*\)\s*\.\s*select/
    );
    expect(HOOK_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']profiles["']\s*\)\s*\.\s*select\([^)]*streak_days/
    );
  });

  it("Case 4: Sentry tag `progress-loading` preserved at the refresh-catch site", () => {
    // Story 13-2 review-round-1 P11: use string-literal-tolerant matching
    // for the categorical-tag arg. Pre-patch `[^)]*` was stopped by any
    // intermediate `)` (e.g., if a future refactor used
    // `captureError(computeError(), "progress-loading")` the regex would
    // fail). Just match the canonical short-tag string verbatim — that
    // string only ever appears in captureError calls in this project.
    expect(HOOK_CODE_ONLY).toMatch(/["']progress-loading["']/);
    expect(HOOK_CODE_ONLY).toMatch(/captureError\s*\(/);
  });

  it("Case 5: `CACHE_KEYS.HOME_AGGREGATE` is invalidated on `logActivity`", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /invalidateCache\(\s*user\.id\s*,\s*CACHE_KEYS\.HOME_AGGREGATE\s*\)/
    );
  });
});
