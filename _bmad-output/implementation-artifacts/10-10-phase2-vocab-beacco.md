# Story 10.10: Phase-2 Vocabulary Calibration — Replace Heuristic Caps with Beacco-Verbatim Word Lists

Status: backlog

**Phase-2 follow-up story. ARTIFACT-BLOCKED.** Filed by Epic 10 retrospective (`epic-10-retro-2026-05-10.md` action item B6). Closes `docs/tcf-spec-source.md §7.2 + §7.3 + §10b item #5`. This story **cannot start** until the operator delivers the Beacco volumes (~€120–€180, see Operator-Action Blockers below). Story 10-4 (Phase 1) shipped heuristic-tier caps + 10-20-word curated exemplars per level; this story replaces them with publisher-grade word counts + word lists + page citations.

---

## Story

As a TCF Canada candidate whose practice content is currently constrained by per-CEFR vocabulary caps in [`src/lib/prompts/vocabulary-tiers.ts`](src/lib/prompts/vocabulary-tiers.ts) — A1 ~700 / A2 ~1700 / B1 ~2800 / B2 ~5000 / C1 ~7500 / C2 ~10000 (operator-derived heuristics cross-checked against Beacco _Niveau A1_ samples + DGLF frequency tables) — and a 10-20-word exemplar list per level (Wiktionary CC-BY-SA + DGLF), but the underlying source-of-truth at [`docs/tcf-spec-source.md §7.2`](docs/tcf-spec-source.md) warns: "**⚠️ The numbers below are operator-derived rough caps, NOT Beacco-verbatim.** Beacco's actual per-volume 'Inventaire général' sections give specific numbers that Epic 10.4 MUST source from the published volumes (Didier 2007–2011 series) before locking in prompt-builder caps. The values here are common rough rules of thumb that vary across pedagogy literature — using them as caps without verifying against a sourced Beacco edition risks under-targeting (A1 too narrow) or over-targeting (B2 too wide),"

I want **`vocabulary-tiers.ts` rewritten with Beacco-verbatim data**: (a) per-CEFR `approxWordCap` values replaced with the exact "Inventaire général" word counts from each Beacco volume, with page citations in JSDoc, (b) per-CEFR `exemplars` arrays replaced with the canonical first ~20 entries from each volume's Inventaire (or stratified-sampled if the inventory exceeds N entries — operator decision when the volumes are in hand), (c) `forbiddenLowerTier` lists re-derived from the volumes' upper-tier sections rather than the current `force est de constater` + scattered tokens (operator-derived per §8.1), (d) `docs/tcf-spec-source.md §7.2` table replaced with the Beacco-verbatim numbers + an updated "Source: Beacco _Niveau X pour le français_ (Didier YYYY), p. Z" citation per row, (e) a new `docs/tcf-canada-snapshots/beacco-vocab-inventories-YYYY-MM-DD.md` snapshot of the extracted data (operator-transcribed, since Beacco books are not on the web — same operator-transcribed snapshot pattern Story 10-1 used for the IRCC CLB table when canada.ca returned 403), (f) the existing Phase-1 vocabulary-tiers tests at `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` (40 cases) and `vocabulary-integration.test.ts` (53 surface checks across 9 prompt builders) all stay green, OR are updated in lockstep where the verbatim Beacco numbers diverge from the heuristic — every divergence documented with a Story 10-10 trailer + the Phase-1 → Phase-2 delta,

so that **the §7.2 audit P1-4 finding closes at the publisher-grade level** (Phase-1 closure was heuristic; Phase-2 is verbatim); `docs/tcf-spec-citations.md §9` row "approxWordCap" flips from ✓ Verified-with-caveat to ✓ Verified-publisher-grade; `docs/tcf-spec-source.md §10` follow-up #9 ("Vocabulary frequency caps in prompts" PARTIAL) flips to DONE; the 9 CEFR-aware prompt builders (`listening`, `reading`, `writing`, `conversation`, `echo`, `translation`, `speaking`, `mock-test`, `placement` — Story 10-4 + 10-5 + 10-6 + 10-7 footprint) automatically consume the publisher-grade data without any builder change because Story 10-4 wired them through `buildVocabularyConstraintBlock(cefrLevel)` + `buildAggregatedVocabularyConstraintTable()`. The Phase-1 → Phase-2 transition is **forward-only at the data level** (Phase-1 historical exercise rows are evaluated against the heuristic; post-10-10 rows against publisher-grade) but **byte-compatible at the schema / function-signature level** — no prompt builder change, no Zod schema change, no migration required.

## Operator-Action Blockers

**The operator MUST acquire 4 Beacco volumes (Didier 2007–2011) before this story can be promoted to `ready-for-dev`:**

| Volume | Approx. cost | Required for | ISBN / catalog reference |
| ------ | ------------ | ------------ | ------------------------ |
| Beacco, _Niveau A1 pour le français_ | ~€30-45 | A1 inventory + caps + exemplars | Didier, ISBN 978-2278059331 (verify in operator-action; ISBNs change across editions) |
| Beacco, _Niveau A2 pour le français_ | ~€30-45 | A2 inventory | Didier, verify ISBN at acquisition |
| Beacco, _Niveau B1 pour le français_ | ~€30-45 | B1 inventory | Didier, verify ISBN |
| Beacco, _Niveau B2 pour le français_ | ~€30-45 | B2 inventory | Didier, verify ISBN |
| **Total** | **~€120–180** | All 4 — note Beacco does not publish a Niveau C1/C2 volume; C1/C2 caps stay heuristic per §7.2 | — |

**Where to acquire (operator-action options, in order of preference):**

1. Didier Éditions direct order — https://www.editionsdidier.com/ (search "Niveau A1 pour le français")
2. Amazon France / fnac.fr / decitre.fr (often faster shipping; same publisher edition)
3. Used / library copies via abebooks.fr — acceptable IF the edition matches the operator-selected year (2007 / 2011 reprints have minor inventory revisions; document which year is in hand)

**After acquisition, operator must:**

1. **Transcribe the "Inventaire général" section of each volume** into the snapshot file `docs/tcf-canada-snapshots/beacco-vocab-inventories-YYYY-MM-DD.md` (where YYYY-MM-DD = transcription date). The Inventaire is typically a multi-page lemmatized list with per-entry CEFR markers; transcription scope is the Inventaire only, not the rest of the volume.
2. **Compute SHA-256** of the snapshot file's body (post-frontmatter delimiter) and record in the snapshot frontmatter — mirrors Story 10-1's snapshot integrity pattern.
3. **Note any volume-edition variance** in the snapshot frontmatter (Didier 2007 vs 2011 reprint may have slightly different inventories).
4. **Cite per-row** in the snapshot — every entry includes the source page number.

**Operator-action checklist (for the operator to track when ordering):**

- [ ] Order Beacco A1 volume
- [ ] Order Beacco A2 volume
- [ ] Order Beacco B1 volume
- [ ] Order Beacco B2 volume
- [ ] Wait for delivery
- [ ] Transcribe A1 Inventaire général → snapshot
- [ ] Transcribe A2 Inventaire général → snapshot
- [ ] Transcribe B1 Inventaire général → snapshot
- [ ] Transcribe B2 Inventaire général → snapshot
- [ ] Compute snapshot SHA-256 + record in frontmatter
- [ ] Verify edition year + page-number citations
- [ ] Promote story 10-10 to `ready-for-dev` once snapshot is committed

## Background — Why This Story Exists

### Phase-1 vs Phase-2 distinction (Story 10-4 contract)

Story 10-4 explicitly framed itself as "Phase 1 — heuristic-tier caps." See `docs/tcf-spec-source.md §7.3`:

> Post-Epic-10.4 (Phase 1, 2026-05-10): all CEFR-aware prompt builders in `src/lib/prompts/` carry a Vocabulary Constraint block sourced from [`src/lib/prompts/vocabulary-tiers.ts`](../src/lib/prompts/vocabulary-tiers.ts). The block surfaces (a) a numeric word-form cap per §7.2 heuristic table (A1 ~700 / A2 ~1700 / B1 ~2800 / B2 ~5000 / C1 ~7500 / C2 ~10000), (b) a 10-20-word exemplar list per level (Wiktionary CC-BY-SA + DGLF), and (c) a forbidden-lower-tier list. The Beacco-verbatim word-list replacement (operator-action per §10b item #5) is **deferred to a Phase-2 follow-up sub-story** when the operator delivers the Beacco volumes (Didier 2007–2011).

### What is NOT changing

- **No prompt builder file changes.** Story 10-4 wired all 9 builders through `buildVocabularyConstraintBlock` + `buildAggregatedVocabularyConstraintTable` exactly so a Phase-2 data update would not require touching the builders.
- **No Zod schema changes.** The Vocabulary Constraint block is statically built from the module — no user input flows in (Story 9-4 prompt-injection defense holds without modification).
- **No migration.** This story changes a TypeScript module + a docs snapshot — no DB column, no `exercises` table change.
- **No test infrastructure change.** Existing `vocabulary-tiers.test.ts` (40 cases) and `vocabulary-integration.test.ts` (53 surface checks) continue to run; some assertions may need numeric updates where Phase-2 numbers diverge from Phase-1 heuristics.

## Acceptance Criteria (sketch — to be expanded when story is promoted to `ready-for-dev`)

### 1. Beacco snapshot artifact landed

- [ ] `docs/tcf-canada-snapshots/beacco-vocab-inventories-YYYY-MM-DD.md` committed (operator-action).
- [ ] Snapshot frontmatter: `volumes:` (4 entries with ISBN + edition year + page range) + `transcription_date:` + `sha256:` (over body, post-frontmatter).
- [ ] Snapshot body: per-CEFR section (A1 / A2 / B1 / B2) with the full Inventaire général lemma list + per-lemma page citation.
- [ ] **No mock data, no synthesized lists** — every entry must be operator-transcribed from the physical volume.

### 2. `vocabulary-tiers.ts` rewritten from snapshot data

- [ ] `vocabularyTier(cefrLevel)` returns `{ approxWordCap, exemplars, forbiddenLowerTier }` where:
  - `approxWordCap` = exact Inventaire général entry count from the snapshot
  - `exemplars` = canonical first 20 (or operator-selected sample) entries
  - `forbiddenLowerTier` = upper-tier tokens that the snapshot identifies as level-X+1 or higher
- [ ] **C1 and C2 retain heuristic caps** with explicit JSDoc note ("Beacco does not publish a Niveau C1/C2 volume; per `docs/tcf-spec-source.md §7.2`, C1+ caps remain operator-derived heuristics until a published reference replaces them"). This is the only level-pair where Phase-2 cannot fully close §7.2.
- [ ] All caps + exemplars + forbidden lists JSDoc-cite the snapshot file + the source page (e.g., `// Source: Beacco A1, p. 247-249`).

### 3. `docs/tcf-spec-source.md §7.2` table updated

- [ ] Per-CEFR row updated with the verbatim Beacco numbers.
- [ ] Heuristic-caveat warning at top of §7.2 removed for A1-B2 rows; retained for C1-C2 rows with the "no Beacco volume exists" rationale.
- [ ] §7.3 paragraph updated to mark Phase-1 → Phase-2 transition complete.

### 4. `docs/tcf-spec-source.md §10` follow-up #9 flipped

- [ ] Status flipped from "PARTIAL — closed for the heuristic-tier scope by Story 10-4 on 2026-05-10" to "DONE — closed for the publisher-grade scope by Story 10-10 on [date]" with a one-paragraph closure trailer.

### 5. `docs/tcf-spec-source.md §10b item #5` flipped

- [ ] Operator-action item #5 marked "DONE on [date]" with the snapshot file path as the artifact reference.

### 6. `docs/tcf-spec-citations.md §9` row(s) updated

- [ ] `approxWordCap` / `exemplars` / `forbiddenLowerTier` row flipped from ✓ Verified-with-caveat to ✓ Verified-publisher-grade. C1/C2 entries retain caveat.

### 7. Test surface

- [ ] **EXTEND** `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` — every Phase-1 numeric assertion that diverges from Phase-2 verbatim numbers gets a new assertion pinning the Phase-2 value, with the Phase-1 value documented as a negative-assertion (`expect(...).not.toBe(<phase-1-value>)`) so a future regression cannot revert.
- [ ] **VERIFY** `vocabulary-integration.test.ts` (53 surface checks across 9 prompt builders) — every builder's rendered prompt continues to surface the vocab block. Numeric content may change but block presence + rendering stays.
- [ ] **NEW** snapshot-integrity test in `src/lib/__tests__/beacco-snapshot.test.ts` (or co-located with `tcf-spec.test.ts`) — asserts the snapshot frontmatter's recorded SHA-256 matches the actual body SHA-256 at test time (catches accidental snapshot edits).

### 8. CLAUDE.md

- [ ] Add a new "TCF vocabulary calibration Phase-2 (Beacco-verbatim)" architecture line after the Story 10-X line that immediately precedes 10-10 in chronological order. Documents the Phase-1 → Phase-2 transition + the C1/C2 heuristic-retention rationale.

## Out of Scope (deferred elsewhere)

- **C1 / C2 verbatim calibration** — no Beacco volume exists for these levels. Future hardening could source from Eduscol B2+ documents or DGLF lemma frequencies but is NOT this story's scope.
- **Beacco "Référentiel pour les programmes" content** — broader pedagogy framework outside the per-CEFR vocab inventory. This story limits to the Inventaire général tables only.
- **Prompt-builder changes** — none required. Story 10-4's architecture (per-builder `buildVocabularyConstraintBlock` integration) absorbs the data update transparently.
- **9-criterion speaking rubric** — Story 10-11.
- **Realtime examiner role-play** — Story 10-9.
- **Backfilling pre-10-10 exercises with re-evaluated vocab compliance** — forward-only. The Phase-1 → Phase-2 transition is content-level only; persisted exercise rows are untouched.

## Dependencies

- **Story 10-4** (Phase-1 vocabulary-tiers infrastructure) — required, verified stable. This story is a strict data update of Story 10-4's module.
- **Story 10-5** (placement-test prompt extraction consuming `buildAggregatedVocabularyConstraintTable`) — required, verified stable. Story 10-5's aggregated-table consumer auto-picks up the Phase-2 data with no change.
- **Stories 10-6 / 10-7** (no direct dependency, just downstream consumers via the integration matrix) — verified stable.
- **No Story 10-9 / 10-11 dependency.** This story can land in any order relative to its Phase-2 siblings.

## References

- [Source: docs/tcf-spec-source.md §7.2 — operator-derived heuristic caps + warning that Beacco-verbatim must replace them]
- [Source: docs/tcf-spec-source.md §7.3 — Phase-1 closure paragraph]
- [Source: docs/tcf-spec-source.md §10 follow-up #9 — PARTIAL status with Phase-2 deferral]
- [Source: docs/tcf-spec-source.md §10b item #5 — operator-action to acquire Beacco volumes + cost estimate]
- [Source: src/lib/prompts/vocabulary-tiers.ts — Story 10-4 Phase-1 module (target for rewrite)]
- [Source: src/lib/prompts/__tests__/vocabulary-tiers.test.ts — 40 Phase-1 cases]
- [Source: src/lib/prompts/__tests__/vocabulary-integration.test.ts — 53 surface checks across 9 builders]
- [Source: epic-10-retro-2026-05-10.md action item B6]
- [Source: Beacco, J.-C. _Niveau A1/A2/B1/B2 pour le français — un référentiel_. Didier, Paris, 2007-2011. (operator must acquire)]

## Dev Agent Record

_(To be filled when story is promoted to `ready-for-dev` and implementation begins. Operator action B6 must complete first.)_
