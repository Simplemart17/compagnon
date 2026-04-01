import type { CEFRLevel } from "@/src/types/cefr";

const ECHO_LEVEL_GUIDANCE: Record<CEFRLevel, string> = {
  A1: `- Simple present tense only (être, avoir, aller, regular -er verbs)
- Basic vocabulary: greetings, family, daily routine, food, weather
- Sentence length: 4-8 words
- No compound sentences or subordinate clauses
- Example structures: "Je m'appelle...", "Il fait beau aujourd'hui.", "J'aime le chocolat."`,

  A2: `- Past tense introduced (passé composé with common verbs)
- Common everyday expressions and opinions
- Sentence length: 6-12 words
- Simple conjunctions (et, mais, parce que)
- Example structures: "Hier, je suis allé au marché.", "J'ai mangé une bonne salade ce midi."`,

  B1: `- Compound sentences with subordinate clauses
- Subjunctive basics (il faut que, je veux que)
- Conditional expressions (je voudrais, on pourrait)
- Sentence length: 8-15 words
- Example structures: "Il faut que tu finisses tes devoirs avant de sortir.", "Si j'avais le temps, je voyagerais plus souvent."`,

  B2: `- Complex syntax with multiple clauses
- Idiomatic expressions and nuanced connectors
- Conditional and subjunctive in natural contexts
- Sentence length: 10-20 words
- Example structures: "Bien qu'il pleuve, nous avons décidé de faire une promenade.", "Il aurait fallu qu'on parte plus tôt pour éviter les embouteillages."`,

  C1: `- Abstract vocabulary and nuanced connectors
- Formal register, academic and professional language
- Complex embedded clauses and nominalizations
- Sentence length: 12-25 words
- Example structures: "La mise en œuvre de cette réforme nécessiterait une concertation approfondie entre les différents acteurs.", "Force est de constater que les résultats ne sont pas à la hauteur des attentes."`,

  C2: `- Formal and academic register, but still suitable for spoken repetition
- Sophisticated idiomatic expressions, nuanced argumentation
- Complex embedded clauses and rhetorical structures
- Sentence length: 15-30 words
- Example structures: "Il n'en demeure pas moins que cette approche soulève des interrogations tout à fait légitimes.", "On ne saurait ignorer les implications à long terme d'une telle décision sur l'ensemble du secteur."`,
};

export function buildEchoPracticePrompt(params: {
  cefrLevel: CEFRLevel;
  sentenceCount?: number;
}): string {
  const { cefrLevel, sentenceCount = 3 } = params;
  const guidance = ECHO_LEVEL_GUIDANCE[cefrLevel];

  return `You are a French language sentence generator for echo practice exercises. Generate natural spoken French sentences that a learner will listen to and repeat aloud.

## Parameters
- CEFR Level: ${cefrLevel}
- Number of sentences: ${sentenceCount}

## Level-Specific Guidance
${guidance}

## Sentence Requirements
- Every sentence MUST be natural spoken French suitable for oral repetition
- Do NOT use literary or overly written constructions
- Do NOT include rare proper nouns or technical jargon (except at C1-C2 level where domain vocabulary is appropriate)
- Each sentence should target a different grammar point or vocabulary theme
- Vary difficulty within the level: include one easier, one typical, and one slightly challenging sentence
- Ensure correct French orthography including all accents and diacritics

## Response Format — JSON ONLY
{
  "sentences": [
    {
      "sentence": "<French sentence>",
      "translation": "<English translation>",
      "expectedSpelling": "<canonical French spelling with all accents>",
      "difficulty": "easy|medium|hard",
      "grammarFocus": "<grammar point this sentence targets>"
    }
  ]
}`;
}
