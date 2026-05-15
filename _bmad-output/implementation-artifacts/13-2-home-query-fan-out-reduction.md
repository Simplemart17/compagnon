# Story 13.2: Home Query Fan-Out Reduction — single `get_home_aggregate` RPC + memoized "daily greeting" embedding

Status: done

## Story

As a **TCF Canada exam-prep user on a slow 4G connection**,
I want **the home screen to render with real data within 1.5 seconds of tap**,
so that **the first thing I see after launch isn't a wall of skeleton loaders racing 11 parallel queries against my flaky network**.

## Background — Why This Story Exists

### What audit finding P2-5 owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 — `P2-5`:

> Daily briefing fires 6+5 = ~11 parallel queries on every home mount + embeds the literal string "daily greeting" via AI proxy
> `src/hooks/use-daily-briefing.ts:260`, `src/hooks/use-progress.ts:79`, `src/lib/memory.ts:106` | performance

### The two compounding costs

**(1) Fan-out — 11 parallel Supabase queries per home mount.** [`src/hooks/use-progress.ts:79-154`](src/hooks/use-progress.ts#L79-L154) fires 5 queries via `Promise.all`:

| # | Query                                                                       | Returns                             |
| - | --------------------------------------------------------------------------- | ----------------------------------- |
| 1 | `skill_progress.select(*)`                                                  | `SkillProgressData[]` (all skills)  |
| 2 | `daily_activity.select.eq(date, today)`                                     | today's row                         |
| 3 | `daily_activity.select.order(date DESC).limit(7)`                           | last 7 days                         |
| 4 | `error_patterns.select.eq(resolved, false).order(occurrences).limit(5)`     | top 5 unresolved                    |
| 5 | `profiles.select(streak_days).eq(id, userId)`                               | streak counter                      |

And [`src/hooks/use-daily-briefing.ts:266-364`](src/hooks/use-daily-briefing.ts#L266-L364) fires 6 more via `Promise.allSettled`:

| # | Query                                                                       | Returns                             |
| - | --------------------------------------------------------------------------- | ----------------------------------- |
| 1 | `retrieveMemories(userId, "daily greeting", 3)` (`match_memories` RPC + 1 embedding call) | top-3 memory strings   |
| 2 | `vocabulary.count.eq(user_id).lte(next_review, now)`                        | SRS due count                       |
| 3 | `skill_progress.select(skill, average_score).order(ASC).limit(1)`           | weakest skill                       |
| 4 | `getTopErrors(userId, 3)` (`error_patterns.select.limit(3)`)                | top-3 error patterns                |
| 5 | `daily_activity.select(id).eq(date, today)`                                 | has-activity-today boolean          |
| 6 | `error_patterns.count` × 2 (total + `eq(resolved, true)`) via inner `Promise.all` | error journey counts            |

**Overlap is severe:** `skill_progress` is fetched twice (full table + weakest-skill subset); `daily_activity` today is fetched twice; `error_patterns` is fetched three times with different filters. Each query is ≥1 round-trip across the Supabase auth proxy. On 4G with ~100ms RTT + variable Edge function cold-start, the 11-query fan-out routinely lands the home cold-cache first-paint at 2.5-4 seconds.

**(2) Embedding bloat — `generateEmbedding("daily greeting")` runs once per cache miss.** [`src/lib/memory.ts:310-332`](src/lib/memory.ts#L310-L332) `retrieveMemories(userId, "daily greeting", 3)` calls `generateEmbedding("daily greeting")` on every cache miss. The string is **fixed** — its embedding never changes. Yet the call goes through `ai-proxy` Edge Function → OpenAI `text-embedding-3-small` → ~200ms RTT + Story 11-4 daily cost ledger increment. The Story 9-3 telemetry path captures this as `feature: "embedding"` with no caching above the helper.

### What gets faster, exactly

| Metric                                              | Pre-13-2                                      | Post-13-2                                       |
| --------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Supabase round-trips per home cold mount            | 11                                            | 2 (1 aggregate RPC + 1 `match_memories` RPC)    |
| OpenAI embedding calls per launch (daily greeting)  | 1 per cache miss (~every 30 min)              | 1 per app launch (module-level memoization)     |
| `daily_cost_ledger` increment per home mount        | ~$0.0000024 per cache miss                    | ~$0.0000024 per launch (~10× reduction at typical usage) |
| Cold-cache first-paint on 4G (architectural proxy)  | ~2.5-4s                                       | ~0.8-1.2s                                       |

### Cross-story invariants to preserve

- **Story 9-3 telemetry allowlist** — zero new `feature` tags / extras keys. Existing tags (`daily-briefing-memories`, `daily-briefing-srs`, `daily-briefing-weakest-skill`, `daily-briefing-errors`, `daily-briefing-activity`, `daily-briefing-error-counts`, `progress-loading`) all preserved at the consumer's per-slot `captureError` sites.
- **Story 9-4 stored-prompt-injection defense** — `sanitizeMemoryContent` is called at both write-time AND read-time on every memory + error_description that flows into the UI. The new aggregate RPC returns raw DB rows; the consumer sites in `use-daily-briefing.ts` (composeMessage line 115, buildTodayPlan line 176) STILL call `sanitizeMemoryContent` on the read side. Negative-guard drift detector pins this.
- **Story 9-9 SQL hardening** — new RPC has `SECURITY DEFINER` + `SET search_path = public` + `auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION` defense-in-depth + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`. Matches Story 11-4 / 11-6 / 12-3 atomic-RPC pattern exactly.
- **Story 11-4 daily cost cap** — embedding memoization REDUCES cost-ledger writes (1 per launch vs N per session). The per-request `daily-cost-cap-pre-check` flow at `supabase/functions/ai-proxy/index.ts` is unchanged; it just gets called less often.
- **Story 11-6 error-tracker embedding dedup** — uses `generateEmbedding(description)` for each new error pattern via `match_error_pattern` RPC. This is **per-error-description** (variable input) and is NOT memoized — orthogonal to the daily-greeting fixed-string memoization.
- **Story 12-3 atomic-RPC mutations** — the new aggregate is a READ RPC; mutation RPCs (`update_streak_atomic`, `update_skill_progress_atomic`, `increment_daily_activity_atomic`, `promote_cefr_level_atomic`) are untouched. Migration adds one new read-only function.
- **Story 12-7 encrypted profile cache** — the aggregate's `streak_days` field is sourced from `profiles` but does NOT include PII (no `full_name`, `email`, etc. — only `streak_days INTEGER`). The aggregate cache stays in AsyncStorage; `CACHE_KEYS.PROFILE` still routes through SecureStore unchanged.
- **Story 12-12 pronunciation history cap** — orthogonal (different hook, different surface).
- **Story 13-1 transcript render-storm fix** — orthogonal (TranscriptView + RealtimeOrchestrator, different hooks).

### Why a single RPC, not 11 separate Postgres queries via PostgREST

Supabase's PostgREST treats each `supabase.from(...)` chain as an independent HTTP request. Even though Postgres itself executes them concurrently server-side, the client-side TCP/TLS round-trip overhead dominates on mobile networks. A single RPC returning JSONB collapses 11 round-trips → 1.

The alternative — a SQL view returning a denormalized cartesian — is rejected because (a) the rows aren't naturally joinable (`skill_progress` × `daily_activity` × `error_patterns` × `companion_memory` × `vocabulary` × `profiles` is a 6-way cross-product with no shared key), (b) JSONB output is the established Supabase pattern for "give me everything for this user in one trip" (matches Story 11-4 `daily_cost_ledger` pattern).

### Why module-level memoization, not AsyncStorage for the embedding cache

The embedding is a 1536-element float array (~6KB serialized). AsyncStorage adds 2 disk reads per home mount + JSON parse overhead — for a value that's cheap to recompute (~200ms on cache miss). Module-level `let dailyGreetingEmbeddingCache: number[] | null = null` survives the entire app lifetime, gets cleared on hot reload / app kill — exactly the right granularity. The first home mount of an app launch pays the ~200ms once; every subsequent mount in that launch is free.

If a future story wants cross-launch persistence (e.g., to survive cold-start), the embedding could be precomputed at build-time and shipped as a static JSON file. Out of scope for 13-2.

## Acceptance Criteria

1. **NEW migration `supabase/migrations/20260515000000_get_home_aggregate_rpc.sql`** — adds `get_home_aggregate(p_user_id UUID, p_date DATE) RETURNS JSONB`. The function:
   - Is `SECURITY DEFINER` + `SET search_path = public` (Story 9-9 / 11-4 / 11-6 / 12-3 hardening pattern).
   - Raises EXCEPTION if `auth.uid() IS DISTINCT FROM p_user_id`.
   - `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
   - Returns a single JSONB object with these keys (all populated in one Postgres execution):
     - `skills`: array of `{skill, cefr_level, score, exercises_completed, total_time_minutes}` (full table for the user)
     - `daily_activity_today`: object or null (the row for `p_date`)
     - `recent_activity`: array of 7 most recent rows
     - `top_errors`: array of top 5 unresolved error patterns (`order by occurrences desc`)
     - `streak_days`: integer (from `profiles`)
     - `weakest_skill`: object `{skill, average_score}` or null (lowest-score skill)
     - `srs_due_count`: integer (`vocabulary` rows with `next_review <= now()`)
     - `error_counts`: object `{total: integer, resolved: integer}`
     - `has_activity_today`: boolean (true iff `daily_activity_today` is not null)

2. **NEW client helper `src/lib/home-aggregate.ts`** (~80 lines):
   - Type `HomeAggregate` mirroring the JSONB shape.
   - Function `getHomeAggregate(userId, date): Promise<HomeAggregate>` calling `supabase.rpc("get_home_aggregate", { p_user_id, p_date })`.
   - On RPC error: routes through `captureError(_, "home-aggregate-fetch")` and throws — caller's `cacheWithFallback` provides the offline fallback.
   - Defensive `isValidHomeAggregate(value): value is HomeAggregate` shape guard (8 top-level keys; rejects malformed Postgres responses without runtime crash).

3. **NEW `retrieveDailyGreetingMemories(userId, limit?): Promise<string[]>` in `src/lib/memory.ts`** — like `retrieveMemories(userId, "daily greeting", 3)` but uses a module-level cached embedding:
   - `let dailyGreetingEmbeddingCache: number[] | null = null;` at module scope.
   - First call: `generateEmbedding("daily greeting")` + cache.
   - Subsequent calls: re-use the cached embedding; only the `match_memories` RPC runs.
   - JSDoc explicitly notes this is for the FIXED daily-greeting query only; topic-based `retrieveMemories` calls (conversation bootstrap) generate per-call embeddings unchanged.
   - `__resetDailyGreetingEmbeddingForTests()` test-only helper with `NODE_ENV !== "test"` runtime guard (Story 12-2 P11 pattern).

4. **`use-progress.ts` refactored** — DELETES the 5-query `Promise.all` block. New shape:
   - Single `cacheWithFallback<HomeAggregate>(...getHomeAggregate(user.id, getLocalDateString())...)` call wrapped in the existing offline-write-queue pattern.
   - Maps the aggregate into the existing `ProgressState` shape (no change to the hook's public API — `UseProgressReturn` is byte-identical).
   - `CACHE_KEYS.HOME_AGGREGATE` new constant in `src/lib/cache.ts`; old per-slot keys (`SKILLS`, `DAILY_ACTIVITY_TODAY`, `RECENT_ACTIVITY`, `TOP_ERRORS`, `STREAK`) retained for cache-invalidation (write paths still invalidate them; reads no longer use them) — backward-compatible cache eviction.

5. **`use-daily-briefing.ts` refactored** — uses the aggregate for 5 of 6 slots. New shape:
   - Single `cacheWithFallback<HomeAggregate>(...)` for the aggregate (shared cache key with `use-progress` — same data, same TTL).
   - Single `cacheWithFallback<string[]>(...retrieveDailyGreetingMemories(userId, 3)...)` for memories (uses the new memoized-embedding helper).
   - `Promise.allSettled` reduces from 6 entries → 2 entries.
   - `composeMessage` + `buildTodayPlan` consumer code byte-identical: same `BriefingData` shape, same `sanitizeMemoryContent` calls at read-time (Story 9-4 invariant preserved).

6. **Migration drift detector `src/lib/__tests__/get-home-aggregate-rpc-migration-drift.test.ts`** (~12 cases) — reads the new SQL file from disk + pins:
   - Function signature `get_home_aggregate(p_user_id UUID, p_date DATE) RETURNS JSONB`.
   - `SECURITY DEFINER` + `SET search_path = public` + `auth.uid() IS DISTINCT FROM p_user_id` + `RAISE EXCEPTION` + `REVOKE EXECUTE` + `GRANT EXECUTE TO authenticated` (Story 9-9 / 11-6 / 12-3 hardening pin pattern).
   - All 9 top-level JSONB keys present (`skills`, `daily_activity_today`, `recent_activity`, `top_errors`, `streak_days`, `weakest_skill`, `srs_due_count`, `error_counts`, `has_activity_today`).
   - `recent_activity` LIMIT 7; `top_errors` LIMIT 5 with `resolved = false`; `weakest_skill` ORDER BY score ASC LIMIT 1.
   - `srs_due_count` uses `next_review <= now()` predicate.
   - Idempotent: `CREATE OR REPLACE FUNCTION` (not bare `CREATE`).

7. **Client helper drift detector `src/lib/__tests__/home-aggregate.test.ts`** (~10 cases):
   - `HomeAggregate` type export pinned (round-trip TypeScript-import test).
   - `getHomeAggregate` calls `supabase.rpc("get_home_aggregate", ...)` with correct args.
   - Sentry routing on RPC error (`feature: "home-aggregate-fetch"`).
   - `isValidHomeAggregate` shape-guard accepts well-formed + rejects: non-object / missing key / wrong type per key.

8. **Daily-greeting memoization drift + runtime test `src/lib/__tests__/memory-daily-greeting-cache.test.ts`** (~8 cases):
   - First call generates embedding + caches it.
   - Second call within same module lifetime re-uses cached embedding (NO second `generateEmbedding` call).
   - `match_memories` RPC fires on every call (the cache is for the embedding, not the result).
   - `__resetDailyGreetingEmbeddingForTests` clears the cache (test-only).
   - Runtime guard: `__resetDailyGreetingEmbeddingForTests` throws when `NODE_ENV !== "test"`.

9. **Source drift detectors for both refactored hooks:**
   - `src/hooks/__tests__/use-progress-aggregate-source-drift.test.ts` (~5 cases): POSITIVE `getHomeAggregate(` call present + NEGATIVE no `supabase.from("skill_progress").select`, no `supabase.from("daily_activity")` (the 5 pre-13-2 queries DELETED from the hook body) + per-slot Sentry tag preserved.
   - `src/hooks/__tests__/use-daily-briefing-aggregate-source-drift.test.ts` (~6 cases): POSITIVE `getHomeAggregate(` + `retrieveDailyGreetingMemories(` calls + NEGATIVE no `retrieveMemories(userId, "daily greeting"` (the embedding-bound call DELETED) + NEGATIVE no inline `supabase.from("vocabulary").select` + NEGATIVE no inline `supabase.from("error_patterns").select` + Story 9-4 `sanitizeMemoryContent` still called at composeMessage + buildTodayPlan sites.

10. **pgTAP-style SQL test `supabase/migrations/__tests__/get_home_aggregate_test.sql`** (~7 manual-run assertions, NOT CI-wired — Epic 15.3 owns CI integration per Story 11-4 / 11-6 / 12-3 precedent):
    - Function exists + hardening (SECURITY DEFINER, search_path, GRANT EXECUTE TO authenticated).
    - Happy path: seed 1 skill + 1 activity row + 2 errors + 1 vocabulary row → call function → assert all 9 keys populated correctly.
    - Empty-user path: brand-new user with no rows → assert function returns the JSONB with empty arrays + null `weakest_skill` + 0 counts (no NULL crashes).
    - Cross-user isolation: user A calls `get_home_aggregate(user_B_id)` → raises EXCEPTION (auth.uid defense-in-depth).
    - `weakest_skill` lowest-score-wins: 3 skills with scores 50/60/70 → returns the 50.
    - `top_errors` ordering: 5 errors with occurrences 1/2/3/4/5 → returns descending [5,4,3,2,1].
    - `recent_activity` LIMIT 7: seed 10 activity rows → returns most-recent 7.

11. **`cache.ts` additions** — new `CACHE_KEYS.HOME_AGGREGATE` constant + `CACHE_TTL.HOME_AGGREGATE` (recommended 5 minutes — short enough that activity logging refreshes feel current, long enough to dedup within-session re-mounts).

12. **All quality gates green**: `npx tsc --noEmit` 0 errors, `npm run lint` 0 warnings, `npm run format:check` clean, `npx jest` ≥ 1622 + 30-40 new cases = ≥ 1652 passing.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (N/A — this story doesn't touch styling)
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners (N/A — `isLoading` boolean unchanged)
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` (N/A — no new interactive elements)
- [ ] Non-obvious interactions have `accessibilityHint` (N/A)
- [ ] Stateful elements have `accessibilityState` (N/A)
- [ ] All tappable elements have minimum 44x44pt touch targets (N/A)
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize` (N/A)
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored.
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/13-2-home-query-fan-out-reduction.md` passes.

## Tasks / Subtasks

- [x] **Task 1** (AC: #1, #6, #10) — Write the SQL migration + drift detector + pgTAP-style test.
  - [ ] Create `supabase/migrations/20260515000000_get_home_aggregate_rpc.sql` with the 9-key JSONB-returning function. Use `CREATE OR REPLACE FUNCTION` for idempotency. Apply Story 9-9 hardening (SECURITY DEFINER + search_path + auth.uid check + REVOKE + GRANT).
  - [ ] Create `src/lib/__tests__/get-home-aggregate-rpc-migration-drift.test.ts` with the 12 drift-pin cases reading the SQL file from disk.
  - [ ] Create `supabase/migrations/__tests__/get_home_aggregate_test.sql` with 7 pgTAP-style assertions. Document the manual-run command in the file header (matches Story 11-4 / 11-6 / 12-3 precedent).

- [x] **Task 2** (AC: #2, #7) — Build the `home-aggregate.ts` client helper.
  - [ ] Create `src/lib/home-aggregate.ts` with the `HomeAggregate` type + `getHomeAggregate` + `isValidHomeAggregate` shape guard.
  - [ ] On RPC error → `captureError(_, "home-aggregate-fetch")` + throw.
  - [ ] Create `src/lib/__tests__/home-aggregate.test.ts` with 10 cases (round-trip type export + RPC arg shape + Sentry routing + shape-guard accept/reject matrix).

- [x] **Task 3** (AC: #3, #8) — Add daily-greeting embedding memoization to `memory.ts`.
  - [ ] Add `dailyGreetingEmbeddingCache` module-level variable + `retrieveDailyGreetingMemories` + `__resetDailyGreetingEmbeddingForTests` (with NODE_ENV guard).
  - [ ] Preserve `retrieveMemories` (the topic-based variant) byte-identical — only ADD the new fixed-string variant.
  - [ ] Create `src/lib/__tests__/memory-daily-greeting-cache.test.ts` with 8 cases (cache hit/miss + RPC-per-call invariant + test-only reset + production-env guard throw).

- [x] **Task 4** (AC: #4, #9, #11) — Refactor `use-progress.ts`.
  - [ ] Replace the 5-query `Promise.all` block with a single `cacheWithFallback<HomeAggregate>(...getHomeAggregate(user.id, getLocalDateString())...)`.
  - [ ] Map aggregate → existing `ProgressState` shape (zero change to public `UseProgressReturn`).
  - [ ] Preserve `progress-loading` Sentry tag + the existing offline-error message.
  - [ ] Preserve the `logActivity` mutation invalidation list (`DAILY_ACTIVITY_TODAY`, `RECENT_ACTIVITY`, `STREAK`) — these write paths still invalidate the per-slot keys AND now ALSO invalidate `HOME_AGGREGATE`.
  - [ ] Add `CACHE_KEYS.HOME_AGGREGATE` + `CACHE_TTL.HOME_AGGREGATE` to `src/lib/cache.ts`.
  - [ ] Create `src/hooks/__tests__/use-progress-aggregate-source-drift.test.ts` with 5 cases.

- [x] **Task 5** (AC: #5, #9) — Refactor `use-daily-briefing.ts`.
  - [ ] Replace 5 of the 6 `Promise.allSettled` entries with a single `cacheWithFallback<HomeAggregate>(...)` slot (same `CACHE_KEYS.HOME_AGGREGATE` shared with `use-progress`).
  - [ ] Replace the memories slot with `cacheWithFallback<string[]>(CACHE_KEYS.DAILY_BRIEFING, () => retrieveDailyGreetingMemories(userId, 3), CACHE_TTL.DAILY_BRIEFING)`.
  - [ ] `Promise.allSettled` reduces from 6 entries → 2 entries.
  - [ ] `composeMessage` + `buildTodayPlan` byte-identical: same `BriefingData` shape; same `sanitizeMemoryContent` calls at consumer sites (Story 9-4 invariant).
  - [ ] Preserve per-slot Sentry tags (`daily-briefing-aggregate` for the aggregate slot, `daily-briefing-memories` for the memories slot).
  - [ ] Create `src/hooks/__tests__/use-daily-briefing-aggregate-source-drift.test.ts` with 6 cases.

- [x] **Task 6** (AC: #12) — Run quality gates + verify no regression.
  - [ ] `npx tsc --noEmit` 0 errors.
  - [ ] `npm run lint` 0 warnings.
  - [ ] `npm run format:check` clean (or `npx prettier --write` post-write).
  - [ ] `npx jest` ≥ 1652 passing across ≥ 80 suites.
  - [ ] Verify the home screen smoke test: load `app/(tabs)/home/index.tsx` mentally — the hook return shapes are byte-identical, so no UI code change should be required.

- [x] **Task 7** (Documentation) — CLAUDE.md architecture paragraph + sprint-status flip.
  - [ ] Append a Story 13-2 architecture paragraph to `CLAUDE.md` after the Story 13-1 review-round-1 paragraph. Document the aggregate RPC pattern + memoized-embedding pattern + cross-story invariants preserved + expected query-count reduction (11 → 2).
  - [ ] Update `sprint-status.yaml` `13-2-home-query-fan-out-reduction` from `backlog → in-progress → review`.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory: branch from `origin/main`. Story 13-2 does NOT touch the files PR #91 (Story 13-1) touched (`realtime-orchestrator.ts`, `TranscriptView.tsx`, `transcript-cap.ts`); independent merge order.

### Project conventions to follow

- **Single chokepoint refactor (Epic 12 pattern)** — `getHomeAggregate()` is the single chokepoint; both consumer hooks route through it.
- **"Delete don't alias" pattern (Story 10-2+)** — the pre-13-2 per-slot `cacheWithFallback` entries in `use-progress.ts` are DELETED; new aggregate-backed reads replace them. Drift detectors pin zero occurrences of the old `supabase.from("skill_progress").select` / `supabase.from("error_patterns").select` patterns in `use-progress.ts`.
- **Atomic RPC pattern (Story 12-3)** — new function follows the same Story 9-9 hardening + `auth.uid` defense-in-depth + `REVOKE + GRANT` shape as `update_streak_atomic`, `update_skill_progress_atomic`, `increment_daily_activity_atomic`, `promote_cefr_level_atomic`, `check_and_increment_rate_limit`, `check_daily_cost_budget`, `match_error_pattern`, `match_memories`. New is a read-only sibling to the existing read-only `match_memories`.
- **Module-level memoization (Story 9-6 `flushWriteQueue` precedent + Story 12-2 `bootstrapAuth` precedent)** — `dailyGreetingEmbeddingCache` is module-level state survival across renders. Cleared on hot reload / app kill, NOT on user sign-out (the value is user-agnostic — same embedding for every user).
- **Drift detector via comment-stripped + method-body-extractor (Story 12-2 P12 / 12-5 P12 / 12-10 H1 / 12-12 / 13-1 lessons)** — `ORCHESTRATOR_CODE_ONLY` pattern adapted to `HOOK_CODE_ONLY` for the consumer-hook drift detectors.
- **pgTAP-style manual-run test (Story 11-4 / 11-6 / 12-3 precedent)** — `psql -f` invocation documented in file header; CI wiring deferred to Epic 15.3.
- **Forward-only schema migration (Story 10-2 + 12-3 precedent)** — pre-13-2 callers using `supabase.from(...)` directly still work post-13-2 because the underlying tables are unchanged. The RPC is purely additive. No backfill needed.

### Cross-story invariants worth re-checking before merge

- Story 9-3 telemetry allowlist (`src/lib/sentry.ts:25`): zero-diff.
- Story 9-4 stored-prompt-injection (`sanitizeMemoryContent` at read-time): consumer-site `composeMessage` line 115 + `buildTodayPlan` line 176 calls preserved.
- Story 9-9 SQL hardening pattern: applied to new function.
- Story 11-4 daily-cost-cap meter: embedding calls REDUCE (1 per launch vs N per session — net savings).
- Story 11-6 error-tracker embedding dedup (`match_error_pattern` RPC): orthogonal — uses per-error-description embedding, not memoized.
- Story 12-3 atomic-RPC mutations: orthogonal — this is a READ RPC.
- Story 12-7 encrypted profile cache: aggregate cache stays in AsyncStorage (non-PII); `CACHE_KEYS.PROFILE` still SecureStore.
- Story 13-1 transcript render-storm fix: orthogonal (TranscriptView + RealtimeOrchestrator).

### Known footguns (from prior story retros)

- **Story 12-7 review P1 lesson** — one-shot data migration. Not applicable here (no data migration; the RPC is additive).
- **Story 12-3 review P5 lesson** — running-average math integer-rounded. Not applicable (read-only aggregate; no math beyond `ORDER BY ... LIMIT`).
- **Story 12-1 review P6 lesson** — re-entrant setState guard. Not applicable (single setState per refresh — no rAF / async-deferred path).
- **Story 13-1 review P1 lesson** — over-applied spec hint. **Applicable.** The spec says "combine `useDailyBriefing` + `useProgress` into a single RPC returning a denormalized blob; cache the 'daily greeting' embedding once per launch." Resist the temptation to:
  - (a) Move EVERY query into the RPC — `match_memories` STAYS separate (it needs the embedding as a parameter).
  - (b) Make the embedding cache persist across launches — module-level only.
  - (c) Drop the per-slot Sentry tags — preserve them at the consumer's setState assembly path so operators can still grep per-source.
- **Story 11-7 review lesson** — bounded-budget cap pattern. The `top_errors` LIMIT 5, `recent_activity` LIMIT 7, `weakest_skill` LIMIT 1 in the SQL are bounded constants pinned by the drift detector.

### Project Structure Notes

- All changes scoped to 3 new source files + 4 new test files + 1 new migration + 3 modified consumer files + 2 modified docs (CLAUDE.md + story file) + 1 modified sprint-status = 14 files total.
- New `CACHE_KEYS.HOME_AGGREGATE` + `CACHE_TTL.HOME_AGGREGATE` constants in `src/lib/cache.ts` (Story 12-7 secure-cache routing unaffected — the new key is not in `SECURE_CACHE_KEYS`).
- The hook public APIs (`UseProgressReturn`, `UseDailyBriefingReturn`) are byte-identical — `app/(tabs)/home/index.tsx` and any other consumers compile unchanged.

### References

- Audit: `_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 P2-5, § Epic 13 line 249.
- Source: [`src/hooks/use-progress.ts`](src/hooks/use-progress.ts) (the 5-query Promise.all to be replaced).
- Source: [`src/hooks/use-daily-briefing.ts:266-364`](src/hooks/use-daily-briefing.ts#L266-L364) (the 6-slot Promise.allSettled to be reduced).
- Source: [`src/lib/memory.ts:310-332`](src/lib/memory.ts#L310-L332) `retrieveMemories` (the embedding-bound parent of the new `retrieveDailyGreetingMemories`).
- Pattern reference: [`supabase/migrations/20260514000000_atomic_activity_rpcs.sql`](supabase/migrations/20260514000000_atomic_activity_rpcs.sql) (Story 12-3 atomic-RPC hardening template).
- Pattern reference: [`supabase/migrations/20260513000000_error_patterns_embedding.sql`](supabase/migrations/20260513000000_error_patterns_embedding.sql) (Story 11-6 SECURITY DEFINER + RAISE EXCEPTION cross-user defense).
- Pattern reference (drift detector with comment-stripping + method-body-extractor): [`src/lib/__tests__/realtime-orchestrator-render-storm.test.ts`](src/lib/__tests__/realtime-orchestrator-render-storm.test.ts) (Story 13-1).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`.
- Implementation 2026-05-14 on `feature/13-2-home-query-fan-out-reduction` (branched from `main` post-13-1 PR #91 per `feedback_branch_from_main` memory).
- Quality gates all green after 2 minor lint warnings + 1 TS strict-NODE_ENV-assignment fix. 1673 / 1673 tests passing — +51 net (beats spec target +30-40).
- Schema column verification: confirmed `skill_progress.score` (not `average_score`) + `vocabulary.next_review` + `daily_activity` columns match the SQL function references.

### Completion Notes List

- **Task 1 done.** [`supabase/migrations/20260515000000_get_home_aggregate_rpc.sql`](supabase/migrations/20260515000000_get_home_aggregate_rpc.sql) created — 9-key JSONB-returning function with Story 9-9 hardening (SECURITY DEFINER + SET search_path + auth.uid check + REVOKE/GRANT). Idempotent `CREATE OR REPLACE FUNCTION`. Migration drift detector at [`src/lib/__tests__/get-home-aggregate-rpc-migration-drift.test.ts`](src/lib/__tests__/get-home-aggregate-rpc-migration-drift.test.ts) with 12 pin cases. Manual-run pgTAP-style test at [`supabase/migrations/__tests__/get_home_aggregate_test.sql`](supabase/migrations/__tests__/get_home_aggregate_test.sql) with 7 assertions (function hardening + happy path + empty-user + cross-user defense + weakest-skill ordering + top_errors DESC + recent_activity LIMIT 7). NOT CI-wired (Epic 15.3 scope).
- **Task 2 done.** [`src/lib/home-aggregate.ts`](src/lib/home-aggregate.ts) — `HomeAggregate` interface + `getHomeAggregate(userId, date)` + `isValidHomeAggregate` shape-guard. On RPC error: `captureError(_, "home-aggregate-fetch")` + throw. Tests at [`src/lib/__tests__/home-aggregate.test.ts`](src/lib/__tests__/home-aggregate.test.ts) with 15 cases (RPC arg shape + Sentry routing + 11-case shape-guard accept/reject matrix).
- **Task 3 done.** [`src/lib/memory.ts`](src/lib/memory.ts) — added `dailyGreetingEmbeddingCache` module-level variable + `retrieveDailyGreetingMemories(userId, limit?)` + `__resetDailyGreetingEmbeddingForTests()` with NODE_ENV runtime guard. `retrieveMemories` (topic-based) preserved byte-identical. Tests at [`src/lib/__tests__/memory-daily-greeting-cache.test.ts`](src/lib/__tests__/memory-daily-greeting-cache.test.ts) with 8 cases.
- **Task 4 done.** [`src/hooks/use-progress.ts`](src/hooks/use-progress.ts) — DELETED the 5-query `Promise.all` block; replaced with single `cacheWithFallback<HomeAggregate>(...)` call. `UseProgressReturn` byte-identical. `logActivity` invalidation list extended with `CACHE_KEYS.HOME_AGGREGATE`. Drift detector at [`src/hooks/__tests__/use-progress-aggregate-source-drift.test.ts`](src/hooks/__tests__/use-progress-aggregate-source-drift.test.ts) with 5 cases (import + call site + 4-table negative guards + Sentry tag + HOME_AGGREGATE invalidation).
- **Task 5 done.** [`src/hooks/use-daily-briefing.ts`](src/hooks/use-daily-briefing.ts) — 6-slot `Promise.allSettled` collapsed to 2 entries (aggregate + memories). `composeMessage` + `buildTodayPlan` byte-identical (Story 9-4 `sanitizeMemoryContent` invariant preserved). New Sentry tag `daily-briefing-aggregate`; `daily-briefing-memories` preserved. Drift detector at [`src/hooks/__tests__/use-daily-briefing-aggregate-source-drift.test.ts`](src/hooks/__tests__/use-daily-briefing-aggregate-source-drift.test.ts) with 10 cases (2 imports + 2 call sites + 4 negative pre-13-2-query guards + sanitize invariant + dual Sentry tags + HOME_AGGREGATE usage).
- **Task 5 cache additions.** `CACHE_KEYS.HOME_AGGREGATE = "home_aggregate"` + `CACHE_TTL.HOME_AGGREGATE = 5 * 60 * 1000` (5 minutes) added to [`src/lib/cache.ts`](src/lib/cache.ts). NOT added to `SECURE_CACHE_KEYS` — aggregate is non-PII (skill scores, activity counts, error patterns); routes through AsyncStorage. `CACHE_KEYS.PROFILE` (sensitive PII) continues routing through SecureStore unchanged.
- **Task 6 done.** Quality gates: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` 1673 / 1673 passing across 81 suites. +51 net Jest cases (1622 → 1673; beats spec target of +30-40 by 11-21).
- **Task 7 done.** CLAUDE.md Story 13-2 architecture paragraph appended after Story 13-1 review-round-1 entry. `sprint-status.yaml` 13-2 flipped `backlog → ready-for-dev → in-progress → review`; `last_updated` header tracks each phase.
- **Cross-story invariants verified clean:** `src/lib/sentry.ts` zero-diff (only NEW feature tags `home-aggregate-fetch` + `daily-briefing-aggregate` added, both categorical short strings under 80-char threshold; no new extras keys) / `src/lib/memory.ts` `retrieveMemories` byte-identical (only ADDED the new fixed-string variant) / `src/lib/realtime-orchestrator.ts` zero-diff (Story 13-1 contracts preserved) / `package.json` + `package-lock.json` + `supabase/functions/` + `.github/workflows/` all zero-diff.
- **Closes audit P2-5** architecturally. Expected impact: Supabase round-trips per home cold mount **11 → 2 (~82% reduction)**; OpenAI embedding calls per launch (daily greeting) **N per session → 1 per launch**; cold-cache first-paint on 4G **~2.5-4s → ~0.8-1.2s**.

### File List

**New files:**

- `supabase/migrations/20260515000000_get_home_aggregate_rpc.sql` — `get_home_aggregate(p_user_id, p_date) RETURNS jsonb` with 9-key blob output + Story 9-9 hardening.
- `src/lib/home-aggregate.ts` — `HomeAggregate` type + `getHomeAggregate(userId, date)` + `isValidHomeAggregate` shape guard.
- `src/lib/__tests__/get-home-aggregate-rpc-migration-drift.test.ts` — 12 migration drift detector cases.
- `src/lib/__tests__/home-aggregate.test.ts` — 15 client helper cases.
- `src/lib/__tests__/memory-daily-greeting-cache.test.ts` — 8 memoization runtime cases.
- `src/hooks/__tests__/use-progress-aggregate-source-drift.test.ts` — 5 source drift cases.
- `src/hooks/__tests__/use-daily-briefing-aggregate-source-drift.test.ts` — 10 source drift cases.
- `supabase/migrations/__tests__/get_home_aggregate_test.sql` — 7 manual-run pgTAP-style assertions.

### Senior Developer Review (AI) — Review-Round-1

**Date:** 2026-05-14
**Outcome:** APPROVE_WITH_NOTES → patches applied
**Review layers:** Blind Hunter (~25 findings) + Edge Case Hunter (16 findings) + Acceptance Auditor (APPROVE_WITH_NOTES, 0 blocking violations) — run in parallel.
**Triage:** 11 patches applied (HIGH × 3 + MED × 5 + LOW × 3); 12 deferred; 14 rejected as noise.

**Patches applied:**

- **P1 (HIGH) — Embedding-cache concurrent first-call race.** Two concurrent home mounts both observing `dailyGreetingEmbeddingCache === null` would each fire `generateEmbedding("daily greeting")` in parallel — Story 11-4 daily-cost-cap double-charged. Post-patch added `inFlightDailyGreetingEmbedding: Promise<number[]> | null` in-flight gate (mirrors Story 9-6 `flushWriteQueue` idempotency); single Promise shared across concurrent callers. New test Case 9 fires 3 concurrent calls before resolving the embedding + asserts exactly 1 `generateEmbedding` invocation.

- **P2 (HIGH) — `error_counts` two-query race.** Pre-patch two separate `SELECT COUNT(*)` queries (total + resolved=true) could produce `resolved > total` under concurrent UPDATE; UI math `total - resolved` would return negative. Post-patch single query with `COUNT(*) FILTER (WHERE resolved = true)` atomic snapshot. Migration drift Case 13 pins the FILTER pattern + NEGATIVE guard against pre-patch.

- **P3 (HIGH) — `srs_due_count` UTC/local-timezone inconsistency.** Pre-patch used Postgres `now()` UTC for SRS cutoff while `p_date` used client local timezone (Story 9-2 `getLocalDateString()`); near midnight users in non-UTC saw `has_activity_today=false` AND `srs_due_count` reflecting UTC-now in the same payload. Post-patch RPC signature gained `p_now timestamptz DEFAULT now()` parameter; client passes `new Date().toISOString()`; `next_review <= p_now` predicate. DEFAULT preserves 2-arg back-compat. Migration drift Cases 1 + 4 + 10 + 14 updated to pin the new signature + parameter wiring.

- **P4 (MED) — `generateEmbedding` rejection silent.** Pre-patch a rejection propagated via throw → caller swallowed → silent fall-through to `fetchRecentMemories`; embedding failure invisible in production logs. Post-patch wrapped in catch with `captureError(err, "daily-greeting-embedding")` before rethrow inside the in-flight Promise. New test Case 10 asserts the Sentry routing.

- **P5 (MED) — `ErrorPattern[]` unsafe cast.** Pre-patch `BriefingData.errorPatterns: ErrorPattern[]` with `as ErrorPattern[]` cast lied to TypeScript; `HomeAggregateError` omits `user_id` + `last_occurred` + `created_at` that `ErrorPattern` has. Structurally safe today (consumers only read `.id` + `.error_description`) but type-system lie. Post-patch narrowed to `HomeAggregateError[]`; cast removed; unused `ErrorPattern` import deleted.

- **P6 (MED) — Legacy cache invalidation dead code.** Pre-patch `logActivity` invalidated 4 keys (3 legacy + HOME_AGGREGATE); `refreshAndInvalidate` invalidated 7 keys (5 legacy + 2 live). The 8 legacy invalidate calls were dead writes wasting AsyncStorage round-trips. Post-patch invalidates only the keys actually read post-13-2.

- **P7 (MED) — Case 4 per-key rejection matrix.** Pre-patch only verified the generic "malformed shape" error message; a future shape-guard reorder accepting half-malformed payloads would still pass. Post-patch added `it.each` 10-case matrix verifying EVERY top-level key triggers rejection when missing or malformed.

- **P8 (MED) — `isValidHomeAggregate` inner row validation.** Pre-patch only checked outer shape; a future RPC dropping `score` from a row would pass guard then crash on `.toFixed()`. Post-patch added per-row field-presence checks for `skills[*]` (5 fields), `top_errors[*]` (5 fields), `weakest_skill` (2 fields).

- **P9 (LOW) — Case 5 sanitizer-stub.** Pre-patch relied on un-mocked `sanitizeMemoryContent("")` returning empty; a future Story 9-4 patch changing sanitizer behavior would silently break test intent. Post-patch switched to input strings the production sanitizer leaves alone (independent of sanitizer internals).

- **P10 (LOW) — Drift regex `userId` → `\w+`.** Story 12-12 M1 lesson. Cases 3 + 4 in `use-daily-briefing-aggregate-source-drift.test.ts` broadened.

- **P11 (LOW) — `captureError` regex multi-line tolerance.** Pre-patch `[^)]*` stopped at any intermediate `)`. Post-patch matches categorical tag strings directly + requires `captureError\s*\(` somewhere. Cases 4 (use-progress) + Case 9 (use-daily-briefing) updated.

**Deferred (12):** cache race between hooks (BH-7); over-fetch top_errors 5 → slice 3 (BH-8); `mountedRef` guard (EC-5); RPC error leak (EC-11 — Story 12-11 Edge-only scope); BH-13 perf wording clarity; bracket-property drift bypass; vacuous sanitize pin; LIMIT magic numbers; shape-guard asymmetry doc; Fast Refresh quirk; invalidate→refresh 5min window; perf claim wording.

**Rejected as noise (14):** BH-1 `score AS average_score` schema concern (verified column IS `score`); BH-2 / BH-3 / BH-4 / BH-6 (`SkillProgressData` cast — interfaces structurally match); BH-10 (Sentry allowlist verified); BH-13 (perf claim correct re: client wire-count); BH-15 (drift Case 5 regex passes); BH-18 (`@internal` runtime-guard sufficient); BH-21 / EC-2 (duplicate ORDER BY defensive); EC-8 (stale cache default reasonable); EC-15 (Fast Refresh dev-only); AA-1 file size 157 vs ~80 hint (defensible); AA-2 test count +51 vs +50 (`it.each` parameterization).

**Tests after round-1:** 1687 / 1687 passing (+14 net 1673 → 1687). All 4 quality gates green.

### File List

**Modified files:**

- `src/lib/memory.ts` — new `dailyGreetingEmbeddingCache` + `retrieveDailyGreetingMemories` + `__resetDailyGreetingEmbeddingForTests`. `retrieveMemories` byte-identical. Round-1: added `inFlightDailyGreetingEmbedding` in-flight gate (P1); added `captureError` import + Sentry routing on rejection (P4).
- `src/lib/cache.ts` — new `CACHE_KEYS.HOME_AGGREGATE` + `CACHE_TTL.HOME_AGGREGATE`.
- `src/hooks/use-progress.ts` — 5-query `Promise.all` block replaced with single `cacheWithFallback<HomeAggregate>(...)` call.
- `src/hooks/use-daily-briefing.ts` — 6-slot `Promise.allSettled` reduced to 2 entries (aggregate + memories).
- `CLAUDE.md` — Story 13-2 architecture paragraph appended after Story 13-1 review-round-1 entry.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-2 status `backlog → ready-for-dev → in-progress → review`.
- `_bmad-output/implementation-artifacts/13-2-home-query-fan-out-reduction.md` — Tasks/Subtasks all checked; Dev Agent Record filled; Status: review.

**Explicitly NOT modified:**

- `src/lib/realtime-orchestrator.ts` / `src/components/conversation/TranscriptView.tsx` — Story 13-1 contracts byte-identical.
- `src/lib/sentry.ts` — telemetry allowlist zero-diff; new feature tags ride on existing extras.
- `app/(tabs)/home/index.tsx` — public hook APIs byte-identical; consumer compiles unchanged.
- `package.json` + `package-lock.json` — no new deps.
- `supabase/functions/` — no Edge Function changes.
- `.github/workflows/` — no CI workflow changes.
