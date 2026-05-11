import { buildAggregatedVocabularyConstraintTable } from "@/src/lib/prompts/vocabulary-tiers";
import type { CEFRLevel } from "@/src/types/cefr";

/**
 * TCF Canada placement-test prompt builder.
 *
 * Extracted from the inline `SYSTEM_PROMPT` const previously defined in
 * `app/onboarding/placement-test.tsx` by Story 10-5. Same
 * single-source-of-truth pattern as Story 10-2's `IRCC_CLB_BANDS`,
 * Story 10-3's `writingTaskWordRange`, and Story 10-4's
 * `vocabularyTier` — the call-site const is **deleted** (not aliased
 * or re-exported) so a future reader who greps `SYSTEM_PROMPT` in the
 * repo finds zero results.
 *
 * Per-CEFR vocabulary tiers are sourced from
 * `src/lib/prompts/vocabulary-tiers.ts`
 * `buildAggregatedVocabularyConstraintTable()` (Story 10-4 / per
 * `docs/tcf-spec-source.md §7.2` heuristic caps + §8.1 forbidden
 * tokens) — the aggregated-table renderer (rather than a per-level
 * block) because the placement test spans A1–C2 in a single AI call.
 * Same pattern as `src/lib/prompts/mock-test.ts`.
 *
 * Question-distribution metadata (`PLACEMENT_LEVEL_RANGES` +
 * `TOTAL_PLACEMENT_QUESTIONS`) is centralised here so both the
 * prompt-builder AND the scoring path (`levelForQuestion`,
 * `calculateLevel`, `buildResultsSummary` in
 * `app/onboarding/placement-test.tsx`) consume one source of truth.
 *
 * **Schema contract:** the AI output is validated against
 * `placementTestSchema` + `placementQuestionSchema` exported from
 * `src/lib/schemas/ai-responses.ts` (Story 9-7). The prompt instructs
 * the AI to produce schema-shape compliant JSON; the schema is the
 * runtime guard. They are deliberately separate concerns.
 *
 * **Story 9-4 stored-prompt-injection defense:** `buildPlacementTestPrompt`
 * accepts no arguments; all per-CEFR data is module-static or sourced
 * from `vocabulary-tiers.ts` (which is itself static). Output is
 * deterministic (same call → byte-identical output), asserted by test.
 *
 * **Closes:** audit P1-5 + `docs/tcf-spec-source.md §10` follow-up #7.
 */

/**
 * Placement-test question-distribution metadata.
 *
 * The placement test asks a fixed 15 questions across all 6 CEFR
 * levels with the following distribution (verified-production since
 * Feature Completion Sprint 2026-03-04 — see MEMORY.md):
 *
 *   A1: questions 1–3 (3)
 *   A2: questions 4–6 (3)
 *   B1: questions 7–9 (3)
 *   B2: questions 10–12 (3)
 *   C1: questions 13–14 (2)
 *   C2: question 15 (1)
 *
 * Consumed by BOTH `buildPlacementTestPrompt` (per-level question-count
 * breakdown rendered into the system prompt) AND
 * `app/onboarding/placement-test.tsx` (`levelForQuestion`,
 * `calculateLevel`, `buildResultsSummary`). Single source of truth —
 * same pattern as Story 10-3's `writingTaskWordRange` + Story 10-4's
 * `vocabularyTier`.
 */
export const PLACEMENT_LEVEL_RANGES: readonly {
  readonly level: CEFRLevel;
  readonly start: number;
  readonly end: number;
}[] = [
  { level: "A1", start: 1, end: 3 },
  { level: "A2", start: 4, end: 6 },
  { level: "B1", start: 7, end: 9 },
  { level: "B2", start: 10, end: 12 },
  { level: "C1", start: 13, end: 14 },
  { level: "C2", start: 15, end: 15 },
] as const;

/**
 * Total number of placement-test questions, derived at module load from
 * `PLACEMENT_LEVEL_RANGES`. Review patch P1: derive instead of hardcode
 * so a future edit to a range automatically flows through to both the
 * prompt header ("Generate exactly N…") and the progress-bar denominator
 * in `placement-test.tsx`. Schema length is pinned independently at
 * `src/lib/schemas/ai-responses.ts` `placementTestSchema.length(15)`,
 * so a drift between distribution sum and schema length still fails at
 * runtime.
 */
export const TOTAL_PLACEMENT_QUESTIONS: number = PLACEMENT_LEVEL_RANGES.reduce(
  (acc, range) => acc + (range.end - range.start + 1),
  0
);

/**
 * Per-CEFR-level competency targets surfaced inside the system prompt.
 * Preserved verbatim from the pre-10-5 inline `SYSTEM_PROMPT`. Each
 * level's `competencies` + `distractors` lines are grammar / lexical
 * content that is NOT a duplicate of `vocabulary-tiers.ts` (which
 * handles vocab-frequency tiers; this handles grammatical-skill
 * targets). The per-level "Vocabulary: top-N frequency words" line
 * from the inline prompt is **deleted** — `vocabulary-tiers.ts` is
 * the single source for vocabulary frequency.
 */
const LEVEL_COMPETENCIES: Record<CEFRLevel, { competencies: string; distractors: string }> = {
  A1: {
    competencies:
      "definite/indefinite articles, present tense of etre/avoir/aller, basic greetings and politeness, cardinal numbers, gender agreement",
    distractors:
      "common beginner confusions (le/la/les mix-ups, je suis/j'ai confusion, tu/vous errors)",
  },
  A2: {
    competencies:
      "passe compose with avoir and etre (auxiliary choice), direct/indirect object pronouns, near future (aller + infinitive), prepositions of place",
    distractors:
      "passe compose auxiliary errors (j'ai alle vs je suis alle), pronoun placement errors, gender/number agreement mistakes",
  },
  B1: {
    competencies:
      "imparfait vs passe compose, relative pronouns (qui/que/dont/ou), conditional present, basic subjunctive after il faut que",
    distractors:
      "imparfait/passe compose confusion in context, wrong relative pronoun choice, conditional/future mix-ups",
  },
  B2: {
    competencies:
      "subjunctive in subordinate clauses (bien que, pour que, avant que), passive voice, concession/opposition connectors, plus-que-parfait",
    distractors:
      "indicative where subjunctive is needed, incorrect connector choice, register-inappropriate vocabulary",
  },
  C1: {
    competencies:
      "literary tenses (passe simple recognition), advanced syntax (mise en relief, inversion), nuanced connector usage (quoique, en depit de, force est de constater)",
    distractors:
      "near-synonyms with subtle meaning differences, formal vs literary register confusion",
  },
  C2: {
    competencies:
      "subtle stylistic distinctions, rare grammatical forms (subjonctif plus-que-parfait, ne expletif), literary/rhetorical devices",
    distractors: "plausible but subtly incorrect collocations, archaic vs modern usage",
  },
};

/**
 * Format a question range as "Questions X-Y" (plural) or "Question X"
 * (singular when start === end). Used to render the per-level
 * breakdown header from `PLACEMENT_LEVEL_RANGES` so the metadata
 * pin and the prompt-rendered text stay in lockstep.
 */
function formatQuestionRange(start: number, end: number): string {
  return start === end ? `Question ${start}` : `Questions ${start}-${end}`;
}

/**
 * Build the TCF Canada placement-test system prompt.
 *
 * Pure / deterministic / nullary — same call → byte-identical output
 * (Story 9-4 prompt-injection-defense contract; Story 10-4 review
 * patch P8 determinism pattern). All per-CEFR data is module-static
 * or sourced from `vocabulary-tiers.ts`.
 *
 * Structure:
 *   1. Role + alignment statement (TCF Canada + CEFR)
 *   2. 4-competency rubric (grammar / vocabulary / reading
 *      comprehension / pragmatics) — each question MUST test a
 *      different competency
 *   3. Per-CEFR question-count breakdown (rendered from
 *      `PLACEMENT_LEVEL_RANGES`)
 *   4. Per-CEFR competency targets + distractor families
 *   5. Aggregated Vocabulary Constraint table (Story 10-4)
 *   6. Distractor-quality requirements (plausible mistakes; vary
 *      correct-answer position)
 *   7. Explanation requirements (1-2 sentences English; cite rule)
 *   8. JSON output contract matching `placementTestSchema`
 */
export function buildPlacementTestPrompt(): string {
  const levelSections = PLACEMENT_LEVEL_RANGES.map((range) => {
    const total = range.end - range.start + 1;
    const header = `${formatQuestionRange(range.start, range.end)}: ${range.level} level (${total} question${total === 1 ? "" : "s"})`;
    const { competencies, distractors } = LEVEL_COMPETENCIES[range.level];
    return `${header}
  - Competencies: ${competencies}
  - Distractors: ${distractors}`;
  }).join("\n\n");

  return `You are an expert French language placement test generator aligned with the TCF (Test de Connaissance du Francais) exam standards and the CEFR framework.

Generate exactly ${TOTAL_PLACEMENT_QUESTIONS} multiple-choice questions. Each question MUST test a DIFFERENT linguistic competency. Vary across these categories:
- Grammar (verb conjugation, agreement, tense usage, syntax)
- Vocabulary (contextual word choice, synonyms, collocations)
- Reading comprehension (short passage with inference question)
- Pragmatics (appropriate response in social context)

Question distribution by CEFR level (${TOTAL_PLACEMENT_QUESTIONS} total):

${levelSections}

${buildAggregatedVocabularyConstraintTable()}

IMPORTANT RULES FOR DISTRACTORS:
- Every wrong answer must be a PLAUSIBLE mistake a learner at that level would actually make
- Never include obviously absurd or ungrammatical options that can be eliminated without knowing French
- For grammar questions, distractors should reflect real interference errors (L1 transfer, overgeneralization)
- The correct answer position (a/b/c/d) should be varied across questions -- do NOT always put it in the same slot

EXPLANATION REQUIREMENTS:
- Each explanation must be 1-2 sentences in English
- State WHY the correct answer is right (cite the grammar rule or usage pattern)
- Briefly note what common mistake the distractors represent

All questions and options must be written entirely in French. Explanations in English.
Each question must have exactly 4 options with exactly 1 correct answer.

You MUST respond with this EXACT JSON structure:
{
  "questions": [
    {
      "question": "The question text in French",
      "options": [
        { "id": "a", "text": "Option text", "isCorrect": false },
        { "id": "b", "text": "Option text", "isCorrect": true },
        { "id": "c", "text": "Option text", "isCorrect": false },
        { "id": "d", "text": "Option text", "isCorrect": false }
      ],
      "explanation": "Brief explanation in English stating the rule and why distractors are wrong."
    }
  ]
}

CRITICAL: Each option object MUST have "isCorrect" as a boolean (true/false). Exactly ONE option per question must have "isCorrect": true. Do NOT use a separate "correct_answer" field.`;
}
