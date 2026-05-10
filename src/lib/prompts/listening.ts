import type { CEFRLevel } from "@/src/types/cefr";

/**
 * Per-CEFR listening passage word ranges anchored to
 * `docs/tcf-spec-source.md §3.1` (operator-derived heuristics
 * cross-checked against Beacco _Niveau A1_ samples + Council of Europe
 * 2018 Companion Volume listening descriptors). The publisher
 * (France Éducation International) does NOT publish per-CEFR
 * passage word counts — these are generation-time heuristics only.
 *
 * **Bands deliberately overlap.** Length is not the CEFR diagnostic;
 * syntactic density + lexical frequency tier (§7) + abstract/concrete
 * ratio + implicitness (§8) + rhetorical complexity differentiate
 * levels. The CEFR Companion Volume 2018 §3 listening descriptors
 * (also reproduced in `cefr-self-assessment-grid-2026-05-10.md`) are
 * the qualitative reference; word ranges below are a generation-time
 * heuristic only. Do NOT flatten the overlap to a non-overlapping
 * partition — Story 10-3 widened these ranges from the pre-10-3 audit
 * P1-3 caps (which were too narrow at A1 / B2 / C1 / C2) to match
 * Beacco samples.
 *
 * Citations matrix rows live in `docs/tcf-spec-citations.md §3`.
 */

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
  "passage": "<the French text to be spoken aloud — 30-600 words depending on level>",
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

// Per-CEFR passage word ranges anchored to docs/tcf-spec-source.md §3.1
// (operator-derived heuristics; bands deliberately overlap — see top-of-file
// JSDoc). Story 10-3 widened these ranges to address audit P1-3.
const LEVEL_CONTENT: Record<CEFRLevel, string> = {
  A1: `- Very short passages (30-80 words)
- Topics: greetings, self-introduction, simple directions, ordering food
- Simple present tense only
- Clear, isolated sentences with pauses
- Numbers, dates, basic descriptions`,

  A2: `- Short passages (60-150 words)
- Topics: daily routines, shopping, weather, making plans
- Present tense, some passé composé
- Simple dialogues between 2 people
- Common everyday vocabulary`,

  B1: `- Medium passages (100-200 words)
- Topics: travel, work, health, news summaries, phone calls
- Past tenses, future, conditional
- More complex dialogues or short monologues
- Some inference required`,

  B2: `- Longer passages (150-300 words)
- Topics: current events, professional situations, cultural topics, debates
- All major tenses including subjonctif
- Radio-style reports, interviews, professional discussions
- Requires understanding implicit meaning`,

  C1: `- Long passages (250-500 words)
- Topics: academic lectures, political commentary, literary discussion, specialized fields
- Complex grammar, sophisticated vocabulary
- Fast-paced interviews, debates with multiple speakers
- Requires understanding nuance, tone, and implicit arguments`,

  C2: `- Extended passages (350-600 words)
- Topics: philosophical discourse, sociolinguistic analysis, abstract argumentation
- Native-speed delivery with cultural references
- Humor, irony, wordplay
- Multiple layers of meaning`,
};
