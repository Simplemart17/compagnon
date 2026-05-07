# Story 9.2: CEFR Promotion Engine Fix

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner using Companion to track real progress toward my TCF Canada goal,
I want CEFR auto-promotion to fire correctly each time I clear the bar **and** to require evidence across all five TCF skills (not just three),
so that I cannot be told I've reached B2 without ever having spoken or written French, and so that promotions continue working the second, third, and fourth time I qualify — not only the first.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged two coupled defects in `src/lib/activity.ts` as **P0** release blockers:

| Audit ID | Defect | Location |
|----------|--------|----------|
| **P0-2** | `updateSkillProgress` upserts on `(user_id, skill)` but **never writes `cefr_level`**, while `checkCefrPromotion` filters skill rows by `cefr_level`. The first promotion happens (default `'A1'` matches a freshly created user's `current_cefr_level`); subsequent promotions silently fail because skill rows still carry `'A1'` while the profile has moved to `A2`. | `src/lib/activity.ts:84-119` (write path), `src/lib/activity.ts:174-223` (read path) |
| **P0-3** | Promotion criteria require **only 3 distinct skills** at 85%. A user can be promoted to B2 with zero evidence in Speaking and Writing — i.e., the two production skills that TCF Canada actually scores. The audit's required policy: 5 skills must be practiced (any score), at least 3 of those must clear 85%, and total exercises must be ≥10. | `src/lib/activity.ts:174-223` |

Epic 9 acceptance criterion (`shippable-roadmap.md` §4 line 143):

> *"A user who completes 10 exercises × 3 skills at 85% **and also** has Speaking + Writing evidence is auto-promoted; without all 5, they are not."*

This story owns both defects. It is a small, surgical change to `activity.ts` plus an update to every call site that invokes `updateSkillProgress`, plus a Jest test file that locks the new behavior in.

**Out of scope for this story (delegated elsewhere):**

- **Demotion / spaced retention** — one-way promotion is acceptable for v1 (P3-8 → Epic 17 territory).
- **Scoring band recalibration** — the linear `0-20% → below A1` curve in `scoring.ts` (P1-1) is **not** part of promotion logic and stays untouched here → **Epic 10.2**.
- **Mock-test per-skill score writes** — `app/(tabs)/mock-test/[testId].tsx:502-504` calls `incrementDailyActivity` + `checkCefrPromotion` but does not call `updateSkillProgress` per skill from the section scores. That gap is acknowledged in Dev Notes but is **not fixed here**; it belongs to **Story 9-8** (Speaking pipeline rebuild) once mock-test has all 4 TCF Canada sections wired. **DO NOT** add per-skill writes to mock-test in this story.
- **Speaking section pipeline** — TCF Canada's Expression Orale has no scoring path today → **Story 9-8**.
- **Per-level passage / vocabulary frequency calibration** — Epic 10.3 / 10.4.

## Acceptance Criteria

### 1. `updateSkillProgress` Writes `cefr_level` On Every Upsert

- [ ] `updateSkillProgress` in `src/lib/activity.ts` is updated to accept a required `cefrLevel: CEFRLevel` parameter (added after `skill`, before `score`, to keep the natural `userId, skill, cefrLevel, score, timeMinutes` ordering).
- [ ] The upsert payload includes `cefr_level: cefrLevel`. It is written on both insert and update — `onConflict: "user_id,skill"` already handles the merge.
- [ ] If a `skill_progress` row already exists at a *higher* level than the incoming one (e.g., user practiced at A2 and is now doing an A1 review), the row's `cefr_level` is **not regressed**. Implement this by reading `existing.cefr_level` and writing `max(existing.cefr_level, cefrLevel)` using `CEFR_ORDER.indexOf(...)` for ordering. Document this with one inline comment.
- [ ] The function continues to update `score` (running average), `exercises_completed`, `total_time_minutes`, and `last_practiced` exactly as before — running-average math is unchanged.
- [ ] No new try/catch beyond what already exists; the existing `captureError(err, "update-skill-progress", { skill, score })` block continues to capture failures (extend the metadata object to include `cefrLevel` for diagnostics).

**Given** a user at `current_cefr_level = "B1"` who completes a B1 listening exercise scoring 90%
**When** `updateSkillProgress(userId, "listening", "B1", 90, 0)` is called
**Then** the `skill_progress` row for `(user_id, "listening")` has `cefr_level = "B1"`, `score = round((prevScore * prevCount + 90) / (prevCount + 1))`, and `last_practiced` advanced to now
**And** if that row was previously `cefr_level = "B2"` (because the user is reviewing a lower level), the row stays at `"B2"` (no regression)

### 2. All Five `updateSkillProgress` Call Sites Pass `cefrLevel`

The following five call sites in `src/hooks/` and `app/` must be updated to pass the user's CEFR level (the level the *exercise was generated at*, not the profile's `current_cefr_level` — so a B1 user practicing an A2 review gets credited at A2):

| File | Line (current) | What `cefrLevel` to pass |
|------|----------------|--------------------------|
| `src/hooks/use-exercise.ts:359` | `await updateSkillProgress(userId, skill, score, 0)` | The `cefrLevel` parameter already received by `persistExercise(skill, cefrLevel, score)` (line 314) |
| `src/hooks/use-realtime-voice.ts:541` | `await updateSkillProgress(user.id, "speaking", speakingScore, minutesPracticed)` | The `cefrLevel` from the hook's `UseRealtimeVoiceOptions` (already in scope at line 88) |
| `src/hooks/use-translation.ts:145` | `updateSkillProgress(user.id, "speaking", overallScore, elapsedMinutes)` | The `cefrLevel` already derived at line 89 from `profile?.current_cefr_level` |
| `src/hooks/use-echo-practice.ts:297-298` | Two adjacent calls (`"listening"`, `"speaking"`) | `cefrLevel` already in scope at line 96 |
| `src/hooks/use-dictation.ts:434` | `updateSkillProgress(user.id, "listening", avg, elapsed)` | `cefrLevel` already in scope at line 239 |

- [ ] Every call site above passes the in-scope `cefrLevel` value — **no fallback to `"A1"` literals**, no re-fetch from the DB.
- [ ] `npm run type-check` is the contract: removing the new required parameter will fail compilation. If you change `updateSkillProgress` to accept an optional `cefrLevel`, you have introduced a footgun — make it required.
- [ ] No new call sites are introduced. If you find yourself adding `updateSkillProgress` somewhere new, stop — that's scope creep for this story.

**Given** the new `updateSkillProgress(userId, skill, cefrLevel, score, time)` signature
**When** the project type-checks
**Then** no call site compiles without supplying `cefrLevel`
**And** every existing call site supplies the level the exercise was generated at, not the profile's overall level

### 3. `checkCefrPromotion` Requires All Five TCF Skills

The current promotion gate is: `≥3 distinct skills practiced at currentLevel ∧ ≥10 total exercises ∧ avg score ≥85%`. The new gate adds a **breadth requirement** so users can no longer skip Speaking + Writing.

- [ ] `checkCefrPromotion` in `src/lib/activity.ts` is updated so the criteria are:

  1. The user's `current_cefr_level` is below `C2` (unchanged).
  2. **Evidence across all 5 TCF skills at the current level**: there is at least one `skill_progress` row with `cefr_level = currentLevel` for **each** of `listening`, `reading`, `speaking`, `writing`, `grammar`. (Five distinct values from `TCFSkill`.)
  3. **At least 3 of those 5 skills score ≥ 85** at the current level (computed from the row's running-average `score`).
  4. The sum of `exercises_completed` across all 5 skill rows at the current level is **≥ 10**.
  5. Promotion advances `profiles.current_cefr_level` by exactly one step in `CEFR_ORDER`.

- [ ] **Define a typed promotion-decision helper** to keep the function readable and unit-testable. Add to `src/lib/activity.ts`:

  ```ts
  export interface PromotionEvidence {
    skill: TCFSkill;
    score: number;
    exercisesCompleted: number;
  }

  export interface PromotionDecision {
    promote: boolean;
    /** Reason the gate did not fire — used by Sentry breadcrumbs and tests. */
    reason:
      | "ok"
      | "already-c2"
      | "missing-skills"
      | "too-few-passing-skills"
      | "too-few-exercises";
    missingSkills: TCFSkill[];
  }

  export function evaluatePromotion(
    currentLevel: CEFRLevel,
    rowsAtLevel: PromotionEvidence[]
  ): PromotionDecision {
    /* …pure function, no Supabase access… */
  }
  ```

  Then refactor `checkCefrPromotion` to: (a) fetch the rows, (b) hand them to `evaluatePromotion`, (c) write the new level if `promote === true`. The pure helper is what the test suite exercises.

- [ ] **`reason` semantics** (these strings are stable contract — tests assert on them and Sentry breadcrumbs key on them):

  | `reason` | When |
  |----------|------|
  | `"ok"` | All gates pass; promotion happens |
  | `"already-c2"` | `currentLevel === "C2"` |
  | `"missing-skills"` | Fewer than 5 distinct skills represented at `currentLevel` (returns the absent skills in `missingSkills`) |
  | `"too-few-passing-skills"` | All 5 present, but < 3 score ≥ 85 |
  | `"too-few-exercises"` | All 5 present, ≥ 3 passing, but `sum(exercises_completed) < 10` |

  The first failing gate wins (short-circuit in the order above). When `reason === "ok"`, `missingSkills === []`.

- [ ] When `reason !== "ok"` and `reason !== "already-c2"`, add a Sentry breadcrumb (not a captureError — this is expected non-promotion, not a failure):
  ```ts
  Sentry.addBreadcrumb({
    category: "cefr-promotion",
    level: "info",
    message: `cefr-promotion-skipped: ${decision.reason}`,
    data: { currentLevel, missingSkills: decision.missingSkills },
  });
  ```
  Use the `Sentry` import already in `src/lib/sentry.ts` (do not import `@sentry/react-native` directly here — that's the module's job).

**Given** a user at `current_cefr_level = "A1"` who has skill_progress rows at A1 for listening (90%, 4 exercises), reading (90%, 4 exercises), grammar (90%, 3 exercises), but no rows for speaking or writing
**When** `checkCefrPromotion(userId)` is invoked
**Then** the user is **not** promoted (`reason: "missing-skills"`, `missingSkills: ["speaking", "writing"]`)
**And** `profiles.current_cefr_level` remains `"A1"`

**Given** a user at A1 who has all 5 skills at A1 (listening 90%/4ex, reading 90%/3ex, speaking 88%/2ex, writing 50%/1ex, grammar 60%/1ex — total 11 ex, 3 passing skills)
**When** `checkCefrPromotion(userId)` runs
**Then** the user is promoted to A2 (`reason: "ok"`)

### 4. Re-Promotion Works End-to-End (the Audit's Smoking-Gun Test)

This AC is what makes P0-2 a regression test, not just a theoretical fix.

- [ ] A new test in `src/lib/__tests__/activity.test.ts` simulates a full A1→A2→B1 trajectory using the pure `evaluatePromotion` helper:

  ```ts
  describe("evaluatePromotion — re-promotion regression (P0-2)", () => {
    it("promotes A1 → A2 when all gates pass at A1", () => {
      const decision = evaluatePromotion("A1", buildPassingRowsAt("A1"));
      expect(decision.promote).toBe(true);
      expect(decision.reason).toBe("ok");
    });

    it("does NOT re-promote A2 → B1 when skill rows are still tagged A1", () => {
      // Simulates the P0-2 bug: profile bumped to A2 but skill_progress.cefr_level still 'A1'
      const a2Decision = evaluatePromotion("A2", []);
      expect(a2Decision.promote).toBe(false);
      expect(a2Decision.reason).toBe("missing-skills");
    });

    it("promotes A2 → B1 once skill rows are written at A2", () => {
      const decision = evaluatePromotion("A2", buildPassingRowsAt("A2"));
      expect(decision.promote).toBe(true);
    });
  });
  ```

  The `buildPassingRowsAt(level)` helper lives in the test file and returns 5 `PromotionEvidence` rows that satisfy the gate. **Do not export it from `activity.ts`.**

- [ ] Tests for each `reason` value also exist (`"missing-skills"`, `"too-few-passing-skills"`, `"too-few-exercises"`, `"already-c2"`, `"ok"`). At least one assertion per `reason`.
- [ ] The test for `"missing-skills"` asserts `decision.missingSkills` is sorted in `TCFSkill` declaration order (`listening, reading, speaking, writing, grammar`) for stability.
- [ ] All assertions are on the pure helper — **no Supabase mocking in this story**. The Supabase wrapper (`checkCefrPromotion`) is exercised via type-checking + manual review.

**Given** a passing-by-design test fixture at A1 followed by a passing fixture at A2
**When** `evaluatePromotion` is called with each
**Then** both decisions return `{promote: true, reason: "ok"}`
**And** the bug-reproducing scenario (`evaluatePromotion("A2", [])`) returns `{promote: false, reason: "missing-skills"}`, *not* `{promote: true}`

### 5. Existing `cefr_level` Default Stays — No DB Migration

- [ ] `skill_progress.cefr_level` already has `DEFAULT 'A1'` (`supabase/migrations/20260301000000_initial_schema.sql:53`). **No new migration is needed**. The fix is purely a write-path correctness change in `updateSkillProgress`.
- [ ] **Do not** alter the `skill_progress` schema. Do not add a NOT NULL constraint, do not add a CHECK constraint on `cefr_level`. The `CEFRLevel` type is enforced at the application layer.
- [ ] Backfill behavior for existing rows: rows written before this story will keep their stale `cefr_level` (typically `'A1'`). The first call to `updateSkillProgress` after this story ships will overwrite the field with the actual exercise-time level. This is acceptable (production user count is effectively zero pre-beta) — **flag in Completion Notes** but do not write a backfill SQL script.

**Given** the existing `skill_progress` schema with `cefr_level TEXT DEFAULT 'A1'`
**When** the story ships
**Then** no migration file is added under `supabase/migrations/`
**And** stale rows are self-correcting on the user's next exercise at any level

### 6. Mock-Test Path Acknowledgment (No Code Change)

- [ ] `app/(tabs)/mock-test/[testId].tsx:502-504` (the post-finish persistence block) calls `incrementDailyActivity` + `updateStreak` + `checkCefrPromotion` but **does not** call `updateSkillProgress` per section. That means a perfect TCF Canada mock test does not feed the per-skill scores that `checkCefrPromotion` reads. **Do not fix this here**.
- [ ] Add a single comment immediately above line 502 (or at the new equivalent line) noting the gap and the owning story:
  ```ts
  // TODO(story-9-8): Wire per-skill score writes from `results.sections` into
  // updateSkillProgress(userId, "listening" | "reading" | "writing" | "speaking",
  //   currentLevel, sectionScore, sectionMinutes) once Story 9-8 lands the Speaking
  // pipeline and re-confirms section/skill mapping for TCF Canada.
  ```
- [ ] Confirm the existing `checkCefrPromotion(userId)` call on line 504 still runs after this story (it should — promotion is just gated more tightly now).

**Given** a mock-test session today
**When** the user completes it
**Then** `checkCefrPromotion` runs but typically does not promote because the per-skill rows are not updated by the mock-test path
**And** that is acceptable for v1 (the mock test still records `mock_tests.cefr_result` for display)

### 7. Documentation — Update CLAUDE.md and the Function JSDoc

- [ ] Update the JSDoc on `checkCefrPromotion` (`src/lib/activity.ts:164-173`) to reflect the new criteria. Keep it concise:
  ```
  /**
   * Check if user should be promoted to next CEFR level.
   *
   * Promotion criteria (all must hold at the user's current_cefr_level):
   * - Evidence in all 5 TCF skills (listening, reading, speaking, writing, grammar)
   * - ≥3 of those 5 skills with running-average score ≥ 85
   * - ≥10 total exercises_completed across the 5 skill rows
   *
   * One-step promotion only. C2 is terminal. See evaluatePromotion for the
   * pure decision helper exercised by activity.test.ts.
   */
  ```
- [ ] Update the JSDoc on `updateSkillProgress` (`src/lib/activity.ts:71-76`) to mention the `cefr_level` write and the no-regress rule.
- [ ] Add a single-line note to `CLAUDE.md` under the `## Architecture` section, right after the existing TCF source-of-truth line:
  ```
  **CEFR promotion contract:** `src/lib/activity.ts` — pure decision helper `evaluatePromotion()`, regression-tested by `src/lib/__tests__/activity.test.ts`. Promotion requires evidence in all 5 TCF skills at the current level (verified 2026-05-XX, story 9-2).
  ```
- [ ] **Do not** edit the PRD (`_bmad-output/planning-artifacts/prd.md` line 493 still says "10+ exercises across 3+ skills with 85%+ average"). That document gets reconciled with the rest of the audit follow-ups by Epic 10.1 — **flag in Completion Notes**.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex *(N/A — this story does not touch UI)*
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners *(N/A)*
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` *(N/A — no UI changes)*
- [ ] Non-obvious interactions have `accessibilityHint` *(N/A)*
- [ ] Stateful elements have `accessibilityState` *(N/A)*
- [ ] All tappable elements have minimum 44x44pt touch targets *(N/A)*
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — verify the existing two `captureError` blocks in `activity.ts` retain the new `cefrLevel` field in their metadata where applicable
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize` *(N/A — no text added)*
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test`

## Tasks / Subtasks

- [x] Task 1: Update `updateSkillProgress` to write `cefr_level` (AC: #1)
  - [x] 1.1 Add required `cefrLevel: CEFRLevel` parameter to the function signature in `src/lib/activity.ts`
  - [x] 1.2 Read `existing.cefr_level` (already in the SELECT at line 86) and compute `mergedLevel = max(existing.cefr_level ?? "A1", cefrLevel)` using `CEFR_ORDER.indexOf` for comparison
  - [x] 1.3 Add `cefr_level: mergedLevel` to the upsert payload
  - [x] 1.4 Extend `captureError` metadata to include `cefrLevel`
  - [x] 1.5 Update JSDoc per AC #7
- [x] Task 2: Update all five call sites (AC: #2)
  - [x] 2.1 `src/hooks/use-exercise.ts:359` — pass `cefrLevel` from `persistExercise` parameter
  - [x] 2.2 `src/hooks/use-realtime-voice.ts:541` — pass `cefrLevel` from `UseRealtimeVoiceOptions`
  - [x] 2.3 `src/hooks/use-translation.ts:145` — pass the `cefrLevel` derived at line 89
  - [x] 2.4 `src/hooks/use-echo-practice.ts:297-298` — pass `cefrLevel` from line 96 to both calls
  - [x] 2.5 `src/hooks/use-dictation.ts:434` — pass `cefrLevel` from line 239
  - [x] 2.6 `npm run type-check` — confirm no orphan call sites slipped through
- [x] Task 3: Implement `evaluatePromotion` pure helper (AC: #3)
  - [x] 3.1 Add `PromotionEvidence`, `PromotionDecision` types and the `evaluatePromotion` function to `src/lib/activity.ts`
  - [x] 3.2 Implement short-circuit gate logic in the documented order: `already-c2` → `missing-skills` → `too-few-passing-skills` → `too-few-exercises` → `ok`
  - [x] 3.3 Sort `missingSkills` in `TCFSkill` declaration order for stability
- [x] Task 4: Refactor `checkCefrPromotion` to use the helper (AC: #3)
  - [x] 4.1 After fetching `skills` from Supabase, map to `PromotionEvidence[]` and call `evaluatePromotion`
  - [x] 4.2 If `decision.promote === true`, run the existing UPDATE on `profiles.current_cefr_level`
  - [x] 4.3 If `decision.promote === false` and `reason !== "already-c2"`, emit a Sentry breadcrumb with `level: "info"`
  - [x] 4.4 Update JSDoc per AC #7
- [x] Task 5: Add Jest tests (AC: #4)
  - [x] 5.1 Create `src/lib/__tests__/activity.test.ts` with the `evaluatePromotion` test suite
  - [x] 5.2 Cover all 5 `reason` values with at least one assertion each
  - [x] 5.3 Include the re-promotion trajectory test (A1 → A2 → B1)
  - [x] 5.4 `npm test` is green
- [x] Task 6: Mock-test acknowledgment comment (AC: #6)
  - [x] 6.1 Add the TODO comment at `app/(tabs)/mock-test/[testId].tsx:502`
- [x] Task 7: Documentation (AC: #7)
  - [x] 7.1 JSDoc updates on `updateSkillProgress` and `checkCefrPromotion`
  - [x] 7.2 One-line CLAUDE.md note under `## Architecture`
  - [x] 7.3 PRD discrepancy flagged in Completion Notes for Epic 10.1
- [x] Task 8: Quality gates (AC: #Z)
  - [x] 8.1 `npm run type-check` clean
  - [x] 8.2 `npm run lint` clean
  - [x] 8.3 `npm run format:check` clean
  - [x] 8.4 `npm test` clean (existing 42 tests + 12 new activity tests = 54 total)

## Dev Notes

### Why this story is so small in scope

Two defects, one file (`src/lib/activity.ts`), six call-site lines, one new test file. **It should not require touching anything else**. If you find yourself opening `scoring.ts`, `prompts/*.ts`, `[testId].tsx` (beyond a one-line comment), or any UI file — stop. That's scope creep.

The temptation will be to "while I'm here, also fix the mock-test per-skill writes." Resist it. That fix has a real dependency on TCF Canada's per-section-to-per-skill mapping which is the property of Story 9-8 (Speaking pipeline). Adding the writes here without that mapping resolved would silently mis-attribute mock-test scores.

### Why a pure decision helper, not a giant Supabase-mocking test suite

The current `checkCefrPromotion` interleaves Supabase calls and decision logic. Mocking Supabase in Jest for this project would be the first time we do so — there's no existing pattern (`scoring.test.ts`, `tcf-spec.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts` are all pure). Bootstrapping a mock infrastructure for a single function is bad ROI when the alternative — extracting a pure function — is one short refactor that makes the logic exhaustively testable and inherently reviewable.

`evaluatePromotion` is also future-proofing for Epic 17/Phase 4 (demotion + spaced retention) — that work will extend the helper, not rewrite the gate.

### The five-skill rule and Grammar's awkward role

Story 9-1's TCF Canada pivot dropped Grammar from the in-app *test* pipeline (no Grammar section in the mock test, no Grammar in `MockTestQcmSection`). However:

- `TCFSkill` in `src/types/cefr.ts` still has 5 entries including `grammar`.
- `skill_progress.skill` CHECK constraint still allows `'grammar'`.
- The Grammar practice screen and prompt builder still exist and write `skill_progress` rows for grammar.

Per the audit, "all 5 TCF skills" means the `TCFSkill` union — *including* grammar. This is correct for now: a learner who never touches grammar drills is missing breadth even though TCF Canada itself doesn't test grammar in isolation. If/when Grammar is fully retired as a practice skill, the `evaluatePromotion` helper's gate will need to be rewritten — that is **explicitly Epic 10 / 17 territory**, not this story.

The implication: a brand-new beta user must touch all 5 practice screens before they can ever be promoted past A1. This is intentional friction.

### CEFR_ORDER ordering helper

```ts
import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";

function maxLevel(a: CEFRLevel, b: CEFRLevel): CEFRLevel {
  return CEFR_ORDER.indexOf(a) >= CEFR_ORDER.indexOf(b) ? a : b;
}
```

Use this for the no-regress rule in `updateSkillProgress`. Don't reach for a generic `lodash.max` or a string compare — `"C1" < "C2"` works only by coincidence of ASCII; `"B2" < "A1"` is `false` only by ASCII; in general, lexicographic comparison of CEFR levels is **not** correct. Always go through `CEFR_ORDER.indexOf`.

### Sentry import

```ts
// In src/lib/activity.ts — already imports from "./sentry"
import { addBreadcrumb } from "./sentry";

// Then:
addBreadcrumb({
  category: "cefr-promotion",
  level: "info",
  message: `cefr-promotion-skipped: ${decision.reason}`,
  data: { currentLevel, missingSkills: decision.missingSkills },
});
```

If `addBreadcrumb` is not yet exported from `src/lib/sentry.ts`, add it as a thin wrapper around `Sentry.addBreadcrumb`. **Do not import `@sentry/react-native` directly into `activity.ts`** — `src/lib/sentry.ts` is the only module that should know about the SDK.

### The "evidence" rule — what counts as a row

A `skill_progress` row counts as "evidence" the moment `updateSkillProgress` writes it once. There is no minimum-score gate to count for breadth — only the 3-of-5-passing-at-85% rule cares about the score. This is intentional: we want users to *try* speaking and writing before promotion, not be punished for being weak at them initially.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `CEFR_ORDER`, `CEFRLevel`, `TCFSkill` | `@/src/types/cefr` | Level ordering, type unions |
| `captureError`, `addBreadcrumb` | `@/src/lib/sentry` | Error capture + breadcrumbs |
| `supabase` client | `@/src/lib/supabase` | DB access (already imported in `activity.ts`) |
| `getLocalDateString` | `@/src/lib/activity` | Local date for streak — unrelated, do not touch |
| Path alias `@/*` | `tsconfig.json` | Maps to repo root — use it for new imports |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/__tests__/activity.test.ts` | Jest tests for `evaluatePromotion` covering all 5 `reason` values + the re-promotion trajectory |

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/activity.ts` | Add `cefrLevel` parameter + cefr_level write + no-regress rule to `updateSkillProgress`; add `PromotionEvidence`, `PromotionDecision`, `evaluatePromotion` exports; refactor `checkCefrPromotion` to use the helper + emit Sentry breadcrumb on skip; JSDoc updates |
| `src/hooks/use-exercise.ts` | Pass `cefrLevel` to `updateSkillProgress` (line 359) |
| `src/hooks/use-realtime-voice.ts` | Pass `cefrLevel` (line 541) |
| `src/hooks/use-translation.ts` | Pass `cefrLevel` (line 145) |
| `src/hooks/use-echo-practice.ts` | Pass `cefrLevel` to both calls (lines 297-298) |
| `src/hooks/use-dictation.ts` | Pass `cefrLevel` (line 434) |
| `app/(tabs)/mock-test/[testId].tsx` | Single TODO(story-9-8) comment above the persistence block (~line 502); no logic change |
| `src/lib/sentry.ts` | If `addBreadcrumb` is not yet exported, add a thin wrapper |
| `CLAUDE.md` | One-line CEFR-promotion-contract note under `## Architecture` |

### What This Story Does NOT Include

- **NO** changes to `scoring.ts` (`rawToTCFScore`, `SKILL_WEIGHTS`, scoring bands) → **Epic 10.2**.
- **NO** mock-test per-skill score writes (just the TODO comment) → **Story 9-8**.
- **NO** demotion logic, spaced retention check, or "level decay" → **Epic 17 / P3-8**.
- **NO** DB migration — the existing `cefr_level TEXT DEFAULT 'A1'` is sufficient.
- **NO** backfill SQL — stale rows self-correct on the user's next exercise.
- **NO** PRD edits — line 493 ("3+ skills with 85%+ average") gets reconciled by **Epic 10.1**.
- **NO** Supabase mock infrastructure — the test scope is intentionally the pure helper only.
- **NO** changes to `TCFSkill` union or `skill_progress.skill` CHECK constraint.
- **NO** changes to call sites' surrounding logic — the *only* edit per file is adding the `cefrLevel` argument.

### Audit excerpts for reference

From `_bmad-output/planning-artifacts/shippable-roadmap.md`:

> **P0-2** — CEFR auto-promotion silently broken — `updateSkillProgress` upserts on `(user_id, skill)` without writing `cefr_level`; `checkCefrPromotion` filters by `cefr_level`, so promotion never re-fires after the first one.
> Files: `src/lib/activity.ts:84-110`, `src/lib/activity.ts:174-223`. Severity: P0. Specialist: qa, pedagogy.

> **P0-3** — CEFR promotion does not require all 5 TCF skills — users can be told they reached B2 with zero speaking practice.
> Files: `src/lib/activity.ts:174-223`. Severity: P0. Specialist: pedagogy.

Epic 9 acceptance criterion:

> *"A user who completes 10 exercises × 3 skills at 85% **and also** has Speaking + Writing evidence is auto-promoted; without all 5, they are not."*

### Sentry / Error handling

This story introduces one new failure mode (Sentry breadcrumb emission on every non-promoting `checkCefrPromotion` call). Breadcrumbs are non-blocking and should never throw — but wrap the `addBreadcrumb` call in `try { … } catch { /* swallow */ }` if `src/lib/sentry.ts` does not already make breadcrumbs safe. Do not let a Sentry hiccup break activity tracking.

The existing two `captureError` blocks in `activity.ts` continue to handle real failures (network, RLS denial). The `cefrLevel` field is added to their metadata for diagnostics.

### Project Structure Notes

- New tests live under `src/lib/__tests__/` (existing pattern — `scoring.test.ts`, `tcf-spec.test.ts`, `mock-test-prompt.test.ts`).
- No new imports outside of types/utilities already present in `src/types/cefr` and `src/lib/sentry`.
- The `components/` directory at repo root is unused boilerplate per CLAUDE.md — do not put anything there.
- Path alias `@/*` → repo root (configured in `tsconfig.json`) — use it for new imports added to test files.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-2, P0-3 (lines 37-38), §4 Epic 9 (lines 127-149) — acceptance criterion line 143]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §6 workflow recommendation: invoke specialist agents for both fix and verification — `backend-engineer` + `ai-integration` are this story's specialists per epic deliverable line 132]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 is `in-progress`; story 9-2 currently `backlog` (lines 121-122)]
- [Source: _bmad-output/implementation-artifacts/9-1-tcf-spec-verification-correction.md — completed 2026-05-07, established TCF Canada pivot context that this story inherits]
- [Source: _bmad-output/planning-artifacts/prd.md — §FR40 (line 493) currently states "3+ skills with 85%+ average" — flag for Epic 10.1 reconciliation]
- [Source: _bmad-output/planning-artifacts/architecture.md — line 542 (`activity.ts: Streak, skill progress, CEFR promotion`), line 692 (Progress maps to `skill_progress, daily_activity` tables)]
- [Source: src/lib/activity.ts — current `updateSkillProgress` (lines 71-119), current `checkCefrPromotion` (lines 164-223)]
- [Source: src/types/cefr.ts — `CEFRLevel` and `TCFSkill` unions, `CEFR_ORDER` helper (lines 1-73)]
- [Source: supabase/migrations/20260301000000_initial_schema.sql — `skill_progress` schema (lines 49-65), `cefr_level TEXT DEFAULT 'A1'` (line 53), CHECK on `skill` (line 52)]
- [Source: src/hooks/use-exercise.ts — `persistExercise` already receives `cefrLevel` (line 314); call site at line 359]
- [Source: src/hooks/use-realtime-voice.ts — `UseRealtimeVoiceOptions.cefrLevel` (line 59); call site at line 541]
- [Source: src/hooks/use-translation.ts — `cefrLevel` derived from profile (line 89); call site at line 145]
- [Source: src/hooks/use-echo-practice.ts — `cefrLevel` from profile (line 96); call sites at lines 297-298]
- [Source: src/hooks/use-dictation.ts — `cefrLevel` from profile (line 239); call site at line 434]
- [Source: app/(tabs)/mock-test/[testId].tsx — post-finish persistence (lines 462-509); `checkCefrPromotion(userId)` call at line 504; gap acknowledged but not fixed in this story]
- [Source: src/lib/__tests__/scoring.test.ts, src/lib/__tests__/tcf-spec.test.ts — existing pure-function test patterns to follow]
- [Source: jest.config.js — `jest-expo` preset, `@/*` mapped to `<rootDir>/$1`]
- [Source: CLAUDE.md — project conventions, path alias `@/*`, RLS-on-everything rule (`auth.uid() = user_id`)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- Initial test run failed with "supabaseUrl is required." because `evaluatePromotion` lives in `activity.ts`, which transitively imports `src/lib/supabase.ts` (instantiates `createClient` at module load). Fixed by adding a one-line `jest.setup.js` that stubs `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` so the module loads cleanly under Jest. No Supabase client behavior is mocked — only env vars set so the module import does not throw. Same approach unblocks any future pure-function test in `src/lib/__tests__/`.
- Adding `cefrLevel` to the `saveResults` callback closures in `use-translation.ts`, `use-echo-practice.ts`, and `use-dictation.ts` triggered `react-hooks/exhaustive-deps` warnings (`max-warnings 0` in CI). Resolved by adding `cefrLevel` to each `useCallback` dependency array — semantically correct since `saveResults` now reads `cefrLevel` to credit the right level.

### Completion Notes List

- **P0-2 (re-promotion bug) fixed:** `updateSkillProgress` now writes `cefr_level` on every upsert with a no-regress rule (`maxLevel(existing, incoming)` via `CEFR_ORDER.indexOf`). `checkCefrPromotion` will re-fire on subsequent promotions because skill rows track the level the exercise was generated at, not whatever default was first written.
- **P0-3 (5-skill breadth) fixed:** `evaluatePromotion` (new pure helper, exported from `activity.ts`) gates promotion on (a) all 5 TCF skills present at current level, (b) ≥3 passing at ≥85%, (c) ≥10 total exercises. Gate order is short-circuit: `already-c2` → `missing-skills` → `too-few-passing-skills` → `too-few-exercises` → `ok`. `checkCefrPromotion` is now a thin Supabase wrapper around the helper.
- **`addBreadcrumb` wrapper added to `src/lib/sentry.ts`** — thin try/catch over `Sentry.addBreadcrumb`. Used by `checkCefrPromotion` to emit an `info`-level breadcrumb tagged `cefr-promotion` whenever a non-promoting decision is reached (excluding `already-c2`, which is normal). Lets ops see *why* a user did not advance.
- **All 5 call sites now pass `cefrLevel`:** `use-exercise.ts` (from `persistExercise` param), `use-realtime-voice.ts` (from `UseRealtimeVoiceOptions`), `use-translation.ts`, `use-echo-practice.ts`, `use-dictation.ts` (all from the in-scope `cefrLevel` derived from the user's `current_cefr_level`). The level passed is the level the exercise was generated at, not always the user's profile-wide level — this is correct: a B1 user reviewing A1 should be credited at A1 (and the no-regress rule keeps the row at B1 if it was already there).
- **No DB migration needed.** `skill_progress.cefr_level` already has `DEFAULT 'A1'`. Existing rows will be self-correcting on the user's next exercise. **Backfill flag for ops:** rows written before this story landed will keep stale `cefr_level` values (typically `'A1'`) until they are next touched. This is acceptable pre-beta (production user count effectively zero); no SQL backfill script was added per AC #5.
- **PRD discrepancy flagged for Epic 10.1:** `_bmad-output/planning-artifacts/prd.md` line 493 still says "10+ exercises across 3+ skills with 85%+ average". The implemented contract is "all 5 skills present, ≥3 passing at 85%, ≥10 exercises total". Per the story scope, the PRD is **not** edited here — Epic 10.1 owns that reconciliation pass.
- **Mock-test gap acknowledged, not fixed (per AC #6):** A TODO(story-9-8) comment was added at `app/(tabs)/mock-test/[testId].tsx:502` noting that the post-finish persistence path runs `incrementDailyActivity` + `updateStreak` + `checkCefrPromotion` but does **not** call `updateSkillProgress` per section. Story 9-8 (Speaking pipeline) owns wiring section→skill mapping for TCF Canada.
- **Test scope:** All 12 new tests are pure-function tests on `evaluatePromotion`. The Supabase wrapper `checkCefrPromotion` is exercised via type-check + manual review (no Supabase mocking infrastructure introduced), as scoped by AC #4.
- **Jest infrastructure addition:** `jest.setup.js` (new) + `setupFiles: ["<rootDir>/jest.setup.js"]` in `jest.config.js`. This is the minimal change required to let any `src/lib/__tests__/*.ts` file safely import a module that transitively pulls `supabase.ts`.
- **Quality gates (final):** `npm run type-check` ✅ · `npm run lint` ✅ (0 errors / 0 warnings, `--max-warnings 0`) · `npm run format:check` ✅ · `npx jest` ✅ (5 suites, 54 tests passing).

### File List

- `src/lib/activity.ts` — added `cefrLevel` param + `cefr_level` upsert with no-regress rule to `updateSkillProgress`; added `PromotionEvidence`, `PromotionDecision`, `evaluatePromotion` exports; refactored `checkCefrPromotion` to delegate to the pure helper and emit a Sentry breadcrumb on skip; JSDoc updates; `maxLevel`, `TCF_SKILLS_IN_ORDER`, gate-threshold constants added.
- `src/lib/sentry.ts` — added `addBreadcrumb()` wrapper (with `Breadcrumb` interface) so `activity.ts` does not import `@sentry/react-native` directly.
- `src/lib/__tests__/activity.test.ts` — **new** — 12 unit tests covering all 5 `reason` values, the missingSkills sort-order invariant, the 85%/exercise-count boundaries, and the A1→A2→B1 re-promotion trajectory (including the P0-2 reproducer at `evaluatePromotion("A2", [])`).
- `src/hooks/use-exercise.ts` — call-site update at `persistExercise` (now passes `cefrLevel`).
- `src/hooks/use-realtime-voice.ts` — call-site update for `speaking` skill in conversation persistence.
- `src/hooks/use-translation.ts` — call-site update for `speaking`; added `cefrLevel` to `saveResults` `useCallback` deps.
- `src/hooks/use-echo-practice.ts` — call-site updates for `listening` and `speaking`; added `cefrLevel` to `saveResults` `useCallback` deps.
- `src/hooks/use-dictation.ts` — call-site update for `listening`; added `cefrLevel` to `saveResults` `useCallback` deps.
- `app/(tabs)/mock-test/[testId].tsx` — TODO(story-9-8) comment above the post-finish persistence block; no logic change.
- `CLAUDE.md` — one-line CEFR-promotion-contract note added under `## Architecture`.
- `jest.config.js` — added `setupFiles: ["<rootDir>/jest.setup.js"]`.
- `jest.setup.js` — **new** — env-var stubs so `src/lib/supabase.ts` instantiates cleanly in tests (no Supabase behavior mocked).

### Change Log

- 2026-05-07 — Story 9-2 implemented and ready for review. Two coupled P0 defects (P0-2 re-promotion silent failure, P0-3 missing breadth requirement) closed in `src/lib/activity.ts`. Pure decision helper + 12 regression tests prevent the bugs from recurring.
