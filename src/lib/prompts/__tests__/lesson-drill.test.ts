/**
 * Story 19-2 (drill slice) — lesson-drill prompt content pins.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { getLesson } from "@/src/lib/curriculum";
import { buildLessonDrillPrompt } from "@/src/lib/prompts/lesson-drill";

const LESSON = getLesson("a1-u2-l4")!; // adjective agreement — a rich drill target

describe("Story 19-2 — buildLessonDrillPrompt", () => {
  const prompt = buildLessonDrillPrompt(LESSON);

  it("scopes the drill to the lesson's grammar target + full vocabulary list", () => {
    expect(prompt).toContain(LESSON.grammarTarget);
    for (const item of LESSON.vocab) {
      expect(prompt).toContain(item.fr);
    }
  });

  it("enforces the sequencing discipline on generated content (lesson-vocab-only stems)", () => {
    expect(prompt).toContain("the ONLY content words you may use");
    expect(prompt).toMatch(/Do NOT use any French content word outside the lesson vocabulary/);
  });

  it("chrome/content split: French stems + options, ENGLISH explanations (14-1 + 18-1 A1 comprehension)", () => {
    expect(prompt).toMatch(/stems and all 4 options are in FRENCH/);
    expect(prompt).toMatch(/explanation is 1-2 sentences in ENGLISH/);
  });

  it("pins the schema contract: exactly 3 questions, 4 options, 1 correct, plausible-error distractors", () => {
    expect(prompt).toContain("EXACTLY 3 multiple-choice questions");
    expect(prompt).toContain(
      "Exactly 3 questions. Exactly 4 options each. Exactly 1 correct option"
    );
    expect(prompt).toMatch(/Distractors must be plausible A1 errors/);
  });
});

describe("Story 19-2 — player drill integration drift pins", () => {
  function readSrc(rel: string): string {
    const raw = readFileSync(join(__dirname, "../../../..", rel), "utf8");
    return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("the lesson player mounts the drill BETWEEN the vocabulary card and the apply CTA", () => {
    const player = readSrc("app/(tabs)/practice/lesson/[lessonId].tsx");
    expect(player).toMatch(/useLessonDrill\(lesson\)/);
    const vocabIdx = player.indexOf("Vocabulary (");
    const drillIdx = player.indexOf("Quick drill");
    const ctaIdx = player.indexOf("Practice in conversation");
    expect(vocabIdx).toBeGreaterThan(-1);
    expect(drillIdx).toBeGreaterThan(vocabIdx);
    expect(ctaIdx).toBeGreaterThan(drillIdx);
    // Reuses the existing MCQ renderer, not a bespoke option list.
    expect(player).toMatch(/<MCQCard/);
  });

  it("the drill is practice-only: the hook writes NO skill progress and NO exercises rows", () => {
    const hook = readSrc("src/hooks/use-lesson-drill.ts");
    expect(hook).not.toContain("updateSkillProgress");
    expect(hook).not.toContain("supabase");
    expect(hook).toContain('feature: "lesson-drill"');
  });
});
