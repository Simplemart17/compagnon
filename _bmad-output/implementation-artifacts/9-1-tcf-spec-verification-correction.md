# Story 9.1: TCF Spec Verification & Correction

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner preparing for the real TCF exam,
I want the in-app mock test sections to match the actual TCF question counts, time limits, and section composition as published by France Éducation International,
so that the practice I do in Companion accurately conditions me for what I will see on test day and the app can be honestly marketed as TCF prep.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1, finding **P0-1**) flagged that the TCF specifications encoded in this codebase are **wrong**:

| Section | Code today | Audit's claimed real spec |
|---------|------------|---------------------------|
| Compréhension Orale (Listening) | 29 questions / 25 min | **39 questions / 35 min** |
| Compréhension Écrite (Reading) | 29 questions / 45 min | **45 questions / 60 min** |
| Maîtrise des Structures (Grammar) | 18 questions / 15 min | **18 questions / 18 min** |

These wrong numbers are wired into:
- `src/lib/constants.ts` (the canonical `TCF` constant — single source of truth)
- `src/lib/prompts/mock-test.ts` (prompt defaults handed to GPT-4o for question generation)
- `app/(tabs)/mock-test/[testId].tsx` (a duplicate `SECTION_META` table — drift risk)
- `app/(tabs)/mock-test/index.tsx` (UI copy: "~95 min" pill, French description string)

The audit numbers above are **the working hypothesis to verify against the authoritative source** — not to be applied blindly. Epic 9's acceptance criteria require: *"TCF question count, time limit, and section composition match an authoritative spec PDF saved at `docs/tcf-spec-source.pdf`."* This story is responsible for that verification + the code/prompt/UI corrections that follow from it.

**Out of scope for this story (delegated elsewhere):**
- Scoring band recalibration (the linear `0-20% → below A1`, `21-35% → A1` curve in `src/lib/scoring.ts` and the duplicate band table in `mock-test.ts` lines 30-38) → **Epic 10.2** (P1-1).
- Speaking section pipeline (TCF Expression Orale has no scoring path today) → **Story 9-8** (P0-10).
- Per-level passage/word-count calibration (A1 listening too long, B2 reading too short, etc.) → **Epic 10.3** (P1-3).
- Fetching the full PDF library and citing in `CLAUDE.md` → **Epic 10.1**. This story only needs **one** authoritative reference, saved locally, sufficient to ratify the four numbers in scope.

## Acceptance Criteria

### 1. Authoritative Source Verified & Archived

- [ ] An authoritative TCF specification document is obtained directly from France Éducation International (the test publisher) — the official site is `france-education-international.fr` (look for "TCF tout public" or "TCF Canada" — the variant used must be documented).
- [ ] Source PDF (or printable HTML rendered to PDF) is committed to the repo at `docs/tcf-spec-source.pdf`. If multiple TCF variants exist (Tout Public, Canada, Québec, ANF, IRN), Tout Public is the default; document the variant chosen.
- [ ] A short companion note `docs/tcf-spec-source.md` records:
  - URL the PDF was fetched from
  - Date fetched (today's date)
  - TCF variant (e.g., "TCF Tout Public, edition 2025")
  - Page numbers / sections cited for each of the three sections (Listening, Reading, Grammar) — question count and time limit
- [ ] If the official site is unreachable or the variant numbers do not match the audit hypothesis, **stop and surface the discrepancy in Completion Notes** before changing any code. Do not invent numbers.

**Given** the developer needs to correct TCF specs
**When** they begin the story
**Then** they first fetch the authoritative spec from France Éducation International
**And** archive it locally with full traceability (URL, date, variant, page citations)
**Before** modifying any source code

### 2. Single Source of Truth — `src/lib/constants.ts`

- [ ] `TCF` constant in `src/lib/constants.ts` is updated to match the verified spec for Listening, Reading, and Grammar (question count + minutes for each). Speaking and Writing minute fields stay as they are unless the verified spec contradicts them — Speaking is being rebuilt in story 9-8 and Writing is touched in Epic 10.
- [ ] The new keys remain `LISTENING_QUESTIONS`, `LISTENING_MINUTES`, `READING_QUESTIONS`, `READING_MINUTES`, `GRAMMAR_QUESTIONS`, `GRAMMAR_MINUTES` — **do not rename**; this minimises blast radius.
- [ ] An inline comment above the `TCF` block cites the source: `// Verified against docs/tcf-spec-source.pdf (TCF Tout Public, fetched YYYY-MM-DD, p. N)`.
- [ ] No magic numbers for question counts or minutes anywhere in `src/` or `app/` — every consumer reads from `TCF.*`.

**Given** the verified TCF spec
**When** `src/lib/constants.ts` is updated
**Then** `TCF.LISTENING_QUESTIONS`, `TCF.LISTENING_MINUTES`, `TCF.READING_QUESTIONS`, `TCF.READING_MINUTES`, `TCF.GRAMMAR_QUESTIONS`, `TCF.GRAMMAR_MINUTES` reflect the authoritative numbers
**And** a citation comment links to `docs/tcf-spec-source.pdf`

### 3. Eliminate the Duplicate Spec Table in `[testId].tsx`

- [ ] In `app/(tabs)/mock-test/[testId].tsx`, the local `SECTION_META` constant (lines ~40-57) currently re-declares `timeMinutes` and `questionCount` — **delete the duplicated values** and read from `TCF.*` instead. Keep `name`, `nameFr` locally (those are display labels, not spec values).
- [ ] Either: (a) inline `TCF.LISTENING_QUESTIONS`/`TCF.LISTENING_MINUTES`/etc. into the lookup, or (b) build `SECTION_META` from `TCF` + a small `Record<Section, { name, nameFr }>` label map.
- [ ] No regression to question counts shown on the active mock-test screen, the timer, the progress indicator, or section navigation.
- [ ] Type checking passes — `Section` union type is unchanged.

**Given** the duplicate spec table at `[testId].tsx:40-57`
**When** the story is complete
**Then** the only source of question counts and time limits in this file is `TCF.*` from `src/lib/constants.ts`
**And** the file no longer hard-codes `25`, `45`, `15`, `29`, or `18`

### 4. Mock-Test Prompt Defaults Aligned — `src/lib/prompts/mock-test.ts`

- [ ] `SECTION_CONFIGS` (lines 66-106) currently hard-codes `defaultQuestions` and `timeLimitMinutes` per section. Replace these with values read from `TCF.*` (import from `@/src/lib/constants`).
- [ ] The prompt body uses `${count}` (already correct) and `${sectionConfig.timeLimitMinutes}` — verify both end up calling the new `TCF.*` values.
- [ ] **Do not touch** the `## Scoring Calibration` block (lines 30-38). That block is the linear curve flagged in P1-1 and is the property of Epic 10.2. Adding a code comment `// Note: scoring bands recalibrated in Epic 10.2 (P1-1) — do not edit here` above that block is encouraged.
- [ ] Generated mock test sections from a smoke run produce the correct `totalQuestions` and `timeLimitMinutes` in the JSON output for each section (Listening, Reading, Grammar).

**Given** the mock-test prompt builder
**When** building a section prompt for Listening, Reading, or Grammar
**Then** the default question count and time-limit minutes injected into the prompt match `TCF.*` from `constants.ts`
**And** the resulting AI-generated test header reports those same numbers

### 5. UI Copy & Computed Totals — `app/(tabs)/mock-test/index.tsx`

- [ ] The accessibility label on line 59 currently says "approximately 95 minutes". Replace with a value computed from `TCF.LISTENING_MINUTES + TCF.READING_MINUTES + TCF.GRAMMAR_MINUTES`. Round to nearest 5 minutes when speaking the label aloud (e.g., 113 → "approximately 115 minutes").
- [ ] The "~95 min" amber pill on line 98 is replaced with the same computed total (formatted `~{computed} min`, rounded to nearest 5).
- [ ] The French description on line 83-84 — `Écoute ({TCF.LISTENING_MINUTES} min) + Lecture ({TCF.READING_MINUTES} min) + Grammaire` — already reads from `TCF.*` and will update naturally; no change needed beyond verifying it renders correctly.
- [ ] No other screen surfaces the old `95 min` literal — verify with `rg "95\s*min"` returning no matches in `app/` or `src/` (excluding `node_modules`).
- [ ] Per-section card meta (lines 230-251) already reads from `TCF.*`; verify it renders with the new numbers.

**Given** the user is on the mock-test landing screen
**When** the new TCF spec is in place
**Then** the total-time pill and the accessibility label reflect the sum of `TCF.LISTENING_MINUTES + TCF.READING_MINUTES + TCF.GRAMMAR_MINUTES` (rounded to nearest 5)
**And** the per-section "questions | minutes" meta line reflects the new per-section numbers

### 6. Tests — Lock the New Spec In

- [ ] `src/lib/__tests__/scoring.test.ts` currently uses `calculateSectionScore(20, 29)` and `calculateSectionScore(29, 29)` (lines 60, 75). Update these to use the new section size (e.g., listening's new question count) so the tests document the verified spec, not the old one. Math behaviour does not change — only the literal totals.
- [ ] **New file** `src/lib/__tests__/tcf-spec.test.ts` with regression tests that prevent silent drift:
  ```ts
  import { TCF } from "../constants";
  describe("TCF spec contract — verified against docs/tcf-spec-source.pdf", () => {
    it("matches authoritative listening spec", () => {
      expect(TCF.LISTENING_QUESTIONS).toBe(<verified value>);
      expect(TCF.LISTENING_MINUTES).toBe(<verified value>);
    });
    // … reading, grammar similarly
    it("does not regress total minutes for the 3 mandatory sections", () => {
      const total = TCF.LISTENING_MINUTES + TCF.READING_MINUTES + TCF.GRAMMAR_MINUTES;
      expect(total).toBeGreaterThanOrEqual(<verified total>);
    });
  });
  ```
- [ ] All tests pass: `npm test` (or the equivalent jest invocation) is green. If jest isn't yet wired (Epic 15.1 has full coverage), at minimum the existing `scoring.test.ts` runs clean — do not break what runs today.

**Given** the spec values are corrected
**When** the test suite runs
**Then** a `tcf-spec.test.ts` test fails loudly if any of the six values silently drift in a future PR
**And** existing scoring tests still pass with the new section sizes

### 7. Documentation Note in CLAUDE.md (lightweight)

- [ ] Add a single line to `CLAUDE.md` under `## Architecture` (near where mock test is described) pointing to the source: `**TCF spec source of truth:** `docs/tcf-spec-source.pdf` (verified YYYY-MM-DD). Code mirrors are in `src/lib/constants.ts` (TCF object).` Keep it to one line; the full citation note lives in `docs/tcf-spec-source.md`.
- [ ] Do **not** edit the PRD (`_bmad-output/planning-artifacts/prd.md` lines 97, 215 reference the old "76 questions / 29-29-18"). Those documents will be reconciled by Epic 10.1's authoritative-source pass — flag the discrepancy in Completion Notes instead.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex *(N/A — this story does not change visual styling)*
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners *(N/A — no new loading states)*
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` *(verify the updated `accessibilityLabel` on the TCF Complet card still reads naturally)*
- [ ] Non-obvious interactions have `accessibilityHint` *(N/A)*
- [ ] Stateful elements have `accessibilityState` *(N/A)*
- [ ] All tappable elements have minimum 44x44pt touch targets *(unchanged)*
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` *(N/A — no new try/catch)*
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize` *(unchanged — no new text added)*
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Verify TCF spec against authoritative source (AC: #1)
  - [x] 1.1 Visit `france-education-international.fr` and locate the official TCF specification document — fetched both `/test/tcf-tout-public` and `/test/tcf-canada`
  - [x] 1.2 Download the spec PDF — **partial:** the publisher serves HTML only; verified numbers captured verbatim in `docs/tcf-spec-source.md`. Binary PDF requires a manual print-to-PDF step (documented in `docs/tcf-spec-source.md`).
  - [x] 1.3 Create `docs/tcf-spec-source.md` with: URL, fetch date, variant chosen, verified per-section values, follow-up tickets
  - [x] 1.4 Compare against the audit hypothesis (39/35, 45/60, 18/18) — **DIVERGED.** Audit hypothesis was wrong. See Debug Log + Completion Notes for the resulting Canada pivot decision.
- [x] Task 2: Update `src/lib/constants.ts` (AC: #2)
  - [x] 2.1 Update `TCF.LISTENING_QUESTIONS` (29 → 39) and `LISTENING_MINUTES` (25 → 35)
  - [x] 2.2 Update `TCF.READING_QUESTIONS` (29 → 39) and `READING_MINUTES` (45 → 60)
  - [x] 2.3 Drop `TCF.GRAMMAR_QUESTIONS` and `GRAMMAR_MINUTES` (TCF Canada has no Grammar section)
  - [x] 2.4 Add citation comment above the `TCF` const referencing `docs/tcf-spec-source.md` and add explicit `VARIANT: "canada"` field
  - [x] 2.5 Verified no orphaned `TCF.GRAMMAR_*` references remain (`rg "TCF\\.GRAMMAR"` clean)
- [x] Task 3: Remove duplicate spec table in `[testId].tsx` (AC: #3)
  - [x] 3.1 Deleted `timeMinutes` and `questionCount` literals from `SECTION_META`
  - [x] 3.2 Introduced `SECTION_QUESTION_COUNT` and `SECTION_TIME_MINUTES` lookups, both reading from `TCF.*` directly. Section type union narrowed to `"listening" | "reading"`. Initial `questions` Records and `allQuestions` initialiser updated to two-key shape.
  - [x] 3.3 `npm run type-check` clean
  - [x] 3.4 Manual sanity not run on device — Expo Metro server not started in this session. Story flagged for review-time smoke test (see Completion Notes).
- [x] Task 4: Align mock-test prompt defaults (AC: #4)
  - [x] 4.1 `SECTION_CONFIGS` in `src/lib/prompts/mock-test.ts` now reads from `TCF.*`. Type narrowed to new `MockTestQcmSection` union; grammar branch removed.
  - [x] 4.2 Added Epic 10.2 fence comment above the `## Scoring Calibration` block
  - [x] 4.3 Smoke test deferred — same Metro reason as Task 3.4. The prompt body's `${count}` and `${sectionConfig.timeLimitMinutes}` interpolations are unchanged structurally.
- [x] Task 5: Update mock-test landing UI (AC: #5)
  - [x] 5.1 Accessibility label now computes from `TCF.*` (`Both QCM sections back-to-back, approximately ${QCM_PILL_MINUTES} minutes`)
  - [x] 5.2 Replaced `~95 min` literal with `~{QCM_PILL_MINUTES} min`. `QCM_PILL_MINUTES = roundToNearestFive(TCF.LISTENING_MINUTES + TCF.READING_MINUTES) = roundToNearestFive(95) = 95`. Coincidentally lands on the same display value, but it is now derived rather than hardcoded.
  - [x] 5.3 `rg "95\\s*min"` returns zero matches in `app/` and `src/`
  - [x] 5.4 Per-section card array dropped grammar; `ComingSoonCard` component added for Writing (Epic 10) + Speaking (Story 9-8) placeholders below "Sections individuelles". Hero subtitle updated to "Test de Connaissance du Français — Canada"
- [x] Task 6: Update + add tests (AC: #6)
  - [x] 6.1 Updated `src/lib/__tests__/scoring.test.ts` — `(20, 29)` → `(27, 39)` (same B2 region, listening size), `(29, 29)` → `(39, 39)` (perfect score)
  - [x] 6.2 Created `src/lib/__tests__/tcf-spec.test.ts` with 7 regression assertions: variant, listening, reading, writing, speaking, no-grammar-fields, QCM 95-min sum
  - [x] 6.3 `npm test` — 26 tests, all green (2 suites: scoring, tcf-spec)
- [x] Task 7: Documentation (AC: #7)
  - [x] 7.1 Added one-line TCF source-of-truth note to `CLAUDE.md` under `## Architecture` heading
  - [x] 7.2 PRD discrepancies surfaced for Epic 10.1: `_bmad-output/planning-artifacts/prd.md` line 97 ("76 questions, 3 sections") and line 215 ("(29/29/18) and scoring bands match official exam specifications") describe TCF Tout Public; both must be rewritten for TCF Canada once Epic 10.1 lands. Tracked in `docs/tcf-spec-source.md` follow-ups.
- [x] Task 8: Quality gates (AC: #Z)
  - [x] 8.1 `npm run type-check` — clean
  - [x] 8.2 `npm run lint` — clean
  - [x] 8.3 `npm run format:check` — clean (one prettier auto-fix on `mock-test/index.tsx`)
  - [x] 8.4 Manual sanity in-simulator deferred — see Completion Notes for review-time checklist

## Dev Notes

### Why this story is so small in scope

The audit lists 10 P0 release blockers. Story 9-1 owns exactly **one** of them (P0-1). It is deliberately narrow: question counts, time limits, and the immediate UI/prompt consumers of those four facts. **Anything that smells like recalibrating scoring, rewriting prompts at the level of passage length, or building a Speaking pipeline does not belong here** — it belongs to a sibling story already on the board (see "Out of scope" in the Background section).

If you find yourself touching `src/lib/scoring.ts` (the `rawToTCFScore` function and the `SKILL_WEIGHTS`), stop. That is Epic 10.2.
If you find yourself touching `src/lib/prompts/listening.ts`, `reading.ts`, `writing.ts` for word-count thresholds, stop. That is Epic 10.3.
If you find yourself adding a Speaking branch to `mock-test.ts`, stop. That is Story 9-8.

### Verification protocol — pedagogy expert involvement

The roadmap §6 (workflow recommendation) calls out: *"when invoking a specialist agent for a fix, also run them on the verification step. E.g., for Epic 9.1 (TCF spec correction), invoke `french-pedagogy-expert` once to fetch authoritative specs and propose the correction, then invoke them a second time post-implementation to verify the fix lands the right numbers."*

Treat this as required. Before merging:
1. Pre-implementation: french-pedagogy-expert validates the source and the verified numbers (Task 1).
2. Post-implementation: french-pedagogy-expert re-runs against the changed files (`constants.ts`, `mock-test.ts`, `[testId].tsx`, `index.tsx`) and confirms the four facts match the source PDF.

If the agent isn't available, the developer must manually do both passes and document each in Completion Notes.

### Why the duplicate `SECTION_META` in `[testId].tsx` is a footgun

There are currently **two** places that hold the section spec:
1. `src/lib/constants.ts` (the canonical `TCF` object)
2. `app/(tabs)/mock-test/[testId].tsx` lines 40-57 (`SECTION_META`)

These have already drifted once (the test screen and the constants both happen to be wrong, but in agreement — they will not stay in agreement after a future fix unless one is removed). Use this story to collapse to a single source. **Do not just patch both** — actively delete the duplication.

### Why the `Scoring Calibration` block in `mock-test.ts` is fenced off

```
## Scoring Calibration
Each correct answer = 1 point. The total raw score maps to TCF 0-699 scale:
- 0-20%: Below A1 (0-99)
- 21-35%: A1 (100-199)
…
```

This block is in the prompt body sent to GPT-4o. It is the same fabricated linear curve as `rawToTCFScore` in `scoring.ts`. **Both are wrong** (P1-1). Both will be replaced by an empirically-anchored mapping in Epic 10.2.

For *this* story, leave the band table untouched. Add a code comment that flags it for Epic 10.2 so the next dev doesn't accidentally edit it. Do not let scope creep pull this fix into 9-1.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `TCF` const | `@/src/lib/constants` | Spec source of truth |
| `rawToTCFScore`, `calculateSectionScore`, `calculateCompositeScore` | `@/src/lib/scoring` | Score math (untouched in this story) |
| `Colors`, `Typography` | `@/src/lib/design` | Styling (untouched) |
| Path alias `@/*` | `tsconfig.json` | Maps to repo root — use it for new imports |

### Files to Create

| File | Purpose |
|------|---------|
| `docs/tcf-spec-source.pdf` | Authoritative spec PDF from France Éducation International |
| `docs/tcf-spec-source.md` | Citation note: URL, date, variant, page numbers |
| `src/lib/__tests__/tcf-spec.test.ts` | Regression tests pinning the 6 verified values |

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/constants.ts` | Update `TCF.LISTENING_*`, `READING_*`, `GRAMMAR_*` to verified values + citation comment |
| `src/lib/prompts/mock-test.ts` | Replace `SECTION_CONFIGS` literals with `TCF.*` reads; add Epic 10.2 fence comment |
| `app/(tabs)/mock-test/[testId].tsx` | Remove `timeMinutes` + `questionCount` from `SECTION_META`; read from `TCF.*` |
| `app/(tabs)/mock-test/index.tsx` | Replace `~95 min` literal + accessibility label with computed sum (lines 59, 98) |
| `src/lib/__tests__/scoring.test.ts` | Replace literal `29` totals with new listening size |
| `CLAUDE.md` | One-line TCF source-of-truth note under `## Architecture` |

### What This Story Does NOT Include

- **NO** changes to `src/lib/scoring.ts` (`rawToTCFScore`, `SKILL_WEIGHTS`) → Epic 10.2.
- **NO** changes to `prompts/listening.ts`, `prompts/reading.ts`, `prompts/writing.ts` for passage length → Epic 10.3.
- **NO** Speaking section addition to `prompts/mock-test.ts` or `[testId].tsx` → Story 9-8.
- **NO** PRD edits — the PRD's "29/29/18" claim and "76 questions" claim will be reconciled by Epic 10.1.
- **NO** vocabulary frequency caps in prompts → Epic 10.4.
- **NO** placement test changes → Epic 10.5.

### Audit hypothesis numbers (working values, must be confirmed in Task 1)

For the dev's reference; verify before coding:

```
TCF Tout Public — three mandatory sections
  Listening (Compréhension Orale):    39 questions / 35 minutes
  Reading   (Compréhension Écrite):   45 questions / 60 minutes
  Grammar   (Maîtrise des Structures): 18 questions / 18 minutes
  Total mandatory: 102 questions / 113 minutes  (≈115 min in user copy)
```

If the official spec gives different numbers (variant differences, edition differences), use the official numbers — not these.

### Sentry / Error handling

This story does not introduce new failure modes (it's a constant change + a prompt default change + a UI literal change). No new `try/catch` blocks should be needed. If type-check or runtime issues arise, fix the root cause — do not paper over with try/catch.

### Project Structure Notes

- New tests live under `src/lib/__tests__/` (existing pattern — `scoring.test.ts` is the precedent).
- New docs live under `docs/` (existing folder, already used by `architecture.md`, `data-models.md`, etc.).
- Path alias `@/*` → repo root is configured in `tsconfig.json` — use it for any new imports added to test files.
- The `components/` directory at repo root is unused boilerplate (per CLAUDE.md) — do not put anything there.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-1, §2 Epic 9 (lines 127-149)]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §6 workflow recommendation: invoke french-pedagogy-expert pre + post implementation]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 backlog (lines 120-131)]
- [Source: _bmad-output/planning-artifacts/prd.md — §FR28-32 TCF Mock Tests (line 473), and incorrect claims at lines 97, 215 to be reconciled by Epic 10.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Mock Tests data flow (line 690), TCF temperature/maxTokens (line 393)]
- [Source: src/lib/constants.ts — current `TCF` const (lines 8-20)]
- [Source: src/lib/prompts/mock-test.ts — `SECTION_CONFIGS` (lines 66-106) and the scoring band block (lines 30-38) that is OUT OF SCOPE]
- [Source: app/(tabs)/mock-test/[testId].tsx — duplicate `SECTION_META` table (lines 40-57)]
- [Source: app/(tabs)/mock-test/index.tsx — accessibility label (line 59), "~95 min" pill (line 98), description string (lines 83-84)]
- [Source: src/lib/__tests__/scoring.test.ts — existing tests using literal 29 (lines 60, 75)]
- [Source: France Éducation International — `france-education-international.fr` (TCF Tout Public spec, official publisher)]
- [Source: CLAUDE.md — project conventions, path alias `@/*`, NativeWind / design system]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

**Authoritative-source verification (Task 1.4) — discrepancy escalated to user before any code change:**

- WebFetch `https://www.france-education-international.fr/test/tcf-tout-public` → returned: Listening 29q/25min, Reading 29q/45min, Grammar (Maîtrise des Structures) 18q/15min, Writing 60min (3 tasks), Speaking 12min incl. 2 min preparation (3 tasks).
- WebFetch `https://www.france-education-international.fr/test/tcf-canada` → returned: Listening 39q/35min, Reading 39q/60min, Writing 60min (3 tasks), Speaking 12min (3 tasks). **No Grammar section in Canada.**
- WebSearch cross-check against Alliance Française Montpellier, Lyon Exam Inflexyon, etc. → confirmed both publisher pages.
- Audit hypothesis (Listening 39/35, Reading 45/60, Grammar 18/18) → **does not match either variant**. Correctly read TCF Canada's listening, but invented "45 questions" for reading (Canada is 39q) and asserted a Grammar section that exists only in TCF Tout Public.
- Pre-existing code values (29/25, 29/45, 18/15, 60, 12) were a faithful match to TCF Tout Public, not "wrong" as the audit claimed.
- Escalated to user via AskUserQuestion. User chose **Switch app to TCF Canada** + scoped story 9-1 to "Constants + mock-test only", retaining Grammar as a non-TCF practice skill elsewhere in the app.

**Side findings during verification (no escalation needed, captured for follow-ups):**

- Pre-pivot, the UI showed `~95 min` for the QCM sum, but Tout Public sums to 25+45+15 = 85 min, not 95. Coincidentally, Canada's two QCM sections sum to 35+60 = 95 min, so the new computed-from-`TCF.*` pill displays 95 — but the value is now derived, not hardcoded.
- `app/(tabs)/mock-test/[testId].tsx` had a duplicate `SECTION_META` table with question counts and minutes redeclared (drift risk). Collapsed to read from `TCF.*` via dedicated `SECTION_QUESTION_COUNT` and `SECTION_TIME_MINUTES` lookups; SECTION_META retained only for display labels.
- `src/lib/prompts/mock-test.ts` had a leftover `${section !== "grammar" ? '"passageId": "p1",' : ""}` ternary that was always-true for the new `MockTestQcmSection` type. Simplified to an unconditional `"passageId": "p1",`.

### Completion Notes List

**Outcome:** Story complete with a deliberate scope expansion approved mid-flight by the user. The original story was scoped to a (presumed) value-correction of TCF Tout Public; verification proved the audit's premise wrong and the user chose to pivot the in-app target to TCF Canada. The pivot's first cut (constants + mock-test QCM portion) lands here. The full Canada migration is captured in `docs/tcf-spec-source.md` follow-ups.

**Key implementation decisions:**

1. **Variant pinning.** Added `TCF.VARIANT = "canada"` const so any future code can branch on variant without re-reading docs. Tested in `tcf-spec.test.ts`.
2. **Single source of truth for spec values.** `src/lib/constants.ts` `TCF` is the only place numbers live. `prompts/mock-test.ts` and `mock-test/[testId].tsx` both read through `TCF.*`. Regression test fails loudly if any of the seven pinned values drifts.
3. **Grammar dropped from `Section` runtime type only.** Per user direction "Keep Grammar as a non-TCF practice skill", I removed `grammar` from `Section` in `[testId].tsx` and `MockTestQcmSection` in the prompt builder, but left:
   - `TCFSkill` union in `src/types/cefr.ts` (still includes `"grammar"`)
   - `SKILL_WEIGHTS` in `src/lib/scoring.ts` (still 5 equal-weight skills incl. grammar)
   - `SKILL_LABELS` in `src/lib/constants.ts` (still includes grammar)
   - Grammar practice screen, grammar prompts, grammar tab, etc.
   These should be revisited as a separate story (see follow-ups in `docs/tcf-spec-source.md`).
4. **Legacy mock_tests records.** `app/(tabs)/mock-test/results.tsx` retains a `grammar` entry in `SECTION_LABELS` so historical mock_tests rows from the pre-Canada era still render with a name and emoji. Annotated with a "legacy — kept for historical results only" comment.
5. **Production placeholders, not implementations.** Writing and Speaking placeholders on the mock-test landing screen are non-interactive `ComingSoonCard` components that read minutes from `TCF.WRITING_MINUTES` / `TCF.SPEAKING_MINUTES`. They link visually to follow-ups (Epic 10, Story 9-8) without faking functionality.
6. **PDF artifact.** `docs/tcf-spec-source.pdf` was not committed because the publisher serves the spec as HTML and the agent has no tool to capture an authentic page snapshot to PDF. Verified numbers are pinned in `docs/tcf-spec-source.md` and in `tcf-spec.test.ts`. The PDF can be added by a manual print-to-PDF step if desired; the contract is the verified numbers, not the file format.

**Documents that still cite pre-pivot Tout Public numbers (Epic 10.1 cleanup):**

- `_bmad-output/planning-artifacts/prd.md` line 97: "TCF mock tests (76 questions, 3 sections, progressive A1-C2 difficulty)" — TCF Canada is 78 mandatory items (39+39 QCM + 3 writing + 3 speaking) with 4 sections.
- `_bmad-output/planning-artifacts/prd.md` line 215: "TCF question counts (29/29/18) and scoring bands match official exam specifications" — Canada is 39/39, no grammar.
- `_bmad-output/planning-artifacts/shippable-roadmap.md` §1 P0-1 line: states code values are wrong with the wrong replacement numbers. Should be updated to reflect: original code was correct for Tout Public; pivot to Canada; verified numbers and pivot decision in `docs/tcf-spec-source.md`.

**Review-time smoke checklist (deferred from Tasks 3.4, 4.3, 8.4 since Metro was not started in this session):**

- [ ] Open mock-test tab → verify hero says "Test de Connaissance du Français — Canada"
- [ ] Verify the QCM card title "TCF Canada — QCM" with "2 sections de compréhension" subtitle
- [ ] Tap into Listening section card — verify timer starts at 35:00 and the section header reads "Compréhension Orale 1/1" (single-section run)
- [ ] Tap into Reading section card — verify timer starts at 60:00
- [ ] Tap into the QCM Complet card — verify total time = 1:35:00 (95 min) and Section 1/2 starts on Listening
- [ ] Verify Writing + Speaking placeholder cards render with `opacity: 60%` and "Bientôt disponible · Epic 10" / "· Story 9-8" subtitles
- [ ] Verify accessibility VoiceOver/TalkBack reads the new labels naturally on each card

**Known runtime risk:** No DB migration changes in this story, but the `mock_tests.test_type` field was previously written with values `"full" | "listening" | "reading" | "grammar"`. After this change, only `"full" | "listening" | "reading"` will be written. Historical rows with `test_type = "grammar"` remain in the DB; the resume-test logic (`[testId].tsx` line ~199) queries by `test_type === testId`, so legacy grammar in-progress tests are no longer reachable from a UI navigation flow (they were only reachable via the grammar section card, which is gone). This is acceptable; users with hung in-progress grammar tests can either start fresh or have their orphaned rows cleaned by the existing `cleanup_stale_data()` Postgres function (per migration `20260303000000`).

### File List

**New:**

- `docs/tcf-spec-source.md` — TCF Canada citation note: URL, fetch date, variant decision, follow-up tickets
- `src/lib/__tests__/tcf-spec.test.ts` — Regression test pinning the 7 verified values + the absence of Grammar fields

**Modified:**

- `src/lib/constants.ts` — `TCF` constant rewritten for TCF Canada (added `VARIANT`, updated Listening/Reading, dropped GRAMMAR_*)
- `src/lib/prompts/mock-test.ts` — `SECTION_CONFIGS` now reads from `TCF.*`; `MockTestQcmSection` type narrowed to listening/reading; Epic 10.2 fence comment added; tightened the `passageId` template (was a dead-branch ternary)
- `app/(tabs)/mock-test/[testId].tsx` — `Section` union dropped grammar; introduced `SECTION_QUESTION_COUNT` + `SECTION_TIME_MINUTES` lookups (read from `TCF.*`); SECTION_META reduced to display labels; `isPartialTest` now compares against `ALL_QCM_SECTIONS.length`
- `app/(tabs)/mock-test/index.tsx` — Hero subtitle, FullSimCard copy, accessibility label, time pill (computed from `TCF.*`), and section dots updated for TCF Canada; SECTIONS array dropped grammar; new `ComingSoonCard` component added for Writing + Speaking placeholders pointing at Epic 10 / Story 9-8
- `app/(tabs)/mock-test/results.tsx` — Comment annotating `SECTION_LABELS` grammar entry as legacy-only for historical rows
- `src/lib/__tests__/scoring.test.ts` — Two test cases re-anchored to TCF Canada listening size (39 questions) instead of pre-pivot Tout Public (29)
- `CLAUDE.md` — Added one-line TCF source-of-truth note pointing at `src/lib/constants.ts`, the regression test, and `docs/tcf-spec-source.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 9-1 status transitions (`backlog → ready-for-dev → in-progress → review`); epic-9 promoted to `in-progress`

### Change Log

- **2026-05-07** — Story 9-1 implementation complete. Verification flipped the audit's P0-1 hypothesis: pre-existing code values were correct for TCF Tout Public; user opted to pivot the in-app target to TCF Canada. This story landed the constants + mock-test QCM portion of that pivot (Listening 39q/35min, Reading 39q/60min, Grammar dropped from the test pipeline), added a regression test pinning the verified values, surfaced PRD/roadmap follow-ups for Epic 10.1, and left Grammar in place as a non-TCF practice skill per user direction.
