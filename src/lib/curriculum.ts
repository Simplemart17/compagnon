/**
 * Curriculum spine registry + position helpers — Story 19-1.
 *
 * The registry is the SINGLE list of shipped units in pedagogical order.
 * Content files are statically imported (Metro bundles JSON; no runtime
 * I/O, no async, works offline) and validated ONCE at module init — a
 * malformed file throws at import time in dev/test, and the CI content
 * test fails before that can ever ship.
 *
 * Review R1 note: the throw ships in PRODUCTION bundles too once 19.2
 * wires a screen to this registry — the guard is the CI test, not the
 * environment. curriculum.test.ts is therefore a REQUIRED gate for ANY
 * pipeline that can publish JS (including manual OTA); the 19.2 wire-up
 * review must re-evaluate throw-at-import vs safeParse-with-empty-registry
 * before the first screen consumer lands.
 *
 * Position model (consumed by 19.2's lesson engine + 19.3's daily plan):
 * a learner's curriculum position is simply a lesson id; `nextLesson`
 * walks lesson order within a unit, then unit order within the spine.
 * Persistence of the position is 19.2 scope (lesson state row), NOT here.
 */

import a1Unit1Json from "@/src/content/curriculum/a1-u1.json";
import a1Unit2Json from "@/src/content/curriculum/a1-u2.json";
import a1Unit3Json from "@/src/content/curriculum/a1-u3.json";
import a1Unit4Json from "@/src/content/curriculum/a1-u4.json";
import a1Unit5Json from "@/src/content/curriculum/a1-u5.json";
import a1Unit6Json from "@/src/content/curriculum/a1-u6.json";
import a2Unit1Json from "@/src/content/curriculum/a2-u1.json";
import a2Unit2Json from "@/src/content/curriculum/a2-u2.json";
import a2Unit3Json from "@/src/content/curriculum/a2-u3.json";
import a2Unit4Json from "@/src/content/curriculum/a2-u4.json";
import a2Unit5Json from "@/src/content/curriculum/a2-u5.json";
import a2Unit6Json from "@/src/content/curriculum/a2-u6.json";
import {
  type CurriculumLesson,
  type CurriculumUnit,
  curriculumUnitFileSchema,
} from "@/src/lib/schemas/curriculum";
import { CEFR_ORDER, type CEFRLevel } from "@/src/types/cefr";

function parseUnitFile(raw: unknown, sourceName: string): CurriculumUnit {
  const result = curriculumUnitFileSchema.safeParse(raw);
  if (!result.success) {
    // Content is in-repo — a parse failure is a BUILD defect, not a
    // runtime condition to degrade around. Fail loudly.
    throw new Error(
      `Curriculum content file ${sourceName} failed validation: ${result.error.message}`
    );
  }
  return result.data.unit;
}

/**
 * All shipped units in pedagogical order. Adding a unit = add the JSON
 * file + one import + one entry here (the content-integrity test walks
 * this list).
 */
export const CURRICULUM_UNITS: readonly CurriculumUnit[] = [
  parseUnitFile(a1Unit1Json, "a1-u1.json"),
  parseUnitFile(a1Unit2Json, "a1-u2.json"),
  parseUnitFile(a1Unit3Json, "a1-u3.json"),
  parseUnitFile(a1Unit4Json, "a1-u4.json"),
  parseUnitFile(a1Unit5Json, "a1-u5.json"),
  parseUnitFile(a1Unit6Json, "a1-u6.json"),
  parseUnitFile(a2Unit1Json, "a2-u1.json"),
  parseUnitFile(a2Unit2Json, "a2-u2.json"),
  parseUnitFile(a2Unit3Json, "a2-u3.json"),
  parseUnitFile(a2Unit4Json, "a2-u4.json"),
  parseUnitFile(a2Unit5Json, "a2-u5.json"),
  parseUnitFile(a2Unit6Json, "a2-u6.json"),
];

/** Flat lesson list in spine order — the canonical traversal. */
export const CURRICULUM_LESSONS: readonly CurriculumLesson[] = CURRICULUM_UNITS.flatMap((unit) =>
  [...unit.lessons].sort((a, b) => a.order - b.order)
);

export function getUnit(unitId: string): CurriculumUnit | undefined {
  return CURRICULUM_UNITS.find((u) => u.id === unitId);
}

export function getLesson(lessonId: string): CurriculumLesson | undefined {
  return CURRICULUM_LESSONS.find((l) => l.id === lessonId);
}

/** The unit a lesson belongs to (lesson ids extend unit ids by schema). */
export function getUnitForLesson(lessonId: string): CurriculumUnit | undefined {
  return CURRICULUM_UNITS.find((u) => u.lessons.some((l) => l.id === lessonId));
}

/**
 * The lesson after `lessonId` in spine order, or undefined at the end of
 * shipped content ("you're ahead of the curriculum — free practice").
 */
export function nextLesson(lessonId: string): CurriculumLesson | undefined {
  const idx = CURRICULUM_LESSONS.findIndex((l) => l.id === lessonId);
  if (idx === -1) return undefined;
  return CURRICULUM_LESSONS[idx + 1];
}

/** First lesson of the first shipped unit at a level, if any. */
export function firstLessonAtLevel(level: CEFRLevel): CurriculumLesson | undefined {
  const unit = CURRICULUM_UNITS.find((u) => u.level === level);
  return unit ? [...unit.lessons].sort((a, b) => a.order - b.order)[0] : undefined;
}

/**
 * Entry position for a placement result (19.3 hook): the first lesson at
 * the placed level, falling back DOWN the shipped levels (a C1 placement
 * with only A1-B2 shipped enters at the highest shipped level's start),
 * then to the very first lesson.
 */
export function entryLessonForLevel(level: CEFRLevel): CurriculumLesson | undefined {
  const levelIdx = CEFR_ORDER.indexOf(level);
  for (let i = levelIdx; i >= 0; i -= 1) {
    const lesson = firstLessonAtLevel(CEFR_ORDER[i]);
    if (lesson) return lesson;
  }
  return CURRICULUM_LESSONS[0];
}
