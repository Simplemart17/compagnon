---
title: "Manuel du candidat TCF — Expression Orale rubric transcription"
source_pdf: "manuel-candidat-tcf-FR-2026-05-11.pdf"
source_pdf_sha256: "2ee5d4d531b5f135af950a475bac09338b611b6822e641659fd42304affe7725"
source_pdf_size_bytes: 3111833
source_pdf_pages: 66
publisher: "France Éducation International"
edition: "Version P, avril 2026"
download_url: "https://www.france-education-international.fr/test/tcf-canada (Documents à télécharger section)"
language: "fr"
retrieval_date: "2026-05-11"
transcribed_by: "Operator (manual download) + claude-opus-4-7[1m] (pdftotext extraction + verbatim transcription)"
story: "10-11 — Phase-2 speaking rubric (artifact prerequisite)"
license_note: "© France Éducation International. Reproduction here is for the project's internal CEFR-pedagogy verification. Distribution requires FEI permission."
---

# Manuel du candidat TCF — Expression Orale rubric transcription

This snapshot is the artifact prerequisite for **Story 10-11** (`_bmad-output/implementation-artifacts/10-11-phase2-speaking-9-criterion.md`). It transcribes the Expression Orale-relevant sections of the publisher's _Manuel du candidat TCF_ (Version P, avril 2026) verbatim from the official PDF downloaded by the operator from https://www.france-education-international.fr.

---

## 🚨 Analyst's note — MATERIAL DIVERGENCE FROM §6.3 PREDICTION

**`docs/tcf-spec-source.md §6.3` predicted a "9-criterion (3 publisher categories × 3 sub-criteria each)" breakdown** that would be published in the Manuel and unlock a Phase-2 rubric upgrade from Story 10-6's 5-dimension proxy.

**The Manuel does NOT publish a 9-sub-criterion breakdown.** It publishes:

1. **3 evaluation categories** (`linguistique` / `pragmatique` / `sociolinguistique`) — each with a parenthetical list of features (étendue du lexique, correction grammaticale, etc.) framed with `etc.` to indicate the list is illustrative, not exhaustive.
2. **Per-task holistic A1-non-atteint → C2 rating** — each of the 3 Expression Orale tasks is rated as a single CEFR level by each evaluator. There is NO per-sub-criterion 0-20 scoring in the publisher's published material.
3. **Double-blind 2-evaluator correction** — 2 × 3 = 6 CEFR-level ratings combined via an undisclosed "règle de calcul" (calculation rule) into a final 0-20 score + 1 final CEFR level.
4. A **grille d'interprétation** mapping 0-20 score bands ↔ CEFR levels (transcribed in §3 below).

**Implications for Story 10-11 scope:**

- The 9-sub-criterion schema-extension predicted by §6.3 + AC #2 of Story 10-11 is **not supported by the publisher's published rubric**. Pursuing it would invent finer granularity than the publisher itself uses.
- Story 10-6's 5-dimension proxy schema is actually **MORE granular** than the Manuel's 3-category-plus-holistic rating, not less.
- The genuine Phase-2 improvement available from this snapshot is **NOT "extend to 9 sub-criteria"** — it is one or more of:
  1. **Add per-task holistic CEFR-level rating field** to `speakingTaskEvaluationSchema` alongside the 5-dim scores, matching how the publisher actually rates each task.
  2. **Document the "règle de calcul" as undisclosed** in `docs/tcf-spec-source.md §6.4` and update `computeSpeakingTaskOverall` / `computeSpeakingComposite` JSDoc to acknowledge the publisher's official combination rule is opaque (the current per-task × 1.0 / 3-task-average heuristic is the best public-information approximation).
  3. **Cross-reference the grille d'interprétation** (§3 below) in `src/lib/ircc-bands.ts` for Expression Orale score-to-CEFR mapping; verify against the existing IRCC CLB table at `docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md`.
- Story 10-11 should be **rescoped or replaced** before promotion to `ready-for-dev`. Recommended action: file a new "Story 10-11b — Per-task CEFR rating + grille d'interprétation pin" with the actionable scope from this snapshot, and mark 10-11 (as currently drafted) as **REJECTED — §6.3 prediction not supported by publisher**.

This is exactly the divergence Story 10-11's spec anticipated and instructed the operator to flag.

---

## §1. Expression Orale — 3 Tasks (verbatim, Manuel pp. 18-19)

Source: lines 660-701 of `/tmp/manuel-tcf-full.txt` (extracted via `pdftotext -layout` from the source PDF).

> **Épreuve d'expression orale : 3 tâches :**
>
> - **Tâche 1 – Entretien dirigé sans préparation :**
>
>   Durée de l'échange : 2 minutes pour les TCF TP, Canada et Québec / 3 minutes pour le TCF IRN
>
>   Objectif de la tâche : le candidat fait preuve de sa capacité à échanger avec une personne qu'il ne connaît pas (l'examinateur).
>
> - **Tâche 2 – Exercice en interaction avec préparation pour les TCF TP, Canada et Québec / sans préparation pour le TCF IRN :**
>
>   Durée de l'échange : 3 minutes 30 de dialogue (plus 2 minutes de temps de préparation, sauf pour le TCF IRN)
>
>   Objectif de la tâche : le candidat fait preuve de sa capacité à obtenir des informations dans une situation de la vie quotidienne courante. Le statut de l'interlocuteur et du candidat sont précisés dans la consigne.
>
> - **Tâche 3 – Expression d'un point de vue sans préparation :**
>
>   Durée de l'échange : 4 minutes 30 pour les TCF TP, Canada et Québec / 3 minutes 30 pour le TCF IRN
>
>   Objectif de la tâche : le candidat fait preuve de sa capacité à parler de manière spontanée, continue et convaincante en répondant à une question choisie par l'examinateur. L'examinateur est autorisé à interrompre le candidat en lui posant des questions en lien avec l'expression de son point de vue (par exemple pour lui demander des précisions sur ses arguments).
>
> **Dans cette épreuve, le candidat est évalué sur ses capacités à :**
>
> - parler de soi, de son environnement familial et professionnel ;
> - poser des questions adaptées à la situation de communication proposée ;
> - donner son opinion et expliquer les avantages et inconvénients d'un projet, exprimer son accord et son désaccord ;
> - présenter une argumentation claire et structurée dans un style approprié au contexte ;
> - présenter de façon détaillée et structurée des sujets complexes, les développer et conclure.

**Cross-reference to existing project:**

- Per-task durations confirm Story 9-8 / `src/lib/prompts/speaking.ts` `TASK_DURATIONS` (Task 1: 120s, Task 2: 330s incl. 2-min prep, Task 3: 270s). ✓ Verified.
- Task 2 prep-window confirms `docs/tcf-spec-source.md §6.1` and Story 10-6's Task 2 prep-window evaluator instruction. ✓ Verified.
- The 5 "capacités" features above are NOT separately scored — they describe what the task is designed to elicit. They map informally onto Story 10-6's 5 dimensions but are not 1:1.

---

## §2. Expression Orale — Evaluation Criteria + Correction Process (verbatim, Manuel p. 20-21)

Source: lines 792-820 of `/tmp/manuel-tcf-full.txt`.

> **L'évaluation des épreuves d'expression orale**
>
> Les épreuves d'expression orale (EO) sont évaluées une première fois par l'examinateur qui a suivi une formation d'habilitation dispensée par France Éducation international et qui mène et enregistre l'entretien dans le centre le jour de la passation. L'enregistrement est ensuite envoyé à un correcteur également formé par France Éducation international.
>
> Ces 2 évaluations sont effectuées de manière totalement indépendante et en double aveugle (sans que l'un ou l'autre n'ait connaissance des niveaux attribués par l'autre).
>
> L'examinateur et le correcteur attribuent à chacune des 3 tâches un niveau allant du niveau « A1 non atteint » au niveau « C2 ». Une règle de calcul prenant en compte les 6 niveaux attribués donne lieu à une note finale et un niveau final. Dans les rares cas où un écart important est constaté entre deux correcteurs, une troisième correction est systématiquement effectuée.
>
> **Les critères d'évaluation de cette épreuve d'expression orale sont d'ordre :**
>
> - **linguistique** (étendue et maîtrise du lexique, correction grammaticale, aisance, prononciation, fluidité globale du discours, etc.) ;
> - **pragmatique** (interaction, structuration du discours, cohérence et cohésion, développement thématique, etc.) ;
> - **sociolinguistique** (adéquation à la situation de communication).
>
> **ATTENTION !** L'épreuve d'expression orale pourrait être évaluée « A1 non atteint » si le candidat récite un ou des textes appris par cœur.
> En effet, une récitation est considérée comme non représentatif du niveau réel du candidat et peut donc être considéré comme une fraude.

**Key structural facts (analyst extraction):**

| Aspect                                | Manuel's published structure                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Number of criterion categories        | **3** (linguistique / pragmatique / sociolinguistique)                                                                                                                                                 |
| Features per category                 | Variable, all flagged with `etc.` (i.e., illustrative). Linguistique lists 5 features; Pragmatique lists 4 features; Sociolinguistique lists 1 feature ("adéquation à la situation de communication"). |
| Per-criterion scoring scale published | **None** — the Manuel does NOT publish 0-6 / 0-4 / 0-20 per-criterion scores.                                                                                                                          |
| Per-task scoring scale published      | **CEFR level** (A1-non-atteint → C2) per task; **2 evaluators** × **3 tasks** = 6 levels per candidate.                                                                                                |
| Combination rule                      | **Undisclosed** — Manuel says "Une règle de calcul prenant en compte les 6 niveaux attribués donne lieu à une note finale et un niveau final" without specifying the rule.                             |
| A1-non-atteint disqualifier (EO)      | Recitation of memorized text → considered fraud → rated A1-non-atteint regardless of content quality.                                                                                                  |

---

## §3. Grille d'interprétation des scores (verbatim, Manuel p. 25)

Source: lines 984-1026 of `/tmp/manuel-tcf-full.txt`.

> La grille d'interprétation des scores (pour les QCM) et des notes (pour l'expression orale et l'expression écrite) est la suivante :

| CEFR level                | QCM score (0-699) | Expression score (0-20) | Manuel descriptor (verbatim, condensed)                                                                                                                                                                                                                                         |
| ------------------------- | ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1                        | 101 à 199         | **1/20**                | Maitrise de base du français. La personne est capable de comprendre des situations simples et concrètes se rapportant à la vie quotidienne. Elle peut communiquer de façon simple si l'interlocuteur parle lentement.                                                           |
| Élémentaire avancé (A2)   | 200 à 299         | **2 à 5/20**            | Maîtrise élémentaire de la langue. La personne peut comprendre des phrases isolées portant sur des domaines familiers. Elle peut communiquer dans des situations courantes et évoquer avec des moyens simples des questions qui la concernent.                                  |
| Niveau B1                 | 300 à 399         | **6 à 9/20**            | Maîtrise efficace mais limitée de la langue. La personne comprend un langage clair et standard s'il s'agit d'un domaine familier. Elle peut se débrouiller en voyage, parler de ses centres d'intérêt et donner de brèves explications sur un projet ou une idée.               |
| Intermédiaire avancé (B2) | 400 à 499         | **10 à 13/20**          | Maîtrise générale et spontanée de la langue. La personne peut comprendre l'essentiel d'un texte complexe. Elle peut participer à une conversation sur un sujet général ou professionnel de façon claire et détaillée en donnant des avis argumentés.                            |
| Niveau C1                 | 500 à 599         | **14 à 17/20**          | Bonne maîtrise de la langue. La personne peut comprendre une grande gamme de textes longs et exigeants comportant des contenus implicites. Elle s'exprime couramment et de façon bien structurée sur sa vie sociale, professionnelle ou académique et sur des sujets complexes. |
| Supérieur avancé (C2)     | 600 à 699         | **18 à 20/20**          | Excellente maîtrise de la langue. La personne comprend sans effort pratiquement tout ce qu'elle lit ou entend et peut tout résumer de façon cohérente. Elle s'exprime très couramment et de façon différenciée et nuancée sur des sujets complexes.                             |

> Ces grilles de niveaux sont extraites du _Cadre européen commun de référence pour les langues : apprendre, enseigner, évaluer_, ©Conseil de l'Europe, Didier, Paris 2001

**Analyst note — Manuel uses the labels "Élémentaire avancé" (A2) and "Intermédiaire avancé" (B2)** — the same labels Story 10-7 deleted from `CEFR_LEVELS.nameFr` per §8.2 audit P2-2 (replaced with Alliance Française "Élémentaire 2" / "Intermédiaire 2"). This **does NOT invalidate Story 10-7's fix** — §8.2 documents that there is no single canonical French short-label per CEFR level; the Manuel uses one convention, Alliance Française uses another, both are acceptable institutional sources. Story 10-7 picked Alliance Française deliberately because A1/A2 would collapse to identical labels under the Service-Public 3-tier convention; the Manuel doesn't have that problem because it puts the CEFR code (A2 / B2) alongside the descriptor. The two conventions coexist; the app uses Alliance Française for the `nameFr` display labels.

---

## §4. TCF Canada-specific Expression Orale parameters (verbatim, Manuel p. 13)

Source: lines 467-481.

| Parameter       | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Total duration  | 12 minutes                                              |
| Number of tasks | 3                                                       |
| Format          | Épreuve individuelle en face à face avec un examinateur |
| Output          | Note sur 20 + niveau A1-non-atteint → C2                |

---

## §5. Cross-Project Implications

| Existing project surface                                                             | Verification result vs Manuel                                                                                                                                                                                                                                   | Action                                                                                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/prompts/speaking.ts` `TASK_DURATIONS` (120/330/270)                         | ✓ Matches Manuel §1 above (Task 1 = 2 min; Task 2 = 3:30 + 2 min prep; Task 3 = 4:30)                                                                                                                                                                           | None — verified-correct                                                                                                                  |
| `src/lib/prompts/speaking.ts` Task 2 prep-window evaluator instruction (Story 10-6)  | ✓ Matches Manuel §1 "plus 2 minutes de temps de préparation"                                                                                                                                                                                                    | None — verified-correct                                                                                                                  |
| `src/lib/schemas/ai-responses.ts` `speakingTaskEvaluationSchema` (5-dim, Story 10-6) | ⚠ MORE granular than publisher's 3 categories. NOT a defect — operator-derived per-feature scoring is a reasonable approximation of the holistic per-task rating.                                                                                               | None — see Story 10-11 rescope below                                                                                                     |
| `src/lib/speaking-scoring.ts` `RUBRIC_TO_COMPOSITE = 1.0` (5-dim × 0-20 → 0-100)     | ⚠ Approximates the publisher's undisclosed "règle de calcul".                                                                                                                                                                                                   | None — JSDoc could be updated to note the publisher rule is opaque                                                                       |
| `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS`                                             | Verify Expression Orale 0-20 → CEFR band mapping against the grille d'interprétation in §3 above. Per IRCC table snapshot (`docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md`) the CLB mapping uses TCF 0-20 EO/EE bands; the Manuel grille aligns. | None — verified-correct                                                                                                                  |
| `docs/tcf-spec-source.md §6.3` "9-criterion DEFERRED" claim                          | ❌ INCORRECT — the publisher does not publish 9 sub-criteria. The prediction was an inference, not a citation.                                                                                                                                                  | Update §6.3 — strike the "9-criterion" prediction; cite this snapshot for the verbatim 3-category structure.                             |
| `_bmad-output/implementation-artifacts/10-11-phase2-speaking-9-criterion.md` (draft) | ❌ Scope premise (extend schema to 9 sub-criteria) NOT supported by publisher                                                                                                                                                                                   | Rescope or REJECT as drafted; file 10-11b with actionable per-task CEFR-rating addition (see "Implications" section at top of this file) |

---

## §6. Items NOT Found in the Manuel (operator-verified)

For completeness — items that `docs/tcf-spec-source.md §5.4` or §6.3 expected to find in the Manuel but which are absent from the **candidate-facing** Version P (avril 2026) PDF:

- **Per-criterion 0-6 / 0-4 scoring scales** — §5.4 references these for Expression Écrite. The candidate-facing Manuel publishes only the holistic per-task CEFR rating; per-criterion fine-grained scoring (if it exists at all in FEI's examiner-training materials) is NOT in this PDF.
- **9-sub-criterion breakdown** for Expression Orale — see Analyst's note above.
- **Detailed sub-criterion descriptors** per criterion — only the parenthetical `etc.`-flagged feature lists in §2 above.
- **The undisclosed "règle de calcul"** combining 6 CEFR-level ratings into a final 0-20 score — Manuel acknowledges its existence but does not publish the rule.

These absences are themselves valuable data — the verbatim public-information rubric is the 3-category-plus-holistic-rating structure, full stop. Future Phase-2 work should not pursue finer granularity than the publisher itself publishes; instead, it should match the publisher's actual structure more faithfully.

---

## §7. Re-verification procedure

This snapshot was extracted via `pdftotext -layout` from the operator-downloaded PDF at retrieval date 2026-05-11 (Manuel version P, avril 2026). To re-verify when FEI publishes a new edition:

1. Operator re-downloads the PDF from https://www.france-education-international.fr/test/tcf-canada (Documents à télécharger section).
2. Operator saves at `docs/tcf-canada-snapshots/manuel-candidat-tcf-FR-<YYYY-MM-DD>.pdf`.
3. Compute SHA-256 of the new PDF; compare to the `source_pdf_sha256` field in this file's frontmatter. If unchanged → no update needed. If changed → continue.
4. Re-extract text: `pdftotext -layout <new.pdf> /tmp/manuel-tcf-new.txt`.
5. Diff the Expression Orale section (search for "L'évaluation des épreuves d'expression orale" + "Épreuve d'expression orale : 3 tâches" + "La grille d'interprétation des scores").
6. Update §§1-4 of this file with new verbatim transcription; bump frontmatter `retrieval_date` + `edition`; recompute `source_pdf_sha256`.
7. Re-check the §5 cross-project implications table — any changes propagate to story file scope.
