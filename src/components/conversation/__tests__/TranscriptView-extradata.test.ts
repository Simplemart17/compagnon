/**
 * Story 13-1 — `TranscriptView` extraData drift detector (audit P2-3 closure).
 *
 * Pins the post-13-1 extraData contract against silent regression by reading
 * the component source from disk and asserting:
 *
 *   (1) `extraData={transcript.length}` shape is present (post-13-1 form).
 *   (2) NEGATIVE — `${transcript.length}-${isAiSpeaking}` template-literal
 *       shape is GONE. Pre-13-1 the `condensed` branch produced this string
 *       which invalidated FlatList virtualization on every AI-speech state
 *       flip (~2 flips per turn × 30 turns = 60 invalidations per session).
 *   (3) `isAiSpeakingRef.current` is read inside a `renderItem`-region of
 *       the component — confirms the Story 12-1 ref-stable pattern is the
 *       render-time access path for the side-note correction gating
 *       (otherwise dropping `isAiSpeaking` from extraData would leak stale
 *       row-render state).
 *
 * Uses comment-stripping per Story 12-2 P12 lesson so JSDoc mentioning the
 * pre-13-1 pattern doesn't trip the negative-guard regex in Case 2.
 */

import { readFileSync } from "fs";
import { join } from "path";

const TRANSCRIPT_VIEW_PATH = join(__dirname, "..", "TranscriptView.tsx");
const TRANSCRIPT_VIEW_SOURCE = readFileSync(TRANSCRIPT_VIEW_PATH, "utf-8");

/**
 * Strip block + line comments so JSDoc mentioning the pre-13-1 pattern
 * doesn't trip the Case 2 negative-guard regex. Story 12-2 P12 lesson.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const TRANSCRIPT_VIEW_CODE_ONLY = stripComments(TRANSCRIPT_VIEW_SOURCE);

describe("TranscriptView extraData ref-stable — Story 13-1 source drift detector", () => {
  it("Case 1: POSITIVE — `extraData={transcript.length}` shape is present (post-13-1 form)", () => {
    // The ref-stable extraData is the load-bearing fix for the FlatList
    // virtualization invalidation half of audit P2-3. The post-13-1 shape
    // is a bare member-expression — no template literal, no isAiSpeaking
    // suffix.
    expect(TRANSCRIPT_VIEW_CODE_ONLY).toMatch(/extraData=\{\s*transcript\.length\s*\}/);
  });

  it("Case 2: NEGATIVE — pre-13-1 `${transcript.length}-${isAiSpeaking}` shape is GONE", () => {
    // The pre-13-1 condensed branch produced a template string that flipped
    // every time the AI started/stopped speaking, invalidating FlatList
    // virtualization. Whitespace-tolerant negative guard so a Prettier
    // reformat can't accidentally re-introduce the pattern.
    expect(TRANSCRIPT_VIEW_CODE_ONLY).not.toMatch(
      /extraData=\{[^}]*\$\{\s*transcript\.length\s*\}-\$\{\s*isAiSpeaking\s*\}/
    );
    // Belt-and-suspenders — also reject the alternative ordering.
    expect(TRANSCRIPT_VIEW_CODE_ONLY).not.toMatch(
      /extraData=\{[^}]*\$\{\s*isAiSpeaking\s*\}-\$\{\s*transcript\.length\s*\}/
    );
  });

  it("Case 3: POSITIVE — `isAiSpeakingRef.current` is read at render-time (Story 12-1 invariant)", () => {
    // The renderItem closure relies on `isAiSpeakingRef.current` for the
    // side-note correction gating (lines 318-324 pre-13-1). Pulling
    // `isAiSpeaking` out of `extraData` is only safe if the closure still
    // has a render-time access path to the flag. This guard catches a
    // future refactor that drops the ref read AND extraData simultaneously
    // (which would break the gating silently — corrections would stick on
    // the wrong row).
    expect(TRANSCRIPT_VIEW_CODE_ONLY).toMatch(/isAiSpeakingRef\.current/);
  });
});
