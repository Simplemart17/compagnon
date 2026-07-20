/**
 * Story 19-2 — lesson engine wiring drift pins (slice 1: teach → apply).
 *
 * The teach → drill → apply loop's APPLY leg is cross-file plumbing: the
 * player pushes lessonId → the conversation screen steers the session from
 * the scenario → completion persists on user-ended sessions only. These
 * pins hold each link.
 *
 * Drift discipline: comment-stripped source reads (12-2 P12) + paired
 * POSITIVE/NEGATIVE pins (13-2 P11).
 */

import { readFileSync } from "fs";
import { join } from "path";

function readSrc(rel: string): string {
  const raw = readFileSync(join(__dirname, "../../..", rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 19-2 — conversation screen lesson wiring", () => {
  const screen = readSrc("app/(tabs)/conversation/[sessionId].tsx");

  it("lessonId param resolves through the in-repo registry", () => {
    expect(screen).toMatch(/lessonId\?: string/);
    expect(screen).toMatch(/getLesson\(rawLessonId\)/);
  });

  it("promptSeed rides the existing topicDescription channel into the prompt", () => {
    expect(screen).toMatch(/topicDescription: lesson\?\.conversationScenario\.promptSeed/);
  });

  it("goalEn overrides the SessionGoalChip (the 18-6 hook, consumed)", () => {
    const tagStart = screen.indexOf("<SessionGoalChip");
    const openingTag = screen.slice(tagStart, screen.indexOf("/>", tagStart));
    expect(openingTag).toMatch(/goalOverride=\{lesson\?\.conversationScenario\.goalEn\}/);
  });

  it("completion requires a user-ENDED session AND real engagement (guard-shape pin, R1)", () => {
    // R1: the pre-R1 proximity negative (/"disconnected"[\s\S]{0,200}?mark…/)
    // passed by ~6 chars against the LEGITIMATE upstream OR-condition — a
    // benign refactor would false-fail it. Anchor on the guard itself: the
    // completion if-condition must require === "ended" + the engagement
    // gate, and must NOT mention disconnected.
    const guardMatch = screen.match(
      /if \(([^)]*)\)\s*\{\s*void markLessonCompleted\(user\.id, lesson\.id\);/
    );
    expect(guardMatch).not.toBeNull();
    const guard = guardMatch![1];
    expect(guard).toContain('conversation.status === "ended"');
    expect(guard).toContain("userTurns >= 2");
    expect(guard).not.toContain("disconnected");
    // The engagement gate counts USER transcript turns.
    expect(screen).toMatch(
      /conversation\.transcript\.filter\(\(e\) => e\.role === "user"\)\.length/
    );
  });
});

describe("Story 19-2 — player + list + entry surfaces", () => {
  it("the player pushes to the conversation with lessonId + companion mode", () => {
    const player = readSrc("app/(tabs)/practice/lesson/[lessonId].tsx");
    expect(player).toMatch(/getLesson\(rawLessonId\)/);
    expect(player).toMatch(/mode=companion&lessonId=\$\{encodeURIComponent\(lesson\.id\)\}/);
    // The topic pushed is the scenario title (FR content).
    expect(player).toMatch(/encodeURIComponent\([\s\S]{0,40}?conversationScenario\.titleFr/);
  });

  it("the lesson list derives the resume pointer and refetches completion on focus", () => {
    const list = readSrc("app/(tabs)/practice/lessons.tsx");
    // Story 19-3: the pointer became placement-aware — accept the entry-id
    // second argument (the 19-3 drift suite pins its exact shape).
    expect(list).toMatch(/nextLessonForUser\(completedIds,/);
    expect(list).toMatch(/useFocusEffect/);
    expect(list).toMatch(/getCompletedLessonIds\(user\.id\)/);
  });

  it("the practice tab exposes the Lessons entry card", () => {
    const practice = readSrc("app/(tabs)/practice/index.tsx");
    expect(practice).toMatch(/titleEn="Lessons"/);
    expect(practice).toMatch(/practice\/lessons/);
  });
});

describe("Story 19-2 — lesson_progress schema pins", () => {
  const schema = readFileSync(join(__dirname, "../../..", "supabase/companion-schema.sql"), "utf8");

  it("table + uniqueness + cascade + index ship in the consolidated schema file", () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS companion\.lesson_progress/);
    expect(schema).toMatch(/UNIQUE \(user_id, lesson_id\)/);
    expect(schema).toMatch(
      /lesson_progress[\s\S]{0,400}?REFERENCES companion\.profiles\(id\) ON DELETE CASCADE/
    );
    expect(schema).toMatch(/idx_lesson_progress_user/);
  });

  it("R1: the Story 19-2 section is SELF-CONTAINED — table and RLS in ONE contiguous block", () => {
    // R1: the table + RLS originally shipped as two fragments 1100 lines
    // apart inside other stories' sections — an operator running only the
    // found fragment would ship the table WITHOUT RLS while the schema-wide
    // GRANT TO authenticated applies (every user's progress exposed).
    const start = schema.indexOf("CREATE TABLE IF NOT EXISTS companion.lesson_progress");
    const rls = schema.indexOf("ALTER TABLE companion.lesson_progress ENABLE ROW LEVEL SECURITY");
    expect(start).toBeGreaterThan(-1);
    expect(rls).toBeGreaterThan(start);
    // Contiguous: RLS follows the table within the same section (< 1200
    // chars — the block itself), not half a file away.
    expect(rls - start).toBeLessThan(1200);
    // Exactly one Story 19-2 section header exists (single operator target).
    expect(schema.match(/Story 19-2 \(2026-07-19\)/g)).toHaveLength(1);
  });

  it("RLS: enabled + select/insert/delete policies on auth.uid() = user_id", () => {
    expect(schema).toMatch(/ALTER TABLE companion\.lesson_progress ENABLE ROW LEVEL SECURITY/);
    for (const verb of ["view", "insert", "delete"]) {
      expect(schema).toContain(`"Users can ${verb} own lesson progress"`);
    }
  });
});
