# Story 6.3: Echo Practice Screen & Practice Hub Integration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner browsing practice options,
I want to find and use echo practice from the practice hub,
So that I can access this multi-skill exercise alongside my other practice types.

## Acceptance Criteria

### A. Practice Hub Card

- [x] **Given** the practice hub index screen **When** the user views available practice types **Then** an "Echo Practice" skill card appears with a microphone emoji (🎙️), `Colors.skillListening` color, and description "Listen, repeat aloud, then type what you heard" **And** tapping it navigates to `/(tabs)/practice/echo`

### B. Layout Registration

- [x] **Given** the practice layout **When** `echo.tsx` is created **Then** `<Stack.Screen name="echo" options={{ title: "Echo Practice" }} />` is registered in `app/(tabs)/practice/_layout.tsx`

### C. Idle State

- [x] **Given** the echo practice screen in "idle" state **When** the user opens it **Then** a description explains the listen-speak-type flow **And** a "Start Practice" button calls `generateExercise()` **And** if `generateError` is set, an error message + "Retry" button is shown

### D. Generating State

- [x] **Given** the echo practice screen in "generating" state **When** the AI generates the exercise **Then** a skeleton loading animation (3–4 `SkeletonBar` elements matching the exercise layout) is shown with `accessibilityLabel="Generating exercise"`

### E. Listen State

- [x] **Given** the echo practice screen in "listen" state **When** audio plays **Then** a "Play" button (normal speed) and a "Slow" button (0.75x) are shown **And** a sentence counter shows "Sentence N of M" **And** a "Next" button advances to speak after at least one listen (`hasPlayed` guard) **And** no French text is visible — audio only

### F. Speak State

- [x] **Given** the echo practice screen in "speak" state **When** the user records speech **Then** a microphone button with recording indicator is shown (use `pronunciation.isRecording` and `pronunciation.isAssessing` from the hook) **And** after recording, pronunciation word-by-word results are shown using color-coded chips (green ≥80%, orange ≥60%, red <60% via `getScoreColor`) **And** the user can re-record before advancing **And** a "Next" button advances to type (guarded on `currentPronunciationResult !== null`)

### G. Type State

- [x] **Given** the echo practice screen in "type" state **When** the user types their response **Then** a `TextInput` is auto-focused with keyboard visible **And** a "Check" button calls `checkSpelling()` (disabled if input is empty)

### H. Checking State (Per-Sentence Result)

- [x] **Given** the echo practice screen in "checking" state **When** per-sentence results are shown **Then** three sub-scores (Listening, Pronunciation, Spelling) are displayed with color-coded values via `getScoreColor()` **And** word-by-word spelling comparison shows correct (green), missing (red), wrong (orange) chips **And** the original French sentence and English translation are revealed **And** a "Next Sentence" / "See Results" button calls `nextSentence()`

### I. Results State

- [x] **Given** the echo practice screen in "results" state **When** all sentences are complete **Then** a score circle (140×140px, 6px border) displays `overallAccuracy` with color via `getScoreColor()` **And** `getScoreLabel(overallAccuracy)` is shown below the score **And** three sub-score averages (Listening, Pronunciation, Spelling) are shown as stat tiles **And** per-sentence breakdown is shown in a scrollable list **And** "Try Again" and "Back to Practice" buttons are available **And** `fireScoreHaptic(overallAccuracy)` fires on mount

### J. Offline & Error Handling

- [x] **Given** the echo practice screen **When** a network error occurs **Then** `<OfflineFallback onDismiss={clearOfflineFallback} />` is shown **And** `<NetworkBanner />` is rendered at the top of the screen

### K. Skip Sentence

- [x] **Given** any active step (listen/speak/type) **When** the user taps "Skip" **Then** `skipSentence()` is called, recording zero scores, and advancing to the next sentence or results

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [x] Non-obvious interactions have `accessibilityHint`
- [x] Stateful elements have `accessibilityState`
- [x] All tappable elements have minimum 44×44pt touch targets
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Register echo screen in practice layout (AC: B)
  - [x] 1.1 Add `<Stack.Screen name="echo" options={{ title: "Echo Practice" }} />` in `app/(tabs)/practice/_layout.tsx` after the dictation entry

- [x] Task 2: Add echo card to practice hub (AC: A)
  - [x] 2.1 Add `"echo"` to the `PracticeSkill` type in `app/(tabs)/practice/index.tsx`
  - [x] 2.2 Add echo entry to `PRACTICE_LABELS`: `echo: { en: "Echo Practice", fr: "Pratique d'écho" }`
  - [x] 2.3 Add echo card to `PRACTICE_SKILLS` array: `{ skill: "echo", emoji: "🎙️", color: Colors.skillListening, description: "Listen, repeat aloud, then type what you heard" }`
  - [x] 2.4 Verify card navigates to `/(tabs)/practice/echo` on tap

- [x] Task 3: Create `echo.tsx` screen — idle + generating states (AC: C, D)
  - [x] 3.1 Create `app/(tabs)/practice/echo.tsx`
  - [x] 3.2 Import and call `useEchoPractice()` from `@/src/hooks/use-echo-practice`
  - [x] 3.3 Implement idle state: exercise description text + "Start Practice" button + error display with "Retry"
  - [x] 3.4 Implement generating state: `GeneratingSkeleton` component with 3–4 `SkeletonBar` elements

- [x] Task 4: Implement listen state UI (AC: E)
  - [x] 4.1 Show sentence counter: "Sentence {currentIndex + 1} of {sentenceCount}"
  - [x] 4.2 "Play" button → `playSentence()` (normal speed), "Slow" button → `playSentence(0.75)`
  - [x] 4.3 "Next" button → `advanceToSpeak()`, disabled when `!hasPlayed`
  - [x] 4.4 NO French text shown — audio only (tests comprehension)

- [x] Task 5: Implement speak state UI (AC: F)
  - [x] 5.1 Microphone button: tap to `startRecording()` / `stopRecording()`, show recording indicator via `pronunciation.isRecording`
  - [x] 5.2 Show assessing spinner (SkeletonBar) while `pronunciation.isAssessing`
  - [x] 5.3 After recording: display pronunciation word-by-word results as color-coded chips using `currentPronunciationResult.words[]` and `getScoreColor(word.accuracyScore)`
  - [x] 5.4 "Re-record" button to overwrite previous recording
  - [x] 5.5 "Next" button → `advanceToType()`, disabled when `currentPronunciationResult === null`

- [x] Task 6: Implement type state UI (AC: G)
  - [x] 6.1 Auto-focused `TextInput` with `value={userInput}` and `onChangeText={setUserInput}`
  - [x] 6.2 "Check" button → `checkSpelling()`, disabled when `userInput.trim() === ""`

- [x] Task 7: Implement checking state — per-sentence result (AC: H)
  - [x] 7.1 Display three sub-scores: Listening (`listeningScore`), Pronunciation (`pronunciationScore`), Spelling (`spellingScore`) — each color-coded via `getScoreColor()`
  - [x] 7.2 Word-by-word spelling comparison: map `spellingResult.wordResults` to color-coded chips (correct → `Colors.success`, missing → `Colors.error`, wrong → `Colors.accent`)
  - [x] 7.3 Reveal original French sentence + English translation
  - [x] 7.4 Button: "Next Sentence" (or "See Results" on last sentence) → `nextSentence()`

- [x] Task 8: Implement results state (AC: I)
  - [x] 8.1 Score circle: 140×140px, 6px border colored by `getScoreColor(overallAccuracy)`, background `skillTint(color, 0.06)`
  - [x] 8.2 Score label: `getScoreLabel(overallAccuracy)` below circle
  - [x] 8.3 Three stat tiles: avg Listening, avg Pronunciation, avg Spelling — compute from `sentenceResults`
  - [x] 8.4 Per-sentence breakdown in `FlatList` (NOT ScrollView + .map) — each row shows sentence text + 3 sub-scores
  - [x] 8.5 "Try Again" → `tryAgain()`, "Back to Practice" → `router.back()`
  - [x] 8.6 Call `fireScoreHaptic(overallAccuracy)` in `useEffect` on mount

- [x] Task 9: Offline handling + skip (AC: J, K)
  - [x] 9.1 Render `<NetworkBanner />` at screen top
  - [x] 9.2 Conditionally render `<OfflineFallback onDismiss={clearOfflineFallback} />` when `offlineFallback` is true
  - [x] 9.3 Add "Skip" button in listen/speak/type states → `skipSentence()`

- [x] Task 10: Animations & accessibility (AC: Z)
  - [x] 10.1 Use `react-native-reanimated` `FadeIn`, `FadeInDown`, `SlideInRight` for state transitions (follow dictation.tsx pattern)
  - [x] 10.2 Add `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` to all interactive elements
  - [x] 10.3 Add `accessibilityState={{ disabled }}` on conditional buttons
  - [x] 10.4 Ensure all tappable targets ≥ 44×44pt

- [x] Task 11: Quality gates (AC: Z)
  - [x] 11.1 Run `npm run type-check` — zero errors
  - [x] 11.2 Run `npm run lint` — zero warnings
  - [x] 11.3 Run `npm run format:check` — all files pass

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module | Location | What to Use |
|--------|----------|-------------|
| `useEchoPractice()` | `src/hooks/use-echo-practice.ts` | Full hook with state machine, scoring, progress tracking — created in story 6-2 |
| `getScoreColor()` | `src/lib/score-framing.ts` | Returns `Colors.success` (≥80%), `Colors.accent` (≥60%), `Colors.primary` (<60%) |
| `getScoreLabel()` | `src/lib/score-framing.ts` | Returns motivational label ("Excellent!", "Great job!", etc.) |
| `fireScoreHaptic()` | `src/lib/score-framing.ts` | Fires success haptic for ≥80%, light haptic otherwise |
| `SkeletonBar` | `src/components/common/SkeletonBar.tsx` | Pulsing skeleton bar with width/height props |
| `OfflineFallback` | `src/components/common/OfflineFallback.tsx` | Offline state UI with `onDismiss` prop |
| `NetworkBanner` | `src/components/common/NetworkBanner.tsx` | Top-of-screen offline indicator |
| `useToast()` | `src/hooks/use-toast.ts` | `showToast({ type, message })` for notifications |
| `Colors`, `Typography`, `Spacing`, `skillTint` | `src/lib/design.ts` | All design tokens |
| `captureError()` | `src/lib/sentry.ts` | Error reporting |
| `hapticLight()`, `hapticSuccess()` | `src/lib/haptics.ts` | Interaction haptics |

### Primary Template: `dictation.tsx`

**Copy the structural pattern** from `app/(tabs)/practice/dictation.tsx`:
- Same `SafeAreaView` + `ScrollView` wrapper
- Same `getScoreColor()` usage for coloring scores
- Same `GeneratingSkeleton` inline component for loading state
- Same `ComparisonWord` chip pattern for word-by-word display (adapt for both pronunciation words AND spelling words)
- Same score circle (140×140px, 6px border) in results
- Same `FadeIn`/`FadeInDown` animations with staggered delays
- Same accessibility patterns on every interactive element

**Key difference from dictation:** Echo has 3 sub-steps per sentence (listen → speak → type) instead of 1, so each sentence cycles through 3 UI states before showing the per-sentence result in "checking" state.

### Pronunciation Word Display Pattern

From `pronunciation.tsx` — adapt the `WordChip` component for the speak step:

```tsx
// Color-code by accuracy score using getScoreColor()
const color = getScoreColor(wordScore.accuracyScore);
// Background: skillTint(color, 0.09), border: skillTint(color, 0.25)
// Show word text + accuracy % — no need for phoneme drill-down in echo
```

### Spelling Word Display Pattern

From `dictation.tsx` — adapt the `ComparisonWord` component for the checking step:

```tsx
// Status-based coloring:
//   correct → Colors.success background
//   missing → Colors.error background (show expected word)
//   wrong → Colors.accent background (show both typed and expected)
```

### Practice Hub Card Integration

In `app/(tabs)/practice/index.tsx`, the `PRACTICE_SKILLS` array drives the card grid. Each entry needs:
- `skill`: string key used for navigation and label lookup
- `emoji`: display emoji
- `color`: skill color from `Colors.*`
- `description`: one-line exercise description

The card navigates via `router.push(\`/(tabs)/practice/${skill}\`)`. No routing changes needed — Expo Router auto-resolves the file.

### Score Framing (Epic 5)

Results screen MUST use the standardized score framing from story 5-2:
- `getScoreColor(score)` for circle border + stat tile colors
- `getScoreLabel(score)` for motivational text below circle
- `fireScoreHaptic(score)` in `useEffect` on entering results state

### State-to-UI Mapping

| Hook State | UI Shown | Key Data |
|------------|----------|----------|
| `idle` | Description + "Start" button | `generateError` for retry |
| `generating` | Skeleton animation | — |
| `listen` | Play/Slow buttons + counter | `hasPlayed`, `currentIndex`, `sentenceCount` |
| `speak` | Mic button + word results | `pronunciation.isRecording`, `pronunciation.isAssessing`, `currentPronunciationResult` |
| `type` | TextInput + Check button | `userInput`, `setUserInput` |
| `checking` | 3 scores + word comparison + sentence reveal | `sentenceResults[currentIndex]` |
| `results` | Score circle + stats + breakdown | `overallAccuracy`, `sentenceResults`, `fullyCorrectCount` |

### Animations

Use `react-native-reanimated` (4.2) — NEVER React Native built-in `Animated`:
- `FadeIn` for new state content
- `FadeInDown.delay(N * 70)` for staggered card/stat entries
- `SlideInRight` for sentence transitions

### FlatList for Results Breakdown

Per architecture: "Never ScrollView + `.map()` for dynamic lists." Use `FlatList` with `React.memo` on the row component for the per-sentence results breakdown.

### Previous Story (6-2) Learnings

- `PronunciationResult` uses `overallScore` (not `pronunciationScore`) for the pronunciation quality metric
- `accuracyScore` serves as listening comprehension proxy
- `expectedSpelling` (not `sentence`) is the canonical form for spelling comparison
- Slow-speed audio is generated on-demand (0.75 speed) and cached in the hook — screen just calls `playSentence(0.75)`
- `audioPlayer` and `pronunciation` are exposed from the hook — use them directly for recording/playback state

### What This Story Does NOT Include

- **No hook changes** — `use-echo-practice.ts` is complete from story 6-2
- **No prompt builder changes** — `prompts/echo.ts` is complete from story 6-1
- **No DB migration** — exercise_type TEXT is unconstrained
- **No new shared components** — build screen-local components, promote to `src/components/practice/` only if reusable

### Project Structure Notes

- New screen: `app/(tabs)/practice/echo.tsx` (file-based routing)
- Layout registration: `app/(tabs)/practice/_layout.tsx` (add Stack.Screen entry)
- Practice hub: `app/(tabs)/practice/index.tsx` (add to PRACTICE_SKILLS array)
- Path alias: `@/*` maps to repo root — use `@/src/hooks/use-echo-practice` for imports
- Components go in `src/components/` NOT root `components/` (boilerplate)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 6, Story 6.3 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — Phase 2 Feature Mapping: echo → use-echo-practice.ts → prompts/echo.ts → ai-proxy]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture: Hook-driven, Skeleton loading, FlatList, reanimated]
- [Source: _bmad-output/planning-artifacts/architecture.md — File tree: practice/echo.tsx]
- [Source: _bmad-output/planning-artifacts/architecture.md — Requirements Mapping: Echo Practice (FR56-57)]
- [Source: _bmad-output/implementation-artifacts/6-2-echo-practice-hook-multi-step-exercise-flow.md — Hook interface, state machine, audio strategy, previous learnings]
- [Source: src/lib/score-framing.ts — getScoreColor, getScoreLabel, fireScoreHaptic]
- [Source: src/lib/design.ts — Colors, Typography, Spacing, skillTint]
- [Source: app/(tabs)/practice/dictation.tsx — Template screen: state machine UI, score circle, word comparison]
- [Source: app/(tabs)/practice/pronunciation.tsx — WordChip pattern for pronunciation word display]
- [Source: app/(tabs)/practice/index.tsx — PRACTICE_SKILLS array, PracticeSkill type, card structure]
- [Source: app/(tabs)/practice/_layout.tsx — Stack.Screen registration pattern]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed `Animated.Text` closing tag mismatch (JSX error)
- Removed unused `index` prop from `SentenceResultRow` (lint error)
- Ran Prettier to fix formatting

### Completion Notes List

- **Task 1**: Registered `<Stack.Screen name="echo" options={{ title: "Echo Practice" }} />` in practice layout after dictation entry
- **Task 2**: Added `"echo"` to `PracticeSkill` type, `PRACTICE_LABELS`, and `PRACTICE_SKILLS` array with microphone emoji, `Colors.skillListening` color, and correct description
- **Task 3**: Created `echo.tsx` with idle state (description + Start Practice + error/retry + "How it works" steps) and generating state (4 SkeletonBar skeleton with "Generating exercise" a11y label)
- **Task 4**: Listen state with Play/Slow buttons, sentence counter, Next button guarded on `hasPlayed`, no French text visible
- **Task 5**: Speak state with mic button (recording indicator via `pronunciation.isRecording`), assessing skeleton, pronunciation word chips color-coded via `getScoreColor`, re-record button, Next guarded on `currentPronunciationResult !== null`
- **Task 6**: Type state with auto-focused TextInput, Check button disabled when empty
- **Task 7**: Checking state with 3 sub-scores (Listening/Pronunciation/Spelling) color-coded, spelling word comparison chips, original sentence + translation revealed, Next Sentence / See Results button
- **Task 8**: Results state with 140×140px score circle (6px border), `getScoreLabel`, 3 sub-score averages, per-sentence breakdown in FlatList with `React.memo` row, Try Again / Back to Practice buttons, `fireScoreHaptic` on mount
- **Task 9**: NetworkBanner rendered at top of every state, OfflineFallback shown when `offlineFallback` is true, Skip button in listen/speak/type states
- **Task 10**: FadeIn/FadeInDown/FadeInUp/SlideInRight animations, full a11y (accessibilityRole, accessibilityLabel, accessibilityHint, accessibilityState) on all interactive elements, 44pt min touch targets
- **Task 11**: All quality gates pass: type-check (0 errors), lint (0 warnings), format:check (all pass)

### Change Log

- 2026-04-01: Implemented story 6-3 — Echo Practice Screen & Practice Hub Integration (all 11 tasks, all ACs A–K + Z)

### File List

- `app/(tabs)/practice/_layout.tsx` — modified (added echo Stack.Screen)
- `app/(tabs)/practice/index.tsx` — modified (added echo to PracticeSkill type, PRACTICE_LABELS, PRACTICE_SKILLS)
- `app/(tabs)/practice/echo.tsx` — new (full echo practice screen with 7 states)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (story status updated)
- `_bmad-output/implementation-artifacts/6-3-echo-practice-screen-practice-hub-integration.md` — modified (tasks checked, dev agent record)
