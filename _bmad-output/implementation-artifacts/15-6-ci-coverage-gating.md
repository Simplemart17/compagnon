# Story 15.6: CI coverage gating — wire `jest --coverage` with threshold gate on `src/lib/` + `src/hooks/`

Status: done

## Story

As a developer, I want `jest --coverage` wired into CI with a coverage threshold gate on `src/lib/` + `src/hooks/` so that **a PR that removes tests OR adds substantial untested code fails CI rather than silently merging** — operationalizing the Epic 15 "make CI a real gate, not a green-light theater" goal.

## Background

[`shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 299 — Epic 15.6 deliverable: "CI gating — Jest threshold ≥ 40% on `src/lib/` and `src/hooks/`; fail PR on regression."

**Story 12-10 audit refresh footnote** clarifies: the pre-15-X audit's "3-5% coverage" framing was stale. Today's repo has 2167+ Jest tests across libs / hooks / components / prompts / schemas. The actual gap is **wiring** `--coverage` into CI (no gate today), not writing tests.

## Acceptance Criteria

### AC-A: `jest.config.js` coverage config

1. Add `collectCoverageFrom: ["src/lib/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "!**/__tests__/**", "!**/*.d.ts"]` so coverage scope is bounded to the spec's targets.
2. Add `coverageThreshold` block with conservative initial thresholds. Per spec: **40%** floor on lines + functions + statements + branches for both `src/lib/` and `src/hooks/`. The threshold is a starting point; can be ratcheted up via PR as coverage grows.
3. Add `coverageReporters: ["text-summary", "lcov"]` for CI-readable + Codecov-compatible output.

### AC-B: `package.json` script

4. Add `"test:coverage": "jest --coverage"` script.

### AC-C: CI workflow change

5. Add new step `Tests with coverage threshold` to `.github/workflows/ci.yml` AFTER the existing `Tests` step (which runs `npm test -- --no-coverage`). The new step:
   - Runs `npm run test:coverage`
   - Fails CI if coverage thresholds are not met
   - Uploads coverage as workflow artifact for later inspection (optional but recommended)
6. Do NOT remove the existing `Tests` step — keep both:
   - `Tests` (`npm test -- --no-coverage`) for fast green-light feedback
   - `Tests with coverage threshold` for the gate
   This way developers can see test failures quickly without waiting for the slower coverage instrumentation.
   **CONFIRM CHOICE in spec:** OR — replace the `Tests` step with `test:coverage` only. Q1 below.

### AC-D: Drift detector

7. NEW `src/lib/__tests__/ci-coverage-gate-source-drift.test.ts` (≥5 cases) pinning:
   - `jest.config.js` has `coverageThreshold` block with 40% floor for lines + functions + statements + branches
   - `jest.config.js` has `collectCoverageFrom` scoping to `src/lib/` + `src/hooks/`
   - `package.json` has `test:coverage` script
   - `ci.yml` has the new coverage step + NEGATIVE no `continue-on-error: true` (Story 12-10 R1-H2)
   - Step ordering: coverage step AFTER the no-coverage Tests step

### AC-E: Threshold reality check

8. Run `npm run test:coverage` locally during dev-story implementation. If actual coverage on `src/lib/` OR `src/hooks/` is BELOW 40% on ANY metric (lines / functions / statements / branches), lower the threshold to the FLOOR-MINUS-3% of actual coverage (rounded down to the nearest integer) per metric. Document the actual numbers in the Completion Notes. **Future-PR ratchet:** when coverage grows, the threshold should grow with it via separate PR — but for 15-6 ship the realistic floor, not an aspirational one.

### AC-F: Quality gates + cross-story

9. All 5 design-system gates green.
10. **Net test growth:** **+5 to +7 net Jest cases** (drift detector only — the coverage gate runs the existing suite + measures).
11. **0 source-module modifications** beyond `jest.config.js` + `package.json` + `ci.yml` + new drift test.

## Operator Decisions

| Q | Question | Recommended |
| --- | --- | --- |
| Q1 | Keep `Tests` + `Tests with coverage threshold` (2 steps) OR replace? | **Keep both** — Tests step is fast green-light; coverage step adds ~30% time + memory. Two steps means failing tests fail fast in the Tests step before the slower coverage measurement runs. |
| Q2 | Coverage threshold 40% (spec literal) or measured floor? | **Measured floor minus 3%** — ship a passing CI; ratchet up via future PRs. Spec's 40% is a starting hint, not a hard requirement. |
| Q3 | Codecov / Coveralls integration? | **Defer** — needs operator account setup. Filing `15-6-followup-codecov-integration`. Ship the local gate first. |

## Out of Scope

- Codecov / Coveralls integration (operator action)
- Coverage on `src/components/` (the spec scopes to `src/lib/` + `src/hooks/` only)
- Threshold ratcheting policy (file `15-6-followup-coverage-ratchet-cadence`)

## Tasks / Subtasks

- [x] Task 1: Add coverage config to `jest.config.js`
- [x] Task 2: Add `test:coverage` script to `package.json`
- [x] Task 3: Add CI step + drift detector
- [x] Task 4: Run coverage locally, calibrate threshold to realistic floor
- [x] Task 5: Quality gates + CLAUDE.md + sprint-status

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6) via /bmad-dev-story workflow in autopilot mode.

### Completion Notes List

- **Coverage configuration**: `jest.config.js` extended with `collectCoverageFrom` scoping (src/lib/ + src/hooks/; **tests**/ + .d.ts excluded), `coverageThreshold` block at 40% floor on all 4 metrics (statements/branches/functions/lines), and `coverageReporters: ["text-summary", "lcov"]`. Mounted alongside the existing `forceExit: true` block; no other Jest config changes.
- **Package.json**: new `test:coverage` script wired to `jest --coverage`; placed immediately after `test:watch` for adjacency.
- **CI wiring**: new step `Tests with coverage threshold` runs `npm run test:coverage` AFTER the existing `Tests` step (Q1 RECOMMENDED — keep both for fast green-light + slow gate separation). The new step does NOT carry `continue-on-error: true` (Story 12-10 R1-H2 silent-disable defense).
- **Threshold calibration**: measured local coverage at 53.42% / 55.80% / 51.49% / 54.12% — well above the 40% spec floor with ~11 points of headroom against the lowest metric (Functions 51.49%). Q2 RECOMMENDED was "measured floor minus 3%" but the 40% spec literal already leaves comfortable headroom, so the spec floor was used as-is. A future PR can ratchet to 50% once Functions coverage grows.
- **Drift detector**: 6 cases at `src/lib/__tests__/ci-coverage-gate-source-drift.test.ts` pinning (1) coverageThreshold whole-block with 40 floor, (2) collectCoverageFrom 4-entry scope, (3) package.json `test:coverage` script value, (4) CI step name + run command, (5) coverage step appears AFTER `Tests` step, (6) NEGATIVE no `continue-on-error: true` and no `if:` keys inside the coverage step block. Story 12-10 R1-M1 indexOf-ordering pattern reused.
- **Gate verification**: `npm run test:coverage` runs all 116 suites / 2165 cases + emits the coverage summary; gate passes by ~11 points on each metric.
- **Ignore files**: `coverage/` added to `.gitignore` (generated lcov + HTML report) and `.prettierignore` (HTML report not subject to Prettier formatting).
- **Q3 (Codecov/Coveralls)**: deferred per spec — filed as `15-6-followup-codecov-integration` (future operator action).
- **Quality gates**: type-check 0 errors / lint 0 warnings / Prettier clean / `check:tokens` clean / Jest 116 suites 2165 cases. Coverage gate passes.

### File List

**New:**

- `src/lib/__tests__/ci-coverage-gate-source-drift.test.ts` — 6 drift cases

**Modified:**

- `jest.config.js` — coverage config (collectCoverageFrom + coverageThreshold + coverageReporters)
- `package.json` — `test:coverage` script
- `.github/workflows/ci.yml` — new `Tests with coverage threshold` step
- `.gitignore` — `coverage/` ignored
- `.prettierignore` — `coverage/` ignored
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 15-6 → done
- `CLAUDE.md` — Story 15-6 architecture paragraph appended
