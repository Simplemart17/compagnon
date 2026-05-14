# Story 13.1: Transcript Render Storm Fix — `extraData` ref-stable + rAF-coalesced delta setState

Status: review

## Story

As a **voice conversation user on an older device (iPhone 11 / Pixel 5 / 3-year-old Android baseline)**,
I want **the transcript UI to remain at ≥ 55 FPS during AI streaming speech**,
so that **scrolling and tap interactions don't stutter while the AI is talking** and **my older device doesn't burn battery on wasted re-renders**.

## Background — Why This Story Exists

### What audit finding P2-3 owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 — `P2-3`:

> Transcript re-render storm during AI streaming — `setState` per audio chunk (~20ms cadence); FlatList `extraData` invalidates per AI speech state flip
> `src/hooks/use-realtime-voice.ts:279`, `src/components/conversation/TranscriptView.tsx:307` | performance

### Current state — the two storm sources

Two independent re-render multipliers compound during AI streaming speech:

**(1) Orchestrator setState cadence — the dominant storm.** Three setState sites in [`src/lib/realtime-orchestrator.ts`](src/lib/realtime-orchestrator.ts) `handleEvent`'s switch fire on EVERY audio delta during AI speech:

| Line  | Event                                          | setState payload                                          | Cadence per turn |
| ----- | ---------------------------------------------- | --------------------------------------------------------- | ---------------- |
| `875` | `response.output_audio.delta`                  | `{ ...s, isAiSpeaking: true, isProcessing: false }`       | ~50Hz (~20ms)    |
| `898` | `response.output_text.delta` (defensive)       | `{ ...s, pendingAiText: this.currentAiText }`             | 0 (modalities=audio) |
| `919` | `response.output_audio_transcript.delta`       | `{ ...s, pendingAiText: this.currentAiText }`             | ~50Hz (~20ms)    |

A 5-second AI utterance fires ~250 setState calls. Each setState propagates to React subscribers (Story 12-1 observer pattern) → parent component re-renders → TranscriptView consumes 3 changing props (`transcript`, `pendingAiText`, `isAiSpeaking`) → React reconciles the FlatList and footer. On a 3-year-old phone, the JS bridge + reconciliation + ScrollView measure pass at 50Hz drops frame rate well below 55 FPS during AI speech.

**(2) FlatList `extraData` invalidation per `isAiSpeaking` flip.** [`src/components/conversation/TranscriptView.tsx:362`](src/components/conversation/TranscriptView.tsx#L362):

```typescript
extraData={condensed ? `${transcript.length}-${isAiSpeaking}` : transcript.length}
```

The `condensed` form (used by the active-conversation screen) includes `isAiSpeaking` in the extraData key. The flag flips twice per turn (true on AI speech start, false on AI speech end). Each flip invalidates FlatList virtualization → all visible rows re-render via `renderItem`. For a 30-turn conversation = 60 extraData invalidations.

The `isAiSpeaking` was originally included so the `renderItem` closure could re-evaluate `showSideNoteCorrections` gating on the LATEST user message (lines 318-324). But the closure already reads `isAiSpeakingRef.current` (line 302) — a render-time ref that's been there since Story 12-1. The `isAiSpeaking` in the key is redundant if the FlatList re-renders for any reason that's caused by a state change (e.g., `pendingAiText` updating).

### Why fix both, not just one

The audit pairs them deliberately. If we fix only (1) and leave (2), each isAiSpeaking flip still invalidates rows. If we fix only (2) and leave (1), the 50Hz parent re-render still burns the JS thread on observer fan-out + prop comparison. Both fixes are mechanically simple; both ride on existing architectural patterns (Story 12-1 ref-stable mirrors + Story 12-6 bounded budget); both ship together.

### Why `requestAnimationFrame` for the throttle

In React Native, `requestAnimationFrame` is polyfilled by the bridge to roughly align with JS-thread frame ticks (~16.67ms at 60fps). Multiple `requestAnimationFrame` callbacks queued in the same frame coalesce — exactly the batching we want. Alternatives rejected:

- `setTimeout(0)`: 4ms minimum in browser, ~16ms in RN; no frame alignment; flushes earlier than the next render.
- `queueMicrotask`: runs at end of current task; can fire many times per frame (no batching).
- Throttle by elapsed-time (e.g., `if (Date.now() - lastUpdate < 33) return`): doesn't coalesce; just skips. Drops content the user wanted to see.

rAF gives us frame-aligned batching where every queued delta within a frame produces ONE setState, and the final delta of a burst always reaches subscribers on the next render. Pre-existing precedent in the codebase: [`src/hooks/use-debounce.ts`](src/hooks/use-debounce.ts) handles a different need (debounced derived value); the orchestrator's per-event batching is its own story.

### Cross-story invariants to preserve

The fix MUST NOT change any of:

- **Story 9-5 voice transcript dedup** — `acceptDelta` (`src/lib/realtime-transcript.ts`) is the dedup boundary; `this.currentAiText` is set from `result.state.pendingText` on every accepted delta. The throttle wraps the SETSTATE not the `acceptDelta` call.
- **Story 11-2 barge-in synchronous mirror** — `this.isAiSpeakingMirror = true` on line 874 fires BEFORE any setState; barge-in detection reads the mirror at event time, not via React state.
- **Story 11-2 review-round-2 P22** — `isAiSpeakingMirror` is synchronously updated inside `setState()` at line 396. The throttle path must still go through `setState()` so the mirror update fires.
- **Story 12-1 P6 re-entrant setState guard** — `this.isSetStating` flag at line 389 + pendingUpdates queue. The throttle's `requestAnimationFrame` callback runs OUTSIDE the original event handler, so the guard isn't engaged — but the rAF callback calls `setState()` normally, which re-engages the guard for any nested update.
- **Story 12-1 P7 isDisposed short-circuit** — `handleEvent` early-returns when `this.isDisposed === true`. The throttle introduces a new path where a queued rAF could fire AFTER dispose. **The fix must clear pending rAFs on dispose** (cancel via `cancelAnimationFrame`).
- **Story 12-6 transcript cap** — `MAX_TRANSCRIPT_ENTRIES = 200` + `applyTranscriptCap` is unchanged; the storm fix is upstream of cap application.
- **Story 12-12 pronunciation history cap** — orthogonal (different hook).
- **Story 9-3 telemetry allowlist** — no new `feature` tags / no new extras keys.
- **Realtime API behavior** — the throttle is purely client-side React state batching. No event sent/received changes timing.

### What gets faster, exactly

| Metric                                       | Pre-13-1                                  | Post-13-1                                          |
| -------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `setState` calls per 5-second AI utterance   | ~250 (≈50Hz × 2 paths)                    | ~30 (≈6Hz × 2 paths; rAF-coalesced)                |
| extraData invalidations per 30-turn session  | 60                                        | 0 (extraData ref-stable on transcript.length only) |
| Parent re-renders per AI utterance           | ~250                                      | ~30 (parent only re-renders on setState commit)    |
| isAiSpeakingMirror correctness               | sync per setState                         | sync per setState (unchanged)                      |
| Final pendingAiText reaches subscribers when | within ~20ms of last delta                | within ~16ms of last delta (next rAF tick)         |

The "final pendingAiText" latency is bounded by one frame (~16.67ms) — imperceptible. The `.done` events bypass the throttle so the transcript-finalization moment is never delayed.

### Sentry / client-side telemetry impact

Zero. No new `feature` tags. No new extras keys. The `SENTRY_EXTRAS_ALLOWLIST` (Story 9-3) is zero-diff.

## Acceptance Criteria

1. **`TranscriptView` `extraData` is `transcript.length` only** — drop the `${transcript.length}-${isAiSpeaking}` shape from the `condensed` branch. Both branches use `transcript.length`. The `isAiSpeakingRef` (line 302) is the render-time access path for the renderItem closure's correction gating (Story 12-1 ref-stable pattern). Pinned by drift detector.

2. **`response.output_audio.delta` setState is guarded** — the orchestrator's line 875 setState only fires if `this.state.isAiSpeaking === false` (i.e., on the FIRST delta of a turn). Subsequent deltas update `this.isAiSpeakingMirror` synchronously (already true) and skip the setState. Pinned by drift detector AND runtime test (100 synthetic deltas → 1 setState).

3. **Text-delta + audio-transcript-delta setStates are rAF-coalesced** — orchestrator lines 898 + 919 stop calling `setState` directly. Each delta updates `this.currentAiText` synchronously; if no rAF is pending, schedule one via `this.scheduleAiTextSetState()`. The rAF callback calls `setState({ ...s, pendingAiText: this.currentAiText })` once. Multiple deltas within a single frame coalesce. Pinned by drift detector AND runtime test (100 deltas across 50ms → ≤ 4 setState calls).

4. **`.done` events bypass the rAF throttle** — `response.output_audio.done`, `response.output_text.done`, `response.output_audio_transcript.done` and `response.done` paths fire setState immediately (no rAF). The pending rAF if any is cancelled at this point so the immediate setState is the authoritative final state.

5. **Pending rAF is cancelled on `dispose()`** — `RealtimeOrchestrator.dispose()` calls `cancelAnimationFrame(this.aiTextRafHandle)` if one is queued, AND sets `this.aiTextRafHandle = null`. Prevents a queued rAF from firing setState into a disposed orchestrator (Story 12-1 P7 isDisposed contract extension).

6. **`isAiSpeakingMirror` synchronous-update invariant preserved** — line 874 still sets `this.isAiSpeakingMirror = true` on every delta BEFORE any setState path. Negative-guard regression test.

7. **`acceptDelta` semantics preserved** — `currentAiText` still updates from `result.state.pendingText` on every accepted delta. The dedup boundary (Story 9-5) is unchanged.

8. **All existing orchestrator + TranscriptView tests pass.** No regression on the 1608 existing tests.

9. **Drift detector added** — new test file `src/lib/__tests__/realtime-orchestrator-render-storm.test.ts` (10+ cases) reading orchestrator source from disk + asserting:
   - `extractMethodBody` of `handleEvent` contains the `if (!this.state.isAiSpeaking)` guard before the line-875 setState.
   - Both delta handlers (lines 898 + 919) route through `scheduleAiTextSetState()` (or whatever the helper is named), not direct setState.
   - `scheduleAiTextSetState` method exists + uses `requestAnimationFrame`.
   - `dispose()` body contains `cancelAnimationFrame(this.aiTextRafHandle)`.
   - Negative guard: the pre-13-1 direct-setState pattern `setState((s) => ({ ...s, pendingAiText:` does NOT appear in handlers for `response.output_text.delta` / `response.output_audio_transcript.delta`.

10. **Drift detector for TranscriptView extraData** — new test file `src/components/conversation/__tests__/TranscriptView-extradata.test.ts` (3-5 cases) reading the component source + asserting:
    - `extraData={transcript.length}` (no `isAiSpeaking` template-literal suffix).
    - Negative guard against pre-13-1 `${transcript.length}-${isAiSpeaking}` shape.

11. **Runtime test — 100 synthetic deltas produce ≤ 10 setStates** — new test in `src/lib/__tests__/realtime-orchestrator-render-storm.test.ts` (uses jest fake timers + mock `requestAnimationFrame` to count actual setState invocations).

12. **Cross-story invariant negative guards** — same test file pins:
    - `this.isAiSpeakingMirror = true` (or `= false`) appears at least 2 times (delta path + done path) — Story 11-2 invariant.
    - `applyTranscriptCap(this.transcript,` appears at least 2 times — Story 12-6 invariant unchanged.
    - `setState((s) => ({ ...s, pendingAiText:` appears ONLY inside the new `scheduleAiTextSetState` method body, plus the `.done` paths.

13. **All 4 quality gates green**: `npx tsc --noEmit` 0 errors, `npm run lint` 0 warnings, `npm run format:check` clean, `npx jest` ≥ 1608 passing (target +10-13 net cases).

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (N/A — this story doesn't touch styling)
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners (N/A)
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` (N/A — no new interactive elements)
- [ ] Non-obvious interactions have `accessibilityHint` (N/A)
- [ ] Stateful elements have `accessibilityState` (N/A)
- [ ] All tappable elements have minimum 44x44pt touch targets (N/A)
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` (N/A — no new error paths)
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize` (N/A)
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored.
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/13-1-transcript-render-storm-fix.md` passes.

## Tasks / Subtasks

- [x] **Task 1** (AC: #1, #10) — Drop `isAiSpeaking` from `TranscriptView.tsx` extraData.
  - [x] Edited [`src/components/conversation/TranscriptView.tsx:362`](src/components/conversation/TranscriptView.tsx#L362) — `extraData={transcript.length}` (dropped `${transcript.length}-${isAiSpeaking}` template-literal in `condensed` branch); inline comment explains the rationale + cross-story invariant.
  - [x] Verified `renderItem` still reads `isAiSpeakingRef.current` at render-time (Story 12-1 ref-stable pattern). No source change needed; the ref was already in place.
  - [x] Created [`src/components/conversation/__tests__/TranscriptView-extradata.test.ts`](src/components/conversation/__tests__/TranscriptView-extradata.test.ts) — 3 cases passing (positive shape + negative pre-13-1 guard for both orderings + render-time ref read).

- [x] **Task 2** (AC: #2, #6, #9, #12) — Guard `response.output_audio.delta` setState.
  - [x] Edited the case-arm at the `response.output_audio.delta` switch label — `this.isAiSpeakingMirror = true` stays unconditional (Story 11-2 P22 invariant); the `setState(...)` is now wrapped in `if (!this.state.isAiSpeaking)`. Cuts ~50 setStates/turn to 1.
  - [x] `aiSpeakingStartedAtMs === null` guard on the start-time capture preserved unchanged.

- [x] **Task 3** (AC: #3, #4, #5, #12) — Added `scheduleAiTextSetState` rAF-coalesce helper.
  - [x] Added `private aiTextRafHandle: number | null = null;` field with JSDoc explaining the rAF batching contract + Story 12-1 P7 extension.
  - [x] Added `private scheduleAiTextSetState(): void` — idempotent schedule guard; `requestAnimationFrame` callback reads `this.currentAiText` at fire-time; in-callback `isDisposed` short-circuit.
  - [x] Refactored both delta handlers — `response.output_text.delta` AND `response.output_audio_transcript.delta` route through `this.scheduleAiTextSetState()`; `acceptDelta` boundary byte-identical.
  - [x] Added `private cancelPendingAiTextRaf(): void` — calls `cancelAnimationFrame` + nulls the handle.
  - [x] Wired `cancelPendingAiTextRaf()` calls at: `response.output_audio.done`, `response.output_text.done`, `response.output_audio_transcript.done`, `handleResponseDone`, `handleErrorEvent`, `handleSpeechStarted` (barge-in path), `dispose()`, and `start()` reset block.

- [x] **Task 4** (AC: #9, #11, #12) — New runtime + drift test file.
  - [x] Created [`src/lib/__tests__/realtime-orchestrator-render-storm.test.ts`](src/lib/__tests__/realtime-orchestrator-render-storm.test.ts) — 12 cases passing (9 drift detectors using comment-stripped `ORCHESTRATOR_CODE_ONLY` + `extractMethodBody` walker + 3 runtime cases mocking `requestAnimationFrame`/`cancelAnimationFrame` to verify 100-delta → 1-setState coalescing + dispose-cancels-pending-rAF + 100-audio-delta → 1-setState state-change guard).
  - [x] Drift case 5 NEGATIVE pin uses helper-body excision: searches the source MINUS the `scheduleAiTextSetState` body for the pre-13-1 pattern → 0 matches confirmed.

- [x] **Task 5** (AC: #8, #13) — Quality gates.
  - [x] `npx tsc --noEmit` — 0 errors.
  - [x] `npm run lint` — 0 warnings (1 transient lint warning surfaced + fixed during dev: `Array<T>` → `T[]` per project preference).
  - [x] `npm run format:check` — clean.
  - [x] `npx jest` — **1622 / 1622 passing** (+15 net from 1607). Beats spec target of +10-13 by 2-5.
  - [x] No regression on the 76 existing test suites.

- [x] **Task 6** (Documentation) — CLAUDE.md + sprint-status.
  - [x] Story 13-1 architecture paragraph appended to `CLAUDE.md` after the Story 12-12 review-round-1 paragraph. Documents the rAF batching pattern + extraData ref-stable pin + dispose-time cancel contract + cross-story invariants preserved + expected setState reduction (~250 → ~30 per utterance; ~88% reduction).
  - [x] `sprint-status.yaml` flipped `13-1-transcript-render-storm-fix: backlog → ready-for-dev → in-progress → review` across the dev cycle; `last_updated` reflects each phase.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory: branch from `origin/main` (NOT from PR #89 or PR #90 even if either is still open). Story 13-1 does NOT touch the files those PRs touch (`shippable-roadmap.md` / `epic-12-retro-*.md` / `sprint-status.yaml` / `errors.ts` / `upstream-error-sanitization-source-drift.test.ts`), so merge ordering is independent.

### Project conventions to follow

- **Bounded-budget cap pattern (Story 9-4 / 11-7 / 12-6 / 12-12)** — this story doesn't add a cap but rides on Story 12-6's `MAX_TRANSCRIPT_ENTRIES = 200` (transcript.length is bounded by 200 so the FlatList virtualization budget is finite).
- **"Delete don't alias" pattern (Story 10-2+)** — the pre-13-1 direct-setState pattern in the two delta handlers is DELETED, replaced by `scheduleAiTextSetState()`. Drift detector pins zero occurrences of the old pattern outside the new method body.
- **Single chokepoint refactor (Epic 12 pattern)** — `scheduleAiTextSetState` is the chokepoint; both delta handlers route through it.
- **Synchronous mirror invariant (Story 11-2 review-round-2 P22)** — `isAiSpeakingMirror` MUST be set BEFORE any setState path. The delta handler keeps this line first, then conditionally setStates.
- **Drift detector via comment-stripping (Story 12-2 P12 lesson)** — strip block + line comments before regex assertions so JSDoc mentioning the pre-13-1 pattern doesn't trip negative guards.
- **Method-body extraction (Story 12-5 P12 / 12-10 H1 / 12-12 lessons)** — drift cases scoped to specific method bodies (`handleEvent`, `dispose`, `scheduleAiTextSetState`) via a balanced-brace-counting helper, not whole-file regex.

### Cross-story invariants worth re-checking before merge

- Story 9-3 telemetry allowlist (`src/lib/sentry.ts:25`): zero-diff.
- Story 9-5 voice transcript dedup (`appendIfNew`, `acceptDelta`, `resolveTranscriptKey` in `realtime-transcript.ts`): byte-identical.
- Story 11-1 tool-call protocol (`processReportCorrectionCall`, `drainPendingCorrections` in `realtime-corrections.ts`): byte-identical.
- Story 11-2 reconnect + barge-in (`shouldReconnect`, `computeBargeInDirective`, `RealtimeSession` event flow): byte-identical.
- Story 12-1 observer pattern (`subscribe`, `getState`, `dispose`, `setState` re-entrant guard): preserved; new `scheduleAiTextSetState` is additive.
- Story 12-1 P7 `isDisposed` short-circuit: extended to cover queued-rAF callbacks.
- Story 12-3 atomic-RPC mutations (Phase A `persistConversation` slots): unchanged.
- Story 12-4 `start()` race fix (`this.session = session` before await): unchanged.
- Story 12-5 audio-stream-manager refcount: unchanged.
- Story 12-6 transcript cap (`applyTranscriptCap`, `MAX_TRANSCRIPT_ENTRIES`): preserved by construction.

### Known footguns (from prior story retros)

- **Epic 12 retro action item 4** ("performance/parallelism claims need explicit test cases") — applied here via Runtime cases 8/9/10 in Task 4. The setState-reduction claim is verifiable in CI without a real device.
- **Story 12-1 review-round-1 P6 lesson** — re-entrant setState. The new `scheduleAiTextSetState` calls setState INSIDE a rAF callback (post-event-loop). The Story 12-1 re-entrancy guard (`this.isSetStating` flag at line 389) is NOT engaged by a top-level rAF call — the rAF runs outside any setState frame. This is correct; the guard is for nested-setState scenarios (a subscriber calling back into the orchestrator), not for async-deferred setState. The drift detector should NOT regress this.
- **Story 12-5 review P1 lesson** — "matched-pair acquire/release in start()-reset block". The rAF handle is acquired on schedule + released on cancel/fire. The reset block in `start()` should set `this.aiTextRafHandle = null` defensively (a stale handle from a prior conversation must not leak across `end() → start()` recycling). Verify.
- **Story 12-9 M2 lesson** — module-level state survives HMR; refs survive re-renders. The `aiTextRafHandle` is an instance field, so it's per-orchestrator and clears on `dispose()` → next `start()` creates a fresh orchestrator with `aiTextRafHandle = null` by class-init.
- **Story 12-12 M2 lesson** — `useMemo` is NOT needed when state mutation is already constrained to a non-render-path. Same logic applies here: the throttle is per-event, not per-render.

### Project Structure Notes

- All changes scoped to `src/lib/realtime-orchestrator.ts` + `src/components/conversation/TranscriptView.tsx` + 2 new test files. No new packages. No migration. No Edge Function change. No CI workflow change.
- The `state.pendingAiText` field on `ConversationState` is unchanged (still `string`, still in `INITIAL_STATE` at line 163). Consumers of state see the same shape.
- Public hook API (`useRealtimeVoice` return shape from Story 12-1) is unchanged. The hook continues to subscribe to orchestrator state via `subscribe(callback)` and `setState` mirror.

### References

- Audit: `_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 P2-3, § Epic 13 (line 227-245)
- Epic 12 retrospective: `_bmad-output/implementation-artifacts/epic-12-retro-2026-05-14.md` (action items 1, 4)
- Source: [`src/components/conversation/TranscriptView.tsx:362`](src/components/conversation/TranscriptView.tsx#L362)
- Source: [`src/lib/realtime-orchestrator.ts:865-928`](src/lib/realtime-orchestrator.ts#L865-L928)
- Prior story: [`_bmad-output/implementation-artifacts/12-6-transcript-ref-cap.md`](_bmad-output/implementation-artifacts/12-6-transcript-ref-cap.md)
- Prior story: [`_bmad-output/implementation-artifacts/12-1-realtime-orchestrator-decomposition.md`](_bmad-output/implementation-artifacts/12-1-realtime-orchestrator-decomposition.md)
- Pattern reference (Story 12-5 P12 / 12-10 H1 / 12-12 method-body extractor): `src/lib/__tests__/upstream-error-sanitization-source-drift.test.ts` `extractParseUpstreamErrorBody` helper

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`; sprint-status flipped `backlog → ready-for-dev`.
- Implementation 2026-05-14 on branch `feature/13-1-transcript-render-storm-fix` (branched from `main` post-12-12 PR #88 merge per project memory `feedback_branch_from_main`).
- Quality gates all green after one lint-warning fix (`Array<() => void>` → `(() => void)[]` per `@typescript-eslint/array-type` project rule). 1622 / 1622 tests passing — +15 net from 1607.

### Completion Notes List

- **Task 1 done.** [`src/components/conversation/TranscriptView.tsx:362`](src/components/conversation/TranscriptView.tsx#L362) extraData ref-stable on `transcript.length`. Inline comment documents the rationale + the Story 12-1 ref-stable pattern. 3-case drift detector at [`src/components/conversation/__tests__/TranscriptView-extradata.test.ts`](src/components/conversation/__tests__/TranscriptView-extradata.test.ts) — positive shape pin + negative pre-13-1 guard (both orderings) + render-time `isAiSpeakingRef.current` read pin.
- **Task 2 done.** `case "response.output_audio.delta"` setState guarded by `if (!this.state.isAiSpeaking)`. The Story 11-2 P22 synchronous `isAiSpeakingMirror = true` stays unconditional (positioned BEFORE the guard) so barge-in detection at event time reads the up-to-date value regardless of whether React state has committed. Inline comment cross-references both Story 11-2 P22 and the audit P2-3 closure proof.
- **Task 3 done.** New helper pair on `RealtimeOrchestrator`:
  - `private aiTextRafHandle: number | null = null;` field with JSDoc + cross-story invariant documentation.
  - `private scheduleAiTextSetState(): void` — idempotent (no-op if handle non-null); `requestAnimationFrame` callback reads `this.currentAiText` at fire-time so coalesced bursts surface the latest value; in-callback `isDisposed` short-circuit per Story 12-1 P7 contract extension.
  - `private cancelPendingAiTextRaf(): void` — `cancelAnimationFrame` + null the handle.
  - Both delta handlers (`response.output_text.delta` + `response.output_audio_transcript.delta`) route through `scheduleAiTextSetState()`; `acceptDelta` boundary byte-identical (Story 9-5 invariant preserved).
  - `cancelPendingAiTextRaf()` wired at 8 sites: 3 `.done` switch arms + `handleResponseDone` + `handleErrorEvent` + `handleSpeechStarted` (barge-in cancel BEFORE clearing currentAiText so a queued frame can't re-surface stale text) + `dispose()` (belt-and-suspenders with the in-callback `isDisposed` guard) + `start()` reset block (Story 12-1 P1 / 12-5 P1 reset-all-state pattern).
- **Task 4 done.** New test file [`src/lib/__tests__/realtime-orchestrator-render-storm.test.ts`](src/lib/__tests__/realtime-orchestrator-render-storm.test.ts) — 12 cases / 12 passing:
  - 9 drift detectors using comment-stripped `ORCHESTRATOR_CODE_ONLY` (Story 12-2 P12 lesson) + the `extractMethodBody` walker pattern from Story 12-5 P12 / 12-10 H1 / 12-12. Each detector scoped to a specific method body so a future refactor that moves logic out of the intended location fails CI loudly.
  - 3 runtime cases mocking `requestAnimationFrame` + `cancelAnimationFrame` via `beforeEach`/`afterEach` (Story 12-5 P4 lesson — per-test install/restore prevents cross-test leakage):
    - Case 10: 100 audio-delta events → exactly 1 setState (state-change guard pin); `state.isAiSpeaking === true`; `state.isProcessing === false`.
    - Case 11: 100 transcript-delta events → 1 rAF queued (idempotent schedule); 0 setStates before flush; exactly 1 setState after flush; `state.pendingAiText.length === 100`.
    - Case 12: dispose mid-pending-rAF → `cancelAnimationFrame` called on the handle; flushing the queue post-dispose does NOT fire setState (the in-callback `isDisposed` guard catches it even if cancel were a no-op).
  - Drift Case 5 negative pin uses helper-body excision to defend against false-positives: searches the source MINUS the `scheduleAiTextSetState` body for the pre-13-1 setState pattern — confirms 0 matches.
- **Task 5 done.** Quality gates: `tsc` 0 errors; `lint` 0 warnings (post `Array<T>` → `T[]` fix); `prettier` clean; `jest` 1622 / 1622 passing across 76 suites.
- **Task 6 done.** CLAUDE.md gained a 12-paragraph-precedent-style Story 13-1 architecture entry (post-Story-12-12 review-round-1 entry) documenting the two-axis fix + cross-story invariants (Stories 9-3 / 9-5 / 11-1 / 11-2 / 12-1 / 12-6 / 12-12 all explicitly preserved) + expected setState reduction (~88%). `sprint-status.yaml` `13-1-transcript-render-storm-fix` flipped `backlog → ready-for-dev → in-progress → review`; `last_updated` header tracks each phase.
- **Cross-story invariants verified clean:** `src/lib/sentry.ts` zero-diff (no new feature tags / no new extras keys); `src/lib/realtime-transcript.ts` zero-diff (`appendIfNew` / `acceptDelta` / `resolveTranscriptKey` byte-identical — Story 9-5 contract preserved); `src/lib/realtime-corrections.ts` zero-diff (Story 11-1 tool-call protocol unchanged); `src/lib/realtime-barge-in.ts` zero-diff (Story 11-2 helper unchanged); `src/lib/transcript-cap.ts` zero-diff (Story 12-6 `MAX_TRANSCRIPT_ENTRIES = 200` unchanged); `package.json` + `package-lock.json` + `supabase/` + `.github/workflows/` all zero-diff.
- **Closes audit P2-3** architecturally. Expected impact: setState/utterance drops from ~250 → ~30 (~88% reduction); extraData invalidations/session drops from 60 → 0; parent re-renders/utterance drops proportionally. Final pendingAiText reaches subscribers within one frame (~16.67ms) of the last delta — imperceptible. Epic 13 AC `≥ 55 FPS on iPhone 11 for 30 turns` satisfied architecturally (a real-device FPS trace requires Reactotron / Flipper instrumentation which lives outside CI; Epic 15 / live-device QA owns that verification).

### File List

**Modified files:**
- `src/lib/realtime-orchestrator.ts` — new `aiTextRafHandle` field; new `scheduleAiTextSetState` + `cancelPendingAiTextRaf` private helpers; `response.output_audio.delta` setState wrapped in `if (!this.state.isAiSpeaking)` guard; both delta handlers route through `scheduleAiTextSetState`; `cancelPendingAiTextRaf` wired at 8 sites (3 `.done` arms + `handleResponseDone` + `handleErrorEvent` + `handleSpeechStarted` + `dispose()` + `start()` reset).
- `src/components/conversation/TranscriptView.tsx` — `extraData={transcript.length}` (dropped pre-13-1 template-literal shape from condensed branch); inline rationale comment.
- `CLAUDE.md` — Story 13-1 architecture paragraph appended after Story 12-12 review-round-1 entry.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-1 status `backlog → ready-for-dev → in-progress → review`; `last_updated` header tracks the cycle.
- `_bmad-output/implementation-artifacts/13-1-transcript-render-storm-fix.md` — Tasks/Subtasks all checked; Dev Agent Record filled; Status: review.

**New files:**
- `src/lib/__tests__/realtime-orchestrator-render-storm.test.ts` — 12 cases (9 drift detectors + 3 runtime cases mocking rAF).
- `src/components/conversation/__tests__/TranscriptView-extradata.test.ts` — 3 cases (positive shape + negative pre-13-1 guards + render-time ref read).

**Explicitly NOT modified:**
- `src/lib/realtime-transcript.ts` / `src/lib/realtime-corrections.ts` / `src/lib/realtime-barge-in.ts` / `src/lib/transcript-cap.ts` — pure helper modules preserved byte-for-byte (Stories 9-5 / 11-1 / 11-2 / 12-6 invariants).
- `src/lib/sentry.ts` — no allowlist changes.
- `src/lib/realtime.ts` — `RealtimeSession` event flow unchanged.
- `src/hooks/use-realtime-voice.ts` — pure React-binding consumer of `RealtimeOrchestrator`; no surface change.
- `app/(tabs)/conversation/[sessionId].tsx` — zero diff.
- `package.json` / `package-lock.json` — no new deps.
- `supabase/migrations/` / `supabase/functions/` — zero diff.
- `.github/workflows/` — zero CI change.
