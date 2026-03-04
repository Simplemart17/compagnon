import type { CEFRLevel } from "@/src/types/cefr";

/** Build prompt to generate a listening exercise */
export function buildListeningExercisePrompt(params: {
  cefrLevel: CEFRLevel;
  exerciseCount?: number;
  dialect?: "metropolitan" | "quebecois" | "african";
  topic?: string;
}): string {
  const { cefrLevel, exerciseCount = 5, dialect = "metropolitan", topic } = params;

  const dialectGuidance = DIALECT_GUIDANCE[dialect];
  const levelContent = LEVEL_CONTENT[cefrLevel];

  return `You are a TCF listening exercise generator. Create a French listening comprehension exercise.

## Parameters
- CEFR Level: ${cefrLevel}
- Number of questions: ${exerciseCount}
- French dialect/accent: ${dialect} (${dialectGuidance})
${topic ? `- Topic: ${topic}` : "- Topic: choose an appropriate topic for this level"}

## Content Guidelines for ${cefrLevel}
${levelContent}

## Exercise Format
Generate a complete listening exercise with:
1. A passage in French (the "audio script" that will be converted to speech)
2. Multiple-choice comprehension questions about the passage

## Speed Guidance
${cefrLevel === "A1" || cefrLevel === "A2" ? "- Write the passage to be read SLOWLY and clearly, with simple sentence structures and natural pauses" : ""}
${cefrLevel === "B1" || cefrLevel === "B2" ? "- Write for NORMAL conversational speed with natural flow" : ""}
${cefrLevel === "C1" || cefrLevel === "C2" ? "- Write for NATIVE speed — natural rhythm, contractions, liaisons, with some background context (e.g., radio style, interview format)" : ""}

## Response Format — JSON ONLY
{
  "title": "<exercise title in French>",
  "passage": "<the French text to be spoken aloud — 50-300 words depending on level>",
  "passageType": "<dialogue|monologue|news|interview|announcement|phone_call>",
  "dialect": "${dialect}",
  "suggestedSpeed": <0.7-1.2 where 1.0 is normal>,
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
  "vocabularyHighlights": [
    {"word": "<French word>", "definition": "<explanation in simple French>", "level": "${cefrLevel}"}
  ]
}`;
}

const DIALECT_GUIDANCE: Record<string, string> = {
  metropolitan: "Standard Parisian/metropolitan French. Clear pronunciation, standard grammar.",
  quebecois:
    "Québécois French. Include typical features: 'tu' pronounced 'tsu', 'chez nous', 'icitte', informal contractions. Keep vocabulary comprehensible.",
  african:
    "West African French (e.g., Senegalese, Ivorian). Slightly different rhythm, some local expressions. Formal register tends to be very correct.",
};

const LEVEL_CONTENT: Record<CEFRLevel, string> = {
  A1: `- Very short passages (30-50 words)
- Topics: greetings, self-introduction, simple directions, ordering food
- Simple present tense only
- Clear, isolated sentences with pauses
- Numbers, dates, basic descriptions`,

  A2: `- Short passages (50-80 words)
- Topics: daily routines, shopping, weather, making plans
- Present tense, some passé composé
- Simple dialogues between 2 people
- Common everyday vocabulary`,

  B1: `- Medium passages (80-150 words)
- Topics: travel, work, health, news summaries, phone calls
- Past tenses, future, conditional
- More complex dialogues or short monologues
- Some inference required`,

  B2: `- Longer passages (150-200 words)
- Topics: current events, professional situations, cultural topics, debates
- All major tenses including subjonctif
- Radio-style reports, interviews, professional discussions
- Requires understanding implicit meaning`,

  C1: `- Long passages (200-300 words)
- Topics: academic lectures, political commentary, literary discussion, specialized fields
- Complex grammar, sophisticated vocabulary
- Fast-paced interviews, debates with multiple speakers
- Requires understanding nuance, tone, and implicit arguments`,

  C2: `- Extended passages (250-350 words)
- Topics: philosophical discourse, sociolinguistic analysis, abstract argumentation
- Native-speed delivery with cultural references
- Humor, irony, wordplay
- Multiple layers of meaning`,
};
