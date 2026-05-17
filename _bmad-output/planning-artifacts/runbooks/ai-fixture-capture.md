# AI Fixture Capture Runbook

**Owner:** ai-integration agent / operator
**Frequency:** After any prompt change in `src/lib/prompts/*.ts` OR after a model upgrade (gpt-4o → gpt-4.x) OR after a schema change in `src/lib/schemas/ai-responses.ts`.

---

## What is this?

Story 15-5 shipped the **AI schema regression test infrastructure**: a fixture loader at `src/lib/schemas/__tests__/fixture-replay.test.ts` that walks `src/lib/schemas/__fixtures__/<schema>/*.json` and replays each through its corresponding Zod parser. Real-shaped fixtures captured from production model outputs catch regressions that synthetic unit tests miss (e.g., an extra-field the model started emitting, or an enum value drift).

Each fixture file becomes a distinct Jest test case automatically. **Adding a fixture is a pure data add** — no code change needed.

---

## When to capture

1. **Prompt change** — modifying any of `src/lib/prompts/*.ts` (e.g., `writing.ts`, `mock-test.ts`, `dictation.ts`). The new prompt may shift the model output shape; capture fresh fixtures to verify the schema still accepts the new responses.
2. **Model upgrade** — when switching the OpenAI/Azure model version. New models often subtly change JSON output shape.
3. **Schema change** — when modifying `src/lib/schemas/ai-responses.ts`. Run existing fixtures through the new schema to verify backward compatibility.

---

## How to capture (3 options)

### Option A: Sentry breadcrumb pull (preferred for production-shape fidelity)

1. Open Sentry → Issues → filter `feature:chat-completion` (or `feature:writing-evaluation`, etc.).
2. Pick a recent breadcrumb with a successful AI response (look for `breadcrumb.category === "ai"` and `breadcrumb.level === "info"`).
3. Copy the raw JSON response body from the breadcrumb metadata.
4. Save to `src/lib/schemas/__fixtures__/<schema>/<descriptor>-NNN.json`.

### Option B: Dev-mode capture (when Sentry doesn't have the shape you want)

1. Add a temporary `console.log` in the relevant `chatCompletionJSON` caller: `console.log("FIXTURE_CAPTURE:", JSON.stringify(parsed));`
2. Run the app in dev mode; trigger the AI call once.
3. Copy the logged JSON from the terminal.
4. **REMOVE the console.log before committing.**
5. Save to `src/lib/schemas/__fixtures__/<schema>/<descriptor>-NNN.json`.

### Option C: Live OpenAI call (most expensive — last resort)

1. Write a one-off Node script that invokes `chatCompletionJSON` with a representative prompt.
2. Save the response.
3. **Counts against `daily_cost_ledger` per Story 11-4** — do this sparingly.

---

## Naming convention

Filename pattern: `<descriptor>-NNN.json` (e.g., `b2-formal-essay-003.json`, `a1-greeting-001.json`).

- `<descriptor>` — short alphanumeric description matching the CEFR level + content theme + sequence index
- `NNN` — 3-digit zero-padded sequence number per descriptor

The directory name is the schema name (lowercased, hyphenated) matching the keys in `FIXTURE_SCHEMA_MAP` at `src/lib/schemas/__tests__/fixture-replay.test.ts`.

### Synthetic vs real-captured

The Story 15-5 seed fixtures carry a top-level `"_synthetic": true` marker to distinguish them from real-captured fixtures. **When capturing real outputs, OMIT the `_synthetic` field.** The `stripMetadata` helper in the replay test strips `_synthetic` + `_note` fields before handing to the parser, so the presence/absence of the marker is purely operator-readable bookkeeping.

---

## Where to store

```
src/lib/schemas/__fixtures__/
├── writing-evaluation/
│   └── synthetic-b1-formal-001.json  ← seed
├── dictation/
│   └── synthetic-a2-mixed-001.json   ← seed
├── mock-test-section/
│   └── synthetic-b1-listening-001.json  ← seed
└── <new-schema-dir>/                  ← add here as needed
    └── <captured>-NNN.json
```

Adding a new schema to coverage requires:

1. Create the directory: `mkdir -p src/lib/schemas/__fixtures__/<schema-name>/`
2. Add an entry to `FIXTURE_SCHEMA_MAP` in `src/lib/schemas/__tests__/fixture-replay.test.ts`:
   ```ts
   const FIXTURE_SCHEMA_MAP: Record<string, z.ZodTypeAny> = {
     "writing-evaluation": writingEvaluationSchema,
     dictation: dictationSetSchema,
     "mock-test-section": mockTestSectionSchema,
     "<schema-name>": <importedSchemaSymbol>,  // ← add this line
   };
   ```
3. Drop at least one fixture file into the new directory.

---

## How to verify

After adding a fixture:

```bash
npx jest fixture-replay --no-coverage
```

You should see a new passing test case named `fixture <schema>/<file> parses successfully against its Zod schema`. If the test FAILS:

- Read the Zod issue list in the error output — it tells you which field is wrong and why.
- Common causes: model emitted an extra field the schema doesn't allow (Zod is `strict()` by default in many schemas); model omitted an optional-but-validated field; model returned a string where the schema expected a number.
- If the schema needs to be widened to accept the new shape, that's a schema change in `ai-responses.ts` — usually requires a follow-up story discussion.

---

## Coverage target

Story 15-5 spec target: 10 real fixtures per schema. Current state: 3 schemas × 1 synthetic seed = 3 fixtures total. **Operator action:** capture 9 more fixtures per schema during the next prompt-change or model-upgrade window.

---

## Cross-story references

- Story 15-5: shipped the infrastructure (this runbook + fixture-replay.test.ts + seed fixtures + 3 directories).
- Story 9-7: `chatCompletionJSON` parseRetries contract — failed schema parse retries the AI call once before throwing.
- Story 11-4: `daily_cost_ledger` — Option C (live capture) burns cost-cap budget.
- Story 15-6 (planned): jest `--coverage` CI gating; the fixture-replay tests count toward the coverage threshold.
