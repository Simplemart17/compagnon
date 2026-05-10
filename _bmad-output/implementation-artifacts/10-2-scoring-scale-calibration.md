# Story 10.2: Scoring Scale Calibration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TCF Canada candidate whose readiness score, CEFR auto-promotion, and per-skill mock-test feedback all today derive from [src/lib/scoring.ts:7-35](src/lib/scoring.ts#L7) `rawToTCFScore` — a **7-band linear interpolation** that the new source-of-truth at [docs/tcf-spec-source.md §2.4](docs/tcf-spec-source.md) explicitly flags as **"invented, not publisher-anchored"** — and whose composite score derives from [scoring.ts:61-89](src/lib/scoring.ts#L61) `calculateCompositeScore` which averages 5 skills (including Grammar, which TCF Canada does not have) and produces a single number that **the publisher does not produce or recognize**,
I want the scoring pipeline split into **per-skill conversion functions** anchored to the IRCC CLB equivalency table at [docs/tcf-spec-source.md §2.2](docs/tcf-spec-source.md) — so Listening/Reading raw % maps to the publisher's 0–699 scale via empirical CLB-anchored bands (not linear interpolation), and Writing/Speaking raw inputs map to the publisher's 0–20 scale (not the 0–699 conflation that exists today) — plus the composite path either eliminated or explicitly demoted to "internal-display-only with no IRCC equivalence,"
so that **the scoring math the app shows the user is consistent with what IRCC will compute when they plug their TCF Canada certificate into Express Entry** — closing audit findings P1-1 ("raw% → TCF score curve fabricated") and P1-2 ("equal skill weights wrong; publisher reports per-skill, not composite") that block Epic 10's "credible TCF prep tool" acceptance criterion at [shippable-roadmap.md §2 line 167](_bmad-output/planning-artifacts/shippable-roadmap.md), and unblocking Epic 10.6 (deeper Speaking rubric) and Epic 10.5 (placement test) which both depend on a per-skill scoring contract that 10-2 now delivers.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged two P1 release-quality findings tied to scoring math:

> **P1-1:** "Raw% → TCF score curve is fabricated (linear-ish bands), not calibrated against real TCF data; produces over/under-estimation by skill." — Files: `src/lib/scoring.ts:13-19`. Source agent: pedagogy.

> **P1-2:** "Equal skill weights in composite are wrong — TCF reports per-skill, not composite; the math is invented." — Files: `src/lib/scoring.ts:50-56`. Source agent: pedagogy.

Story 10-1 (2026-05-10) sourced the publisher's per-skill scales and the IRCC CLB equivalency table verbatim and pinned them at [docs/tcf-spec-source.md §2](docs/tcf-spec-source.md#L34) + [§2.2 IRCC table](docs/tcf-spec-source.md). Citations matrix [docs/tcf-spec-citations.md §2](docs/tcf-spec-citations.md) marks three rows as **✗ DELTA — Owner: Epic 10.2:**

| Code location | Value | tcf-spec-source.md anchor | Status |
|---|---|---|---|
| `src/lib/scoring.ts:7-35` `rawToTCFScore` 7-band linear | 0-99 / 100-199 / 200-299 / 300-399 / 400-499 / 500-599 / 600-699 | §2.4 obs 1 | ✗ DELTA — invented linear bands; publisher uses non-linear empirical bands per IRCC equivalency. **Owner: Epic 10.2 (P1-1)** |
| `src/lib/scoring.ts:61-67` `SKILL_WEIGHTS` | 5 skills × 0.2 | §2.1 + §2.4 obs 2 | ✗ DELTA — publisher does not produce a composite; code's composite is invented. Also Grammar is not part of TCF Canada (5-skill weighting wrong). **Owner: Epic 10.2 (P1-2)** |
| `src/types/cefr.ts:27-69` `CEFR_LEVELS.tcfScoreMin/Max` | A1=100-199, A2=200-299, B1=300-399, B2=400-499, C1=500-599, C2=600-699 | §2.3 — round-number bands not publisher-verbatim | ✗ DELTA — round-number approximation widely cited but no FEI source; should align to CLB equivalency (§2.2) which is non-linear. **Owner: Epic 10.2** |

Plus one row Epic 10.2 must address from §1:

| `src/lib/constants.ts:18` `TCF.C1_MIN` | 500 | §2.3 — derived round-number CEFR band; not publisher-verbatim | ✗ DELTA — round-number approximation in code; publisher uses non-linear CLB-anchored bands. **Owner: Epic 10.2** |

The Epic 10.6 follow-up retro item (per the [pedagogy review](docs/tcf-spec-source.md) §6.3) and the [story 9-8 speaking-mock-test-persist.ts:81](src/lib/speaking-mock-test-persist.ts#L81) hand-off both **silently route through `rawToTCFScore`** today — meaning every Speaking mock test currently maps a 0-100 internal composite through Listening/Reading's invented 0-699 linear bands. That's wrong on two axes: wrong scale (Speaking is 0-20, not 0-699) and wrong band shape.

### Threat / failure model — what cannot happen post-story

After this story:

1. **A user who scores 90% raw on Listening sees a TCF score that lands inside the IRCC CLB band corresponding to that raw% per the publisher**, NOT the linearly-interpolated 600 the current code produces. (Concretely: 90% × 39 questions = 35 correct ≈ CLB 9-10 territory per [docs/tcf-spec-source.md §2.2](docs/tcf-spec-source.md), not "the lowest possible C2.")
2. **A Speaking mock test composite from story 9-8 maps to the publisher's 0-20 scale**, not the legacy 0-699 path through the invented linear bands. The persisted `mock_tests.total_score` for `test_type="speaking"` reflects the 0-20 number; UI shows both the 0-20 raw and an explanatory CLB band.
3. **`calculateCompositeScore` either disappears from the runtime path or is renamed + JSDoc-flagged as "INTERNAL DISPLAY ONLY — NOT IRCC-EQUIVALENT, NOT THE PUBLISHER'S NUMBER, NOT USED FOR PROMOTION GATING."** The CEFR promotion engine ([src/lib/activity.ts](src/lib/activity.ts) `checkCefrPromotion` + `evaluatePromotion` from story 9-2) reads **per-skill scores**, not the composite — that contract holds.
4. **`SKILL_WEIGHTS` no longer includes `grammar`.** Grammar stays in the `TCFSkill` union (operator's 2026-05-07 decision per [docs/tcf-spec-source.md §10 follow-up #1](docs/tcf-spec-source.md)) but does NOT appear in the TCF Canada composite. A regression test asserts the new weights sum to 1.0 across exactly 4 skills.
5. **`CEFR_LEVELS.tcfScoreMin/Max` round-number bands stay** for UI labeling (they're a "self-assessment grid display" convention, not IRCC math) BUT a new constant `IRCC_CLB_BANDS` (per `docs/tcf-spec-source.md §2.2`) drives the per-skill promotion-gate math. The two are explicitly distinguished in JSDoc.
6. **`rawToTCFScore` is replaced by per-skill conversion functions** (`rawPercentToListeningReadingScore` for the 0-699 skills; `rawPercentToWritingSpeakingScore` for the 0-20 skills, OR keep them split to per-skill if the IRCC bands differ). The old name is **deleted**, not aliased — every caller is updated.
7. **Scoring tests double in count** — the existing 5-band linear assertions are deleted (they pinned the wrong math) and replaced with IRCC-band-anchored assertions. New tests assert (a) round-trip CLB ↔ TCF for each skill, (b) the per-skill mappings stay in their CLB band, (c) the composite is internal-display-only and is not consulted by the promotion engine.
8. **Speaking pipeline (`src/lib/speaking-scoring.ts` + `speaking-mock-test-persist.ts`)** stops routing through `rawToTCFScore`. New helper `computeSpeakingScore0to20` (or similar) divides the 0-100 internal composite by 5 → 0-20 → publisher scale. The `mock_tests.total_score` for speaking persists the 0-20 number.
9. **`activity.ts updateSkillProgress + checkCefrPromotion`** continue to work unchanged — they read per-skill `skill_progress` rows. Story 9-2's contract holds.
10. **`CLAUDE.md`** gains a new architecture line for the per-skill scoring scale family, parallel to the 9-1 / 9-7 / 9-8 / 9-9 / 10-1 lines.
11. **`docs/tcf-spec-citations.md`** §1 + §2 rows flip from ✗ DELTA → ✓ Verified for the 4 rows owned by Epic 10.2.

**Out of scope for this story (delegated elsewhere):**

- **Per-CEFR passage / sentence calibration** ([src/lib/prompts/listening.ts](src/lib/prompts/listening.ts), [reading.ts](src/lib/prompts/reading.ts), [writing.ts](src/lib/prompts/writing.ts) word counts) → **Epic 10.3**. 10-2 does not change prompts.
- **Vocabulary frequency caps** in prompts → **Epic 10.4**.
- **Placement test prompt extraction** → **Epic 10.5**.
- **Speaking rubric deepening** (add 5th `sociolinguisticScore` dimension; deepen the 4-criterion convention to publisher's 3-category structure) → **Epic 10.6**. 10-2 changes the *scaling* of Speaking outputs, not the *rubric*.
- **Linguistic accuracy pass** (CEFR labels in French, Québécois, "Force est de constater") → **Epic 10.7**.
- **Anti-cheat / anti-repetition** → **Epic 10.8**.
- **Drop `grammar` from `TCFSkill` union entirely** — operator's 2026-05-07 direction was to keep Grammar as a non-TCF practice skill. The union stays; only `SKILL_WEIGHTS` membership changes.
- **`mock_tests.test_type` / `mock_tests.variant` schema versioning** (per `tcf-spec-source.md §10` follow-up #8) → **Epic 17.1**. 10-2 does NOT add a database column; historical pre-pivot scores stay as-is and the new pipeline produces post-pivot scores going forward. Front-end can detect via `test_type` + creation date if needed.
- **Backfilling existing `mock_tests` rows** with re-computed scores → **out of scope.** Pre-10-2 rows reflect the legacy linear-band scoring; new rows reflect IRCC-anchored scoring. Document the discontinuity in CLAUDE.md.
- **UI changes beyond mock-test-results adjustment** — the `app/(tabs)/mock-test/results.tsx:60` literal `500` (which should be `TCF.C1_MIN`) gets fixed in 10-2 because it's a 1-line trivial cleanup, but no broader UX redesign happens here.
- **Edge Function changes** — scoring math runs client-side; no `supabase/functions/` change needed.
- **Database migrations** — Epic 17.1 owns mock_tests schema versioning; 10-2 stays in app code only.

## Acceptance Criteria

### 1. Replace `rawToTCFScore` with per-skill conversion functions

The current single-function `rawToTCFScore` produces a 0-699 score for ALL skills via 7-band linear interpolation. Replace with **per-skill** functions that respect the publisher's two distinct scales (per [`docs/tcf-spec-source.md §2.1`](docs/tcf-spec-source.md)):

- [x] **DELETE** `src/lib/scoring.ts:7-35` `rawToTCFScore`. Do NOT alias for backward compat — every caller MUST be updated.
- [x] **CREATE** `rawPercentToListeningReadingScore(rawPercent: number, skill: "listening" | "reading"): TCFScore` returning a 0–699 score. Implementation MUST use the IRCC CLB equivalency table (`docs/tcf-spec-source.md §2.2`) as the band-boundary anchor:
  - Map raw% → expected raw-correct count (rawPercent × 39 questions for both Listening and Reading per `TCF.LISTENING_QUESTIONS` / `TCF.READING_QUESTIONS`)
  - Map raw-correct count → CLB level via empirical scaling against the publisher's CLB-band ranges (e.g., a candidate hitting "expert" 90%+ raw lands in CLB 9-10 territory ≈ 549-699)
  - **The implementation does NOT need to be a perfect band-identity function** — the publisher's 39q QCM has known statistical noise and the CLB bands are calibrated against full-test psychometrics, not raw% caps. The new function MUST satisfy these invariants:
    1. 0% raw → 0 TCF score (below CLB 1)
    2. 100% raw → 699 TCF score (top of CLB 10-12 band)
    3. Monotonic non-decreasing in rawPercent (no inversions)
    4. The CLB band the score lands in matches the band a CLB-7-target candidate would expect at that raw% — verified by a regression-test that takes 12 anchor (raw%, expected-CLB) pairs sourced from `docs/tcf-spec-source.md §2.2` and checks the function lands the score in the correct CLB row's TCF range
- [x] **CREATE** `rawPercentToWritingSpeakingScore(rawPercent: number): WritingSpeakingScore` returning a 0–20 score. Use the IRCC equivalency: < 4 = below CLB 4, 4-5 = CLB 4, 6 = CLB 5, 7-9 = CLB 6, 10-11 = CLB 7, 12-13 = CLB 8, 14-15 = CLB 9, 16-20 = CLB 10-12. Implementation MUST satisfy the same invariants (clamp 0/100, monotonic, band-anchored to publisher).
- [x] **CREATE** new type `WritingSpeakingScore = number` with JSDoc documenting the 0-20 range. Place in [`src/types/cefr.ts`](src/types/cefr.ts) next to the existing `TCFScore = number` type. Both are nominal `number` aliases so consumers must use the right one — TypeScript-flag-only protection (similar to how `TCFScore` already works); no runtime branding.
- [x] **DELETE** the old test cases in [src/lib/__tests__/scoring.test.ts](src/lib/__tests__/scoring.test.ts) for `rawToTCFScore` linear bands (lines 9-57). They pinned the wrong math.
- [x] **CREATE** new test cases:
  - 12 anchor pairs from CLB equivalency table mapped through `rawPercentToListeningReadingScore` for "listening" and "reading" — each must produce a TCF score in the correct CLB band
  - 9 anchor pairs (CLB 1-3 / 4 / 5 / 6 / 7 / 8 / 9 / 10-12 + 0% + 100% boundaries) for `rawPercentToWritingSpeakingScore`
  - Monotonicity check: 11 ascending raw% → 11 monotonic non-decreasing TCF scores per function

**Why two functions** (not one with a `skill` parameter): the 0-699 vs 0-20 scales have different semantics; combining them in one function with a discriminated return type creates a type-narrowing burden at every call site. Two functions = two clear types = compile-time enforcement.

**Why band-anchored monotonic, not perfectly-empirically-fit**: the publisher's CLB bands are calibrated against full-test psychometrics that the app cannot replicate from raw% alone. The right contract is "given raw%, produce a TCF score that IRCC would map to the correct CLB band" — not "predict the exact TCF score the publisher would give." The 39-question QCM has statistical floor noise the app cannot eliminate.

**Given** raw% = 90 (calibrated to CLB 9-10 territory per `tcf-spec-source.md §2.2` Listening row "549-699")
**When** `rawPercentToListeningReadingScore(90, "listening")` is called
**Then** the result is in [549, 699]
**And** `levelFromScore(result)` returns C1 or C2 (per `CEFR_LEVELS.tcfScoreMin` round-number bands; documented as UI-only labeling)

**Given** raw% = 0 or raw% = 100
**When** either function is called
**Then** result is the floor (0) or ceiling (699 / 20) respectively

### 2. Replace `calculateCompositeScore` with internal-display-only `calculateInternalCompositeForUI`

The publisher does NOT produce a TCF Canada composite (per `docs/tcf-spec-source.md §2.1`). The current code's composite drives at least one UI element ([app/(tabs)/mock-test/results.tsx:60](app/(tabs)/mock-test/results.tsx#L60) "distance to C1") but is NOT consulted by the promotion engine ([src/lib/activity.ts](src/lib/activity.ts) `evaluatePromotion` reads per-skill `skill_progress` rows, per story 9-2 contract).

- [x] **RENAME** `calculateCompositeScore` → `calculateInternalCompositeForUI`. Keep the function body initially; just rename + add explicit JSDoc:
  ```typescript
  /**
   * Internal-display-only composite for UI elements like
   * "Today's level estimate" and the mock-test landing card.
   *
   * **NOT IRCC-EQUIVALENT** — TCF Canada does not produce a composite;
   * Express Entry / IRCC scores are per-skill. **NOT used by the
   * promotion engine** (`src/lib/activity.ts` `evaluatePromotion`
   * reads per-skill `skill_progress` rows directly).
   *
   * Use `calculateSectionScore` for any user-facing TCF-equivalence
   * claim. This composite is a soft estimate for UX continuity only.
   */
  ```
- [x] **UPDATE** `SKILL_WEIGHTS` to drop `grammar` (TCF Canada has 4 skills, not 5):
  ```typescript
  const SKILL_WEIGHTS_TCF_CANADA: Record<Exclude<TCFSkill, "grammar">, number> = {
    listening: 0.25,
    reading: 0.25,
    writing: 0.25,
    speaking: 0.25,
  };
  ```
  - **Why equal 0.25 weights** (not weighted): the publisher does not publish a weighting; equal weights is the only defensible default. The function explicitly disclaims IRCC-equivalence in JSDoc.
  - **Why exclude grammar but keep `TCFSkill` union intact**: operator's 2026-05-07 direction (per `docs/tcf-spec-source.md §10` follow-up #1) was to keep Grammar as a non-TCF practice skill. Union stays; only `SKILL_WEIGHTS_TCF_CANADA` excludes it. The function silently drops any `grammar` entry passed in `skillScores`.
- [x] **UPDATE** `app/(tabs)/mock-test/results.tsx:60` — replace literal `500` with `TCF.C1_MIN` (cleanup of an unrelated drift; both reference the same UI threshold).
- [x] **UPDATE** the `distanceToC1` JSDoc/comment to clarify it's a UX continuity feature, not a publisher metric.
- [x] Add a regression test asserting `evaluatePromotion` still works **without** consulting the composite — invoke it with mock per-skill data and confirm it returns the right promotion decision regardless of what `calculateInternalCompositeForUI` would produce.

**Given** a user with skillScores = { listening: 500, reading: 500, writing: 12, speaking: 14, grammar: 800 }
**When** `calculateInternalCompositeForUI(skillScores)` is called
**Then** `grammar: 800` is silently dropped from the average
**And** the result averages only listening/reading/writing/speaking

### 3. Update `speaking-mock-test-persist.ts` to use the per-skill scoring path

Story 9-8's `speaking-mock-test-persist.ts:81` currently does `rawToTCFScore(compositeOverall)` where `compositeOverall` is a 0-100 internal value. This routes through Listening/Reading's invented bands — wrong. 10-2 fixes this.

- [x] **UPDATE** [src/lib/speaking-mock-test-persist.ts:81](src/lib/speaking-mock-test-persist.ts#L81) to call the new path. The 9-8 internal 0-100 composite needs to map to the publisher's 0-20 Speaking scale; the mapping is integer-divide-by-5 (0-100 → 0-20) since story 9-8's RUBRIC_TO_COMPOSITE constant is exactly the inverse (0-80 sum × 1.25 = 0-100 → reverse: 0-100 / 5 = 0-20):
  ```typescript
  // Map internal 0-100 composite → publisher's 0-20 scale.
  const publisherScore0to20: WritingSpeakingScore = compositeOverall / 5;
  ```
- [x] **DECIDE** what `mock_tests.total_score` (the persisted DB field) holds for `test_type="speaking"`. Two options:
  - **(a) Persist the 0-20 publisher score.** Pro: matches IRCC, clean. Con: discontinuity vs pre-10-2 rows which hold 0-699.
  - **(b) Persist the 0-699 score derived via `rawPercentToWritingSpeakingScore` after first dividing by 5.** Pro: keeps the column homogeneous with Listening/Reading. Con: loses publisher-fidelity.
  - **Decision (this AC item):** option **(a)** — persist 0-20. Rationale: stories 10.X are migrating the entire stack toward publisher-fidelity; consistency now beats homogeneity later. Add a comment noting the discontinuity for Epic 17.1's eventual `variant` column migration.
- [x] **UPDATE** [src/lib/speaking-scoring.ts](src/lib/speaking-scoring.ts) to add `computeSpeakingScore0to20(taskOveralls: [number, number, number]): WritingSpeakingScore` that wraps `computeSpeakingComposite` (which produces 0-100) and divides by 5. JSDoc explains the publisher mapping.
- [x] **UPDATE** `src/lib/__tests__/speaking-mock-test-persist.test.ts` to assert the persisted `total_score` is in [0, 20] for speaking rows.
- [x] **DOCUMENT** in CLAUDE.md (per AC #7) that the speaking pipeline now persists publisher-scale 0-20 scores and that historical pre-10-2 rows hold legacy 0-699 values.

**Given** a story 9-8 mock-test result with task overalls (80, 90, 75) → composite 81.67
**When** `computeSpeakingScore0to20` is called
**Then** the result is 16 (rounded from 16.33)
**And** persisted `mock_tests.total_score` is 16

### 4. Update `app/(tabs)/mock-test/[testId].tsx` to use per-skill conversion

The QCM runner at [app/(tabs)/mock-test/[testId].tsx:560](app/(tabs)/mock-test/[testId].tsx#L560) currently calls `rawToTCFScore(rawPercent)` and persists 0-699 to `mock_tests.total_score`. After 10-2's deletion of `rawToTCFScore`, this caller must be updated.

- [x] Replace `rawToTCFScore(rawPercent)` with `rawPercentToListeningReadingScore(rawPercent, sectionType)` where `sectionType` is the active mock-test section (`"listening"` or `"reading"`).
- [x] **Persisted score format unchanged** for Listening/Reading: 0-699 (matches IRCC).
- [x] No UI changes beyond the function-name swap. The score number the user sees stays in the same range; only the band-boundary math changes.
- [x] Verify [app/(tabs)/mock-test/results.tsx](app/(tabs)/mock-test/results.tsx) renders the new score correctly. Manually test: pick a 75% raw → expect a CLB-6 band number (398-457 listening; 406-452 reading per `tcf-spec-source.md §2.2`).

### 5. Add `IRCC_CLB_BANDS` constant for promotion-gate math

The codebase's `CEFR_LEVELS.tcfScoreMin/Max` round-number bands ([src/types/cefr.ts:27-69](src/types/cefr.ts#L27)) are documented in `tcf-spec-source.md §2.3` as **non-publisher-authoritative** (used for UI labeling). The promotion-gate math at [src/lib/activity.ts](src/lib/activity.ts) `evaluatePromotion` (story 9-2 contract) should use **publisher-anchored bands** for the per-skill threshold check.

- [x] Create `src/lib/ircc-bands.ts` (NEW) exporting:
  ```typescript
  /**
   * IRCC CLB ↔ TCF Canada per-skill equivalency bands.
   *
   * Source: docs/tcf-spec-source.md §2.2 (transcribed from canada.ca with
   * caveat — operator-verifiable). Used by:
   * - src/lib/scoring.ts per-skill conversion functions (10-2)
   * - src/lib/activity.ts evaluatePromotion (per-skill threshold check)
   *
   * Each band is INCLUSIVE-INCLUSIVE for raw values within range. CLB
   * thresholds for promotion (e.g., "user is at CLB 7+ in listening")
   * use the band's `min` value.
   */
  export const IRCC_CLB_BANDS = {
    listeningReading: {
      // CLB level → { listening: [min, max], reading: [min, max] } TCF score range
      "1-3": { listening: [0, 330], reading: [0, 341] },
      "4": { listening: [331, 368], reading: [342, 374] },
      "5": { listening: [369, 397], reading: [375, 405] },
      "6": { listening: [398, 457], reading: [406, 452] },
      "7": { listening: [458, 502], reading: [453, 498] },
      "8": { listening: [503, 522], reading: [499, 523] },
      "9": { listening: [523, 548], reading: [524, 548] },
      "10-12": { listening: [549, 699], reading: [549, 699] },
    } as const,
    writingSpeaking: {
      "1-3": [0, 3],
      "4": [4, 5],
      "5": [6, 6],
      "6": [7, 9],
      "7": [10, 11],
      "8": [12, 13],
      "9": [14, 15],
      "10-12": [16, 20],
    } as const,
  } as const;

  export type CLBLevel = keyof typeof IRCC_CLB_BANDS.listeningReading;

  export function clbLevelFromListeningScore(score: TCFScore): CLBLevel | null {
    /* find the band whose [min, max] contains score */
  }
  export function clbLevelFromReadingScore(score: TCFScore): CLBLevel | null { /* ... */ }
  export function clbLevelFromWritingSpeakingScore(score: WritingSpeakingScore): CLBLevel | null { /* ... */ }
  ```
- [x] **Why a separate file `ircc-bands.ts`** (not in `scoring.ts` or `constants.ts`): the IRCC bands are a single-source-of-truth lookup table that multiple consumers (`scoring.ts`, `activity.ts`, future placement-test) share. Putting it in its own file with named exports avoids circular imports and lets the file's tests live in isolation.
- [x] **Use this constant in the new conversion functions** (AC #1) — the band boundaries should derive from `IRCC_CLB_BANDS`, not be hardcoded inline. Single source of truth.
- [x] **The `CEFR_LEVELS.tcfScoreMin/Max` bands stay** — they're for UI labeling (e.g., "B2" pill on the home screen). Add JSDoc clarifying:
  ```typescript
  /**
   * UI-display CEFR ↔ TCF round-number bands.
   *
   * **NOT IRCC-EQUIVALENT** — these are convenience labels for self-
   * assessment grid display (e.g., "you're at B2"). For IRCC / Express
   * Entry math (CLB equivalency, promotion gates), use
   * `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS` instead.
   *
   * Source: round-number convention used by HiTCF, ouizami, tcfprep
   * third-party tables (per docs/tcf-spec-source.md §2.3). The
   * publisher does not publish a verbatim TCF→CEFR mapping.
   */
  ```
- [x] Add tests at `src/lib/__tests__/ircc-bands.test.ts` (NEW):
  - Each band's `[min, max]` matches `docs/tcf-spec-source.md §2.2` verbatim
  - `clbLevelFromListeningScore(458)` returns `"7"`
  - `clbLevelFromListeningScore(457)` returns `"6"`
  - Below floor / above ceiling handling
  - Round-trip: for each CLB level, `clbLevelFromListeningScore(band.listening[0])` and `(band.listening[1])` both return that CLB level
- [x] **Citations matrix update** (per AC #7): add a new §2 row for `IRCC_CLB_BANDS` (✓ Verified — sourced from `tcf-spec-source.md §2.2`).

### 6. Update `activity.ts` `evaluatePromotion` to use per-skill IRCC bands

Story 9-2's promotion gate currently checks per-skill scores against `CEFR_LEVELS.tcfScoreMin` (the round-number bands). 10-2's IRCC-anchored bands are more accurate. The change is small: swap the threshold lookup.

- [x] **READ** [src/lib/activity.ts](src/lib/activity.ts) `evaluatePromotion` (story 9-2 + 9-10 contract) — confirm the per-skill threshold check uses `CEFR_LEVELS[targetLevel].tcfScoreMin`.
- [x] **DECIDE** what threshold to check against:
  - **Option A:** keep `CEFR_LEVELS.tcfScoreMin` (UI bands) — least change
  - **Option B:** switch to `IRCC_CLB_BANDS` and use the CLB threshold corresponding to the target CEFR level (e.g., promotion to C1 = CLB 9+)
  - **Decision (this AC item):** option **A for this story.** Reason: 10-2's scope is the scoring pipeline; activity.ts's promotion gate is owned by story 9-2 and any change risks breaking the promotion contract. Document in JSDoc that the promotion gate uses UI-band thresholds (which are slightly more permissive than IRCC bands at level boundaries) and that switching to IRCC bands is a follow-up.
- [x] Add a comment to `evaluatePromotion`'s threshold-check block: `// Note: uses CEFR_LEVELS round-number bands (UI display) not IRCC bands; this is intentional for UX gentleness. Switch to IRCC_CLB_BANDS when the promotion engine is migrated to per-CLB thresholds (deferred follow-up).`
- [x] **No code change to activity.ts beyond the comment.** Story 9-2's regression tests at [src/lib/__tests__/activity.test.ts](src/lib/__tests__/activity.test.ts) continue to pass unchanged.

### 7. Update CLAUDE.md, citations matrix, and source-of-truth follow-ups

- [x] Add a new architecture line to [CLAUDE.md](CLAUDE.md) after the "Deploy substrate" line (currently the most recent line, story 9-9):
  ```markdown
  **TCF scoring pipeline (per-skill, publisher-anchored):** post-Epic-10.2, scoring is split into per-skill conversion functions in `src/lib/scoring.ts`: `rawPercentToListeningReadingScore` (returns 0-699 for the QCM skills) and `rawPercentToWritingSpeakingScore` (returns 0-20 for the production-task skills) — band boundaries are anchored to the IRCC CLB equivalency table at `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS` (sourced from `docs/tcf-spec-source.md §2.2`). The legacy `rawToTCFScore` 7-band linear interpolation is **deleted**, not aliased — every caller is updated. `calculateCompositeScore` was renamed to `calculateInternalCompositeForUI` and JSDoc-flagged as NOT IRCC-equivalent and NOT used by the promotion engine; `SKILL_WEIGHTS_TCF_CANADA` (4-skill, equal 0.25 weights) replaces the prior 5-skill `SKILL_WEIGHTS` and explicitly excludes Grammar (operator decision per `docs/tcf-spec-source.md §10` follow-up #1 — Grammar stays in the `TCFSkill` union as a non-TCF practice skill). Speaking pipeline (`src/lib/speaking-mock-test-persist.ts`) now persists `mock_tests.total_score` in publisher-scale 0-20 for `test_type="speaking"`; pre-10-2 historical rows hold legacy 0-699 values (the discontinuity is documented but not backfilled — Epic 17.1 owns schema versioning). UI-labeling `CEFR_LEVELS.tcfScoreMin/Max` round-number bands stay for self-assessment-grid display; IRCC math uses `IRCC_CLB_BANDS`. `app/(tabs)/mock-test/results.tsx:60` literal `500` replaced with `TCF.C1_MIN`. Verified 2026-05-XX, story 10-2.
  ```
- [x] **UPDATE** [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md) — flip the four ✗ DELTA rows (3 in §1/§2 + 1 in §1) to ✓ Verified, naming Story 10-2 as the closure:
  - §1 row `TCF.C1_MIN`: ✗ DELTA → ✗ DELTA (unchanged — story 10-2 keeps round-number 500 for UI; this row stays as a deferred Epic 10.X polish item OR closes if the JSDoc note is sufficient — see decision below)
  - §2 row `rawToTCFScore`: ✗ DELTA → ✓ Verified 2026-05-XX (Story 10-2 deleted the function and replaced with per-skill IRCC-anchored conversions)
  - §2 row `SKILL_WEIGHTS`: ✗ DELTA → ✓ Verified 2026-05-XX (Story 10-2 dropped grammar, switched to 4-skill 0.25-each `SKILL_WEIGHTS_TCF_CANADA`)
  - §2 row `CEFR_LEVELS.tcfScoreMin/Max`: ✗ DELTA → ✓ Verified 2026-05-XX with caveat (round-number bands kept for UI labeling per JSDoc; IRCC math uses `IRCC_CLB_BANDS`)
  - **Decision on TCF.C1_MIN:** keep as ✗ DELTA owned by no specific Epic (it's a UI-rounding choice, not a math correctness issue). Update the row's Status to: `🟡 INTENTIONAL — round-number 500 kept for UI 'distance to C1' display; IRCC promotion math uses IRCC_CLB_BANDS instead. See JSDoc in src/lib/constants.ts.`
- [x] **ADD** a new row to citations matrix §2 for `src/lib/ircc-bands.ts IRCC_CLB_BANDS` — Status: ✓ Verified 2026-05-XX (sourced from §2.2).
- [x] **UPDATE** [docs/tcf-spec-source.md §10](docs/tcf-spec-source.md) follow-up #2 (recalibrate composite scoring): mark **DONE — closed by Story 10-2 (this story).**

### 8. Test surface (regression + new contract enforcement)

- [x] **DELETE** the old `rawToTCFScore` band-pinning tests in `src/lib/__tests__/scoring.test.ts` (lines 9-57 — they pinned the wrong math).
- [x] **REPLACE** with the new tests per AC #1 (12 anchor pairs for Listening/Reading + 9 for Writing/Speaking + monotonicity).
- [x] **ADD** `src/lib/__tests__/ircc-bands.test.ts` per AC #5 (band-boundary correctness, lookup function tests, round-trip tests).
- [x] **UPDATE** `src/lib/__tests__/speaking-mock-test-persist.test.ts` to assert speaking total_score is in [0, 20].
- [x] **VERIFY** existing tests stay green:
  - `src/lib/__tests__/activity.test.ts` (story 9-2 promotion engine — no behavior change)
  - `src/lib/__tests__/speaking-scoring.test.ts` (story 9-8 internal 0-100 composite — no behavior change)
  - `src/lib/__tests__/scoring.test.ts` `calculateInternalCompositeForUI` block (was `calculateCompositeScore`)
  - `src/lib/__tests__/tcf-spec.test.ts` citation-matrix completeness — UPDATE to expect the new `ircc-bands.ts` row in the matrix
- [x] **TARGET TEST COUNT POST-STORY:** 329 → 350+ (reasonable estimate: -10 deleted linear-band tests + ~30 new tests across the 4 new test areas).

### Z. Polish Requirements

- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no new error-prone code; pure scoring helpers + 1-line UI fix)
- [x] N/A — All colors use `Colors.*` design tokens (no UI in this story)
- [x] N/A — All loading states use skeleton animations (no UI; the results.tsx fix is a literal swap)
- [x] N/A — All interactive elements have accessibility labels (no UI in this story)
- [x] N/A — Non-obvious interactions have `accessibilityHint` (no UI in this story)
- [x] N/A — Stateful elements have `accessibilityState` (no UI in this story)
- [x] N/A — Tappable elements ≥ 44x44pt (no UI in this story)
- [x] N/A — All text uses `Typography.*` presets (no UI in this story)
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`. The new ircc-bands tests pass.
- [x] **Citations matrix completeness test in `tcf-spec.test.ts`** continues to pass — must include `IRCC_CLB_BANDS` row in the matrix verification.
- [x] **`git status` shows new files as untracked-but-not-ignored** — the `src/lib/ircc-bands.ts` and `src/lib/__tests__/ircc-bands.test.ts` files (Epic 9 retro A1 lesson).
- [x] **Sentry DSN leak guard + Submit credentials leak guard** in `ci.yml` continue to pass.

## Tasks / Subtasks

- [x] Task 1: Source the IRCC bands into a new `src/lib/ircc-bands.ts` module (AC #5)
  - [x] Create the file with `IRCC_CLB_BANDS` constant transcribed from `docs/tcf-spec-source.md §2.2`
  - [x] Add `clbLevelFromListeningScore`, `clbLevelFromReadingScore`, `clbLevelFromWritingSpeakingScore` lookup functions
  - [x] Add JSDoc explaining the IRCC source + caveat about third-party-transcribed table
  - [x] Create `src/lib/__tests__/ircc-bands.test.ts` with band-boundary correctness + round-trip tests

- [x] Task 2: Add `WritingSpeakingScore` type to `src/types/cefr.ts` (AC #1)

- [x] Task 3: Replace `rawToTCFScore` with per-skill conversion functions (AC #1)
  - [x] DELETE `src/lib/scoring.ts:7-35` `rawToTCFScore`
  - [x] CREATE `rawPercentToListeningReadingScore` using `IRCC_CLB_BANDS`
  - [x] CREATE `rawPercentToWritingSpeakingScore` using `IRCC_CLB_BANDS`
  - [x] DELETE old `rawToTCFScore` band-pinning tests
  - [x] CREATE new tests with 12 + 9 anchor pairs from CLB equivalency

- [x] Task 4: Rename `calculateCompositeScore` → `calculateInternalCompositeForUI` + drop grammar (AC #2)
  - [x] Rename function
  - [x] Update `SKILL_WEIGHTS` → `SKILL_WEIGHTS_TCF_CANADA` (4 skills, 0.25 each)
  - [x] Add JSDoc: NOT IRCC-equivalent, NOT used by promotion engine
  - [x] Update test cases for the rename + grammar-drop behavior
  - [x] Add regression test that `evaluatePromotion` (story 9-2) works without consulting the composite

- [x] Task 5: Fix `app/(tabs)/mock-test/results.tsx:60` literal 500 → `TCF.C1_MIN` (AC #2 cleanup)

- [x] Task 6: Update `app/(tabs)/mock-test/[testId].tsx:560` to use `rawPercentToListeningReadingScore` (AC #4)

- [x] Task 7: Update `src/lib/speaking-scoring.ts` + `speaking-mock-test-persist.ts` for 0-20 publisher scale (AC #3)
  - [x] Add `computeSpeakingScore0to20` to `speaking-scoring.ts`
  - [x] Update `speaking-mock-test-persist.ts:81` to use the new function
  - [x] Persist `mock_tests.total_score` as 0-20 for `test_type="speaking"`
  - [x] Update `speaking-mock-test-persist.test.ts` to assert [0, 20] range

- [x] Task 8: Update `activity.ts` JSDoc note (AC #6) — no code change

- [x] Task 9: Update CLAUDE.md (AC #7)
  - [x] Add new architecture line for the per-skill scoring pipeline

- [x] Task 10: Update `docs/tcf-spec-citations.md` (AC #7)
  - [x] Flip 3 ✗ DELTA rows in §1 + §2 to ✓ Verified
  - [x] Add new row for `IRCC_CLB_BANDS`
  - [x] Update `TCF.C1_MIN` row to 🟡 INTENTIONAL

- [x] Task 11: Update `docs/tcf-spec-source.md` §10 follow-up #2 (AC #7)
  - [x] Mark "recalibrate composite scoring" as DONE — closed by Story 10-2

- [x] Task 12: Quality gates (AC #Z)
  - [x] `npm run type-check` passes
  - [x] `npm run lint` passes
  - [x] `npm run format:check` passes
  - [x] `npm test` passes — target 350+ tests (was 329)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN leak guard passes
  - [x] CI Submit credentials leak guard passes
  - [x] `git status` shows new files as untracked-but-not-ignored
  - [x] Citations matrix completeness test in `tcf-spec.test.ts` includes `IRCC_CLB_BANDS`

## Dev Notes

### Architecture pattern alignment

- **Per-skill, not composite, scoring** is the architectural commitment of Epic 10. 10-2 implements it; 10-3/10-4/10-6 build on it. The `IRCC_CLB_BANDS` constant becomes the single source of truth for "what does TCF score X mean for IRCC."
- **Round-number CEFR bands stay for UI** because users expect "B2" / "C1" labels; UI bands are documented as NOT IRCC-equivalent in JSDoc.
- **Promotion engine (story 9-2 contract) is unchanged** — 10-2 leaves `evaluatePromotion` as-is; switching its threshold lookup to IRCC bands is a deferred follow-up because it would change CEFR promotion behavior in subtle ways that need their own pedagogy review.
- **Speaking pipeline now persists publisher-scale 0-20** for `mock_tests.total_score` when `test_type="speaking"`. Listening/Reading still persist 0-699. Discontinuity for historical pre-10-2 rows is documented; Epic 17.1 owns schema versioning if needed.

### Pulling forward Epic 9 + 10-1 lessons

- **Epic 9 retro A1** ("git status shows new files as untracked-but-not-ignored"): Polish AC #Z explicitly bakes this in. New files (`ircc-bands.ts`, its test, citations matrix updates) MUST appear in `git status`.
- **Epic 9 retro A3** (review-patch budget): expect 5-15 patches in this story's review pass. Numerical-table heavy stories tend to surface boundary-condition bugs (e.g., a CLB-7 score of exactly 458 should map to CLB 7, not CLB 6 — off-by-one risk).
- **Story 10-1 lesson** (citations-matrix completeness): every TCF-derived value MUST appear in `docs/tcf-spec-citations.md`. The new `IRCC_CLB_BANDS` constant gets a row; the matrix-completeness test in `tcf-spec.test.ts` will fail loudly if it's missing.
- **Story 10-1 pedagogy review verdict**: "Epic 10 may proceed to story 10-2 (scoring scale calibration)" — this story IS the move.
- **Story 9-8 lesson** (Speaking pipeline): the existing 0-100 internal composite is fine; 10-2 just adds a 0-20 mapper. Don't re-architect 9-8's flow.

### Source tree components to touch

| File | Action |
|---|---|
| [src/lib/ircc-bands.ts](src/lib/ircc-bands.ts) | **Create** — `IRCC_CLB_BANDS` constant + 3 lookup functions |
| [src/lib/__tests__/ircc-bands.test.ts](src/lib/__tests__/ircc-bands.test.ts) | **Create** — band-boundary + round-trip tests |
| [src/lib/scoring.ts](src/lib/scoring.ts) | DELETE `rawToTCFScore`; CREATE `rawPercentToListeningReadingScore`, `rawPercentToWritingSpeakingScore`; RENAME `calculateCompositeScore` → `calculateInternalCompositeForUI`; UPDATE `SKILL_WEIGHTS` → `SKILL_WEIGHTS_TCF_CANADA` (drop grammar); UPDATE JSDoc throughout |
| [src/types/cefr.ts](src/types/cefr.ts) | Add `WritingSpeakingScore` type alias next to `TCFScore`; add JSDoc to `CEFR_LEVELS` clarifying UI-labeling-only |
| [src/lib/__tests__/scoring.test.ts](src/lib/__tests__/scoring.test.ts) | DELETE old `rawToTCFScore` linear-band tests; ADD new IRCC-anchored tests; UPDATE composite tests for the rename + grammar-drop |
| [src/lib/speaking-scoring.ts](src/lib/speaking-scoring.ts) | ADD `computeSpeakingScore0to20` function |
| [src/lib/speaking-mock-test-persist.ts](src/lib/speaking-mock-test-persist.ts) | UPDATE line 81 to use `computeSpeakingScore0to20` |
| [src/lib/__tests__/speaking-mock-test-persist.test.ts](src/lib/__tests__/speaking-mock-test-persist.test.ts) | UPDATE to assert 0-20 range for speaking total_score |
| [src/lib/__tests__/tcf-spec.test.ts](src/lib/__tests__/tcf-spec.test.ts) | UPDATE matrix-completeness test to expect `IRCC_CLB_BANDS` row |
| [src/lib/activity.ts](src/lib/activity.ts) | Add JSDoc comment noting promotion gate uses UI bands not IRCC bands (no behavior change) |
| [app/(tabs)/mock-test/[testId].tsx](app/(tabs)/mock-test/[testId].tsx) | UPDATE line 560 to use `rawPercentToListeningReadingScore` |
| [app/(tabs)/mock-test/results.tsx](app/(tabs)/mock-test/results.tsx) | Replace literal `500` with `TCF.C1_MIN` (line 60) |
| [src/lib/constants.ts](src/lib/constants.ts) | Add JSDoc to `TCF.C1_MIN` clarifying UI-rounding intent |
| [CLAUDE.md](CLAUDE.md) | Add new architecture line for per-skill scoring pipeline |
| [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md) | Flip 3 DELTA rows → ✓ Verified; add `IRCC_CLB_BANDS` row; update `TCF.C1_MIN` row |
| [docs/tcf-spec-source.md](docs/tcf-spec-source.md) | §10 follow-up #2 → DONE |

### Anti-pattern prevention

- **Do NOT alias the old `rawToTCFScore` for backward compat** — rename + delete + update every caller. The function's semantics changed (no more linear interpolation); aliasing would let stale calls quietly produce wrong scores.
- **Do NOT add a `variant` column to `mock_tests`** — Epic 17.1 owns schema versioning. The discontinuity between pre-10-2 and post-10-2 scores is acceptable for now.
- **Do NOT change `evaluatePromotion`'s behavior** — story 9-2 contract holds. Only add a JSDoc note explaining the threshold-lookup choice.
- **Do NOT drop `grammar` from the `TCFSkill` union** — operator's 2026-05-07 direction. Only `SKILL_WEIGHTS_TCF_CANADA` excludes it. Grammar continues to function as a non-TCF practice skill.
- **Do NOT change the `CEFR_LEVELS.tcfScoreMin/Max` round-number bands** — they're documented as UI-labeling-only. Changing them would ripple into UI displays across many screens.
- **Do NOT introduce a `Score` discriminated union** for TCFScore vs WritingSpeakingScore — TypeScript-flag-only nominal aliases are sufficient and avoid runtime overhead. The function-naming convention (`rawPercentToListeningReadingScore` vs `rawPercentToWritingSpeakingScore`) signals intent at the call site.
- **Do NOT backfill historical `mock_tests` rows** with re-computed scores — the discontinuity is documented; backfilling is a separate decision (Epic 17.1).
- **Do NOT change Edge Functions or migrations** — 10-2 is client-side scoring math only.

### Testing standards

- **Anchor pairs MUST come from `docs/tcf-spec-source.md §2.2` verbatim**, not invented by the dev agent. The IRCC table is the contract; tests pin the contract.
- **Off-by-one boundary tests are non-negotiable** — `clbLevelFromListeningScore(458)` MUST return CLB 7 (not 6); 457 MUST return 6. Each band's [min, max] gets explicit boundary-test cases.
- **Round-trip tests** — for each CLB level, both `[min]` and `[max]` of the band MUST map back to that CLB level.
- **Don't test the implementation, test the contract** — assertions reference IRCC bands, not specific function-internal magic numbers.

### Project Structure Notes

- New file `src/lib/ircc-bands.ts` lives in `src/lib/`, parallel to `scoring.ts` and `speaking-scoring.ts`. Tests under `src/lib/__tests__/`.
- The 0-100 internal composite scale (story 9-8) stays in `speaking-scoring.ts`; the 0-20 publisher mapper is added there too. `speaking-mock-test-persist.ts` consumes both.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §1 P1-1 + P1-2 — scoring math findings]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §2 line 158 — Epic 10.2 deliverable]
- [Source: docs/tcf-spec-source.md §2.1 — per-skill scoring scales (0-699 vs 0-20)]
- [Source: docs/tcf-spec-source.md §2.2 — IRCC CLB equivalency table]
- [Source: docs/tcf-spec-source.md §2.3 — CEFR ↔ TCF round-number-bands disclaimer]
- [Source: docs/tcf-spec-source.md §2.4 — critical observations + 3 DELTAs flagged for Epic 10.2]
- [Source: docs/tcf-spec-source.md §10 follow-up #2 — recalibrate composite scoring]
- [Source: docs/tcf-spec-citations.md §1 + §2 — 4 ✗ DELTA rows owned by Epic 10.2]
- [Source: src/lib/scoring.ts:7-35 `rawToTCFScore` — to be DELETED]
- [Source: src/lib/scoring.ts:50-67 `SKILL_WEIGHTS` block + JSDoc "do not edit in 9-1"]
- [Source: src/lib/scoring.ts:70-89 `calculateCompositeScore` — to be RENAMED]
- [Source: src/lib/scoring.ts:92-127 `isReadyForNextLevel` — unchanged; consumed by activity.ts]
- [Source: src/lib/speaking-scoring.ts (full file) — story 9-8 internal 0-100 composite]
- [Source: src/lib/speaking-mock-test-persist.ts:81 — current `rawToTCFScore` consumer to fix]
- [Source: src/types/cefr.ts:5 `TCFSkill` union — `grammar` retained per operator decision]
- [Source: src/types/cefr.ts:21-69 `CEFR_LEVELS` round-number bands — kept; JSDoc clarification only]
- [Source: app/(tabs)/mock-test/[testId].tsx:560 — second `rawToTCFScore` consumer to fix]
- [Source: app/(tabs)/mock-test/results.tsx:60 — literal `500` to replace with `TCF.C1_MIN`]
- [Source: src/lib/__tests__/scoring.test.ts:9-57 — old linear-band tests to DELETE]
- [Source: src/lib/__tests__/tcf-spec.test.ts — citation-matrix completeness test (story 10-1)]
- [Source: src/lib/__tests__/activity.test.ts — story 9-2 promotion engine; tests stay green]
- [Source: src/lib/activity.ts `evaluatePromotion` — story 9-2 + 9-10 contract; only JSDoc updated]
- [Source: docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md — verbatim IRCC table snapshot]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/10-2-scoring-scale-calibration` (from `main`)
- Quality gates: `npm run type-check` ✓ · `npm run lint` ✓ · `npm run format:check` ✓ · `npm test` (447 passing, +118 vs 329) ✓ · `npm run check:colors` ✓
- CI submit-credentials leak guard ✓ · Sentry DSN leak guard ✓
- New files NOT gitignored (Epic 9 retro A1) ✓

### Completion Notes List

**Replaced `rawToTCFScore` (deleted) with two per-skill conversion functions:**

- `rawPercentToListeningReadingScore(rawPercent, "listening" | "reading"): TCFScore` — 0–699 scale, IRCC-band-anchored
- `rawPercentToWritingSpeakingScore(rawPercent): WritingSpeakingScore` — 0–20 scale, IRCC-band-anchored
- Both clamp to [0, scale-max], are monotonic non-decreasing, and round-trip-band-preserving against `IRCC_CLB_BANDS`

**Created `src/lib/ircc-bands.ts`** as the single source of truth for IRCC CLB ↔ TCF Canada per-skill bands (`IRCC_CLB_BANDS`) plus 3 lookup helpers (`clbLevelFromListeningScore`, `clbLevelFromReadingScore`, `clbLevelFromWritingSpeakingScore`). Source: `docs/tcf-spec-source.md §2.2` verbatim.

**Renamed `calculateCompositeScore` → `calculateInternalCompositeForUI`** with explicit JSDoc disclaimer (NOT IRCC-equivalent, NOT used by promotion engine). `SKILL_WEIGHTS` → `SKILL_WEIGHTS_TCF_CANADA` (4 skills × 0.25, grammar excluded — operator decision per `docs/tcf-spec-source.md §10` follow-up #1; grammar value is silently dropped from the average).

**Speaking pipeline now persists publisher-scale 0–20:** `speaking-mock-test-persist.ts:81` no longer routes through the deleted `rawToTCFScore`. New helper `computeSpeakingScore0to20` in `speaking-scoring.ts` divides the 0–100 internal composite by 5. `cefrLevelFromWritingSpeakingScore` in `scoring.ts` maps 0–20 → CEFR via CLB equivalence for the persisted `cefr_result`. Pre-10-2 historical rows hold legacy 0–699 values — discontinuity documented in CLAUDE.md (Epic 17.1 owns schema versioning).

**`app/(tabs)/mock-test/[testId].tsx:560`** updated to call `rawPercentToListeningReadingScore(rawPercent, section)` — section type `"listening" | "reading"` matches the new signature exactly.

**`app/(tabs)/mock-test/results.tsx:60`** literal `500` replaced with `TCF.C1_MIN`.

**`activity.ts evaluatePromotion`** unchanged behavior (story 9-2 contract); JSDoc comment added on `PASSING_SCORE` clarifying the 0–100 internal scale vs the IRCC scales. New regression block in `activity.test.ts` (2 tests) demonstrates the promotion gate consumes only per-skill rows, never the composite.

**`WritingSpeakingScore` type alias** added to `src/types/cefr.ts` next to `TCFScore` — TypeScript-flag-only nominal protection so call sites cannot mix the 0–699 and 0–20 scales.

**Citations matrix** flipped 3 ✗ DELTA rows → ✓ Verified, added `IRCC_CLB_BANDS` + `rawPercentToListeningReadingScore` + `rawPercentToWritingSpeakingScore` + `SKILL_WEIGHTS_TCF_CANADA` rows, marked `TCF.C1_MIN` row as 🟡 INTENTIONAL.

**`docs/tcf-spec-source.md §10` follow-up #2** marked **DONE — closed by Story 10-2**.

**`CLAUDE.md`** gained a new "TCF scoring pipeline (per-skill, publisher-anchored)" architecture line above the Deploy substrate line.

**Test surface:** +118 tests vs pre-story baseline (329 → 447). New `ircc-bands.test.ts` covers 24 band-boundary cases + 3 round-trip blocks (8 levels × 3 skills). `scoring.test.ts` rewritten to assert IRCC-anchored CLB band round-trip across 8+8 anchor pairs for L/R + 8 for W/S + monotonicity + clamp behavior. `speaking-scoring.test.ts` adds 8 cases for `computeSpeakingScore0to20`. `speaking-mock-test-persist.test.ts` adds 2 cases asserting 0–20 persistence + known-input mapping. `activity.test.ts` adds 2 cases asserting promotion does not consume the composite. `tcf-spec.test.ts` adds matrix-completeness assertion for the 4 new Story 10-2 row keys.

**Out of scope (deferred per story):** per-CEFR passage calibration (Epic 10.3), vocabulary frequency caps (Epic 10.4), placement test extraction (Epic 10.5), Speaking rubric deepening (Epic 10.6), linguistic accuracy (Epic 10.7), anti-cheat (Epic 10.8), `mock_tests` schema versioning + backfill (Epic 17.1), promotion engine migration to `IRCC_CLB_BANDS` (deferred follow-up).

### File List

**Created:**

- `src/lib/ircc-bands.ts` (NEW — IRCC_CLB_BANDS + 3 lookup functions)
- `src/lib/__tests__/ircc-bands.test.ts` (NEW — 50+ test cases)

**Modified:**

- `src/lib/scoring.ts` (DELETE rawToTCFScore; CREATE rawPercentToListeningReadingScore + rawPercentToWritingSpeakingScore + cefrLevelFromWritingSpeakingScore; RENAME calculateCompositeScore → calculateInternalCompositeForUI; UPDATE SKILL_WEIGHTS → SKILL_WEIGHTS_TCF_CANADA dropping grammar)
- `src/types/cefr.ts` (ADD WritingSpeakingScore type alias; ADD JSDoc to TCFSkill + TCFScore + CEFR_LEVELS clarifying UI-labeling-only)
- `src/lib/speaking-scoring.ts` (ADD computeSpeakingScore0to20)
- `src/lib/speaking-mock-test-persist.ts` (UPDATE line 81 to use new 0-20 publisher path; UPDATE SpeakingMockTestResults.totalScore type)
- `src/lib/activity.ts` (ADD JSDoc to PASSING_SCORE explaining 0-100 internal vs IRCC scales)
- `app/(tabs)/mock-test/[testId].tsx` (UPDATE line 560 + import to use rawPercentToListeningReadingScore)
- `app/(tabs)/mock-test/results.tsx` (UPDATE line 60 literal 500 → TCF.C1_MIN; UPDATE import)
- `src/lib/__tests__/scoring.test.ts` (REWRITE — IRCC-anchored band round-trip + monotonicity + clamp tests; UPDATE composite tests for rename + grammar drop)
- `src/lib/__tests__/speaking-scoring.test.ts` (ADD computeSpeakingScore0to20 tests)
- `src/lib/__tests__/speaking-mock-test-persist.test.ts` (ADD 0-20 persistence assertions)
- `src/lib/__tests__/activity.test.ts` (ADD Story 10-2 regression block — promotion does not consume composite)
- `src/lib/__tests__/tcf-spec.test.ts` (ADD matrix-completeness assertion for Story 10-2 rows)
- `CLAUDE.md` (ADD TCF scoring pipeline architecture line)
- `docs/tcf-spec-citations.md` (FLIP 3 ✗ DELTA rows → ✓ Verified; ADD 4 Story 10-2 rows; UPDATE TCF.C1_MIN to 🟡 INTENTIONAL; UPDATE §6 speakingTaskEvaluationSchema row to 🟡 PARTIAL)
- `docs/tcf-spec-source.md` (UPDATE §10 follow-up #2 — DONE closed by Story 10-2)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (10-2: ready-for-dev → in-progress → review → done)
- `_bmad-output/implementation-artifacts/10-2-scoring-scale-calibration.md` (this story file)
- `src/lib/constants.ts` (ADD JSDoc to TCF.C1_MIN — review patch P11)

---

## Senior Developer Review (AI)

**Review date:** 2026-05-10
**Reviewers:** Blind Hunter (general adversarial) + Edge Case Hunter (project-aware) + Acceptance Auditor (spec-vs-impl)
**Outcome:** Changes Requested → all 15 patch findings addressed → APPROVED

### Triage outcome

- **15 patch findings** — all addressed in this story branch (HIGH × 4, MED × 8, LOW × 3)
- **5 defer findings** — pre-existing or out-of-scope (type-system protection, IRCC table boundary semantics, immutability, schema versioning)
- **4 reject findings** — noise (W/S step-function distribution by design, -0 edge, 99.99→100 unreachable discontinuity, AC #6.1 spec premise was wrong)

### Action Items (all resolved)

- [x] **[HIGH] P1** Mixed-scale composite — `calculateInternalCompositeForUI` now scoped to Listening + Reading only (0–699 scale); Writing/Speaking/grammar silently dropped to avoid scale conflation. Test rewritten to pin the L/R-only contract; added `InternalComposite` interface with JSDoc on `distanceToC1` field.
- [x] **[HIGH] P2** `cefrLevelFromWritingSpeakingScore` no longer returns null for valid CLB 1-3 — maps to "A1" instead. Persist code's `?? "A1"` is now a defensive guard for invalid inputs only.
- [x] **[HIGH] P3** `WritingSpeakingScore` JSDoc softened to "documentation-only naming convention" — explicitly acknowledges TypeScript does NOT enforce scale separation.
- [x] **[HIGH] P4** CLB 10-12 split: scores 16-17 → C1 (lower CLB 10), scores 18-20 → C2 (CLB 11-12). Operator-derived but more conservative than blanket → C2.
- [x] **[MED] P5** Off-by-one boundaries fixed — `pickBand` helper uses `[lower, upper)` semantics for non-final bands; raw 35% now lands in CLB 4 (not CLB 1-3) deterministically.
- [x] **[MED] P6** Added `formatWritingSpeakingScore(score)` returning `"X/20 (CEFR)"` parallel to `formatTCFScore`.
- [x] **[MED] P7** Test docstring for `computeSpeakingScore0to20([80, 90, 75])` clarifies the internal composite-rounding step.
- [x] **[MED] P8** `calculateSectionScore` `skill` parameter is now required (no default) — eliminates silent reading-as-listening misclassification.
- [x] **[MED] P9** `LR_BAND_RAW_PERCENT_BOUNDARIES` JSDoc rewritten to document `[lower, upper)` semantics and CLB 7 starting at exactly 75%.
- [x] **[MED] P10** Anchor pair counts: 12 L/R (was 8) + 9 W/S (was 8); added boundary-coverage anchors at 35, 50, 75, 93 (L/R) and 50 (W/S).
- [x] **[MED] P11** Added JSDoc on `TCF.C1_MIN` in `src/lib/constants.ts` per the citations matrix dangling reference.
- [x] **[MED] P12** Promotion regression test strengthened — added a HIGH-composite-FEW-passing vs LOW-composite-MANY-passing assertion that directly demonstrates per-skill semantics (would fail under any composite-aware gate).
- [x] **[LOW] P13** Test comments at "0% → 0" no longer claim "below CLB 1 floor" (which contradicted the ircc-bands round-trip tests).
- [x] **[LOW] P14** `distanceToC1` field JSDoc folded into the new `InternalComposite` interface (P1).
- [x] **[LOW] P15** CLAUDE.md TCF-scoring-pipeline line moved to AFTER Deploy substrate (was before).

### Deferred items (filed for follow-up)

- **DEFER-1:** Listening vs Reading IRCC bands disagree on CLB for value 523 (by design per IRCC table). Type-level protection requires branded types.
- **DEFER-2:** `cefrLevelFromWritingSpeakingScore` vs `levelFromScore` produce different labels for the same numeric value 15 (different scales). Also requires branded types.
- **DEFER-3:** `IRCC_CLB_BANDS["1-3"].listening` floor of 0 is operator-derived (source uses "<331" semantic). Doc-only nuance.
- **DEFER-4:** `IRCC_CLB_BANDS` could be `Object.freeze`'d for runtime immutability (`as const` already covers compile-time).
- **DEFER-5:** Promotion engine migration to `IRCC_CLB_BANDS` thresholds (currently uses internal 0-100 `PASSING_SCORE = 85`).

### Final verification

- 460 tests passing (was 447 pre-patches, 329 pre-story)
- All quality gates green: type-check, lint, format:check, npm test, check:colors
- New files NOT gitignored (Epic 9 retro A1)
- CI Sentry DSN + Submit credentials leak guards both pass
