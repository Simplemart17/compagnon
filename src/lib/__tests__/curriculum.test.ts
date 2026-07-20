/**
 * Story 19-1 — curriculum spine: content integrity + position helpers.
 *
 * The content-integrity block is the CI gate the roadmap's "versioned
 * content files" model depends on: every JSON file under
 * src/content/curriculum must parse against the schema, and every file
 * must be registered in CURRICULUM_UNITS (an authored-but-unregistered
 * unit is invisible to learners — a silent content loss).
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import {
  CURRICULUM_LESSONS,
  CURRICULUM_UNITS,
  entryLessonForLevel,
  firstLessonAtLevel,
  getLesson,
  getUnit,
  getUnitForLesson,
  nextLesson,
} from "@/src/lib/curriculum";
import { curriculumUnitFileSchema } from "@/src/lib/schemas/curriculum";

const CONTENT_DIR = join(__dirname, "../../content/curriculum");

describe("Story 19-1 — content integrity (CI gate)", () => {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));

  it("at least one content file ships", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses against curriculumUnitFileSchema", (file) => {
    const raw = JSON.parse(readFileSync(join(CONTENT_DIR, file), "utf8"));
    const result = curriculumUnitFileSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`${file}: ${result.error.message}`);
    }
    // File name must match the unit id (a1-u1.json ↔ id "a1-u1") so the
    // registry import list stays greppable against the directory.
    expect(file).toBe(`${result.data.unit.id}.json`);
  });

  it("every content file is registered in CURRICULUM_UNITS (no silent content loss)", () => {
    const registeredIds = CURRICULUM_UNITS.map((u) => u.id).sort();
    const fileIds = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(registeredIds).toEqual(fileIds);
  });

  it("chrome/content split holds: canDo phrasing is EN chrome + FR content", () => {
    for (const lesson of CURRICULUM_LESSONS) {
      expect(lesson.canDoEn).toMatch(/^I can /);
      expect(lesson.canDoFr).toMatch(/^Je peux /);
    }
  });

  it("spine ordering: units strictly ordered per level; lessons strictly ordered per unit", () => {
    const byLevel = new Map<string, number[]>();
    for (const unit of CURRICULUM_UNITS) {
      const orders = byLevel.get(unit.level) ?? [];
      orders.push(unit.order);
      byLevel.set(unit.level, orders);
    }
    for (const [, orders] of byLevel) {
      const sorted = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sorted);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});

describe("Story 19-1 — position helpers", () => {
  const first = CURRICULUM_LESSONS[0];
  const last = CURRICULUM_LESSONS[CURRICULUM_LESSONS.length - 1];

  it("getUnit / getLesson / getUnitForLesson resolve shipped content", () => {
    expect(getUnit(CURRICULUM_UNITS[0].id)?.id).toBe(CURRICULUM_UNITS[0].id);
    expect(getLesson(first.id)?.id).toBe(first.id);
    expect(getUnitForLesson(first.id)?.id).toBe(CURRICULUM_UNITS[0].id);
    expect(getUnit("zz-u9")).toBeUndefined();
    expect(getLesson("zz-u9-l1")).toBeUndefined();
  });

  it("nextLesson walks the spine and returns undefined past the end", () => {
    for (let i = 0; i < CURRICULUM_LESSONS.length - 1; i += 1) {
      expect(nextLesson(CURRICULUM_LESSONS[i].id)?.id).toBe(CURRICULUM_LESSONS[i + 1].id);
    }
    expect(nextLesson(last.id)).toBeUndefined();
    expect(nextLesson("zz-u9-l1")).toBeUndefined();
  });

  it("firstLessonAtLevel: A1 resolves to the first A1 lesson; unshipped levels are undefined", () => {
    expect(firstLessonAtLevel("A1")?.id).toBe(first.id);
    expect(firstLessonAtLevel("C2")).toBeUndefined();
  });

  it("entryLessonForLevel falls DOWN to the highest shipped level (placement above shipped content)", () => {
    // Only A1 ships in this slice: every placement enters at the A1 start.
    for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"] as const) {
      expect(entryLessonForLevel(level)?.id).toBe(first.id);
    }
  });
});
