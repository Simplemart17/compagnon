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

  it("fetches completed lessons as a BARE (uncached) settled slot and derives the placement-aware pointer", () => {
    // Anchored as a bare array element inside Promise.allSettled — a future
    // "perf" pass wrapping it in cacheWithFallback would re-introduce the
    // stale-pointer bug the design note names (review R1).
    expect(briefing).toMatch(
      /Promise\.allSettled\(\[[\s\S]*?,\s*getCompletedLessonIds\(userId\),?\s*\]\)/
    );
    expect(briefing).not.toMatch(/\(\)\s*=>\s*getCompletedLessonIds/);
    expect(briefing).toMatch(/nextLessonForUser\(completedLessons,\s*entryLessonId\)/);
    // The ASSIGNMENT is pinned (not just call existence) so a hardcoded
    // entry + dead reference elsewhere can't satisfy the pins (review R1).
    expect(briefing).toMatch(
      /const entryLessonId = entryLessonIdForLevel\(profile\?\.current_cefr_level\)/
    );
  });

  it("maps the pointer's ENGLISH can-do into the plan (a canDoFr slip type-checks — review R1)", () => {
    expect(briefing).toMatch(
      /nextLesson:\s*pointer\s*\?\s*\{\s*id:\s*pointer\.id,\s*canDoEn:\s*pointer\.canDoEn\s*\}\s*:\s*null/
    );
    expect(briefing).not.toContain("pointer.canDoFr");
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
    // Fail-LOUD window extraction (12-8 R2-P3 / 13-1 P7 walker convention —
    // a -1 from indexOf must throw, not silently unscope the window).
    const headerStart = picker.indexOf("ListHeaderComponent=");
    const headerEnd = picker.indexOf("contentContainerStyle", headerStart);
    if (headerStart === -1 || headerEnd === -1) {
      throw new Error(
        "Stale drift anchors: ListHeaderComponent/contentContainerStyle not found in the picker — re-anchor this window"
      );
    }
    const header = picker.slice(headerStart, headerEnd);
    expect(header).toMatch(/\/\(tabs\)\/practice\/lesson\/\$\{continueLesson\.id\}/);
    // Guard-shape anchoring (19-2 R1-P4): EVERY navigation call inside the
    // header must target the lesson player — a group-less "/conversation/…"
    // push would evade a literal ban alone. Routes are extracted from the
    // template-literal argument (a bare `\)` matcher stops at the paren
    // inside "/(tabs)" — the exact trap this regex avoids); object-form
    // pushes are covered by the substring NEGATIVE below.
    const navRoutes = [...header.matchAll(/router\.(?:push|navigate|replace)\(\s*`([^`]*)`/g)].map(
      (m) => m[1]
    );
    expect(navRoutes.length).toBeGreaterThan(0);
    for (const route of navRoutes) {
      expect(route).toContain("/practice/lesson/");
    }
    // NEGATIVE: no conversation route in any form (the group-qualified
    // literal contains this substring too).
    expect(header).not.toContain("/conversation/");
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
