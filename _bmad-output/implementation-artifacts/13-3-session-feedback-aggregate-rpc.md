# Story 13.3: Session Feedback Aggregate RPC — single `get_session_feedback_aggregate` consolidating 4-effect waterfall

Status: review

## Story

As a **TCF Canada exam-prep user finishing a voice conversation**,
I want **the post-conversation feedback screen to load comparison + milestone + error-journey data in one round-trip**,
so that **the milestone banner + comparison chart + error counter all appear together instead of streaming in over 2-4 seconds across 6 sequential queries — one of which fetches my entire conversation history every time**.

## Background — Why This Story Exists

### What audit finding P2-4 owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 — `P2-4`:

> Conversation feedback fan-out — 4 sequential effects, ~7 unbounded queries on each `[sessionId]` mount
> `app/(tabs)/conversation/[sessionId].tsx:237-456` | performance

### The 4-effect waterfall + the unbounded query

[`app/(tabs)/conversation/[sessionId].tsx:242-461`](app/(tabs)/conversation/[sessionId].tsx#L242-L461) fires 4 `useEffect` blocks when `conversation.feedback` arrives. Each effect runs 1-3 queries against Supabase:

**Effect 1 — Session comparison** (lines 242-318):
- Query 1: `conversations.select(ai_feedback, duration_seconds, completed_at).eq(user_id).eq(status, completed).neq(id, current).order(completed_at DESC).limit(1).single()` — fetches the most-recent previous conversation.
- Client-side filter: drop comparison if `completed_at > 21 days ago` (could be server-side).

**Effect 2 — Milestone detection** (lines 321-421):
- Query 1: `profiles.select(current_cefr_level).eq(id).single()` — for CEFR-promotion detection.
- **Query 2 — THE UNBOUNDED ONE**: `conversations.select(ai_feedback).eq(user_id).eq(status, completed).neq(id, current)` — fetches ALL previous completed conversations to compute `max(fluencyRating)` + `max(grammarRating)`. For a power user with 200+ conversations, this returns 200+ JSONB blobs (~1KB each) = ~200KB transferred just to compute 2 scalars.
- Query 3: `error_patterns.select(error_description).eq(user_id).eq(resolved, true).gte(last_occurred, 5-min-ago).order(last_occurred DESC).limit(1).maybeSingle()` — recent error-resolution detection.

**Effect 3 — Error journey counts** (lines 424-461):
- Query 1: `error_patterns.count.eq(user_id)` — total count.
- Query 2: `error_patterns.count.eq(user_id).eq(resolved, true)` — resolved count.
- **Two-query race identical to Story 13-2 P2**: concurrent UPDATE flipping `resolved` between the queries could produce `resolved > total`.

**Effect 4 — Contextual next action** (lines 464+): 0 queries (pure computation from `conversation.feedback`).

**Total: 6 queries per feedback arrival.** Plus the context-fetch effect at mount (memories + getTopErrors = 2 more queries) brings the per-session-view query count to 8 — matching the audit's "~7" estimate (counting the inner subqueries).

### What gets faster, exactly

| Metric                                              | Pre-13-3                                      | Post-13-3                                       |
| --------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Supabase round-trips per feedback arrival           | 6                                             | 1 (single aggregate RPC)                        |
| `conversations` rows transferred per call           | N (all prev completed; ~200 for power users)  | 0 (server-side MAX, returns 2 scalars)          |
| `error_patterns` round-trips                        | 3 (1 recent resolved + 2 count race)          | 0 (folded into aggregate)                       |
| Feedback-screen latency on 4G (architectural proxy) | ~1.5-3s                                       | ~0.4-0.7s                                       |
| Race-prone count math (`resolved > total` possible) | YES (Story 13-2 P2 mirror)                    | NO (single FILTER snapshot)                     |

### Cross-story invariants to preserve

- **Story 9-3 telemetry allowlist** — pre-13-3 the 4 effects had 5 distinct `captureError` feature tags (`session-comparison-fetch`, `milestone-detection`, `error-journey-total-query`, `error-journey-resolved-query`, `error-journey-fetch`). Post-13-3 collapses to **one new tag** `session-feedback-aggregate-fetch` (categorical short string under 80-char threshold). The pre-13-3 tags can be deleted (matching Story 13-2 P6 pattern), OR retained as backward-compat per the consumer-side error-routing decision below.
- **Story 9-9 SQL hardening** — new RPC has SECURITY DEFINER + SET search_path = public + auth.uid defense-in-depth + REVOKE EXECUTE + GRANT EXECUTE TO authenticated. Matches Story 11-4 / 11-6 / 12-3 / 13-2 atomic-RPC pattern.
- **Story 11-4 daily-cost-cap** — orthogonal. No AI calls in this story.
- **Story 12-3 atomic-RPC mutations** — orthogonal. This is a READ RPC.
- **Story 12-7 secure-cache routing** — the aggregate is non-PII (current_cefr_level + max scalars + counts) → AsyncStorage. No `SECURE_CACHE_KEYS` addition.
- **Story 13-1 transcript render-storm fix** — orthogonal (TranscriptView + RealtimeOrchestrator).
- **Story 13-2 home aggregate** — companion pattern; share the same single-chokepoint RPC discipline.
- **`conversation.feedback` arrival semantics** — the existing `onConversationEnd` callback at line 236-238 sets `feedbackVisible = true`. Post-13-3 the aggregate fetch happens INSIDE the new hook (`useSessionFeedbackAggregate`) which is keyed on `(conversationId, preConversationCefrLevel)` — the hook fires the RPC exactly once per feedback arrival, then derives all 4 effect-outputs from the single result.

### Why a single RPC, not 4 separate effect queries

Same logic as Story 13-2: PostgREST treats each `supabase.from(...)` chain as an independent HTTP request. 6 round-trips × ~100ms RTT on 4G = ~600ms minimum. A single RPC returning JSONB collapses to one round-trip + Postgres-side parallel execution.

The CRITICAL improvement is the **unbounded query elimination**: pre-13-3 the milestone-detection effect transferred ALL of a user's previous `ai_feedback` JSONBs over the wire to compute 2 scalars (`max_fluency`, `max_grammar`). Post-13-3 the MAX runs server-side; the response carries 2 numbers, not 200 JSONBs.

### Why a hook + the aggregate, not just inlined queries

The 4 effects are scattered across `[sessionId].tsx:242-461` (~220 lines of feedback-aggregation logic embedded in a 1296-line screen). Story 12-1's "single chokepoint refactor" pattern (and Story 12-24's "screens too large" finding) point to extraction.

New `useSessionFeedbackAggregate({ conversationId, preConversationCefrLevel, currentFeedback, currentDurationSeconds, allCorrections })` hook returns `{ comparisonMetrics, milestone, errorJourney, nextAction }` — the same 4 pieces of state the screen currently maintains. Internal: 1 `useEffect` keyed on (conversationId, currentFeedback) firing the RPC + computing derived state.

### What `[sessionId].tsx` looks like post-13-3

The 4 useEffects collapse to a single hook call:

```typescript
const { comparisonMetrics, milestone, errorJourney, nextAction } = useSessionFeedbackAggregate({
  conversationId: conversation.conversationId,
  preConversationCefrLevel,
  currentFeedback: conversation.feedback,
  currentDurationSeconds: conversation.durationSeconds,
  allCorrections: conversation.allCorrections,
});
```

The 4 `useState` declarations + 4 `useEffect` blocks (~220 lines) are DELETED. Screen drops from ~1296 → ~1080 lines (~17% reduction — partial mitigation of audit P2-24's "screens too large" finding for this file specifically).

## Acceptance Criteria

1. **NEW migration `supabase/migrations/20260516000000_get_session_feedback_aggregate_rpc.sql`** — adds `get_session_feedback_aggregate(p_user_id UUID, p_conversation_id UUID, p_pre_cefr_level TEXT, p_now TIMESTAMPTZ DEFAULT now()) RETURNS JSONB`. Story 9-9 hardening (SECURITY DEFINER + SET search_path = public + `auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION` + REVOKE/GRANT TO authenticated). Returns a single JSONB object with these 5 top-level keys:
   - `prev_session`: object `{ ai_feedback (jsonb), duration_seconds (int), completed_at (timestamptz) }` or null. **Server-side 21-day cutoff** — only included if `completed_at >= p_now - INTERVAL '21 days'`.
   - `cefr_promotion`: object `{ from: text, to: text }` or null. Server compares `p_pre_cefr_level` vs the user's CURRENT `profiles.current_cefr_level`; non-null only if they differ.
   - `max_fluency_rating`: number — MAX of `(ai_feedback->>'fluencyRating')::numeric` across all completed conversations for the user excluding `p_conversation_id`. Returns 0 if no previous conversations.
   - `max_grammar_rating`: number — MAX of `(ai_feedback->>'grammarRating')::numeric` excluding `p_conversation_id`. Returns 0 if no previous conversations.
   - `recent_resolved_error`: object `{ error_description: text }` or null. Single most-recent `error_patterns` row with `resolved = true AND last_occurred >= p_now - INTERVAL '5 minutes'`.
   - `error_counts`: object `{ total: int, resolved: int }` — single-query atomic snapshot via `COUNT(*) FILTER` (Story 13-2 P2 pattern).

2. **NEW client helper `src/lib/session-feedback-aggregate.ts`** (~150 lines):
   - Type `SessionFeedbackAggregate` mirroring the JSONB shape.
   - Function `getSessionFeedbackAggregate(userId, conversationId, preCefrLevel | null): Promise<SessionFeedbackAggregate>` calling the RPC.
   - On RPC error: routes through `captureError(_, "session-feedback-aggregate-fetch")` + throws.
   - Defensive `isValidSessionFeedbackAggregate(value): value is SessionFeedbackAggregate` shape-guard (per-key + per-nested-row presence checks).
   - Client passes `p_now: new Date().toISOString()` per Story 13-2 P3 timezone-consistency pattern.

3. **NEW hook `src/hooks/use-session-feedback-aggregate.ts`** (~200 lines):
   - Signature: `useSessionFeedbackAggregate({ conversationId, preConversationCefrLevel, currentFeedback, currentDurationSeconds, allCorrections }): { comparisonMetrics, milestone, errorJourney, nextAction }`.
   - Internally: single `useEffect` keyed on `(conversationId, currentFeedback, allCorrections, currentDurationSeconds, preConversationCefrLevel, userId)` that fires `getSessionFeedbackAggregate` ONCE per feedback arrival.
   - Derives the 4 output pieces from the single RPC response + the current feedback + corrections data — same algorithms as pre-13-3 inline code, just operating on the aggregate's pre-computed scalars instead of running its own max/filter math.
   - Internal `useState` for the 4 outputs + `mountedRef` guard for the stale-resolve-after-unmount race (Story 12-9 ProfileRetryScreen pattern).
   - Sentry tag `session-feedback-aggregate-fetch` on the RPC error path; pre-13-3 5 tags are DELETED ("delete don't alias" pattern; the 4 effects no longer exist to fail individually).

4. **`[sessionId].tsx` refactored** — DELETES:
   - 4 `useState` declarations (lines 172-184: `comparisonMetrics`, `milestone`, `errorJourney`, `nextAction`).
   - 4 `useEffect` blocks at lines 242-461 (~220 lines total).
   - Direct `supabase.from("conversations").select(...)` calls.
   - Direct `supabase.from("error_patterns").count` calls.
   - Direct `supabase.from("profiles").select("current_cefr_level")` call.
   - Replaces them with a single `useSessionFeedbackAggregate(...)` call returning the same 4 pieces of state.
   - The `preConversationCefrLevel` state + `cefrCapturedRef` + the small effect at line 222-227 capturing it STAY — they belong to the screen, not the aggregate.
   - `nextAction` derivation involves `conversation.allCorrections` (Story 11-1 corrections array) — passed into the hook as input.

5. **Migration drift detector `src/lib/__tests__/get-session-feedback-aggregate-rpc-migration-drift.test.ts`** (~12 cases): function signature + Story 9-9 hardening + REVOKE/GRANT + all 5 top-level JSONB keys + 21-day cutoff + 5-minute cutoff + `COUNT(*) FILTER` atomic-snapshot pattern (P2 mirror) + MAX scalar computation server-side + idempotent CREATE OR REPLACE + `p_now` parameter wiring (Story 13-2 P3 timezone pattern).

6. **Client helper drift detector `src/lib/__tests__/session-feedback-aggregate.test.ts`** (~15 cases): RPC arg shape (4 args including `p_now` ISO string) + Sentry routing on error + 10-case `isValidSessionFeedbackAggregate` accept/reject matrix (each top-level key + nested-row validation).

7. **Hook contract test `src/hooks/__tests__/use-session-feedback-aggregate.test.tsx`** (~10 cases) — react-test-renderer based (Story 12-1 P8 / 12-9 pattern):
   - Hook calls `getSessionFeedbackAggregate` ONCE per feedback arrival (not 4 separate fetches).
   - `comparisonMetrics` derived correctly from `prev_session` (Fluency / Grammar / Duration rows).
   - `milestone` priority order: CEFR promotion > personal best > error resolution > null.
   - Personal best detection: `currentFluency > maxFluency && maxFluency > 0`.
   - `errorJourney` is null when total=0; populated otherwise.
   - `nextAction` derived from `conversation.allCorrections` + `feedback.improvements` text.
   - Sentry tag `session-feedback-aggregate-fetch` on RPC failure.
   - `mountedRef` guard: setState calls do NOT fire after unmount.
   - Skip when `conversationId` or `currentFeedback` is null/undefined.
   - 21-day-old prev_session correctly excluded (server enforces; client passes through).

8. **Source drift detector `app/(tabs)/conversation/__tests__/sessionId-aggregate-source-drift.test.ts`** (~7 cases): hook import + call site + NEGATIVE supabase.from(...) guards for the 5 pre-13-3 direct queries (`conversations.select`, `profiles.select.current_cefr_level`, `error_patterns.count`, `error_patterns.select(error_description)`) — all GONE from `[sessionId].tsx` post-13-3.

9. **pgTAP-style manual-run SQL test `supabase/migrations/__tests__/get_session_feedback_aggregate_test.sql`** (~9 assertions): hardening verification + happy path with all 5 keys populated + empty-user (no previous conversations) → null + 0s + cross-user defense (auth.uid EXCEPTION) + 21-day cutoff (seed conversation 22 days ago → prev_session null) + 5-minute resolved-error cutoff + MAX scalar correctness + CEFR-promotion detection (pre vs current differ) + `COUNT(*) FILTER` atomicity. NOT CI-wired (Epic 15.3 scope; Story 11-4 / 11-6 / 12-3 / 13-2 precedent).

10. **All quality gates green**: tsc 0 errors / lint 0 warnings / prettier clean / jest ≥ 1687 + 30-40 new cases = ≥ 1717.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` (N/A — no styling)
- [ ] All loading states use skeleton animations (N/A — pre-13-3 already had null-state UI)
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` (N/A — no new interactive elements)
- [ ] Non-obvious interactions have `accessibilityHint` (N/A)
- [ ] Stateful elements have `accessibilityState` (N/A)
- [ ] All tappable elements have minimum 44x44pt touch targets (N/A)
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets (N/A)
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files".
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/13-3-session-feedback-aggregate-rpc.md` passes.

## Tasks / Subtasks

- [x] **Task 1** (AC: #1, #5, #9) — Migration + drift detector + pgTAP test.
- [x] **Task 2** (AC: #2, #6) — Client helper `session-feedback-aggregate.ts` + tests.
- [x] **Task 3** (AC: #3, #7) — New hook `use-session-feedback-aggregate.ts` + tests.
- [x] **Task 4** (AC: #4, #8) — Refactor `[sessionId].tsx` + source drift detector.
- [x] **Task 5** (AC: #10) — Run quality gates.
- [x] **Task 6** (Documentation) — CLAUDE.md + sprint-status flip.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory: branch from `origin/main`. Story 13-3 does NOT touch the files PR #92 (Story 13-2) touched (`use-progress.ts`, `use-daily-briefing.ts`, `memory.ts`, `home-aggregate.ts`, `cache.ts`); independent merge order.

### Project conventions to follow

- **Single chokepoint refactor** — `getSessionFeedbackAggregate` consolidates 6 queries into 1; `useSessionFeedbackAggregate` extracts the 4-effect logic into a single hook chokepoint.
- **"Delete don't alias"** — the 4 useState + 4 useEffect blocks in `[sessionId].tsx` are DELETED; the 5 pre-13-3 Sentry tags are DELETED.
- **Atomic RPC pattern** (Story 12-3 / 13-2) — Story 9-9 hardening applied verbatim.
- **Bounded-budget pattern** — server-side MAX returns 2 scalars instead of N-row JSONB list; 21-day + 5-min cutoffs enforced server-side instead of client-side filter-after-fetch.
- **`COUNT(*) FILTER` atomic snapshot** (Story 13-2 review-round-1 P2) — applied to error_counts.
- **`p_now timestamptz` timezone consistency** (Story 13-2 review-round-1 P3) — applied to both cutoffs.
- **`mountedRef` guard** (Story 12-9 ProfileRetryScreen pattern) — applied to the new hook's setState calls.
- **Hook public-API byte-identical** — the screen consumes `comparisonMetrics`, `milestone`, `errorJourney`, `nextAction` — the same 4 pieces of state. The downstream JSX consuming these 4 pieces does NOT need to change.
- **Drift detector pattern** — comment-stripped source (Story 12-2 P12) + bounded method/case-arm extraction (Story 12-5 P12 / 12-10 H1 / 13-1 P7).

### Cross-story invariants worth re-checking before merge

- Story 9-3 telemetry allowlist (`feature` extras key preserved; ONE new `feature` tag string).
- Story 9-4 stored-prompt-injection (`error_description` flows through DB → consumer; `sanitizeMemoryContent` is NOT applied here today and was NOT in the pre-13-3 path either — not a regression but flag as possible follow-up).
- Story 9-9 SQL hardening (applied to new RPC).
- Story 11-1 corrections array (`allCorrections` passed unchanged to the hook).
- Story 11-2 reconnect + barge-in (orthogonal).
- Story 12-1 orchestrator (orthogonal).
- Story 12-3 atomic-RPC mutations (orthogonal — read-only RPC).
- Story 12-7 secure-cache (no PII in aggregate → AsyncStorage path).
- Story 13-1 transcript render-storm (orthogonal).
- Story 13-2 home aggregate (companion pattern; same hardening + p_now + FILTER patterns applied).

### Known footguns (from prior story retros)

- **Story 13-2 review-round-1 P2 lesson** — TWO-QUERY COUNT race for error_counts. The same pattern lives in `[sessionId].tsx:424-461` (Effect 3); fix it with `COUNT(*) FILTER` atomic snapshot at RPC time.
- **Story 13-2 review-round-1 P3 lesson** — UTC/local-timezone mixing. The pre-13-3 `[sessionId].tsx:394` uses `new Date(Date.now() - 5 * 60 * 1000).toISOString()` (client-time, UTC) for the 5-min cutoff. Server-side this should also accept `p_now` so the cutoff is consistent with the client's "now" perception.
- **Story 13-2 review-round-1 P5 lesson** — unsafe TypeScript casts hiding structural mismatches. The new `SessionFeedbackAggregate` type should be the source of truth for what the hook returns; no `as` casts to widen.
- **Story 13-2 review-round-1 P7/P8 lessons** — shape guard rejection matrix + per-row inner validation. Apply both to `isValidSessionFeedbackAggregate`.
- **Story 12-1 review-round-1 P8 lesson** — react-test-renderer for hook contract tests. Use `create` + `act` (Story 12-9 EmailVerificationGate.test.tsx pattern).
- **Story 13-1 review-round-1 P1 lesson** — over-applied spec hint. The audit says "single hook backed by a SQL view returning aggregates" — but a SQL VIEW is NOT the right primitive here (PostgreSQL views can't take parameters; we need a function). The "view" wording in the audit is loose; the impl correctly uses a FUNCTION returning JSONB.

### Project Structure Notes

- 1 new migration + 2 new source files (helper + hook) + 4 new test files + 1 modified screen + 2 modified docs + 1 modified sprint-status = 11 files total.
- The hook is the FIRST extraction-of-screen-logic-into-a-hook on Epic 13's track; sets precedent for Stories 13.4/13.5/13.7's mock-test + history modal + className-style consolidations.
- `app/(tabs)/conversation/[sessionId].tsx` shrinks from ~1296 → ~1080 lines (~17% reduction). Audit P2-24's "screens too large" finding (1291 lines pre-13-3) gets partial mitigation.

### References

- Audit: `_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 P2-4, § Epic 13 line 250.
- Story 13-2 spec + impl (closest precedent for the aggregate-RPC pattern).
- Source: [`app/(tabs)/conversation/[sessionId].tsx:242-461`](app/(tabs)/conversation/[sessionId].tsx#L242-L461) (the 4-effect waterfall to be consolidated).
- Pattern reference: [`supabase/migrations/20260515000000_get_home_aggregate_rpc.sql`](supabase/migrations/20260515000000_get_home_aggregate_rpc.sql) (Story 13-2 atomic-RPC hardening template + FILTER pattern + p_now parameter).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`.
- Implementation 2026-05-14 on `feature/13-3-session-feedback-aggregate-rpc` (branched from `main` post-13-2 PR #92 merge per `feedback_branch_from_main` memory).
- Quality gates all green after 3 minor fixes (NODE_ENV-style readonly bypass via Record cast on `__resetDailyGreetingEmbeddingForTests` Case 7, JSX namespace → `React.ReactElement`, missing `vocabularyUsed` field on test fixture). 1739 / 1739 tests passing — +52 net (beats spec target +30-40 high end by 12).
- Screen line count: 1296 → 1021 (~21% reduction; exceeded spec's ~17% target).

### Completion Notes List

- **Task 1 done.** [`supabase/migrations/20260516000000_get_session_feedback_aggregate_rpc.sql`](supabase/migrations/20260516000000_get_session_feedback_aggregate_rpc.sql) created — 6-key JSONB-returning function with Story 9-9 hardening. Server-side 21-day + 5-min cutoffs; Story 13-2 P2 `COUNT(*) FILTER` atomic snapshot for error_counts; Story 13-2 P3 `p_now timestamptz DEFAULT now()` parameter. Server-side `MAX((ai_feedback->>'fluencyRating')::numeric)` + `MAX((ai_feedback->>'grammarRating')::numeric)` returns 2 scalars instead of N JSONB rows (audit P2-4 critical win). Migration drift detector at [`src/lib/__tests__/get-session-feedback-aggregate-rpc-migration-drift.test.ts`](src/lib/__tests__/get-session-feedback-aggregate-rpc-migration-drift.test.ts) with 12 cases. Manual-run pgTAP-style test at [`supabase/migrations/__tests__/get_session_feedback_aggregate_test.sql`](supabase/migrations/__tests__/get_session_feedback_aggregate_test.sql) with 9 assertions (hardening + happy path 6 keys + empty-user + cross-user defense + 21-day cutoff isolated to prev_session + 5-min cutoff + MAX no-time-cutoff + CEFR promotion + atomic count invariant). NOT CI-wired (Epic 15.3 scope).
- **Task 2 done.** [`src/lib/session-feedback-aggregate.ts`](src/lib/session-feedback-aggregate.ts) — `SessionFeedbackAggregate` interface + `SessionFeedbackPrevSession` / `SessionFeedbackCefrPromotion` / `SessionFeedbackResolvedError` / `SessionFeedbackErrorCounts` sub-types + `getSessionFeedbackAggregate(userId, conversationId, preCefrLevel)` + `isValidSessionFeedbackAggregate(value)` shape guard. On RPC error: `captureError(_, "session-feedback-aggregate-fetch")` + throw. Client passes `p_now: new Date().toISOString()`. Tests at [`src/lib/__tests__/session-feedback-aggregate.test.ts`](src/lib/__tests__/session-feedback-aggregate.test.ts) with 18 cases (4-arg RPC shape + Sentry routing + null preCefrLevel passthrough + 10-case per-key rejection matrix + 5 shape-guard accept/reject).
- **Task 3 done.** [`src/hooks/use-session-feedback-aggregate.ts`](src/hooks/use-session-feedback-aggregate.ts) — `UseSessionFeedbackAggregateOptions` (6 input fields) + `UseSessionFeedbackAggregateReturn` (4 output fields matching pre-13-3 useState shape) + 4 pure derivation helpers (`deriveComparisonMetrics` / `deriveMilestone` / `deriveErrorJourney` / `deriveNextAction`) preserved byte-faithful from pre-13-3 inline logic. Single `useEffect` keyed on (userId, conversationId, currentFeedback, currentDurationSeconds, preConversationCefrLevel) fires the RPC ONCE per feedback arrival. `mountedRef` guard against stale-resolve-after-unmount (Story 12-9 pattern). RPC failure → setState null + `captureError(err, "session-feedback-aggregate-fetch")`. Tests at [`src/hooks/__tests__/use-session-feedback-aggregate.test.tsx`](src/hooks/__tests__/use-session-feedback-aggregate.test.tsx) with 13 react-test-renderer cases.
- **Task 4 done.** [`app/(tabs)/conversation/[sessionId].tsx`](app/(tabs)/conversation/[sessionId].tsx) — 4 useState declarations + 4 useEffect blocks DELETED (~268 lines via Python-driven block replacement). Single `useSessionFeedbackAggregate({...})` call returns the same 4 pieces of state via destructuring; JSX consumer below unchanged. Unused `SessionComparisonMetric` + `MilestoneBannerProps` type imports + `supabase` import removed. Pre-conversation `preConversationCefrLevel` useState + `cefrCapturedRef` retained (belong to conversation START, not the feedback flow). Source drift detector at [`app/(tabs)/conversation/__tests__/sessionId-aggregate-source-drift.test.ts`](app/(tabs)/conversation/__tests__/sessionId-aggregate-source-drift.test.ts) with 7 cases (hook import + call site + 3 NEGATIVE `supabase.from(...)` guards for conversations / error_patterns / profiles + 2 NEGATIVE useState-deleted guards + preConversationCefrLevel-retained POSITIVE).
- **Task 5 done.** Quality gates: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` 1739 / 1739 passing across 85 suites. +52 net Jest cases (1687 → 1739; beats spec target +30-40 high end by 12).
- **Task 6 done.** CLAUDE.md gained the Story 13-3 architecture paragraph after the Story 13-2 review-round-1 entry. Documents the 4-effect-waterfall consolidation pattern + the unbounded-query elimination + cross-story invariants preserved + expected impact metrics. `sprint-status.yaml` 13-3 flipped `backlog → ready-for-dev → in-progress → review`.
- **Cross-story invariants verified clean:** `src/lib/sentry.ts` zero-diff (1 new feature tag string `session-feedback-aggregate-fetch` rides on existing `feature` extras key — Story 9-3 contract); `src/lib/realtime-orchestrator.ts` zero-diff (Story 13-1 contracts preserved); `src/lib/memory.ts` zero-diff (Story 13-2 contracts preserved); `src/lib/home-aggregate.ts` zero-diff; `src/lib/cache.ts` zero-diff; `package.json` + `package-lock.json` + `supabase/functions/` + `.github/workflows/` all zero-diff.
- **Closes audit P2-4** architecturally. Expected impact: Supabase round-trips per feedback arrival **6 → 1 (~83% reduction)**; `conversations` rows transferred per call **N → 0** (server-side MAX scalars); `error_patterns` round-trips **3 → 0**; feedback-screen latency on 4G **~1.5-3s → ~0.4-0.7s**; race-prone `resolved > total` math **YES → NO** (FILTER atomic snapshot). Hook public API byte-identical to the 4 pre-13-3 useState pieces — JSX consumer unchanged.

### File List

**New files:**

- `supabase/migrations/20260516000000_get_session_feedback_aggregate_rpc.sql` — RPC with Story 9-9 hardening + server-side MAX scalars + cutoffs + FILTER atomic snapshot + p_now parameter.
- `src/lib/session-feedback-aggregate.ts` — `SessionFeedbackAggregate` type + `getSessionFeedbackAggregate` + `isValidSessionFeedbackAggregate` shape guard.
- `src/hooks/use-session-feedback-aggregate.ts` — Hook with 4 pure derivation helpers + single-fetch effect + mountedRef guard.
- `src/lib/__tests__/get-session-feedback-aggregate-rpc-migration-drift.test.ts` — 12 migration drift cases.
- `src/lib/__tests__/session-feedback-aggregate.test.ts` — 18 client-helper cases.
- `src/hooks/__tests__/use-session-feedback-aggregate.test.tsx` — 13 hook contract cases via react-test-renderer.
- `app/(tabs)/conversation/__tests__/sessionId-aggregate-source-drift.test.ts` — 7 screen drift cases.
- `supabase/migrations/__tests__/get_session_feedback_aggregate_test.sql` — 9 manual-run pgTAP-style assertions.

**Modified files:**

- `app/(tabs)/conversation/[sessionId].tsx` — 4 useState + 4 useEffect blocks DELETED (~268 lines); replaced with single `useSessionFeedbackAggregate({...})` destructuring call. Unused type imports + `supabase` import removed. Screen: 1296 → 1021 lines.
- `CLAUDE.md` — Story 13-3 architecture paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-3 status `backlog → ready-for-dev → in-progress → review`.
- `_bmad-output/implementation-artifacts/13-3-session-feedback-aggregate-rpc.md` — Tasks/Subtasks all checked; Dev Agent Record filled; Status: review.

**Explicitly NOT modified:**

- `src/lib/sentry.ts` — telemetry allowlist zero-diff; new feature tag rides on existing extras key.
- `src/lib/realtime-orchestrator.ts` / `src/components/conversation/TranscriptView.tsx` — Story 13-1 contracts byte-identical.
- `src/lib/memory.ts` / `src/lib/home-aggregate.ts` / `src/lib/cache.ts` — Story 13-2 contracts byte-identical.
- `package.json` + `package-lock.json` — no new deps.
- `supabase/functions/` — no Edge Function changes.
- `.github/workflows/` — no CI workflow changes.
- The downstream JSX consumers of `comparisonMetrics` / `milestone` / `errorJourney` / `nextAction` (the post-feedback panel render path) — destructured names byte-identical; render shape unchanged.
