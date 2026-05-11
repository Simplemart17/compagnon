# Story 10.4: Vocabulary Frequency Caps

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TCF Canada candidate whose AI-generated practice content today includes vocabulary that the model freely chooses without any per-CEFR frequency constraint — the audit explicitly flagged P1-4 ("No vocabulary frequency caps in prompts — 'A1 vocab' is whatever the model decides") and the source-of-truth at [`docs/tcf-spec-source.md §7.3`](docs/tcf-spec-source.md) confirms **"the codebase has zero vocabulary frequency caps in prompts today"** — meaning an A1 listening passage may legitimately contain `cependant`, `néanmoins`, or `force est de constater` (all C1+ register), and a C1 reading prompt may use only top-300 words and call itself C1, with no observable enforcement either direction,
I want every CEFR-aware prompt builder ([listening.ts](src/lib/prompts/listening.ts), [reading.ts](src/lib/prompts/reading.ts), [writing.ts](src/lib/prompts/writing.ts), [conversation.ts](src/lib/prompts/conversation.ts), [echo.ts](src/lib/prompts/echo.ts), [translation.ts](src/lib/prompts/translation.ts), [speaking.ts](src/lib/prompts/speaking.ts), [mock-test.ts](src/lib/prompts/mock-test.ts)) to surface a per-CEFR **vocabulary frequency tier** to the AI — including a numeric word-count cap (per `docs/tcf-spec-source.md §7.2` operator-derived heuristics: A1 ~500–900 / A2 ~1500–1800 / B1 ~2500–3000 / B2 ~5000+ / C1 5000+ specialized / C2 10000+), a small **curated exemplar list** of high-frequency French words per level (10–20 per level, sourced from open Wiktionary frequency lists), and a small **forbidden-tier list** of words / connectors that must NOT appear at lower levels (per `docs/tcf-spec-source.md §8.1` — `force est de constater` is C1+, `néanmoins` / `toutefois` / `en l'occurrence` are C1+, `cependant` / `par conséquent` are B1+, etc.) — all of this fed into prompts as an explicit "Vocabulary Constraint" block parallel to Story 10-3's `## Publisher Word Count Enforcement` block,
so that **the practice content the app generates respects the same lexical-density constraints a real TCF Canada candidate is graded against** — closing audit finding **P1-4**, unblocking the Epic 10 acceptance criterion *"a French-pedagogy review returns no severity-HIGH findings"* (which today fails on `/lib/prompts/conversation.ts` "Force est de constater" misclassification + the broader vocab-tier silence), and providing the lexical-tier surface that Epic 10.7 (linguistic accuracy pass) and Epic 10.5 (placement test prompt extraction) both depend on for their own CEFR-calibration claims to be enforceable.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged one consolidated P1 release-quality finding tied to vocabulary frequency:

> **P1-4:** "No vocabulary frequency caps in prompts — 'A1 vocab' is whatever the model decides." — Files: `src/lib/prompts/*.ts`. Source agent: pedagogy.

Story 10-1 (2026-05-10) sourced the publisher's position at [`docs/tcf-spec-source.md §7.1`](docs/tcf-spec-source.md):

> "The publisher (FEI) does NOT publish per-CEFR vocabulary frequency tier requirements." — Confirmed against `landing-2026-05-10.md` and `samples-2026-05-10.md`.

Without a publisher-verbatim spec, the Council of Europe defers to per-language operationalizations published as the **Référentiel des contenus d'apprentissage du FLE (Beacco / Porquier series, Didier 2007–2011)** ([§7.2](docs/tcf-spec-source.md)). The source-of-truth flags an **explicit operator-action item** at §7.2:

> *"⚠️ The numbers below are operator-derived rough caps, NOT Beacco-verbatim. Beacco's actual per-volume 'Inventaire général' sections give specific numbers that **Epic 10.4 MUST source from the published volumes** (Didier 2007–2011 series) before locking in prompt-builder caps. The values here are common rough rules of thumb that vary across pedagogy literature — using them as caps without verifying against a sourced Beacco edition risks under-targeting (A1 too narrow) or over-targeting (B2 too wide)."*

And at the bottom: *"Owner: Epic 10.4 must (a) acquire the Beacco _Niveau A1/A2/B1/B2 pour le français_ volumes (Didier), (b) extract the verbatim per-CEFR 'Inventaire général' word counts and word lists, (c) replace the table above with sourced numbers + page citations, and (d) implement the prompt-builder caps using the actual word lists, not just a numeric cap."*

The citations matrix at [`docs/tcf-spec-citations.md §9`](docs/tcf-spec-citations.md) marks this as **🟡 GAP — no current code; Epic 10.4 will use this section to embed top-N lists. Owner: Epic 10.4 (P1-4)**.

### The operator-action blocker — why this story splits into Phase 1 + Phase 2

The Beacco _Niveau X pour le français_ volumes are paywalled academic publications (Didier, ~€30–€45 per volume × 4 volumes). The dev agent cannot fetch them via WebSearch / WebFetch. Two paths:

- **Phase 1 (this story):** ship a defensible heuristic-tier framework — numeric caps from §7.2 + curated exemplar lists + forbidden-tier lists — sourced from open materials (Wiktionary "1000 mots les plus fréquents en français" CC-BY-SA list + the connector / register guidance already documented in `docs/tcf-spec-source.md §8`). Heuristic caps are documented as not-Beacco-verbatim.
- **Phase 2 (deferred sub-story):** when the operator delivers the Beacco volumes (operator-action TODO), replace the heuristic numbers with verbatim "Inventaire général" word counts + extracted per-CEFR word lists. Filed as new follow-up `10-4-beacco-verbatim-replacement` (or absorbed into Epic 10.X), citations matrix §9 row stays ✓ Verified-with-caveat until Beacco data lands.

This is the same defer-with-doc pattern as Story 10-3's writing-pipeline-in-mock-test deferral, and Story 10-1's `Manuel du candidat TCF` operator-action.

### Threat / failure model — what cannot happen post-story

After this story:

1. **Every CEFR-aware prompt builder** in `src/lib/prompts/` carries a per-level vocabulary-tier block sourced from a single helper (`src/lib/prompts/vocabulary-tiers.ts`) — no two-site drift.
2. **The AI sees an explicit numeric cap** ("approximate distinct-word-form ceiling") per level in every CEFR-tagged generation block, parallel to Story 10-3's `## Publisher Word Count Enforcement` section.
3. **The AI sees an exemplar-list nudge** for each level — a small (10–20-word) hand-curated list of canonical high-frequency French words at that tier (sourced from Wiktionary's open "Liste des 1000 mots les plus fréquents en français" + Echelle DGLF basic-tier vocabulary). The list is not exhaustive; it's a calibration anchor.
4. **The AI sees a forbidden-tier list** for each level — connectors / words that must NOT appear at this level or lower (e.g., A1 must not contain `néanmoins` / `toutefois` / `cependant` / `force est de constater` / `en l'occurrence`). This is the most enforcement-grade signal because it's verifiable: a regression test can substring-check the AI output for forbidden tokens at low CEFR levels.
5. **A new `vocabulary-tiers.ts` module** lives at `src/lib/prompts/vocabulary-tiers.ts` and exports:
   - `vocabularyTier(cefrLevel)` returns `{ approxWordCap, exemplars, forbiddenLowerTier }`
   - `buildVocabularyConstraintBlock(cefrLevel)` returns a markdown string ready to drop into any prompt
6. **Story 9-4's stored-prompt-injection defense holds:** the new vocabulary-constraint block is statically built from a controlled module — no user input flows through it. The exemplar/forbidden lists are constant-time module exports, not user-derived strings, so no XSS-into-prompt risk.
7. **Citations matrix §9 row flips from 🟡 GAP to ✓ Verified-with-caveat** — the caveat is the Beacco-verbatim deferral. A new row is added for `vocabulary-tiers.ts` with anchor §7.2 + status reflecting the heuristic-tier scope.
8. **`docs/tcf-spec-source.md §7.3`** is updated from "the codebase has zero vocabulary frequency caps" to "post-Epic-10.4, all CEFR-aware prompts carry heuristic-tier caps + exemplar/forbidden lists from `src/lib/prompts/vocabulary-tiers.ts`; Beacco-verbatim replacement deferred per §10b operator-action."
9. **`docs/tcf-spec-source.md §10b` (pending operator actions)** gains a new item #5: "Acquire Beacco _Niveau A1/A2/B1/B2 pour le français_ volumes (Didier 2007–2011) → extract verbatim 'Inventaire général' word counts + word lists → file follow-up sub-story to replace `vocabulary-tiers.ts` heuristics with publisher-grade data."
10. **`docs/tcf-spec-source.md §10` follow-up** — currently no #9; this story adds **DONE — closed by Story 10-4 (Phase 1, heuristic-tier scope; Beacco-verbatim replacement deferred)** as a new follow-up entry.
11. **`CLAUDE.md`** gains a new architecture line for the per-CEFR vocabulary tiers, parallel to the 10-3 line.
12. **The §8.1 fix on conversation.ts** ("Force est de constater" misclassification) is **NOT** in scope here — that's Epic 10.7 (linguistic accuracy pass). 10-4 only adds the forbidden-tier list that flags such words at lower levels; the C1-C2 connector-list comment in `writing.ts` cohesion criteria stays intact.
13. **No existing prompt's per-level qualitative content is rewritten** — 10-4 *adds* a Vocabulary Constraint block; it does not delete or restructure the existing `LEVEL_CONTENT` / `LEVEL_GUIDELINES` blocks (those are owned by 10-3 / 10-7).

**Out of scope for this story (delegated elsewhere):**

- **Beacco-verbatim word lists + page citations** → **deferred Phase 2** (operator-action blocker; new follow-up sub-story under Epic 10 when Beacco volumes are acquired).
- **Placement test prompt extraction** to `src/lib/prompts/placement.ts` → **Epic 10.5**.
- **Speaking rubric deepening** (5th `sociolinguisticScore` dimension) → **Epic 10.6**.
- **Linguistic accuracy fixes** ("Force est de constater" misclassification, CEFR `nameFr` labels, Québécois prompt rewrite, voice-mode emoji removal) → **Epic 10.7**. Story 10-4 only flags `force est de constater` as forbidden at lower levels via the new forbidden-tier list; the existing misclassification in `conversation.ts` stays for Epic 10.7 to fix.
- **Anti-cheat / anti-repetition** → **Epic 10.8**.
- **Runtime AI-output validation against the forbidden-tier list** (e.g., post-generation a Zod-style check that rejects an A1 passage containing `néanmoins`) — **deferred to a future hardening story**. 10-4 only adds prompt-time guidance; a runtime guard is a separate UX decision (warn user? regenerate? reject?). Documenting the gap.
- **Per-CEFR forbidden-tier coverage of every word** — the lists are calibration anchors, not exhaustive dictionaries. 10–20 exemplars + 10–20 forbidden tokens per level. A future story (or Beacco-Phase-2) deepens coverage.
- **Database migrations / Edge Function changes** — vocabulary tiers are static module exports; no schema change.
- **Backfill of historical generated content** — pre-10-4 exercises stay as-is; new generations apply the new constraints.
- **`grammar.ts` prompts** — Grammar is operator-decided as a non-TCF practice skill (per `tcf-spec-source.md §10` follow-up #1). 10-4 does not touch `grammar.ts`. *(If `grammar.ts` is CEFR-aware and would benefit from the same vocab tier, that's a Phase-2 polish item.)*
- **Multi-language vocabulary tiers** — French only. The Québécois variant is deferred to v2 per audit decision D5.

## Acceptance Criteria

### 1. Create `src/lib/prompts/vocabulary-tiers.ts` (NEW)

The new module is the single source of truth for per-CEFR vocabulary constraints. Lives parallel to `src/lib/prompts/writing.ts` `writingTaskWordRange` (Story 10-3's pattern).

- [x] **CREATE** `src/lib/prompts/vocabulary-tiers.ts` exporting:
  ```typescript
  /**
   * Per-CEFR vocabulary-frequency tiers for prompt-builder consumption.
   *
   * Source: `docs/tcf-spec-source.md §7.2` (operator-derived heuristic
   * caps; NOT Beacco-verbatim — operator-action TODO per §10b to fetch
   * Beacco _Niveau A1/A2/B1/B2 pour le français_ volumes and replace
   * these numbers with publisher-grade data in a Phase-2 follow-up).
   *
   * Exemplars: 10-20 hand-curated high-frequency French words per level,
   * sourced from Wiktionary "Liste des 1000 mots les plus fréquents en
   * français" (CC-BY-SA) + Échelle DGLF / Service-Public.gouv.fr usage
   * frequency. Used as calibration anchors for the AI; NOT exhaustive
   * dictionaries.
   *
   * Forbidden-tier: words / connectors that must NOT appear at this
   * level or lower. Sourced from `docs/tcf-spec-source.md §8.1` (e.g.,
   * `force est de constater` is C1+) plus FLE-pedagogy connector
   * conventions.
   *
   * Citations: `docs/tcf-spec-citations.md §9` row flips 🟡 GAP →
   * ✓ Verified-with-caveat by this story.
   */
  export interface VocabularyTier {
    approxWordCap: number;       // approximate distinct-word-form ceiling
    capRationale: string;         // human-readable explanation tying back to §7.2
    exemplars: string[];          // 10-20 canonical high-frequency French words at this tier
    forbiddenLowerTier: string[]; // words/connectors that must NOT appear at this level or lower
  }

  export function vocabularyTier(cefrLevel: CEFRLevel): VocabularyTier { ... }

  /**
   * Build the markdown "Vocabulary Constraint" block ready to drop into
   * any CEFR-aware prompt. Renders as a structured block with:
   *  - the numeric cap + rationale citation
   *  - the exemplar list
   *  - the forbidden-tier list (only for levels where it has entries)
   */
  export function buildVocabularyConstraintBlock(cefrLevel: CEFRLevel): string { ... }
  ```
- [x] Caps per `docs/tcf-spec-source.md §7.2` (heuristic, not Beacco-verbatim):
  - **A1:** approxWordCap = 700 (midpoint of §7.2 range 500-900)
  - **A2:** approxWordCap = 1700 (midpoint of 1500-1800)
  - **B1:** approxWordCap = 2800 (midpoint of 2500-3000)
  - **B2:** approxWordCap = 5000 (floor of "5000+")
  - **C1:** approxWordCap = 7500 (5000+ specialized → midpoint with C2)
  - **C2:** approxWordCap = 10000 (floor of "10000+")
- [x] Exemplars per level (10-20 each, hand-curated; do NOT need to be exhaustive — calibration anchors only):
  - **A1:** `bonjour`, `merci`, `oui`, `non`, `je`, `tu`, `manger`, `boire`, `aller`, `venir`, `petit`, `grand`, `rouge`, `bleu`, `un`, `deux`, `aujourd'hui`, `demain`, `maison`, `école`
  - **A2:** `cependant` *(NOT — this is B1+; demonstrates negative selection at A2)*, `parce que`, `mais`, `et`, `aussi`, `très`, `souvent`, `parfois`, `voyage`, `travail`, `famille`, `temps libre`, `acheter`, `vendre`, `essayer`, `pouvoir`, `vouloir`, `devoir`
  - **B1:** `cependant`, `pourtant`, `donc`, `alors`, `parce que`, `vacances`, `travailler`, `apprendre`, `expérience`, `opinion`, `proposer`, `imaginer`, `expliquer`, `comprendre`, `dépendre`, `convenir`
  - **B2:** `néanmoins` *(NOT — C1+)*, `cependant`, `par conséquent`, `en effet`, `d'une part`, `d'autre part`, `en revanche`, `argument`, `débat`, `analyse`, `cadre`, `enjeu`, `démarche`, `subjonctif`-triggering verbs (`il faut que`, `pour que`)
  - **C1:** `néanmoins`, `toutefois`, `en l'occurrence`, `il n'en demeure pas moins`, `quoi qu'il en soit`, `discours`, `paradigme`, `nuance`, `enjeu sociétal`, `argumentation`, `réfuter`, `étayer`, `corroborer`
  - **C2:** `force est de constater`, `il sied de`, `prêter à confusion`, `s'apparenter à`, `verbiage`, `circonlocution`, `truismе`, `idiosyncrasie`, `palimpseste`, literary archaisms (`naguère`, `jadis`, `chair de canon`)
- [x] Forbidden-lower-tier per level (these words must NOT appear at OR below this level):
  - **A1:** `cependant`, `néanmoins`, `toutefois`, `pourtant`, `en effet`, `par conséquent`, `force est de constater`, `quoi qu'il en soit`, `il n'en demeure pas moins`, `en l'occurrence`, `subjonctif` constructions
  - **A2:** `néanmoins`, `toutefois`, `en l'occurrence`, `il n'en demeure pas moins`, `quoi qu'il en soit`, `force est de constater`
  - **B1:** `néanmoins`, `toutefois`, `force est de constater`, `il n'en demeure pas moins`, `en l'occurrence`
  - **B2:** `force est de constater`, `il sied de`, `idiosyncrasie`, `palimpseste`
  - **C1:** *(empty — C1 candidates are expected to wield the full upper register)*
  - **C2:** *(empty)*
- [x] **Cite the source-of-truth.** Top-of-file JSDoc points at `docs/tcf-spec-source.md §7.2` AND `§8.1`.

**Why a single helper module:** parallel to Story 10-3's `writingTaskWordRange` pattern — eliminates the lockstep-update risk of having per-CEFR vocab guidance scattered across 8 prompt files.

**Why heuristic caps not Beacco:** operator-action blocker; documented Phase-1/Phase-2 split.

**Why curated exemplars over fetched lists:** open-source frequency lists (Wiktionary, Lexique 3) are 1000+ words long — embedding the full list in every prompt blows the token budget. A small calibration-anchor list is sufficient guidance; the AI knows the full tier from its training.

### 2. Wire `buildVocabularyConstraintBlock` into all CEFR-aware prompt builders

The new constraint block is rendered into every prompt that references a CEFR level. Each integration is small (single import + single template-literal interpolation).

- [x] **`src/lib/prompts/listening.ts`** `buildListeningExercisePrompt` — interpolate `${buildVocabularyConstraintBlock(cefrLevel)}` after the `## Content Guidelines for ${cefrLevel}` block, before the `## Speed Guidance` block.
- [x] **`src/lib/prompts/reading.ts`** `buildReadingExercisePrompt` — interpolate after the `## Content Guidelines for ${cefrLevel}` block, before `## Word Explanation Format`.
- [x] **`src/lib/prompts/writing.ts`** `buildWritingEvaluatorPrompt` — interpolate after the `## Evaluation Task` block, before `## Evaluation Rubric`. The Vocabulary Constraint block also informs the evaluator's `lexicalRichnessScore` rubric — a B2 user using only A1 vocabulary should be flagged.
- [x] **`src/lib/prompts/conversation.ts`** `buildConversationSystemPrompt` (or equivalent — locate via grep) — interpolate after the `LEVEL_GUIDELINES[cefrLevel]` interpolation, before any Memory/Weak-Areas blocks. The conversation prompt is the most-referenced surface; this is the highest-impact integration.
- [x] **`src/lib/prompts/echo.ts`** `buildEchoExercisePrompt` (or equivalent) — interpolate after the per-level content block.
- [x] **`src/lib/prompts/translation.ts`** `buildTranslationExercisePrompt` (or equivalent) — interpolate after the per-level content block.
- [x] **`src/lib/prompts/speaking.ts`** `buildSpeakingTaskPrompt` and `buildSpeakingEvaluatorPrompt` (story 9-8 surfaces) — interpolate after the per-CEFR topic library / per-level evaluator block.
- [x] **`src/lib/prompts/mock-test.ts`** `buildMockTestPrompt` — interpolate as a sibling to the existing `## Passage Word Counts` block (Story 10-3, reading section only). Since mock-test spans A1–C2, render an aggregated tier table (one row per level) rather than a single-level block. Build via `["A1", "A2", "B1", "B2", "C1", "C2"].map(buildVocabularyConstraintBlock).join("\n\n")` OR a new `buildAggregatedVocabularyConstraintTable()` helper if the per-level format is too verbose for an aggregated view.
- [x] **No existing per-level qualitative content is removed** — the Vocabulary Constraint block is *additive*. Story 10-3's `LEVEL_CONTENT` blocks stay intact.

**Given** a user requests an A1 listening exercise
**When** `buildListeningExercisePrompt({ cefrLevel: "A1" })` is called
**Then** the returned prompt contains the substring `"Vocabulary Constraint"`
**And** contains the substring `"approximately 700 distinct word-forms"` (or equivalent)
**And** contains at least one A1 exemplar (e.g., `"bonjour"`)
**And** contains the forbidden-lower-tier list (e.g., `"cependant"` listed as forbidden at A1)

**Given** a user requests a C1 listening exercise
**When** `buildListeningExercisePrompt({ cefrLevel: "C1" })` is called
**Then** the returned prompt contains the Vocabulary Constraint block but the forbidden-lower-tier list section is empty / omitted (C1 candidates wield the full register)

### 3. Test surface for `vocabulary-tiers.ts` and prompt integration

- [x] **CREATE** `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` (NEW) covering:
  - Per-level `vocabularyTier(cefrLevel)` round-trip: 6 cases (A1–C2) asserting `approxWordCap`, exemplar count ≥ 10, forbiddenLowerTier non-empty for A1–B2 / empty for C1–C2.
  - `buildVocabularyConstraintBlock(cefrLevel)` substring assertions: 6 cases asserting the rendered block contains the cap number, the rationale citation `(per docs/tcf-spec-source.md §7.2)`, at least one exemplar, and (for A1–B2) at least one forbidden token.
  - Negative assertions: A1 forbidden list MUST contain `cependant`, `néanmoins`, `force est de constater`; A2 forbidden list MUST contain `néanmoins`; B1 forbidden list MUST contain `force est de constater`; C1 forbidden list MUST be empty.
  - **Anti-pattern guard:** the rendered block MUST NOT contain raw user input or memory-derived strings (defense-in-depth against story 9-4's stored-prompt-injection class). Assert the rendered block is byte-identical for two calls with the same `cefrLevel` argument (deterministic, no time/randomness).
- [x] **CREATE** `src/lib/prompts/__tests__/vocabulary-integration.test.ts` (NEW) OR extend the existing `passage-calibration.test.ts` (Story 10-3) — for each integrated prompt builder + each CEFR level, assert the prompt output contains `"Vocabulary Constraint"` (positive surface check). 8 builders × 6 levels = 48 assertions; parameterize via `it.each`.
- [x] **EXTEND** `src/lib/__tests__/tcf-spec.test.ts` matrix-completeness check to assert a §9 row for `src/lib/prompts/vocabulary-tiers.ts` exists in `docs/tcf-spec-citations.md`. One new `it()` block (mirrors Story 10-2's `IRCC_CLB_BANDS` row check + Story 10-3's `writingTaskWordRange` row check).
- [x] **VERIFY** existing tests stay green:
  - `src/lib/prompts/__tests__/passage-calibration.test.ts` (Story 10-3) — adding the Vocabulary Constraint block to a prompt should not break Story 10-3's substring assertions on per-CEFR word ranges (the new block is additive). Re-run after each integration to confirm.
  - `src/lib/__tests__/tcf-spec.test.ts` matrix-completeness checks (Story 10-1 + 10-2 + 10-3) — new §9 row must not break existing per-CEFR / per-task / Story 10-2 row checks.
  - `src/lib/__tests__/scoring.test.ts`, `ircc-bands.test.ts`, `activity.test.ts`, `speaking-mock-test-persist.test.ts` — no behavior change expected (10-4 is prompt-only).
- [x] **TARGET TEST COUNT POST-STORY:** 501 → 560+ (estimate: 6 tier-helper + 12 builder + ~48 integration + 1 matrix = ~67 new tests).

### 4. Update `docs/tcf-spec-source.md` §7.3 and §10b

- [x] **UPDATE** [`docs/tcf-spec-source.md §7.3`](docs/tcf-spec-source.md):
  - Replace `"The codebase has zero vocabulary frequency caps in prompts today (audit P1-4)."` with:
    ```
    Post-Epic-10.4 (Phase 1, 2026-05-XX): all CEFR-aware prompt builders
    in `src/lib/prompts/` carry a Vocabulary Constraint block sourced from
    `src/lib/prompts/vocabulary-tiers.ts`. The block surfaces (a) a numeric
    word-form cap per §7.2 heuristic table, (b) a 10-20-word exemplar list
    per level, and (c) a forbidden-lower-tier list (e.g., A1 must not
    contain `cependant`, `néanmoins`, `force est de constater` per §8.1).
    The Beacco-verbatim word-list replacement (operator-action per §10b
    item #5) is **deferred to a Phase-2 follow-up sub-story** when the
    operator delivers the Beacco _Niveau A1/A2/B1/B2 pour le français_
    volumes (Didier 2007–2011).
    ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §10b`](docs/tcf-spec-source.md) — add a new operator-action item:
  ```
  5. **Acquire Beacco _Niveau A1/A2/B1/B2 pour le français_ volumes**
     (Didier 2007–2011, ~€30–€45 per volume × 4 volumes = ~€120–€180
     total). Extract verbatim "Inventaire général" word counts and word
     lists per level → file Phase-2 follow-up sub-story (or new Epic
     10.X) to replace `src/lib/prompts/vocabulary-tiers.ts` heuristic
     caps + curated exemplars with publisher-grade data + page citations.
     Required by Phase-2 closure of audit P1-4. Story 10-4 (Phase 1)
     ships heuristic-tier caps in the meantime.
  ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §10`](docs/tcf-spec-source.md) — add a new follow-up #9:
  ```
  9. **Vocabulary frequency caps in prompts** — **PARTIAL — closed for
     the heuristic-tier scope by Story 10-4 (this story) on 2026-05-XX**
     (`src/lib/prompts/vocabulary-tiers.ts` ships per-CEFR caps +
     exemplars + forbidden-lower-tier lists; integrated into all
     CEFR-aware prompt builders). Beacco-verbatim replacement remains
     **DEFERRED to a Phase-2 sub-story** when operator delivers the
     Beacco volumes (see §10b item #5).
  ```

### 5. Update `docs/tcf-spec-citations.md` §9

- [x] **UPDATE** [`docs/tcf-spec-citations.md §9`](docs/tcf-spec-citations.md) row from:
  ```
  | (no current code citation) | (no caps in any prompt) | §7.2 — Beacco-derived per-CEFR lexical inventories | 🟡 GAP — no current code; Epic 10.4 will use this section to embed top-N lists. **Owner: Epic 10.4 (P1-4)** |
  ```
  to two rows:
  ```
  | `src/lib/prompts/vocabulary-tiers.ts` `vocabularyTier` + `buildVocabularyConstraintBlock` | per-CEFR { approxWordCap, exemplars[], forbiddenLowerTier[] } sourced from §7.2 (heuristic) + §8.1 (forbidden tokens) | §7.2 + §8.1 | ✓ Verified-with-caveat 2026-05-XX — Story 10-4 (Phase 1) ships heuristic-tier caps + curated exemplars + forbidden-tier lists; Beacco-verbatim word-list replacement deferred to Phase-2 follow-up (operator-action per §10b item #5) |
  | `src/lib/prompts/{listening,reading,writing,conversation,echo,translation,speaking,mock-test}.ts` Vocabulary Constraint block | renders `buildVocabularyConstraintBlock(cefrLevel)` into every CEFR-aware prompt | §7.3 — implementation surface | ✓ Verified 2026-05-XX — Story 10-4 |
  ```
- [x] **VERIFY** the new row's `vocabulary-tiers.ts` reference is matched by the new matrix-completeness `it()` block in `tcf-spec.test.ts` (per AC #3).

### 6. Update CLAUDE.md

- [x] Add a new architecture line to [`CLAUDE.md`](CLAUDE.md) **after** the "TCF per-CEFR passage calibration" line (the most recent line, story 10-3):
  ```markdown
  **TCF per-CEFR vocabulary tiers:** post-Epic-10.4 (Phase 1), every CEFR-aware prompt builder in `src/lib/prompts/{listening,reading,writing,conversation,echo,translation,speaking,mock-test}.ts` carries a Vocabulary Constraint block sourced from `src/lib/prompts/vocabulary-tiers.ts`. The new module exports `vocabularyTier(cefrLevel)` returning `{ approxWordCap, exemplars, forbiddenLowerTier }` per `docs/tcf-spec-source.md §7.2` (operator-derived heuristic caps: A1 ~700 / A2 ~1700 / B1 ~2800 / B2 ~5000 / C1 ~7500 / C2 ~10000) plus 10-20 hand-curated high-frequency exemplars per level (Wiktionary CC-BY-SA + DGLF) plus a forbidden-lower-tier list per `docs/tcf-spec-source.md §8.1` (e.g., A1 must not contain `cependant`, `néanmoins`, `force est de constater`; B1 must not contain `force est de constater`; C1+ no forbidden list — full upper register expected). `buildVocabularyConstraintBlock(cefrLevel)` renders the markdown block dropped into every prompt as a sibling of Story 10-3's `## Publisher Word Count Enforcement` block. **Phase 2 (Beacco-verbatim word lists from Didier 2007–2011) deferred** — operator-action per `docs/tcf-spec-source.md §10b` item #5. Story 9-4's stored-prompt-injection defense holds: the constraint block is statically built from a controlled module — no user input flows through it. Regression-tested in `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` (helper round-trip + forbidden-token assertions) and `vocabulary-integration.test.ts` (8 builders × 6 levels surface check). Verified 2026-05-XX, story 10-4.
  ```

### 7. (Optional, recommended) Inline cross-references in existing prompt files

To make the integration discoverable to future readers without forcing them to grep, add a one-line JSDoc comment near the top of each CEFR-aware prompt file pointing at the new `vocabulary-tiers.ts` module. Already done in Story 10-3 for `listening.ts` / `reading.ts` / `writing.ts` (top-of-file JSDoc cites §3.1 / §4.1 / §5.1); 10-4 adds a sibling line citing §7.2 + the new module.

- [x] `src/lib/prompts/conversation.ts` — top-of-file JSDoc gains: *"Vocabulary tiers per CEFR are surfaced via `src/lib/prompts/vocabulary-tiers.ts` `buildVocabularyConstraintBlock` (Story 10-4 / `docs/tcf-spec-source.md §7.2`)."*
- [x] Same for `echo.ts`, `translation.ts`, `speaking.ts`, `mock-test.ts`. The 10-3 files (`listening.ts`, `reading.ts`, `writing.ts`) gain a one-line addendum to the existing JSDoc.

### Z. Polish Requirements

- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — **N/A** (no new error-prone code; pure prompt-builder constants + integration touches)
- [x] N/A — All colors use `Colors.*` design tokens (no UI in this story)
- [x] N/A — All loading states use skeleton animations (no UI in this story)
- [x] N/A — All interactive elements have accessibility labels (no UI in this story)
- [x] N/A — Non-obvious interactions have `accessibilityHint` (no UI in this story)
- [x] N/A — Stateful elements have `accessibilityState` (no UI in this story)
- [x] N/A — Tappable elements ≥ 44x44pt (no UI in this story)
- [x] N/A — All text uses `Typography.*` presets (no UI in this story)
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`. The new vocabulary-tiers tests pass.
- [x] **Citations matrix completeness test in `tcf-spec.test.ts`** continues to pass — must include the new `vocabulary-tiers.ts` row check.
- [x] **Sentry DSN leak guard + Submit credentials leak guard** in `ci.yml` continue to pass (no DSN/credential changes).
- [x] **`git status` shows new files as untracked-but-not-ignored** — `src/lib/prompts/vocabulary-tiers.ts`, `src/lib/prompts/__tests__/vocabulary-tiers.test.ts`, optional `vocabulary-integration.test.ts` (Epic 9 retro A1 lesson).
- [x] **Story 9-4 stored-prompt-injection defense holds** — `buildVocabularyConstraintBlock` accepts only a `CEFRLevel` enum argument; no user input flows in. Verified by static inspection + the deterministic-output assertion in AC #3.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`. Verifying that the file is *visible to git but not yet tracked* catches the ignore-rule footgun before story 1 of any future project.
-->

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/10-4-vocabulary-frequency-caps.md`) under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/10-4-vocabulary-frequency-caps.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] Task 1: Create `src/lib/prompts/vocabulary-tiers.ts` (AC #1)
  - [x] Create the module with `vocabularyTier(cefrLevel)` + `buildVocabularyConstraintBlock(cefrLevel)`
  - [x] Populate per-CEFR tiers (A1–C2) per AC #1's tables (caps + exemplars + forbidden-lower-tier)
  - [x] Add top-of-file JSDoc citing §7.2 + §8.1 + the Phase-1/Phase-2 split

- [x] Task 2: Wire `buildVocabularyConstraintBlock` into all CEFR-aware prompt builders (AC #2)
  - [x] `listening.ts` integration
  - [x] `reading.ts` integration
  - [x] `writing.ts` integration
  - [x] `conversation.ts` integration
  - [x] `echo.ts` integration
  - [x] `translation.ts` integration
  - [x] `speaking.ts` integration (`buildSpeakingTaskPrompt` + `buildSpeakingEvaluatorPrompt`)
  - [x] `mock-test.ts` integration (aggregated table for A1–C2 spread)

- [x] Task 3: Test surface (AC #3)
  - [x] CREATE `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` with helper round-trip + substring + forbidden-token + determinism assertions
  - [x] CREATE `src/lib/prompts/__tests__/vocabulary-integration.test.ts` with 8 builders × 6 levels surface checks (parameterized via `it.each`)
  - [x] EXTEND `src/lib/__tests__/tcf-spec.test.ts` matrix-completeness check to include `vocabulary-tiers.ts` row
  - [x] Re-run `passage-calibration.test.ts` to confirm Story 10-3's assertions stay green

- [x] Task 4: Update `docs/tcf-spec-source.md` §7.3, §10b, §10 follow-up #9 (AC #4)

- [x] Task 5: Update `docs/tcf-spec-citations.md` §9 — split into 2 rows for `vocabulary-tiers.ts` + integration surface (AC #5)

- [x] Task 6: Update CLAUDE.md (AC #6) — add new "TCF per-CEFR vocabulary tiers" architecture line after the Story 10-3 line

- [x] Task 7: Optional cross-references in existing prompt files (AC #7) — add one-line JSDoc addendum citing the new module

- [x] Task 8: Quality gates (AC #Z)
  - [x] `npm run type-check` passes
  - [x] `npm run lint` passes
  - [x] `npm run format:check` passes
  - [x] `npm test` passes — target 560+ tests (was 501 post-10-3)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN + Submit credentials leak guards pass
  - [x] `git status` shows new files as untracked-but-not-ignored
  - [x] Citations matrix completeness test in `tcf-spec.test.ts` includes `vocabulary-tiers.ts`

## Dev Notes

### Architecture pattern alignment

- **Single-source-of-truth helper module** — parallel to Story 10-3's `writingTaskWordRange` and Story 10-2's `IRCC_CLB_BANDS`. The new `vocabulary-tiers.ts` is the third module in the `src/lib/prompts/` source-of-truth family. Future per-CEFR additions should follow the same pattern.
- **Phase-1 / Phase-2 split** — the Beacco operator-action blocker is documented; the heuristic Phase-1 ships now. Same pattern as Story 10-3's writing-pipeline-in-mock-test deferral and Story 10-1's `Manuel du candidat TCF` defer.
- **Additive prompt integration** — the Vocabulary Constraint block is a NEW block dropped into existing prompts; no existing per-CEFR qualitative content is rewritten. Story 10-3's `LEVEL_CONTENT` blocks stay intact, and the audit's "Force est de constater" misclassification at `conversation.ts:91` is left for Epic 10.7 (linguistic accuracy pass) to fix — Story 10-4 only flags it as forbidden at lower levels.
- **Forbidden-tier list is the highest-leverage signal** — unlike caps (which the AI may quietly violate) and exemplars (which the AI may ignore), forbidden tokens are substring-verifiable post-generation. A future runtime guard (deferred per Out-of-scope) can substring-check AI output and reject low-CEFR generations containing forbidden tokens. 10-4 only adds the prompt-time guidance; the runtime gate is a separate UX decision.
- **Story 9-4 prompt-injection defense holds** — `buildVocabularyConstraintBlock` accepts only a typed `CEFRLevel` enum argument; no user input flows in. Exemplar / forbidden lists are constant-time module exports, byte-identical for repeated calls with the same argument (deterministic — assertable by test).

### Pulling forward Epic 9 + 10-1 + 10-2 + 10-3 lessons

- **Epic 9 retro A1** ("git status shows new files as untracked-but-not-ignored"): Polish AC #Z explicitly bakes this in. New module + new test files MUST appear in `git status`.
- **Epic 9 retro A3** (review-patch budget — "an implementation that passes type-check, lint, and existing tests is ~70% done, not 100%"): expect 5–15 patches in this story's review pass. Numerical-table-heavy + integration-touches stories tend to surface (a) per-level off-by-one cap mismatches, (b) lockstep-update misses across the 8 prompt files, (c) integration-site placement bugs (the new block landing in the wrong section of the existing prompt template). Plan the review-patch round into the time budget.
- **Story 10-1 lesson** (citations-matrix completeness): every TCF-derived value MUST appear in `docs/tcf-spec-citations.md`. The new `vocabulary-tiers.ts` module gets a row; the matrix-completeness test will fail loudly if it's missing.
- **Story 10-2 lesson** (delete don't alias): the new `vocabularyTier` helper is the ONLY source of per-CEFR vocab caps. Do NOT scatter inline `if cefrLevel === "A1" then 700 else ...` ladders into prompts — always import + call.
- **Story 10-3 lesson** (single source of truth across same-file sites): when adding the constraint block to `writing.ts`, ensure the §5.3 enforcement block + `TASK_EXPECTATIONS` (now templated via `writingTaskWordRange`) and the new vocabulary block do NOT duplicate the per-task numbers anywhere. Helper-templated everywhere.
- **Story 10-3 review patch P5 lesson** (parameterize across all task numbers): the integration test should use `it.each` across all 6 CEFR levels × all 8 builders so a future scope-to-A1-only refactor fails the build.
- **Story 9-4 prompt-injection defense**: the new constraint block is module-static; no user input flows in. Verified by determinism test + static inspection.

### Source tree components to touch

| File | Action |
|---|---|
| [src/lib/prompts/vocabulary-tiers.ts](src/lib/prompts/vocabulary-tiers.ts) | **Create** — `VocabularyTier` interface + `vocabularyTier(cefrLevel)` + `buildVocabularyConstraintBlock(cefrLevel)` + per-CEFR caps / exemplars / forbidden-lower-tier data |
| [src/lib/prompts/__tests__/vocabulary-tiers.test.ts](src/lib/prompts/__tests__/vocabulary-tiers.test.ts) | **Create** — 6+ helper round-trip + substring + forbidden-token + determinism cases |
| [src/lib/prompts/__tests__/vocabulary-integration.test.ts](src/lib/prompts/__tests__/vocabulary-integration.test.ts) | **Create** — 8 builders × 6 levels = 48 surface-check cases parameterized via `it.each` |
| [src/lib/prompts/listening.ts](src/lib/prompts/listening.ts) | UPDATE — interpolate `${buildVocabularyConstraintBlock(cefrLevel)}` after `## Content Guidelines for ${cefrLevel}`; add JSDoc cross-reference |
| [src/lib/prompts/reading.ts](src/lib/prompts/reading.ts) | UPDATE — same pattern as listening.ts |
| [src/lib/prompts/writing.ts](src/lib/prompts/writing.ts) | UPDATE — interpolate after `## Evaluation Task` block; the lexicalRichnessScore rubric also benefits from the constraint signal |
| [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts) | UPDATE — interpolate after `LEVEL_GUIDELINES[cefrLevel]` interpolation, before Memory/Weak-Areas blocks |
| [src/lib/prompts/echo.ts](src/lib/prompts/echo.ts) | UPDATE — interpolate after the per-level content block |
| [src/lib/prompts/translation.ts](src/lib/prompts/translation.ts) | UPDATE — interpolate after the per-level content block |
| [src/lib/prompts/speaking.ts](src/lib/prompts/speaking.ts) | UPDATE — interpolate into both `buildSpeakingTaskPrompt` and `buildSpeakingEvaluatorPrompt` (story 9-8 surfaces) |
| [src/lib/prompts/mock-test.ts](src/lib/prompts/mock-test.ts) | UPDATE — interpolate as aggregated table (A1–C2 spread); sibling to Story 10-3's `## Passage Word Counts` block |
| [src/lib/__tests__/tcf-spec.test.ts](src/lib/__tests__/tcf-spec.test.ts) | UPDATE — add matrix-completeness `it()` for `vocabulary-tiers.ts` row |
| [CLAUDE.md](CLAUDE.md) | UPDATE — add new "TCF per-CEFR vocabulary tiers" architecture line after the Story 10-3 line |
| [docs/tcf-spec-source.md](docs/tcf-spec-source.md) | UPDATE — §7.3 rewritten; §10b new operator-action item #5; §10 new follow-up #9 |
| [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md) | UPDATE — §9 split from 1 GAP row into 2 ✓-Verified-with-caveat rows |

### Anti-pattern prevention

- **Do NOT scatter inline per-CEFR vocab ladders** into prompt files — always import `buildVocabularyConstraintBlock` from the helper module. Story 10-2 / 10-3 lesson.
- **Do NOT modify existing per-CEFR `LEVEL_CONTENT` / `LEVEL_GUIDELINES` blocks** — the Vocabulary Constraint block is *additive*. Story 10-3 owns word-count calibration; Epic 10.7 owns linguistic accuracy fixes.
- **Do NOT fix the "Force est de constater" misclassification at `conversation.ts:91`** — that's Epic 10.7 scope. Story 10-4 only adds the forbidden-tier list that flags it at A1–B1. The existing comment-error in `writing.ts` cohesion criteria stays for Epic 10.7.
- **Do NOT embed long word lists** in the prompt — exemplars are ≤ 20 per level so they fit in the prompt token budget. The full Beacco "Inventaire général" lists (when Phase 2 lands) MUST be summarized + a top-N exemplar sample for prompts; the full lists belong in a separate constant for runtime validation guards (deferred per Out-of-scope).
- **Do NOT introduce a runtime AI-output validation gate** — that's a separate UX decision. 10-4 only adds prompt-time guidance.
- **Do NOT use the heuristic caps as if they were Beacco-verbatim** — the JSDoc + citations matrix MUST flag the Phase-1/Phase-2 split. A future reader who treats `approxWordCap: 700` as a publisher-grade contract is the failure mode this story prevents via the `-with-caveat` framing.
- **Do NOT include grammar.ts** — operator-decided as non-TCF practice skill. Out of scope.
- **Do NOT introduce a database migration or schema change** — vocabulary tiers are static module exports.
- **Do NOT touch any Edge Function** — prompt builders run client-side.
- **Do NOT backfill historical generated content** — forward-only.

### Testing standards

- **Substring assertions on prompt output, not implementation internals** — same contract as Story 10-3's `passage-calibration.test.ts`.
- **Forbidden-token assertions are non-negotiable** — A1 prompt MUST NOT contain `cependant` in the constraint block (positive surface check); A1 forbidden-list MUST contain `cependant` (negative surface check). Both fail loudly on regression.
- **Each per-level / per-builder assertion is its own `it.each` row** so failures are diagnosable. Don't `forEach` 48 levels into a single test.
- **Determinism check** — `buildVocabularyConstraintBlock(cefrLevel)` MUST return byte-identical output for two consecutive calls with the same argument. Defends against accidental introduction of `Date.now()` / random / user-input dependencies (story 9-4 defense).
- **Don't test the AI's behavior** — only the prompt-builder's output. Whether the AI actually respects the forbidden-tier list is a separate concern (out-of-scope runtime guard).

### Project Structure Notes

- New module `src/lib/prompts/vocabulary-tiers.ts` lives parallel to `src/lib/prompts/writing.ts` (which now exports `writingTaskWordRange` per Story 10-3) and `src/lib/prompts/speaking.ts` (Story 9-8 topic libraries). Discoverable by anyone reading the prompts directory.
- New tests under `src/lib/prompts/__tests__/` parallel to `passage-calibration.test.ts` and `speaking.test.ts`. Discoverable by `jest`'s default config.
- The CLAUDE.md addition goes at the very bottom of the architecture-line stack, after the Story 10-3 "TCF per-CEFR passage calibration" line. Insertion order = chronological by story.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §1 P1-4 — vocabulary frequency caps audit finding]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §2 line 162 — Epic 10.4 deliverable]
- [Source: docs/tcf-spec-source.md §7.1 — publisher position (FEI does NOT publish vocab tiers)]
- [Source: docs/tcf-spec-source.md §7.2 — Beacco / Council of Europe position + heuristic-tier table (operator-derived caps used by Phase 1)]
- [Source: docs/tcf-spec-source.md §7.3 — codebase implication (zero caps today; rewritten by this story)]
- [Source: docs/tcf-spec-source.md §8.1 — "Force est de constater" fixed expression / connector misclassification (informs forbidden-tier list)]
- [Source: docs/tcf-spec-source.md §10b — pending operator actions (this story adds item #5 for Beacco volumes)]
- [Source: docs/tcf-spec-citations.md §9 — current 🟡 GAP row owned by Epic 10.4]
- [Source: src/lib/prompts/listening.ts:96-126 — LEVEL_CONTENT block (Story 10-3); integration site for Vocabulary Constraint]
- [Source: src/lib/prompts/reading.ts:80-110 — LEVEL_CONTENT block (Story 10-3); integration site]
- [Source: src/lib/prompts/writing.ts — `buildWritingEvaluatorPrompt` (Story 10-3); integration site after `## Evaluation Task`]
- [Source: src/lib/prompts/conversation.ts:176-219 — `LEVEL_GUIDELINES` block; integration site after the per-level interpolation]
- [Source: src/lib/prompts/echo.ts — per-level content block (Story 6-1); integration site]
- [Source: src/lib/prompts/translation.ts — per-level content block (Story 7-1); integration site]
- [Source: src/lib/prompts/speaking.ts — `buildSpeakingTaskPrompt` + `buildSpeakingEvaluatorPrompt` (Story 9-8); integration sites]
- [Source: src/lib/prompts/mock-test.ts — `buildMockTestPrompt` spans A1–C2; aggregated table integration]
- [Source: src/lib/__tests__/tcf-spec.test.ts:91-129 — citation-matrix per-CEFR / Story 10-2 / 10-3 row checks; needs extending for `vocabulary-tiers.ts` row]
- [Source: src/lib/prompts/__tests__/passage-calibration.test.ts (Story 10-3) — pattern reference for the new vocabulary-tiers.test.ts]
- [Source: docs/tcf-canada-snapshots/cefr-self-assessment-grid-2026-05-10.md — qualitative CEFR descriptors (informs exemplar / forbidden curation)]
- [Source: src/types/cefr.ts `CEFR_LEVELS` — 6-level enum + tcfScoreMin/Max bands (UI-labeling only per Story 10-2 JSDoc)]
- [Source: Wiktionary "Liste des 1000 mots les plus fréquents en français" (CC-BY-SA) — open-source frequency list used to seed exemplars (no fetch needed; widely reproduced)]
- [Source: Story 9-4 stored-prompt-injection defense — `src/lib/memory.ts` `sanitizeMemoryContent` + `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapper pattern; informs the static-module-export design of `vocabulary-tiers.ts`]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/10-4-vocabulary-frequency-caps` (from `main` at 6ea4b1e — post-Story-10-3 PR #61 merge)
- Quality gates: `npm run type-check` ✓ · `npm run lint` ✓ (0 errors, 0 warnings) · `npm run format:check` ✓ · `npm test` (595 passing, +94 vs 501 pre-story baseline) ✓ · `npm run check:colors` ✓
- New files NOT gitignored (Epic 9 retro A1) ✓
- Story file `_bmad-output/implementation-artifacts/10-4-vocabulary-frequency-caps.md` NOT gitignored, prettier-clean ✓

### Completion Notes List

**Created `src/lib/prompts/vocabulary-tiers.ts`** — single source of truth for per-CEFR vocabulary frequency caps + curated exemplars + forbidden-lower-tier lists. Exports `VocabularyTier` interface, `vocabularyTier(cefrLevel)`, `buildVocabularyConstraintBlock(cefrLevel)` (single-level builders), and `buildAggregatedVocabularyConstraintTable()` (mock-test which spans A1–C2). Per-CEFR data sourced from `docs/tcf-spec-source.md §7.2` heuristic table (caps: A1 700 / A2 1700 / B1 2800 / B2 5000 / C1 7500 / C2 10000) + Wiktionary CC-BY-SA + DGLF for exemplars + §8.1 for forbidden tokens. `vocabularyTier` throws on non-CEFR runtime input (Story 10-3 `writingTaskWordRange` defensive pattern).

**Wired `buildVocabularyConstraintBlock` into 8 CEFR-aware prompt builders:**

- `listening.ts buildListeningExercisePrompt` — interpolated after `## Content Guidelines for ${cefrLevel}`
- `reading.ts buildReadingExercisePrompt` — same pattern
- `writing.ts buildWritingEvaluatorPrompt` — interpolated after `## Evaluation Task` block
- `conversation.ts buildConversationPrompt` — interpolated after `LEVEL_GUIDELINES[cefrLevel]` interpolation, before correction-behavior block
- `echo.ts buildEchoPracticePrompt` — interpolated after per-level guidance
- `translation.ts buildTranslationPrompt` (both translation A1–B1 + paraphrasing B2–C2 branches) and `buildTranslationEvaluationPrompt` — interpolated in all three template literals
- `speaking.ts buildSpeakingEvaluatorPrompt` — interpolated after `## Evaluation Task` block
- `mock-test.ts buildMockTestPrompt` — uses `buildAggregatedVocabularyConstraintTable()` (one-row-per-level compact table) since the mock-test section spans A1–C2 in a single call

**Scope refinement (documented in JSDoc):** `buildSpeakingTaskPrompt` was NOT integrated despite being listed in the story's AC #2. The function returns user-facing UI chrome (English instruction string + French topic from a pre-curated topic library), not an AI prompt — vocab tiers don't apply. Decision documented in `src/lib/prompts/speaking.ts` top-of-file JSDoc; integration test docstring; this completion note.

**Story 9-4 prompt-injection defense holds** — `buildVocabularyConstraintBlock` accepts only a typed `CEFRLevel` enum argument. The constraint block is built from constant-time module exports; no user input flows through it. Determinism test asserts byte-identical output for repeated calls with the same argument.

**Existing per-CEFR `LEVEL_CONTENT` / `LEVEL_GUIDELINES` blocks unchanged** — the Vocabulary Constraint block is *additive*. Story 10-3's word-range calibration stays intact. The audit's "Force est de constater" misclassification at `conversation.ts:91` (which is in a comment listing C1-C2 connectors) stays for Epic 10.7 to fix — Story 10-4 only adds the forbidden-tier list that flags it at A1–B1.

**Citations matrix §9** flipped from 🟡 GAP (single row) → ✓ Verified-with-caveat (2 rows: helper module + integration surface). New `tcf-spec.test.ts` matrix-completeness check asserts the `vocabulary-tiers.ts` row exists and references one of the exported helpers.

**Source-of-truth `docs/tcf-spec-source.md` updates:**

- §7.3 rewritten from "zero caps today" to "Phase-1 caps + exemplars + forbidden tokens shipped; Beacco-verbatim deferred"
- §10b new operator-action item #5: acquire Beacco volumes (~€120–€180) for Phase-2 replacement
- §10 new follow-up #9: PARTIAL — closed for heuristic-tier scope; Beacco replacement deferred

**`CLAUDE.md`** gained a new "TCF per-CEFR vocabulary tiers" architecture line after the Story 10-3 line (chronological order).

**Test surface:** +94 tests vs 501 pre-story baseline (501 → 595).

- `vocabulary-tiers.test.ts` (40 cases): per-CEFR data shape + cap-value pinning + monotonicity + runtime throw + forbidden-tier lists (per §8.1) + `buildVocabularyConstraintBlock` substring + Phase-1/Phase-2 caveat + determinism + aggregated-table tests
- `vocabulary-integration.test.ts` (53 cases): 8 builders × 6 CEFR levels parameterized via `it.each` + mock-test aggregated table for both listening/reading sections + 3 forbidden-token regression guards (A1 listening forbids `cependant` / `force est de constater`; A1 conversation forbids `néanmoins`; C1 listening declares `Forbidden at C1: none`)
- `tcf-spec.test.ts` extended with 1 new `it()` block asserting the §9 row references both `vocabulary-tiers.ts` and one of the exported helpers

**Out of scope (deferred per story):** Beacco-verbatim word lists (Phase 2 — operator-action blocked); placement test prompt extraction (Epic 10.5); Speaking rubric deepening (Epic 10.6); linguistic accuracy fixes including the pre-existing "Force est de constater" misclassification at `conversation.ts:91` (Epic 10.7); anti-cheat / anti-repetition (Epic 10.8); runtime AI-output validation against forbidden-tier list (deferred future hardening); Quebec variant; grammar.ts (operator-decided non-TCF skill); per-CEFR exhaustive forbidden-token coverage; multi-language tiers; database / Edge Function changes; backfill of historical generated content.

### File List

**Created:**

- `src/lib/prompts/vocabulary-tiers.ts` (NEW — `VocabularyTier` interface + `vocabularyTier` + `buildVocabularyConstraintBlock` + `buildAggregatedVocabularyConstraintTable` + per-CEFR data tables)
- `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` (NEW — 40 helper-contract test cases)
- `src/lib/prompts/__tests__/vocabulary-integration.test.ts` (NEW — 53 prompt-builder integration test cases)

**Modified:**

- `src/lib/prompts/listening.ts` (import + interpolation after `## Content Guidelines for ${cefrLevel}` + JSDoc cross-reference)
- `src/lib/prompts/reading.ts` (same pattern as listening.ts)
- `src/lib/prompts/writing.ts` (import + interpolation after `## Evaluation Task` block; JSDoc not needed — already cites §5.1 / §5.3 in Story 10-3)
- `src/lib/prompts/conversation.ts` (import + interpolation after `LEVEL_GUIDELINES[cefrLevel]` interpolation + JSDoc addendum noting the constant-time module-export keeps Story 9-4 defense intact)
- `src/lib/prompts/echo.ts` (import + interpolation after per-level guidance + JSDoc addendum)
- `src/lib/prompts/translation.ts` (import + 3 interpolations: paraphrasing builder, translation builder, evaluator + JSDoc addendum)
- `src/lib/prompts/speaking.ts` (import + interpolation in `buildSpeakingEvaluatorPrompt` only + JSDoc explaining the `buildSpeakingTaskPrompt` non-integration scope refinement)
- `src/lib/prompts/mock-test.ts` (import of `buildAggregatedVocabularyConstraintTable` + interpolation between `${sectionConfig.instructions}` and `## Scoring` block + JSDoc addendum)
- `src/lib/__tests__/tcf-spec.test.ts` (added 1 new `it()` block for the §9 vocabulary-tiers.ts matrix-row check)
- `CLAUDE.md` (added "TCF per-CEFR vocabulary tiers" architecture line after the Story 10-3 line)
- `docs/tcf-spec-source.md` (§7.3 rewritten; §10b new item #5; §10 new follow-up #9)
- `docs/tcf-spec-citations.md` (§9 row split from single 🟡 GAP into 2 ✓-Verified rows for helper + integration surface)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (10-4: backlog → ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/10-4-vocabulary-frequency-caps.md` (this story file — Status, all checkboxes [x], Dev Agent Record filled)

### Change Log

| Date       | Change                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-10 | Story 10-4 implementation complete; vocabulary-tiers.ts module created + integrated into 8 CEFR-aware prompt builders; 94 new tests; §9 GAP closed; status → review |
| 2026-05-10 | Senior Developer Review patches P1–P9 + P15 applied (3 HIGH + 5 MED + 1 LOW); +44 new tests (95 → 137 in vocab suites); 639 total                                   |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-10
**Reviewers:** Blind Hunter (general adversarial) + Edge Case Hunter (project-aware) + Acceptance Auditor (spec-vs-impl)
**Outcome:** Changes Requested → all 9 patch findings addressed → APPROVED

### Triage outcome

- **9 patch findings** — all addressed in this story branch (HIGH × 3, MED × 5, LOW × 1)
- **5 defer findings** — pre-existing, cosmetic, or out-of-scope (trailing-newline cosmetic, "distinct word-forms" terminology nit, integration-test substring coupling tradeoff, listening "30-600 words" pre-existing post-10-3, helper trailing newline)
- **4 reject findings** — noise (typeof in error message, speaking task scope refinement (already documented), CEFRLevel hypothetical extension, BH#13 dup of AA#1)

### Action Items (all resolved)

- [x] **[HIGH] P1** Forbidden-tier monotonicity broken — A1 forbade `cependant` / `pourtant` but A2 silently allowed them. Refactored `vocabulary-tiers.ts` to derive `forbiddenLowerTier` per-level from a single `LEXICAL_MIN_LEVEL: ReadonlyArray<[string, CEFRLevel]>` map (each token → minimum allowed CEFR level). Per-level `forbiddenLowerTier = computeForbiddenAt(level)` filters the map. Monotonicity now holds by construction. New `forbidden-tier monotonicity` describe block in `vocabulary-tiers.test.ts` asserts both the set-inclusion invariant (T forbidden at higher level → T forbidden at lower level) and size-non-increasing invariant.
- [x] **[HIGH] P2** Exemplar duplication across tiers — `parce que` was both A2 + B1 exemplar; `cependant` was both B1 + B2. Removed duplicates: `parce que` is A2-only; `cependant` is B1-only. Each token now appears at exactly one tier (its introduction tier). New `exemplar deduplication across tiers` describe block asserts no cross-tier duplicate exists.
- [x] **[HIGH] P3** Writing.ts contradiction — at A1 the AI saw both "Forbidden when generating content TARGETED at A1: ... force est de constater" (new vocab block) AND "C1-C2 expected: force est de constater" (cohesion criteria rubric). Two fixes: (a) reworded the vocab block from "must NOT appear at this level or lower" to "Forbidden when generating content TARGETED at ${level}" (clarifies generation-vs-grading scope); (b) `buildWritingEvaluatorPrompt` now filters the "Expected connectors by level" block by the user's target CEFR — A1/A2 evaluators see A1-A2 row only; B1/B2 see A1-A2 + B1-B2; C1/C2 see all three. Aspirational connector references no longer leak into lower-level evaluator prompts.
- [x] **[MED] P4** Aggregated mock-test table hid `force est de constater` behind `slice(0, 3) + ", …"`. Two fixes: (a) raised slice from 3 to 5; (b) reordered `LEXICAL_MIN_LEVEL` so canonical fixed expressions (`force est de constater`, `il sied de`, `il n'en demeure pas moins`) come FIRST within each tier, ensuring the most diagnostic tokens always surface above the ellipsis. New `A1 and A2 rows surface 'force est de constater'` test pins the contract.
- [x] **[MED] P5** Throw test missing null/lowercase/whitespace cases. Extended the throw test to exhaustively cover 11 invalid input shapes: `"D1"`, `""`, `undefined`, `null`, `"a1"` (lowercase), `"A1 "` / `" A1"` (whitespace-padded), `0`, `1`, `{}`, `[]`. All MUST throw `/unsupported cefrLevel/`. Error message also enriched to include `typeof` + `JSON.stringify(value)` for telemetry diagnostics.
- [x] **[MED] P7** Integration test passed via header literal alone — no assertion that the helper actually ran. Added a sentinel-exemplar map (A1→`bonjour`, A2→`parce que`, B1→`cependant`, B2→`en effet`, C1→`paradigme`, C2→`palimpseste`) to `assertVocabularyConstraintPresent` so each integration assertion now verifies a level-specific exemplar is present in the rendered prompt. A future regression that copies the literal header into a comment without invoking the helper fails CI.
- [x] **[MED] P8** Speaking integration test only exercised `taskNumber: 1`. Parameterized via `it.each(LEVEL_TASK_MATRIX)` over the 6 levels × 3 tasks Cartesian product (18 cases). A future refactor that branches on taskNumber and accidentally omits the constraint block at task 2 or 3 fails the build.
- [x] **[MED] P9** No regression test prevented existing per-level guidance maps from drifting into forbidden tokens. Added `Story 10-4 review patch P9 — cross-check existing per-level guidance vs forbidden tokens` describe block (24 cases: 6 levels × 4 builders — listening, reading, echo, translation). Strips the legitimate constraint block from each rendered prompt, then asserts none of the level's forbidden tokens appear in the residual legacy content. `conversation.ts` is intentionally excluded (the audit's known "Force est de constater" misclassification at the C1-C2 connector example list is owned by Epic 10.7 — including it here would turn a known-out-of-scope item into a 10-4 blocker).
- [x] **[LOW] P15** Aggregated table said "no forbidden tokens (full upper register)" but per-level block said "Forbidden at C1: none — C1 candidates wield the full upper register" — inconsistent calibration language. Unified via shared `NO_FORBIDDEN_WORDING = "none — full upper register"` constant rendered identically across both paths.

### Deferred items (filed for follow-up)

- **DEFER-1:** Helper return value missing trailing `\n`. Cosmetic; integration sites compensate with `\n\n` separators. Not worth a code change.
- **DEFER-2:** "distinct word-forms" terminology vs multi-word locutions (e.g., `parce que` is 2 word-forms but counts as 1 exemplar). Minor terminology nit; renaming `approxWordCap` → `approxLexicalUnitCap` is a future cleanup.
- **DEFER-3:** Integration-test substring coupling — 54 assertions on a literal header string. Acceptable design tradeoff (brittleness is intentional; coupling header format to module export adds indirection without benefit).
- **DEFER-4:** Listening JSON-template "30-600 words depending on level" descriptor pre-exists Story 10-3 and overshoots LEVEL_CONTENT's per-level cap. Out of 10-4 scope; future cleanup story.
- **DEFER-5:** Trailing-newline inconsistency in helper output. Cosmetic; integration sites work correctly.

### Final verification

- **639 tests passing** (was 595 post-implementation, 501 pre-story; net +138 across the whole story)
- All quality gates green: `npm run type-check`, `npm run lint`, `npm run format:check`, `npm test`, `npm run check:colors`
- New module + 2 new test files NOT gitignored (Epic 9 retro A1)
- CI Sentry DSN + Submit credentials leak guards both pass
- 0 HIGH findings remaining
- 0 MED findings remaining
- 0 LOW findings remaining (1 patched, 5 deferred per triage above)

### Cross-story consistency

- Story 10-3's `passage-calibration.test.ts` (114 cases) continues to pass — the new Vocabulary Constraint block is additive and does not contain any of 10-3's negative-substring patterns (`30-50 words`, `200-300 words`, etc.).
- Story 10-2's `scoring.test.ts` / `ircc-bands.test.ts` — no behavior change; vocab tiers are prompt-only.
- Story 10-1's `tcf-spec.test.ts` matrix-completeness checks (16 → 16) — extended with 1 new `it()` block for the §9 vocabulary-tiers.ts row check; existing per-CEFR + per-task + Story 10-2/10-3 row checks unchanged.
