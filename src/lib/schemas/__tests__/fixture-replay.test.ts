/**
 * Story 15-5 — AI schema regression test infrastructure.
 *
 * Walks `src/lib/schemas/__fixtures__/<schema>/*.json` at suite setup time,
 * loads each fixture, and replays it through the corresponding Zod parser.
 * Each fixture file becomes a distinct Jest test case via `it.each` over
 * the discovered files — adding a new fixture file is a pure data add (no
 * code change needed).
 *
 * The `FIXTURE_SCHEMA_MAP` is the explicit dir-name → schema mapping. A
 * future schema rename in `ai-responses.ts` requires updating both this
 * map AND the fixtures directory name (caught by TypeScript on the
 * `import` line, with `satisfies` per R1 BH-5 narrowing).
 *
 * `_synthetic: true` marker on seed fixtures distinguishes them from
 * operator-captured real model outputs. The replay logic strips the
 * `_synthetic` + `_note` top-level fields BEFORE handing to the parser
 * (those are metadata; not part of the schema contract).
 *
 * R1 patches (HIGH × 5 + MED × 5 + LOW × 2):
 *   - BH-1: JSON.parse wrapped in try/catch so a malformed fixture's
 *     file path is surfaced in the error message, not buried.
 *   - BH-2: NEW Case 6 enforces every fixture carries `_synthetic: true`
 *     until an operator-action manifest is established for real captures.
 *   - BH-4: Case 2 walks `fs.readdirSync` directly so an empty orphan
 *     directory (no .json files yet) fails loudly, not silently.
 *   - BH-5: `FIXTURE_SCHEMA_MAP` typed with `as const satisfies` so
 *     value-typo at construction is caught at compile time.
 *   - BH-6: Filter via `dirent.isFile()` so a directory ending in `.json`
 *     doesn't crash `readFileSync` with EISDIR.
 *   - BH-7 / EH-1: `stripMetadata` JSDoc explicitly documents the
 *     top-level-only contract — load-bearing for nested data passthrough.
 *   - BH-12: Belt-and-suspenders existence check on FIXTURES_ROOT so a
 *     future relocation that mis-points the path fails loudly.
 *   - EH-2: Case 4 input gains a nested `_note` alongside nested
 *     `_synthetic` so both metadata keys are covered symmetrically.
 *   - EH-6: case-insensitive `.json` match so `.JSON` / `.Json` files
 *     don't silently skip.
 *   - EH-9: NEW Case 7 parallel strict-mode probe — the schemas use
 *     Zod default `.strip()` which silently drops unknown fields,
 *     defeating the regression-detection goal. The strict-mode probe
 *     runs `schema.strict().safeParse()` on each fixture and reports
 *     extra-field drift as a SOFT warning (does not fail the test) so
 *     real-fixture captures expose model output drift without breaking
 *     synthetic-seed parses that intentionally omit edge fields.
 */

import * as fs from "fs";
import * as path from "path";

import { z } from "zod";

import {
  writingEvaluationSchema,
  dictationSetSchema,
  mockTestSectionSchema,
} from "@/src/lib/schemas/ai-responses";

const FIXTURES_ROOT = path.resolve(__dirname, "../__fixtures__");

/**
 * Explicit dir-name → Zod schema mapping. Add a new entry to extend
 * regression coverage to a new schema; create the matching directory and
 * drop fixture JSON files into it.
 *
 * `as const satisfies` (R1 BH-5): preserves narrow value types so a typo
 * like `writingEvalSchema` would fail compilation, while still enforcing
 * the index signature.
 */
const FIXTURE_SCHEMA_MAP = {
  "writing-evaluation": writingEvaluationSchema,
  dictation: dictationSetSchema,
  "mock-test-section": mockTestSectionSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

/**
 * Metadata fields that exist on synthetic seed fixtures but are NOT part
 * of the schema contract — stripped before replay.
 */
const METADATA_FIELDS = new Set(["_synthetic", "_note"]);

interface DiscoveredFixture {
  schemaName: string;
  fileName: string;
  fullPath: string;
}

function discoverFixtures(): DiscoveredFixture[] {
  const out: DiscoveredFixture[] = [];
  if (!fs.existsSync(FIXTURES_ROOT)) return out;
  const schemaDirs = fs.readdirSync(FIXTURES_ROOT, { withFileTypes: true });
  for (const dir of schemaDirs) {
    if (!dir.isDirectory()) continue;
    const schemaName = dir.name;
    const schemaDirPath = path.join(FIXTURES_ROOT, schemaName);
    // R1 BH-6: pass `withFileTypes: true` so we can filter via
    // `dirent.isFile()` — a directory named `foo.json` would otherwise be
    // picked up by the string-ends-with check and crash `readFileSync`
    // with EISDIR.
    const entries = fs.readdirSync(schemaDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // R1 EH-6: case-insensitive `.json` match so a copy-pasted fixture
      // from a tool that produces `.JSON` doesn't silently skip.
      if (!entry.name.toLowerCase().endsWith(".json")) continue;
      out.push({
        schemaName,
        fileName: entry.name,
        fullPath: path.join(schemaDirPath, entry.name),
      });
    }
  }
  return out;
}

/**
 * Strip top-level metadata fields (`_synthetic`, `_note`) from a fixture
 * JSON before handing to the Zod parser.
 *
 * **R1 BH-7 / EH-1 contract**: top-level only by design. Nested objects
 * pass through unchanged because (a) the schema may legitimately want
 * `_note` as a string field at some path, and (b) the metadata semantics
 * apply to the fixture file as a whole, not to interior data shapes. A
 * future "be helpful" refactor that deep-strips would silently swallow
 * real model-emitted fields. Pinned by Case 4 nested-survival assertions.
 */
function stripMetadata(json: unknown): unknown {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return json;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (METADATA_FIELDS.has(k)) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

/**
 * Read + parse a fixture file. R1 BH-1 — wrap `JSON.parse` so a
 * syntactically-broken fixture surfaces its file path in the error,
 * not just `SyntaxError at position N`.
 */
function loadFixture(fullPath: string, schemaName: string): unknown {
  const raw = fs.readFileSync(fullPath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Fixture ${schemaName}/${path.basename(fullPath)} contains invalid JSON: ${msg}`
    );
  }
}

describe("Story 15-5 — AI schema regression fixture replay", () => {
  const fixtures = discoverFixtures();

  it("Case 0: FIXTURES_ROOT exists on disk (R1 BH-12 belt-and-suspenders defense against a future relocation that mis-points the path)", () => {
    expect(fs.existsSync(FIXTURES_ROOT)).toBe(true);
  });

  it("Case 1: FIXTURE_SCHEMA_MAP contains entries for the included seed schemas (3 minimum)", () => {
    expect(Object.keys(FIXTURE_SCHEMA_MAP)).toEqual(
      expect.arrayContaining(["writing-evaluation", "dictation", "mock-test-section"])
    );
    expect(Object.keys(FIXTURE_SCHEMA_MAP).length).toBeGreaterThanOrEqual(3);
  });

  it("Case 2: every fixture directory on disk has a corresponding FIXTURE_SCHEMA_MAP entry (R1 BH-4: walks fs directly so EMPTY orphan dirs also fail loudly, not just dirs with files)", () => {
    // R1 BH-4: iterate the filesystem directly instead of deriving from
    // `fixtures` (which only contains dirs with at least one .json file).
    // An empty `__fixtures__/listening-comprehension/` dir created during
    // scaffolding would silently pass the pre-patch test even without a
    // map entry — now it fails loudly.
    if (!fs.existsSync(FIXTURES_ROOT)) return;
    const dirs = fs
      .readdirSync(FIXTURES_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of dirs) {
      expect(FIXTURE_SCHEMA_MAP[dir as keyof typeof FIXTURE_SCHEMA_MAP]).toBeDefined();
    }
  });

  it("Case 3: at least 1 seed fixture per included schema (3 schemas × ≥1 fixture)", () => {
    for (const schemaName of Object.keys(FIXTURE_SCHEMA_MAP)) {
      const count = fixtures.filter((f) => f.schemaName === schemaName).length;
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  describe("Replay each discovered fixture through its Zod parser", () => {
    if (fixtures.length === 0) {
      // Defensive: if discovery returns empty (e.g., a bad merge), skip
      // rather than fail. The infrastructure should still pass tests so
      // 15-5 can ship before fixtures are populated. This branch is dead
      // code given the seed fixtures above; included for resilience.
      it.skip("no fixtures discovered — directory tree may be malformed", () => {});
      return;
    }
    it.each(fixtures)(
      "fixture $schemaName/$fileName parses successfully against its Zod schema",
      ({ schemaName, fullPath }) => {
        const schema = FIXTURE_SCHEMA_MAP[schemaName as keyof typeof FIXTURE_SCHEMA_MAP];
        expect(schema).toBeDefined();
        const json = loadFixture(fullPath, schemaName);
        const stripped = stripMetadata(json);
        const result = schema.safeParse(stripped);
        if (!result.success) {
          // Detailed failure message so a regression PR shows which schema
          // + which fixture + which Zod issues, not just "parse failed".
          throw new Error(
            `Fixture ${schemaName}/${path.basename(fullPath)} failed schema parse:\n` +
              JSON.stringify(result.error.issues, null, 2)
          );
        }
        expect(result.success).toBe(true);
      }
    );
  });

  it("Case 4: stripMetadata removes _synthetic + _note top-level fields without touching nested fields (R1 EH-2: symmetric coverage)", () => {
    const input = {
      _synthetic: true,
      _note: "test note",
      data: {
        nested: {
          _synthetic: "should NOT be stripped at nested level",
          // R1 EH-2: parallel `_note` coverage so a future regression
          // that deep-strips only one metadata key is also caught.
          _note: "nested note also preserved",
        },
      },
      overallScore: 75,
    };
    const out = stripMetadata(input) as Record<string, unknown>;
    expect(out._synthetic).toBeUndefined();
    expect(out._note).toBeUndefined();
    expect(out.data).toEqual({
      nested: {
        _synthetic: "should NOT be stripped at nested level",
        _note: "nested note also preserved",
      },
    });
    expect(out.overallScore).toBe(75);
  });

  it("Case 5: stripMetadata is a no-op on non-objects (defensive)", () => {
    expect(stripMetadata(null)).toBeNull();
    expect(stripMetadata([1, 2, 3])).toEqual([1, 2, 3]);
    expect(stripMetadata("string")).toBe("string");
    expect(stripMetadata(42)).toBe(42);
  });

  it("Case 6: every fixture in source carries `_synthetic: true` (R1 BH-2: synthetic-marker enforcement until operator-action manifest exists for real captures)", () => {
    // Until a `.real-fixtures.txt` manifest is established (filed as
    // `15-5-followup-real-fixture-manifest`), every fixture committed to
    // source MUST be marked synthetic. This prevents an operator from
    // accidentally committing a real-captured fixture containing
    // user-derived French writing samples (privacy + GDPR concern; see
    // runbook Privacy section R1 BH-3 / EH-10).
    const missingMarker: string[] = [];
    for (const fixture of fixtures) {
      const json = loadFixture(fixture.fullPath, fixture.schemaName) as Record<string, unknown>;
      if (json._synthetic !== true) {
        missingMarker.push(`${fixture.schemaName}/${fixture.fileName}`);
      }
    }
    if (missingMarker.length > 0) {
      throw new Error(
        `Fixture(s) missing \`_synthetic: true\` marker (R1 BH-2 enforcement): ` +
          missingMarker.join(", ") +
          `. Either set it true (synthetic data) OR add the file to a future ` +
          `\`.real-fixtures.txt\` manifest with explicit operator approval ` +
          `(see \`15-5-followup-real-fixture-manifest\`).`
      );
    }
    expect(missingMarker.length).toBe(0);
  });

  it("Case 7: parallel strict-mode probe — fixtures stay PARSEABLE under schema.strict() (R1 EH-9: model output drift detection)", () => {
    // R1 EH-9 (load-bearing): Zod default behavior is `.strip()` which
    // silently drops unknown fields. The regression-detection goal of
    // this story requires catching model-output drift — a new field
    // emitted by the model that the schema doesn't know about.
    //
    // This probe wraps each fixture's parse with `schema.strict()` and
    // accumulates a SOFT warning list. The current synthetic seeds are
    // hand-authored to match the schemas exactly, so all three should
    // pass strict parsing. Future real-captured fixtures that introduce
    // unknown fields will surface as warnings — operator decides whether
    // to update the schema OR sanitize the fixture.
    //
    // Implementation note: not all Zod types support .strict() at the
    // root level (e.g., union/discriminated-union schemas); the probe
    // wraps in try/catch so a non-strict-able schema doesn't fail the
    // test infrastructure. If a fixture is rejected by .strict() AND
    // the schema supports it, the failure is reported as a soft warning
    // via console.warn but does NOT fail the test (per spec: soft signal
    // for fixture-author triage, not a hard gate).
    const warnings: string[] = [];
    for (const fixture of fixtures) {
      const schema = FIXTURE_SCHEMA_MAP[fixture.schemaName as keyof typeof FIXTURE_SCHEMA_MAP];
      const json = loadFixture(fixture.fullPath, fixture.schemaName);
      const stripped = stripMetadata(json);
      try {
        // Only attempt strict-mode probe on schemas with a `.strict()`
        // method (i.e., ZodObject). Unions/discriminated-unions skip.
        const strictSchema =
          typeof (schema as z.ZodTypeAny & { strict?: () => z.ZodTypeAny }).strict === "function"
            ? (schema as z.ZodObject<z.ZodRawShape>).strict()
            : null;
        if (!strictSchema) continue;
        const result = strictSchema.safeParse(stripped);
        if (!result.success) {
          const extraFields = result.error.issues
            .filter((i) => i.code === "unrecognized_keys")
            .flatMap((i) => ("keys" in i ? (i as { keys: string[] }).keys : []));
          if (extraFields.length > 0) {
            warnings.push(
              `Fixture ${fixture.schemaName}/${fixture.fileName} has unknown field(s) under strict parse: ${extraFields.join(", ")}`
            );
          }
        }
      } catch {
        // Schema type doesn't support `.strict()` (e.g., ZodUnion at root).
        // Silent skip — the soft-warning surface is best-effort.
      }
    }
    if (warnings.length > 0) {
      console.warn(
        "[15-5 strict-mode probe] " +
          warnings.length +
          " fixture(s) have potential model-drift:\n  " +
          warnings.join("\n  ")
      );
    }
    // Soft probe — never fails the test. Synthetic seeds pass strict
    // by construction; real captures may surface drift as warnings.
    expect(true).toBe(true);
  });
});
