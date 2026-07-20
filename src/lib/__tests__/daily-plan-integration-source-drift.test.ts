/**
 * Story 19-3 — placement + daily-plan integration drift pins.
 *
 * Pins the three consumer wirings of the placement-aware resume pointer
 * (daily briefing, lessons list, conversation picker) + the placement
 * results' curriculum-position card. Comment-stripped source reads per
 * the Story 12-2 P12 pattern.
 */

import { readFileSync } from "fs";
import { join } from "path";

function readSrc(rel: string): string {
  const raw = readFileSync(join(__dirname, "../../..", rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 19-3 — daily briefing pulls the next lesson", () => {
  const briefing = readSrc("src/hooks/use-daily-briefing.ts");

  it("fetches completed lessons as a third settled slot and derives the placement-aware pointer", () => {
    expect(briefing).toContain("getCompletedLessonIds(userId)");
    expect(briefing).toMatch(/nextLessonForUser\(completedLessons,\s*entryLessonId\)/);
    expect(briefing).toMatch(/entryLessonIdForLevel\(profile\?\.current_cefr_level\)/);
  });

  it("refresh re-derives when the profile level hydrates (deps include current_cefr_level)", () => {
    expect(briefing).toMatch(/\[user,\s*profile\?\.full_name,\s*profile\?\.current_cefr_level\]/);
  });

  it("the plan's lesson item routes to the lesson player", () => {
    expect(briefing).toMatch(/\/\(tabs\)\/practice\/lesson\/\$\{data\.nextLesson\.id\}/);
  });
});

describe("Story 19-3 — lessons list resume pointer is placement-aware", () => {
  const lessons = readSrc("app/(tabs)/practice/lessons.tsx");

  it("passes the entry lesson id derived from the UNCOERCED profile level (18-2 R1-P3)", () => {
    expect(lessons).toMatch(
      /nextLessonForUser\(completedIds,\s*entryLessonIdForLevel\(profile\?\.current_cefr_level\)\)/
    );
    // NEGATIVE: the pre-19-3 one-arg call is gone, and no `?? "A1"` coercion
    // sneaks a wrong entry in during profile hydration.
    expect(lessons).not.toMatch(/nextLessonForUser\(completedIds\)/);
    expect(lessons).not.toMatch(/current_cefr_level\s*\?\?\s*"A1"/);
  });
});

describe("Story 19-3 — conversation picker 'Continue my lesson' default", () => {
  const picker = readSrc("app/(tabs)/conversation/index.tsx");

  it("fetches completion on focus and derives the pointer with the placement entry", () => {
    expect(picker).toContain("getCompletedLessonIds(user.id)");
    expect(picker).toMatch(
      /nextLessonForUser\(completedIds,\s*entryLessonIdForLevel\(profile\?\.current_cefr_level\)\)/
    );
  });

  it("renders the default as the list header and routes to the lesson PLAYER (teach → drill → apply intact)", () => {
    expect(picker).toContain("ListHeaderComponent=");
    expect(picker).toContain("Continue my lesson");
    const headerStart = picker.indexOf("ListHeaderComponent=");
    const headerEnd = picker.indexOf("contentContainerStyle", headerStart);
    const header = picker.slice(headerStart, headerEnd);
    expect(header).toMatch(/\/\(tabs\)\/practice\/lesson\/\$\{continueLesson\.id\}/);
    // NEGATIVE: the header card must not shortcut straight into a
    // conversation route — the player owns the lesson flow.
    expect(header).not.toContain("/(tabs)/conversation/");
  });

  it("holds until the first completion fetch settles (19-2 R1-P7 no-flash rule)", () => {
    expect(picker).toMatch(/completedIds\s*!==\s*null/);
  });
});

describe("Story 19-3 — placement results show the curriculum starting point", () => {
  const placement = readSrc("app/onboarding/placement-test.tsx");

  it("maps the determined level to an entry lesson and renders it", () => {
    expect(placement).toMatch(/entryLessonForLevel\(determinedLevel\)/);
    expect(placement).toContain("YOUR STARTING POINT");
    expect(placement).toMatch(/\{entryUnit\.titleEn\}/);
    expect(placement).toMatch(/\{entryLesson\.canDoEn\}/);
  });
});
