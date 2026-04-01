# Story 6.1: Echo Practice Prompt Builder & Exercise Generation

Status: done

## Story

As a learner wanting multi-skill practice,
I want the app to generate CEFR-calibrated sentences for echo practice,
So that the sentences match my level and target relevant vocabulary and grammar structures.

## Acceptance Criteria

### A. Prompt Builder File

- [ ] **Given** the echo practice feature **When** the prompt builder is created **Then** it exists at `src/lib/prompts/echo.ts` following the `build<Feature>Prompt(params): string` convention **And** exports a single `buildEchoPracticePrompt()` function **And** uses private `Record<CEFRLevel, string>` maps for level-specific content guidance

### B. CEFR-Calibrated Sentence Generation

- [ ] **Given** a user at any CEFR level (A1-C2) **When** the echo practice prompt builder generates a sentence **Then** the sentence is calibrated to the user's CEFR level using vocabulary frequency constraints and grammatical structures appropriate for that level **And** sentences are natural French suitable for spoken repetition (not awkward constructions)

### C. AI Response Format

- [ ] **Given** the echo practice generation request **When** sent to the ai-proxy Edge Function via `chatCompletionJSON()` **Then** the response includes: the French sentence text, an English translation, and expected spelling **And** temperature is set to 0.4 per convention **And** model is `gpt-4o` with `maxTokens: 2048`

### D. TTS Audio Generation

- [ ] **Given** a successfully generated sentence **When** the prompt builder returns **Then** TTS audio is generated via `generateSpeech()` from `openai.ts` **And** the audio is returned as base64 for playback in the exercise

### E. Exercise Persistence

- [ ] **Given** a generated echo practice exercise **When** stored in the database **Then** it is inserted into the `exercises` table using `exercise_type: "echo"` **And** the sentence, translation, and expected spelling are stored in the `content` JSONB column **And** skill is set appropriately (listening, speaking, or a primary skill — see Dev Notes)

### F. ExerciseType Extension

- [ ] **Given** the echo practice exercise type **When** the TypeScript types are updated **Then** `ExerciseType` in `src/types/exercise.ts` includes `"echo"` **And** an `EchoContent` interface is exported for the echo-specific JSONB shape

### G. Error Handling

- [ ] **Given** exercise generation **When** it fails or returns an empty response **Then** the error is handled gracefully with retry logic (already built into `chatCompletionJSON` — 2 retries with backoff) **And** `requireNetwork()` is already called in `openai.ts` — do NOT add redundant checks **And** errors are captured via `captureError(err, "echo-practice-generation")`

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [ ] Non-obvious interactions have `accessibilityHint`
- [ ] Stateful elements have `accessibilityState`
- [ ] All tappable elements have minimum 44x44pt touch targets
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Add `"echo"` to ExerciseType and create EchoContent interface (AC: F)
  - [x] 1.1 In `src/types/exercise.ts`, add `"echo"` to the `ExerciseType` union: `"mcq" | "fill_blank" | "free_write" | "dictation" | "matching" | "echo"`
  - [x] 1.2 In `src/types/exercise.ts`, add an `EchoContent` interface:
    ```typescript
    export interface EchoContent {
      sentence: string;        // The French sentence to echo
      translation: string;     // English translation
      expectedSpelling: string; // Canonical spelling for comparison
      difficulty: "easy" | "medium" | "hard";
      grammarFocus?: string;   // Grammar point this sentence targets
    }
    ```
  - [x] 1.3 Update the `Exercise.content` type union to include `EchoContent`: `content: MCQContent | WritingContent | EchoContent`

- [x] Task 2: Create the echo prompt builder (AC: A, B)
  - [x] 2.1 Create `src/lib/prompts/echo.ts` with a single exported function `buildEchoPracticePrompt(params: { cefrLevel: CEFRLevel; sentenceCount?: number }): string`
  - [x] 2.2 Add a private `const ECHO_LEVEL_GUIDANCE: Record<CEFRLevel, string>` map with level-specific constraints:
    - A1: Simple present tense, basic vocabulary (greeting, family, daily routine), 4-8 words
    - A2: Past tense introduced, common expressions, 6-12 words
    - B1: Compound sentences, subjunctive basics, 8-15 words
    - B2: Complex syntax, idiomatic expressions, conditional, 10-20 words
    - C1: Abstract vocabulary, nuanced connectors, formal register, 12-25 words
    - C2: Literary/academic register, rare constructions, 15-30 words
  - [x] 2.3 The prompt must instruct the AI to return JSON in this format:
    ```json
    {
      "sentences": [
        {
          "sentence": "<French sentence>",
          "translation": "<English translation>",
          "expectedSpelling": "<canonical French spelling>",
          "difficulty": "easy|medium|hard",
          "grammarFocus": "<grammar point>"
        }
      ]
    }
    ```
  - [x] 2.4 The prompt must specify: sentences must be natural spoken French (suitable for repetition aloud), not literary/written constructions. No sentence should contain rare proper nouns or technical jargon unless at C1-C2 level.

- [x] Task 3: Create the echo exercise generation function (AC: C, D, E, G)
  - [x] 3.1 Create `src/lib/echo-generation.ts` with an exported async function `generateEchoExercise(params: { cefrLevel: CEFRLevel; userId: string }): Promise<EchoExerciseResult>` that:
    - Calls `buildEchoPracticePrompt({ cefrLevel })` to build the system prompt
    - Calls `chatCompletionJSON<EchoGenerationResponse>()` with `{ temperature: 0.4, model: "gpt-4o", maxTokens: 2048 }`
    - Validates the response shape (array of sentences, each with required fields)
    - Calls `generateSpeech(sentence.sentence)` for TTS audio of the first sentence (or all sentences depending on flow — see Dev Notes)
    - Returns the parsed sentences + audio base64
  - [x] 3.2 Add a validation function `validateEchoResponse(data: unknown): EchoGenerationResponse` that checks:
    - `sentences` array exists and is non-empty
    - Each sentence has non-empty `sentence`, `translation`, `expectedSpelling` strings
    - `difficulty` is one of `"easy" | "medium" | "hard"`
  - [x] 3.3 On validation failure, throw a descriptive error (captured by the caller's catch block)
  - [x] 3.4 The function does NOT call `requireNetwork()` — it's already called inside `chatCompletionJSON` and `generateSpeech` in `openai.ts`

- [x] Task 4: Run quality gates (AC: Z)
  - [x] 4.1 Run `npm run type-check` — zero errors
  - [x] 4.2 Run `npm run lint` — zero warnings
  - [x] 4.3 Run `npm run format:check` — all files pass

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module | Location | What It Does |
|--------|----------|-------------|
| `chatCompletionJSON<T>()` | `src/lib/openai.ts` | JSON chat completion with type parameter, retries, requireNetwork built-in |
| `generateSpeech()` | `src/lib/openai.ts` | TTS via ai-proxy Edge Function, returns base64 audio |
| `requireNetwork()` | `src/lib/network.ts` | Already called inside `openai.ts` — do NOT add redundant calls |
| `captureError()` | `src/lib/sentry.ts` | Sentry error reporting with context tag |
| `buildGrammarExercisePrompt()` | `src/lib/prompts/grammar.ts` | Reference pattern for prompt builder structure |
| `use-dictation.ts` | `src/hooks/use-dictation.ts` | Reference pattern for a dedicated exercise hook (word comparison, state machine) |
| `classifyError()` | `src/lib/error-messages.ts` | User-friendly error messages |
| `supabase` | `src/lib/supabase.ts` | Supabase client for DB operations |

### Architecture Decision: Separate Hook

Per architecture doc (line 239): "Echo Practice: Dedicated `use-echo-practice.ts` hook (new exercise type with distinct multi-step flow). Do not generalize `useExercise` — keep it focused on single-step MCQ/writing."

This story creates the **generation layer only** (prompt builder + generation function + types). Story 6-2 will create the `use-echo-practice.ts` hook that consumes this generation function.

### Database Constraint: `skill` Column

The `exercises` table has a CHECK constraint: `skill IN ('listening','reading','speaking','writing','grammar')`. Echo practice spans listening + speaking + vocabulary. For DB persistence:
- Use `skill: "listening"` as the primary skill for the exercise record (echo practice is primarily a listening exercise)
- Story 6-2 will update `skill_progress` for multiple skills (listening, speaking) via `updateSkillProgress()` in `activity.ts`

### ExerciseType: No DB Migration Needed

The `exercise_type` column is `TEXT NOT NULL` with **no CHECK constraint** — any string value is accepted. Adding `"echo"` only requires updating the TypeScript `ExerciseType` union in `src/types/exercise.ts`.

### TTS Strategy

`generateSpeech()` from `openai.ts` generates TTS for a single text string. For echo practice:
- Generate TTS for each sentence individually (the hook in story 6-2 will play them one at a time)
- The generation function should generate TTS for all sentences in the batch and return audio alongside each sentence
- Consider batch size: dictation generates 5 sentences per set. Echo practice should generate 3-5 sentences per set (they're more complex multi-step exercises)

### Prompt Builder Pattern (from `grammar.ts`)

```typescript
import type { CEFRLevel } from "@/src/types/cefr";

const LEVEL_MAP: Record<CEFRLevel, string> = {
  A1: "...", A2: "...", B1: "...", B2: "...", C1: "...", C2: "..."
};

export function buildEchoPracticePrompt(params: {
  cefrLevel: CEFRLevel;
  sentenceCount?: number;
}): string {
  const { cefrLevel, sentenceCount = 3 } = params;
  const guidance = LEVEL_MAP[cefrLevel];
  return `You are a French language exercise generator...
  ## Parameters
  - CEFR Level: ${cefrLevel}
  - Number of sentences: ${sentenceCount}
  ## Level-Specific Guidance
  ${guidance}
  ## Response Format — JSON ONLY
  { "sentences": [...] }`;
}
```

### File Organization

| New File | Purpose |
|----------|---------|
| `src/lib/prompts/echo.ts` | Prompt builder — `buildEchoPracticePrompt()` |
| `src/lib/echo-generation.ts` | Generation function — `generateEchoExercise()` |
| `src/types/exercise.ts` | Modified — add `"echo"` to ExerciseType, add `EchoContent` interface |

### What This Story Does NOT Include

- **No new screen** — that's story 6-3
- **No new hook** — that's story 6-2
- **No pronunciation assessment** — that's story 6-2 (speak step)
- **No word comparison** — that's story 6-2 (type step), reusing dictation comparison logic
- **No DB migration** — `exercise_type` is unconstrained TEXT

### Project Structure Notes

- All prompt builders follow one-file-one-export pattern in `src/lib/prompts/`
- Generation logic lives in `src/lib/` (stateless) — NOT in hooks (stateful)
- `import type { CEFRLevel }` for type-only imports — enforced by ESLint
- Path alias: `@/*` maps to repo root — use `@/src/lib/prompts/echo` for imports

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 6, Story 6.1, Lines 1207-1234]
- [Source: _bmad-output/planning-artifacts/architecture.md — AI Prompt Builder Conventions, Lines 383-399]
- [Source: _bmad-output/planning-artifacts/architecture.md — Screen State Machine Pattern, Lines 401-431]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Data Growth Strategy, Line 188]
- [Source: _bmad-output/planning-artifacts/architecture.md — Echo Practice hook decision, Line 239]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Feature Mapping, Lines 699-702]
- [Source: _bmad-output/planning-artifacts/prd.md — FR56-57, Lines 524-525]
- [Source: src/lib/prompts/grammar.ts — Reference prompt builder pattern]
- [Source: src/hooks/use-dictation.ts — Reference dedicated hook with word comparison]
- [Source: src/types/exercise.ts — Current ExerciseType union]
- [Source: supabase/migrations/20260301000000_initial_schema.sql — exercises table, line 116-130]
- [Source: _bmad-output/project-context.md — 67 critical rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Prettier auto-fix on `src/lib/echo-generation.ts` (line wrapping in validation function)

### Completion Notes List

- Task 1: Extended `ExerciseType` union with `"echo"`, added `EchoContent` interface with sentence/translation/expectedSpelling/difficulty/grammarFocus fields, updated `Exercise.content` union
- Task 2: Created `src/lib/prompts/echo.ts` with `buildEchoPracticePrompt()` — private `ECHO_LEVEL_GUIDANCE` Record maps A1-C2 with vocabulary frequency constraints, grammar structures, and word count ranges. Prompt enforces natural spoken French and JSON response format
- Task 3: Created `src/lib/echo-generation.ts` with `generateEchoExercise()` — calls prompt builder → `chatCompletionJSON` (temp 0.4, gpt-4o, 2048 tokens) → `validateEchoResponse()` shape validation → parallel `generateSpeech()` TTS for all sentences → DB insert to `exercises` table with `exercise_type: "echo"`, `skill: "listening"`. No redundant `requireNetwork()` calls. Errors captured via `captureError()`
- Task 4: All quality gates pass (type-check, lint, format:check)

### Change Log

- 2026-03-31: Story 6-1 implementation complete — echo practice types, prompt builder, and generation function

### File List

- `src/types/exercise.ts` — Modified: added `"echo"` to ExerciseType, added `EchoContent` interface, updated `Exercise.content` union
- `src/lib/prompts/echo.ts` — New: echo practice prompt builder with CEFR-calibrated level guidance
- `src/lib/echo-generation.ts` — New: echo exercise generation function with AI response validation, TTS generation, and DB persistence
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Modified: story 6-1 and epic-6 status updates
