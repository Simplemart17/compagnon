# Story 7.2: Translation Exercise Hook

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner doing translation practice,
I want to hear a sentence, speak my translation, and receive multi-dimensional feedback,
So that I can systematically improve my ability to produce French from comprehension.

## Acceptance Criteria

### A. State Machine

- [ ] **Given** the `use-translation.ts` hook **When** initialized **Then** it manages a state machine with states: `idle → generating → listen → recording → evaluating → results` **And** the state type is exported as `TranslationScreenState`

### B. Exercise Generation (generating state)

- [ ] **Given** the "generating" state **When** the exercise is being created **Then** the hook calls `generateTranslationExercise()` from `@/src/lib/translation-generation` **And** `requireNetwork()` is called before the request **And** TTS audio is included in the result for source sentences (English at A1-B1, French at B2+)

### C. Source Playback (listen state)

- [ ] **Given** the "listen" state **When** the source sentence audio plays **Then** the user hears the sentence via `useAudioPlayer().playFromBase64()` **And** the source text is available for screen display **And** the user can replay at normal and slow speeds (0.75x via on-demand `generateSpeech()` call, cached) **And** at least one listen is required before advancing to recording

### D. Recording (recording state)

- [ ] **Given** the "recording" state **When** the user speaks their French translation **Then** audio is captured via `usePronunciation().startAssessment()` **And** the user can re-record before submitting (re-entering recording clears previous recording)

### E. Transcription & Evaluation (evaluating state)

- [ ] **Given** the "evaluating" state **When** the user submits their recording **Then** the hook sends the audio for pronunciation assessment via `pronunciation.finishAssessment(expectedTarget)` for pronunciation scoring **And** sends the audio for Whisper transcription via a new `transcribeAudio()` function through `ai-proxy` **And** sends the transcription text to `evaluateTranslation()` for accuracy/fluency/naturalness scoring **And** pronunciation assessment and transcription run in parallel where possible

### F. Results & Persistence (results state)

- [ ] **Given** the "results" state **When** evaluation completes **Then** the hook returns: pronunciation result, translation evaluation (accuracy, fluency, naturalness scores + feedback), expected target for comparison, and user transcription **And** skill progress is updated for "speaking" skill via `updateSkillProgress()` **And** daily activity is incremented via `incrementDailyActivity()` **And** streak is updated via `updateStreak()` **And** errors detected are fed into error pattern tracking via `extractErrorsFromCorrections()` **And** the exercise record is marked `completed: true` with score and time_spent_seconds

### G. Transcription Infrastructure

- [ ] **Given** the `ai-proxy` Edge Function **When** it receives `action: "transcribe"` **Then** it forwards base64 audio to OpenAI Whisper API (`/v1/audio/transcriptions`) with `model: "whisper-1"`, `language: "fr"` **And** returns the transcription text **And** validates audio input is present and base64-encoded
- [ ] **Given** `src/lib/openai.ts` **When** `transcribeAudio(audioBase64, language)` is called **Then** it sends the audio to `ai-proxy` with `action: "transcribe"` **And** returns the transcription text as a string **And** calls `requireNetwork()` before the request **And** retries on retryable errors

### H. Multi-Sentence Flow

- [ ] **Given** an exercise with multiple sentences **When** the user completes one sentence **Then** the hook advances to the next sentence's "listen" state **And** when all sentences are done, computes overall scores (average across sentences) and transitions to "results" **And** all per-sentence results are collected for screen display

### I. Navigation Actions

- [ ] **Given** the hook **When** used by the screen **Then** it exposes: `generateExercise()`, `playSource(speed?)`, `startRecording()`, `stopRecording()`, `submitRecording()`, `nextSentence()`, `skipSentence()`, `tryAgain()`, `clearOfflineFallback()` **And** `tryAgain()` resets to idle state for a fresh exercise

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

- [x] Task 1: Add Whisper transcription to ai-proxy Edge Function (AC: G)
  - [x] 1.1 In `supabase/functions/ai-proxy/index.ts`, add a `case "transcribe"` block in the `switch (action)` statement
  - [x] 1.2 Validate `params.audio` exists and is a non-empty string (base64-encoded audio)
  - [x] 1.3 Convert base64 audio to a `Blob` with content type `audio/wav` (iOS) — Whisper accepts WAV, MP3, M4A natively
  - [x] 1.4 Build a `FormData` request body with fields: `file` (audio Blob, named `audio.wav`), `model: "whisper-1"`, `language: params.language ?? "fr"`, `response_format: "json"`
  - [x] 1.5 POST to `https://api.openai.com/v1/audio/transcriptions` with `Authorization: Bearer ${OPENAI_API_KEY}` and the FormData body (do NOT set Content-Type manually — let fetch set multipart boundary)
  - [x] 1.6 Parse response JSON and return `{ text: response.text }` with CORS headers
  - [x] 1.7 On upstream error, return structured error via `errorResponse({ code: "UPSTREAM_ERROR", ... })`

- [x] Task 2: Add `transcribeAudio()` to openai.ts (AC: G)
  - [x] 2.1 In `src/lib/openai.ts`, export `async function transcribeAudio(audioBase64: string, language?: string): Promise<string>`
  - [x] 2.2 Call `requireNetwork()` before the request
  - [x] 2.3 Invoke `supabase.functions.invoke("ai-proxy", { body: { action: "transcribe", audio: audioBase64, language: language ?? "fr" } })`
  - [x] 2.4 Extract `data.text` from response, throw if missing or empty
  - [x] 2.5 Add retry logic (1 retry with backoff) matching the `generateSpeech()` pattern
  - [x] 2.6 Wrap in try/catch with proper error propagation

- [x] Task 3: Create `use-translation.ts` hook — state machine & types (AC: A, I)
  - [x] 3.1 Create `src/hooks/use-translation.ts`
  - [x] 3.2 Export `TranslationScreenState` type: `"idle" | "generating" | "listen" | "recording" | "evaluating" | "results"`
  - [x] 3.3 Define `TranslationSentenceResult` interface:
    ```typescript
    interface TranslationSentenceResult {
      sentenceIndex: number;
      pronunciationResult: PronunciationResult | null;
      evaluation: TranslationEvaluation | null;
      userTranscription: string;
      skipped: boolean;
    }
    ```
  - [x] 3.4 Export `UseTranslationReturn` interface with:
    - State: `screenState`, `exercise` (TranslationExerciseResult | null), `currentIndex`, `currentSentence` (TranslationSentence | null), `sentenceResults`, `currentPronunciationResult`, `currentEvaluation`, `generateError`, `offlineFallback`, `hasPlayed`, `isSavingResults`, `audioPlayer`, `recorder`
    - Computed: `overallScore`, `sentenceCount`, `getElapsedMinutes()`
    - Actions: `generateExercise()`, `playSource(speed?)`, `startRecording()`, `stopRecording()`, `submitRecording()`, `nextSentence()`, `skipSentence()`, `tryAgain()`, `clearOfflineFallback()`
  - [x] 3.5 Initialize hook with `useAudioPlayer()`, `useAudioRecorder()`, `useAuthStore()` for user profile
  - [x] 3.6 Set up refs: `startTimeRef`, `isGeneratingRef`, `exerciseIdRef`, `sentenceResultsRef`, `slowAudioCacheRef`, `recordedAudioRef`, `exerciseRef`

- [x] Task 4: Implement `generateExercise()` (AC: B)
  - [x] 4.1 Guard: return early if `isGeneratingRef.current` is true (prevent double-tap)
  - [x] 4.2 Set `screenState` to `"generating"`, clear previous state
  - [x] 4.3 Get user's CEFR level from `useAuthStore` profile
  - [x] 4.4 Call `generateTranslationExercise({ cefrLevel, userId })` from `@/src/lib/translation-generation`
  - [x] 4.5 On success: store result, set `currentIndex` to 0, set `screenState` to `"listen"`, set `startTimeRef`
  - [x] 4.6 On network error: set `offlineFallback` to true, use `classifyError()` from `@/src/lib/error-messages`
  - [x] 4.7 On other error: set `generateError` with message
  - [x] 4.8 `captureError(err, "translation-generate")` in catch block
  - [x] 4.9 Reset `isGeneratingRef` in finally block

- [x] Task 5: Implement `playSource()` with slow speed caching (AC: C)
  - [x] 5.1 `playSource(speed?: number)`: default speed 1.0
  - [x] 5.2 For normal speed: get pre-generated base64 from `exercise.audioData.get(currentIndex)`, play via `audioPlayer.playFromBase64(base64, "mp3")`
  - [x] 5.3 For slow speed (0.75): check `slowAudioCacheRef` for cached slow audio at current index
  - [x] 5.4 If not cached: call `generateSpeech(currentSentence.source, { speed: 0.75 })` and cache the result
  - [x] 5.5 Play cached slow audio via `audioPlayer.playFromBase64()`
  - [x] 5.6 Set `hasPlayed` to true after first successful play
  - [x] 5.7 Wrap in try/catch with `captureError(err, "translation-play-source")`

- [x] Task 6: Implement recording flow (AC: D)
  - [x] 6.1 `startRecording()`: clear `currentPronunciationResult` and `currentEvaluation`, call `recorder.startRecording()`, set `screenState` to `"recording"`
  - [x] 6.2 `stopRecording()`: call `recorder.getBase64Audio()` — stores base64 in `recordedAudioRef`. Do NOT change screen state (user can re-record or submit).
  - [x] 6.3 If `stopRecording` fails, `captureError(err, "translation-stop-recording")` and show error

- [x] Task 7: Implement `submitRecording()` — transcription + evaluation (AC: E)
  - [x] 7.1 Set `screenState` to `"evaluating"`
  - [x] 7.2 Uses `recordedAudioRef.current` (base64 captured by `stopRecording()` via `useAudioRecorder` directly)
  - [x] 7.3 N/A — used Whisper transcription approach (preferred)
  - [x] 7.4 Run in parallel with `Promise.allSettled`: `assessPronunciation()` + `transcribeAudio()` — both use the same base64 audio
  - [x] 7.5 Call `evaluateTranslation({ source, expectedTarget, userTranscription, cefrLevel, mode })` with Whisper transcription
  - [x] 7.6 Store evaluation in `currentEvaluation`
  - [x] 7.7 Store sentence result in `sentenceResultsRef` and `sentenceResults` state
  - [x] 7.8 If this is the last sentence → transition to "results" and trigger `saveResults()`
  - [x] 7.9 If not last sentence → stay on current sentence showing per-sentence feedback (screen will call `nextSentence()`)
  - [x] 7.10 On error: revert to "recording" state with error message, `captureError(err, "translation-evaluate")`

- [x] Task 8: Implement `nextSentence()` and `skipSentence()` (AC: H)
  - [x] 8.1 `nextSentence()`: increment `currentIndex`, reset `hasPlayed`, `currentPronunciationResult`, `currentEvaluation`, transition to "listen" state for next sentence
  - [x] 8.2 `skipSentence()`: record a skipped result `{ sentenceIndex, skipped: true, pronunciationResult: null, evaluation: null, userTranscription: "" }`, then call `nextSentence()` logic
  - [x] 8.3 If skipping/completing the last sentence, transition to "results"

- [x] Task 9: Implement results persistence (AC: F)
  - [x] 9.1 Create internal `saveResults()` function called when all sentences are done
  - [x] 9.2 Set `isSavingResults` to true
  - [x] 9.3 Compute overall score: average of non-skipped sentence `evaluation.overallScore` values. If no evaluations, default 0.
  - [x] 9.4 Compute elapsed minutes from `startTimeRef`
  - [x] 9.5 Run `Promise.all` (best-effort, don't block results display):
    - `updateSkillProgress(userId, "speaking", overallScore, elapsedMinutes)`
    - `incrementDailyActivity(userId, { minutes: elapsedMinutes, exercises: 1 })`
    - `updateStreak(userId)`
  - [x] 9.6 Update exercise in DB: `supabase.from("exercises").update({ completed: true, score: overallScore, time_spent_seconds: elapsedSeconds, completed_at: new Date().toISOString() }).eq("id", exerciseIdRef.current)`
  - [x] 9.7 Extract error corrections from evaluations and feed to `extractErrorsFromCorrections()`:
    - For each non-skipped result with `evaluation.corrections`, create correction objects: `{ original: userTranscription, corrected: expectedTarget, explanation: evaluation.corrections, category: "grammar" }`
    - Also extract from pronunciation: words with `errorType !== "None"` → `{ original: errorType, corrected: word, explanation: "Pronunciation ${errorType}", category: "pronunciation" }`
  - [x] 9.8 Set `isSavingResults` to false in finally block
  - [x] 9.9 Wrap all persistence in try/catch — persistence failures must NOT block results display

- [x] Task 10: Implement `tryAgain()` and `clearOfflineFallback()` (AC: I)
  - [x] 10.1 `tryAgain()`: reset all state to initial values, set `screenState` to "idle"
  - [x] 10.2 `clearOfflineFallback()`: set `offlineFallback` to false

- [x] Task 11: Quality gates (AC: Z)
  - [x] 11.1 Run `npm run type-check` — zero errors
  - [x] 11.2 Run `npm run lint` — zero warnings
  - [x] 11.3 Run `npm run format:check` — all files pass

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module | Location | What to Use |
|--------|----------|-------------|
| `generateTranslationExercise()` | `src/lib/translation-generation.ts` | Generates sentences + TTS audio, persists to DB |
| `evaluateTranslation()` | `src/lib/translation-generation.ts` | Scores accuracy/fluency/naturalness (0-100 each) |
| `chatCompletionJSON<T>()` | `src/lib/openai.ts` | JSON-parsed AI completion |
| `generateSpeech()` | `src/lib/openai.ts` | TTS audio generation (returns base64) — use for slow playback |
| `requireNetwork()` | `src/lib/network.ts` | Network check before API calls |
| `captureError()` | `src/lib/sentry.ts` | Error reporting to Sentry |
| `classifyError()` | `src/lib/error-messages.ts` | Classifies errors into `{ category, message }` for UI |
| `useAudioPlayer()` | `src/hooks/use-audio-player.ts` | Plays base64 audio — `playFromBase64(base64, "mp3")` |
| `usePronunciation()` | `src/hooks/use-pronunciation.ts` | Records + assesses pronunciation against reference text |
| `useAuthStore` | `src/store/auth-store.ts` | `user`, `profile` (contains `cefr_level`, `id`) |
| `updateSkillProgress()` | `src/lib/activity.ts` | Updates skill_progress table |
| `incrementDailyActivity()` | `src/lib/activity.ts` | Increments daily_activity counters |
| `updateStreak()` | `src/lib/activity.ts` | Updates streak in profiles table |
| `extractErrorsFromCorrections()` | `src/lib/error-tracker.ts` | Batches corrections → AI pattern extraction → error_patterns table |
| `hapticSuccess()`, `hapticError()` | `src/lib/haptics.ts` | Haptic feedback on completion/failure |
| `TranslationContent`, `TranslationEvaluation`, `TranslationSentence` | `src/types/exercise.ts` | Type definitions from story 7-1 |
| `TranslationExerciseResult` | `src/lib/translation-generation.ts` | Return type with exerciseId, content, audioData |
| `PronunciationResult` | `src/lib/pronunciation.ts` | Pronunciation assessment result type |
| `Colors`, `Typography` | `src/lib/design.ts` | Design tokens (hook doesn't use directly, but screen will) |

### Primary Template: `src/hooks/use-echo-practice.ts`

**Copy the structural pattern** from the echo practice hook:
- State machine with `screenState` discriminated union
- Refs for stale closure prevention (`startTimeRef`, `isGeneratingRef`, `exerciseIdRef`, `sentenceResultsRef`)
- `useAudioPlayer()` for source playback + `usePronunciation()` for recording/assessment
- `useAuthStore()` for user profile access
- `classifyError()` for error categorization (network vs other)
- `offlineFallback` boolean for offline state
- `isSavingResults` flag for async persistence
- Slow audio caching pattern (on-demand `generateSpeech()` with ref cache)
- `Promise.all` for parallel persistence at results stage

### Key Differences from Echo Practice

| Aspect | Echo | Translation |
|--------|------|-------------|
| States | idle → generating → listen → speak → type → checking → results | idle → generating → listen → recording → evaluating → results |
| Steps per sentence | 3 (listen, speak, type) | 3 (listen, record, evaluate) |
| Typing step | Yes (spelling check) | No (voice only) |
| Evaluation | Pronunciation score + spelling comparison | Whisper transcription + AI evaluation (accuracy/fluency/naturalness) |
| Transcription | Not needed (compares typed text) | **Required** — must transcribe recorded audio to send to evaluateTranslation() |
| Skills tracked | listening + speaking | speaking only |
| Score composition | Avg of listening + pronunciation + spelling | Avg of evaluation.overallScore across sentences |
| Mode branching | No modes | `"translation"` (A1-B1) vs `"paraphrasing"` (B2+) — affects display only, hook logic is identical |

### Critical: Transcription Strategy

`evaluateTranslation()` requires a `userTranscription: string` parameter — the actual French text the user spoke. The pronunciation assessment (`usePronunciation`) does NOT return the user's spoken text; it scores pronunciation against a reference.

**Solution: Add Whisper transcription via ai-proxy.**

1. Add `case "transcribe"` to `supabase/functions/ai-proxy/index.ts` — forwards base64 audio to OpenAI Whisper API
2. Add `transcribeAudio(audioBase64, language)` to `src/lib/openai.ts` — client function
3. In the hook, after `stopRecording()` obtains pronunciation result, `submitRecording()` calls `transcribeAudio()` to get the transcription text, then calls `evaluateTranslation()` with that text

**Audio access for Whisper**: The `usePronunciation` hook wraps `useAudioRecorder`. When `finishAssessment()` is called, it internally calls `recorder.getBase64Audio()` which stops recording and returns base64. The base64 audio is consumed by `assessPronunciation()`. To also send to Whisper, we need to capture the base64 audio BEFORE it's consumed. 

**Implementation approach**: Modify the flow so `stopRecording()` captures and stores the base64 audio in a ref, then `submitRecording()` uses that stored audio for both pronunciation assessment and Whisper transcription. Alternatively, expose the recording URI from `usePronunciation` and read it in the hook. Check what `usePronunciation` exposes — if it exposes `recorder` or the URI, use that. If not, use a separate `useAudioRecorder` instance for the translation hook (NOT the one inside usePronunciation) and manage recording directly.

**Simplest pattern**: Use `useAudioRecorder` directly (not via usePronunciation). Record audio → get base64 → send to BOTH pronunciation-assess AND Whisper in parallel → combine results.

### Audio Recording Flow (Detailed)

```
User taps "Record" → startRecording()
  → useAudioRecorder.startRecording()
  → screenState = "recording"

User taps "Stop" → stopRecording()
  → useAudioRecorder.getBase64Audio() → stores in recordedAudioRef
  → screenState stays "recording" (user sees stop state, can re-record or submit)

User taps "Submit" → submitRecording()
  → screenState = "evaluating"
  → Promise.allSettled([
      assessPronunciation(recordedAudioRef.current, expectedTarget),
      transcribeAudio(recordedAudioRef.current, "fr")
    ])
  → evaluateTranslation({ source, expectedTarget, userTranscription, cefrLevel, mode })
  → store results, advance or complete
```

This means the hook should use `useAudioRecorder` directly instead of `usePronunciation`, and call `assessPronunciation()` from `src/lib/pronunciation.ts` directly. This gives full control over the base64 audio for dual-purpose use.

### AI API Conventions

| Parameter | Value | Source |
|-----------|-------|--------|
| Whisper model | `whisper-1` | OpenAI standard |
| Whisper language | `fr` | Target language is always French |
| Evaluation temperature | 0.4 | Architecture: scoring = 0.4 |
| TTS for slow playback | `generateSpeech(text, { speed: 0.75 })` | Same pattern as echo |

### Exercise Completion Persistence Pattern

From echo practice (replicate exactly):
```typescript
// In saveResults(), run best-effort — don't block UI
try {
  setIsSavingResults(true);
  await Promise.all([
    updateSkillProgress(userId, "speaking", score, elapsedMinutes),
    incrementDailyActivity(userId, { minutes: elapsedMinutes, exercises: 1 }),
    updateStreak(userId),
  ]);
  await supabase.from("exercises").update({
    completed: true,
    score: overallScore,
    time_spent_seconds: elapsedSeconds,
    completed_at: new Date().toISOString(),
  }).eq("id", exerciseIdRef.current);
  // Error tracking is best-effort
  if (corrections.length > 0) {
    await extractErrorsFromCorrections(userId, corrections);
  }
} catch (err) {
  captureError(err, "translation-save-results");
} finally {
  setIsSavingResults(false);
}
```

### Error Correction Extraction

From the evaluation result, build corrections for `extractErrorsFromCorrections()`:

```typescript
const corrections = sentenceResults
  .filter(r => !r.skipped && r.evaluation?.corrections)
  .map(r => ({
    original: r.userTranscription,
    corrected: r.evaluation!.expectedTranslation ?? currentSentence.target,
    explanation: r.evaluation!.corrections!,
    category: "grammar",
  }));

// Also extract pronunciation errors
const pronCorrections = sentenceResults
  .filter(r => !r.skipped && r.pronunciationResult)
  .flatMap(r => r.pronunciationResult!.words
    .filter(w => w.errorType !== "None")
    .map(w => ({
      original: w.errorType === "Omission" ? "(omitted)" : w.word,
      corrected: w.word,
      explanation: `Pronunciation ${w.errorType.toLowerCase()}: ${w.word}`,
      category: "pronunciation",
    }))
  );
```

### What This Story Does NOT Include

- **No screen/UI** — that is story 7-3
- **No new prompt builders** — story 7-1 created those
- **No DB migration** — uses existing exercises table
- **No changes to existing hooks** — only creates new `use-translation.ts`

### Previous Story (7-1) Learnings

- `TranslationExerciseResult` has `audioData: Map<number, string>` (index → base64) — use `.get(currentIndex)` for playback
- `evaluateTranslation()` throws on empty `userTranscription` — guard before calling
- `evaluateTranslation()` computes weighted `overallScore` fallback (accuracy 40%, fluency 30%, naturalness 30%) if AI doesn't provide one
- Validation already handles edge cases in generation/evaluation functions — hook doesn't need to re-validate
- `exercise.content.mode` is either `"translation"` or `"paraphrasing"` — pass through to evaluateTranslation, no branching needed in hook logic

### Previous Epic (6) Learnings

From echo practice hook (6-2):
- `Promise.allSettled()` for parallel API calls prevents single-failure cascade
- Use refs for values accessed in callbacks to avoid stale closures
- `classifyError()` returns `{ category: "network" | "validation" | "server"; message: string }` — check `category === "network"` for offline fallback
- Audio is stored as base64 in runtime refs, NOT in database
- `isSavingResults` flag prevents duplicate saves on rapid taps
- `isGeneratingRef` prevents concurrent generation calls

### Git Intelligence

Story 7-1 just completed — `translation-generation.ts` and `prompts/translation.ts` are fresh. Echo practice (6-1 through 6-3) provides the complete hook template. The codebase pattern is: prompt builder → generation function → hook → screen.

### Project Structure Notes

- New hook: `src/hooks/use-translation.ts` (parallel to `use-echo-practice.ts`)
- Modified: `src/lib/openai.ts` (add `transcribeAudio()` export)
- Modified: `supabase/functions/ai-proxy/index.ts` (add `"transcribe"` action)
- Path alias: `@/*` maps to repo root — use `@/src/lib/translation-generation` for imports

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.2 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Mapping: use-translation.ts → prompts/translation.ts → ai-proxy]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture: Hook-driven, state machine pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Frontend Growth: dedicated hooks for new exercise types]
- [Source: _bmad-output/planning-artifacts/architecture.md — API: ai-proxy Edge Function proxy pattern]
- [Source: _bmad-output/planning-artifacts/prd.md — FR53-55: Speech-to-speech translation requirements]
- [Source: _bmad-output/implementation-artifacts/7-1-translation-prompt-builder-evaluation-logic.md — Previous story, generation/evaluation functions]
- [Source: _bmad-output/implementation-artifacts/6-2-echo-practice-hook-multi-step-exercise-flow.md — Template hook pattern]
- [Source: src/hooks/use-echo-practice.ts — Primary implementation template]
- [Source: src/lib/translation-generation.ts — generateTranslationExercise, evaluateTranslation]
- [Source: src/lib/openai.ts — chatCompletion, generateSpeech, generateEmbedding patterns]
- [Source: src/lib/activity.ts — updateSkillProgress, incrementDailyActivity, updateStreak]
- [Source: src/lib/error-tracker.ts — extractErrorsFromCorrections]
- [Source: src/hooks/use-audio-recorder.ts — getBase64Audio for Whisper input]
- [Source: src/lib/pronunciation.ts — assessPronunciation for direct call]
- [Source: supabase/functions/ai-proxy/index.ts — Edge Function action pattern]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — no blockers encountered.

### Completion Notes List

- **Task 1**: Added `case "transcribe"` to ai-proxy Edge Function. Converts base64 audio to Blob, builds FormData, POSTs to Whisper API. Increased body size limit to 5MB for audio actions (text actions remain 50KB). Returns `{ text }` JSON.
- **Task 2**: Added `transcribeAudio(audioBase64, language)` to openai.ts. Follows same retry pattern as `generateSpeech()` (1 retry with backoff). Calls `requireNetwork()` before request.
- **Tasks 3-10**: Created `use-translation.ts` hook with full state machine. Key architectural decision: used `useAudioRecorder` directly (not via `usePronunciation`) to get full control over base64 audio for dual-purpose use (pronunciation assessment via `assessPronunciation()` AND Whisper transcription). Both run in parallel via `Promise.allSettled`. Follows echo practice hook patterns for state management, refs, error handling, and persistence.
- **Task 11**: All quality gates pass — type-check, lint, format:check all clean.

### Change Log

- 2026-04-01: Implemented story 7-2 — translation exercise hook with Whisper transcription infrastructure

### File List

- `supabase/functions/ai-proxy/index.ts` — Modified: added `case "transcribe"` for Whisper API, increased body size limit for audio
- `src/lib/openai.ts` — Modified: added `transcribeAudio()` export
- `src/hooks/use-translation.ts` — New: translation exercise hook with state machine, recording, evaluation, persistence
