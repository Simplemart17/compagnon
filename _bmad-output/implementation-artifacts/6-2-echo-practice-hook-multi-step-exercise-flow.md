# Story 6.2: Echo Practice Hook & Multi-Step Exercise Flow

Status: done

## Story

As a learner doing echo practice,
I want to listen to a sentence, repeat it aloud, then type it, and receive scores for all three skills,
So that I improve my listening, pronunciation, and spelling in one integrated exercise.

## Acceptance Criteria

### A. State Machine

- [x] **Given** the `use-echo-practice.ts` hook **When** initialized **Then** it manages a multi-step state machine with states: `idle → generating → listen → speak → type → checking → results` **And** the state type is exported as `EchoPracticeScreenState`

### B. Listen Step

- [x] **Given** the "listen" step **When** the generated sentence audio plays **Then** the user hears the sentence via TTS from the pre-generated `audioBase64` in `EchoSentenceWithAudio` **And** they can replay the audio at normal and slow speeds (slow = 0.75 via `generateSpeech` with speed param) **And** the French text is NOT shown during listening (tests comprehension) **And** a "Next" button advances to the speak step only after at least one listen (`hasPlayed` guard)

### C. Speak Step

- [x] **Given** the "speak" step **When** the user records their spoken repetition **Then** the audio is captured via `usePronunciation().startAssessment()` / `finishAssessment(sentence)` **And** pronunciation assessment is requested via the pronunciation-assess Edge Function **And** word-by-word accuracy results are returned as `PronunciationResult` **And** the user can re-record before advancing **And** a "Next" button advances to the type step

### D. Type Step

- [x] **Given** the "type" step **When** the user types what they heard **Then** a text input captures their typed response **And** the system compares their typed text against `expectedSpelling` using `compareSentences()` from `use-dictation.ts` (reuse the exported function — do NOT reimplement) **And** a "Check" button submits the response

### E. Results & Scoring

- [x] **Given** the "results" step **When** all three sub-scores are computed **Then** the hook returns: listening comprehension score (pronunciation accuracy score as proxy — `pronunciationResult.accuracyScore`), pronunciation score (from `PronunciationResult.overallScore`), and spelling score (from `compareSentences().accuracy`) **And** per-sentence results are accumulated in a `sentenceResults` array

### F. Progress Tracking

- [x] **Given** exercise completion (all sentences done) **When** results are saved **Then** skill progress is updated for listening AND speaking skills via `updateSkillProgress()` from `activity.ts` **And** daily activity is incremented via `incrementDailyActivity()` **And** streak is updated via `updateStreak()` **And** the exercise record is updated with `completed: true`, `score`, and `time_spent_seconds` in the exercises table

### G. Error Pattern Tracking

- [x] **Given** the hook **When** errors are detected in pronunciation or spelling **Then** spelling errors (wrong/missing words) are fed into error pattern tracking via `extractErrorsFromCorrections()` from `error-tracker.ts` **And** errors use category `"vocabulary"` for spelling mistakes and `"pronunciation"` for pronunciation issues

### H. Error Handling

- [x] **Given** any step in the exercise **When** an error occurs (TTS playback, pronunciation assessment, or network failure) **Then** errors are captured via `captureError(err, "echo-practice-<step>")` **And** network errors set `offlineFallback: true` (classified via `classifyError()`) **And** other errors set an `error` string for UI display **And** the user can retry or go back

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

- [x] Task 1: Create `use-echo-practice.ts` hook skeleton with state machine (AC: A)
  - [x] 1.1 Create `src/hooks/use-echo-practice.ts`
  - [x] 1.2 Define and export `EchoPracticeScreenState = "idle" | "generating" | "listen" | "speak" | "type" | "checking" | "results"`
  - [x] 1.3 Define and export `UseEchoPracticeReturn` interface (model after `UseDictationReturn` — see Dev Notes)
  - [x] 1.4 Define `EchoPracticeSentenceResult` interface for per-sentence results:
    ```typescript
    export interface EchoPracticeSentenceResult {
      sentence: EchoSentenceWithAudio;
      pronunciationResult: PronunciationResult | null;
      spellingResult: { wordResults: WordResult[]; accuracy: number; isFullyCorrect: boolean };
      listeningScore: number;    // pronunciationResult.accuracyScore (proxy for comprehension)
      pronunciationScore: number; // pronunciationResult.pronunciationScore
      spellingScore: number;      // spellingResult.accuracy
    }
    ```
  - [x] 1.5 Set up state variables: `screenState`, `sentences` (EchoSentenceWithAudio[]), `currentIndex`, `userInput`, `sentenceResults` (EchoPracticeSentenceResult[]), `generateError`, `offlineFallback`, `hasPlayed`, `isSavingResults`, `currentPronunciationResult`
  - [x] 1.6 Set up refs: `startTimeRef` (Date.now()), `isGeneratingRef` (boolean guard)
  - [x] 1.7 Initialize `useAudioPlayer()` and `usePronunciation()` inside the hook

- [x] Task 2: Implement generate action (AC: A, H)
  - [x] 2.1 Create `generateExercise` callback that calls `generateEchoExercise({ cefrLevel, userId })` from `src/lib/echo-generation.ts`
  - [x] 2.2 On success: set `sentences` from result, store `exerciseId`, transition to `"listen"`
  - [x] 2.3 On error: classify with `classifyError()` — network errors → `offlineFallback: true`, others → `generateError` string, transition back to `"idle"`, call `hapticError()`
  - [x] 2.4 Guard against double-generation via `isGeneratingRef`

- [x] Task 3: Implement listen step (AC: B)
  - [x] 3.1 Create `playSentence(speed?: number)` callback: play from `currentSentence.audioBase64` via `audioPlayer.playFromBase64(base64, "mp3")` at normal speed (1.0); for slow speed, call `generateSpeech(sentence, { voice: "coral", speed: 0.75 })` and play that
  - [x] 3.2 Cache normal-speed audio from `EchoSentenceWithAudio.audioBase64` (already pre-generated) — only slow-speed needs on-demand TTS
  - [x] 3.3 Set `hasPlayed = true` after first successful playback
  - [x] 3.4 Create `advanceToSpeak()` callback: guard on `hasPlayed`, transition to `"speak"`, call `hapticLight()`

- [x] Task 4: Implement speak step (AC: C)
  - [x] 4.1 Create `startRecording()` callback: call `pronunciation.startAssessment()`
  - [x] 4.2 Create `stopRecording()` callback: call `pronunciation.finishAssessment(currentSentence.sentence)`, store the `PronunciationResult` in `currentPronunciationResult` state
  - [x] 4.3 Allow re-recording: call `startRecording` again to overwrite the previous result
  - [x] 4.4 Create `advanceToType()` callback: guard on `currentPronunciationResult !== null`, transition to `"type"`, call `hapticLight()`
  - [x] 4.5 Handle pronunciation errors: if `finishAssessment` returns null, set error state, allow retry

- [x] Task 5: Implement type step and checking (AC: D, E)
  - [x] 5.1 Expose `setUserInput` for the text input
  - [x] 5.2 Create `checkSpelling()` callback: call `compareSentences(currentSentence.expectedSpelling, userInput.trim())` from `use-dictation.ts` (import the exported function)
  - [x] 5.3 Assemble `EchoPracticeSentenceResult` from pronunciation + spelling results:
    - `listeningScore` = `currentPronunciationResult.accuracyScore` (0-100)
    - `pronunciationScore` = `currentPronunciationResult.pronunciationScore` (0-100)
    - `spellingScore` = `spellingResult.accuracy` (0-100)
  - [x] 5.4 Append to `sentenceResults` array, transition to `"checking"`
  - [x] 5.5 Call `hapticSuccess()` if all scores > 80, else `hapticLight()`

- [x] Task 6: Implement sentence advancement and results (AC: E, F)
  - [x] 6.1 Create `nextSentence()` callback: if more sentences remain → increment `currentIndex`, reset `userInput`/`hasPlayed`/`currentPronunciationResult`, transition to `"listen"`; if last sentence → transition to `"results"`
  - [x] 6.2 On entering results: save progress:
    ```typescript
    const avgListening = avg(sentenceResults.map(r => r.listeningScore));
    const avgPronunciation = avg(sentenceResults.map(r => r.pronunciationScore));
    const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000));
    await Promise.all([
      updateSkillProgress(userId, "listening", avgListening, elapsed),
      updateSkillProgress(userId, "speaking", avgPronunciation, elapsed),
      incrementDailyActivity(userId, { minutes: elapsed, exercises: 1 }),
      updateStreak(userId),
    ]);
    ```
  - [x] 6.3 Update the exercise record: `supabase.from("exercises").update({ completed: true, score: overallScore, time_spent_seconds, completed_at: new Date().toISOString() }).eq("id", exerciseId)`
  - [x] 6.4 Wrap progress saving in try/catch with `captureError(err, "echo-practice-save-results")`

- [x] Task 7: Implement error pattern tracking (AC: G)
  - [x] 7.1 After each sentence's checking step, collect spelling errors (wrong/missing words) and format as corrections:
    ```typescript
    const spellingCorrections = wordResults
      .filter(wr => wr.status !== "correct")
      .map(wr => ({
        original: wr.typed ?? "(missing)",
        corrected: wr.word,
        explanation: wr.status === "missing" ? "Word was missed" : "Spelling error",
        category: "vocabulary",
      }));
    ```
  - [x] 7.2 Call `extractErrorsFromCorrections(userId, spellingCorrections)` after all sentences are complete (in the results transition, batch all corrections)
  - [x] 7.3 Wrap in try/catch — error tracking failures must not block the results screen

- [x] Task 8: Implement `tryAgain` and `clearOfflineFallback` (AC: A, H)
  - [x] 8.1 `tryAgain()`: reset all state, call `generateExercise()` again
  - [x] 8.2 `clearOfflineFallback()`: set `offlineFallback = false`
  - [x] 8.3 Expose `skipSentence()`: record current sentence with zero scores, advance to next

- [x] Task 9: Computed values (AC: E)
  - [x] 9.1 `overallAccuracy`: average of all three sub-scores across all sentences (useMemo)
  - [x] 9.2 `fullyCorrectCount`: sentences where all three scores > 80 (useMemo)
  - [x] 9.3 `errorPatterns`: reuse `analyzeErrorPatterns()` from `use-dictation.ts` on spelling results (useMemo)
  - [x] 9.4 `getElapsedMinutes`: `Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000))` (useCallback)

- [x] Task 10: Quality gates (AC: Z)
  - [x] 10.1 Run `npm run type-check` — zero errors
  - [x] 10.2 Run `npm run lint` — zero warnings
  - [x] 10.3 Run `npm run format:check` — all files pass

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module | Location | What to Use |
|--------|----------|-------------|
| `generateEchoExercise()` | `src/lib/echo-generation.ts` | Generates sentences + TTS audio + DB insert. Returns `EchoExerciseResult` with `sentences: EchoSentenceWithAudio[]` and `exerciseId: string` |
| `EchoSentenceWithAudio` | `src/lib/echo-generation.ts` | Extends `EchoSentence` with `audioBase64: string` — TTS is pre-generated |
| `compareSentences()` | `src/hooks/use-dictation.ts` | Word-by-word comparison algorithm. Returns `{ wordResults, accuracy, isFullyCorrect }`. Import and reuse — do NOT reimplement |
| `analyzeErrorPatterns()` | `src/hooks/use-dictation.ts` | Analyzes `SentenceResult[]` for pedagogical patterns. Reuse for spelling feedback |
| `WordResult`, `SentenceResult` | `src/hooks/use-dictation.ts` | Exported types for word comparison results |
| `usePronunciation()` | `src/hooks/use-pronunciation.ts` | Wraps Azure Speech assessment. `startAssessment()` → `finishAssessment(referenceText)` → `PronunciationResult` |
| `PronunciationResult` | `src/lib/pronunciation.ts` | Contains `accuracyScore`, `pronunciationScore`, `completenessScore`, `fluencyScore`, `words[]` with per-word scores |
| `useAudioPlayer()` | `src/hooks/use-audio-player.ts` | `playFromBase64(base64, format)` for TTS playback |
| `generateSpeech()` | `src/lib/openai.ts` | TTS generation with `{ voice, speed }` options. Used for slow-speed playback (0.75) |
| `updateSkillProgress()`, `incrementDailyActivity()`, `updateStreak()` | `src/lib/activity.ts` | Shared activity tracking — call on exercise completion |
| `extractErrorsFromCorrections()` | `src/lib/error-tracker.ts` | Batch error tracking — accepts `{ original, corrected, explanation, category }[]` |
| `captureError()` | `src/lib/sentry.ts` | Sentry error reporting with context string |
| `classifyError()` | `src/lib/error-messages.ts` | Classifies errors. Returns `{ message, category }` — `category === "network"` means offline |
| `hapticLight()`, `hapticMedium()`, `hapticSuccess()`, `hapticError()` | `src/lib/haptics.ts` | Haptic feedback at interaction points |
| `useAuthStore` | `src/store/auth-store.ts` | `(s) => s.profile` for `current_cefr_level`, `(s) => s.user` for `user.id` |
| `supabase` | `src/lib/supabase.ts` | Direct DB operations for updating exercise record on completion |

### Architecture Decision: Separate Hook

Per architecture doc: "Echo Practice: Dedicated `use-echo-practice.ts` hook (new exercise type with distinct multi-step flow). Do NOT generalize `useExercise` — keep it focused on single-step MCQ/writing."

The echo hook is structurally closest to `useDictation` but with THREE sub-steps per sentence instead of one. Follow `useDictation`'s patterns for: state management, error handling, progress tracking, ref usage, and return interface shape.

### State Machine: Echo vs Dictation Comparison

| Dictation | Echo Practice | Notes |
|-----------|--------------|-------|
| `idle` | `idle` | Same — waiting for user to start |
| `generating` | `generating` | Same — AI generating content |
| `active` | `listen` → `speak` → `type` | Echo splits "active" into 3 sub-steps |
| `checking` | `checking` | Same — brief state showing per-sentence result |
| `results` | `results` | Same — final results summary |

### Audio Strategy

Normal-speed TTS is **already pre-generated** in `EchoSentenceWithAudio.audioBase64` by `generateEchoExercise()`. Do NOT call `generateSpeech()` for normal playback — just play the pre-generated audio via `audioPlayer.playFromBase64(audioBase64, "mp3")`.

Only call `generateSpeech()` on-demand for **slow-speed playback** (speed: 0.75). Cache slow-speed audio in a ref to avoid re-generation.

### Pronunciation Assessment Flow

```
User taps "Record" → pronunciation.startAssessment() (starts mic)
User taps "Stop" → pronunciation.finishAssessment(sentence.sentence)
  → Records audio, reads as base64, sends to pronunciation-assess Edge Function
  → Returns PronunciationResult with accuracyScore, pronunciationScore, words[]
Store result in state → User can re-record or advance to type step
```

Key fields from `PronunciationResult`:
- `accuracyScore` (0-100): used as **listening comprehension proxy** (if they pronounced it well, they heard it well)
- `pronunciationScore` (0-100): the direct pronunciation quality score
- `words`: array of per-word pronunciation scores for color-coded display in story 6-3

### Spelling Comparison: Import from Dictation

```typescript
import { compareSentences, analyzeErrorPatterns } from "@/src/hooks/use-dictation";
import type { WordResult, SentenceResult } from "@/src/hooks/use-dictation";
```

Compare user's typed text against `currentSentence.expectedSpelling` (NOT `sentence` — `expectedSpelling` is the canonical form with proper accents).

### Database: Exercise Record Update

The exercise record is created by `generateEchoExercise()` with `completed: false`. On completion, update it:

```typescript
await supabase
  .from("exercises")
  .update({
    completed: true,
    score: Math.round(overallScore),
    time_spent_seconds: Math.round((Date.now() - startTimeRef.current) / 1000),
    completed_at: new Date().toISOString(),
  })
  .eq("id", exerciseId);
```

### Return Interface Shape

Follow the `UseDictationReturn` pattern. The echo hook must expose:

```typescript
export interface UseEchoPracticeReturn {
  // State
  screenState: EchoPracticeScreenState;
  sentences: EchoSentenceWithAudio[];
  currentIndex: number;
  currentSentence: EchoSentenceWithAudio | null;
  userInput: string;
  sentenceResults: EchoPracticeSentenceResult[];
  currentPronunciationResult: PronunciationResult | null;
  generateError: string | null;
  offlineFallback: boolean;
  hasPlayed: boolean;
  isSavingResults: boolean;
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  pronunciation: UsePronunciationReturn;

  // Computed
  overallAccuracy: number;
  fullyCorrectCount: number;
  errorPatterns: string[];
  sentenceCount: number;
  getElapsedMinutes: () => number;

  // Actions
  setUserInput: (text: string) => void;
  generateExercise: () => Promise<void>;
  playSentence: (speed?: number) => Promise<void>;
  advanceToSpeak: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  advanceToType: () => void;
  checkSpelling: () => void;
  nextSentence: () => Promise<void>;
  skipSentence: () => void;
  tryAgain: () => void;
  clearOfflineFallback: () => void;
}
```

### Stale Closure Prevention

Follow the `useDictation` pattern — use refs for values accessed in async callbacks:

```typescript
const stateRef = useRef(screenState);
stateRef.current = screenState;
```

Use functional state updaters (`setState(prev => ...)`) instead of reading state directly in callbacks.

### What This Story Does NOT Include

- **No screen UI** — that's story 6-3
- **No practice hub integration** — that's story 6-3
- **No layout registration** — that's story 6-3
- **No DB migration** — exercise_type TEXT is unconstrained, exercise record already created by story 6-1's `generateEchoExercise()`

### Project Structure Notes

- New hook goes at `src/hooks/use-echo-practice.ts` (kebab-case, per naming convention)
- Imports from `src/hooks/use-dictation.ts` for `compareSentences` and `analyzeErrorPatterns` — these are already exported
- Imports from `src/lib/echo-generation.ts` for `generateEchoExercise` and `EchoSentenceWithAudio` — created in story 6-1
- Path alias: `@/*` maps to repo root — use `@/src/hooks/use-dictation` for imports

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 6, Story 6.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Screen State Machine Pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md — Hook vs Library Function Boundary]
- [Source: _bmad-output/planning-artifacts/architecture.md — Echo Practice hook decision: "Dedicated hook, do NOT generalize useExercise"]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Feature Mapping: echo → use-echo-practice.ts → prompts/echo.ts → ai-proxy]
- [Source: _bmad-output/planning-artifacts/architecture.md — Temperature 0.4 for scoring/generation]
- [Source: _bmad-output/planning-artifacts/architecture.md — Layer Boundary: Screens → Hooks → Libraries → Edge Functions]
- [Source: src/hooks/use-dictation.ts — Reference pattern for state machine, error handling, progress saving, compareSentences, analyzeErrorPatterns]
- [Source: src/hooks/use-pronunciation.ts — startAssessment/finishAssessment API, PronunciationResult shape]
- [Source: src/lib/echo-generation.ts — generateEchoExercise API, EchoSentenceWithAudio type]
- [Source: src/lib/activity.ts — updateSkillProgress, incrementDailyActivity, updateStreak signatures]
- [Source: src/lib/error-tracker.ts — extractErrorsFromCorrections signature and correction format]
- [Source: _bmad-output/implementation-artifacts/6-1-echo-practice-prompt-builder-exercise-generation.md — Previous story learnings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- `PronunciationResult` does not have `pronunciationScore` field — used `overallScore` instead (the actual pronunciation quality score from Azure Speech)

### Completion Notes List

- Created `src/hooks/use-echo-practice.ts` — full multi-step echo practice hook
- State machine: idle → generating → listen → speak → type → checking → results
- Listen step: plays pre-generated TTS at normal speed, generates slow-speed (0.75) on-demand with caching
- Speak step: uses `usePronunciation()` for Azure Speech assessment, allows re-recording
- Type step: reuses `compareSentences()` from `use-dictation.ts` against `expectedSpelling`
- Results/scoring: listeningScore = accuracyScore, pronunciationScore = overallScore, spellingScore = compareSentences accuracy
- Progress tracking: updates listening + speaking skill progress, daily activity, streak, and exercise record
- Error tracking: batches spelling errors and feeds to `extractErrorsFromCorrections()` on completion
- Error handling: all catch blocks use `captureError()`, network errors set `offlineFallback`, haptic feedback on errors
- Computed values: overallAccuracy (avg of all 3 sub-scores), fullyCorrectCount (>80 on all 3), errorPatterns via analyzeErrorPatterns
- Quality gates: type-check (0 errors), lint (0 warnings), format:check (all pass)

### Change Log

- 2026-03-31: Implemented story 6-2 — echo practice hook with multi-step exercise flow

### File List

- `src/hooks/use-echo-practice.ts` — NEW: echo practice hook with state machine, scoring, progress tracking
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status updated
- `_bmad-output/implementation-artifacts/6-2-echo-practice-hook-multi-step-exercise-flow.md` — MODIFIED: tasks marked complete
