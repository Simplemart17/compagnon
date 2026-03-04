import type { CEFRLevel } from "@/src/types/cefr";

/** Build prompt to generate a reading exercise */
export function buildReadingExercisePrompt(params: {
  cefrLevel: CEFRLevel;
  exerciseCount?: number;
  textType?: string;
  topic?: string;
}): string {
  const { cefrLevel, exerciseCount = 5, textType, topic } = params;

  const levelContent = LEVEL_CONTENT[cefrLevel];

  return `You are a TCF reading exercise generator. Create a French reading comprehension exercise.

## Parameters
- CEFR Level: ${cefrLevel}
- Number of questions: ${exerciseCount}
${textType ? `- Text type: ${textType}` : "- Text type: choose an appropriate type for this level"}
${topic ? `- Topic: ${topic}` : "- Topic: choose an engaging topic for this level"}

## Content Guidelines for ${cefrLevel}
${levelContent}

## Word Explanation Format
For each difficult word in the passage, provide an explanation IN SIMPLE FRENCH (not English translation). This is for the "Click-to-Explain" immersive feature.

Example: "l'apanage" → "C'est quelque chose qui appartient uniquement à une personne ou un groupe."

## Response Format — JSON ONLY
{
  "title": "<exercise title in French>",
  "passage": "<the French reading text>",
  "textType": "<article|email|advertisement|letter|literary|instructions|news>",
  "wordCount": <number>,
  "questions": [
    {
      "id": "q1",
      "question": "<question in French>",
      "options": [
        {"id": "a", "text": "<option text>", "isCorrect": false},
        {"id": "b", "text": "<option text>", "isCorrect": true},
        {"id": "c", "text": "<option text>", "isCorrect": false},
        {"id": "d", "text": "<option text>", "isCorrect": false}
      ],
      "explanation": "<why the correct answer is correct, in French>"
    }
  ],
  "wordExplanations": {
    "<difficult word or expression>": "<explanation in simple French>",
    "<another word>": "<explanation in simple French>"
  },
  "vocabularyHighlights": [
    {"word": "<French word>", "definition": "<explanation in simple French>", "level": "${cefrLevel}"}
  ]
}`;
}

const LEVEL_CONTENT: Record<CEFRLevel, string> = {
  A1: `- Very short texts (30-60 words)
- Types: signs, simple menus, postcards, short messages, ID forms
- Present tense, basic vocabulary
- Questions test literal comprehension (who, what, where)
- No inference required`,

  A2: `- Short texts (60-120 words)
- Types: personal emails, simple advertisements, short articles, schedules
- Present and past tenses, everyday vocabulary
- Questions test comprehension of main ideas and specific details
- Some simple inference`,

  B1: `- Medium texts (120-200 words)
- Types: newspaper articles, formal emails, blog posts, instructions, brochures
- All common tenses, varied vocabulary
- Questions test understanding of opinions, cause/effect, sequence
- Moderate inference required`,

  B2: `- Longer texts (200-300 words)
- Types: opinion pieces, professional correspondence, reviews, reports
- Complex grammar, abstract vocabulary
- Questions test understanding of argumentation, implicit meaning, tone
- Requires distinguishing fact from opinion`,

  C1: `- Long texts (300-400 words)
- Types: academic articles, literary excerpts, editorials, policy documents
- Sophisticated language, specialized vocabulary
- Questions test nuanced comprehension, rhetorical analysis, synthesis
- Requires understanding subtle distinctions and authorial intent`,

  C2: `- Extended texts (350-500 words)
- Types: literary criticism, philosophical essays, legal texts, satirical writing
- Full range of registers and styles
- Questions test mastery-level comprehension: subtext, cultural references, stylistic analysis
- Near-native reading ability required`,
};
