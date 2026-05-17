# Story 15.5: AI schema regression test infrastructure — fixture loader + replay harness for `ai-responses.ts` Zod schemas (capture deferred to operator)

Status: review

## Story

As a developer, I want a **regression-test harness that loads recorded AI-response JSON fixtures from `src/lib/schemas/__fixtures__/<schema>/*.json` and replays each through its corresponding Zod parser in `ai-responses.ts`** so that a future prompt change or model upgrade that breaks an existing real-shape response is caught in CI.

## Background

[`shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 297 — Epic 15.5 deliverable: "AI schema regression tests — record 10 real model outputs per prompt (writing eval, mock test, dictation, etc); replay through Zod parsers in CI."

**Coverage today:** `src/lib/schemas/__tests__/ai-responses.test.ts` covers the schemas at the unit level (synthetic-input boundary tests). Story 15-5 adds the regression-test layer: real-shaped fixtures from production model outputs replayed through the same parsers.

**Why infrastructure-only scope:** capturing 10 real outputs per prompt requires either (a) operator action — pulling Sentry breadcrumbs or capturing live during dev/manual runs — or (b) running the live OpenAI/Azure APIs which would burn cost-cap budget per Story 11-4. Neither is appropriate for an autopilot story. The 15-5 deliverable splits cleanly: ship the infrastructure here; defer fixture capture to operator action documented in the runbook.

## Acceptance Criteria

### AC-A: Fixture loader + replay harness

1. NEW directory `src/lib/schemas/__fixtures__/` with subdirectories one per Zod schema (e.g., `chat-completion/`, `writing-evaluation/`, `conversation-feedback/`). Each schema dir holds N JSON fixture files named `<descriptor>.json` (e.g., `b1-formal-prompt-001.json`).
2. NEW `src/lib/schemas/__tests__/fixture-replay.test.ts` that:
   - Walks the `__fixtures__/<schema>/` subdirectories at test setup time
   - For each fixture file: loads the JSON, looks up the corresponding Zod schema by directory name, runs `schema.safeParse(json)`, asserts `success === true`
   - **Each fixture becomes a distinct Jest test case** via `it.each` over discovered files. A future operator adding `__fixtures__/chat-completion/new-fixture.json` automatically gets a new test case without code changes.
   - Empty fixture directory → schema is documented as "no regression fixtures yet" with a `describe.skip` block (NOT a hard test failure — we want to ship the infrastructure before fixtures exist).
3. The fixture-to-schema mapping is explicit (not auto-derived from directory name) — a constant `FIXTURE_SCHEMA_MAP: Record<string, ZodSchema>` at the top of the test file lists each schema dir mapped to its imported Zod parser.

### AC-B: Seed fixtures (minimum 1 per included schema)

4. Seed at least 1 fixture file per included schema directory (operator-captured shapes are out of scope; use a SYNTHETIC fixture per schema that demonstrates the replay path works). Mark each synthetic fixture with a top-level `"_synthetic": true` field to distinguish from operator-captured fixtures.
5. Start with 3 schema directories (matches the spec's "writing eval, mock test, dictation" example list): `writing-evaluation`, `mock-test-section`, `dictation`.

### AC-C: Operator runbook

6. NEW `_bmad-output/planning-artifacts/runbooks/ai-fixture-capture.md` documenting:
   - WHEN to capture (after a prompt change OR after a model upgrade)
   - HOW to capture (paste-from-Sentry vs run live OpenAI call vs use dev-mode logging breadcrumb)
   - NAMING convention (`<cefr>-<descriptor>-NNN.json`)
   - WHERE to store (`src/lib/schemas/__fixtures__/<schema>/`)
   - HOW to verify (run `npx jest fixture-replay` locally → new fixture should show as a new passing test case)

### AC-D: Quality gates

7. All 5 design-system gates green.
8. **Net test growth:** **+3 to +6 net Jest cases** (1 per included schema seed fixture + a few infrastructure pins).

### AC-E: Cross-story invariants

9. `ai-responses.ts` schemas unchanged (15-5 consumes them; doesn't modify).
10. Existing `ai-responses.test.ts` unchanged.
11. **No source-module modifications** beyond test infrastructure + runbook.

## Operator Decisions

| Q | Question | Recommended |
| --- | --- | --- |
| Q1 | Auto-derive schema from dir name (fragile to renames) vs explicit `FIXTURE_SCHEMA_MAP`? | **Explicit map** — clearer + survives schema renames + TypeScript-checked |
| Q2 | Include `_synthetic: true` marker on seed fixtures? | **Yes** — distinguishes operator-captured-real fixtures from infra-bootstrap seeds; future tooling can filter to real-only when assessing regression confidence |
| Q3 | Start with 3 schemas or all 36? | **3** — `writing-evaluation`, `mock-test-section`, `dictation` (matches the spec's example list). Adding more is a one-line dir create + map entry; defer to follow-ups. |

## Out of Scope

- Real fixture capture (operator action; runbook documents the procedure)
- All 36 schemas covered (defer to `15-5-followup-fixture-coverage-expansion`)
- Capture automation (e.g., adding a `dev-mode-fixture-recorder` to Sentry breadcrumbs) — defer

## Tasks / Subtasks

- [x] Task 1: Create `__fixtures__/` directory tree + 3 synthetic seed fixtures
- [x] Task 2: Write `fixture-replay.test.ts` with `FIXTURE_SCHEMA_MAP` + auto-discovery `it.each`
- [x] Task 3: Write runbook
- [x] Task 4: Quality gates + CLAUDE.md paragraph + sprint-status

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### File List
