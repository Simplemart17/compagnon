import { TCF } from "@/src/lib/constants";
import type { CEFRLevel } from "@/src/types/cefr";

/**
 * TCF Canada mock-test prompt builder. Generates a single-section
 * QCM (Listening or Reading) spanning A1–C2 difficulty.
 *
 * Per-passage word-count guidance (the AI infers passage length from
 * difficulty + section): see `docs/tcf-spec-source.md §3.1` (listening,
 * operator-derived) and `§4.1` (reading, operator-derived). The
 * single-skill prompt builders at `src/lib/prompts/listening.ts` and
 * `src/lib/prompts/reading.ts` carry the per-CEFR ranges; this builder
 * spans the full A1–C2 range and lets the AI scale per-passage.
 *
 * Scoring is computed downstream from raw correctness count via
 * `rawPercentToListeningReadingScore` in `src/lib/scoring.ts` (Story
 * 10-2; IRCC-band-anchored). The AI is intentionally NOT given a
 * scoring band table — its job is to generate questions, not produce
 * scores.
 */

/**
 * Sections of the TCF Canada exam that are generated as multiple-choice
 * questionnaires. Writing and Speaking are mandatory in TCF Canada too but
 * use separate (non-MCQ) production-task pipelines:
 *   - Speaking — see `app/(tabs)/mock-test/speaking.tsx` (story 9-8 landed)
 *   - Writing — Epic 10.6
 */
export type MockTestQcmSection = "listening" | "reading";

/** Build prompt to generate a full or partial TCF mock test */
export function buildMockTestPrompt(params: {
  section: MockTestQcmSection;
  targetLevel: CEFRLevel;
  questionCount?: number;
}): string {
  const { section, questionCount } = params;

  const sectionConfig = SECTION_CONFIGS[section];
  // Defensive: TypeScript narrows MockTestQcmSection to listening | reading,
  // but the route param at app/(tabs)/mock-test/[testId].tsx is cast from a
  // dynamic string. A stale "/mock-test/grammar" deep link must not silently
  // produce a prompt with `undefined` interpolations.
  if (!sectionConfig) {
    throw new Error(`buildMockTestPrompt: unsupported TCF Canada section "${section}"`);
  }
  // Default to the verified TCF Canada count if the caller didn't override.
  // Reading and Listening are both 39 in TCF Canada; this falls back through
  // SECTION_CONFIGS so a future variant change only needs one edit.
  const count = questionCount ?? sectionConfig.defaultQuestions;

  return `You are a professional TCF Canada (Test de Connaissance du Français — Canada) test designer. Generate a realistic mock test section.

## Test Section: ${sectionConfig.name}
- Assessment range: A1 to C2 (full TCF Canada spectrum, progressive difficulty)
- Number of questions: ${count}

## TCF Question Distribution
TCF Canada uses progressive difficulty. Questions MUST span the entire A1-to-C2 range:
- Questions 1-${Math.floor(count * 0.2)}: A1-A2 level (basic comprehension)
- Questions ${Math.floor(count * 0.2) + 1}-${Math.floor(count * 0.45)}: A2-B1 level (intermediate)
- Questions ${Math.floor(count * 0.45) + 1}-${Math.floor(count * 0.7)}: B1-B2 level (upper intermediate)
- Questions ${Math.floor(count * 0.7) + 1}-${Math.floor(count * 0.85)}: B2-C1 level (advanced)
- Questions ${Math.floor(count * 0.85) + 1}-${count}: C1-C2 level (mastery)

${sectionConfig.instructions}

## Scoring
Binary correct/incorrect — 1 point per right answer. The total raw correctness count is converted downstream to the TCF 0-699 scale by src/lib/scoring.ts rawPercentToListeningReadingScore (IRCC CLB-anchored, Story 10-2); do NOT emit a score yourself.

${
  section === "reading"
    ? `## Passage Word Counts (per docs/tcf-spec-source.md §4.1)
Each reading passage's \`wordCount\` MUST reflect the passage's difficulty:
- A1 passages: 30–60 words
- A2 passages: 60–120 words
- B1 passages: 120–250 words
- B2 passages: 250–450 words
- C1 passages: 450–700 words
- C2 passages: 600+ words
Early passages (q1-q${Math.floor(count * 0.2)}) sit in the A1–A2 range; late passages (q${Math.floor(count * 0.85) + 1}+) sit in B2–C2.

`
    : ""
}## Passage Grouping — IMPORTANT
You MUST emit 6-8 passages in the "passages" array, each with a unique \`id\`
("p1", "p2", "p3", ...). Each question's "passageId" field MUST reference one
of those ids. Do NOT label every question with "p1" — questions must be
distributed across the passages so that 3-5 questions belong to each passage.
The "questionIds" array on each passage must list the ids of the questions
that reference it.

## Response Format — JSON ONLY
{
  "section": "${section}",
  "title": "${sectionConfig.name}",
  "totalQuestions": ${count},
  "timeLimitMinutes": ${sectionConfig.timeLimitMinutes},
  ${section === "listening" ? '"passages": [\n    {\n      "id": "p1",\n      "text": "<passage 1 text to be spoken>",\n      "type": "<dialogue|monologue|announcement>",\n      "suggestedSpeed": 1.0,\n      "questionIds": ["q1", "q2", "q3"]\n    },\n    {\n      "id": "p2",\n      "text": "<passage 2 text to be spoken>",\n      "type": "<dialogue|monologue|announcement>",\n      "suggestedSpeed": 1.0,\n      "questionIds": ["q4", "q5", "q6"]\n    }\n  ],' : ""}
  ${section === "reading" ? '"passages": [\n    {\n      "id": "p1",\n      "text": "<reading passage 1>",\n      "type": "<article|email|advertisement|notice>",\n      "wordCount": <integer word count, see "Passage Word Counts" guidance above>,\n      "questionIds": ["q1", "q2", "q3"]\n    },\n    {\n      "id": "p2",\n      "text": "<reading passage 2>",\n      "type": "<article|email|advertisement|notice>",\n      "wordCount": <integer word count, see "Passage Word Counts" guidance above>,\n      "questionIds": ["q4", "q5", "q6"]\n    }\n  ],' : ""}
  "questions": [
    {
      "id": "q1",
      "difficulty": "<A1|A2|B1|B2|C1|C2>",
      "passageId": "<p1|p2|p3|...>",
      "question": "<question text>",
      "options": [
        {"id": "a", "text": "<option>", "isCorrect": false},
        {"id": "b", "text": "<option>", "isCorrect": true},
        {"id": "c", "text": "<option>", "isCorrect": false},
        {"id": "d", "text": "<option>", "isCorrect": false}
      ],
      "explanation": "<explanation in French>"
    }
  ]
}`;
}

const SECTION_CONFIGS: Record<
  MockTestQcmSection,
  { name: string; defaultQuestions: number; timeLimitMinutes: number; instructions: string }
> = {
  listening: {
    name: "Compréhension Orale",
    defaultQuestions: TCF.LISTENING_QUESTIONS,
    timeLimitMinutes: TCF.LISTENING_MINUTES,
    instructions: `## Listening Section Design
- Generate 6-8 audio passages of increasing difficulty
- Each passage has 3-5 associated questions
- Passage types: short dialogues, announcements, interviews, radio segments, lectures
- Early passages: slow, clear, short (A1-A2)
- Later passages: native speed, complex, longer (B2-C2)
- Questions test: main idea, specific details, speaker intent, inference`,
  },
  reading: {
    name: "Compréhension Écrite",
    defaultQuestions: TCF.READING_QUESTIONS,
    timeLimitMinutes: TCF.READING_MINUTES,
    instructions: `## Reading Section Design
- Generate 6-8 reading passages of increasing difficulty
- Each passage has 3-5 associated questions
- Passage types: signs, menus, emails, articles, academic texts, literary excerpts
- Early passages: short, simple vocabulary (A1-A2)
- Later passages: long, complex, specialized vocabulary (B2-C2)
- Questions test: literal comprehension, inference, vocabulary in context, author's purpose`,
  },
};
