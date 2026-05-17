# Story 15.1: Lib unit tests — `srs.ts`, `pronunciation.ts` (compare logic), `cache.ts` (core API), `use-dictation.ts` (`compareSentences` word-comparison helper)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **a developer maintaining the Companion codebase**,
I want **the pure-function lib modules (`srs.ts` SM-2 algorithm, `pronunciation.ts` `identifyWeakSounds`, `cache.ts` core get/set/invalidate/cacheWithFallback API, `use-dictation.ts` `compareSentences` helper) to have direct unit tests** —
so that **future refactors can rely on regression detection at the lib layer, the Story 12-10 audit refresh "Jest coverage ≥ 40% on src/lib/" CI gate (Story 15-6) becomes achievable, and Epic 15's broader "make CI a real gate, not a green-light theater" goal becomes structurally enforceable**.

## Background — Why This Story Exists

### What roadmap / audit owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 293 — Epic 15 deliverable 15.1:

> 15.1 Lib unit tests — `srs.ts`, `cache.ts`, `activity.ts`, `memory.ts`, `error-tracker.ts`, `pronunciation.ts` (compare logic), `dictation` word comparison.

**Story 12-10 audit refresh footnote** at [`shippable-roadmap.md:45`](_bmad-output/planning-artifacts/shippable-roadmap.md#L45) refined Epic 15's overall scope: the original 2026-05-06 audit's "3-5% coverage, only `scoring.test.ts` exists" framing is stale. The repo today has **2099 passing Jest tests**. **Epic 15.1's pivoted scope:** target the modules that genuinely lack pure-function unit tests (not modules that already have substantial coverage). The audit's original deliverable line is a starting list; 15.1's actual scope is the subset where direct tests don't yet exist.

### Coverage inventory (2026-05-16)

| Module | LOC | Existing tests | Status |
| --- | --- | --- | --- |
| `src/lib/srs.ts` | 71 | none | **GAP — 15-1 scope** |
| `src/lib/cache.ts` core API | 696 | `cache-flush.test.ts` (write queue) + `cache-secure-routing.test.ts` (SecureStore fork) | **GAP for `getCache`/`setCache`/`invalidateCache`/`cacheWithFallback` — 15-1 scope** |
| `src/lib/activity.ts` | 388 | `activity.test.ts` (307L) + `activity-rpc-mutations.test.ts` + `atomic-activity-rpcs-migration-drift.test.ts` | ✅ Already tested (Story 9-2 + 12-3) — **NOT in 15-1 scope** |
| `src/lib/memory.ts` | 468 | `prompt-injection.test.ts` (sanitize) + `memory-daily-greeting-cache.test.ts` (cached embedding) | Partial coverage (sanitize + embedding cache); async DB-touching paths (`extractFacts`, `persistMemories`, `retrieveMemories`) lack direct tests — **defer to 15-1-followup or 15-2** (needs mocked supabase + OpenAI; better suited to hook-integration story) |
| `src/lib/error-tracker.ts` | 512 | `error-tracker-dedupe.test.ts` + `error-tracker-e2e.test.ts` + `error-patterns-migration-drift.test.ts` | Partial coverage (dedup + e2e clustering); non-dedup paths (`getTopErrors`, `extractErrorsFromCorrections`, `persistErrorPatterns`, `getRecentResolvedError`, micro-drill) lack direct tests — **defer to 15-1-followup or 15-2** (same rationale as memory.ts) |
| `src/lib/pronunciation.ts` `identifyWeakSounds` | 158 | `pronunciation-history.test.ts` covers history FIFO cap; `assessPronunciation` Edge Function wrapper has no test; `identifyWeakSounds` aggregator has no test | **GAP for `identifyWeakSounds` — 15-1 scope.** `assessPronunciation` async wrapper deferred to 15-1-followup (needs mocked `supabase.functions.invoke`) |
| `src/hooks/use-dictation.ts` `compareSentences` | (in 484L hook file) | none | **GAP — 15-1 scope.** Despite living in a hook file, `compareSentences` is a **pure function** (no React, no async, no side effects) so it fits 15-1's pure-function scope |

**15-1 scope (4 modules, GAP-only):** `srs.ts` (full) + `pronunciation.ts` `identifyWeakSounds` (pure aggregator) + `cache.ts` core API (`getCache` / `setCache` / `invalidateCache` / `cacheWithFallback` happy + TTL boundary) + `use-dictation.ts` `compareSentences` (pure word-comparison helper).

**15-1 explicitly NOT in scope:** memory.ts async / DB-touching paths; error-tracker.ts non-dedup paths; pronunciation.ts `assessPronunciation` Edge Function wrapper; cache.ts `enqueueWrite` / `flushWriteQueue` / `clearUserCache` / `clearAllCache` (write queue is covered by `cache-flush.test.ts`; multi-key sweeps deferred). These are async + heavy-mock + better suited to 15-2 (hook integration tests) or follow-up stories.

### Why GAP-only (not exhaustive re-test)

Epic 14 retro lesson (What didn't go well #2): Story 14-4's enforcement-rule change touched every styled surface and absorbed 22 R1 patches. **Test-writing stories have analogous risk** — touching too many modules at once produces broad review-patch surface. By scoping 15-1 to **4 modules where pure-function tests don't yet exist** (and explicitly deferring async / DB-touching paths to 15-2's hook-integration territory), the review surface stays tight and the spec-target is realistic.

### Cross-story precedent

- **Story 9-2 `activity.test.ts` (`evaluatePromotion`)** — pure decision helper with exhaustive boundary tests. The 15-1 `srs.ts` tests follow the same pattern: pure-function in/out tables covering every meaningful boundary.
- **Story 9-4 `prompt-injection.test.ts`** — pure `sanitizeMemoryContent` boundary tests including surrogate-pair, partial-marker, and constant-pin cases. The 15-1 `compareSentences` tests follow this discipline (boundary tests for word-by-word edge cases including accents, casing, punctuation).
- **Story 12-2 P12 + Story 13-2 P11 + Story 13-7 R1-P4** — comment-stripped readFile + paired POSITIVE+NEGATIVE pin + scoped-element extraction patterns. **NOT directly needed for 15-1** because these are runtime tests not drift detectors, but the disciplined-boundary-case-table approach is the inherited testing style.
- **`activity.test.ts` (Story 9-2)** + **`pronunciation-history.test.ts` (Story 12-12)** — pre-existing precedent for pure-function lib tests in this codebase. 15-1 follows their structure.

## Acceptance Criteria

### AC-A: `src/lib/__tests__/srs.test.ts` (NEW)

The full SM-2 algorithm at [`src/lib/srs.ts`](src/lib/srs.ts) currently has zero unit tests. Add a single test file covering `calculateNextReview(current: SRSState, quality: ReviewQuality)`:

1. **Quality boundary cases** (one test per quality value 0 through 5 = 6 cases):
   - Quality 0 (complete blackout): `repetitions` resets to 0; `interval` resets to 1; `easeFactor` decreases by 0.20 floored at 1.3
   - Quality 1 (incorrect response, but remembered when shown): same as 0 — `repetitions = 0`, `interval = 1`, `easeFactor` decreased
   - Quality 2 (incorrect, easy recall): same reset pattern
   - Quality 3 (correct, but difficult): increments `repetitions`; `interval` follows SM-2 formula; `easeFactor` decreases slightly
   - Quality 4 (correct, hesitant): increments `repetitions`; `interval` follows SM-2 formula; `easeFactor` unchanged or slightly increased
   - Quality 5 (perfect): increments `repetitions`; `interval` follows SM-2 formula; `easeFactor` increased by 0.10
2. **`easeFactor` lower-bound clamping (1.3 minimum)**: starting from `easeFactor: 1.4`, a quality-0 review should clamp at 1.3, NOT go negative or below 1.3. Verify the clamp fires at the boundary.
3. **`interval` progression on consecutive correct reviews** (quality 4 or 5):
   - First correct review (`repetitions: 0 → 1`): interval becomes 1 day
   - Second correct review (`repetitions: 1 → 2`): interval becomes 6 days
   - Third+ correct review (`repetitions: 2+`): interval = `previous_interval * easeFactor` (rounded per implementation)
4. **`nextReviewDate` math**: result's `nextReviewDate` is `Date.now() + (interval days in ms)`. Verify via a frozen `Date.now()` mock (Story 12-6 / 12-7 pattern) and assert the resulting timestamp matches `expected_interval * 24 * 60 * 60 * 1000` offset.
5. **Idempotency / no-mutation invariant**: passing the same `current` state object twice must return equivalent `SRSUpdate` outputs and must NOT mutate the input `current` state object (verify via `expect(current).toEqual(snapshot)` after the call).

**Target:** ≥12 cases.

### AC-B: `src/lib/__tests__/pronunciation.test.ts` (NEW)

The `identifyWeakSounds(history: PronunciationResult[])` pure aggregator at [`src/lib/pronunciation.ts:133`](src/lib/pronunciation.ts#L133) currently has zero direct unit tests:

6. **Empty input**: `identifyWeakSounds([])` returns `[]`.
7. **Single-result-no-weak-words**: a single result with all `wordScores[*].accuracyScore >= 70` returns `[]`.
8. **Single-result-one-weak-phoneme**: a single result with one word whose phonemes contain a low-accuracy `/ʁ/` phoneme returns `[{phoneme: "ʁ", ...}]` if the aggregation threshold logic flags it. Verify the returned object shape matches expectations.
9. **Threshold boundary (low-bound)**: a phoneme appearing in N results with average score exactly at the flagging threshold either fires or doesn't (assert the exact boundary behavior the implementation chose).
10. **Threshold boundary (count)**: a phoneme appearing in fewer than `MIN_OCCURRENCE_COUNT` (whatever the implementation uses, e.g., 3) does NOT fire even if it's the lowest-accuracy phoneme in those occurrences.
11. **Multi-phoneme ranking**: multiple weak phonemes returned in DESCENDING-weakness order (worst first) OR in stable insertion order — whatever the impl guarantees. Verify the contract.
12. **No-mutation invariant**: input `history` array reference unchanged after the call; deep-equality against a pre-call snapshot.

**Target:** ≥10 cases.

### AC-C: `src/lib/__tests__/cache.test.ts` (NEW)

Pure-API tests for `cache.ts` core (existing `cache-flush.test.ts` covers the write-queue idempotency; existing `cache-secure-routing.test.ts` covers the SecureStore fork — this file covers the AsyncStorage path):

13. **`getCache(userId, key)` empty-storage returns `null`**: with `AsyncStorage.getItem` mocked to return `null`, `getCache` returns `null`.
14. **`setCache` then `getCache` round-trip**: setCache writes a `{data, timestamp}` envelope; getCache reads it back as the original `data` value. Verify via mocked `AsyncStorage.setItem` capture + manual `AsyncStorage.getItem` mock return.
15. **TTL boundary — fresh entry returned**: an envelope with `timestamp = now - (CACHE_TTL.X - 1)` (1ms below the TTL) is returned by `getCache`.
16. **TTL boundary — expired entry returns `null` AND deletes**: an envelope with `timestamp = now - (CACHE_TTL.X + 1)` (1ms above the TTL) returns `null`; assert `AsyncStorage.removeItem` was called for the same cache key.
17. **`invalidateCache(userId, key)`**: calls `AsyncStorage.removeItem` for the correct cache key.
18. **`cacheWithFallback` happy path — fetcher succeeds**: fetcher returns fresh data; `cacheWithFallback` writes it to cache AND returns the fresh value.
19. **`cacheWithFallback` happy path — cache hit (fresh)**: cache contains a fresh envelope; fetcher is NOT called; cached value returned.
20. **`cacheWithFallback` offline fallback — fetcher throws AND stale cache exists**: fetcher rejects (e.g., network error); cache contains an EXPIRED envelope (above TTL); `cacheWithFallback` returns the expired value as a "stale-but-cached beats no-data" fallback (verify the path; if Story 12-7 enforces secure-cache routing on PROFILE this should fork via `readSecureCacheIgnoreTTL`).
21. **`cacheWithFallback` no fallback — fetcher throws AND no cache**: fetcher rejects; no cache entry exists; `cacheWithFallback` throws the underlying error (no silent null).
22. **Cache-key building — userId + key are namespaced correctly**: a `setCache("user-abc", "profile", ...)` write key must NOT collide with `setCache("user-xyz", "profile", ...)` (verify via `AsyncStorage.setItem.mock.calls[0][0]` capture).
23. **JSON-parse error (corrupted entry)**: `AsyncStorage.getItem` returns malformed JSON; `getCache` returns `null` (no throw) AND calls `AsyncStorage.removeItem` to clean up.
24. **Sentry routing — `captureError` fires on `AsyncStorage` failure** with `feature: "cache-<action>"` tag (Story 9-3 allowlist).
25. **`CACHE_KEYS` + `CACHE_TTL` constant pins**: verify the canonical keys (`profile`, `skills`, `activity`, `vocabulary`, `daily_briefing`, `home_aggregate`) exist + verify each `CACHE_TTL` value matches the documented duration (operator-readable values).

**Target:** ≥13 cases. Mock `@react-native-async-storage/async-storage` via `jest.mock()` factory + mock `@/src/lib/sentry` to capture `captureError` invocations.

### AC-D: `src/hooks/__tests__/use-dictation-compare.test.ts` (NEW)

The pure `compareSentences(expected: string, actual: string): SentenceResult` helper at [`src/hooks/use-dictation.ts:88`](src/hooks/use-dictation.ts#L88) currently has zero unit tests despite being the load-bearing scoring logic for the dictation practice flow:

26. **Perfect match**: `compareSentences("bonjour le monde", "bonjour le monde")` returns all words marked correct + score 100% (or whatever shape the result type uses).
27. **One wrong word**: `compareSentences("bonjour le monde", "bonjour la monde")` returns `le` as incorrect, the other 2 as correct; score reflects 2/3 = 66.7%.
28. **Missing word (short answer)**: `compareSentences("bonjour le monde", "bonjour monde")` returns `le` as missing OR as a position-mismatch; score reflects appropriately.
29. **Extra word (long answer)**: `compareSentences("bonjour monde", "bonjour le monde")` returns `le` as extra; score reflects appropriately.
30. **Empty `actual` input**: `compareSentences("bonjour monde", "")` returns all `expected` words as missing; score 0%.
31. **Empty `expected` input** (defensive): `compareSentences("", "bonjour")` either throws OR returns a documented degenerate result (assert whichever the impl chose).
32. **Casing difference**: `compareSentences("Bonjour", "bonjour")` — verify whether the impl is case-sensitive (likely case-insensitive for dictation pedagogy).
33. **Accent difference**: `compareSentences("café", "cafe")` — verify whether the impl normalizes accents (likely yes — pedagogical leniency).
34. **Trailing punctuation**: `compareSentences("Bonjour le monde.", "Bonjour le monde")` — verify whether trailing `.` is stripped before comparison.
35. **Internal punctuation**: `compareSentences("Salut, Marie", "Salut Marie")` — verify behavior on comma stripping.
36. **Multi-space whitespace**: `compareSentences("bonjour  le  monde", "bonjour le monde")` — multiple internal spaces should collapse to single during comparison.
37. **Leading/trailing whitespace**: `compareSentences("  bonjour monde  ", "bonjour monde")` — trimmed before comparison.
38. **No-mutation invariant**: input strings unchanged after call (always true for primitives, but verify the result shape doesn't reference input by reference).

**Target:** ≥13 cases.

### AC-E: Quality gates

39. All 5 design-system gates green: `npm run type-check && npm run lint && npm run format:check && npm run check:tokens && npx jest`.
40. **Net test growth target:** **+50 to +65 net Jest cases** (2099 → 2149-2164). This is a conservative budget that matches the spec's 4-module × ≥10-13 cases per module floor.

### AC-F: Cross-story invariants preserved

41. Story 9-3 Sentry allowlist zero-diff — no new `feature` tags / extras keys introduced (cache tests assert existing `cache-*` feature tags fire; no new tags).
42. Story 9-4 stored-prompt-injection N/A (no AI prompts in 15-1 scope).
43. Story 12-1 / 12-6 / 12-7 / 13-7 / 14-X — all orthogonal (these tests only consume existing module exports; no module source is modified).
44. **No source-module modifications.** This story is test-only. If a tested function reveals a bug, file the fix as a follow-up story rather than mixing dev work with test work. (Exception: if a JSDoc clarification is needed to disambiguate intended behavior, that's allowed.)

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex. **(N/A — no UI surface in this story.)**
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners. **(N/A.)**
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`. **(N/A.)**
- [x] Non-obvious interactions have `accessibilityHint`. **(N/A.)**
- [x] Stateful elements have `accessibilityState`. **(N/A.)**
- [x] All tappable elements have minimum 44x44pt touch targets. **(N/A.)**
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`. **(N/A — no source changes; tests verify existing `captureError` calls.)**
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`. **(N/A.)**
- [x] All quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm run check:tokens && npx jest`.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/15-1-lib-unit-tests.md`) under "Untracked files".
- [x] `npx prettier --check _bmad-output/implementation-artifacts/15-1-lib-unit-tests.md` passes.

## Operator Decisions

This story has minimal operator-decision surface because it's test-only with no API design surface. Three points warrant explicit decision:

| Q | Question | Options | Recommended | Rationale |
| --- | --- | --- | --- | --- |
| **Q1** | Should `assessPronunciation()` Edge Function wrapper be in 15-1 scope? | (a) Include — adds ~5-8 cases with mocked `supabase.functions.invoke`; (b) Defer to `15-1-followup-pronunciation-edge-wrapper` | **(b) Defer** | Async Edge Function wrappers need substantial mocking infra; better suited to 15-2 (hook integration tests) or a dedicated follow-up. Keeping 15-1 pure-function-only matches the Epic 14 lesson that scope drift produces patch-count balloon. |
| **Q2** | Should `memory.ts` `extractFacts` / `persistMemories` / `retrieveMemories` be in 15-1 scope? | (a) Include — adds ~10-15 cases; (b) Defer to `15-1-followup-memory-async-paths` or 15-2 | **(b) Defer** | Same rationale as Q1 — async + DB-touching + complex mocking. Story 9-4 covered the pure `sanitizeMemoryContent` path; the async write/read paths are integration-test territory. |
| **Q3** | Should `error-tracker.ts` non-dedup paths (`getTopErrors`, `extractErrorsFromCorrections`, `persistErrorPatterns`, `getRecentResolvedError`) be in 15-1 scope? | (a) Include; (b) Defer | **(b) Defer** | Same. Story 11-6 covered the dedup/embedding paths. Non-dedup paths are async + DB-touching. |

## Out of Scope

Reject any reviewer pressure to expand 15-1 into these (filed for follow-up stories if motivated):

- **`memory.ts` async paths** — `extractFacts(transcript)`, `persistMemories(userId, conversationId, facts)`, `retrieveMemories(userId, topic, limit)`. Defer to `15-1-followup-memory-async-paths` or 15-2.
- **`error-tracker.ts` non-dedup paths** — `getTopErrors`, `extractErrorsFromCorrections`, `persistErrorPatterns`, `getRecentResolvedError`, micro-drill generation. Defer to `15-1-followup-error-tracker-extended` or 15-2.
- **`pronunciation.ts` `assessPronunciation()`** Edge Function wrapper. Defer to `15-1-followup-pronunciation-edge-wrapper`.
- **`cache.ts` extended surface** — `enqueueWrite` / `flushWriteQueue` (already covered by `cache-flush.test.ts`); `clearUserCache` / `clearAllCache` multi-key sweeps. Defer to `15-1-followup-cache-clear-paths`.
- **`use-dictation.ts` `analyzeErrorPatterns(results)`** — pure but less load-bearing than `compareSentences`. Defer to `15-1-followup-dictation-error-patterns`.
- **Any source-module modifications** beyond JSDoc clarifications. If a test reveals a bug, file the fix as a separate story.
- **Coverage threshold wiring** — 15-6 territory. 15-1 produces tests; 15-6 wires `jest --coverage` thresholds into CI.

## Tasks / Subtasks

- [x] **Task 1: Write `src/lib/__tests__/srs.test.ts`** (AC: 1–5)
  - [x] Initial test scaffolding — import `calculateNextReview` + `ReviewQuality` + `SRSState` types; jest.useFakeTimers for `Date.now()` mocking.
  - [x] Quality 0/1/2 boundary cases (3 cases) verifying `repetitions = 0` + `interval = 1` + `easeFactor` decrement + 1.3 floor.
  - [x] Quality 3/4/5 progression cases (3 cases) verifying `repetitions` increment + SM-2 interval formula + `easeFactor` adjustment.
  - [x] `easeFactor` 1.3 floor boundary case (1 case).
  - [x] Interval progression on 3 consecutive correct reviews (1 case asserting 1 → 6 → ≈ 6\*ef days).
  - [x] `nextReviewDate` math verification (1 case with frozen `Date.now()`).
  - [x] No-mutation invariant (1 case via deep-equal pre/post-call).

- [x] **Task 2: Write `src/lib/__tests__/pronunciation.test.ts`** (AC: 6–12)
  - [x] Empty input case.
  - [x] No-weak-words happy path.
  - [x] Single-weak-phoneme case.
  - [x] Threshold boundary (score) case.
  - [x] Threshold boundary (count) case.
  - [x] Multi-phoneme ranking case.
  - [x] No-mutation invariant case.

- [x] **Task 3: Write `src/lib/__tests__/cache.test.ts`** (AC: 13–25)
  - [x] Mock `@react-native-async-storage/async-storage` via shared module mock; mock `@/src/lib/sentry` `captureError` (Story 12-9 / 14-7 precedent).
  - [x] `getCache` empty-storage returns null.
  - [x] `setCache` → `getCache` round-trip.
  - [x] TTL boundary fresh / expired cases (2 cases).
  - [x] `invalidateCache` removeItem verification.
  - [x] `cacheWithFallback` 4 paths: fresh-fetcher / fresh-cache-hit / stale-fallback-on-fetcher-error / no-fallback-fetcher-throws.
  - [x] Cache-key namespacing across different userIds.
  - [x] Corrupted-JSON cleanup case.
  - [x] Sentry `captureError` routing on `AsyncStorage.getItem` throw.
  - [x] Constant pins for `CACHE_KEYS` + `CACHE_TTL`.

- [x] **Task 4: Write `src/hooks/__tests__/use-dictation-compare.test.ts`** (AC: 26–38)
  - [x] Perfect match.
  - [x] One wrong word.
  - [x] Missing word.
  - [x] Extra word.
  - [x] Empty actual.
  - [x] Empty expected (defensive).
  - [x] Casing-difference (case-insensitive expectation; adjust if impl is strict).
  - [x] Accent-difference (`café` vs `cafe`).
  - [x] Trailing punctuation strip.
  - [x] Internal punctuation strip.
  - [x] Multi-space collapse.
  - [x] Leading/trailing whitespace trim.
  - [x] No-mutation invariant.

- [x] **Task 5: Verify quality gates** (AC: 39–40)
  - [x] `npm run type-check` (0 errors).
  - [x] `npm run lint` (0 warnings).
  - [x] `npm run format:check` (clean).
  - [x] `npm run check:tokens` (clean).
  - [x] `npx jest` (4 new test files; +50-65 net cases; suite goes 2099 → 2149-2164).
  - [x] All 5 gates pass before commit.

- [x] **Task 6: Housekeeping** (Story 15-1 closure)
  - [x] Update CLAUDE.md with a Story 15-1 paragraph (per Epic 14 retro AI #5 — the dev-story gate should now enforce this; if the story File List declares CLAUDE.md, the file must actually be modified before completion).
  - [x] Update `_bmad-output/implementation-artifacts/sprint-status.yaml` `15-1-lib-unit-tests` entry from `in-progress` to `review`.

## Dev Notes

### Test-writing discipline (inherited from Epic 14)

- **GAP-only scope** — do not re-test what's already tested. The Coverage Inventory above is the authoritative list of what's in scope.
- **Pure-function focus** — every test in this story drives a pure function (no React rendering, no async DB calls, no Edge Function invocations). The Reanimated mock is NOT needed.
- **Boundary case discipline** — for `srs.ts` quality boundaries + `cache.ts` TTL boundaries, write exact-boundary tests (e.g., `now - TTL_MS + 1` returns fresh; `now - TTL_MS - 1` returns null). This matches Story 9-2 `evaluatePromotion` test discipline.
- **No-mutation invariants** — every pure-function test that takes an array/object input MUST end with `expect(input).toEqual(snapshot)` to verify no in-place mutation. Pattern from Story 12-12 `pronunciation-history.test.ts`.
- **Mock at the module-level only when needed** — `cache.test.ts` mocks `@react-native-async-storage/async-storage` + `@/src/lib/sentry`. `srs.test.ts` + `pronunciation.test.ts` + `use-dictation-compare.test.ts` have ZERO mocks (pure-function-only).

### Mock infrastructure required

- **`cache.test.ts`** — mocks:
  ```ts
  jest.mock("@react-native-async-storage/async-storage", () => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    getAllKeys: jest.fn(),
    multiRemove: jest.fn(),
  }));
  jest.mock("@/src/lib/sentry", () => ({
    captureError: jest.fn(),
    addBreadcrumb: jest.fn(),
  }));
  ```
- **`srs.test.ts`** — use `jest.useFakeTimers()` for `Date.now()` mocking around `nextReviewDate` cases. Reset via `jest.useRealTimers()` in `afterAll`.
- **`pronunciation.test.ts`** — zero mocks needed; `identifyWeakSounds` is pure.
- **`use-dictation-compare.test.ts`** — zero mocks needed; `compareSentences` is pure.

### Source tree components to touch

**NEW files (4 — tests only):**
- `src/lib/__tests__/srs.test.ts`
- `src/lib/__tests__/pronunciation.test.ts`
- `src/lib/__tests__/cache.test.ts`
- `src/hooks/__tests__/use-dictation-compare.test.ts`

**MODIFIED files (0 source files):**
- No source modules touched in this story.

**HOUSEKEEPING files (3):**
- `CLAUDE.md` (Story 15-1 paragraph — per Epic 14 retro AI #5 dev-story gate enforcement)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status update)
- `_bmad-output/implementation-artifacts/15-1-lib-unit-tests.md` (this file — Status: review on completion)

### Testing standards summary

- **Test framework:** Jest (existing project setup at `jest.config.js`).
- **Test file naming:** `<module-name>.test.ts` for lib modules; `<helper-name>.test.ts` for non-default helpers from hook files.
- **Test structure:** `describe("Story 15-1 — <module>", () => { describe("<helper>", () => { it("Case N: <description>", () => {...}) }) })`. Match Story 9-2 / 12-12 / 14-X precedent.
- **No reliance on existing test infrastructure beyond `jest.useFakeTimers()`** — the new test files should be self-contained.

### Project Structure Notes

- Tests live alongside the modules they test in `__tests__` subdirectories.
- `use-dictation-compare.test.ts` lives in `src/hooks/__tests__/` because `compareSentences` is exported from `src/hooks/use-dictation.ts` — its location follows its export, not its semantic purity.
- No new packages required. Jest + TypeScript + `@types/jest` (existing setup) cover everything.
- No migrations / Edge Function changes / CI workflow changes.

### References

- [`_bmad-output/planning-artifacts/shippable-roadmap.md:293`](_bmad-output/planning-artifacts/shippable-roadmap.md#L293) — Epic 15 deliverable 15.1.
- [`_bmad-output/planning-artifacts/shippable-roadmap.md:45`](_bmad-output/planning-artifacts/shippable-roadmap.md#L45) — Story 12-10 audit refresh footnote (Epic 15 scope pivot).
- [`_bmad-output/implementation-artifacts/epic-14-retro-2026-05-16.md`](_bmad-output/implementation-artifacts/epic-14-retro-2026-05-16.md) — Epic 14 retro lessons (notably "test-writing stories at risk of scope drift").
- [`src/lib/srs.ts`](src/lib/srs.ts) — module under test.
- [`src/lib/pronunciation.ts`](src/lib/pronunciation.ts) — module under test (`identifyWeakSounds` only).
- [`src/lib/cache.ts`](src/lib/cache.ts) — module under test (core API only).
- [`src/hooks/use-dictation.ts`](src/hooks/use-dictation.ts) — module under test (`compareSentences` only).
- [`src/lib/__tests__/activity.test.ts`](src/lib/__tests__/activity.test.ts) — precedent pure-function lib test (Story 9-2).
- [`src/lib/__tests__/pronunciation-history.test.ts`](src/lib/__tests__/pronunciation-history.test.ts) — precedent pure-function lib test (Story 12-12).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- **`use-dictation-compare.test.ts` transitive `expo-audio` crash:** the dictation hook imports `use-audio-player` which imports `expo-audio` (native-only; crashes in Jest with `Cannot read properties of undefined (reading 'prototype')`). Resolved by adding two `jest.mock` factories at the top of the test file: `@/src/hooks/use-audio-player` → empty stub; `@/src/lib/openai` → stub `chatCompletionJSON` + `generateSpeech`. `compareSentences` itself is pure so it doesn't need the real audio/AI deps.
- **Cache test secure-key avoidance:** the AsyncStorage path is gated on `SECURE_CACHE_KEYS.has(key) && Platform.OS !== "web"` — using `"profile"` would route through SecureStore. Used `"skills"` (non-secure) throughout `cache.test.ts` to exercise the AsyncStorage path directly. The Story 12-7 SecureStore fork is already covered by `cache-secure-routing.test.ts`.

### Completion Notes List

- **+59 net Jest cases** (2099 → 2158; squarely within spec target of +50-65). Breakdown: 14 srs.test.ts + 10 pronunciation.test.ts + 20 cache.test.ts + 15 use-dictation-compare.test.ts.
- **0 source-module modifications.** Test-only story — every test consumes existing module exports verbatim.
- **All 3 operator decisions resolved per Recommended** (Q1 defer `assessPronunciation` Edge wrapper, Q2 defer `memory.ts` async paths, Q3 defer `error-tracker.ts` non-dedup paths). Kept 15-1 pure-function-only per Epic 14 retro lesson.
- **All 5 design-system gates green:** type-check (0 errors), lint (0 warnings), prettier (clean), check:tokens (clean), jest (113 suites / 2158 tests).
- **CLAUDE.md paragraph added** per Epic 14 retro AI #5 (dev-story should enforce this).

### File List

**NEW (4 — tests only):**

- `src/lib/__tests__/srs.test.ts`
- `src/lib/__tests__/pronunciation.test.ts`
- `src/lib/__tests__/cache.test.ts`
- `src/hooks/__tests__/use-dictation-compare.test.ts`

**MODIFIED (0 source files).**

**HOUSEKEEPING (3):**

- `CLAUDE.md` (Story 15-1 paragraph)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status update)
- `_bmad-output/implementation-artifacts/15-1-lib-unit-tests.md` (this file — Status: review)

### Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-05-16 | Story 15-1 implementation complete — 4 NEW test files; +59 net Jest cases (2099 → 2158); 0 source-module modifications. All 5 quality gates green. Status: review. FIRST Epic 15 story shipped. | claude-opus-4-7 |
