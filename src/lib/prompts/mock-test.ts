import { TCF } from "@/src/lib/constants";
import type { CEFRLevel } from "@/src/types/cefr";

/**
 * Sections of the TCF Canada exam that are generated as multiple-choice
 * questionnaires. Writing and Speaking are mandatory in TCF Canada too but
 * use separate (non-MCQ) production-task pipelines (Epic 10 + story 9-8).
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

## Scoring Calibration
Each correct answer = 1 point. The total raw score maps to TCF 0-699 scale:
- 0-20%: Below A1 (0-99)
- 21-35%: A1 (100-199)
- 36-50%: A2 (200-299)
- 51-65%: B1 (300-399)
- 66-80%: B2 (400-499)
- 81-90%: C1 (500-599)
- 91-100%: C2 (600-699)

## Passage Grouping — IMPORTANT
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
  ${section === "reading" ? '"passages": [\n    {\n      "id": "p1",\n      "text": "<reading passage 1>",\n      "type": "<article|email|advertisement|notice>",\n      "wordCount": 150,\n      "questionIds": ["q1", "q2", "q3"]\n    },\n    {\n      "id": "p2",\n      "text": "<reading passage 2>",\n      "type": "<article|email|advertisement|notice>",\n      "wordCount": 200,\n      "questionIds": ["q4", "q5", "q6"]\n    }\n  ],' : ""}
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

// The "## Scoring Calibration" block in the prompt body above is the legacy
// linear curve. Recalibration against real TCF data is owned by Epic 10.2
// (P1-1) — do not edit the band table here in story 9-1.

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
