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

For Epic 10.3 calibration, the **derived expectations** below are operator-derived heuristics cross-checked against Beacco/Porquier _Niveau A1 pour le français_ (Didier 2007) sample text lengths and the CEFR Companion Volume 2018 listening descriptors. They are NOT publisher-verbatim — Epic 10.3 should source the canonical numbers from the _Manuel du candidat TCF_ (operator-action TODO; see §10b) before locking these in.

| CEFR | Expected listening passage length                                                       | Speech rate                     |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------- |
| A1   | 30–80 words (≈ 20–60 sec of slow speech; Beacco _Niveau A1_ samples typically 60–100 w) | Slow, clearly articulated       |
| A2   | 60–150 words                                                                            | Slow to natural                 |
| B1   | 100–200 words                                                                           | Natural standard speech         |
| B2   | 150–300 words                                                                           | Natural, including TV/films     |
| C1   | 250–500 words (extended speech, may be implicit-relationship)                           | Natural, including unstructured |
| C2   | 350–600 words (any speech, even at fast native speed)                                   | Native speed                    |

> **Note on overlapping bands:** the upper end of one level overlaps the lower end of the next. This is deliberate — **length alone is not the CEFR diagnostic**. Syntactic density, lexical frequency tier (§7), abstract/concrete ratio, implicitness (§8), and rhetorical complexity differentiate levels. The CEFR Companion Volume 2018 §3 listening descriptors (also reproduced in `cefr-self-assessment-grid-2026-05-10.md`) are the qualitative reference; length brackets above are a generation-time heuristic only. Audit P1-3's earlier "≤ 30 words at A1, 50 exits A1" claim was an unsourced rule of thumb — Beacco samples and Council of Europe descriptors support a wider 30–80 range at A1.

Epic 10.3 will use these as the calibration starting point but should fetch the _Manuel du candidat TCF_ PDF before implementing prompt-builder changes. Epic 10.4 will overlay vocabulary frequency caps (§7).

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

**Derived expectations for Epic 10.3 calibration** (operator-derived heuristics; not publisher-verbatim — same caveat as §3.1):

| CEFR | Expected reading passage length |
| ---- | ------------------------------- |
| A1   | 30–60 words                     |
| A2   | 60–120 words                    |
| B1   | 120–250 words                   |
| B2   | 250–450 words                   |
| C1   | 450–700 words                   |
| C2   | 600–900+ words                  |

> **Note on overlapping bands:** same as §3.1 — length is not the diagnostic; the CEFR Companion Volume 2018 reading descriptors (and `cefr-self-assessment-grid-2026-05-10.md`) drive level differentiation via syntactic complexity, vocabulary tier, abstract/concrete ratio, and rhetorical structure. The above is a generation-time heuristic only.

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

**These ranges are not advisory — they are enforcement thresholds.** See §5.3: a submission outside these word counts is automatically evaluated as "A1 non atteint" (below A1) regardless of content quality.

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

**Story 9-8's `useAudioRecorder` durations** at [src/lib/prompts/speaking.ts](../src/lib/prompts/speaking.ts) (Task 1: 120s, Task 2: 330s, Task 3: 270s) sum to 720s = 12 min. Match the publisher's wall-clock exactly. **No Epic 10.6 delta on total durations.**

> **Epic 10.6 note on prep/speak distinction:** Task 2's 5:30 window decomposes into ~2 min preparation + ~3:30 active interaction (publisher: "5 minutes 30 dont 2 minutes de préparation"). Story 9-8's record-and-grade flow captures the full 5:30 wall-clock as a single audio segment, which is acceptable for prep-mode practice but **does not faithfully simulate the live exam** where the candidate is silent during prep and the examiner does not engage until prep ends. Epic 10.6's Realtime examiner role-play implementation must distinguish the two windows — e.g., a silent UI countdown for prep followed by the examiner-greeting trigger — and the rubric should not penalize silence during the prep window.

### 6.2 Evaluation criteria (paraphrase from publisher)

Candidates demonstrate the capacity to:

- Discuss self, family / professional environment
- Pose situation-appropriate questions
- Express opinions; explain advantages / disadvantages
- Present clear, structured argumentation in contextual style
- Present detailed, structured complex subjects with development / conclusion

### 6.3 Per-criterion 0-20 rubric

Per IRCC equivalency (Section 2.2), Speaking is scored on a 0-20 scale per skill.

**FEI publishes three criterion categories for Expression Orale** (per the public "Évaluation des épreuves du TCF" article on france-education-international.fr):

1. **Linguistique** — étendue / maîtrise du lexique, correction grammaticale, aisance, prononciation, fluidité globale du discours
2. **Pragmatique** — interaction, structuration du discours, cohérence et cohésion, développement thématique
3. **Sociolinguistique** — adéquation à la situation de communication

The 4-criterion convention (pronunciation/fluency, vocabulary, grammar, interaction) used by the codebase's `speakingTaskEvaluationSchema` ([src/lib/schemas/ai-responses.ts](../src/lib/schemas/ai-responses.ts)) **collapses linguistique + pragmatique into 4 dimensions and omits sociolinguistique entirely**. The exact per-criterion weighting within each category is not published verbatim by FEI on the public page (operator-fetch the _Manuel du candidat TCF_ for the full breakdown). The codebase implements 0-20 per dimension × 4 dimensions = 0-80 sum × 1.25 = 0-100 overall (story 9-8).

**Implication for Epic 10.6:** the missing sociolinguistic criterion is an Epic 10.6 deliverable. Either (a) add a fifth `sociolinguisticScore` dimension to `speakingTaskEvaluationSchema` and update the prompt to assess "adéquation à la situation de communication" explicitly, or (b) document why sociolinguistic is intentionally omitted and update the rubric framing to acknowledge the gap. The 0-100 overall scale is internal-consistency-only; to map back to the IRCC 4-20 scale used for CLB equivalency, divide by 5. Story 9-8's `computeSpeakingComposite` produces 0-100; Epic 10.6 should add a 0-20 mapping function and use it for `skill_progress` writes that are CLB-relevant. **Defer scaling change to Epic 10.2 (which owns scoring scale calibration); defer sociolinguistic addition to Epic 10.6.**

### 6.4 Examiner format

Face-to-face individual exam (not collective). The codebase's record-and-grade flow (story 9-8) is a faithful operationalization for prep purposes — Realtime examiner role-play is Epic 10.6.

## 7. Vocabulary frequency expectations per CEFR

### 7.1 Publisher position

**The publisher (FEI) does NOT publish per-CEFR vocabulary frequency tier requirements.** Confirmed 2026-05-10 against [`landing-2026-05-10.md`](./tcf-canada-snapshots/landing-2026-05-10.md) and [`samples-2026-05-10.md`](./tcf-canada-snapshots/samples-2026-05-10.md).

### 7.2 Council of Europe + Beacco position

The Conseil de l'Europe defers to per-language operationalizations published as the **Référentiel des contenus d'apprentissage du FLE (Beacco/Porquier series)**. These reference works define per-CEFR lexical inventories for French.

> **⚠️ The numbers below are operator-derived rough caps, NOT Beacco-verbatim.** Beacco's actual per-volume "Inventaire général" sections give specific numbers that Epic 10.4 MUST source from the published volumes (Didier 2007–2011 series) before locking in prompt-builder caps. The values here are common rough rules of thumb that vary across pedagogy literature — using them as caps without verifying against a sourced Beacco edition risks under-targeting (A1 too narrow) or over-targeting (B2 too wide).

| CEFR | Rough cap (operator-derived heuristic; verify against Beacco)  |
| ---- | -------------------------------------------------------------- |
| A1   | ~500–900 most-frequent words                                   |
| A2   | ~1500–1800                                                     |
| B1   | ~2500–3000                                                     |
| B2   | ~5000+                                                         |
| C1   | 5000+ including specialized lexicon (Beacco "Inventaire" tier) |
| C2   | ~10000+ with literary/archaic/regional registers               |

**Owner: Epic 10.4** must (a) acquire the Beacco _Niveau A1/A2/B1/B2 pour le français_ volumes (Didier), (b) extract the verbatim per-CEFR "Inventaire général" word counts and word lists, (c) replace the table above with sourced numbers + page citations, and (d) implement the prompt-builder caps using the actual word lists, not just a numeric cap.

### 7.3 Implication for the codebase

**The codebase has zero vocabulary frequency caps in prompts today** (audit P1-4). Epic 10.4 will use the Beacco-derived word lists to add explicit "do not exceed level" constraints to prompt builders.

## 8. Linguistic accuracy reference

### 8.1 "Force est de constater" — fixed expression, not connector

Per Le Bon Usage (Grevisse) and the Trésor de la langue française, _force est de_ + infinitive is a **fixed expression** (locution verbale figée) meaning "one must / it is necessary to." It is NOT a connector or transitional adverbial. The codebase's [src/lib/prompts/conversation.ts](../src/lib/prompts/conversation.ts) reportedly classifies it as a connector (audit P2-2). **Owner: Epic 10.7.**

### 8.2 CEFR labels in French

**There is no single canonical French short-label per CEFR level.** Different French institutional sources use different conventions:

| Level | Service-Public.gouv.fr | Eduscol (Min. Éducation) | Beacco / Didier _Niveau X pour le français_ | Alliance Française (school convention) |
| ----- | ---------------------- | ------------------------ | ------------------------------------------- | -------------------------------------- |
| A1    | Élémentaire            | A1 (introductif)         | A1                                          | Élémentaire 1                          |
| A2    | Élémentaire            | A2 (intermédiaire)       | A2                                          | Élémentaire 2                          |
| B1    | Indépendant            | B1 (seuil)               | B1                                          | Intermédiaire 1                        |
| B2    | Indépendant            | B2 (avancé)              | B2                                          | Intermédiaire 2                        |
| C1    | Expérimenté            | C1 (autonome)            | C1                                          | Avancé 1                               |
| C2    | Expérimenté            | C2 (maîtrise)            | C2                                          | Avancé 2                               |

The CEFR Companion Volume (2018) §3 also recognizes informal sub-levels A2.1 / A2.2 (= A2+), where A2+ is informally rendered "élémentaire avancé" in some FLE-pedagogy schools.

**Codebase implications:** [src/types/cefr.ts:33](../src/types/cefr.ts#L33) labels A2 as `nameFr: "Élémentaire avancé"` — informal / non-canonical (not in the four institutional conventions above; closest match is "A2+" from the Companion Volume). For consistency, Epic 10.7 should pick **one** convention and apply it across all six levels. The Service-Public.gouv.fr 3-tier convention (Élémentaire / Indépendant / Expérimenté) is the simplest French-government-source-of-truth; Eduscol's CEFR-bracketed convention is the Ministry of Education default. **Owner: Epic 10.7** (decision: pick one, document in CLAUDE.md, apply to `nameFr` for all six levels).

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
2. **Recalibrate composite scoring** — **DONE — closed by Story 10-2 on 2026-05-10.** The 7-band linear `rawToTCFScore` was deleted and replaced with per-skill conversion functions (`rawPercentToListeningReadingScore` for 0–699 QCM skills; `rawPercentToWritingSpeakingScore` for 0–20 production-task skills) anchored to the IRCC CLB equivalency table at `src/lib/ircc-bands.ts`. The composite was renamed to `calculateInternalCompositeForUI` and JSDoc-flagged as NOT IRCC-equivalent and NOT used by the promotion engine; `SKILL_WEIGHTS_TCF_CANADA` (4-skill, equal 0.25) replaced the prior 5-skill weighting. Speaking pipeline now persists publisher-scale 0–20 to `mock_tests.total_score`. See `CLAUDE.md` "TCF scoring pipeline (per-skill, publisher-anchored)" architecture line.
3. **Add Writing pipeline to mock test** — **PARTIAL** — calibration scope **closed by Story 10-3 on 2026-05-10** (per-task word ranges in `src/lib/prompts/writing.ts` corrected to publisher-verbatim §5.1, §5.3 disqualification rule surfaced in the system prompt, `writingTaskWordRange` helper added as single source of truth, `src/hooks/use-exercise.ts` writing flow updated). Writing-pipeline-in-mock-test wiring (UI + persistence + scoring routing through `rawPercentToWritingSpeakingScore`) remains **DEFERRED to a future Epic 10.6 sub-story or new Epic 10.X**.
4. ~~**Add Speaking pipeline to mock test**~~ **DONE — landed by story 9-8 on 2026-05-09** as a record-and-grade flow. See `app/(tabs)/mock-test/speaking.tsx` and `src/lib/prompts/speaking.ts`. Section 6 documents the publisher's spec; story 9-8 implementation aligns on durations + structure.
5. **Fix `shippable-roadmap.md` P0-1 line** — **DONE — closed by story 10-1 (this story).** The audit's specific numbers were partially wrong; footnote added in `shippable-roadmap.md`. See [Citations Matrix](./tcf-spec-citations.md) for the cross-reference.
6. **Update PRD** — **DONE.** PR #57 (re-PR of stranded PR #55) landed the PRD on main on 2026-05-10. Story 10-1's pedagogy follow-up patch round then updated lines 113 + 235 + 496 (FR28) from TCF Tout Public language to TCF Canada language. Citations matrix §7 reflects ✓ Verified.
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
