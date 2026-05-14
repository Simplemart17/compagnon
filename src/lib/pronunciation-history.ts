/**
 * Pronunciation history FIFO cap (Story 12-12) — closes audit P2-22.
 *
 * The 4th iteration of the project's bounded-budget cap pattern:
 *
 * | Story | Cap | Module |
 * | ----- | --- | ------ |
 * | 9-4 | `MAX_MEMORY_CHARS = 300` | `src/lib/memory.ts` |
 * | 11-7 | `MAX_PROMPT_MEMORIES = 3` / `MAX_PROMPT_ITEM_CHARS = 80` | `src/lib/prompts/conversation.ts` |
 * | 12-6 | `MAX_TRANSCRIPT_ENTRIES = 200` | `src/lib/transcript-cap.ts` |
 * | **12-12** | **`MAX_PRONUNCIATION_HISTORY = 50`** | **this file** |
 *
 * Each follows the same structural pattern: single MAX constant + pure-helper
 * FIFO append-with-cap + drift-pinned at the consumer's insertion site.
 *
 * Pre-12-12 the `useState`-managed `history: PronunciationResult[]` in
 * `useState` (Story P2-22 reference: `use-pronunciation.ts:79-88`) grew
 * unbounded via `[...prev.history, result]` spread inside the `setState`
 * updater. `identifyWeakSounds(newHistory)` then ran O(N × W × P) over the
 * entire history on every assessment-completion. Post-12-12 the array is
 * bounded at 50 entries by construction, which makes the triple-nested
 * scan bounded at ~50 × 10 × 5 = ~2,500 iterations per call (microsecond
 * cost). No `useMemo` wrapper is required because the aggregate is already
 * computed only inside the `setState` updater (not on every render).
 */
import type { PronunciationResult } from "./pronunciation";

/**
 * FIFO cap on the in-memory `usePronunciation` `state.history` array.
 *
 * 50 is the sweet spot across three trade-offs:
 *   - **Memory bound:** 50 × ~500 bytes = ~25 KB max (acceptable on mobile).
 *   - **Compute bound:** `identifyWeakSounds(history)` becomes 50 × ~10 × ~5
 *     ≈ 2,500 iterations per call — microsecond cost.
 *   - **Diagnostic signal:** `identifyWeakSounds` filters phonemes with
 *     `count >= 3 && avgScore < 70`. A 50-entry history easily surfaces
 *     5-15 weak-phoneme candidates — sufficient for the "top phonemes
 *     you need to work on" UI surface.
 *
 * To change: edit this constant + update the Jest drift detector +
 * helper unit tests + the JSDoc rationale above.
 *
 * Pattern mirrors Story 12-6 `MAX_TRANSCRIPT_ENTRIES = 200` (chosen as
 * "well above typical-session usage but well below pathological-session
 * memory cliff").
 */
export const MAX_PRONUNCIATION_HISTORY = 50;

/**
 * Append a new pronunciation assessment result to the in-memory history
 * with FIFO eviction past the cap. Closes audit P2-22.
 *
 * Semantics (mirrors Story 12-6 `applyTranscriptCap` pattern):
 *   - Always returns a NEW array — never mutates the input + always
 *     produces a fresh reference so React's `Object.is` setState
 *     short-circuit doesn't false-skip the re-render.
 *   - At-or-below cap: appended entry at tail; no eviction.
 *   - Past cap: oldest `N - MAX` entries dropped from the head; new
 *     entry always preserved at tail. Cap-then-evict sequencing — the
 *     just-appended entry is NEVER evicted in the same operation.
 *   - Defensive: if the input is OVER-cap (a future caller bypassing
 *     this helper), the result is correctly truncated to
 *     `MAX_PRONUNCIATION_HISTORY` length.
 *
 * @param prevHistory The existing history array (any length).
 * @param newResult The just-completed `PronunciationResult` to append.
 * @returns A new array of length
 *   `min(prevHistory.length + 1, MAX_PRONUNCIATION_HISTORY)`.
 */
export function appendCappedHistory(
  prevHistory: PronunciationResult[],
  newResult: PronunciationResult
): PronunciationResult[] {
  // Review-round-1 L1 patch: slice-BEFORE-append for bounded allocation
  // regardless of input size. Pre-patch the helper always spread `prevHistory`
  // into a temporary `appended` array first (creating an N+1-element
  // intermediate in memory) before slicing down to MAX. For the defensive
  // over-cap branch documented in JSDoc (input length ≫ MAX — e.g., a
  // future caller bypassing this helper), the pre-patch implementation
  // built a 5,001-element array before slicing down to 50 — the exact
  // memory pathology the cap is meant to prevent. Post-patch the slice
  // runs FIRST when needed, so the allocation is at most MAX + 1 elements
  // regardless of input size.
  //
  // `.slice` returns a new array — input is never mutated either way.
  if (prevHistory.length >= MAX_PRONUNCIATION_HISTORY) {
    // FIFO: drop the oldest entries from the head; preserve insertion order.
    // After slicing, append the new result at tail — bounded at exactly
    // MAX entries (the slice grabs the trailing MAX-1, then +1 new entry
    // = MAX total).
    return [...prevHistory.slice(prevHistory.length - MAX_PRONUNCIATION_HISTORY + 1), newResult];
  }
  // At-or-below cap: simple append; result length stays ≤ MAX.
  return [...prevHistory, newResult];
}
