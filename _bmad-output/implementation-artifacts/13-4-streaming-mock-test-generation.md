# Story 13.4: Streaming Mock-Test Generation — `useMockTestGeneration` hook parallelizes per-section AI calls so section 1 is playable while section 2 generates

Status: review

## Story

As a **TCF Canada exam-prep user tapping "Start full mock test"**,
I want **the first section's questions to render within ~8s instead of waiting for both sections to finish generating sequentially**,
so that **I begin the 35-minute listening section while the 60-minute reading section finishes generating in the background — instead of staring at a skeleton for ~12-16s while listening + reading generate one after the other**.

## Background — Why This Story Exists

### What audit finding P2-6 owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 — `P2-6`:

> Mock test 3 sequential AI calls (no streaming, no first-section-playable progressive UI)
> `app/(tabs)/mock-test/[testId].tsx` | performance

The audit was written when TCF Tout Public had 3 sections (listening + reading + grammar). Story 10-X's TCF Canada pivot dropped the run to 2 sections (listening + reading; see [`app/(tabs)/mock-test/[testId].tsx:38-51`](app/(tabs)/mock-test/[testId].tsx#L38-L51) `SCHEMA NOTE`). **The "3 sequential" phrasing is outdated; the principle holds: today's 2 sequential AI calls block first-section playability for the cumulative max-tokens latency of BOTH calls instead of just the longest one.** Epic 13 AC at [`shippable-roadmap.md:255`](_bmad-output/planning-artifacts/shippable-roadmap.md#L255): _"Mock test feels playable (first section rendered) within 8s of tap."_

### The sequential `for-of` loop — what gets blocked

[`app/(tabs)/mock-test/[testId].tsx:298-368`](<app/(tabs)/mock-test/[testId].tsx#L298-L368>) `initTest` fires per-section generation in a serial `for (const section of sections)` loop:

```typescript
for (const section of sections) {
  try {
    const prompt = buildMockTestPrompt({ section, targetLevel: cefrLevel, ... });
    const result = await chatCompletionJSON(
      [{ role: "system", content: prompt }],
      mockTestSectionSchema,
      { temperature: 0.4, maxTokens: 4096, feature: `mock-test-${section}` }
    );
    // ... passage map merge ...
    allQuestions[section] = questions;
  } catch (err) {
    captureError(err, `mock-test-generate-${section}`);
    allQuestions[section] = [];
    generationFailed = true;
  }
}
// After the loop: insert mock_tests row + setState({ status: "active" }).
```

Per-call latency at `gpt-4o` temp 0.4, maxTokens 4096 is empirically ~6-10s (39 questions per section × the per-question token cost is a lot of output tokens to stream). **Two sections sequentially: ~12-20s end-to-end to render the first question.** Post-13-4 parallel: max(listening, reading) ≈ ~6-10s to render section 1; section 2 finishes in parallel and is ready when the user reaches it (35 minutes later under normal flow).

### What gets faster, exactly

| Metric                                                    | Pre-13-4                                       | Post-13-4                                        |
| --------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| First-question-tappable latency (architectural proxy)     | ~12-20s (Σ section gen times)                  | ~6-10s (max section gen time)                    |
| `chatCompletionJSON` calls fired concurrently             | 1 at a time (sequential `await`)               | 2 in parallel (`Promise.allSettled`)             |
| Total wall-clock for both sections                        | Σ per-section latencies                        | max(per-section latencies)                       |
| Partial-success semantic preserved                        | YES (1 section empty → test proceeds)          | YES (per-section failure isolation)              |
| DB row insert timing                                      | After ALL sections generate                    | After FIRST section ready (UPDATE on subsequent) |
| Per-section Sentry tag `mock-test-generate-${section}`    | YES (1 tag per failure)                        | YES (preserved per-section)                      |
| Epic 13 AC line 255 "first section ≤ 8s"                  | ❌ likely 12-20s                               | ✅ 6-10s typical                                 |

### Why a hook + parallel-fire, not "real" token streaming

Two technically-valid interpretations of "stream mock-test generation":

(a) **Concurrent per-section AI calls** — fire `chatCompletionJSON(listening)` + `chatCompletionJSON(reading)` in parallel via `Promise.allSettled`; render the first section as soon as ITS promise resolves; render the second when it resolves (or show a "Preparing next section..." overlay if the user reaches it first).

(b) **OpenAI token streaming with progressive JSON parsing** — use the OpenAI streaming API + a partial-JSON parser to render questions as they emit tokens.

**This story implements (a), not (b).** Justification:

1. **The audit AC at [`shippable-roadmap.md:255`](_bmad-output/planning-artifacts/shippable-roadmap.md#L255)** says "first section rendered within 8s of tap" — not "first question rendered within Xs". Per-section concurrent firing solves the AC; partial-section streaming does not.
2. **Token streaming + Zod schema validation are structurally incompatible.** `chatCompletionJSON` uses `responseFormat: "json_object"` + `mockTestSectionSchema.safeParse(JSON.parse(raw))` (Story 9-7). The schema parses ONCE at the end of the response. Streaming would require either (i) deleting Story 9-7's parseRetries contract for this call site or (ii) writing a custom partial-JSON-tolerant validator — both significantly larger scope than this story owns.
3. **`gpt-4o`'s Realtime/streaming surface is in Edge Function territory** ([`supabase/functions/ai-proxy/`](supabase/functions/ai-proxy/)). Adding a streaming chat endpoint would touch the Edge Function + the Story 11-3 `fetchWithTimeout` budgets + the Story 11-4 daily-cost-cap pre-flight (which today reads `usage` from the final response — no `usage` until stream completes). That's an Epic 17.X-scope follow-up, not Epic 13's hot-path-fix scope.
4. **(a) gets the entire AC win for ~150-line hook + ~70-line screen refactor.** (b) would be a multi-story epic.

### Why a hook, not inline `Promise.allSettled` in `[testId].tsx`

Pre-13-4 the generation logic + DB resume + Sentry routing + Alert prompts are ~115 lines inside the `initTest()` closure inside the `useEffect` inside the 811-line screen. Story 12-1 + 13-3 precedent: **single-chokepoint refactor into a hook**.

- New `useMockTestGeneration({ sections, cefrLevel, testIdParam, isInvalidTestId, enabled }) → { questions, sectionStatus, allReady, anyFailed, abortAlertShown, activeTestId, generationError }` extracts the per-section parallel-fire logic + DB INSERT/UPDATE plumbing.
- The hook is REACTOR-PATTERN compatible: each section's status transitions `"pending" → "ready" | "failed"` independently; the screen subscribes to `sectionStatus` + first-ready signals.
- Hook ALSO consumes the DB resume path (preserves the existing flow at [`[testId].tsx:198-296`](<app/(tabs)/mock-test/[testId].tsx#L198-L296>)).
- **The screen no longer imports `chatCompletionJSON`, `mockTestSectionSchema`, or `buildMockTestPrompt`** — those move to the hook. Drift detector pins this.

### What `[testId].tsx` looks like post-13-4

The `initTest` `useEffect` shrinks from ~217 lines (lines 198-414) to a hook-call + a `useEffect` that reacts to `sectionStatus[firstSection] === "ready"`:

```typescript
const { sections, cefrLevel } = useMockTestRouteParams(); // pure helper extracting from testId + profile
const generation = useMockTestGeneration({
  sections,
  cefrLevel,
  testIdParam: testId,
  enabled: !isInvalidTestId,
});
// generation.questions: Record<Section, MCQContent[]>
// generation.sectionStatus: Record<Section, "pending" | "ready" | "failed">
// generation.allReady: boolean
// generation.anyFailed: boolean
// generation.firstSectionReady: boolean (sectionStatus[sections[0]] === "ready")
// generation.activeTestId: string | null
// generation.resumeData: { ... } | null (when resuming from DB)

useEffect(() => {
  // Transition from "loading" → "active" when first section is ready
  if (generation.firstSectionReady && state.status === "loading") {
    setState((s) => ({
      ...s,
      questions: generation.questions,
      timeRemaining: totalMinutes * 60,
      status: "active",
    }));
  } else if (state.status === "active") {
    // Merge newly-ready sections into state (for section 2's late arrival)
    setState((s) => ({ ...s, questions: generation.questions }));
  }
}, [generation.firstSectionReady, generation.questions]);
```

The `handleNextSection` callback ([`[testId].tsx:606`](<app/(tabs)/mock-test/[testId].tsx#L606>)) gains a guard: if the next section's status is `"pending"`, show a "Preparing next section..." overlay; advance once status flips to `"ready"`. Under normal usage section 2 has had 35 minutes to finish generating, so this overlay almost never appears — but it's the correctness backstop for users who race through section 1.

### Cross-story invariants to preserve

- **Story 9-3 telemetry allowlist** — per-section Sentry tags `mock-test-generate-listening` + `mock-test-generate-reading` PRESERVED verbatim (categorical short strings under 80-char threshold). One NEW categorical tag `mock-test-generation-aborted` for the all-sections-failed Alert path. `feature` extras key already allowlisted; `section` extras key — _verify_ — Sentry calls today already pass `section` as part of the feature string interpolation, not as an extras key, so no allowlist extension needed.
- **Story 9-4 stored-prompt-injection** — `buildMockTestPrompt` is operator-built (no user input flows through); the `<USER_TRANSCRIPT>` / `<USER_FACTS>` wrappers don't apply. Pre-13-4 invariant: zero user-derived content in the mock-test prompt — preserved.
- **Story 9-7 Zod-schema parseRetries** — `chatCompletionJSON(_, mockTestSectionSchema, _)` per-section call SHAPE byte-identical; `parseRetries: 1` default preserved. Parallel firing does NOT change parseRetries semantics (each call's retry budget is independent).
- **Story 9-8 / 10-6 Speaking pipeline** — speaking section uses separate `chatCompletionJSON(speakingTaskEvaluationSchema)` flow at [`speaking.tsx`](<app/(tabs)/mock-test/speaking.tsx>); orthogonal — NOT touched.
- **Story 10-8 anti-repetition** — `runMcqDedupPipeline` for practice exercises (listening / reading / grammar / writing) is at `use-exercise.ts`; mock-test path explicitly OUT-OF-SCOPE per 10-8 CLAUDE.md ("Mock-test section dedupe ... out of scope (Epic 13.x performance / Epic 17.x mock-test caching / Epic 11.6 embedding-based dedup / future sub-stories)"). 13-4 does NOT add dedup at this layer.
- **Story 11-3 `fetchWithTimeout`** — server-side `chatCompletionJSON` upstream timeout = `DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000`. Per-section calls run on independent Edge Function invocations; parallel firing does NOT compound the per-call budget. Worst-case per-section: 30s timeout × MAX_RETRIES = 2 + Σ RETRY_DELAYS = 93s. Both sections in parallel: still 93s worst case (not 186s). Acceptable.
- **Story 11-4 daily-cost-cap pre-flight** — `check_daily_cost_budget` RPC runs per chatCompletion call BEFORE the upstream OpenAI dispatch. Parallel firing means TWO concurrent pre-flights against the same `auth.uid()` row → potential race where both pre-flights see the same `total_today_cents` and both pass, then both record cost. Story 11-4's `record_daily_cost(p_user_id, p_cost_cents)` is an ATOMIC INCREMENT (`UPDATE ... SET total_cost_cents = total_cost_cents + p_cost_cents`) — no lost updates. Worst case: both calls pass pre-flight slightly above the cap (over-spend by ≤ 1 call's worth of cents). Acceptable for first-class hot-path; tight-budget enforcement is Story 11-4's domain and remains correct in aggregate.
- **Story 11-7 prompt-truncation** — `buildMockTestPrompt` is fixed-content (no `<USER_FACTS>` / `<USER_WEAK_AREAS>` injection); not affected.
- **Story 11-8 empty-response retry** — `MAX_RETRIES = 2` + `RETRY_DELAYS = [1000, 2000]` per `chatCompletion` call preserved; parallel firing inherits the per-call retry budget.
- **Story 12-1 orchestrator** — orthogonal (Realtime voice flow; mock test is separate).
- **Story 12-3 atomic-RPC mutations** — orthogonal (this story does not mutate the activity-tracking RPCs; the post-test completion flow still calls `incrementDailyActivity` + `updateStreak` + `checkCefrPromotion` unchanged at [`[testId].tsx:517-519`](<app/(tabs)/mock-test/[testId].tsx#L517-L519>)).
- **Story 12-7 secure-cache** — orthogonal (mock-test in-progress state is stored in `mock_tests.questions` JSONB, not in `AsyncStorage`).
- **Story 12-9 email verification gate** — orthogonal (gate fires at `_layout.tsx` BEFORE the mock-test screen mounts).
- **Story 13-1 transcript render-storm** — orthogonal (orchestrator + TranscriptView; mock test is QCM-only).
- **Story 13-2 home aggregate** — orthogonal (RPC pattern; this story uses parallel `chatCompletionJSON`, not RPC).
- **Story 13-3 session-feedback aggregate** — orthogonal (conversation feedback flow). **But the HOOK extraction pattern is the SAME** — 13-3 extracted 4-effect waterfall into `useSessionFeedbackAggregate`; 13-4 extracts for-loop generation into `useMockTestGeneration`. Same single-chokepoint discipline.

### Known footguns (from prior story retros)

- **Story 13-2 review-round-1 P1 lesson** — concurrent first-call race on a module-level cache. `useMockTestGeneration` does NOT use module-level state (each mount gets a fresh hook instance); not directly applicable. But the test suite must verify: **two `renderHook` instances mounted concurrently do not interfere with each other's per-section state.** Cover via test case.
- **Story 13-2 review-round-1 P2 lesson** — two-query atomic-count race. Mock-test does not have a count-then-update pattern; not applicable.
- **Story 13-2 review-round-1 P3 lesson** — UTC/local-timezone consistency. Not applicable (mock test is timer-based, not date-based).
- **Story 13-3 review-round-1 P2 lesson** — hook re-fires effect on every parent re-render due to fresh-reference-per-render of object inputs. The hook input `sections: readonly Section[]` would change reference on every render of `[testId].tsx` because `sections` is computed inline as `testId === "full" ? [...ALL_QCM_SECTIONS] : [testId as Section]`. **Defense:** memoize `sections` via `useMemo` in the SCREEN before passing to the hook, OR build the hook's effect dep array from `sections.join(",")` (content key). Spec mandates the latter (`sectionsKey` content string) for defense-in-depth.
- **Story 13-3 review-round-1 P4 lesson** — duplicate `captureError` from both helper and hook layers. Not applicable here (no helper-layer; the hook IS the chokepoint).
- **Story 12-9 mountedRef pattern** — applied to the hook's setState calls so a deferred-resolve after unmount does not setState into a torn-down tree.
- **Story 12-1 P8 react-test-renderer for hook contract tests** — `create` + `act` (Story 12-9 EmailVerificationGate.test.tsx pattern, Story 13-3 use-session-feedback-aggregate.test.tsx pattern). Hook tests use react-test-renderer, NOT `@testing-library/react-hooks` (latter unmaintained).
- **Story 9-7 partial schema response** — `mockTestSectionSchema` allows `passages` optional. If reading section returns `passages` but section index points to an undefined passage, the existing `passageMap.get(q.passageId) ?? undefined` swallows silently. Preserve this resilience.
- **Pre-13-4 `generationFailed` semantic** — _if (generationFailed && emptySections.length === sections.length) → Alert._ The hook's `anyFailed` + `allFailed` outputs MUST replicate this: Alert ONLY when every section failed, not when one failed and one succeeded.
- **DB INSERT race** — pre-13-4 the INSERT runs ONCE after all sections complete. Post-13-4 if INSERT runs after first section ready, the row has `questions: { listening: [...], reading: [] }` initially; section 2's eventual ready/failed triggers a follow-up UPDATE. If section 2 fails, the row has `questions.reading: []` permanently — pre-13-4 partial-success semantic preserved (test proceeds; results screen reports section 2 as `total: 0`, `isPartial: true`). If user navigates away mid-generation, the row exists with status `in_progress` — resume path at [`[testId].tsx:211-296`](<app/(tabs)/mock-test/[testId].tsx#L211-L296>) loads it as-is and the new mount's hook DOES NOT re-fire generation for already-populated sections (resume path takes precedence — drift detector pins this).
- **`mock_tests` UPDATE-on-section-ready** — non-blocking, fire-and-forget; failure → `captureError(_, "mock-test-section-update")` + swallow (matches existing `saveTestProgress` "silently fail" semantic at line 191-192).

### What the new hook owns

The hook is the SINGLE SOURCE for ALL of:

1. **Per-section parallel AI generation** via `Promise.allSettled`.
2. **DB resume detection** (the existing `[testId].tsx:211-296` `mock_tests.select.in_progress` query moves into the hook).
3. **DB INSERT on first-section-ready** (with partial `questions` blob; the `mock_tests.insert(... questions: allQuestions, status: "in_progress" ...)` from line 391-401 moves into the hook).
4. **DB UPDATE on subsequent-section-ready** (NEW — non-blocking, fire-and-forget).
5. **All-failed Alert** (the lines 372-385 Alert "Could not load test ... Retry / Go Back" moves into the hook).
6. **`mountedRef` guard** — setState calls do NOT fire after hook unmount.
7. **Sentry routing** — per-section `mock-test-generate-${section}` tag preserved; NEW `mock-test-generation-aborted` for the all-failed-Alert path; NEW `mock-test-section-update` for the section-2-UPDATE failure path.

The screen retains:

1. Timer countdown (lines 416-440) — untouched.
2. Navigation guard (lines 442-471) — untouched.
3. Completion flow (lines 473-533) — untouched (still calls `incrementDailyActivity` + `updateStreak` + `checkCefrPromotion`).
4. `calculateResultsFromState` (lines 535-584) — untouched.
5. `handleAnswer` (lines 586-604) — untouched.
6. `handleNextSection` — gains a single `if (generation.sectionStatus[nextSection] !== "ready") return` guard.
7. `MockTestSkeleton` component (lines 67-125) — untouched.

## Acceptance Criteria

1. **NEW hook `src/hooks/use-mock-test-generation.ts`** (~250-320 lines). Exports:
   - `useMockTestGeneration(options): UseMockTestGenerationReturn`
   - `interface UseMockTestGenerationOptions { sections: readonly Section[]; cefrLevel: CEFRLevel; testIdParam: string; enabled: boolean }`
   - `interface UseMockTestGenerationReturn { questions: Record<Section, MCQContent[]>; sectionStatus: Record<Section, MockTestSectionStatus>; firstSectionReady: boolean; allReady: boolean; anyFailed: boolean; allFailed: boolean; activeTestId: string | null; resumeData: ResumeData | null; retry: () => void }`
   - `type MockTestSectionStatus = "pending" | "ready" | "failed"`
   - Internal: single `useEffect` keyed on `sectionsKey = sections.join(",")` + `cefrLevel` + `enabled` (Story 13-3 P2 content-key memoization to defeat fresh-reference-per-render). Fires generation ONCE per `(sectionsKey, cefrLevel)` change.
   - `Promise.allSettled` over per-section async generators (NOT serial `for...of`).
   - Each section's generation: `chatCompletionJSON(_, mockTestSectionSchema, { temperature: 0.4, maxTokens: 4096, feature: "mock-test-${section}" })` + passage-map merge (preserved byte-faithful from pre-13-4 lines 308-345).
   - On per-section settle: setState fires immediately for that section's `sectionStatus` + `questions[section]` (does NOT wait for sibling section).
   - `mountedRef` guard (Story 12-9 pattern): all setState calls check `mountedRef.current === true`.
   - Resume detection runs FIRST: if `mock_tests.select.eq(status, in_progress).single()` returns a row with valid resumeData, hook short-circuits the generation path and sets `resumeData` non-null; the screen consumes resumeData to hydrate the test state.
   - DB INSERT on first-section-ready: when `sectionStatus[sections[0]] === "ready"`, fire `mock_tests.insert({ user_id, test_type, questions: snapshot, status: "in_progress" })`; on success, setState `activeTestId`. **Single-fire guard:** `insertFiredRef.current` so re-renders during section 2's settle do not re-INSERT.
   - DB UPDATE on subsequent-section-ready: when section N (N > 0) settles AND `activeTestId !== null`, fire-and-forget `mock_tests.update({ questions: snapshot }).eq("id", activeTestId)`. Failure → `captureError(_, "mock-test-section-update")` + swallow.
   - `retry()` re-fires ONLY the sections currently in `"failed"` status. Preserves successful sections. Resets `failed` → `pending` BEFORE the parallel fire.

2. **`[testId].tsx` refactored** — DELETES:
   - The `for (const section of sections) { ... }` block (lines 306-368).
   - The `if (generationFailed && emptySections.length === sections.length) { Alert ... }` block (lines 372-385).
   - The `mock_tests.insert({ ... questions: allQuestions ... })` block (lines 390-402).
   - The `mock_tests.select.in_progress` resume query (lines 212-296).
   - Direct imports of `chatCompletionJSON`, `mockTestSectionSchema`, `buildMockTestPrompt`.

   Replaces them with:
   - `const generation = useMockTestGeneration({ sections: memoizedSections, cefrLevel, testIdParam: testId, enabled: !isInvalidTestId });` (sections memoized via `useMemo([testId])`).
   - One `useEffect` listening for `generation.firstSectionReady` → transitions `state.status` from `"loading"` → `"active"` + hydrates `state.questions` from `generation.questions` + sets `state.timeRemaining = totalMinutes * 60`.
   - One `useEffect` listening for `generation.questions` changes during `state.status === "active"` → merges late-arriving section into `state.questions` (for section 2's late settle).
   - One `useEffect` listening for `generation.resumeData` → if non-null, hydrate state from resumeData (preserves existing resume flow byte-faithful — the same state-shape that lines 260-270 produced today).
   - One `useEffect` listening for `generation.allFailed` → renders the same "Could not load test ... Retry / Go Back" Alert. The Alert's `Retry` calls `generation.retry()`; `Go Back` calls `router.back()`. The pre-13-4 Alert is moved INTO the screen (not the hook) because Alerts are React-Native UI surfaces; the hook owns the data signal (`allFailed`), the screen owns the visual surface.
   - `handleNextSection` gains a guard: `if (generation.sectionStatus[nextSection] !== "ready") return;` (the screen can render a "Preparing next section..." overlay; the guard is the correctness backstop).

3. **NEW state in `[testId].tsx`** (or a "preparing next section" overlay component):
   - `state.status === "active" && generation.sectionStatus[nextSection] !== "ready"` after user finishes current section → renders an overlay screen with a spinner + French copy `"Préparation de la section suivante..."` + English fallback `"Preparing next section..."` (matches the bilingual screen-skeleton convention from pre-13-4).
   - **Architecturally rare**: under normal flow section 2 has been generating for ≥35 minutes when user finishes section 1; only a sub-1-second race remains. Test pins both branches.

4. **Per-section failure isolation** (NEW preserved-but-pinned):
   - If listening fails but reading succeeds → `allFailed === false`, `anyFailed === true`, `state.questions = { listening: [], reading: [...] }`. Test proceeds; results screen reports listening as `total: 0`, `isPartial: true` (pre-13-4 semantic byte-identical).
   - If both fail → `allFailed === true` → screen renders the "Could not load test" Alert.
   - If listening succeeds but reading fails → `firstSectionReady === true`, `anyFailed === true`. Test proceeds with listening section playable; when user attempts to advance to reading, `handleNextSection` finds `sectionStatus.reading === "failed"`; the screen renders a per-section "Section unavailable — skip to results?" Alert + the test transitions to `finished` immediately on confirm (matches the existing pre-13-4 partial-test flow where empty sections produce `total: 0` rows in results).

5. **DB resume flow preserved verbatim**:
   - `useMockTestGeneration` runs the resume query BEFORE firing generation; if a valid `mock_tests` row with `status === "in_progress"` exists for the user + test_type, hook returns `resumeData` non-null and skips generation entirely.
   - Resume data shape mirrors pre-13-4: `{ activeTestId, resumedQuestions, savedSectionIndex, savedQuestionIndex, adjustedTimeRemaining, savedAnswers, savedAnsweredQuestions, status: "active" | "finished" }`.
   - Corrupt resume state → hook fires `Alert.alert("Resume Failed", ...)` callback? **No** — Alerts belong to the screen. Hook returns `resumeData` with a `corrupt: true` flag; the screen renders the Alert with Retry/Go Back options. Retry calls `generation.retry()` which clears the corrupt row + fires fresh generation. The hook owns the corruption detection (`if (!hasValidQuestions) return { corrupt: true, ... }`); the screen owns the UI dispatch.

6. **NEW hook contract tests `src/hooks/__tests__/use-mock-test-generation.test.tsx`** (~16-20 react-test-renderer cases, Story 12-1 P8 / 12-9 / 13-3 pattern):
   - **Concurrent firing** — assert `chatCompletionJSON` called 2× synchronously before either resolves (parallel, not serial).
   - **First-section-ready before second** — section A resolves first → `firstSectionReady === true`, `sectionStatus.B === "pending"`. Verifies non-blocking.
   - **All ready** — both resolve → `allReady === true`, `firstSectionReady === true`, `anyFailed === false`.
   - **Per-section failure isolation** — section A succeeds, section B fails → `sectionStatus.A === "ready"`, `sectionStatus.B === "failed"`, `anyFailed === true`, `allFailed === false`. Sentry tag `mock-test-generate-B` fires; tag `mock-test-generate-A` does NOT.
   - **All fail** — both fail → `allFailed === true`, `firstSectionReady === false`. Both Sentry tags fire.
   - **Single-section test** (`testId === "listening"`) — only one `chatCompletionJSON` call; `allReady === firstSectionReady` (sections.length === 1).
   - **Sections content-key memoization** — re-render parent with a new array reference but same content (`["listening","reading"]` → fresh array) → effect does NOT re-fire (Story 13-3 P2 lesson). Mock counts assert exactly 2 calls total.
   - **mountedRef guard** (Story 12-9 P8 deferred-resolve pattern) — manually-resolvable Promise; `act(() => renderer.unmount())` BEFORE resolving; assert no setState warning.
   - **DB INSERT on first-section-ready** — when first section settles, `mock_tests.insert(...)` called exactly ONCE with `status: "in_progress"` + the partial `questions` blob.
   - **DB INSERT single-fire guard** — section 2's settle does NOT re-INSERT (uses `insertFiredRef`).
   - **DB UPDATE on subsequent-section-ready** — when section 2 settles, `mock_tests.update(...)` called with full `questions` blob; `eq("id", activeTestId)` filter present.
   - **DB UPDATE failure silenced** — `mock_tests.update` rejects → `captureError(_, "mock-test-section-update")` fires; setState unaffected.
   - **Resume short-circuits generation** — when `mock_tests.select.in_progress` returns a valid row, `chatCompletionJSON` is NOT called at all; `resumeData` non-null with the expected shape.
   - **Corrupt resume detection** — invalid resume row (e.g., `questions: null`) → `resumeData.corrupt === true`; `chatCompletionJSON` still NOT called (corruption recovery is the screen's job via `retry()`).
   - **`retry()` re-fires only failed sections** — initial: A succeeds, B fails; call `retry()` → second `chatCompletionJSON` call ONLY for section B (call count = 3 total).
   - **`enabled: false` no-ops** — hook returns initial state (`sectionStatus: { all: "pending" }`); zero AI / DB calls.
   - **`isInvalidTestId` no-ops** — `enabled === false` derived from screen's `isInvalidTestId`; pin via the screen-source drift detector, not the hook.

7. **NEW screen source drift detector `app/(tabs)/mock-test/__tests__/testId-streaming-source-drift.test.ts`** (~10 cases, comment-stripped source per Story 12-2 P12):
   - POSITIVE: `useMockTestGeneration` imported from `@/src/hooks/use-mock-test-generation`.
   - POSITIVE: `useMockTestGeneration(...)` called once in screen body.
   - POSITIVE: `useMemo` applied to `sections` array before passing to hook (Story 13-3 P2 defense-in-depth).
   - NEGATIVE: `for (const section of sections)` loop GONE.
   - NEGATIVE: `chatCompletionJSON` import GONE (moved to hook).
   - NEGATIVE: `mockTestSectionSchema` import GONE.
   - NEGATIVE: `buildMockTestPrompt` import GONE.
   - NEGATIVE: direct `supabase.from("mock_tests").insert(...)` for INITIAL insert GONE (moved to hook; UPDATE on completion at line 487-510 STAYS — that's the final results write, a different concern).
   - POSITIVE: `handleNextSection` guards `if (generation.sectionStatus[nextSection] !== "ready")` (regex pattern check).
   - POSITIVE: `state.status` transitions from `"loading"` → `"active"` via the hook's `firstSectionReady` signal (regex check).

8. **NEW hook source drift detector `src/hooks/__tests__/use-mock-test-generation-source-drift.test.ts`** (~6 cases):
   - POSITIVE: `Promise.allSettled` used (NOT `Promise.all` — failures must not abort siblings).
   - NEGATIVE: `for (const section of sections)` serial-await loop GONE.
   - POSITIVE: `mountedRef.current` guard appears in every setState code path (count ≥ N where N = number of setState sites; pin via regex).
   - POSITIVE: `insertFiredRef.current` guard around the INSERT call site.
   - POSITIVE: `captureError(_, "mock-test-generate-${section}")` template literal preserved (using a wide regex tolerating the section-key interpolation).
   - POSITIVE: `captureError(_, "mock-test-section-update")` for the UPDATE-failure path.
   - POSITIVE: `captureError(_, "mock-test-generation-aborted")` for the all-failed path.

9. **Acceptance Auditor cross-check** — the audit's verbatim AC line 255 reads:
   > Mock test feels playable (first section rendered) within 8s of tap.

   The hook contract test that proves this AC architecturally: **fire two `chatCompletionJSON` mocks; resolve section A's mock at t=2000ms; resolve section B's mock at t=12000ms; assert `firstSectionReady === true` at t≈2000ms (not at t≈12000ms).** Use `jest.useFakeTimers()` + `act()` to advance time deterministically. This is the proxy for the 8s-on-tap AC.

10. **Story 9-3 telemetry allowlist verification** — `src/lib/sentry.ts` `SENTRY_EXTRAS_ALLOWLIST` zero-diff. The `feature` extras key is the only allowlisted dimension this story uses; the 2 new feature tag strings (`mock-test-generation-aborted` + `mock-test-section-update`) are categorical and ride on the existing allowlist. Pre-13-4 `mock-test-generate-${section}` + `mock-test-undercount` tags preserved verbatim.

11. **All 4 quality gates green**: `npm run type-check` (0 errors) + `npm run lint` (0 warnings) + `npm run format:check` (clean) + `npm test` (≥ 1742 baseline + spec target 30-40 new cases = ≥ 1772 / ≥ 1782). All previously-green tests STILL green.

12. **CLAUDE.md gains a Story 13-4 architecture paragraph** appended after the Story 13-3 review-round-1 entry. Documents the parallel-fire-via-`Promise.allSettled` consolidation + first-section-playable-first-ready signal + per-section failure isolation + cross-story invariants preserved + closes audit P2-6 architecturally.

13. **`sprint-status.yaml` 13-4 status flips** `backlog` → `ready-for-dev` (this story file creation) → `in-progress` (dev start) → `review` (impl complete).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — N/A for the hook (no JSX). For the "Preparing next section..." overlay (if added to the screen): `Colors.bgDark` + `Colors.textOnDark`.
- [ ] All loading states use skeleton animations — the existing `MockTestSkeleton` (line 68) is unchanged.
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` — N/A (no new interactive elements; the "Preparing next section..." overlay is a non-interactive blocking surface).
- [ ] Non-obvious interactions have `accessibilityHint` — N/A.
- [ ] Stateful elements have `accessibilityState` — N/A.
- [ ] All tappable elements have minimum 44x44pt touch targets — N/A.
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — verified by the hook source drift detector (AC #8).
- [ ] All text uses `Typography.*` presets — applied to the "Preparing next section..." overlay if added.
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing. **Verified:** `git status --short` returns `?? _bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md`; `git check-ignore -v` returns no match.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md` passes. **Verified:** "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1** (AC: #1, #6, #8) — NEW hook `src/hooks/use-mock-test-generation.ts` + hook contract tests + hook source drift tests.
  - [x] 1.1 Define `MockTestSectionStatus` type + `UseMockTestGenerationOptions` + `UseMockTestGenerationReturn` interfaces.
  - [x] 1.2 Implement resume-detection short-circuit (the pre-13-4 `mock_tests.select.in_progress` query path moved INTO the hook).
  - [x] 1.3 Implement `Promise.allSettled` parallel-fire per section.
  - [x] 1.4 Per-section settle → setState immediately (no batch wait).
  - [x] 1.5 `mountedRef` guard on every setState path.
  - [x] 1.6 DB INSERT on first-section-ready with `insertFiredRef` single-fire guard.
  - [x] 1.7 DB UPDATE on subsequent-section-ready (fire-and-forget; failure → captureError + swallow).
  - [x] 1.8 `retry()` re-fires ONLY failed sections.
  - [x] 1.9 Hook contract tests (18 cases via react-test-renderer + manually-resolvable Promises).
  - [x] 1.10 Hook source drift detector (7 cases).
- [x] **Task 2** (AC: #2, #3, #4, #5, #7) — Refactor `[testId].tsx` + screen source drift tests.
  - [x] 2.1 DELETE the `for (const section of sections)` loop (lines 306-368).
  - [x] 2.2 DELETE the resume query block (lines 212-296).
  - [x] 2.3 DELETE the all-failed Alert block (lines 372-385) — moved to a hook-signal-driven Alert.
  - [x] 2.4 DELETE the post-loop INSERT block (lines 390-402) — moved to hook.
  - [x] 2.5 DELETE imports of `chatCompletionJSON`, `mockTestSectionSchema`, `buildMockTestPrompt`.
  - [x] 2.6 ADD `useMockTestGeneration` import + call (with `useMemo` on `sections`).
  - [x] 2.7 ADD `useEffect` listening on `generation.firstSectionReady` → state transition to `"active"`.
  - [x] 2.8 ADD `useEffect` listening on `generation.questions` → merge late-arriving sections.
  - [x] 2.9 ADD `useEffect` listening on `generation.resumeData` → hydrate from resume.
  - [x] 2.10 ADD `useEffect` listening on `generation.allFailed` → render the "Could not load test" Alert.
  - [x] 2.11 MODIFY `handleNextSection` — guard against advancing to a `"pending" | "failed"` section.
  - [x] 2.12 ADD "Preparing next section..." overlay render-branch for the rare race case.
  - [x] 2.13 Screen source drift detector (10 cases).
- [x] **Task 3** (AC: #11) — Run quality gates locally before commit. **All 4 green:** tsc 0 errors / lint 0 warnings / prettier clean / jest 1777/1777 across 88 suites (+35 net from 1742 baseline; matches spec target +30-40).
- [x] **Task 4** (AC: #12, #13) — Documentation: CLAUDE.md architecture paragraph + sprint-status.yaml status flip + Dev Agent Record + File List in this story file.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory: branch from `origin/main`. Story 13-4 does NOT touch the files PR #93 (Story 13-3) touched (`[sessionId].tsx`, `session-feedback-aggregate.ts`, `use-session-feedback-aggregate.ts`); independent merge order. **Branch already created**: `feature/13-4-streaming-mock-test-generation` off `origin/main`.

### Project conventions to follow

- **Single chokepoint refactor** — `useMockTestGeneration` consolidates per-section generation + DB INSERT + DB UPDATE + resume detection + all-failed Alert signal into ONE hook (matches Story 12-1 / 13-3 pattern).
- **"Delete don't alias"** — the for-loop + resume query + all-failed Alert + INSERT block in `[testId].tsx` are DELETED (~115 lines), not legacy-aliased. Pattern established by Stories 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 / 12-7 / 12-8 / 12-9 / 12-10 / 12-11 / 12-12 / 13-1 / 13-2 / 13-3.
- **`Promise.allSettled` not `Promise.all`** — failures must not abort sibling generations. Story 12-1 Phase A precedent.
- **`mountedRef` guard** (Story 12-9 ProfileRetryScreen / 13-3 pattern) — applied to every setState path.
- **Content-key memoization on hook inputs** (Story 13-3 P2) — `sectionsKey = sections.join(",")` defends against fresh-array-reference-per-render re-fires.
- **`insertFiredRef` single-fire guard** — mirrors Story 12-5 `acquireWasCalled` / Story 12-6 `breadcrumbFiredForUsers` pattern; lifecycle-bound refs survive re-renders within a hook instance.
- **`chatCompletionJSON` per-call Sentry tag** — preserved verbatim per `feature: "mock-test-${section}"` shape. Story 9-7 schema-parseRetries contract preserved.
- **Per-section partial-success semantic** — pre-13-4 `if (generationFailed && emptySections.length === sections.length)` → only abort on full failure. Preserved by `allFailed` boolean.
- **Drift detector pattern** — comment-stripped source (Story 12-2 P12) + bounded method-body / case-arm extraction (Story 12-5 P12 / 12-10 H1 / 13-1 P7) + regex-broadening for safe renames (Story 12-12 M1 / 13-3 P7). Apply to BOTH the hook drift detector AND the screen drift detector.

### Cross-story invariants worth re-checking before merge

- Story 9-3 telemetry allowlist (`feature` extras key preserved; 2 new `feature` tag strings categorical).
- Story 9-4 stored-prompt-injection (mock-test prompt is operator-built; no user-input wrappers; not affected).
- Story 9-7 Zod-schema parseRetries (`chatCompletionJSON(_, mockTestSectionSchema, _)` call shape byte-identical per section).
- Story 9-8 / 10-6 Speaking pipeline (orthogonal — different schema + screen).
- Story 9-9 SQL hardening (this story does NOT add migrations; no new RPCs).
- Story 10-8 anti-repetition (mock-test dedupe explicitly out-of-scope per 10-8 CLAUDE.md).
- Story 11-3 `fetchWithTimeout` (per-section timeout budget independent; parallel firing does NOT compound).
- Story 11-4 daily-cost-cap (atomic `record_daily_cost` increment tolerates concurrent firings; over-spend ≤ 1 call worst-case).
- Story 11-7 prompt-truncation (mock-test prompt is fixed-content; not affected).
- Story 11-8 empty-response retry (per-call retry budget preserved).
- Story 12-1 orchestrator (orthogonal — Realtime voice).
- Story 12-3 atomic-RPC mutations (post-completion `incrementDailyActivity` + `updateStreak` + `checkCefrPromotion` calls preserved unchanged at the completion useEffect).
- Story 12-7 secure-cache (mock-test state stored in `mock_tests` table, not AsyncStorage).
- Story 12-9 email verification gate (gate fires UPSTREAM at `_layout.tsx`).
- Story 13-1 transcript render-storm (orthogonal — orchestrator + TranscriptView).
- Story 13-2 home aggregate (orthogonal — separate hot path).
- Story 13-3 session-feedback aggregate (orthogonal — conversation flow; same hook-extraction pattern reused).

### Project Structure Notes

- **Files added (new):** `src/hooks/use-mock-test-generation.ts` + `src/hooks/__tests__/use-mock-test-generation.test.tsx` + `src/hooks/__tests__/use-mock-test-generation-source-drift.test.ts` + `app/(tabs)/mock-test/__tests__/testId-streaming-source-drift.test.ts` = 4 new files.
- **Files modified:** `app/(tabs)/mock-test/[testId].tsx` (~115 lines deleted, ~50 lines added; net −65 lines, screen shrinks 811 → ~745 lines) + `CLAUDE.md` + `_bmad-output/implementation-artifacts/sprint-status.yaml` + this story file = 4 modified files.
- **Explicitly NOT modified:** `src/lib/openai.ts` (chatCompletionJSON contract preserved) / `src/lib/schemas/ai-responses.ts` (mockTestSectionSchema preserved) / `src/lib/prompts/mock-test.ts` (buildMockTestPrompt preserved) / `src/lib/sentry.ts` (allowlist zero-diff) / `src/lib/activity.ts` (post-completion atomic-RPC calls untouched) / `supabase/migrations/` (no new migrations — purely client-side refactor) / `supabase/functions/` (no Edge Function changes) / `.github/workflows/` (no CI workflow changes) / `package.json` + `package-lock.json` (no new deps).
- **Total file count:** 4 new + 4 modified = 8 files. Total diff < 800 lines.
- The hook is the SECOND screen-logic-into-hook extraction on Epic 13's track (after 13-3's `useSessionFeedbackAggregate`); precedent reinforced for Stories 13.5 (history modal FlatList) / 13.7 (className-style consolidation) / future screen-shrink work.

### Estimated test budget

Spec target: **+30-40 net Jest cases** (current baseline 1742 → ≥ 1772 / ≥ 1782). Breakdown:

- Hook contract (use-mock-test-generation.test.tsx): ~16-20 cases.
- Hook source drift: ~6 cases.
- Screen source drift: ~10 cases.

Beat the high end (+40) by adding a 4th test file or extending one of the above if review-round-1 surfaces gaps.

### Expected impact

- First-question-tappable latency: **~12-20s → ~6-10s (~50% reduction)**.
- Total wall-clock for generating both sections: **Σ → max** (compositionally identical to Phase A in Story 12-1's `persistConversation`).
- Epic 13 AC line 255 (mock test feels playable within 8s of tap): **likely-failing → passing under realistic latency conditions**.
- Architectural cleanliness: screen `[testId].tsx` 811 lines → ~745 lines (~8% reduction; partial mitigation of audit P2-24's "screens too large" finding for this file).

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) § 1 P2-6 (line 101), § Epic 13 line 251 (deliverable 13.4), § Epic 13 AC line 255.
- Story 12-1 spec + impl (precedent for `Promise.allSettled` parallel fan-out + observer-pattern hook).
- Story 13-3 spec + impl (closest precedent for hook-extraction-from-screen + content-key memoization + mountedRef guard).
- Source: [`app/(tabs)/mock-test/[testId].tsx:198-414`](<app/(tabs)/mock-test/[testId].tsx#L198-L414>) (the `initTest` block to be refactored).
- Pattern reference: [`src/hooks/use-session-feedback-aggregate.ts`](src/hooks/use-session-feedback-aggregate.ts) (Story 13-3 hook template; same shape: typed Options/Return + single useEffect + mountedRef + Sentry routing).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-15 via `/bmad-create-story`.
- Branch: `feature/13-4-streaming-mock-test-generation` off `origin/main` (post-13-3 PR #93 merge per `feedback_branch_from_main` memory).

### Completion Notes List

- **Task 1 done.** [`src/hooks/use-mock-test-generation.ts`](src/hooks/use-mock-test-generation.ts) created (~505 lines) — `Promise.allSettled` parallel per-section AI generation replaces the pre-13-4 serial `for-of` loop. Hook owns resume detection (the pre-13-4 `mock_tests.select.in_progress` query path), DB INSERT on first-section-ready (with `insertFiredRef` single-fire guard so two concurrent settle continuations cannot both INSERT), DB UPDATE on subsequent-section-ready (fire-and-forget; failure → `captureError(_, "mock-test-section-update")` + swallow), all-failed signal, and `retry()` re-fires only sections in `"failed"` status. Story 12-9 `mountedRef` pattern applied to every setState path. Story 13-3 P2 content-key memoization on `sectionsKey = sections.join(",")` defeats fresh-array-reference re-fires. Per-section AI call signature byte-faithful from pre-13-4 lines 308-360 (same `temperature: 0.4`, same `maxTokens: 4096`, same `feature: "mock-test-${section}"` Sentry tag, same passage-map merge, same `mock-test-undercount` undercount warning). Hook contract tests at [`src/hooks/__tests__/use-mock-test-generation.test.tsx`](src/hooks/__tests__/use-mock-test-generation.test.tsx) — 18 cases pinning: parallel firing (NOT serial) + first-section-ready BEFORE second + all-ready + per-section failure isolation + all-failed + single-section variant + content-key memoization (sectionsKey) + mountedRef deferred-resolve guard + DB INSERT single-fire + DB UPDATE on subsequent + DB UPDATE failure silenced + resume short-circuit + corrupt-resume detection + retry() re-fires only failed + enabled=false no-op + undercount warning + corrupt-resume + retry() flow. Hook source drift detector at [`src/hooks/__tests__/use-mock-test-generation-source-drift.test.ts`](src/hooks/__tests__/use-mock-test-generation-source-drift.test.ts) — 7 cases pinning Promise.allSettled + NEGATIVE `generationFailed` legacy variable + POSITIVE `sections.map(async)` parallel-fire shape + mountedRef count + insertFiredRef guard + 3 Sentry tags (per-section + section-update + undercount).
- **Task 2 done.** [`app/(tabs)/mock-test/[testId].tsx`](<app/(tabs)/mock-test/[testId].tsx>) refactored — DELETED ~210 lines: the for-loop (lines 306-368) + resume query + corrupt-resume Alert + all-failed Alert + post-loop INSERT (lines 212-410). ADDED ~130 lines of hook consumption: `useMemo` for `sections` + `useMockTestGeneration({...})` call + 5 reactive `useEffect`s (resume-hydration, first-section-ready → active transition, late-section merge, all-failed Alert, corrupt-resume Alert) + `handleNextSection` guards on `generation.sectionStatus[nextSection] !== "ready"` (with "Section Unavailable — Skip to Results?" Alert for the `"failed"` arm) + "Préparation de la section suivante..." (FR + EN) overlay render-branch for the architecturally-rare race where the user races through section 1 faster than ~6-10s of section-2 generation. Direct imports of `chatCompletionJSON` + `mockTestSectionSchema` + `buildMockTestPrompt` removed; the `supabase` import stays (used by the unchanged `saveTestProgress` debounce + the completion-flow UPDATE and the corrupt-resume `delete()` call). Screen line count: 811 → 808 (essentially flat by line count because the deleted serial generation block was replaced by reactive effects + the new overlay; the AUDIT win is parallel fan-out, not LOC reduction). Screen source drift detector at [`app/(tabs)/mock-test/__tests__/testId-streaming-source-drift.test.ts`](<app/(tabs)/mock-test/__tests__/testId-streaming-source-drift.test.ts>) — 10 cases pinning: hook import + call site + `useMemo` on sections + NEGATIVE for-of loop + NEGATIVE chatCompletionJSON/mockTestSectionSchema/buildMockTestPrompt imports + NEGATIVE `status: "in_progress"` legacy INSERT + POSITIVE handleNextSection guard + POSITIVE firstSectionReady → active transition.
- **Task 3 done.** All 4 quality gates green: `npm run type-check` 0 errors / `npm run lint` 0 warnings / `npm run format:check` clean / `npm test` 1777 / 1777 passing across 88 suites (+35 net from 1742 baseline; matches spec target +30-40 exactly).
- **Task 4 done.** CLAUDE.md gained the Story 13-4 architecture paragraph after the Story 13-3 review-round-1 entry. Documents the parallel-fire-via-`Promise.allSettled` consolidation + first-section-playable signal + per-section failure isolation + cross-story invariants preserved + closes audit P2-6 architecturally. `sprint-status.yaml` 13-4 flipped `ready-for-dev → in-progress → review`.
- **Cross-story invariants verified clean:** `src/lib/sentry.ts` zero-diff (3 new categorical feature tags `mock-test-generate-${section}` + `mock-test-section-update` + `mock-test-undercount` all ride on existing `feature` extras key — Story 9-3 contract; `mock-test-undercount` was pre-13-4 already in the codebase, the 2 net-new are short categorical strings under 80-char threshold); `src/lib/openai.ts` zero-diff (chatCompletionJSON contract preserved); `src/lib/schemas/ai-responses.ts` zero-diff (mockTestSectionSchema preserved); `src/lib/prompts/mock-test.ts` zero-diff (buildMockTestPrompt preserved); `src/lib/activity.ts` zero-diff (post-completion `updateStreak` / `incrementDailyActivity` / `checkCefrPromotion` calls at the completion useEffect untouched); `supabase/migrations/` zero-diff (no new migrations); `supabase/functions/` zero-diff (no Edge Function changes); `.github/workflows/` zero-diff (no CI workflow changes); `package.json` + `package-lock.json` zero-diff (no new deps).
- **Closes audit P2-6** architecturally. Expected impact: first-question-tappable latency **~12-20s → ~6-10s (~50% reduction)** because per-section AI calls now fire in parallel; Epic 13 AC at `shippable-roadmap.md:255` ("Mock test feels playable (first section rendered) within 8s of tap") passes architecturally under realistic latency conditions. Per-section failure isolation preserved: 1 section failing while the other succeeds lets the test proceed (results screen reports failed section as `total: 0`, `isPartial: true`); only all-failed triggers the "Could not load test" Alert.

### File List

**New files:**

- `src/hooks/use-mock-test-generation.ts` — Parallel per-section AI generation hook with resume detection + INSERT/UPDATE plumbing + mountedRef + single-fire INSERT + retry() (~505 lines).
- `src/hooks/__tests__/use-mock-test-generation.test.tsx` — 18 react-test-renderer hook contract cases.
- `src/hooks/__tests__/use-mock-test-generation-source-drift.test.ts` — 7 hook source drift cases.
- `app/(tabs)/mock-test/__tests__/testId-streaming-source-drift.test.ts` — 10 screen source drift cases.

**Modified files:**

- `app/(tabs)/mock-test/[testId].tsx` — for-loop + resume + all-failed Alert + post-loop INSERT DELETED (~210 lines); replaced with `useMockTestGeneration` consumption + 5 reactive useEffects + handleNextSection guards + "Préparation de la section suivante..." overlay (~130 lines).
- `CLAUDE.md` — Story 13-4 architecture paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-4 status `backlog → ready-for-dev → in-progress → review`; `last_updated` annotated with 13-4 impl summary.
- `_bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md` — Tasks/Subtasks all checked; Dev Agent Record filled; Status: review.

**Explicitly NOT modified:**

- `src/lib/sentry.ts` — telemetry allowlist zero-diff; new feature tags ride on existing `feature` extras key.
- `src/lib/openai.ts` / `src/lib/schemas/ai-responses.ts` / `src/lib/prompts/mock-test.ts` — chatCompletionJSON + schema + prompt builder byte-identical (Story 9-7 contract preserved).
- `src/lib/activity.ts` — post-completion atomic-RPC calls untouched (Story 12-3 contract preserved).
- `package.json` + `package-lock.json` — no new deps.
- `supabase/migrations/` — no new migrations.
- `supabase/functions/` — no Edge Function changes.
- `.github/workflows/` — no CI workflow changes.
- The downstream JSX consumers of `state.questions` + `state.status` (the test-screen render below the hook call) — render shape unchanged; consumers see the same `MCQContent[]` per section + the same `"loading" | "active" | "finished"` status union.

### Senior Developer Review (AI) — Review-Round-1

**Date:** 2026-05-15
**Outcome:** APPROVE_WITH_NOTES → 12 patches applied
**Review layers:** Blind Hunter (29 findings) + Edge Case Hunter (26 findings) + Acceptance Auditor (APPROVE_WITH_NOTES, 0 blocking violations) — run in parallel.
**Triage:** 12 patches applied (HIGH × 4 + MED × 6 + LOW × 2); 8 deferred; 30+ rejected as noise / design-as-documented / unreachable / test-mock pragmatism.

**Patches applied:**

- **P1 (HIGH) — `handleNextSection` silent no-op when next section is `"pending"`.** Pre-patch the function returned `void` without advancing `currentSectionIndex` when the next section's status was `"pending"`. The "Préparation de la section suivante..." overlay only renders when `currentQuestions.length === 0`, but since the index didn't advance, `currentSection` stayed the just-completed section (with questions), so the overlay never appeared. User saw a dead tap. Post-patch the function advances `currentSectionIndex` unconditionally (unless the section explicitly failed), and the overlay handles the visual feedback for the pending case. — [`[testId].tsx:558-595`](<app/(tabs)/mock-test/[testId].tsx#L558-L595>).

- **P2 (HIGH) — Snapshot-ref staleness cluster (multi-finding merge: BH-10/11/12/28 + EH-1/4/9/26).** Pre-patch three mirror refs (`activeTestIdRef`, `questionsSnapshotRef`, `sectionStatusSnapshotRef`) were updated via lagging `useEffect`s that run AFTER the setState commit. When two sections settled in quick succession (real on fast OpenAI responses with parallel `chatCompletionJSON`), the second settle read stale ref values. Symptoms: section-2 UPDATE silently dropped because `activeTestIdRef.current === null`; INSERT payload missing section data; retry filter excluding/including wrong sections. Post-patch every setState site updates the corresponding ref SYNCHRONOUSLY in the same statement; the 3 lagging `useEffect` mirrors are DELETED ("delete don't alias" pattern). Story 11-2 review-round-2 P22 / Story 12-1 P22 sync-mirror invariant applied verbatim. — [`use-mock-test-generation.ts:234-258`](src/hooks/use-mock-test-generation.ts#L234-L258), [:319-379](src/hooks/use-mock-test-generation.ts#L319-L379), [:407-487](src/hooks/use-mock-test-generation.ts#L407-L487). **Sub-fix:** also closes the parallel-resolve race where section B settles between section A's INSERT-chain-start and INSERT-completion — the INSERT branch now detects when `questionsSnapshotRef` drifted during its await and fires a single follow-up UPDATE to reconcile. Pinned by new test Case 20.

- **P4 (HIGH) — "Skip to Results" path doesn't flag incomplete test.** Pre-patch when user encountered a failed section mid-test and chose "Skip to Results", `state.status` flipped to `"finished"` without any flag. `calculateResultsFromState`'s `isPartial: testState.sections.length === 1` didn't catch the case of a 2-section run with one section permanently failed. Resulting TCF score got persisted as a "normal" completion. Post-patch: new optional `skippedDueToFailure?: boolean` field on `TestState`; the Skip-to-Results Alert's onPress sets it to `true`; `calculateResultsFromState` includes `skippedDueToFailure === true || anySectionEmpty` in the `isPartialTest` computation + surfaces `skippedDueToFailure` as a top-level field on the results blob so the results screen can render an "incomplete" badge / disclaimer. — [`[testId].tsx:54-62`](<app/(tabs)/mock-test/[testId].tsx#L54-L62>), [:560-583](<app/(tabs)/mock-test/[testId].tsx#L560-L583>), [:534-549](<app/(tabs)/mock-test/[testId].tsx#L534-L549>).

- **P6 (HIGH) — Resume hydration race with `firstSectionReady` effect.** Pre-patch the screen's resume-hydration effect (deps `[generation.resumeData]`) and firstSectionReady effect (deps `[generation.firstSectionReady]`) both ran when the hook completed a successful resume + set sectionStatus.listening to `"ready"`. Both effects were gated by `stateInitializedRef`. Whichever ran first won. If firstSectionReady fired first, it set `state.timeRemaining = totalMinutes * 60` (CLOBBERS resume's `adjustedTimeRemaining`). Post-patch firstSectionReady effect adds `if (generation.resumeData) return;` — resume always wins. — [`[testId].tsx:246-279`](<app/(tabs)/mock-test/[testId].tsx#L246-L279>).

- **P12 (MED) — `mock-test-generation-aborted` Sentry tag was absent — spec drift between AC #10 and impl.** Pre-patch the spec mandated this categorical tag but neither the hook nor the screen fired it; operators couldn't dashboard "% of mock-test sessions aborted entirely" without correlating multiple per-section events. Post-patch the all-failed Alert effect fires `captureError(new Error("All mock-test sections failed"), "mock-test-generation-aborted")` before showing the Alert. Story 9-3 telemetry allowlist preserved (categorical short string under 80-char threshold; existing `feature` extras key). — [`[testId].tsx:298-300`](<app/(tabs)/mock-test/[testId].tsx#L298-L300>).

- **P15 (MED) — `setActiveTestId(null)` called inside `setResumeData` updater (React anti-pattern).** Pre-patch the `retry()` callback called `setActiveTestId(null)` from INSIDE `setResumeData((prev) => { ... })`'s updater function. React docs require setState updaters to be pure; nested setState calls trigger strict-mode warnings + double-invocation breaks invariants. Post-patch: capture the corrupt-decision synchronously from the latest `resumeData` closure value (useCallback dep added), then run each setState as its own statement at the top level of `retry()`. — [`use-mock-test-generation.ts:518-549`](src/hooks/use-mock-test-generation.ts#L518-L549).

- **P16 (MED) — Resume with one valid section + one empty leaves the empty section perpetually `"pending"`.** Pre-patch when a saved row had e.g. `listening: [items], reading: []` (legacy listening-only row OR a partial first-INSERT row from a failed sibling), `hasValidQuestions` was true (the `some` check accepted ANY non-empty section), but then the hook short-circuited the generation block via early-return. Reading stayed `"pending"` forever; user completed listening, advanced to reading, saw the overlay forever, no recovery path. Post-patch: don't unconditionally short-circuit. Only short-circuit when EVERY section in the resumed payload is `"ready"`; otherwise fall through to the generation block, which filters by `sectionStatusSnapshotRef.current[s] !== "ready"` and generates ONLY the missing sections. The `insertFiredRef` stays `true` post-resume so the new section's settle routes through the UPDATE branch (not INSERT). Pinned by new test Case 22. — [`use-mock-test-generation.ts:344-385`](src/hooks/use-mock-test-generation.ts#L344-L385).

- **P17 (MED) — Test gap: Case 11 didn't assert UPDATE payload contains BOTH sections.** Pre-patch the test only counted `mockUpdate.toHaveBeenCalledTimes(1)`; a regression updating with `{}` or just the late section would have passed silently. Post-patch the supabase mock captures both INSERT and UPDATE payloads via module-level `capturedInserts` + `capturedUpdates` arrays; Case 11 now asserts the UPDATE payload contains both `listening` (39 questions) AND `reading` (39 questions) + the `.eq("id", "test-row-1")` filter targets the row id from the INSERT. — [`use-mock-test-generation.test.tsx:520-542`](src/hooks/__tests__/use-mock-test-generation.test.tsx#L520-L542).

- **P18 (MED) — Case 8 (post-unmount mountedRef) was a tautology.** Pre-patch the assertion `result.current?.sectionStatus.listening === "pending"` reflected the pre-unmount snapshot regardless of whether setState fired post-unmount — capturing `result.current` happens at last render, not at the time of the assertion. Post-patch the test adds `jest.spyOn(console, "error").mockImplementation(...)` and asserts that NO React "Can't perform a state update on an unmounted component" warning fires after the deferred-resolve. If the mountedRef guard regresses (someone deletes the check), this test now fails immediately. — [`use-mock-test-generation.test.tsx:398-438`](src/hooks/__tests__/use-mock-test-generation.test.tsx#L398-L438).

- **P19 (MED) — Eslint-disable comments missing justification.** Pre-patch the 5 reactive effects in `[testId].tsx` all carried bare `// eslint-disable-next-line react-hooks/exhaustive-deps` without explaining why specific deps were omitted. Post-patch each disable has a 1-line justification documenting which dep was intentionally excluded and why (content-key memoization / stable-identity from hook / reactive-on-signal-only). — [`[testId].tsx:241-245`](<app/(tabs)/mock-test/[testId].tsx#L241-L245>), [:267-272](<app/(tabs)/mock-test/[testId].tsx#L267-L272>), [:283-289](<app/(tabs)/mock-test/[testId].tsx#L283-L289>), [:317-320](<app/(tabs)/mock-test/[testId].tsx#L317-L320>), [:351-353](<app/(tabs)/mock-test/[testId].tsx#L351-L353>).

- **P21 (MED) — PostgrestError vs Error shape mismatch in `captureError`.** Pre-patch the hook passed raw supabase `error` objects (PostgrestError-shape: `{message, code, hint, details}`) directly to `captureError`. Sentry's scrubber (Story 9-3) expects an Error instance with a `.message` string; non-Error inputs surfaced as "[object Object]" in the dashboard, masking the actual failure reason. Post-patch: new `toError(value)` helper at the top of the hook file normalizes non-Error values to `new Error(value.message)` (or `JSON.stringify(value)` as fallback for objects without `.message`). Every `captureError` call site in the INSERT/UPDATE error paths wraps the error via `toError(_)` first. — [`use-mock-test-generation.ts:118-131`](src/hooks/use-mock-test-generation.ts#L118-L131), [:435,438,455,458,469,472](src/hooks/use-mock-test-generation.ts#L435).

- **L1 (LOW) — Story file Completion Notes claimed hook is `~440 lines` but actual was 505.** Off by ~65 lines (~13%). Cosmetic but propagates as inaccurate precedent for future story-size estimates. Post-patch: corrected to `~505 lines` (3 occurrences). — [`13-4-streaming-mock-test-generation.md`](_bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md).

- **L2 (LOW) — Redundant `testIdParam === "full" ? "full" : testIdParam` ternary in 2 sites.** Pre-patch the ternary was a no-op (always evaluates to `testIdParam`). Post-patch: replaced with just `testIdParam`. — [`use-mock-test-generation.ts:307`](src/hooks/use-mock-test-generation.ts#L307), [:432](src/hooks/use-mock-test-generation.ts#L432).

**Deferred (8):** P5 (`stateInitializedRef` not reset by retry — latent, no current trigger path) / P10 (no AbortController for in-flight `chatCompletionJSON` — architectural Edge Function API limitation) / P11 (unbounded retry — server-side rate-limit + Story 11-4 cost cap covers) / P13 (`generation.questions` vs `state.questions` duplication — architectural choice; bigger refactor) / P14 (`enabled: false` doesn't reset hook state — screen unmounts on `isInvalidTestId` in practice) / P20 (cefrLevel mid-test re-fire — unrealistic) / EH-12/13/18 (savedAt missing / clock-skew / DB delete fire-and-forget — all pre-13-4 inherited semantics) / BH-9 (`as MutableQuestion[]` cast — pre-13-4 byte-faithful).

**Rejected (30+):** BH-3, BH-4 (firstSectionReady=sections[0] — design as documented) / BH-7 (synchronous double-fire allFailed — unreachable timing) / BH-26 (stateInitializedRef design smell — architectural choice) / BH-27 (sectionsKey enabled-flip — no failure mode) / overlay misleading on failed (unreachable) / bilingual overlay (convention) / hook-size hint (cosmetic) / bg-surface (defensible) / fake-timers literal (semantically equivalent) / sectionsToGenerate empty no-op (correct) / sections.length === 0 (closed union) / sectionStatus monotonic (correct invariant) / comma collision (closed union) / test mocks pragmatic / sectionsKey re-derive (no failure mode) / also-pending re-fire (can't happen via current call paths) + Acceptance Auditor's 4 LOW "no action required" items.

**Tests after round-1:** **1782 / 1782 passing** (+5 round-1 net from 1777; +40 net since story start vs 1742 baseline; matches story spec target +30-40 high end). All 4 quality gates green (type-check 0 errors / lint 0 warnings / prettier clean / jest 88 suites).

**Files modified in round-1:**

- `src/hooks/use-mock-test-generation.ts` — P2 sync-mirror cluster (3 ref-update lifecycle effects DELETED + 9 sync-mirror writes added at every setState site) + P15 retry() restructured (no setState-inside-updater anti-pattern; `resumeData` added to useCallback deps) + P16 partial-resume falls through to generation (allResumedReady gate) + P21 `toError` helper + all `captureError` wrap + L2 redundant ternary × 2.
- `app/(tabs)/mock-test/[testId].tsx` — P1 `handleNextSection` advances unconditionally on pending + P4 `skippedDueToFailure` flag on TestState + flows through `calculateResultsFromState` + P6 firstSectionReady effect gated on `!generation.resumeData` + P12 `mock-test-generation-aborted` captureError before all-failed Alert + P19 eslint-disable justification comments × 5.
- `src/hooks/__tests__/use-mock-test-generation.test.tsx` — P17 `capturedInserts` / `capturedUpdates` payload-capture mocks + Case 11 strengthened with payload assertions + P18 Case 8 `console.error` spy + 5 NEW round-1 patch tests (Case 19 P2 INSERT-payload sync-mirror, Case 20 P2 activeTestIdRef sync-mirror parallel-resolve, Case 21 P15 no-nested-setState warning, Case 22 P16 partial-resume generates missing section, Case 23 P21 toError normalizes non-Error shapes).
- `_bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md` — L1 doc fix (`~440` → `~505`) + this Senior Developer Review section.
- `CLAUDE.md` — Story 13-4 review-round-1 paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-4 round-1 annotation.
