# Story 15.4: Golden-flow E2E (Maestro skeleton flows + operator runbook)

Status: review

## Story

As **a developer**, I want **5 Maestro YAML flow files documenting the golden user flows (sign-up / onboarding / first exercise / first conversation / partial mock test → review)** so that **an operator can execute end-to-end smoke tests locally + we have the structural framework for wiring Maestro into CI when simulator/emulator infrastructure is set up**.

## Background

[`shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 296 — Epic 15.4 deliverable: "Golden-flow E2E with Detox or Maestro — sign-up → onboarding → 1 exercise → 1 conversation → mock test partial → review."

**Operator pre-decision (autopilot batch kickoff):** **Maestro** chosen over Detox per the spec's recommended default — faster iteration, simpler YAML config, no Xcode/Android Studio project-level integration required.

### Why SKELETON-ONLY scope

Maestro requires a running iOS Simulator OR Android Emulator + a built app binary + Maestro CLI installed locally. None of these are available in the autopilot session. The cleanest scope-cut: ship the YAML flow files + operator runbook + drift detector; defer CI wiring to a follow-up after the operator sets up the simulator/emulator infrastructure on a dedicated runner.

Maestro flow YAMLs are usable AS-IS by the operator once they install the CLI (`curl -Ls "https://get.maestro.mobile.dev" | bash`).

## Acceptance Criteria

### AC-A: 5 Maestro flow YAML files

1. NEW `.maestro/config.yaml` declaring the app id (matches `app.json` bundleIdentifier / package name).
2. NEW `.maestro/01-signup-flow.yaml` — sign-up via email/password → email-verification screen.
3. NEW `.maestro/02-onboarding-flow.yaml` — 3-step onboarding wizard → placement test → home.
4. NEW `.maestro/03-first-exercise.yaml` — practice tab → grammar/vocabulary → complete 1 MCQ exercise.
5. NEW `.maestro/04-first-conversation.yaml` — conversation tab → topic select → start session → grant mic → speak → end.
6. NEW `.maestro/05-mock-test-partial-review.yaml` — mock-test tab → start full sim → complete listening section → submit (partial) → view results.

Each flow file:
- Documents EXPECTED steps with `# TODO: verify selector` markers where the testID/accessibilityLabel needs operator verification against the actual app screens
- Uses `assertVisible`, `tapOn`, `inputText` Maestro commands

### AC-B: Operator runbook

7. NEW `_bmad-output/planning-artifacts/runbooks/maestro-e2e-setup.md` documenting:
   - Install Maestro CLI
   - Set up iOS Simulator + Android Emulator
   - Build a development client via `npx expo run:ios` / `npx expo run:android`
   - Run flows locally: `maestro test .maestro/`
   - Test account requirements
   - Selector-verification workflow (`maestro studio` for interactive selector picking)
   - Wire into CI procedure (deferred; documented for when operator infrastructure is ready)

### AC-C: Drift detector

8. NEW `src/lib/__tests__/maestro-flows-source-drift.test.ts` (≥4 cases) reading `.maestro/` dir:
   - POSITIVE: 5 expected flow files exist with canonical names
   - POSITIVE: each flow has a non-empty body
   - POSITIVE: `.maestro/config.yaml` exists with the canonical appId
   - NEGATIVE: no flow file is empty / placeholder-only (gap detection)

### AC-D: Quality gates + cross-story

9. All 5 design-system gates green.
10. **Net test growth:** **+4 to +6 net Jest cases** (drift detector only — Maestro flows execute outside Jest).
11. **No CI workflow changes** (deferred to `15-4-followup-maestro-ci-wiring`).
12. **0 source-module modifications.**

## Operator Decisions

| Q | Question | Recommended |
| --- | --- | --- |
| Q1 | Maestro vs Detox? | **Maestro** — pre-decided at autopilot kickoff |
| Q2 | Wire CI now or defer? | **Defer** — needs simulator/emulator infrastructure. File `15-4-followup-maestro-ci-wiring`. |
| Q3 | Inline selector hard-coding vs operator-verify TODO markers? | **TODO markers** — selectors must be verified against the actual app via `maestro studio`; hardcoding without verification is hope-driven |

## Out of Scope

- CI wiring (deferred)
- Actually-running the flows in this session (no simulator/emulator access)
- Selector verification (operator action; `maestro studio` workflow documented in runbook)

## Tasks / Subtasks

- [x] Task 1: 5 Maestro YAML flow files + `.maestro/config.yaml`
- [x] Task 2: Operator runbook
- [x] Task 3: Drift detector test
- [x] Task 4: Quality gates + CLAUDE.md paragraph + sprint-status

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### File List
