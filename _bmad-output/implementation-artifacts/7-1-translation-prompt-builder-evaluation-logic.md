# Story 7.1: Translation Prompt Builder & Evaluation Logic

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner practicing translation,
I want CEFR-appropriate sentences and accurate evaluation of my spoken French translation,
So that I build the mental bridge from my native language to French at my proficiency level.

## Acceptance Criteria

### A. Translation Prompt Builder

- [x] **Given** a user at CEFR level A1-B1 **When** the translation prompt builder generates content **Then** it produces sentences in English with corresponding French translation targets **And** vocabulary and grammar structures are calibrated to the user's CEFR level **And** sentences cover practical TCF scenarios (travel, work, daily life)

### B. B2+ Paraphrasing Mode

- [x] **Given** a user at CEFR level B2 or above **When** the translation prompt builder generates content **Then** it produces a French sentence for L2 paraphrasing (rephrase in different French words) instead of L1-to-L2 translation **And** this is per PRD rationale: translation reinforces L1-to-L2 pathways, counterproductive for advanced learners

### C. Evaluation Prompt

- [x] **Given** the evaluation prompt **When** it scores the user's spoken translation **Then** it evaluates three dimensions: accuracy (semantic correctness), fluency (natural flow), and naturalness (idiomatic French vs. literal translation) **And** each dimension receives a 0-100 score and specific feedback text **And** temperature is set to 0.4

### D. CEFR Level Guidance Maps

- [x] **Given** the translation prompt builder **When** generating sentences **Then** it uses private `Record<CEFRLevel, string>` maps for level-specific content guidance (vocabulary constraints, grammatical structures, sentence complexity) **And** the builder follows `build<Feature>Prompt` naming convention

### E. Translation Generation Function

- [x] **Given** the generation function **When** called with a CEFR level and user ID **Then** it generates sentences via `chatCompletionJSON` through `ai-proxy` Edge Function **And** generates TTS audio for the source sentence (English at A1-B1, French at B2+) **And** validates AI response structure before returning **And** persists to the `exercises` table with `exercise_type: "translation"` and content in JSONB

### F. Exercise Data Storage

- [x] **Given** the translation exercise data **When** stored **Then** it uses the existing `exercises` table with `exercise_type` set to `"translation"` and content in JSONB **And** no new database tables or migrations are required

### G. Type Definitions

- [x] **Given** the `ExerciseType` union in `src/types/exercise.ts` **When** translation is added **Then** `"translation"` is added to the `ExerciseType` union **And** a `TranslationContent` interface is defined for the JSONB content **And** a `TranslationEvaluation` interface is defined for the evaluation result

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [x] Non-obvious interactions have `accessibilityHint`
- [x] Stateful elements have `accessibilityState`
- [x] All tappable elements have minimum 44x44pt touch targets
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Add `"translation"` to ExerciseType and define content/evaluation types (AC: G)
  - [x] 1.1 In `src/types/exercise.ts`, add `"translation"` to `ExerciseType` union (alongside `"echo"`, `"mcq"`, etc.)
  - [x] 1.2 Define `TranslationContent` interface:
    ```typescript
    export interface TranslationSentence {
      source: string;          // English sentence (A1-B1) or French sentence (B2+ paraphrasing)
      target: string;          // Expected French translation or paraphrase
      explanation: string;     // Why this translation is correct / key grammar notes
      difficulty: CEFRLevel;   // Sentence difficulty level
      grammarFocus: string;    // Primary grammar structure being tested
    }
    export interface TranslationContent {
      mode: "translation" | "paraphrasing"; // A1-B1 vs B2+
      sentences: TranslationSentence[];
    }
    ```
  - [x] 1.3 Define `TranslationEvaluation` interface:
    ```typescript
    export interface TranslationDimensionScore {
      score: number;      // 0-100
      feedback: string;   // Specific dimension feedback
    }
    export interface TranslationEvaluation {
      accuracy: TranslationDimensionScore;
      fluency: TranslationDimensionScore;
      naturalness: TranslationDimensionScore;
      overallScore: number;   // Weighted average
      expectedTranslation: string;
      userTranscription: string;
    }
    ```
  - [x] 1.4 Add `TranslationContent` to the `Exercise.content` union type

- [x] Task 2: Create translation prompt builder (AC: A, B, D)
  - [x] 2.1 Create `src/lib/prompts/translation.ts`
  - [x] 2.2 Export `buildTranslationPrompt(params: { cefrLevel: CEFRLevel; sentenceCount?: number }): string`
  - [x] 2.3 Define private `LEVEL_GUIDANCE: Record<CEFRLevel, string>` with:
    - A1: Present tense, basic nouns/adjectives, greetings, daily routines, simple subject-verb-object
    - A2: Past tense (passé composé), prepositions, shopping, directions, compound sentences
    - B1: Imperfect vs passé composé, subjunctive basics, opinions, conditional, relative clauses
    - B2+ (paraphrasing): Complex subjunctive, formal register, nuanced vocabulary, idiomatic expressions
    - C1: Abstract topics, literary register, rhetorical structures, concessive clauses
    - C2: Near-native fluency, cultural references, implicit meaning, stylistic variation
  - [x] 2.4 For A1-B1: Prompt instructs AI to generate English sentences with French targets
  - [x] 2.5 For B2+: Prompt instructs AI to generate French sentences for paraphrasing (rephrase in different French words, maintaining meaning)
  - [x] 2.6 Define JSON response schema in the prompt:
    ```json
    {
      "mode": "translation" | "paraphrasing",
      "sentences": [{
        "source": "string",
        "target": "string",
        "explanation": "string",
        "difficulty": "A1" | "A2" | ... | "C2",
        "grammarFocus": "string"
      }]
    }
    ```
  - [x] 2.7 Include instruction: sentences must cover practical TCF scenarios (travel, work, daily life, social, administrative)
  - [x] 2.8 Include instruction: default 5 sentences per exercise (configurable via `sentenceCount`)

- [x] Task 3: Create translation evaluation prompt builder (AC: C)
  - [x] 3.1 In the same file `src/lib/prompts/translation.ts`, export `buildTranslationEvaluationPrompt(params: { source: string; expectedTarget: string; userTranscription: string; cefrLevel: CEFRLevel; mode: "translation" | "paraphrasing" }): string`
  - [x] 3.2 Prompt instructs AI to evaluate three dimensions:
    - **Accuracy**: How semantically correct is the translation/paraphrase? Does it convey the same meaning?
    - **Fluency**: How naturally does it flow? Grammatically correct word order, conjugation, agreement?
    - **Naturalness**: Is it idiomatic French or a word-for-word literal translation? Would a native speaker phrase it this way?
  - [x] 3.3 Define evaluation JSON response schema:
    ```json
    {
      "accuracy": { "score": 0-100, "feedback": "string" },
      "fluency": { "score": 0-100, "feedback": "string" },
      "naturalness": { "score": 0-100, "feedback": "string" },
      "overallScore": 0-100,
      "corrections": "string (optional: key mistakes)"
    }
    ```
  - [x] 3.4 For paraphrasing mode: evaluation emphasizes lexical variety and avoidance of repeated source vocabulary
  - [x] 3.5 Temperature: 0.4 (per architecture convention for scoring)

- [x] Task 4: Create translation generation function (AC: E, F)
  - [x] 4.1 Create `src/lib/translation-generation.ts`
  - [x] 4.2 Export `generateTranslationExercise(params: { cefrLevel: CEFRLevel; userId: string; sentenceCount?: number }): Promise<TranslationExerciseResult>`
  - [x] 4.3 Define result type:
    ```typescript
    interface TranslationExerciseResult {
      exerciseId: string;
      content: TranslationContent;
      audioData: Map<number, string>; // index → base64 audio
    }
    ```
  - [x] 4.4 Call `chatCompletionJSON<TranslationContent>` with `buildTranslationPrompt`, temperature 0.4, model `gpt-4o`, maxTokens 2048
  - [x] 4.5 Validate response: `sentences` array exists, each sentence has `source`, `target`, `explanation`, `difficulty`, `grammarFocus`
  - [x] 4.6 Generate TTS audio for each source sentence using `generateSpeech()` — use `Promise.allSettled()` to avoid batch failure on single TTS error
  - [x] 4.7 For A1-B1: TTS generates English audio (source is English)
  - [x] 4.8 For B2+: TTS generates French audio (source is French for paraphrasing)
  - [x] 4.9 Persist exercise to `exercises` table via Supabase: `{ user_id, skill: "speaking", cefr_level, exercise_type: "translation", content: translationContent, completed: false }`
  - [x] 4.10 Call `requireNetwork()` before API request
  - [x] 4.11 Wrap in try/catch with `captureError(err, "translation-generation")`

- [x] Task 5: Create translation evaluation function (AC: C)
  - [x] 5.1 In `src/lib/translation-generation.ts`, export `evaluateTranslation(params: { source: string; expectedTarget: string; userTranscription: string; cefrLevel: CEFRLevel; mode: "translation" | "paraphrasing" }): Promise<TranslationEvaluation>`
  - [x] 5.2 Call `chatCompletionJSON<TranslationEvaluation>` with `buildTranslationEvaluationPrompt`, temperature 0.4
  - [x] 5.3 Validate response: all three dimension scores are 0-100, feedback strings are non-empty
  - [x] 5.4 Compute `overallScore` if not provided by AI: weighted average (accuracy 40%, fluency 30%, naturalness 30%)
  - [x] 5.5 Call `requireNetwork()` before API request
  - [x] 5.6 Wrap in try/catch with `captureError(err, "translation-evaluation")`

- [x] Task 6: Quality gates (AC: Z)
  - [x] 6.1 Run `npm run type-check` — zero errors
  - [x] 6.2 Run `npm run lint` — zero warnings
  - [x] 6.3 Run `npm run format:check` — all files pass

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module | Location | What to Use |
|--------|----------|-------------|
| `chatCompletionJSON<T>()` | `src/lib/openai.ts` | JSON-parsed AI completion — auto-parses response |
| `chatCompletion()` | `src/lib/openai.ts` | Text AI completion |
| `generateSpeech()` | `src/lib/openai.ts` | TTS audio generation (returns base64) |
| `requireNetwork()` | `src/lib/network.ts` | Network availability check before API calls |
| `captureError()` | `src/lib/sentry.ts` | Error reporting to Sentry |
| `supabase` | `src/lib/supabase.ts` | Supabase client for DB operations |
| `CEFRLevel` | `src/types/cefr.ts` | `"A1" | "A2" | "B1" | "B2" | "C1" | "C2"` |
| `ExerciseType`, `Exercise` | `src/types/exercise.ts` | Exercise DB types — extend with `"translation"` |
| `Colors`, `Typography` | `src/lib/design.ts` | Design tokens (for any future UI in this story) |

### Primary Template: `src/lib/prompts/echo.ts` + `src/lib/echo-generation.ts`

**Copy the structural pattern** from the echo practice implementation:
- `echo.ts` prompt builder: CEFR level guidance map → system prompt with JSON schema → practical scenario sentences
- `echo-generation.ts`: `chatCompletionJSON` call → response validation → TTS audio generation via `Promise.allSettled` → Supabase insert → return result with audio data

**Key differences from echo:**
1. Translation has TWO prompt builders (generation + evaluation) — echo only has generation
2. Translation source audio language varies by CEFR level (English A1-B1, French B2+) — echo is always French
3. Translation evaluation is a separate AI call (not pronunciation-based) — scores accuracy/fluency/naturalness via GPT-4o
4. Translation has a "mode" discriminator (`"translation"` vs `"paraphrasing"`) — echo has no mode

### CEFR Level Branching Logic

This is the most critical architectural decision in this story:

| CEFR Level | Mode | Source Language | Exercise Description |
|-----------|------|----------------|---------------------|
| A1, A2, B1 | `translation` | English → French | Hear English, speak French translation |
| B2, C1, C2 | `paraphrasing` | French → French | Hear French, rephrase in different French words |

**Why the split?** Per PRD: "Translation reinforces L1→L2 pathways, counterproductive for advanced learners." B2+ learners should think in French, not translate from English.

### Prompt Builder Convention

From architecture: `build<Feature>Prompt(params): string` — one exported function per file, with private `Record<CEFRLevel, string>` maps.

This story exports TWO builders from the same file:
- `buildTranslationPrompt` — sentence generation
- `buildTranslationEvaluationPrompt` — spoken translation scoring

This follows the writing exercise pattern where `writing.ts` is an evaluator prompt, separate from generation.

### AI API Conventions

| Parameter | Value | Source |
|-----------|-------|--------|
| Temperature | 0.4 | Architecture: scoring/generation = 0.4 |
| Model | gpt-4o | Architecture: all exercise generation uses gpt-4o |
| maxTokens | 2048 | Architecture: translation evaluation = 2048 |
| Retry | 2 retries with backoff | Built into `chatCompletionJSON` via openai.ts |

### Exercise Table Usage

The `exercises` table has an unconstrained TEXT `exercise_type` column and JSONB `content`. No DB migration needed — just insert with `exercise_type: "translation"`.

The TypeScript `ExerciseType` union in `src/types/exercise.ts` MUST be extended to include `"translation"` for type safety.

### TTS Language Selection

For A1-B1 (translation mode): Generate English TTS for the source sentence — the learner hears English and must speak French.
For B2+ (paraphrasing mode): Generate French TTS for the source sentence — the learner hears French and must rephrase it.

Use `generateSpeech(text, { voice: "alloy" })` from `src/lib/openai.ts`. The voice is the same regardless of language — OpenAI TTS auto-detects language.

### What This Story Does NOT Include

- **No screen/UI** — that is story 7-3
- **No hook** — that is story 7-2
- **No DB migration** — exercise_type TEXT is unconstrained
- **No Edge Function changes** — uses existing `ai-proxy`
- **No pronunciation assessment** — story 7-2 will integrate pronunciation for fluency scoring

### Previous Epic (6) Learnings

From story 6-1 (Echo prompt builder) and 6-2 (Echo hook):
- `chatCompletionJSON` handles JSON parsing automatically — no need for manual `JSON.parse`
- `Promise.allSettled()` for TTS audio generation prevents single-failure cascade
- `expectedSpelling` (not `sentence`) is the canonical form — use `target` as the canonical French text
- Audio is stored as base64 in runtime memory, NOT in the database
- Validation must check array length and all required fields — AI sometimes returns empty arrays or missing fields

### Git Intelligence

Recent commits show echo practice (stories 6-1 through 6-3) just completed. The codebase patterns are fresh and consistent. Translation follows the exact same architectural spine: prompt builder → generation function → hook → screen.

### Project Structure Notes

- New prompt builder: `src/lib/prompts/translation.ts` (file-based, kebab-case per convention)
- New generation module: `src/lib/translation-generation.ts` (parallel to `echo-generation.ts`)
- Type extension: `src/types/exercise.ts` (add `"translation"` to union + new interfaces)
- Path alias: `@/*` maps to repo root — use `@/src/lib/prompts/translation` for imports

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.1 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Feature Mapping: translation → use-translation.ts → prompts/translation.ts → ai-proxy]
- [Source: _bmad-output/planning-artifacts/architecture.md — AI Prompt Builder Conventions: temperature 0.4, build<Feature>Prompt pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Growth Strategy: extend exercises table with exercise_type discriminator]
- [Source: _bmad-output/planning-artifacts/architecture.md — File tree: prompts/translation.ts, use-translation.ts]
- [Source: _bmad-output/planning-artifacts/architecture.md — Requirements Mapping: Translation (FR53-55)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR53-55: Speech-to-speech translation requirements]
- [Source: _bmad-output/planning-artifacts/prd.md — Innovation: Voice-first translation practice, A1-B1 scope, B2+ paraphrasing]
- [Source: _bmad-output/implementation-artifacts/6-3-echo-practice-screen-practice-hub-integration.md — Previous story learnings]
- [Source: src/lib/prompts/echo.ts — Template prompt builder pattern]
- [Source: src/lib/openai.ts — chatCompletionJSON, generateSpeech API]
- [Source: src/types/exercise.ts — ExerciseType union, Exercise interface]
- [Source: src/types/cefr.ts — CEFRLevel type definition]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Lint caught unused `expectedCount` parameter in `validateTranslationResponse` — removed.

### Completion Notes List

- Task 1: Added `"translation"` to `ExerciseType` union, defined `TranslationSentence`, `TranslationContent`, `TranslationDimensionScore`, `TranslationEvaluation` interfaces, updated `Exercise.content` union.
- Task 2: Created `buildTranslationPrompt` with CEFR level guidance map. A1-B1 generates English→French translation exercises; B2+ generates French→French paraphrasing exercises. Default 5 sentences, configurable.
- Task 3: Created `buildTranslationEvaluationPrompt` evaluating accuracy (semantic), fluency (grammar), naturalness (idiomatic) on 0-100 scales. Paraphrasing mode emphasizes lexical variety.
- Task 4: Created `generateTranslationExercise` — calls `chatCompletionJSON` with temp 0.4, validates response structure, generates TTS audio via `Promise.allSettled`, persists to exercises table with `exercise_type: "translation"`.
- Task 5: Created `evaluateTranslation` — calls `chatCompletionJSON` with evaluation prompt, validates dimension scores 0-100, computes weighted `overallScore` fallback (40/30/30).
- Task 6: All quality gates pass — `type-check`, `lint`, `format:check` all clean.

### Change Log

- 2026-04-01: Story 7-1 implementation complete — translation prompt builder, evaluation logic, type definitions, generation function.
- 2026-04-01: Code review — addressed 7 patch findings: overallScore validation, mode cross-validation, sentenceCount clamping, corrections type field, difficulty CEFRLevel validation, empty transcription guard, prompt difficulty example.

### File List

- `src/types/exercise.ts` — MODIFIED: added `"translation"` to ExerciseType, added TranslationSentence, TranslationContent, TranslationDimensionScore, TranslationEvaluation interfaces, updated Exercise.content union
- `src/lib/prompts/translation.ts` — NEW: buildTranslationPrompt and buildTranslationEvaluationPrompt with CEFR level guidance maps
- `src/lib/translation-generation.ts` — NEW: generateTranslationExercise and evaluateTranslation functions with validation, TTS, DB persistence
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: epic-7 → in-progress, 7-1 → in-progress
