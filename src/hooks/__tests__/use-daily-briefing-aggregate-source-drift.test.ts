/**
 * Story 13-2 — `use-daily-briefing.ts` source-drift detector (audit P2-5 closure).
 *
 * Pins the post-13-2 contract by reading the hook source from disk + asserting:
 *   (1) `getHomeAggregate` is imported from `@/src/lib/home-aggregate`.
 *   (2) `retrieveDailyGreetingMemories` is imported from `@/src/lib/memory`.
 *   (3) POSITIVE: both `getHomeAggregate(` and `retrieveDailyGreetingMemories(`
 *       call sites are present.
 *   (4) NEGATIVE: pre-13-2 `retrieveMemories(userId, "daily greeting", ...)`
 *       is GONE (replaced by the memoized variant).
 *   (5) NEGATIVE: pre-13-2 inline `supabase.from("vocabulary")` SRS-due-count
 *       query is GONE.
 *   (6) NEGATIVE: pre-13-2 inline `supabase.from("error_patterns")` queries
 *       are GONE (aggregate handles error_counts + top_errors).
 *   (7) NEGATIVE: pre-13-2 inline `supabase.from("skill_progress")` weakest-skill
 *       query is GONE.
 *   (8) Story 9-4 invariant: `sanitizeMemoryContent` is still called at the
 *       composeMessage + buildTodayPlan consumer sites (read-time defense).
 *   (9) Sentry tag `daily-briefing-memories` preserved; new tag
 *       `daily-briefing-aggregate` added.
 *  (10) `CACHE_KEYS.HOME_AGGREGATE` is used as the aggregate cache key.
 */

import { readFileSync } from "fs";
import { join } from "path";

const HOOK_PATH = join(__dirname, "..", "use-daily-briefing.ts");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf-8");

/** Strip block + line comments per Story 12-2 P12 lesson. */
const HOOK_CODE_ONLY = HOOK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("use-daily-briefing.ts — Story 13-2 source-drift detector (audit P2-5)", () => {
  it("Case 1: imports `getHomeAggregate` from `@/src/lib/home-aggregate`", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /import\s*\{[^}]*getHomeAggregate[^}]*\}\s*from\s*["']@\/src\/lib\/home-aggregate["']/
    );
  });

  it("Case 2: imports `retrieveDailyGreetingMemories` from `@/src/lib/memory`", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /import\s*\{[^}]*retrieveDailyGreetingMemories[^}]*\}\s*from\s*["']@\/src\/lib\/memory["']/
    );
  });

  it("Case 3: POSITIVE — both `getHomeAggregate(` and `retrieveDailyGreetingMemories(` call sites present", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /getHomeAggregate\s*\(\s*userId\s*,\s*getLocalDateString\(\)\s*\)/
    );
    expect(HOOK_CODE_ONLY).toMatch(/retrieveDailyGreetingMemories\s*\(\s*userId\s*,\s*3\s*\)/);
  });

  it('Case 4: NEGATIVE — pre-13-2 `retrieveMemories(userId, "daily greeting", ...)` is GONE', () => {
    expect(HOOK_CODE_ONLY).not.toMatch(
      /retrieveMemories\s*\(\s*userId\s*,\s*["']daily greeting["']/
    );
  });

  it('Case 5: NEGATIVE — pre-13-2 inline `supabase.from("vocabulary")` SRS query is GONE', () => {
    expect(HOOK_CODE_ONLY).not.toMatch(/supabase\.from\(\s*["']vocabulary["']\s*\)\s*\.\s*select/);
  });

  it('Case 6: NEGATIVE — pre-13-2 inline `supabase.from("error_patterns")` queries are GONE', () => {
    expect(HOOK_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']error_patterns["']\s*\)\s*\.\s*select/
    );
  });

  it('Case 7: NEGATIVE — pre-13-2 inline `supabase.from("skill_progress")` weakest-skill query is GONE', () => {
    expect(HOOK_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']skill_progress["']\s*\)\s*\.\s*select/
    );
  });

  it("Case 8: Story 9-4 invariant — `sanitizeMemoryContent` still called at consumer sites", () => {
    // composeMessage + buildTodayPlan both call sanitizeMemoryContent on
    // memory + error_description strings before rendering them. Story 9-4
    // stored-prompt-injection read-time defense.
    const matches = HOOK_CODE_ONLY.match(/sanitizeMemoryContent\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("Case 9: Sentry tags preserved + new `daily-briefing-aggregate` tag added", () => {
    expect(HOOK_CODE_ONLY).toMatch(/captureError\([^)]*,\s*["']daily-briefing-memories["']\s*\)/);
    expect(HOOK_CODE_ONLY).toMatch(/captureError\([^)]*,\s*["']daily-briefing-aggregate["']\s*\)/);
  });

  it("Case 10: `CACHE_KEYS.HOME_AGGREGATE` used as the aggregate cache key", () => {
    expect(HOOK_CODE_ONLY).toMatch(/CACHE_KEYS\.HOME_AGGREGATE/);
  });
});
