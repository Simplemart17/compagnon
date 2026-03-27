# Story 3.3: Waveform-Centered Layout & Latency Masking

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner having a voice conversation,
I want the conversation screen to feel immersive with the waveform as the visual anchor and natural-sounding AI processing,
So that the experience feels like talking to a person rather than using a tool.

## Acceptance Criteria

### A. Waveform-Centered Layout (Active Conversation)

1. **AC-A1:** When the conversation status is `"connected"` or `"connecting"`, the screen uses a waveform-centered layout: condensed TranscriptView (160px fixed height) at the top, large AudioWaveform (size `140`) centered in the remaining flex space, and end/control buttons at the bottom. No other UI elements compete for attention.

2. **AC-A2:** When the conversation status is `"idle"`, `"ended"`, or `"error"`, the screen uses the current layout: full TranscriptView (flex-1) dominant, small AudioWaveform (size `60`). No regressions to pre-connection or post-conversation states.

3. **AC-A3:** The layout swap happens at connection start (coincides with the "connecting" animation state). There is no animated layout transition between modes — the connecting animation provides natural visual cover.

4. **AC-A4:** On iPhone SE (375pt x 667pt), the waveform + condensed transcript + end button fit without scrolling: 160px (transcript) + 172px (waveform with rings) + 55px (controls) + 92px (header + status bar) = 479pt < 667pt.

5. **AC-A5:** The ProcessingIndicator renders below the centered waveform (same relative position as current, but now in the larger center area). It remains driven by `isProcessing` and `status === "connecting"` props — no change to its logic.

6. **AC-A6:** The text input field (keyboard toggle) continues to work in the waveform-centered layout. When visible, it appears between the waveform area and the bottom controls.

### B. Filler Phrase Latency Masking

7. **AC-B1:** All 3 conversation mode builders in `src/lib/prompts/conversation.ts` (companion, debate, TCF simulation) include a filler phrase instruction paragraph in the system prompt.

8. **AC-B2:** The instruction tells the AI to use French thinking phrases when formulating responses: "Alors voyons...", "Hmm bonne question...", "Eh bien...", "Voyons voir...", "Comment dire..." — varied naturally. The instruction is level-appropriate (simpler fillers for A1/A2, richer discourse markers for B2+).

9. **AC-B3:** No runtime logic is added — the filler phrase behavior is entirely driven by the system prompt instruction. The AI naturally varies usage.

### C. State Transitions & Visual Cohesion

10. **AC-C1:** The 5 conversation states (connecting, idle, user-speaking, processing, ai-speaking) each produce a visually distinct waveform appearance in the centered layout. All existing AudioWaveform behavior is preserved — only the `size` prop changes.

11. **AC-C2:** When the conversation ends, the screen transitions back to the full transcript layout showing the complete conversation history. The feedback bottom sheet then slides up as it does today.

### D. Accessibility

12. **AC-D1:** The condensed TranscriptView in the waveform-centered layout retains `accessibilityLiveRegion="polite"` behavior for new messages.

13. **AC-D2:** The larger AudioWaveform retains its existing `accessibilityLabel` and `accessibilityRole`.

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

- [x] Task 1: Restructure `[sessionId].tsx` layout — conditional waveform-centered mode (AC: A1-A6, C1-C2, D1-D2)
  - [x] 1.1 Add `isConversationActive` derived const: `const isConversationActive = conversation.status === "connected" || conversation.status === "connecting";`
  - [x] 1.2 When `isConversationActive` is true, render waveform-centered layout:
    - Condensed TranscriptView at top: `<View style={{ height: 160 }}><TranscriptView ... condensed /></View>`
    - AudioWaveform centered in flex-1 area: `<View className="flex-1 items-center justify-center">` containing `<AudioWaveform ... size={140} />` + `<ProcessingIndicator .../>` below it
    - Controls at bottom (unchanged structure)
  - [x] 1.3 When `isConversationActive` is false, keep existing layout: `<View className="flex-1"><TranscriptView ... /></View>` + small waveform section (size `60`)
  - [x] 1.4 Pass `condensed={isConversationActive}` to TranscriptView (the prop already exists from Story 3.2)
  - [x] 1.5 Move the text input rendering so it appears between the waveform center area and bottom controls in the centered layout
  - [x] 1.6 Verify the feedback bottom sheet still works after the layout swap (status changes to "ended" → layout reverts to full transcript → feedback sheet overlays)
  - [x] 1.7 Verify back-press guard and gesture disable still work in the centered layout

- [x] Task 2: Add filler phrase instruction to conversation prompts (AC: B1-B3)
  - [x] 2.1 In `buildConversationPrompt()`, add a new section after the Idiom Injection section
  - [x] 2.2 Section content — level-aware instruction:
    - A1/A2: simple fillers ("Alors...", "Euh...", "Bon...", "Voyons...")
    - B1/B2: natural discourse markers ("Alors voyons...", "Hmm bonne question...", "Eh bien...", "Comment dire...", "C'est-a-dire...")
    - C1/C2: sophisticated thinking phrases ("Voyons voir...", "En fait, c'est une question interessante...", "Si je comprends bien...", "Il faut que je reflechisse...")
  - [x] 2.3 The instruction tells the AI to use these phrases naturally when formulating responses to mask processing latency — not to force them into every response

- [x] Task 3: Quality gates (AC: Z)
  - [x] 3.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 3.2 Run `scripts/check-hex-colors.sh` — verify no raw hex values
  - [x] 3.3 Verify no regressions in pre-connection layout (idle, error, ended states)
  - [x] 3.4 Verify iPhone SE layout math: header (92px) + transcript (160px) + waveform area with rings (172px) + controls (55px) = 479px < 667px

## Dev Notes

### Critical: Architectural Contracts from Epic 3 Architecture

These values are locked by the architecture document and MUST NOT be changed without updating `epic-3-architecture.md`:

| Contract | Value | Rationale |
|----------|-------|-----------|
| Condensed transcript height | `160px` | Fixed allocation in waveform-centered layout. iPhone SE math validated. |
| Centered waveform size | `140` | Large enough to be visual anchor, small enough for iPhone SE. Rings add 32px total. |
| Small waveform size (pre/post) | `60` | Existing value, unchanged |
| Layout swap trigger | `status === "connected" \|\| status === "connecting"` | Swap happens during connecting animation — natural visual cover |

### Current Layout Structure (lines 308-345 of [sessionId].tsx)

The existing layout you must restructure:

```
<View className="flex-1">                              ← Full transcript (dominant)
  <TranscriptView transcript={...} pendingAiText={...} isAiSpeaking={...} />
</View>

{(connected || connecting) && (                        ← Small waveform section
  <View className="items-center py-2">
    <AudioWaveform ... size={60} />
    <ProcessingIndicator ... />
  </View>
)}
```

Must become (when `isConversationActive`):

```
<View style={{ height: 160 }}>                         ← Condensed transcript (fixed)
  <TranscriptView ... condensed />
</View>

<View className="flex-1 items-center justify-center">  ← Centered waveform (flex)
  <AudioWaveform ... size={140} />
  <ProcessingIndicator ... />
</View>
```

And revert to the original layout when NOT `isConversationActive`.

### Filler Phrase Placement in Prompt

Add a new `## Natural Conversation Flow` section in `buildConversationPrompt()` after the Idiom Injection section (after line 59). This is additive — do NOT modify existing sections.

The instruction should be:
- Conditional on CEFR level for phrase complexity
- Clear that this is about natural speech flow, not forced phrases
- Explain the purpose: "To make the conversation feel natural, use French thinking phrases when you need a moment to formulate your response"

### What NOT to Change

- `AudioWaveform.tsx` — no changes needed. Only the `size` prop value changes (60 → 140) when passed from the screen.
- `TranscriptView.tsx` — no changes needed. The `condensed` prop already exists from Story 3.2.
- `CorrectionBubble.tsx` — no changes needed.
- `ProcessingIndicator.tsx` — no changes needed.
- `use-realtime-voice.ts` — no changes needed.
- `realtime.ts` — no changes needed.
- Edge Functions — filler phrases are in the system prompt, no server-side changes.

### Files Modified (2 files only)

| File | Change |
|------|--------|
| `app/(tabs)/conversation/[sessionId].tsx` | Conditional layout swap: waveform-centered when active, full transcript when not. Pass `condensed` prop, change `size` prop. |
| `src/lib/prompts/conversation.ts` | Add filler phrase instruction section to `buildConversationPrompt()` after Idiom Injection |

### Previous Story Intelligence (from Story 3-2)

- Branch naming convention: `feature/3-3-waveform-centered-layout-latency-masking`
- Commit prefix: `feat(story-3-3):` for feature work, `chore:` for status updates
- ESLint import order enforced: react -> react-native -> expo -> external -> @/ internal
- Hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/`
- Quality gates: `npm run type-check && npm run lint && npm run format:check`
- Story 3-2 confirmed: `TranscriptView` already has `condensed?: boolean` prop and `CONDENSED_HEIGHT = 160`
- Story 3-2 confirmed: `CorrectionBubble` already has `variant?: "default" | "sideNote"` prop
- Story 3-1 confirmed: `isProcessing` exposed from `useRealtimeVoice()`, `ProcessingIndicator` component exists
- Story 3-1 confirmed: `AudioWaveform` already supports `speaker: "processing"` and has a `size` prop (default 180)

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function | Import Path | Usage |
|----------|-------------|-------|
| `Colors.*` | `@/src/lib/design` | All design tokens — already imported in `[sessionId].tsx` |
| `TranscriptView` with `condensed` prop | `@/src/components/conversation/TranscriptView` | Already imported |
| `AudioWaveform` with `size` prop | `@/src/components/conversation/AudioWaveform` | Already imported |
| `ProcessingIndicator` | `@/src/components/conversation/ProcessingIndicator` | Already imported |

### Anti-Patterns to Avoid

- Do NOT animate the layout transition between full-transcript and waveform-centered modes. The connecting animation provides visual cover — an animated swap would compete with it and risk jank.
- Do NOT use percentage-based heights for the condensed transcript — use `160` (fixed px).
- Do NOT calculate waveform size from screen dimensions — use `140` (fixed value).
- Do NOT create new components or wrapper views beyond what's needed for the layout swap.
- Do NOT modify the feedback bottom sheet — it overlays the full transcript layout after conversation ends.
- Do NOT add filler phrase selection logic at runtime — the AI model handles natural variation from the system prompt instruction.
- Do NOT use `Animated` from `react-native` — use only `react-native-reanimated` if any animation is needed.

### Project Structure Notes

- `[sessionId].tsx` lives in `app/(tabs)/conversation/`
- `conversation.ts` (prompts) lives in `src/lib/prompts/`
- Path alias `@/*` maps to repo root
- Both files already exist and are well-established

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3 — BDD acceptance criteria]
- [Source: _bmad-output/planning-artifacts/epic-3-architecture.md — Decision 2: Layout Restructuring Strategy, Decision 4: Filler Phrase Strategy, Waveform Size Contract, Condensed Transcript Layout Contract, Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Anti-UI voice screen philosophy, latency masking with French filler phrases]
- [Source: app/(tabs)/conversation/[sessionId].tsx — Current layout structure (lines 308-345), controls, feedback sheet]
- [Source: src/lib/prompts/conversation.ts — buildConversationPrompt function, Idiom Injection section]
- [Source: _bmad-output/implementation-artifacts/3-2-transcriptview-condensed-mode-correctionbubble-side-note-variant.md — Previous story learnings, TranscriptView condensed implementation, CorrectionBubble sideNote variant]
- [Source: _bmad-output/implementation-artifacts/3-1-audiowaveform-processing-state-processingindicator.md — isProcessing state, ProcessingIndicator component, AudioWaveform processing animation]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Prettier formatting fix required on conversation.ts after adding filler phrase section (auto-fixed with `npx prettier --write`)

### Completion Notes List

- **Task 1:** Restructured `[sessionId].tsx` with conditional layout swap. When `isConversationActive` (connected/connecting), renders condensed TranscriptView (160px fixed height) at top with large centered AudioWaveform (size 140) in flex space. When not active, preserves original full-transcript layout. Text input positioned between waveform and controls. Gesture disable updated to use `isConversationActive`. Feedback sheet and back-press guard verified — both depend on status transitions that correctly toggle the layout.
- **Task 2:** Added `## Natural Conversation Flow` section to `buildConversationPrompt()` after Idiom Injection. Level-aware: A1/A2 gets simple fillers (Alors, Euh, Bon), B1/B2 gets discourse markers (Alors voyons, Hmm bonne question, Comment dire), C1/C2 gets sophisticated phrases (Voyons voir, C'est un point de vue qui mérite réflexion). Instruction explicitly states not to force fillers — natural usage only. Applies to all 3 conversation modes since it's in the base prompt.
- **Task 3:** All quality gates pass: type-check (0 errors), ESLint (0 warnings), Prettier (all formatted), hex color check (no raw hex). iPhone SE layout math verified: 92+160+172+55=479 < 667.

### File List

- `app/(tabs)/conversation/[sessionId].tsx` — Conditional waveform-centered layout, `isConversationActive` derived const, size prop 60→140, condensed prop, text input repositioned
- `src/lib/prompts/conversation.ts` — Added Natural Conversation Flow filler phrase section with CEFR-level-aware instructions
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 3-3 status updated to in-progress
- `_bmad-output/implementation-artifacts/3-3-waveform-centered-layout-latency-masking.md` — Tasks marked complete, Dev Agent Record filled, status → review

### Change Log

- 2026-03-27: Implemented waveform-centered layout and filler phrase latency masking (all 3 tasks complete)
