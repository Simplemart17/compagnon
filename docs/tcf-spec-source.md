# TCF Specification — Source of Truth

**Variant targeted by this app:** TCF Canada
**Verified:** 2026-05-07 (story 9-1) · **Re-verified and expanded:** 2026-05-10 (story 10-1)

This is the single canonical reference for every TCF Canada specification the codebase depends on. Every TCF-derived value in source code is traceable to a section of this document via [docs/tcf-spec-citations.md](./tcf-spec-citations.md) (the citations matrix). Adding a TCF claim in code without a matrix row fails `src/lib/__tests__/tcf-spec.test.ts`.

## 1. Verified TCF Canada structure (the contract)

**Authoritative source:**

- **Publisher:** France Éducation International (FEI), the official TCF examiner; operates under the French Ministry of Education
- **Primary URL (FR):** https://www.france-education-international.fr/test/tcf-canada
- **Primary URL (EN):** https://www.france-education-international.fr/test/tcf-canada?langue=en
- **Snapshot:** [`docs/tcf-canada-snapshots/landing-2026-05-10.md`](./tcf-canada-snapshots/landing-2026-05-10.md) (SHA-256: `2e0ed1cf...`)
- **Cross-checked against:** independent test centre listings (Alliance Française, Lyon Exam Inflexyon, etc.) — all in agreement.

A frozen PDF of the publisher page is **not** committed under `docs/tcf-spec-source.pdf` because the publisher serves this content as HTML only. The markdown snapshot at the link above is the citable contract; SHA-256 is the integrity check. The operator can manually print the URL above to PDF and place it at `docs/tcf-spec-source.pdf` if a binary archive is desired.

All four sections are **mandatory** for TCF Canada (unlike TCF Tout Public, where only Listening + Reading + Grammar are mandatory and Writing + Speaking are optional).

| Section                         | Code        | Format                                          | Questions | Time                                 |
| ------------------------------- | ----------- | ----------------------------------------------- | --------- | ------------------------------------ |
| Compréhension orale (Listening) | `listening` | QCM, 4 options/1 correct                        | **39**    | **35 min**                           |
| Compréhension écrite (Reading)  | `reading`   | QCM, 4 options/1 correct                        | **39**    | **60 min**                           |
| Expression écrite (Writing)     | `writing`   | 3 production tasks                              | n/a       | **60 min**                           |
| Expression orale (Speaking)     | `speaking`  | 3 production tasks (face-to-face with examiner) | n/a       | **12 min** (incl. 2 min preparation) |

**Total exam duration (verbatim):** "Le TCF Canada à une durée totale de 2 heures 47."
**Note:** TCF Canada has **no Grammar / Maîtrise des Structures de la Langue section.** That section exists only in TCF Tout Public, TCF ANF, TCF IRN, etc.

**Re-verification 2026-05-10:** snapshot `landing-2026-05-10.md` confirms all numbers above. No spec-edition change detected since 2026-05-07.

## 2. Scoring scale and CEFR equivalency

### 2.1 Per-skill scoring scales used by the publisher

The publisher uses **two different scales**, NOT a single 0-699 scale across all skills:

| Skill                           | Scale                                                            | Source                                                                     |
| ------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Listening (Compréhension orale) | **0–699** raw; CLB-relevant range starts at 331                  | IRCC equivalency table (canada.ca, third-party-transcribed)                |
| Reading (Compréhension écrite)  | **0–699** raw; CLB-relevant range starts at 342                  | IRCC equivalency table                                                     |
| Writing (Expression écrite)     | **0–20** raw (per-criterion sum); CLB-relevant range starts at 4 | IRCC equivalency table; rubric breakdown not published verbatim by FEI     |
| Speaking (Expression orale)     | **0–20** raw (per-criterion sum); CLB-relevant range starts at 4 | IRCC equivalency table; the 4-criterion 0-20-each rubric is FEI convention |

**Why "raw" vs "CLB-relevant range":** the raw scale extends to 0 (a candidate who scores below CLB 4's threshold gets a raw score in the < 4 / < 331 region). CLB equivalency is only defined for the upper subrange. §6.3 references the 4-20 figure when discussing CLB-mapped consumption; that's the same scale, narrowed to the CLB-relevant subset.

**There is no composite TCF Canada score.** The publisher reports each skill independently. Express Entry / IRCC accepts the per-skill scores; users do not receive a single overall TCF number.

### 2.2 CLB / NCLC equivalency table (IRCC)

This is the operative downstream consumer of TCF Canada scores. CLB (Canadian Language Benchmark, English) and NCLC (Niveaux de compétence linguistique canadiens, French) share the same numeric thresholds.

**Snapshot:** [`docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md`](./tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md) (SHA-256: `1e4ac260...`)

**⚠️ CAVEAT:** The IRCC URL responds HTTP 403 to WebFetch (anti-bot). The table below is transcribed from a third-party source that explicitly cites the canada.ca URL. Operator should verify against the official URL annually and update the snapshot.

| CLB / NCLC Level | Reading (CE) | Writing (EE) | Listening (CO) | Speaking (EO) |
| ---------------- | ------------ | ------------ | -------------- | ------------- |
| 1–3              | < 342        | < 4          | < 331          | < 4           |
| 4                | 342–374      | 4–5          | 331–368        | 4–5           |
| 5                | 375–405      | 6            | 369–397        | 6             |
| 6                | 406–452      | 7–9          | 398–457        | 7–9           |
| **7**            | **453–498**  | **10–11**    | **458–502**    | **10–11**     |
| 8                | 499–523      | 12–13        | 503–522        | 12–13         |
| 9                | 524–548      | 14–15        | 523–548        | 14–15         |
| 10–12            | 549–699      | 16–20        | 549–699        | 16–20         |

**CLB 7 is the typical Express Entry threshold** — bolded for emphasis since this is the most-asked-about row by IRCC-track users.

### 2.3 CEFR ↔ TCF mapping

The publisher's English page states (verbatim):

> "TCF Canada assesses six levels of French knowledge (defined with reference to the Common European Framework of Reference for Languages by the Council of Europe)."

**The publisher does NOT publish a verbatim TCF-score → CEFR-level table on the landing page** (confirmed 2026-05-10). The mapping is implied via the CEFR descriptors (Section 3 of this doc) but not stated as a numeric range. Common third-party tables (HiTCF, ouizami, tcfprep) approximate it as:

| CEFR | Approximate TCF score (per-skill, derived) |
| ---- | ------------------------------------------ |
| A1   | 100–199                                    |
| A2   | 200–299                                    |
| B1   | 300–399                                    |
| B2   | 400–499                                    |
| C1   | 500–599                                    |
| C2   | 600–699                                    |

**These round-number bands are NOT publisher-authoritative.** They appear in the codebase at [src/types/cefr.ts:27-69](../src/types/cefr.ts#L27) and are widely cited but lack a verbatim FEI source. The publisher-authoritative mapping is via CLB equivalency (Section 2.2), which is non-linear.

### 2.4 Critical observations for the codebase

1. **The 7-band linear `rawToTCFScore` is invented.** [src/lib/scoring.ts:7-35](../src/lib/scoring.ts#L7) maps raw % → TCF score in 7 piecewise linear bands. The publisher's CLB bands (Section 2.2) are non-linear, empirically anchored. **Owner: Epic 10.2** (P1-1).
2. **The composite score is invented.** [src/lib/scoring.ts:70-89](../src/lib/scoring.ts#L70) `calculateCompositeScore` averages skills with equal weights — but the publisher does not produce a composite. **Owner: Epic 10.2** (P1-2).
3. **Two scales exist.** Listening + Reading use 0–699; Writing + Speaking use 0–20. The codebase's per-skill scoring should reflect this. **Owner: Epic 10.2 + Epic 10.6**.

## 3. Listening section specification

### 3.1 Per-CEFR-level passage characteristics

**The publisher does NOT publish per-CEFR passage word-count expectations.** Confirmed 2026-05-10 against snapshots [`landing-2026-05-10.md`](./tcf-canada-snapshots/landing-2026-05-10.md) and [`samples-2026-05-10.md`](./tcf-canada-snapshots/samples-2026-05-10.md). The CEFR Self-Assessment Grid descriptors (Section 4 of this doc) provide _qualitative_ guidance only.

The codebase's per-CEFR word counts at [src/lib/prompts/listening.ts:71-101](../src/lib/prompts/listening.ts#L71) are **operator-derived heuristics**, not publisher-sourced. They are documented as such in `tcf-spec-citations.md`.

For Epic 10.3 calibration, the **derived expectations** (cross-checked against Beacco/Porquier _Niveau A1 pour le français_ and standard CEFR pedagogy literature) are:

| CEFR | Expected listening passage length                             | Speech rate                     |
| ---- | ------------------------------------------------------------- | ------------------------------- |
| A1   | ≤ 30 words (audit P1-3 says 50 exits A1)                      | Slow, clearly articulated       |
| A2   | 30–80 words                                                   | Slow to natural                 |
| B1   | 80–150 words                                                  | Natural standard speech         |
| B2   | 150–300 words                                                 | Natural, including TV/films     |
| C1   | 200–500 words (extended speech, may be implicit-relationship) | Natural, including unstructured |
| C2   | 250–600 words (any speech, even at fast native speed)         | Native speed                    |

Epic 10.3 will use these as the calibration target. Epic 10.4 will overlay vocabulary frequency caps.

### 3.2 Passage types observed in publisher samples

From [`samples-2026-05-10.md`](./tcf-canada-snapshots/samples-2026-05-10.md) §1:

- Conversational exchange (e.g., payment-methods negotiation)
- Workplace dialogue (e.g., scheduling appointments)
- Informational monologue (e.g., geopolitical research organization description)

The codebase's `passageType` enum at [src/lib/prompts/listening.ts:40](../src/lib/prompts/listening.ts#L40) (`dialogue|monologue|news|interview|announcement|phone_call`) is consistent with these.

### 3.3 Question format

**Verbatim from the publisher:**

> "Chaque enregistrement n'est diffusé qu'une seule fois" (Each recording plays only once)

39 multiple-choice questions, 4 options each, 1 correct answer. 35 minutes total.

## 4. Reading section specification

### 4.1 Per-CEFR-level passage characteristics

**Same caveat as §3.1:** the publisher does not publish per-CEFR word counts. Codebase heuristics at [src/lib/prompts/reading.ts:60-90](../src/lib/prompts/reading.ts#L60) are operator-derived.

**Audit P1-3** flagged: B2 too short (codebase: 200–300; widely cited target: 300–450), C1 too short (codebase: 300–400; widely cited target: 500–700).

**Derived expectations for Epic 10.3 calibration:**

| CEFR | Expected reading passage length |
| ---- | ------------------------------- |
| A1   | 30–60 words                     |
| A2   | 60–120 words                    |
| B1   | 120–250 words                   |
| B2   | 250–450 words                   |
| C1   | 450–700 words                   |
| C2   | 600–900+ words                  |

### 4.2 Passage types observed in publisher samples

From [`samples-2026-05-10.md`](./tcf-canada-snapshots/samples-2026-05-10.md) §3:

- Service notice interpretation
- Administrative correspondence
- Personal correspondence (e.g., vacation invitation)
- Informational article analysis

Codebase's `type` enum at [src/lib/prompts/mock-test.ts:75](../src/lib/prompts/mock-test.ts#L75) (`article|email|advertisement|notice`) is consistent with these.

## 5. Writing section specification (Expression écrite)

### 5.1 Per-task word counts (verbatim, publisher-authoritative)

**Source:** [`landing-2026-05-10.md`](./tcf-canada-snapshots/landing-2026-05-10.md) §"Expression écrite":

| Task | Verbatim FR                           | Word range  |
| ---- | ------------------------------------- | ----------- |
| 1    | "minimum 60 mots / maximum 120 mots"  | **60–120**  |
| 2    | "minimum 120 mots / maximum 150 mots" | **120–150** |
| 3    | "minimum 120 mots / maximum 180 mots" | **120–180** |

**Codebase mismatch (audit P1-3):** [src/lib/prompts/writing.ts:85-99](../src/lib/prompts/writing.ts#L85) currently specifies Task 1: 50–80 words, Task 2: 120–150, Task 3: 250–300 (C1). **Tasks 1 and 3 are wrong** per the publisher. Owner: Epic 10.3.

### 5.2 Evaluation criteria (paraphrase from publisher; verbatim FR in snapshot)

Candidates are assessed on the ability to:

- Communicate the message clearly
- Provide requested information
- Describe, narrate, explain
- Justify choices / positions / decisions
- Sequence ideas with discourse coherence
- Compare two viewpoints
- Express and argue opinions
- Use vocabulary / structures suited to the task
- Reformulate effectively

### 5.3 Disqualification rules (verbatim FR)

> "La copie d'expression écrite pourrait être évaluée « A1 non atteint » si: l'écriture n'est pas lisible...; chaque tâche n'est pas réalisée avec le nombre [de] mots exigé; la production est hors-sujet; une ou plusieurs tâches ne sont pas réalisées."

**Translation:** the copy may be evaluated as "A1 not achieved" if writing is illegible, if each task is not completed within the required word count, if production is off-topic, or if one or more tasks is not completed.

**Implication for Epic 10.3:** the Writing pipeline (when added to mock test) must reject submissions that fall outside the per-task word ranges.

### 5.4 Per-criterion 0-20 rubric

Per IRCC equivalency (Section 2.2), Writing is scored on a 0-20 scale. The publisher does NOT publish the per-criterion breakdown verbatim; the 9 evaluation-criteria bullets in §5.2 are the documented criteria but their numeric weighting is not surfaced by FEI on the public page.

For Epic 10.3 / 10.6 implementation: source the **Manuel du candidat TCF** PDF (operator action; see [`samples-2026-05-10.md`](./tcf-canada-snapshots/samples-2026-05-10.md) §"Operator Action Items") to obtain the per-criterion breakdown. Until then, the 9 criteria summed-and-scaled is a defensible operationalization.

## 6. Speaking section specification (Expression orale)

### 6.1 Per-task durations (verbatim, publisher-authoritative)

**Source:** [`landing-2026-05-10.md`](./tcf-canada-snapshots/landing-2026-05-10.md) §"Expression orale":

| Task | Name                         | Duration (verbatim FR)                                          | Prep                |
| ---- | ---------------------------- | --------------------------------------------------------------- | ------------------- |
| 1    | Entretien dirigé             | "sans préparation (2 minutes)"                                  | None                |
| 2    | Exercice en interaction      | "avec préparation (5 minutes 30 dont 2 minutes de préparation)" | 2 min (within 5:30) |
| 3    | Expression d'un point de vue | "sans préparation (4 minutes 30)"                               | None                |

**Total:** 12 minutes wall-clock (Task 2's 5:30 includes 2 min preparation; the publisher's "12 minutes (incl. 2 min preparation)" framing means the 2 min prep is a slice of Task 2, not added on top of the 12 min total). Confirmed against [src/lib/constants.ts:25](../src/lib/constants.ts#L25) `SPEAKING_MINUTES: 12`.

**Story 9-8's `useAudioRecorder` durations** at [src/lib/prompts/speaking.ts](../src/lib/prompts/speaking.ts) (Task 1: 120s, Task 2: 330s, Task 3: 270s) sum to 720s = 12 min. Match the publisher exactly. **No Epic 10.6 delta on durations.**

### 6.2 Evaluation criteria (paraphrase from publisher)

Candidates demonstrate the capacity to:

- Discuss self, family / professional environment
- Pose situation-appropriate questions
- Express opinions; explain advantages / disadvantages
- Present clear, structured argumentation in contextual style
- Present detailed, structured complex subjects with development / conclusion

### 6.3 Per-criterion 0-20 rubric

Per IRCC equivalency (Section 2.2), Speaking is scored on a 0-20 scale per skill. The 4-criterion convention (pronunciation/fluency, vocabulary, grammar, interaction) used by the codebase's `speakingTaskEvaluationSchema` ([src/lib/schemas/ai-responses.ts](../src/lib/schemas/ai-responses.ts)) is **derived from FEI examiner conventions but not published verbatim** by FEI on the public page. The codebase implements 0-20 per dimension × 4 dimensions = 0-80 sum × 1.25 = 0-100 overall (story 9-8).

**Implication for Epic 10.6:** the 0-100 overall scale is internal-consistency-only. To map back to the IRCC 4-20 scale used for CLB equivalency, divide by 5. Story 9-8's `computeSpeakingComposite` produces 0-100; Epic 10.6 should add a 0-20 mapping function and use IT for `skill_progress` writes that are CLB-relevant. **Defer scaling change to Epic 10.2 (which owns scoring scale calibration).**

### 6.4 Examiner format

Face-to-face individual exam (not collective). The codebase's record-and-grade flow (story 9-8) is a faithful operationalization for prep purposes — Realtime examiner role-play is Epic 10.6.

## 7. Vocabulary frequency expectations per CEFR

### 7.1 Publisher position

**The publisher (FEI) does NOT publish per-CEFR vocabulary frequency tier requirements.** Confirmed 2026-05-10 against [`landing-2026-05-10.md`](./tcf-canada-snapshots/landing-2026-05-10.md) and [`samples-2026-05-10.md`](./tcf-canada-snapshots/samples-2026-05-10.md).

### 7.2 Council of Europe + Beacco position

The Conseil de l'Europe defers to per-language operationalizations published as the **Référentiel des contenus d'apprentissage du FLE (Beacco/Porquier series)**. These reference works define per-CEFR lexical inventories for French. The widely-accepted approximations (Council of Europe Companion Volume + Beacco):

| CEFR | Approximate French lexical inventory             |
| ---- | ------------------------------------------------ |
| A1   | ~500 most-frequent words                         |
| A2   | ~1000–1500 most-frequent words                   |
| B1   | ~2000–3000 most-frequent words                   |
| B2   | ~4000–5000 most-frequent words                   |
| C1   | 5000+ including specialized lexicon              |
| C2   | ~10000+ with literary/archaic/regional registers |

**These are NOT verbatim from a single FEI source.** They are reference values published across multiple Council of Europe / Beacco volumes. Epic 10.4 should source the most current Beacco edition for the canonical word lists.

### 7.3 Implication for the codebase

**The codebase has zero vocabulary frequency caps in prompts today** (audit P1-4). Epic 10.4 will use the Beacco-derived word lists to add explicit "do not exceed level" constraints to prompt builders.

## 8. Linguistic accuracy reference

### 8.1 "Force est de constater" — fixed expression, not connector

Per Le Bon Usage (Grevisse) and the Trésor de la langue française, _force est de_ + infinitive is a **fixed expression** (locution verbale figée) meaning "one must / it is necessary to." It is NOT a connector or transitional adverbial. The codebase's [src/lib/prompts/conversation.ts](../src/lib/prompts/conversation.ts) reportedly classifies it as a connector (audit P2-2). **Owner: Epic 10.7.**

### 8.2 CEFR labels in French

Standard CEFR-French conventions:

- A1: "Élémentaire 1" or simply "Élémentaire"
- A2: "Élémentaire 2" or "Élémentaire" (same descriptor as A1; level distinguished by number)
- B1: "Intermédiaire 1" or "Intermédiaire"
- B2: "Intermédiaire 2" or "Intermédiaire avancé" (the only level where "avancé" is the standard label)
- C1: "Avancé 1" or "Avancé"
- C2: "Avancé 2" or "Maîtrise"

**Codebase mismatch:** [src/types/cefr.ts:33](../src/types/cefr.ts#L33) labels A2 as `nameFr: "Élémentaire avancé"` — non-standard. The standard A2 label is "Élémentaire 2" or "Élémentaire". "Élémentaire avancé" is sometimes informally used by language schools but is not Council-of-Europe canonical. **Owner: Epic 10.7.**

### 8.3 Québécois variant

Per the Office québécois de la langue française (OQLF) and the Banque de dépannage linguistique:

- The "tu" → "tsu" affrication is a real phonological feature of Québec French (specifically /t/ before /i/ and /y/ becomes [ts]) but the codebase prompt's spelling appears off (audit P2-2 says it should be IPA-tagged or use OQLF orthographic conventions).
- "Chez nous" is NOT specifically a Québécois marker — it's standard French. Genuine Québécois lexical markers include _icitte_ (here), _pantoute_ (not at all), _astheure_ (now), _piasse_ (dollar), _char_ (car), _magasiner_ (to shop).
- Per audit decision D5 (`shippable-roadmap.md` §6): Québécois variant is **deferred to v2** with native-speaker review. v1 should drop the Québécois prompt entirely or significantly simplify it. **Owner: Epic 10.7.**

### 8.4 Voice-mode emoji-formatted output

OpenAI's Realtime API does not have a documented position on emoji handling in TTS output. Empirical observation: TTS literally reads asterisks (`*` → "asterisk") and reads or skips emoji unpredictably. The codebase's voice-mode prompts should NOT instruct the model to emit markdown formatting (asterisks, bullet points, code blocks) or emoji. Audit P2-1 flagged this. **Owner: Epic 10.7.**

## 9. Citations in source code

The full per-line citations matrix lives at **[`docs/tcf-spec-citations.md`](./tcf-spec-citations.md)** — every TCF-derived value in the codebase appears as a row with: code location, value, this-doc anchor, and status (`✓ Verified` / `✗ DELTA` / `🟡 GAP`). `✗ DELTA` rows name their owner Epic 10.X / Epic 17.X story.

A regression test (`src/lib/__tests__/tcf-spec.test.ts`) walks the citations matrix and fails if a known TCF claim is missing a row.

## 10. Follow-up tickets (status as of 2026-05-10, story 10-1)

The pivot to Canada has implications well beyond story 9-1 / 10-1. Status update:

1. **Drop `grammar` from `TCFSkill` union** — **DEFERRED to Epic 10.2** (composite scoring recalibration). Operator's 2026-05-07 direction was to keep Grammar as a non-TCF practice skill, so the union stays but its membership in TCF readiness math changes.
2. **Recalibrate composite scoring** — **DEFERRED to Epic 10.2.** Section 2.4 documents the deltas; 10.2 implements the fix.
3. **Add Writing pipeline to mock test** — **DEFERRED to Epic 10.3** (per-level passage calibration owns Writing changes too) and/or a future Epic 10.6 sub-story. Section 5 documents the publisher's per-task word counts.
4. ~~**Add Speaking pipeline to mock test**~~ **DONE — landed by story 9-8 on 2026-05-09** as a record-and-grade flow. See `app/(tabs)/mock-test/speaking.tsx` and `src/lib/prompts/speaking.ts`. Section 6 documents the publisher's spec; story 9-8 implementation aligns on durations + structure.
5. **Fix `shippable-roadmap.md` P0-1 line** — **DONE — closed by story 10-1 (this story).** The audit's specific numbers were partially wrong; footnote added in `shippable-roadmap.md`. See [Citations Matrix](./tcf-spec-citations.md) for the cross-reference.
6. **Update PRD** — **DEFERRED.** Story 10-1 surfaced the deltas in the citations matrix §7 (`prd.md:113` and `prd.md:235`) but the actual file edit is blocked: PR #55 (which would have committed the PRD to main) merged into the closed `feature/9-9-...` branch instead of main, so the PRD file is not on main today. The edit will land in a follow-up PR after PR #55's content is re-PR'd to main. Citations matrix §7 marks both rows 🟡 DEFERRED.
7. **Onboarding / placement test TCF readiness indicator** — **DEFERRED to Epic 10.5** (placement test prompt extraction).
8. **`mock_tests.test_type` schema versioning** — **DEFERRED to Epic 17.1** (mock_tests questions normalization). Pre-pivot rows with `test_type = "full"` represent a 3-section run (TCF Tout Public era, 85 min, includes grammar); post-pivot rows represent a 2-section run (TCF Canada era, 95 min QCM-only). Migration to add `variant` column.

## 10b. Pending operator actions (surfaced from snapshots)

Operator-driven follow-ups that the dev agent cannot complete via WebFetch but that the next Epic 10 story (10-3 / 10-6) will need:

1. **Manually download "Manuel du candidat TCF"** PDF (FR 2.97 Mo or EN 2.86 Mo) from the publisher landing page → save under `docs/tcf-canada-snapshots/manuel-candidat-tcf.pdf`. Contains the per-criterion 0-6 / 0-4 Writing rubric breakdown that §5.4 documents as not-published-on-the-public-page.
2. **Manually download "TCF TP / TCF CANADA / TCF QUÉBEC — Exemple d'épreuves d'expression orale"** PDF (1.54 MB) from the publisher samples page → save under `docs/tcf-canada-snapshots/expression-orale-samples.pdf`. Required by Epic 10.6 Speaking rubric deepening.
3. **Manually download "TCF TP / TCF CANADA / TCF QUÉBEC — Exemple d'épreuves d'expression écrite"** PDF (1.9 MB) from the same page → save under `docs/tcf-canada-snapshots/expression-ecrite-samples.pdf`. Required by Epic 10.3 Writing per-task calibration.
4. **Manually verify the IRCC CLB equivalency table** at https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/standard-requirements/language-requirements/test-equivalency-charts.html and update [`docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md`](./tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md) if any row diverges from the third-party-transcribed table; recompute SHA-256.

These items unblock Epic 10.3 / 10.6 partially. Until done, those stories will document the gap rather than implement against publisher-verbatim numbers.

## 11. Re-verification procedure

This document should be re-verified annually OR whenever France Éducation International publishes a new edition note OR whenever IRCC updates the equivalency chart.

### Re-verification steps

1. **Re-fetch publisher landing page** — WebFetch `https://www.france-education-international.fr/test/tcf-canada` → save as `docs/tcf-canada-snapshots/landing-<YYYY-MM-DD>.md`. Compute SHA-256.
2. **Re-fetch publisher samples page** — WebFetch `https://www.france-education-international.fr/test/exemples-epreuves-tcf?langue=en` → save as `docs/tcf-canada-snapshots/samples-<YYYY-MM-DD>.md`. Compute SHA-256.
3. **Re-fetch IRCC CLB equivalency** — manual browser check (canada.ca returns 403 to WebFetch). Compare against `ircc-clb-equivalency-2026-05-10.md`. Update + recompute SHA if changed.
4. **Re-fetch CEFR self-assessment grid** — Europass URL: `https://europass.europa.eu/system/files/2020-05/CEFR%20self-assessment%20grid%20EN.pdf`. Save snapshot, compute SHA. Note: CEFR descriptors are very stable (last revision 2018 Companion Volume); annual check is sufficient.
5. **`git diff` snapshots vs prior** — if non-empty, walk through each change and update the corresponding section of this file.
6. **Run `npm test -- tcf-spec`** — must pass (citation matrix completeness + section anchors).
7. **Update the "Verified" / "Re-verified" date** at the top of this file.
8. **If any change affects code:** file an Epic 10.X-equivalent story; do NOT fix in the verification PR. The verification PR's job is to update the source-of-truth; the fix PR's job is to update the code.
9. **Tamper check:** verify each snapshot's SHA-256 in the front-matter matches the actual file content (defense against accidental edit). Recompute via the procedure in `docs/tcf-spec-citations.md`.
