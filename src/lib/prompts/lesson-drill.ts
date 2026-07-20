/**
 * Lesson quick-drill prompt — Story 19-2 (drill slice).
 *
 * Generates EXACTLY 3 MCQs scoped to ONE curriculum lesson: the drill is
 * the middle step of teach → drill → apply, so its questions must exercise
 * the lesson's grammarTarget using ONLY that lesson's vocabulary (plus
 * function words) — a learner mid-lesson must never meet an untaught word
 * in a drill stem (the curriculum's own sequencing discipline, applied to
 * generated content).
 *
 * Chrome/content split (Story 14-1 + the 18-1 comprehension-support
 * philosophy): question stems and options are FRENCH (the learning
 * content); explanations are ENGLISH (an A1-A2 learner must be able to
 * READ why their answer was wrong — a French explanation they can't parse
 * teaches nothing).
 */

import type { CurriculumLesson } from "@/src/lib/schemas/curriculum";

export function buildLessonDrillPrompt(lesson: CurriculumLesson): string {
  const vocabList = lesson.vocab.map((v) => `${v.fr} (${v.en})`).join("; ");

  return `You are a French exercise author for an A1 curriculum lesson. Generate EXACTLY 3 multiple-choice questions drilling this lesson's grammar point.

## Lesson Scope (HARD constraints)
- Grammar target: ${lesson.grammarTarget}
- Lesson vocabulary (the ONLY content words you may use, besides basic function words): ${vocabList}
- The learner's can-do goal: ${lesson.canDoEn}
- Every question must exercise the grammar target directly (not general trivia about France, not vocabulary translation alone).
- Question stems and all 4 options are in FRENCH. Do NOT use any French content word outside the lesson vocabulary above.
- Distractors must be plausible A1 errors for THIS grammar point (e.g. wrong agreement, wrong article, wrong verb form) — never random unrelated words.

## Explanations
- Each question's explanation is 1-2 sentences in ENGLISH, stating WHY the correct option is right in terms of the grammar target. Never mention option letters or ids.

## Response Format — JSON ONLY (no prose outside the JSON object)
{
  "questions": [
    {
      "question": "<French stem, may include a blank as ___>",
      "options": [
        { "id": "a", "text": "<French>", "isCorrect": false },
        { "id": "b", "text": "<French>", "isCorrect": true },
        { "id": "c", "text": "<French>", "isCorrect": false },
        { "id": "d", "text": "<French>", "isCorrect": false }
      ],
      "explanation": "<1-2 sentences in English>"
    }
  ]
}
Exactly 3 questions. Exactly 4 options each. Exactly 1 correct option per question. Vary which option id is correct across the 3 questions.`;
}
