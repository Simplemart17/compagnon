/**
 * Story 13-4 — `[testId].tsx` source-drift detector (audit P2-6 closure).
 *
 * Pins the post-13-4 contract by reading the screen source from disk +
 * asserting:
 *   (1) POSITIVE — `useMockTestGeneration` imported from `@/src/hooks/...`.
 *   (2) POSITIVE — `useMockTestGeneration({` call site present.
 *   (3) POSITIVE — `useMemo` applied to `sections` array (Story 13-3 P2
 *       defense-in-depth content-key memoization).
 *   (4) NEGATIVE — pre-13-4 `for (const section of sections)` serial-await
 *       loop is GONE.
 *   (5) NEGATIVE — `chatCompletionJSON` import GONE (moved to hook).
 *   (6) NEGATIVE — `mockTestSectionSchema` import GONE.
 *   (7) NEGATIVE — `buildMockTestPrompt` import GONE.
 *   (8) NEGATIVE — direct `supabase.from("mock_tests").insert(...)` for the
 *       INITIAL insert is GONE. (The UPDATE on completion at the finished-
 *       state effect STAYS — different concern, screen owns it.)
 *   (9) POSITIVE — `handleNextSection` guards against advancing into a
 *       section whose `generation.sectionStatus[nextSection]` is not "ready".
 *   (10) POSITIVE — `state.status` transitions to `"active"` via
 *        `generation.firstSectionReady` (NOT via the deleted post-loop
 *        setState in pre-13-4 `initTest`).
 *
 * Story 12-2 P12 lesson: strip comments so JSDoc that mentions pre-13-4
 * patterns doesn't trip the negative guards.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_PATH = join(__dirname, "..", "[testId].tsx");
const SCREEN_SOURCE = readFileSync(SCREEN_PATH, "utf-8");

const SCREEN_CODE_ONLY = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("[testId].tsx — Story 13-4 source-drift detector (audit P2-6)", () => {
  it("Case 1: POSITIVE — imports `useMockTestGeneration` from the hook module", () => {
    expect(SCREEN_CODE_ONLY).toMatch(
      /import\s*\{\s*useMockTestGeneration\s*\}\s*from\s*["']@\/src\/hooks\/use-mock-test-generation["']/
    );
  });

  it("Case 2: POSITIVE — `useMockTestGeneration({` call site present", () => {
    expect(SCREEN_CODE_ONLY).toMatch(/useMockTestGeneration\s*\(\s*\{/);
  });

  it("Case 3 (Story 13-3 P2): POSITIVE — `useMemo` applied to the `sections` array", () => {
    // The `sections` array is computed inline from `testId` and used by the
    // hook; memoizing it ensures a stable input reference (the hook ALSO
    // de-dupes via sectionsKey content-key memoization, defense-in-depth).
    expect(SCREEN_CODE_ONLY).toMatch(/useMemo\s*<\s*Section\[\]\s*>\s*\(/);
  });

  it("Case 4: NEGATIVE — pre-13-4 `for (const section of sections)` serial-await loop is GONE", () => {
    // The post-13-4 screen doesn't iterate `sections` with await; the hook does.
    // (Inline patterns like `state.sections.reduce(...)` for total-minutes math
    // STAY — those are pure sync reduces, no await.)
    expect(SCREEN_CODE_ONLY).not.toMatch(/for\s*\(\s*const\s+section\s+of\s+sections\s*\)/);
    // Anchor against the pre-13-4 `generationFailed` flag name.
    expect(SCREEN_CODE_ONLY).not.toMatch(/let\s+generationFailed/);
  });

  it("Case 5: NEGATIVE — `chatCompletionJSON` import GONE from the screen (moved to hook)", () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /import\s*\{[^}]*\bchatCompletionJSON\b[^}]*\}\s*from\s*["']@\/src\/lib\/openai["']/
    );
  });

  it("Case 6: NEGATIVE — `mockTestSectionSchema` import GONE from the screen", () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /import\s*\{[^}]*\bmockTestSectionSchema\b[^}]*\}\s*from\s*["']@\/src\/lib\/schemas\/ai-responses["']/
    );
  });

  it("Case 7: NEGATIVE — `buildMockTestPrompt` import GONE from the screen", () => {
    expect(SCREEN_CODE_ONLY).not.toMatch(
      /import\s*\{[^}]*\bbuildMockTestPrompt\b[^}]*\}\s*from\s*["']@\/src\/lib\/prompts\/mock-test["']/
    );
  });

  it("Case 8: NEGATIVE — pre-13-4 initial `supabase.from('mock_tests').insert({ status: 'in_progress' })` is GONE (moved to hook)", () => {
    // The completion UPDATE at the finished-state effect STAYS (writes
    // total_score + section_scores + status: "completed" — different concern).
    // The fallback INSERT inside the completion effect (no activeTestId case)
    // also stays since it writes `status: "completed"`, not `in_progress`.
    // The pre-13-4 INITIAL insert wrote `status: "in_progress"` along with
    // `questions: allQuestions` (the pre-load INSERT). Post-13-4 the hook
    // owns that INSERT. Pin via the load-bearing `status: "in_progress"`
    // anchor.
    //
    // (A future addition that legitimately needs `status: "in_progress"`
    // inserts from the screen layer must explicitly opt out of this guard.)
    expect(SCREEN_CODE_ONLY).not.toMatch(/status\s*:\s*["']in_progress["']/);
  });

  it('Case 9: POSITIVE — `handleNextSection` guards on `generation.sectionStatus[nextSection]` !== "ready"', () => {
    expect(SCREEN_CODE_ONLY).toMatch(/generation\.sectionStatus\s*\[\s*nextSection\s*\]/);
  });

  it("Case 10: POSITIVE — `state.status` transitions to `active` via `generation.firstSectionReady`", () => {
    // The transition-to-active effect lives in a useEffect keyed on
    // `generation.firstSectionReady` and sets `state.status: "active"`.
    expect(SCREEN_CODE_ONLY).toMatch(/generation\.firstSectionReady/);
    expect(SCREEN_CODE_ONLY).toMatch(/status\s*:\s*["']active["']/);
  });

  it("Case 11: POSITIVE — recoverable Alert when the FIRST section fails (P4 dead-end fix)", () => {
    // firstSectionReady gates on sections[0]==="ready" and allFailed needs ALL
    // sections failed — so a failed first section + a succeeded later section
    // would stick the screen on the loading skeleton forever. The screen must
    // detect sections[0]==="failed" and surface a Retry/Go-Back Alert.
    expect(SCREEN_CODE_ONLY).toMatch(/firstSectionFailedAlertFiredRef/);
    expect(SCREEN_CODE_ONLY).toMatch(
      /generation\.sectionStatus\s*\[\s*sections\s*\[\s*0\s*\]\s*\]\s*!==\s*["']failed["']/
    );
  });
});
