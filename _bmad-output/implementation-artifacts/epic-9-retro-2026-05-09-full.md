# Epic 9 Retrospective (Full) — Release Blockers (P0)

**Date:** 2026-05-09
**Facilitator:** Bob (Scrum Master)
**Project Lead:** Simplemart
**Scope:** Epic 9 — 10 stories closing the P0 findings from the 2026-05-06 independent audit
**Supersedes:** [`epic-9-retro-2026-05-09.md`](./epic-9-retro-2026-05-09.md) — partial retro held while story 9-9 was in `review` (PRs #48 + #55 open). This full retro is run after all 10 stories reached `done` and all four PRs (#44, #47, #48, #55) merged. The partial doc is preserved as the historical record of the in-flight state.

---

## Epic Summary

Epic 9 was the "stop-the-bleed" phase of the path-to-shippable roadmap (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1). The 2026-05-06 independent multi-agent audit found 10 P0 findings — wrong TCF specs, broken CEFR promotion engine, stored prompt-injection vector, Sentry PII leak, duplicate transcripts, auth listener bug, no AI schema validation, missing Speaking pipeline, missing deploy substrate, auth/cache race. Epic 9 closes all 10 with verifiable regression coverage and review-patch hardening.

| #    | Story                                  | Status | Test count after | Review patches | PR  | Merged       |
| ---- | -------------------------------------- | ------ | ---------------- | -------------- | --- | ------------ |
| 9-1  | TCF spec verification & correction     | done   | —                | —              | —   | (in-tree)    |
| 9-2  | CEFR promotion engine fix              | done   | —                | —              | —   | (in-tree)    |
| 9-3  | Sentry leak remediation                | done   | —                | —              | —   | (in-tree)    |
| 9-4  | Stored prompt injection defense        | done   | —                | —              | —   | (in-tree)    |
| 9-5  | Voice transcript dedup                 | done   | —                | —              | —   | (in-tree)    |
| 9-6  | Auth listener token refresh fix        | done   | —                | —              | —   | (in-tree)    |
| 9-7  | Zod validation infrastructure          | done   | 281              | 13             | —   | (in-tree)    |
| 9-8  | Speaking section pipeline              | done   | 324              | 27             | #47 | 2026-05-10   |
| 9-9  | Submit credentials & deploy substrate  | done   | 324              | 12             | #48 | 2026-05-10   |
| 9-10 | Auth cache race hardening              | done   | —                | 10 (D1-D4 + P1-P10) | #44 | 2026-05-08   |
| —    | Backfill (story files + retros + planning) | done | 324           | 0              | #55 | 2026-05-10   |

### Aggregate Metrics

| Metric                                              | Value                                |
| --------------------------------------------------- | ------------------------------------ |
| Stories completed                                   | 10/10 done (100%)                    |
| Test suite growth                                   | 0 → 324 cases (19 suites)            |
| Review patches across the epic                      | 62+ across 4 stories with detailed accounting; 9-1 through 9-6 + 9-10 patch counts not surfaced individually in sprint-status |
| P0 findings closed                                  | 10/10                                |
| Quality gates failed at merge                       | 0                                    |
| Production incidents                                | 0 (no production traffic; all changes pre-launch) |
| New tech-debt issues filed                          | 5 (#49–#53, all `tech-debt` labelled) |
| New CI guards introduced                            | 2 (Sentry DSN leak guard, submit credentials leak guard) |
| New runbooks                                        | 2 (`ota-hotfix.md`, `submit-and-deploy.md`) |
| PRs merged in this epic                             | 4 (#44, #47, #48, #55)               |

---

## Team Participants

- Alice (Product Owner) — release-readiness gate decisions
- Bob (Scrum Master) — facilitator
- Charlie (Senior Dev) — implementation across all 10 stories
- Dana (QA Engineer) — test design, leak guard verification
- Elena (Junior Dev) — story file authorship, review-patch execution
- Felix (Security Analyst) — 9-3, 9-4, 9-9 leak-guard design
- Gabriela (DevOps Engineer) — 9-9 substrate
- Hugo (AI Integration) — 9-7 schema design, 9-8 evaluator prompts

---

## What Went Well

### 1. The story-file-as-context-engine pattern delivered

Story 9-8 (Speaking pipeline) was 660+ lines before implementation began. Story 9-9 (deploy substrate) was 660+ lines. Story 10-1 (currently `ready-for-dev`) is also 660+ lines. Each carries a "Background — Why This Story Exists" with audit citations, an explicit "Out of scope" demarcation that names the receiving epic for every deferred concern, and BDD-formatted acceptance criteria.

**Bob (Scrum Master):** _"The dev agent never asked 'should I do X?' on these stories. The story already answered."_

**Elena (Junior Dev):** _"Writing the story is harder than implementing it. But the implementation goes faster and the review finds fewer surprises."_

### 2. Adversarial code review caught real bugs that quality gates missed

Every story went through a 3-layer review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Real critical bugs surfaced:

- **9-8 P1 critical:** `sanitizeMemoryContent` was silently truncating transcripts to 300 chars — would have shipped a Speaking pipeline that scored 5.5-minute Task 2 responses against a 75-character snippet
- **9-7 P-multiple:** placement-test polymorphic options regression — Zod schema would have rejected real model outputs the prior validator had been quietly fixing
- **9-9 P1:** `deploy.yml` `if:` condition silently skipped edge-function deploys on squash-merge or force-push (commits-array empty/truncated)
- **9-9 P3:** `submit.yml` script-injection vector with `EXPO_TOKEN` in the runner env

**Charlie (Senior Dev):** _"We caught these in review. CI didn't catch them. Tests didn't catch them. The 3-agent adversarial pass is now non-negotiable."_

### 3. CI leak guards are the right primitive for "do not regress this class"

Story 9-3 added the Sentry DSN leak guard. Story 9-9 added the submit-credentials leak guard. Pattern: every newly-classified credential category gets a CI grep with self-match defense (story 9-9 introduced the `[_]` character-class trick when its own regex literally matched its source).

**Felix (Security Analyst):** _"The leak guard is what locks in the lesson. Without it, the next contributor reintroduces the placeholder in 6 months and we're back to 2026-05-06."_

### 4. The "memory log overstates completeness" anti-pattern was actively defended against

Per `feedback_memory_log_completeness.md` (added after the 2026-05-06 audit), every Epic 9 story closed with a verification artifact: a test name, a grep result, a re-audit citation, or a screenshot. No story was marked done by author claim alone.

**Alice (Product Owner):** _"Epic 1-8 had us shipping prematurely. Epic 9 has us shipping when the verification fires green. Different culture."_

### 5. Cross-story dependency discipline held

The internal dependency graph of Epic 9:

- **9-1** (TCF spec) → 9-8 (Speaking constants reference `TCF.SPEAKING_MINUTES`)
- **9-2** (CEFR engine) → 9-8 (Speaking writes the 5th `skill_progress` row that 9-2's gate now requires)
- **9-3** (Sentry) → 9-9 (source-map upload step explicitly closed 9-3's "blocked on Epic 9.3" TODO)
- **9-4** (prompt injection) → 9-8 (`<USER_TRANSCRIPT>` wrapper mirrors 9-4's `<USER_FACTS>` defense)
- **9-7** (Zod) → 9-8 (`speakingTaskEvaluationSchema` slots into the 9-7 schema family)

No story shipped that broke an upstream dependency. The story-file `References` section made the dependency graph visible at review time.

### 6. The first-time runbook discipline scaled

Epic 9 introduced two operator runbooks: `ota-hotfix.md` (when to OTA vs fresh build) and `submit-and-deploy.md` (10-section end-to-end provisioning flow). Both follow the same shape: prerequisites → one-time provisioning → verification → rollback → cost watch → quick reference. Future runbooks (e.g., Epic 16.6's migration rollback) have a template to follow.

### 7. Merge-order discipline between dependent PRs worked first try

PR #48 (9-9 substrate) was merged 02:03 UTC on 2026-05-10. PR #55 (file backfill, based on PR #48) was merged 02:29 UTC the same night. The base auto-redirected to `main` after #48's squash-merge with no manual rebase. The risk flagged in the partial retro (§"What Didn't Go Well" #4) did not materialize because the merge order was followed.

**Charlie (Senior Dev):** _"That was the cheap version of a problem that could have wasted a sprint. Documenting merge order in PR #55's body paid off."_

---

## What Didn't Go Well

### 1. The story file gitignore footgun was discovered late

Story 9-9's AC #9 found that the `_bmad*` blanket gitignore rule had been silently dropping any file written under `_bmad-output/` — including the new 9-9 story file itself. The dev agent committed it via `git add -f` without realizing why. The narrowing in 9-9 surfaced ~25 untracked operator-local files that had been on disk for weeks; PR #55 backfilled all of them in a single commit run (`docs(stories)`, `docs(retros)`, `docs(planning)`).

**Why it matters:** every prior story (1-1 through 9-8) was either tracked because someone manually `-f`'d it, or NOT tracked at all (most of Epic 1's story files were operator-local until PR #55).

**Lesson:** "if a workflow writes a file you expect to commit, and the next `git status` doesn't show it, the gitignore is silently eating it." Adding the `[ ] git status shows the new file as untracked` step to the story-file template would have caught this 6 weeks earlier.

### 2. CI gates passed on `main` while drift accumulated

When story 9-9's gitignore narrowing exposed `_bmad-output/*.md` files to Prettier (because Prettier respects `.gitignore` by default and the prior `_bmad*` rule had been hiding them), `npm run format:check` started failing on ~30 previously-tracked story files. The fix was to add `_bmad-output/` to `.prettierignore`. But the underlying pattern — _"a tool's behavior depends on a config we have, and changing the config exposes drift"_ — is a class of bug we'll see again.

**Action item:** when changing `.gitignore` or `.prettierignore`, run all quality gates immediately and inspect any files that flip into/out of scope.

### 3. The same review-patch round happened 4 times in Epic 9 (62+ patches total)

Story 9-7: 13 patches. Story 9-8: 27. Story 9-9: 12. Story 9-10: 10. The pattern is: implement → review surfaces 10–30 issues → patch round → re-review → ship.

This is _good_ in that the bugs got caught. But it's expensive — each patch round takes longer than the original implementation in some cases. The bugs cluster in predictable categories: GHA workflow gotchas (squash-merge events, shell injection, concurrency), Zod schema edge cases (nullable vs optional vs required), and edge-case state machines in async flows (per-task retry, partial deploy, transcript dedup).

**Lesson for Epic 10:** budget for the review patch round explicitly. A "complete" implementation that has not been reviewed is ~70% done.

### 4. The 9-9 review found a high-severity issue (script injection) that should have been caught in design

Story 9-9 AC #3's example workflow had `${{ github.event.inputs.build_id }}` interpolated directly into a `run:` block — the canonical GHA injection sink. The implementation copied the example verbatim. The Blind Hunter caught it in review.

**Why design missed it:** the story author wrote the workflow example with the wrong shape and didn't run an adversarial pass over their own AC content. The "Why X (not Y)" rationale entries throughout the AC are excellent for catching design drift, but they don't surface security gaps.

**Action item:** when a story introduces a new GHA workflow, the AC must include a "GHA injection vector check" subsection. Same way every AI call now has a Zod schema requirement.

### 5. Backfill PR #55 surfaced ~weeks of unindexed planning + retro drift

The `docs(retros): backfill epic 1, 1B, 2, 3-8 retros` and `docs(planning): backfill architecture, epics, prd, epic-2/3 architecture` commits in PR #55 retroactively wrote entire planning artifacts and retros that should have been tracked from the start. The ignore-rule footgun (Item #1) is upstream; the consequence is that the project's audit trail for Epics 1–8 was reconstructed in one push rather than committed as work happened.

**What this didn't break:** the work itself was real and the retros are accurate (per `MEMORY.md`'s "memory log overstates completeness" defense). What it did break: the ability to look at git history and infer "what did the team know at the time of Epic 5?" — the retros, prds, and architecture for Epics 1–8 are all dated 2026-05-09 in git, even though the work happened weeks earlier.

**Lesson:** the gitignore narrowing must happen at the start of every project, not at story 9-9. For new projects, the BMad install should produce a `.gitignore` that already lists the carve-outs.

---

## Previous Epic Retro Follow-Through (Epics 3-8 Retro, 2026-04-01)

The Epics 3-8 mega-retro committed to:

| Action item from 3-8 retro | Status in Epic 9 |
| --- | --- |
| Adopt the BDD `Given/When/Then` pattern for ACs (story 1b-3) | ✅ Used in every Epic 9 story |
| Add Prettier format check to CI | ✅ Already in `ci.yml`; story 9-9 hardened it |
| Add SQL migration validation to CI | ✅ Still in `ci.yml`; story 9-9 added `notify-migration-pending` job to surface manual-apply requirement |
| Replace ScrollView with FlatList in long-list components | ✅ Done in stories 1-3 / 1-4; not re-touched in Epic 9 |
| Authoritative TCF spec sourcing | ✅ Story 9-1 (deferred deeper sourcing to Epic 10.1) |
| Real submit credentials | 🟡 Story 9-9 wired the substrate; operator action still pending (runbook §1-3) |
| Sentry source-map upload | ✅ Story 9-9 closed this (was the 9-3 follow-up) |
| Edge Function deploy automation | ✅ Story 9-9 added `deploy.yml` |

**Net: 7/8 commitments delivered in Epic 9.** The 8th (real submit credentials) is operator-driven and unblocked by 9-9.

---

## Significant Discoveries (Affect Epic 10 / 16)

### D1: TCF Canada vs Tout Public spec divergence

Story 9-1 verified the spec source (`docs/tcf-spec-source.md`) is **TCF Canada**, not the generic TCF Tout Public. Epic 10.1 ("authoritative TCF spec sourcing") inherits this — must source the Canada-specific reference materials, not the generic PDFs from france-education-international.fr. Story 10-1 (now `ready-for-dev`, 660+ lines) explicitly calls this out and proposes a Citations Matrix to pin every TCF-derived value in code to a `docs/tcf-spec-source.md` anchor.

### D2: 5-skill CEFR promotion gate is now load-bearing

Story 9-2 fixed the promotion engine. Story 9-8 closed the Speaking gap that was the only path-blocker. Epic 10 must keep this contract intact — 10.4 (vocabulary frequency caps) and 10.6 (deeper Speaking rubric) cannot regress the per-skill evidence requirement.

### D3: Zod schema infrastructure is now the validation primitive

Story 9-7 added Zod to every `chatCompletionJSON` call site. Epic 10's per-skill prompt builders (10-3 listening/reading calibration, 10-4 vocabulary caps, 10-5 placement extraction) should consume existing schemas where possible and add new ones to `src/lib/schemas/ai-responses.ts` only when justified. The pattern of "one schema per call site, inferred types in `src/types/`" is the convention.

### D4: Per-CEFR topic libraries with deterministic bucketing is a reusable pattern

Story 9-8 introduced a 3-day deterministic bucket so retakes within the window see the same prompt (anti-game heuristic). Epic 10.8 (anti-cheat, frequency anti-repetition) should consider whether to extend this pattern or generalize it into a `src/lib/anti-repetition.ts` helper.

### D5: Deploy substrate is wired and merged but not yet exercised against real services

Story 9-9 (PR #48) is now merged. The workflows live on `main`. But no operator has run them end-to-end against real EAS / TestFlight / Play / Sentry / Supabase yet. Epic 16's beta launch depends on the operator completing runbook §1-5 first. This is **not blocking Epic 10** but **is blocking Epic 16**.

### D6: Documentation must be tracked from day-one (PR #55 lesson)

The backfill PR retroactively committed planning artifacts (PRD, architecture, epics), per-epic retros (1, 1B, 2, 3–8), and ~22 story files that had been operator-local for weeks. Net consequence: the git timeline now shows ~weeks of work landing in a single 2026-05-09/10 push. Future projects should land the gitignore carve-outs in the first commit.

### Epic update needed?

**No.** Epic 10's plan (10-1 through 10-8) is unchanged by Epic 9 outcomes. Story 10-1 already exists and reflects D1 / D3 / D6. Epic 16's plan is unchanged but has a new precondition (runbook §1-5 operator execution) that the dev agent cannot run.

---

## Action Items Status

### From the partial retro (2026-05-09)

| # | Action | Owner | Status as of full retro |
| --- | --- | --- | --- |
| A1 | Update story-file template (story 1b-3) to require: "[ ] git status shows new files as untracked-but-not-ignored" check | Bob (SM) | ✅ **Done 2026-05-09 (operator-local)** — added "Story File Self-Check" section to `.claude/skills/bmad-create-story/template.md` and `_bmad/bmm/workflows/4-implementation/bmad-create-story/template.md`. **Both paths are gitignored** (`.gitignore:60, 69`); persistence model = operator-local only. The lesson body is preserved in this retro file (which is tracked) so future operators can re-apply on a fresh install. |
| A2 | Update story-file template to require: "GHA injection vector check" subsection for any story introducing a new workflow | Felix (Security) | ✅ **Done 2026-05-09 (operator-local)** — added conditional "Y. GitHub Actions Injection Vector Check" section to both copies of the template; pattern matches the Zod-schema requirement for AI calls. Same gitignore caveat as A1. |
| A3 | Document the "62+ review patches across Epic 9" lesson in the create-story workflow notes | Bob (SM) | ✅ **Done 2026-05-09 (operator-local)** — added "Lessons Learned" section to both copies of `bmad-create-story/workflow.md` covering review-patch budget + visibility check. Same gitignore caveat as A1. |
| A4 | Merge PR #48 then PR #55 in that order; verify PR #55 base auto-redirects to main | Simplemart (operator) | ✅ **Done 2026-05-10** — both PRs merged in correct order, no manual rebase needed |
| A5 | Operator runs runbook §1-3 (one-time provisioning) for real EAS / Apple / Google / Sentry / Supabase | Simplemart (operator) | ⏳ Open — must complete before Epic 16 |
| A6 | Operator triggers first production EAS Build via the workflow; verifies Sentry source-maps land | Simplemart (operator) | ⏳ Open — must complete before Epic 16 |
| A7 | Operator triggers `submit.yml` for both platforms; confirms TestFlight + Play Internal-Track delivery | Simplemart (operator) | ⏳ Open — must complete before Epic 16.10 (beta) |
| A8 | Triage the 5 deferred tech-debt issues (#49–#53) before Epic 11 starts; close or reschedule each | Simplemart + Bob | ⏳ Open — applies before Epic 11 |
| A9 | Carry the 3-layer adversarial review pattern (Blind Hunter / Edge Case Hunter / Acceptance Auditor) into Epic 10 stories | Charlie (Senior Dev) | ⏳ Standing — every Epic 10 story PR |
| A10 | Audit the 9-1 follow-up at `docs/tcf-spec-source.md:63` — confirm story 9-8 closed it (Speaking pipeline added) | Hugo (AI Integration) | ✅ **Done 2026-05-09** — verified `docs/tcf-spec-source.md` follow-up #4 already strikes through "Add Speaking pipeline to mock test" with `**DONE — landed by story 9-8 on 2026-05-09**`. No further action needed |

### Newly added in this full retro

| # | Action | Owner | Deadline | Success criterion |
| --- | --- | --- | --- | --- |
| A11 | Add the gitignore-narrowing-from-day-one lesson to BMad install playbook / new-project checklist | Bob (SM) | When next project is started | A new project's first commit has the carve-outs (`!_bmad-output/{implementation,planning}-artifacts/`) so retros and stories track from day one |
| A12 | When changing `.gitignore` or `.prettierignore`, immediately run `npm run format:check`, `npm run type-check`, `npm run lint` and inspect the diff of files that flip in/out of scope | Charlie (Senior Dev) | Standing | Future ignore-rule edits do not silently re-format / un-ignore tracked files |

---

## Critical Path to Epic 10 Kickoff

1. ✅ PR #48 merged 2026-05-10
2. ✅ PR #55 merged 2026-05-10 after #48 (base auto-redirected, no rebase)
3. ✅ A1 + A2 + A3 — story-file template + workflow updates landed 2026-05-09 (operator-local; gitignored. Lesson bodies preserved in this retro for future operators to re-apply on a fresh BMad install)
4. ✅ A10 — 9-1 follow-up #4 verified closed in `docs/tcf-spec-source.md`

**Epic 10 is unblocked.** Ready to invoke `bmad-dev-story 10-1`. A5–A7 (operator EAS/store provisioning) is concurrent — Epic 10 doesn't depend on it; Epic 16 does.

---

## Readiness Assessment

| Dimension | Status |
| --- | --- |
| Testing & Quality | ✅ 324 tests passing; 0 quality-gate failures across 10 stories |
| Deployment substrate | ✅ Merged on `main` (PR #48); 🟡 first production submit pending operator action (A5–A7) |
| Stakeholder acceptance | N/A (pre-launch; no external stakeholders yet) |
| Technical health | ✅ No HIGH-severity findings remain unaddressed; 5 LOW-severity tech-debt items filed as issues (#49–#53) |
| Unresolved blockers | None for Epic 10. For Epic 16: operator EAS/store credential provisioning (A5–A7) |
| Documentation | ✅ All Epic 1–9 retros, PRD, architecture, epic specs, story files, and runbooks tracked in git as of PR #55 |

---

## What Changed Since the Partial Retro

| Item | Partial retro state (2026-05-09) | Full retro state (2026-05-09 post-merge) |
| --- | --- | --- |
| Story 9-9 status | `review` (PR #48 open) | `done` (PR #48 merged 2026-05-10) |
| PR #48 (substrate) | open | merged |
| PR #55 (backfill) | open, based on #48 | merged after #48, base auto-redirected to main |
| Sprint-status `epic-9-retrospective` | `optional` | `done` (set on 2026-05-09 after partial retro) |
| Action item A4 | open | ✅ done |
| Story 10-1 file | not yet drafted | drafted, `ready-for-dev`, untracked in current branch |
| New action items | — | A11 (gitignore install playbook), A12 (ignore-rule change quality gate) |
| Lessons added | — | "What Didn't Go Well #5" (backfill PR drift), "Went Well #7" (merge-order discipline worked) |

---

## Closing Note

Epic 9 is the moment Companion stopped being a "polished prototype with overstated completeness claims" and started being an app that knows what it doesn't yet know. The audit-driven discipline, the review-patch culture, and the runbook-first ops posture are the practices we carry into Epic 10.

The 62+ review patches were not waste — they were the cost of catching the bugs at review time instead of at production time. The next epic must budget for them honestly.

The gitignore footgun cost us a week of audit-trail clarity but did not cost any work. The lesson — narrow ignore rules from day one — is the cheapest one we'll learn this year.

**Bob (Scrum Master):** _"Epic 9 done — fully done now, not 'mostly done' done. Epic 10 begins on a foundation we can actually ship from."_

---

**Retrospective complete. Next: execute A1 + A2 + A3 + A10, then `bmad-dev-story 10-1`.**
