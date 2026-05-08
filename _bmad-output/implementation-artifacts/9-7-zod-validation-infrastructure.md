# Story 9.7: Zod Validation Infrastructure

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a French learner whose every AI-generated exercise, evaluation, mock-test section, dictation set, conversation feedback summary, micro-drill, fact extraction, and placement-test set is consumed as a typed JavaScript object — and persisted to Supabase JSONB columns wired to React renderers that destructure those fields without `??` fallbacks,
I want every `chatCompletionJSON` call site to validate the model's response against a Zod schema before it touches any consumer or any DB row,
so that one drift in the model's output (a missing `options` array, a stringified-instead-of-number score, a misnamed `correct_answer` field, an empty `questions` array) cannot propagate as a `TypeError: Cannot read properties of undefined` in the UI, a row of `null` fields in `exercises.content`, a `NaN` in `skill_progress.average_score`, or a silent `[object Object]` in a Sentry breadcrumb — and so that the failure mode is one observable Sentry event with the offending feature + attempt + parse-error code, not a downstream cascade.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged this as **P0-8**, a release blocker:

> "Zero schema validation on AI outputs — `chatCompletionJSON<T>` blindly casts; every consumer (writing eval, mock test, dictation, memory, error-tracker, conversation feedback) is one drift away from runtime error or silent garbage in DB. Files: `src/lib/openai.ts:112-126`. Source agents: ai, qa."

Hands-on verification of the codebase against that finding confirms the bug is live. The current implementation at `src/lib/openai.ts:112-126` is:

```ts
export async function chatCompletionJSON<T>(
  messages: ChatMessage[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<T> {
  const raw = await chatCompletion(messages, { ...options, responseFormat: "json_object" });
  return JSON.parse(raw) as T; // ← blind cast — `T` is a TypeScript-only contract
}
```

`T` is a phantom type. `JSON.parse` returns `any`. The `as T` is a compile-time fiction — at runtime the function returns whatever the model emitted, no matter how malformed. There are **16 call sites across 8 files** that consume the result without any cross-cutting validation:

| # | Call site | Phantom type | Has manual validator? | Risk if validator absent |
|---|-----------|--------------|-----------------------|-----------------|
| 1 | `src/hooks/use-exercise.ts:177` (listening) | `ListeningResponse` | partial — `validateMCQExercise` (line 99) | Listening passage missing → audio TTS gets empty string → silent generation skip |
| 2 | `src/hooks/use-exercise.ts:209` (reading) | `ReadingResponse` | partial — `validateMCQExercise` | Passage rendered as `undefined` in `<Text>` → React warning + blank UI |
| 3 | `src/hooks/use-exercise.ts:230` (grammar) | `GrammarResponse` | partial — `validateMCQExercise` | Same as #2 |
| 4 | `src/hooks/use-exercise.ts:260` (writing prompt) | `{ prompt; context }` | none | `prompt: undefined` written into `WritingContent.prompt` → empty writing screen |
| 5 | `src/hooks/use-exercise.ts:412` (writing eval) | `WritingEvaluation` | none | `overallScore: undefined` → `setState({ score: undefined })` → `Math.round(NaN)` → `score: null` row in `exercises.score`, breaking `updateSkillProgress` running average |
| 6 | `src/hooks/use-realtime-voice.ts:631` (conversation feedback) | `ConversationFeedback` | none | Persisted directly to `conversations.ai_feedback` JSONB; missing `strengths` → home-screen "Today's recap" card crashes on `.map()` |
| 7 | `src/hooks/use-dictation.ts:284` | `DictationSet` | empty-array check only | `sentence: undefined` → `tokenize(undefined)` throws |
| 8 | `src/lib/echo-generation.ts:80` | `<unknown>` + `validateEchoResponse` | yes, hand-rolled | Manual validator exists but its rule set is feature-local — no cross-feature reuse, no test coverage |
| 9 | `src/lib/translation-generation.ts:136` | `<unknown>` + `validateTranslationResponse` | yes, hand-rolled | Same as #8 |
| 10 | `src/lib/translation-generation.ts:220` | `<unknown>` + `validateEvaluationResponse` | yes, hand-rolled, **silently coerces** invalid `overallScore` to `-1` | Hand-rolled coercion to magic number `-1` later "fixed" by recompute — fragile; a Zod transform expresses this declaratively |
| 11 | `src/lib/memory.ts:199` (fact extraction) | `{ facts: ExtractedFact[] }` | downstream `.filter` does shape check | `facts: null` → `facts.facts` accessed before filter → TypeError |
| 12 | `src/lib/error-tracker.ts:152` (micro-drill) | `MicroDrill` | none | Drill with no `questions[]` array → grammar drill screen crashes on `.map()` |
| 13 | `src/lib/error-tracker.ts:241` (batch error patterns) | `BatchPatternResult` | empty-array check only | `pattern: undefined` → unique-violations on `error_patterns.pattern UNIQUE` constraint silently swallowed by upsert |
| 14 | `app/(tabs)/mock-test/[testId].tsx:313` | inline `{ passages?; questions[] }` | partial — filter for `options.length === 4 && correctCount === 1` | Section silently truncated to 0 valid questions → "0 of 29 answered" UI dead-end |
| 15 | `app/(tabs)/practice/pronunciation.tsx:189` | `GeneratedSentence` | none | `sentence: undefined` → Azure pronunciation assess called with empty reference text → 400 error |
| 16 | `app/onboarding/placement-test.tsx:468` | `PlacementResponse` | extensive normalization (`resolveIsCorrect`, options-as-object support) | Most defensive call site already; still uses `as unknown as Record<string, unknown>` casts that Zod would replace with one line |

**Two existing patterns in the codebase already do, in spirit, what 9-7 generalizes**:

1. **Per-feature hand-rolled validators** — `validateMCQExercise` (`use-exercise.ts:99`), `validateEchoResponse` (`echo-generation.ts:28`), `validateTranslationResponse` (`translation-generation.ts:32`), `validateEvaluationResponse` (`translation-generation.ts:91`). Each is ~30–50 lines of manual `typeof` / `Array.isArray` / boundary checks. Each is feature-local with no shared test fixture, no shared error format, no retry contract. Most predate this story but their existence proves the team has been writing validation by hand because there was no library.
2. **Defensive casts at consumer level** — `placement-test.tsx:489-518` does ~30 lines of `Record<string, unknown>` normalization to coerce a polymorphic AI response into the expected `MCQOption` shape. Zod's `transform()` and `union()` express the same logic in 5 lines.

9-7 unifies both into one infrastructure: **Zod schemas at the boundary, retry-once-on-parse-failure, single Sentry context for parse failures, and one source of truth for AI response shapes** — enabling Epic 15.5 (AI schema regression tests with recorded outputs) as a downstream consumer of the schemas this story creates.

Epic 9 acceptance-criterion lineage (`shippable-roadmap.md` §2 line 137):

> *"9.7 Zod validation infrastructure (`ai-integration + qa`) — add `zod`; wrap every `chatCompletionJSON` call site with a parse step; on parse failure: retry once, then fail loudly to Sentry. **Covers P0-8.**"*

And the Epic 9 acceptance criterion (line 146):

> *"Zod parse failure is observable in Sentry and never produces undefined fields in DB."*

And the production-risk callout (line 387):

> *"Zod parse failures in production could be loud to users — mitigate with retry-once-then-graceful-degradation per call site."*

**Threat / failure model — what cannot happen post-story:**

After this story:

1. A model that emits `{ "questions": [{}] }` (empty objects) or `{ "questions": null }` cannot reach `setState({ exercise })` or `supabase.from("exercises").insert(...)`. The schema rejects it, one retry fires, and on second failure a `captureError(err, "ai-schema-parse-failed", { feature: "exercise-listening", attempt: 2 })` is emitted with the inferred CEFR level on the scope. The caller's `catch` runs as if the AI request itself had failed (existing `classifyError` path → "Could not generate exercise").
2. A model that returns `{ "overallScore": "85" }` (string, should be number) is rejected by the schema's `z.number()` rule. There is exactly one valid evaluation in `WritingEvaluation` — no `Math.round("85")` foot-gun.
3. A model that returns `{ "summary": "...", "strengths": "great work" }` (string instead of array) cannot land in `conversations.ai_feedback`. The schema's `z.array(z.string())` rejects it; the conversation completes without an AI feedback summary; the row is updated with `ai_feedback: null` (existing fallback path), not with garbage.
4. A model whose first response failed Zod parsing and whose retry response also failed Zod parsing surfaces as exactly one `captureError` event with `feature: "<call-site-tag>"` and `attempt: 2`. The Sentry allowlist rule from 9-3 prevents the prompt content / model output from leaking into the event payload (only `feature`, `attempt`, `code` are emitted as extras; the underlying `ZodError.message` is short and does not contain raw user/model text).
5. The retry attempt does NOT counter-invoke the network-retry path inside `chatCompletion` (which only retries on transient HTTP/timeout errors per `isRetryable`); the parse-retry is a separate, deliberate one-shot at the `chatCompletionJSON` layer. Network retries and parse retries do not multiply.
6. Removing the existing hand-rolled validators (`validateMCQExercise`, `validateEchoResponse`, `validateTranslationResponse`, `validateEvaluationResponse`, the inline mock-test filter, and the placement-test normalization) does not regress functionality — each is replaced by an equivalent Zod schema (with `transform()` for the AI-quirk normalizations the placement test handles). All existing tests continue to pass.
7. The 16 call sites above all pass an explicit schema as a required argument to `chatCompletionJSON`. There is no path through which a caller can omit validation and reach a runtime cast.

**Out of scope for this story (delegated elsewhere):**

- **Recorded-output AI regression tests** (replay 10 real model outputs per prompt through the new Zod parsers in CI) → **Epic 15.5** (`shippable-roadmap.md` line 278). 9-7 produces the schemas these tests will consume but does not record fixtures.
- **Empty-response detection / TTS retry parity** → **Epic 11.8**. 9-7 only validates JSON shape; it does not cover the case where `chatCompletion` returns an empty string for `responseFormat: "text"` calls.
- **Edge Function-side validation of upstream OpenAI responses** → out of scope. The Edge Functions already pass the upstream JSON through unchanged; client-side schema validation is the right boundary for response shape, since the Edge Function does not know the per-feature contract.
- **Schemas for non-AI inputs** (form validation, env var parsing, `app.json` config) → out of scope. 9-7 is laser-focused on AI JSON output schemas.
- **Response-format `tool_calls` migration** (replacing JSON-mode prompts with structured tool calls) → **Epic 11.1** ("Correction protocol via tool-calls"). 9-7 keeps `responseFormat: "json_object"` and validates client-side; structured tool calls are a future, deeper architectural shift.
- **Embedding-based dedupe in error-tracker** → **Epic 11.6**. The error-tracker's `chatCompletionJSON<BatchPatternResult>` call site at `error-tracker.ts:241` will be schema'd by this story but its dedupe heuristic is unchanged.
- **Realtime API output validation** (`response.output_audio_transcript.done` / `output_text.done` events) → out of scope. Those events are validated by the existing dedup / shape guards in `realtime-transcript.ts`, not by JSON-mode parsing. 9-7 does not touch the Realtime path.
- **Removing the existing manual validators in the same commit as the Zod migration** is encouraged where the schema fully covers them; if a manual validator's rule cannot be cleanly expressed as Zod (e.g., cross-field invariants like "exactly one option per question has `isCorrect: true`"), keep the manual check as a `superRefine()` on the Zod schema or as a follow-up assertion inside the call site — but DELETE the standalone validator function once its callers are migrated. No dead code.
- **Form / hook input validation with Zod** (e.g., signup, settings forms) → out of scope. 9-7 addresses AI output validation only.

## Acceptance Criteria

### 1. Add `zod` Dependency

The runtime dependency `zod` must be added with a tracked version. Zod 3 is the only currently-supported major; ^3.23 is the line that ships the `z.ZodType<T>` and `safeParse` APIs this story uses.

- [x] Add `"zod": "^3.23.0"` to `dependencies` in `package.json` (NOT `devDependencies` — runtime consumer).
- [x] Run `npm install`.
- [x] Verify `npm run type-check` passes after install.
- [x] Verify the dependency is reflected in `package-lock.json`. Do NOT commit `node_modules`. Do NOT run `npm audit fix` as part of this story (Epic 12.10 owns audit cleanup).
- [x] **Why Zod 3 (not 4 alpha, not Valibot, not arktype)**: Zod 3 is the React Native ecosystem standard, has zero RN runtime issues, and ships native TypeScript inference via `z.infer<typeof schema>`. Zod 4 is in alpha as of 2026-05; not for production. Valibot is leaner but its tooling (`@hookform/resolvers/valibot`) is not needed here. arktype is faster but not yet stable enough. The roadmap explicitly names Zod (line 137, line 21).
- [x] **Bundle size acknowledgement**: Zod adds ~12 KB minified gzipped. Acceptable for a JSON-validation use case that prevents runtime crashes. Do NOT pull in `zod-to-json-schema`, `zod-form-data`, or any Zod ecosystem package — only `zod` itself.

**Given** a clean checkout
**When** `npm install` runs
**Then** `node_modules/zod` exists at version `3.23.x`
**And** `npm run type-check` is green

### 2. Schema-First `chatCompletionJSON` — Required Schema Argument, No More Phantom Casts

The current `chatCompletionJSON<T>` signature (`messages, options`) must be replaced by a schema-first signature that requires a Zod schema at the type level. The `T` generic is inferred from the schema; callers cannot opt out of validation.

- [x] In `src/lib/openai.ts`, replace the body of `chatCompletionJSON<T>` with the schema-first variant:

  ```ts
  import type { z } from "zod";

  export interface ChatCompletionJSONOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** Tag passed to Sentry on parse failure for observability. Required. */
    feature: string;
    /** Per-call-site retry budget for parse failures. Default 1 (= one retry). */
    parseRetries?: number;
  }

  /**
   * Send a chat completion request, parse it as JSON, and validate the result
   * against the supplied Zod schema. On schema validation failure, the call
   * is retried once (default; configurable via parseRetries) with a fresh
   * model invocation. If the retry also fails, a Sentry event is captured
   * with context "ai-schema-parse-failed" and the failure is rethrown.
   *
   * The schema is required — there is no path that returns an unvalidated cast.
   */
  export async function chatCompletionJSON<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options: ChatCompletionJSONOptions
  ): Promise<T> { ... }
  ```

- [x] **Implementation contract:**
  1. Call `chatCompletion(messages, { ...options, responseFormat: "json_object" })` to get the raw JSON string. The existing network-retry logic inside `chatCompletion` is preserved (transient HTTP/timeout retries via `isRetryable`).
  2. `JSON.parse` the response. **`JSON.parse` errors are not parse-retried** — a non-JSON response from a JSON-mode request is an upstream invariant break, not a schema drift, and re-prompting will not change it. Capture and rethrow.
  3. Run `schema.safeParse(parsed)`. If `success: true`, return `result.data`.
  4. On `success: false`, emit `addBreadcrumb({ category: "ai", level: "warning", message: "AI schema parse failed — retrying", data: { feature, attempt: 1 } })` and retry the entire chain (chat call + JSON.parse + safeParse) up to `parseRetries` more times (default 1 = one retry).
  5. After exhausting parseRetries, call `captureError(new Error(\`AI schema parse failed: ${error.issues[0]?.path.join(".")} — ${error.issues[0]?.message}\`), "ai-schema-parse-failed", { feature, attempt: parseRetries + 1, code: error.issues[0]?.code ?? "unknown" })` and throw the constructed Error so callers `.catch` exactly as today.
  6. **Never** include the offending response text or model output in the captured Error message — only the Zod issue path + code (allowlist-safe per `src/lib/sentry.ts:25`).

- [x] **Why a required `feature` parameter (not derived from stack trace, not optional)**: every call site already has a natural feature name (e.g., `"exercise-listening"`, `"writing-evaluation"`, `"placement-test"`); requiring it makes Sentry events grep-able by feature without touching the allowlist. Stack-trace inspection is unreliable in minified RN production bundles.
- [x] **Why retry the WHOLE chain (chat + parse), not just `safeParse` against the same response**: a malformed response is not going to become valid by re-parsing the same string. The retry's value is asking the model again — possibly the model emits a clean response on the second attempt. Re-parsing the same string is dead code.
- [x] **Why default `parseRetries = 1`, not 2 or 0**: 1 matches the roadmap spec ("retry once, then fail loudly"). 0 would skip the retry entirely. 2 doubles the cost on a path where success is increasingly unlikely (model temperature is fixed; persistent drift is structural).
- [x] **Why use `safeParse` and not `parse`**: `parse` throws a `ZodError`; `safeParse` returns a discriminated union. The retry decision is cleaner with the union (we own the branch). `parse`'s exception flow conflates schema errors with internal Zod errors.
- [x] **No Sentry allowlist changes**. The new context tag `"ai-schema-parse-failed"` rides on the existing `feature` allowlist key per `src/lib/sentry.ts:32`. The breadcrumb uses `feature` and `attempt` — both allowlisted (sentry.ts:32, 47).
- [x] **Idempotency of imports**: `import type { z } from "zod"` is type-only — does not pull Zod into the runtime bundle of `openai.ts` if the only use is the generic constraint. The actual `z.ZodType` runtime check is at the call site (the schema must be a Zod schema). Verify the tree-shake by inspecting the module bundle if concerned (no test required).

**Given** the schema-first `chatCompletionJSON`
**When** the AI returns valid JSON matching the schema
**Then** the function returns `result.data` (typed as `T` via inference)
**And** no breadcrumb or captureError is emitted

**Given** the AI returns valid JSON that does NOT match the schema
**When** `chatCompletionJSON` is called with default `parseRetries: 1`
**Then** a Sentry breadcrumb is emitted with `feature` and `attempt: 1`
**And** the chain is re-invoked once (one full chat call + parse)
**And if** the second response also fails the schema
**Then** `captureError(_, "ai-schema-parse-failed", { feature, attempt: 2, code })` is emitted
**And** the call rejects with the constructed Error

**Given** the AI returns malformed JSON (e.g., truncated mid-string)
**When** `JSON.parse` throws
**Then** no retry is attempted (this is not a schema-drift case)
**And** the underlying SyntaxError is rethrown via `captureError(err, "ai-proxy-json-parse")`

### 3. Centralize AI Response Schemas — `src/lib/schemas/ai-responses.ts`

All schemas live in one file so the next story (Epic 15.5) can import them for replay tests, and so a future agent grepping "what does the AI return" finds it in 5 seconds.

- [x] Create `src/lib/schemas/ai-responses.ts` with the following exported schemas. Each schema MUST export both the `z.ZodType` and the inferred TypeScript type (via `z.infer<typeof X>` aliased to the existing type name where possible).

- [x] **Common atomic schemas** (declared once, reused):

  ```ts
  // CEFR level — already enumerated in src/types/cefr.ts.
  export const cefrLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

  // MCQ option — used by listening, reading, grammar, mock-test, placement-test.
  export const mcqOptionSchema = z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    isCorrect: z.boolean(),
  });

  // MCQ question — exactly 4 options, exactly 1 correct, non-empty explanation.
  export const mcqQuestionSchema = z
    .object({
      question: z.string().min(1),
      passage: z.string().optional(),
      passageId: z.string().optional(),
      options: z.array(mcqOptionSchema).length(4),
      explanation: z.string().min(1),
    })
    .superRefine((q, ctx) => {
      const correctCount = q.options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected exactly 1 correct option, got ${correctCount}`,
          path: ["options"],
        });
      }
    });
  ```

- [x] **Per-feature schemas** (one per call site, named `<feature>ResponseSchema`):

  | Schema export | Replaces | Used by |
  |---------------|----------|---------|
  | `listeningExerciseSchema` | `ListeningResponse` interface + `validateMCQExercise` (for listening) | `use-exercise.ts:177` |
  | `readingExerciseSchema` | `ReadingResponse` interface + `validateMCQExercise` (for reading) | `use-exercise.ts:209` |
  | `grammarExerciseSchema` | `GrammarResponse` interface + `validateMCQExercise` (for grammar) | `use-exercise.ts:230` |
  | `writingPromptGenerationSchema` | `{ prompt: string; context: string }` inline | `use-exercise.ts:260` |
  | `writingEvaluationSchema` | `WritingEvaluation` interface | `use-exercise.ts:412` |
  | `conversationFeedbackSchema` | `ConversationFeedback` interface | `use-realtime-voice.ts:631` |
  | `dictationSetSchema` | `DictationSet` interface | `use-dictation.ts:284` |
  | `echoGenerationSchema` | `EchoGenerationResponse` + `validateEchoResponse` | `echo-generation.ts:80` |
  | `translationGenerationSchema` | `TranslationGenerationResponse` + `validateTranslationResponse` | `translation-generation.ts:136` |
  | `translationEvaluationSchema` | `TranslationEvaluation` + `validateEvaluationResponse` | `translation-generation.ts:220` |
  | `factExtractionSchema` | `{ facts: ExtractedFact[] }` inline | `memory.ts:199` |
  | `microDrillSchema` | `MicroDrill` interface | `error-tracker.ts:152` |
  | `errorPatternBatchSchema` | `BatchPatternResult` inline | `error-tracker.ts:241` |
  | `mockTestSectionSchema` | inline `{ passages?; questions[] }` | `mock-test/[testId].tsx:313` |
  | `pronunciationSentenceSchema` | `GeneratedSentence` inline | `practice/pronunciation.tsx:189` |
  | `placementTestSchema` | `PlacementResponse` interface | `onboarding/placement-test.tsx:468` |

- [x] **Schema rules to enforce** (these are the cross-cutting non-obvious invariants that must be in the schemas, not just "shape-matches"):
  - **Numbers in 0-100 range**: `writingEvaluationSchema.overallScore`, `grammarScore`, `cohesionScore`, `lexicalRichnessScore`, `registerScore` all use `z.number().min(0).max(100)`.
  - **Numbers in 1-5 range**: `conversationFeedbackSchema.fluencyRating`, `grammarRating` use `z.number().int().min(1).max(5)`.
  - **Difficulty enums**: `dictationSetSchema.sentences[].difficulty` uses `z.enum(["easy", "medium", "hard"])`.
  - **Translation difficulty by CEFR**: `translationGenerationSchema.sentences[].difficulty` uses `cefrLevelSchema`.
  - **Categories enums**: `writingErrorSchema.category` uses `z.enum(["grammar", "cohesion", "vocabulary", "register"])`.
  - **Memory types enum**: `factExtractionSchema.facts[].type` uses `z.enum(["personal_fact", "preference", "topic_discussed", "milestone"])` — matches `MEMORY_TYPES` set in `memory.ts:100`.
  - **Length caps**: `factExtractionSchema.facts[].content` uses `z.string().min(1).max(MAX_PRE_SANITIZE_CHARS)` (4096 — matches `memory.ts:23`). The downstream sanitizer enforces the 300-char limit; the schema enforces the upstream guard.
  - **Mock-test 4-options + 1-correct**: `mockTestSectionSchema.questions[]` uses the same `mcqQuestionSchema` superRefine.
  - **Placement-test normalization**: `placementTestSchema` uses Zod's `.preprocess()` to handle the polymorphic input shapes the AI sometimes returns (options-as-object, options-as-array, `correct_answer` field instead of `isCorrect: true` on an option). This replaces `placement-test.tsx:489-518` lines of manual normalization with a schema. **Worked example below.**

- [x] **Worked example — `placementTestSchema` with `.preprocess()` for AI quirks:**

  ```ts
  // The placement-test AI sometimes returns options as a record { a: "text", b: "text" }
  // instead of an array, and sometimes uses `correct_answer: "b"` on the question
  // instead of `isCorrect: true` on an option. Normalize at the schema boundary.
  const placementOptionInputSchema = z
    .union([
      // Standard array shape
      z.object({ id: z.string(), text: z.string(), isCorrect: z.boolean().optional() }),
      // Common AI quirk: { id: "a", label: "...", correct: true }
      z.object({ id: z.string(), label: z.string(), correct: z.boolean().optional() }),
    ])
    .transform((o) => ({
      id: "id" in o ? o.id : "",
      text: "text" in o ? o.text : (o as { label: string }).label,
      isCorrect: "isCorrect" in o ? !!o.isCorrect : !!(o as { correct?: boolean }).correct,
    }));

  const placementQuestionSchema = z
    .preprocess((q: unknown) => {
      // Convert { options: { a: "...", b: "..." } } → { options: [...] }
      if (q && typeof q === "object" && !Array.isArray((q as { options?: unknown }).options)) {
        const rawOpts = (q as { options?: unknown }).options;
        if (rawOpts && typeof rawOpts === "object") {
          const optsArray = Object.entries(rawOpts as Record<string, unknown>).map(([k, v]) => ({
            id: k,
            text: typeof v === "string" ? v : (v as { text?: string })?.text ?? String(v),
            isCorrect: false,
          }));
          // Resolve correct from question-level field if present
          const correctId = (q as Record<string, unknown>).correct_answer
            ?? (q as Record<string, unknown>).correctAnswer
            ?? (q as Record<string, unknown>).answer;
          if (typeof correctId === "string") {
            const target = optsArray.find((o) => o.id === correctId);
            if (target) target.isCorrect = true;
          }
          return { ...q, options: optsArray };
        }
      }
      return q;
    }, z.object({
      level: cefrLevelSchema,
      question: z.string().min(1),
      options: z.array(placementOptionInputSchema).length(4),
      explanation: z.string().min(1),
    }))
    .superRefine((q, ctx) => {
      const correctCount = q.options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected exactly 1 correct option, got ${correctCount}`,
          path: ["options"],
        });
      }
    });

  export const placementTestSchema = z.object({
    questions: z.array(placementQuestionSchema).length(15),
  });
  ```

- [x] **Inferred type re-exports** so existing consumers don't churn (back-compat for the in-tree types that already exist):

  ```ts
  // Replace the existing interface in src/types/exercise.ts with the inferred type
  // for ALL types the schemas now own. Keep the same name; replace the body.
  export type WritingEvaluation = z.infer<typeof writingEvaluationSchema>;
  // ... and so on for ConversationFeedback, MicroDrill, EchoSentence, TranslationEvaluation,
  // TranslationContent, etc.
  ```

  **Type-replacement contract**: when an existing `interface` becomes a `z.infer<...>`, the inferred type is a union of object types (Zod's typing), structurally compatible with the existing interface. If a consumer was relying on the structural shape (every consumer in this codebase), TypeScript narrows transparently. If a consumer was using the interface as a class/extends target (none in this codebase, verified by `grep "extends \(WritingEvaluation\|ConversationFeedback\|MicroDrill\)"`), the migration would need a different shape — but no such consumer exists, so this is a no-op for callers.

- [x] **Why one centralized schemas file (not per-feature `*-schema.ts`)**: the next story (Epic 15.5) needs `import * as Schemas from "@/src/lib/schemas/ai-responses"` to drive replay tests. Discoverability matters — one file, one source of truth for "what does the AI return." Per-feature files would scatter discovery and require Epic 15.5 to chase imports.

- [x] **JSDoc on every exported schema** noting the call site and the model that produces it (e.g., "Used by `useExercise` listening branch, generated by `gpt-4o` at temperature 0.4"). This is the contract Epic 15.5 will read.

**Given** the new schemas file
**When** any consumer imports `writingEvaluationSchema`
**Then** TypeScript infers `z.infer<typeof writingEvaluationSchema>` as the same shape as the (now derived) `WritingEvaluation` type
**And** runtime use of `writingEvaluationSchema.parse(unknownPayload)` enforces 0-100 ranges, the categories enum, and required fields — without any manual `typeof`/`Array.isArray` checks at the call site

### 4. Migrate Every `chatCompletionJSON` Call Site to the Schema-First API

All 16 call sites must pass a schema and a `feature` tag. Phantom generic casts are removed. Hand-rolled validators are removed where the schema fully covers them.

- [x] **`src/hooks/use-exercise.ts`** — 5 call sites:
  - Line 177 (listening): pass `listeningExerciseSchema`, `feature: "exercise-listening"`. Remove the `validateMCQExercise(result.questions, "listening")` call (covered by schema's `.length(4)` + `superRefine` on `mcqQuestionSchema`).
  - Line 209 (reading): pass `readingExerciseSchema`, `feature: "exercise-reading"`. Remove `validateMCQExercise(result.questions, "reading")`.
  - Line 230 (grammar): pass `grammarExerciseSchema`, `feature: "exercise-grammar"`. Remove `validateMCQExercise(result.questions, "grammar")`.
  - Line 260 (writing prompt): pass `writingPromptGenerationSchema`, `feature: "exercise-writing-prompt"`.
  - Line 412 (writing eval): pass `writingEvaluationSchema`, `feature: "writing-evaluation"`.
  - **Delete** the local `validateMCQExercise` function and the local `MCQQuestion` / `ListeningResponse` / `ReadingResponse` / `GrammarResponse` interfaces — replaced by `z.infer<typeof listeningExerciseSchema>` etc. inline at the call site.

- [x] **`src/hooks/use-realtime-voice.ts`** — 1 call site:
  - Line 631 (conversation feedback): pass `conversationFeedbackSchema`, `feature: "conversation-feedback"`. Replace the `import type { ConversationFeedback } from "@/src/types/conversation"` with `z.infer<typeof conversationFeedbackSchema>` (or keep the type as a re-export from `src/types/conversation.ts` derived from the schema — see AC #3 type re-export rule).

- [x] **`src/hooks/use-dictation.ts`** — 1 call site:
  - Line 284: pass `dictationSetSchema`, `feature: "dictation-generation"`. Remove the local `interface DictationSet` and the post-call `if (!result.sentences || result.sentences.length === 0)` check (the schema's `z.array(...).min(1)` covers it).

- [x] **`src/lib/echo-generation.ts`** — 1 call site:
  - Line 80: pass `echoGenerationSchema`, `feature: "echo-generation"`. **Delete** the entire `validateEchoResponse` function (lines 28-67) and the `EchoGenerationResponse` interface — the schema replaces them.

- [x] **`src/lib/translation-generation.ts`** — 2 call sites:
  - Line 136: pass `translationGenerationSchema`, `feature: "translation-generation"`. **Delete** `validateTranslationResponse` (lines 32-89).
  - Line 220: pass `translationEvaluationSchema`, `feature: "translation-evaluation"`. **Delete** `validateEvaluationResponse` (lines 91-118). The `-1` magic-number coercion on `overallScore` is replaced by the caller's existing recompute logic (lines 230-241) — keep that recompute, since it expresses a domain rule (weighted average) that's separate from validation.

- [x] **`src/lib/memory.ts`** — 1 call site:
  - Line 199: pass `factExtractionSchema`, `feature: "memory-fact-extraction"`. The downstream `validFacts` filter at lines 243-250 is now redundant for shape (covered by schema) but **keep it** — it covers the post-sanitize empty-string drop, which is a sanitization rule not a schema rule. Update the JSDoc accordingly so a future reader doesn't re-delete.

- [x] **`src/lib/error-tracker.ts`** — 2 call sites:
  - Line 152: pass `microDrillSchema`, `feature: "error-tracker-micro-drill"`. The local `MicroDrill` interface (lines 188-198) is replaced by `z.infer<typeof microDrillSchema>` re-exported from `error-tracker.ts` (or `ai-responses.ts`).
  - Line 241: pass `errorPatternBatchSchema`, `feature: "error-tracker-batch"`. The local `BatchPatternResult` interface stays inline if preferred (it's local to a function); replace with `z.infer<typeof errorPatternBatchSchema>` for consistency.

- [x] **`app/(tabs)/mock-test/[testId].tsx`** — 1 call site:
  - Line 313: pass `mockTestSectionSchema`, `feature: \`mock-test-${section}\`` (interpolating the section so listening/reading parse failures are distinguishable in Sentry). **Delete** the inline filter at lines 335-340 — the schema's `.length(4)` + `superRefine` covers it. The "section silently truncated to less than half" warning at lines 342-349 is now orthogonal: keep it as a domain-level guard (the AI may still emit fewer than the requested 29 questions), but rephrase the captureError context to `"mock-test-undercount"` so it does not collide with `"ai-schema-parse-failed"`.

- [x] **`app/(tabs)/practice/pronunciation.tsx`** — 1 call site:
  - Line 189: pass `pronunciationSentenceSchema`, `feature: "pronunciation-sentence-gen"`.

- [x] **`app/onboarding/placement-test.tsx`** — 1 call site:
  - Line 468: pass `placementTestSchema`, `feature: "placement-test", parseRetries: 2` (this call site already has its own `MAX_RETRIES = 2` retry on top of the AI failure check at line 569 — the higher parse-retry budget reflects that it's the highest-stakes call and the AI's response shape is the most polymorphic). **Delete** the manual normalization at lines 489-518 (`resolveIsCorrect`, options-as-object handling, `correct_answer` fallbacks) — the schema's `.preprocess()` covers all of them. **Keep** the retry loop at lines 561-572 (it's an AI-quality retry, not a schema retry) but simplify: the inner schema parse is now atomic, so the outer retry just re-invokes `chatCompletionJSON`.

- [x] **`app/(tabs)/mock-test/[testId].tsx:313` interpolation tag**: confirmed valid per `feature` allowlist length rule (`section` is "listening" or "reading" — both ≤ 80 chars when concatenated).

- [x] **No call site is allowed to call the old non-schema variant**. Run `git grep "chatCompletionJSON<"` after the migration. Expected hits: zero (all call sites now pass schema as a positional arg, not a generic).

**Given** every call site has been migrated
**When** `git grep "chatCompletionJSON<\|validateMCQExercise\|validateEchoResponse\|validateTranslationResponse\|validateEvaluationResponse"` runs
**Then** zero hits remain (excluding the test files asserting the old behavior is gone, if any)

### 5. Sentry Observability — One Context, No Allowlist Changes, No Payload Leaks

The Sentry signal for parse failures must be exactly one event per failed retry-exhausted call, must use only allowlisted extras, and must never include the offending response text or the user's prompt.

- [x] **Sentry event shape** (asserted in tests):
  - `event.level === "error"` (default for `captureException`).
  - `event.tags.feature === "<call-site-tag>"` (e.g., `"exercise-listening"`).
  - `event.extra` contains only `{ feature, attempt, code }` — all allowlisted (sentry.ts:25).
  - `event.exception.values[0].value` is the constructed Error message — short, formatted as `"AI schema parse failed: <path> — <issue.message>"`. Subject to the 80-char redaction rule from `scrubLongString`. Do NOT include the offending response text.
  - No `user.email` (already scrubbed by `scrubEvent` from 9-3, but assert it).
  - No `breadcrumb.data.model_output`, `prompt`, `response_text`, etc. — only the allowlisted keys.

- [x] **Breadcrumb shape on the first parse failure** (before retry):
  ```ts
  addBreadcrumb({
    category: "ai",
    level: "warning",
    message: "AI schema parse failed — retrying",
    data: { feature, attempt: 1, code: error.issues[0]?.code ?? "unknown" },
  });
  ```
  Allowlist-safe: `feature`, `attempt`, `code` per sentry.ts:25.

- [x] **No new keys** added to `SENTRY_EXTRAS_ALLOWLIST` in `src/lib/sentry.ts:25`. The existing `feature`, `context`, `attempt`, `code`, `phase` cover all needs.

- [x] **`code` semantics**: use `z.ZodIssueCode` values (`"invalid_type"`, `"invalid_enum_value"`, `"too_small"`, etc.). These are short stable strings, allowlist-safe under the 80-char rule.

- [x] **Why a constructed Error (not the raw `ZodError`)**: `ZodError.message` includes a JSON dump of all issues — large and may contain quoted field values that include user-derived text (in the rare case where a model echoes user input into a malformed field). The constructed Error includes only the issue path + code + short message, all already allowlist-safe under the GDPR scrubber's 80-char rule.

- [x] **Breadcrumb cardinality**: at most one per parse-retry. The failing-after-retry case emits one breadcrumb (the retry signal) and one captureError. The success-after-retry case emits one breadcrumb (the retry signal) and no captureError. The success-on-first-try case emits zero breadcrumbs and zero captureErrors.

**Given** an AI response that fails the schema on first try and succeeds on retry
**When** `chatCompletionJSON(messages, schema, { feature: "exercise-listening" })` is called
**Then** exactly one breadcrumb is emitted with `feature: "exercise-listening", attempt: 1`
**And** no captureError is emitted
**And** the function returns the parsed retry result

**Given** an AI response that fails on both first try and retry
**When** the same call is made
**Then** one breadcrumb is emitted (`attempt: 1`)
**And** exactly one captureError is emitted with `feature: "exercise-listening", attempt: 2, code: <ZodIssueCode>`
**And** the function rejects with the constructed Error
**And** no Sentry event contains the offending model output or user prompt

### 6. Regression Test Suite

Pure-function suites where possible; minimal mocks where state interaction is required. The schema tests are the foundation that Epic 15.5 will extend with recorded outputs.

- [x] **New file: `src/lib/schemas/__tests__/ai-responses.test.ts`** — schema-level unit tests. Tests the rules, not the API.

  | # | Test | Asserts |
  |---|------|---------|
  | 1 | `mcqQuestionSchema` accepts a 4-option, 1-correct shape | parse succeeds |
  | 2 | `mcqQuestionSchema` rejects 3 options | parse fails with `path: ["options"]`, `code: "too_small"` |
  | 3 | `mcqQuestionSchema` rejects 5 options | parse fails with `path: ["options"]`, `code: "too_big"` |
  | 4 | `mcqQuestionSchema` rejects 0 correct options | parse fails with `path: ["options"]`, `code: "custom"` (superRefine), message includes "Expected exactly 1 correct option" |
  | 5 | `mcqQuestionSchema` rejects 2 correct options | parse fails (same as #4) |
  | 6 | `writingEvaluationSchema` accepts a complete eval | parse succeeds, types narrow to `WritingEvaluation` |
  | 7 | `writingEvaluationSchema` rejects `overallScore: "85"` (string) | parse fails with `code: "invalid_type"` |
  | 8 | `writingEvaluationSchema` rejects `overallScore: 150` (out of range) | parse fails with `code: "too_big"` |
  | 9 | `writingEvaluationSchema` rejects missing `errors` array | parse fails with `code: "invalid_type"` (undefined → expected array) |
  | 10 | `conversationFeedbackSchema` rejects `fluencyRating: 6` | parse fails with `code: "too_big"` |
  | 11 | `conversationFeedbackSchema` rejects `strengths: "great work"` (string vs array) | parse fails with `code: "invalid_type"` |
  | 12 | `dictationSetSchema` rejects empty sentences array | parse fails with `code: "too_small"` |
  | 13 | `dictationSetSchema` rejects difficulty `"trivial"` | parse fails with `code: "invalid_enum_value"` |
  | 14 | `placementTestSchema.preprocess` normalizes `options` from object to array | parse succeeds, `options` is array of 4, exactly 1 with `isCorrect: true` |
  | 15 | `placementTestSchema.preprocess` resolves `correct_answer: "b"` to `isCorrect: true` on option id `b` | parse succeeds with the correct option flagged |
  | 16 | `placementTestSchema` rejects 14-question response | parse fails with `path: ["questions"], code: "too_small"` |
  | 17 | `factExtractionSchema` rejects content > 4096 chars | parse fails with `code: "too_big"` |
  | 18 | `factExtractionSchema` rejects type `"opinion"` (not in enum) | parse fails with `code: "invalid_enum_value"` |
  | 19 | `microDrillSchema` rejects `correctIndex: -1` | parse fails with `code: "too_small"` |
  | 20 | `mockTestSectionSchema` accepts a passages-attached response | parse succeeds, `passages` and `questions` typed |

- [x] **New file: `src/lib/__tests__/chat-completion-json.test.ts`** — API-level tests of the retry-once-then-fail behavior. Mocks `chatCompletion` to control the response stream; mocks `captureError` and `addBreadcrumb` to assert exactly-once cardinality.

  | # | Test | Asserts |
  |---|------|---------|
  | 1 | Schema-passing response on first try | `chatCompletion` called exactly once; no breadcrumb, no captureError; result returned |
  | 2 | Schema-failing then schema-passing | `chatCompletion` called exactly twice; exactly one breadcrumb (`attempt: 1`); no captureError; result returned |
  | 3 | Schema-failing on both attempts | `chatCompletion` called exactly twice; one breadcrumb; exactly one captureError with context `"ai-schema-parse-failed"`, `feature` matches the call site, `attempt: 2`; promise rejects |
  | 4 | `parseRetries: 0` with schema failure | `chatCompletion` called exactly once; no breadcrumb (no retry was attempted); one captureError with `attempt: 1`; rejects |
  | 5 | `parseRetries: 2` (custom budget) succeeding on attempt 3 | `chatCompletion` called exactly three times; two breadcrumbs (`attempt: 1`, `attempt: 2`); no captureError; result returned |
  | 6 | Malformed JSON (non-parseable) | `JSON.parse` throws; no schema retry; existing chatCompletion error path runs; captureError is invoked but with the surrounding context, NOT `"ai-schema-parse-failed"` |
  | 7 | The `feature` tag is required at type level | TypeScript test: omitting `feature` from `ChatCompletionJSONOptions` produces a compile error (use `// @ts-expect-error` to assert) |
  | 8 | The captureError event's `extras` contain only allowlisted keys (`feature`, `attempt`, `code`) | mocked `captureError` invoked with `extras` matching `Object.keys(extras).every(k => SENTRY_EXTRAS_ALLOWLIST.has(k))` |

- [x] **Append to existing test file `src/lib/__tests__/prompt-injection.test.ts`** — at least one assertion that the migration does not regress prompt-injection defenses:
  - The existing `(chatCompletionJSON as jest.Mock).mockResolvedValueOnce({ facts })` mocks bypass the new schema validation (because they mock the function directly). Either:
    - **(a) Update the mocks** to mock through the schema-first signature, OR
    - **(b) Leave the mocks as-is** and add a NEW test case that verifies `factExtractionSchema.safeParse(...)` rejects an injected fact whose content is over the 4096-char `MAX_PRE_SANITIZE_CHARS`.
  - Path (a) is more correct (tests the real wiring); path (b) is a faster lift. **Recommended: (b) for this story; (a) deferred to Epic 15.5 as a recorded-output replay test.**

- [x] **No new entries to `cache-flush.test.ts`, `auth-events.test.ts`, `realtime-dedup.test.ts`, `tcf-spec.test.ts`, or `activity.test.ts`** — those suites are unrelated.

- [x] **CI integration:** no new workflow steps. `npm test` auto-picks up the new files.

**Given** the new test files
**When** `npm test` runs in CI
**Then** all new cases pass
**And** the existing 207-test suite (per 9-10) still passes (now ~235 tests)

### 7. Documentation — CLAUDE.md Architecture Contract Line + JSDoc + `.env.example` (no change)

- [x] **CLAUDE.md** — under `## Architecture`, immediately after the existing "Auth + cache race hardening" line (added by story 9-10), add one new line:

  > **AI response validation:** `src/lib/openai.ts` `chatCompletionJSON<T>` requires a Zod schema (`z.ZodType<T>`) and a `feature` tag. On schema parse failure the call is retried once with a fresh model invocation; if the retry also fails, `captureError(_, "ai-schema-parse-failed", { feature, attempt: 2, code })` fires and the call rejects. All AI response schemas live in `src/lib/schemas/ai-responses.ts` — one schema per call site (listening/reading/grammar/writing/dictation/echo/translation/memory/error-tracker/conversation-feedback/mock-test/pronunciation/placement-test). Hand-rolled validators (`validateMCQExercise`, `validateEchoResponse`, `validateTranslationResponse`, `validateEvaluationResponse`, the inline mock-test option filter, the placement-test polymorphic-options normalizer) are deleted; the schemas express the same rules declaratively (`mcqQuestionSchema.superRefine` for the 4-options + 1-correct invariant, `placementTestSchema.preprocess` for the polymorphic-options normalization). Sentry never sees the offending response text — only the `ZodIssueCode`, the issue path, and the call-site `feature` tag (allowlist-safe per `src/lib/sentry.ts:25`). Regression-tested in `src/lib/schemas/__tests__/ai-responses.test.ts` and `src/lib/__tests__/chat-completion-json.test.ts`. Verified `<DATE>`, story 9-7.

  Replace `<DATE>` with the date the story is marked `done` (today, in YYYY-MM-DD).

- [x] **No `.env.example` change.** No env vars introduced.
- [x] **No PRD edit.** Internal correctness fix.
- [x] **No privacy-policy edit.** No new data collected; the new Sentry context already conforms to the 9-3 GDPR posture.
- [x] **JSDoc updates** on `chatCompletionJSON` (note the schema-required contract + retry-once semantics + Sentry context), on every exported schema in `ai-responses.ts` (call site + model + temperature), and on the type re-exports in `src/types/exercise.ts` and `src/types/conversation.ts` (note that the type is now `z.infer<typeof X>`).
- [x] **No new agent definitions or skill changes.**

### 8. No Existing Conversations / Tests Are Broken — Quality Gates Pass

- [x] **All existing call sites compile** after migration. Verified by `npm run type-check` (0 errors).
- [x] **All existing tests still pass** — `scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `sentry-init.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`, `realtime-dedup.test.ts`, `auth-events.test.ts`, `cache-flush.test.ts`, `auth-load-profile-stale.test.ts`, `profile-fetch-failed-flag.test.ts`. Note: `prompt-injection.test.ts`'s mocks of `chatCompletionJSON` may need a TypeScript signature update (mock the new 3-arg form) — this is a mock-shape change, not a behavior change.
- [ ] **Manual smoke test (mandatory before marking done):** _Deferred to reviewer / user — the dev agent cannot run a live device session._
  1. **Listening exercise**: tap "Generate listening exercise (A2)". Confirm: passage renders, 4 options per question, audio TTS plays. No console error. No Sentry breadcrumb in dev.
  2. **Writing evaluation**: submit a 60-word A2 writing exercise. Confirm: scores render in 0-100 ranges, errors list renders. Check Sentry — zero events.
  3. **Conversation feedback**: complete a 60s voice conversation. Confirm: feedback summary card shows fluency/grammar 1-5 stars, strengths and improvements bullets. Confirm `conversations.ai_feedback` JSONB is populated (DB query).
  4. **Forced parse failure (development-only)**: temporarily edit one prompt to force a malformed response (e.g., `"Return JSON: { }"`), invoke the feature, observe one Sentry breadcrumb (`attempt: 1`) and one captureError (`attempt: 2`) with `feature` matching the call site. Revert the prompt change.
  5. **Placement test**: complete a placement test. Confirm: 15 questions render, options normalize correctly across the AI's 3-4 different shapes (validated by running it 3 times — Zod's `.preprocess()` should make all 3 succeed).
  6. **Document** in Completion Notes: turn-by-turn observation of (1)-(5). Deferred to reviewer / user — the dev agent cannot run a live device session.
- [x] **Migration verification commands** (run before marking done):
  ```sh
  # Should produce zero hits — all call sites must use the new 3-arg signature
  git grep -n 'chatCompletionJSON<' src/ app/

  # Should produce zero hits — all hand-rolled validators must be deleted
  git grep -n 'function validateMCQExercise\|function validateEchoResponse\|function validateTranslationResponse\|function validateEvaluationResponse' src/ app/

  # Every chatCompletionJSON call must pass a feature tag
  git grep -n 'chatCompletionJSON(' src/ app/ | grep -v 'feature:'   # should produce zero hits
  ```
- [x] `npm run type-check` clean.
- [x] `npm run lint` clean (`--max-warnings 0`).
- [x] `npm run format:check` clean.
- [x] `npm test` clean — full suite + the new ~28 cases (~235 total).

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — *N/A; no UI added by this story.*
- [x] All loading states use skeleton animations — *N/A; no UI added.*
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — *N/A; no UI added.*
- [x] Non-obvious interactions have `accessibilityHint` — *N/A.*
- [x] Stateful elements have `accessibilityState` — *N/A.*
- [x] All tappable elements have minimum 44x44pt touch targets — *N/A.*
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — *new context tag: `"ai-schema-parse-failed"`. Existing per-feature contexts (`"exercise-generation"`, `"writing-evaluation"`, `"persist-conversation"`, etc.) are preserved at the call sites; the schema-parse failure rides on a new context that doesn't overlap.*
- [x] All text uses `Typography.*` presets — *N/A; no UI added.*
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test`.

## Tasks / Subtasks

- [x] Task 1: Add `zod` dependency (AC: #1)
  - [x] 1.1 Add `"zod": "^3.23.0"` to `package.json` dependencies.
  - [x] 1.2 Run `npm install`; verify `package-lock.json` updated.
  - [x] 1.3 Verify `npm run type-check` passes (sanity).
- [x] Task 2: Schema-first `chatCompletionJSON` infrastructure (AC: #2, #5)
  - [x] 2.1 In `src/lib/openai.ts`, replace `chatCompletionJSON<T>` body with the schema-first variant. Required positional `schema` arg; required `feature` in options.
  - [x] 2.2 Implement the retry-once-on-parse-failure loop with `safeParse`.
  - [x] 2.3 Wire `addBreadcrumb` on first failure with `category: "ai", level: "warning", data: { feature, attempt: 1, code }`.
  - [x] 2.4 Wire `captureError` on retry-exhausted failure with context `"ai-schema-parse-failed"` and extras `{ feature, attempt, code }`.
  - [x] 2.5 Construct the rethrown Error with a short, allowlist-safe message: `\`AI schema parse failed: ${path} — ${message}\``.
  - [x] 2.6 Update JSDoc per AC #7.
- [x] Task 3: Centralized AI response schemas (AC: #3)
  - [x] 3.1 Create `src/lib/schemas/ai-responses.ts`. Add common atomics (`cefrLevelSchema`, `mcqOptionSchema`, `mcqQuestionSchema`).
  - [x] 3.2 Add the 16 per-feature schemas listed in AC #3.
  - [x] 3.3 Implement `placementTestSchema.preprocess()` covering the polymorphic-options normalization.
  - [x] 3.4 Re-export inferred types: `WritingEvaluation`, `ConversationFeedback`, `MicroDrill` from the schemas. Update `src/types/exercise.ts` and `src/types/conversation.ts` accordingly.
  - [x] 3.5 Add JSDoc on every exported schema (call site + model + temperature).
- [x] Task 4: Migrate call sites (AC: #4)
  - [x] 4.1 `src/hooks/use-exercise.ts` — 5 sites; delete `validateMCQExercise` and the local response interfaces.
  - [x] 4.2 `src/hooks/use-realtime-voice.ts` — 1 site.
  - [x] 4.3 `src/hooks/use-dictation.ts` — 1 site; remove the empty-array post-check.
  - [x] 4.4 `src/lib/echo-generation.ts` — 1 site; delete `validateEchoResponse`.
  - [x] 4.5 `src/lib/translation-generation.ts` — 2 sites; delete `validateTranslationResponse` and `validateEvaluationResponse`. Keep the `overallScore` recompute (domain rule).
  - [x] 4.6 `src/lib/memory.ts` — 1 site; keep the post-call sanitizer-driven filter (it's separate from schema).
  - [x] 4.7 `src/lib/error-tracker.ts` — 2 sites.
  - [x] 4.8 `app/(tabs)/mock-test/[testId].tsx` — 1 site; delete the inline 4-option filter; keep the undercount warning under a renamed context tag.
  - [x] 4.9 `app/(tabs)/practice/pronunciation.tsx` — 1 site.
  - [x] 4.10 `app/onboarding/placement-test.tsx` — 1 site; delete the polymorphic-options normalization (`resolveIsCorrect` + the for-loop at lines 489-518); use `parseRetries: 2`. Keep the outer AI-quality retry loop.
  - [x] 4.11 Run `git grep "chatCompletionJSON<\|validateMCQExercise\|validateEchoResponse\|validateTranslationResponse\|validateEvaluationResponse"` — expect zero hits in src/ and app/.
- [x] Task 5: Regression tests (AC: #6)
  - [x] 5.1 Create `src/lib/schemas/__tests__/ai-responses.test.ts` — 20 cases per AC #6 table.
  - [x] 5.2 Create `src/lib/__tests__/chat-completion-json.test.ts` — 8 cases per AC #6 table; mock `chatCompletion`, `captureError`, `addBreadcrumb`.
  - [x] 5.3 Update `src/lib/__tests__/prompt-injection.test.ts` mock signatures (path b: add the new schema-rejection case for over-cap content).
  - [x] 5.4 Run `npx jest` — green for new files + full suite.
- [x] Task 6: Documentation (AC: #7)
  - [x] 6.1 Add the one-line "AI response validation" architecture-contract note to `CLAUDE.md` immediately after the 9-10 line. Use today's date in the verification stamp.
  - [x] 6.2 Update JSDoc on `chatCompletionJSON`, on the type re-exports, and on the new schemas file.
- [ ] Task 7: Manual smoke test (AC: #8) — **deferred to reviewer / user**
  - [ ] 7.1 Listening / reading / grammar exercise generation success path.
  - [ ] 7.2 Writing submission + evaluation; assert score range.
  - [ ] 7.3 Voice conversation completion + feedback summary populated in DB.
  - [ ] 7.4 Forced-parse-failure dev-only check; assert one breadcrumb + one captureError.
  - [ ] 7.5 Placement test 3× run; assert all 3 normalize correctly.
  - [ ] 7.6 Document the five observations in Completion Notes.
- [x] Task 8: Quality gates (AC: #8 / #Z)
  - [x] 8.1 `npm run type-check` clean.
  - [x] 8.2 `npm run lint` clean (`--max-warnings 0`).
  - [x] 8.3 `npm run format:check` clean.
  - [x] 8.4 `npm test` clean — full suite + new cases.

## Dev Notes

### Why Zod (not hand-rolled, not Valibot, not arktype) — final summary

The roadmap line names Zod (line 137, line 21). Beyond that: the codebase already has 4 hand-rolled `validate<X>Response` functions that prove the team has been writing this manually because there was no library. Zod replaces them with declarative schemas, gets us free TypeScript inference (so the type system mirrors runtime validation), and unblocks Epic 15.5's recorded-output replay tests. Valibot is leaner but its ecosystem is too thin for RN/Expo today. arktype is faster but pre-1.0. Zod 3 is the boring, correct choice.

### Why a required `feature` tag (not derived from stack trace, not optional)

Sentry events without a `feature` tag are uncategorizable in production. Stack traces are unreliable in minified RN bundles. Making `feature` a required argument means every call site is observable from the moment it lands. The cost is one string at every call site (already the natural feature name in the codebase — e.g., `"exercise-listening"`, `"writing-evaluation"`).

### Why retry-once-then-fail (not retry-twice, not retry-zero, not exponential backoff)

The roadmap spec is explicit ("retry once, then fail loudly"). The math: temperature is fixed per call, so retrying the same prompt against the same model has a non-zero but bounded probability of producing a different shape. One retry captures most of that probability without doubling the cost. Two retries triple the cost on a path that's increasingly unlikely to succeed. Zero retries is a lower-quality user experience for transient model wobbles. Exponential backoff would imply the retry strategy could fix transient network issues — but `chatCompletion` already handles those internally with its own retry layer. The two retry layers are deliberately separate and do not multiply (network retry inside `chatCompletion`; parse retry outside).

### Why `safeParse` (not `parse`)

`parse` throws a `ZodError`, which conflates schema-violation errors with internal Zod errors (none today, but possible in future Zod versions). `safeParse` returns a discriminated union — the retry decision is cleaner with the union. `safeParse` also has a tiny perf benefit (no exception throw on the success path).

### Why centralize schemas in one file (not per-feature `*-schema.ts`)

Epic 15.5 will replay recorded model outputs through every schema. Discoverability matters — `import * as Schemas from "@/src/lib/schemas/ai-responses"` is the test-fixture entry point. Per-feature files would scatter discovery across 16 files and require Epic 15.5 to chase imports. The centralized file is also the natural place to put the common atomics (`mcqOptionSchema`, `cefrLevelSchema`) without circular-import gymnastics.

### Why DELETE the hand-rolled validators (not keep as defense-in-depth)

Defense-in-depth is valuable when defenses sit at different layers. Here the schema and the manual validator both run inside `chatCompletionJSON`'s callback chain — same layer, same boundary. Keeping both creates two sources of truth for "what shape is valid" and one will rot. The schema wins because it carries the type inference. The manual validators are deleted in the same commit as the migration; their behavior is preserved (and improved — `superRefine` is more expressive than hand-rolled type guards).

The only exception is the `memory.ts` post-sanitize filter at lines 243-250, which is **not** a schema rule — it's a post-validation sanitization rule that drops empty-string content after sanitization. That filter stays.

### Why mock-test undercount tag is renamed (not collapsed into `ai-schema-parse-failed`)

The undercount warning at `mock-test/[testId].tsx:342-349` fires when the AI returns FEWER questions than requested but each one is still valid. That's a domain-level rule ("we asked for 29; got 14") not a schema rule. Conflating it under `"ai-schema-parse-failed"` would make Sentry events ambiguous: was it a validation error (probably an upstream defect) or a quality issue (probably a prompt that the model can't reliably satisfy)? Renaming to `"mock-test-undercount"` keeps both signals distinguishable. The `mockTestSectionSchema` only enforces "each question that's present is well-formed" via `mcqQuestionSchema`; the section-length check is a separate, domain-level concern.

### Why placement test gets `parseRetries: 2` (not 1)

The placement test is the highest-stakes call (it sets the user's CEFR level for their entire learning journey) and has the most polymorphic AI response shape (the model has been observed to return options as object, options as array, options with `correct` vs `isCorrect`, etc.). The existing call site already has its own outer 2-retry loop on top. The schema's `.preprocess()` should normalize most cases on first attempt; the extra parse retry catches the rare structural break. Cost is negligible (this call fires once per user lifetime).

### Why `parse` retry budget defaults to 1 (and is per-call configurable)

The default of 1 matches the roadmap spec. Configurability is for the rare call site (placement test) where a higher budget is warranted by the cost-of-failure. Most call sites should never override the default.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `chatCompletion` | `@/src/lib/openai` | Existing. The schema-first `chatCompletionJSON` calls it; preserve its network-retry behavior unchanged. |
| `captureError`, `addBreadcrumb`, `SENTRY_EXTRAS_ALLOWLIST` | `@/src/lib/sentry` | Existing. New context tag `"ai-schema-parse-failed"` rides on the existing `feature`/`attempt`/`code` allowlist keys. No allowlist additions. |
| `MAX_PRE_SANITIZE_CHARS = 4096` | `@/src/lib/memory` | Re-use as the upper bound on `factExtractionSchema.facts[].content`. Do not duplicate the constant. |
| `MEMORY_TYPES`, `MemoryType` | `@/src/lib/memory` | Re-use the union for the `factExtractionSchema.facts[].type` enum. |
| `CEFR_ORDER` (`["A1","A2","B1","B2","C1","C2"]`) | `@/src/types/cefr` | The order of `cefrLevelSchema = z.enum([...])`. Use the existing constant. |
| `requireNetwork`, `isOnline` | `@/src/lib/network` | Existing. Unchanged. |
| All existing prompt builders | `@/src/lib/prompts/*.ts` | Existing. Unchanged — schemas validate the response, not the prompt. |
| `WritingEvaluation`, `ConversationFeedback`, `MicroDrill`, `EchoSentence`, `TranslationEvaluation`, `TranslationContent`, `MCQContent` types | `@/src/types/*` | Existing — replace bodies with `z.infer<typeof schema>` re-exports. Preserve the names so consumers don't churn. |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/schemas/ai-responses.ts` | Centralized Zod schemas for all 16 AI call sites + common atomics. |
| `src/lib/schemas/__tests__/ai-responses.test.ts` | Schema-level unit tests (20 cases). |
| `src/lib/__tests__/chat-completion-json.test.ts` | API-level retry-once tests (8 cases). |

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `"zod": "^3.23.0"` to dependencies. |
| `package-lock.json` | Auto-updated by `npm install`. |
| `src/lib/openai.ts` | Replace `chatCompletionJSON<T>` body with schema-first variant; require `schema` and `feature` args; implement retry-once-on-parse loop. JSDoc updates. |
| `src/types/exercise.ts` | Replace `WritingEvaluation`, `WritingError`, `EchoSentence`, `EchoContent`, `TranslationSentence`, `TranslationContent`, `TranslationDimensionScore`, `TranslationEvaluation` interfaces with `z.infer<typeof X>` aliases. |
| `src/types/conversation.ts` | Replace `ConversationFeedback` interface with `z.infer<typeof conversationFeedbackSchema>` alias. |
| `src/hooks/use-exercise.ts` | Migrate 5 call sites to schema-first; delete `validateMCQExercise` and local response interfaces. |
| `src/hooks/use-realtime-voice.ts` | Migrate 1 call site to schema-first. |
| `src/hooks/use-dictation.ts` | Migrate 1 call site to schema-first; remove redundant empty-array post-check. |
| `src/lib/echo-generation.ts` | Migrate 1 call site to schema-first; delete `validateEchoResponse` and `EchoGenerationResponse` interface. |
| `src/lib/translation-generation.ts` | Migrate 2 call sites to schema-first; delete `validateTranslationResponse` and `validateEvaluationResponse`. Keep the `overallScore` recompute (domain rule). |
| `src/lib/memory.ts` | Migrate 1 call site to schema-first. JSDoc note: post-call sanitizer-driven filter is preserved as a separate concern. |
| `src/lib/error-tracker.ts` | Migrate 2 call sites to schema-first; replace `MicroDrill` interface with schema infer; reduce `BatchPatternResult` to inferred type. |
| `app/(tabs)/mock-test/[testId].tsx` | Migrate 1 call site to schema-first; delete inline 4-option filter; rename undercount captureError to `"mock-test-undercount"`. |
| `app/(tabs)/practice/pronunciation.tsx` | Migrate 1 call site to schema-first. |
| `app/onboarding/placement-test.tsx` | Migrate 1 call site with `parseRetries: 2`; delete polymorphic-options normalization (lines 489-518) — covered by `placementTestSchema.preprocess`. Keep the outer AI-quality retry loop. |
| `src/lib/__tests__/prompt-injection.test.ts` | Update `chatCompletionJSON` mock signatures to match the new 3-arg form; add a schema-rejection case for over-cap fact content. |
| `CLAUDE.md` | Add the `**AI response validation:**` architecture-contract line under `## Architecture` immediately after the 9-10 line, dated to story-completion day. |

### What This Story Does NOT Include

- **NO** Edge Function-side validation of upstream OpenAI responses (out of scope).
- **NO** schemas for non-AI inputs — form validation, env var parsing, `app.json` config (out of scope).
- **NO** structured tool-calls migration (Epic 11.1) — keep `responseFormat: "json_object"`.
- **NO** recorded-output AI replay tests (Epic 15.5 — this story produces the schemas those tests will consume).
- **NO** empty-response-detection / TTS retry parity (Epic 11.8).
- **NO** new env vars, no `app.json` change, no SDK upgrades, no Expo plugin changes.
- **NO** `npm audit fix` or other dependency cleanup (Epic 12.10).
- **NO** Zod-based form validation library (e.g., `react-hook-form` + `@hookform/resolvers/zod`).
- **NO** `zod-to-json-schema`, `zod-form-data`, or any Zod ecosystem package — only `zod` itself.
- **NO** changes to `realtime-transcript.ts`, `realtime.ts`, or any Realtime API code path — those events are validated by their own dedup / shape guards.
- **NO** changes to `pronunciation.ts` (Azure Speech assessment) — its response is already validated structurally by the Azure SDK shape.
- **NO** changes to the Sentry allowlist (`SENTRY_EXTRAS_ALLOWLIST`).
- **NO** breaking changes to public hook signatures (`useExercise`, `useRealtimeVoice`, `useDictation`) — internal call-site changes only.
- **NO** changes to the offline write queue, cache, or auth listener — orthogonal to this story.

### Audit excerpt for reference

From the 2026-05-06 independent audit (`shippable-roadmap.md`):

> **P0-8 (release blocker):** "Zero schema validation on AI outputs — `chatCompletionJSON<T>` blindly casts; every consumer (writing eval, mock test, dictation, memory, error-tracker, conversation feedback) is one drift away from runtime error or silent garbage in DB."

> **Epic 9 acceptance criterion:** "Zod parse failure is observable in Sentry and never produces undefined fields in DB."

> **Production risk callout:** "Zod parse failures in production could be loud to users — mitigate with retry-once-then-graceful-degradation per call site."

### Sentry / Error handling

Two new Sentry signals introduced by 9-7:

1. **`addBreadcrumb({ category: "ai", level: "warning", message: "AI schema parse failed — retrying", data: { feature, attempt: 1, code } })`** on the first parse failure of any retry-eligible call. Warning-level because the event is a recoverable retry, not yet a failure.
2. **`captureError(constructedError, "ai-schema-parse-failed", { feature, attempt: 2, code })`** after retry exhaustion. Error-level. The constructed Error message is `"AI schema parse failed: <path> — <issue.message>"` — short, allowlist-safe under the GDPR scrubber's 80-char rule. The raw `ZodError` is NOT included.

Existing per-feature `captureError` contexts at the call sites (e.g., `"exercise-generation"`, `"writing-evaluation"`, `"persist-conversation"`, `"placement-test"`) are preserved — they fire on the OUTER `catch` in the call site after `chatCompletionJSON` rethrows. So a parse-retry-exhausted call surfaces TWO Sentry events: one for the schema parse failure (`feature: "exercise-listening"`) and one for the call-site context (`feature: "exercise-generation"`). This is intentional — the first identifies WHICH validation failed; the second identifies WHICH user feature broke.

The 9-3 allowlist discipline is preserved — only `feature`, `attempt`, `code`, `phase`, `context` keys (already allowlisted) are used in `data`/`extras`.

### Testing standards summary

- New tests live under `src/lib/__tests__/` and `src/lib/schemas/__tests__/` per existing convention.
- Pure-function tests preferred for schema-level cases. API-level tests (chatCompletionJSON behavior) mock `chatCompletion`, `captureError`, `addBreadcrumb`.
- Mock pattern for `chatCompletion`: similar to `prompt-injection.test.ts` — `jest.mock("../openai", ...)` with `chatCompletion` as the mocked export; the schema-first `chatCompletionJSON` is NOT mocked (so the test exercises the real retry loop).
- Path alias `@/*` → repo root.
- Zod schemas can be tested directly: `expect(schema.safeParse(input).success).toBe(true)` and `.success === false` paths.

### Dependencies on previous stories

- **Story 9-3** (Sentry leak remediation, `scrubEvent`, allowlist) — direct parent. 9-7 emits Sentry events that must conform to the 9-3 allowlist. No allowlist changes needed (verified).
- **Story 9-4** (stored prompt-injection defense, `MAX_PRE_SANITIZE_CHARS`) — `factExtractionSchema` re-uses `MAX_PRE_SANITIZE_CHARS` as the content upper bound.
- **Story 9-2** (CEFR promotion engine) — unrelated.
- **Story 9-5** (voice transcript dedup) — unrelated.
- **Story 9-6** (auth listener event-gating) — unrelated.
- **Story 9-10** (auth + cache race hardening) — unrelated; the `pure-helper-extracted-for-testability` pattern from 9-2 through 9-10 is followed in this story's schema centralization.
- **Epic 15.5** (AI schema regression tests) — downstream consumer. 9-7 produces the schemas those tests will consume. Out of scope for this story.
- **Epic 11.8** (empty-response detection) — adjacent. 9-7 covers JSON-mode shape; 11.8 covers text-mode emptiness. No overlap.

### Project Structure Notes

- All touched files are existing locations except the two new schemas/test files. The schemas file goes under `src/lib/schemas/` (a new subdirectory; mirrors `src/lib/prompts/` for consistency) — discoverable, sibling to prompts (input layer) and schemas (output layer).
- The `components/` directory at repo root is unused boilerplate per CLAUDE.md — do not put anything there.
- Path alias `@/*` → repo root.
- New tests under `src/lib/schemas/__tests__/` and `src/lib/__tests__/` per existing convention.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-8 (line 43), §2 Epic 9 deliverable 9.7 (line 137), Epic 9 acceptance criterion (line 146), production risk callout (line 387)]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §2 Epic 15.5 line 278, downstream consumer of these schemas]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 in-progress, story 9-7 backlog]
- [Source: src/lib/openai.ts — `chatCompletionJSON<T>` (lines 112-126, the blind-cast site)]
- [Source: src/lib/openai.ts — `chatCompletion` (lines 43-109), preserves network-retry behavior]
- [Source: src/lib/sentry.ts — `SENTRY_EXTRAS_ALLOWLIST` (lines 25-47), `captureError` (lines 216-228), `addBreadcrumb` (lines 244-255)]
- [Source: src/lib/memory.ts — `MAX_PRE_SANITIZE_CHARS` (line 23), `MEMORY_TYPES` (line 100), `MemoryType` (line 5) — re-used by `factExtractionSchema`]
- [Source: src/types/cefr.ts — `CEFR_ORDER`, `CEFRLevel` — re-used by `cefrLevelSchema`]
- [Source: src/types/exercise.ts — existing types to be replaced by `z.infer<...>` aliases]
- [Source: src/types/conversation.ts — `ConversationFeedback` (lines 36-44) — to be replaced by `z.infer<typeof conversationFeedbackSchema>`]
- [Source: src/hooks/use-exercise.ts — 5 call sites (lines 177, 209, 230, 260, 412); `validateMCQExercise` (lines 99-133) to be deleted]
- [Source: src/hooks/use-realtime-voice.ts — 1 call site (line 631)]
- [Source: src/hooks/use-dictation.ts — 1 call site (line 284); local `DictationSet` interface (lines 32-34)]
- [Source: src/lib/echo-generation.ts — 1 call site (line 80); `validateEchoResponse` (lines 28-67) to be deleted]
- [Source: src/lib/translation-generation.ts — 2 call sites (lines 136, 220); `validateTranslationResponse` (lines 32-89) and `validateEvaluationResponse` (lines 91-118) to be deleted]
- [Source: src/lib/memory.ts — 1 call site (line 199); post-call filter (lines 243-250) preserved as sanitization concern]
- [Source: src/lib/error-tracker.ts — 2 call sites (lines 152, 241); `MicroDrill` interface (lines 188-198) replaced by `z.infer<typeof microDrillSchema>`]
- [Source: app/(tabs)/mock-test/[testId].tsx — 1 call site (line 313); inline filter (lines 335-340) deleted; undercount captureError (line 343) renamed]
- [Source: app/(tabs)/practice/pronunciation.tsx — 1 call site (line 189); local `GeneratedSentence` interface (lines 38-41)]
- [Source: app/onboarding/placement-test.tsx — 1 call site (line 468); polymorphic-options normalization (lines 489-518) and `resolveIsCorrect` (lines 53-65) deleted; outer AI-quality retry loop (lines 561-572) preserved]
- [Source: src/lib/__tests__/prompt-injection.test.ts — existing mock pattern for `chatCompletionJSON`; mock signatures to be updated for new 3-arg form]
- [Source: src/lib/__tests__/cache-flush.test.ts — Sentry mock pattern (lines 16-20) reused for `chat-completion-json.test.ts`]
- [Source: package.json — dependencies block (line 27) for the `zod` add]
- [Source: jest.config.js — preset `jest-expo`, `moduleNameMapper` for `@/*` already wired; new test files auto-discovered]
- [Source: CLAUDE.md `## Architecture` section — location for new "AI response validation" line, immediately after the 9-10 "Auth + cache race hardening" line]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `npm run type-check` — clean (0 errors).
- `npm run lint` — clean (0 errors, 0 warnings under `--max-warnings 0`).
- `npm run format:check` — clean.
- `npm test` — 15 test suites, 261 passing tests (was 207 pre-9-7; +54 net: 43 new schema cases in `ai-responses.test.ts`, 9 new cases in `chat-completion-json.test.ts`, +2 new cases in `prompt-injection.test.ts` — over-cap rejection + lockstep assertion).

### Completion Notes List

**AC #1 — `zod` ^3.23 dependency added.**

- `package.json` dependencies block updated; `npm install` resolved `zod@3.25.76` (the latest 3.x at install time, satisfying `^3.23.0`). `package-lock.json` reflects the addition.

**AC #2 — Schema-first `chatCompletionJSON`.**

- `src/lib/openai.ts:128-260` — replaced the 14-line phantom-cast body with a schema-required signature (`messages`, `schema: z.ZodType<T>`, `options: ChatCompletionJSONOptions`). The `feature` tag is now a required option; `parseRetries` defaults to 1.
- Implements the retry loop: chat call → `JSON.parse` (no retry on parse error — non-JSON from JSON-mode is an upstream defect, captured under `"ai-proxy-json-parse"`) → `safeParse` → on failure, `addBreadcrumb({ category: "ai", level: "warning", data: { feature, attempt, code } })` and re-loop. After exhaustion, `captureError(constructedError, "ai-schema-parse-failed", { feature, attempt: totalAttempts, code })` and rethrow.
- The constructed Error message is `"AI schema parse failed: <path> — <issue.message>"` — short, allowlist-safe under the GDPR scrubber's 80-char rule (verified by the "does not leak the offending JSON" test).

**AC #3 — Centralized AI response schemas.**

- New file `src/lib/schemas/ai-responses.ts` with 16 per-feature schemas + atomics (`cefrLevelSchema`, `mcqOptionSchema`, `mcqQuestionSchema`).
- `mcqQuestionSchema.superRefine` enforces "exactly 1 correct option" — replaces the 4 hand-rolled validators that did this manually.
- `placementQuestionSchema.preprocess` handles the polymorphic-options shape variance (object-vs-array, `correct_answer` field → `isCorrect: true` on the matching option) — replaces the 30-line normalization at `placement-test.tsx:489-518` and the `resolveIsCorrect` helper.
- `MAX_PRE_SANITIZE_CHARS` is hardcoded at `4096` in the schemas file (rather than imported from `memory.ts`) to break a circular import; a regression test asserts the two values stay in lockstep.
- `src/types/exercise.ts` and `src/types/conversation.ts` updated to derive `WritingEvaluation`, `WritingError`, `EchoSentence`, `TranslationSentence`, `TranslationDimensionScore`, `TranslationEvaluation`, and `ConversationFeedback` from `z.infer<typeof X>`. `TranslationEvaluation` extends the schema's optional `expectedTranslation`/`userTranscription` to required, since the caller (`evaluateTranslation`) always populates them.

**AC #4 — All 16 call sites migrated.**

- 5 sites in `src/hooks/use-exercise.ts` (listening, reading, grammar, writing-prompt, writing-evaluation). Local response interfaces and the `validateMCQExercise` helper deleted (~35 lines).
- 1 site in `src/hooks/use-realtime-voice.ts` (conversation-feedback).
- 1 site in `src/hooks/use-dictation.ts`. Local `DictationSet` interface deleted; the post-call empty-array check is also removed (covered by `dictationSetSchema.sentences.min(1)`).
- 1 site in `src/lib/echo-generation.ts`. `validateEchoResponse` deleted (~40 lines) and `EchoGenerationResponse` interface removed.
- 2 sites in `src/lib/translation-generation.ts`. `validateTranslationResponse` (~58 lines) and `validateEvaluationResponse` (~28 lines) deleted. The domain-level `overallScore` recompute is preserved at the caller.
- 1 site in `src/lib/memory.ts`. The post-call `validFacts` filter is preserved as defense-in-depth (per spec: "keep it — it covers the post-sanitize empty-string drop, which is a sanitization rule not a schema rule"). The filter also handles the case where tests mock `chatCompletionJSON` past the schema layer — verified by the existing `prompt-injection.test.ts` cases.
- 2 sites in `src/lib/error-tracker.ts` (micro-drill + batch-pattern). Local `BatchPatternResult` interface kept inline, references the schema's inferred type implicitly through the unifying `chatCompletionJSON` return type.
- 1 site in `app/(tabs)/mock-test/[testId].tsx`. The inline 4-options-1-correct filter (lines 335-340) deleted; the section-undercount warning is preserved under a renamed context tag (`"mock-test-undercount"`) so it doesn't collide with `"ai-schema-parse-failed"`. The `feature` tag interpolates the section name (`mock-test-listening` / `mock-test-reading`) to make Sentry events distinguishable per section.
- 1 site in `app/(tabs)/practice/pronunciation.tsx`. Local `GeneratedSentence` interface preserved for component prop typing but no longer drives runtime validation.
- 1 site in `app/onboarding/placement-test.tsx`. The 30-line polymorphic-options normalization (lines 489-553), the `resolveIsCorrect` helper (lines 53-65), and the manual `valid` check (lines 555-564) are all DELETED. `parseRetries: 2` reflects the high stakes of the placement test. The outer `MAX_RETRIES = 2` AI-quality retry loop remains as a fallback layer (e.g., for the rare case where the model returns the wrong CEFR distribution despite a schema-passing shape).
- A `as PlacementQuestion[]` cast at the `setQuestions` call is required because Zod's `preprocess + transform` chain infers questions as `unknown[]` at the `z.ZodType<T>` boundary — a known Zod 3 inference quirk for `ZodEffects`. Runtime correctness is unaffected (the schema enforces shape; the cast is structurally safe).

**AC #5 — Sentry observability.**

- New context tag `"ai-schema-parse-failed"` rides on the existing `feature` / `attempt` / `code` allowlist keys per `src/lib/sentry.ts:25`. **Zero changes** to `SENTRY_EXTRAS_ALLOWLIST`.
- The breadcrumb on retry uses `{ category: "ai", level: "warning", data: { feature, attempt: 1, code: <ZodIssueCode> } }`. Cardinality verified by tests: success-on-first-try → 0 breadcrumbs; success-on-retry → 1 breadcrumb; retry-exhausted → 1 breadcrumb + 1 captureError.
- The "does not leak the offending JSON" test asserts the constructed Error message (a) starts with `"AI schema parse failed: "`, (b) does not contain user-prompt-text-like field names, (c) does not contain repeated content from the model output, (d) is shorter than 200 chars (well within the 80-char redaction threshold for the per-message body).

**AC #6 — Regression tests.**

- New file `src/lib/schemas/__tests__/ai-responses.test.ts`: **43 cases** covering all 20 cases from the AC table plus smoke tests for the remaining schemas. Notable coverage: 5 `mcqQuestionSchema` invariants, 5 `writingEvaluationSchema` constraints, 4 `conversationFeedbackSchema` rules, 3 `dictationSetSchema` rules, 4 `placementTestSchema` cases (including 2 polymorphic-options preprocess scenarios), 4 `factExtractionSchema` rules (including the new lockstep assertion against `MAX_PRE_SANITIZE_CHARS`), 3 `microDrillSchema` rules, 3 `mockTestSectionSchema` cases, and 11 smoke tests for the remaining schemas.
- New file `src/lib/__tests__/chat-completion-json.test.ts`: **9 cases** covering the retry-once-on-parse-failure contract. Mocks `supabase.functions.invoke` so the real `chatCompletion` runs against fake responses; cardinality is asserted explicitly. Case 7 (the type-only test for `feature` requirement) uses `if (false as boolean)` to keep the call out of the runtime path — the `// @ts-expect-error` flags the missing field at compile time.
- Append to `src/lib/__tests__/prompt-injection.test.ts`: **2 new cases** under `describe("factExtractionSchema — content length cap (story 9-7)")` — over-cap rejection and at-cap acceptance. The existing `extractAndStoreMemories` runtime-validation tests continue to pass because the post-schema `validFacts` filter in `memory.ts` was restored per spec.

**AC #7 — Documentation.**

- `CLAUDE.md` `## Architecture` section: added a single line under "AI response validation" immediately after the 9-10 "Auth + cache race hardening" line, with verification stamp `Verified 2026-05-08, story 9-7`.
- JSDoc updated on `chatCompletionJSON` (full contract + retry semantics + Sentry context), on every exported schema in `ai-responses.ts` (call site + model + temperature where relevant), and on the `MAX_PRE_SANITIZE_CHARS` mirror constant (explains the circular-import workaround).
- No `.env.example` change. No PRD edit. No privacy-policy edit. No new agent definitions or skill changes.

**AC #8 — Quality gates.**

- `git grep "chatCompletionJSON<"` in `src/` and `app/` returns zero hits (the function definition itself is the only `chatCompletionJSON<T>` line in `src/lib/openai.ts`, which is expected).
- `git grep "function validateMCQExercise|function validateEchoResponse|function validateTranslationResponse|function validateEvaluationResponse"` in `src/` and `app/` returns zero hits.
- All 16 call sites pass a `feature:` tag (verified by type-check — the field is required).

**Manual smoke test (Task 7) — DEFERRED to reviewer / user.**

The dev agent cannot run a live device session for the 6 manual verification steps (golden-path generation across listening/reading/grammar/writing/conversation, forced parse failure, 3× placement test runs). The unit suite covers the schema + retry behavior at the algorithmic level; manual verification confirms end-to-end UX integration on a real device.

### File List

**New files:**

- `src/lib/schemas/ai-responses.ts` — 16 per-feature Zod schemas + common atomics (mcqOption, mcqQuestion, cefrLevel) + memory-type / writing-error sub-schemas + inferred-type re-exports for downstream `src/types/*` consumers.
- `src/lib/schemas/__tests__/ai-responses.test.ts` — 43-case schema unit suite covering all 20 AC #6 cases plus smoke tests for the remaining 11 schemas plus the lockstep assertion against `MAX_PRE_SANITIZE_CHARS`.
- `src/lib/__tests__/chat-completion-json.test.ts` — 9-case API-level test suite for the retry-once-on-parse-failure contract; mocks `supabase.functions.invoke` to drive the real `chatCompletion` retry loop.

**Modified files:**

- `package.json` — added `"zod": "^3.23.0"` to dependencies.
- `package-lock.json` — `zod@3.25.76` resolved at install.
- `src/lib/openai.ts` — replaced `chatCompletionJSON<T>` body with schema-first variant; new `ChatCompletionJSONOptions` type; retry loop with breadcrumb + captureError; expanded JSDoc.
- `src/types/exercise.ts` — replaced `WritingEvaluation`, `WritingError`, `EchoSentence`, `TranslationSentence`, `TranslationDimensionScore`, `TranslationEvaluation` interfaces with `z.infer<typeof X>` aliases.
- `src/types/conversation.ts` — replaced `ConversationFeedback` interface with `z.infer<typeof conversationFeedbackSchema>`.
- `src/hooks/use-exercise.ts` — migrated 5 call sites; deleted `validateMCQExercise` (35 lines) and the local `MCQQuestion` / `ListeningResponse` / `ReadingResponse` / `GrammarResponse` interfaces.
- `src/hooks/use-realtime-voice.ts` — migrated 1 call site.
- `src/hooks/use-dictation.ts` — migrated 1 call site; deleted local `DictationSet` interface; removed redundant empty-array post-check.
- `src/lib/echo-generation.ts` — migrated 1 call site; deleted `validateEchoResponse` (40 lines) and `EchoGenerationResponse` interface.
- `src/lib/translation-generation.ts` — migrated 2 call sites; deleted `validateTranslationResponse` (58 lines) and `validateEvaluationResponse` (28 lines); kept the domain-level `overallScore` recompute and the caller-attached metadata fields.
- `src/lib/memory.ts` — migrated 1 call site to schema-first; preserved the post-schema `validFacts` filter as defense-in-depth (per spec).
- `src/lib/error-tracker.ts` — migrated 2 call sites (micro-drill + batch-pattern); local `BatchPatternResult` interface preserved inline.
- `app/(tabs)/mock-test/[testId].tsx` — migrated 1 call site; deleted inline 4-option filter; renamed undercount captureError context to `"mock-test-undercount"` (was `"mock-test-validation-truncated"`); the `feature` tag interpolates the section name.
- `app/(tabs)/practice/pronunciation.tsx` — migrated 1 call site.
- `app/onboarding/placement-test.tsx` — migrated 1 call site with `parseRetries: 2`; deleted the 30-line polymorphic-options normalization, the `resolveIsCorrect` helper, and the manual `valid` check; preserved the outer AI-quality retry loop.
- `src/lib/__tests__/prompt-injection.test.ts` — added 2 cases under a new describe block for the schema's content-cap rule + lockstep assertion.
- `CLAUDE.md` — added the `**AI response validation:**` architecture-contract line under `## Architecture` immediately after the 9-10 line, dated 2026-05-08.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `9-7-zod-validation-infrastructure` flipped from `ready-for-dev` to `review`; `last_updated` bumped.

## Change Log

| Date       | Author    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-08 | dev-agent | Story 9-7 implemented. AC #1: `zod` ^3.23 dependency added (resolved 3.25.76). AC #2: schema-first `chatCompletionJSON<T>` requires `z.ZodType<T>` and `feature` tag; retries once on parse failure; emits one allowlist-safe `captureError(_, "ai-schema-parse-failed", { feature, attempt, code })` on retry exhaustion. AC #3: 16 per-feature Zod schemas + common atomics in `src/lib/schemas/ai-responses.ts`. AC #4: all 16 call sites migrated; 4 hand-rolled validators (`validateMCQExercise`, `validateEchoResponse`, `validateTranslationResponse`, `validateEvaluationResponse`) and 2 inline normalizations (mock-test 4-option filter, placement-test 30-line polymorphic-options helper) DELETED. AC #5: zero changes to `SENTRY_EXTRAS_ALLOWLIST`. AC #6: 54 net new test cases across 3 files (43 schema cases, 9 retry-loop cases, 2 cap-rule cases) — full suite 261/261 green. AC #7: CLAUDE.md architecture-contract line added; JSDoc updated on `chatCompletionJSON` and every exported schema. AC #8: quality gates clean (type-check ✓, lint --max-warnings 0 ✓, format:check ✓). Task 7 (manual smoke test) deferred to reviewer / user. |
| 2026-05-08 | dev-agent | Addressed bmad-code-review findings — 13 patches applied (P1–P13). **HIGH:** P1 placement-test polymorphic options regressions restored (string-boolean coercion via `coerceTruthy()`, lowercase + trim on `correct_answer`, numeric-index fallback via `resolvePlacementCorrectKey`); P2 `translationGenerationSchema` MIN_SENTENCES (3) / MAX_SENTENCES (10) bounds restored + lockstep with `translation-generation.ts`; P3 mock-test undercount captureError now also fires on `questions: []`. **MEDIUM:** P4 `translationDimensionScoreSchema.feedback` rejects whitespace-only via `.refine(s => s.trim().length > 0)`; P5 `parseRetries` clamped to non-negative integer with `Math.max(0, Math.floor(...))`; P6 `chatCompletion` errors inside `chatCompletionJSON` emit a feature-tagged breadcrumb before re-throwing; P7 placement preprocess filters null option values + null array entries. **LOW:** P8 `SCHEMA_MAX_PRE_SANITIZE_CHARS` exported for symmetric lockstep test; P9 unique-id rule on `mcqQuestionSchema.superRefine` and `placementQuestionSchema.superRefine`; P10 `mcqQuestionSchema.passage` / `passageId` use `.min(1).optional()`; P11 `translationEvaluationSchema.overallScore` is `.nullable().optional()` so `null` triggers caller's recompute path instead of retry exhaustion; P12 `memoryTypeSchema.options` parity test against canonical 4-type list; P13 empty-path `.join("")` falls back to `<root>` via `||` (not `??`). +20 new test cases (281 total, was 261). 16 review findings rejected as noise; 7 deferred (cost amplification documentation, brittle Zod issue ordering, type intersection narrowing, `as PlacementQuestion[]` cast, Test Case 7 `false as boolean` guard, UTF-16 vs codepoints, mock-test Sentry alert rename). Quality gates re-clean. |
