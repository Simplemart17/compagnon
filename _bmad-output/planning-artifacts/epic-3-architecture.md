---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: "complete"
completedAt: "2026-03-27"
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/epic-2-architecture.md
  - _bmad-output/project-context.md
  - docs/index.md
  - docs/component-inventory.md
workflowType: "architecture"
project_name: "companion"
user_name: "Simplemart"
date: "2026-03-26"
---

# Architecture Decision Document — Epic 3: Enhanced Voice Conversation Experience

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (from PRD UX-DR refs):**

- UX-DR3: Voice conversation processing state feedback ("I heard you, I'm thinking")
- UX-DR9: Condensed transcript during active conversation (last 2-3 messages visible)
- UX-DR10: Correction side-note variant (amber left-border, collapsed by default, tap to expand)
- UX-DR11: Waveform-centered layout with minimal controls during active speech
- UX-DR12: French filler phrases in system prompts to mask processing latency
- UX-DR17: Distinct waveform animations for all 5 conversation states

**Non-Functional Requirements driving architecture:**

- 60fps animation performance across all state transitions (NFR: rendering)
- iPhone SE (375pt × 667pt) must fit waveform + condensed transcript + end button without scrolling
- Accessibility: `accessibilityLiveRegion="polite"` for state announcements, role/label on all interactive elements
- Processing state transition must occur within 100ms of VAD silence detection (perceptual immediacy)

**Scale & Complexity:**

- Primary domain: Mobile (React Native / Reanimated animations)
- Complexity level: Medium
- Files modified: ~6 (3 existing components, 1 new component, 1 screen, 1 prompt file)
- New component: ProcessingIndicator
- Modified components: AudioWaveform, TranscriptView, CorrectionBubble
- Modified screen: `[sessionId].tsx`
- Modified prompt: `src/lib/prompts/conversation.ts`

### Technical Constraints & Dependencies

- **Reanimated 4.2.2** — All animations must use shared values + `useAnimatedStyle`. No `Animated.timing()` from core RN.
- **NativeWind v4** — Layout via `className`, but animated properties must use Reanimated animated styles (NativeWind and Reanimated don't share animated props)
- **Existing FlatList in TranscriptView** — Condensed mode must work with virtualization, not against it. `initialScrollIndex` or `scrollToEnd` with viewport limiting.
- **AudioWaveform's current API** — `speaker` prop drives bar colors via shared values. Adding `"processing"` must not break existing idle/user/ai states.
- **`use-realtime-voice.ts` hook** — Exposes `isSpeaking`, `isAiSpeaking`, `status`. A new `isProcessing` state is needed (user stopped speaking AND AI hasn't started). The hook must derive this from WebSocket events.
- **Server VAD** — Processing state starts when server VAD fires `input_audio_buffer.speech_stopped` and ends when `response.audio.delta` arrives. This timing comes from the WebSocket, not the client.

### Cross-Cutting Concerns Identified

1. **Animation state machine** — 5 states (connecting, idle, user-speaking, processing, ai-speaking) must coordinate across AudioWaveform, ProcessingIndicator, and the layout. A single source of truth (the hook's state) drives all three.
2. **Layout transition** — Inverting transcript/waveform prominence is the riskiest change. Must preserve scroll position, auto-scroll behavior, and correction attachment while changing the visual hierarchy.
3. **Filler phrase injection** — Modifying system prompts affects all 3 conversation modes (companion, debate, TCF simulation). Must be additive, not breaking existing prompt structure.
4. **Accessibility state announcements** — Screen readers must announce state transitions without being noisy. `accessibilityLiveRegion="polite"` (not "assertive") to avoid interrupting the conversation audio.
5. **Performance budget** — Adding ProcessingIndicator animations + waveform size increase + condensed transcript viewport logic must not degrade the 60fps target, especially during the processing→AI-speaking transition where multiple animations fire simultaneously.

## Starter Template Evaluation

### Primary Technology Domain

Mobile (React Native / Expo SDK 55) — brownfield project with established architecture.

### Existing Foundation (No Starter Needed)

Epic 3 is a feature evolution within a mature codebase. No new project initialization, framework selection, or starter template is required. All technology decisions are locked by the existing stack.

**Established Stack Relevant to Epic 3:**

**Language & Runtime:**

- TypeScript 5.9.2 (strict mode, `jsxImportSource: "nativewind"`)
- React Native 0.83.2 + Expo SDK 55 (managed workflow)

**Animation Framework:**

- React Native Reanimated 4.2.2 — all animations via shared values + `useAnimatedStyle`
- Spring animations (stiffness 220, damping 24) and timing animations established in existing components

**Styling Solution:**

- NativeWind v4 — `className` props for layout
- `src/lib/design.ts` — centralized Colors, Typography, Spacing, Radii, Shadows constants
- Animated properties use Reanimated animated styles (not NativeWind)

**Component Architecture:**

- Feature-grouped: `src/components/conversation/` (AudioWaveform, TranscriptView, CorrectionBubble)
- Hook-driven: `src/hooks/use-realtime-voice.ts` owns all conversation state
- FlatList virtualization already in TranscriptView
- React.memo on performance-sensitive components (AnimatedMessage, CorrectionBubble)

**AI Integration:**

- System prompts in `src/lib/prompts/conversation.ts` — 3 modes (companion, debate, TCF simulation)
- OpenAI Realtime API via `src/lib/realtime.ts` WebSocket through `realtime-session` Edge Function
- Server VAD for turn detection

**Existing Conversation Screen Layout (`[sessionId].tsx`):**

- TranscriptView (flex-1, dominant) → small AudioWaveform (60px) → controls
- Epic 3 inverts this to: condensed TranscriptView → large AudioWaveform (centered) → end button

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**

1. Processing state derivation — must be resolved before any UI work
2. Layout restructuring strategy — determines how all 3 stories compose
3. Component API evolution — determines prop signatures for all stories

**Important Decisions (Shape Architecture):** 4. Filler phrase strategy — affects system prompt structure

**Deferred Decisions:**

- None — all Epic 3 decisions are scoped and resolved

### 1. Processing State Derivation

**Decision:** Explicit WebSocket event tracking in `RealtimeSession`

**Approach:**

- `src/lib/realtime.ts` exposes two new event callbacks: `onUserSpeechStopped` and `onAiResponseStarted`
- `use-realtime-voice.ts` sets `isProcessing = true` on `input_audio_buffer.speech_stopped`, clears it on first `response.audio.delta`
- `isProcessing` is exported alongside `isSpeaking`, `isAiSpeaking` from the hook
- The screen and components consume `isProcessing` directly — no derived state needed

**Rationale:** WebSocket events are the source of truth for the processing gap. Deriving from boolean combinations (`!isSpeaking && !isAiSpeaking && hadRecentSpeech`) introduces timing fragility — a dropped frame or delayed state update could flash the wrong state. Direct event tracking is deterministic.

**Affects:** `src/lib/realtime.ts`, `src/hooks/use-realtime-voice.ts`, `[sessionId].tsx`

### 2. Layout Restructuring Strategy

**Decision:** Conditional layout swap in existing screen (no animated transition)

**Approach:**

- When `status === "connected"` or `status === "connecting"`: waveform-centered layout (condensed transcript fixed height above, large AudioWaveform in center flex area, end button below)
- When `status === "idle"` or `status === "ended"`: current layout (full transcript dominant)
- The swap happens at connection start — coincides with the existing "connecting" animation state, so the layout change feels intentional
- No Reanimated layout transition between modes — the connecting animation provides visual continuity

**Rationale:** The layout transition occurs during the connecting phase when the screen is already changing visually (waveform pulse, "Connecting..." status). An animated layout swap would compete with the connecting animation and risk jank on lower-end devices. A clean conditional swap is simpler and the connecting state provides natural visual cover.

**Affects:** `app/(tabs)/conversation/[sessionId].tsx`

### 3. Component API Evolution

**Decision:** Additive props on existing components (backwards compatible)

**Changes:**

- `AudioWaveform`: extend `speaker` prop type to `"user" | "ai" | "idle" | "processing"` — new animation state with visually distinct pattern
- `TranscriptView`: add `condensed?: boolean` prop — when true, container has fixed height showing last 2-3 messages, scrollable upward for history
- `CorrectionBubble`: add `variant?: "default" | "sideNote"` prop — sideNote renders amber left-border card with collapsed-by-default behavior

**Rationale:** Additive props keep the component count low, follow the existing codebase pattern (e.g., `CorrectionBubble` already has `compact?: boolean`), and avoid wrapper indirection. Each component remains self-contained with its new variant being an opt-in feature.

**Affects:** `src/components/conversation/AudioWaveform.tsx`, `TranscriptView.tsx`, `CorrectionBubble.tsx`

### 4. Filler Phrase Strategy

**Decision:** Static instruction in system prompts

**Approach:**

- Add a paragraph to each conversation mode builder in `src/lib/prompts/conversation.ts`
- Instruction: "To make the conversation feel natural, use French thinking phrases when you need a moment to formulate your response (e.g., Alors voyons..., Hmm bonne question..., Eh bien..., Voyons voir..., Comment dire...). Vary these naturally."
- The language model handles variation naturally — no runtime selection logic needed

**Rationale:** The Realtime API's language model already excels at natural variation. A static instruction is sufficient and avoids unnecessary runtime complexity. The filler phrases serve as latency masking — the AI speaks them while generating the substantive response, filling the 500ms-2s gap.

**Affects:** `src/lib/prompts/conversation.ts`

### Decision Impact Analysis

**Implementation Sequence:**

1. Processing state in `realtime.ts` → `use-realtime-voice.ts` (foundation — all UI depends on this)
2. AudioWaveform `"processing"` state + ProcessingIndicator component (Story 3.1)
3. TranscriptView `condensed` mode + CorrectionBubble `sideNote` variant (Story 3.2)
4. Screen layout restructuring + filler phrases in prompts (Story 3.3)

**Cross-Component Dependencies:**

- Stories 3.2 and 3.3 depend on Story 3.1's processing state being available
- Story 3.3's layout change depends on both 3.1 (waveform sizing) and 3.2 (condensed transcript) being ready
- Filler phrases (Story 3.3) are independent of all UI work and can be done in parallel

## Implementation Patterns & Consistency Rules

### Epic 3 Conflict Points

**5 areas where agents implementing different stories could make incompatible choices:**

1. Animation timing values across stories
2. Processing state naming across component layers
3. Condensed transcript fixed height value
4. Correction sideNote appearance trigger
5. Waveform size in centered layout mode

### Animation Timing Constants

**Rule:** All Epic 3 animation durations must be defined as named constants in each component, using these agreed values:

| Animation                          | Duration           | Easing                                   | Used In   |
| ---------------------------------- | ------------------ | ---------------------------------------- | --------- |
| ProcessingIndicator dot pulse      | 600ms per cycle    | Reanimated `withRepeat` + `withTiming`   | Story 3.1 |
| ProcessingIndicator dot stagger    | 200ms between dots | Delay offset per dot index               | Story 3.1 |
| ProcessingIndicator fade in/out    | 200ms              | `FadeIn` / `FadeOut` (Reanimated layout) | Story 3.1 |
| Waveform state transition          | 300ms              | `withTiming` (default easing)            | Story 3.1 |
| CorrectionBubble sideNote slide-in | 200ms              | `SlideInLeft` (Reanimated layout)        | Story 3.2 |
| CorrectionBubble expand/collapse   | 200ms              | `withTiming`                             | Story 3.2 |

**Rationale:** Consistent timing prevents jarring visual disconnects when multiple animations fire in sequence (e.g., processing dots fade out → waveform transitions → correction slides in).

### Processing State Naming Convention

**Rule:** The processing state uses consistent naming across all layers:

| Layer                       | Name                                         | Type                               |
| --------------------------- | -------------------------------------------- | ---------------------------------- |
| `RealtimeSession` callbacks | `onUserSpeechStopped`, `onAiResponseStarted` | Event callbacks                    |
| `use-realtime-voice.ts`     | `isProcessing: boolean`                      | Hook return value                  |
| `AudioWaveform` prop        | `speaker: "processing"`                      | Extends existing union             |
| `ProcessingIndicator` prop  | `isVisible: boolean`                         | Driven by `isProcessing` from hook |
| Accessibility               | `"Processing: Listening..."`                 | Label text                         |

**Anti-pattern:** Do NOT introduce alternative names like `isThinking`, `isWaiting`, `state: "loading"`, or `mode: "processing"`. The word "processing" is the canonical term for the user-stopped-speaking-AI-hasn't-started gap.

### Condensed Transcript Layout Contract

**Rule:** TranscriptView condensed mode uses a fixed height of `160px`, showing approximately 2-3 messages.

- Story 3.2 implements the `condensed` prop with this height
- Story 3.3 allocates exactly `160px` for the transcript area in the waveform-centered layout
- On iPhone SE (667pt height), this leaves ~400pt for waveform + controls after accounting for status bar (44pt) + header (48pt) + end button area (55pt)

**Rationale:** A percentage-based height would vary across devices and break the "no scrolling during active conversation" requirement. 160px is enough for 2-3 compact message bubbles and consistent across all screen sizes.

### Correction SideNote Trigger

**Rule:** CorrectionBubble `sideNote` variant appears when:

1. The AI's response audio has **finished playing** (not just when the text response is complete)
2. The correction is attached to the **user's preceding message**, not the AI response

**Implementation:** The screen passes `isAiSpeaking` to TranscriptView. When `isAiSpeaking` transitions from `true` to `false`, any pending corrections for the previous user message animate in. This prevents corrections from appearing while the AI is still speaking.

**Anti-pattern:** Do NOT trigger corrections on `response.done` WebSocket event — the audio may still be playing. Use the hook's `isAiSpeaking` state which tracks actual audio playback completion.

### Waveform Size Contract

**Rule:** AudioWaveform `size` prop values for Epic 3:

| Context                                          | Size                                   | Rationale                                                                                                 |
| ------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Waveform-centered layout (active conversation)   | `140`                                  | Large enough to be the visual anchor, small enough to fit iPhone SE with 160px transcript + 55px controls |
| Pre-connection / post-end (full transcript mode) | `60`                                   | Existing value, unchanged                                                                                 |
| Concentric ring borders                          | Outer: `size + 32`, Inner: `size + 16` | Existing ratio, scales with size                                                                          |

**Rationale:** 140px waveform + 32px outer ring = 172px total visual footprint. Combined with 160px transcript + 55px controls + 92px header/status = 479px, well within iPhone SE's 667pt.

### Enforcement Guidelines

**All agents implementing Epic 3 stories MUST:**

- Use the animation timing values from the table above — do not invent new durations
- Reference `isProcessing` from the hook as the single source of truth for the processing gap
- Use `160px` for condensed transcript height — do not calculate dynamically
- Use `140` for centered waveform size — do not calculate from screen dimensions
- Trigger sideNote corrections on `isAiSpeaking` transition, not WebSocket events
- Follow existing project context rules: `captureError()` for errors, `@/*` imports, `className` for layout, Reanimated for animations

### Pattern Examples

**Good:**

```tsx
// ProcessingIndicator reads from hook state
const { isProcessing } = useRealtimeVoice();
<ProcessingIndicator isVisible={isProcessing} />

// AudioWaveform uses canonical "processing" value
<AudioWaveform
  speaker={isProcessing ? "processing" : isSpeaking ? "user" : isAiSpeaking ? "ai" : "idle"}
  size={isConversationActive ? 140 : 60}
/>

// Condensed transcript with fixed height
<View style={{ height: 160 }}>
  <TranscriptView transcript={transcript} condensed />
</View>
```

**Anti-patterns:**

```tsx
// BAD: Deriving processing from negation
const isProcessing = !isSpeaking && !isAiSpeaking; // fragile

// BAD: Dynamic height calculation
<View style={{ height: screenHeight * 0.25 }}> // varies per device

// BAD: Triggering corrections on WebSocket event
session.on('response.done', () => showCorrections()); // audio may still play

// BAD: Alternative naming
<AudioWaveform state="thinking" /> // not in the type union
```

## Project Structure & Boundaries

### Files Touched by Epic 3

```
src/
├── components/
│   └── conversation/
│       ├── AudioWaveform.tsx          ← MODIFIED (Story 3.1: add "processing" speaker state)
│       ├── ProcessingIndicator.tsx     ← NEW (Story 3.1: pulsing dots + label)
│       ├── TranscriptView.tsx          ← MODIFIED (Story 3.2: add condensed prop)
│       └── CorrectionBubble.tsx        ← MODIFIED (Story 3.2: add sideNote variant)
├── hooks/
│   └── use-realtime-voice.ts          ← MODIFIED (Story 3.1: expose isProcessing)
├── lib/
│   ├── realtime.ts                    ← MODIFIED (Story 3.1: onUserSpeechStopped, onAiResponseStarted callbacks)
│   └── prompts/
│       └── conversation.ts            ← MODIFIED (Story 3.3: filler phrase instructions)
app/
└── (tabs)/
    └── conversation/
        └── [sessionId].tsx            ← MODIFIED (Story 3.3: waveform-centered layout)
```

### New File: ProcessingIndicator

**Location:** `src/components/conversation/ProcessingIndicator.tsx`

**Rationale:** Follows the existing pattern — all conversation-related components live in `src/components/conversation/`. ProcessingIndicator is tightly coupled to the voice conversation screen and AudioWaveform.

**Props:**

- `isVisible: boolean` — controls fade in/out
- `label?: string` — defaults to "Listening...", overridden to "Setting up your conversation..." during connecting

**Internals:**

- Three 5px animated dots using Reanimated `withRepeat` + `withTiming`
- Label below dots using `Typography.caption`
- `FadeIn` / `FadeOut` layout animations (200ms)
- `accessibilityRole="status"`, `accessibilityLiveRegion="polite"`

### Architectural Boundaries

**Data Flow (processing state):**

```
WebSocket events (RealtimeSession)
  → onUserSpeechStopped / onAiResponseStarted callbacks
    → use-realtime-voice.ts sets isProcessing boolean
      → [sessionId].tsx reads isProcessing
        → AudioWaveform receives speaker="processing"
        → ProcessingIndicator receives isVisible={isProcessing}
```

**Data Flow (condensed transcript + corrections):**

```
use-realtime-voice.ts provides transcript + isAiSpeaking
  → [sessionId].tsx passes condensed={isConversationActive} to TranscriptView
    → TranscriptView renders in 160px fixed container
      → AnimatedMessage renders CorrectionBubble variant="sideNote"
        → sideNote appears when isAiSpeaking transitions false→true→false
```

**Component Boundaries:**

- `ProcessingIndicator` is a pure presentational component — no hooks, no data fetching. Driven entirely by props from the screen.
- `AudioWaveform` remains self-contained — it animates based on `speaker` prop, no knowledge of ProcessingIndicator.
- `TranscriptView` owns its own scroll behavior in condensed mode — the screen only sets the container height and the `condensed` prop.
- `CorrectionBubble` sideNote variant is self-contained — animation, expand/collapse, and styling are internal. The parent only passes `variant="sideNote"`.

**Integration Points:**

- `use-realtime-voice.ts` ↔ `realtime.ts`: New callbacks added to `RealtimeSession` constructor options
- `[sessionId].tsx` ↔ all components: Screen orchestrates layout and passes hook state as props
- `conversation.ts` prompts ↔ `realtime-session` Edge Function: Filler phrases are in the system prompt sent at session start — no Edge Function changes needed

### Story-to-File Mapping

**Story 3.1 — AudioWaveform Processing State & ProcessingIndicator:**
| File | Change |
|------|--------|
| `src/lib/realtime.ts` | Add `onUserSpeechStopped`, `onAiResponseStarted` callback support |
| `src/hooks/use-realtime-voice.ts` | Add `isProcessing` state, wire callbacks |
| `src/components/conversation/AudioWaveform.tsx` | Add `"processing"` to speaker union, new animation pattern |
| `src/components/conversation/ProcessingIndicator.tsx` | **NEW** — pulsing dots + label component |

**Story 3.2 — TranscriptView Condensed Mode & CorrectionBubble Side-Note:**
| File | Change |
|------|--------|
| `src/components/conversation/TranscriptView.tsx` | Add `condensed?: boolean` prop, fixed-height container, viewport limiting |
| `src/components/conversation/CorrectionBubble.tsx` | Add `variant?: "default" \| "sideNote"` prop, amber left-border card, collapsed-by-default |

**Story 3.3 — Waveform-Centered Layout & Latency Masking:**
| File | Change |
|------|--------|
| `app/(tabs)/conversation/[sessionId].tsx` | Conditional layout swap, waveform size 140, condensed transcript 160px container |
| `src/lib/prompts/conversation.ts` | Add filler phrase instruction to all 3 conversation mode builders |

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**

- Decision 1 (processing state) → feeds Decision 3 (component props) via `isProcessing` boolean. No conflict.
- Decision 2 (conditional layout) → consumes Decision 3 (condensed/size props) and Decision 1 (isProcessing). All inputs are available.
- Decision 4 (filler phrases) → independent of all UI decisions. System prompt modification has no code-level coupling to components.
- No circular dependencies between decisions.

**Pattern Consistency:**

- All naming follows the "processing" canonical term across all layers (validated in naming table).
- All animation durations use Reanimated APIs consistently (no mix of core RN Animated and Reanimated).
- All layout values are fixed pixels (160px, 140px, 60px) — no dynamic calculations that could diverge.

**Structure Alignment:**

- All modified files exist in established directories. No new directories needed.
- New ProcessingIndicator follows existing `src/components/conversation/` pattern.
- Hook → screen → component data flow matches the existing `use-realtime-voice.ts` → `[sessionId].tsx` → AudioWaveform/TranscriptView pattern.

### Requirements Coverage Validation

**Epic Coverage:**

| Requirement                          | Decision                         | Story | Status  |
| ------------------------------------ | -------------------------------- | ----- | ------- |
| UX-DR3: Processing state feedback    | Decision 1 + ProcessingIndicator | 3.1   | Covered |
| UX-DR9: Condensed transcript         | Decision 3 (condensed prop)      | 3.2   | Covered |
| UX-DR10: Correction side-note        | Decision 3 (sideNote variant)    | 3.2   | Covered |
| UX-DR11: Waveform-centered layout    | Decision 2 (conditional swap)    | 3.3   | Covered |
| UX-DR12: French filler phrases       | Decision 4 (static prompt)       | 3.3   | Covered |
| UX-DR17: 5-state waveform animations | Decision 1 + Decision 3          | 3.1   | Covered |

**Non-Functional Requirements:**

| NFR                         | How Addressed                                                                           | Status  |
| --------------------------- | --------------------------------------------------------------------------------------- | ------- |
| 60fps animations            | Reanimated shared values, timing constants table, React.memo on components              | Covered |
| iPhone SE fit               | Pixel math validated: 160 + 172 + 55 + 92 = 479pt < 667pt                               | Covered |
| Accessibility               | `accessibilityLiveRegion="polite"`, `accessibilityRole="status"` on ProcessingIndicator | Covered |
| 100ms processing transition | Direct WebSocket event tracking (no polling, no boolean derivation)                     | Covered |

### Implementation Readiness Validation

**Decision Completeness:**

- All 4 decisions documented with approach, rationale, and affected files.
- All decisions include the rejected alternative and why it was rejected.
- Implementation sequence defined with cross-story dependencies.

**Structure Completeness:**

- All 8 files mapped to stories with specific change descriptions.
- New ProcessingIndicator fully specified (props, internals, accessibility).
- Data flow diagrams for both processing state and correction triggers.

**Pattern Completeness:**

- 5 conflict points identified and resolved with concrete values.
- Good/bad code examples for the 4 most likely divergence points.
- Enforcement guidelines summarize all rules in one checklist.

### Gap Analysis Results

**Resolved during validation:**

- `isConversationActive` derived const — added to patterns: `const isConversationActive = status === 'connected' || status === 'connecting'` in `[sessionId].tsx`

**No remaining gaps.** All requirements have architectural support, all conflict points are resolved, and all file mappings are complete.

### Architecture Completeness Checklist

**Requirements Analysis**

- [x] Project context thoroughly analyzed (PRD, UX spec, epics, existing codebase)
- [x] Scale and complexity assessed (medium — 8 files, 1 new component)
- [x] Technical constraints identified (Reanimated, NativeWind, FlatList, Server VAD)
- [x] Cross-cutting concerns mapped (animation state machine, layout transition, accessibility, performance)

**Architectural Decisions**

- [x] Critical decisions documented with rationale (4 decisions)
- [x] Technology stack confirmed (brownfield — all locked)
- [x] Integration patterns defined (WebSocket → hook → screen → components)
- [x] Performance considerations addressed (60fps budget, pixel math for iPhone SE)

**Implementation Patterns**

- [x] Naming conventions established (processing state naming table)
- [x] Animation timing constants defined (6 animations with exact durations)
- [x] Layout contracts specified (160px transcript, 140px waveform)
- [x] Anti-patterns documented (4 examples of what NOT to do)

**Project Structure**

- [x] Complete file tree defined (8 files across 3 stories)
- [x] Component boundaries established (4 components with clear ownership)
- [x] Integration points mapped (3 integration boundaries)
- [x] Requirements to structure mapping complete (story-to-file tables)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all decisions are concrete with pixel-level specificity, all conflict points resolved, and the scope is well-bounded (8 files, 1 new component).

**Key Strengths:**

- Minimal blast radius — additive changes to existing components, no breaking API changes
- Single source of truth — `use-realtime-voice.ts` hook owns all state, components are pure consumers
- Concrete contracts — pixel values, animation durations, and naming conventions eliminate ambiguity between story implementations
- iPhone SE validated — layout math proves the design fits the smallest supported screen

**Areas for Future Enhancement:**

- Animation tuning — the exact spring stiffness/damping for ProcessingIndicator dots may need visual tuning during implementation. The 600ms cycle is a starting point.
- Condensed transcript UX — if 160px feels too cramped on larger devices, a future story could introduce a `maxHeight` that scales up on tablets.

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect the enforcement guidelines checklist
- Reference this document for all architectural questions
- Do NOT deviate from concrete values (160px, 140px, animation durations) without updating this document first

**Implementation Order:**

1. Story 3.1 first — processing state is the foundation for all other work
2. Story 3.2 second — condensed transcript and sideNote must exist before layout restructuring
3. Story 3.3 last — integrates all components into the new layout + adds filler phrases (independent, can start early)
