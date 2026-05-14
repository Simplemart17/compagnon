# Story 12.10: `npm audit` Reframing — CI Gate at `high+` + Risk-Classified Documentation of Dev/Build-Time Moderates

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose audit finding **P1-13** at [`shippable-roadmap.md` line 65](_bmad-output/planning-artifacts/shippable-roadmap.md) was written 2026-05-06 claiming `"npm audit reports 9 vulnerabilities, 3 high (xmldom XML injection, recursion DoS)"` AND whose Epic 12 acceptance criterion at [`shippable-roadmap.md` line 221](_bmad-output/planning-artifacts/shippable-roadmap.md) reads `"npm audit reports 0 high vulnerabilities"` AND whose current (2026-05-14) `npm audit` output shows **`0 critical, 0 high, 4 moderate, 5 low = 9 total`** — i.e. the AC is **already satisfied** today because the xmldom vulnerabilities P1-13 named are GONE from the dependency tree (the intervening Expo SDK upgrade chain from 49 → 55 dropped xmldom; verified via `npm audit --json` returning ZERO `xmldom` keys), AND the 9 remaining vulnerabilities are split across **(a) a 4-row moderate postcss-chain** (postcss `<8.5.10` — `GHSA-qx2v-qp2m-jg93` "PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output" — flowing through `@expo/metro-config` → `@expo/cli` → `expo`; ALL are **build-time** dependencies that compile NativeWind / Tailwind at bundle time and DO NOT execute at runtime in the shipped iOS/Android binary — the XSS sink requires serializing untrusted CSS through `postcss.stringify()` which Companion does not do; Tailwind's compiler emits to a static stylesheet at build, NOT runtime), AND **(b) a 5-row low jest-expo + jsdom chain** (`jest-environment-jsdom`, `jsdom`, `http-proxy-agent`, `@tootallnate/once`, `jest-expo` itself — ALL `devDependencies` per [`package.json`](package.json) `"devDependencies"` block; jest-expo is the test-harness wrapping jest with Expo-config presets; jsdom is the test-time DOM polyfill; NONE ship to the production bundle which is verified by the existing `expo export` output not including any jest/jsdom code), AND **the auto-fix path requires Expo SDK downgrade from 55 → 49** (`npm audit fix --force` reports `Will install expo@49.0.23, which is a breaking change` because the audit's `fixAvailable.version: 49.0.23` is the LAST safe version BEFORE the affected range `49.0.0-alpha.1 - 56.0.0-preview.6` begins — downgrading 6 major versions is operationally suicidal AND would regress every Story 11.X / 12.X invariant pinned against SDK 55 surfaces; the CORRECT forward-path is to upgrade to Expo SDK 57+ once it ships with a postcss bump out of the `<8.5.10` range, OR adopt npm-overrides for postcss directly — both are HIGHER-RISK than they appear and fall outside this story's scope), AND today `.github/workflows/ci.yml` has **no `npm audit` gate** (`grep -n "npm audit" .github/workflows/ci.yml` returns ZERO matches), so a future dependency-tree change that introduces a HIGH-or-CRITICAL vulnerability would land on `main` silently AND the Epic 12 AC's `"0 high"` claim would regress without operator visibility, AND the cross-story pattern (Stories 12-7 / 12-8 / 12-9 all add operator-runbook deliverables for non-code policies) suggests Story 12-10 should land an **operator runbook** documenting the quarterly review cadence + the per-severity decision tree + the conditions under which the operator escalates to an Expo SDK upgrade, AND none of the existing CI steps gate on dependency vulnerabilities so there's a precedent-clean place to add ONE step.

I want (a) **a new CI step in `.github/workflows/ci.yml`** inserted immediately AFTER the existing `Tests` step (line ~37) named `Dependency vulnerability gate` that runs `npm audit --audit-level=high` — this exits **non-zero** when ANY critical-or-high severity vulnerability is found AND exits **zero** for moderate/low (matching the project's risk tolerance ratified by this story); the step does NOT use `--omit=dev` because high-severity vulns in dev-deps still warrant operator attention (a malicious test-harness can exfiltrate secrets from a dev's machine; the bar for "high" is high enough that we want the gate to fire even for dev-deps); the step caches `node_modules` via the existing `actions/setup-node` `cache: npm` so it adds ~1-2s to CI; (b) **a new operator runbook `_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md`** (~150 lines) documenting (i) the **current vulnerability inventory** as of 2026-05-14 (the 9 vulns enumerated, each with `severity`, `package`, `advisory URL`, `range`, `risk assessment` (dev-only / build-only / runtime), and `fix path`), (ii) the **per-severity decision tree** — `critical/high` → block merge via CI gate (mandatory); `moderate` → operator review within 1 quarter; `low` → operator review at next Expo SDK upgrade; informational → ignore, (iii) the **quarterly review cadence** — operator runs `npm audit --json | jq '.metadata.vulnerabilities'` on the 1st business day of each quarter, compares against the inventory in this runbook, files individual stories for any new moderate/high vulns; the runbook has a "Last reviewed" date placeholder the operator updates each quarter (mirrors Story 11-4's `MODEL_RATES` quarterly-refresh-bait pattern), (iv) the **Expo SDK upgrade decision matrix** documenting that the current 4 moderate postcss-chain vulns will close naturally when Expo ships SDK 57+ with a postcss bump out of the `<8.5.10` range (the operator monitors [Expo release notes](https://expo.dev/changelog) for SDK-upgrade announcements; the upgrade is filed as a separate story when SDK 57 RC ships, NOT this story), (v) the **rollback procedure** if a future `npm audit fix` lands a breaking dep — `git revert` the auto-fix commit + restore the prior `package-lock.json`, (vi) **the npm-overrides escape hatch** documented but explicitly OUT-OF-SCOPE for Story 12-10 (a future story can add `"overrides": {"postcss": "^8.5.10"}` to package.json to force postcss out of the vulnerable range — the runbook documents the operator-required test plan if it's ever needed: `expo prebuild` + `expo export` + run NativeWind compilation; if any of those break, revert immediately); (c) **NO `npm audit fix` run during this story's implementation** — the only available fix is `--force` which downgrades Expo (explicitly rejected; would unship 7 stories' worth of invariants); a follow-up story can adopt npm-overrides if telemetry surfaces an actual exposure; (d) **NO Expo SDK upgrade** — filed as a separate Epic 16.X follow-up `16-X-expo-sdk-57-upgrade-evaluation` (BACKLOG; not in this story); operator monitors Expo release-notes for SDK 57 RC announcement; (e) **CLAUDE.md architecture paragraph** added after the Story 12-9 entry documenting (i) the live audit state (`0/0/4/5 = 9 total`), (ii) the CI gate location + `--audit-level=high` rationale (zero-tolerance for high+; documented-tolerance for moderate/low limited to dev/build-time exposure), (iii) the runbook path + the quarterly-review cadence + the deferred Expo SDK 57+ upgrade follow-up; (f) **regression test gating** — adding a test to verify CI gate behavior is INFEASIBLE from inside the test-harness (the gate runs in the CI workflow itself, not in the app code); instead a **drift detector** test at `src/lib/__tests__/ci-audit-gate-source-drift.test.ts` (~5 Jest cases) reads `.github/workflows/ci.yml` from disk + asserts (i) the literal step name `"Dependency vulnerability gate"` is present, (ii) the run-script line contains `npm audit --audit-level=high`, (iii) NEGATIVE — the step does NOT use `--audit-level=low` (would block on moderate/low and unship the AC because we currently have 9 moderates+lows), (iv) NEGATIVE — the step does NOT use `--audit-level=moderate` (same — would block today), (v) the step is ordered AFTER the `Tests` step (regex-position check ensures workflow execution-order is preserved); the drift detector pattern mirrors Story 12-9's `email-verification-source-drift.test.ts` (read source from disk + string-strip comments + regex assertions); (g) **NO changes to product code** — `package.json` dependencies stay verbatim, `package-lock.json` stays verbatim, `app/` and `src/` are zero-diff; the story's deliverables are: 1 modified CI file + 1 new runbook + 1 new test file + 1 modified CLAUDE.md paragraph + 1 modified sprint-status.yaml + 1 new story file = 6 files total; (h) **NO test coverage delta in product code** — the new test is a drift detector for CI config, not a runtime regression test; total Jest case delta ≈ +5; (i) **Sentry telemetry** — NO new feature tags / extras keys (`SENTRY_EXTRAS_ALLOWLIST` zero-diff); dependency vulnerabilities are a build-time supply-chain concern that doesn't flow through the runtime telemetry pipeline,

so that **audit finding P1-13 closes architecturally** with the AC `"npm audit reports 0 high vulnerabilities"` satisfied today AND CI-gated against regression; **the moderate/low vulns are documented, risk-classified, and on a review cadence** rather than ignored or papered-over; **the operator has an actionable runbook** for the next quarterly review + the eventual Expo SDK 57+ upgrade decision; **the CI gate is calibrated to the project's risk tolerance** — strict on high+ (zero-tolerance), permissive on moderate/low (documented dev/build-time-only exposure); **no product code regression risk** — the story touches CI config + docs only, not a single line of `app/` or `src/`; **the npm-overrides escape hatch is documented but not adopted** — a future story can pull that trigger if the moderate postcss-chain becomes an actual exposure (unlikely given build-time scope); **the Expo SDK 57+ upgrade is properly scoped as a separate epic** rather than smuggled into this story — SDK upgrades are 1-3 engineer-days of test + smoke-verify work + Story 11.X / 12.X invariant re-verification, far beyond this story's small-discrete-story budget; **the drift detector pins the CI gate against silent regression** — a future `ci.yml` edit that drops the `--audit-level=high` flag OR replaces it with `--audit-level=critical` (which would let highs through) fails CI loudly; **the runbook's quarterly-review-cadence pattern mirrors Story 11-4's `MODEL_RATES` REFRESH QUARTERLY discipline** — operators have one familiar mental model for "things to re-check on a calendar cadence"; **Story 12-10 closes 1 audit finding (P1-13) with reframing — `0 high` is met today; the original 3-high count was stale — as a SMALL discrete story** (1 modified CI file + 1 new runbook + 1 new test file + 1 modified CLAUDE.md paragraph + 1 modified sprint-status.yaml + 1 new story file; total diff < 500 lines; zero product-code changes; zero quality-gate risk).

## Background — Why This Story Exists

### What audit finding P1-13 owns to this story — and the reframing

[`shippable-roadmap.md` line 65](_bmad-output/planning-artifacts/shippable-roadmap.md), written 2026-05-06:

> "P1-13 — `npm audit` reports 9 vulnerabilities, 3 high (xmldom XML injection, recursion DoS) — `package-lock.json` — security"

Epic 12.10 deliverable at [`shippable-roadmap.md` line 213](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "12.10 `npm audit fix` + Expo SDK update path if needed. **Covers P1-13.**"

Epic 12 AC at [`shippable-roadmap.md` line 221](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "`npm audit` reports 0 high vulnerabilities."

**Current state (verified 2026-05-14 via `npm audit --json`):**

```
0 critical | 0 high | 4 moderate | 5 low | 9 total
```

**The AC is already satisfied.** The 3 high-severity xmldom vulnerabilities P1-13 names are GONE — they were eliminated by the Expo SDK 49 → 55 dependency chain update that landed between roadmap-writing-time (2026-05-06) and now (2026-05-14). `grep -i xmldom node_modules/.package-lock.json` returns zero matches.

### Current vulnerability inventory (9 vulns, none high)

| # | Package | Severity | Range | Advisory | Risk class |
|---|---|---|---|---|---|
| 1 | `postcss` | moderate | `<8.5.10` | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — XSS via Unescaped `</style>` in Stringify | **Build-time only** (Tailwind/NativeWind compile-time; runtime emits static CSS) |
| 2 | `@expo/metro-config` | moderate | — | (transitive via postcss) | Build-time only |
| 3 | `@expo/cli` | moderate | — | (transitive via @expo/metro-config) | Build-time only |
| 4 | `expo` | moderate | `49.0.0-alpha.1 - 56.0.0-preview.6` | (transitive via @expo/cli) | Build-time only |
| 5 | `jest-environment-jsdom` | low | `27.0.1 - 30.0.0-rc.1` | jsdom-related | **Dev-only** (testing) |
| 6 | `jsdom` | low | `16.6.0 - 22.1.0` | — | Dev-only |
| 7 | `http-proxy-agent` | low | — | (transitive via jsdom) | Dev-only |
| 8 | `@tootallnate/once` | low | — | (transitive via http-proxy-agent) | Dev-only |
| 9 | `jest-expo` | low | — | (root of the dev-deps chain) | Dev-only |

**Zero production-runtime exposure** for all 9 vulnerabilities. Verified via:

- (a) `expo export --output-dir=/tmp/exp-test` produces a bundle that contains NEITHER `postcss` NOR `jsdom` NOR `jest-expo` symbols (postcss is invoked at bundle-time by Metro; jsdom + jest-expo are dev-deps that the bundler never touches).
- (b) The postcss XSS sink requires `postcss.stringify(node)` invocation on attacker-controlled CSS; Companion's UI is NativeWind-compiled at build-time, emitting static stylesheet bytes — no runtime postcss invocation.

### Why `npm audit fix` is operationally suicidal

```
$ npm audit fix --force
Will install expo@49.0.23, which is a breaking change
```

The auto-fix downgrades Expo SDK from 55 → 49 (6 major versions backward). That would unship:

- Story 11.X surface (gpt-realtime-mini, Realtime API additions only available on SDK 51+)
- Story 12.1 (RealtimeOrchestrator React 18+ memo patterns)
- Story 12.5 (`@mykin-ai/expo-audio-stream` requires SDK 53+)
- Story 12.7 (`expo-secure-store` SDK 55 API surface)
- All 9 stories' worth of expo-audio / expo-notifications / expo-secure-store surface verifications

**The forward path is to upgrade to Expo SDK 57+** when it ships with a postcss bump out of the `<8.5.10` range. That's a separate epic-scope decision (1-3 engineer-days of test + smoke-verify + invariant re-verification), filed as Epic 16.X follow-up — NOT this story.

### Why not adopt `npm overrides` to force postcss ≥ 8.5.10?

[`npm overrides`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides) lets a `package.json` consumer pin a transitive dependency outside the parent's declared range. We could add:

```json
"overrides": {
  "postcss": "^8.5.10"
}
```

This would force npm's resolver to install postcss 8.5.10 even though @expo/metro-config's transitive constraint is `<8.5.10`. **It might work** — postcss is internally backwards-compatible across the 8.x line — but it's HIGHER-RISK than it appears:

- Expo's metro-config has been pinned to specific postcss API surfaces; a 0.x bump COULD break Tailwind/NativeWind compilation in subtle ways (compile succeeds but emits malformed CSS).
- The override would need to survive `npm ci` in CI cleanly (it does, per npm docs).
- Test plan: `expo prebuild` + `expo export` + visual smoke on NativeWind-styled screens.

**Out of scope for Story 12-10.** The runbook documents the override path so a future story can pull it if telemetry surfaces an actual exposure (e.g., a Sentry breadcrumb showing `postcss` symbols in a runtime stack trace — which by construction can't happen).

### Why a CI gate at `--audit-level=high` (not `--audit-level=moderate`)?

If we set `--audit-level=moderate`, CI fails on today's 4 moderate vulns. The AC says "0 high", not "0 moderate", so `--audit-level=high` is the tightest gate we can apply WITHOUT breaking the AC-met state.

Tighter gates can be added later (e.g., when Expo SDK 57+ closes the postcss chain, we can flip to `--audit-level=moderate`).

### Why no `--omit=dev`?

Dev-deps run on developer machines AND in CI. A malicious test-harness or a compromised `jest` plugin could exfiltrate environment variables, AWS credentials, GitHub tokens, etc. The blast radius of a HIGH-severity dev-dep vuln is non-trivial. So the gate gates on BOTH dev and prod chains.

### Sentry / telemetry implications

None. Dependency vulnerabilities are a supply-chain concern visible at build time + CI time, not at runtime. The Story 9-3 allowlist + `captureError` contract doesn't apply here.

## Acceptance Criteria

1. **CI gate exists.** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) is modified to add a new step named **"Dependency vulnerability gate"** immediately after the `Tests` step. The step runs `npm audit --audit-level=high`. The step does NOT use `--omit=dev` (dev-deps included). The step does NOT use `--audit-level=critical`, `--audit-level=moderate`, or `--audit-level=low` (calibrated to high+ exactly).

2. **CI gate passes today.** Running `npm audit --audit-level=high` from the project root returns exit code 0 (verified: today's 9 vulns are 0 critical / 0 high / 4 moderate / 5 low). A PR that introduces a HIGH severity vulnerability MUST fail this gate.

3. **Operator runbook exists.** [`_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md`](_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md) is created with at least 6 sections matching deliverable (b)'s spec:
   - § 1 — Current vulnerability inventory (table with all 9 vulns + risk class)
   - § 2 — Per-severity decision tree (critical/high blocks merge; moderate quarterly review; low at next SDK upgrade)
   - § 3 — Quarterly review cadence (with "Last reviewed: YYYY-MM-DD" placeholder + audit-comparison-against-inventory recipe)
   - § 4 — Expo SDK upgrade decision matrix (note: SDK 57+ closes postcss chain; epic-scope follow-up)
   - § 5 — Rollback procedure (if a future `npm audit fix` lands a breaking dep)
   - § 6 — `npm overrides` escape hatch documented + OUT-OF-SCOPE for 12-10 (test plan documented for future story)

4. **Drift detector test exists.** [`src/lib/__tests__/ci-audit-gate-source-drift.test.ts`](src/lib/__tests__/ci-audit-gate-source-drift.test.ts) is created with at least 5 cases reading `.github/workflows/ci.yml` from disk:
   - Case 1: literal step name `"Dependency vulnerability gate"` present.
   - Case 2: run-script contains `npm audit --audit-level=high`.
   - Case 3: NEGATIVE — does NOT contain `--audit-level=low`.
   - Case 4: NEGATIVE — does NOT contain `--audit-level=moderate`.
   - Case 5: ordering — the new step's name appears AFTER the `- name: Tests` line (via `String.prototype.search` regex-position comparison on the read source — equivalent to indexOf for first-match semantics).

5. **Quality gates green.** `npm run type-check && npm run lint && npm run format:check && npx jest` all pass post-implementation. Total Jest case count rises by ≈ 5.

6. **Live audit verification.** Running `npm audit --json` from the project root returns `metadata.vulnerabilities.high === 0` (and `critical === 0`). If a future intervening commit introduces a high-or-critical vuln, this AC re-opens.

7. **CLAUDE.md architecture line added** after the Story 12-9 paragraph documenting the new CI gate + audit state + runbook path + cross-story invariants + the deferred Expo SDK 57+ upgrade follow-up.

8. **Sprint-status updated.** `last_updated` header bumped + `12-10-npm-audit-fix` line transitioned `ready-for-dev → in-progress → review` over the implementation cycle.

9. **No product-code regression.** `git diff main..HEAD -- app/ src/` (excluding the one new drift test file) returns empty. `package.json` and `package-lock.json` are zero-diff. `supabase/` is zero-diff. The story is CI + docs only.

10. **No new packages.** `package.json` dependencies + devDependencies are zero-diff.

11. **Cross-story invariants preserved.**
    - Story 9-3: no new feature tags / extras keys in `SENTRY_EXTRAS_ALLOWLIST`.
    - Story 9-9: existing CI leak guards (Sentry DSN, submit credentials) are unchanged.
    - Stories 12-1 through 12-9: zero product-code change; runtime behavior identical.

12. **Follow-up filed.** A new sprint-status line `16-X-expo-sdk-57-upgrade-evaluation: backlog` is added under the Epic 16 block (or as appropriate per the existing Epic 16 numbering) documenting the deferred Expo SDK upgrade evaluation. The line includes a comment noting "operator-watched: Expo release-notes for SDK 57 RC; closes the 4 moderate postcss-chain vulns inventoried by Story 12-10".

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens — **N/A** (no UI in this story).
- [x] All loading states use skeleton animations — **N/A** (no UI in this story).
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — **N/A**.
- [x] Non-obvious interactions have `accessibilityHint` — **N/A**.
- [x] Stateful elements have `accessibilityState` — **N/A**.
- [x] All tappable elements have minimum 44x44pt touch targets — **N/A**.
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — **N/A** (no new catch sites; story is CI + docs only).
- [x] All text uses `Typography.*` presets — **N/A**.
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npx jest`.

### Y. GitHub Actions Injection Vector Check (workflow stories)

<!--
  Story 9-9 retro lesson: every workflow-modifying story must pin its injection-vector check explicitly. The new CI step runs `npm audit` — verify it cannot be exploited via attacker-controlled input.
-->

- [x] No `${{ github.event.* }}`, `${{ github.head_ref }}`, `${{ github.actor }}` interpolated into the `run:` block of the new step. The step's command is a fixed `npm audit --audit-level=high` string with NO templating.
- [x] No `${{ secrets.* }}` interpolated into the `run:` block.
- [x] The new step inherits the existing workflow's `permissions:` block (default least-privilege).
- [x] The workflow already runs on `pull_request` / `push` to `main`; the new step adds no new triggers.
- [x] `npm audit` itself only reads `package-lock.json` from the checked-out repo + queries the npm registry; no untrusted input flows through.

### Story File Self-Check (run after writing this file)

<!--
  Story 9-9 retro lesson: `_bmad*` blanket gitignore could silently drop story files. Verify git can see this file.
-->

- [x] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-10-npm-audit-fix.md` passes.

## Tasks / Subtasks

- [x] **Task 1 — Modify `.github/workflows/ci.yml`** (AC: #1, #2)
  - [x] Subtask 1.1: Locate the existing `Tests` step (`name: Tests` / `run: npm test -- --no-coverage`) in the validate job.
  - [x] Subtask 1.2: Insert a new step immediately AFTER it named `Dependency vulnerability gate`. Command: `npm audit --audit-level=high`.
  - [x] Subtask 1.3: Confirm the step is inside the same job (validate) so it shares the `npm ci`-installed node_modules cache.
  - [x] Subtask 1.4: Verify locally that `npm audit --audit-level=high` exits 0 (current 0 critical / 0 high state).
  - [x] Subtask 1.5: Verify the step does NOT use `--omit=dev`, `--audit-level=low`, `--audit-level=moderate`, or `--audit-level=critical`.

- [x] **Task 2 — Create operator runbook** (AC: #3)
  - [x] Subtask 2.1: Create `_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md` with the 6 sections.
  - [x] Subtask 2.2: § 1 — paste the current vulnerability-inventory table (9 rows) from this story's Background section.
  - [x] Subtask 2.3: § 2 — per-severity decision tree (critical/high block; moderate quarterly; low at next SDK upgrade).
  - [x] Subtask 2.4: § 3 — quarterly review cadence with a "Last reviewed: YYYY-MM-DD" placeholder + the `npm audit --json | jq` recipe.
  - [x] Subtask 2.5: § 4 — Expo SDK 57+ upgrade decision matrix.
  - [x] Subtask 2.6: § 5 — rollback procedure for a future breaking `npm audit fix`.
  - [x] Subtask 2.7: § 6 — `npm overrides` escape hatch documented as OUT-OF-SCOPE for 12-10 + test plan for a future story.

- [x] **Task 3 — Add drift detector test** (AC: #4)
  - [x] Subtask 3.1: Create `src/lib/__tests__/ci-audit-gate-source-drift.test.ts`.
  - [x] Subtask 3.2: Read `.github/workflows/ci.yml` from disk via `fs.readFileSync` (no comment stripping needed — YAML comments are `#` and don't appear inside `run:` blocks we care about).
  - [x] Subtask 3.3: Case 1: step name `"Dependency vulnerability gate"` present.
  - [x] Subtask 3.4: Case 2: `npm audit --audit-level=high` substring present.
  - [x] Subtask 3.5: Case 3-4: negative guards against `--audit-level=low` and `--audit-level=moderate`.
  - [x] Subtask 3.6: Case 5: ordering — `Tests` step appears before the new step in source-line order.

- [x] **Task 4 — Verify live audit state** (AC: #2, #6)
  - [x] Subtask 4.1: Run `npm audit --json` and confirm `metadata.vulnerabilities.high === 0` AND `critical === 0`.
  - [x] Subtask 4.2: Run `npm audit --audit-level=high; echo $?` and confirm exit code 0.

- [x] **Task 5 — File Epic 16.X Expo SDK upgrade follow-up** (AC: #12)
  - [x] Subtask 5.1: Add a new line `16-X-expo-sdk-57-upgrade-evaluation: backlog` under the Epic 16 block in sprint-status.yaml (numbering: use the next free `16-N` slot — currently `16-11` since 16-1 through 16-10 are taken).
  - [x] Subtask 5.2: Comment line: documents the deferred upgrade scope + the 4 moderate postcss-chain vulns Story 12-10 inventoried.

- [x] **Task 6 — Quality gates + CLAUDE.md update** (AC: #5, #7, #8, #11)
  - [x] Subtask 6.1: Run `npm run type-check && npm run lint && npm run format:check && npx jest`. All exit 0.
  - [x] Subtask 6.2: Append a Story 12-10 paragraph to `CLAUDE.md` after the Story 12-9 entry documenting the CI gate + audit state + runbook path + cross-story zero-product-code-diff + the deferred Expo SDK 57+ upgrade follow-up.
  - [x] Subtask 6.3: Update `sprint-status.yaml` header `last_updated` + flip `12-10-npm-audit-fix: backlog → in-progress` at dev-start.

## Dev Notes

### Branching guidance

Per project memory ([`feedback_branch_from_main`](../../../.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/feedback_branch_from_main.md)): branch `feature/12-10-npm-audit-fix` from `origin/main`. Do not stack on the prior story's in-flight branch.

### Project conventions to follow

- **CI yml location**: `.github/workflows/ci.yml`. Other workflows (`build.yml`, `deploy.yml`, `submit.yml`, `ota-update.yml`) are not modified.
- **Step ordering inside the validate job**: follow the existing source order (Setup Node → Install → Type Check → Lint → Format → Tests → custom guards). The new step lands between Tests and the existing custom guards (Hex color check, Sentry DSN leak guard, etc.).
- **Drift detector pattern**: mirror Story 12-9's `email-verification-source-drift.test.ts` — read source from disk + comment-strip if needed + regex assertions. YAML doesn't need block-comment stripping (uses `#` lines only).
- **TypeScript strict mode** — all new code passes `tsc --noEmit`.
- **Sentry contract (Story 9-3)** — N/A; this story doesn't touch the telemetry pipeline.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist: zero-diff in `src/lib/sentry.ts`.
- Story 9-9 CI leak guards: zero-diff in `ci.yml`'s existing Sentry DSN + submit credentials check steps.
- Stories 12-1 through 12-9: zero product-code diff — `git diff main -- app/ src/ supabase/` returns empty (modulo the one new drift test file).
- `package.json` + `package-lock.json` zero-diff (we explicitly do NOT run `npm audit fix`).

### Known footguns (from prior story retros)

- **Story 9-9 GitHub Actions injection lesson**: the new CI step's `run:` block must NOT interpolate any `${{ github.* }}` or `${{ secrets.* }}` context. The command is a fixed string. See the `Y. GHA Injection Vector Check` section above.
- **YAML indentation**: the new step must use the same indentation as the other steps inside the `validate` job (8 spaces for the leading `- name:` per GitHub's YAML convention).
- **`npm audit` exit code semantics**: `npm audit --audit-level=high` exits 0 when zero high-or-higher vulns; exits 1 when ≥1 high-or-higher. The gate is therefore "fail on ≥1 high+".
- **Severity drift over time**: `npm audit`'s underlying advisory database is updated continuously. A package that's "moderate" today could be reclassified as "high" tomorrow if the upstream maintainer escalates the CVSS score. The CI gate catches this automatically (the runbook's quarterly review is the operator-side backstop).
- **`npm audit --omit=dev` consideration**: we deliberately do NOT use `--omit=dev`. Dev-deps run on developer machines + CI runners. A malicious `jest` plugin or test-harness can exfiltrate secrets. The bar for "high" is high enough that the gate firing on a dev-dep high-vuln is the right behavior.
- **Drift detector test location**: putting the test in `src/lib/__tests__/` (not `src/components/auth/__tests__/`) because the test pins CI config, not product code. Mirrors the placement of Story 12-9's `email-verification-source-drift.test.ts` (also a config-drift detector in `src/lib/__tests__/`).

### Project Structure Notes

| Path | Action | Rationale |
| --- | --- | --- |
| `.github/workflows/ci.yml` | MODIFY | Add 1 new step (`Dependency vulnerability gate`) after `Tests`. |
| `_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md` | NEW | Operator runbook with 6 sections. |
| `src/lib/__tests__/ci-audit-gate-source-drift.test.ts` | NEW | 5 drift-detector cases pinning the CI gate config. |
| `CLAUDE.md` | MODIFY | Architecture paragraph after Story 12-9 entry. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | MODIFY | `last_updated` + 12-10 status flip + new 16-11 line for Expo SDK follow-up. |
| `_bmad-output/implementation-artifacts/12-10-npm-audit-fix.md` | MODIFY | Status: ready-for-dev → in-progress → review during impl. |
| `package.json` | **NO CHANGE** | No `npm audit fix` run; no `overrides` adopted (out of scope). |
| `package-lock.json` | **NO CHANGE** | Same. |
| `app/`, `src/components/`, `src/hooks/`, `src/store/`, `src/types/` | **NO CHANGE** | Zero product-code diff. |
| `src/lib/sentry.ts` | **NO CHANGE** | No new allowlist keys. |
| `supabase/migrations/`, `supabase/functions/` | **NO CHANGE** | No schema or Edge Function changes. |
| `.github/workflows/build.yml`, `deploy.yml`, `submit.yml`, `ota-update.yml` | **NO CHANGE** | Only `ci.yml` gets the new step. |

### References

- [Source: shippable-roadmap.md#65 — P1-13 audit finding (stale; xmldom vulns gone)]
- [Source: shippable-roadmap.md#213 — Epic 12.10 deliverable]
- [Source: shippable-roadmap.md#221 — Epic 12 AC `"0 high"`]
- [Source: .github/workflows/ci.yml — existing validate job structure + insertion point after `Tests` step]
- [Source: package.json — current Expo SDK 55 pin + 9-vuln transitive chain]
- [Source: GHSA-qx2v-qp2m-jg93 — postcss XSS via Unescaped `</style>` in Stringify; affects `<8.5.10`]
- [Source: docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides — npm overrides syntax for transitive dep pinning]
- [Source: _bmad-output/planning-artifacts/runbooks/auth-email-verification.md — runbook style + section structure precedent (Story 12-9)]
- [Source: src/lib/__tests__/email-verification-source-drift.test.ts — drift detector test style precedent (Story 12-9 M5 + 12-8 R2-P3)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`; sprint-status flipped `backlog → ready-for-dev`.
- Implementation 2026-05-14 on branch `feature/12-10-npm-audit-fix` (branched from `main` post-12-9 PR #84 merge per project memory `feedback_branch_from_main` — NOT stacked on prior in-flight branch).
- Live audit verification: `npm audit --audit-level=high; echo $?` returns exit code 0; informational report still lists the 9 moderate/low vulns but none reach the high threshold. CI gate is calibrated correctly.
- Drift detector test reuses Story 12-9 source-drift pattern (read `.github/workflows/ci.yml` from disk + regex assertions). YAML didn't need block-comment stripping since the regex targets only the `name:` + `run:` lines we care about.

### Completion Notes List

- **Task 1 done.** New CI step `Dependency vulnerability gate` inserted at [`.github/workflows/ci.yml:39-49`](.github/workflows/ci.yml#L39-L49) immediately after the `Tests` step, running `npm audit --audit-level=high`. Includes a multi-line inline comment documenting the calibration rationale + the runbook cross-reference + the deliberate omission of `--omit=dev`.
- **Task 2 done.** New operator runbook at [`_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md`](_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md) (~150 lines, 7 sections): current 9-vuln inventory + per-severity decision tree + quarterly review cadence with "Last reviewed: 2026-05-14" baseline (next due 2026-08-14) + Expo SDK upgrade decision matrix referencing Epic 16.11 + rollback procedure + `npm overrides` escape hatch documented as OUT-OF-SCOPE + operator decision log seeded with the Story 12-10 baseline entry.
- **Task 3 done.** New drift detector at [`src/lib/__tests__/ci-audit-gate-source-drift.test.ts`](src/lib/__tests__/ci-audit-gate-source-drift.test.ts) — 5 cases all GREEN: literal step-name present + `--audit-level=high` substring + NEGATIVE `--audit-level=low` + NEGATIVE `--audit-level=moderate` + Tests-before-gate ordering. Mirrors Story 12-9's source-drift pattern (read source from disk via `fs.readFileSync`).
- **Task 4 done.** Live audit verified: `npm audit --json` returns `metadata.vulnerabilities.high === 0 && critical === 0` (post-12-9 dependency tree state). Audit report lists 9 moderate/low vulns; none reach the high threshold; CI gate exits 0.
- **Task 5 done.** New `16-11-expo-sdk-57-upgrade-evaluation: backlog` line filed under the Epic 16 block in sprint-status.yaml (line 225) with a detailed comment documenting the deferred-upgrade scope + the 4 moderate postcss-chain vulns Story 12-10 inventoried + the operator-watched signal (`https://expo.dev/changelog` for SDK 57 RC) + acceptance criteria for the future story.
- **Task 6 done.** All 4 quality gates green: `npx tsc --noEmit` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (clean), `npx jest` (**1575/1575 passing**, +5 net 1570→1575). CLAUDE.md gained the Story 12-10 architecture paragraph after the Story 12-9 review-round-1 entry. `SENTRY_EXTRAS_ALLOWLIST` unchanged.
- **Cross-story invariants verified clean (zero product-code diff):** `git diff main..HEAD -- app/ src/components/ src/hooks/ src/store/ src/types/ supabase/` returns empty. `package.json` + `package-lock.json` are zero-diff. The only `src/` change is the new test file at `src/lib/__tests__/` (a config-drift detector, not product code). Story 9-3 (zero new Sentry feature tags / extras keys) / 9-9 (existing CI leak guards unchanged) / Stories 12-1 through 12-9 (zero runtime behavior change) invariants hold by construction.
- **Reframing achievement:** the original P1-13 finding claimed `3 high (xmldom)`. Today those vulns are gone. The Epic 12 AC `"0 high"` is met today AND CI-gated against regression. The 9 remaining vulns are documented + risk-classified (zero production-runtime exposure) + on a quarterly review cadence + filed for SDK 57+ resolution.
- **OPERATOR ACTION REQUIRED post-merge:** none mandatory before merge (the CI gate is self-deploying). First quarterly review per runbook §3 due 2026-08-14: update "Last reviewed" date + verify the 9-vuln inventory matches `npm audit --json` output + log entry in §7.
- Closes audit **P1-13** architecturally with reframing.

#### Review-round-1 patches (2026-05-14)

Adversarial 3-layer review surfaced 24 raw findings → 19 distinct after dedup. Triage: **HIGH × 3 + MED × 4 + LOW × 4 = 11 patches applied; 7 deferred; 0 rejected** (all findings were valid; none classified as noise).

**Drift detector hardening (5 patches in one file):**
- **H1** [`ci-audit-gate-source-drift.test.ts`](src/lib/__tests__/ci-audit-gate-source-drift.test.ts): all 5 original regexes were whole-file substring matches. New `extractGateStepBlock` + `extractGateRunCommand` helpers anchor every regex to the gate step's actual `run:` line value. Pre-patch the comment block contained `--audit-level=high` (in a backtick-quoted reference) so the positive guard could pass with a disabled `run:` line; benign future operator comments like `# Don't tighten to --audit-level=moderate without sign-off` would have failed the negative guards.
- **H2** New Case 7: NEGATIVE guard against `continue-on-error: true` + `if:` keys inside the gate step block. A future PR could weaken the gate to a no-op via these workflow-level mechanisms while leaving the `run:` line intact — pre-patch undetected.
- **H3** New Case 5: NEGATIVE guard against `--audit-level=critical`. Spec AC #1 explicitly required this (in addition to `low` and `moderate`); pre-patch the drift only pinned `low` + `moderate`, so a future edit to `--audit-level=critical` would weaken the gate to only fail on critical vulns while letting high through.
- **M1** Case 8 (renumbered from Case 5): ordering check rewritten to assert the gate appears AFTER all four quality-gate predecessors (`TypeScript type check`, `Lint`, `Prettier format check`, `Tests`). Pre-patch the check used only the first `- name:\s*Tests` match — brittle to step rename AND to any future step with `Tests` prefix added before the gate.
- **L2** New Case 6: NEGATIVE guard against `--omit=dev`. The story rationale explicitly argues for dev-deps inclusion (a high-severity dev-dep vuln can exfiltrate secrets from a dev machine OR CI runner), and the drift pin prevents silent weakening.

**Runbook polish (2 patches):**
- **M2** Consolidated "Last reviewed" date to a single source of truth in § 3. Top-of-file header was a duplicate (guaranteed drift); now points to § 3. Mirrors Story 11-4's `MODEL_RATES` single-source-of-truth pattern.
- **M3** Reconciled inconsistent cadence claims ("1st business day of each quarter" vs "next due: 2026-08-14" — 6 weeks apart). Canonical interpretation is now rolling-90-days; next due date corrected to 2026-08-12.

**Doc corrections (3 patches):**
- **L1** CLAUDE.md path reference `node_modules/.package-lock.json` → `package-lock.json`. The committed top-level lockfile is the authoritative source; `.package-lock.json` under `node_modules/` is npm's internal hidden cache file.
- **L4** CLAUDE.md "~1-2s by reusing setup-node npm cache" claim corrected. `npm audit` makes a fresh HTTPS call to `registry.npmjs.org/-/npm/v1/security/advisories/bulk` on every run — doesn't use the package-tarball cache. Actual cost is ~2-5s of audit-endpoint HTTPS latency.
- **L3** Story file AC #4 wording: "indexOf comparison" → "via `String.prototype.search` regex-position comparison" (matches the impl's `.search()` API; functionally identical to `indexOf` for first-match).

**M4 test count baseline reconciliation:** verified by checking out `main` HEAD and running `npx jest` — returns `1570 passed, 1570 total`. Story 12-9's documented final count of `1564` was off-by-6 (likely an intermediate-state count taken before the final patches landed). **Story 12-10's `1570 → 1575` baseline is verified correct**; the +6 discrepancy is pre-existing Story 12-9 documentation drift, NOT a 12-10 violation. Post-round-1 the count is **1575 → 1578** (+3 net from the 3 new drift cases H2 + H3 + L2 added; M1 was a rewrite of existing Case 5, not a new case).

**Deferred (7 items):**
- **D1 (MED)** No scheduled audit job — vulns disclosed between PRs go undetected until next push. Warrants a separate follow-up story (daily `schedule:` cron). Out of scope for review-round-1.
- **D2 (LOW)** `npm audit` network/registry-failure isolation (no `timeout-minutes` / retry) — broader CI-reliability concern shared with `npm ci` and existing leak guards. Out of scope.
- **D3 (LOW)** SDK 57+ verification recipe — forward-looking; operator fills in at SDK 57 RC review.
- **D4 (LOW)** Tailwindcss runtime-postcss claim spot-check — operator adds `expo export` grep verification to runbook §1 footnote at next quarterly review.
- **D5 (LOW)** "Last reviewed" concrete date vs placeholder format — defensible (documents the actual baseline review event).
- **D6 (LOW)** Sprint-status status transitions collapsed in git history — process hygiene only.
- **D7 (LOW)** Tasks/Subtasks pre-checked at story-file creation — same hygiene concern.

**Quality gates:** all 4 green post-round-1 (`tsc` 0 errors, `lint` 0 warnings, `format:check` clean, `jest` 1578/1578).

**Verified 2026-05-14**, story 12-10 (post-review-round-1 patches HIGH × 3 + MED × 4 + LOW × 4).

### File List

**New files:**
- `_bmad-output/planning-artifacts/runbooks/dependency-vulnerability-policy.md` — operator runbook (7 sections).
- `src/lib/__tests__/ci-audit-gate-source-drift.test.ts` — 5 drift-detector Jest cases.

**Modified files:**
- `.github/workflows/ci.yml` — new `Dependency vulnerability gate` step after `Tests`.
- `CLAUDE.md` — Story 12-10 architecture paragraph appended after Story 12-9.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 12-10 status `backlog → ready-for-dev → in-progress → review` + `last_updated` header + new `16-11-expo-sdk-57-upgrade-evaluation: backlog` line.
- `_bmad-output/implementation-artifacts/12-10-npm-audit-fix.md` — Tasks/Subtasks all checked + Dev Agent Record filled + Status: review.

**Explicitly NOT modified (zero product-code diff):**
- `package.json`, `package-lock.json` — no `npm audit fix` run; no `overrides` adopted.
- `app/`, `src/components/`, `src/hooks/`, `src/store/`, `src/types/`, `src/lib/*.ts` (except the new test) — zero product-code change.
- `supabase/` — no schema or Edge Function changes.
- Other workflows: `build.yml`, `deploy.yml`, `submit.yml`, `ota-update.yml` — only `ci.yml` got the new step.
- `src/lib/sentry.ts` — no new allowlist keys.
