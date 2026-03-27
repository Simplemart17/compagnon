# Story 3.1: AudioWaveform Processing State & ProcessingIndicator

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner in a voice conversation,
I want clear visual feedback when the AI is processing my speech,
So that I know the AI heard me and is preparing a response, rather than feeling anxious during the silence.

## Acceptance Criteria

### A. Processing State Derivation

1. **AC-A1:** `src/lib/realtime.ts` emits `input_audio_buffer.speech_stopped` and `response.output_audio.delta` events (already emitted via the generic `on()` handler). No new callbacks are needed — `use-realtime-voice.ts` already receives these events.

2. **AC-A2:** `use-realtime-voice.ts` exposes a new `isProcessing: boolean` in its return value. It is `true` when `input_audio_buffer.speech_stopped` fires AND `response.output_audio.delta` has not yet arrived. It resets to `false` on `response.output_audio.delta` (AI starts speaking) or `response.done` (response completed without audio).

3. **AC-A3:** `isProcessing` is never `true` simultaneously with `isSpeaking` or `isAiSpeaking`. The transitions are deterministic: user-speaking -> processing -> ai-speaking.

4. **AC-A4:** `isProcessing` resets to `false` when the conversation ends or encounters an error.

### B. AudioWaveform "processing" Speaker State

5. **AC-B1:** The `speaker` prop type on `AudioWaveform` is extended to `"user" | "ai" | "idle" | "processing"`. The component renders a visually distinct animation for `"processing"` that communicates "thinking" — not lag or error.

6. **AC-B2:** The processing animation is different from idle (slow breathing) and active (oscillating). It should convey active computation — e.g., bars at medium height with a gentle synchronized pulse.

7. **AC-B3:** The waveform bar color in processing state uses `Colors.accent` (amber/gold) to match the ProcessingIndicator dots.

8. **AC-B4:** State transitions between speaker values animate smoothly (existing `withTiming` pattern) at 300ms duration.

### C. ProcessingIndicator Component

9. **AC-C1:** A new `ProcessingIndicator` component exists at `src/components/conversation/ProcessingIndicator.tsx` displaying three 5px animated dots.

10. **AC-C2:** Dot animation: each dot pulses `Colors.accent` at varying opacity (0.3 -> 1.0 -> 0.3) using Reanimated `withRepeat` + `withTiming`, 600ms per cycle, staggered 200ms between dots (dot 0 starts at 0ms, dot 1 at 200ms, dot 2 at 400ms).

11. **AC-C3:** A label renders below the dots using `Typography.caption` with color `Colors.textOnDark` at 50% opacity (`rgba(255,255,255,0.5)`), fontWeight 500.

12. **AC-C4:** Default label text is `"Listening..."` (intentional UX choice — reassures user their speech was heard, even though technically the AI is processing, not listening). When `label` prop is provided, it overrides (used for `"Setting up your conversation..."` during connecting).

13. **AC-C5:** The component fades in/out using Reanimated layout animations: `FadeIn.duration(200)` / `FadeOut.duration(200)`.

14. **AC-C6:** When `isVisible` is `false`, the component is not rendered (conditional rendering with `entering`/`exiting` layout animations).

### D. Connecting State Integration

15. **AC-D1:** During `status === "connecting"`, the ProcessingIndicator is shown with `label="Setting up your conversation..."` and `isVisible={true}`.

16. **AC-D2:** During `status === "connecting"`, the AudioWaveform continues using `isConnecting={true}` (existing synchronized pulse behavior — no changes needed).

### E. Screen Integration

17. **AC-E1:** `app/(tabs)/conversation/[sessionId].tsx` passes the new `isProcessing` state from the hook to both AudioWaveform (`speaker="processing"`) and ProcessingIndicator (`isVisible={isProcessing}`).

18. **AC-E2:** The ProcessingIndicator renders directly below the AudioWaveform component in the layout.

19. **AC-E3:** The speaker prop derivation logic on the screen becomes: `isConnecting ? undefined : isSpeaking ? "user" : isProcessing ? "processing" : isAiSpeaking ? "ai" : "idle"`.

### F. Accessibility

20. **AC-F1:** ProcessingIndicator has `accessibilityRole="status"` on the container.
21. **AC-F2:** ProcessingIndicator has `accessibilityLiveRegion="polite"` to announce state changes without interrupting conversation audio.
22. **AC-F3:** ProcessingIndicator has `accessibilityLabel="Processing: [label text]"` (e.g., `"Processing: Listening..."`).

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

- [x] Task 1: Add `isProcessing` state to `use-realtime-voice.ts` (AC: A1-A4)
  - [x] 1.1 Add `isProcessing: boolean` to `ConversationState` interface (default `false`)
  - [x] 1.2 In the event handler, set `isProcessing = true` on `input_audio_buffer.speech_stopped` event
  - [x] 1.3 Set `isProcessing = false` on `response.output_audio.delta` event (AI starts speaking)
  - [x] 1.4 Set `isProcessing = false` on `response.done` event (safety reset for responses without audio)
  - [x] 1.5 Reset `isProcessing = false` in the `end()` method and on error status
  - [x] 1.6 Export `isProcessing` in `UseRealtimeVoiceReturn` type

- [x] Task 2: Extend AudioWaveform `speaker` prop with `"processing"` state (AC: B1-B4)
  - [x] 2.1 Add `"processing"` to the `speaker` prop union type: `"user" | "ai" | "idle" | "processing"`
  - [x] 2.2 Add `"processing"` case to `getBarColor()` — return `Colors.accent`
  - [x] 2.3 Add processing animation mode: bars at ~40% max height with synchronized gentle pulse (800ms cycle, `Easing.inOut(Easing.sin)`)
  - [x] 2.4 The processing animation should feel distinct from the connecting pulse (connecting is faster at 700ms with lower amplitude 35%; processing is slower at 800ms with slightly higher amplitude ~40%)
  - [x] 2.5 Ensure `isActive` interaction: when `speaker === "processing"`, treat as active for ring pulse animation

- [x] Task 3: Create `ProcessingIndicator` component (AC: C1-C6, F1-F3)
  - [x] 3.1 Create `src/components/conversation/ProcessingIndicator.tsx`
  - [x] 3.2 Define `ProcessingIndicatorProps`: `{ isVisible: boolean; label?: string }`
  - [x] 3.3 Implement three 5px dots in a row with `Colors.accent` background
  - [x] 3.4 Each dot: `withRepeat(withTiming(opacity 0.3->1.0->0.3), -1)` at 600ms cycle, staggered 200ms per dot index
  - [x] 3.5 Label below dots: `Typography.caption`, color `rgba(255,255,255,0.5)`, fontWeight 500, default "Listening..."
  - [x] 3.6 Wrap in `Animated.View` with `entering={FadeIn.duration(200)}` and `exiting={FadeOut.duration(200)}`
  - [x] 3.7 Conditional render: only mount when `isVisible` is `true` (the `entering`/`exiting` props handle animation)
  - [x] 3.8 Add accessibility: `accessibilityRole="status"`, `accessibilityLiveRegion="polite"`, `accessibilityLabel="Processing: {label}"`
  - [x] 3.9 Wrap with `React.memo` using named function pattern

- [x] Task 4: Integrate into conversation screen (AC: D1-D2, E1-E3)
  - [x] 4.1 Import `ProcessingIndicator` in `[sessionId].tsx`
  - [x] 4.2 Destructure `isProcessing` from the `useRealtimeVoice()` hook return
  - [x] 4.3 Update speaker prop derivation (when not connecting): `isSpeaking ? "user" : isProcessing ? "processing" : isAiSpeaking ? "ai" : "idle"` — note: `isConnecting` already overrides via the existing `isConnecting` prop on AudioWaveform, so this chain only runs when connected
  - [x] 4.4 Render ProcessingIndicator directly below AudioWaveform: `<ProcessingIndicator isVisible={isProcessing || status === "connecting"} label={status === "connecting" ? "Setting up your conversation..." : undefined} />`
  - [x] 4.5 Verify AudioWaveform `isActive` is updated to include processing: `isSpeaking || isAiSpeaking || isProcessing`

- [x] Task 5: Quality gates (AC: Z)
  - [x] 5.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 5.2 Verify no regressions: conversation screen still functions for idle, connecting, speaking, ai-speaking, ended, error states

## Dev Notes

### Critical: Event-Based Processing State (NOT Boolean Derivation)

The `isProcessing` state MUST be set from WebSocket events, not derived from `!isSpeaking && !isAiSpeaking`. Boolean derivation is fragile — a dropped frame or delayed state update could flash the wrong state. Use event transitions:

```
speech_stopped → isProcessing = true
response.output_audio.delta → isProcessing = false
response.done → isProcessing = false (safety)
```

This is the canonical approach from the Epic 3 architecture document.

### File Structure

```
NEW FILES:
  src/components/conversation/ProcessingIndicator.tsx  — ProcessingIndicator component

MODIFIED FILES:
  src/hooks/use-realtime-voice.ts         — Add isProcessing state + event wiring
  src/components/conversation/AudioWaveform.tsx  — Add "processing" speaker state + animation
  app/(tabs)/conversation/[sessionId].tsx  — Wire isProcessing to components
```

### Existing Hook Event Handler Pattern

In `use-realtime-voice.ts`, the event handler is a single function passed to `session.on()`. It uses a switch/if-chain on `event.type`. Add the `isProcessing` state changes into the existing handler:

- In the `input_audio_buffer.speech_stopped` case: add `setState(prev => ({ ...prev, isSpeaking: false, isProcessing: true }))`
- In the `response.output_audio.delta` case: add `setState(prev => ({ ...prev, isProcessing: false, isAiSpeaking: true }))` (combine with existing isAiSpeaking = true)
- In the `response.done` case: add `isProcessing: false` reset

The `isSpeaking = false` already happens on `speech_stopped` — combine the `isProcessing = true` in the same setState call.

### AudioWaveform Animation Architecture

The existing AudioWaveform uses 7 bars with individual `useSharedValue` heights. Three animation modes exist (connecting, active, inactive). Adding "processing" means:

1. In the `useEffect` that selects animation mode, add a check for `speaker === "processing"`
2. The processing animation should pulse all 7 bars synchronously (like connecting) but at different timing: 800ms cycle, ~40% max height, using `Easing.inOut(Easing.sin)`
3. Color is handled by `getBarColor()` — just add the `"processing"` case returning `Colors.accent`

Do NOT create a separate animation system — extend the existing `useEffect` that already handles connecting/active/inactive modes.

### ProcessingIndicator Dot Animation Pattern

```typescript
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

// Per dot (index 0, 1, 2):
const opacity = useSharedValue(0.3);
useEffect(() => {
  opacity.value = withDelay(
    index * 200, // stagger: 0ms, 200ms, 400ms
    withRepeat(withTiming(1, { duration: 300 }), -1, true) // 300ms up + 300ms down = 600ms cycle
  );
}, []);
```

### Epic 3 Animation Timing Constants (from architecture)

| Animation | Duration | Easing |
|-----------|----------|--------|
| ProcessingIndicator dot pulse | 600ms per cycle | `withRepeat` + `withTiming` |
| ProcessingIndicator dot stagger | 200ms between dots | Delay offset per dot index |
| ProcessingIndicator fade in/out | 200ms | `FadeIn` / `FadeOut` layout animation |
| Waveform state transition | 300ms | `withTiming` (default easing) |

### Processing State Naming Convention (from architecture)

| Layer | Name | Type |
|-------|------|------|
| `use-realtime-voice.ts` | `isProcessing: boolean` | Hook return value |
| `AudioWaveform` prop | `speaker: "processing"` | Extends existing union |
| `ProcessingIndicator` prop | `isVisible: boolean` | Driven by `isProcessing` from hook |
| Accessibility | `"Processing: Listening..."` | Label text |

**Anti-pattern:** Do NOT introduce names like `isThinking`, `isWaiting`, `state: "loading"`. `"processing"` is the canonical term.

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function | Import Path | Usage |
|----------|-------------|-------|
| `Colors.*`, `Typography.*` | `@/src/lib/design` | All design tokens |
| `skillTint(color, opacity)` | `@/src/lib/design` | Ring border colors (already used in AudioWaveform) |
| `captureError(err, context)` | `@/src/lib/sentry` | Error capture in catch blocks |
| `useRealtimeVoice()` | `@/src/hooks/use-realtime-voice` | Hook already used in [sessionId].tsx |

### AudioWaveform Current Speaker Color Map

```typescript
// Existing in getBarColor():
"user" → Colors.accent
"ai" → Colors.surfaceWhite
"idle" → Colors.surfaceWhite at 22% opacity

// Add:
"processing" → Colors.accent (same color as user — amber/gold)
```

### Component Pattern (follow existing conversation components)

- Named function inside `React.memo`: `export const ProcessingIndicator = React.memo(function ProcessingIndicator(...) { })`
- Props interface exported alongside component
- Reanimated for all animations — no core RN `Animated`
- `@/*` import paths, no relative paths
- `className` for basic flex layout, `style={{}}` for animation-critical properties

### Screen Speaker Derivation Update

Current logic in `[sessionId].tsx`:
```tsx
speaker={isSpeaking ? "user" : isAiSpeaking ? "ai" : "idle"}
```

Updated logic:
```tsx
speaker={isSpeaking ? "user" : isProcessing ? "processing" : isAiSpeaking ? "ai" : "idle"}
```

And for `isActive`:
```tsx
isActive={isSpeaking || isAiSpeaking || isProcessing}
```

### Anti-Patterns to Avoid

- Do NOT modify `src/lib/realtime.ts` — the events needed (`input_audio_buffer.speech_stopped`, `response.output_audio.delta`) are already emitted through the generic `on()` handler. The architecture doc (Story-to-File Mapping) lists `realtime.ts` as modified with new `onUserSpeechStopped`/`onAiResponseStarted` callbacks, but this is unnecessary — `use-realtime-voice.ts` already receives all WebSocket events via the `session.on()` handler and can detect these transitions directly. This is a deliberate architecture deviation that simplifies the implementation.
- Do NOT derive processing from boolean negation: `!isSpeaking && !isAiSpeaking` is fragile
- Do NOT use `Animated` from `react-native` — use only `react-native-reanimated`
- Do NOT create a new animation system in AudioWaveform — extend the existing `useEffect` mode selection
- Do NOT put ProcessingIndicator in `src/components/common/` — it goes in `src/components/conversation/`
- Do NOT use raw hex colors — use `Colors.*` from design tokens
- Do NOT use `accessibilityLiveRegion="assertive"` — use `"polite"` to avoid interrupting audio

### Stories 3.2 and 3.3 Depend on This Story

This story establishes the `isProcessing` state that Stories 3.2 and 3.3 will consume. Key contracts for downstream stories:

- `isProcessing` is exported from `useRealtimeVoice()` return value
- `speaker="processing"` is a valid value on `AudioWaveform`
- `ProcessingIndicator` accepts `isVisible: boolean` and `label?: string`
- The connecting state integration pattern (showing ProcessingIndicator during connecting) is established here

### Previous Story Intelligence (from Story 2-3)

- Branch naming: `feature/3-1-audiowaveform-processing-state-processingindicator`
- Commit prefix: `feat(story-3-1):` for feature work, `chore:` for status updates
- ESLint import order enforced: react -> react-native -> expo -> external -> @/ internal
- The hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/` — no raw hex allowed
- Quality gates: `npm run type-check && npm run lint && npm run format:check`

### Project Structure Notes

- All conversation components live in `src/components/conversation/` (AudioWaveform, TranscriptView, CorrectionBubble, and now ProcessingIndicator)
- Path alias `@/*` maps to repo root — use `@/src/components/conversation/ProcessingIndicator`
- The hook at `src/hooks/use-realtime-voice.ts` is the single source of truth for all conversation state
- The screen at `app/(tabs)/conversation/[sessionId].tsx` orchestrates layout and passes hook state as props

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1 — BDD acceptance criteria, visual spec]
- [Source: _bmad-output/planning-artifacts/epic-3-architecture.md — Decision 1: Processing State Derivation, Decision 3: Component API Evolution, Animation Timing Constants, Processing State Naming Convention, Story-to-File Mapping]
- [Source: src/hooks/use-realtime-voice.ts — ConversationState, event handler pattern, isSpeaking/isAiSpeaking derivation]
- [Source: src/components/conversation/AudioWaveform.tsx — speaker prop union, getBarColor(), animation modes, size prop handling]
- [Source: app/(tabs)/conversation/[sessionId].tsx — hook usage, layout structure, speaker derivation logic]
- [Source: src/lib/realtime.ts — RealtimeEvent types, on() event handler, WebSocket event broadcasting]
- [Source: _bmad-output/implementation-artifacts/2-3-error-journey-progress-bar-home-screen-integration.md — Git patterns, CI checks, component patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

- Task 1: Added `isProcessing: boolean` to `ConversationState` interface and wired event-based transitions: `speech_stopped` -> true, `response.output_audio.delta` -> false, `response.done` -> false (safety), error/end -> false. Exported via `UseRealtimeVoiceReturn` which extends `ConversationState`.
- Task 2: Extended AudioWaveform speaker union with `"processing"`. Added `Colors.accent` bar color. Processing animation: synchronized 800ms pulse at 40% max height (distinct from connecting: 700ms at 35%). Ring pulse and border colors match user/accent pattern.
- Task 3: Created ProcessingIndicator with three 5px dots (staggered 200ms opacity pulse), "Listening..." default label, FadeIn/FadeOut layout animations, accessibility attributes, React.memo wrapper.
- Task 4: Integrated into [sessionId].tsx — speaker derivation includes processing state, isActive includes isProcessing, ProcessingIndicator shown during processing and connecting states with appropriate labels.
- Task 5: All quality gates pass (type-check, lint, format:check). No regressions.

### Change Log

- 2026-03-27: Implemented story 3-1 — AudioWaveform processing state, ProcessingIndicator component, and conversation screen integration.

### File List

- src/hooks/use-realtime-voice.ts (modified)
- src/components/conversation/AudioWaveform.tsx (modified)
- src/components/conversation/ProcessingIndicator.tsx (new)
- app/(tabs)/conversation/[sessionId].tsx (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/3-1-audiowaveform-processing-state-processingindicator.md (modified)
