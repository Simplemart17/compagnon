# Story 12.12: Pronunciation History FIFO Cap at 50 Entries — Bounded Memory + Bounded `identifyWeakSounds` Compute

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose audit finding **P2-22** at [`shippable-roadmap.md` line 100](_bmad-output/planning-artifacts/shippable-roadmap.md) names the bug exactly: `"Pronunciation history grows unbounded in memory; identifyWeakSounds runs over whole history on every call — src/hooks/use-pronunciation.ts:79-88 — mobile, performance"`, AND whose current [`src/hooks/use-pronunciation.ts:78-89`](src/hooks/use-pronunciation.ts#L78-L89) `finishAssessment` AND [`:116-127`](src/hooks/use-pronunciation.ts#L116-L127) `assessFromUri` both append the new `PronunciationResult` to `state.history` via `setState((prev) => { const newHistory = [...prev.history, result]; const weakSounds = identifyWeakSounds(newHistory); return {...prev, history: newHistory, weakSounds}; })` — i.e., the `history: PronunciationResult[]` array is **unbounded** (no FIFO cap; no MAX) AND each `PronunciationResult` carries a `words: WordResult[]` with per-word `phonemes: PhonemeScore[]` payload (a single sentence-length pronunciation assessment can carry 10-15 words × 5-10 phonemes = 50-150 phoneme entries, each with `phoneme`, `accuracyScore`, plus metadata; ~150-500 bytes per result; a power-user doing 200 assessments per session burns ~30-100KB of pure history memory plus React reconciliation overhead on every setState that touches `state.history`), AND `identifyWeakSounds(newHistory)` at [`src/lib/pronunciation.ts:133-158`](src/lib/pronunciation.ts#L133-L158) is a **triple-nested O(N × W × P)** scan over the ENTIRE history on every append — for the 200-assessment power-user pathway that's ~200 × 10 × 5 = 10,000 iterations per assessment-completion, growing monotonically as `N` grows; not catastrophic in absolute terms (the iterations are arithmetic-only — no I/O, no async, ~1ms on a modern phone CPU) but the unbounded growth is the architectural problem the audit names, AND the cross-story pattern — Story 12-6 capped the realtime `transcript` array at `MAX_TRANSCRIPT_ENTRIES = 200` FIFO with a `spilledMessages` DB-payload spill buffer, Story 11-7 capped prompt-injection memories at `MAX_PROMPT_MEMORIES = 3` / error patterns at `MAX_PROMPT_ERROR_PATTERNS = 3` / per-item char-truncate at `MAX_PROMPT_ITEM_CHARS = 80`, Story 9-4 capped memory content at `MAX_MEMORY_CHARS = 300` — bounded-budget caps via single-MAX-constant + pure-helper-extracted FIFO append are a project-wide discipline pattern that Story 12-12 follows, AND the spec's "memoize `identifyWeakSounds`" half of the deliverable is **already substantially satisfied** by the current implementation: the `weakSounds` aggregate is computed ONLY inside the `setState` updater that fires on assessment completion — NOT on every render — so the compute is naturally "memoized to insert events" without any `useMemo` machinery; **the load-bearing fix is the cap, not additional memoization**; once the history is capped at 50 entries, `identifyWeakSounds` becomes a 50 × 10 × 5 = 2,500-iteration computation that's microsecond-cheap and structurally bounded by definition; the existing pure function at [`src/lib/pronunciation.ts:133-158`](src/lib/pronunciation.ts#L133-L158) needs no changes (sufficient for the post-cap workload), AND none of the existing CI gates catch the unbounded-history regression today (no test asserts `history.length <= MAX`; no test exercises the 200-assessment power-user pathway), AND Story 12-6's `transcript-cap.ts` module establishes the pure-helper + Jest-test precedent (FIFO append + max-cap + drift detector reading the consumer's source) that Story 12-12 mirrors structurally.

I want (a) **a new pure helper module `src/lib/pronunciation-history.ts`** (~80 lines including JSDoc) exporting: (i) `MAX_PRONUNCIATION_HISTORY = 50` constant — the FIFO cap on the in-memory `state.history` array; 50 chosen because it covers a long power-user session (each assessment surfaces 5-15 phonemes of weak-sound feedback; 50 × 15 = 750 phoneme data points is more than enough signal for the `identifyWeakSounds` heuristic; beyond 50 the marginal diagnostic value falls off rapidly while memory grows linearly; mirrors Story 12-6's `MAX_TRANSCRIPT_ENTRIES = 200` selection methodology of "pick a number well above typical-session usage but well below pathological-session memory cliff"); (ii) `appendCappedHistory(prevHistory, newResult): PronunciationResult[]` pure FIFO append-then-cap helper that returns a new array of length `Math.min(prevHistory.length + 1, MAX_PRONUNCIATION_HISTORY)` — the just-appended entry is NEVER evicted in the same operation (cap-then-evict sequencing matches Story 12-6's `applyTranscriptCap` pattern); always returns a NEW array so React reference-equality optimizations trigger correctly; never mutates the input; (iii) `appendCappedHistory` is the SINGLE write point — both `finishAssessment` and `assessFromUri` route through it; (b) **refactor `src/hooks/use-pronunciation.ts`** — update the two `setState` updater blocks at lines 79-89 (`finishAssessment`) and 117-127 (`assessFromUri`) to call `appendCappedHistory(prev.history, result)` instead of the inline `[...prev.history, result]` spread; the rest of each updater (computing `weakSounds = identifyWeakSounds(newHistory)`, setting `isAssessing: false`, etc.) is preserved verbatim because `identifyWeakSounds` is already structurally memoized to insert-events (not render-events), and post-cap its compute cost is bounded at ~2500 iterations; the import line is extended to bring in `appendCappedHistory` from `@/src/lib/pronunciation-history`; (c) **NO change to `src/lib/pronunciation.ts`** — `identifyWeakSounds` at line 133-158 stays verbatim because it's already a pure function operating on the array passed in; with the cap the workload is bounded by definition, no memoization wrapper needed (the spec's "memoize" half is satisfied by the current "only computes inside setState, not on every render" architectural property — verified by reading the hook); (d) **NEW Jest unit tests** in `src/lib/__tests__/pronunciation-history.test.ts` (~10 cases) covering: (i) `MAX_PRONUNCIATION_HISTORY === 50` constant pin (drift-catches sloppy edits); (ii) `appendCappedHistory([], result)` returns `[result]` (single-element case); (iii) `appendCappedHistory(historyOf49, result)` returns array of length 50 (one-below-cap → at-cap boundary, no eviction); (iv) `appendCappedHistory(historyOf50, result)` returns array of length 50 with the OLDEST entry evicted and the new entry at the END (at-cap → at-cap FIFO eviction); (v) `appendCappedHistory(historyOf50, result)` always returns a NEW array (reference inequality `result !== prev.history`) so React's `Object.is` setState short-circuit doesn't false-skip the re-render; (vi) `appendCappedHistory` does NOT mutate the input (post-call `prevHistory.length === 50`); (vii) `appendCappedHistory(historyOf60, result)` (pathological: input is OVER-cap) correctly truncates to 50 with FIFO eviction of the oldest 11 (defensive against a future caller bypassing the helper); (viii) the just-appended entry is NEVER evicted in the same operation (insertion-order preserved); (ix) the order of remaining entries is preserved (no shuffle); (x) `appendCappedHistory(historyOf50, result).at(-1) === result` (the last element is always the appended result); (e) **NEW Jest drift detector** in `src/lib/__tests__/pronunciation-history-source-drift.test.ts` (~5 cases) reads `src/hooks/use-pronunciation.ts` from disk + comment-strips per Story 12-2 P12 lesson + asserts: (i) Case 1 — imports `appendCappedHistory` from `@/src/lib/pronunciation-history`; (ii) Case 2 — POSITIVE: contains `appendCappedHistory(prev.history, result)` (or with whitespace tolerance) at TWO call sites (covers both `finishAssessment` and `assessFromUri`); (iii) Case 3 — NEGATIVE: does NOT contain the pre-12-12 `[...prev.history, result]` spread pattern (catches a regression that re-introduces the unbounded append); (iv) Case 4 — `identifyWeakSounds(newHistory)` call is preserved (regression catches accidental deletion of the aggregate computation); (v) Case 5 — the imports block contains `import { appendCappedHistory, MAX_PRONUNCIATION_HISTORY } from "@/src/lib/pronunciation-history"` OR equivalent (per-import line tolerance); (f) **NO new packages, no migrations, no Edge Function changes** — `src/hooks/use-pronunciation.ts` is the only consumer; `src/lib/pronunciation.ts` is zero-diff; (g) **CLAUDE.md architecture paragraph** added after the Story 12-11 entry documenting: the new `pronunciation-history.ts` module + the 50-entry FIFO cap + the no-memoization-needed-post-cap rationale + cross-story zero-product-code-side-effects + closed P2-22 + Epic 12 completion (12-12 is the LAST Epic-12 story — Epic 12 retro is next); (h) **NO new operator runbook** — there's no operator-actionable knob here (the cap is a code-level constant; changing it requires a code-edit, not a dashboard-config decision); the rationale + the 50-value justification lives in the JSDoc on `MAX_PRONUNCIATION_HISTORY` so future operators reading the code understand the choice; (i) **`SENTRY_EXTRAS_ALLOWLIST` zero-diff** — no new feature tags or extras keys; the cap is a pure in-memory bounded-data-structure, not a telemetry concern; (j) **client-side surface unchanged** — `usePronunciation` returns the same shape (`state.history` still surfaces, just bounded at 50); consumers of the hook (the `practice/pronunciation` screen + any other call sites) see no API change.

so that **audit finding P2-22 closes architecturally** — the `history` array is structurally incapable of growing past 50 entries; `identifyWeakSounds` compute is bounded at ~2500 iterations per call by construction; **memory footprint is bounded** — at 50 × ~500 bytes = ~25KB max (vs. the pre-12-12 monotonic growth across long sessions); **the project's bounded-budget discipline pattern extends to one more surface** — Story 12-12 mirrors Story 12-6's transcript-cap + Story 11-7's prompt-truncation + Story 9-4's memory-content-cap pattern; **the cap is drift-pinned at two layers** — the Jest unit tests assert helper-level invariants (FIFO, eviction-of-oldest, never-evict-just-appended, no-input-mutation), the source-drift detector asserts hook-level integration (call sites preserved, leak-pattern absent); **`identifyWeakSounds` does NOT need a memoization wrapper** — the spec's "memoize" suggestion is satisfied by the existing architectural property that the aggregate is computed ONLY inside the setState updater (not on every render), and post-cap the compute is microsecond-cheap by definition; **the spec's deliverable wording is honored without over-engineering** — adding a `useMemo` keyed on `history.length` would be measurable-effect-zero noise that the patch round 12-12 wisely avoids; **Story 12-12 is the LAST Epic-12 story** — closes the final P2 audit finding in Epic 12 (P2-22); Epic 12 retrospective is next; **the cap value of 50 is a discrete operator decision** documented in the JSDoc on `MAX_PRONUNCIATION_HISTORY` — a future story can lower (more conservative) or raise (more diagnostic budget) by a single-line code change without touching consumer code; **Story 12-12 closes 1 audit finding (P2-22) as a SMALL discrete story** — 1 new lib + 1 modified hook + 2 new test files + 1 modified CLAUDE.md paragraph + 1 modified sprint-status.yaml + 1 new story file = 7 files total; total diff < 400 lines; zero client-API change; zero new packages; zero migrations.

## Background — Why This Story Exists

### What audit finding P2-22 owns to this story

[`shippable-roadmap.md` line 100](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P2-22 — Pronunciation history grows unbounded in memory; `identifyWeakSounds` runs over whole history on every call — `src/hooks/use-pronunciation.ts:79-88` — mobile, performance"

Epic 12.12 deliverable at [`shippable-roadmap.md` line 215](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "12.12 Cap pronunciation history; memoize `identifyWeakSounds`. **Covers P2-22.**"

### Current state — the unbounded-growth path

Pre-12-12 [`src/hooks/use-pronunciation.ts:78-89`](src/hooks/use-pronunciation.ts#L78-L89) (`finishAssessment`):

```typescript
// Use functional updater to avoid stale closure over state.history
setState((prev) => {
  const newHistory = [...prev.history, result];     // ← UNBOUNDED APPEND
  const weakSounds = identifyWeakSounds(newHistory); // ← O(N × W × P) scan over EVERY entry
  return {
    ...prev,
    isAssessing: false,
    result,
    history: newHistory,
    weakSounds,
  };
});
```

Same pattern at [`:116-127`](src/hooks/use-pronunciation.ts#L116-L127) (`assessFromUri`).

`identifyWeakSounds` at [`src/lib/pronunciation.ts:133-158`](src/lib/pronunciation.ts#L133-L158):

```typescript
export function identifyWeakSounds(
  results: PronunciationResult[]
): { phoneme: string; avgScore: number; count: number }[] {
  const phonemeStats: Record<string, { total: number; count: number }> = {};

  for (const result of results) {       // ← O(N) — outer loop over history
    for (const word of result.words) {   // ← O(W) — middle loop over words
      for (const phoneme of word.phonemes) {  // ← O(P) — inner loop over phonemes
        // ... aggregation ...
      }
    }
  }
  // ... return weak phonemes sorted by avgScore ...
}
```

Triple-nested O(N × W × P) where N grows monotonically with session length.

### Worst-case memory math

| Session length | N entries | Bytes per entry | Total history bytes |
| --- | --- | --- | --- |
| Typical session (10 assessments) | 10 | ~500 | ~5 KB |
| Long session (50 assessments) | 50 | ~500 | ~25 KB |
| Power-user session (200 assessments) | 200 | ~500 | ~100 KB |
| Pathological all-day session (1000 assessments) | 1000 | ~500 | ~500 KB |

Post-12-12 cap at 50: bounded at ~25 KB regardless of session length.

### Worst-case compute math (`identifyWeakSounds`)

| Session length | Iterations per call (N × 10 × 5) |
| --- | --- |
| 10 assessments | ~500 ops (microsecond cost) |
| 50 assessments | ~2,500 ops (microsecond cost) |
| 200 assessments | ~10,000 ops (~1ms on mobile CPU) |
| 1000 assessments | ~50,000 ops (~5-10ms on mobile CPU; noticeable lag on slower devices) |

Post-12-12 cap at 50: bounded at ~2,500 ops per call by construction.

### Why no `useMemo` for `identifyWeakSounds`?

The spec deliverable says "memoize `identifyWeakSounds`". A literal read suggests wrapping the call in `useMemo`. Let me check whether that's actually needed.

Look at the call sites: `identifyWeakSounds(newHistory)` runs **inside the `setState` functional updater** at [`use-pronunciation.ts:81`](src/hooks/use-pronunciation.ts#L81) and [`:119`](src/hooks/use-pronunciation.ts#L119). The updater fires ONLY on assessment-completion (post-await of `assessPronunciation`). It does NOT run on every render.

So the compute is already structurally "memoized to insert-events" — not "memoized to render-events". The architectural property holds without any `useMemo` machinery.

If a future component were to compute `identifyWeakSounds(history)` inside its render path (which doesn't exist today), a `useMemo` wrapper would help. But that's a future-story concern, not a 12-12 concern.

**Post-cap, the compute is bounded at ~2,500 ops per call — microsecond-cheap by construction.** Adding a `useMemo` wrapper would be measurable-effect-zero noise. The spec's "memoize" suggestion is satisfied architecturally; the cap is the load-bearing fix.

### Why 50 as the cap value?

Picking the cap value involves three trade-offs:

1. **Memory bound** — 50 × 500 bytes = ~25 KB. Acceptable for a mobile in-memory data structure.
2. **`identifyWeakSounds` compute bound** — 50 × 10 × 5 = 2,500 ops per call. Microsecond cost.
3. **Diagnostic signal** — `identifyWeakSounds` filters phonemes with `count >= 3` AND `avgScore < 70`. A 50-entry history easily surfaces 5-15 candidate weak sounds (each phoneme appears in multiple words across multiple assessments), which is the right N for a "top 10 phonemes you need to work on" UI surface.

Going lower (20-30) reduces memory further but degrades diagnostic signal — fewer phonemes meet the `count >= 3` threshold. Going higher (100-200) maintains diagnostic signal at the cost of bounded-but-still-larger memory.

**50 is the sweet spot** matching Story 12-6's `MAX_TRANSCRIPT_ENTRIES = 200` methodology — well above typical-session usage (10), well below pathological-session memory cliff (1000), tuned for the specific diagnostic surface this data structure feeds.

### Cross-story pattern — bounded-budget caps

Story 12-12 is the 4th iteration of the project's bounded-budget cap pattern:

| Story | Cap | Constant | Module |
| --- | --- | --- | --- |
| 9-4 | Memory content chars | `MAX_MEMORY_CHARS = 300` | `src/lib/memory.ts` |
| 11-7 | Prompt memories | `MAX_PROMPT_MEMORIES = 3` | `src/lib/prompts/conversation.ts` |
| 11-7 | Prompt error patterns | `MAX_PROMPT_ERROR_PATTERNS = 3` | same |
| 11-7 | Per-item prompt chars | `MAX_PROMPT_ITEM_CHARS = 80` | same |
| 12-6 | Realtime transcript entries | `MAX_TRANSCRIPT_ENTRIES = 200` | `src/lib/transcript-cap.ts` |
| 12-6 | Spilled DB-payload high-water | `SPILLED_MESSAGES_HIGH_WATER_MARK = 1000` | same |
| **12-12** | **Pronunciation history entries** | **`MAX_PRONUNCIATION_HISTORY = 50`** | **`src/lib/pronunciation-history.ts`** |

Each follows the same structural pattern: single MAX constant + pure-helper append-with-cap + drift-pinned at insertion site.

### Spec — `pronunciation-history.ts` shape

```typescript
import type { PronunciationResult } from "./pronunciation";

/**
 * FIFO cap on the in-memory `usePronunciation` `state.history` array
 * (Story 12-12). Picks 50 entries as the sweet spot between:
 *   - Memory bound: 50 × ~500 bytes = ~25 KB (acceptable mobile).
 *   - Compute bound: `identifyWeakSounds(history)` becomes 50 × 10 × 5
 *     ≈ 2,500 iterations per call (microsecond cost).
 *   - Diagnostic signal: 50 entries surface ≥ 5-15 weak phonemes via the
 *     `count >= 3 && avgScore < 70` filter — sufficient for the
 *     "top phonemes you need to work on" UI surface.
 *
 * To change: edit this constant + update the Jest drift detector.
 * Pattern mirrors Story 12-6 `MAX_TRANSCRIPT_ENTRIES = 200`.
 */
export const MAX_PRONUNCIATION_HISTORY = 50;

/**
 * Append a new pronunciation assessment result to the in-memory history
 * with FIFO eviction past the cap. Closes audit P2-22 by ensuring the
 * history is structurally incapable of unbounded growth.
 *
 * Semantics:
 *   - Always returns a NEW array (React reference-equality friendly).
 *   - Never mutates the input.
 *   - At-or-below cap: appended entry at tail; no eviction.
 *   - Past cap: oldest N - MAX entries dropped from the head; new entry
 *     always preserved at tail. Cap-then-evict sequencing (Story 12-6
 *     pattern).
 *   - Defensive: if input is OVER-cap (a future caller bypassing this
 *     helper), the result is correctly truncated to `MAX_PRONUNCIATION_HISTORY`.
 *
 * @param prevHistory The existing history array (any length).
 * @param newResult The just-completed PronunciationResult to append.
 * @returns A new array of length min(prevHistory.length + 1, MAX_PRONUNCIATION_HISTORY).
 */
export function appendCappedHistory(
  prevHistory: PronunciationResult[],
  newResult: PronunciationResult
): PronunciationResult[] {
  const appended = [...prevHistory, newResult];
  if (appended.length <= MAX_PRONUNCIATION_HISTORY) return appended;
  // FIFO: drop the oldest entries from the head; preserve insertion order.
  return appended.slice(appended.length - MAX_PRONUNCIATION_HISTORY);
}
```

### Spec — `use-pronunciation.ts` modifications

```diff
+ import { appendCappedHistory } from "@/src/lib/pronunciation-history";

  // finishAssessment (line 78-89):
  setState((prev) => {
-   const newHistory = [...prev.history, result];
+   const newHistory = appendCappedHistory(prev.history, result);
    const weakSounds = identifyWeakSounds(newHistory);
    return {
      ...prev,
      isAssessing: false,
      result,
      history: newHistory,
      weakSounds,
    };
  });

  // assessFromUri (line 117-127) — identical change:
  setState((prev) => {
-   const newHistory = [...prev.history, result];
+   const newHistory = appendCappedHistory(prev.history, result);
    const weakSounds = identifyWeakSounds(newHistory);
    return {
      ...prev,
      isAssessing: false,
      result,
      history: newHistory,
      weakSounds,
    };
  });
```

## Acceptance Criteria

1. **Helper module exists.** [`src/lib/pronunciation-history.ts`](src/lib/pronunciation-history.ts) is created with `MAX_PRONUNCIATION_HISTORY = 50` constant + `appendCappedHistory(prevHistory, newResult): PronunciationResult[]` pure helper matching the deliverable (a) semantics. JSDoc explains the cap-value rationale + the 3-trade-off framework + the Story 12-6 cross-reference.

2. **`use-pronunciation.ts` hook refactored.** Both `setState` updater blocks (lines 79-89 and 117-127 pre-12-12) now call `appendCappedHistory(prev.history, result)` instead of `[...prev.history, result]`. The import line is extended to bring in `appendCappedHistory` (and `MAX_PRONUNCIATION_HISTORY` if needed for tests). The rest of each updater (`identifyWeakSounds` call, `setState` return shape) is preserved verbatim.

3. **Helper unit tests pass.** [`src/lib/__tests__/pronunciation-history.test.ts`](src/lib/__tests__/pronunciation-history.test.ts) covers ≥ 10 cases as enumerated in deliverable (d): constant pin / empty / 49→50 boundary / 50→50 FIFO eviction / new-array reference inequality / no-input-mutation / over-cap defensive truncation / never-evict-just-appended / insertion-order-preserved / last-element-is-appended.

4. **Source-drift detector pass.** [`src/lib/__tests__/pronunciation-history-source-drift.test.ts`](src/lib/__tests__/pronunciation-history-source-drift.test.ts) covers ≥ 5 cases reading `src/hooks/use-pronunciation.ts` from disk: imports `appendCappedHistory` + positive guard `appendCappedHistory(prev.history, result)` appears TWICE + NEGATIVE no pre-12-12 `[...prev.history, result]` spread pattern + `identifyWeakSounds(newHistory)` call preserved + import line shape.

5. **Zero behavioral change for short sessions.** Sessions ≤ 50 assessments behave identically pre- and post-12-12 (the cap doesn't trigger). Verified by helper test case (iii) — at-the-boundary behavior matches pre-12-12.

6. **Bounded memory + bounded compute for long sessions.** Sessions > 50 assessments cannot exceed 50 entries in `state.history`. `identifyWeakSounds` runs over at most 50 × ~10 × ~5 = ~2,500 entries per call. Verified by helper test cases (iv) and (vii) — the over-cap and at-cap cases produce arrays of length exactly 50.

7. **`identifyWeakSounds` does NOT need a `useMemo` wrapper.** [`src/lib/pronunciation.ts`](src/lib/pronunciation.ts) is zero-diff. The function is already computed inside the setState updater (not on every render); post-cap its workload is bounded at ~2500 iterations. The spec's "memoize" deliverable is satisfied architecturally without additional code.

8. **Quality gates green.** `npm run type-check && npm run lint && npm run format:check && npx jest` all pass. Total Jest case count rises by ≈ 15 (10 helper + 5 drift detector).

9. **CLAUDE.md architecture paragraph added** after the Story 12-11 entry documenting: the new module + the 50-entry FIFO cap + the no-`useMemo`-needed-post-cap rationale + cross-story bounded-budget pattern reference + closed P2-22 + Epic 12 completion note.

10. **Zero client-API change.** `usePronunciation` returns the same shape (`UsePronunciationReturn`). The `practice/pronunciation` screen + any future consumers see no breaking change.

11. **No new packages, no migrations, no Edge Function changes.** `package.json` + `package-lock.json` + `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` all zero-diff.

12. **Cross-story invariants preserved.**
    - Story 9-3 Sentry allowlist zero-diff.
    - Story 9-4 / 11-7 / 12-6 bounded-budget cap pattern extended (consistent with the project-wide discipline).
    - Stories 12-1 through 12-11: orthogonal; zero product-code other-surface change.

13. **Sprint-status flipped.** `12-12-pronunciation-history-cap` transitions `backlog → ready-for-dev → in-progress → review` over the implementation cycle. Epic 12 progress noted: 12-12 is the FINAL Epic-12 story; Epic 12 retro is the next workflow step.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens — **N/A** (no UI in this story).
- [x] All loading states use skeleton animations — **N/A**.
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — **N/A**.
- [x] Non-obvious interactions have `accessibilityHint` — **N/A**.
- [x] Stateful elements have `accessibilityState` — **N/A**.
- [x] All tappable elements have minimum 44x44pt touch targets — **N/A**.
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — **N/A** (no new catch sites; the existing `captureError(err, "pronunciation-assessment")` in the hook is preserved).
- [x] All text uses `Typography.*` presets — **N/A**.
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npx jest`.

### Y. GitHub Actions Injection Vector Check

- [x] **N/A** — Story 12-12 modifies hook + library code only. No workflow files touched. `git diff main..HEAD -- .github/` MUST return empty.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-12-pronunciation-history-cap.md` passes.

## Tasks / Subtasks

- [x] **Task 1 — Create `src/lib/pronunciation-history.ts`** (AC: #1)
  - [x] Subtask 1.1: Add `MAX_PRONUNCIATION_HISTORY = 50` constant with JSDoc explaining the 3-trade-off framework (memory / compute / diagnostic signal).
  - [x] Subtask 1.2: Implement `appendCappedHistory(prevHistory, newResult): PronunciationResult[]` pure FIFO append-then-cap helper. Always returns a new array; never mutates input.
  - [x] Subtask 1.3: Add JSDoc cross-referencing the Story 12-6 pattern + the cap-value rationale.
  - [x] Subtask 1.4: Import `PronunciationResult` type from `./pronunciation` to satisfy TypeScript strict mode.

- [x] **Task 2 — Refactor `src/hooks/use-pronunciation.ts`** (AC: #2, #5, #6)
  - [x] Subtask 2.1: Add import for `appendCappedHistory` from `@/src/lib/pronunciation-history`.
  - [x] Subtask 2.2: Replace `const newHistory = [...prev.history, result]` at line 80 (`finishAssessment` setState updater) with `const newHistory = appendCappedHistory(prev.history, result)`.
  - [x] Subtask 2.3: Replace the same pattern at line 118 (`assessFromUri` setState updater).
  - [x] Subtask 2.4: Verify the rest of each setState updater is unchanged (`identifyWeakSounds(newHistory)` call, return shape).

- [x] **Task 3 — Add Jest helper unit tests** (AC: #3, #5, #6)
  - [x] Subtask 3.1: Create `src/lib/__tests__/pronunciation-history.test.ts`.
  - [x] Subtask 3.2: Case 1: `MAX_PRONUNCIATION_HISTORY === 50` constant pin.
  - [x] Subtask 3.3: Case 2: empty + 1 result → length 1.
  - [x] Subtask 3.4: Case 3: 49 + 1 → length 50 (boundary — no eviction at cap).
  - [x] Subtask 3.5: Case 4: 50 + 1 → length 50 with oldest evicted + new at tail.
  - [x] Subtask 3.6: Case 5: result is a NEW array reference (`!== prevHistory`).
  - [x] Subtask 3.7: Case 6: input is NOT mutated (post-call `prevHistory.length` unchanged).
  - [x] Subtask 3.8: Case 7: input over-cap (length 60) → output truncated to 50 with FIFO eviction.
  - [x] Subtask 3.9: Case 8: just-appended entry is NEVER evicted.
  - [x] Subtask 3.10: Case 9: insertion order preserved (entries appear in chronological append order).
  - [x] Subtask 3.11: Case 10: `.at(-1)` of result is always the appended entry.

- [x] **Task 4 — Add Jest source-drift detector** (AC: #4)
  - [x] Subtask 4.1: Create `src/lib/__tests__/pronunciation-history-source-drift.test.ts`.
  - [x] Subtask 4.2: Case 1: imports `appendCappedHistory` from `@/src/lib/pronunciation-history`.
  - [x] Subtask 4.3: Case 2: POSITIVE — `appendCappedHistory(prev.history, result)` appears TWICE (both setState updaters).
  - [x] Subtask 4.4: Case 3: NEGATIVE — no `[...prev.history, result]` spread pattern.
  - [x] Subtask 4.5: Case 4: `identifyWeakSounds(newHistory)` call preserved (catches accidental deletion).
  - [x] Subtask 4.6: Case 5: import line shape (whitespace-tolerant per Story 12-2 P12 lesson).

- [x] **Task 5 — Quality gates + CLAUDE.md + sprint-status** (AC: #8, #9, #12, #13)
  - [x] Subtask 5.1: Run `npm run type-check && npm run lint && npm run format:check && npx jest`. All exit 0.
  - [x] Subtask 5.2: Append Story 12-12 paragraph to `CLAUDE.md` after the Story 12-11 entry. Note: 12-12 is the FINAL Epic-12 story; Epic 12 retro is the next workflow step.
  - [x] Subtask 5.3: Update `sprint-status.yaml` header `last_updated` + flip `12-12` transition at dev-start.

## Dev Notes

### Branching guidance

Per project memory ([`feedback_branch_from_main`](../../../.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/feedback_branch_from_main.md)): branch `feature/12-12-pronunciation-history-cap` from `origin/main`. Do not stack on the prior story's in-flight branch.

### Project conventions to follow

- **Pure-helper extraction pattern** — mirrors Story 12-6's `src/lib/transcript-cap.ts` (FIFO append + max-cap + drift-pinned at consumer source).
- **Bounded-budget discipline** — Stories 9-4 / 11-7 / 12-6 / 12-12 all use the same pattern: single MAX constant + pure helper + Jest drift detector at insertion site.
- **TypeScript strict mode** — all new code passes `tsc --noEmit`.
- **Sentry contract (Story 9-3)** — no new allowlist keys; cap is a pure in-memory bounded-data-structure concern, not telemetry.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist zero-diff.
- Story 9-4 / 11-7 / 12-6 bounded-budget cap pattern extended consistently.
- Stories 12-1 through 12-11 orthogonal — no product-code-other-surface change.

### Known footguns (from prior story retros)

- **Story 12-6 lesson (cap-then-evict sequencing)**: the just-appended entry must NEVER be evicted in the same operation. The `appendCappedHistory` implementation handles this via "append then truncate" — the new entry is at index `length - 1` post-append, and `.slice(length - MAX)` preserves the tail. Pinned by Case 8.
- **Story 12-2 P12 lesson (drift detector comment-stripping)**: when the drift detector reads source from disk, comments may contain examples of the pre-12-12 pattern (e.g., `// pre-12-12 we used [...prev.history, result]`). Strip comments first so JSDoc doesn't trip the negative-guard regex.
- **React setState reference inequality**: the helper MUST always return a new array (never the input). React's setState short-circuits via `Object.is` — returning the same array reference would skip the re-render. Pinned by Case 5.
- **`useMemo` over-engineering**: don't add a `useMemo` wrapper for `identifyWeakSounds` post-cap — the compute is already structurally memoized to insert-events (not render-events), and post-cap the workload is microsecond-cheap by construction. The spec's "memoize" deliverable is satisfied architecturally.

### Project Structure Notes

| Path | Action | Rationale |
| --- | --- | --- |
| `src/lib/pronunciation-history.ts` | NEW | Pure helper module — single MAX constant + FIFO append-then-cap. |
| `src/hooks/use-pronunciation.ts` | MODIFY | Two setState updaters call `appendCappedHistory` instead of inline spread. |
| `src/lib/__tests__/pronunciation-history.test.ts` | NEW | 10 helper-contract Jest cases. |
| `src/lib/__tests__/pronunciation-history-source-drift.test.ts` | NEW | 5 drift-detector Jest cases. |
| `CLAUDE.md` | MODIFY | Architecture paragraph after Story 12-11 entry. Note: 12-12 is the FINAL Epic-12 story. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | MODIFY | `last_updated` + 12-12 status transitions. |
| `_bmad-output/implementation-artifacts/12-12-pronunciation-history-cap.md` | MODIFY | Status: ready-for-dev → in-progress → review during impl. |
| `src/lib/pronunciation.ts` | **NO CHANGE** | `identifyWeakSounds` stays verbatim — post-cap workload bounded by construction. |
| `package.json` / `package-lock.json` | **NO CHANGE** | No new deps. |
| `app/`, `src/components/`, `src/store/`, `src/types/` | **NO CHANGE** | Zero client-app-surface diff. |
| `supabase/migrations/`, `supabase/functions/` | **NO CHANGE** | Pronunciation history is client-side only. |
| `.github/workflows/` | **NO CHANGE** | No CI gate changes. |

### References

- [Source: shippable-roadmap.md#100 — P2-22 audit finding]
- [Source: shippable-roadmap.md#215 — Epic 12.12 deliverable]
- [Source: src/hooks/use-pronunciation.ts:78-89 + :116-127 — current unbounded-append setState updaters]
- [Source: src/lib/pronunciation.ts:133-158 — `identifyWeakSounds` triple-nested aggregator (zero-diff)]
- [Source: src/lib/transcript-cap.ts — Story 12-6 pure-helper precedent for cap pattern]
- [Source: src/lib/__tests__/transcript-cap.test.ts — Story 12-6 Jest test precedent]
- [Source: src/lib/prompts/conversation.ts — Story 11-7 MAX_PROMPT_MEMORIES / MAX_PROMPT_ITEM_CHARS precedent]
- [Source: src/lib/memory.ts — Story 9-4 MAX_MEMORY_CHARS precedent]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`; sprint-status flipped `backlog → ready-for-dev`.
- Implementation 2026-05-14 on branch `feature/12-12-pronunciation-history-cap` (branched from `main` post-12-11 PR #86 merge per project memory `feedback_branch_from_main`).
- TDD-ish cycle: helper written first → unit tests (10 cases) GREEN → hook refactored → drift detector GREEN → quality gates all green.
- No defensive code paths needed beyond the spec — the `appendCappedHistory` helper is a pure 6-line function (`[...append] + slice if over cap`), and the over-cap defensive case (input length > MAX) is handled naturally by the same `.slice()` logic.

### Completion Notes List

- **Task 1 done.** [`src/lib/pronunciation-history.ts`](src/lib/pronunciation-history.ts) (~75 lines including JSDoc) created with `MAX_PRONUNCIATION_HISTORY = 50` constant + `appendCappedHistory(prevHistory, newResult)` pure FIFO append-then-cap helper. JSDoc explains the 3-trade-off framework (memory / compute / diagnostic signal) + cross-references Story 12-6's `MAX_TRANSCRIPT_ENTRIES = 200` precedent + Stories 9-4 + 11-7 in the bounded-budget cap pattern lineage.
- **Task 2 done.** [`src/hooks/use-pronunciation.ts`](src/hooks/use-pronunciation.ts) both `setState` updater blocks (line 85 in `finishAssessment` + line 127 in `assessFromUri`) refactored to route through `appendCappedHistory(prev.history, result)` instead of inline `[...prev.history, result]` spread. Import line at `:19` extended to bring in `appendCappedHistory` from `@/src/lib/pronunciation-history`. Rest of each updater (`identifyWeakSounds(newHistory)` call, return shape) preserved verbatim. JSDoc-style inline comment added at both sites explaining the Story 12-12 P2-22 closure rationale.
- **Task 3 done.** [`src/lib/__tests__/pronunciation-history.test.ts`](src/lib/__tests__/pronunciation-history.test.ts) created with **10/10 cases GREEN** matching deliverable (d) spec: constant pin / empty + 1 / 49 + 1 boundary / 50 + 1 FIFO eviction / new-array-reference inequality / no-input-mutation / over-cap defensive truncation / never-evict-just-appended / insertion-order preserved / `.at(-1)` always the appended.
- **Task 4 done.** [`src/lib/__tests__/pronunciation-history-source-drift.test.ts`](src/lib/__tests__/pronunciation-history-source-drift.test.ts) created with **5/5 cases GREEN**: import pin + POSITIVE `appendCappedHistory(prev.history, result)` appears TWICE + NEGATIVE no-pre-12-12-spread-pattern + `identifyWeakSounds(newHistory)` preserved at 2 sites + named-import shape. Comment-stripping applied per Story 12-2 P12 lesson.
- **Task 5 done.** All 4 quality gates green: `npx tsc --noEmit` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (clean post auto-format), `npx jest` (**1605/1605 passing**, +15 net 1590→1605 — matches spec target exactly). CLAUDE.md gained the Story 12-12 architecture paragraph after the Story 12-11 entry. The paragraph documents the load-bearing "cap is the fix, no `useMemo` needed" architectural property.
- **Cross-story invariants verified clean:** `git diff main..HEAD -- app/ src/components/ src/store/ src/types/ supabase/` returns empty. `src/lib/pronunciation.ts` zero-diff (`identifyWeakSounds` does NOT need a `useMemo` wrapper post-cap — the aggregate is already only computed inside setState, NOT on every render; post-cap workload is ~2,500 ops/call by construction). `package.json` + `package-lock.json` + `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` all zero-diff. `src/lib/sentry.ts` zero-diff (no allowlist changes).
- **Zero client-API change** — `usePronunciation` returns the same `UsePronunciationReturn` shape; `state.history` is still surfaced, just bounded at 50.
- **Closes audit P2-22** architecturally.
- **Epic 12 is COMPLETE — 12 of 12 stories done.** Story 12-12 is the FINAL Epic-12 story. Epic 12 retrospective is the next workflow step.

#### Review-round-1 patches (2026-05-14)

Adversarial 3-layer review surfaced 11 distinct findings after dedup. **Acceptance Auditor returned 0 findings — all 13 ACs structurally satisfied** (the cleanest review surface across Epic 12). Triage: **MED × 2 + LOW × 3 = 5 patches applied; 4 deferred; 1 rejected.**

- **M1** drift detector regex hardening — Cases 2 + 4 loosened to accept `\w+` for variable-name renames (`result` → `assessmentResult`); Cases 2 + 3 tolerate optional-chaining `prev?.history`; Case 3 gains a second negative guard `/prev\??\.history\.concat\s*\(/` for the alternative leak pattern. Pre-patch a benign rename OR a `.concat()`-based regression would slip through.
- **M2** new Case 11 — pins the cap × `identifyWeakSounds` interaction by driving 63 results where indices 0-2 carry a "ɑ̃" weak phoneme; asserts the capped trailing-50 view DROPS the weak phoneme from `identifyWeakSounds` output while the uncapped 63-entry view STILL flags it (count=3, avgScore=40). Future cap-value adjustments (50 → 30) re-evaluate this threshold deliberately.
- **L1** `appendCappedHistory` reordered to slice-BEFORE-append for bounded allocation regardless of input size. Pre-patch the defensive over-cap branch built a 5,001-element array before slicing to 50; post-patch allocation is bounded at exactly MAX elements.
- **L2** Case 6 (no-mutation test) upgraded to full-array snapshot via `[...prev]` + `toEqual(snapshot)` deep equality. Pre-patch only `prev.length` and `prev[0]` were checked — a future "optimization" mutating `prev[25]` would have passed silently.
- **L3** new Case 3b — isolates the at-cap (50→51) boundary so an off-by-one regression (`<` vs `<=` in the cap predicate) fails with a clear diagnostic instead of vacuously passing the broader Case 4.
- **Deferred (4):** D1 no runtime hook integration test (drift detector + helper unit tests cover the contract; full hook test is a future-story scope); D2 non-defensive against `null`/`undefined` input (TypeScript catches; runtime defensiveness adds noise); D3 drift detector Case 5 doesn't reject `import type` regression (TypeScript catches); D4 `WordScore.phonemes` empty-array Azure-data interaction (pre-existing, not 12-12 regression).
- **Rejected (1):** concurrent-assessments race — Edge Case Hunter analyzed, NOT A BUG (React's functional setState updaters pass the latest state to each successive updater).
- **+2 net Jest cases** (1605 → 1607): Case 11 (M2) + Case 3b (L3) added; Case 6 (L2) modified in place; M1 modified drift cases in place; L1 source change preserved existing test contract.
- All 4 quality gates green post-round-1.
- Verified 2026-05-14, story 12-12 (post-review-round-1 patches MED × 2 + LOW × 3).

### File List

**New files:**
- `src/lib/pronunciation-history.ts` — pure helper module (`MAX_PRONUNCIATION_HISTORY = 50` + `appendCappedHistory`).
- `src/lib/__tests__/pronunciation-history.test.ts` — 10 helper-contract Jest cases.
- `src/lib/__tests__/pronunciation-history-source-drift.test.ts` — 5 source-drift detector Jest cases.

**Modified files:**
- `src/hooks/use-pronunciation.ts` — both setState updaters route through `appendCappedHistory`; import line extended.
- `CLAUDE.md` — Story 12-12 architecture paragraph appended after Story 12-11 entry; notes Epic 12 completion.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 12-12 status `backlog → in-progress → review` + `last_updated` header.
- `_bmad-output/implementation-artifacts/12-12-pronunciation-history-cap.md` — Tasks/Subtasks checked + Dev Agent Record filled + Status: review.

**Explicitly NOT modified:**
- `src/lib/pronunciation.ts` — `identifyWeakSounds` stays verbatim (no `useMemo` wrapper needed post-cap; computed only inside setState).
- `app/`, `src/components/`, `src/store/`, `src/types/` — zero client-app-other-surface diff.
- `package.json`, `package-lock.json` — no new deps.
- `src/lib/sentry.ts` — no allowlist changes.
- `supabase/migrations/`, `supabase/functions/` — no schema or Edge Function changes.
- `.github/workflows/` — no CI changes.
