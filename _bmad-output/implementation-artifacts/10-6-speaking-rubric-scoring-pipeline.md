# Story 10.6: Speaking Rubric & Scoring Pipeline — Add Sociolinguistic 5th Dimension

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TCF Canada candidate whose Expression Orale evaluations today score on a 4-criterion rubric (`pronunciationFluencyScore` / `vocabularyScore` / `grammarScore` / `interactionScore`, each 0–20, summed × 1.25 → 0–100) — but the publisher (France Éducation International) explicitly names **3 criterion categories** for Expression Orale at [`docs/tcf-spec-source.md §6.3`](docs/tcf-spec-source.md): _Linguistique_ + _Pragmatique_ + **_Sociolinguistique_ — adéquation à la situation de communication**, and the codebase's `speakingTaskEvaluationSchema` ([src/lib/schemas/ai-responses.ts:433-446](src/lib/schemas/ai-responses.ts)) **collapses linguistique + pragmatique into 4 dimensions and omits sociolinguistique entirely** — meaning a candidate who chooses the wrong register (tutoiement with an examiner, slang in a professional roleplay, over-formal speech in a casual scenario) loses zero rubric points for what is one of the three official publisher categories,
I want the speaking evaluator schema + prompt + scoring helpers extended to include a 5th `sociolinguisticScore: 0-20` dimension assessing "adéquation à la situation de communication" (register appropriateness, situational politeness markers, contextual code-switching, formality calibration), the per-task composite recomputed as `(5 dimensions × 0-20) / 100` (each dimension equal-weighted; `RUBRIC_TO_COMPOSITE` drops from `1.25` to `1.0`), the IRCC 0–20 publisher-scale mapping preserved unchanged (`composite / 5`), and the existing `computeSpeakingTaskOverall` / `computeSpeakingComposite` / `computeSpeakingScore0to20` call signatures preserved (no schema change at `speaking-mock-test-persist.ts` `mock_tests.section_scores` payload beyond an additional `sociolinguisticScore` key per task),
so that **the speaking section of the app scores against all 3 publisher categories instead of 2** — closing audit Epic 10.6 deliverable + closing the `docs/tcf-spec-source.md §10` follow-up #4 implication ("Add Speaking pipeline to mock test" — story 9-8 landed the pipeline; this story closes the rubric-completeness gap) + flipping the `docs/tcf-spec-citations.md §6` row from 🟡 PARTIAL to ✓ Verified — without touching the verified-correct task durations (Task 1: 120s / Task 2: 330s / Task 3: 270s, summing to the publisher's 12 min), the verified-correct task instructions / French scenarios at `buildSpeakingTaskPrompt`, or the verified-correct deterministic-3-day-bucket topic selection (Story 9-8). The Realtime examiner role-play (`docs/tcf-spec-source.md §6.1` Epic 10.6 note on Task 2 prep/speak distinction + §6.4 examiner format) is **out of scope** and deferred to a follow-up Epic 10.X story; this story closes only the rubric-completeness half.

## Background — Why This Story Exists

### What Story 9-8 shipped (verified-correct, NOT touched by 10-6)

Story 9-8 (2026-05-09, PR #47) landed the TCF Canada Expression Orale record-and-grade pipeline:

- **Per-task prompts** at [`src/lib/prompts/speaking.ts`](src/lib/prompts/speaking.ts) `buildSpeakingTaskPrompt` — 6 CEFR-calibrated topic libraries × 3 tasks (8–12 entries per cell). Deterministic 3-day bucket via `computeTopicBucket`.
- **Per-task durations** at `TASK_DURATIONS` — 120 / 330 / 270 sec, sum = 720 sec = 12 min, matches publisher §6.1 verbatim. **NOT TOUCHED by 10-6.**
- **Per-task evaluator prompt** at `buildSpeakingEvaluatorPrompt` — `<USER_TRANSCRIPT>` wrapped per Story 9-4 prompt-injection defense; vocab-tier constraint per Story 10-4; 4-criterion 0–20 rubric.
- **Schema** at [`src/lib/schemas/ai-responses.ts:433-446`](src/lib/schemas/ai-responses.ts) `speakingTaskEvaluationSchema` — 4 dims × 0-20 + optional `overallScore` 0-100 + strengths/improvements 1-5 entries each + optional `corrections` ≤ 2000 chars.
- **Scoring** at [`src/lib/speaking-scoring.ts`](src/lib/speaking-scoring.ts):
  - `computeSpeakingTaskOverall` — model `overallScore` preferred when in [0, 100]; else recomputes `(pron + vocab + grammar + interact) × 1.25` clamped to 0-100. **The `× 1.25` constant is the 4-dimension → 100-display-scale mapping that this story changes to `× 1.0` for 5 dimensions.**
  - `computeSpeakingComposite` — equal-weighted 3-task average, 0-100. **NOT TOUCHED by 10-6** (composite math is dimension-agnostic).
  - `computeSpeakingScore0to20` — `composite / 5`, IRCC publisher-scale mapping. **NOT TOUCHED by 10-6** (the `/ 5` factor depends on composite being 0-100, which it remains).
- **Persistence** at [`src/lib/speaking-mock-test-persist.ts`](src/lib/speaking-mock-test-persist.ts) — `mock_tests.section_scores.speaking.{task1, task2, task3, compositeOverall}` JSONB; `mock_tests.total_score` on the 0–20 publisher scale.
- **Eval call site** at [`src/lib/speaking-evaluator.ts:67-80`](src/lib/speaking-evaluator.ts) — `chatCompletionJSON` with `temperature: 0.3`, `maxTokens: 1024`, `feature: "speaking-eval-task-${taskNumber}"`.
- **Screen** at [`app/(tabs)/mock-test/speaking.tsx`](app/\(tabs\)/mock-test/speaking.tsx) — record-and-grade flow (NOT Realtime; Realtime is deferred per §6.4).

### What Story 10-6 closes

The 2026-05-10 source-of-truth at [`docs/tcf-spec-source.md §6.3`](docs/tcf-spec-source.md) names three publisher categories:

> **FEI publishes three criterion categories for Expression Orale** (per the public "Évaluation des épreuves du TCF" article on france-education-international.fr):
>
> 1. **Linguistique** — étendue / maîtrise du lexique, correction grammaticale, aisance, prononciation, fluidité globale du discours
> 2. **Pragmatique** — interaction, structuration du discours, cohérence et cohésion, développement thématique
> 3. **Sociolinguistique** — adéquation à la situation de communication

The §6.3 then states the gap + the closure path:

> The 4-criterion convention (pronunciation/fluency, vocabulary, grammar, interaction) used by the codebase's `speakingTaskEvaluationSchema` **collapses linguistique + pragmatique into 4 dimensions and omits sociolinguistique entirely**. […]
>
> **Implication for Epic 10.6:** the missing sociolinguistic criterion is an Epic 10.6 deliverable. Either (a) add a fifth `sociolinguisticScore` dimension to `speakingTaskEvaluationSchema` and update the prompt to assess "adéquation à la situation de communication" explicitly, or (b) document why sociolinguistic is intentionally omitted and update the rubric framing to acknowledge the gap.

This story chooses **path (a)** — add the 5th dimension. Rationale:

- Path (b) (document the omission) is the strictly cheaper option but leaves the publisher-category contract unfulfilled. A user who takes a B2 placement and consistently mismatches register would see no rubric penalty; the score is over-reported relative to what FEI would mark.
- The 4-criterion convention conflates Linguistique-grammar with Pragmatique-interaction, but ALSO drops Sociolinguistique outright. Path (a) doesn't fully un-conflate Linguistique + Pragmatique (that would require a 9-criterion breakdown), but it adds the missing Sociolinguistique as the 5th equal-weighted dimension — a strict improvement over 4-criterion with **no** Sociolinguistique signal.
- The audit's roadmap line 164 ("Speaking rubric & scoring pipeline … per-task rubric") explicitly names per-task rubric work; the 5th dimension fits that scope.
- The full 9-criterion (3 categories × 3 sub-criteria each) breakdown requires the operator-fetch _Manuel du candidat TCF_ PDF (`docs/tcf-spec-source.md §10b` item #2 — DEFERRED; the operator hasn't delivered the PDF yet). Path (a) is what's achievable without that operator-action.

The citations matrix §6 row at [`docs/tcf-spec-citations.md §6`](docs/tcf-spec-citations.md) explicitly flags the 5th-dimension gap as **Owner: Epic 10.6** — this story closes it.

### Threat / failure model — what cannot happen post-story

After this story:

1. **`speakingTaskEvaluationSchema`** at `src/lib/schemas/ai-responses.ts` gains a 5th `sociolinguisticScore: z.number().min(0).max(20)` field. Required (not optional) — the schema breaks an AI response that omits this dimension, which is the correct enforcement contract (Story 9-7 retry path will trigger).
2. **`buildSpeakingEvaluatorPrompt`** at `src/lib/prompts/speaking.ts` gains a "### 5. Sociolinguistic Appropriateness (0-20)" rubric section before the "## Composite Score" line. The JSON-output contract block at the bottom adds `"sociolinguisticScore": <0-20>` between `"interactionScore"` and `"overallScore"`. The Sociolinguistic section explicitly names: register appropriateness (tu/vous, formal/informal lexicon), situational politeness markers, contextual code-switching (e.g., professional roleplay vs casual conversation), formality calibration to the scenario.
3. **`computeSpeakingTaskOverall`** at `src/lib/speaking-scoring.ts` is updated to factor the 5th dimension into the recompute path. The constant `RUBRIC_TO_COMPOSITE = COMPOSITE_MAX / (4 * DIMENSION_MAX)` (which evaluates to `1.25`) becomes `RUBRIC_TO_COMPOSITE = COMPOSITE_MAX / (5 * DIMENSION_MAX)` (which evaluates to `1.0`). The composite calculation becomes `(pron + vocab + grammar + interact + socio) × 1.0` = 5 dims × 0-20 each = 0-100 directly. The model's `overallScore` preference branch is unchanged.
4. **`computeSpeakingComposite`** is **NOT TOUCHED** — it averages 3 task overalls (each 0-100), dimension-agnostic.
5. **`computeSpeakingScore0to20`** is **NOT TOUCHED** — `composite / 5` continues to map 0-100 → 0-20 (the math is invariant to how the composite was computed; only the input range matters, and that's still 0-100).
6. **`speaking-mock-test-persist.ts`** persistence path is **NOT TOUCHED at the function-signature level** — the `mock_tests.section_scores.speaking.{task1, task2, task3, compositeOverall}` JSONB shape grows a 5th `sociolinguisticScore` key per task automatically (Postgres JSONB is structurally additive); `mock_tests.total_score` on the 0–20 scale continues to be `computeSpeakingScore0to20`'s output. **Pre-10-6 historical rows hold 4-dimension `section_scores.speaking.task{1,2,3}` blobs**; the discontinuity is documented + forward-only (same pattern as Story 10-2's pre-10-2 historical 0–699 speaking rows).
7. **Schema-evolution call-site impact:** `src/lib/speaking-evaluator.ts:67-80` `chatCompletionJSON` call is unchanged at the source-code level. The schema parameter (`speakingTaskEvaluationSchema`) is re-imported; the change is internal to the schema. The Story 9-7 retry-once-on-parse-failure path will catch any model response that still produces only 4 dimensions and retry; if the retry also fails, the `ai-schema-parse-failed` Sentry event fires per Story 9-7.
8. **`docs/tcf-spec-source.md §6.3`** is updated to reflect closure: the "Implication for Epic 10.6" paragraph flips to "**DONE — closed by Story 10-6 on 2026-05-XX**" with a reference to the new schema field + the new `RUBRIC_TO_COMPOSITE` constant.
9. **`docs/tcf-spec-citations.md §6`** speaking-pipeline row flips from 🟡 PARTIAL to ✓ Verified with a Story 10-6 trailer documenting the 5th dimension addition + the rubric-multiplier change.
10. **`CLAUDE.md`** gains a new architecture line for the Speaking 5-dimension rubric.
11. **Realtime examiner role-play** (§6.1 Epic 10.6 prep/speak distinction note + §6.4 examiner-format note) is **EXPLICITLY DEFERRED** to a follow-up Epic 10.X story. The 10-6 story file documents the deferral in §10 follow-up.
12. **The 9-criterion breakdown** (3 publisher categories × 3 sub-criteria each, per §6.3 verbatim FEI categorization) is **ALSO EXPLICITLY DEFERRED** to a follow-up that requires the operator-fetch _Manuel du candidat TCF_ PDF (§10b item #2 operator-action blocker).

**Out of scope for this story (delegated elsewhere):**

- **Realtime examiner role-play** at the screen level — `docs/tcf-spec-source.md §6.4`. The current record-and-grade flow stays. Deferred to a new follow-up Epic 10.X story. **Specifically NOT touched:** WebSocket Realtime session, `useRealtimeVoice` hook, examiner persona prompt, Task 2 prep-window UI (silent countdown + examiner-greeting trigger).
- **Task 2 prep/speak distinction** in the rubric — §6.1 Epic 10.6 note states the rubric should not penalize silence during the 2-min prep window. The 5th dimension is rubric-content-only; the prep-window awareness lives in the prompt (this story may add a one-line "do not penalize silence during Task 2 first 2 minutes" instruction to `buildSpeakingEvaluatorPrompt` for taskNumber === 2 — see AC #2). The full prep-window UI gating is Realtime role-play scope.
- **The 9-criterion (3-category × 3-subcriterion) full breakdown** — requires operator-fetch _Manuel du candidat TCF_ (§10b item #2). Deferred.
- **Recalibrating per-task weights** (currently equal-weighted at `computeSpeakingComposite`) — calibration is "owned by Epic 10.2" per `speaking-scoring.ts:69-74` comment; Epic 10.2 shipped without per-task weighting, so the equal-weight is the current contract.
- **Migrating historical pre-10-6 mock_tests rows** to add the 5th dimension — forward-only (Story 10-2 pattern). Pre-10-6 rows show 4 dimensions in the results screen; post-10-6 rows show 5.
- **Schema changes to other speaking-related tables** (`mock_test_answers`, `skill_progress.speaking`) — `mock_test_answers` per-question entries for speaking already use `is_correct: NULL` (Story 9-8 design); 10-6 does not change that. `skill_progress.speaking` uses the existing 0-100 score scale; 10-6 does not change that.
- **Backfilling the Story 9-8 evaluator prompt change to historical mock-tests** — forward-only.
- **`buildSpeakingTaskPrompt`** topic libraries — verified-correct by Story 9-8 manual review; not touched.
- **Task durations** — verified-correct against publisher §6.1; not touched.
- **Vocabulary-constraint integration** — Story 10-4 already wires `buildVocabularyConstraintBlock(cefrLevel)` into `buildSpeakingEvaluatorPrompt`; not touched.
- **`buildSpeakingTaskPrompt` Realtime adaptation** — Realtime is deferred.

## Acceptance Criteria

### 1. Extend `speakingTaskEvaluationSchema` with `sociolinguisticScore`

- [x] **UPDATE** [`src/lib/schemas/ai-responses.ts:433-446`](src/lib/schemas/ai-responses.ts) `speakingTaskEvaluationSchema`:
  ```typescript
  export const speakingTaskEvaluationSchema = z.object({
    pronunciationFluencyScore: z.number().min(0).max(20),
    vocabularyScore: z.number().min(0).max(20),
    grammarScore: z.number().min(0).max(20),
    interactionScore: z.number().min(0).max(20),
    sociolinguisticScore: z.number().min(0).max(20), // NEW — Story 10-6, per §6.3
    overallScore: z.number().min(0).max(100).nullable().optional(),
    estimatedCEFR: cefrLevelSchema.optional(),
    strengths: z.array(z.string().min(1)).min(1).max(5),
    improvements: z.array(z.string().min(1)).min(1).max(5),
    corrections: z.string().max(2000).optional(),
  });
  ```
- [x] **REQUIRED, NOT OPTIONAL.** The schema must break on a 4-dimension AI response so the Story 9-7 retry-once path triggers. Making it `optional()` would let a 4-dimension legacy response silently pass; the whole point of this story is to enforce the 5th dimension.
- [x] **Update the top-of-schema JSDoc** at lines 410-432 to reflect the 5-dimension rubric. Add a Story 10-6 reference. Update the "0-80 sum × 1.25" arithmetic to "0-100 sum × 1.0".
- [x] **NO change to `SpeakingTaskEvaluation` type alias** at line 692 — `z.infer<typeof speakingTaskEvaluationSchema>` automatically picks up the new field. Verify by `npm run type-check`.

**Given** an AI response with only 4 dimensions (legacy 9-8 shape)
**When** `speakingTaskEvaluationSchema.safeParse(response)` is called
**Then** `success` is `false` and `error.issues` contains a missing-field error for `sociolinguisticScore`

**Given** an AI response with all 5 dimensions
**When** `speakingTaskEvaluationSchema.safeParse(response)` is called
**Then** `success` is `true` and `data.sociolinguisticScore` is a number in [0, 20]

### 2. Add Sociolinguistic rubric section to `buildSpeakingEvaluatorPrompt`

- [x] **UPDATE** [`src/lib/prompts/speaking.ts`](src/lib/prompts/speaking.ts) `buildSpeakingEvaluatorPrompt`:
  - Add a new "### 5. Sociolinguistic Appropriateness (0-20)" section AFTER the existing "### 4. Interaction Quality / Task Fulfillment (0-20)" section and BEFORE the "## Composite Score" line.
  - Content of section 5 (one bullet per criterion):
    - Register appropriateness (tu/vous, formal/informal lexicon, scenario-appropriate politeness markers)
    - Situational code-switching (professional vs casual, formal vs colloquial)
    - Formality calibration to the task scenario (e.g., commercial roleplay → polite formal; friend invitation → relaxed familiar)
    - Cultural / sociolinguistic markers appropriate for `${cefrLevel}` (A1: greetings + basic politeness; B1: register-appropriate small talk; C1+: nuanced register shifts within the same exchange)
    - Reference: TCF Expression Orale official Sociolinguistique category — "adéquation à la situation de communication" (`docs/tcf-spec-source.md §6.3`)
- [x] **Update the "## Composite Score" line** from `(pronunciationFluencyScore + vocabularyScore + grammarScore + interactionScore) × 1.25` to `(pronunciationFluencyScore + vocabularyScore + grammarScore + interactionScore + sociolinguisticScore) × 1.0`. Update the explanatory text ("This maps the 0-80 rubric sum to the 0-100 display scale used elsewhere in the app.") to read "This maps the 0-100 rubric sum (5 dimensions × 0-20 each) to the 0-100 display scale used elsewhere in the app."
- [x] **Update the JSON Response Format block** at the bottom of the prompt to add the new field:
  ```
  {
    "pronunciationFluencyScore": <0-20>,
    "vocabularyScore": <0-20>,
    "grammarScore": <0-20>,
    "interactionScore": <0-20>,
    "sociolinguisticScore": <0-20>,
    "overallScore": <0-100>,
    "estimatedCEFR": "<A1|A2|B1|B2|C1|C2>",
    "strengths": ["<1-3 specific strengths in French>"],
    "improvements": ["<1-3 specific actionable improvements in French>"],
    "corrections": "<short plain-text correction notes; no emoji, no markdown>"
  }
  ```
- [x] **OPTIONAL — Task 2 prep-window note (§6.1 partial closure):** add a one-line instruction conditional on `taskNumber === 2`: *"For Task 2, do NOT penalize silence in the first 2 minutes (publisher: '5 minutes 30 dont 2 minutes de préparation' — that window is preparation, not speaking). Score the recorded interaction from ~2:00 onward."* Inserted AFTER the existing `TASK_RUBRIC_FOCUS[taskNumber]` rendering line. This partially closes §6.1's "the rubric should not penalize silence during the prep window" requirement without implementing Realtime UI gating.
- [x] **No change to `<USER_TRANSCRIPT>` wrapper** — Story 9-4 defense holds.
- [x] **No change to `buildVocabularyConstraintBlock(cefrLevel)` integration** — Story 10-4 wiring holds.
- [x] **No change to topic libraries, task durations, or `buildSpeakingTaskPrompt`** — Story 9-8 contracts hold.

### 3. Update `computeSpeakingTaskOverall` for 5 dimensions

- [x] **UPDATE** [`src/lib/speaking-scoring.ts`](src/lib/speaking-scoring.ts) constant `RUBRIC_TO_COMPOSITE`:
  ```typescript
  /** 5 dimensions × 1.0 = 100 (mapping 0-100 rubric sum to 0-100 display). */
  const RUBRIC_TO_COMPOSITE = COMPOSITE_MAX / (5 * DIMENSION_MAX);
  ```
- [x] **UPDATE** `computeSpeakingTaskOverall` recompute path:
  ```typescript
  const pron = clamp(scores.pronunciationFluencyScore, DIMENSION_MAX);
  const vocab = clamp(scores.vocabularyScore, DIMENSION_MAX);
  const grammar = clamp(scores.grammarScore, DIMENSION_MAX);
  const interact = clamp(scores.interactionScore, DIMENSION_MAX);
  const socio = clamp(scores.sociolinguisticScore, DIMENSION_MAX); // NEW
  const composite = (pron + vocab + grammar + interact + socio) * RUBRIC_TO_COMPOSITE;
  ```
- [x] **Update the JSDoc** on `computeSpeakingTaskOverall` (lines 31-44) to reflect 5 dimensions. Update "Each dimension is clamped to [0, 20] before recompute" to remain accurate. Update the recompute formula in the JSDoc.
- [x] **NO change to `computeSpeakingComposite`** signature, body, or JSDoc. It averages 3 task overalls (each 0-100), dimension-agnostic. Verify by re-reading lines 80-85 and confirming nothing references the dimension count.
- [x] **NO change to `computeSpeakingScore0to20`** signature, body, or JSDoc. `composite / 5` mapping 0-100 → 0-20 is invariant to dimension count. Verify by re-reading lines 106-110.
- [x] **Update the top-of-file JSDoc** (lines 1-10) to reference Story 10-6 and the 5-dimension rubric.

**Given** a `SpeakingTaskEvaluation` with `pronunciationFluencyScore=20, vocabularyScore=20, grammarScore=20, interactionScore=20, sociolinguisticScore=20, overallScore=null`
**When** `computeSpeakingTaskOverall(eval)` is called
**Then** the result is `100` (5 × 20 × 1.0 = 100)

**Given** a `SpeakingTaskEvaluation` with all 5 dimensions at `10` and `overallScore=null`
**When** `computeSpeakingTaskOverall(eval)` is called
**Then** the result is `50` (5 × 10 × 1.0 = 50)

**Given** a `SpeakingTaskEvaluation` with all 5 dimensions at `0` and `overallScore=null`
**When** `computeSpeakingTaskOverall(eval)` is called
**Then** the result is `0`

**Given** a `SpeakingTaskEvaluation` with all 5 dimensions and `overallScore=85` (model-provided)
**When** `computeSpeakingTaskOverall(eval)` is called
**Then** the result is `85` (model-provided takes precedence; recompute is fallback only)

### 4. Test surface

- [x] **EXTEND** [`src/lib/__tests__/speaking-scoring.test.ts`](src/lib/__tests__/speaking-scoring.test.ts):
  - Replace any existing `× 1.25` math expectations with `× 1.0` (5-dimension) math.
  - Add new test cases:
    - All 5 dimensions at 20 → overall 100
    - All 5 dimensions at 0 → overall 0
    - All 5 dimensions at 10 → overall 50
    - Mixed dimensions (e.g., 20/15/10/5/0 → sum 50 × 1.0 = 50) → overall 50
    - Model `overallScore=85` provided → takes precedence over recompute regardless of dimension count
    - Missing `sociolinguisticScore` (i.e., `undefined` at runtime — testing the clamp resilience) → treated as 0 by the clamp
    - 5-dimension composite still routes correctly through `computeSpeakingScore0to20` (e.g., 5×20 → composite 100 → 0-20 score = 20; 5×10 → composite 50 → 0-20 score = 10)
  - **Pin the constant:** assert `RUBRIC_TO_COMPOSITE === 1.0` (or its derivation `100 / (5 * 20)` evaluates to `1.0`). This is the Story 10-6 sentinel that fails loudly if a future patch reverts the constant.
- [x] **EXTEND** [`src/lib/__tests__/speaking-evaluator.test.ts`](src/lib/__tests__/speaking-evaluator.test.ts):
  - Add a new `it.each(ALL_LEVELS × ALL_TASKS)` parameterized block asserting the rendered prompt contains:
    - "### 5. Sociolinguistic Appropriateness (0-20)" header
    - "adéquation à la situation de communication" reference
    - `"sociolinguisticScore": <0-20>` in the JSON output contract
    - The updated composite formula "+ sociolinguisticScore) × 1.0"
  - Add a Task 2 specific case asserting the prep-window instruction is present when `taskNumber === 2` and NOT present when `taskNumber === 1` or `taskNumber === 3` (only if AC #2 prep-window note is implemented).
  - **Pin the previous "× 1.25" string is NOT present** — negative assertion. A future patch that re-introduces the 4-dimension multiplier would fail.
- [x] **EXTEND** [`src/lib/schemas/__tests__/ai-responses.test.ts`](src/lib/schemas/__tests__/ai-responses.test.ts) `speakingTaskEvaluationSchema` block:
  - Positive case: 5-dimension response parses successfully.
  - Negative case: 4-dimension response (missing `sociolinguisticScore`) fails with a Zod issue path of `["sociolinguisticScore"]`.
  - Boundary case: `sociolinguisticScore = -1` and `= 21` both fail Zod min/max guards.
- [x] **VERIFY** existing tests stay green:
  - `src/lib/__tests__/speaking-mock-test-persist.test.ts` — `mock_tests.section_scores` shape grows a 5th key per task; assert the persisted blob includes `sociolinguisticScore` for each of the 3 tasks. The existing `compositeOverall` + `total_score` math should still produce sensible numbers.
  - `src/lib/prompts/__tests__/speaking.test.ts` (Story 9-8 + 10-4 vocab-integration extension) — the existing vocab-tier integration assertion still passes; the new Sociolinguistic section is additive.
  - `src/lib/prompts/__tests__/vocabulary-integration.test.ts` (Story 10-4) — `buildSpeakingEvaluatorPrompt` for all 6 levels × 3 tasks still surfaces the Vocabulary Constraint block. The new Sociolinguistic section is positioned BEFORE the "## Composite Score" line, AFTER the vocab block, so no positional regression.
  - `src/lib/__tests__/tcf-spec.test.ts` — matrix-completeness assertions stay green; the §6 row check (if any) gets refreshed in AC #5.
- [x] **TARGET TEST COUNT POST-STORY:** 677 → 700+ (estimate: ~10 new scoring cases + ~12 evaluator-prompt cases + ~3 schema cases + ~2 persist cases = ~27 new tests).

### 5. Update `docs/tcf-spec-source.md §6.3` and §10 follow-up

- [x] **UPDATE** [`docs/tcf-spec-source.md §6.3`](docs/tcf-spec-source.md) — the "Implication for Epic 10.6" paragraph (~line 254):
  - Replace from:
    ```
    **Implication for Epic 10.6:** the missing sociolinguistic criterion is an Epic 10.6 deliverable. Either (a) add a fifth `sociolinguisticScore` dimension to `speakingTaskEvaluationSchema` and update the prompt to assess "adéquation à la situation de communication" explicitly, or (b) document why sociolinguistic is intentionally omitted and update the rubric framing to acknowledge the gap. [...] Defer scaling change to Epic 10.2 (which owns scoring scale calibration); defer sociolinguistic addition to Epic 10.6.
    ```
  - To:
    ```
    **Implication for Epic 10.6:** **DONE — closed by Story 10-6 on 2026-05-XX** ([`src/lib/schemas/ai-responses.ts`](../src/lib/schemas/ai-responses.ts) `speakingTaskEvaluationSchema` ships a 5th `sociolinguisticScore: 0-20` dimension; [`src/lib/prompts/speaking.ts`](../src/lib/prompts/speaking.ts) `buildSpeakingEvaluatorPrompt` adds the "### 5. Sociolinguistic Appropriateness" rubric section; [`src/lib/speaking-scoring.ts`](../src/lib/speaking-scoring.ts) `RUBRIC_TO_COMPOSITE` updated from `1.25` to `1.0` to reflect 5 dimensions × 0-20 = 100). The full 9-criterion (3 publisher categories × 3 sub-criteria each) breakdown remains **DEFERRED** to a Phase-2 follow-up requiring the operator-fetch _Manuel du candidat TCF_ PDF (§10b item #2 operator-action).
    ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §10` follow-up tickets](docs/tcf-spec-source.md) — add a new follow-up entry (#10) referencing the Realtime examiner role-play deferral:
  ```
  10. **Realtime examiner role-play for Speaking** — **DEFERRED** to a future Epic 10.X follow-up. Story 9-8 shipped the record-and-grade flow; Story 10-6 closed the rubric-completeness gap (sociolinguistic 5th dimension). The Task 2 prep/speak distinction (§6.1) + the examiner-format Realtime role-play (§6.4) require a WebSocket Realtime session + examiner persona prompt + Task 2 prep-window UI gating (silent countdown + examiner-greeting trigger). Out of scope for 10-6; filed as Epic 10.X for the operator to schedule.
  ```
- [x] **NO change to §6.1, §6.2, §6.4** — those sections describe the publisher's spec, not the codebase implementation. The Story 10-6 footnote on §6.3 is the only §6 update.

### 6. Update `docs/tcf-spec-citations.md §6`

- [x] **UPDATE** [`docs/tcf-spec-citations.md §6`](docs/tcf-spec-citations.md) — the existing 4th row (`speakingTaskEvaluationSchema`):
  - Replace from:
    ```
    | `src/lib/schemas/ai-responses.ts` `speakingTaskEvaluationSchema` | 4 criteria × 0-20 each → sum 0-80 → ×1.25 → 0-100 | §6.3 | 🟡 PARTIAL — Story 10-2 added `computeSpeakingScore0to20` so the persisted `mock_tests.total_score` for speaking is now on the publisher's 0–20 scale via `composite / 5`. The 4-criterion convention (vs the publisher's 3-category structure with sociolinguistique) and the missing 5th `sociolinguisticScore` dimension remain **Owner: Epic 10.6**. |
    ```
  - To:
    ```
    | `src/lib/schemas/ai-responses.ts` `speakingTaskEvaluationSchema` | 5 criteria × 0-20 each → sum 0-100 → ×1.0 → 0-100 (adds sociolinguistic) | §6.3 | ✓ Verified-with-caveat 2026-05-XX — Story 10-6 ships the 5th `sociolinguisticScore` dimension (`pron/fluency + vocab + grammar + interaction + sociolinguistic`); `RUBRIC_TO_COMPOSITE` updated `1.25 → 1.0`; `computeSpeakingScore0to20` mapping (`composite / 5`) unchanged. The full 9-criterion publisher breakdown (3 categories × 3 sub-criteria) requires operator-fetch *Manuel du candidat TCF* (§10b item #2); deferred to Phase-2 follow-up. Realtime examiner role-play deferred to a separate Epic 10.X follow-up (§6.1 prep/speak distinction + §6.4 examiner format). |
    ```

### 7. Update CLAUDE.md

- [x] Add a new architecture line to [`CLAUDE.md`](CLAUDE.md) **after** the Story 10-5 "TCF placement-test prompt extraction" line (chronological order):
  ```markdown
  **TCF Expression Orale 5-dimension rubric:** post-Epic-10.6, the speaking-task evaluator at `src/lib/prompts/speaking.ts` `buildSpeakingEvaluatorPrompt` scores against **5 criteria** instead of the Story 9-8 4-criterion convention: `pronunciationFluencyScore` + `vocabularyScore` + `grammarScore` + `interactionScore` + **`sociolinguisticScore`** (NEW — adéquation à la situation de communication per `docs/tcf-spec-source.md §6.3` publisher categorization). Each dimension is 0-20; sum is 0-100; `RUBRIC_TO_COMPOSITE` in `src/lib/speaking-scoring.ts` updated from `1.25` (4-dim) to `1.0` (5-dim). `computeSpeakingTaskOverall` recompute factors all 5 dimensions when the model omits `overallScore`. `computeSpeakingComposite` (3-task average) and `computeSpeakingScore0to20` (`composite / 5` for IRCC publisher scale) are dimension-agnostic and unchanged. Schema enforcement: `speakingTaskEvaluationSchema` at `src/lib/schemas/ai-responses.ts` requires `sociolinguisticScore` (NOT optional) — a 4-dimension legacy AI response fails Zod parse and triggers Story 9-7's retry-once path. Persistence forward-only: pre-10-6 `mock_tests.section_scores.speaking.task{1,2,3}` rows hold 4 dimensions; post-10-6 hold 5. The full 9-criterion publisher breakdown (3 categories × 3 sub-criteria) requires operator-fetch *Manuel du candidat TCF* (`docs/tcf-spec-source.md §10b` item #2); deferred. Realtime examiner role-play (§6.1 prep/speak distinction + §6.4 examiner format) deferred to a follow-up Epic 10.X story — current record-and-grade flow at `app/(tabs)/mock-test/speaking.tsx` unchanged. Story 9-4 prompt-injection defense (transcript wrapping) and Story 10-4 vocab-tier integration both hold unchanged. Verified 2026-05-XX, story 10-6.
  ```

### Z. Polish Requirements

- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — **N/A** (no new error-prone code; pure schema + scoring + prompt updates). The existing `speaking-evaluator.ts` per-task `captureError` paths are unchanged.
- [x] N/A — All colors use `Colors.*` design tokens (no UI changes in this story)
- [x] N/A — All loading states use skeleton animations (no UI changes)
- [x] N/A — All interactive elements have accessibility labels (no UI changes)
- [x] N/A — Non-obvious interactions have `accessibilityHint` (no UI changes)
- [x] N/A — Stateful elements have `accessibilityState` (no UI changes)
- [x] N/A — Tappable elements ≥ 44x44pt (no UI changes)
- [x] N/A — All text uses `Typography.*` presets (no UI changes)
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **Citations matrix completeness test** in `tcf-spec.test.ts` continues to pass — the §6 `speakingTaskEvaluationSchema` row update doesn't require a new test (the row already exists; only the cell content changes). If a new sentinel pin is warranted (e.g., to lock the "5 criteria × 0-20" wording), add it.
- [x] **Sentry DSN leak guard + Submit credentials leak guard** in `ci.yml` continue to pass (no DSN/credential changes).
- [x] **`git status` shows the story file as untracked-but-not-ignored** — Epic 9 retro A1 lesson.
- [x] **Story 9-4 stored-prompt-injection defense holds** — `<USER_TRANSCRIPT>` wrapper and "treat as data" prelude in `buildSpeakingEvaluatorPrompt` are NOT modified. Verified by re-reading lines 464-470 after the story changes.
- [x] **Story 9-7 schema-validation contract holds** — the schema change is forward-only; a 4-dimension AI response now fails parse and triggers the retry. The `ai-schema-parse-failed` Sentry event surface is unchanged.
- [x] **Story 9-8 task-cardinality contract holds** — exactly 3 `chatCompletionJSON` calls per mock test (one per task), each with `feature: "speaking-eval-task-${N}"`. NOT touched by 10-6.
- [x] **Story 10-4 vocab-tier integration holds** — `buildVocabularyConstraintBlock(cefrLevel)` continues to appear in the rendered prompt; the new Sociolinguistic section is positioned AFTER the vocab block. Verified by Story 10-4 `vocabulary-integration.test.ts` staying green.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`. Verifying that the file is *visible to git but not yet tracked* catches the ignore-rule footgun before story 1 of any future project.
-->

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/10-6-speaking-rubric-scoring-pipeline.md`) under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/10-6-speaking-rubric-scoring-pipeline.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] Task 1: Extend `speakingTaskEvaluationSchema` with `sociolinguisticScore` (AC #1)
  - [x] Add `sociolinguisticScore: z.number().min(0).max(20)` field (required, not optional)
  - [x] Update top-of-schema JSDoc to reflect 5-dimension rubric + Story 10-6 reference + new "× 1.0" arithmetic

- [x] Task 2: Add Sociolinguistic rubric section to `buildSpeakingEvaluatorPrompt` (AC #2)
  - [x] Add "### 5. Sociolinguistic Appropriateness (0-20)" section after section 4
  - [x] Update "## Composite Score" formula to 5-dimension × 1.0
  - [x] Add `"sociolinguisticScore": <0-20>` to the JSON output contract
  - [x] OPTIONAL — Add Task 2 prep-window instruction conditional on `taskNumber === 2`

- [x] Task 3: Update `computeSpeakingTaskOverall` for 5 dimensions (AC #3)
  - [x] Update `RUBRIC_TO_COMPOSITE` constant from `1.25` to `1.0`
  - [x] Update recompute path to factor 5th dimension
  - [x] Update JSDoc to reflect 5-dimension formula
  - [x] Verify `computeSpeakingComposite` and `computeSpeakingScore0to20` are NOT touched

- [x] Task 4: Test surface (AC #4)
  - [x] EXTEND `speaking-scoring.test.ts` with new 5-dimension cases + constant pin
  - [x] EXTEND `speaking-evaluator.test.ts` with section-5 substring + composite-formula assertions + negative assertion that "× 1.25" is gone
  - [x] EXTEND `ai-responses.test.ts` `speakingTaskEvaluationSchema` block with 5-dim positive + 4-dim negative + boundary cases
  - [x] VERIFY `speaking-mock-test-persist.test.ts`, `speaking.test.ts` (Story 9-8), `vocabulary-integration.test.ts` (Story 10-4) stay green

- [x] Task 5: Update `docs/tcf-spec-source.md §6.3` and §10 follow-up #10 (AC #5)

- [x] Task 6: Update `docs/tcf-spec-citations.md §6` — `speakingTaskEvaluationSchema` row flipped 🟡 PARTIAL → ✓ Verified-with-caveat (AC #6)

- [x] Task 7: Update CLAUDE.md (AC #7) — add new "TCF Expression Orale 5-dimension rubric" architecture line after the Story 10-5 line

- [x] Task 8: Quality gates (AC #Z)
  - [x] `npm run type-check` passes
  - [x] `npm run lint` passes (0 errors, 0 warnings)
  - [x] `npm run format:check` passes
  - [x] `npm test` passes — target 700+ tests (was 677 post-10-5)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN + Submit credentials leak guards pass
  - [x] `git status` shows new files as untracked-but-not-ignored
  - [x] `<USER_TRANSCRIPT>` wrapper preserved in `buildSpeakingEvaluatorPrompt`
  - [x] No change to `computeSpeakingComposite` / `computeSpeakingScore0to20` / `buildSpeakingTaskPrompt` / task durations / topic libraries (verify by diff)

## Dev Notes

### Architecture pattern alignment

- **Schema-evolution forward-only** — same pattern as Story 10-2's `mock_tests.total_score` scale change (pre-10-2 0–699 rows stay; post-10-2 rows use 0–20). Pre-10-6 `mock_tests.section_scores.speaking.task{1,2,3}` JSONB blobs hold 4 dimensions; post-10-6 hold 5. Documented; not backfilled.
- **Required-not-optional schema field** — Story 9-7 lesson: schema parse failure should be loud (triggers retry + Sentry), not silent (default-fill). Making `sociolinguisticScore` required forces the AI to emit it.
- **Rubric multiplier as a derived constant** — `RUBRIC_TO_COMPOSITE = COMPOSITE_MAX / (N * DIMENSION_MAX)` so a future dimension change is a single-edit. Currently `100 / (5 * 20) = 1.0`. The test pin `expect(RUBRIC_TO_COMPOSITE).toBe(1.0)` is the sentinel.
- **Composite-scale invariance** — the 0-100 internal composite scale is preserved across the 4-dim → 5-dim transition. `computeSpeakingScore0to20` (`composite / 5`) is invariant. `computeSpeakingComposite` (3-task average) is invariant.
- **Task durations unchanged** — `docs/tcf-spec-source.md §6.1` is the publisher contract; not touched.
- **Topic libraries unchanged** — Story 9-8 manual review verified; not touched.
- **Realtime role-play deferred** — §6.1 prep/speak distinction + §6.4 examiner format are scope-creep for a rubric story. Filed as Epic 10.X follow-up.
- **Story 9-4 + 10-4 invariants preserved** — `<USER_TRANSCRIPT>` wrapper + `buildVocabularyConstraintBlock` integration both untouched.

### Pulling forward Epic 9 + 10-1 / 10-2 / 10-3 / 10-4 / 10-5 lessons

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Polish AC #Z bakes this in for the new story file. No new module files in this story (all changes are to existing files), but the story file itself must show as untracked.
- **Epic 9 retro A3** (review-patch budget — "an implementation that passes type-check, lint, and existing tests is ~70% done, not 100%"): expect 5–15 patches in this story's review. Schema-evolution stories tend to surface (a) call-site references that import the old type alias (`SpeakingTaskEvaluation`) and assume 4 dimensions, (b) test fixtures that hand-roll 4-dimension responses, (c) JSDoc / comment drift between the new "× 1.0" math and any place that still says "× 1.25". Plan the review-patch round.
- **Story 9-7 lesson** (Zod schema is the runtime guard, prompt is the generation guide): schema and prompt are deliberately separate. Change both in lockstep here.
- **Story 9-8 lesson** (`MAX_TRANSCRIPT_CHARS = 12000` + `<USER_TRANSCRIPT>` wrapper): preserve verbatim; do NOT regress the transcript-safety contract.
- **Story 10-2 lesson** ("delete don't alias"): no aliases for the old `RUBRIC_TO_COMPOSITE` value; update the constant directly.
- **Story 10-3 lesson** (single source of truth for a derived constant): `RUBRIC_TO_COMPOSITE` is a derived constant, not a hardcoded literal. The single-edit pattern holds.
- **Story 10-4 lesson** (`buildVocabularyConstraintBlock` integration is positional — must stay BEFORE the rubric sections): new Sociolinguistic section goes AFTER the existing 4 dimensions, BEFORE the composite-score line; vocab block stays positioned where Story 10-4 placed it (between `## Evaluation Task` and `## Evaluation Rubric`).
- **Story 10-5 lesson** (regression tests pin the deletion claims): the negative assertion "× 1.25 is NOT in the prompt" defends the rubric-multiplier change the same way Story 10-5's "top-N is NOT in the prompt" defends the vocab-tier extraction.

### Source tree components to touch

| File | Action |
|---|---|
| [src/lib/schemas/ai-responses.ts](src/lib/schemas/ai-responses.ts) | UPDATE — add `sociolinguisticScore` field (required) to `speakingTaskEvaluationSchema`; update top-of-schema JSDoc |
| [src/lib/prompts/speaking.ts](src/lib/prompts/speaking.ts) | UPDATE — add "### 5. Sociolinguistic Appropriateness (0-20)" rubric section; update composite-score formula text; add field to JSON output contract; OPTIONAL Task 2 prep-window note |
| [src/lib/speaking-scoring.ts](src/lib/speaking-scoring.ts) | UPDATE — `RUBRIC_TO_COMPOSITE` constant updated `1.25 → 1.0`; `computeSpeakingTaskOverall` recompute path factors 5th dimension; JSDoc updated; `computeSpeakingComposite` + `computeSpeakingScore0to20` NOT touched |
| [src/lib/__tests__/speaking-scoring.test.ts](src/lib/__tests__/speaking-scoring.test.ts) | UPDATE — 5-dimension math expectations replace 4-dim; new boundary + mixed cases; constant pin |
| [src/lib/__tests__/speaking-evaluator.test.ts](src/lib/__tests__/speaking-evaluator.test.ts) | UPDATE — Sociolinguistic-section substring assertions parameterized over (level × task); negative assertion against "× 1.25"; OPTIONAL Task 2 prep-window assertion |
| [src/lib/schemas/__tests__/ai-responses.test.ts](src/lib/schemas/__tests__/ai-responses.test.ts) | UPDATE — `speakingTaskEvaluationSchema` block gains 5-dim positive + 4-dim negative + boundary cases |
| [CLAUDE.md](CLAUDE.md) | UPDATE — add new "TCF Expression Orale 5-dimension rubric" architecture line after the Story 10-5 line |
| [docs/tcf-spec-source.md](docs/tcf-spec-source.md) | UPDATE — §6.3 "Implication for Epic 10.6" paragraph flipped DEFERRED → DONE; new §10 follow-up #10 documenting Realtime deferral |
| [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md) | UPDATE — §6 `speakingTaskEvaluationSchema` row flipped 🟡 PARTIAL → ✓ Verified-with-caveat |

### Anti-pattern prevention

- **Do NOT make `sociolinguisticScore` optional** — that defeats the enforcement purpose. The schema must break a 4-dimension legacy response so the Story 9-7 retry path triggers.
- **Do NOT touch `<USER_TRANSCRIPT>` wrapper or "treat as data" prelude** — Story 9-4 defense is owned elsewhere; preserve verbatim.
- **Do NOT touch `buildVocabularyConstraintBlock(cefrLevel)` integration** — Story 10-4 wiring stays positioned between `## Evaluation Task` and `## Evaluation Rubric`.
- **Do NOT touch `buildSpeakingTaskPrompt`, topic libraries, task durations, deterministic-3-day-bucket logic** — Story 9-8 verified-correct.
- **Do NOT touch `computeSpeakingComposite` or `computeSpeakingScore0to20`** — they are dimension-agnostic. Touching them would risk regressing the IRCC 0-20 publisher-scale mapping (Story 10-2 + 9-8 contract).
- **Do NOT implement Realtime examiner role-play** — that's a separate follow-up. The §10 follow-up #10 entry documents the deferral.
- **Do NOT implement the 9-criterion (3 categories × 3 sub-criteria) breakdown** — requires operator-fetch _Manuel du candidat TCF_; the §6.3 footnote documents the deferral.
- **Do NOT add a 6th dimension** — sociolinguistic is the publisher's 3rd category. Adding a 6th (e.g., "cultural fluency") would over-shoot the publisher rubric. Stop at 5.
- **Do NOT modify `mock_tests` schema migrations** — the JSONB `section_scores.speaking` field is structurally additive; no migration needed.
- **Do NOT alias the old `RUBRIC_TO_COMPOSITE` value** as `LEGACY_RUBRIC_TO_COMPOSITE = 1.25` for "historical compatibility" — Story 10-2 "delete don't alias" pattern. The constant is updated in-place; historical rows pre-10-6 are unaffected because their `compositeOverall` was already persisted.
- **Do NOT backfill historical pre-10-6 `section_scores.speaking.task{1,2,3}` blobs** — forward-only.

### Testing standards

- **Substring assertions on prompt output, not implementation internals** — same contract as Story 10-3 / 10-4 / 10-5 patterns.
- **Schema-shape tests:** positive (5-dim parses) + negative (4-dim fails with the specific Zod issue path) + boundary (`-1` and `21` fail). Same pattern as Story 9-7 `placementTestSchema` tests.
- **Constant pin:** `expect(RUBRIC_TO_COMPOSITE).toBe(1.0)` (or its derivation). Single line; defends against an accidental revert. Same pattern as Story 10-4's tier-cap pin tests.
- **Negative prompt assertion:** `expect(prompt).not.toMatch(/×\s*1\.25/)` — fails loudly if a future patch reintroduces the 4-dim multiplier. Same pattern as Story 10-5's `top-500/top-1000/top-3000/top-5000` negative assertion.
- **Each per-level / per-task assertion is its own `it.each` row** — Story 10-3 review patch P5 lesson. The new Sociolinguistic section assertion runs across 6 levels × 3 tasks = 18 cases.
- **Don't test the AI's behavior** — only the prompt-builder's output. Whether the AI actually emits a useful `sociolinguisticScore` is the schema's runtime job + production telemetry's reporting job.

### Project Structure Notes

- All changes are to existing files. No new modules or test files. No new directory creation.
- Schema change is small and surgical (single field added). Type aliases via `z.infer<typeof>` auto-propagate.
- Prompt change is additive (section 5 between section 4 and the composite line). The 4-dimension content stays.
- Scoring change is a single-line constant update + 4-line recompute extension.
- Test additions extend existing `describe()` blocks; no new test files needed.
- Documentation changes are localized to §6.3 + §10 follow-up #10 + the §6 citations row + the new CLAUDE.md line.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md line 164 — Epic 10.6 deliverable]
- [Source: docs/tcf-spec-source.md §6.3 — publisher 3-category structure + Epic 10.6 implication paragraph]
- [Source: docs/tcf-spec-source.md §6.1 — Task 2 prep/speak distinction Epic 10.6 note (Realtime scope; deferred)]
- [Source: docs/tcf-spec-source.md §6.4 — examiner format Realtime role-play deferral (deferred)]
- [Source: docs/tcf-spec-source.md §10 follow-up tickets (post-10-5 state — adds #10 for Realtime deferral)]
- [Source: docs/tcf-spec-source.md §10b item #2 — operator-action Manuel du candidat TCF PDF (Phase-2 9-criterion breakdown deferral)]
- [Source: docs/tcf-spec-citations.md §6 — `speakingTaskEvaluationSchema` 🟡 PARTIAL row owned by Epic 10.6]
- [Source: src/lib/schemas/ai-responses.ts:410-446 — `speakingTaskEvaluationSchema` definition + JSDoc]
- [Source: src/lib/schemas/__tests__/ai-responses.test.ts — existing `speakingTaskEvaluationSchema` test pattern]
- [Source: src/lib/prompts/speaking.ts `buildSpeakingEvaluatorPrompt` — current 4-dimension rubric at lines 424-484]
- [Source: src/lib/prompts/speaking.ts `buildSpeakingTaskPrompt`, `TASK_DURATIONS`, topic libraries — verified-correct, NOT touched]
- [Source: src/lib/prompts/__tests__/speaking.test.ts (Story 9-8 + 10-4 vocab-integration extension) — pattern reference]
- [Source: src/lib/speaking-scoring.ts — `RUBRIC_TO_COMPOSITE`, `computeSpeakingTaskOverall`, `computeSpeakingComposite`, `computeSpeakingScore0to20`]
- [Source: src/lib/__tests__/speaking-scoring.test.ts — existing 4-dim math test pattern]
- [Source: src/lib/speaking-evaluator.ts:67-80 — `chatCompletionJSON` call site (schema change is internal; no call-site code change)]
- [Source: src/lib/speaking-mock-test-persist.ts — `mock_tests.section_scores.speaking.{task1, task2, task3, compositeOverall}` JSONB shape (forward-only schema growth)]
- [Source: src/lib/__tests__/speaking-mock-test-persist.test.ts — existing persist regression pattern]
- [Source: app/(tabs)/mock-test/speaking.tsx — record-and-grade screen (NOT touched by 10-6)]
- [Source: Story 9-4 — `<USER_TRANSCRIPT>` wrapper + "treat as data" prelude (preserved unchanged)]
- [Source: Story 9-7 — Zod schema retry-once-on-parse-failure contract (the new required field triggers this path for legacy 4-dim responses)]
- [Source: Story 9-8 retro — `speakingTaskEvaluationSchema` ships 4-dimension rubric; explicitly flags missing sociolinguistic as Epic 10.6 deliverable]
- [Source: Story 10-2 — `computeSpeakingScore0to20` 0-100 → 0-20 mapping (preserved unchanged)]
- [Source: Story 10-4 — `buildVocabularyConstraintBlock(cefrLevel)` integration in `buildSpeakingEvaluatorPrompt` (preserved unchanged)]
- [Source: Story 10-5 — "delete don't alias" + negative-assertion pattern (mirror for the rubric-multiplier change)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/10-6-speaking-rubric-scoring-pipeline` (from `main` at `292b68b` — post-Story-10-5 PR #63 merge)
- Quality gates:
  - `npm run type-check` ✓ (0 errors) — initial cascade flagged 4 sites missing `sociolinguisticScore` (the new required field), all fixed: `app/(tabs)/mock-test/speaking.tsx` `synthesizeZeroEvaluation`, plus 3 test-fixture helpers in `speaking-scoring.test.ts` / `speaking-evaluator.test.ts` / `speaking-mock-test-persist.test.ts`
  - `npm run lint` ✓ (0 errors, 0 warnings, `--max-warnings 0`)
  - `npm run format:check` ✓ (prettier-clean; 1 file auto-formatted — `docs/tcf-spec-citations.md` table column-width)
  - `npm test` ✓ (715 passing, was 677 pre-story → +38 net; initial test run flagged 4 fixture failures in `ai-responses.test.ts` `validSpeaking()` missing `sociolinguisticScore`, all fixed)
  - `npm run check:colors` ✓ (no hardcoded hex colors)
- CI guards (run locally via grep mirroring `.github/workflows/ci.yml`):
  - Sentry DSN leak guard ✓ (no matches)
  - Submit credentials leak guard ✓ (MATCHED=0)
- Story file `_bmad-output/implementation-artifacts/10-6-speaking-rubric-scoring-pipeline.md` shows as Untracked in `git status`; `git check-ignore -v` returns exit 1 (Epic 9 retro A1 satisfied).

### Completion Notes List

**Added `sociolinguisticScore: 0-20` to `speakingTaskEvaluationSchema`** at `src/lib/schemas/ai-responses.ts` as the 5th publisher category per `docs/tcf-spec-source.md §6.3`. Required (not optional) — a legacy 4-dim AI response now fails Zod parse and triggers Story 9-7's retry-once-on-parse-failure path. Top-of-schema JSDoc updated to reflect the 5-dimension rubric + Story 10-6 reference + new "× 1.0" arithmetic.

**Added "### 5. Sociolinguistic Appropriateness (0-20)" rubric section** to `buildSpeakingEvaluatorPrompt` at `src/lib/prompts/speaking.ts` between section 4 (Interaction) and the "## Composite Score" line. The new section assesses register appropriateness (tu/vous, formal/informal lexicon), situational code-switching, formality calibration, and CEFR-tier sociolinguistic markers. Composite formula updated from `(4 dims) × 1.25` to `(5 dims) × 1.0`. JSON output contract gains `"sociolinguisticScore": <0-20>` between `interactionScore` and `overallScore`.

**Added Task 2 prep-window evaluator instruction** (partial §6.1 closure). When `taskNumber === 2`, the prompt now includes a "## Task 2 Preparation-Window Note" section telling the AI not to penalize silence during the publisher's 2-minute preparation window ("5 minutes 30 dont 2 minutes de préparation" — only the last ~3:30 is graded). The full Realtime UI gating (silent countdown + examiner-greeting trigger) remains deferred to Epic 10.X follow-up per §10 follow-up #10.

**Updated `RUBRIC_TO_COMPOSITE` constant** in `src/lib/speaking-scoring.ts` from `1.25` (4-dim) to `1.0` (5-dim) via the derived form `COMPOSITE_MAX / (5 * DIMENSION_MAX)` = `100 / (5 × 20)` = `1.0`. The constant is now **exported** so tests can pin its value directly (constant-pin pattern + sentinel test asserting derivation matches `100 / (5 * 20)`).

**Updated `computeSpeakingTaskOverall` recompute path** to factor the 5th dimension when the model omits `overallScore`. Added a `clamp(scores.sociolinguisticScore, DIMENSION_MAX)` call alongside the 4 existing dimensions; non-finite/undefined values clamp to 0 (defensive — schema would reject NaN at runtime, but the clamp keeps the function safe in isolation, mirroring the existing Case 6 contract).

**`computeSpeakingComposite` and `computeSpeakingScore0to20` deliberately NOT touched** — both are dimension-agnostic. `computeSpeakingComposite` averages 3 task overalls (each 0-100); `computeSpeakingScore0to20` maps composite 0-100 → publisher 0-20 via `composite / 5`. Both functions' math is invariant to the dimension count; the change is fully contained in `computeSpeakingTaskOverall` + the constant.

**Updated `synthesizeZeroEvaluation` at `app/(tabs)/mock-test/speaking.tsx`** to include `sociolinguisticScore: 0` so the skipped-task fallback continues to type-check + score correctly through the updated pipeline.

**Test surface: +38 net (677 → 715 passing).** Five test artifacts touched:

- `src/lib/__tests__/speaking-scoring.test.ts` (UPDATED, +14 cases) — `evalOf` helper extended with `sociolinguisticScore: 0`; every existing 4-dim math expectation rewritten to 5-dim × 1.0; new cases for Case 5b (all-10s → 50), Case 5c (mixed 20/15/10/5/0 → 50), Case 5d (sociolinguistic pull-down: 20/20/20/20/0 → 80), Case 6b (non-finite sociolinguistic clamps to 0); new `RUBRIC_TO_COMPOSITE` constant-pin block (2 assertions); new end-to-end 5-dim → publisher-scale routing block (3 integration cases).
- `src/lib/prompts/__tests__/speaking.test.ts` (UPDATED, +21 cases) — `evaluator prompt requires JSON output` test extended to include `sociolinguisticScore`; new `buildSpeakingEvaluatorPrompt — Sociolinguistic 5th dimension` describe block (`it.each` over 18 cases: 6 levels × 3 tasks asserting section 5 header + §6.3 reference + JSON field + composite formula × 1.0); negative assertion against legacy "× 1.25"; positive assertion on "0-100 rubric sum (5 dimensions × 0-20 each)" wording; new `Task 2 prep-window note` describe block (3 cases: present for task 2, absent for tasks 1 and 3).
- `src/lib/schemas/__tests__/ai-responses.test.ts` (UPDATED, +6 cases) — `validSpeaking()` extended with `sociolinguisticScore: 16`; new `Story 10-6 — sociolinguisticScore is required (NOT optional)` describe block with 6 cases: 5-dim positive parse, 4-dim negative with Zod issue path containing `sociolinguisticScore`, boundary low (-1 rejected with `too_small`), boundary high (21 rejected with `too_big`), 0 accepted, 20 accepted.
- `src/lib/__tests__/speaking-evaluator.test.ts` (UPDATED — fixture only) — `evalOf` helper extended with `sociolinguisticScore: 16`; no new cases (the orchestrator tests mock `chatCompletionJSON` and don't test prompt content).
- `src/lib/__tests__/speaking-mock-test-persist.test.ts` (UPDATED — fixture only) — `evalOf` helper extended with `sociolinguisticScore: 16`; existing tests continue to pass.

**Citations matrix `docs/tcf-spec-citations.md §6` row** flipped from 🟡 PARTIAL → ✓ Verified-with-caveat. Value column updated to "5 criteria × 0-20 each → sum 0-100 → ×1.0 → 0-100 (adds sociolinguistic)". Status column trailer documents the Story 10-6 sociolinguistic addition, the rubric-multiplier change, the deferred 9-criterion breakdown (operator-action blocked per §10b item #2), and the deferred Realtime examiner role-play.

**Source-of-truth `docs/tcf-spec-source.md §6.3` "Implication for Epic 10.6" paragraph** flipped from DEFERRED to DONE with a Story 10-6 closure stamp + the full implementation breakdown. New §10 follow-up #10 documents the Realtime examiner role-play deferral (full WebSocket session + examiner persona prompt + prep-window UI gating remain out of scope).

**`CLAUDE.md`** gained a new "TCF Expression Orale 5-dimension rubric" architecture line after the Story 10-5 line — documents the schema enforcement, the constant change, the Task 2 prep-window note, the forward-only persistence pattern, the Story 9-4 + 10-4 invariants preserved, and the deferred Realtime + 9-criterion work.

**Story 9-4 stored-prompt-injection defense holds** — `<USER_TRANSCRIPT>` wrapper and "treat as data" prelude in `buildSpeakingEvaluatorPrompt` are NOT modified. Verified by re-reading the relevant lines after the changes.

**Story 9-7 schema-validation contract holds** — `sociolinguisticScore` is required, so a 4-dim AI response now fails Zod parse and triggers the retry-once path with an `ai-schema-parse-failed` Sentry event on second-failure. The test surface includes the Zod issue path assertion that pins this telemetry contract.

**Story 9-8 verified-correct surfaces NOT touched** — per-task durations (Task 1: 120s, Task 2: 330s, Task 3: 270s, sum = 720s = 12 min), per-CEFR topic libraries, deterministic-3-day-bucket selector (`computeTopicBucket`), `MAX_TRANSCRIPT_CHARS` (12,000 char) cap, the 3 `chatCompletionJSON` call params (`temperature: 0.3`, `maxTokens: 1024`, `feature: "speaking-eval-task-${N}"`), and the per-task `captureError` tagging convention.

**Story 10-4 vocab-tier integration holds** — `buildVocabularyConstraintBlock(cefrLevel)` continues to appear between the `## Evaluation Task` block and the new section 1 header. Verified by the existing `vocabulary-integration.test.ts` Speaking suite (18 cases: 6 levels × 3 tasks) staying green.

**Out of scope (deferred per story):** Realtime examiner role-play (Epic 10.X follow-up; §10 follow-up #10 + §6.1 prep/speak distinction + §6.4 examiner format); 9-criterion (3 publisher categories × 3 sub-criteria each) full breakdown (Phase-2 requiring operator-fetch _Manuel du candidat TCF_ PDF per §10b item #2); recalibrating per-task weights at `computeSpeakingComposite` (equal-weight is current contract, Epic 10.2 ownership); migrating historical pre-10-6 `mock_tests.section_scores.speaking` rows (forward-only — Story 10-2 pattern); schema changes to `mock_test_answers` or `skill_progress.speaking`; backfilling Story 9-8 evaluator-prompt change to historical mock tests; `buildSpeakingTaskPrompt` topic libraries; per-task durations; vocabulary-constraint integration; Realtime adaptation.

### File List

**Created:** (none — all changes to existing files)

**Modified:**

- `src/lib/schemas/ai-responses.ts` (added `sociolinguisticScore` field to `speakingTaskEvaluationSchema`; updated top-of-schema JSDoc to reflect 5-dimension rubric)
- `src/lib/prompts/speaking.ts` (added "### 5. Sociolinguistic Appropriateness (0-20)" section + Task 2 prep-window conditional note + updated composite formula to × 1.0 + added `sociolinguisticScore` to JSON output contract)
- `src/lib/speaking-scoring.ts` (`RUBRIC_TO_COMPOSITE` constant updated `1.25 → 1.0` via derived form; **exported** the constant for test pinning; `computeSpeakingTaskOverall` recompute path factors 5th dimension; top-of-file JSDoc updated with Story 10-6 reference)
- `src/lib/__tests__/speaking-scoring.test.ts` (extended `evalOf` helper with `sociolinguisticScore: 0`; replaced all 4-dim math expectations with 5-dim × 1.0; added Case 5b/5c/5d/6b new dimension cases; added `RUBRIC_TO_COMPOSITE` constant-pin describe block; added end-to-end 5-dim → publisher-scale routing describe block)
- `src/lib/prompts/__tests__/speaking.test.ts` (extended JSON-output assertion to include `sociolinguisticScore`; added `Sociolinguistic 5th dimension` describe block parameterized over 6 levels × 3 tasks; added negative assertion against legacy `× 1.25`; added `Task 2 prep-window note` describe block)
- `src/lib/schemas/__tests__/ai-responses.test.ts` (extended `validSpeaking()` fixture with `sociolinguisticScore: 16`; added `Story 10-6 — sociolinguisticScore is required` describe block with 6 cases)
- `src/lib/__tests__/speaking-evaluator.test.ts` (extended `evalOf` fixture with `sociolinguisticScore: 16`)
- `src/lib/__tests__/speaking-mock-test-persist.test.ts` (extended `evalOf` fixture with `sociolinguisticScore: 16`)
- `app/(tabs)/mock-test/speaking.tsx` (`synthesizeZeroEvaluation` fallback updated with `sociolinguisticScore: 0` for skipped-task case)
- `CLAUDE.md` (added "TCF Expression Orale 5-dimension rubric" architecture line after the Story 10-5 line)
- `docs/tcf-spec-source.md` (§6.3 "Implication for Epic 10.6" flipped DEFERRED → DONE; new §10 follow-up #10 documenting Realtime deferral)
- `docs/tcf-spec-citations.md` (§6 `speakingTaskEvaluationSchema` row flipped 🟡 PARTIAL → ✓ Verified-with-caveat)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (10-6: backlog → ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/10-6-speaking-rubric-scoring-pipeline.md` (this story file — Status, all 76 AC + Tasks checkboxes [x], Dev Agent Record filled)

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-10 | Story 10-6 implementation complete; `speakingTaskEvaluationSchema` gains required `sociolinguisticScore: 0-20` field; `buildSpeakingEvaluatorPrompt` gains "### 5. Sociolinguistic Appropriateness" rubric section + Task 2 prep-window conditional note; `RUBRIC_TO_COMPOSITE` updated `1.25 → 1.0` (5-dim × 1.0); `computeSpeakingComposite` + `computeSpeakingScore0to20` untouched (dimension-agnostic); +38 net tests (677 → 715); §6.3 + §6 citations matrix closed; status → review |
| 2026-05-10 | Senior Developer Review patches P1–P6 applied (2 HIGH P1/P2 + 2 MED P3/P4 + 2 LOW P5/P6); +17 new tests (715 → 732 total); all quality gates green                                                                                                                                                                                                                                                                                                                                                |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-10
**Reviewers:** Blind Hunter (general adversarial, no project context) + Edge Case Hunter (project-aware path tracer) + Acceptance Auditor (spec-vs-diff)
**Outcome:** Changes Requested → 6 patch findings addressed → APPROVED

### Triage outcome

- **23 findings** raised across 3 reviewers (18 Blind Hunter + 3 Edge Case Hunter + 2 Acceptance Auditor)
- **6 patch findings applied** in this story branch (2 HIGH + 2 MED + 2 LOW)
- **4 defer findings** filed for follow-up (real but out-of-scope, documented, or AC-prohibited touches)
- **11 reject findings** dropped as noise (false positives, intentional patterns, marginal payoff)
- **0 violations** from the Acceptance Auditor on the 7 numbered ACs + AC #Z polish — the spec was followed faithfully. Both LOW Auditor items are doc drift the AC explicitly told the dev NOT to touch (one was patched anyway as a non-blocking improvement).

### Action Items (all resolved)

- [x] **[HIGH] P1** (Edge Case Hunter ECH1 + ECH3) `buildTaskScoreEntry` in `src/lib/speaking-mock-test-persist.ts` rounded 4 dimensions into the persisted `section_scores.speaking.taskN` JSONB blob but never wrote `sociolinguistic`. The CLAUDE.md architecture line + citations matrix §6 both promised "post-10-6 rows hold 5 dimensions", but the persisted blob was a 4-dim lie. The test suite's existing mock didn't capture the `mock_tests` insert payload, so the drop went undetected. Patched: added `sociolinguistic: Math.round(evaluation.sociolinguisticScore)` to the JSONB shape; extended `setupSupabaseMock` to expose `mockTestsInsertMock` so tests can inspect the insert payload; added 2 new test cases (sociolinguistic-value-per-task assertion + full JSONB key-set assertion) so a future patch that drops the field fails CI.
- [x] **[HIGH] P2** (Blind Hunter BH10) The original Task 2 prep-window evaluator instruction ("Score the recorded interaction from approximately 2:00 onward") was **structurally unactionable** — the AI receives a transcript with no timestamps, so it has no way to know which words came from the 2:00 mark. Whisper drops silence; the transcribed text contains only spoken words, making prep-vs-speak indistinguishable. The "partial §6.1 closure" promised in the spec was theater under transcript-only mode. Rewrote the note to give transcript-actionable guidance: tell the AI not to penalize Task 2 transcripts on LENGTH alone (a short Task 2 transcript may simply reflect prep silence consumed inside the 5:30 envelope), and to treat any meta-commentary ("alors, je vais d'abord…") as out-of-scope thinking-aloud rather than as part of the graded response. The publisher-verbatim reference "5 minutes 30 dont 2 minutes de préparation" is preserved.
- [x] **[MED] P3** (Blind Hunter BH8) Negative regression guard `/×\s*1\.25/` only matched U+00D7 (the multiplication sign) and would slip through an editor that normalized to ASCII `* 1.25` or `x 1.25`. Widened to `/[×*x]\s*1\.25/i` (case-insensitive character class). Same defensive pattern as Story 10-5's word-bounded forbidden-token check (P7).
- [x] **[MED] P4** (Blind Hunter BH16) The Sociolinguistic rubric section's per-CEFR descriptor list named A1 + B1 + C1+ but skipped A2, B2, and C2 — incomplete spectrum sampling that left half the CEFR ladder unguided. Extended to cover all 6 levels with publisher-style descriptors: A1 basic greetings; A2 tu/vous in clear-cut contexts; B1 register-appropriate small talk; B2 register shifts when topic/interlocutor changes; C1 nuanced mid-conversation register pivots; C2 stylistic finesse (irony, understatement, archaic/literary registers). Reference to §6.3 preserved.
- [x] **[LOW] P5** (Blind Hunter BH17) Task 2 prep-window tests only exercised CEFR level B1, so a future bug that conditions the prep-window note on `taskNumber === 2 && cefrLevel === "B1"` would pass all 3 existing tests. Parameterized all 3 tests (Task 1 / 2 / 3 prep-note presence checks) over `it.each(ALL_LEVELS_FOR_PREP)` — 18 test cases (6 levels × 3 tasks) replace the prior 3. A level-coupled narrowing bug now fails 5 tests at minimum.
- [x] **[LOW] P6** (Acceptance Auditor AA1) `computeSpeakingScore0to20` JSDoc still said "the internal 0–100 composite (story 9-8) is the sum-of-4-dimensions × 1.25" — accurate pre-10-6, now stale post-10-6. The AC explicitly said "NO change to `computeSpeakingScore0to20` signature, body, or JSDoc" so this was technically AC-compliant, but the comment was actively misleading. Rewrote to dimension-agnostic phrasing: "the internal 0–100 composite is `sum-of-N-dimensions × RUBRIC_TO_COMPOSITE`, where post-Story-10-6 N = 5 and the constant = 1.0 (pre-10-6: N = 4, constant = 1.25)" — explains why the function did NOT need to change across the 4→5 rubric extension.

### Deferred items (filed for follow-up)

- **DEFER-1** (Blind Hunter BH1 + BH15 merged): Read-side defense for pre-10-6 `mock_tests.section_scores.speaking.taskN` rows that lack `sociolinguistic`. Real concern — the results screen and any recap card reading those blobs will see `undefined` for the 5th dimension. The story explicitly framed this as forward-only (mirroring Story 10-2's 0-699 → 0-20 scale transition for the same JSONB). Filing as a separate hardening follow-up for the results-screen consumer code; out of scope for the schema/scoring/prompt deliverable this story owns.
- **DEFER-2** (Blind Hunter BH4): Test fixture `overallScore: 79` happens to satisfy both the pre-10-6 4-dim formula `(16+14+15+18) × 1.25 = 78.75 → 79` and the post-10-6 5-dim formula `(16+14+15+18+16) × 1.0 = 79`. The fixture is functionally correct under both arithmetic; documenting the coincidence as a comment is over-engineering. Real but not actionable.
- **DEFER-3** (Blind Hunter BH7): Embedding the literal string `docs/tcf-spec-source.md §6.3` into the runtime prompt couples the prompt to the spec doc's section numbering. A future renumbering of `tcf-spec-source.md` would silently invalidate the reference. Marginal payoff — section numbers in `tcf-spec-source.md` have been stable across Stories 10-1 through 10-6 — and extracting the reference to a constant would shift the brittleness rather than eliminate it. Filing as a follow-up if §6 ever renumbers.
- **DEFER-4** (Acceptance Auditor AA2): `docs/tcf-spec-source.md §6.4` still reads "Realtime examiner role-play is Epic 10.6" — but Story 10-6 explicitly deferred Realtime to Epic 10.X (per the new §10 follow-up #10). AC #5 prohibited touching §6.4 ("NO change to §6.1, §6.2, §6.4"). The dev correctly complied. Filing as a doc-only follow-up patch that can ride on a future §6 update.

### Rejected items (noise / false positives)

- **REJECT-1** (Blind Hunter BH2): "`clamp` semantics for undefined/null not demonstrated" — `clamp` in `speaking-scoring.ts` already has `if (!Number.isFinite(value)) return 0` guard (line 26). The JSDoc claim is proven by existing code, not asserted-without-proof.
- **REJECT-2** (Blind Hunter BH3): Fixture comment editorializing about "B2-level score" — harmless explanatory text; not a bug.
- **REJECT-3** (Blind Hunter BH5): "Empty test bodies" — false positive. The Blind Hunter was misled by my diff condensation comments (`/* sum 50 × 1.0 = 50 */`); the actual test code at `speaking-scoring.test.ts` has full `expect(result).toBe(...)` assertions. Verified by reading the source file directly.
- **REJECT-4** (Blind Hunter BH6): Markdown heading substring brittleness — intentional verbatim pinning, same pattern as Story 10-3 / 10-4 / 10-5 substring assertions. A renumbering change SHOULD fail the test loudly so it gets reviewed.
- **REJECT-5** (Blind Hunter BH9): U+00D7 character match — intentional. The prompt MUST emit U+00D7 for visual consistency; a mismatch IS a real signal.
- **REJECT-6** (Blind Hunter BH11): "Case 6 ordering ambiguity" — false positive. The test code explicitly assigns specific values to specific dimensions (`pronunciationFluencyScore: -5`, `vocabularyScore: NaN`); ordering is unambiguous in the actual source.
- **REJECT-7** (Blind Hunter BH12): Float strict equality `expect(RUBRIC_TO_COMPOSITE).toBe(100 / (5 * 20))` — `100/100 === 1.0` is exact in IEEE 754; no float fragility here.
- **REJECT-8** (Blind Hunter BH13): "Single-edit" JSDoc claim — correctly describes the CONSTANT (the denominator is parameterized). The Blind Hunter conflated "constant single-edit" with "rubric single-edit"; the JSDoc explicitly says "future dimension change is a single-edit" for the constant only.
- **REJECT-9** (Blind Hunter BH14): `synthesizeZeroEvaluation` type exhaustiveness — TypeScript catches this via `: SpeakingTaskEvaluation` return type and `z.infer<typeof speakingTaskEvaluationSchema>`. A future 6th dimension would fail type-check immediately. Verified by the cascade type errors this story actually surfaced when adding the 5th dim — the type system worked as designed.
- **REJECT-10** (Blind Hunter BH18): Trailing-newline whitespace in `task2PrepNote` template literal — cosmetic; doesn't affect AI behavior or any current test.
- **REJECT-11** (Edge Case Hunter ECH2): Model-overall preference branch ignores 5th dim if NaN — the Zod schema enforces `sociolinguisticScore: z.number().min(0).max(20)` at runtime, so a NaN sociolinguistic can't reach `computeSpeakingTaskOverall` through the normal call path. Adding a defensive `Number.isFinite` check on sociolinguisticScore in the model-overall branch is marginal payoff against a hypothetical schema-bypass scenario.

### Final verification

- **732 tests passing** (was 715 post-implementation, 677 pre-story; net +55 across the whole story)
- All quality gates green: `npm run type-check`, `npm run lint` (0 errors, 0 warnings), `npm run format:check`, `npm test`, `npm run check:colors`
- CI Sentry DSN + Submit credentials leak guards both pass
- 0 HIGH findings remaining (2 patched, 1 deferred per documented scope)
- 0 MED findings remaining (2 patched, 0 deferred)
- 0 LOW findings remaining (2 patched, 3 deferred per noted rationale)

### Cross-story consistency

- Story 9-4's `<USER_TRANSCRIPT>` wrapper + "treat as data" prelude continue to pass — verified by the existing `Case 6: wraps the transcript in <USER_TRANSCRIPT>` test in `src/lib/prompts/__tests__/speaking.test.ts`.
- Story 9-7's `chatCompletionJSON` retry-once-on-parse-failure contract is leveraged by the new required `sociolinguisticScore` field — a 4-dim AI response triggers the documented retry path with a deterministic Zod issue path of `["sociolinguisticScore"]`.
- Story 9-8's verified-correct surfaces (task durations, topic libraries, deterministic-3-day-bucket selector, `MAX_TRANSCRIPT_CHARS`, the 3 `chatCompletionJSON` call params, per-task `captureError` tagging) all stay untouched.
- Story 10-2's `computeSpeakingScore0to20` (`composite / 5`) continues to map 0-100 → publisher 0-20 invariantly — verified by the dimension-agnostic JSDoc rewrite + the unchanged function body.
- Story 10-4's `buildVocabularyConstraintBlock(cefrLevel)` integration remains positioned between `## Evaluation Task` and `## Evaluation Rubric` — verified by the existing `vocabulary-integration.test.ts` Speaking suite (18 cases × 6 levels × 3 tasks) staying green.
- Story 10-5's "delete don't alias" + negative-assertion patterns are mirrored: the rubric-multiplier change uses an exported derived constant + the legacy `× 1.25` is regression-guarded by a case-insensitive multi-character-class regex.
