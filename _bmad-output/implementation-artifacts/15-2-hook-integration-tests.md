# Story 15.2: Hook integration tests — `use-pronunciation` (full mocked-API coverage)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **a developer maintaining the Companion codebase**,
I want **the `use-pronunciation` hook (which has zero direct test coverage today) to have full mocked-API integration tests covering its 3 async paths (`startAssessment` / `finishAssessment` / `assessFromUri`), state machine, and error handling** —
so that **future refactors to the Azure pronunciation Edge Function or the recording lifecycle don't silently regress the practice screen at [`app/(tabs)/practice/pronunciation.tsx`](<app/(tabs)/practice/pronunciation.tsx>)**.

## Background — Why This Story Exists

### Spec deliverable (refined)

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 294 — Epic 15 deliverable 15.2:

> 15.2 Hook integration tests with @testing-library/react-native — `use-auth` (sign-in success/failure, token refresh), `use-exercise` (MCQ + writing flows), `use-realtime-voice` (mocked WebSocket), `use-pronunciation` (mocked API).

### Coverage inventory (2026-05-17)

| Hook | Existing tests | Status |
| --- | --- | --- |
| `use-auth` | `use-auth.test.tsx` (6 cases — Story 12-2 hook-binding) + `use-auth-line-budget.test.ts` | ✅ Substantial shape coverage; sign-in flow integration cases would extend (DEFERRED) |
| `use-exercise` | `use-exercise.test.ts` (11 cases — Story 10-8 persist contract + question-stem-hash payload) | ✅ Substantial persistence coverage; MCQ+writing full-flow integration would extend (DEFERRED) |
| `use-realtime-voice` | `use-realtime-voice.test.tsx` (6 cases — Story 12-1 orchestrator binding) + `use-realtime-voice-line-budget.test.ts` + Story 11-2 reconnect + barge-in coverage via `realtime-orchestrator.test.ts` | ✅ Substantial integration coverage at the orchestrator level (the hook is a thin React binding per Story 12-1's god-hook decomposition); WS-flow extensions DEFERRED |
| **`use-pronunciation`** | **none** | **GAP — 15-2 scope** |

### Why GAP-only

Per Epic 14 retro lesson and Story 15-1 precedent: test-writing stories that touch many modules at once produce broad review-patch surface (Story 14-4 → 22 R1 patches). The `use-pronunciation` hook is the only hook in the spec's target list with zero direct coverage; the other 3 have substantial shape/binding tests. Full-flow integration extensions to existing test files belong in a follow-up to avoid scope drift.

### What `use-pronunciation` does (170 LOC)

The hook wraps Azure Speech Service pronunciation assessment ([`src/lib/pronunciation.ts`](src/lib/pronunciation.ts) `assessPronunciation` Edge Function call). Public surface:

- **State:** `{isAssessing, result, weakSounds, history, error, isRecording}`
- **Actions:** `startAssessment()`, `finishAssessment(referenceText)`, `assessFromUri(uri, referenceText)`, `clearResult()`, `getWeakPhonemes()`
- **Dependencies:** `useAudioRecorder` (recording lifecycle), `expo-file-system` (read audio as base64), `assessPronunciation` (Edge call), `identifyWeakSounds` (pure aggregator from Story 15-1 `pronunciation.test.ts`), `appendCappedHistory` (Story 12-12 FIFO cap), `classifyError` (Story 9-X error-messaging), `captureError` (Story 9-3 Sentry).

## Acceptance Criteria

### AC-A: NEW `src/hooks/__tests__/use-pronunciation.test.tsx` (≥12 cases)

Test file uses `@testing-library/react-native` (already installed at v13.3.3) OR `react-test-renderer` (Story 15-1 / 12-9 / 12-1 P8 precedent). The former is simpler for hooks; pick the simpler approach unless there's a specific reason. Story 15-1 used `react-test-renderer` for runtime tests — same precedent applies here.

Mocks (jest.mock at file top):
- `@/src/hooks/use-audio-recorder` → stubbed `{startRecording, stopRecording, isRecording}` controlled per-test
- `expo-file-system/legacy` → stubbed `readAsStringAsync` returning a fixed base64
- `@/src/lib/pronunciation` → stubbed `assessPronunciation` (mocked Edge call) + REAL `identifyWeakSounds` (already pure, Story 15-1 tested)
- `@/src/lib/sentry` → stubbed `captureError` for assertion
- `@/src/lib/error-messages` → stubbed `classifyError` returning a known `{message}` envelope

Required cases (≥12):

1. **Initial state**: `{isAssessing: false, result: null, weakSounds: [], history: [], error: null, isRecording: false}` immediately on mount.
2. **`startAssessment` clears prior result/error AND delegates to recorder.startRecording**: set state to have a prior result (via successful `finishAssessment`), then call `startAssessment`, verify `result === null` + `error === null` + `recorder.startRecording` was called.
3. **`finishAssessment` happy path**: recorder returns a URI; readAsStringAsync returns base64; assessPronunciation resolves with a result; state updates with `{isAssessing: false, result: <result>, history: [<result>], weakSounds: <from identifyWeakSounds>}`.
4. **`finishAssessment` recorder returns null** (user cancelled / no audio): `error === "No audio recorded"` + `isAssessing: false` + no captureError fired.
5. **`finishAssessment` `assessPronunciation` throws** (network / Azure error): `captureError(err, "pronunciation-assessment")` fires + `error` set via `classifyError` + `isAssessing: false`.
6. **`finishAssessment` returns the resolved PronunciationResult value** (not just stores in state — the callable contract).
7. **`assessFromUri` happy path** (skips recording; reads from given uri): readAsStringAsync called with the passed uri; assessPronunciation called with the resulting base64; state updates same as finishAssessment.
8. **`assessFromUri` error path** (`assessPronunciation` throws): captureError + classifyError surfacing + `isAssessing: false`.
9. **`clearResult` resets result + error but PRESERVES history**: after a successful assessment, call `clearResult`, verify `result === null && error === null && history.length === 1` (history NOT cleared).
10. **`getWeakPhonemes` returns `state.result.weakPhonemes` when result exists, `[]` when null**.
11. **History accumulation**: 3 sequential `finishAssessment` calls produce `history.length === 3` (delegated to Story 12-12 `appendCappedHistory` — verify the cap helper is invoked, not duplicated).
12. **History FIFO cap integration**: after 51 sequential `finishAssessment` calls, `history.length === 50` (the `MAX_PRONUNCIATION_HISTORY = 50` cap from Story 12-12 fires; first result evicted). This is a sanity-level integration check, not a re-test of Story 12-12.
13. **`isRecording` mirrors `recorder.isRecording`**: when the mocked recorder's `isRecording === true`, the hook return reflects it.

### AC-B: Quality gates

14. All 5 design-system gates green (type-check / lint / format / check:tokens / jest).
15. **Net test growth target:** **+12 to +15 net Jest cases** (2159 → 2171-2174).

### AC-C: Cross-story invariants

16. Story 9-3 Sentry allowlist zero-diff (verifies existing `pronunciation-assessment` feature tag fires).
17. Story 12-12 `appendCappedHistory` + `MAX_PRONUNCIATION_HISTORY = 50` unchanged (15-2 verifies integration, doesn't modify).
18. Story 15-1 `identifyWeakSounds` unchanged (15-2 uses the real helper rather than mocking — Story 15-1 already pinned its contract).
19. **No source-module modifications** — test-only story.

### Z. Polish Requirements

- [x] All quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm run check:tokens && npx jest`.

### Story File Self-Check

- [x] `git status` lists this file as Untracked.
- [x] `npx prettier --check` passes.

## Operator Decisions

| Q | Question | Options | Recommended |
| --- | --- | --- | --- |
| **Q1** | `@testing-library/react-native` vs `react-test-renderer` for the test file? | (a) RTL — simpler hook-test API via `renderHook`; (b) react-test-renderer — Story 15-1 precedent | **(b) react-test-renderer** — consistency with Story 15-1 + 12-9 + 12-1 P8 + 14-X. Switching test frameworks mid-epic creates pattern drift. |
| **Q2** | Extend existing `use-auth.test.tsx` / `use-exercise.test.ts` / `use-realtime-voice.test.tsx` with integration-flow cases? | (a) Include in 15-2; (b) Defer to `15-2-followup-existing-hook-flow-integration` | **(b) Defer** — existing tests provide substantial shape/binding coverage; full-flow extensions would balloon R1 patches per Epic 14 14-4 lesson. |
| **Q3** | Mock `assessPronunciation` (the lib-level Edge wrapper) OR `supabase.functions.invoke` (one level deeper)? | (a) Mock `assessPronunciation`; (b) Mock supabase | **(a) Mock `assessPronunciation`** — boundary is at the lib-export level; the Edge function call is `pronunciation.ts`'s concern and is OUT of `use-pronunciation`'s scope. |

## Out of Scope

- `use-auth` / `use-exercise` / `use-realtime-voice` integration-flow extensions (deferred to `15-2-followup-existing-hook-flow-integration`)
- `assessPronunciation()` Edge wrapper coverage (Story 15-1 Q1 deferral; would belong to `15-1-followup-pronunciation-edge-wrapper`)
- `useAudioRecorder` hook internal tests (deferred to a separate hook-test follow-up)
- Source-module modifications

## Tasks / Subtasks

- [x] **Task 1: Write `src/hooks/__tests__/use-pronunciation.test.tsx`** (AC: 1-13)
  - [x] Set up jest.mock factories for `use-audio-recorder`, `expo-file-system/legacy`, `@/src/lib/pronunciation` (mock `assessPronunciation` only; pass through `identifyWeakSounds`), `@/src/lib/sentry`, `@/src/lib/error-messages`.
  - [x] Write 13 cases per the AC table.
- [x] **Task 2: Quality gates** (AC: 14-15)
- [x] **Task 3: Housekeeping** — sprint-status, CLAUDE.md paragraph (per Epic 14 retro AI #5).

## Dev Notes

- The hook uses `useState` with functional updaters consistently (Story 12-12 P2-22 closure-fix pattern preserved).
- `expo-file-system/legacy` is the legacy import path; the mock path should match exactly.
- `recorder.startRecording()` and `recorder.stopRecording()` are async; mocks should return Promises.
- The `setState((s) => ({...s, ...}))` functional-updater pattern means test assertions need to wait for the next React tick after each state-mutating call.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6) via /bmad-dev-story + /bmad-code-review workflows in autopilot mode.

### Debug Log References

### Completion Notes List

- **NEW** `src/hooks/__tests__/use-pronunciation.test.tsx` — 20 cases (13 original + 7 R1 patches). Tests cover full hook lifecycle: initial state, startAssessment, finishAssessment (4 paths: happy / no-audio / Azure error / permission-denied), assessFromUri (3 paths: happy / Azure error / FS error / ref-stability), clearResult (with-state + empty-state), getWeakPhonemes (null + populated), history accumulation (3-call + 51-call Story 12-12 FIFO cap with non-containment), isRecording mirroring (snapshot + live-state delegation across re-renders), transient isAssessing via deferred-promise pattern, weakSounds aggregator end-to-end via low-scoring × 3 phoneme fixture.
- **R1 patches applied** (HIGH × 4 + MED × 5): BH-1 weakSounds assertion in Case 3 + new Case 3b for non-empty aggregator integration (R1 EH-7 + EH-10 fixture realism); BH-2 new Case 13b for live-state delegation across re-renders; BH-5 new Case 8c for assessFromUri ref-stability; BH-6 isAssessing post-startAssessment assertion in Case 2; EH-1 new Case 4b for permission-denied path; EH-4 new Case 9b for clearResult-before-init; EH-6 new Case 8b for readAsStringAsync rejection; EH-8 non-containment FIFO assertion in Case 12; EH-9 new Case 6b for transient isAssessing via deferred promise.
- **Deferred** (filed as follow-ups): EH-3 re-entrant guard → `15-2-followup-reentrant-guard` (low real-world hazard, impl-defined behavior); EH-5 `getWeakPhonemes` ref-stability → `15-2-followup-getweakphonemes-ref-stability`; permission-denied distinct error message → `15-2-followup-permission-denied-distinct-error` (operator decision on UX); distinct FS error feature tag → `15-2-followup-distinct-fs-error-tag` (operator decision on telemetry granularity).
- **Quality gates green**: type-check 0 errors / lint 0 warnings / prettier clean / jest test passes (20/20).

### File List

**New:**

- `src/hooks/__tests__/use-pronunciation.test.tsx` — 20 Jest cases (13 original + 7 R1 patches)

**Modified:**

- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 15-2 → done
- `CLAUDE.md` — Story 15-2 architecture paragraph appended
