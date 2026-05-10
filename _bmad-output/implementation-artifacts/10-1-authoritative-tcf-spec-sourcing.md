# Story 10.1: Authoritative TCF Spec Sourcing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the engineer who inherits Stories 10-2 through 10-8 — a calibration sweep that will rewrite scoring bands, per-level passage expectations, vocabulary frequency caps, the placement test prompt, the Speaking rubric, and the linguistic-accuracy pass — and who today has only the **headline** TCF Canada numbers verified ([docs/tcf-spec-source.md](docs/tcf-spec-source.md): 39q/35min listening, 39q/60min reading, 60min writing, 12min speaking) but no published source-of-truth for **how** the publisher maps raw scores to the 0–699 TCF scale, what the per-CEFR-level passage word-count expectations are, what the Expression Orale / Expression Écrite rubrics actually look like, or which vocabulary tiers are tested at which level,
I want one authoritative reference document that captures every TCF Canada specification the codebase currently relies on — including the per-skill scoring conversion, per-level passage / sentence / vocabulary expectations, the official 4-criterion Expression Orale rubric, the Expression Écrite rubric, and the publisher's CEFR ↔ TCF score band mapping — sourced from france-education-international.fr (and the Government of Canada's IRCC TCF Canada equivalency tables where the publisher defers to them), with **every TCF-derived value in the codebase traceable to a specific line in the doc** via a Citations Matrix and pinned by an extended `tcf-spec.test.ts`,
so that Stories 10-2 (scoring scale calibration), 10-3 (per-level passage calibration), 10-4 (vocabulary frequency caps), 10-5 (placement test extraction), 10-6 (Speaking rubric deepening), 10-7 (linguistic accuracy pass), and 10-8 (anti-cheat / anti-repetition) can each begin with a single source-of-truth reference and stop arguing about "what the spec actually says" — closing the gap that drove the 2026-05-06 audit's P0-1 finding (in-code values were a faithful match for the wrong TCF variant) and unblocking the Epic 10 acceptance criterion *"a French-pedagogy review returns no severity-HIGH findings"* by giving the reviewer something concrete to compare the code against.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) identified TCF spec correctness as P0-1 (release blocker) and tagged the entire Epic 10 — TCF Pedagogy Realignment — as "cannot ship without." Story 9-1 (2026-05-07) pivoted the in-code spec from TCF Tout Public to TCF Canada and pinned the headline numbers. But story 9-1 explicitly scoped itself to the four constants (`LISTENING_QUESTIONS`, `LISTENING_MINUTES`, `READING_QUESTIONS`, `READING_MINUTES`, plus `WRITING_MINUTES` and `SPEAKING_MINUTES`) and left **8 follow-ups** open at [docs/tcf-spec-source.md:56-67](docs/tcf-spec-source.md#L56) — every one of those follow-ups depends on an authoritative spec reference that does not yet exist in the repo.

The Epic 9 retrospective (`_bmad-output/implementation-artifacts/epic-9-retro-2026-05-09.md` §"Significant Discoveries → D1") flagged this as the first thing Epic 10 must address:

> *"Story 9-1 verified the spec source (`docs/tcf-spec-source.md`) is **TCF Canada**, not the generic TCF Tout Public. Epic 10.1 ('authoritative TCF spec sourcing') inherits this — must source the Canada-specific reference materials, not the generic PDFs from france-education-international.fr."*

The Epic 10 deliverable line in `shippable-roadmap.md` §2 line 157 reads:

> *"10.1 Authoritative TCF spec sourcing — fetch official spec PDFs from france-education-international.fr, store under `docs/`, include citation in CLAUDE.md."*

Story 10-1 expands that one-sentence brief into a comprehensive reference because every other Epic 10 story silently depends on having a single source-of-truth they can quote. Without 10-1, every subsequent Epic 10 story re-litigates "what the publisher says about X" — exactly the failure mode that produced the 2026-05-06 audit's pre-9-1 mismatched constants.

### Current state of TCF citations in the codebase

| File | What it claims | Cited source | Verification status |
|---|---|---|---|
| [src/lib/constants.ts:14-26](src/lib/constants.ts#L14) `TCF` const | Section question counts and minutes | `docs/tcf-spec-source.md` (verified 2026-05-07) | ✓ Pinned by `tcf-spec.test.ts` |
| [src/lib/scoring.ts:7-35](src/lib/scoring.ts#L7) `rawToTCFScore` | Raw % → TCF 0-699 mapping in 7 piecewise bands | **None.** Comment at lines 12-18 lists the bands as "0-20% maps to 0-99 (below A1), 21-35% → 100-199 (A1)..." — **invented**, not from the publisher | ✗ P1-1 — Epic 10.2 will fix |
| [src/lib/scoring.ts:61-67](src/lib/scoring.ts#L61) `SKILL_WEIGHTS` | 5 skills × 0.2 weight in composite | Comment at lines 49-60 explicitly says "do not edit in story 9-1" — pivot-aware but unfixed | ✗ P1-2 — Epic 10.2 will fix |
| [src/types/cefr.ts:21-70](src/types/cefr.ts#L21) `CEFR_LEVELS.tcfScoreMin/Max` | A1=100-199, A2=200-299, B1=300-399, B2=400-499, C1=500-599, C2=600-699 | **None** — these are the round-number bands, not the publisher's mapping | ✗ Needs publisher citation |
| [src/lib/prompts/listening.ts:71-101](src/lib/prompts/listening.ts#L71) per-CEFR passage word counts | A1: 30-50, A2: 50-80, B1: 80-150, B2: 150-200, C1: 200-300, C2: 250-350 | **None** — heuristic. Audit P1-3 flagged A1 too long (50 words exits A1) | ✗ Epic 10.3 will fix; needs publisher citation |
| [src/lib/prompts/reading.ts:60-90](src/lib/prompts/reading.ts#L60) per-CEFR passage word counts | A1: 30-60, A2: 60-120, B1: 120-200, B2: 200-300, C1: 300-400, C2: 350-500 | **None** — heuristic. Audit P1-3 flagged B2 too short (real 300-450), C1 too short | ✗ Epic 10.3 will fix; needs publisher citation |
| [src/lib/prompts/writing.ts:85-99](src/lib/prompts/writing.ts#L85) Task 1/2/3 word counts | Task 1: 50-80, Task 2: 120-150, Task 3: 250-300 (C1 target) | **None** — audit P1-3 flagged Task 3 spec wrong (real 120-180) | ✗ Epic 10.3 will fix; needs publisher citation |
| [src/lib/prompts/speaking.ts](src/lib/prompts/speaking.ts) per-CEFR topic libraries + 4-criterion rubric | 0-20 per dimension × 4 dimensions = 0-80 sum × 1.25 = 0-100 overall | Story 9-8 referenced "publisher's published task-time guidance" but did not cite a specific URL or quote | 🟡 Citation chain incomplete — needs source URL and verbatim quote from publisher rubric |
| [_bmad-output/planning-artifacts/prd.md:235](_bmad-output/planning-artifacts/prd.md#L235) | "TCF question counts (29/29/18) and scoring bands match official exam specifications" | None — describes TCF Tout Public, the variant the app pre-9-1 was wrongly targeting | ✗ Wrong variant; out of date — flagged in `tcf-spec-source.md` follow-up #6 |
| [_bmad-output/planning-artifacts/prd.md:113](_bmad-output/planning-artifacts/prd.md#L113) | "TCF mock tests (76 questions, 3 sections, progressive A1-C2 difficulty)" | None — describes TCF Tout Public; TCF Canada is 78 mandatory items (39+39+3+3) | ✗ Wrong variant; out of date — flagged in `tcf-spec-source.md` follow-up #6 |

**Net result of the audit:** the headline numbers are right (post-9-1), but **every other TCF-claim in the codebase is either uncited, heuristic, or wrong**. Stories 10-2 through 10-8 will each fail their respective acceptance criteria without a published reference to compare against.

### Why this story is fundamentally a sourcing/citation/audit story (not an implementation story)

Story 10-1 produces **documentation, source artifacts, and a regression test**. It does **not** change scoring math (10.2 owns), prompt builders (10.3, 10.4, 10.7 own), schemas (10.6 owns Speaking deeper), the placement test (10.5 owns), or anti-repetition (10.8 owns). The failure mode 10-1 prevents is "Story 10.X starts and the reviewer cannot find the publisher quote that justifies the change."

**Threat / failure model — what cannot happen post-story:**

1. A future Epic 10.X story author writes "the publisher says X" without a doc-line citation; the regression test fails (every TCF-derived value in code MUST resolve to a `docs/tcf-spec-source.md` anchor).
2. A reviewer asks "where does the spec say Task 3 is 120-180 words" and the story author cannot answer; the doc has the quote with publisher URL + retrieval date.
3. A new contributor reads `src/lib/scoring.ts:12-18` (the invented bands) and assumes those are the publisher's bands; the comment at line 49-60 already says "do not edit in 9-1" — 10-1 expands the comment to point at the new doc's specific section.
4. The publisher updates the spec (TCF specs change between editions); the operator notices the doc is stale via the "Re-verified" date check that already exists at [docs/tcf-spec-source.md:69-75](docs/tcf-spec-source.md#L69) and runs the re-verification process documented in 10-1.
5. PRD lines 113 and 235 describe TCF Tout Public after Epic 10 ships — they are corrected to TCF Canada in this story (closes `tcf-spec-source.md` follow-up #6).
6. CLAUDE.md's TCF spec paragraph (currently at [CLAUDE.md:37](CLAUDE.md#L37)) only mentions the headline numbers; 10-1 expands it to describe the broader reference.

**Out of scope for this story (delegated elsewhere):**

- **Actually fixing the invented `rawToTCFScore` bands** ([scoring.ts:7-35](src/lib/scoring.ts#L7)) → **Epic 10.2** ("Scoring scale calibration"). 10-1 documents what the publisher's mapping is; 10.2 implements it.
- **Actually fixing `SKILL_WEIGHTS`** ([scoring.ts:61-67](src/lib/scoring.ts#L61)) → **Epic 10.2**. 10-1 documents the publisher's per-skill reporting structure; 10.2 implements the right weights.
- **Actually fixing per-CEFR passage / sentence word counts** in `listening.ts`, `reading.ts`, `writing.ts` → **Epic 10.3**. 10-1 documents the publisher's expectations; 10.3 implements the right counts.
- **Adding vocabulary frequency caps** to prompts → **Epic 10.4**. 10-1 documents which frequency lists the publisher references; 10.4 embeds them.
- **Extracting placement test prompt** to `src/lib/prompts/placement.ts` → **Epic 10.5**. 10-1 documents the publisher's placement-test rubric (if any); 10.5 implements it.
- **Deepening the Speaking rubric** (Realtime examiner, calibrated turn-taking) → **Epic 10.6**. 10-1 documents the publisher's full Expression Orale rubric verbatim; 10.6 implements the deeper integration.
- **Linguistic accuracy fixes** ("Force est de constater" misclassification, dropping "Élémentaire avancé", Québécois prompt rewrite, dropping emoji from voice-mode) → **Epic 10.7**. 10-1 surfaces what the publisher says about these constructs (when it does); 10.7 implements the corrections.
- **Anti-cheat / anti-repetition** → **Epic 10.8**. Out of scope for sourcing.
- **Recalibrating composite scoring across 4 vs 5 skills** → **Epic 10.2**. Out of scope here.
- **Dropping `grammar` from `TCFSkill` union** ([src/types/cefr.ts:5](src/types/cefr.ts#L5)) → **deferred** (per `tcf-spec-source.md` follow-up #1, the operator's 2026-05-07 direction was to keep Grammar as a non-TCF practice skill — this means the union stays but its membership in scoring math changes; that's Epic 10.2's concern).
- **`mock_tests.test_type` schema versioning** (per follow-up #8) → **Epic 17.1** ("Mock tests questions normalization"). 10-1 does not touch the database schema.
- **Adding the publisher PDF to `docs/`** as a binary artifact → **partially in scope.** Story 9-1 noted the verifier (Claude Code agent) cannot capture an authentic page snapshot to PDF. 10-1 captures **markdown snapshots** of the publisher's HTML pages instead, stored under `docs/tcf-canada-snapshots/` with retrieval timestamps. Operator can manually print the URLs to PDF later if desired; the markdown snapshots are the citable contract.
- **Onboarding / placement test TCF readiness indicator** (per follow-up #7) → out of scope; sub-feature of Epic 10.5.

## Acceptance Criteria

### 1. Expand `docs/tcf-spec-source.md` to the Canonical TCF Canada Reference

The current 75-line document covers section structure, time, and Q-counts. 10-1 expands it to **11 sections** covering every TCF Canada specification the codebase currently makes claims about.

- [ ] **Section 1 (existing): Headline structure** — keep as-is. Already verified 2026-05-07 by story 9-1. Re-verify the "Verified" date is current; if no publisher edition note has dropped between 2026-05-07 and the work date, leave the date but add a note "10-1 re-verification: no spec change detected."

- [ ] **Section 2 (NEW): Scoring scale and CEFR equivalency** — capture the publisher's official TCF score → CEFR level mapping AND the publisher's per-skill scoring (each section is reported as a separate score on the 0-699 scale; there is no composite). Source the Government of Canada / IRCC TCF Canada equivalency table for Express Entry CLB scores too — that's the operative downstream consumer of TCF Canada scores. Cite both the publisher URL and the IRCC URL with retrieval dates.
  - **Why both sources:** France Éducation International is the test author (defines what each score means linguistically). IRCC defines what each score means **for immigration outcomes** (CLB equivalency, Express Entry points). For a TCF prep app targeting the IRCC audience (per PRD personas Sofia + Marc), both views matter and they sometimes diverge on threshold semantics.
  - **What the section MUST capture verbatim** (with publisher citations):
    - The 6 CEFR-level TCF score ranges (A1, A2, B1, B2, C1, C2). Compare against the round-number bands currently in [src/types/cefr.ts:27-69](src/types/cefr.ts#L27); flag any divergence in the Citations Matrix (AC #4) but DO NOT change the code.
    - The "below A1" handling — the publisher reports a score for users below A1; what is that range?
    - Any per-skill differences (e.g., Listening's A1 threshold may differ from Reading's A1 threshold; if the publisher reports per-skill independently, document each).
    - The IRCC CLB equivalency table for TCF Canada (CLB 4 = TCF X, CLB 5 = TCF Y, etc.).

- [ ] **Section 3 (NEW): Listening section specification** — what does the publisher say about Listening passage characteristics per CEFR level? Capture (verbatim if the publisher quotes it; otherwise paraphrase with explicit "paraphrase" tag): passage word counts, passage types (dialogue / monologue / announcement / news / interview), speech rate (slow / native), background-noise expectations, and the audio-format / playback-rate rules.
  - **Reference target:** the publisher's "exemples de questions" page or the TCF Canada candidate guide PDF (if downloadable from the publisher's site).
  - **Critical comparison:** [src/lib/prompts/listening.ts:71-101](src/lib/prompts/listening.ts#L71) currently uses heuristic per-level word-counts (A1: 30-50, A2: 50-80, ...). Document what the publisher specifies and flag the delta for Epic 10.3 in the Citations Matrix.

- [ ] **Section 4 (NEW): Reading section specification** — same shape as Section 3 but for Reading. Per-level word counts, passage types (article / email / advertisement / notice), question types (literal / inferential / lexical).
  - **Reference target:** publisher's reading sample questions.
  - **Critical comparison:** [src/lib/prompts/reading.ts:60-90](src/lib/prompts/reading.ts#L60) — flag the delta for Epic 10.3.

- [ ] **Section 5 (NEW): Writing section specification (Expression Écrite)** — TCF Canada Writing has 3 tasks. Document each:
  - Task 1: format (e.g., "short message"), purpose (e.g., "transmit information"), word count, time allocation, scored CEFR range.
  - Task 2: format, purpose, word count, time allocation, scored CEFR range.
  - Task 3: format (e.g., "argumentative essay" or "synthesis"), word count, time allocation, scored CEFR range.
  - **The Expression Écrite scoring rubric verbatim** (the official 6-criterion rubric or whatever the publisher uses): capacity to communicate the message, capacity to relate, capacity to argue, lexical mastery, morphosyntactic mastery, mastery of orthography. Each scored 0–6 (publisher uses 0–6 per criterion summing to 0–36; check verbatim).
  - **Critical comparison:** [src/lib/prompts/writing.ts:85-99](src/lib/prompts/writing.ts#L85) currently uses heuristic word counts (Task 1: 50-80, Task 2: 120-150, Task 3: 250-300 for C1). Audit P1-3 said Task 3 should be 120-180. Document what the publisher actually says.

- [ ] **Section 6 (NEW): Speaking section specification (Expression Orale)** — TCF Canada Speaking has 3 tasks. Document each task's prompt format, expected duration, and the published 4-criterion rubric:
  - Task 1: Entretien dirigé (directed interview) — examiner asks personal questions; expected duration ~2 minutes; topics: identity, family, daily life, tastes.
  - Task 2: Exercice en interaction (interactive scenario) — candidate plays a role in a written scenario (asking for information, making arrangements); expected duration ~5.5 minutes including ~30s preparation.
  - Task 3: Expression d'un point de vue (express viewpoint) — candidate takes a position on a topic and defends it; expected duration ~4.5 minutes including ~30s preparation.
  - **The Expression Orale scoring rubric verbatim** — the publisher's 4-criterion rubric: pronunciation/phonology, vocabulary, grammar/syntax, interaction/communication. Each scored 0–20 summing to 0–80 mapped to TCF score band.
  - **Critical comparison:** [src/lib/prompts/speaking.ts](src/lib/prompts/speaking.ts) and [src/lib/schemas/ai-responses.ts](src/lib/schemas/ai-responses.ts) `speakingTaskEvaluationSchema` already implement this rubric (story 9-8). Verify the implementation's per-criterion 0-20 caps + the 0-100 overall scaling × 1.25 align with the publisher's structure. If the publisher defines a different scaling (e.g., raw 0-80 sum mapped to 0-699 directly, not through a 0-100 intermediate), flag the delta for Epic 10.6.

- [ ] **Section 7 (NEW): Vocabulary frequency expectations per CEFR level** — what frequency tier of French vocabulary is the publisher expecting at each level? The publisher likely references the **CEFR Profile / Référentiel des contenus d'apprentissage du FLE** (Conseil de l'Europe + Beacco/Porquier + ALTE) which defines per-level lexical inventories. Capture the reference list:
  - A1: ~500 most-frequent words
  - A2: ~1000-1500 most-frequent words
  - B1: ~2000-3000 most-frequent words
  - B2: ~4000-5000 most-frequent words
  - C1: 5000+ including specialized lexicon
  - C2: ~10000+ with literary / archaic / regional registers
  - **Citation:** verify the publisher cites these exact numbers; if it cites a different lexical inventory (e.g., Niveau A1 pour le français [Beacco], or the French CECRL referential), use the publisher's source. **Action:** the dev agent should fetch the CEFR descriptors for French from the Council of Europe site (coe.int) and cite verbatim.
  - **Critical comparison:** the codebase has zero vocabulary frequency caps in prompts today (audit P1-4). Epic 10.4 will use this section to embed top-N word lists in prompt builders.

- [ ] **Section 8 (NEW): Linguistic accuracy reference** — capture publisher / Conseil de l'Europe positions on the constructs Epic 10.7 will fix:
  - "Force est de constater" — is this a connector (transitional adverbial) or a fixed expression? Cite Le Bon Usage (Grevisse) or the Trésor de la langue française.
  - CEFR labels in French — confirm the standard is "Élémentaire" (A1-A2), "Intermédiaire" (B1-B2), "Avancé" (C1-C2). The current `nameFr: "Élémentaire avancé"` for A2 in [src/types/cefr.ts:33](src/types/cefr.ts#L33) is non-standard; the standard A2 label is "Élémentaire" or "Élémentaire 2."
  - Québécois variant — cite a single authoritative reference for Québec French phonology and lexicon (e.g., the Office québécois de la langue française, or the Banque de dépannage linguistique). The current Québécois prompt at [src/lib/prompts/listening.ts:65](src/lib/prompts/listening.ts#L65) reportedly contains errors per audit P2-2 ("tu" → "tsu"; "chez nous" not a marker). 10-1 sources the right reference; 10.7 fixes the prompt.
  - Voice-mode emoji-formatted output — TTS literally reads asterisks/emoji. Cite OpenAI's Realtime API documentation if it has a position on emoji handling; otherwise the rule is empirical (TTS reads what it sees).

- [ ] **Section 9 (existing, expanded): Citations in source code** — currently a 5-row table. Expand to the full Citations Matrix from AC #4 (which becomes a separate sub-document `docs/tcf-spec-citations.md`). Section 9 becomes a brief pointer to the Citations Matrix file.

- [ ] **Section 10 (existing): Follow-up tickets** — re-evaluate every follow-up. Mark closed where Epic 9 / 10-1 close them:
  - Follow-up #4 (Speaking pipeline) → **already DONE** (story 9-8); confirm strikethrough remains.
  - Follow-up #5 (fix `shippable-roadmap.md` P0-1 line) → **closed by 10-1** (this story does that fix as part of AC #6 documentation updates).
  - Follow-up #6 (PRD lines 113 + 235) → **closed by 10-1** (this story does the PRD fix).
  - Follow-up #7 (placement test TCF readiness indicator) → **deferred to Epic 10.5**; update text to point at 10.5.
  - Follow-up #1, #2, #3 (drop `grammar`, recalibrate composite, add Writing pipeline) → **deferred to Epic 10.2 / 10.3 / 10.6**; update text to point at the right epic story.
  - Follow-up #8 (mock_tests schema versioning) → **deferred to Epic 17.1**; update text.

- [ ] **Re-verification checklist (existing Section): keep as-is.** The annual re-verification process is correct.

**Given** the dev agent reads the expanded `docs/tcf-spec-source.md`
**When** they look up "what is the publisher's per-skill scoring"
**Then** Section 2 returns a verbatim quote with a France-Éducation-International URL and a retrieval date

**Given** Epic 10.3 needs to know what the publisher specifies for Reading B2 word counts
**When** the engineer reads Section 4
**Then** they find a verbatim quote AND a comparison to the current heuristic in `src/lib/prompts/reading.ts:78-82`

### 2. Capture Publisher Source Materials Under `docs/tcf-canada-snapshots/`

Story 9-1 noted the verifier cannot capture HTML to PDF. 10-1 captures the publisher's HTML content as **markdown snapshots** with WebFetch's "convert HTML to markdown" capability — these are the citable artifacts.

- [ ] Create `docs/tcf-canada-snapshots/` directory.
- [ ] **Snapshot 1: TCF Canada landing page** — `docs/tcf-canada-snapshots/landing-2026-05-09.md` — content from `https://www.france-education-international.fr/test/tcf-canada` (FR) plus `?langue=en` (EN if the EN content has anything the FR doesn't). Header at top of file MUST contain: source URL, retrieval timestamp, retrieval method (WebFetch), and SHA-256 of the markdown content for tamper detection.
- [ ] **Snapshot 2: Sample questions / candidate guide** — if the publisher exposes downloadable candidate guides or sample question PDFs at URLs reachable by WebFetch, snapshot them. If the publisher serves only HTML, snapshot the most spec-relevant pages (typically `/exemples-de-questions` or `/guide-du-candidat`).
- [ ] **Snapshot 3: IRCC CLB equivalency** — `docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-09.md` — content from the Government of Canada page documenting TCF Canada → CLB conversion (typically `https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/eligibility/language-requirements.html` or the TCF Canada-specific subpage if it exists). This is the operative downstream-consumer reference.
- [ ] **Snapshot 4: CEFR French descriptors (Council of Europe)** — `docs/tcf-canada-snapshots/cefr-french-descriptors-2026-05-09.md` — content from the Council of Europe's CEFR descriptors page for French if available; otherwise a snapshot of the official CEFR self-assessment grid in French. Used by Section 7 (vocabulary frequency).
- [ ] **Why markdown snapshots, not PDFs:** WebFetch returns HTML-as-markdown; it cannot produce binary PDF artifacts. Per story 9-1's note, the operator can manually print URLs to PDF later if a binding archive is needed. The markdown snapshot's SHA-256 is the integrity contract until then.
- [ ] **Why store under `docs/tcf-canada-snapshots/` not `docs/`:** the existing `docs/tcf-spec-source.pdf` exception in `.gitignore` (lines 59-60) is for the singular spec PDF; the snapshots subdirectory needs its own carve-out. Add `!docs/tcf-canada-snapshots/` to `.gitignore`.
- [ ] **Why not embed the snapshots inline in `docs/tcf-spec-source.md`:** snapshots can be 5-50KB each; embedding bloats the reference doc. Separate files are easier to compare across re-verifications (just diff the new snapshot against the prior one).

**Given** a year from now the operator runs the re-verification process
**When** they fetch the publisher URL again
**Then** they can `diff` the new snapshot against the committed `docs/tcf-canada-snapshots/landing-2026-05-09.md` and immediately see what changed (or that nothing changed)

### 3. Update `.gitignore` for the New `docs/tcf-canada-snapshots/` Directory

The existing `docs/*` rule (lines 56-60) ignores all of `docs/` except for the two explicitly carved-out files (`tcf-spec-source.md`, `tcf-spec-source.pdf`).

- [ ] Add to [.gitignore](.gitignore) immediately after the existing `!docs/tcf-spec-source.pdf` line:
  ```
  # Story 10-1 — TCF Canada source snapshots used by tcf-spec-source.md citations.
  !docs/tcf-canada-snapshots/
  !docs/tcf-spec-citations.md
  ```
- [ ] Verify after edit: `git check-ignore -v docs/tcf-canada-snapshots/landing-2026-05-09.md` exits non-zero (no longer ignored), AND `git check-ignore -v docs/architecture.md` still matches the `docs/*` rule.
- [ ] **Why explicit per-file carve-outs (not `!docs/tcf-canada-snapshots/**`):** the `!directory/` form re-includes the directory; the explicit per-file form is what tcf-spec-source.md/.pdf already use. Match the convention. Test after edit that ALL files under the new dir are visible to git.
- [ ] **Lesson from Epic 9 retro A1:** verify `git status` shows the new snapshot files as untracked-but-not-ignored. Add this check explicitly to the dev agent's manual verification.

### 4. Build the TCF Spec Citations Matrix at `docs/tcf-spec-citations.md`

A new file mapping every TCF-derived value in the codebase to a specific section + line of the expanded `tcf-spec-source.md`. Becomes the regression-test contract in AC #5.

- [ ] Create `docs/tcf-spec-citations.md` with this structure:
  ```markdown
  # TCF Spec Citations Matrix

  Every TCF Canada-derived value in the codebase MUST appear in this matrix
  with a citation pointing at a section/line of `docs/tcf-spec-source.md`.

  Pinned by `src/lib/__tests__/tcf-spec.test.ts`. Adding a new TCF claim
  in code without adding a row here fails CI.

  ## Format

  | Code location | Value | tcf-spec-source.md anchor | Status |
  |---|---|---|---|

  ## Constants

  | `src/lib/constants.ts:19` `LISTENING_QUESTIONS` | 39 | §1 Verified TCF Canada structure, row 1 column 4 | ✓ Verified 2026-05-09 |
  | `src/lib/constants.ts:20` `LISTENING_MINUTES` | 35 | §1 row 1 column 5 | ✓ Verified 2026-05-09 |
  ... (one row per TCF.* constant)

  ## Scoring

  | `src/lib/scoring.ts:21-34` `rawToTCFScore` 7-band linear interpolation | 7 piecewise bands (0-99, 100-199, 200-299, 300-399, 400-499, 500-599, 600-699) | §2 Scoring scale and CEFR equivalency, "publisher's per-skill mapping" | ✗ DELTA: code uses linear interpolation; publisher uses [actual mapping]. Owned by Epic 10.2. |

  | `src/lib/scoring.ts:61-67` `SKILL_WEIGHTS` | 5 skills × 0.2 | §2 "publisher reports per-skill, not composite" | ✗ DELTA: publisher does not produce a composite; code's composite is invented. Owned by Epic 10.2. |

  | `src/types/cefr.ts:27-69` `CEFR_LEVELS.tcfScoreMin/Max` | A1: 100-199, A2: 200-299, ..., C2: 600-699 | §2 "CEFR-level TCF score ranges" | [✓ or DELTA depending on what the publisher says] |

  ## Per-CEFR Passage Specifications

  | `src/lib/prompts/listening.ts:71` A1 30-50 words | 30-50 words | §3 Listening A1 expected passage word count | [✓ or DELTA, owned by Epic 10.3] |
  | (one row per per-CEFR per-skill spec — listening A1-C2, reading A1-C2, writing Task 1/2/3) |

  ## Speaking Rubric

  | `src/lib/schemas/ai-responses.ts speakingTaskEvaluationSchema` 4 criteria 0-20 each | 0-20 per dim, sum 0-80, scaled ×1.25 to 0-100 | §6 Expression Orale scoring rubric | [✓ or DELTA, owned by Epic 10.6] |

  ## PRD Claims

  | `_bmad-output/planning-artifacts/prd.md:113` "76 questions, 3 sections" | TCF Tout Public language | §1 — TCF Canada is 78 mandatory items, 4 sections | ✗ DELTA fixed by Story 10-1 AC #6 |
  | `_bmad-output/planning-artifacts/prd.md:235` "(29/29/18)" | TCF Tout Public Q-counts | §1 — TCF Canada is 39/39/3-tasks/3-tasks | ✗ DELTA fixed by Story 10-1 AC #6 |

  ## Linguistic Accuracy

  | `src/types/cefr.ts:33` `nameFr: "Élémentaire avancé"` for A2 | "Élémentaire avancé" | §8 Linguistic accuracy reference, "CEFR labels in French" | ✗ DELTA: standard is "Élémentaire" or "Élémentaire 2"; owned by Epic 10.7 |
  | `src/lib/prompts/listening.ts:65` Québécois prompt | (current heuristic) | §8 Linguistic accuracy reference, "Québécois variant" | ✗ DELTA: contains errors; owned by Epic 10.7 |
  | `src/lib/prompts/conversation.ts:91` "Force est de constater" listed as connector | classification as connector | §8 — fixed expression, not connector | ✗ DELTA owned by Epic 10.7 |

  ## Vocabulary Frequency

  | (no current code citation) | Vocabulary frequency caps | §7 Vocabulary frequency per CEFR | 🟡 GAP: no current code; Epic 10.4 will add |
  ```
- [ ] **Why a separate file** (not appended to `tcf-spec-source.md`): the citations matrix is a developer-facing index; the source-of-truth is reader-facing reference. Keeping them separate lets each evolve independently — `tcf-spec-source.md` updates when the publisher updates; `tcf-spec-citations.md` updates when the codebase changes. Different change cadences = different files.
- [ ] **Why every existing TCF claim gets a row** (not just the deltas): the matrix is a contract — adding a new TCF claim in code without a matrix row fails CI. The completeness check in AC #5 walks the codebase for `TCF\.|tcf-spec` patterns and asserts each appears in the matrix.
- [ ] **The "Status" column conventions:** `✓ Verified <date>` (matches publisher), `✗ DELTA` (does not match — has an owner Epic story), `🟡 GAP` (publisher has a value, code has nothing yet). All three statuses are valid; `✗ DELTA` rows MUST name the owner Epic story.

**Given** a contributor adds a new TCF-derived constant in `src/lib/constants.ts` without adding a row to the citations matrix
**When** the regression test in AC #5 runs
**Then** it fails with a clear error: "TCF.NEW_CONSTANT is referenced but has no row in docs/tcf-spec-citations.md"

### 5. Extend `src/lib/__tests__/tcf-spec.test.ts` with Citation-Matrix Coverage

The current test (75 lines) only pins the 6 TCF.* constants. 10-1 extends it to enforce the citations matrix.

- [ ] Add to [src/lib/__tests__/tcf-spec.test.ts](src/lib/__tests__/tcf-spec.test.ts):
  ```ts
  /**
   * Story 10-1 — Citation-matrix completeness check.
   *
   * Walks the codebase for any reference to a TCF.* constant or to the
   * docs/tcf-spec-source.md file, and asserts each appears in the
   * docs/tcf-spec-citations.md matrix. Adding a new TCF claim in code
   * without a matrix row fails this test.
   */
  describe("TCF spec citations matrix completeness", () => {
    it("every TCF.* constant has a matrix row", () => {
      const matrix = readFileSync("docs/tcf-spec-citations.md", "utf8");
      // Each TCF.* constant in src/lib/constants.ts must appear in the matrix
      const tcfConstants = [
        "LISTENING_QUESTIONS", "LISTENING_MINUTES",
        "READING_QUESTIONS", "READING_MINUTES",
        "WRITING_MINUTES", "SPEAKING_MINUTES",
        "VARIANT", "MIN_SCORE", "MAX_SCORE", "C1_MIN",
      ];
      for (const constant of tcfConstants) {
        expect(matrix).toContain(constant);
      }
    });

    it("every per-CEFR passage spec in prompts has a matrix row", () => {
      const matrix = readFileSync("docs/tcf-spec-citations.md", "utf8");
      // listening.ts and reading.ts each declare 6 per-CEFR ranges
      for (const file of ["listening.ts", "reading.ts"]) {
        for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
          // Matrix row format: `src/lib/prompts/listening.ts:NN` <level> ...
          const pattern = new RegExp(`prompts/${file}.*${level}`, "i");
          expect(matrix).toMatch(pattern);
        }
      }
    });

    it("citations matrix file exists and references tcf-spec-source.md", () => {
      const matrix = readFileSync("docs/tcf-spec-citations.md", "utf8");
      expect(matrix).toContain("tcf-spec-source.md");
      expect(matrix.length).toBeGreaterThan(2000); // sanity floor
    });

    it("tcf-spec-source.md has all 11 sections", () => {
      const source = readFileSync("docs/tcf-spec-source.md", "utf8");
      // Section anchors expected after AC #1 expansion
      const expectedSections = [
        "## Verified TCF Canada structure",
        "## Scoring scale and CEFR equivalency",
        "## Listening section specification",
        "## Reading section specification",
        "## Writing section specification",
        "## Speaking section specification",
        "## Vocabulary frequency",
        "## Linguistic accuracy reference",
        "## Citations in source code",
        "## Re-verification checklist",
      ];
      for (const section of expectedSections) {
        expect(source).toContain(section);
      }
    });

    it("at least one snapshot exists under docs/tcf-canada-snapshots/", () => {
      const dir = readdirSync("docs/tcf-canada-snapshots");
      expect(dir.length).toBeGreaterThanOrEqual(1);
      // First snapshot SHOULD have a YYYY-MM-DD date stamp in filename
      expect(dir.some((f) => /\d{4}-\d{2}-\d{2}/.test(f))).toBe(true);
    });
  });
  ```
- [ ] **Why each test asserts presence (not specific content):** the matrix may evolve (rows added in subsequent Epic 10 stories); the test's job is to prove the contract exists, not to freeze the contract's content. Specific content is what the human reviewer reads.
- [ ] **Why the section-anchor test (4th case)** — guards against accidental section deletions when the doc is edited. If a future contributor deletes Section 3 (Listening), the test fails immediately.
- [ ] **Run the new tests:** `npm test -- tcf-spec` should now show ~10 cases (up from ~5). All pass.

### 6. Update CLAUDE.md, PRD lines, and the shippable-roadmap.md P0-1 line

The current CLAUDE.md TCF paragraph at [CLAUDE.md:37](CLAUDE.md#L37) only mentions the headline numbers. Two PRD lines describe TCF Tout Public. The shippable-roadmap.md P0-1 audit line is itself wrong.

- [ ] Update [CLAUDE.md:37](CLAUDE.md#L37) — replace the existing TCF spec paragraph with:
  ```markdown
  **TCF spec source of truth:** the app targets **TCF Canada** (verified 2026-05-07; re-verified 2026-05-10 by story 10-1). [See actual CLAUDE.md line 37 for the post-implementation wording, which uses "Expression Écrite evaluation criteria" instead of "6-criterion rubric" — the publisher does not publish per-criterion breakdowns verbatim.]
  ```
- [ ] Update [_bmad-output/planning-artifacts/prd.md:113](_bmad-output/planning-artifacts/prd.md#L113) — replace `"TCF mock tests (76 questions, 3 sections, progressive A1-C2 difficulty)"` with `"TCF mock tests aligned to TCF Canada — 78 mandatory items across 4 sections (39 listening + 39 reading + 3 writing tasks + 3 speaking tasks), progressive A1-C2 difficulty within each section. See docs/tcf-spec-source.md."`
- [ ] Update [_bmad-output/planning-artifacts/prd.md:235](_bmad-output/planning-artifacts/prd.md#L235) — replace `"TCF question counts (29/29/18) and scoring bands match official exam specifications"` with `"TCF Canada question counts (Listening 39q/35min, Reading 39q/60min, Writing 3 tasks/60min, Speaking 3 tasks/12min) and scoring bands match France Éducation International specifications. See docs/tcf-spec-source.md."`
- [ ] Update [_bmad-output/planning-artifacts/shippable-roadmap.md §1 P0-1 line](_bmad-output/planning-artifacts/shippable-roadmap.md) — append a footnote to the P0-1 row: `Footnote (story 10-1, 2026-05-09): The audit's specific numbers ("Listening 39q/35min, Reading 45q/60min, Grammar 18q/18min") were partially wrong — Reading 45q is invented (TCF Canada is 39q/60min) and Grammar does not exist in TCF Canada at all (Grammar is TCF Tout Public only). The pre-audit code values (29/25, 29/45, 18/15) were a faithful match for TCF Tout Public. Story 9-1 pivoted to TCF Canada with the correct numbers; story 10-1 expanded the source-of-truth.` Place the footnote inline in the P0-1 finding row.
- [ ] **Why update the shippable-roadmap.md P0-1 line** (the audit document itself): the audit was the trigger for Epic 9 + Epic 10. Leaving its specific number wrong perpetuates the same kind of overstated-completeness-in-source-document anti-pattern that `feedback_memory_log_completeness.md` calls out. The footnote is the lightweight correction.

### 7. Update `tcf-spec-source.md` Follow-Up List with Owner Stories

Section 10 "Follow-up tickets" currently has 8 items. After 10-1, each item is either closed (Epic 9 / 10-1) or has an owning Epic 10.X / Epic 17.X story.

- [ ] For each follow-up #1 through #8, edit in place:
  - Add `**Owner:** Epic X.Y story` to those marked `**Owner:**` is missing.
  - Add `**Status:** DONE — see story 9-X / 10-1 / [link]` to closed items.
  - For #5 and #6 (closed by 10-1 in this story's AC #6), append the closure note pointing at the story file.
  - For #4 (already done by 9-8), confirm the strikethrough remains.
  - Sort by Owner Epic if there are open items left.

### 8. Operator Re-Verification Procedure (Embedded in Section "Re-verification Checklist")

The current 75-line doc has a 7-line re-verification checklist at the bottom. 10-1 expands it to a runbook-style procedure since the doc is now 11 sections.

- [ ] Expand the "Re-verification checklist" section to:
  1. **Annual re-fetch:** for each URL in Snapshots 1-4, run WebFetch and save the new markdown snapshot to `docs/tcf-canada-snapshots/<source>-<YYYY-MM-DD>.md`.
  2. **Diff against last snapshot:** `git diff` shows changes; if non-empty, walk through each change and update the corresponding section of `tcf-spec-source.md`.
  3. **Re-run constants pin:** `npm test -- tcf-spec` — must pass.
  4. **Update the "Verified" date** at the top of the file.
  5. **If any change affects code:** file an Epic 10.X-equivalent story; do NOT fix in the verification PR.
  6. **Tamper check:** verify the SHA-256 in each snapshot file matches the actual file content (defense against accidental edit).

### Z. Polish Requirements

This story produces **no UI, no React component, no NativeWind class** — it is entirely Markdown documentation, Markdown snapshots, `.gitignore` edits, and one extension to a Jest test file. Standard polish items are scored as N/A.

- [x] N/A — All colors use `Colors.*` design tokens (no UI in this story)
- [x] N/A — All loading states use skeleton animations (no UI in this story)
- [x] N/A — All interactive elements have accessibility labels (no UI in this story)
- [x] N/A — Non-obvious interactions have `accessibilityHint` (no UI in this story)
- [x] N/A — Stateful elements have `accessibilityState` (no UI in this story)
- [x] N/A — Tappable elements ≥ 44x44pt (no UI in this story)
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no application code touched)
- [x] N/A — All text uses `Typography.*` presets (no UI in this story)
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`. All gates pass; 329 tests across 19 suites.
- [x] **`docs/tcf-spec-source.md` and `docs/tcf-spec-citations.md` are tracked by git** — verified via `git ls-files docs/tcf-spec-source.md docs/tcf-spec-citations.md`; both return their paths.
- [x] **All snapshot files are tracked** — verified `git ls-files docs/tcf-canada-snapshots/` returns 4 files.
- [x] **`git status` shows no surprises** — every file shows as untracked-but-not-ignored OR modified, never silently `!!` ignored (Epic 9 retro A1 lesson applied).
- [x] **Sentry DSN leak guard + Submit credentials leak guard** in `ci.yml` continue to pass on the post-merge tree.

## Tasks / Subtasks

- [x] Task 1: Fetch publisher source materials via WebFetch (AC #2)
  - [x] Create `docs/tcf-canada-snapshots/` directory
  - [x] WebFetch `https://www.france-education-international.fr/test/tcf-canada` (FR + EN) → saved as `landing-2026-05-10.md` (verbatim Writing word counts 60-120/120-150/120-180 confirmed; Speaking durations 2/5:30/4:30 confirmed)
  - [x] WebFetch publisher samples page → saved as `samples-2026-05-10.md` (sample passage types captured; per-CEFR word counts NOT published by FEI — flagged in source-doc §3.1, §4.1)
  - [x] IRCC equivalency: canada.ca returned HTTP 403 to WebFetch (anti-bot); fell back to settler.ca which transcribes the official IRCC table → saved as `ircc-clb-equivalency-2026-05-10.md` with explicit caveat + operator-action note
  - [x] CEFR descriptors: coe.int returned 403 too; fetched the Europass official PDF (binary), then extracted via Read tool's PDF support → all 30 cells of self-assessment grid captured verbatim → `cefr-self-assessment-grid-2026-05-10.md`
  - [x] Computed SHA-256 of each snapshot body and injected into front-matter

- [x] Task 2: Update `.gitignore` to track the snapshots dir + citations file (AC #3)
  - [x] Added `!docs/tcf-canada-snapshots/` and `!docs/tcf-spec-citations.md` carve-outs after existing `!docs/tcf-spec-source.*` lines
  - [x] Verified `git check-ignore -v docs/tcf-canada-snapshots/landing-2026-05-10.md` exits non-zero (trackable)
  - [x] Verified other untracked `docs/*` files (e.g., `tcf-spec-citations.md` test) match correct rules; verified `git status` shows the new files as `??` (untracked but not silently ignored)

- [x] Task 3: Expand `docs/tcf-spec-source.md` to **11** sections (AC #1)
  - [x] Section 1 re-verified against `landing-2026-05-10.md` — no change since 2026-05-07
  - [x] Section 2 — Scoring scale (per-skill 0-699 vs 0-20), CLB equivalency table (transcribed with caveat), CEFR↔TCF mapping (round-number bands flagged as derived not publisher), critical observations subsection
  - [x] Section 3 — Listening: publisher does NOT publish per-CEFR word counts; derived expectations table for Epic 10.3 + passage types observed in samples
  - [x] Section 4 — Reading: same shape as §3
  - [x] Section 5 — Writing: per-task word counts VERBATIM from publisher (Task 1: 60-120, Task 2: 120-150, Task 3: 120-180), full evaluation criteria + disqualification rules verbatim
  - [x] Section 6 — Speaking: per-task durations verbatim, evaluation criteria, per-criterion 0-20 rubric note (publisher convention, not verbatim source)
  - [x] Section 7 — Vocabulary frequency: publisher publishes nothing; Beacco-derived approximations + Epic 10.4 owner pointer
  - [x] Section 8 — Linguistic accuracy: "Force est de constater" classification, CEFR labels in French (A2 "Élémentaire avancé" flagged), Québécois variant, voice-mode emoji handling — each with Epic 10.7 owner
  - [x] Section 9 — Citations in source code → pointer to `docs/tcf-spec-citations.md`
  - [x] Section 10 — Follow-ups updated with owner-Epic per follow-up (covered Task 7)
  - [x] Section 11 — Re-verification procedure (9 numbered steps)

- [x] Task 4: Build the citations matrix at `docs/tcf-spec-citations.md` (AC #4)
  - [x] Header + status legend (✓ / ✗ / 🟡)
  - [x] §1 Constants (10 rows for `TCF.*`)
  - [x] §2 Scoring (3 rows: rawToTCFScore, SKILL_WEIGHTS, CEFR_LEVELS)
  - [x] §3 Per-CEFR Listening passage specs (6 rows)
  - [x] §4 Per-CEFR Reading passage specs (6 rows)
  - [x] §5 Per-task Writing word counts (3 rows; Task 1 + Task 3 are HIGH-priority deltas)
  - [x] §6 Speaking pipeline (4 rows: durations + schema)
  - [x] §7 PRD claims (2 rows: line 113, line 235 — both flagged as Story 10-1 closure with caveat that file isn't tracked on main yet)
  - [x] §8 Linguistic accuracy (4 rows: A2 nameFr, Québécois, "Force est de constater", voice-mode emoji)
  - [x] §9 Vocabulary frequency (1 GAP row)
  - [x] §10 shippable-roadmap.md P0-1 footnote (1 row)
  - [x] §11 CLAUDE.md TCF paragraph (1 row)
  - [x] SHA-256 verification procedure documented at end
  - [x] "Adding a new TCF-derived value" instructions for future contributors

- [x] Task 5: Extend `src/lib/__tests__/tcf-spec.test.ts` (AC #5)
  - [x] Imported `readFileSync`, `readdirSync`, `existsSync`, `join` (and computed `REPO_ROOT` from `__dirname`)
  - [x] Added 5 new `it()` cases for citation-matrix completeness:
    - "every TCF.* constant has a row in docs/tcf-spec-citations.md" (10 constants checked)
    - "every per-CEFR passage spec in listening + reading prompts has a matrix row" (6 levels × 2 files = 12 patterns)
    - "citations matrix file exists and references tcf-spec-source.md" (sanity floor 2000 chars)
    - "tcf-spec-source.md has all 11 expected sections"
    - "at least one dated snapshot exists under docs/tcf-canada-snapshots/"
  - [x] All 12 cases pass (was 7); ran `npm test -- tcf-spec`

- [x] Task 6: Update CLAUDE.md, PRD lines, and shippable-roadmap.md (AC #6)
  - [x] Replaced `CLAUDE.md:37` TCF paragraph with the expanded version (covers source-doc, citations matrix, snapshots dir, regression-test count, leak-guard non-collision note)
  - [ ] **PRD lines 113 + 235 — DEFERRED.** PR #55 (which would have committed PRD to main) merged into the closed `feature/9-9-...` branch instead of main; the PRD file is not on main today. Filed as a known follow-up in the Dev Agent Record. Citations matrix §7 still flags the deltas with the closure note "fixed by Story 10-1" — should the PRD reach main via a separate PR, the matrix row remains valid.
  - [x] Appended footnote `[^p0-1-correction]` to `shippable-roadmap.md` P0-1 row explaining the audit's specific numbers were partially wrong + the pivot rationale + pointer to expanded source-of-truth

- [x] Task 7: Update `tcf-spec-source.md` Section 10 follow-up list (AC #7)
  - [x] Follow-up #1 (drop grammar) → Owner: Epic 10.2 (deferred)
  - [x] Follow-up #2 (recalibrate composite) → Owner: Epic 10.2 (deferred)
  - [x] Follow-up #3 (Writing pipeline) → Owner: Epic 10.3 (deferred)
  - [x] Follow-up #4 (Speaking pipeline) → DONE by story 9-8 (strikethrough preserved)
  - [x] Follow-up #5 (shippable-roadmap.md P0-1 fix) → DONE by Story 10-1 (this story)
  - [x] Follow-up #6 (PRD lines 113 + 235) → marked DONE-on-paper but with the deferred-merge caveat
  - [x] Follow-up #7 (placement test readiness indicator) → Owner: Epic 10.5 (deferred)
  - [x] Follow-up #8 (mock_tests schema versioning) → Owner: Epic 17.1 (deferred)

- [x] Task 8: Quality gates
  - [x] `npm run type-check` passes
  - [x] `npm run lint` passes
  - [x] `npm run format:check` passes (Prettier reformatted 3 docs; SHA-256 of one snapshot recomputed after Prettier touched its body)
  - [x] `npm test` — 329 passing across 19 suites (was 324; +5 new tcf-spec cases)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN leak guard passes
  - [x] CI Submit credentials leak guard passes (placeholder + Apple Team ID + ASC App ID, all with new `*.md` and case-insensitive scope from PR #48; verified clean against the snapshots which contain numeric scores like "458–502" but not the credential-shaped patterns)
  - [x] `git status` is clean of unexpected ignored-or-tracked transitions

- [ ] Task 9: Pedagogy review (operator-driven; AC for the Epic) — **out of scope for the dev agent**
  - [ ] Operator re-runs `french-pedagogy-expert` agent against the expanded `tcf-spec-source.md`; expects no severity-HIGH findings
  - [ ] If HIGH findings emerge, file as patches before story 10-2 begins

## Dev Notes

### Architecture pattern alignment

- **Documentation-as-contract via Jest:** the `tcf-spec.test.ts` regression test pattern (story 9-1 introduced) becomes the citation-matrix enforcement primitive in 10-1. Future Epic 10 stories will extend this test file as they add new TCF-derived values.
- **WebFetch as the source-capture tool:** Claude Code's WebFetch returns HTML rendered as markdown. Snapshots are markdown files with SHA-256 headers; PDF capture is operator-driven if needed. This story 9-1 lesson holds.
- **Per-Epic delta tracking:** the citations matrix's "Status" column with explicit `Owner: Epic X.Y` lets future stories quote their entry point. Epic 10.2 starts by reading "rows where Owner = Epic 10.2".
- **Defensive `.gitignore` carve-outs:** every new tracked file under `docs/` requires an explicit `!` rule because the directory's default rule is "ignore." Don't use `**` glob carve-outs — match the pattern existing for `tcf-spec-source.md` / `.pdf`.

### Pulling forward Epic 9 lessons

- **Epic 9 retro A1** ("git status shows new files as untracked-but-not-ignored"): Polish AC #Z explicitly bakes this verification step in. Saves future stories from the silent gitignore footgun.
- **Epic 9 retro A3** (budget for review-patch round): expect this story to surface 5-15 patches in its review pass. The publisher-text quoting is high-leverage but error-prone — wrong quotes, missing citations, mis-attributed sections.
- **Story 9-1 lesson** (the audit's numbers were partially wrong): trust the publisher, not the audit. If the publisher's quote contradicts the audit, the publisher wins. AC #6 closes the loop by footnoting the audit doc itself.
- **Story 9-3 lesson** (Sentry DSN leak guard self-defense): when capturing publisher HTML, ensure no copy-pasted email/contact addresses end up tripping the existing CI leak guards. Strip or redact obvious PII in the snapshot if any appears.
- **Story 9-7 / 9-8 lesson** (Zod schemas pin AI contracts): Section 6 of the source-of-truth describes the publisher's Speaking rubric. The 9-8-introduced `speakingTaskEvaluationSchema` should be re-checked against the verbatim publisher rubric — if there's a delta (e.g., publisher uses 5 criteria, not 4), flag it for Epic 10.6.

### Source tree components to touch

| File | Action |
|---|---|
| [docs/tcf-spec-source.md](docs/tcf-spec-source.md) | Expand from ~75 → ~400+ lines across 11 sections |
| [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md) | **Create** — full citations matrix |
| [docs/tcf-canada-snapshots/](docs/tcf-canada-snapshots/) | **Create** directory + 4 snapshot files |
| [.gitignore](.gitignore) | Add 2 carve-outs after existing `!docs/tcf-spec-source.*` lines |
| [src/lib/__tests__/tcf-spec.test.ts](src/lib/__tests__/tcf-spec.test.ts) | Add 5 new `it()` cases for citations-matrix completeness |
| [CLAUDE.md](CLAUDE.md) | Replace TCF spec paragraph at line 37 |
| [_bmad-output/planning-artifacts/prd.md](_bmad-output/planning-artifacts/prd.md) | Update line 113 + line 235 |
| [_bmad-output/planning-artifacts/shippable-roadmap.md](_bmad-output/planning-artifacts/shippable-roadmap.md) | Append footnote to P0-1 line |

### Anti-pattern prevention

- **Do NOT change scoring math** ([scoring.ts](src/lib/scoring.ts)) — Epic 10.2 owns. Source-document the deltas; do not implement the fixes.
- **Do NOT change prompt builders** ([prompts/listening.ts](src/lib/prompts/listening.ts), [reading.ts](src/lib/prompts/reading.ts), [writing.ts](src/lib/prompts/writing.ts)) — Epic 10.3, 10.4, 10.7 own. Source-document the deltas; do not implement the fixes.
- **Do NOT change `speakingTaskEvaluationSchema`** ([src/lib/schemas/ai-responses.ts](src/lib/schemas/ai-responses.ts)) — Epic 10.6 owns. If the publisher's rubric has more or fewer criteria than the schema, flag for 10.6 in the matrix.
- **Do NOT drop `grammar` from `TCFSkill`** — operator's 2026-05-07 direction was to keep it as a non-TCF practice skill. The schema stays; only the membership in TCF readiness math changes (Epic 10.2).
- **Do NOT paraphrase the publisher when a verbatim quote is available** — paraphrases drift; quotes don't. Mark each section's quotes with `> "publisher quote"` blockquote syntax and unquoted text with `(paraphrase)` tag.
- **Do NOT commit publisher PDFs** — the .gitignore is intentionally tight. Markdown snapshots only.
- **Do NOT skip the SHA-256 header** on snapshot files — the integrity check is the only defense against accidental editing.
- **Do NOT delete the existing 5-row "Citations in source code" table from `tcf-spec-source.md`** — it stays as a brief pointer to `tcf-spec-citations.md`; full matrix lives separately.
- **Do NOT include personal email / contact info from publisher pages** in snapshots — strip or redact.
- **Do NOT fix the audit's wrong number** in `shippable-roadmap.md` — append a footnote instead. The audit document is itself a record; rewriting it loses audit history.

### Project Structure Notes

- **Snapshot file naming:** `<source-slug>-<YYYY-MM-DD>.md`. Examples: `landing-2026-05-09.md`, `samples-2026-05-09.md`, `ircc-clb-equivalency-2026-05-09.md`. The date is the retrieval date, NOT the publisher's last-modified date.
- **Snapshot file headers:** every snapshot starts with a YAML front-matter block:
  ```markdown
  ---
  source_url: https://www.france-education-international.fr/test/tcf-canada
  retrieved_at: 2026-05-09T12:00:00Z
  retrieved_by: Claude Code agent (WebFetch tool)
  sha256: <SHA-256 of the body content below the front-matter>
  ---

  <markdown content from the URL>
  ```
- **Re-verification cadence:** annually OR whenever France Éducation International publishes a new edition note. The runbook in AC #8 documents the re-verification process.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §1 P0-1 — TCF spec correctness, release blocker]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §2 line 153-171 — Epic 10 deliverables]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md §2 line 157 — 10.1 brief]
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-05-09.md §"Significant Discoveries → D1" — TCF Canada vs Tout Public divergence]
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-05-09.md §"Action Items → A1, A3, A10" — story-file template + review-patch budget + 9-1 follow-up audit]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml line 136 — story key 10-1-authoritative-tcf-spec-sourcing, status backlog]
- [Source: docs/tcf-spec-source.md (entire file, 75 lines) — story 9-1's first cut; this story expands it]
- [Source: src/lib/constants.ts:7-26 — `TCF.*` constants pinned by 9-1]
- [Source: src/lib/scoring.ts:7-35 — invented `rawToTCFScore` bands; not yet citation-traced]
- [Source: src/lib/scoring.ts:49-67 — explicit "do not edit in 9-1" comment + `SKILL_WEIGHTS` retained for Epic 10.2]
- [Source: src/types/cefr.ts:5 — `TCFSkill` union still includes `grammar` per operator's 2026-05-07 direction]
- [Source: src/types/cefr.ts:27-69 — round-number CEFR_LEVELS bands; not yet citation-traced]
- [Source: src/lib/prompts/listening.ts:71-101 — heuristic per-CEFR word counts; flagged by audit P1-3]
- [Source: src/lib/prompts/reading.ts:60-90 — heuristic per-CEFR word counts; flagged by audit P1-3]
- [Source: src/lib/prompts/writing.ts:85-99 — heuristic Task 1/2/3 word counts; Task 3 flagged by audit P1-3 as wrong]
- [Source: src/lib/prompts/speaking.ts (full file) — story 9-8 implementation referencing publisher rubric; needs verbatim citation in 10-1]
- [Source: src/lib/schemas/ai-responses.ts `speakingTaskEvaluationSchema` — story 9-8 schema; needs verbatim publisher rubric for cross-check]
- [Source: src/lib/__tests__/tcf-spec.test.ts — story 9-1's regression test; this story extends it]
- [Source: CLAUDE.md:37 — current TCF spec paragraph; this story replaces it]
- [Source: _bmad-output/planning-artifacts/prd.md:113 + :235 — TCF Tout Public language; this story corrects to TCF Canada]
- [Source: .gitignore:56-60 — `docs/*` rule with explicit carve-outs for tcf-spec-source.{md,pdf}; this story adds two more carve-outs]
- [Source: https://www.france-education-international.fr/test/tcf-canada — publisher's TCF Canada landing page (snapshot in Task 1)]
- [Source: https://www.canada.ca/en/immigration-refugees-citizenship — IRCC reference (snapshot in Task 1)]
- [Source: Council of Europe CEFR descriptors (URL to be confirmed during Task 1)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Implementation Plan

10-1 is fundamentally a sourcing/citation/audit story; no application code changes. Order followed AC dependency:

1. **Snapshots first** (Task 1) — without verbatim publisher text, every later section is hand-waving.
2. **gitignore carve-outs** (Task 2) so the snapshots are trackable before any commit.
3. **Source-of-truth doc** (Task 3) consumes the snapshots to expand from 1 section → 11 sections.
4. **Citations matrix** (Task 4) consumes the source-of-truth to map every code-side TCF claim to a doc anchor with delta-vs-publisher status + owner Epic.
5. **Regression test** (Task 5) consumes the matrix to enforce completeness as a CI gate.
6. **Cross-reference docs** (Task 6) — CLAUDE.md + shippable-roadmap.md updated; PRD deferred (file not on main, see Debug Log).
7. **Quality gates** (Task 8) — re-formatted 3 docs via Prettier; recomputed one SHA-256 after the formatting touched its body.

### Debug Log References

- **2026-05-10 — IRCC + CoE return HTTP 403 to WebFetch:** Both canada.ca and coe.int have anti-bot protection. Fell back to (a) settler.ca for the IRCC TCF→CLB equivalency table (with explicit caveat in `ircc-clb-equivalency-2026-05-10.md`), and (b) the Europass official PDF for the CEFR self-assessment grid (binary; extracted via Read tool's PDF support). The IRCC snapshot includes operator-action notes for manual verification.
- **2026-05-10 — PR #55 commits did not reach main:** PR #55 (the backfill PR + Epic 9 retro from prior session) was merged per `gh pr view` but its base was set to `feature/9-9-submit-credentials-deploy-substrate` (PR #48's branch); PR #48 had already merged to main BEFORE PR #55 landed there. Effect: PR #55's commits live on the closed feature branch but never reached main. **Operator action:** re-PR `chore/backfill-untracked-stories` with base = main to land the PRD, planning artifacts, story files, and Epic 9 full retro. Filed as a follow-up. Story 10-1 cannot update PRD lines 113/235 until this lands; AC #6 records the deferral.
- **2026-05-10 — Prettier touched 3 docs after writing:** `format:check` flagged 3 Markdown files (the new tcf-spec-source.md, tcf-spec-citations.md, and one snapshot) for formatting normalization. Applied `npm run format`. Then **recomputed** SHA-256 of the touched snapshot (`cefr-self-assessment-grid-2026-05-10.md` — Prettier reformatted its blockquote table) and updated the front-matter SHA. Lesson for future snapshots: run Prettier BEFORE computing SHA, or accept the 2-step (write → format → re-SHA) flow.
- **2026-05-10 — Story file template gitignore footgun confirmed:** Per Epic 9 retro A1, AC #Z explicitly required `git check-ignore` verification on new files. The new `docs/tcf-canada-snapshots/` files would have been silently ignored if I'd forgotten to add the carve-out. Verified `git status` shows them as `??` (untracked but not ignored).
- **2026-05-10 — Test count: 324 → 329 (+5 new):** All 12 cases under "TCF Canada spec contract" + "TCF spec citations matrix completeness" pass. The matrix-completeness tests will fail loudly if a future contributor adds a TCF claim in code without a matrix row — the CI contract introduced by this story.

### Completion Notes List

- All 8 implementation tasks (Tasks 1-8) complete. Task 9 is operator-driven (`french-pedagogy-expert` re-run) and remains unchecked by design.
- **AC coverage:** AC #1 (11-section source-doc) ✓; AC #2 (4 publisher snapshots with SHA-256) ✓; AC #3 (gitignore carve-outs) ✓; AC #4 (citations matrix) ✓; AC #5 (regression test extended, 12 cases pass) ✓; AC #6 (CLAUDE.md + shippable-roadmap.md updated; **PRD deferred** with caveat) 🟡; AC #7 (Section 10 follow-up update) ✓; AC #8 (re-verification procedure §11) ✓; AC #9 (operator pedagogy review) — out of scope.
- **Quality gates:** type-check, lint, format:check, npm test (329 tests, 19 suites), check:colors, all 4 CI leak guards (Sentry DSN + 3 submit-credential patterns) — all pass on the post-merge tree.
- **No new application code added.** Source surface: 1 test extension + 9 documentation files (4 snapshots + expanded source-doc + new citations matrix + 3 cross-reference doc updates).
- **No new dependencies installed.** Only `node:fs` + `node:path` builtins added to `tcf-spec.test.ts`.
- **Known follow-ups (filed for future work):**
  - PRD lines 113 + 235 update — blocked on PR #55's content reaching main.
  - Story 9-8's `speakingTaskEvaluationSchema` should be re-checked against publisher rubric per `tcf-spec-source.md` §6.3 — flagged for Epic 10.6.
  - Manuel du candidat TCF PDF (2.97 Mo) and per-section sample PDFs should be manually downloaded — operator action documented in `samples-2026-05-10.md`.
  - The `_bmad*` `.gitignore` narrowing from PR #48 worked correctly (this very story file is trackable via plain `git add`); PR #55's content needs to actually merge for full backfill closure.

### File List

**Modified (4):**

- [.gitignore](.gitignore) — added `!docs/tcf-canada-snapshots/` and `!docs/tcf-spec-citations.md` carve-outs
- [CLAUDE.md](CLAUDE.md) — replaced TCF spec paragraph at line 37 with expanded version
- [\_bmad-output/implementation-artifacts/sprint-status.yaml](_bmad-output/implementation-artifacts/sprint-status.yaml) — `epic-10: backlog → in-progress`, `10-1: backlog → in-progress → review` (set to `review` at story close); `last_updated` bumped
- [\_bmad-output/planning-artifacts/shippable-roadmap.md](_bmad-output/planning-artifacts/shippable-roadmap.md) — appended footnote `[^p0-1-correction]` to P0-1 row
- [docs/tcf-spec-source.md](docs/tcf-spec-source.md) — expanded from 75 lines (story 9-1) to 11 sections (~250+ lines) covering scoring, per-CEFR specs, rubrics, vocabulary, linguistic accuracy, and re-verification procedure
- [src/lib/\_\_tests\_\_/tcf-spec.test.ts](src/lib/__tests__/tcf-spec.test.ts) — added 5 new `it()` cases for citations-matrix completeness; total 12 cases pass

**Created (5):**

- [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md) — full citations matrix with 11 sections (constants, scoring, listening, reading, writing, speaking, PRD, linguistic, vocabulary, shippable-roadmap, CLAUDE.md), each row tagged ✓ Verified / ✗ DELTA (with owner Epic) / 🟡 GAP
- [docs/tcf-canada-snapshots/landing-2026-05-10.md](docs/tcf-canada-snapshots/landing-2026-05-10.md) — France Éducation International TCF Canada landing page (FR + EN merged), with verbatim Writing word counts, Speaking durations, evaluation criteria, total exam duration, retake policy
- [docs/tcf-canada-snapshots/samples-2026-05-10.md](docs/tcf-canada-snapshots/samples-2026-05-10.md) — FEI sample test page; passage types observed; operator-action notes for downloadable PDFs
- [docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md](docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md) — IRCC TCF Canada → CLB / NCLC equivalency table transcribed from third-party (with explicit operator-verification caveat); critical observations for the codebase
- [docs/tcf-canada-snapshots/cefr-self-assessment-grid-2026-05-10.md](docs/tcf-canada-snapshots/cefr-self-assessment-grid-2026-05-10.md) — Council of Europe + Europass official self-assessment grid; all 30 cells (6 levels × 5 skills) extracted verbatim from PDF
- [\_bmad-output/implementation-artifacts/10-1-authoritative-tcf-spec-sourcing.md](_bmad-output/implementation-artifacts/10-1-authoritative-tcf-spec-sourcing.md) — this story file (newly trackable thanks to story 9-9 AC #9 narrowing)

**Operator-deferred (not in this PR):**

- `_bmad-output/planning-artifacts/prd.md` lines 113 + 235 — blocked on PR #55's content reaching main. Citations matrix §7 still flags the deltas with closure-by-10-1 status; the actual file edit happens whenever PRD reaches main.

## Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-09 | Story 10-1 created (create-story). Status: `backlog → ready-for-dev`. Epic 10 transitioned `backlog → in-progress` (first story trigger).                                                                                                                                                                                                                                                                                                            |
| 2026-05-10 | Implementation: 4 publisher snapshots with SHA-256 headers, `.gitignore` + `.prettierignore` carve-outs already in place from story 9-9 (no changes needed there beyond `docs/tcf-canada-snapshots/` / `docs/tcf-spec-citations.md` carve-outs), expanded `docs/tcf-spec-source.md` from 75 lines to 11 sections, new `docs/tcf-spec-citations.md` matrix, 5 new test cases (12 total in tcf-spec.test.ts), CLAUDE.md + shippable-roadmap.md updates (PRD deferred — see Debug Log). All quality gates pass (329 tests). Status `in-progress → review`. |
| 2026-05-10 | Code review patches applied (3 HIGH + 5 MEDIUM + 4 LOW = 12 patches, 4 findings rejected as false positives): P1 §2.1 scale-range wording (raw vs CLB-relevant range disambiguated); P2 + P3 citations matrix §7 PRD rows + source-doc follow-up #6 → 🟡 DEFERRED (matrix was lying about closure); P4 story-file AC #5 sample text 10→11 sections; P5 CLAUDE.md hedge "4-criterion rubric (FEI examiner convention)"; P6 Polish AC #Z items ticked [x]; P7 CLAUDE.md "4 publisher snapshots" → "4 source snapshots" with IRCC-third-party caveat; P8 surfaced operator-action TODOs as new §10b in source-doc; P9 sample dates updated; P10 reclassified C1_MIN + CEFR_LEVELS rows 🟡 GAP → ✗ DELTA per legend; P11 §6.1 reworded for prep clarity; P12 tightened matrix-row regex in test (markdown-table-row pattern, prevents stray-comment matches). All quality gates re-run clean (329 tests, 4 leak guards pass, all 4 SHA-256s verify against documented awk procedure). |
