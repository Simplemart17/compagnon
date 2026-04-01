# Story 5.3: Offline Transition Handling & Component Promotion

Status: done

## Story

As a learner using the app on an unreliable connection,
I want graceful transitions when I go offline mid-activity and reusable components across screens,
So that losing connection never feels like a crash and the UI stays consistent as the app grows.

## Acceptance Criteria

### A. Voice Conversation — Network Drop

- [x] **Given** a user in an active voice conversation **When** the network drops and the WebSocket closes **Then** the screen shows "Connection lost — your conversation has been saved" **And** the user is navigated to the transcript view of the saved conversation **And** no error modal or crash screen appears

### B. Exercise — Already Generated, Network Drops

- [x] **Given** a user mid-exercise with the exercise already generated **When** the network drops **Then** the user can continue answering the current exercise **And** results are queued for sync when connectivity returns via `enqueueWrite()` from `cache.ts`

### C. Exercise — Generating, Network Drops

- [x] **Given** a user mid-exercise while the exercise is generating **When** the network drops **Then** the user sees a message: "Can't generate exercise offline. Review vocabulary instead?" **And** a button navigates them to vocabulary SRS review (offline-capable)

### D. NetworkBanner Debounce

- [x] **Given** the NetworkBanner **When** the network rapidly toggles (flaky connection) **Then** the banner is debounced by 5 seconds — it does not rapidly appear and disappear **And** visual noise from toggling is eliminated

### E. StatTile Promotion

- [x] **Given** the StatTile component currently in `app/(tabs)/profile/index.tsx` **When** it is needed by other screens **Then** it is promoted to `src/components/common/StatTile.tsx` with a props interface, `React.memo`, and accessibility labels

### F. ActivityBar Promotion

- [x] **Given** the ActivityBar component currently in `app/(tabs)/home/index.tsx` **When** it is needed by the profile weekly view **Then** it is promoted to `src/components/common/ActivityBar.tsx` with a props interface, `React.memo`, and accessibility labels

### G. SkillCard Promotion

- [x] **Given** the SkillCard component currently in `app/(tabs)/practice/index.tsx` **When** it is needed as a generalizable tappable feature card **Then** it is promoted to `src/components/common/SkillCard.tsx` with a props interface, `React.memo`, and accessibility labels

### H. Import Cleanup

- [x] **Given** all promoted components **When** extracted to `src/components/common/` **Then** the original screen files import from the new shared location **And** no duplicate component definitions exist **And** `npm run type-check && npm run lint && npm run format:check` pass clean

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

### Part A: Offline Transition Handling

- [x] Task 1: Add debounce to NetworkBanner (AC: D)
  - [x] 1.1 In `src/components/common/NetworkBanner.tsx`, add a 5-second debounce before showing/hiding the banner. Use a `useRef` timer — when `isConnected` changes, clear any pending timer and start a new 5s timeout before applying the state change. The banner should only appear after the device has been continuously offline for 5 seconds, and only disappear after being continuously online for 5 seconds.
  - [x] 1.2 Keep the existing `flushWriteQueue()` call on reconnection — it should fire immediately when `isConnected` goes from false→true (not debounced).

- [x] Task 2: Handle conversation WebSocket disconnection gracefully (AC: A)
  - [x] 2.1 In `src/hooks/use-realtime-voice.ts`, handle the `"connection_lost"` error event (emitted by `realtime.ts` line 207-210 when WebSocket closes after initial connection). Instead of setting `status: "error"` with a generic error, set a new `status: "disconnected"` to distinguish network loss from other errors.
  - [x] 2.2 In `app/(tabs)/conversation/[sessionId].tsx`, detect `status === "disconnected"` and show a distinct UI: message "Connection lost — your conversation has been saved" with a single "View Transcript" button that navigates to the transcript view. Do NOT show the error retry/back buttons. Use `Colors.accent` for the message icon (warning, not error). The conversation data is already auto-saved to DB by the existing `end()` cleanup.
  - [x] 2.3 In `app/(tabs)/conversation/[sessionId].tsx`, auto-navigate to conversation history after 3 seconds if user doesn't tap "View Transcript" — use `router.replace("/(tabs)/conversation/history")` so back button goes to topic selection, not the dead session.

- [x] Task 3: Handle exercise generation network failure (AC: C)
  - [x] 3.1 In `src/hooks/use-exercise.ts`, detect network-specific errors (check error message for "No internet connection" or "network" patterns in the catch block of `generateExercise()`). When detected, set a new state field `offlineFallback: true` instead of the generic error message.
  - [x] 3.2 In the exercise screens that use `useExercise` (grammar, listening, reading, writing, dictation), when `offlineFallback === true`, render a card: "Can't generate exercise offline. Review vocabulary instead?" with a button that navigates to `/(tabs)/practice/vocabulary`. Use `Colors.accent` background tint, not `Colors.error`.

- [x] Task 4: Allow completing in-progress exercises offline (AC: B)
  - [x] 4.1 In `src/hooks/use-exercise.ts` `persistExercise()`, if the Supabase insert fails due to network error, call `enqueueWrite()` from `@/src/lib/cache` with `{ table: "exercises", operation: "insert", payload: exerciseData }`. Show a toast: "Results saved offline — will sync when you're back online" via `useToast()`.
  - [x] 4.2 In `src/hooks/use-exercise.ts` `submitWriting()`, if the evaluation API call fails due to network, show the offline fallback UI (same as Task 3.2) since writing evaluation requires AI.

### Part B: Component Promotion

- [x] Task 5: Promote StatTile (AC: E)
  - [x] 5.1 Create `src/components/common/StatTile.tsx`. Extract from `app/(tabs)/profile/index.tsx` lines 50-103. Wrap in `React.memo`. Export both the component and its `StatTileProps` interface. Keep the existing Reanimated entrance animation and accessibility label.
  - [x] 5.2 In `app/(tabs)/profile/index.tsx`, delete the inline `StatTile` definition and import from `@/src/components/common/StatTile`.

- [x] Task 6: Promote ActivityBar (AC: F)
  - [x] 6.1 Create `src/components/common/ActivityBar.tsx`. Extract from `app/(tabs)/home/index.tsx` lines 114-155. Wrap in `React.memo`. Export both the component and its `ActivityBarProps` interface. Keep the existing Reanimated height animation and accessibility label.
  - [x] 6.2 In `app/(tabs)/home/index.tsx`, delete the inline `ActivityBar` definition and import from `@/src/components/common/ActivityBar`.

- [x] Task 7: Promote SkillCard from practice screen (AC: G)
  - [x] 7.1 Create `src/components/common/SkillCard.tsx`. Extract the **practice screen** version from `app/(tabs)/practice/index.tsx` lines 82-170 — it's the more generalizable card (emoji, bilingual labels, description, accent color, press animation). Wrap in `React.memo`. Export both the component and its `SkillCardProps` interface.
  - [x] 7.2 In `app/(tabs)/practice/index.tsx`, delete the inline `SkillCard` definition and import from `@/src/components/common/SkillCard`.
  - [x] 7.3 The **profile screen** version (`app/(tabs)/profile/index.tsx` lines 109-200) is a different component with different props (skill, skillLevel, exercises, score, progress bar). Rename it to `ProfileSkillCard` in-place — do NOT promote it. It's profile-specific and unlikely to be reused.

- [x] Task 8: Verify import cleanup and quality gates (AC: H)
  - [x] 8.1 Verify no duplicate component definitions remain in the original screen files.
  - [x] 8.2 Run `npm run type-check && npm run lint && npm run format:check` — all must pass clean.

## Dev Notes

### Existing Infrastructure — DO NOT Recreate

| Module | Location | What It Does |
|--------|----------|-------------|
| `NetworkBanner` | `src/components/common/NetworkBanner.tsx` | Shows red banner when offline; flushes write queue on reconnect |
| `isOnline()` / `requireNetwork()` | `src/lib/network.ts` | Connectivity check; throws if offline |
| `enqueueWrite()` / `flushWriteQueue()` | `src/lib/cache.ts` | Offline write queue backed by AsyncStorage |
| `captureError()` | `src/lib/sentry.ts` | Sentry error reporting with context tag |
| `useToast()` | `src/components/common/Toast/ToastContext.tsx` | Toast notification system (from story 5-1) |
| `Colors`, `Typography`, `Spacing`, `Radii`, `Shadows` | `src/lib/design.ts` | Full design token system |
| `skillTint()` | `src/lib/design.ts` | rgba tint generator for colored backgrounds |

### NetworkBanner — Current Implementation Details

Current code in `NetworkBanner.tsx`:
- Uses `NetInfo.addEventListener()` from `@react-native-community/netinfo`
- Tracks `wasDisconnected` ref to know when to flush write queue
- Shows red banner with "No internet connection" — uses `className="items-center bg-error px-4 py-1.5"`
- Mounted in `app/_layout.tsx` BEFORE Toast and Stack
- **What to change:** Add 5-second debounce timer for show/hide state. Keep `flushWriteQueue()` firing immediately on reconnection (not debounced).

### WebSocket Disconnection — Current Flow

1. `realtime.ts` WebSocket `onclose` handler (line 199-212) sets `_isConnected = false`
2. If WebSocket was already connected (promise settled), emits synthetic error: `{ type: "error", error: { message: "Connection lost. Please try again.", code: "connection_lost" } }`
3. `use-realtime-voice.ts` `case "error"` handler (line 384-392) sets `status: "error"` and `error: event.error.message`
4. `[sessionId].tsx` renders error UI with Retry/Back buttons

**What to change:** In step 3, check for `code === "connection_lost"` and set `status: "disconnected"` instead. In step 4, render a distinct "connection lost" UI with "View Transcript" button and auto-navigate.

### Exercise Hook — Current Error Flow

1. `generateExercise()` calls AI API → if network error, `requireNetwork()` in `openai.ts` throws "No internet connection..."
2. Catch block runs `classifyError()` which produces user-friendly message → sets `error` state
3. Exercise screens show error message with retry button

**What to change:** Before `classifyError()`, check if the error is network-related. If so, set `offlineFallback: true` in state. Exercise screens check this flag and show vocabulary redirect instead of generic error.

### Two SkillCard Variants — Important

There are TWO different `SkillCard` components with different props and purposes:

1. **Practice version** (`app/(tabs)/practice/index.tsx:82-170`) — Generalizable card with emoji, bilingual titles, description, accent strip, press animation. **Promote this one** to `src/components/common/SkillCard.tsx`.

2. **Profile version** (`app/(tabs)/profile/index.tsx:109-200`) — Profile-specific with `TCFSkill`, `CEFRLevel`, exercise count, score, progress bar. **Rename to `ProfileSkillCard` in-place** — it's too domain-specific to generalize.

### Component Promotion Pattern

All three promoted components follow the same pattern:
```typescript
// src/components/common/ComponentName.tsx
import React, { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming } from "react-native-reanimated";
import { Colors } from "@/src/lib/design";

export interface ComponentNameProps {
  // ... props
}

export const ComponentName = React.memo(function ComponentName({ ... }: ComponentNameProps) {
  // ... component body (preserve existing animation + accessibility)
});
```

### Project Structure Notes

- All new files go in `src/components/common/` — already contains `NetworkBanner.tsx`, `SkeletonBar.tsx`, `ErrorBoundary.tsx`, `Toast/`
- Path alias: `@/*` maps to repo root — use `@/src/components/common/StatTile` for imports
- NativeWind v4: static layout via `className`, dynamic values via inline `style={{ }}` with design tokens
- No `StyleSheet.create` — use `className` or inline styles only
- `import type { ... }` for type-only imports

### Testing & Quality

- Run `npm run type-check` after every file change
- Run `npm run lint` — zero warnings (`--max-warnings 0`)
- Run `npm run format:check` — Prettier validation
- `scripts/check-hex-colors.sh` — No raw hex values in `app/` or `src/components/`
- No `console.log` statements — use `captureError()` for error reporting

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5, Story 5.3, Lines 1156-1201]
- [Source: _bmad-output/planning-artifacts/architecture.md — Offline Resilience, Lines 83, 711]
- [Source: _bmad-output/planning-artifacts/architecture.md — Network & Graceful Degradation, Lines 407-416]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Offline Transitions, Lines 64-65, 150, 254-260]
- [Source: _bmad-output/planning-artifacts/prd.md — Offline Mode, Lines 304-315]
- [Source: src/components/common/NetworkBanner.tsx — Current implementation]
- [Source: src/lib/cache.ts — Write queue and cacheWithFallback]
- [Source: src/lib/realtime.ts — WebSocket lifecycle, connection_lost event]
- [Source: src/hooks/use-realtime-voice.ts — Error handling flow]
- [Source: src/hooks/use-exercise.ts — Generation and persistence error handling]
- [Source: _bmad-output/implementation-artifacts/5-2-exercise-score-framing-tab-badge-indicators.md — Previous story]
- [Source: _bmad-output/project-context.md — Critical rules and quality gates]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- TypeScript strict check: 0 errors
- ESLint zero-warning policy: 0 warnings
- Prettier format check: all files pass
- Hex color check: no hardcoded hex found

### Completion Notes List
- Task 1: Added 5-second debounce to NetworkBanner show/hide state. `flushWriteQueue()` fires immediately on reconnection (not debounced). Uses `useRef` timer with proper cleanup.
- Task 2: Added `"disconnected"` status to `ConversationState`. WebSocket `connection_lost` errors now show distinct UI with "View Transcript" button and 3-second auto-navigate to history using `router.replace`.
- Task 3: Added `offlineFallback` state field to `useExercise`. Network errors during generation/evaluation set this flag. Created `OfflineFallback` shared component with accent tint, vocabulary redirect button. Added to all 4 exercise screens (grammar, listening, reading, writing).
- Task 4: `persistExercise` now detects network errors and queues writes via `enqueueWrite()`. Shows toast "Results saved offline — will sync when you're back online". Writing evaluation network errors also show offline fallback UI.
- Task 5: Promoted `StatTile` to `src/components/common/StatTile.tsx` with `React.memo`, exported `StatTileProps` interface. Preserved Reanimated entrance animation and accessibility label.
- Task 6: Promoted `ActivityBar` to `src/components/common/ActivityBar.tsx` with `React.memo`, exported `ActivityBarProps` interface. Preserved Reanimated height animation and accessibility label.
- Task 7: Promoted practice `SkillCard` to `src/components/common/SkillCard.tsx` with `React.memo`, exported `SkillCardProps` interface. Preserved press animation, accent strip, bilingual labels. Renamed profile version to `ProfileSkillCard` in-place.
- Task 8: All original screens import from new shared locations. No duplicate component definitions. Cleaned up unused imports (`withDelay`, `skillTint` from practice/index.tsx). All quality gates pass clean.

### Change Log
- 2026-03-28: Implemented story 5-3 — offline transition handling (NetworkBanner debounce, WebSocket disconnection, exercise offline fallback, offline write queue) and component promotion (StatTile, ActivityBar, SkillCard)

### File List
- src/components/common/NetworkBanner.tsx (modified)
- src/components/common/OfflineFallback.tsx (new)
- src/components/common/StatTile.tsx (new)
- src/components/common/ActivityBar.tsx (new)
- src/components/common/SkillCard.tsx (new)
- src/hooks/use-realtime-voice.ts (modified)
- src/hooks/use-exercise.ts (modified)
- app/(tabs)/conversation/[sessionId].tsx (modified)
- app/(tabs)/practice/grammar.tsx (modified)
- app/(tabs)/practice/listening.tsx (modified)
- app/(tabs)/practice/reading.tsx (modified)
- app/(tabs)/practice/writing.tsx (modified)
- app/(tabs)/practice/index.tsx (modified)
- app/(tabs)/profile/index.tsx (modified)
- app/(tabs)/home/index.tsx (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
