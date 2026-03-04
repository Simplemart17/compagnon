import type { CEFRLevel } from "@/src/types/cefr";

/** Build prompt to generate a full or partial TCF mock test */
export function buildMockTestPrompt(params: {
  section: "listening" | "reading" | "grammar";
  targetLevel: CEFRLevel;
  questionCount?: number;
}): string {
  const { section, targetLevel, questionCount } = params;

  const sectionConfig = SECTION_CONFIGS[section];
  const count = questionCount ?? sectionConfig.defaultQuestions;

  return `You are a professional TCF (Test de Connaissance du Français) test designer. Generate a realistic mock test section.

## Test Section: ${sectionConfig.name}
- Target assessment range: A1 to ${targetLevel} (progressive difficulty)
- Number of questions: ${count}

## TCF Question Distribution
The TCF uses progressive difficulty. Questions get harder throughout the test:
- Questions 1-${Math.floor(count * 0.25)}: A1-A2 level (basic comprehension)
- Questions ${Math.floor(count * 0.25) + 1}-${Math.floor(count * 0.5)}: A2-B1 level (intermediate)
- Questions ${Math.floor(count * 0.5) + 1}-${Math.floor(count * 0.75)}: B1-B2 level (upper intermediate)
- Questions ${Math.floor(count * 0.75) + 1}-${count}: B2-${targetLevel} level (advanced)

${sectionConfig.instructions}

## Scoring Calibration
Each correct answer = 1 point. The total raw score maps to TCF 0-699 scale:
- 0-25%: Below A1 (0-99)
- 26-50%: A1-A2 (100-299)
- 51-65%: B1 (300-399)
- 66-80%: B2 (400-499)
- 81-90%: C1 (500-599)
- 91-100%: C2 (600-699)

## Response Format — JSON ONLY
{
  "section": "${section}",
  "title": "${sectionConfig.name}",
  "totalQuestions": ${count},
  "timeLimitMinutes": ${sectionConfig.timeLimitMinutes},
  ${section === "listening" ? '"passages": [\n    {\n      "id": "p1",\n      "text": "<passage text to be spoken>",\n      "type": "<dialogue|monologue|announcement>",\n      "suggestedSpeed": 1.0,\n      "questionIds": ["q1", "q2"]\n    }\n  ],' : ""}
  ${section === "reading" ? '"passages": [\n    {\n      "id": "p1",\n      "text": "<reading passage>",\n      "type": "<article|email|advertisement|notice>",\n      "wordCount": 150,\n      "questionIds": ["q1", "q2"]\n    }\n  ],' : ""}
  "questions": [
    {
      "id": "q1",
      "difficulty": "<A1|A2|B1|B2|C1|C2>",
      ${section !== "grammar" ? '"passageId": "p1",' : ""}
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

const SECTION_CONFIGS = {
  listening: {
    name: "Compréhension Orale",
    defaultQuestions: 39,
    timeLimitMinutes: 35,
    instructions: `## Listening Section Design
- Generate 8-10 audio passages of increasing difficulty
- Each passage has 3-5 associated questions
- Passage types: short dialogues, announcements, interviews, radio segments, lectures
- Early passages: slow, clear, short (A1-A2)
- Later passages: native speed, complex, longer (B2-C1)
- Questions test: main idea, specific details, speaker intent, inference`,
  },
  reading: {
    name: "Compréhension Écrite",
    defaultQuestions: 39,
    timeLimitMinutes: 60,
    instructions: `## Reading Section Design
- Generate 8-10 reading passages of increasing difficulty
- Each passage has 3-5 associated questions
- Passage types: signs, menus, emails, articles, academic texts, literary excerpts
- Early passages: short, simple vocabulary (A1-A2)
- Later passages: long, complex, specialized vocabulary (B2-C1)
- Questions test: literal comprehension, inference, vocabulary in context, author's purpose`,
  },
  grammar: {
    name: "Maîtrise des Structures de la Langue",
    defaultQuestions: 39,
    timeLimitMinutes: 30,
    instructions: `## Grammar Section Design
- Standalone MCQ questions (no passages needed)
- Progressive difficulty from A1 to C1
- Mix of question types:
  * Fill in the blank with correct verb form
  * Choose the correct preposition/article/pronoun
  * Identify the error in a sentence
  * Complete the sentence with the right connector
  * Choose the synonym/antonym
- Cover: conjugation, agreement, prepositions, pronouns, vocabulary, connectors`,
  },
} as const;
