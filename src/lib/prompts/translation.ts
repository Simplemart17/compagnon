import type { CEFRLevel } from "@/src/types/cefr";

const LEVEL_GUIDANCE: Record<CEFRLevel, string> = {
  A1: `- Present tense only (être, avoir, aller, regular -er verbs)
- Basic nouns, adjectives, greetings, daily routines
- Sentence length: 4-8 words
- Simple subject-verb-object structure
- Topics: greetings, introductions, food, weather, family`,

  A2: `- Past tense introduced (passé composé with common verbs)
- Prepositions, shopping, directions
- Sentence length: 6-12 words
- Compound sentences with et, mais, parce que
- Topics: shopping, travel directions, routines, hobbies`,

  B1: `- Imperfect vs passé composé, subjunctive basics (il faut que)
- Conditional expressions (je voudrais, on pourrait)
- Relative clauses (qui, que, où)
- Sentence length: 8-15 words
- Topics: opinions, work, plans, describing experiences`,

  B2: `- Complex subjunctive, formal register, nuanced vocabulary
- Idiomatic expressions, concessive clauses (bien que, quoique)
- Sentence length: 10-20 words
- Paraphrasing mode: rephrase the French sentence using different vocabulary and structures while preserving meaning
- Topics: current events, professional situations, abstract concepts`,

  C1: `- Abstract topics, literary register, rhetorical structures
- Concessive and hypothetical clauses, nominalizations
- Sentence length: 12-25 words
- Paraphrasing mode: rephrase with sophisticated lexical variety and register awareness
- Topics: academic discourse, policy, cultural commentary`,

  C2: `- Near-native fluency, cultural references, implicit meaning
- Stylistic variation, formal argumentation, nuanced connectors
- Sentence length: 15-30 words
- Paraphrasing mode: rephrase demonstrating mastery of register, idiom, and rhetorical precision
- Topics: philosophy, literature, complex social issues`,
};

/** Build the system prompt for generating translation exercise sentences */
export function buildTranslationPrompt(params: {
  cefrLevel: CEFRLevel;
  sentenceCount?: number;
}): string {
  const { cefrLevel, sentenceCount = 5 } = params;
  const guidance = LEVEL_GUIDANCE[cefrLevel];
  const isParaphrasing = ["B2", "C1", "C2"].includes(cefrLevel);
  const mode = isParaphrasing ? "paraphrasing" : "translation";

  if (isParaphrasing) {
    return `You are a French language exercise generator for paraphrasing practice. Generate natural French sentences that a learner will listen to and rephrase in different French words, maintaining the same meaning.

## Parameters
- CEFR Level: ${cefrLevel}
- Mode: paraphrasing (L2 → L2)
- Number of sentences: ${sentenceCount}

## Level-Specific Guidance
${guidance}

## Sentence Requirements
- Every "source" sentence MUST be natural spoken French
- The "target" MUST be a valid French paraphrase using different vocabulary and structures
- Source and target must convey the same meaning but use different words
- The paraphrase should demonstrate lexical variety — avoid repeating key content words from the source
- Each sentence should target a different grammar point or vocabulary theme
- Cover practical TCF scenarios: travel, work, daily life, social interactions, administrative tasks
- Ensure correct French orthography including all accents and diacritics

## Response Format — JSON ONLY
{
  "mode": "${mode}",
  "sentences": [
    {
      "source": "<French sentence to paraphrase>",
      "target": "<French paraphrase using different words>",
      "explanation": "<Why this paraphrase works / key vocabulary and grammar notes>",
      "difficulty": "<CEFR level: A1, A2, B1, B2, C1, or C2>",
      "grammarFocus": "<grammar point or vocabulary theme>"
    }
  ]
}`;
  }

  return `You are a French language exercise generator for translation practice. Generate English sentences that a learner will translate into French by speaking aloud.

## Parameters
- CEFR Level: ${cefrLevel}
- Mode: translation (L1 → L2)
- Number of sentences: ${sentenceCount}

## Level-Specific Guidance
${guidance}

## Sentence Requirements
- Every "source" sentence MUST be in English
- Every "target" MUST be the correct French translation
- Vocabulary and grammar in the French target must match CEFR ${cefrLevel} level constraints
- Each sentence should target a different grammar point or vocabulary theme
- Vary difficulty within the level: include easier, typical, and slightly challenging sentences
- Cover practical TCF scenarios: travel, work, daily life, social interactions, administrative tasks
- Ensure correct French orthography including all accents and diacritics

## Response Format — JSON ONLY
{
  "mode": "${mode}",
  "sentences": [
    {
      "source": "<English sentence>",
      "target": "<French translation>",
      "explanation": "<Why this translation is correct / key grammar notes>",
      "difficulty": "<CEFR level: A1, A2, B1, B2, C1, or C2>",
      "grammarFocus": "<grammar point this sentence targets>"
    }
  ]
}`;
}

/** Build the system prompt for evaluating a user's spoken translation */
export function buildTranslationEvaluationPrompt(params: {
  source: string;
  expectedTarget: string;
  userTranscription: string;
  cefrLevel: CEFRLevel;
  mode: "translation" | "paraphrasing";
}): string {
  const { source, expectedTarget, userTranscription, cefrLevel, mode } = params;

  const modeInstructions =
    mode === "paraphrasing"
      ? `The user was asked to PARAPHRASE a French sentence using different words while preserving meaning.
Evaluate lexical variety: did the user avoid simply repeating the source vocabulary?
A good paraphrase uses different words and structures but conveys the same meaning.`
      : `The user was asked to TRANSLATE an English sentence into French.
Evaluate whether the French output accurately conveys the English meaning.`;

  return `You are an expert French language evaluator. Score the user's spoken ${mode === "paraphrasing" ? "paraphrase" : "translation"} on three dimensions.

## Context
- CEFR Level: ${cefrLevel}
- Mode: ${mode}
- Source sentence: "${source}"
- Expected ${mode === "paraphrasing" ? "paraphrase" : "translation"}: "${expectedTarget}"
- User's spoken response: "${userTranscription}"

## Evaluation Mode
${modeInstructions}

## Scoring Dimensions

### Accuracy (0-100)
How semantically correct is the ${mode === "paraphrasing" ? "paraphrase" : "translation"}? Does it convey the same meaning as the ${mode === "paraphrasing" ? "source sentence" : "English original"}?
- 90-100: Perfect or near-perfect meaning transfer
- 70-89: Core meaning preserved with minor omissions or additions
- 50-69: Partial meaning transfer — some key ideas lost
- 0-49: Significant meaning distortion or incomprehensible

### Fluency (0-100)
How naturally does it flow? Is the grammar correct — word order, conjugation, agreement?
- 90-100: Grammatically perfect, natural flow
- 70-89: Minor grammatical errors that don't impede understanding
- 50-69: Notable errors but still understandable
- 0-49: Major grammatical issues

### Naturalness (0-100)
Is it idiomatic French or a word-for-word literal translation? Would a native speaker phrase it this way?
- 90-100: Sounds like a native speaker
- 70-89: Mostly natural with minor awkward phrasing
- 50-69: Understandable but clearly non-native phrasing
- 0-49: Literal translation or unnatural structures

## Response Format — JSON ONLY
{
  "accuracy": { "score": <0-100>, "feedback": "<specific feedback>" },
  "fluency": { "score": <0-100>, "feedback": "<specific feedback>" },
  "naturalness": { "score": <0-100>, "feedback": "<specific feedback>" },
  "overallScore": <0-100>,
  "corrections": "<key mistakes and how to fix them, or empty string if perfect>"
}`;
}
