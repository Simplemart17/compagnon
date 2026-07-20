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
import { curriculumUnitFileSchema, normalizeVocabKey } from "@/src/lib/schemas/curriculum";

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

  it("spine totals are pinned (review R1 — the directory-walk let the prose vocab count drift)", () => {
    // Slice 5: A1 (309) + A2 complete (122 + 109 = 231) = 540 across 12
    // units / 60 lessons. The aggregate is a tripwire so the CLAUDE.md/
    // roadmap count can never silently diverge from the shipped content.
    expect(CURRICULUM_UNITS).toHaveLength(12);
    expect(CURRICULUM_LESSONS).toHaveLength(60);
    const totalVocab = CURRICULUM_LESSONS.reduce((n, l) => n + l.vocab.length, 0);
    expect(totalVocab).toBe(540);
  });

  it("no vocab item is introduced in two different UNITS (cross-unit dedup — the schema only sees one file)", () => {
    // Recycling happens in scenarios and teach text; re-LISTING a word in a
    // later unit's vocab wastes a flashcard slot and double-drills the SRS.
    // The schema's superRefine dedups WITHIN a unit; only this registry
    // test can see across files. Keys via the SHARED production normalizer.
    //
    // R2 (slice 3): compound "x / y" alternate entries are SPLIT before
    // keying — pre-R2 'le parc / le jardin' would have evaded the guard
    // while re-listing the taught 'le parc'.
    const ALLOWED_CROSS_UNIT_REINTRODUCTIONS = new Set([
      // U3-L4 teaches faire du/de la (activity marker); U4-L1 deliberately
      // re-teaches du/de la as the PARTITIVE and its teachEn explicitly
      // disambiguates the two — an intentional, documented re-introduction.
      "du",
      "de la",
    ]);
    const seen = new Map<string, string>();
    for (const unit of CURRICULUM_UNITS) {
      for (const lesson of unit.lessons) {
        for (const item of lesson.vocab) {
          for (const part of item.fr.split(" / ")) {
            const key = normalizeVocabKey(part);
            if (key.length === 0 || ALLOWED_CROSS_UNIT_REINTRODUCTIONS.has(key)) continue;
            const firstIn = seen.get(key);
            if (firstIn !== undefined && !firstIn.startsWith(`${unit.id}-l`)) {
              throw new Error(
                `vocab "${part}" (in "${item.fr}", ${lesson.id}) was already introduced in ${firstIn}`
              );
            }
            if (firstIn === undefined) seen.set(key, lesson.id);
          }
        }
      }
    }
  });

  it("chrome/content split holds: canDo phrasing is EN chrome + FR content", () => {
    for (const lesson of CURRICULUM_LESSONS) {
      expect(lesson.canDoEn).toMatch(/^I can /);
      expect(lesson.canDoFr).toMatch(/^Je peux /);
    }
  });

  it("spine ordering: registry sequence strictly increasing in (CEFR level, unit order) — R1", () => {
    // Review R1: the pre-R1 case grouped orders BY LEVEL, so cross-level
    // interleaving ([a1-u1, a2-u1, a1-u2]) passed while nextLesson walked
    // learners A1 → A2 → back into A1. Registry order IS the traversal.
    const CEFR_INDEX: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };
    for (let i = 1; i < CURRICULUM_UNITS.length; i += 1) {
      const prev = CURRICULUM_UNITS[i - 1];
      const curr = CURRICULUM_UNITS[i];
      const prevKey = CEFR_INDEX[prev.level] * 100 + prev.order;
      const currKey = CEFR_INDEX[curr.level] * 100 + curr.order;
      expect(currKey).toBeGreaterThan(prevKey);
    }
    // Per-level unit orders must be contiguous from 1 (no gaps a learner
    // would fall into).
    const byLevel = new Map<string, number[]>();
    for (const unit of CURRICULUM_UNITS) {
      byLevel.set(unit.level, [...(byLevel.get(unit.level) ?? []), unit.order]);
    }
    for (const [, orders] of byLevel) {
      expect(orders).toEqual(Array.from({ length: orders.length }, (_, i) => i + 1));
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

  it("firstLessonAtLevel: A1/A2 resolve to their level's first lesson by order; unshipped levels are undefined", () => {
    expect(firstLessonAtLevel("A1")?.id).toBe(first.id);
    // Slice 4: A2 is a shipped level — pin its start directly (previously
    // covered only transitively via entryLessonForLevel). Review R1.
    expect(firstLessonAtLevel("A2")?.id).toBe("a2-u1-l1");
    expect(firstLessonAtLevel("C2")).toBeUndefined();
  });

  it("entryLessonForLevel falls DOWN to the highest shipped level (placement above shipped content)", () => {
    // Slice 4: A1 + A2 ship. A1 enters at the A1 start; A2 enters at the
    // A2 start; B1+ falls DOWN to A2 (the highest shipped level).
    expect(entryLessonForLevel("A1")?.id).toBe(first.id);
    for (const level of ["A2", "B1", "B2", "C1", "C2"] as const) {
      expect(entryLessonForLevel(level)?.id).toBe("a2-u1-l1");
    }
  });
});
