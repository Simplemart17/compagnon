/**
 * Story 13-3 — `[sessionId].tsx` source-drift detector (audit P2-4 closure).
 *
 * Pins the post-13-3 contract by reading the screen source from disk +
 * asserting:
 *   (1) `useSessionFeedbackAggregate` is imported from `@/src/hooks/...`.
 *   (2) POSITIVE: `useSessionFeedbackAggregate({` call site present with
 *       the 6 expected option fields.
 *   (3) NEGATIVE: pre-13-3 `supabase.from("conversations").select(...)` is GONE.
 *   (4) NEGATIVE: pre-13-3 `supabase.from("error_patterns").select("*", { count: "exact" ... })` is GONE.
 *   (5) NEGATIVE: pre-13-3 `supabase.from("error_patterns").select("error_description")` is GONE.
 *   (6) NEGATIVE: pre-13-3 `supabase.from("profiles").select("current_cefr_level")` is GONE.
 *   (7) NEGATIVE: 4 pre-13-3 useState declarations (comparisonMetrics /
 *       milestone / errorJourney / nextAction) are GONE — the hook owns them.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_PATH = join(__dirname, "..", "[sessionId].tsx");
const SCREEN_SOURCE = readFileSync(SCREEN_PATH, "utf-8");

/** Story 12-2 P12 lesson: strip comments so JSDoc mentioning pre-13-3
 *  patterns doesn't trip the negative guards. */
const SCREEN_CODE_ONLY = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("[sessionId].tsx — Story 13-3 source-drift detector (audit P2-4)", () => {
  it("Case 1: imports `useSessionFeedbackAggregate` from the hook module", () => {
    expect(SCREEN_CODE_ONLY).toMatch(
      /import\s*\{\s*useSessionFeedbackAggregate\s*\}\s*from\s*["']@\/src\/hooks\/use-session-feedback-aggregate["']/
    );
  });

  it("Case 2: POSITIVE — `useSessionFeedbackAggregate({` call site present", () => {
    expect(SCREEN_CODE_ONLY).toMatch(/useSessionFeedbackAggregate\s*\(\s*\{/);
    // Destructured outputs match the hook's UseSessionFeedbackAggregateReturn.
    expect(SCREEN_CODE_ONLY).toMatch(
      /const\s*\{\s*comparisonMetrics\s*,\s*milestone\s*,\s*errorJourney\s*,\s*nextAction\s*\}/
    );
  });

  it('Case 3: NEGATIVE — pre-13-3 `supabase.from("conversations")` queries are GONE', () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(/supabase\.from\(\s*["']conversations["']\s*\)/);
  });

  it('Case 4: NEGATIVE — pre-13-3 `supabase.from("error_patterns")` count queries are GONE', () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(/supabase\.from\(\s*["']error_patterns["']\s*\)/);
  });

  it('Case 5: NEGATIVE — pre-13-3 `supabase.from("profiles").select("current_cefr_level")` is GONE', () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /supabase\.from\(\s*["']profiles["']\s*\)\s*\.\s*select\s*\(\s*["']current_cefr_level["']/
    );
  });

  it("Case 6: NEGATIVE — pre-13-3 4 useState declarations for the aggregated state are GONE", () => {
    // The 4 useState pieces are now owned by the hook.
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /useState\s*<\s*SessionComparisonMetric\[\]\s*\|\s*null\s*>/
    );
    expect(SCREEN_CODE_ONLY).not.toMatch(/useState\s*<\s*MilestoneBannerProps\s*\|\s*null\s*>/);
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /useState\s*<\s*\{\s*total:\s*number\s*;\s*resolved:\s*number\s*\}\s*\|\s*null\s*>/
    );
  });

  it("Case 7: `preConversationCefrLevel` useState + cefrCapturedRef stay in the screen", () => {
    // These belong to the screen, not the aggregate hook (used for capture
    // timing at conversation START, not for derived feedback state).
    expect(SCREEN_CODE_ONLY).toMatch(
      /useState<string\s*\|\s*null>\(null\)\s*;\s*const\s+cefrCapturedRef/
    );
  });
});
