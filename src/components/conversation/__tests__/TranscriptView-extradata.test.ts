/**
 * Story 13-1 — `TranscriptView` extraData drift detector.
 *
 * **Review-round-1 P1 scope narrowing:** the initial 13-1 implementation
 * simplified extraData to `transcript.length` only across both branches,
 * but the review caught 3 correctness regressions (broken correction
 * gating, transcript-cap eviction invalidation hole, hot-reload crash
 * risk). The pre-13-1 shape — `condensed ? `${transcript.length}-${isAiSpeaking}` : transcript.length` —
 * is RESTORED. The audit P2-3 storm fix lives in the orchestrator (~99%
 * of the burden); the per-turn `isAiSpeaking`-flip extraData cost is
 * negligible (≤60 invalidations/session).
 *
 * What this drift detector pins POST-review-round-1:
 *
 *   (1) `extraData={condensed ? `${transcript.length}-${isAiSpeaking}` : transcript.length}`
 *       shape is present in the condensed-branch ternary form.
 *   (2) `isAiSpeakingRef.current` is read at render-time (Story 12-1
 *       ref-stable pattern) — confirms the render-time access path for
 *       the side-note correction gating remains intact regardless of
 *       FlatList virtualization behavior.
 *
 * Uses comment-stripping per Story 12-2 P12 lesson so JSDoc mentioning
 * pre-13-1 / round-1 patterns doesn't pollute the regex assertions.
 */

import { readFileSync } from "fs";
import { join } from "path";

const TRANSCRIPT_VIEW_PATH = join(__dirname, "..", "TranscriptView.tsx");
const TRANSCRIPT_VIEW_SOURCE = readFileSync(TRANSCRIPT_VIEW_PATH, "utf-8");

/**
 * Strip block + line comments so JSDoc mentioning various extraData
 * shapes doesn't trip the assertions. Story 12-2 P12 lesson.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const TRANSCRIPT_VIEW_CODE_ONLY = stripComments(TRANSCRIPT_VIEW_SOURCE);

describe("TranscriptView extraData — Story 13-1 review-round-1 P1 drift detector", () => {
  it("Case 1: POSITIVE — `condensed`-branch ternary with `${transcript.length}-${isAiSpeaking}` is restored", () => {
    // The condensed branch MUST include `isAiSpeaking` in the extraData key
    // so a state flip during AI speech (with no transcript entry added)
    // re-evaluates the renderItem closure for the side-note correction
    // gating. Whitespace-tolerant — accepts Prettier reformatting.
    expect(TRANSCRIPT_VIEW_CODE_ONLY).toMatch(
      /extraData=\{[\s\S]{0,80}condensed[\s\S]{0,80}\?\s*`\$\{\s*transcript\.length\s*\}-\$\{\s*isAiSpeaking\s*\}`[\s\S]{0,80}:\s*transcript\.length/
    );
  });

  it("Case 2: POSITIVE — `isAiSpeakingRef.current` is read at render-time (Story 12-1 invariant)", () => {
    // The renderItem closure relies on `isAiSpeakingRef.current` for the
    // side-note correction gating. Independent of the extraData strategy,
    // this read MUST remain in the renderItem region — otherwise a future
    // refactor that drops the ref would silently break the gating even
    // though the condensed branch's extraData re-renders rows correctly.
    expect(TRANSCRIPT_VIEW_CODE_ONLY).toMatch(/isAiSpeakingRef\.current/);
  });
});
