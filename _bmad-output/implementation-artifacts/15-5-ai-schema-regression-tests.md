# Story 15.5: AI schema regression test infrastructure — fixture loader + replay harness for `ai-responses.ts` Zod schemas (capture deferred to operator)

Status: done

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

Claude Sonnet 4.6 (claude-sonnet-4-6) via /bmad-dev-story + /bmad-code-review workflows in autopilot mode.

### Completion Notes List

- **Infrastructure shipped**: fixture-replay harness at `src/lib/schemas/__tests__/fixture-replay.test.ts` discovers `__fixtures__/<schema>/*.json` via `it.each`, strips `_synthetic` + `_note` top-level metadata, parses through Zod schemas via `FIXTURE_SCHEMA_MAP`. 3 synthetic seed fixtures (writing-evaluation, dictation, mock-test-section). Operator runbook at `_bmad-output/planning-artifacts/runbooks/ai-fixture-capture.md`.
- **R1 patches applied** (HIGH × 5 + MED × 5 + LOW × 2): BH-1 JSON.parse error wrapping (surfaces fixture path on malformed JSON); BH-2 NEW Case 6 enforces `_synthetic: true` marker on every committed fixture (privacy defense); BH-3/EH-10 runbook gains REQUIRED Privacy + GDPR section before Option A — user-derived French content sanitization workflow with `_redacted: true` marker convention; BH-4 Case 2 walks `fs.readdirSync` directly so empty orphan dirs fail loud; BH-5 `FIXTURE_SCHEMA_MAP` uses `as const satisfies` for narrow value typing; BH-6 `dirent.isFile()` filter so a directory ending in `.json` doesn't crash with EISDIR; BH-7/EH-1 `stripMetadata` JSDoc documents top-level-only contract; BH-12 belt-and-suspenders FIXTURES_ROOT existence pin (Case 0); EH-2 Case 4 covers nested `_note` symmetrically with nested `_synthetic`; EH-6 case-insensitive `.json` match; EH-9 (load-bearing) NEW Case 7 parallel strict-mode probe — schemas use Zod default `.strip()` which silently drops unknown fields; strict-probe surfaces extra-field drift as SOFT console warning per fixture (does not fail test — synthetic seeds pass by construction; real captures may flag drift). Runbook's misleading "Zod is strict() by default" claim corrected.
- **Deferred** (filed as follow-ups): `15-5-followup-real-fixture-manifest` (operator-action `.real-fixtures.txt` allow-list for real captures); `15-5-followup-passage-ref-integrity` (BH-8 — mock-test passageId schema gap); `15-5-followup-empty-fixture-boundary` (EH-3 — empty-object edge case).
- **Quality gates green**: type-check 0 errors / lint 0 warnings / prettier clean / jest test passes (11/11).

### File List

**New:**

- `src/lib/schemas/__tests__/fixture-replay.test.ts` — 11 Jest cases (8 original + 3 R1 patches: Case 0 FIXTURES_ROOT existence + Case 6 synthetic-marker + Case 7 strict-mode probe)
- `src/lib/schemas/__fixtures__/writing-evaluation/synthetic-b1-formal-001.json`
- `src/lib/schemas/__fixtures__/dictation/synthetic-a2-mixed-001.json`
- `src/lib/schemas/__fixtures__/mock-test-section/synthetic-b1-listening-001.json`
- `_bmad-output/planning-artifacts/runbooks/ai-fixture-capture.md` (round-1 includes new Privacy + GDPR section + Zod default-behavior correction)

**Modified:**

- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 15-5 → done
- `CLAUDE.md` — Story 15-5 architecture paragraph appended
