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
 * `import` line).
 *
 * `_synthetic: true` marker on seed fixtures distinguishes them from
 * operator-captured real model outputs. The replay logic strips the
 * `_synthetic` + `_note` top-level fields BEFORE handing to the parser
 * (those are metadata; not part of the schema contract).
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
 */
const FIXTURE_SCHEMA_MAP: Record<string, z.ZodTypeAny> = {
  "writing-evaluation": writingEvaluationSchema,
  dictation: dictationSetSchema,
  "mock-test-section": mockTestSectionSchema,
};

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
    const files = fs.readdirSync(schemaDirPath);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      out.push({
        schemaName,
        fileName: file,
        fullPath: path.join(schemaDirPath, file),
      });
    }
  }
  return out;
}

function stripMetadata(json: unknown): unknown {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return json;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (METADATA_FIELDS.has(k)) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

describe("Story 15-5 — AI schema regression fixture replay", () => {
  const fixtures = discoverFixtures();

  it("Case 1: FIXTURE_SCHEMA_MAP contains entries for the included seed schemas (3 minimum)", () => {
    expect(Object.keys(FIXTURE_SCHEMA_MAP)).toEqual(
      expect.arrayContaining(["writing-evaluation", "dictation", "mock-test-section"])
    );
    expect(Object.keys(FIXTURE_SCHEMA_MAP).length).toBeGreaterThanOrEqual(3);
  });

  it("Case 2: every fixture directory has a corresponding FIXTURE_SCHEMA_MAP entry (no orphan dirs)", () => {
    const discoveredDirs = new Set(fixtures.map((f) => f.schemaName));
    for (const dir of discoveredDirs) {
      expect(FIXTURE_SCHEMA_MAP[dir]).toBeDefined();
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
        const schema = FIXTURE_SCHEMA_MAP[schemaName];
        expect(schema).toBeDefined();
        const raw = fs.readFileSync(fullPath, "utf-8");
        const json = JSON.parse(raw);
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

  it("Case 4: stripMetadata removes _synthetic + _note top-level fields without touching nested fields", () => {
    const input = {
      _synthetic: true,
      _note: "test note",
      data: { nested: { _synthetic: "should NOT be stripped at nested level" } },
      overallScore: 75,
    };
    const out = stripMetadata(input) as Record<string, unknown>;
    expect(out._synthetic).toBeUndefined();
    expect(out._note).toBeUndefined();
    expect(out.data).toEqual({
      nested: { _synthetic: "should NOT be stripped at nested level" },
    });
    expect(out.overallScore).toBe(75);
  });

  it("Case 5: stripMetadata is a no-op on non-objects (defensive)", () => {
    expect(stripMetadata(null)).toBeNull();
    expect(stripMetadata([1, 2, 3])).toEqual([1, 2, 3]);
    expect(stripMetadata("string")).toBe("string");
    expect(stripMetadata(42)).toBe(42);
  });
});
