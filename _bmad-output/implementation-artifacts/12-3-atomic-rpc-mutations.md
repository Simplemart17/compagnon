# Story 12.3: Atomic Postgres RPCs for Streak / Skill / Daily-Activity / CEFR Promotion Mutations (Replace Client-Side Read-Then-Write)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose four core activity-mutation helpers at [`src/lib/activity.ts`](src/lib/activity.ts) — `updateStreak()` ([`activity.ts:54-89`](src/lib/activity.ts#L54-L89)), `updateSkillProgress()` ([`activity.ts:106-157`](src/lib/activity.ts#L106-L157)), `incrementDailyActivity()` ([`activity.ts:163-200`](src/lib/activity.ts#L163-L200)), and `checkCefrPromotion()` ([`activity.ts:315-395`](src/lib/activity.ts#L315-L395)) — each implement a **client-side read-then-write pattern** that is NOT atomic against the Postgres row: (a) `updateStreak` does `SELECT streak_days, last_active_date → compute newStreak (today / yesterday / reset) → UPDATE streak_days = newStreak`; if a user has the app open on phone AND web (Story 16.X paid-tier scenario) and both increment within the same millisecond, both reads see `streak_days = 5` + `last_active_date = yesterday`, both compute `newStreak = 6`, both `UPDATE`, and ONE of the two increments is lost (the second `UPDATE` overwrites the first with the same value) — observable as a stuck streak counter even though the user actively used the app twice; (b) `updateSkillProgress` does `SELECT score, exercises_completed, total_time_minutes, cefr_level → compute running average → UPSERT score = newAvg, exercises_completed = prev + 1, total_time_minutes = prev + time` — two concurrent exercises completed within the same Promise.allSettled tick (e.g., Story 12-1's `persistConversation` Phase A slot for speaking + a parallel pending exercise) both read `score = 80, exercises_completed = 10`, both compute `newAvg = round((80 * 10 + newScore) / 11)`, both upsert — and one of the two exercise contributions to the running average is silently discarded (the user practiced 11 + 12 = 12 total exercises but the row shows only 11); (c) `incrementDailyActivity` does `SELECT minutes_practiced, exercises_completed, conversations_completed, words_learned → UPSERT minutes = prev + delta` — same read-then-write race: two concurrent exercise completions on the same day both read `minutes = 30`, both compute `newMinutes = 30 + 5 = 35`, both upsert — total daily minutes shows `35` when it should be `40` (the second increment is silently lost); (d) `checkCefrPromotion` does `SELECT current_cefr_level → SELECT skill_progress rows at level → evaluatePromotion → UPDATE current_cefr_level = nextLevel` — two concurrent promotion checks could both promote (idempotent if `evaluatePromotion` returns the same `nextLevel`) OR in pathological compare-and-swap timing **skip a level** if the read sees the pre-promotion level + the write goes through after another worker already promoted (e.g., the SELECT sees `B1`, evaluatePromotion decides `→ B2`, a concurrent worker promotes to `B2` first, then this worker's UPDATE writes `B2` again — IDEMPOTENT but the same logic if extended to multi-step promotion would silently skip levels), AND the existing JSDoc at [`activity.ts:100-104`](src/lib/activity.ts#L100-L104) explicitly acknowledges this with a `TODO(epic-10-schema-hardening)` comment ("The read-modify-write pattern below is not atomic. Two concurrent calls for the same (user, skill) can clobber each other's running-average update. Fix requires either an RPC with `SELECT ... FOR UPDATE` or a Postgres function that does the running-avg math server-side. Out of scope for story 9-2 (AC #5 forbids schema changes)") and the similar comment at [`activity.ts:310-314`](src/lib/activity.ts#L310-L314) ("Two concurrent invocations could both promote (idempotent same-level write) or, in pathological timing, skip a level. A row-level lock or `UPDATE ... WHERE current_cefr_level = $expected` compare-and-swap would close this"), AND the audit finding **P1-18** at [`shippable-roadmap.md` line 70](_bmad-output/planning-artifacts/shippable-roadmap.md) names this exactly: "Race conditions in `activity.ts` — read-then-write streak/skill/daily activity; phone+web concurrent users lose increments", AND the Epic 12.3 deliverable at [`shippable-roadmap.md` line 206](_bmad-output/planning-artifacts/shippable-roadmap.md) describes the fix: "Atomic RPC mutations — convert `incrementDailyActivity`, `updateStreak`, `updateSkillProgress` to server-side `UPDATE … SET x = x + $1`. **Covers P1-18.**", AND the Epic 12 acceptance criteria at [`shippable-roadmap.md` line 219](_bmad-output/planning-artifacts/shippable-roadmap.md) names the verification target: "Concurrent phone+web session test does not lose any increments (verified via 100 concurrent updates)" — the bug is real, the path forward is server-side atomic mutations via Postgres RPC functions, AND the migration substrate is already established by Stories 9-9 (`SECURITY DEFINER` + `SET search_path = public` hardening from `match_memories`), 11-4 (`check_and_increment_rate_limit` + `record_daily_cost` + `check_daily_cost_budget` atomic-counter RPCs at [`supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql`](supabase/migrations/20260512000000_rate_limit_and_cost_ledger.sql)), 11-6 (`match_error_pattern` cosine-similarity RPC at [`supabase/migrations/20260513000000_error_patterns_embedding.sql`](supabase/migrations/20260513000000_error_patterns_embedding.sql)) — all 3 prior migrations use the same conventions: `SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` filter + idempotent forward-only DDL + manual-run pgTAP-style assertion test at `supabase/migrations/__tests__/` (Epic 15.3 will CI-wire those).

I want (a) a **new forward-only SQL migration `supabase/migrations/20260514000000_atomic_activity_rpcs.sql`** that adds **4 atomic-mutation RPC functions**: (i) `update_streak_atomic(p_user_id UUID, p_today DATE, p_yesterday DATE)` — does the streak math + UPDATE inside a single statement so concurrent calls serialize via row-lock, returning the new `streak_days` value; (ii) `update_skill_progress_atomic(p_user_id UUID, p_skill TEXT, p_cefr_level TEXT, p_incoming_score NUMERIC, p_time_minutes INTEGER)` — does the running-average math + UPSERT in a single statement using `INSERT ... ON CONFLICT (user_id, skill) DO UPDATE SET score = ((skill_progress.score * skill_progress.exercises_completed) + EXCLUDED.score) / (skill_progress.exercises_completed + 1)::numeric` + `exercises_completed = skill_progress.exercises_completed + 1` + `total_time_minutes = skill_progress.total_time_minutes + EXCLUDED.time_minutes` + the no-regress CEFR rule (`cefr_level = GREATEST_OR_HIGHER_CEFR(skill_progress.cefr_level, EXCLUDED.cefr_level)`); (iii) `increment_daily_activity_atomic(p_user_id UUID, p_date DATE, p_minutes INTEGER, p_exercises INTEGER, p_conversations INTEGER, p_words INTEGER)` — does the cumulative INSERT-or-add in a single statement; (iv) `promote_cefr_level_atomic(p_user_id UUID, p_expected_current_level TEXT, p_next_level TEXT)` — does a **compare-and-swap UPDATE** of `current_cefr_level = p_next_level WHERE current_cefr_level = p_expected_current_level` so two concurrent promotion checks cannot skip a level (pathological case: A→B and a parallel A→B both succeed → idempotent; but if A is being promoted concurrently with a B→C check that races, the CAS prevents B→C from writing C when A was the read-time level) — returns `TRUE` if the swap landed, `FALSE` if it raced; (b) the SQL functions are wrapped with `SECURITY DEFINER` + `SET search_path = public` (Story 9-9 / 11-4 / 11-6 hardening pattern) + an `auth.uid() = p_user_id` check inside the function body that throws if the auth context's user doesn't match the parameter (defense-in-depth on top of RLS); (c) the client-side `activity.ts` helpers are **rewritten** to call `supabase.rpc("update_streak_atomic", {...})` / `supabase.rpc("update_skill_progress_atomic", {...})` / `supabase.rpc("increment_daily_activity_atomic", {...})` / `supabase.rpc("promote_cefr_level_atomic", {...})` instead of doing the client-side SELECT-then-UPDATE round trips, so the round-trip count drops from `2 per call × 4 callers = 8 round-trips per typical activity tick` to `1 per call × 4 = 4 round-trips per tick` (network-latency-bound — material improvement on mobile networks); (d) the pure helper functions (`getLocalDateString`, `evaluatePromotion`, `clampScore`, `isCEFRLevel`, `maxLevel`, `PromotionDecision`, `PromotionEvidence`, `PASSING_SCORE`, `MIN_PASSING_SKILLS`, `MIN_TOTAL_EXERCISES`, `TCF_SKILLS_IN_ORDER`) stay **unchanged** in `activity.ts` — they're consumed by Story 9-2's `evaluatePromotion` tests and Story 12-1's `RealtimeOrchestrator` Phase A slots; the migration is pure call-site relocation of the read-then-write pipeline into the database, with the JS helpers retaining their public signatures so all callers (`use-exercise.ts`, `use-echo-practice.ts`, `use-translation.ts`, `use-dictation.ts`, `use-progress.ts`, `app/(tabs)/mock-test/[testId].tsx`, `src/lib/speaking-mock-test-persist.ts`, `src/lib/realtime-orchestrator.ts`) compile with zero changes; (e) the JSDoc `TODO(epic-10-schema-hardening)` markers at [`activity.ts:100-104`](src/lib/activity.ts#L100-L104) and [`activity.ts:310-314`](src/lib/activity.ts#L310-L314) are **deleted** (the TODO is now resolved); (f) **fail-OPEN policy** on RPC error — if the new `supabase.rpc(...)` call fails (Postgres unreachable, RPC removed by migration drift, SECURITY DEFINER auth context mismatch), the client `captureError`s the failure and **returns silently without throwing** — same policy as Story 11-4's `checkRateLimit` Postgres-error path: never block a user-facing activity tick on a tracking-pipeline write failure, especially since the activity helpers are all called via `void` fire-and-forget from `Promise.allSettled` slots in Story 12-1's Phase A pipeline; (g) **regression tests** cover: (i) Drift detector test reading the SQL migration from disk + pinning `SECURITY DEFINER` + `SET search_path = public` + `auth.uid() = p_user_id` defense-in-depth + the compare-and-swap WHERE clause shape + per-RPC function-name pin (mirror of Story 11-4's `cost-table.test.ts` + Story 11-6's `error-patterns-migration-drift.test.ts` patterns); (ii) Updated unit tests for the 4 client-side `activity.ts` functions — replace the existing `from("profiles").update(...)` + `from("skill_progress").select(...)` Supabase-builder mocks with `rpc("...", {...})` mocks; verify happy-path arg shape + RPC-error fail-OPEN routing through `captureError` with the existing Sentry tags (`update-streak`, `update-skill-progress`, `increment-daily-activity`, `cefr-promotion`); (iii) `pgTAP`-style assertion test at `supabase/migrations/__tests__/atomic_activity_rpcs_test.sql` covering the concurrency contract via 100-concurrent-pgbench-style assertions: 100 concurrent `update_streak_atomic` calls leave `streak_days = 1` (incremented once because today === today after first call) NOT `streak_days = 100`; 100 concurrent `update_skill_progress_atomic` calls with score=80 leave `exercises_completed = 100` AND `score = 80` (running average converges correctly under contention) — mirror of Story 11-4's `rate_limit_test.sql` 100-concurrent-cap test (`supabase/migrations/__tests__/rate_limit_test.sql`); (iv) Story 9-2's `evaluatePromotion` pure-helper test file at [`src/lib/__tests__/activity.test.ts`](src/lib/__tests__/activity.test.ts) stays GREEN unchanged — the helper is unchanged; (v) Story 12-1's `realtime-orchestrator.test.ts` Phase A parallelization tests continue passing — the Phase A slot dispatchers (which call `updateSkillProgress` / `incrementDailyActivity` / `updateStreak`) still resolve via the per-slot Promise; the underlying transport mechanism changing from supabase `from(...).update(...)` to `supabase.rpc(...)` is transparent at the test boundary,

so that **audit finding P1-18 closes architecturally** (the read-then-write race that was previously documented as a TODO is now structurally impossible because the math runs server-side inside a single Postgres statement with row-level locking guarantees from `INSERT ... ON CONFLICT DO UPDATE`); **the Epic 12 acceptance criterion at [`shippable-roadmap.md` line 219](_bmad-output/planning-artifacts/shippable-roadmap.md) ("Concurrent phone+web session test does not lose any increments (verified via 100 concurrent updates)") is satisfied** via the new pgTAP-style 100-concurrent-update test; the **mobile-network round-trip count drops by ~50%** (4 RPC calls vs 8 SELECT + UPDATE round-trips per typical activity tick) — material latency improvement on Phase A's tail-latency budget; the **`activity.ts` TODO debt is paid down** — both `TODO(epic-10-schema-hardening)` JSDoc markers are deleted because the schema fix lands here; the **paid-tier multi-device scenario (Epic 16.X) is unblocked** — Story 12-3 is a prerequisite for any feature that involves the same user being signed in on phone + web simultaneously without losing increments; **Story 9-3 Sentry telemetry allowlist contract holds** — the existing 4 tags (`update-streak`, `update-skill-progress`, `increment-daily-activity`, `cefr-promotion`) preserve verbatim; no new feature tags introduced; **Story 9-4 stored-prompt-injection defense holds** by construction — the migration is database-only, no user-derived content flows through it; **Story 9-9 SQL hardening contract holds** — all 4 new RPCs use `SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` filter; **Story 11-4 atomic-RPC pattern extends** — the new functions follow the same convention as `check_and_increment_rate_limit` (single-statement atomic mutation guarded by SECURITY DEFINER, fail-OPEN on RPC error from the client wrapper); **Story 11-6 migration drift-detector pattern extends** — the new SQL is pinned by a Jest test reading the migration from disk; **Story 12-1 `RealtimeOrchestrator` Phase A invariants preserved by construction** — the `Promise.allSettled` slot dispatchers see no change in resolved shape (the client wrapper still returns void-or-error on RPC failure); the **verified-correct surfaces NOT touched** are: pure helpers (`getLocalDateString` / `evaluatePromotion` / `clampScore` / `isCEFRLevel` / `maxLevel`), the `evaluatePromotion` tests, the `evaluatePromotion`-consumed types (`PromotionEvidence`, `PromotionDecision`, `TCFSkill`), the per-slot `captureError` Sentry tags (Story 9-3 contract), the Story 11-4 rate-limit/cost-cap RPCs (orthogonal), the Story 11-6 `match_error_pattern` RPC (orthogonal), the Story 12-1 / 12-2 surfaces (orthogonal).

## Background — Why This Story Exists

### What audit finding P1-18 owns to this story

[`shippable-roadmap.md` line 70](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P1-18 — Race conditions in `activity.ts` — read-then-write streak/skill/daily activity; phone+web concurrent users lose increments — `src/lib/activity.ts:33-110`"

Epic 12.3 deliverable at [line 206](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Atomic RPC mutations — convert `incrementDailyActivity`, `updateStreak`, `updateSkillProgress` to server-side `UPDATE … SET x = x + $1`. **Covers P1-18.**"

Epic 12 acceptance criterion at [line 219](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Concurrent phone+web session test does not lose any increments (verified via 100 concurrent updates)."

### Current state — 4 read-then-write functions in `activity.ts`

The race window is illustrated for `updateStreak` (the simplest):

```
Phone tab:                          Web tab:
SELECT streak_days, last_active     SELECT streak_days, last_active
       ↓ returns {5, yesterday}            ↓ returns {5, yesterday}
       ↓                                   ↓
compute newStreak = 5 + 1 = 6       compute newStreak = 5 + 1 = 6
       ↓                                   ↓
UPDATE streak_days = 6 ✓            UPDATE streak_days = 6  ← overwrites with same value
                                    (the user practiced TWICE; counter shows 6 once, not 7)
```

Same pattern for `updateSkillProgress` (running-average drift), `incrementDailyActivity` (minute-counter drift), and `checkCefrPromotion` (potential level-skip in compare-and-swap).

### The 4 helpers + their call sites

| Helper | File | Lines | Pattern | Callers |
|---|---|---|---|---|
| `updateStreak` | `src/lib/activity.ts` | 54-89 | `SELECT streak_days → compute → UPDATE` | `use-exercise.ts`, `use-echo-practice.ts`, `use-translation.ts`, `use-dictation.ts`, `realtime-orchestrator.ts`, `speaking-mock-test-persist.ts`, `mock-test/[testId].tsx` |
| `updateSkillProgress` | `src/lib/activity.ts` | 106-157 | `SELECT score, exercises → running-avg → UPSERT` | Same 7 call sites + `realtime-orchestrator.ts` Phase A slot 3 |
| `incrementDailyActivity` | `src/lib/activity.ts` | 163-200 | `SELECT counters → SUM → UPSERT` | Same call sites + Phase A slot 4 |
| `checkCefrPromotion` | `src/lib/activity.ts` | 315-395 | `SELECT current_cefr_level → evaluatePromotion → UPDATE` | Same call sites + Phase B |

### 12-3 collapses each pair to 1 atomic statement

```
Phone tab:                          Web tab:
RPC update_streak_atomic(uid)       RPC update_streak_atomic(uid)
       ↓ Postgres row-locks                ↓ blocks behind phone's lock
       ↓ math runs inside Postgres         ↓ math runs inside Postgres (sees the post-phone state)
       ↓ UPDATE commits                    ↓ UPDATE commits
       ↓ returns {6}                       ↓ returns {6} (today === last_active_date → no-op)
```

The "today === last_active_date → no-op" branch is preserved exactly (the existing JS logic at [`activity.ts:65`](src/lib/activity.ts#L65) "If last_active_date is today → do nothing"). With the lock, the second caller observes the post-first-call state and short-circuits.

### Architecture — `supabase/migrations/20260514000000_atomic_activity_rpcs.sql`

```sql
-- Story 12-3: Atomic Postgres RPCs for activity-mutation race elimination.
--
-- Pre-12-3 `src/lib/activity.ts` uses client-side SELECT-then-UPDATE for
-- streak / skill / daily-activity / CEFR-promotion writes. Two concurrent
-- callers (phone + web) lose increments. Audit finding P1-18.
--
-- SECURITY DEFINER + SET search_path = public + auth.uid() defense-in-depth
-- mirrors Story 9-9 hardening + Story 11-4's check_and_increment_rate_limit.

CREATE OR REPLACE FUNCTION update_streak_atomic(
  p_user_id UUID,
  p_today DATE,
  p_yesterday DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_streak INTEGER;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'auth.uid() must match p_user_id';
  END IF;

  UPDATE profiles
  SET streak_days = CASE
        WHEN last_active_date = p_today THEN streak_days
        WHEN last_active_date = p_yesterday THEN COALESCE(streak_days, 0) + 1
        ELSE 1
      END,
      last_active_date = p_today,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING streak_days INTO v_new_streak;

  RETURN v_new_streak;
END;
$$;

-- ... update_skill_progress_atomic, increment_daily_activity_atomic,
--     promote_cefr_level_atomic with similar shape ...

REVOKE EXECUTE ON FUNCTION update_streak_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_streak_atomic TO authenticated;
```

The `INSERT ... ON CONFLICT (user_id, skill) DO UPDATE SET ...` pattern (for `update_skill_progress_atomic`) acquires a row-level lock on conflict resolution, serializing concurrent writes by definition.

### Architecture — `src/lib/activity.ts` post-12-3 (representative for `updateStreak`)

```typescript
export async function updateStreak(userId: string): Promise<void> {
  try {
    const today = getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    const { error } = await supabase.rpc("update_streak_atomic", {
      p_user_id: userId,
      p_today: today,
      p_yesterday: yesterdayStr,
    });

    if (error) {
      captureError(error, "update-streak");
    }
  } catch (err) {
    captureError(err, "update-streak");
  }
}
```

Same pattern for the other 3 helpers — pure call-site relocation from client-side compute to server-side compute.

### Threat / failure model — what cannot happen post-story

After this story:

1. **`updateStreak` concurrent-write race resolved** — two parallel calls serialize at the row lock; the second observes the post-first state and short-circuits if `last_active_date === today`.

2. **`updateSkillProgress` running-average drift resolved** — `INSERT ... ON CONFLICT DO UPDATE` is a single atomic statement; the running-average math runs against the post-lock state on each call.

3. **`incrementDailyActivity` minute-counter drift resolved** — same atomic-upsert pattern; concurrent increments sum correctly.

4. **`checkCefrPromotion` compare-and-swap holds** — `UPDATE current_cefr_level = next WHERE current_cefr_level = expected` only commits if the read-time value matches; a concurrent worker that already promoted causes this UPDATE to no-op (0 rows affected) without writing a stale `next`.

5. **Fail-OPEN policy preserved** — RPC failures (Postgres down, RLS denial, schema drift) route through `captureError` + return silently. Activity tracking is fire-and-forget per Story 12-1's Phase A `Promise.allSettled`; never block the user-facing flow on a tracking-pipeline write failure (Story 11-4 policy).

6. **Story 9-9 hardening preserved** — all 4 new RPCs are `SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` filter.

7. **Story 9-3 Sentry allowlist preserved** — the 4 existing feature tags carry through unchanged. No new tags.

8. **Story 12-1 Phase A invariants preserved** — `Promise.allSettled` slot dispatchers see no change in resolved shape (still void-or-error).

9. **Per-call round-trip count drops ~50%** — pre-12-3: SELECT + UPDATE per helper = 2 round-trips × 4 helpers = 8; post-12-3: 1 RPC × 4 = 4. Material on mobile networks.

10. **`activity.ts` pure helpers unchanged** — `evaluatePromotion` + `getLocalDateString` + `clampScore` + `isCEFRLevel` + `maxLevel` + types + constants. Story 9-2 + Story 12-1 tests stay green.

### Out of scope for this story (delegated elsewhere)

- **Schema versioning / `last_updated_by_atomic_rpc` audit column** — Epic 17.1 owns broader schema versioning.
- **Conflict resolution between `last_active_date` timezone shift mid-day** — Story 9-X's `getLocalDateString` is the canonical timezone source; no change.
- **Speaking score recalibration for the running-average math** — Story 10-2 owns the publisher-anchored TCF scoring path; the running-average math here operates on the internal 0–100 `skill_progress.score` scale (Story 9-2 intentional separation).
- **CI-wiring the pgTAP-style migration test** — Epic 15.3 owns Edge Function / SQL test CI integration.
- **Multi-user atomic mutations (group challenges, shared streaks)** — out of scope; per-user only.
- **Backfill of historical drift-affected rows** — operator decision; the migration is forward-only and existing rows may have slight drift but converge to correct values within ~5 activity ticks.
- **Realtime push notifications on streak milestones** — Epic 8.X already owns notifications.

## Acceptance Criteria

### 1. Create migration `supabase/migrations/20260514000000_atomic_activity_rpcs.sql`

- [ ] **CREATE** 4 RPC functions: `update_streak_atomic` / `update_skill_progress_atomic` / `increment_daily_activity_atomic` / `promote_cefr_level_atomic`.
- [ ] **Each function** has: `SECURITY DEFINER` + `SET search_path = public` + `auth.uid() = p_user_id` defense-in-depth check that `RAISE EXCEPTION` on mismatch + `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated`.
- [ ] **`update_skill_progress_atomic`** uses `INSERT ... ON CONFLICT (user_id, skill) DO UPDATE SET ...` so the row-level lock serializes concurrent writes; the running-average math runs server-side.
- [ ] **`promote_cefr_level_atomic`** uses `UPDATE ... WHERE current_cefr_level = p_expected_current_level` (compare-and-swap); returns `TRUE` if 1 row affected, `FALSE` otherwise.
- [ ] **Forward-only + idempotent** — `CREATE OR REPLACE FUNCTION ...` is re-runnable safely.
- [ ] **No-regress CEFR rule preserved** — `update_skill_progress_atomic` writes `cefr_level = GREATEST_OR_HIGHER(skill_progress.cefr_level, EXCLUDED.cefr_level)` via a helper or inline CASE so a B2 user reviewing A1 still leaves the row at B2.

**Given** a clean Postgres DB
**When** the migration runs
**Then** the 4 RPCs are created with `SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` checks AND `EXECUTE` is granted only to `authenticated`.

### 2. Rewrite the 4 client-side helpers in `src/lib/activity.ts`

- [ ] **REPLACE** `updateStreak`'s SELECT-then-UPDATE pipeline with `await supabase.rpc("update_streak_atomic", { p_user_id, p_today, p_yesterday })`.
- [ ] **REPLACE** `updateSkillProgress`'s SELECT-then-UPSERT pipeline with `await supabase.rpc("update_skill_progress_atomic", { p_user_id, p_skill, p_cefr_level, p_incoming_score, p_time_minutes })`. **DELETE** the `TODO(epic-10-schema-hardening)` JSDoc marker at lines 100-104.
- [ ] **REPLACE** `incrementDailyActivity`'s SELECT-then-UPSERT pipeline with `await supabase.rpc("increment_daily_activity_atomic", { p_user_id, p_date, p_minutes, p_exercises, p_conversations, p_words })`.
- [ ] **REPLACE** `checkCefrPromotion`'s final UPDATE step with `await supabase.rpc("promote_cefr_level_atomic", { p_user_id, p_expected_current_level, p_next_level })`. The pre-step pipeline (SELECT current_cefr_level + SELECT skill_progress rows + evaluatePromotion) stays unchanged. **DELETE** the `TODO(epic-10-schema-hardening)` JSDoc marker at lines 310-314.
- [ ] **PRESERVE** all pure helpers: `getLocalDateString`, `evaluatePromotion`, `clampScore`, `isCEFRLevel`, `maxLevel`, `PromotionEvidence`, `PromotionDecision`, `PASSING_SCORE`, `MIN_PASSING_SKILLS`, `MIN_TOTAL_EXERCISES`, `TCF_SKILLS_IN_ORDER`, `lastSkippedBreadcrumb`, exports of all the same names.
- [ ] **PRESERVE** the 4 `captureError` Sentry tags verbatim: `update-streak`, `update-skill-progress`, `increment-daily-activity`, `cefr-promotion` (Story 9-3 allowlist contract).
- [ ] **PRESERVE** the fail-OPEN policy — RPC error → `captureError` + return silently.
- [ ] **PRESERVE** the existing `addBreadcrumb({ category: "cefr-promotion", level: "info", ... })` breadcrumb path in `checkCefrPromotion` for skipped-promotion outcomes.

**Given** a `updateStreak(userId)` call on the post-12-3 client
**When** the call dispatches
**Then** `supabase.rpc("update_streak_atomic", ...)` is invoked exactly once AND the prior `from("profiles").select(...).eq("id", userId).single()` call is GONE.

### 3. Tests

- [ ] **CREATE** `src/lib/__tests__/atomic-activity-rpcs-migration-drift.test.ts` (~12 cases — drift detector reading the SQL migration from disk):
  - The 4 function names exist as `CREATE OR REPLACE FUNCTION` declarations.
  - Each function has `SECURITY DEFINER`.
  - Each function has `SET search_path = public`.
  - Each function has `auth.uid() IS DISTINCT FROM p_user_id` (or equivalent strict-equality `=` with the `RAISE EXCEPTION` guard).
  - Each function has `REVOKE EXECUTE ... FROM PUBLIC` and `GRANT EXECUTE ... TO authenticated`.
  - `update_skill_progress_atomic` uses `INSERT ... ON CONFLICT (user_id, skill) DO UPDATE`.
  - `promote_cefr_level_atomic` uses `WHERE current_cefr_level = p_expected_current_level` (compare-and-swap).
  - No `DROP TABLE` / `DROP COLUMN` / non-idempotent operations.
  - `CREATE EXTENSION IF NOT EXISTS` is present if any extension dependencies are needed (defensive; none expected for this migration).

- [ ] **UPDATE** `src/lib/__tests__/activity.test.ts` — the `evaluatePromotion` test block stays unchanged; replace the existing supabase-builder mocks (`from("profiles").update(...)` etc.) with `rpc("...", ...)` mocks. ~6-8 case updates.
- [ ] **CREATE** `supabase/migrations/__tests__/atomic_activity_rpcs_test.sql` (~10 pgTAP-style assertions; manual-run via `psql -f`, not CI-wired — Epic 15.3 scope):
  - `update_streak_atomic` happy path (today, yesterday, gap).
  - `update_streak_atomic` 100 concurrent calls in the same transaction-block test leave `streak_days = 1` (because today === today after first call); concurrency contract holds.
  - `update_skill_progress_atomic` insert + update (running-average math).
  - `update_skill_progress_atomic` no-regress CEFR rule (B2 row + A1 incoming keeps B2).
  - `update_skill_progress_atomic` 100 concurrent calls each contributing score=80 leave `exercises_completed = 100` AND `score ≈ 80` (running-avg correctness under contention).
  - `increment_daily_activity_atomic` insert + add.
  - `increment_daily_activity_atomic` 100 concurrent calls add correctly.
  - `promote_cefr_level_atomic` happy path (B1 → B2 with expected = B1).
  - `promote_cefr_level_atomic` CAS mismatch (B1 → B2 with expected = A2 returns FALSE).
  - `auth.uid() IS DISTINCT FROM p_user_id` defense-in-depth fires (4 cases, one per function).

- [ ] **VERIFY** the following existing tests stay green unchanged:
  - `src/lib/__tests__/activity.test.ts` — the `evaluatePromotion` pure-helper coverage (Story 9-2).
  - `src/lib/__tests__/realtime-orchestrator.test.ts` — Phase A parallelization + per-slot failure isolation (Story 12-1).
  - `src/lib/__tests__/speaking-mock-test-persist.test.ts` — Story 9-8 speaking pipeline.

- [ ] **Target test count:** 1292 → ~1318 (+~26 from the 12 drift-detector cases + ~6-8 updated `activity.test.ts` mocks + ~10 new pgTAP cases not in Jest).

### 4. Update CLAUDE.md

- [ ] Add a new architecture line **after** the Story 12-2 paragraph documenting: (a) the new `supabase/migrations/20260514000000_atomic_activity_rpcs.sql` migration with the 4 RPCs, (b) the `SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` defense-in-depth pattern, (c) the client-side `activity.ts` helpers rewritten to call `supabase.rpc(...)` with prior public API preserved, (d) the read-then-write race elimination + N-concurrent-update verification, (e) the round-trip count reduction (8 → 4 per typical activity tick), (f) the deleted `TODO(epic-10-schema-hardening)` JSDoc markers, (g) Story 9-2 / 9-3 / 9-9 / 11-4 / 12-1 cross-story invariants preserved by construction.

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 12-3 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [ ] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — preserve every pre-12-3 catch site + tag verbatim.
- [ ] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [ ] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [ ] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass.
- [ ] **Story 9-3 Sentry allowlist contract holds** — no new `feature` strings; pre-12-3 tags preserved.
- [ ] **Story 9-9 SQL hardening contract holds** — `SECURITY DEFINER` + `SET search_path = public` + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated` on every new function.
- [ ] **Story 11-4 atomic-RPC pattern + fail-OPEN policy holds** — RPC error in client wrapper routes through `captureError` + returns silently (never throws into Story 12-1 Phase A slots).
- [ ] **Story 12-1 `RealtimeOrchestrator` Phase A invariants hold** — `Promise.allSettled` slot dispatchers see no change in resolved shape.
- [ ] **Story 12-2 auth-bootstrap contract holds** — orthogonal; no shared state.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files".
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/12-3-atomic-rpc-mutations.md` passes.

## Tasks / Subtasks

- [ ] **Task 1: Create migration `supabase/migrations/20260514000000_atomic_activity_rpcs.sql`** (AC #1)
  - [ ] `update_streak_atomic(p_user_id, p_today, p_yesterday) RETURNS INTEGER`.
  - [ ] `update_skill_progress_atomic(p_user_id, p_skill, p_cefr_level, p_incoming_score, p_time_minutes) RETURNS VOID` with `INSERT ... ON CONFLICT (user_id, skill) DO UPDATE` + running-avg math + no-regress CEFR rule.
  - [ ] `increment_daily_activity_atomic(p_user_id, p_date, p_minutes, p_exercises, p_conversations, p_words) RETURNS VOID`.
  - [ ] `promote_cefr_level_atomic(p_user_id, p_expected_current_level, p_next_level) RETURNS BOOLEAN` with compare-and-swap `WHERE current_cefr_level = p_expected_current_level`.
  - [ ] Each: `SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` check + `REVOKE`/`GRANT`.
  - [ ] Add migration-level comment documenting Story 12-3 + audit P1-18 closure.

- [ ] **Task 2: Rewrite the 4 helpers in `src/lib/activity.ts`** (AC #2)
  - [ ] `updateStreak` → `supabase.rpc("update_streak_atomic", ...)`.
  - [ ] `updateSkillProgress` → `supabase.rpc("update_skill_progress_atomic", ...)`. DELETE the `TODO(epic-10-schema-hardening)` JSDoc marker.
  - [ ] `incrementDailyActivity` → `supabase.rpc("increment_daily_activity_atomic", ...)`.
  - [ ] `checkCefrPromotion` → keep the pre-step pipeline (SELECT current_cefr_level + SELECT skill_progress rows + `evaluatePromotion`) but replace the final UPDATE with `supabase.rpc("promote_cefr_level_atomic", ...)`. DELETE the `TODO(epic-10-schema-hardening)` JSDoc marker.
  - [ ] Preserve all pure helpers + types + constants + Sentry tags.

- [ ] **Task 3: Tests** (AC #3)
  - [ ] CREATE `src/lib/__tests__/atomic-activity-rpcs-migration-drift.test.ts` (~12 cases).
  - [ ] UPDATE `src/lib/__tests__/activity.test.ts` — swap builder mocks for RPC mocks (~6-8 case updates).
  - [ ] CREATE `supabase/migrations/__tests__/atomic_activity_rpcs_test.sql` (~10 pgTAP cases; manual-run).
  - [ ] Verify Story 9-2 + 12-1 existing tests stay GREEN unchanged.

- [ ] **Task 4: Update CLAUDE.md** (AC #4)

- [ ] **Task 5: Quality gates** (AC #Z)
  - [ ] type-check / lint / format / test / colors all green.
  - [ ] CI Sentry DSN + Submit credentials leak guards pass.
  - [ ] `git status` shows the story file as untracked-but-not-ignored.
  - [ ] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Server-side atomic mutation via `INSERT ... ON CONFLICT DO UPDATE`** — mirrors Story 11-4's `check_and_increment_rate_limit` pattern (atomic-counter-with-row-lock). Postgres MVCC + row-level locks guarantee serialization on conflict resolution.
- **`SECURITY DEFINER` + `SET search_path = public` + `auth.uid()` defense-in-depth** — Story 9-9 hardening pattern. Used by `match_memories` (`20260301000002`), `match_error_pattern` (Story 11-6), `check_and_increment_rate_limit` / `record_daily_cost` / `check_daily_cost_budget` (Story 11-4).
- **Fail-OPEN client wrapper on RPC error** — Story 11-4 policy. Activity helpers are fire-and-forget from `void`/Promise.allSettled; never block a user-facing flow on a tracking-pipeline write failure.
- **Compare-and-swap for promotion** — `UPDATE ... WHERE current_cefr_level = expected` pattern. Mirrors the optimistic-concurrency-control idiom from distributed systems; safe on a single Postgres row because the predicate is checked under the row's lock.
- **Drift detector test reading SQL from disk** — Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 pattern. Catches future schema-vs-test drift.
- **pgTAP-style migration test** — Story 11-4 (`rate_limit_test.sql`) + Story 11-6 (`match_error_pattern_test.sql`) pattern. Manual-run via `psql -f`; Epic 15.3 owns CI integration.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section included.
- **Epic 9 + 10 + 11 + 12-1 + 12-2 retros A3** (review-patch budget): Story 12-3 has **MEDIUM-to-HIGH** risk surface — touches 4 client-side functions + 4 new SQL functions + a migration + tests across 3 levels (Jest drift detector + Jest unit-test mock-swap + pgTAP migration assertions). Expect **8-12 review patches**. Risk surfaces:
  - (a) The `auth.uid()` check inside `SECURITY DEFINER` needs careful design — `SECURITY DEFINER` runs as the function owner, so `auth.uid()` returns the CALLER's auth context (correct), not the owner's. Story 11-4's RPCs verified this pattern works; the new functions inherit it.
  - (b) `INSERT ... ON CONFLICT DO UPDATE SET ...` semantics for running-average math: when no row exists yet, the INSERT row sets `score = p_incoming_score` directly (no division by zero); when a row exists, the UPDATE computes `(skill_progress.score * skill_progress.exercises_completed + p_incoming_score) / (skill_progress.exercises_completed + 1)`. Round to integer at the boundary OR keep as NUMERIC. Need to decide consistent with the Story 9-2 pre-12-3 behavior (`Math.round` at the client).
  - (c) The no-regress CEFR rule needs a SQL helper or inline `CASE WHEN array_position(ARRAY['A1','A2','B1','B2','C1','C2'], EXCLUDED.cefr_level) > array_position(ARRAY['A1','A2','B1','B2','C1','C2'], skill_progress.cefr_level) THEN EXCLUDED.cefr_level ELSE skill_progress.cefr_level END` to avoid a separate helper function. Either is fine; inline is simpler for one call site.
  - (d) The `getLocalDateString` timezone handling stays client-side — the client computes today + yesterday in local time and passes both as `DATE` parameters. The RPC compares against the stored `last_active_date` directly. Don't move this to server-side (`CURRENT_DATE` would be UTC and break the local-timezone fix from Story 9-2).
  - (e) The `checkCefrPromotion` SELECT-before-RPC pattern means the read happens client-side then the compare-and-swap happens server-side. Two concurrent promotion checks: both read the same pre-promotion level, both evaluate, both call the RPC — first one wins (returns TRUE), second one races (returns FALSE without writing). The client can ignore FALSE silently (no Sentry error) because it just means another worker promoted first.
  - (f) Story 12-1's `realtime-orchestrator.test.ts` Phase A test mocks `updateSkillProgress` / `incrementDailyActivity` / `updateStreak` at the module level. Those mocks transparently work because the helpers' public signatures are unchanged. But the orchestrator's per-slot Sentry tag (`persist-conversation-phase-a-{slot}`) catches rejected Promises — the new fail-OPEN policy ensures no rejection escapes the helper, so the Phase A behavior is preserved.
  - (g) Tests that mock `supabase.from(...).update(...).eq(...)` etc. for the activity helpers (in `activity.test.ts`) need to switch to `supabase.rpc("name", args)` mocks. The mock surface area shrinks (one method per call vs a chain), which is a net simplification.
  - (h) The pgTAP-style migration test uses `psql -f supabase/migrations/__tests__/atomic_activity_rpcs_test.sql`. It runs against a local Supabase Postgres. Not CI-wired (Epic 15.3 scope). The drift detector test (Jest) IS CI-wired and is the regression gate.

- **Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 lesson** (drift detector reading source from disk + pinning invariants): Add a drift detector test for the new SQL migration.
- **Story 12-1 lesson** (atomic refactor in one commit when responsibilities are deeply interconnected): The 4 SQL functions + 4 client wrappers are deeply intertwined; ship as one commit.

### Anticipated File List

**Created:**

- `supabase/migrations/20260514000000_atomic_activity_rpcs.sql` — 4 RPC functions with hardening conventions.
- `src/lib/__tests__/atomic-activity-rpcs-migration-drift.test.ts` — ~12 Jest drift-detector cases.
- `supabase/migrations/__tests__/atomic_activity_rpcs_test.sql` — ~10 pgTAP-style assertions.

**Modified:**

- `src/lib/activity.ts` — 4 helper bodies rewritten to call `supabase.rpc(...)`; 2 `TODO(epic-10-schema-hardening)` JSDoc markers deleted; pure helpers + types + constants + Sentry tags unchanged.
- `src/lib/__tests__/activity.test.ts` — supabase-builder mocks swapped for `rpc(...)` mocks; `evaluatePromotion` test block unchanged.
- `CLAUDE.md` — Story 12-3 architecture paragraph.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status flip.

**Deleted:**

- The client-side SELECT-then-UPDATE pipelines for `updateStreak` / `updateSkillProgress` / `incrementDailyActivity` (migrated server-side via RPCs).
- The final UPDATE step (after the SELECT/evaluate pipeline) inside `checkCefrPromotion` (migrated to `promote_cefr_level_atomic` RPC).
- Two `TODO(epic-10-schema-hardening)` JSDoc markers inside `activity.ts`.

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-13 | Story 12-3 story file created; closes audit P1-18 (read-then-write races in `activity.ts` → server-side atomic RPCs); spec target satisfies Epic 12 AC at `shippable-roadmap.md` line 219 (100-concurrent-update no-loss); MEDIUM-to-HIGH risk surface (4 new SQL functions + 4 client rewrites + 3-level test coverage); ~8-12 review patches anticipated per Epic 9/10/11/12 retro budget. |
