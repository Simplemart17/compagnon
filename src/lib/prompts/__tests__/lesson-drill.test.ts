/**
 * Story 19-2 (drill slice) — lesson-drill prompt content pins.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { getLesson, getUnitForLesson } from "@/src/lib/curriculum";
import { buildLessonDrillPrompt, MAX_EARLIER_VOCAB_ITEMS } from "@/src/lib/prompts/lesson-drill";

// Review R1: fail fast on a stale fixture id — a content re-org must fail
// with THIS message, not a TypeError deep inside the prompt builder.
const FIXTURE_ID = "a1-u2-l4"; // adjective agreement — a rich drill target
const maybeLesson = getLesson(FIXTURE_ID);
if (!maybeLesson) {
  throw new Error(`Stale test fixture: curriculum lesson "${FIXTURE_ID}" no longer exists`);
}
const LESSON = maybeLesson;
const UNIT = getUnitForLesson(LESSON.id);
if (!UNIT) {
  throw new Error(`Stale test fixture: no unit found for lesson "${FIXTURE_ID}"`);
}
// Same derivation the hook performs: everything taught EARLIER in the unit.
const EARLIER_VOCAB = UNIT.lessons
  .filter((l) => l.order < LESSON.order)
  .flatMap((l) => l.vocab.map((v) => v.fr));

describe("Story 19-2 — buildLessonDrillPrompt", () => {
  const prompt = buildLessonDrillPrompt(LESSON, "A1", EARLIER_VOCAB);

  it("scopes the drill to the lesson's grammar target + full vocabulary list", () => {
    expect(prompt).toContain(LESSON.grammarTarget);
    for (const item of LESSON.vocab) {
      expect(prompt).toContain(item.fr);
    }
  });

  it("sequencing discipline: lesson vocab + PREVIOUSLY TAUGHT words only (review R1 affordance)", () => {
    // The earlier-vocab affordance is load-bearing: a lesson-vocab-ONLY
    // rule is impossible for sparse lessons (agreement drills need
    // subject nouns from earlier lessons).
    expect(prompt).toContain("Previously taught words you may ALSO use");
    expect(EARLIER_VOCAB.length).toBeGreaterThan(0);
    expect(prompt).toContain(EARLIER_VOCAB[0]);
    expect(prompt).toMatch(
      /Do NOT use any French content word outside the lesson vocabulary and the previously-taught list/
    );
  });

  it("omits the earlier-vocab line for a unit's FIRST lesson (nothing taught earlier)", () => {
    const first = buildLessonDrillPrompt(LESSON, "A1", []);
    expect(first).not.toContain("Previously taught words you may ALSO use");
  });

  it("caps the injected earlier-vocab list (bounded-budget discipline)", () => {
    const oversized = Array.from({ length: MAX_EARLIER_VOCAB_ITEMS + 10 }, (_, i) => `mot${i}`);
    const capped = buildLessonDrillPrompt(LESSON, "A1", oversized);
    expect(capped).toContain(`mot${MAX_EARLIER_VOCAB_ITEMS - 1}`);
    expect(capped).not.toContain(`mot${MAX_EARLIER_VOCAB_ITEMS}`);
  });

  it("derives difficulty from the passed CEFR level — never a hardcoded A1 (review R1)", () => {
    expect(prompt).toContain("an A1 curriculum lesson");
    expect(prompt).toMatch(/Distractors must be plausible A1 errors/);
    const a2 = buildLessonDrillPrompt(LESSON, "A2", EARLIER_VOCAB);
    expect(a2).toContain("an A2 curriculum lesson");
    expect(a2).toMatch(/Distractors must be plausible A2 errors/);
    expect(a2).not.toContain("an A1 curriculum lesson");
  });

  it("chrome/content split: French stems + options, ENGLISH explanations (14-1 + 18-1 A1 comprehension)", () => {
    expect(prompt).toMatch(/stems and all 4 options are in FRENCH/);
    expect(prompt).toMatch(/explanation is 1-2 sentences in ENGLISH/);
  });

  it("forbids semantically-valid distractors: incorrect options must be UNGRAMMATICAL in context (review R1)", () => {
    // The highest-damage A1 failure: a learner picks correct French and
    // gets marked wrong. The schema only enforces the isCorrect FLAG, so
    // exclusivity must be a prompt rule.
    expect(prompt).toContain("UNGRAMMATICAL or clearly wrong in the exact context of the stem");
    expect(prompt).toContain("pins the intended answer");
  });

  it("pins the schema contract: exactly 3 questions, 4 options, 1 correct + randomized correct position", () => {
    expect(prompt).toContain("EXACTLY 3 multiple-choice questions");
    expect(prompt).toContain(
      "Exactly 3 questions. Exactly 4 options each. Exactly 1 correct option"
    );
    // Review R1: the JSON example marks "b" correct — without this rule the
    // example anchors gpt-4o toward position b on every question.
    expect(prompt).toContain('RANDOMIZE which option id ("a", "b", "c" or "d") is correct');
    expect(prompt).toContain('the example above marking "b" is arbitrary');
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

  it("the drill is practice-only: no skill progress, no exercises rows, no lesson completion", () => {
    const hook = readSrc("src/hooks/use-lesson-drill.ts");
    expect(hook).not.toContain("updateSkillProgress");
    expect(hook).not.toContain("supabase");
    // Review R1: the third door — the apply (conversation) step owns lesson
    // completion; a drill finish must never mark the lesson complete.
    expect(hook).not.toContain("markLessonCompleted");
    expect(hook).not.toContain("lesson-progress");
    expect(hook).toContain('feature: "lesson-drill"');
  });
});
