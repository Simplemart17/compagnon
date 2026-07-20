/**
 * Curriculum content schema — Story 19-1 (v2-vision-roadmap Epic 19).
 *
 * The curriculum spine is VERSIONED IN-REPO CONTENT (roadmap 19.1): JSON
 * unit files under `src/content/curriculum/` validated against this schema
 * by a CI test, so malformed content fails the build — never the runtime.
 * Scope decision D-C1: A1→B2 deep first; C1-C2 ship later as advanced
 * tracks.
 *
 * Chrome/content split (Story 14-1): `*En` fields are EN chrome the
 * learner reads AROUND the learning; `*Fr` fields + vocab.fr are French
 * learning content.
 *
 * Epic 19.2 consumers (the lesson engine): `teachEn`/`teachFr` feed the
 * teach step; `vocab` feeds the drill step; `conversationScenario` feeds
 * the apply-in-conversation step — `goalEn` goes to SessionGoalChip's
 * `goalOverride` (Story 18-6 hook) and `promptSeed` steers the buddy
 * session (the loop no competitor closes well).
 */

import { z } from "zod";

import { cefrLevelSchema } from "@/src/lib/schemas/ai-responses";

/** One vocabulary item — FR word/phrase + EN gloss. */
export const curriculumVocabItemSchema = z.object({
  fr: z.string().min(1).max(60),
  en: z.string().min(1).max(80),
});

export const curriculumScenarioSchema = z.object({
  /** FR scenario title the learner sees (content, not chrome). */
  titleFr: z.string().min(1).max(80),
  /** One-line session goal — EN chrome; feeds SessionGoalChip.goalOverride. */
  goalEn: z.string().min(1).max(120),
  /**
   * EN instructions for the AI conversation partner (how to run the
   * role-play, what to elicit, what to recycle). Injected into the
   * conversation prompt by the 19.2 lesson engine — length-capped so the
   * Story 11-7 prompt-budget discipline holds.
   */
  promptSeed: z.string().min(40).max(600),
});

export const curriculumLessonSchema = z.object({
  /** Stable id: `{level}-u{unit}-l{lesson}` (e.g. "a1-u1-l3"). */
  id: z.string().regex(/^[abc][12]-u\d{1,2}-l\d{1,2}$/),
  /** 1-based position within the unit. */
  order: z.number().int().min(1).max(20),
  /** CEFR can-do outcome — EN chrome, learner-facing. */
  canDoEn: z.string().min(10).max(160),
  /** The same outcome in A-level-comprehensible French. */
  canDoFr: z.string().min(10).max(160),
  /** One precise grammar point — EN chrome. */
  grammarTarget: z.string().min(5).max(160),
  /** Teach-step explanation, EN with inline FR examples (3-5 sentences). */
  teachEn: z.string().min(80).max(1200),
  /** Simple-French version of the teach step (level-readable). */
  teachFr: z.string().min(40).max(800),
  /** 8-12 new items per lesson; recycling happens in scenarios. */
  vocab: z.array(curriculumVocabItemSchema).min(6).max(14),
  conversationScenario: curriculumScenarioSchema,
});

export const curriculumUnitSchema = z
  .object({
    /** Stable id: `{level}-u{unit}` (e.g. "a1-u1"). */
    id: z.string().regex(/^[abc][12]-u\d{1,2}$/),
    level: cefrLevelSchema,
    /** 1-based position within the level. */
    order: z.number().int().min(1).max(12),
    titleEn: z.string().min(3).max(80),
    titleFr: z.string().min(3).max(80),
    lessons: z.array(curriculumLessonSchema).min(3).max(8),
  })
  .superRefine((unit, ctx) => {
    // Lesson orders must be exactly 1..N (the engine's position math and
    // the daily-plan "next lesson" pointer both index by order).
    const orders = unit.lessons.map((l) => l.order);
    const expected = Array.from({ length: unit.lessons.length }, (_, i) => i + 1);
    if (JSON.stringify([...orders].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `lesson orders must be exactly 1..${unit.lessons.length}, got [${orders.join(", ")}]`,
        path: ["lessons"],
      });
    }
    // Lesson ids must extend the unit id (a1-u1 → a1-u1-l3) and be unique.
    const seen = new Set<string>();
    unit.lessons.forEach((lesson, i) => {
      if (!lesson.id.startsWith(`${unit.id}-l`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lesson id "${lesson.id}" must start with "${unit.id}-l"`,
          path: ["lessons", i, "id"],
        });
      }
      if (seen.has(lesson.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate lesson id "${lesson.id}"`,
          path: ["lessons", i, "id"],
        });
      }
      seen.add(lesson.id);
    });
    // No vocab item introduced twice within a unit (recycling happens in
    // scenarios, not vocab lists) — normalized on the FR side.
    const vocabSeen = new Map<string, string>();
    unit.lessons.forEach((lesson, i) => {
      lesson.vocab.forEach((item, j) => {
        const key = item.fr.trim().toLowerCase();
        const firstIn = vocabSeen.get(key);
        if (firstIn !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `vocab "${item.fr}" already introduced in ${firstIn}`,
            path: ["lessons", i, "vocab", j, "fr"],
          });
        } else {
          vocabSeen.set(key, lesson.id);
        }
      });
    });
  });

/** One content FILE = one unit + the content-format version. */
export const curriculumUnitFileSchema = z.object({
  /**
   * Content-format version (roadmap: "versioned content files"). Bump on
   * breaking shape changes; the 19.2 engine gates on versions it knows.
   */
  curriculumVersion: z.literal(1),
  unit: curriculumUnitSchema,
});

export type CurriculumVocabItem = z.infer<typeof curriculumVocabItemSchema>;
export type CurriculumScenario = z.infer<typeof curriculumScenarioSchema>;
export type CurriculumLesson = z.infer<typeof curriculumLessonSchema>;
export type CurriculumUnit = z.infer<typeof curriculumUnitSchema>;
export type CurriculumUnitFile = z.infer<typeof curriculumUnitFileSchema>;
