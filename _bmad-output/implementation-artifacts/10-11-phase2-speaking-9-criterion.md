# Story 10.11: Phase-2 Speaking Rubric — Replace 5-Dimension Proxy with Full 9-Criterion Publisher Breakdown

Status: backlog

**Phase-2 follow-up story. ARTIFACT-BLOCKED.** Filed by Epic 10 retrospective (`epic-10-retro-2026-05-10.md` action item B7). Closes `docs/tcf-spec-source.md §6.3` Phase-2 commitment + `§10b item #2` operator-action. This story **cannot start** until the operator downloads the _Manuel du candidat TCF_ PDF from france-education-international.fr (free download, but requires manual operator action — Story 10-1 documented that WebFetch did not return the PDF content reliably).

---

## Story

As a TCF Canada candidate whose Expression Orale evaluation today uses Story 10-6's **5-dimension proxy rubric** at [`src/lib/schemas/ai-responses.ts`](src/lib/schemas/ai-responses.ts) `speakingTaskEvaluationSchema` (`pronunciationFluencyScore` / `vocabularyScore` / `grammarScore` / `interactionScore` / `sociolinguisticScore` — each 0-20, summed × 1.0 → 0-100) which faithfully covers the publisher's 3 named criterion categories at [`docs/tcf-spec-source.md §6.3`](docs/tcf-spec-source.md) (Linguistique + Pragmatique + Sociolinguistique) — but the same §6.3 explicitly notes: "The full 9-criterion (3 publisher categories × 3 sub-criteria each) breakdown remains **DEFERRED** to a Phase-2 follow-up requiring the operator-fetch _Manuel du candidat TCF_ PDF (§10b item #2 operator-action)" — meaning the current 5-dim rubric is a *category-level* proxy, not the *sub-criterion-level* rubric the publisher actually publishes for examiner training,

I want `speakingTaskEvaluationSchema` extended to **9 sub-criterion dimensions** (3 categories × 3 sub-criteria each) sourced from the _Manuel du candidat TCF_ PDF — specifically: **Linguistique** (étendue / maîtrise du lexique, correction grammaticale, aisance + prononciation + fluidité globale du discours = 3 sub-criteria); **Pragmatique** (interaction, structuration du discours, cohérence + cohésion + développement thématique = 3 sub-criteria); **Sociolinguistique** (adéquation à la situation de communication = the publisher's text suggests 1 broad criterion but the Manuel likely decomposes this into 3 finer sub-criteria — operator must confirm at PDF acquisition) — with each sub-criterion scored 0-20, summed × `RUBRIC_TO_COMPOSITE = 100 / (9 × 20) = 0.555...` → 0-100, AND with `buildSpeakingEvaluatorPrompt` at [`src/lib/prompts/speaking.ts`](src/lib/prompts/speaking.ts) extended to a 9-section rubric body (one section per sub-criterion) keyed off the Manuel's exact descriptors per sub-criterion (operator-transcribed from the PDF), AND with the existing Story 10-6 architecture preserved (`computeSpeakingTaskOverall` recompute path, `computeSpeakingComposite` 3-task average, `computeSpeakingScore0to20` IRCC-publisher-scale mapping all dimension-agnostic and continue to work — only the `RUBRIC_TO_COMPOSITE` constant + the schema field count change),

so that **the §6.3 Phase-2 commitment closes**; `docs/tcf-spec-citations.md §6` row "`speakingTaskEvaluationSchema`" flips from ✓ Verified-with-caveat (5-dim proxy) to ✓ Verified-publisher-grade (9-criterion); `docs/tcf-spec-source.md §10 follow-up #4` ("Add Speaking pipeline to mock test" — full 9-criterion sub-row) flips DONE; `docs/tcf-spec-source.md §10b item #2` (operator-action Manuel PDF) flips DONE. Story 10-6's `sociolinguisticScore` becomes one of the 3 Sociolinguistique sub-criteria + 2 new fields; Stories 9-7's retry-once-on-Zod-parse-failure path catches any AI response that omits a sub-criterion (loud Sentry breadcrumb on second failure); Stories 9-8's per-task durations + topic libraries + 3-day-bucket selector + `<USER_TRANSCRIPT>` wrapping all hold byte-identical (verified by `speaking.test.ts` + `speaking-evaluator.test.ts` + `speaking-mock-test-persist.test.ts` staying green with fixture updates for the 9-field shape). The transition is **forward-only at the persistence layer** — pre-10-11 `mock_tests.section_scores.speaking.task{1,2,3}` JSONB rows hold 5 dimensions; post-10-11 hold 9; `getSeenHashes`-style consumers (Story 10-8) are unaffected because the `question_stem_hashes` column is shape-independent.

## Operator-Action Blockers

**The operator MUST download the _Manuel du candidat TCF_ PDF (FR or EN) from france-education-international.fr before this story can be promoted to `ready-for-dev`.**

| Artifact | Size | Source | Required for |
| -------- | ---- | ------ | ------------ |
| _Manuel du candidat TCF_ (FR or EN) | ~2.97 MB (FR) / ~2.86 MB (EN) | https://www.france-education-international.fr/sites/default/files/...tcf...manuel-du-candidat.pdf — the publisher landing page has the canonical link | All 9 sub-criterion descriptors + per-criterion 0-6 / 0-4 scoring scales (per §5.4 reference) |

**Where to acquire (operator-action options):**

1. **France Éducation International landing page** — https://www.france-education-international.fr/test/tcf-canada — navigate to "Documents à télécharger" section, find "Manuel du candidat" link. The PDF is free; download requires only manual browser interaction (WebFetch from this app's environment did not return the PDF content reliably per Story 10-1; manual operator browser download is the canonical path).
2. **EN-language version** (~2.86 MB) at the same page — may be easier to transcribe sub-criterion descriptors verbatim if the operator prefers English source text. Note: §6.3 publisher categorization is FR-canonical; if the EN version's wording differs from FR, FR takes precedence.

**After acquisition, operator must:**

1. **Save the PDF** at `docs/tcf-canada-snapshots/manuel-candidat-tcf-FR-YYYY-MM-DD.pdf` (or `-EN-YYYY-MM-DD.pdf` for the English version).
2. **Compute SHA-256** of the PDF file + record in a companion `docs/tcf-canada-snapshots/manuel-candidat-tcf-YYYY-MM-DD.md` snapshot frontmatter (mirrors Story 10-1's snapshot-with-integrity-header pattern).
3. **Extract the 9 sub-criterion descriptors** from the Manuel's Expression Orale evaluation section. Transcribe each verbatim into the same snapshot markdown file under three sub-sections (Linguistique sub-criteria 1/2/3, Pragmatique 1/2/3, Sociolinguistique 1/2/3). Note any sub-criterion that the Manuel decomposes differently than the §6.3 categorization predicts (Sociolinguistique especially may turn out to be 1-2 sub-criteria rather than 3 — operator confirms at extraction time).
4. **Identify the per-sub-criterion 0-20 scoring scale** — the Manuel publishes a 0-6 scale for Expression Écrite per-criterion (§5.4) and the Expression Orale section may use a similar reduced scale that's then renormalized to 0-20. Operator confirms at extraction time.
5. **Add the snapshot SHA-256 integrity row to `docs/tcf-spec-citations.md`** (Story 10-1 pattern).
6. **Promote story 10-11 to `ready-for-dev`** once snapshot is committed.

**Operator-action checklist:**

- [ ] Download _Manuel du candidat TCF_ PDF from FEI landing page (FR canonical)
- [ ] Save at `docs/tcf-canada-snapshots/manuel-candidat-tcf-FR-YYYY-MM-DD.pdf`
- [ ] Compute SHA-256 + record in snapshot frontmatter
- [ ] Locate Expression Orale evaluation rubric section in the PDF
- [ ] Transcribe 9 sub-criterion descriptors (or whatever count the PDF actually publishes) verbatim into companion markdown
- [ ] Confirm per-sub-criterion scoring scale (0-6 vs 0-20 vs other; renormalize if needed)
- [ ] Flag any divergence from §6.3 categorization prediction (especially Sociolinguistique sub-criterion count)
- [ ] Commit snapshot + integrity row
- [ ] Promote story 10-11 to `ready-for-dev`

## Background — Why This Story Exists

### Phase-1 (Story 10-6) vs Phase-2 (this story) distinction

Story 10-6 (2026-05-10, PR #64) shipped the 5-dimension proxy rubric: pronunciation/fluency + vocabulary + grammar + interaction + sociolinguistic. This faithfully covers the publisher's 3 named CATEGORIES (Linguistique + Pragmatique + Sociolinguistique) but at the category-level granularity. The publisher's actual sub-criterion-level rubric (used by FEI's examiner training) is published only in the _Manuel du candidat TCF_ PDF — which Story 10-1 noted requires manual operator-action download.

§6.3's verbatim note:

> The full 9-criterion (3 publisher categories × 3 sub-criteria each) breakdown remains **DEFERRED** to a Phase-2 follow-up requiring the operator-fetch _Manuel du candidat TCF_ PDF (§10b item #2 operator-action).

### Why the 9-criterion breakdown matters for prep fidelity

A candidate practicing against the 5-dim proxy can score 16/20 on `pronunciationFluencyScore` without distinguishing "fluidité globale du discours" (overall fluency) from "prononciation des phonèmes" (phoneme accuracy) — yet the real examiner scores these independently. A user who has poor segmental phoneme accuracy but compensates with high fluidity could be over-rated by the proxy. The 9-criterion breakdown closes this gap.

### What is NOT changing

- **Story 9-8 record-and-grade flow** — `app/(tabs)/mock-test/speaking.tsx` is unchanged (or 10-9's `speaking-roleplay.tsx` if that's already landed). Only the per-task evaluator schema + prompt change.
- **Per-task durations + topic libraries + 3-day-bucket selector** — Story 9-8 verified-correct, NOT touched.
- **`computeSpeakingComposite` (3-task average) and `computeSpeakingScore0to20` (IRCC publisher-scale mapping)** — both dimension-agnostic; Story 10-6 verified they don't care about the dimension count, only the 0-100 composite range. NOT touched.
- **Story 9-4 prompt-injection defense** — `<USER_TRANSCRIPT>` wrapper + "treat as data" prelude — unchanged.
- **Story 9-7 schema-validation retry** — unchanged; the 9-field schema simply has 4 more required fields than the 5-field schema.

## Acceptance Criteria (sketch — to be expanded when story is promoted to `ready-for-dev`)

### 1. Manuel PDF snapshot committed (operator-action prerequisite)

- [ ] `docs/tcf-canada-snapshots/manuel-candidat-tcf-FR-YYYY-MM-DD.pdf` committed (binary).
- [ ] `docs/tcf-canada-snapshots/manuel-candidat-tcf-YYYY-MM-DD.md` companion markdown with frontmatter `pdf_sha256` + verbatim sub-criterion transcriptions.
- [ ] If the actual sub-criterion count differs from 9 (e.g., publisher publishes 7 or 11), this story's scope adjusts to match — the AC title's "9-criterion" is the §6.3 prediction, not a hard constraint.

### 2. `speakingTaskEvaluationSchema` extended to publisher-grade sub-criteria

- [ ] Schema fields:
  ```typescript
  export const speakingTaskEvaluationSchema = z.object({
    // Linguistique category (3 sub-criteria)
    lexicalRangeScore: z.number().min(0).max(20),         // étendue / maîtrise du lexique
    grammaticalCorrectnessScore: z.number().min(0).max(20), // correction grammaticale
    fluencyPronunciationScore: z.number().min(0).max(20),    // aisance + prononciation + fluidité globale
    // Pragmatique category (3 sub-criteria)
    interactionScore: z.number().min(0).max(20),           // interaction (kept from Story 10-6 name for migration ease)
    discourseStructureScore: z.number().min(0).max(20),    // structuration du discours
    coherenceCohesionScore: z.number().min(0).max(20),     // cohérence + cohésion + développement thématique
    // Sociolinguistique category (operator-confirmed count from Manuel)
    sociolinguisticRegisterScore: z.number().min(0).max(20),
    sociolinguisticAdaptationScore: z.number().min(0).max(20),
    sociolinguisticPolitenessScore: z.number().min(0).max(20),
    // Same trailing fields as Story 10-6
    overallScore: z.number().min(0).max(100).nullable().optional(),
    estimatedCEFR: cefrLevelSchema.optional(),
    strengths: z.array(z.string().min(1)).min(1).max(5),
    improvements: z.array(z.string().min(1)).min(1).max(5),
    corrections: z.string().max(2000).optional(),
  });
  ```
  **The field names + count above are predictions** — the actual schema will be operator-extracted from the Manuel PDF and may differ.
- [ ] **Required, NOT optional** for all 9 sub-criteria — Story 9-7 retry-once-on-parse-failure path triggers for any AI response missing a field.
- [ ] **Story 10-6 `sociolinguisticScore`** becomes one of the 3 Sociolinguistique sub-criteria (or absorbed into a single field if Manuel publishes 1 sub-criterion, not 3).

### 3. `computeSpeakingTaskOverall` updated for N-dimension support

- [ ] `RUBRIC_TO_COMPOSITE` constant updated:
  ```typescript
  // Pre-10-11: 100 / (5 × 20) = 1.0  (Story 10-6)
  // Post-10-11: 100 / (N × 20)       (where N = actual sub-criterion count from Manuel; predicted 9 → 100/180 ≈ 0.555...)
  const RUBRIC_TO_COMPOSITE = COMPOSITE_MAX / (N * DIMENSION_MAX);
  ```
- [ ] Recompute path factors all N dimensions when model omits `overallScore`.
- [ ] **`computeSpeakingComposite` and `computeSpeakingScore0to20` NOT touched** — dimension-agnostic (Story 10-6 contract).
- [ ] **Sentinel test pin:** `expect(RUBRIC_TO_COMPOSITE).toBeCloseTo(N_inverse, 5)` (or exact value if integer-clean).

### 4. `buildSpeakingEvaluatorPrompt` extended to N-section rubric

- [ ] Each sub-criterion gets its own "### N. <Sub-criterion name> (0-20)" section in the rubric block.
- [ ] Section content sourced from the Manuel PDF (verbatim descriptors).
- [ ] JSON Response Format block at the bottom of the prompt lists all N `<criterion>Score` fields.
- [ ] Story 9-4 `<USER_TRANSCRIPT>` wrapper + "treat as data" prelude preserved (verified by re-reading the function post-edit).
- [ ] Story 10-4 `buildVocabularyConstraintBlock(cefrLevel)` integration preserved.
- [ ] Story 10-6 Task 2 prep-window instruction preserved.

### 5. Per-task call site (`src/lib/speaking-evaluator.ts:67-80`)

- [ ] **NO change to the call site** — `chatCompletionJSON(_, speakingTaskEvaluationSchema, _)` signature is shape-independent. The schema import is the only effective change at this surface.

### 6. Persistence (`src/lib/speaking-mock-test-persist.ts`)

- [ ] `mock_tests.section_scores.speaking.task{1,2,3}` JSONB blobs grow N fields per task (forward-only — same pattern Story 10-6 used for the 4-dim → 5-dim transition).
- [ ] **NO migration change** — JSONB shape is structurally additive.

### 7. Test surface

- [ ] **EXTEND** `src/lib/__tests__/speaking-scoring.test.ts` — `evalOf` helper gains the new sub-criterion fields; recompute math pinned at the new `RUBRIC_TO_COMPOSITE`; sentinel pin updated.
- [ ] **EXTEND** `src/lib/prompts/__tests__/speaking.test.ts` — Section 1..N substring assertions parameterized over 6 CEFR × 3 tasks; negative assertion against the pre-10-11 5-dim rubric headers; Task 2 prep-window note preserved.
- [ ] **EXTEND** `src/lib/schemas/__tests__/ai-responses.test.ts` — `speakingTaskEvaluationSchema` block gains N-dim positive parse + missing-field negative cases + boundary cases per new field.
- [ ] **EXTEND** `src/lib/__tests__/speaking-mock-test-persist.test.ts` — fixtures updated for the N-field shape.
- [ ] **TARGET TEST COUNT POST-STORY:** existing baseline + ~30 new cases (estimate: ~10 scoring + ~12 evaluator + ~5 schema + ~3 persist).

### 8. Docs

- [ ] `docs/tcf-spec-source.md §6.3` paragraph updated to "DONE — closed by Story 10-11 on [date]" with the Manuel snapshot file referenced.
- [ ] `docs/tcf-spec-source.md §10 follow-up #4` (Speaking pipeline mock-test wiring) sub-row "9-criterion breakdown" flips DONE.
- [ ] `docs/tcf-spec-source.md §10b item #2` (operator-action Manuel PDF) flips DONE.
- [ ] `docs/tcf-spec-citations.md §6` row updated — `speakingTaskEvaluationSchema` value changes from "5 criteria × 0-20 each → sum 0-100 → ×1.0" to "N criteria × 0-20 each → sum 0-(N×20) → ×(100/(N×20))"; status flips ✓ Verified-with-caveat → ✓ Verified-publisher-grade.
- [ ] `CLAUDE.md` gains a new "TCF Expression Orale Phase-2 N-criterion publisher-verbatim rubric" architecture line after the most recent chronological line at the time of merge.

## Out of Scope (deferred elsewhere)

- **Realtime examiner role-play** — Story 10-9. Story 10-11 changes only the evaluator schema + prompt; the recording flow (Story 9-8 record-and-grade OR Story 10-9 Realtime role-play) is upstream.
- **Beacco vocab calibration** — Story 10-10. Vocabulary tier system continues to feed `buildSpeakingEvaluatorPrompt` via Story 10-4's wiring; Phase-1 → Phase-2 vocab transition is independent of this story.
- **Phase-2 0-6 per-criterion scale renormalization** — if the Manuel publishes 0-6 per-criterion rather than 0-20, the schema field type stays `z.number().min(0).max(20)` and the renormalization happens at evaluation time (operator-confirmed at PDF extraction; documented in the Manuel snapshot frontmatter).
- **Expression Écrite 9-criterion rubric** — §5.4 reference. The Writing pipeline currently uses Story 10-3's 4-dimension rubric; a parallel Phase-2 follow-up for Writing is implicit but not part of this story (would be Story 10-12 or later).
- **Backfilling pre-10-11 `mock_tests.section_scores.speaking.task{1,2,3}` rows** — forward-only (Story 10-6 + 10-8 pattern).

## Dependencies

- **Story 9-7** (Zod schema retry-once-on-parse-failure) — required, verified stable. The N-field schema is strictly larger than the 5-field schema; retry path absorbs the failure mode unchanged.
- **Story 9-8** (record-and-grade pipeline + per-task durations + topic libraries) — required, verified stable. Story 10-11 changes only what the evaluator scores, not what the user does during recording.
- **Story 10-6** (5-dim sociolinguistic rubric) — direct predecessor; Story 10-11 supersedes the schema field count while preserving the function-signature surface.
- **Story 10-9** (Realtime examiner role-play) — independent; either Story 10-9 OR Story 10-11 can land first. If 10-9 lands first, 10-9's `speaking-roleplay.tsx` consumes the 5-dim evaluator until 10-11 lands; transition is forward-only.
- **Operator-action artifact** (_Manuel du candidat TCF_ PDF) — REQUIRED before promotion to `ready-for-dev`. See Operator-Action Blockers section above.

## References

- [Source: docs/tcf-spec-source.md §6.3 — publisher 3-category structure + Phase-2 9-criterion deferral]
- [Source: docs/tcf-spec-source.md §10 follow-up #4 — Speaking pipeline in mock test, 9-criterion sub-row PARTIAL]
- [Source: docs/tcf-spec-source.md §10b item #2 — operator-action Manuel PDF download]
- [Source: docs/tcf-spec-citations.md §6 — `speakingTaskEvaluationSchema` row (currently ✓ Verified-with-caveat at 5-dim proxy)]
- [Source: src/lib/schemas/ai-responses.ts speakingTaskEvaluationSchema — Story 10-6 5-dim schema (target for extension)]
- [Source: src/lib/prompts/speaking.ts buildSpeakingEvaluatorPrompt — Story 10-6 5-section rubric (target for extension)]
- [Source: src/lib/speaking-scoring.ts RUBRIC_TO_COMPOSITE — Story 10-6 derived constant (target for re-derivation)]
- [Source: src/lib/__tests__/speaking-scoring.test.ts + speaking-evaluator.test.ts + speaking-mock-test-persist.test.ts — existing 5-dim test surface]
- [Source: epic-10-retro-2026-05-10.md action item B7]
- [Source: France Éducation International. _Manuel du candidat TCF_. Sèvres: FEI. (operator must download)]

## Dev Agent Record

_(To be filled when story is promoted to `ready-for-dev` and implementation begins. Operator action B7 must complete first — _Manuel du candidat TCF_ PDF + verbatim sub-criterion transcription required.)_
