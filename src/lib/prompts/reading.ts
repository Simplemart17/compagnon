import { buildVocabularyConstraintBlock } from "@/src/lib/prompts/vocabulary-tiers";
import type { CEFRLevel } from "@/src/types/cefr";

/**
 * Per-CEFR reading passage word ranges anchored to
 * `docs/tcf-spec-source.md §4.1` (operator-derived heuristics
 * cross-checked against the publisher's TCF samples + Council of Europe
 * 2018 Companion Volume reading descriptors). The publisher
 * (France Éducation International) does NOT publish per-CEFR
 * passage word counts — these are generation-time heuristics only.
 *
 * **Bands deliberately overlap.** Same caveat as listening.ts — length
 * is not the CEFR diagnostic; syntactic complexity + vocabulary tier
 * (§7) + abstract/concrete ratio + rhetorical structure differentiate
 * levels. Story 10-3 roughly doubled B2 / C1 ceilings to address audit
 * P1-3 ("B2 way too short, C1 way too short").
 *
 * Vocabulary tiers per CEFR are surfaced via
 * `src/lib/prompts/vocabulary-tiers.ts` `buildVocabularyConstraintBlock`
 * (Story 10-4 / `docs/tcf-spec-source.md §7.2`).
 *
 * Citations matrix rows live in `docs/tcf-spec-citations.md §4` + §9.
 */

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

${buildVocabularyConstraintBlock(cefrLevel)}

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

// Per-CEFR passage word ranges anchored to docs/tcf-spec-source.md §4.1
// (operator-derived heuristics; bands deliberately overlap — see top-of-file
// JSDoc). Story 10-3 extended B1/B2/C1/C2 ranges to address audit P1-3.
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

  B1: `- Medium texts (120-250 words)
- Types: newspaper articles, formal emails, blog posts, instructions, brochures
- All common tenses, varied vocabulary
- Questions test understanding of opinions, cause/effect, sequence
- Moderate inference required`,

  B2: `- Longer texts (250-450 words)
- Types: opinion pieces, professional correspondence, reviews, reports
- Complex grammar, abstract vocabulary
- Questions test understanding of argumentation, implicit meaning, tone
- Requires distinguishing fact from opinion`,

  C1: `- Long texts (450-700 words)
- Types: academic articles, literary excerpts, editorials, policy documents
- Sophisticated language, specialized vocabulary
- Questions test nuanced comprehension, rhetorical analysis, synthesis
- Requires understanding subtle distinctions and authorial intent`,

  C2: `- Extended texts (600-900+ words)
- Types: literary criticism, philosophical essays, legal texts, satirical writing
- Full range of registers and styles
- Questions test mastery-level comprehension: subtext, cultural references, stylistic analysis
- Near-native reading ability required`,
};
