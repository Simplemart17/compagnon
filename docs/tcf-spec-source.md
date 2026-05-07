# TCF Specification — Source of Truth

**Variant targeted by this app:** TCF Canada
**Verified:** 2026-05-07
**Verified by:** Story 9-1 — TCF Spec Verification & Correction

## Authoritative source

- **Publisher:** France Éducation International (the official TCF examiner; operates under the French Ministry of Education)
- **Primary URL:** https://www.france-education-international.fr/test/tcf-canada
- **Primary URL (English):** https://www.france-education-international.fr/test/tcf-canada?langue=en
- **Cross-checked against:** independent test centre listings (Alliance Française, Lyon Exam Inflexyon, etc.) — all in agreement.

A frozen PDF of the publisher page is **not** committed under `docs/tcf-spec-source.pdf` because the publisher serves this content as HTML only and the verifier (Claude Code agent) does not have a tool that can capture an authentic page snapshot to PDF. To archive a binding copy, the user can manually print the URL above to PDF and place it at `docs/tcf-spec-source.pdf`. The verbatim numbers in the next section are the contract regardless of whether the PDF artifact is committed.

## Verified TCF Canada structure (the contract)

All four sections are **mandatory** for TCF Canada (unlike TCF Tout Public, where only Listening + Reading + Grammar are mandatory and Writing + Speaking are optional).

| Section                         | Code        | Format                                          | Questions | Time                                 |
| ------------------------------- | ----------- | ----------------------------------------------- | --------- | ------------------------------------ |
| Compréhension orale (Listening) | `listening` | QCM                                             | **39**    | **35 min**                           |
| Compréhension écrite (Reading)  | `reading`   | QCM                                             | **39**    | **60 min**                           |
| Expression écrite (Writing)     | `writing`   | 3 production tasks                              | n/a       | **60 min**                           |
| Expression orale (Speaking)     | `speaking`  | 3 production tasks (face-to-face with examiner) | n/a       | **12 min** (incl. 2 min preparation) |

**Total exam duration:** ≈ 2 h 47 min (all four mandatory sections)
**Note:** TCF Canada has **no Grammar / Maîtrise des Structures de la Langue section.** That section exists only in TCF Tout Public, TCF ANF, TCF IRN, etc.

## Why this variant

The PRD targets "Canadian or French immigration" learners as a primary persona (`_bmad-output/planning-artifacts/prd.md` line 412, plus Sofia/Marc personas living in Canada). TCF Canada is the variant required by Immigration, Refugees and Citizenship Canada (IRCC) for Express Entry / citizenship; it is the right exam for the user base the product was scoped around.

## Why an audit-driven spec correction (P0-1) led here

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1, P0-1) flagged the in-code spec values as wrong and proposed `Listening 39q/35min, Reading 45q/60min, Grammar 18q/18min`. Verification on 2026-05-07 against the publisher's site found:

- Audit's "Listening 39q/35min" → matches **TCF Canada** (does not match Tout Public).
- Audit's "Reading 45q/60min" → does not match any TCF variant. TCF Canada is 39q/60min; the "45q" appears to be invented.
- Audit's "Grammar 18q/18min" → does not match any TCF variant. The 18q matches TCF Tout Public's Grammar (15 min, not 18 min). TCF Canada has no Grammar section.

In short, the audit conflated TCF Canada (Listening + Reading numbers) with TCF Tout Public (Grammar section's existence) and added a fabricated minute count for Grammar. The pre-audit code values (29/25, 29/45, 18/15, plus 60 min Writing and 12 min Speaking) were a faithful match to TCF Tout Public.

**Decision (story 9-1, 2026-05-07):** pivot the in-app exam target from TCF Tout Public to TCF Canada. The pivot's first cut — done in story 9-1 — is the constants and the QCM-portion mock-test screens. The full migration (drop Grammar from the `TCFSkill` union, recalibrate scoring weights, add Writing + Speaking to the mock-test runner, update placement-test target, update PRD and onboarding copy) is intentionally out of this story and is captured as follow-ups below.

## Citation locations in source code

| File                                               | What it contains                      | Verification status                           |
| -------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `src/lib/constants.ts` `TCF` const                 | Canonical question counts and minutes | Updated by story 9-1                          |
| `src/lib/prompts/mock-test.ts` `SECTION_CONFIGS`   | Prompt defaults injected into GPT-4o  | Updated by story 9-1                          |
| `app/(tabs)/mock-test/[testId].tsx` `SECTION_META` | Active-test runner section metadata   | De-duplicated to read from `TCF.*`; story 9-1 |
| `app/(tabs)/mock-test/index.tsx`                   | Mock-test landing UI                  | Updated by story 9-1                          |
| `src/lib/__tests__/tcf-spec.test.ts`               | Regression test pinning the values    | Created by story 9-1                          |

## Follow-up tickets (out of story 9-1 scope)

The pivot to Canada has implications well beyond this story. These should be filed as separate stories:

1. **Drop `grammar` from `TCFSkill` union** — currently in `src/types/cefr.ts` and used by composite scoring (`src/lib/scoring.ts` `SKILL_WEIGHTS`), profile screen, activity tracker, error tracker, conversation feedback, etc. Decision required: keep Grammar as a non-TCF practice skill (probably yes per user direction 2026-05-07) versus drop it entirely.
2. **Recalibrate composite scoring** — Canada has no Grammar; the current 5-equal-weight composite includes it. With Canada, the composite should be 4 skills (listening, reading, writing, speaking) per the publisher's reporting structure.
3. **Add Writing pipeline to mock test** — covered by Epic 10.6 ("Speaking rubric & scoring pipeline") and Epic 10.3 ("per-level passage / sentence calibration"). Writing is currently a separate `practice/writing.tsx` with its own evaluation; needs to be wired into the mock-test runner with TCF Canada Task 1/2/3 prompts.
4. **Add Speaking pipeline to mock test** — covered by story 9-8 ("Speaking section pipeline"). Realtime voice + per-task rubric; results persist to `mock_test_answers`.
5. **Fix `shippable-roadmap.md` P0-1 line** — the audit's number is wrong; replace with the verified TCF Canada numbers and a note that the original code was correct for Tout Public.
6. **Update PRD** — `_bmad-output/planning-artifacts/prd.md` line 215 (`question counts (29/29/18) and scoring bands match official exam specifications`) and line 97 (`TCF mock tests (76 questions, 3 sections, progressive A1-C2 difficulty)`) describe TCF Tout Public; both need to be rewritten for TCF Canada (78 mandatory items: 39 listening + 39 reading + 3 writing tasks + 3 speaking tasks).
7. **Onboarding / placement test** — placement currently produces a CEFR estimate; needs review whether it should also indicate TCF Canada readiness specifically.
8. **`mock_tests.test_type` schema versioning** — pre-pivot rows with `test_type = "full"` represent a 3-section run (85 min, includes grammar); post-pivot rows represent a 2-section run (95 min). The runtime filters out unknown section keys when resuming, but historical analytics rows mean different things across the pivot. File a migration that backfills a `variant` text column (`tout_public` | `canada`) on `mock_tests` so downstream aggregation can disambiguate. See schema note in `app/(tabs)/mock-test/[testId].tsx`.

## Re-verification checklist

This document should be re-verified once a year (TCF specs occasionally change between editions) or any time France Éducation International publishes a new edition note. Re-verification consists of:

1. Re-fetch the URL above and compare verbatim numbers.
2. If numbers change, update the table in this file, update `src/lib/constants.ts`, and run `src/lib/__tests__/tcf-spec.test.ts`.
3. Update the "Verified" date at the top of this file.
