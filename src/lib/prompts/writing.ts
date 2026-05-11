import { buildVocabularyConstraintBlock } from "@/src/lib/prompts/vocabulary-tiers";
import type { CEFRLevel } from "@/src/types/cefr";

/**
 * Per-task Writing word ranges sourced verbatim from
 * `docs/tcf-spec-source.md §5.1` (publisher-verbatim, France Éducation
 * International's TCF Canada landing page). Unlike listening/reading
 * where the publisher does NOT publish per-CEFR word counts, these
 * Writing ranges are **enforcement-grade per §5.3**: a submission
 * outside the per-task range is automatically evaluated as
 * "A1 non atteint" (below A1) regardless of content quality.
 *
 * **Do NOT vary these ranges by CEFR level.** The publisher does not
 * publish a per-level carve-out; all candidates write to the same
 * per-task targets. The legacy "200+ words (250-300 for C1 target)"
 * framing on Task 3 was a pre-10-3 invention.
 *
 * Citations matrix rows live in `docs/tcf-spec-citations.md §5`.
 */

/**
 * Single source of truth for per-task Writing word ranges per
 * `docs/tcf-spec-source.md §5.1`. Imported by `src/hooks/use-exercise.ts`
 * writing flow + by `TASK_EXPECTATIONS` below. Centralising here
 * eliminates the lockstep-update risk that pre-10-3 carried (three
 * sites each holding their own copy of the ranges).
 *
 * - Task 1: 60–120 words (verbatim FR: "minimum 60 mots / maximum 120 mots")
 * - Task 2: 120–150 words (verbatim FR: "minimum 120 mots / maximum 150 mots")
 * - Task 3: 120–180 words (verbatim FR: "minimum 120 mots / maximum 180 mots")
 */
export function writingTaskWordRange(taskNumber: 1 | 2 | 3): { min: number; max: number } {
  switch (taskNumber) {
    case 1:
      return { min: 60, max: 120 };
    case 2:
      return { min: 120, max: 150 };
    case 3:
      return { min: 120, max: 180 };
    default:
      // TypeScript narrows to never here, but at runtime callers can still
      // pass a deserialised DB value or a deep-link param that escaped
      // narrowing. Throw loudly instead of returning undefined and letting
      // a downstream destructure (`const { min, max } = writingTaskWordRange(x)`)
      // crash with a non-diagnostic `TypeError: Cannot destructure property
      // 'min' of 'undefined'`.
      throw new Error(
        `writingTaskWordRange: unsupported taskNumber "${taskNumber as unknown as string}" (expected 1, 2, or 3)`
      );
  }
}

/** Build the system prompt for writing evaluation */
export function buildWritingEvaluatorPrompt(params: {
  cefrLevel: CEFRLevel;
  taskNumber: 1 | 2 | 3;
  prompt: string;
}): string {
  const { cefrLevel, taskNumber, prompt: writingPrompt } = params;

  const taskExpectations = buildTaskExpectations(taskNumber);

  // §5.3 enforcement block is templated from `writingTaskWordRange` so the
  // helper remains the single source of truth — a future range change in
  // the helper propagates to this block automatically. Renders as:
  //   - Task 1: 60-120 words (publisher-verbatim, §5.1)
  //   - Task 2: 120-150 words (publisher-verbatim, §5.1)
  //   - Task 3: 120-180 words (publisher-verbatim, §5.1)
  const enforcementBullets = ([1, 2, 3] as const)
    .map((t) => {
      const { min, max } = writingTaskWordRange(t);
      return `- Task ${t}: ${min}-${max} words (publisher-verbatim, §5.1)`;
    })
    .join("\n");

  // Story 10-4 review patch P3: filter the "Expected connectors by level"
  // block by the user's target CEFR so an A1 evaluator does not see
  // aspirational C1-C2 connector references that the new Vocabulary
  // Constraint block (above) explicitly forbids at A1. Without this
  // filter the AI sees both "Forbidden at A1: force est de constater"
  // and "C1-C2 expected: force est de constater" — direct contradiction
  // (Edge Case Hunter Finding 1).
  const connectorRows: string[] = [];
  if (cefrLevel === "A1" || cefrLevel === "A2") {
    connectorRows.push("  A1-A2: et, mais, parce que, alors, aussi");
  } else if (cefrLevel === "B1" || cefrLevel === "B2") {
    connectorRows.push("  A1-A2: et, mais, parce que, alors, aussi");
    connectorRows.push(
      "  B1-B2: cependant, en effet, par conséquent, d'une part...d'autre part, en revanche"
    );
  } else {
    // C1, C2 — show all three rows (full upper register expected)
    connectorRows.push("  A1-A2: et, mais, parce que, alors, aussi");
    connectorRows.push(
      "  B1-B2: cependant, en effet, par conséquent, d'une part...d'autre part, en revanche"
    );
    connectorRows.push(
      "  C1-C2: néanmoins, toutefois, force est de constater, il n'en demeure pas moins, en l'occurrence, quoi qu'il en soit"
    );
  }
  const expectedConnectorsBlock = connectorRows.join("\n");

  return `You are an expert TCF (Test de Connaissance du Français) writing examiner. You evaluate written French with precision and provide constructive feedback calibrated to CEFR level ${cefrLevel}.

## Publisher Word Count Enforcement (§5.3)
Per France Éducation International's published rule (docs/tcf-spec-source.md §5.3): a Writing submission whose word count falls outside the per-task range below is automatically evaluated as "A1 non atteint" (below A1) regardless of content quality. Do NOT generate writing prompts that implicitly demand more text than the per-task range allows; the prompt's complexity must be addressable within the verbatim publisher range. The ranges are uniform across all CEFR levels — there is no per-level carve-out.
${enforcementBullets}

## Evaluation Task
- TCF Expression Écrite Task ${taskNumber}
- User's target level: ${cefrLevel}
- Writing prompt: "${writingPrompt}"
${taskExpectations}

${buildVocabularyConstraintBlock(cefrLevel)}

## Evaluation Rubric — Score Each Dimension 0-25

### 1. Grammar & Syntax (0-25)
- Verb conjugation accuracy (agreement, tense selection)
- Sentence structure complexity appropriate for ${cefrLevel}
- Correct use of articles, prepositions, pronouns
- Subject-verb agreement
- Proper use of modes (indicatif, subjonctif, conditionnel)

### 2. Cohesion & Coherence (0-25)
- CRITICAL FOR C1: Correct use of Connecteurs Logiques (transition words)
- Expected connectors by level (Story 10-4 review patch P3 — filtered to user's target level + below; aspirational tiers omitted to avoid contradiction with the Vocabulary Constraint block above):
${expectedConnectorsBlock}
- Logical flow between sentences and paragraphs
- Clear introduction, development, and conclusion structure
- Paragraph organization

### 3. Lexical Richness (0-25)
- Vocabulary diversity — flag word repetition
- Appropriate register for the task type
- Use of precise vocabulary vs. vague terms
- Idiomatic expressions and collocations
- Measure: count unique content words / total content words (diversity ratio)
- ${cefrLevel === "C1" || cefrLevel === "C2" ? "Expect specialized vocabulary and nuanced word choices" : ""}

### 4. Register & Appropriateness (0-25)
- Is the register appropriate for the task? (formal letter vs. casual message vs. academic essay)
- Consistency of register throughout the text
- Appropriate level of formality (tu vs. vous, tone)
- Cultural appropriateness of expressions

## Response Format — RESPOND IN JSON ONLY
{
  "overallScore": <0-100 total>,
  "grammarScore": <0-25>,
  "cohesionScore": <0-25>,
  "lexicalRichnessScore": <0-25>,
  "registerScore": <0-25>,
  "estimatedCEFR": "<A1|A2|B1|B2|C1|C2>",
  "tcfEstimatedScore": <0-699>,
  "errors": [
    {
      "original": "<exact text with error>",
      "correction": "<corrected version>",
      "explanation": "<why this is wrong, in simple French>",
      "category": "<grammar|cohesion|vocabulary|register>"
    }
  ],
  "suggestions": [
    "<specific actionable suggestion in French>"
  ],
  "rewriteSuggestion": "<a model rewrite of the user's text at ${cefrLevel} level showing ideal execution>",
  "vocabularyDiversityRatio": <0.0-1.0>,
  "connectorsUsed": ["<list of transition words found>"],
  "connectorsMissing": ["<transition words they should have used>"],
  "summary": "<2-3 sentence overall assessment in French>"
}`;
}

// Per-task expectations pull the word range from `writingTaskWordRange`
// (single source of truth per §5.1). A future change to the helper
// propagates here automatically — no two-site drift. The qualitative
// content (types, register, focus) is task-specific and stays inline.
function buildTaskExpectations(taskNumber: 1 | 2 | 3): string {
  const { min, max } = writingTaskWordRange(taskNumber);
  const wordCountLine = `${min}-${max} words (publisher-verbatim §5.1; out-of-range → "A1 non atteint")`;
  switch (taskNumber) {
    case 1:
      return `
## Task 1 Expectations
- Short message: ${wordCountLine}
- Types: describe something, invite someone, make a request, leave a message
- Register: semi-formal to informal depending on context
- Focus: clarity, basic cohesion, appropriate greeting/closing`;
    case 2:
      return `
## Task 2 Expectations
- Article or formal letter: ${wordCountLine}
- Types: argue a position, compare options, explain a situation, write for a publication
- Register: formal
- Focus: argumentation structure, connectors, vocabulary precision`;
    case 3:
      return `
## Task 3 Expectations
- Essay or synthesis: ${wordCountLine}
- Types: analyze a complex topic, synthesize multiple viewpoints, persuasive essay
- Register: academic/formal
- Focus: sophisticated argumentation, nuanced vocabulary, complex sentence structures, strong thesis
- At any CEFR target, Task 3 word count is ${min}-${max} words per publisher §5.1; complexity is judged by argumentation depth + lexical sophistication, not by length`;
  }
}
