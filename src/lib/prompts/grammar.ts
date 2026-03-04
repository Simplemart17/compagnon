import type { CEFRLevel } from "@/src/types/cefr";

/** Build prompt to generate grammar/vocabulary exercises */
export function buildGrammarExercisePrompt(params: {
  cefrLevel: CEFRLevel;
  exerciseCount?: number;
  focusArea?: string;
  errorPatterns?: string[];
}): string {
  const { cefrLevel, exerciseCount = 10, focusArea, errorPatterns } = params;

  const levelTopics = GRAMMAR_TOPICS[cefrLevel];

  return `You are a TCF grammar and vocabulary exercise generator. Create exercises matching the TCF "Maîtrise des structures de la langue" format.

## Parameters
- CEFR Level: ${cefrLevel}
- Number of questions: ${exerciseCount}
${focusArea ? `- Focus area: ${focusArea}` : "- Focus: mix of grammar and vocabulary topics"}

## Grammar Topics for ${cefrLevel}
${levelTopics}

${errorPatterns && errorPatterns.length > 0 ? `## Known User Weaknesses — Include Questions Targeting These\n${errorPatterns.map((e) => `- ${e}`).join("\n")}` : ""}

## Exercise Design Rules
- Each question must have exactly 4 options (a, b, c, d) with ONE correct answer
- Distractors (wrong answers) should reflect common mistakes French learners make
- Include a clear, pedagogical explanation for each correct answer (in French)
- Mix question types: fill-in-the-blank, choose correct form, identify error, sentence completion
- Every explanation should teach a rule the user can apply to other situations

## Response Format — JSON ONLY
{
  "title": "<exercise set title in French>",
  "focusArea": "<grammar topic or 'mixed'>",
  "questions": [
    {
      "id": "q1",
      "type": "<fill_blank|choose_correct|identify_error|sentence_completion>",
      "question": "<the question text, use '___' for blanks>",
      "context": "<optional sentence showing the word in context>",
      "options": [
        {"id": "a", "text": "<option>", "isCorrect": false},
        {"id": "b", "text": "<option>", "isCorrect": true},
        {"id": "c", "text": "<option>", "isCorrect": false},
        {"id": "d", "text": "<option>", "isCorrect": false}
      ],
      "explanation": "<detailed explanation of the grammar rule in French>",
      "rule": "<one-line summary of the grammar rule>"
    }
  ]
}`;
}

const GRAMMAR_TOPICS: Record<CEFRLevel, string> = {
  A1: `- Present tense of être, avoir, aller, faire, and regular -er/-ir/-re verbs
- Definite/indefinite articles (le, la, les, un, une, des)
- Gender and number agreement (adjectives)
- Simple negation (ne...pas)
- Basic prepositions (à, de, en, dans, sur)
- Question formation with "est-ce que"
- Possessive adjectives (mon, ma, mes, ton, ta, tes)
- Numbers 1-100, telling time`,

  A2: `- Passé composé (with avoir and être, including agreement)
- Imparfait (formation and basic usage)
- Futur proche (aller + infinitif)
- Comparative and superlative (plus...que, le plus...)
- Pronouns: COD (le, la, les) and COI (lui, leur)
- Relative pronouns (qui, que)
- Partitive articles (du, de la, des, de)
- Imperative mood`,

  B1: `- Passé composé vs. imparfait (when to use each)
- Futur simple
- Conditional present (je voudrais, on pourrait)
- Subjonctif present (il faut que, je veux que)
- Pronoun placement with compound tenses
- Y and EN pronouns
- Relative pronouns (dont, où, lequel)
- Plus-que-parfait (introduction)
- Passive voice basics`,

  B2: `- Subjonctif vs. indicatif (after expressions of doubt, emotion, judgment)
- Conditionnel passé (j'aurais dû, j'aurais pu)
- Plus-que-parfait in context
- Double pronoun placement
- Discours indirect (reported speech) with tense shifts
- Gérondif (en + present participle)
- Advanced negation (ne...que, ne...jamais, ne...rien)
- Concession: bien que + subjonctif, malgré, quoique
- Cause and consequence connectors`,

  C1: `- Subjonctif passé (bien qu'il ait fait)
- Conditionnel passé for hypothesis (Si j'avais su, j'aurais...)
- Literary tenses awareness (passé simple, imparfait du subjonctif)
- Advanced relative pronouns (ce qui, ce que, ce dont, ce à quoi)
- Nuanced use of prepositions (à vs. de after verbs)
- Nominalisation (transformer → la transformation)
- Emphatic structures (C'est...qui/que, Ce qui...c'est)
- Subtle register differences (formal vs. informal grammar)
- Advanced agreement rules (past participles with avoir + preceding COD)`,

  C2: `- All previous topics at mastery level
- Stylistic grammar choices (inversion, literary negation "ne" alone)
- Archaic and literary forms recognition
- Subtle meaning shifts based on grammar (position of adjective, mode choice)
- Implicit subjonctif (after certain conjunctions without explicit trigger)
- Complex sentence embedding and restructuring
- Register-appropriate grammar in different contexts
- Rare conjugation patterns`,
};
