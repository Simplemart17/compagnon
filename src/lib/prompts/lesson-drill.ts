/**
 * Lesson quick-drill prompt — Story 19-2 (drill slice).
 *
 * Generates EXACTLY 3 MCQs scoped to ONE curriculum lesson: the drill is
 * the middle step of teach → drill → apply, so its questions must exercise
 * the lesson's grammarTarget using the lesson's vocabulary plus words the
 * learner has ALREADY been taught (earlier lessons in the same unit) — a
 * learner mid-lesson must never meet an untaught word in a drill stem
 * (the curriculum's own "current + earlier" sequencing rule, applied to
 * generated content). Review R1: a lesson-vocab-ONLY constraint is
 * structurally impossible for sparse lessons (e.g. an 8-adjective lesson
 * drilling agreement still needs subject nouns), so the earlier-vocab
 * affordance is load-bearing, not a nicety.
 *
 * Chrome/content split (Story 14-1 + the 18-1 comprehension-support
 * philosophy): question stems and options are FRENCH (the learning
 * content); explanations are ENGLISH (an A1-A2 learner must be able to
 * READ why their answer was wrong — a French explanation they can't parse
 * teaches nothing).
 */

import type { CurriculumLesson } from "@/src/lib/schemas/curriculum";
import type { CEFRLevel } from "@/src/types/cefr";

/** Bound the earlier-vocab list injected into the prompt (same-unit
 * lessons only reach ~50 items today; the slice is belt-and-suspenders
 * against future unit growth — Story 11-7 bounded-budget discipline). */
export const MAX_EARLIER_VOCAB_ITEMS = 60;

export function buildLessonDrillPrompt(
  lesson: CurriculumLesson,
  level: CEFRLevel,
  earlierVocabFr: readonly string[]
): string {
  const vocabList = lesson.vocab.map((v) => `${v.fr} (${v.en})`).join("; ");
  const earlierList = earlierVocabFr.slice(0, MAX_EARLIER_VOCAB_ITEMS).join("; ");
  const earlierLine =
    earlierList.length > 0
      ? `\n- Previously taught words you may ALSO use where the stem needs them (e.g. subject nouns): ${earlierList}`
      : "";

  return `You are a French exercise author for an ${level} curriculum lesson. Generate EXACTLY 3 multiple-choice questions drilling this lesson's grammar point.

## Lesson Scope (HARD constraints)
- Grammar target: ${lesson.grammarTarget}
- Lesson vocabulary (the words to exercise): ${vocabList}${earlierLine}
- You may also use basic function words (articles, pronouns, common forms of être/avoir/aller/faire) that any ${level} learner at this point has met.
- The learner's can-do goal: ${lesson.canDoEn}
- Every question must exercise the grammar target directly (not general trivia about France, not vocabulary translation alone).
- Question stems and all 4 options are in FRENCH. Do NOT use any French content word outside the lesson vocabulary and the previously-taught list above.
- Distractors must be plausible ${level} errors for THIS grammar point (e.g. wrong agreement, wrong article, wrong verb form) — never random unrelated words.
- Every incorrect option must be UNGRAMMATICAL or clearly wrong in the exact context of the stem — never a different word that would also make a correct French sentence. If a stem could accept several vocabulary words (e.g. "Elle est ___" with many adjectives), add a short English cue to the stem that pins the intended answer (e.g. "(She is tall.)").

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
Exactly 3 questions. Exactly 4 options each. Exactly 1 correct option per question. RANDOMIZE which option id ("a", "b", "c" or "d") is correct in each question — the example above marking "b" is arbitrary, and the three questions must not all share the same correct position.`;
}
