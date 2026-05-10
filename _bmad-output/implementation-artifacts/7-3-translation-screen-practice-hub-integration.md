# Story 7.3: Translation Screen & Practice Hub Integration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner browsing practice options,
I want to find and use translation practice from the practice hub,
So that I can access this unique voice translation exercise alongside my other practice types.

## Acceptance Criteria

### A. Practice Hub Card

- [x] **Given** the practice hub index screen **When** the user views available practice types **Then** a "Translation" skill card appears with a globe/speech emoji (🌐), `Colors.skillSpeaking` color (new token — use `#F97316` orange-500, distinct from existing skill colors), and description "Hear a sentence, speak the French translation" **And** for B2+ users the description could read "Listen and rephrase in different French words" but a single static description is acceptable **And** tapping it navigates to `/(tabs)/practice/translation`

### B. Layout Registration

- [x] **Given** the practice layout **When** `translation.tsx` is created **Then** `<Stack.Screen name="translation" options={{ title: "Translation Practice" }} />` is registered in `app/(tabs)/practice/_layout.tsx`

### C. Idle State

- [x] **Given** the translation screen in "idle" state **When** the user opens it **Then** a description explains the exercise flow: "Hear a sentence, speak the French translation, and receive AI evaluation on accuracy, fluency, and naturalness" **And** for B2+ users (check `profile.cefr_level`), an additional note explains paraphrasing mode: "At your level, you'll rephrase French sentences in your own words" **And** a "Start Practice" button calls `generateExercise()` **And** if `generateError` is set, an error message + "Retry" button is shown

### D. Generating State

- [x] **Given** the translation screen in "generating" state **When** the AI generates the exercise **Then** a skeleton loading animation (3-4 `SkeletonBar` elements matching the listen layout) is shown with `accessibilityLabel="Generating exercise"`

### E. Listen State

- [x] **Given** the translation screen in "listen" state **When** audio plays **Then** the source sentence text IS displayed (unlike echo which hides it — translation requires reading the source) **And** a sentence counter shows "Sentence N of M" **And** "Play" button (normal speed) and "Slow" button (0.75x) are shown **And** a "Record Translation" button advances to recording after at least one listen (`hasPlayed` guard) **And** the mode label ("Translation" or "Paraphrasing") is shown above the sentence

### F. Recording State

- [x] **Given** the translation screen in "recording" state **When** the user records **Then** a microphone button with recording indicator is shown (use `recorder.isRecording` from the hook) **And** the source sentence remains visible as reference **And** after stopping, the user sees "Re-record" and "Submit" buttons **And** "Submit" calls `submitRecording()` and transitions to "evaluating" **And** "Re-record" calls `startRecording()` to clear previous recording

### G. Evaluating State

- [x] **Given** the translation screen in "evaluating" state **When** pronunciation assessment + Whisper transcription + AI evaluation run **Then** a loading indicator (skeleton bars or pulsing animation) is shown with text "Evaluating your translation..." **And** `accessibilityLabel="Evaluating translation"` is set

### H. Per-Sentence Result (after evaluating, before nextSentence)

- [x] **Given** the translation screen **When** evaluation completes for a sentence (not the last) **Then** three dimension scores are shown: Accuracy, Fluency, Naturalness — each color-coded via `getScoreColor()` **And** specific feedback text per dimension from `currentEvaluation` is shown **And** the expected French translation (`currentSentence.target`) is shown for comparison alongside the user's transcription **And** pronunciation word-by-word results are shown if `currentPronunciationResult` is available (color-coded chips: green >=80%, orange >=60%, red <60% via `getScoreColor`) **And** a "Next Sentence" button calls `nextSentence()`

### I. Results State (Final)

- [x] **Given** the translation screen in "results" state **When** all sentences are complete **Then** a score circle (140x140px, 6px border) displays `overallScore` with color via `getScoreColor()` **And** `getScoreLabel(overallScore)` is shown below the score **And** three dimension averages (Accuracy, Fluency, Naturalness) are shown as stat tiles — compute from non-skipped `sentenceResults` **And** per-sentence breakdown is shown in a `FlatList` (NOT ScrollView + .map) **And** "Try Again" → `tryAgain()` and "Back to Practice" → `router.back()` buttons are available **And** `fireScoreHaptic(overallScore)` fires on mount **And** time elapsed is shown via `getElapsedMinutes()`

### J. Offline & Error Handling

- [x] **Given** the translation screen **When** a network error occurs **Then** `<OfflineFallback onDismiss={clearOfflineFallback} />` is shown **And** `<NetworkBanner />` is rendered at the top of the screen

### K. Skip Sentence

- [x] **Given** any active step (listen/recording) **When** the user taps "Skip" **Then** `skipSentence()` is called, recording zero scores, and advancing to the next sentence or results

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [ ] Non-obvious interactions have `accessibilityHint`
- [ ] Stateful elements have `accessibilityState`
- [x] All tappable elements have minimum 44x44pt touch targets
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Add `Colors.skillTranslation` design token (AC: A)
  - [x] 1.1 In `src/lib/design.ts`, add `skillTranslation: "#F97316"` (orange-500) to the `Colors` object in the skill accent colors section, after `skillDictation`
  - [x] 1.2 Verify no existing color conflict — `#F97316` is distinct from all current skill colors (blue, green, amber, purple, pink, cyan, orange/vocabulary). If too close to `skillWriting` (#F59E0B), use `#E11D48` (rose-600) instead

- [x] Task 2: Register translation screen in practice layout (AC: B)
  - [x] 2.1 Add `<Stack.Screen name="translation" options={{ title: "Translation Practice" }} />` in `app/(tabs)/practice/_layout.tsx` after the echo entry

- [x] Task 3: Add translation card to practice hub (AC: A)
  - [x] 3.1 Add `"translation"` to the `PracticeSkill` type union in `app/(tabs)/practice/index.tsx`
  - [x] 3.2 Add translation entry to `PRACTICE_LABELS`: `translation: { en: "Translation", fr: "Traduction" }`
  - [x] 3.3 Add translation card to `PRACTICE_SKILLS` array: `{ skill: "translation", emoji: "🌐", color: Colors.skillTranslation, description: "Hear a sentence, speak the French translation" }`

- [x] Task 4: Create `translation.tsx` screen — idle + generating states (AC: C, D)
  - [x] 4.1 Create `app/(tabs)/practice/translation.tsx`
  - [x] 4.2 Import and call `useTranslation()` from `@/src/hooks/use-translation`
  - [x] 4.3 Import `useAuthStore` to access `profile.cefr_level` for B2+ paraphrasing mode display
  - [x] 4.4 Implement idle state: exercise description text (mention paraphrasing if B2+) + "Start Practice" button + error display with "Retry"
  - [x] 4.5 Implement generating state: `GeneratingSkeleton` component with 3-4 `SkeletonBar` elements matching the listen layout shape
  - [x] 4.6 Add "How it works" steps explaining the 3-step flow (listen → record → evaluate) — follow echo.tsx pattern

- [x] Task 5: Implement listen state UI (AC: E)
  - [x] 5.1 Show sentence counter: "Sentence {currentIndex + 1} of {sentenceCount}"
  - [x] 5.2 Show mode label: "Translation" or "Paraphrasing" based on `exercise.content.mode`
  - [x] 5.3 Display source sentence text (`currentSentence.source`) — UNLIKE echo, translation SHOWS the source text
  - [x] 5.4 "Play" button → `playSource()` (normal speed), "Slow" button → `playSource(0.75)`
  - [x] 5.5 "Record Translation" button → `startRecording()`, disabled when `!hasPlayed`
  - [x] 5.6 "Skip" button → `skipSentence()`

- [x] Task 6: Implement recording state UI (AC: F)
  - [x] 6.1 Source sentence remains visible as reference
  - [x] 6.2 Microphone button: show recording indicator via `recorder.isRecording` — animated pulsing border or glow
  - [x] 6.3 When recording: show "Stop" action to call `stopRecording()`
  - [x] 6.4 After stopping (not recording, has audio): show "Re-record" → `startRecording()` and "Submit" → `submitRecording()`
  - [x] 6.5 "Skip" button available → `skipSentence()`

- [x] Task 7: Implement evaluating state UI (AC: G)
  - [x] 7.1 Show skeleton bars or pulsing animation with "Evaluating your translation..." text
  - [x] 7.2 `accessibilityLabel="Evaluating translation"` and `accessibilityRole="progressbar"`

- [x] Task 8: Implement per-sentence result UI (AC: H)
  - [x] 8.1 Three dimension scores: "Accuracy", "Fluency", "Naturalness" — each showing `currentEvaluation.accuracy.score` etc., color-coded via `getScoreColor()`
  - [x] 8.2 Feedback text per dimension: `currentEvaluation.accuracy.feedback` etc.
  - [x] 8.3 Comparison section: "Expected:" + `currentSentence.target`, "You said:" + `currentEvaluation.userTranscription`
  - [x] 8.4 If `currentPronunciationResult` available: show pronunciation word-by-word chips (color-coded by `accuracyScore` via `getScoreColor`) — reuse the `PronunciationWordChip` pattern from echo.tsx
  - [x] 8.5 "Next Sentence" button → `nextSentence()` (or "See Results" on last sentence)

- [x] Task 9: Implement results state (AC: I)
  - [x] 9.1 Score circle: 140x140px, 6px border colored by `getScoreColor(overallScore)`, background `skillTint(color, 0.06)`
  - [x] 9.2 Score label: `getScoreLabel(overallScore)` below circle
  - [x] 9.3 Three stat tiles: avg Accuracy, avg Fluency, avg Naturalness — compute from non-skipped `sentenceResults[].evaluation`
  - [x] 9.4 Time stat: `getElapsedMinutes()` display
  - [x] 9.5 Per-sentence breakdown in `FlatList` (NOT ScrollView + .map) with `React.memo` row component — each row shows sentence source (truncated) + overall score color chip
  - [x] 9.6 "Try Again" → `tryAgain()`, "Back to Practice" → `router.back()`
  - [x] 9.7 Call `fireScoreHaptic(overallScore)` in `useEffect` on results mount

- [x] Task 10: Offline handling + skip (AC: J, K)
  - [x] 10.1 Render `<NetworkBanner />` at screen top (every state)
  - [x] 10.2 Conditionally render `<OfflineFallback onDismiss={clearOfflineFallback} />` when `offlineFallback` is true
  - [x] 10.3 "Skip" button in listen/recording states → `skipSentence()`

- [x] Task 11: Animations & accessibility (AC: Z)
  - [x] 11.1 Use `react-native-reanimated` `FadeIn`, `FadeInDown`, `SlideInRight` for state transitions (follow echo.tsx pattern)
  - [x] 11.2 Staggered entry animations: `FadeInDown.delay(N * 70).duration(300)` for cards and stat tiles
  - [x] 11.3 Add `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` to all interactive elements
  - [x] 11.4 Add `accessibilityState={{ disabled }}` on conditional buttons (hasPlayed guard, empty recording)
  - [x] 11.5 Ensure all tappable targets >= 44x44pt

- [x] Task 12: Quality gates (AC: Z)
  - [x] 12.1 Run `npm run type-check` — zero errors
  - [x] 12.2 Run `npm run lint` — zero warnings
  - [x] 12.3 Run `npm run format:check` — all files pass

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module                                         | Location                                    | What to Use                                                                             |
| ---------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `useTranslation()`                             | `src/hooks/use-translation.ts`              | Full hook with state machine, recording, evaluation, persistence — created in story 7-2 |
| `getScoreColor()`                              | `src/lib/score-framing.ts`                  | Returns `Colors.success` (>=80%), `Colors.accent` (>=60%), `Colors.primary` (<60%)      |
| `getScoreLabel()`                              | `src/lib/score-framing.ts`                  | Returns motivational label ("Excellent!", "Great job!", etc.)                           |
| `fireScoreHaptic()`                            | `src/lib/score-framing.ts`                  | Fires success haptic for >=80%, light haptic otherwise                                  |
| `SkeletonBar`                                  | `src/components/common/SkeletonBar.tsx`     | Pulsing skeleton bar with width/height props                                            |
| `OfflineFallback`                              | `src/components/common/OfflineFallback.tsx` | Offline state UI with `onDismiss` prop                                                  |
| `NetworkBanner`                                | `src/components/common/NetworkBanner.tsx`   | Top-of-screen offline indicator                                                         |
| `SkillCard`                                    | `src/components/common/SkillCard.tsx`       | Practice hub skill card (used in index.tsx)                                             |
| `useToast()`                                   | `src/hooks/use-toast.ts`                    | `showToast({ type, message })` for notifications                                        |
| `Colors`, `Typography`, `Spacing`, `skillTint` | `src/lib/design.ts`                         | All design tokens                                                                       |
| `captureError()`                               | `src/lib/sentry.ts`                         | Error reporting                                                                         |
| `hapticLight()`, `hapticSuccess()`             | `src/lib/haptics.ts`                        | Interaction haptics                                                                     |
| `useAuthStore`                                 | `src/store/auth-store.ts`                   | `profile` (contains `cefr_level`) for B2+ mode detection                                |

### Primary Template: `app/(tabs)/practice/echo.tsx`

**Copy the structural pattern** from the echo practice screen:

- Same `SafeAreaView` + `ScrollView` wrapper
- Same `GeneratingSkeleton` inline component for loading state
- Same score circle (140x140px, 6px border) in results
- Same `FadeIn`/`FadeInDown`/`SlideInRight` animations with staggered delays
- Same accessibility patterns on every interactive element
- Same `FlatList` with `React.memo` for per-sentence results breakdown
- Same `fireScoreHaptic` in results `useEffect`

### Key Differences from Echo

| Aspect                | Echo                                                                                           | Translation                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| States                | idle → generating → listen → speak → type → checking → results                                 | idle → generating → listen → recording → evaluating → results                                |
| Steps per sentence    | 3 (listen, speak, type)                                                                        | 2 (listen, record) + evaluation wait                                                         |
| Source text visible   | NO (tests comprehension)                                                                       | YES (translation requires reading source)                                                    |
| Recording control     | Via `pronunciation` from hook                                                                  | Via `recorder` from hook (direct `useAudioRecorder`)                                         |
| Evaluation            | Pronunciation score + spelling comparison                                                      | 3 dimension scores (accuracy, fluency, naturalness) + pronunciation                          |
| Sub-scores in results | Listening, Pronunciation, Spelling                                                             | Accuracy, Fluency, Naturalness                                                               |
| Mode branching        | None                                                                                           | "Translation" vs "Paraphrasing" label (UI only, no logic difference)                         |
| Typing step           | Yes (TextInput for spelling)                                                                   | No (voice only)                                                                              |
| Hook action names     | `playSentence()`, `startRecording()`, `advanceToSpeak()`, `advanceToType()`, `checkSpelling()` | `playSource()`, `startRecording()`, `stopRecording()`, `submitRecording()`, `nextSentence()` |

### Hook State-to-UI Mapping

| Hook State            | UI Shown                                   | Key Data from Hook                                                                              |
| --------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `idle`                | Description + "Start" button               | `generateError` for retry, `profile.cefr_level` for B2+ note                                    |
| `generating`          | Skeleton animation                         | —                                                                                               |
| `listen`              | Source text + Play/Slow + counter          | `currentSentence.source`, `hasPlayed`, `currentIndex`, `sentenceCount`, `exercise.content.mode` |
| `recording`           | Mic button + source ref + Submit/Re-record | `recorder.isRecording`, source sentence for reference                                           |
| `evaluating`          | Loading skeleton + "Evaluating..."         | —                                                                                               |
| After eval (not last) | 3 dimension scores + comparison + Next     | `currentEvaluation`, `currentPronunciationResult`, `currentSentence.target`                     |
| `results`             | Score circle + stats + breakdown           | `overallScore`, `sentenceResults`, `getElapsedMinutes()`                                        |

### Recording State Flow (Critical UX Detail)

Unlike echo (which uses `pronunciation.isRecording` / `pronunciation.isAssessing`), translation uses `recorder` directly:

```
Recording state has 3 sub-states (all within screenState === "recording"):
1. Not yet recording: show "Tap to Record" mic button
2. Recording: `recorder.isRecording === true` → show pulsing mic + "Tap to Stop"
3. Stopped: `recorder.isRecording === false` AND has recorded → show "Re-record" + "Submit"

After "Submit": screenState transitions to "evaluating"
```

The hook exposes `recorder.isRecording` boolean. The base64 audio is captured internally by `stopRecording()` into a ref — the screen doesn't need to handle audio data directly.

### B2+ Paraphrasing Mode Display

The hook's `exercise.content.mode` is either `"translation"` or `"paraphrasing"`:

- **Idle state**: Add a note for B2+ users: "At your level, you'll rephrase French sentences in your own words"
- **Listen state**: Show mode label above sentence: "Translation" or "Paraphrasing"
- **No logic branching** needed in the screen — the hook handles everything identically

Detect B2+: `const isAdvanced = ["B2", "C1", "C2"].includes(profile?.cefr_level ?? "A1")`

### Dimension Score Display Pattern

Translation evaluation returns 3 scores not present in echo. Display pattern for per-sentence result:

```tsx
// Three dimension scores in a row (similar to echo's 3 sub-scores)
<View className="flex-row justify-around">
  <DimensionScore label="Accuracy" score={evaluation.accuracy.score} />
  <DimensionScore label="Fluency" score={evaluation.fluency.score} />
  <DimensionScore label="Naturalness" score={evaluation.naturalness.score} />
</View>
// Below: feedback text for each dimension
// Below: comparison (expected vs user transcription)
```

### Results Dimension Averages

Compute from `sentenceResults`:

```typescript
const nonSkipped = sentenceResults.filter((r) => !r.skipped && r.evaluation);
const avgAccuracy =
  nonSkipped.length > 0
    ? Math.round(
        nonSkipped.reduce((s, r) => s + r.evaluation!.accuracy.score, 0) / nonSkipped.length
      )
    : 0;
// Same for fluency and naturalness
```

### Animations

Use `react-native-reanimated` (4.2) — NEVER React Native built-in `Animated`:

- `FadeIn` for new state content
- `FadeInDown.delay(N * 70)` for staggered card/stat entries
- `SlideInRight` for sentence transitions
- Mic recording: pulsing border via `useAnimatedStyle` or simpler opacity loop

### FlatList for Results Breakdown

Per architecture: "Never ScrollView + `.map()` for dynamic lists." Use `FlatList` with `React.memo` on the row component for the per-sentence results breakdown. Each row: sentence source (truncated, `numberOfLines={1}`) + overall score chip colored via `getScoreColor`.

### Previous Story (7-2) Learnings

- `recorder.isRecording` indicates active recording — use for mic button state
- `stopRecording()` stores base64 internally, `submitRecording()` uses it — screen never handles raw audio
- `currentEvaluation` is null until evaluation completes — guard all renders
- `currentPronunciationResult` may be null (pronunciation assessment can fail independently) — render conditionally
- `exercise.content.mode` is available after generation — use for display labels
- `audioPlayer` is exposed from hook — check `audioPlayer.isPlaying` if needed for play button state
- `hasPlayed` must be true before allowing recording advance
- `overallScore` is pre-computed by the hook (average of non-skipped evaluation.overallScore values)

### Previous Story (6-3 Echo Screen) Learnings

- `GeneratingSkeleton` as inline component (not shared) — define within the screen file
- `PronunciationWordChip` component for pronunciation word-by-word display — adapt for translation
- `SentenceResultRow` with `React.memo` for FlatList performance
- `SubScoreTile` component for stat display — adapt labels from Listening/Pronunciation/Spelling to Accuracy/Fluency/Naturalness
- Score circle: exact pattern `w-[140px] h-[140px] rounded-full` with 6px border
- All buttons use `Pressable` with `({ pressed }) => [...]` for press feedback (scale 0.97, opacity 0.8)
- `useEffect` with `fireScoreHaptic` fires only when `screenState === "results"`

### What This Story Does NOT Include

- **No hook changes** — `use-translation.ts` is complete from story 7-2
- **No prompt builder changes** — `prompts/translation.ts` is complete from story 7-1
- **No DB migration** — uses existing exercises table
- **No Edge Function changes** — transcribe action added in story 7-2
- **No new shared components** — build screen-local components, promote only if reused across 2+ screens

### Project Structure Notes

- New screen: `app/(tabs)/practice/translation.tsx` (file-based routing)
- New design token: `Colors.skillTranslation` in `src/lib/design.ts`
- Layout registration: `app/(tabs)/practice/_layout.tsx` (add Stack.Screen entry)
- Practice hub: `app/(tabs)/practice/index.tsx` (add to PracticeSkill type, PRACTICE_LABELS, PRACTICE_SKILLS)
- Path alias: `@/*` maps to repo root — use `@/src/hooks/use-translation` for imports
- Components go in `src/components/` NOT root `components/` (boilerplate)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.3 acceptance criteria (lines 1416-1466)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Feature Mapping: translation → use-translation.ts → prompts/translation.ts → ai-proxy]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture: Hook-driven, Skeleton loading, FlatList, reanimated]
- [Source: _bmad-output/planning-artifacts/architecture.md — File tree: practice/translation.tsx]
- [Source: _bmad-output/planning-artifacts/architecture.md — Requirements Mapping: Translation (FR53-55)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR53-55: Speech-to-speech translation requirements]
- [Source: _bmad-output/implementation-artifacts/7-2-translation-exercise-hook.md — Hook interface, state machine, recording strategy, Whisper transcription]
- [Source: _bmad-output/implementation-artifacts/7-1-translation-prompt-builder-evaluation-logic.md — TranslationContent, TranslationEvaluation types]
- [Source: _bmad-output/implementation-artifacts/6-3-echo-practice-screen-practice-hub-integration.md — Template screen pattern, all UI components]
- [Source: src/hooks/use-translation.ts — UseTranslationReturn interface, TranslationScreenState, exposed actions]
- [Source: src/lib/score-framing.ts — getScoreColor, getScoreLabel, fireScoreHaptic]
- [Source: src/lib/design.ts — Colors, Typography, Spacing, skillTint]
- [Source: app/(tabs)/practice/echo.tsx — Primary screen template: state machine UI, score circle, word chips, FlatList results]
- [Source: app/(tabs)/practice/dictation.tsx — Secondary template: skeleton, score circle, word comparison]
- [Source: app/(tabs)/practice/index.tsx — PRACTICE_SKILLS array, PracticeSkill type, card structure]
- [Source: app/(tabs)/practice/_layout.tsx — Stack.Screen registration pattern]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- No issues encountered during implementation.

### Completion Notes List

- Added `Colors.skillTranslation: "#F97316"` (orange-500) design token — distinct from `skillWriting` (#F59E0B amber)
- Registered `translation` screen in practice layout with `Stack.Screen`
- Added translation card to practice hub: PracticeSkill type, PRACTICE_LABELS, PRACTICE_SKILLS array, hero dot
- Created full `translation.tsx` screen with all 7 states: idle, generating, listen, recording, evaluating, per-sentence result, results
- Idle state includes B2+ paraphrasing mode note, "How it works" steps, error/retry/offline handling
- Generating state uses `GeneratingSkeleton` with staggered `FadeInDown` animations
- Listen state shows source sentence (unlike echo which hides it), Play/Slow buttons, hasPlayed guard, mode label
- Recording state uses `RecordingMicButton` with pulsing animation via `useAnimatedStyle`, Re-record/Submit flow
- Evaluating state shows skeleton bars with "Evaluating your translation..." text
- Per-sentence result shows 3 dimension scores (Accuracy, Fluency, Naturalness), feedback text, expected vs user comparison, pronunciation word chips
- Results state uses `FlatList` (not ScrollView+map) with `React.memo` `SentenceResultRow`, score circle (140x140px, 6px border), dimension averages, time elapsed, fireScoreHaptic
- All colors use `Colors.*` design tokens — no hardcoded hex
- All loading states use skeleton animations — no ActivityIndicator
- All interactive elements have `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, `accessibilityState`
- All tappable elements >= 44pt minimum touch targets
- Quality gates pass: type-check (0 errors), lint (0 warnings), format:check (all pass)

### Change Log

- 2026-04-01: Implemented story 7-3 — Translation screen and practice hub integration. All 12 tasks complete.

### File List

- `src/lib/design.ts` — added `skillTranslation` color token
- `app/(tabs)/practice/_layout.tsx` — added translation Stack.Screen entry
- `app/(tabs)/practice/index.tsx` — added translation to PracticeSkill type, PRACTICE_LABELS, PRACTICE_SKILLS, hero dots
- `app/(tabs)/practice/translation.tsx` — NEW: full translation practice screen (all states)
