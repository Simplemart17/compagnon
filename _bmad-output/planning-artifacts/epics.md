---
stepsCompleted:
  [
    "step-01-validate-prerequisites",
    "step-02-design-epics",
    "step-03-create-stories",
    "step-04-final-validation",
  ]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# Companion - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Companion, decomposing the requirements from the PRD, UX Design Specification, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Authentication & Onboarding (Implemented)**
FR1: Users can create an account with email and password
FR2: Users can sign in and sign out
FR3: Users can reset their password via email
FR4: Users can complete a 3-step onboarding wizard (CEFR level, learning goal, daily time target)
FR5: Users can take a 15-question AI-generated placement test assessing 4 linguistic competencies
FR6: Users can view privacy policy and terms of service in-app

**Voice Conversations (Implemented)**
FR7: Users can start a voice conversation on a selected topic
FR8: Users can choose conversation mode: companion, debate, or TCF simulation
FR9: Users can speak and receive real-time AI voice responses via full-duplex audio
FR10: Users can view a live text transcript during conversation
FR11: Users receive inline corrections with category labels and explanations
FR12: Users can view post-conversation AI feedback (fluency rating, grammar rating, strengths, improvements)
FR13: The system retrieves companion memories before each conversation for personalization
FR14: The system extracts and stores new facts from conversations as memories
FR15: The system detects and logs error patterns from corrections

**Structured Exercises (Implemented)**
FR16: Users can generate exercises for listening, reading, writing, and grammar at their CEFR level
FR17: Users can answer MCQ with 4 options and receive feedback with explanations
FR18: Users can complete writing tasks with 4-dimension AI evaluation and rewrite suggestion
FR19: Users can view original text alongside AI corrections in writing exercises
FR20: Users can receive targeted micro-drills generated from tracked error patterns
FR21: The system validates AI-generated MCQ content (4 options, 1 correct)

**Pronunciation Assessment (Implemented)**
FR22: Users can record speech and receive phoneme-level pronunciation assessment
FR23: Users can view word-by-word accuracy with error type indicators
FR24: Users can track weak sounds across assessment history

**Dictation (Implemented)**
FR25: Users can listen to AI-generated sentences at normal and slow speeds
FR26: Users can type what they hear and receive word-by-word color-coded comparison
FR27: The system feeds dictation errors into error pattern tracking

**TCF Mock Tests (Implemented)**
FR28: Users can take full mock tests (76 questions, 3 sections, A1-C2 progressive difficulty)
FR29: Users can take individual section tests
FR30: Users can view results with per-section CEFR breakdown and TCF 0-699 score
FR31: Users can resume interrupted mock tests
FR32: Users see unanswered question count before submitting

**Vocabulary & Spaced Repetition (Implemented)**
FR33: Users can review vocabulary using SM-2 spaced repetition flashcards
FR34: Users can rate recall quality (0-5) to adjust scheduling
FR35: Users can review vocabulary offline with ratings queued for sync
FR36: Users can view full word list with translations, context, and CEFR level

**Progress & Analytics (Implemented)**
FR37: Users can view per-skill progress scores and CEFR levels
FR38: Users can view daily activity tracking
FR39: Users can maintain and view practice streaks with daily goal achievement
FR40: The system auto-promotes CEFR level at 10+ exercises across 3+ skills with 85%+ average
FR41: Users can view CEFR progression chart with target level indicator
FR42: Users can view error patterns and navigate to targeted micro-drills

**Profile & Settings (Implemented)**
FR43: Users can view profile with stats, skills, CEFR chart, and errors
FR44: Users can edit target level, daily goal, and preferences with confirmation
FR45: Users can export personal data (GDPR)
FR46: Users can delete account and all data (GDPR)
FR47: Users can view app version number

**Conversation History (Implemented)**
FR48: Users can browse past conversations with date, topic, and duration
FR49: Users can view full transcript of past conversations including corrections

**Offline & Data Resilience (Implemented)**
FR50: The system caches profile, skills, and activity with TTL-based expiration
FR51: The system displays offline indicator when disconnected
FR52: The system queues offline writes and syncs on reconnection

**Phase 2: Speech-to-Speech Translation (Planned)**
FR53: Users can hear a sentence in their native language and speak the French translation
FR54: The system evaluates spoken translation for accuracy, fluency, and naturalness
FR55: Exercise difficulty is CEFR-calibrated (A1-B1; L2 paraphrasing at B2+)

**Phase 2: Echo Practice (Planned)**
FR56: Users can listen to a sentence, repeat it aloud, and type it in one exercise
FR57: The system scores listening comprehension, pronunciation, and spelling

**Phase 2: Notifications (Planned)**
FR58: Users receive streak-at-risk push notifications
FR59: Users receive SRS vocabulary review push notifications
FR60: Users can manage notification preferences

### NonFunctional Requirements

**Performance**
NFR1: Voice round-trip latency under 2 seconds
NFR2: Exercise generation within 5 seconds
NFR3: TTS playback begins within 3 seconds
NFR4: Cold start to home screen within 3 seconds on 4-year-old devices
NFR5: Animations at 60fps with no jank
NFR6: Cached data loads within 500ms from AsyncStorage
NFR7: Mock test timer drift under 1 second per 30 minutes

**Security**
NFR8: AI API keys stored server-side only — never in client bundle
NFR9: All tables enforce RLS with auth.uid() scoping
NFR10: Auth tokens in native secure storage, not AsyncStorage
NFR11: All Edge Functions validate JWT before processing
NFR12: All Edge Functions enforce per-user rate limits
NFR13: Model parameter allowlists on Edge Functions
NFR14: SECURITY DEFINER functions use SET search_path = public
NFR15: No PII in console, Sentry, or client-side logs

**Accessibility**
NFR16: All interactive elements have accessibilityLabel and accessibilityRole
NFR17: Touch targets at least 44x44 points
NFR18: WCAG 2.1 AA contrast ratios (4.5:1 body, 3:1 large text)
NFR19: Dynamic Type / system font scaling without layout breakage
NFR20: Skeleton animations for loading states

**Integration**
NFR21: OpenAI retries with exponential backoff for retryable errors
NFR22: Azure Speech graceful degradation with informative error
NFR23: Session expiry redirects to login without data loss
NFR24: Network changes surfaced within 2 seconds
NFR25: Offline write queue auto-flushes on reconnection without duplicates

**Reliability**
NFR26: Edge Functions at 99.5%+ availability with graceful cache fallback
NFR27: Zero data loss for streaks, progress, SRS, and exercise results
NFR28: Interrupted mock tests resumable from exact question
NFR29: Back-press confirmation on active conversations and mock tests
NFR30: All unhandled errors captured to Sentry with context tags

**Content Quality**
NFR31: Exercise generation temperature <= 0.4
NFR32: MCQ validation: exactly 4 options, exactly 1 correct
NFR33: AI responses educational, 13+-appropriate, on-topic
NFR34: TCF question distribution: listening 29, reading 29, grammar 18

### Additional Requirements

**From Architecture:**

- Brownfield project — no starter template; extend existing Expo SDK 55 foundation
- Layer boundary enforcement: Screen → Hook → Library → Edge Function → External API (strict, one-directional)
- Edge Function template pattern must be followed for any new functions (JSDoc, CORS, JWT, rate limiting, error handling)
- Hook vs library boundary: useState/useRef = hook; stateless = library function
- Screen state machine pattern: discriminated union type with standard state vocabulary (idle, generating, connecting, active, checking, results, error)
- Phase 2 data growth: new exercise types extend existing `exercises` table via `exercise_type` discriminator + `content` JSONB — no new tables unless data shape diverges
- New `device_tokens` table for push notifications with RLS
- New `notification-register` Edge Function for push token registration
- Phase 2 hooks: `use-echo-practice.ts` (separate from useExercise), `use-translation.ts`
- Phase 2 prompt builders: `prompts/translation.ts`, `prompts/echo.ts`
- Temperature conventions: 0.4 for generation/scoring, 0.2 for extraction, 0.7 for conversation
- Quality gates: `npm run type-check && npm run lint && npm run format:check` before implementation complete
- No test framework — TypeScript strict + ESLint zero-warnings + Prettier replace tests
- Component promotion: promote StatTile, ActivityBar, SkillCard to `src/components/common/` only when reused across 2+ screens
- Rate limiter persistence evaluation when user base exceeds ~1000 DAU
- Background jobs via `pg_cron` for data retention cleanup and inactive account warnings
- All naming conventions: snake_case SQL, camelCase JSONB, camelCase TypeScript functions, PascalCase components

**From User:**

- End-to-end testing, bug-fixing, and UX polishing pass required before Phase 2 implementation begins
- All existing MVP features (FR1-52, NFR1-34) must be verified working correctly across both iOS and Android
- Edge Functions must be deployed and tested against real AI APIs
- All user journeys (first-time, daily practice, returning after absence, error resolution) must be walked through manually
- UX polish: verify visual consistency, interaction smoothness, empty states, loading states, error states, and accessibility across all screens

### UX Design Requirements

**UX-DR1: Home Screen Evolution — Companion Daily Briefing**
Replace stats dashboard with companion-driven daily briefing. Implement CompanionMessage component (avatar + personalized message from memory retrieval, SRS due count, weakest skill). Replace quick actions grid with "Today's Plan" curated list (2-3 recommended activities with contextual badges: Due, Suggested, Error). Add ErrorJourneyBar showing resolved vs. active error patterns. Deprioritize stats to subtitle/status bar position.

**UX-DR2: Post-Conversation Feedback — Narrative Progress Story**
Evolve feedback sheet from score-focused to narrative. Add personalized header ("Great Session, [Name]!"). Implement MilestoneBanner component for personal bests, resolved errors, CEFR promotions (conditional, earned only). Add SessionComparison component showing fluency/grammar/duration deltas vs. last session (hidden on first session or return after absence). Reframe strengths/improvements as companion-voiced "What We Noticed" observations. Add ErrorJourneyBar to feedback screen. Add contextual next action based on today's weaknesses.

**UX-DR3: Voice Conversation Screen — Waveform-Centered Layout**
Restructure conversation screen: waveform as visual anchor (large, centered, concentric ring borders), condensed transcript (last 2-3 messages above waveform, scrollable), correction side-notes (amber left-border cards with "Tap for details"). Implement ProcessingIndicator component ("Listening..." with pulsing dots, distinct from idle/active). Minimize controls during active speech to waveform + transcript + end button.

**UX-DR4: New Custom Components — CompanionMessage**
Build CompanionMessage component in `src/components/home/`. Props: message (string), userName (optional). States: default, loading (skeleton), empty (hidden). Styling: Colors.primary at 5% opacity bg, 32px avatar circle, Typography presets, Radii.card, Spacing.cardPadding. Accessibility: role="text", label="Your companion says: [message]".

**UX-DR5: New Custom Components — TodayPlanItem**
Build TodayPlanItem component in `src/components/home/`. Props: icon, iconColor, title, subtitle, badge ({text, type: due|suggested|error}), onPress. States: default, pressed (scale 0.97 + opacity 0.8 + haptic), disabled (offline). Badge variants: due (amber tint), suggested (amber tint), error (red tint). Accessibility: role="button", label with title+subtitle+badge, hint="Double tap to start".

**UX-DR6: New Custom Components — ErrorJourneyBar**
Build ErrorJourneyBar component in `src/components/common/`. Props: resolved (number), total (number), compact (optional boolean). States: default (proportional fill bar), empty (hidden if total=0), complete (green, "All patterns resolved!"). Animated width transition. Accessibility: role="progressbar", accessibilityValue.

**UX-DR7: New Custom Components — SessionComparison**
Build SessionComparison component in `src/components/feedback/`. Props: metrics array with label, previous, current, direction (up|down|same). States: default, empty (hidden if no previous session), first-return (hidden). Arrow colors: up=success, down=error, same=tertiary.

**UX-DR8: New Custom Components — MilestoneBanner**
Build MilestoneBanner component in `src/components/common/`. Props: icon, title, subtitle, type (personal_best|error_resolved|cefr_promotion). Entry animation: FadeInDown.duration(400).springify(). Haptic: hapticSuccess() on mount. Type variants: personal_best/error_resolved = green tint, cefr_promotion = amber tint. Accessibility: role="alert".

**UX-DR9: New Custom Components — ProcessingIndicator**
Build ProcessingIndicator component in `src/components/common/`. Props: state (idle|processing|connecting), label (optional override). Processing: three 5px pulsing dots with "Listening..." label. Connecting: "Setting up your conversation..." label. Positioned below AudioWaveform. Fade in/out 200ms (Reanimated). Accessibility: role="status", liveRegion="polite".

**UX-DR10: Existing Component Modifications — TranscriptView**
Add `condensed` prop to TranscriptView for waveform-centered layout. Condensed mode shows last 2-3 messages only; full transcript accessible via scroll.

**UX-DR11: Existing Component Modifications — CorrectionBubble**
Add `sideNote` variant to CorrectionBubble. Amber left-border styling, "Tap for details" affordance, reduced visual weight compared to current full correction bubbles.

**UX-DR12: Existing Component Modifications — AudioWaveform**
Add `processing` state to AudioWaveform's `speaker` prop enum. Processing state is visually distinct from idle (breathing) and active (oscillating).

**UX-DR13: Component Promotion — StatTile, ActivityBar, SkillCard**
Promote StatTile from profile/index.tsx, ActivityBar from home/index.tsx, and SkillCard from practice/index.tsx to `src/components/common/` with props interfaces when Phase 2 screens reuse them.

**UX-DR14: Feedback Patterns — Exercise Score Framing**
Implement consistent feedback framing: 90-100% "Excellent!" (success), 80-89% "Great job!" (success), 70-79% "Good work!" (accent), 60-69% "Keep going!" (accent), 50-59% "Almost there!" (primary), below 50% "Keep practicing!" (primary). Never "Failed/Wrong/Poor". Haptic: success for 80%+, light for all others, never error haptic on scores.

**UX-DR15: Toast/Alert System**
Implement toast notification system: success (green border, check icon, 3s auto-dismiss), warning (amber border, info icon, 5s auto-dismiss), error (red border, warning icon, persistent with retry action). Maximum one toast visible, queued. Toasts appear top of screen below status bar.

**UX-DR16: Tab Badge Indicators**
Add amber dot badge on Talk tab when companion has context from recent activity. Add number badge on Practice tab showing SRS cards due count.

**UX-DR17: Latency Masking — French Filler Phrases**
Add French filler phrases to conversation system prompts ("Alors, voyons...", "Hmm, bonne question...") to mask 500ms-2s processing gaps between user speech and AI response.

**UX-DR18: Offline Transition Handling**
Mid-conversation connection loss: "Connection lost — your conversation has been saved" then navigate to transcript view. Mid-exercise offline (exercise already generated): continue answering. Mid-exercise offline (generating): redirect to vocabulary review. Debounce network banner 5 seconds to prevent rapid toggling.

### FR Coverage Map

FR1: Epic 1 — Users can create an account with email and password (validation)
FR2: Epic 1 — Users can sign in and sign out (validation)
FR3: Epic 1 — Users can reset their password via email (validation)
FR4: Epic 1 — Users can complete a 3-step onboarding wizard (validation)
FR5: Epic 1 — Users can take a 15-question AI-generated placement test (validation)
FR6: Epic 1 — Users can view privacy policy and terms of service in-app (validation)
FR7: Epic 1, Epic 3 — Users can start a voice conversation (validated in E1, screen evolved in E3)
FR8: Epic 1, Epic 3 — Users can choose conversation mode (validated in E1, screen evolved in E3)
FR9: Epic 1, Epic 3 — Real-time AI voice responses via full-duplex audio (validated in E1, waveform evolved in E3)
FR10: Epic 1, Epic 3 — Live text transcript during conversation (validated in E1, condensed mode in E3)
FR11: Epic 1, Epic 3 — Inline corrections with category labels (validated in E1, sideNote variant in E3)
FR12: Epic 1, Epic 4 — Post-conversation AI feedback (validated in E1, narrative story in E4)
FR13: Epic 1, Epic 2 — System retrieves companion memories (validated in E1, surfaced in home briefing E2)
FR14: Epic 1 — System extracts and stores new facts as memories (validation)
FR15: Epic 1 — System detects and logs error patterns (validation)
FR16: Epic 1 — Exercise generation for listening, reading, writing, grammar (validation)
FR17: Epic 1 — MCQ with 4 options and feedback (validation)
FR18: Epic 1 — Writing tasks with 4-dimension AI evaluation (validation)
FR19: Epic 1 — Original text alongside AI corrections in writing (validation)
FR20: Epic 1 — Targeted micro-drills from error patterns (validation)
FR21: Epic 1 — AI-generated MCQ content validation (validation)
FR22: Epic 1 — Phoneme-level pronunciation assessment (validation)
FR23: Epic 1 — Word-by-word accuracy with error type indicators (validation)
FR24: Epic 1 — Weak sounds tracking across assessment history (validation)
FR25: Epic 1 — AI-generated dictation sentences at normal and slow speeds (validation)
FR26: Epic 1 — Word-by-word color-coded dictation comparison (validation)
FR27: Epic 1 — Dictation errors feed into error pattern tracking (validation)
FR28: Epic 1 — Full mock tests with 76 questions, 3 sections (validation)
FR29: Epic 1 — Individual section tests (validation)
FR30: Epic 1 — Results with per-section CEFR breakdown and TCF score (validation)
FR31: Epic 1 — Resume interrupted mock tests (validation)
FR32: Epic 1 — Unanswered question count before submitting (validation)
FR33: Epic 1 — SM-2 spaced repetition vocabulary flashcards (validation)
FR34: Epic 1 — Rate recall quality 0-5 to adjust scheduling (validation)
FR35: Epic 1 — Offline vocabulary review with ratings queued (validation)
FR36: Epic 1 — Full word list with translations, context, CEFR level (validation)
FR37: Epic 1, Epic 2 — Per-skill progress scores and CEFR levels (validated in E1, surfaced in home E2)
FR38: Epic 1 — Daily activity tracking (validation)
FR39: Epic 1 — Practice streaks with daily goal achievement (validation)
FR40: Epic 1 — CEFR auto-promotion at 10+ exercises across 3+ skills at 85%+ (validation)
FR41: Epic 1 — CEFR progression chart with target level indicator (validation)
FR42: Epic 1, Epic 2 — Error patterns and navigate to micro-drills (validated in E1, ErrorJourneyBar in E2)
FR43: Epic 1 — Profile with stats, skills, CEFR chart, errors (validation)
FR44: Epic 1 — Edit target level, daily goal, preferences with confirmation (validation)
FR45: Epic 1 — Export personal data GDPR (validation)
FR46: Epic 1 — Delete account and all data GDPR (validation)
FR47: Epic 1 — View app version number (validation)
FR48: Epic 1 — Browse past conversations with date, topic, duration (validation)
FR49: Epic 1 — View full transcript of past conversations (validation)
FR50: Epic 1, Epic 5 — Cache profile, skills, activity with TTL (validated in E1, transitions polished in E5)
FR51: Epic 1, Epic 5 — Offline indicator when disconnected (validated in E1, debounce polished in E5)
FR52: Epic 1, Epic 5 — Queue offline writes and sync on reconnection (validated in E1, transitions polished in E5)
FR53: Epic 7 — Hear native language sentence and speak French translation
FR54: Epic 7 — Evaluate spoken translation for accuracy, fluency, naturalness
FR55: Epic 7 — CEFR-calibrated translation difficulty (A1-B1; paraphrasing at B2+)
FR56: Epic 6 — Listen to sentence, repeat aloud, and type in one exercise
FR57: Epic 6 — Score listening comprehension, pronunciation, and spelling
FR58: Epic 8 — Streak-at-risk push notifications
FR59: Epic 8 — SRS vocabulary review push notifications
FR60: Epic 8 — Manage notification preferences

**UX-DR Coverage:**
UX-DR1: Epic 2 — Home screen evolution to companion daily briefing
UX-DR2: Epic 4 — Post-conversation feedback to narrative progress story
UX-DR3: Epic 3 — Voice conversation waveform-centered layout
UX-DR4: Epic 2 — CompanionMessage component
UX-DR5: Epic 2 — TodayPlanItem component
UX-DR6: Epic 2, Epic 4 — ErrorJourneyBar component (built in E2, reused in E4)
UX-DR7: Epic 4 — SessionComparison component
UX-DR8: Epic 4 — MilestoneBanner component
UX-DR9: Epic 3 — ProcessingIndicator component
UX-DR10: Epic 3 — TranscriptView condensed mode
UX-DR11: Epic 3 — CorrectionBubble sideNote variant
UX-DR12: Epic 3 — AudioWaveform processing state
UX-DR13: Epic 5 — Component promotion (StatTile, ActivityBar, SkillCard)
UX-DR14: Epic 5 — Exercise score feedback framing
UX-DR15: Epic 5 — Toast/alert notification system
UX-DR16: Epic 5 — Tab badge indicators
UX-DR17: Epic 3 — French filler phrases for latency masking
UX-DR18: Epic 5 — Offline transition handling

## Epic List

### Epic 1: MVP Stabilization — End-to-End Testing, Bug Fixing & UX Polish

Users can trust that all existing features work correctly, look visually polished, and handle edge cases gracefully across iOS and Android. This validates the entire implemented MVP before building on top of it.
**FRs covered:** Validates FR1-52, NFR1-34
**Notes:** No new features — purely verification, bug fixes, and UX polish. Covers all 4 user journeys, Edge Function deployment, accessibility, empty/loading/error states.

### Epic 1B: Foundation Cleanup & CI Enforcement

The codebase has automated quality guardrails preventing recurring bug classes (hardcoded hex colors, missing accessibility, spinner loading states), standardized story acceptance criteria with polish requirements, and a planned component architecture for Epic 2's home screen evolution — ensuring all future epics ship clean from day one.
**FRs covered:** None (infrastructure & tech debt). Retroactive enforcement of NFR16-20 (accessibility, design tokens, loading states).
**Notes:** Inserted after Epic 1 retrospective. Addresses 3 recurring bug classes found in 5 of 7 Epic 1 stories. Establishes CI enforcement, converts NativeWind className hex debt, plans Epic 2 component architecture. Must complete before Epic 2.

### Epic 2: Companion Daily Briefing (Home Screen Evolution)

Users open the app to a personalized companion message that knows their context, surfaces what to practice today, and shows their error-to-mastery progress — replacing the current stats dashboard with a relationship-driven daily plan.
**FRs covered:** UX-DR1, UX-DR4, UX-DR5, UX-DR6
**Notes:** New components: CompanionMessage, TodayPlanItem, ErrorJourneyBar. Requires memory retrieval, SRS due count, weakest skill query logic for the home screen.

### Epic 3: Enhanced Voice Conversation Experience

Users have a more immersive voice conversation with a waveform-centered layout, clear processing state feedback ("Listening..."), condensed transcript, and gentler correction styling — eliminating the anxiety gap between speaking and AI response.
**FRs covered:** UX-DR3, UX-DR9, UX-DR10, UX-DR11, UX-DR12, UX-DR17
**Notes:** Modifies TranscriptView (condensed mode), CorrectionBubble (sideNote variant), AudioWaveform (processing state). New: ProcessingIndicator. Adds French filler phrases to system prompts.

### Epic 4: Narrative Post-Conversation Feedback

Users receive a progress story after conversations — personalized header, session-over-session comparison, milestone celebrations for personal bests, companion-voiced observations, and error journey visualization — making improvement tangible.
**FRs covered:** UX-DR2, UX-DR7, UX-DR8, UX-DR6 (reuse)
**Notes:** New components: SessionComparison, MilestoneBanner. Requires storing previous session ratings, personal best detection logic. ErrorJourneyBar reused from Epic 2.

### Epic 5: UX System Patterns & Polish

Users experience consistent feedback framing, toast notifications, tab badge indicators, and graceful offline transitions across the entire app — creating a cohesive, polished interaction layer.
**FRs covered:** UX-DR13, UX-DR14, UX-DR15, UX-DR16, UX-DR18
**Notes:** Toast system, exercise score framing standardization, tab badges (Talk + Practice), offline transition handling, component promotion (StatTile, ActivityBar, SkillCard).

### Epic 6: Echo Practice

Users can practice listening, speaking, and spelling in a single multi-skill exercise — hear a sentence, repeat it aloud, then type it — receiving scores for comprehension, pronunciation, and spelling simultaneously.
**FRs covered:** FR56, FR57
**Notes:** New hook use-echo-practice.ts, new screen practice/echo.tsx, new prompt builder prompts/echo.ts. Extends exercises table via exercise_type discriminator. Uses existing audio infrastructure.

### Epic 7: Speech-to-Speech Translation

Users hear a sentence in their native language, speak the French translation, and receive AI evaluation on accuracy, fluency, and naturalness — the first structured voice translation practice in a CEFR-calibrated format.
**FRs covered:** FR53, FR54, FR55
**Notes:** New hook use-translation.ts, new screen practice/translation.tsx, new prompt builder prompts/translation.ts. CEFR-calibrated: A1-B1 translation, B2+ paraphrasing. Highest complexity Phase 2 feature.

### Epic 8: Push Notification Engine

Users receive timely push notifications for streak-at-risk alerts and SRS vocabulary review reminders, and can manage their notification preferences — driving retention through gentle, non-punitive nudges.
**FRs covered:** FR58, FR59, FR60
**Notes:** New device_tokens table with RLS, new notification-register Edge Function, expo-notifications integration. Independent of other Phase 2 features.

## Epic 1: MVP Stabilization — End-to-End Testing, Bug Fixing & UX Polish

Users can trust that all existing features work correctly, look visually polished, and handle edge cases gracefully across iOS and Android. This validates the entire implemented MVP before building on top of it.

### Story 1.1: Auth, Onboarding & Profile Flow Verification

As a new or returning user,
I want the authentication, onboarding, and profile flows to work flawlessly,
So that I can create an account, set up my learning profile, and manage my settings without encountering bugs or visual inconsistencies.

**Acceptance Criteria:**

**Given** the app is freshly installed
**When** a user taps "Create Account" and enters a valid email and password
**Then** the account is created, the user is redirected to onboarding, and the profile is stored in the database
**And** the signup screen displays the legal notice with links to privacy policy and terms

**Given** a registered user
**When** they enter valid credentials on the login screen
**Then** they are authenticated and redirected to the home screen with their profile loaded
**And** auth tokens are stored in expo-secure-store (not AsyncStorage)

**Given** a registered user who forgot their password
**When** they submit their email on the forgot-password screen
**Then** a password reset email is sent and the user sees a confirmation message

**Given** a newly registered user on the onboarding wizard
**When** they complete all 3 steps (CEFR level, learning goal, daily time target)
**Then** the profile is updated with their selections and they proceed to the placement test or home screen

**Given** a user who selects "I don't know" for their CEFR level
**When** they take the placement test
**Then** 15 AI-generated questions across 4 linguistic competencies are presented with a progress indicator ("Question N of 15")
**And** results show the assigned level with mastery/struggle analysis per level and a natural language summary

**Given** an authenticated user on the profile screen
**When** they view their profile
**Then** stats, skills, CEFR chart, and error patterns are displayed correctly
**And** the app version number from expo-constants is shown in settings

**Given** an authenticated user in settings
**When** they edit target level, daily goal, or preferences
**Then** a confirmation dialog appears before saving changes

**Given** an authenticated user requesting GDPR actions
**When** they tap "Export Data" in settings
**Then** their personal data is exported successfully with a success toast
**When** they tap "Delete Account" and complete the two-step confirmation (dialog + type DELETE)
**Then** all their data is permanently deleted via the account-delete Edge Function

**Given** all auth and profile screens
**When** visually inspected on iOS and Android
**Then** screens are consistent with the design system (Colors, Typography, Spacing from design.ts), empty states use contextual language, loading states use skeleton animations, and error states offer retry + back actions

### Story 1.2: Voice Conversation & History End-to-End Verification

As a learner,
I want voice conversations, memory, error tracking, and conversation history to work reliably end-to-end,
So that I can practice speaking French with confidence that my progress is tracked and my conversations are saved.

**Acceptance Criteria:**

**Given** an authenticated user on the conversation index screen
**When** they select a topic and conversation mode (companion, debate, or TCF simulation)
**Then** the conversation screen loads with the selected configuration

**Given** a user starting a conversation
**When** the WebSocket connects via the realtime-session Edge Function
**Then** companion memories and top error patterns are fetched in parallel
**And** the AI companion greets the user with audio and transcript (referencing memory when available)
**And** connection completes within 4 seconds or shows "Setting up your conversation..." text

**Given** an active voice conversation
**When** the user speaks
**Then** real-time AI voice responses are received via full-duplex audio
**And** a live text transcript displays both user and AI messages
**And** the user can interrupt the AI mid-sentence (barge-in via VAD)

**Given** the AI detects an error in user speech
**When** a correction is generated
**Then** an inline correction appears with category label (grammar/vocabulary/register/pronunciation) and explanation
**And** the correction is tappable to expand for full detail

**Given** a user ending a conversation
**When** they tap "End Conversation"
**Then** a confirmation appears if conversation < 1 minute
**And** the conversation and messages are saved to the database
**And** new facts are extracted and stored as companion memories
**And** error patterns are detected and logged from corrections
**And** AI feedback (fluency rating, grammar rating, strengths, improvements) is generated and displayed in the feedback sheet

**Given** a user pressing the back button during an active conversation
**When** the back-press guard triggers
**Then** a confirmation dialog appears ("Leave this conversation? It will be saved.")

**Given** an authenticated user on the conversation history screen
**When** they browse past conversations
**Then** conversations are listed with date, topic, and duration
**And** tapping a conversation shows the full transcript including corrections

**Given** all conversation screens
**When** visually inspected on iOS and Android
**Then** the dark background, waveform, transcript, and feedback sheet are visually consistent and polished

### Story 1.3: Practice Exercises Verification (Exercises, Pronunciation, Dictation)

As a learner,
I want all practice exercises — grammar, listening, reading, writing, pronunciation, and dictation — to generate correctly, grade accurately, and track my progress,
So that I can practice every TCF skill dimension with confidence in the feedback I receive.

**Acceptance Criteria:**

**Given** an authenticated user on a practice exercise screen (listening, reading, grammar)
**When** they tap to generate an exercise
**Then** an exercise is generated at their CEFR level within 5 seconds
**And** a skeleton loading animation is shown during generation
**And** MCQ questions have exactly 4 options with exactly 1 correct answer

**Given** a user answering an MCQ exercise
**When** they select an answer and submit
**Then** they receive feedback with the correct answer and an explanation
**And** skill progress and daily activity are updated

**Given** an authenticated user on the writing exercise screen
**When** they complete a writing task (minimum 20 characters)
**Then** a 4-dimension AI evaluation is returned with a rewrite suggestion
**And** the original text is shown alongside AI corrections
**And** a "New Task" confirmation dialog appears if current text > 20 characters

**Given** a user navigating from an error pattern to grammar
**When** they tap an error pattern on home or profile
**Then** the grammar screen receives error context params and generates a targeted micro-drill at the user's CEFR level

**Given** an authenticated user on the pronunciation screen
**When** they record speech and submit
**Then** phoneme-level pronunciation assessment is returned from Azure Speech
**And** word-by-word accuracy is displayed with error type indicators (color + text)

**Given** an authenticated user on the dictation screen
**When** they listen to an AI-generated sentence (normal and slow speeds available)
**And** type what they hear and submit
**Then** a word-by-word color-coded comparison is shown
**And** dictation errors are fed into error pattern tracking

**Given** all practice screens
**When** visually inspected on iOS and Android
**Then** screens follow the state machine pattern (idle → generating → active → checking → results), use design.ts tokens, and show proper empty/error states

### Story 1.4: Mock Tests & Vocabulary SRS Verification

As a learner,
I want mock tests and vocabulary review to work correctly and reliably,
So that I can benchmark my TCF readiness and build vocabulary through spaced repetition.

**Acceptance Criteria:**

**Given** an authenticated user on the mock test index
**When** they start a full mock test
**Then** 76 questions are generated across 3 sections (listening 29, reading 29, grammar 18) with progressive A1-C2 difficulty
**And** a skeleton loading animation is shown during generation

**Given** a user taking a mock test
**When** they answer questions and navigate between them
**Then** a timer runs with drift under 1 second per 30 minutes
**And** they can see their progress through sections

**Given** a user about to submit a mock test
**When** they tap "Submit"
**Then** the unanswered question count is displayed in a confirmation dialog

**Given** a user who interrupts a mock test (app close, back press)
**When** they return to the mock test screen
**Then** their in-progress test is auto-resumed from the exact question they left off
**And** a back-press confirmation dialog appears during active tests

**Given** a completed mock test
**When** results are displayed
**Then** per-section CEFR breakdown and TCF 0-699 score are shown correctly

**Given** an authenticated user on the vocabulary screen
**When** they review flashcards
**Then** SM-2 spaced repetition scheduling works correctly
**And** they can rate recall quality (0-5) to adjust the next review date
**And** the full word list with translations, context, and CEFR level is viewable

**Given** a user reviewing vocabulary while offline
**When** they rate cards
**Then** ratings are queued in the offline write queue
**And** the queue flushes automatically when connectivity is restored

**Given** all mock test and vocabulary screens
**When** visually inspected on iOS and Android
**Then** screens are visually polished, empty states say "No tests taken yet" / "No vocabulary yet" with appropriate messaging

### Story 1.5: Progress Tracking & Offline Resilience Verification

As a learner,
I want my progress, streaks, and daily activity to be tracked accurately, and the app to handle offline gracefully,
So that I can trust my learning data and continue using the app even with intermittent connectivity.

**Acceptance Criteria:**

**Given** an authenticated user who completes exercises or conversations
**When** progress is recorded
**Then** per-skill progress scores update correctly
**And** daily activity is incremented
**And** streak count reflects consecutive days of practice (using local date, not UTC)
**And** daily goal achievement is tracked against the user's configured target

**Given** a user who meets CEFR promotion criteria
**When** they have 10+ exercises across 3+ skills with 85%+ average
**Then** their CEFR level is auto-promoted
**And** the CEFR progression chart reflects the new level with target level indicator

**Given** a user viewing error patterns on profile
**When** they tap an error pattern
**Then** they navigate to the grammar screen with error context for a targeted micro-drill

**Given** a user with cached data
**When** the app loads
**Then** profile loads from cache (4h TTL), skills from cache (30m TTL), activity from cache (15m TTL)
**And** cached data loads within 500ms from AsyncStorage
**And** fresh data replaces cache silently in background

**Given** a user who loses network connectivity
**When** the network drops
**Then** the NetworkBanner displays "No internet connection" within 2 seconds
**And** vocabulary SRS review remains fully functional offline

**Given** a user who regains connectivity
**When** the network is restored
**Then** the NetworkBanner dismisses within 2 seconds
**And** the offline write queue auto-flushes without duplicates
**And** cache is invalidated on fresh writes

**Given** the home screen with no data (first-time user)
**When** the screen loads
**Then** empty states show contextual messaging (not "No data" or "Empty")
**And** weekly activity bars are present but at zero height
**And** the companion greets: "Welcome! Let's start with a conversation."

### Story 1.6: Edge Function Deployment & Security Verification

As a developer,
I want all Edge Functions deployed and verified against real APIs with proper security controls,
So that the production backend is ready for app store submission and user data is protected.

**Acceptance Criteria:**

**Given** the Supabase project with secrets configured (OPENAI_API_KEY, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)
**When** all 4 Edge Functions are deployed (ai-proxy, realtime-session, pronunciation-assess, account-delete)
**Then** each function responds to health check requests without errors

**Given** a deployed ai-proxy Edge Function
**When** a request is made with a valid JWT
**Then** chat completions, TTS, and embedding requests proxy correctly to OpenAI
**And** only allowlisted models are accepted
**And** rate limiting enforces 30 requests/minute per user
**And** the X-RateLimit-Remaining header is present in responses

**Given** a deployed realtime-session Edge Function
**When** a request is made with a valid JWT
**Then** an ephemeral Realtime API token is returned
**And** rate limiting enforces 10 requests/minute per user

**Given** a deployed pronunciation-assess Edge Function
**When** a request is made with audio data and a valid JWT
**Then** Azure Speech pronunciation assessment is returned correctly
**And** rate limiting enforces 20 requests/minute per user

**Given** a deployed account-delete Edge Function
**When** a request is made with a valid JWT
**Then** the user's data is deleted via the admin API
**And** rate limiting enforces 1 request/minute per user

**Given** any Edge Function
**When** a request is made without a valid JWT
**Then** an AUTH_MISSING error is returned with appropriate status code
**And** no PII is logged to console or error tracking

**Given** all SECURITY DEFINER functions in the database
**When** inspected
**Then** all use SET search_path = public

**Given** all database tables
**When** RLS policies are reviewed
**Then** every table enforces auth.uid() = user_id scoping

### Story 1.7: Cross-Platform UX Polish & Accessibility Audit

As a learner using iOS or Android,
I want the app to look and feel polished with consistent design and accessibility support,
So that I can use the app comfortably regardless of device, font size preferences, or assistive technology.

**Acceptance Criteria:**

**Given** all screens in the app
**When** visually compared between iOS and Android
**Then** colors, typography, spacing, and border radii are consistent with design.ts tokens
**And** no hardcoded hex values or magic numbers are present in screens

**Given** all interactive elements (buttons, cards, chips, MCQ options, links)
**When** inspected for accessibility
**Then** each has an appropriate accessibilityRole and accessibilityLabel
**And** non-obvious interactions have accessibilityHint

**Given** all tappable elements
**When** measured
**Then** touch targets are at least 44x44 points

**Given** the app with Dynamic Type set to 1.3x
**When** all screens are loaded
**Then** no layout breakage occurs — text wraps or containers expand as needed

**Given** all color combinations used in the app
**When** checked against WCAG 2.1 AA
**Then** body text meets 4.5:1 contrast ratio
**And** large text meets 3:1 contrast ratio
**And** no information is conveyed by color alone (always accompanied by text or icon)

**Given** all loading states across the app
**When** content is being generated or fetched
**Then** skeleton animations matching content shape are shown (never generic spinners)
**And** if loading exceeds 2x expected duration, a subtle text message appears

**Given** all error states across the app
**When** an error occurs
**Then** a user-friendly message is shown (never raw error codes)
**And** at least one action is available (Retry, Back, or fallback)
**And** errors are captured to Sentry with context tags

**Given** all empty states across the app
**When** a screen has no data
**Then** contextual, encouraging language is used (never "No data" or "Empty")
**And** empty states for core features include a direct action to start

## Epic 2: Companion Daily Briefing (Home Screen Evolution)

Users open the app to a personalized companion message that knows their context, surfaces what to practice today, and shows their error-to-mastery progress — replacing the current stats dashboard with a relationship-driven daily plan.

### Story 2.1: CompanionMessage Component & Memory-Driven Briefing

As a returning learner,
I want to see a personalized companion message when I open the app,
So that I feel recognized and know what the companion remembers about me and my learning journey.

**Acceptance Criteria:**

**Given** an authenticated user with companion memories and learning history
**When** the home screen loads
**Then** a CompanionMessage component displays with a 32px avatar circle (Colors.primary background, white "C" initial), companion name label, and a personalized briefing message
**And** the message is assembled from: companion memories (personal context), SRS vocabulary due count, and weakest skill this week
**And** bold spans highlight key data points (card counts, skill names)

**Given** an authenticated user with no companion memories (first-time)
**When** the home screen loads
**Then** the CompanionMessage displays a welcome greeting: "Welcome! Let's start with a conversation." or similar first-time message

**Given** the CompanionMessage is loading data
**When** memory retrieval and skill queries are in progress
**Then** a skeleton placeholder matching the message card dimensions is shown

**Given** no message content is available (edge case)
**When** the component receives empty data
**Then** the component returns null (is not rendered)

**Given** the CompanionMessage component
**When** inspected for accessibility
**Then** it has accessibilityRole="text" and accessibilityLabel="Your companion says: [message content]"

**Given** the CompanionMessage component
**When** styled
**Then** it uses Colors.primary at 5% opacity background, Typography.caption for name (weight 700), Typography.bodySecondary for message, Radii.card (16px) border radius, and Spacing.cardPadding (16px) padding

### Story 2.2: Today's Plan — Curated Activity Recommendations

As a learner opening the app for a daily session,
I want to see 2-3 curated activity recommendations with clear rationale,
So that I know what to practice today without decision fatigue.

**Acceptance Criteria:**

**Given** an authenticated user with learning history
**When** the home screen loads
**Then** a "Today's Plan" section displays 2-3 TodayPlanItem cards, each with an icon, skill color tint, title, subtitle explaining why it's recommended, and a badge

**Given** the recommendation engine
**When** it computes Today's Plan items
**Then** it prioritizes: (1) SRS vocabulary cards due → badge "Due", (2) weakest skill this week → badge "Suggested", (3) active error patterns needing drills → badge "Error"
**And** at most 3 items are shown

**Given** a TodayPlanItem card
**When** the user taps it
**Then** they navigate to the relevant screen (vocabulary, practice skill, grammar micro-drill) with context pre-configured
**And** a haptic light feedback fires on press
**And** the card scales to 0.97 with opacity 0.8 during press

**Given** a TodayPlanItem with badge type "due"
**When** rendered
**Then** the badge uses amber tint background with amber text

**Given** a TodayPlanItem with badge type "error"
**When** rendered
**Then** the badge uses red tint background with red text

**Given** the app is offline and the plan item requires network
**When** the item renders
**Then** it appears at opacity 0.5 and is non-tappable (disabled state)

**Given** the TodayPlanItem component
**When** inspected for accessibility
**Then** it has accessibilityRole="button", accessibilityLabel="[title]. [subtitle]. Status: [badge text]", and accessibilityHint="Double tap to start this activity"

**Given** the TodayPlanItem component
**When** styled
**Then** it uses skillTint(iconColor, 0.06) background, 28px icon container with skillTint(iconColor, 0.12), Typography.label for title, Typography.caption for subtitle, Radii.button (12px) border radius, and 10px 12px padding

### Story 2.3: Error Journey Progress Bar & Home Screen Integration

As a learner tracking my improvement,
I want to see how many error patterns I've resolved on my home screen,
So that I have tangible proof of mastery and motivation to keep practicing.

**Acceptance Criteria:**

**Given** an authenticated user with error patterns (some resolved, some active)
**When** the home screen loads
**Then** an ErrorJourneyBar displays showing "[resolved] of [total] patterns resolved" with a percentage and a proportional fill bar

**Given** a user with zero error patterns
**When** the home screen loads
**Then** the ErrorJourneyBar is not rendered (returns null)

**Given** a user with all error patterns resolved
**When** the home screen loads
**Then** the ErrorJourneyBar shows a fully filled green bar with "All patterns resolved!" text

**Given** the ErrorJourneyBar component
**When** the resolved count changes
**Then** the bar fill width animates smoothly to the new proportion

**Given** the ErrorJourneyBar component
**When** inspected for accessibility
**Then** it has accessibilityRole="progressbar", accessibilityLabel="Error patterns: [resolved] of [total] resolved, [percentage] percent", and accessibilityValue with min=0, max=total, now=resolved

**Given** the ErrorJourneyBar component
**When** styled
**Then** it uses Colors.primary at 4% opacity background, Typography.caption (weight 600) for label, Typography.caption (weight 700, Colors.success) for percentage, 6px bar height with Radii.chip radius, Colors.success for fill, Radii.button (12px) overall radius, and 8px 10px padding

**Given** the home screen with all new components integrated
**When** the layout is viewed
**Then** the order is: CompanionMessage → hero "Talk with Companion" card → Today's Plan list → ErrorJourneyBar → existing stats (streak in deprioritized position)
**And** if the user has a recent conversation, the hero card says "Continue" not "Start"

**Given** the integrated home screen
**When** visually inspected on iOS and Android
**Then** all new components use design.ts tokens consistently and the layout follows the single-column flow with 16px section gaps and 20px screen padding

## Epic 3: Enhanced Voice Conversation Experience

Users have a more immersive voice conversation with a waveform-centered layout, clear processing state feedback ("Listening..."), condensed transcript, and gentler correction styling — eliminating the anxiety gap between speaking and AI response.

### Story 3.1: AudioWaveform Processing State & ProcessingIndicator

As a learner in a voice conversation,
I want clear visual feedback when the AI is processing my speech,
So that I know the AI heard me and is preparing a response, rather than feeling anxious during the silence.

**Acceptance Criteria:**

**Given** the AudioWaveform component
**When** the speaker prop receives a "processing" value
**Then** the waveform displays a visually distinct animation from idle (slow breathing) and active (oscillating)
**And** the processing state communicates "thinking" — not lag or error

**Given** the user finishes speaking (server VAD detects silence)
**When** the AI has not yet started responding (500ms-2s gap)
**Then** the AudioWaveform transitions to the "processing" state
**And** a ProcessingIndicator component renders below the waveform showing three 5px pulsing dots (Colors.accent at varying opacity, staggered 200ms) with "Listening..." label

**Given** the AI starts speaking
**When** the processing state ends
**Then** the ProcessingIndicator fades out (Reanimated FadeOut, 200ms) and the waveform transitions to "active/ai" state

**Given** a conversation is in the "connecting" phase
**When** the WebSocket is being established
**Then** the ProcessingIndicator shows "Setting up your conversation..." label instead of "Listening..."

**Given** the ProcessingIndicator in idle state
**When** no processing is happening
**Then** the component is hidden (not rendered)

**Given** the ProcessingIndicator component
**When** inspected for accessibility
**Then** it has accessibilityRole="status", accessibilityLabel="[state]: [label text]", and accessibilityLiveRegion="polite" to announce state changes to screen readers

**Given** the ProcessingIndicator component
**When** styled
**Then** it uses Typography.caption for label (Colors.textOnDark at 50% opacity, weight 500), Colors.accent for dots, and Reanimated FadeIn/FadeOut transitions at 200ms

### Story 3.2: TranscriptView Condensed Mode & CorrectionBubble Side-Note Variant

As a learner in a voice conversation,
I want the transcript to be less dominant and corrections to appear as gentle side-notes,
So that I stay focused on the conversation flow rather than being overwhelmed by text and corrections.

**Acceptance Criteria:**

**Given** the TranscriptView component receives a `condensed` prop set to true
**When** rendering during an active conversation
**Then** only the last 2-3 messages are visible in the viewport
**And** the full transcript remains accessible via scrolling upward
**And** auto-scroll to the latest message continues to work

**Given** the TranscriptView in condensed mode
**When** new messages arrive
**Then** older messages scroll above the visible area without jump or jank
**And** the transition is smooth at 60fps

**Given** the CorrectionBubble component receives a `sideNote` variant prop
**When** rendering a correction during conversation
**Then** the correction displays as an amber left-border card (Colors.accent) with reduced visual weight
**And** the collapsed state shows: category badge + "original → corrected" one-liner + "Tap for details" affordance
**And** tapping expands to reveal the full explanation paragraph

**Given** a correction in sideNote variant
**When** it appears in the transcript
**Then** it slides in from the left (200ms animation) after the AI response completes — never interrupting the AI's turn

**Given** the sideNote variant
**When** compared to the default CorrectionBubble
**Then** it is visually lighter: semi-transparent background, Typography.caption size, amber left border instead of full-width card

**Given** both condensed TranscriptView and sideNote CorrectionBubble
**When** used together during a conversation
**Then** corrections attach below the user's message they reference, within the condensed view area

### Story 3.3: Waveform-Centered Layout & Latency Masking

As a learner having a voice conversation,
I want the conversation screen to feel immersive with the waveform as the visual anchor and natural-sounding AI processing,
So that the experience feels like talking to a person rather than using a tool.

**Acceptance Criteria:**

**Given** the conversation screen during an active voice session
**When** the layout renders
**Then** the AudioWaveform is large, centered, and occupies the middle of the screen with concentric ring borders
**And** the condensed TranscriptView sits above the waveform
**And** the end button sits at the bottom
**And** no other UI elements compete for attention during active speech

**Given** the conversation screen on iPhone SE (375pt width, ~667pt height)
**When** laid out
**Then** the waveform + condensed transcript + end button fit without scrolling during active conversation

**Given** the conversation system prompts (companion, debate, TCF simulation modes)
**When** the AI processes a response
**Then** French filler phrases are used in the audio output ("Alors, voyons...", "Hmm, bonne question...", "Eh bien...") to mask the 500ms-2s processing gap
**And** the filler phrases are added to the system prompt builders in src/lib/prompts/conversation.ts

**Given** the waveform-centered layout
**When** the conversation transitions through states (connecting → idle → user speaking → processing → AI speaking)
**Then** each state has a visually distinct waveform animation: connecting (synchronized pulse), idle (slow breathing), user speaking (amber bars oscillating), processing (distinct animation + ProcessingIndicator dots), AI speaking (white bars oscillating)

**Given** a user who has completed a conversation
**When** they end the conversation
**Then** the screen transitions to the feedback sheet (modal slide-up) with the existing post-conversation feedback

**Given** the waveform-centered conversation screen
**When** visually inspected on iOS and Android
**Then** the dark background (Colors.bgDark), waveform prominence, condensed transcript, and minimal controls create a focused, immersive experience consistent with the anti-UI voice screen philosophy

## Epic 4: Narrative Post-Conversation Feedback

Users receive a progress story after conversations — personalized header, session-over-session comparison, milestone celebrations for personal bests, companion-voiced observations, and error journey visualization — making improvement tangible.

### Story 4.1: SessionComparison Component & Previous Session Data

As a learner who practices regularly,
I want to see how my fluency, grammar, and duration compare to my last session,
So that I can see tangible progress or know where to focus next.

**Acceptance Criteria:**

**Given** a user who has completed at least two conversations
**When** the post-conversation feedback screen loads
**Then** a SessionComparison component displays showing fluency, grammar, and duration with previous values, current values, and direction arrows (up/down/same)

**Given** a user completing their first conversation ever
**When** the feedback screen loads
**Then** the SessionComparison component is hidden (returns null — no previous session exists)

**Given** a user returning after a long absence (3+ weeks)
**When** they complete their first conversation back
**Then** the SessionComparison component is hidden (per Journey 3 design — no "vs. last session" on first return)

**Given** the SessionComparison component with metrics
**When** a metric direction is "up"
**Then** the arrow and current value display in Colors.success (green)
**When** a metric direction is "down"
**Then** the arrow and current value display in Colors.error (red)
**When** a metric direction is "same"
**Then** an equals sign displays in Colors.textTertiary

**Given** the previous session's ratings
**When** the current conversation ends
**Then** the current session's fluency rating, grammar rating, and duration are stored to enable comparison for the next session

**Given** the SessionComparison component
**When** inspected for accessibility
**Then** it has accessibilityRole="summary" and each row has accessibilityLabel="[label]: changed from [previous] to [current], [direction]"

**Given** the SessionComparison component
**When** styled
**Then** it uses Colors.primary at 4% opacity background, Typography.caption (weight 700, Colors.primary) for title, Typography.caption for labels and previous values, Typography.bodySecondary (weight 700) for current values, Radii.button (12px) radius, and 10px 12px padding

### Story 4.2: MilestoneBanner Component & Personal Best Detection

As a learner achieving something noteworthy,
I want to see a celebration when I hit a personal best, resolve an error pattern, or get promoted to a new CEFR level,
So that I feel genuine accomplishment from earned achievements.

**Acceptance Criteria:**

**Given** a user who achieves their best fluency or grammar score ever
**When** the feedback screen loads
**Then** a MilestoneBanner appears with type "personal_best", a celebration emoji, title "New Personal Best!", and the specific achievement detail

**Given** a user whose conversation triggers an error pattern resolution (absent from 5 consecutive conversations)
**When** the feedback screen loads
**Then** a MilestoneBanner appears with type "error_resolved", title referencing the resolved pattern (e.g., "Pattern Resolved: penser à vs de")

**Given** a user who earns a CEFR promotion
**When** the feedback screen loads
**Then** a MilestoneBanner appears with type "cefr_promotion", amber tint background, and the new level highlighted

**Given** no milestone was earned in this session
**When** the feedback screen loads
**Then** the MilestoneBanner is not rendered (returns null — never shown without genuine achievement)

**Given** a MilestoneBanner appearing on screen
**When** it mounts
**Then** it slides in with FadeInDown.duration(400).springify() animation
**And** hapticSuccess() fires on mount

**Given** the MilestoneBanner component with type "personal_best" or "error_resolved"
**When** styled
**Then** it uses green tint at 8% opacity background, green text for title and subtitle

**Given** the MilestoneBanner component with type "cefr_promotion"
**When** styled
**Then** it uses amber tint at 8% opacity background, amber text for title and subtitle

**Given** the MilestoneBanner component
**When** inspected for accessibility
**Then** it has accessibilityRole="alert" and accessibilityLabel="Milestone: [title]. [subtitle]"

**Given** the personal best detection logic
**When** a conversation ends
**Then** the system compares current fluency and grammar ratings against historical maximums to determine if a personal best was achieved

### Story 4.3: Narrative Feedback Screen Integration

As a learner finishing a conversation,
I want the feedback debrief to feel like a satisfying ritual with personalized narrative,
So that I leave every session with clarity on what went well and what to work on.

**Acceptance Criteria:**

**Given** a user ending a conversation
**When** the feedback sheet slides up
**Then** the header displays "Great Session, [Name]!" using the user's name — never generic "Session Complete" or "Conversation Complete"

**Given** the feedback screen layout
**When** all components are present
**Then** the order is: personalized header → MilestoneBanner (if earned) → fluency/grammar ratings as bar charts → SessionComparison (if applicable) → "What We Noticed" observations → ErrorJourneyBar → contextual next action button

**Given** the strengths and improvements from AI feedback
**When** displayed on the feedback screen
**Then** they are reframed as companion-voiced "What We Noticed" observations (e.g., "Passé composé used correctly 4 times — strong!" instead of "Strengths: passé composé")
**And** resolved error patterns are celebrated: "You used to struggle with [pattern]. Not anymore!"

**Given** the user has active error patterns
**When** the feedback screen loads
**Then** an ErrorJourneyBar (reused from Epic 2) displays showing "[resolved] of [total] patterns resolved ([percentage]%)"

**Given** the feedback screen with today's weaknesses identified
**When** the contextual next action renders
**Then** a specific button appears based on the session's errors (e.g., "Practice Accents" linking to pronunciation, "Review Grammar" linking to grammar screen with error context)
**And** the action is never generic "Practice" — always contextual to today's performance

**Given** a user achieving their best grammar rating in this session
**When** the ratings section renders
**Then** a subtle callout appears: "Your best grammar score! [N]/5"

**Given** the narrative feedback screen
**When** visually inspected on iOS and Android
**Then** the layout is consistent with design.ts tokens, the emotional tone is reflective satisfaction (not clinical grading), and the sheet feels like a natural conclusion to the conversation

## Epic 5: UX System Patterns & Polish

Users experience consistent feedback framing, toast notifications, tab badge indicators, and graceful offline transitions across the entire app — creating a cohesive, polished interaction layer.

### Story 5.1: Toast Notification System

As a learner performing actions throughout the app,
I want consistent, non-intrusive toast notifications for success, warning, and error events,
So that I always know the outcome of my actions without disruptive modals.

**Acceptance Criteria:**

**Given** a successful action (exercise saved, streak updated, data exported)
**When** the success toast fires
**Then** a toast appears at the top of the screen below the status bar with a green left border, check icon, and one-line message
**And** it auto-dismisses after 3 seconds
**And** hapticSuccess() fires on appearance

**Given** a warning condition (approaching rate limit, large SRS backlog)
**When** the warning toast fires
**Then** a toast appears with an amber left border, info icon, and descriptive message
**And** it auto-dismisses after 5 seconds

**Given** an API failure or save error
**When** the error toast fires
**Then** a toast appears with a red left border, warning icon, and user-friendly message (never raw error codes)
**And** it persists until the user dismisses it or taps "Retry"
**And** hapticError() fires on appearance

**Given** multiple toast events fire in rapid succession
**When** a toast is already visible
**Then** only one toast is displayed at a time — additional toasts are queued and shown sequentially

**Given** the toast system
**When** integrated across the app
**Then** it is available as a shared utility (e.g., context provider or imperative API) callable from any screen or hook

**Given** all toast variants
**When** visually inspected
**Then** toasts use design.ts tokens for colors, Typography.caption for message text, Radii.button for border radius, and Shadows.elevated for the container

### Story 5.2: Exercise Score Framing & Tab Badge Indicators

As a learner completing exercises and navigating the app,
I want consistent, encouraging score feedback and visual indicators showing what needs my attention,
So that I never feel punished by scores and always know where to go next.

**Acceptance Criteria:**

**Given** a user completing any exercise (listening, reading, writing, grammar, dictation, pronunciation)
**When** the score is displayed
**Then** the feedback label and color follow the standardized framing:

- 90-100%: "Excellent!" in Colors.success
- 80-89%: "Great job!" in Colors.success
- 70-79%: "Good work!" in Colors.accent
- 60-69%: "Keep going!" in Colors.accent
- 50-59%: "Almost there!" in Colors.primary
- Below 50%: "Keep practicing!" in Colors.primary
  **And** the label never uses "Failed," "Wrong," or "Poor"

**Given** a user scoring 80% or above
**When** haptic feedback fires
**Then** hapticSuccess() is used
**Given** a user scoring below 80%
**When** haptic feedback fires
**Then** hapticLight() is used — never hapticError() on scores

**Given** every ScoreCard displayed after exercises
**When** the actions render
**Then** both "Try Again" and "Back" buttons are always present

**Given** the tab bar on the main app
**When** the companion has context from recent user activity (e.g., recent conversation memories, new error patterns)
**Then** an amber dot badge appears on the Talk tab

**Given** the tab bar on the main app
**When** the user has SRS vocabulary cards due for review
**Then** a number badge appears on the Practice tab showing the due card count

**Given** the tab badges
**When** the user addresses the badged item (reviews vocab, starts conversation)
**Then** the badge clears or updates its count

**Given** all score framing changes
**When** applied across exercise screens
**Then** the standardized labels and haptics are consistent in listening, reading, writing, grammar, dictation, and pronunciation screens

### Story 5.3: Offline Transition Handling & Component Promotion

As a learner using the app on an unreliable connection,
I want graceful transitions when I go offline mid-activity and reusable components across screens,
So that losing connection never feels like a crash and the UI stays consistent as the app grows.

**Acceptance Criteria:**

**Given** a user in an active voice conversation
**When** the network drops and the WebSocket closes
**Then** the screen shows "Connection lost — your conversation has been saved"
**And** the user is navigated to the transcript view of the saved conversation
**And** no error modal or crash screen appears

**Given** a user mid-exercise with the exercise already generated
**When** the network drops
**Then** the user can continue answering the current exercise
**And** results are queued for sync when connectivity returns

**Given** a user mid-exercise while the exercise is generating
**When** the network drops
**Then** the user sees a message: "Can't generate exercise offline. Review vocabulary instead?"
**And** a button navigates them to vocabulary SRS review (offline-capable)

**Given** the NetworkBanner
**When** the network rapidly toggles (flaky connection)
**Then** the banner is debounced by 5 seconds — it does not rapidly appear and disappear
**And** visual noise from toggling is eliminated

**Given** the StatTile component currently in profile/index.tsx
**When** it is needed by other screens (home stats, mock test results, exercise summaries)
**Then** it is promoted to src/components/common/StatTile.tsx with a props interface, React.memo, and accessibility labels

**Given** the ActivityBar component currently in home/index.tsx
**When** it is needed by the profile weekly view
**Then** it is promoted to src/components/common/ActivityBar.tsx with a props interface, React.memo, and accessibility labels

**Given** the SkillCard component currently in practice/index.tsx
**When** it is needed as a generalizable tappable feature card
**Then** it is promoted to src/components/common/SkillCard.tsx with a props interface, React.memo, and accessibility labels

**Given** all promoted components
**When** extracted to src/components/common/
**Then** the original screen files import from the new shared location
**And** no duplicate component definitions exist
**And** npm run type-check && npm run lint && npm run format:check pass clean

## Epic 6: Echo Practice

Users can practice listening, speaking, and spelling in a single multi-skill exercise — hear a sentence, repeat it aloud, then type it — receiving scores for comprehension, pronunciation, and spelling simultaneously.

### Story 6.1: Echo Practice Prompt Builder & Exercise Generation

As a learner wanting multi-skill practice,
I want the app to generate CEFR-calibrated sentences for echo practice,
So that the sentences match my level and target relevant vocabulary and grammar structures.

**Acceptance Criteria:**

**Given** a user at any CEFR level (A1-C2)
**When** the echo practice prompt builder generates a sentence
**Then** the sentence is calibrated to the user's CEFR level using vocabulary frequency constraints and grammatical structures appropriate for that level
**And** the prompt is built in src/lib/prompts/echo.ts following the `build<Feature>Prompt(params): string` convention

**Given** the echo practice generation request
**When** sent to the ai-proxy Edge Function
**Then** the response includes: the French sentence text, an audio TTS rendering, and expected spelling
**And** temperature is set to 0.4 per convention
**And** the exercise is stored in the exercises table using the exercise_type discriminator with content in JSONB

**Given** the echo practice prompt builder
**When** generating sentences
**Then** it uses private Record<CEFRLevel, string> maps for level-specific content guidance
**And** sentences are natural French (not awkward constructions) suitable for spoken repetition

**Given** exercise generation
**When** it fails or returns an empty response
**Then** the error is handled gracefully with retry logic (2 retries with backoff)
**And** requireNetwork() is called before the API request

### Story 6.2: Echo Practice Hook & Multi-Step Exercise Flow

As a learner doing echo practice,
I want to listen to a sentence, repeat it aloud, then type it, and receive scores for all three skills,
So that I improve my listening, pronunciation, and spelling in one integrated exercise.

**Acceptance Criteria:**

**Given** the use-echo-practice.ts hook
**When** initialized
**Then** it manages a multi-step state machine with states: idle → generating → listen → speak → type → checking → results
**And** the state type is exported as EchoPracticeScreenState

**Given** the "listen" step
**When** the generated sentence audio plays
**Then** the user hears the sentence via TTS
**And** they can replay the audio at normal and slow speeds
**And** the French text is NOT shown during listening (tests comprehension)

**Given** the "speak" step
**When** the user records their spoken repetition
**Then** the audio is captured via the existing audio recorder infrastructure
**And** pronunciation assessment is requested via the pronunciation-assess Edge Function
**And** word-by-word accuracy results are returned

**Given** the "type" step
**When** the user types what they heard
**Then** a text input captures their typed response
**And** the system compares their typed text against the expected spelling using word-by-word comparison (reusing dictation comparison logic)

**Given** the "results" step
**When** all three sub-scores are computed
**Then** the hook returns: listening comprehension score (based on pronunciation accuracy as proxy), pronunciation score (from Azure Speech assessment), and spelling score (from word comparison)
**And** skill progress is updated for listening, speaking, and vocabulary skills
**And** daily activity is incremented

**Given** the hook
**When** errors are detected in pronunciation or spelling
**Then** they are fed into error pattern tracking via extractErrorsFromCorrections

**Given** the use-echo-practice.ts hook
**When** compared to useExercise
**Then** it is a separate, dedicated hook (not a generalization of useExercise) per Architecture decision

### Story 6.3: Echo Practice Screen & Practice Hub Integration

As a learner browsing practice options,
I want to find and use echo practice from the practice hub,
So that I can access this multi-skill exercise alongside my other practice types.

**Acceptance Criteria:**

**Given** the practice hub index screen
**When** the user views available practice types
**Then** an "Echo Practice" skill card appears with appropriate icon, color, and description
**And** tapping it navigates to practice/echo.tsx

**Given** the echo practice screen in "idle" state
**When** the user opens it
**Then** a description of the exercise explains the listen-speak-type flow
**And** a "Generate" button starts exercise generation

**Given** the echo practice screen in "generating" state
**When** the AI generates the exercise
**Then** a skeleton loading animation matching the exercise layout is shown
**And** generation completes within 5 seconds

**Given** the echo practice screen in "listen" state
**When** audio plays
**Then** the user sees a play button (normal speed) and a slow-speed button
**And** a "Next" button advances to the speak step after at least one listen
**And** no text is visible — only audio

**Given** the echo practice screen in "speak" state
**When** the user records speech
**Then** a microphone button with recording indicator is shown
**And** the user can re-record before submitting
**And** a "Next" button advances to the type step

**Given** the echo practice screen in "type" state
**When** the user types their response
**Then** a text input is focused with the keyboard visible
**And** a "Check" button submits the response

**Given** the echo practice screen in "results" state
**When** scores are displayed
**Then** three sub-scores (listening, pronunciation, spelling) are shown with the standardized score framing from Epic 5
**And** word-by-word comparison is shown for both pronunciation (color-coded accuracy) and spelling (color-coded match)
**And** "Try Again" and "Back" buttons are available

**Given** the echo practice screen
**When** the layout is registered
**Then** practice/echo.tsx is added to the practice layout file
**And** the screen follows the standard state machine pattern

**Given** the echo practice screen
**When** visually inspected on iOS and Android
**Then** it uses design.ts tokens consistently, matches the design system, and includes accessibility labels on all interactive elements

## Epic 7: Speech-to-Speech Translation

Users hear a sentence in their native language, speak the French translation, and receive AI evaluation on accuracy, fluency, and naturalness — the first structured voice translation practice in a CEFR-calibrated format.

### Story 7.1: Translation Prompt Builder & Evaluation Logic

As a learner practicing translation,
I want CEFR-appropriate sentences and accurate evaluation of my spoken French translation,
So that I build the mental bridge from my native language to French at my proficiency level.

**Acceptance Criteria:**

**Given** a user at CEFR level A1-B1
**When** the translation prompt builder generates content
**Then** it produces a sentence in the user's native language (English) with a corresponding French translation target
**And** vocabulary and grammar structures are calibrated to the user's CEFR level
**And** the prompt is built in src/lib/prompts/translation.ts following the build<Feature>Prompt convention

**Given** a user at CEFR level B2 or above
**When** the translation prompt builder generates content
**Then** it produces a French sentence for L2 paraphrasing (rephrase in different French words) instead of L1-to-L2 translation
**And** this shift is per PRD rationale: translation reinforces L1→L2 pathways, counterproductive for advanced learners

**Given** the evaluation prompt
**When** it scores the user's spoken translation
**Then** it evaluates three dimensions: accuracy (semantic correctness), fluency (natural flow and pronunciation), and naturalness (idiomatic French vs. literal translation)
**And** each dimension receives a score and specific feedback text
**And** temperature is set to 0.4 per convention

**Given** the translation prompt builder
**When** generating sentences
**Then** it uses private Record<CEFRLevel, string> maps for level-specific content guidance
**And** sentences cover practical scenarios (travel, work, daily life) appropriate for TCF preparation

**Given** the translation exercise data
**When** stored
**Then** it uses the existing exercises table with exercise_type discriminator set to "translation" and content in JSONB

### Story 7.2: Translation Exercise Hook

As a learner doing translation practice,
I want to hear a sentence, speak my translation, and receive multi-dimensional feedback,
So that I can systematically improve my ability to produce French from comprehension.

**Acceptance Criteria:**

**Given** the use-translation.ts hook
**When** initialized
**Then** it manages a state machine with states: idle → generating → listen → recording → checking → results
**And** the state type is exported as TranslationScreenState

**Given** the "generating" state
**When** the exercise is being created
**Then** the hook requests sentence generation via the ai-proxy Edge Function
**And** TTS audio is generated for the source sentence (native language at A1-B1, French at B2+)
**And** requireNetwork() is called before the API request

**Given** the "listen" state
**When** the source sentence audio plays
**Then** the user hears the sentence in their native language (A1-B1) or in French (B2+ paraphrasing)
**And** the source text is displayed on screen
**And** the user can replay at normal and slow speeds

**Given** the "recording" state
**When** the user speaks their French translation
**Then** audio is captured via the existing audio recorder infrastructure
**And** the user can re-record before submitting

**Given** the "checking" state
**When** the user submits their recording
**Then** the hook sends the audio for pronunciation assessment via pronunciation-assess Edge Function
**And** sends a transcription + evaluation request via ai-proxy for accuracy, fluency, and naturalness scoring
**And** both requests run in parallel where possible

**Given** the "results" state
**When** evaluation completes
**Then** the hook returns: accuracy score, fluency score, naturalness score, specific feedback per dimension, and the expected French translation for comparison
**And** skill progress is updated for speaking skill
**And** daily activity is incremented
**And** errors detected in the translation are fed into error pattern tracking

### Story 7.3: Translation Screen & Practice Hub Integration

As a learner browsing practice options,
I want to find and use translation practice from the practice hub,
So that I can access this unique voice translation exercise alongside my other practice types.

**Acceptance Criteria:**

**Given** the practice hub index screen
**When** the user views available practice types
**Then** a "Translation" skill card appears with appropriate icon, color, and description
**And** tapping it navigates to practice/translation.tsx

**Given** the translation screen in "idle" state
**When** the user opens it
**Then** a description explains the exercise: hear a sentence, speak the French translation, receive evaluation
**And** for B2+ users, the description explains paraphrasing mode
**And** a "Generate" button starts exercise generation

**Given** the translation screen in "generating" state
**When** the AI generates the exercise
**Then** a skeleton loading animation matching the exercise layout is shown

**Given** the translation screen in "listen" state
**When** audio plays
**Then** the source sentence text is displayed (native language or French for B2+)
**And** play (normal) and slow-speed buttons are available
**And** a "Translate" button advances to recording after at least one listen

**Given** the translation screen in "recording" state
**When** the user records
**Then** a microphone button with recording indicator is shown
**And** the source sentence remains visible as reference
**And** the user can re-record before submitting
**And** a "Submit" button sends the recording for evaluation

**Given** the translation screen in "results" state
**When** scores are displayed
**Then** three dimension scores (accuracy, fluency, naturalness) are shown with the standardized score framing from Epic 5
**And** specific feedback text is displayed per dimension
**And** the expected French translation is shown for comparison
**And** "Try Again" and "Back" buttons are available

**Given** the translation screen
**When** the layout is registered
**Then** practice/translation.tsx is added to the practice layout file

**Given** the translation screen
**When** visually inspected on iOS and Android
**Then** it follows the standard state machine pattern, uses design.ts tokens, and includes accessibility labels on all interactive elements

## Epic 8: Push Notification Engine

Users receive timely push notifications for streak-at-risk alerts and SRS vocabulary review reminders, and can manage their notification preferences — driving retention through gentle, non-punitive nudges.

### Story 8.1: Device Token Registration & Edge Function

As a developer setting up push notification infrastructure,
I want a secure device token storage system and registration endpoint,
So that the app can reliably deliver push notifications to registered devices.

**Acceptance Criteria:**

**Given** the Supabase database
**When** the migration is applied
**Then** a `device_tokens` table is created with columns: id (uuid PK), user_id (FK to auth.users), token (text), platform (text: ios/android), created_at, updated_at
**And** a UNIQUE constraint exists on (user_id, token)
**And** RLS is enabled enforcing auth.uid() = user_id on all operations

**Given** the notification-register Edge Function
**When** a request is made with a valid JWT and a push token
**Then** the token is upserted into device_tokens (insert or update if existing)
**And** the response confirms registration with corsHeaders

**Given** the notification-register Edge Function
**When** a request is made with a valid JWT and a preferences update
**Then** notification preferences (streak_alerts: boolean, srs_reminders: boolean) are stored
**And** preferences can be retrieved in a subsequent request

**Given** the notification-register Edge Function
**When** a request is made without a valid JWT
**Then** an AUTH_MISSING error is returned

**Given** the notification-register Edge Function
**When** deployed
**Then** it follows the Edge Function template exactly: JSDoc header, \_shared/ imports, CORS preflight, env var verification, JWT auth, rate limiting (10/min), try/catch with errorResponse(), corsHeaders on every response

**Given** a user who deletes their account
**When** the account-delete Edge Function cascades
**Then** all device_tokens for that user are deleted

### Story 8.2: Streak & SRS Notification Delivery

As a learner who might forget to practice,
I want to receive gentle push notifications when my streak is at risk or vocabulary cards are due,
So that I maintain my learning habit without needing to remember to open the app.

**Acceptance Criteria:**

**Given** a user who has an active streak and has not practiced today
**When** a configurable time threshold passes (e.g., 8 PM local time or user-configured reminder time)
**Then** a streak-at-risk push notification is sent: "Your [N]-day streak is waiting! A quick practice keeps it alive."
**And** the notification tone is encouraging, never punitive (no "You're about to lose your streak!")

**Given** a user who has SRS vocabulary cards due for review
**When** the due count exceeds a threshold (e.g., 10+ cards due)
**Then** an SRS review reminder notification is sent: "You have [N] vocabulary cards ready for review."
**And** tapping the notification opens the app to the vocabulary review screen

**Given** the notification delivery system
**When** sending notifications
**Then** it uses the Expo Push Notification service via expo-notifications server SDK
**And** notifications are sent only to devices with valid, registered push tokens
**And** failed deliveries (invalid tokens) trigger token cleanup from device_tokens

**Given** a user who has disabled streak_alerts in preferences
**When** the streak notification would fire
**Then** no notification is sent for that user

**Given** a user who has disabled srs_reminders in preferences
**When** the SRS notification would fire
**Then** no notification is sent for that user

**Given** the notification scheduling
**When** implemented
**Then** it uses pg_cron in Supabase to run periodic checks (e.g., every hour) for users meeting notification criteria
**And** notifications are batched efficiently to avoid per-user API calls

### Story 8.3: Notification Preferences UI & Client Integration

As a learner who wants control over notifications,
I want to grant notification permissions, register my device, and manage my notification preferences,
So that I receive only the reminders I want and can opt out at any time.

**Acceptance Criteria:**

**Given** a user logging in on a device for the first time
**When** authentication succeeds
**Then** the app requests push notification permission via expo-notifications
**And** if granted, the push token is registered via the notification-register Edge Function
**And** if denied, the app continues without notifications and no error is shown

**Given** a user who previously denied notification permissions
**When** they navigate to notification preferences in settings
**Then** an "Enable Notifications" option links to device settings with the message "Companion needs notification access for streak and vocabulary reminders"

**Given** an authenticated user in the settings screen
**When** they view notification preferences
**Then** they see toggles for: "Streak Reminders" (default on) and "Vocabulary Review Reminders" (default on)
**And** changes are saved immediately to the notification-register Edge Function

**Given** a user toggling a notification preference off
**When** the toggle is switched
**Then** the preference updates without a confirmation dialog (low severity, easily reversible)
**And** a success toast confirms: "Notification preference updated"

**Given** a user who logs out
**When** the session ends
**Then** the device push token is NOT deregistered (user may log back in on same device)

**Given** a user who logs in on a new device
**When** authentication succeeds
**Then** the new device token is registered alongside any existing tokens for that user
**And** old tokens from inactive devices are cleaned up when push delivery fails

**Given** the notification preferences UI
**When** visually inspected
**Then** it follows the existing settings screen styling with design.ts tokens
**And** toggles use Colors.primary for the active state
**And** the section integrates naturally within the existing settings layout

**Given** the expo-notifications dependency
**When** added to the project
**Then** package.json and package-lock.json are updated
**And** the app.json plugins array includes the expo-notifications configuration
**And** npm run type-check passes clean

## Epic 1B: Foundation Cleanup & CI Enforcement

The codebase has automated quality guardrails preventing recurring bug classes (hardcoded hex colors, missing accessibility, spinner loading states), standardized story acceptance criteria with polish requirements, and a planned component architecture for Epic 2's home screen evolution — ensuring all future epics ship clean from day one.

**Origin:** Epic 1 Retrospective (2026-03-26). Recurring bug classes appeared in 5 of 7 stories — hardcoded hex colors, ActivityIndicator spinners, missing accessibility attributes. Root cause: no automated enforcement. This epic establishes guardrails before Epic 2.

### Story 1B.1: CI Enforcement — Hex Color Check & Accessibility Lint

As a developer,
I want CI to automatically catch hardcoded hex colors and missing accessibility attributes,
So that recurring bug classes from Epic 1 are prevented from entering the codebase again.

**Acceptance Criteria:**

**Given** a PR or push to any branch
**When** the CI pipeline runs
**Then** a grep-based check scans `app/` and `src/components/` for hardcoded hex color patterns (`#[0-9a-fA-F]{3,8}`)
**And** the check fails if any new hardcoded hex values are found (excluding `design.ts` and `constants.ts`)
**And** the error message lists the file(s) and line(s) with hardcoded hex values

**Given** the CI hex color check
**When** a developer uses `Colors.*` design tokens or `skillTint()` from `@/src/lib/design`
**Then** the check passes — only raw hex literals are flagged

**Given** the existing CI pipeline (`ci.yml`)
**When** the hex color check is added
**Then** it runs as a step alongside `type-check`, `lint`, and `format:check`
**And** it does not increase CI run time by more than 10 seconds

**Given** the ESLint configuration
**When** an accessibility lint plugin is evaluated
**Then** research is conducted on `eslint-plugin-react-native-a11y` or equivalent
**And** if a suitable plugin exists, it is added to enforce `accessibilityRole` and `accessibilityLabel` on `Pressable`, `TouchableOpacity`, and `TouchableHighlight`
**And** if no suitable plugin exists, the decision is documented with rationale

**Given** the quality gates
**When** all checks pass
**Then** `npm run type-check && npm run lint && npm run format:check` continues to pass with zero errors and zero warnings

### Story 1B.2: NativeWind className Hex Conversion & Design Token Cleanup

As a developer,
I want all remaining hardcoded hex values in NativeWind className attributes converted to inline style with design tokens,
So that the design system is fully enforced and the CI hex check passes cleanly across the entire codebase.

**Acceptance Criteria:**

**Given** files flagged in Story 1.5 with hardcoded hex in `className` attributes
**When** each is converted
**Then** the hex value is replaced with an equivalent inline `style` prop using `Colors.*` from `@/src/lib/design`
**And** the visual appearance is identical before and after conversion

**Given** the entire `app/` and `src/components/` directories
**When** scanned for any remaining hardcoded hex values
**Then** zero hardcoded hex values remain (excluding `design.ts`, `constants.ts`, and any justified exceptions documented inline)

**Given** any new color not already in `design.ts`
**When** discovered during conversion
**Then** it is added as a named constant in the appropriate section of `Colors` in `design.ts`
**And** the name follows existing naming conventions (e.g., `textPrimary`, `borderLight`, `skillTint`)

**Given** all conversions
**When** completed
**Then** the CI hex color check from Story 1B.1 passes cleanly
**And** `npm run type-check && npm run lint && npm run format:check` passes with zero errors and zero warnings
**And** visual parity is verified on iOS simulator

### Story 1B.3: Story AC Template & Epic 2 Architecture Planning

As a team,
I want standardized story acceptance criteria that include polish requirements and a documented component architecture for Epic 2,
So that every future story ships with design tokens, accessibility, and skeleton loaders from day one, and Epic 2 development starts with a clear component plan.

**Acceptance Criteria:**

**Given** the story creation process
**When** a new story is created via the SM agent's `create-story`
**Then** a standardized polish checklist is included in every story's acceptance criteria:

- All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- All loading states use skeleton animations — no `ActivityIndicator` spinners
- All interactive elements have `accessibilityRole` + `accessibilityLabel`
- Non-obvious interactions have `accessibilityHint`
- Stateful elements have `accessibilityState`
- All tappable elements have minimum 44x44pt touch targets
- All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- All text uses `Typography.*` presets — no raw pixel `fontSize`
- Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

**Given** Epic 2's home screen evolution (CompanionMessage, TodayPlanItem, ErrorJourneyBar)
**When** the component architecture is planned
**Then** a document is created at `_bmad-output/planning-artifacts/epic-2-architecture.md` containing:

- Component tree showing how new components integrate into the home screen
- Decision on whether to create `src/components/home/` directory or use existing structure
- Data hook design: new `use-daily-briefing.ts` hook vs extending `use-progress.ts`
- Data flow diagram: which queries feed each component (memory retrieval, SRS due count, weakest skill, error patterns)
- Dependencies on Epic 1 verified components
- Interface definitions (props) for each new component

**Given** the daily briefing data hook design
**When** documented
**Then** the hook's responsibilities are clearly defined:

- Which Supabase queries it makes
- Which cache keys it uses
- How it composes the companion message
- How it determines today's plan items (SRS due, weakest skill, error drills)
- Error handling and loading states

**Given** all planning artifacts
**When** reviewed
**Then** the architecture is validated against the existing codebase patterns (layer boundary, state management, caching conventions)
**And** the plan is ready for direct implementation in Epic 2 stories
