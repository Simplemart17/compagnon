# Story 3.2: TranscriptView Condensed Mode & CorrectionBubble Side-Note Variant

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner in a voice conversation,
I want the transcript to be less dominant and corrections to appear as gentle side-notes,
So that I stay focused on the conversation flow rather than being overwhelmed by text and corrections.

## Acceptance Criteria

### A. TranscriptView Condensed Mode

1. **AC-A1:** TranscriptView accepts a new `condensed?: boolean` prop. When `true`, the component renders inside a fixed-height container showing only the last 2-3 messages in the viewport. The full transcript remains accessible by scrolling upward.

2. **AC-A2:** Auto-scroll to the latest message continues to work in condensed mode. New messages push older messages above the visible area smoothly at 60fps — no jump or jank.

3. **AC-A3:** The condensed container height is exactly `160px` (architectural contract — Story 3.3 allocates exactly 160px for the transcript area in the waveform-centered layout).

4. **AC-A4:** When `condensed` is `false` or omitted, TranscriptView behaves identically to its current implementation (flex-1 fills available space). No regressions.

### B. CorrectionBubble Side-Note Variant

5. **AC-B1:** CorrectionBubble accepts a new `variant?: "default" | "sideNote"` prop. When `variant="sideNote"`, it renders as a visually lighter amber left-border card instead of the full-width card.

6. **AC-B2:** SideNote collapsed state shows: category badge + "original -> corrected" one-liner + "Tap for details" affordance text.

7. **AC-B3:** Tapping the sideNote expands it to reveal the full explanation paragraph. The expand/collapse transition uses `withTiming` at 200ms duration (architectural timing constant).

8. **AC-B4:** SideNote styling: 3px left border in `Colors.accent`, semi-transparent background (`Colors.accent` at ~8% opacity via `skillTint`), `Typography.caption` size text, reduced visual weight compared to default variant.

9. **AC-B5:** SideNote entry animation: slides in from the left using Reanimated `SlideInLeft` layout animation at 200ms duration (architectural timing constant).

10. **AC-B6:** When `variant` is `"default"` or omitted, CorrectionBubble behaves identically to its current implementation. No regressions.

### C. SideNote Timing & Placement

11. **AC-C1:** In sideNote variant, corrections attach below the user's message they reference (not below the AI response).

12. **AC-C2:** SideNote corrections appear only AFTER the AI's response audio has finished playing — never during the AI's speaking turn. The `isAiSpeaking` prop (already passed to TranscriptView) controls this: sideNotes for pending corrections render only when `isAiSpeaking === false`.

13. **AC-C3:** When multiple corrections exist for a single user message, they stack vertically in order below that message in sideNote mode.

### D. Accessibility

14. **AC-D1:** SideNote variant retains all existing CorrectionBubble accessibility attributes: `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`.

15. **AC-D2:** The expand/collapse state is communicated via `accessibilityState={{ expanded }}` on each correction item.

16. **AC-D3:** The "Tap for details" affordance text has `accessibilityHint="Double-tap to expand correction details"`.

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

- [x] Task 1: Add `condensed` prop to TranscriptView (AC: A1-A4)
  - [x] 1.1 Add `condensed?: boolean` to `TranscriptViewProps` interface
  - [x] 1.2 When `condensed` is true, wrap FlatList in a `View` with `style={{ height: 160 }}` (fixed 160px container). When false/omitted, keep current flex-1 behavior.
  - [x] 1.3 Verify auto-scroll (`scrollToEnd`) still works inside the fixed-height container — FlatList scrolls within its bounded parent
  - [x] 1.4 Test that scrolling upward to see full history works in condensed mode
  - [x] 1.5 Verify no regressions: when `condensed` is omitted, behavior is identical to current

- [x] Task 2: Add `sideNote` variant to CorrectionBubble (AC: B1-B6)
  - [x] 2.1 Add `variant?: "default" | "sideNote"` to `CorrectionBubbleProps` interface
  - [x] 2.2 When `variant="sideNote"`, render alternate layout: 3px left border (`Colors.accent`), semi-transparent background (`skillTint(Colors.accent, 0.08)`), no top accent bar, no outer border
  - [x] 2.3 SideNote collapsed state: category badge (reuse existing `CATEGORY_STYLES`) + "original -> corrected" one-liner + "Tap for details" text (`Typography.caption`, `Colors.textOnDarkMuted`)
  - [x] 2.4 SideNote expanded state: reveal full explanation paragraph below the one-liner, animated with `withTiming` height transition (200ms)
  - [x] 2.5 Entry animation: use Reanimated `SlideInLeft.duration(200)` layout animation on the sideNote container
  - [x] 2.6 When `variant` is `"default"` or omitted, render current implementation unchanged
  - [x] 2.7 Add `accessibilityState={{ expanded: isExpanded }}` to each correction item
  - [x] 2.8 Wrap with existing `React.memo` pattern (component is already memoized)

- [x] Task 3: Wire sideNote timing in TranscriptView (AC: C1-C3)
  - [x] 3.1 In `AnimatedMessage` (inside TranscriptView), when rendering corrections for a user message: if condensed mode is active, pass `variant="sideNote"` to CorrectionBubble
  - [x] 3.2 Add pending correction visibility logic: corrections for the most recent user message are hidden while `isAiSpeaking === true`, then revealed with SlideInLeft animation when `isAiSpeaking` transitions to `false`
  - [x] 3.3 Corrections for older messages (not the latest user turn) are always visible — the timing gate only applies to the current turn's corrections
  - [x] 3.4 Verify multiple corrections stack vertically below their referenced user message

- [x] Task 4: Quality gates (AC: Z, D1-D3)
  - [x] 4.1 Verify all accessibility attributes on sideNote variant (role, label, hint, state)
  - [x] 4.2 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 4.3 Verify no regressions: existing TranscriptView (non-condensed) and CorrectionBubble (default variant) unchanged
  - [x] 4.4 Verify hex color CI check passes (`scripts/check-hex-colors.sh`)

## Dev Notes

### Critical: Architectural Contracts from Epic 3 Architecture

These values are locked by the architecture document and MUST NOT be changed without updating `epic-3-architecture.md`:

| Contract | Value | Rationale |
|----------|-------|-----------|
| Condensed transcript height | `160px` | Story 3.3 allocates exactly 160px in waveform-centered layout. iPhone SE math: 160 + 172 (waveform) + 55 (controls) + 92 (header) = 479pt < 667pt. |
| CorrectionBubble sideNote slide-in | `200ms` with `SlideInLeft` | From animation timing constants table |
| CorrectionBubble expand/collapse | `200ms` with `withTiming` | From animation timing constants table |
| SideNote trigger | `isAiSpeaking` transition from true to false | NOT `response.done` WebSocket event — audio may still be playing |

### Correction Placement: User Message, Not AI Message

The UX spec is explicit: corrections attach below the **user's** message they reference, not below the AI response. In the current `AnimatedMessage`, corrections render below AI messages. For sideNote variant in condensed mode, this needs to change: the correction should render below the user message that triggered it.

Currently in TranscriptView, the AI message's `corrections` field contains the corrections. To attach them to the preceding user message, the rendering logic needs to:
1. Check if the next message (AI response) has corrections
2. Render those corrections below the current user message in sideNote variant
3. This is a rendering shift only — the data model (corrections on AI message) stays the same

**Alternative (simpler):** Keep corrections rendering below AI messages but use sideNote styling. The UX spec says "attached below the user's message" but in a condensed 160px view with 2-3 messages visible, the visual difference is minimal since messages are close together. Check with user if strict placement is required or if sideNote styling on existing position is acceptable.

### Existing CorrectionBubble Patterns to Reuse

The current CorrectionBubble already has:
- `CATEGORY_STYLES` map with colors for grammar, pronunciation, vocabulary, register — reuse as-is for sideNote badges
- `compact?: boolean` prop that limits to 2 corrections — `variant="sideNote"` is orthogonal to `compact` (both can be used together)
- `expandedIndex` state with toggle logic — same expand/collapse pattern for sideNote
- `TouchableOpacity` with accessibility labels — keep the same interaction pattern
- `React.memo` wrapping — already in place

### TranscriptView FlatList Behavior in Fixed Container

The FlatList already handles scroll within its bounds. Wrapping it in a `View` with `height: 160` constrains the visible area. Key considerations:
- `scrollToEnd({ animated: true })` works because FlatList scrolls within its parent — the content extends beyond 160px but the viewport clips it
- `contentContainerStyle={{ padding: 16, gap: 12 }}` remains unchanged
- `showsVerticalScrollIndicator={false}` stays — no scrollbar in condensed mode
- The `inverted` prop is NOT currently used — messages render top-to-bottom with auto-scroll-to-bottom

### SideNote Visual Design (from UX Spec)

```
+----------------------------------------------+
| [Grammar]  "tu as -> tu aies"  Tap for details|
| | (3px amber left border)                      |
+----------------------------------------------+
```

Expanded:
```
+----------------------------------------------+
| [Grammar]  "tu as -> tu aies"                 |
| |                                              |
| | The subjunctive is required after "il faut   |
| | que" — the indicative "tu as" should be      |
| | "tu aies" in this context.                   |
+----------------------------------------------+
```

- Background: `skillTint(Colors.accent, 0.08)` — very subtle amber wash
- Left border: 3px solid `Colors.accent`
- Category badge: reuse `CATEGORY_STYLES` from current implementation
- Text: `Typography.caption` size (which maps to Typography system)
- "Tap for details": `Colors.textOnDarkMuted` (rgba(255,255,255,0.65))
- No top accent bar (remove for sideNote — the left border is the visual anchor)
- No outer rounded border (the left-border card is the new shape)
- Border radius: `borderTopRightRadius: 12, borderBottomRightRadius: 12` (rounded on right side only)

### Pending Correction Visibility Logic

For the `isAiSpeaking` timing gate on sideNote corrections:

```typescript
// In AnimatedMessage or TranscriptView rendering:
const shouldShowCorrection = variant === "sideNote"
  ? !isAiSpeaking && corrections.length > 0  // sideNote: wait for AI to finish
  : corrections.length > 0;                   // default: show immediately
```

This only gates the LATEST user message's corrections. Older corrections are always visible because `isAiSpeaking` only applies to the current turn. Track this by comparing the message index to the last user message index.

### File Structure

```
MODIFIED FILES:
  src/components/conversation/TranscriptView.tsx   — Add condensed prop, fixed-height container
  src/components/conversation/CorrectionBubble.tsx  — Add sideNote variant, new styling + animation
```

No new files. No changes to hooks, screens, or libs — this story is purely component-level.

### Stories That Depend on This Story

Story 3.3 (Waveform-Centered Layout) depends on:
- `TranscriptView` accepting `condensed={true}` prop
- The condensed container being exactly `160px` height
- `CorrectionBubble` rendering in sideNote variant within condensed view

Story 3.3 will pass `condensed={isConversationActive}` to TranscriptView and wrap it in a 160px container in the waveform-centered layout.

### Previous Story Intelligence (from Story 3-1)

- Branch naming convention: `feature/3-2-transcriptview-condensed-mode-correctionbubble-side-note-variant`
- Commit prefix: `feat(story-3-2):` for feature work, `chore:` for status updates
- ESLint import order enforced: react -> react-native -> expo -> external -> @/ internal
- Hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/` — no raw hex
- Quality gates: `npm run type-check && npm run lint && npm run format:check`
- Story 3-1 confirmed: `isProcessing` exported from `useRealtimeVoice()`, `isAiSpeaking` already passed to TranscriptView as prop — both available for this story
- Story 3-1 architecture deviation: `realtime.ts` was NOT modified (events already available via generic `on()` handler) — no impact on this story

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function | Import Path | Usage |
|----------|-------------|-------|
| `Colors.*`, `Typography.*` | `@/src/lib/design` | All design tokens |
| `skillTint(color, opacity)` | `@/src/lib/design` | Semi-transparent backgrounds |
| `CATEGORY_STYLES` | Already in CorrectionBubble.tsx | Category badge colors — reuse, don't duplicate |
| `SlideInLeft`, `FadeIn`, `FadeOut` | `react-native-reanimated` | Layout animations |
| `withTiming` | `react-native-reanimated` | Expand/collapse animation |

### Anti-Patterns to Avoid

- Do NOT use a percentage-based height for condensed mode — use `160` (fixed px). Dynamic calculations vary per device.
- Do NOT create a new component for sideNote — extend CorrectionBubble with the `variant` prop (matches architecture decision #3: additive props on existing components).
- Do NOT trigger sideNote appearance on `response.done` WebSocket event — audio may still be playing. Use `isAiSpeaking` from the hook.
- Do NOT use `Animated` from `react-native` — use only `react-native-reanimated`.
- Do NOT change the data model (corrections remain on AI messages). Only change rendering placement if needed.
- Do NOT modify `use-realtime-voice.ts` or `[sessionId].tsx` — this story is component-level only. Screen integration happens in Story 3.3.
- Do NOT introduce new color hex values — use `Colors.*` and `skillTint()`.

### Project Structure Notes

- TranscriptView and CorrectionBubble both live in `src/components/conversation/`
- Path alias `@/*` maps to repo root
- Both components already use `React.memo` — maintain this pattern
- Both already import from `@/src/lib/design` — extend existing imports

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2 — BDD acceptance criteria]
- [Source: _bmad-output/planning-artifacts/epic-3-architecture.md — Decision 3: Component API Evolution, Animation Timing Constants, Condensed Transcript Layout Contract, Correction SideNote Trigger, Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Inline Corrections — sideNote visual design spec, placement, trigger timing, emotional framework]
- [Source: src/components/conversation/TranscriptView.tsx — current FlatList implementation, AnimatedMessage, scroll behavior, message rendering]
- [Source: src/components/conversation/CorrectionBubble.tsx — CATEGORY_STYLES, compact prop, expand/collapse pattern, animation system]
- [Source: _bmad-output/implementation-artifacts/3-1-audiowaveform-processing-state-processingindicator.md — Previous story learnings, git patterns, architecture deviations]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- **Task 1:** Added `condensed?: boolean` prop to TranscriptView. When true, FlatList is wrapped in a fixed 160px height container (architectural contract). When false/omitted, original flex-1 behavior preserved. Auto-scroll works within bounded parent.
- **Task 2:** Added `variant?: "default" | "sideNote"` prop to CorrectionBubble. SideNote renders as a 3px amber left-border card with `skillTint(Colors.accent, 0.08)` background. Collapsed shows category badge + "original -> corrected" one-liner + "Tap for details". Expanded reveals explanation with `withTiming` 200ms animation. Entry uses `SlideInLeft.duration(200)`. Extracted `SideNoteItem` as a `React.memo` sub-component for the individual correction items. Default variant completely unchanged.
- **Task 3:** Wired sideNote corrections to render below user messages (not AI messages) in condensed mode. Corrections are sourced by looking ahead to the next AI message's corrections field (data model unchanged). `isAiSpeaking` timing gate hides corrections for the latest user message while AI is speaking; older corrections always visible. Multiple corrections stack vertically.
- **Task 4:** All quality gates pass: `type-check`, `lint`, `format:check`, `check-hex-colors.sh`. Accessibility attributes verified on SideNoteItem: `accessibilityRole="button"`, `accessibilityLabel`, `accessibilityHint` (uses "Double-tap to expand/collapse"), `accessibilityState={{ expanded }}`. Minimum 44pt touch target via `minHeight: 44`.

### Change Log

- 2026-03-27: Implemented all 4 tasks — TranscriptView condensed mode, CorrectionBubble sideNote variant, sideNote timing wiring, quality gates verified.

### File List

- `src/components/conversation/TranscriptView.tsx` — MODIFIED: added `condensed` prop, `CONDENSED_HEIGHT` constant, fixed-height container wrapper, sideNote correction wiring with `isAiSpeaking` timing gate, extended `AnimatedMessageProps`
- `src/components/conversation/CorrectionBubble.tsx` — MODIFIED: added `variant` prop, `SIDE_NOTE_DURATION` constant, `SlideInLeft` import, sideNote rendering branch, new `SideNoteItem` memoized sub-component
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story 3-2 status updated to in-progress then review
