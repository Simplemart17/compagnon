# TCF Spec Citations Matrix

Every TCF Canada-derived value in the codebase MUST appear in this matrix with a citation pointing at a section of [`docs/tcf-spec-source.md`](./tcf-spec-source.md). Pinned by [`src/lib/__tests__/tcf-spec.test.ts`](../src/lib/__tests__/tcf-spec.test.ts). Adding a new TCF claim in code without a row here fails CI.

## Status legend

- **✓ Verified** — code value matches the publisher; no action required.
- **✗ DELTA** — code value does not match the publisher; row names the owner Epic story for the fix.
- **🟡 GAP** — publisher has a value but the code has nothing yet; row names the owner Epic story.

---

## 1. Constants (`src/lib/constants.ts` `TCF` object)

| Code location                                   | Value      | tcf-spec-source.md anchor                                          | Status                                                                                                                                                                                                                                |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/constants.ts:15` `TCF.VARIANT`         | `"canada"` | §1 "Variant targeted by this app: TCF Canada"                      | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:16` `TCF.MIN_SCORE`       | 0          | §2.1 — listening/reading scale starts at 0 (CLB-relevant from 331) | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:17` `TCF.MAX_SCORE`       | 699        | §2.1 — listening/reading scale ends at 699                         | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:18` `TCF.C1_MIN`          | 500        | §2.3 — derived round-number CEFR band; not publisher-verbatim      | 🟡 INTENTIONAL — round-number 500 kept for UI "distance to C1" display; IRCC promotion math uses `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS` instead. Closed by Story 10-2 (this story); see JSDoc in `src/types/cefr.ts` `CEFR_LEVELS`. |
| `src/lib/constants.ts:19` `LISTENING_QUESTIONS` | 39         | §1 row "Compréhension orale" col "Questions"                       | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:20` `LISTENING_MINUTES`   | 35         | §1 row "Compréhension orale" col "Time"                            | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:21` `READING_QUESTIONS`   | 39         | §1 row "Compréhension écrite" col "Questions"                      | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:22` `READING_MINUTES`     | 60         | §1 row "Compréhension écrite" col "Time"                           | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:23` `WRITING_MINUTES`     | 60         | §1 row "Expression écrite" col "Time"                              | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |
| `src/lib/constants.ts:25` `SPEAKING_MINUTES`    | 12         | §1 row "Expression orale" col "Time" + §6.1                        | ✓ Verified 2026-05-10                                                                                                                                                                                                                 |

---

## 2. Scoring (`src/lib/scoring.ts`, `src/types/cefr.ts`)

| Code location                                                        | Value                                                                                 | tcf-spec-source.md anchor                            | Status                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/scoring.ts` `rawPercentToListeningReadingScore`             | 0–699 per-skill, IRCC-band-anchored (replaces deleted 7-band linear `rawToTCFScore`)  | §2.2 IRCC table + §2.4 obs 1                         | ✓ Verified 2026-05-10 — Story 10-2 deleted the linear `rawToTCFScore` and replaced with per-skill conversion functions anchored to `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS`                                                                                                                    |
| `src/lib/scoring.ts` `rawPercentToWritingSpeakingScore`              | 0–20 per-skill, IRCC-band-anchored                                                    | §2.1 + §2.2 IRCC table (Writing/Speaking 0–20 scale) | ✓ Verified 2026-05-10 — Story 10-2 added the 0–20 path; before 10-2 Writing/Speaking silently routed through the 0–699 path (wrong scale)                                                                                                                                                      |
| `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS`                             | CLB 1–3 / 4 / 5 / 6 / **7** / 8 / 9 / 10–12 per-skill TCF ranges (verbatim from §2.2) | §2.2 IRCC equivalency table                          | ✓ Verified 2026-05-10 — Story 10-2 transcribed the IRCC table into runtime constants for use by `scoring.ts` per-skill conversion functions and pinned by `src/lib/__tests__/ircc-bands.test.ts`                                                                                               |
| `src/lib/scoring.ts` `SKILL_WEIGHTS_TCF_CANADA`                      | 4 skills × 0.25 (listening / reading / writing / speaking; grammar excluded)          | §2.1 + §2.4 obs 2                                    | ✓ Verified 2026-05-10 — Story 10-2 dropped grammar (TCF Canada has 4 sections, not 5); composite renamed to `calculateInternalCompositeForUI` and JSDoc-flagged as NOT IRCC-equivalent and NOT used by the promotion engine (per `docs/tcf-spec-source.md §10` follow-up #1 operator decision) |
| `src/types/cefr.ts:21-86` `CEFR_LEVELS.tcfScoreMin/Max`              | A1=100-199, A2=200-299, B1=300-399, B2=400-499, C1=500-599, C2=600-699                | §2.3 — round-number bands not publisher-verbatim     | ✓ Verified 2026-05-10 with caveat — Story 10-2 kept the round-number bands for UI labeling (self-assessment-grid display); IRCC math uses `IRCC_CLB_BANDS` instead. JSDoc on `CEFR_LEVELS` clarifies the split.                                                                                |
| `src/types/cefr.ts` `TCFScore` / `WritingSpeakingScore` type aliases | 0–699 (TCFScore) and 0–20 (WritingSpeakingScore) — nominal `number` aliases           | §2.1 — publisher uses two scales                     | ✓ Verified 2026-05-10 — Story 10-2 added `WritingSpeakingScore` to enforce per-scale type safety at compile time (TypeScript flag–only)                                                                                                                                                        |

---

## 3. Per-CEFR Listening passage specs (`src/lib/prompts/listening.ts`)

Code values vs publisher-derived expectations (§3.1).

| Code location                         | Value (codebase) | tcf-spec-source.md anchor     | Status                                                                             |
| ------------------------------------- | ---------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/prompts/listening.ts:71` A1  | 30–50 words      | §3.1 — derived: ≤ 30 words    | ✗ DELTA — A1 too long (audit P1-3: 50 words exits A1). **Owner: Epic 10.3 (P1-3)** |
| `src/lib/prompts/listening.ts:77` A2  | 50–80 words      | §3.1 — derived: 30–80 words   | ✗ DELTA — A2 floor too high. **Owner: Epic 10.3**                                  |
| `src/lib/prompts/listening.ts:83` B1  | 80–150 words     | §3.1 — derived: 80–150 words  | ✓ Verified — within tolerance                                                      |
| `src/lib/prompts/listening.ts:89` B2  | 150–200 words    | §3.1 — derived: 150–300 words | ✗ DELTA — B2 ceiling too low. **Owner: Epic 10.3 (P1-3)**                          |
| `src/lib/prompts/listening.ts:95` C1  | 200–300 words    | §3.1 — derived: 200–500 words | ✗ DELTA — C1 ceiling too low. **Owner: Epic 10.3 (P1-3)**                          |
| `src/lib/prompts/listening.ts:101` C2 | 250–350 words    | §3.1 — derived: 250–600 words | ✗ DELTA — C2 ceiling too low. **Owner: Epic 10.3**                                 |

---

## 4. Per-CEFR Reading passage specs (`src/lib/prompts/reading.ts`)

| Code location                      | Value (codebase) | tcf-spec-source.md anchor      | Status                                                               |
| ---------------------------------- | ---------------- | ------------------------------ | -------------------------------------------------------------------- |
| `src/lib/prompts/reading.ts:60` A1 | 30–60 words      | §4.1 — derived: 30–60 words    | ✓ Verified — match                                                   |
| `src/lib/prompts/reading.ts:66` A2 | 60–120 words     | §4.1 — derived: 60–120 words   | ✓ Verified — match                                                   |
| `src/lib/prompts/reading.ts:72` B1 | 120–200 words    | §4.1 — derived: 120–250 words  | ✗ DELTA — B1 ceiling slightly low. **Owner: Epic 10.3**              |
| `src/lib/prompts/reading.ts:78` B2 | 200–300 words    | §4.1 — derived: 250–450 words  | ✗ DELTA — B2 way too short (audit P1-3). **Owner: Epic 10.3 (P1-3)** |
| `src/lib/prompts/reading.ts:84` C1 | 300–400 words    | §4.1 — derived: 450–700 words  | ✗ DELTA — C1 way too short (audit P1-3). **Owner: Epic 10.3 (P1-3)** |
| `src/lib/prompts/reading.ts:90` C2 | 350–500 words    | §4.1 — derived: 600–900+ words | ✗ DELTA — C2 too short. **Owner: Epic 10.3**                         |

---

## 5. Per-task Writing word counts (`src/lib/prompts/writing.ts`)

**Source: §5.1 (publisher-authoritative, verbatim)**

| Code location                          | Value (codebase)          | tcf-spec-source.md anchor      | Status                                                                                                               |
| -------------------------------------- | ------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `src/lib/prompts/writing.ts:85` Task 1 | 50–80 words               | §5.1 — verbatim: 60–120 words  | ✗ DELTA — code is significantly off (50–80 vs publisher 60–120). **Owner: Epic 10.3 (P1-3)**                         |
| `src/lib/prompts/writing.ts:92` Task 2 | 120–150 words             | §5.1 — verbatim: 120–150 words | ✓ Verified — exact match                                                                                             |
| `src/lib/prompts/writing.ts:99` Task 3 | 250–300 words (C1 target) | §5.1 — verbatim: 120–180 words | ✗ DELTA — code is wildly off (250–300 vs publisher 120–180; audit P1-3). **Owner: Epic 10.3 (P1-3) — HIGH priority** |

---

## 6. Speaking pipeline (`src/lib/prompts/speaking.ts`, `src/lib/schemas/ai-responses.ts`)

| Code location                                                    | Value                                             | tcf-spec-source.md anchor                       | Status                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/prompts/speaking.ts` Task 1 duration                    | 120s (2 min)                                      | §6.1 — verbatim: "sans préparation (2 minutes)" | ✓ Verified — exact match                                                                                                                                                                                                                                                                                                                                 |
| `src/lib/prompts/speaking.ts` Task 2 duration                    | 330s (5 min 30)                                   | §6.1 — verbatim: "5 minutes 30"                 | ✓ Verified — exact match                                                                                                                                                                                                                                                                                                                                 |
| `src/lib/prompts/speaking.ts` Task 3 duration                    | 270s (4 min 30)                                   | §6.1 — verbatim: "4 minutes 30"                 | ✓ Verified — exact match                                                                                                                                                                                                                                                                                                                                 |
| `src/lib/schemas/ai-responses.ts` `speakingTaskEvaluationSchema` | 4 criteria × 0-20 each → sum 0-80 → ×1.25 → 0-100 | §6.3                                            | 🟡 PARTIAL — Story 10-2 added `computeSpeakingScore0to20` so the persisted `mock_tests.total_score` for speaking is now on the publisher's 0–20 scale via `composite / 5`. The 4-criterion convention (vs the publisher's 3-category structure with sociolinguistique) and the missing 5th `sociolinguisticScore` dimension remain **Owner: Epic 10.6**. |

---

## 7. PRD claims (`_bmad-output/planning-artifacts/prd.md`)

| Code location | Value                                                                                                                                          | tcf-spec-source.md anchor                         | Status                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `prd.md:113`  | "TCF mock tests aligned to TCF Canada — 78 mandatory items across 4 sections (39 listening + 39 reading + 3 writing tasks + 3 speaking tasks)" | §1 — TCF Canada is 78 mandatory items, 4 sections | ✓ Verified 2026-05-10 — closed by Story 10-1 pedagogy follow-up |
| `prd.md:235`  | "TCF Canada section composition (Listening 39q/35min, Reading 39q/60min, Writing 3 tasks/60min, Speaking 3 tasks/12min)"                       | §1 — TCF Canada is 39/39/3-tasks/3-tasks          | ✓ Verified 2026-05-10 — closed by Story 10-1 pedagogy follow-up |
| `prd.md:496`  | "Users can take full mock tests aligned to TCF Canada (78 mandatory items across 4 sections)" (FR28)                                           | §1 — TCF Canada is 78 mandatory items, 4 sections | ✓ Verified 2026-05-10 — closed by Story 10-1 pedagogy follow-up |

---

## 8. Linguistic accuracy (`src/types/cefr.ts`, `src/lib/prompts/*.ts`)

| Code location                                                                | Value                                | tcf-spec-source.md anchor                   | Status                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/types/cefr.ts:33` A2 `nameFr`                                           | "Élémentaire avancé"                 | §8.2 — standard A2 label is "Élémentaire 2" | ✗ DELTA — non-standard label. **Owner: Epic 10.7 (P2-2)**                     |
| `src/lib/prompts/listening.ts:65` Québécois prompt                           | (operator-derived heuristic)         | §8.3 — contains errors per audit P2-2       | ✗ DELTA — drop or simplify per audit decision D5. **Owner: Epic 10.7 (P2-2)** |
| `src/lib/prompts/conversation.ts:91` "Force est de constater" classification | listed as connector                  | §8.1 — fixed expression, not connector      | ✗ DELTA — misclassification. **Owner: Epic 10.7 (P2-2)**                      |
| Voice-mode emoji-formatted output                                            | Realtime prompts emit emoji/markdown | §8.4                                        | ✗ DELTA — TTS reads asterisks. **Owner: Epic 10.7 (P2-1)**                    |

---

## 9. Vocabulary frequency

| Code location              | Value (codebase)        | tcf-spec-source.md anchor                          | Status                                                                                                      |
| -------------------------- | ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| (no current code citation) | (no caps in any prompt) | §7.2 — Beacco-derived per-CEFR lexical inventories | 🟡 GAP — no current code; Epic 10.4 will use this section to embed top-N lists. **Owner: Epic 10.4 (P1-4)** |

---

## 10. shippable-roadmap.md

| Code location                                                   | Value                                                                       | tcf-spec-source.md anchor                   | Status                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `_bmad-output/planning-artifacts/shippable-roadmap.md` P0-1 row | "Listening 39q/35min, Reading 45q/60min, Grammar 18q/18min" (audit's claim) | §1 — TCF Canada is 39/35, 39/60, no Grammar | ✗ DELTA — audit's number partially wrong; **Footnote added by Story 10-1 (this story)** |

---

## 11. CLAUDE.md

| Code location                     | Value                                               | tcf-spec-source.md anchor   | Status                                           |
| --------------------------------- | --------------------------------------------------- | --------------------------- | ------------------------------------------------ |
| `CLAUDE.md:37` TCF spec paragraph | (story 9-1 paragraph; covers headline numbers only) | §1, §2, §9 (full reference) | ✗ DELTA — **Updated by Story 10-1 (this story)** |

---

## SHA-256 verification procedure

For each snapshot file under `docs/tcf-canada-snapshots/`:

```bash
# Extract body (everything after the second --- delimiter)
awk '/^---$/{n++; if(n==2){found=1; next}} found' <snapshot.md> > /tmp/body.txt

# Compute and compare
shasum -a 256 /tmp/body.txt
# Compare against the sha256: line in the snapshot's front-matter.
# A mismatch indicates the file body has been edited since retrieval —
# update the front-matter SHA before commit, OR investigate the change.
```

The matrix's `tcf-spec.test.ts` regression test does NOT verify SHAs (it would fail on legitimate snapshot updates). SHA verification is a manual operator check during re-verification.

---

## Adding a new TCF-derived value to the codebase

If you need to add a new constant, scoring band, prompt-builder spec, or rubric criterion that derives from TCF Canada specifications:

1. **Source it first.** Add the citation to the appropriate section of [`docs/tcf-spec-source.md`](./tcf-spec-source.md) before writing the code.
2. **Add a row to this matrix.** Include code location, value, tcf-spec-source.md anchor, and Status.
3. **Run the regression test.** `npm test -- tcf-spec` should pass — if it doesn't, the matrix or source-doc is incomplete.
4. **If the value is a delta from the publisher,** name an owner Epic story in the Status column.
