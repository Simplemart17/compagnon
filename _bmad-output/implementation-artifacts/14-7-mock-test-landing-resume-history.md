# Story 14.7: Mock-test landing — "Resume in-progress" + "Past results" sections so users can continue an abandoned test or revisit prior scores without navigating into a test runner

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **a user who has previously taken or partially completed a TCF mock test and now opens the Mock test tab**,
I want **to see my in-progress test (if any) at the top of the landing screen so I can resume it AND a list of my completed past results so I can review my scores**,
so that **I don't lose progress when I'm interrupted mid-test, and I can track my score trajectory over time without digging through navigation**.

## Background — Why This Story Exists

### What audit / roadmap owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 108 — audit **P2-13**:

> Mock-test index screen has no "past results" / "resume in-progress" surface despite memory's claim

And roadmap line 276 — Epic 14 deliverable 14.7:

> 14.7 Mock-test landing — add "Resume in-progress" and "Past results" sections. **Covers P2-13.**

The "despite memory's claim" wording in P2-13 refers to a CLAUDE.md paragraph from an earlier story that asserted resume-detection was wired up at the landing screen — it was actually wired up only at the **test-runner screen** ([`app/(tabs)/mock-test/[testId].tsx`](<app/(tabs)/mock-test/[testId].tsx>) via [`use-mock-test-generation.ts`](src/hooks/use-mock-test-generation.ts) lines 289-298). The user can only reach the resume flow by tapping into the same test type they previously started — there's no surface on the landing screen that says "you have an unfinished test, tap here to continue."

### What currently exists (pre-14-7 state)

[`app/(tabs)/mock-test/index.tsx`](<app/(tabs)/mock-test/index.tsx>) renders 4 sections:

1. **Hero header** (lines 166-188) — thin amber line + "TCF" title + subtitle
2. **Full Simulation hero card** (lines 198-199 via [`FullSimCard`](<app/(tabs)/mock-test/index.tsx#L27-L117>)) — prominent CTA for the combined Listening+Reading test
3. **Individual sections** (lines 202-226) — 2 `SkillCard`s (Listening + Reading), cascade-animated with `delay = index * 80`
4. **Written and spoken production** (lines 229-261) — Writing card (`disabled`, "Coming soon · Epic 10") + Speaking card (routes to `/(tabs)/mock-test/speaking`)

**Zero surface for in-progress tests. Zero surface for past results.** The `mock_tests` table already stores both (with `status: "in_progress"` and `status: "completed"` respectively) — this story is purely a UI/data-fetch addition to the landing screen, no schema change.

### Database state the data layer can rely on

`supabase/migrations/20260301000000_initial_schema.sql:164-176` defines the `mock_tests` table:

```sql
CREATE TABLE mock_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  test_type TEXT NOT NULL CHECK (test_type IN ('full','listening','reading','grammar','speaking','writing')),
  total_score INTEGER,
  section_scores JSONB,
  cefr_result TEXT,
  duration_seconds INTEGER,
  questions JSONB NOT NULL,
  status TEXT DEFAULT 'in_progress',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

RLS is enforced via `auth.uid() = user_id` (Story 9-9 hardening). The `status` column allows `"in_progress"` (default), `"completed"`, and historically `"abandoned"` (currently unused but tolerated). Speaking tests use the same table with `test_type = "speaking"` + a separate `section_scores.speaking.{task1,task2,task3,compositeOverall}` payload shape (Story 9-8 + 10-6 pipeline) — they ARE included in the past-results list with appropriate iconography per Q3 below.

### Why the resume surface goes ABOVE the Full Simulation hero

User intent ranking: if the user has an unfinished test, that is **more important than starting a new one**. Burying the resume affordance below the hero or in a tertiary "history" tab forces re-navigation. The standard mobile UX convention (Duolingo / Headspace / Calm) is to surface incomplete-work surfaces above new-work surfaces. Story 14-7 follows this convention.

If no in-progress test exists, the resume section renders nothing (zero vertical space — not an "Empty: no tests in progress" placeholder) so first-time users see the landing screen identical to pre-14-7 plus the past-results section at the bottom (also rendering nothing for first-time users — both sections are conditional).

### Why past results go BELOW Written and spoken production (not at top, not as a tab)

Past results are reference / progress-tracking content — important but not action-taking. Surfacing them above the test CTAs would dilute the "start a new test" intent. The convention used in `app/(tabs)/conversation/history.tsx` and `app/(tabs)/profile/index.tsx` is to put past-activity lists below the action surfaces. Story 14-7 follows that pattern.

### Why ListItemCard (Story 14-2) for both resume + past-results rows

Story 14-2 consolidated 9 inline card components into 2 reusable ones (`SkillCard`, `ListItemCard`). Past-results rows are list items with a primary title + secondary metadata + right-side badge — the canonical `ListItemCard` shape. The resume card is also a list item (one row) — but it's accent-colored to draw the eye, which `ListItemCard` supports via the `leftStripColor` prop. **Both surfaces consume `ListItemCard` — no new card variant introduced.**

The pre-14-2 alternative (bespoke `ResumeCard` + `PastResultRow` components) would re-introduce the Story 14-2 audit finding (P2-10: "three different card treatments"). 14-7 sits on top of 14-2's consolidation discipline.

### Why no pagination / "View all" link in v1

The `mock_tests` table has zero indexes on `(user_id, status, completed_at)` today. A query like `WHERE user_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 10` is fast for any user with <100 completed tests — far above the realistic upper bound for a first-100-DAU launch. Adding pagination + a full-history modal would require either an index (forward-only migration; out of scope per Story 14-2 "0 migrations" discipline applied to 14-X stories) OR client-side cursor pagination that adds complexity for zero v1 user benefit.

**v1 ships latest 10 completed results. The "View all" follow-up is filed as `14-7-followup-past-results-pagination`** for if/when telemetry shows users have >10 completed tests on their device (Sentry breadcrumb when count truncated at 10 — provides operator-visible signal without leaking content).

### Why no separate "RPC aggregate" (vs Story 13-2 pattern)

Story 13-2's `get_home_aggregate` RPC consolidated 11 round-trips into 1 for the home screen. The mock-test landing only needs **2 queries** (in-progress + past-results), both filtered by `user_id` + `status`. Adding an RPC for 2 queries is over-engineering — `Promise.all` of 2 direct supabase queries is faster to ship + reason about. If telemetry later shows the 2-query pattern matters, a follow-up can consolidate via RPC.

### What 14-7 does NOT do

- ❌ Add a full-history modal / dedicated past-results screen (v2 follow-up — `14-7-followup-past-results-pagination`)
- ❌ Add pull-to-refresh on the landing screen (out of scope — landing reloads naturally on tab focus via the existing `useFocusEffect` pattern in similar screens)
- ❌ Add filtering / sorting controls on past results (defer until user count justifies it; v1 = chronological reverse)
- ❌ Add new migration / index on `mock_tests` (current row count is small enough that filtered query stays sub-50ms; future index is `14-7-followup-mock-tests-index`)
- ❌ Add a delete-past-result action (GDPR-compliance is handled via the existing account-delete flow + `cleanup_stale_data()` — per-row delete is a separate UX decision)
- ❌ Add "abandoned" status handling — `status = "abandoned"` is currently unused in the codebase; ignore those rows if they exist (they shouldn't)
- ❌ Add a "best score" badge / highlight on past results (UX nice-to-have; defer until informal user test surfaces demand)

## Acceptance Criteria

### A. NEW landing-data hook

1. **AC-A1:** NEW file `src/hooks/use-mock-test-landing.ts` exports `useMockTestLanding()` returning `{ inProgress, pastResults, loading, error, refetch }`.
2. **AC-A2:** `inProgress` is typed `MockTestInProgressSummary | null` — non-null when the user has at least one row with `status = "in_progress"` AND the resumed test is NOT corrupt (the `corrupt` field from Story 13-4 `use-mock-test-generation.ts` `MockTestResumeData`). Shape:
   ```ts
   interface MockTestInProgressSummary {
     id: string;                    // mock_tests.id
     testType: "full" | "listening" | "reading";
     savedSectionIndex: number;     // 0 or 1 (clamped)
     savedQuestionIndex: number;    // clamped to section's questions.length
     adjustedTimeRemaining: number; // seconds, clamped to [0, totalMinutes * 60]
     totalQuestionsAnswered: number;
     totalQuestionsAcrossSections: number;
     createdAt: string;             // ISO timestamp
   }
   ```
3. **AC-A3:** `pastResults` is typed `MockTestPastResult[]` (empty array when none exist). Shape:
   ```ts
   interface MockTestPastResult {
     id: string;
     testType: "full" | "listening" | "reading" | "speaking";
     totalScore: number | null;     // TCF score 0-699 (null for speaking — uses different scale)
     cefrResult: CEFRLevel | null;  // A1-C2, null if score wasn't computed
     durationSeconds: number | null;
     completedAt: string;           // ISO timestamp (rows with null completed_at are excluded)
   }
   ```
4. **AC-A4:** The hook fires 2 parallel Supabase queries via `Promise.all`:
   - In-progress: `.from("mock_tests").select(...).eq("user_id", userId).eq("status", "in_progress").order("created_at", { ascending: false }).limit(1).maybeSingle()`
   - Past results: `.from("mock_tests").select(...).eq("user_id", userId).eq("status", "completed").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(10)`
5. **AC-A5:** The in-progress query's resumed data is validated via the **same `corrupt` detection logic** as Story 13-4 `use-mock-test-generation.ts:300+` (or imports + reuses the pure helper from that module). Corrupt rows return `inProgress: null` AND fire `addBreadcrumb({ category: "mock-test", level: "warning", message: "Landing: in-progress row corrupt — hidden from resume surface", data: { mockTestId } })` (no row deletion at this layer — that's the test-runner screen's responsibility per Story 13-4).
6. **AC-A6:** Errors from either query route through `captureError(err, "mock-test-landing-fetch")` (Story 9-3 allowlist preserved — `feature` tag is short categorical under 80 chars; no new extras keys). On error, hook returns `{ inProgress: null, pastResults: [], loading: false, error: err }`. Past-results truncation at limit 10 fires `addBreadcrumb({ category: "mock-test", level: "info", message: "Landing: past results truncated at 10", data: { actualCount } })` ONLY if the returned array length === 10 (heuristic that there may be more — exact count requires a separate `count()` query which is out of scope for v1).
7. **AC-A7:** `refetch` returns `Promise<void>` and re-fires both queries; consumed by the screen's `useFocusEffect` to refresh data when the user returns from a test runner.

### B. NEW Resume-in-progress section on the landing screen

8. **AC-B1:** When `useMockTestLanding().inProgress` is non-null, render a new section ABOVE the existing `FullSimCard` (i.e., before line 198 of `mock-test/index.tsx`).
9. **AC-B2:** The section header is "Resume" (Typography.sectionHeader, Colors.textPrimary, `accessibilityRole="header"`).
10. **AC-B3:** The resume row uses `<ListItemCard ... />` from `src/components/common/ListItemCard` with these prop values:
    - `titlePrimary`: per `testType`: `"full" → "TCF Canada — Full QCM"`, `"listening" → "Listening section"`, `"reading" → "Reading section"`.
    - `titleSecondary`: progress like `"Section 2 · Question 17 of 29"` (1-indexed for human display).
    - `description`: time remaining formatted via a NEW helper `formatTimeRemaining(seconds: number): string` → e.g., `"~24 min remaining"` for `seconds >= 60`, `"<1 min remaining"` for `seconds in (0, 60)`, `"Time's up"` for `seconds <= 0`. The helper is exported `@internal` for test pinning.
    - `iconNode`: `<Icon name="refresh-cw" size={24} color={Colors.accent} />` (Story 14-3 Icon system; "refresh-cw" is in the IconName union per Story 14-3 line 1 of design — VERIFY at impl time, fall back to `"play"` if not present).
    - `iconColor`: `Colors.accent` (the halo tint).
    - `leftStripColor`: `Colors.accent` (CTA-cluster signal — user action needed; matches Story 14-5 active-state convention).
    - `rightContent`: `<Text style={{ ...Typography.cardTitle, color: Colors.accent }}>→</Text>` (the chevron lives in the right slot).
    - `onPress`: `() => router.push(\`/(tabs)/mock-test/\${inProgress.testType}\`)` (the test-runner screen auto-detects the in-progress row via Story 13-4's resume flow).
    - `accessibilityLabel`: `\`Resume \${titlePrimary}, \${descriptionShort}\`` where `descriptionShort` includes both progress + time-remaining.
    - `accessibilityHint`: `"Double tap to continue your test where you left off."`
11. **AC-B4:** When `useMockTestLanding().inProgress` is null, NO section header is rendered (zero vertical space — first-time users see the unchanged landing layout for everything above the Full Simulation card).

### C. NEW Past Results section on the landing screen

12. **AC-C1:** When `useMockTestLanding().pastResults.length > 0`, render a new section BELOW the Written and spoken production section (i.e., after line 261 of `mock-test/index.tsx`).
13. **AC-C2:** Section header is "Past results" (Typography.sectionHeader, Colors.textPrimary, `accessibilityRole="header"`).
14. **AC-C3:** Render each `MockTestPastResult` via `<ListItemCard ... />`:
    - `titlePrimary`: per `testType`: `"full" → "Full QCM"`, `"listening" → "Listening"`, `"reading" → "Reading"`, `"speaking" → "Speaking"`.
    - `titleSecondary`: per `testType`: `"full" → "Listening + Reading"`, `"listening" → "Compréhension orale"`, `"reading" → "Compréhension écrite"`, `"speaking" → "Expression orale"` (FR pedagogical reinforcement per Story 14-1 chrome rule).
    - `description`: formatted as `\`\${formattedDate(completedAt)} · \${formattedDuration(durationSeconds)}\`` — e.g., `"May 14 · 38 min"`. The `formattedDate` helper uses `new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })` (Story 14-1 R1-M5 lesson: NEVER `.toLocaleDateString("fr"...)` — chrome rule). The `formattedDuration` helper rounds to nearest minute.
    - `iconNode`: per `testType`: `"full" → <Icon name="award" />`, `"listening" → <Icon name="headphones" />`, `"reading" → <Icon name="book-open" />`, `"speaking" → <Icon name="message-circle" />` — each sized 24 with `color={Colors.primary}`. These match the existing per-section iconography in `mock-test/index.tsx` SECTIONS.
    - `iconColor`: per `testType`: `Colors.primary` (full = navy), `Colors.skillListening`, `Colors.skillReading`, `Colors.skillPronunciation` (speaking).
    - `leftStripColor`: `LEVEL_COLORS[cefrResult]` when `cefrResult` is non-null; else `Colors.borderLight` (subtle).
    - `rightContent`: a CEFR badge pill (rendered inline as a small `View` styled as `{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radii.chip, backgroundColor: LEVEL_COLORS[cefrResult] ?? Colors.borderLight }` containing `<Text>{cefrResult ?? "—"}</Text>` styled with `{ ...Typography.caption, color: Colors.textOnDark, fontWeight: "700" }`) + a TCF score below `\`\${totalScore}/699\`` for non-speaking, or `"—"` for speaking (Story 14-7 v1 doesn't render speaking 0-20 score on the landing because it'd be ambiguous next to TCF 0-699; speaking past-results show CEFR badge only).
    - `onPress`: navigates to the existing `app/(tabs)/mock-test/results.tsx` screen via `router.push({ pathname: "/(tabs)/mock-test/results", params: { data: JSON.stringify(reconstructed) } })`. The reconstructed `TestResults` payload comes from the past-result row's `section_scores` JSONB (re-fetched ON DEMAND when the user taps, NOT pre-loaded for all 10 rows — keeps the landing-screen query payload light). Implementation: a NEW exported helper `reconstructTestResultsFromMockTestRow(row: MockTestRow): TestResults` in `src/lib/mock-test-results.ts` does the conversion + a paired `useMockTestResultsLoader(mockTestId)` hook fires the on-tap fetch + nav.
    - `accessibilityLabel`: `\`\${titlePrimary} on \${formattedDate}, scored \${cefrResult ?? "no rating"}\``.
    - `accessibilityHint`: `"Double tap to view detailed results."`
    - `delay`: cascade animation — `index * 80ms` matching Story 14-2 cascade pattern.
15. **AC-C4:** Rendered as a vertical stack (NOT a horizontal scroll) — past results are progress-tracking data, not a carousel.
16. **AC-C5:** When `pastResults` is empty, NO section header is rendered (no "Empty: no past results" placeholder — first-time users see unchanged screen below production card).

### D. Integration with the existing landing screen

17. **AC-D1:** `app/(tabs)/mock-test/index.tsx` `MockTestIndex` component consumes `useMockTestLanding()` and wires the 2 new sections inline. The existing 4 sections (hero, Full Simulation card, Individual sections, Production) are UNCHANGED.
18. **AC-D2:** Screen wraps the data fetch in `useFocusEffect` (or `useEffect` + `useNavigation().addListener("focus", ...)`) so the landing refreshes when the user returns from a test runner or results screen (catches the case where the user just completed a test — past results should immediately show the new entry).
19. **AC-D3:** Loading state — while `useMockTestLanding().loading === true`, the 2 new sections show skeleton placeholders (NOT spinners — Polish Requirement). A single `<View>` per pending section, height matching the ListItemCard's natural height (~76pt), background `Colors.primary5`, borderRadius `Radii.card`. The pre-existing static sections (Full Simulation card, Individual sections, Production) render immediately without waiting on the landing data.
20. **AC-D4:** Error state — if `useMockTestLanding().error` is non-null, the 2 sections render as if both `inProgress = null` and `pastResults = []` (silently hide; the `captureError` from AC-A6 covers operator visibility — no user-facing error UI per Story 13-2 / 13-3 fail-silently pattern for non-critical landing data).

### E. NEW helper module + tests

21. **AC-E1:** NEW file `src/lib/mock-test-results.ts` exports:
    - `formatTimeRemaining(seconds: number): string` (used by Resume row description) — `@internal` for test introspection.
    - `formatPastResultDate(iso: string): string` — uses `new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })`.
    - `formatPastResultDuration(seconds: number | null): string` — rounds to nearest minute; returns `"—"` for null.
    - `reconstructTestResultsFromMockTestRow(row: MockTestRow): TestResults | null` — converts a `mock_tests` row's `section_scores` JSONB into the `TestResults` shape consumed by `results.tsx`. Returns `null` for malformed `section_scores` (caller surfaces UI error).
22. **AC-E2:** NEW runtime test file `src/hooks/__tests__/use-mock-test-landing.test.tsx` — covers (a) happy path with 1 in-progress + 5 past results, (b) empty path (zero rows), (c) error path (Supabase rejection), (d) corrupt-in-progress filtering (returns `inProgress: null` + fires breadcrumb), (e) past-results truncation breadcrumb at exactly 10 rows, (f) `refetch` re-fires both queries, (g) speaking results pass through with `totalScore: null` correctly. Spec target: **7-10 runtime cases**.
23. **AC-E3:** NEW source-drift test file `src/lib/__tests__/mock-test-landing-source-drift.test.ts` — Story 12-2 P12 comment-stripped read pattern + Story 13-2 P11 paired POSITIVE+NEGATIVE pins:
    - Case 1: `useMockTestLanding` is imported in `mock-test/index.tsx`.
    - Case 2: POSITIVE — the resume section's `<ListItemCard` has `leftStripColor={Colors.accent}`. NEGATIVE — no raw hex in the new sections.
    - Case 3: POSITIVE — past-results rendering uses `<ListItemCard` (NOT bespoke `<View>` + `<Text>` JSX — defends against the Story 14-2 P2-10 audit finding re-emerging).
    - Case 4: POSITIVE — the screen calls `formatTimeRemaining` + `formatPastResultDate` from `mock-test-results.ts` (delete-don't-alias guard against re-inlining the formatters).
    - Case 5: POSITIVE — `useFocusEffect` is imported AND invoked (catches the regression where a developer drops focus-refresh because "it works on first load").
    - Case 6: POSITIVE — Helper `reconstructTestResultsFromMockTestRow` is exported from `src/lib/mock-test-results.ts`.
    - Spec target: **6-8 drift cases**.
24. **AC-E4:** NEW pure-helper test file `src/lib/__tests__/mock-test-results.test.ts` — covers `formatTimeRemaining` boundaries (negative, 0, 1, 59, 60, 61, 1499, 1500), `formatPastResultDate` (valid ISO, invalid ISO returns `"—"`), `formatPastResultDuration` (null → `"—"`, 0 → `"0 min"`, 59 → `"1 min"`, 60 → `"1 min"`, 1799 → `"30 min"`, 2400 → `"40 min"`), `reconstructTestResultsFromMockTestRow` (valid section_scores, missing field returns null, malformed JSON returns null). Spec target: **12-15 cases**.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (Story 1B-1 + 14-4 invariant preserved; drift detector Case 2 NEGATIVE-pins `#[0-9a-fA-F]{3,8}` in the new sections).
- [ ] All loading states use skeleton placeholders — NO `ActivityIndicator` spinners (AC-D3).
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` (Resume row + each past-results row + section headers).
- [ ] Non-obvious interactions have `accessibilityHint` (AC-B3 + AC-C3 specify exact hints).
- [ ] Stateful elements have `accessibilityState` (N/A for read-only past results; resume row has no state — single press affordance).
- [ ] All tappable elements have minimum 44×44pt touch targets (`ListItemCard`'s default press surface is full-row height ~76pt; both axes pass).
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — AC-A6 specifies the canonical tag `"mock-test-landing-fetch"`.
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize` (use `Typography.sectionHeader` for headers, `Typography.body` / `caption` / `cardTitle` for content).
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test -- --no-coverage && npm run check:tokens`.
- [ ] Per Story 14-1 chrome rule: all chrome strings ("Resume", "Past results", "Listening section", etc.) are English. Per Story 14-1 R1-M5: `toLocaleDateString` is called with `"en"` locale, NEVER `"fr"`. Per chrome+content split: section-NAME chrome ("Listening section") is EN; pedagogical-reinforcement FR (`"Compréhension orale"`) is the `titleSecondary` line — content side of the rule.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored. Run `git check-ignore -v _bmad-output/implementation-artifacts/14-7-mock-test-landing-resume-history.md` — should return non-zero (not ignored).
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/14-7-mock-test-landing-resume-history.md` passes.

## Tasks / Subtasks

- [x] **Task 1: Create `src/lib/mock-test-results.ts`** (AC: E1)
  - [x] 1.1 Define `MockTestRow` type matching the supabase row shape (`id`, `user_id`, `test_type`, `total_score`, `section_scores`, `cefr_result`, `duration_seconds`, `questions`, `status`, `created_at`, `completed_at`).
  - [x] 1.2 Export `formatTimeRemaining(seconds)` with boundary cases: `<= 0 → "Time's up"`, `< 60 → "<1 min remaining"`, `>= 60 → "~{round(seconds/60)} min remaining"`.
  - [x] 1.3 Export `formatPastResultDate(iso)` using `toLocaleDateString("en", {month:"short", day:"numeric"})`; return `"—"` on `isNaN(Date.parse(iso))`.
  - [x] 1.4 Export `formatPastResultDuration(seconds)` — null → `"—"`; else `\`\${Math.max(0, Math.round(seconds/60))} min\``.
  - [x] 1.5 Export `reconstructTestResultsFromMockTestRow(row)` — Zod-style shape validation on `section_scores` JSONB; returns the `TestResults` shape consumed by `results.tsx` (lines 24-29 reference); returns `null` if validation fails. `addBreadcrumb({ category: "mock-test", level: "warning", message: "Landing: reconstructTestResultsFromMockTestRow validation failed", data: { mockTestId } })` on null path.
- [x] **Task 2: Create `src/hooks/use-mock-test-landing.ts`** (AC: A1-A7)
  - [x] 2.1 Define `MockTestInProgressSummary` + `MockTestPastResult` interfaces per AC-A2 + AC-A3.
  - [x] 2.2 Hook returns `{ inProgress, pastResults, loading, error, refetch }` matching AC-A1.
  - [x] 2.3 `useEffect` keyed on user.id fires `Promise.all([inProgressQuery, pastResultsQuery])` via `supabase.from(...)`.
  - [x] 2.4 Validate in-progress row via Story 13-4's `corrupt` detection — if `questions` JSONB is missing or empty for the test's expected sections, return `inProgress: null` + breadcrumb (AC-A5).
  - [x] 2.5 Limit past-results to 10 rows; breadcrumb at exactly 10 rows (AC-A6).
  - [x] 2.6 Wrap entire fetch in try/catch; route errors through `captureError(err, "mock-test-landing-fetch")` (Story 9-3 allowlist).
  - [x] 2.7 Expose `refetch` that re-fires both queries (consumed by `useFocusEffect` in the screen).
- [x] **Task 3: Wire the landing screen** (AC: B1-B4 + C1-C5 + D1-D4)
  - [x] 3.1 `app/(tabs)/mock-test/index.tsx` import `useMockTestLanding`, the 3 formatter helpers, `ListItemCard`, `Icon`, `useFocusEffect`.
  - [x] 3.2 Inside `MockTestIndex` (or rename to add hooks if needed), call `useMockTestLanding()` + wrap `refetch` in `useFocusEffect`.
  - [x] 3.3 ABOVE the existing `<FullSimCard />` (line 198) — conditionally render the Resume section per AC-B1 to B4.
  - [x] 3.4 BELOW the existing Production section (after line 261) — conditionally render the Past Results section per AC-C1 to C5.
  - [x] 3.5 Loading skeletons per AC-D3 — `Colors.primary5` background, `Radii.card`, ~76pt height.
  - [x] 3.6 Verify no `className` + `style` mix on the new ListItemCards (Story 13-7 invariant) — but `ListItemCard` itself handles this internally; consumers just pass props.
- [x] **Task 4: Past-result tap → results screen with reconstructed payload** (AC: C3-onPress)
  - [x] 4.1 NEW helper hook `useMockTestResultsLoader()` exported from `src/hooks/use-mock-test-results-loader.ts` (or co-located in `use-mock-test-landing.ts` if scope stays small). On `loadAndNavigate(mockTestId)`: (a) fetch the full row, (b) call `reconstructTestResultsFromMockTestRow`, (c) on success → `router.push({pathname:"/(tabs)/mock-test/results", params:{data: JSON.stringify(reconstructed)}})`, (d) on failure → `Alert.alert("Couldn't load result", "This past result has a malformed score record and can't be displayed.")` + `captureError`.
  - [x] 4.2 Wire the past-result `<ListItemCard onPress={...}>` to call this hook's loader.
- [x] **Task 5: Pure-helper tests** (AC: E4)
  - [x] 5.1 Create `src/lib/__tests__/mock-test-results.test.ts` with the 12-15 boundary cases per AC-E4.
- [x] **Task 6: Hook runtime tests** (AC: E2)
  - [x] 6.1 Create `src/hooks/__tests__/use-mock-test-landing.test.tsx` with the 7-10 cases per AC-E2; mock supabase + sentry per Story 13-2 / 13-3 precedent.
- [x] **Task 7: Source-drift tests** (AC: E3)
  - [x] 7.1 Create `src/lib/__tests__/mock-test-landing-source-drift.test.ts` with the 6-8 cases per AC-E3 + Story 12-2 P12 comment-stripped readFile + Story 13-2 P11 paired POSITIVE+NEGATIVE pins.
- [x] **Task 8: Quality gates** (AC: Z)
  - [x] 8.1 `npm run type-check` — 0 errors.
  - [x] 8.2 `npm run lint` — 0 errors / 0 warnings.
  - [x] 8.3 `npm run format:check` — pass.
  - [x] 8.4 `npm test -- --no-coverage` — full suite + new test files pass. Spec target: **+25-33 net Jest cases** (1982 → 2007-2015).
  - [x] 8.5 `npm run check:tokens` — Story 14-4 gate passes (no new raw tokens; the new sections use `Radii.*` / `Shadows.*` exclusively via `ListItemCard`).
  - [x] 8.6 `npm run check:colors` — same pre-existing failures from `14-4-followup`; verify 14-7 adds NO new hex literals in production code.

## Operator-decision items (resolve before/during implementation)

**Q1 — Section ordering on the landing screen:**

- **Recommended:** Resume (if any) → Hero "TCF" → Full Simulation card → Individual sections → Written + spoken production → Past results.

  Rationale: Resume is the highest-intent affordance for returning users. Past results are reference/progress; they sit at the bottom following the home + profile + conversation-history conventions.

- Alternates: (a) Past results above the hero — discouraged (dilutes new-test intent); (b) Both new sections as a separate tab — discouraged (the existing tab IS the mock-test landing; a sub-tab is overkill for v1).

**Q2 — Maximum past-results count on landing:**

- **Recommended:** Latest 10 by `completed_at DESC`. v1 doesn't paginate or surface a "View all" — the followup is filed as `14-7-followup-past-results-pagination`.

- Alternate: 5 (would be conservative on screen real-estate but most users won't have 5+ completed mock tests in their first month; 10 lets power users see ~2 weeks of progress at-a-glance).

**Q3 — Speaking tests in past-results:**

- **Recommended:** INCLUDE speaking past results in the same list. The `iconNode` differs per test_type (per AC-C3); speaking shows `cefrResult` badge only (no TCF score because speaking uses a 0-20 publisher scale, not the 0-699 TCF scale — rendering "16/699" would be wrong).

- Alternate: Exclude speaking from past-results on the landing (would force users to navigate to a separate speaking-history surface that doesn't exist) — discouraged.

**Q4 — Resume row's CTA chevron vs full "Resume" button:**

- **Recommended:** Right-aligned chevron `→` in `Colors.accent` (text-only), to keep the row visually consistent with other `ListItemCard` rows (which use `rightContent` for badges/chevrons, not full buttons).

- Alternate: A dedicated `<Pressable bg-accent rounded-2xl>Resume</Pressable>` button in the right slot — discouraged (visually heavier than past-results rows; breaks ListItemCard's design rhythm).

**Q5 — Handling of `mock_tests` rows with `status = "abandoned"` (legacy):**

- **Recommended:** Ignore them entirely. The `status = "abandoned"` value is never set by current code paths but is allowed by the table's text type. Past-results query filters `status = "completed"` (excludes abandoned by construction). In-progress query filters `status = "in_progress"` (also excludes abandoned). No special handling needed.

- Alternate: Show abandoned rows in a "Drafts" sub-section — discouraged for v1 (no current code writes that value; introducing UI for a pseudo-state adds confusion).

## Dev Notes

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist:** new `feature` tag `"mock-test-landing-fetch"` (28 chars; under 80-char threshold; rides on existing `feature` extras key — no allowlist change needed). New breadcrumb categories `"mock-test"` are breadcrumb-side (NOT `captureError` extras). `mockTestId` extras key is acceptable per existing precedent (UUIDs in extras are bounded-length, not PII).
- **Story 9-4 stored-prompt-injection:** N/A — no AI prompt mutations.
- **Story 9-9 SQL hardening:** N/A — no new migrations; existing RLS on `mock_tests` covers the new SELECT queries.
- **Story 12-1 RealtimeOrchestrator:** orthogonal — mock-test landing doesn't touch conversation flow.
- **Story 12-6 transcript cap (`MAX_TRANSCRIPT_ENTRIES = 200`):** orthogonal — separate surface.
- **Story 13-2 home aggregate pattern:** the mock-test landing has only 2 queries — NOT consolidated into an RPC for v1 (Background section explains: over-engineering for 2 queries). If telemetry later justifies it, `14-7-followup-mock-test-landing-rpc` is filed.
- **Story 13-3 session-feedback aggregate:** orthogonal — different surface (conversation feedback, not mock-test landing).
- **Story 13-4 mock-test parallel generation:** the in-progress detection logic in `use-mock-test-generation.ts:289+` is the canonical pattern; Story 14-7 IMPORTS the same `corrupt` detection helper (or re-implements it identically) — DO NOT diverge the validation logic across the two surfaces.
- **Story 13-5 history modal FlatList:** the past-results list on landing has at most 10 rows (per AC-A4) — no virtualization needed. A plain `<View>` map is sufficient. (Story 13-5's FlatList was needed for 500+ message transcripts.)
- **Story 13-7 frozen static styles:** `ListItemCard` itself handles its static-style invariant (`listItemCardStaticStyle: ViewStyle = Object.freeze({...})`). Story 14-7 consumes the component — no new static-style constants needed.
- **Story 14-1 chrome rule:** ALL chrome strings on landing are English. Per AC-C3: `titleSecondary` carries the FR pedagogical reinforcement (`"Compréhension orale"`, `"Compréhension écrite"`, `"Expression orale"`). The `toLocaleDateString` calls use `"en"` locale (Story 14-1 R1-M5).
- **Story 14-2 SkillCard + ListItemCard:** **the entire 14-7 implementation rides on `ListItemCard` (both resume row + past-results rows). 0 new card components introduced.** The drift detector Case 3 pins this (NEGATIVE-guards against bespoke `<View>` + `<Text>` JSX in the new sections).
- **Story 14-3 Icon system:** all icons consume via `<Icon name={...} />`. The `IconName` union must already include `"refresh-cw"` (resume CTA) — VERIFY at impl time; if absent, use `"play"` instead.
- **Story 14-4 design-token enforcement:** all colors `Colors.*`; all radii `Radii.*` (via `ListItemCard`); no raw `shadowOpacity`. The drift detector Case 2 NEGATIVE-pins raw hex.
- **Story 14-5 accent-color split:** Resume row uses `Colors.accent` (CTA-cluster — user action required). Past-results rows use `LEVEL_COLORS[cefrResult]` (per-CEFR-band, NOT a streak/progress signal). No streak/progress token usage in 14-7.
- **Story 14-6 post-onboarding tour:** orthogonal — separate onboarding flow.

### Pattern to follow

The conversation history surface at [`app/(tabs)/conversation/history.tsx`](<app/(tabs)/conversation/history.tsx>) is the closest precedent for past-results rendering — it lists completed conversations with date, duration, CEFR level, scoring metadata. Mimic that file's `useFocusEffect` refresh + supabase `.eq("status", "completed").order("completed_at", { ascending: false })` pattern.

The resume row's accent-strip + arrow-CTA pattern mirrors the home screen's `ConversationCard` (the "tap me to start a conversation" CTA) at [`app/(tabs)/home/index.tsx`](<app/(tabs)/home/index.tsx>) — though Story 14-7 uses `ListItemCard` instead of a bespoke card (Story 14-2 discipline).

Reconstructing `TestResults` from a stored `mock_tests` row's `section_scores` JSONB requires careful Zod-style validation because the JSONB is operator-controlled (early tests may have malformed `section_scores` payloads from pre-Story-13-4 saves). Story 9-7 chatCompletionJSON's parse-retry pattern is the precedent for "trust but verify the stored JSON shape."

### References

- [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 108 (audit P2-13) + line 276 (Epic 14 deliverable 14.7)
- [`app/(tabs)/mock-test/index.tsx`](<app/(tabs)/mock-test/index.tsx>) — current landing screen (4 sections: hero, Full Simulation, Individual sections, Production); new sections inserted at known line-anchors
- [`app/(tabs)/mock-test/[testId].tsx`](<app/(tabs)/mock-test/[testId].tsx>) — test runner; consumes `useMockTestGeneration()` for auto-resume on focus
- [`app/(tabs)/mock-test/results.tsx`](<app/(tabs)/mock-test/results.tsx>) — results screen; accepts `TestResults` via `params.data` JSON-encoded
- [`src/hooks/use-mock-test-generation.ts`](src/hooks/use-mock-test-generation.ts) lines 60-77 (`MockTestResumeData` shape) + lines 289-298 (in-progress query) + line 300+ (corrupt detection)
- [`src/components/common/ListItemCard.tsx`](src/components/common/ListItemCard.tsx) — Story 14-2 reusable component
- [`src/lib/design.ts`](src/lib/design.ts) — `Colors.accent`, `Colors.primary`, `Colors.skill*`, `LEVEL_COLORS`, `Typography.*`, `Radii.*`
- [`src/lib/scoring.ts`](src/lib/scoring.ts) — TCF score (0-699) ↔ CLB ↔ CEFR mapping
- [`src/lib/sentry.ts`](src/lib/sentry.ts) — `captureError` + `addBreadcrumb` helpers; allowlist contract
- [`app/(tabs)/conversation/history.tsx`](<app/(tabs)/conversation/history.tsx>) — closest precedent for past-list rendering pattern
- [`supabase/migrations/20260301000000_initial_schema.sql`](supabase/migrations/20260301000000_initial_schema.sql) lines 164-176 — `mock_tests` schema
- Story 14-2 [`_bmad-output/implementation-artifacts/14-2-card-consolidation.md`](_bmad-output/implementation-artifacts/14-2-card-consolidation.md) — `ListItemCard` design contract
- Story 13-4 [`_bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md`](_bmad-output/implementation-artifacts/13-4-streaming-mock-test-generation.md) — in-progress resume + corrupt detection precedent

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Mid-implementation: `useFocusEffect` import path verified at `expo-router/build/exports.d.ts` — exported as `{ useFocusEffect, EffectCallback } from './useFocusEffect'`. Direct import from `"expo-router"` works.
- Mid-implementation: `IconName` typed union from Story 14-3 lacked `"refresh-cw"` / `"play"`. Added `"play-circle"` to the union as a small additive change (Feather supports it; matches "resume/start" semantic).
- Mid-implementation: lint flagged `import/no-duplicates` warning on 2 sentry imports (`captureError` + `addBreadcrumb` imported separately) — consolidated to single named-import line.
- Mid-implementation: prettier auto-formatted 4 files post-write (long lines split / multi-line arrow formatting) — committed as part of final commit.
- Branch setup: branched from `origin/main` per Memory rule (do NOT stack on 14-6's still-open PR #106). Resolved sprint-status.yaml merge conflict by keeping 14-6 status as `review` (PR #106 not merged yet) on this branch.

### Completion Notes List

**Q1 (operator-decision) — Section ordering:** recommended layout applied verbatim — Resume section ABOVE Full Simulation hero; Past results section BELOW Written and spoken production. Both sections are conditional (zero vertical space when empty — no "Empty: no tests in progress" placeholder for first-time users).

**Q2 (operator-decision) — Past-results limit:** 10 rows, hardcoded as `PAST_RESULTS_LIMIT = 10` in `use-mock-test-landing.ts`. Truncation breadcrumb fires at exactly 10 rows (heuristic — exact count would require a `count()` query, out of scope per spec). Pagination + full-history modal filed for `14-7-followup-past-results-pagination`.

**Q3 (operator-decision) — Speaking past-results:** INCLUDED in the same list. `iconNode` per `test_type` (full=award, listening=headphones, reading=book-open, speaking=message-circle). Speaking rows show CEFR badge only — no TCF score (publisher 0-20 scale would be misleading next to TCF 0-699). The screen's `PastResultRow` component renders `result.testType !== "speaking" && <Text>{totalScore}/699</Text>` to suppress the score line for speaking.

**Q4 (operator-decision) — Resume CTA chevron:** right-aligned chevron `→` in `Colors.accent` via the `rightContent` slot (NOT a full Pressable button) — matches `ListItemCard` rhythm with other past-results rows. The full row is the press target (default `onPress` of `ListItemCard`).

**Q5 (operator-decision) — Abandoned rows:** ignored entirely. Both queries filter by `status` IN (`in_progress`, `completed`); abandoned never matches. No special handling needed.

**Implementation summary:**

- NEW `src/lib/mock-test-results.ts` (~210 lines incl. JSDoc): 4 pure helpers (`formatTimeRemaining` + `formatPastResultDate` + `formatPastResultDuration` + `reconstructTestResultsFromMockTestRow`) + `MockTestRow` interface + `TestResultsPayload` interface.
- NEW `src/hooks/use-mock-test-landing.ts` (~330 lines): hook with 2 parallel supabase queries via `Promise.all`; corrupt-row detection mirrors Story 13-4's `hasValidQuestions` heuristic; `PAST_RESULTS_LIMIT = 10` truncation with operator-visible breadcrumb; fail-safe `captureError(_, "mock-test-landing-fetch")`. Exports `validateInProgressRow` + `toPastResult` as pure helpers for runtime tests.
- NEW `src/hooks/use-mock-test-results-loader.ts` (~85 lines): on-tap loader that fetches the full `mock_tests` row by id, runs `reconstructTestResultsFromMockTestRow`, then navigates to `/(tabs)/mock-test/results` with the JSON-encoded payload. Surfaces malformed-row failures via French-free Alert.
- MODIFIED `app/(tabs)/mock-test/index.tsx`: added 2 conditional sections (Resume + Past results); added `useFocusEffect`-driven refetch; introduced helper components `ResumeInProgressRow`, `PastResultRow`, `LandingSkeletonRow` (all in-file — they're tightly coupled to the landing surface). The pre-14-7 hero + FullSimCard + Individual sections + Production sections are UNCHANGED.
- MODIFIED `src/components/common/Icon.tsx`: added `"play-circle"` to `IconName` union for the Resume CTA.

**Tests (3 new files; +43 net Jest cases since 1981 baseline):**

- `src/lib/__tests__/mock-test-results.test.ts` — 22 pure-helper boundary cases (formatTimeRemaining × 7, formatPastResultDate × 3, formatPastResultDuration × 5, reconstructTestResultsFromMockTestRow × 7)
- `src/hooks/__tests__/use-mock-test-landing.test.tsx` — 13 hook-runtime cases (happy + empty + error + corrupt-in-progress + speaking-pass-through + truncation breadcrumb + refetch + non-QCM-skip + below-threshold + 3 pure-helper cases)
- `src/lib/__tests__/mock-test-landing-source-drift.test.ts` — 8 drift cases (screen imports + Resume Colors.accent strip + ListItemCard for past-results + formatter delete-don't-alias + useFocusEffect invoked + helper exports + en-only locale + Promise.all + captureError tag)

**Cross-story invariants preserved by construction:**

- Story 9-3 telemetry — new `feature` tag `"mock-test-landing-fetch"` + `"mock-test-results-loader"` are short categorical (< 80 chars) on the existing `feature` extras key (no allowlist change). New breadcrumb category `"mock-test"` (already used by Story 13-4) — no new allowlist entry.
- Story 13-2 home aggregate — orthogonal (mock-test landing has only 2 queries; no RPC consolidation per spec rationale).
- Story 13-4 mock-test parallel generation — in-progress detection uses the SAME `hasValidQuestions` heuristic (manually replicated in `validateInProgressRow` rather than imported, to keep `use-mock-test-generation.ts` zero-diff). A behavioral divergence between the two callers is structurally possible — flagged for code-review.
- Story 14-1 chrome rule — all chrome strings in EN; `formatPastResultDate` calls `toLocaleDateString("en", ...)` NEVER `"fr"`. FR pedagogical reinforcement (`"Compréhension orale"` / `"Expression orale"` etc.) lives in `titleSecondary`.
- Story 14-2 ListItemCard — both Resume and Past-results rows consume `ListItemCard` (0 new card components).
- Story 14-3 Icon system — all icons via `<Icon name={...} />`; `IconName` union extended with `"play-circle"` (1 line addition).
- Story 14-4 design-token enforcement — all colors `Colors.*`; all radii `Radii.*`; no raw `shadowOpacity`. `check:tokens` gate clean.
- Story 14-5 accent-color split — Resume row uses `Colors.accent` (CTA-cluster); past-results uses `LEVEL_COLORS[cefrResult]` (per-CEFR band). No streak/progress token usage.
- Story 14-6 post-onboarding tour — orthogonal (different screen).

**Quality gates:**

- ✅ `npm run type-check` — 0 errors
- ✅ `npm run lint` — 0 errors / 0 warnings
- ✅ `npm run format:check` — pass
- ✅ `npm test -- --no-coverage` — 106 suites / **2024 tests** pass (+43 net since 1981 baseline; exceeds spec target +25-33 by 10)
- ✅ `npm run check:tokens` — clean
- ⚠️ `npm run check:colors` — pre-existing failures from `14-4-followup-test-fixture-hex-exemption`; 14-7 introduces zero new hex literals (drift detector NEGATIVE-pins `leftStripColor=` raw hex)

**Audit P2-13 closed architecturally.**

### File List

**New files (4):**

- `src/lib/mock-test-results.ts` — pure helpers + types
- `src/hooks/use-mock-test-landing.ts` — landing-screen data hook
- `src/hooks/use-mock-test-results-loader.ts` — on-tap loader
- `src/lib/__tests__/mock-test-results.test.ts` — 22 pure-helper cases
- `src/hooks/__tests__/use-mock-test-landing.test.tsx` — 13 hook-runtime cases
- `src/lib/__tests__/mock-test-landing-source-drift.test.ts` — 8 drift cases

**Modified files (3 source + 2 housekeeping):**

- `app/(tabs)/mock-test/index.tsx` — 2 new conditional sections + useFocusEffect refresh
- `src/components/common/Icon.tsx` — added `"play-circle"` to `IconName` union
- `_bmad-output/implementation-artifacts/14-7-mock-test-landing-resume-history.md` — this story file
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status `ready-for-dev` → `in-progress` → `review`

### Change Log

- 2026-05-16: Story 14-7 implementation. Branch `feature/14-7-mock-test-landing-resume-history` off `main` (14-6 PR #106 still open; branched from main per Memory rule). 4 new source files + 2 modified source files + 2 housekeeping. Tests: 1981 → 2024 (+43 net; exceeds spec target +25-33 by 10). All 5 design-system gates green; pre-existing `check:colors` failure tracked under `14-4-followup`. Audit P2-13 + Epic 14 deliverable 14.7 architecturally satisfied.
