# Story 15.3: Edge Function Deno tests in CI — wire existing `_shared/__tests__/*_test.ts` files into the GitHub Actions workflow

Status: done

## Story

As **a developer**, I want **the existing `supabase/functions/_shared/__tests__/*_test.ts` Deno test files (currently manual-run only) wired into the GitHub Actions CI workflow** so that **a regression in `fetchWithTimeout` (Story 11-3) or `parseUpstreamError` (Story 12-11) silently survives a PR merge no longer**.

## Background

[`shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 295 — Epic 15.3 deliverable: "Edge Function Deno tests — auth gate, rate limit, model allowlist, account-delete idempotency."

**Carries Epic 12 AI #7 + Epic 13 AI #8** (pgTAP CI wiring) — surfaced at Epic 15 kickoff via the accountability gate.

### Coverage inventory

Existing manual-run tests:
- `supabase/functions/_shared/__tests__/fetch-with-timeout_test.ts` (Story 11-3 — 7 cases)
- `supabase/functions/_shared/__tests__/parse-upstream-error_test.ts` (Story 12-11 — 7 cases)
- `supabase/migrations/__tests__/rate_limit_test.sql` (Story 11-4 — 8 pgTAP)
- `supabase/migrations/__tests__/atomic_activity_rpcs_test.sql` (Story 12-3 — 11 pgTAP)
- `supabase/migrations/__tests__/match_error_pattern_test.sql` (Story 11-6 — 7 pgTAP)
- `supabase/migrations/__tests__/get_home_aggregate_test.sql` (Story 13-2 — 7 pgTAP)
- `supabase/migrations/__tests__/get_session_feedback_aggregate_test.sql` (Story 13-3 — 9 pgTAP)

**15-3 scope (TIGHT):** wire the 2 existing Deno test files into CI. pgTAP wiring DEFERRED to `15-3-followup-pgtap-ci-wiring` (needs Postgres-in-CI service container infrastructure — a non-trivial workflow change). NEW Deno tests for additional Edge Functions DEFERRED to `15-3-followup-edge-function-coverage` (the spec line lists auth gate / rate limit / model allowlist / account-delete — none of which have unit tests today; each is a substantial new test file).

## Acceptance Criteria

### AC-A: CI workflow change

1. NEW step `Deno tests (Edge Function _shared utilities)` added to `.github/workflows/ci.yml` AFTER the `Tests` step (which runs `npm test`). The step:
   - Uses `denoland/setup-deno@v2` action to install Deno (latest stable)
   - Runs `deno test --allow-net=127.0.0.1 supabase/functions/_shared/__tests__/`
   - The `--allow-net=127.0.0.1` permission is required by `fetch-with-timeout_test.ts` which spins up a local HTTP server for the happy-path test
2. The new step runs ONLY the `_shared/__tests__/` directory (NOT `supabase/functions/*/__tests__/` which doesn't exist today + would inadvertently scope the gate to future test files that may have different permission needs)

### AC-B: Drift detector

3. NEW `src/lib/__tests__/ci-deno-step-source-drift.test.ts` (≥4 cases) reading `.github/workflows/ci.yml` from disk:
   - POSITIVE pin: literal step name `Deno tests (Edge Function _shared utilities)`
   - POSITIVE pin: `denoland/setup-deno@v2` action ref
   - POSITIVE pin: `deno test` invocation with the canonical `--allow-net=127.0.0.1` permission flag
   - NEGATIVE pin: no `--allow-all` (over-permissive)
   - NEGATIVE pin: the step does NOT carry `continue-on-error: true` (Story 12-10 R1-H2 silent-disable defense)

### AC-C: Quality gates + cross-story

4. All 5 design-system gates green.
5. **Net test growth:** **+4 to +6 net Jest cases** (drift detector cases only — the Deno tests themselves run in CI but don't count toward the Jest suite).
6. **Cross-story invariants:** Story 11-3 `fetchWithTimeout` + Story 12-11 `parseUpstreamError` test bodies unchanged (15-3 wires them into CI but doesn't modify the tests themselves).
7. **No source-module modifications** beyond the ci.yml step + the new drift test file.

## Operator Decisions

| Q | Question | Recommended |
| --- | --- | --- |
| Q1 | Use `denoland/setup-deno@v2` vs install Deno via shell curl? | **(a) setup-deno@v2** — official action, cached, faster CI |
| Q2 | Pin Deno version explicitly or use `latest`? | **`v1.x`** — pinned `vx-latest` for the v1 branch (Deno 2.0 has breaking changes; defer migration to a follow-up). Specifically use the action's `deno-version: vx.x.x` with the latest patch of v1. |
| Q3 | Run pgTAP in CI now or defer? | **Defer** — pgTAP needs a Postgres service container; significant workflow complexity. File `15-3-followup-pgtap-ci-wiring`. |

## Out of Scope

- pgTAP CI wiring (deferred to follow-up)
- NEW Edge Function tests (auth gate / rate limit / model allowlist / account-delete idempotency — each is a substantial new test file; defer)
- Deno 2.0 migration

## Tasks / Subtasks

- [x] **Task 1:** Add `Deno tests (Edge Function _shared utilities)` step to `.github/workflows/ci.yml` (AC #1-2)
- [x] **Task 2:** Add `src/lib/__tests__/ci-deno-step-source-drift.test.ts` with ≥4 cases (AC #3)
- [x] **Task 3:** Quality gates + housekeeping (CLAUDE.md paragraph + sprint-status)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6) via /bmad-dev-story + /bmad-code-review workflows in autopilot mode.

### Completion Notes List

- **CI step wired**: `.github/workflows/ci.yml` gains `Setup Deno` (denoland/setup-deno@v2 + deno-version v1.x) + `Deno tests (Edge Function _shared utilities)` step after the existing `Tests` step.
- **Drift detector**: 5 cases at `src/lib/__tests__/ci-deno-step-source-drift.test.ts` — pins action + version + canonical run command + 2 negative guards (--allow-all + silent-disable) + ordering.
- **R1 patches applied** (HIGH × 3 + MED × 4): BH-2/EH-1 explicit file paths in run command (vacuous-pass defense); BH-3/EH-2 fix --allow-all docstring drift in parse-upstream-error_test.ts; EH-4 anchor Case 5 regex with `/m + $` to defend against PR #116 `Tests with coverage threshold` step; BH-5 extend Case 4 to cover BOTH Setup Deno + Deno test step blocks; BH-6 add `timeout-minutes: 3`; BH-7 rewrite misleading v1/v2 comment to clarify action-version vs runtime-version axes; EH-10 add `--no-check` to skip redundant TS check.
- **Deferred**: BH-1/EH-3 SHA-pin all 3rd-party actions → `15-3-followup-action-sha-pinning` (warrants global PR); BH-4/EH-6 Deno cache → `15-3-followup-deno-cache`; EH-8 real body-read timeout test → `15-3-followup-real-body-read-timeout-test`; EH-5 PR #116 merge conflict — operator resolves at merge time (recommended: merge this PR before #116).
- **Quality gates green**: type-check 0 errors / lint 0 warnings / prettier clean / jest drift detector 5/5 pass.

### File List

**New:**

- `src/lib/__tests__/ci-deno-step-source-drift.test.ts` — 5 drift cases (round-1 includes BH-5 + EH-4 + R1 BH-2/EH-1/EH-10 pin updates)

**Modified:**

- `.github/workflows/ci.yml` — added `Setup Deno` + `Deno tests (Edge Function _shared utilities)` steps after the existing `Tests` step (round-1 includes explicit file paths + --no-check + timeout-minutes per R1 patches)
- `supabase/functions/_shared/__tests__/parse-upstream-error_test.ts` — docstring R1 fix (--allow-all → --allow-net=127.0.0.1)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 15-3 → done
- `CLAUDE.md` — Story 15-3 architecture paragraph appended
