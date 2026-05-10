# Story 4.3: Narrative Feedback Screen Integration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner finishing a conversation,
I want the feedback debrief to feel like a satisfying ritual with personalized narrative,
So that I leave every session with clarity on what went well and what to work on.

## Acceptance Criteria

### A. Personalized Header

1. **AC-A1:** Given a user ending a conversation, when the feedback sheet slides up, then the header displays "Great Session, [Name]!" using `profile.first_name` (from `useAuthStore`) -- never generic "Bilan de conversation" or "Session Complete".

### B. Layout Reorder

2. **AC-B1:** Given the feedback screen layout, when all components are present, then the order is: personalized header -> MilestoneBanner (if earned) -> fluency/grammar ratings as bar charts -> SessionComparison (if applicable) -> "What We Noticed" observations -> ErrorJourneyBar -> contextual next action button.

### C. "What We Noticed" Observations

3. **AC-C1:** Given the strengths and improvements from AI feedback, when displayed on the feedback screen, then they are reframed as companion-voiced "What We Noticed" observations (e.g., "Passe compose used correctly 4 times -- strong!" instead of "Strengths: passe compose").

4. **AC-C2:** Given resolved error patterns in this session, when "What We Noticed" renders, then resolved patterns are celebrated: "You used to struggle with [pattern]. Not anymore!"

### D. ErrorJourneyBar Integration

5. **AC-D1:** Given the user has active error patterns, when the feedback screen loads, then an ErrorJourneyBar (reused from `src/components/home/ErrorJourneyBar.tsx`) displays showing "[resolved] of [total] patterns resolved ([percentage]%)".

6. **AC-D2:** Given the user has zero error patterns, when the feedback screen loads, then the ErrorJourneyBar is not rendered (it returns `null` when `total === 0`).

### E. Contextual Next Action Button

7. **AC-E1:** Given the feedback screen with today's weaknesses identified, when the contextual next action renders, then a specific button appears based on the session's errors (e.g., "Practice Pronunciation" linking to pronunciation screen, "Review Grammar" linking to grammar screen with error context).

8. **AC-E2:** Given no specific errors were found in the session, when the contextual next action renders, then a "Continue Practicing" button appears linking to the practice tab.

9. **AC-E3:** The contextual next action button replaces the current generic "Termine" close button. A secondary "Close" text link remains below the action button for dismissing the sheet.

### F. Personal Best Callout on Ratings

10. **AC-F1:** Given a user achieving their best grammar or fluency rating in this session (milestone type `personal_best`), when the ratings section renders, then a subtle callout appears below the relevant rating: "Your best [fluency/grammar] score!" in `Colors.success`.

### G. Visual Consistency

11. **AC-G1:** Given the narrative feedback screen, when visually inspected, then the layout uses `design.ts` tokens throughout, the emotional tone is reflective satisfaction (not clinical grading), and the sheet feels like a natural conclusion to the conversation.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` -- no hardcoded hex
- [x] All loading states use skeleton animations -- no `ActivityIndicator` spinners
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [x] Non-obvious interactions have `accessibilityHint`
- [x] Stateful elements have `accessibilityState`
- [x] All tappable elements have minimum 44x44pt touch targets
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [x] All text uses `Typography.*` presets -- no raw pixel `fontSize`
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Personalize the feedback header (AC: A1)
  - [x] 1.1 Replace the static `"Bilan de conversation"` title (line 748 of `[sessionId].tsx`) with `"Great Session, ${profile?.first_name ?? 'Learner'}!"`
  - [x] 1.2 Replace subtitle with a warm one-liner: `"{duration} • {messageCount} exchanges"` (keep same data, change "messages" to "exchanges")

- [x] Task 2: Reorder feedback sheet layout (AC: B1)
  - [x] 2.1 Restructure the `<ScrollView>` content inside the feedback bottom sheet (lines 770-864) to match the new order:
    1. MilestoneBanner (already present, keep at top of ScrollView)
    2. Fluency/Grammar ratings (extract from AI feedback card, render as standalone bar charts)
    3. SessionComparison (already present)
    4. "What We Noticed" section (new -- replaces old Strengths/Improvements)
    5. ErrorJourneyBar (new)
    6. Contextual next action button (new -- replaces "Termine")
    7. Secondary "Close" text link
  - [x] 2.2 Keep the stat tiles (Your turns / Corrections) and AI feedback summary text ABOVE the ScrollView between the header and the reordered content
  - [x] 2.3 Remove the `conversation.feedback.summary` text from the old card and move it to render as standalone text directly after stat tiles, before the ScrollView ratings

- [x] Task 3: Transform ratings into bar charts (AC: B1, F1)
  - [x] 3.1 Create an inline `RatingBar` component (inside `[sessionId].tsx`, not a separate file) that renders: label, numeric value "N/5", and a horizontal bar filled proportionally (width = `rating/5 * 100%`)
  - [x] 3.2 Fluency bar uses `Colors.success` fill, Grammar bar uses `Colors.accent` fill -- matching current color coding
  - [x] 3.3 Bar track: `Colors.whiteAlpha08` background, 8px height, `Radii.chip` (8px) radius
  - [x] 3.4 Bar fill: animated width using `react-native-reanimated` `withTiming`
  - [x] 3.5 If this session is a personal best for fluency or grammar (detected via `milestone?.type === 'personal_best'` and checking `milestone.subtitle`), render a `Colors.success` callout text "Your best [metric] score!" below the relevant bar
  - [x] 3.6 Vocabulary count remains as a standalone number below the bars (current styling fine)

- [x] Task 4: Create "What We Noticed" section (AC: C1, C2)
  - [x] 4.1 Replace the current "Strengths" / "Areas to improve" sections (lines 800-819) with a unified "What We Noticed" section
  - [x] 4.2 Title: "What We Noticed" using `Typography.label` weight 700, `Colors.textOnDark`
  - [x] 4.3 Render `conversation.feedback.strengths` items as companion-voiced bullet points prefixed with a check mark icon. Keep original text -- the AI prompt already generates them in observation form. Styled with `Colors.success` bullet, `Colors.whiteAlpha85` text
  - [x] 4.4 Render `conversation.feedback.improvements` items with a right-arrow icon prefix. Styled with `Colors.accent` bullet, `Colors.whiteAlpha85` text
  - [x] 4.5 If the milestone is `error_resolved`, prepend a celebration line: "You used to struggle with [milestone.subtitle]. Not anymore!" in `Colors.success`
  - [x] 4.6 Container: `Colors.whiteAlpha07` background, `Radii.card` (16px) radius, 16px padding

- [x] Task 5: Integrate ErrorJourneyBar (AC: D1, D2)
  - [x] 5.1 Import `ErrorJourneyBar` from `@/src/components/home/ErrorJourneyBar`
  - [x] 5.2 Add state: `const [errorJourney, setErrorJourney] = useState<{ total: number; resolved: number } | null>(null)`
  - [x] 5.3 In the existing milestone detection `useEffect` (or a new parallel `useEffect` watching `conversation.feedback`), query error pattern counts: `supabase.from("error_patterns").select("resolved", { count: "exact" }).eq("user_id", user.id)` to get total count, and filter `resolved = true` for resolved count
  - [x] 5.4 Render `<ErrorJourneyBar total={errorJourney.total} resolved={errorJourney.resolved} />` after "What We Noticed", before the action button
  - [x] 5.5 Only render when `errorJourney` is not null and `errorJourney.total > 0` (component also handles `total === 0` by returning null, but skip rendering entirely)
  - [x] 5.6 Wrap in a `<View className="mb-3">` for spacing consistency
  - [x] 5.7 **Dark mode adaptation:** ErrorJourneyBar uses `skillTint(Colors.primary, 0.04)` which renders a navy-tinted background. On the dark feedback sheet (`Colors.bgDarkCard`), override the background to `Colors.whiteAlpha07` to match other feedback sheet cards. Pass a `style` override or wrap in a View with the correct background.

- [x] Task 6: Add contextual next action button (AC: E1, E2, E3)
  - [x] 6.1 Add state: `const [nextAction, setNextAction] = useState<{ label: string; route: string; params?: Record<string, string> } | null>(null)`
  - [x] 6.2 Derive the next action from `conversation.feedback.improvements` and `conversation.allCorrections`:
    - If corrections mention pronunciation/accent errors → `{ label: "Practice Pronunciation", route: "/(tabs)/practice/pronunciation" }`
    - If corrections mention grammar errors → `{ label: "Review Grammar", route: "/(tabs)/practice/grammar", params: { errorType: firstGrammarError } }`
    - If corrections mention vocabulary errors → `{ label: "Review Vocabulary", route: "/(tabs)/practice/vocabulary" }`
    - Fallback: `{ label: "Continue Practicing", route: "/(tabs)/practice" }`
  - [x] 6.3 Render the action button: `bg-accent` background, `Radii.button` (12px) radius, 52px height, bold white text, full width
  - [x] 6.4 On press: `router.push(nextAction.route)` with params if present
  - [x] 6.5 Below the action button, render a "Close" text link: `Colors.whiteAlpha65` text, centered, `mt-3`, onPress closes feedback and calls `router.back()`
  - [x] 6.6 Remove the old "Termine" `<TouchableOpacity>` button (lines 852-863)
  - [x] 6.7 Add accessibility: `accessibilityRole="button"`, `accessibilityLabel={nextAction.label}`, `accessibilityHint="Double tap to navigate to practice"`

- [x] Task 7: Quality gates (AC: Z)
  - [x] 7.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 7.2 Run `scripts/check-hex-colors.sh` -- verify no raw hex values
  - [x] 7.3 Verify personalized header shows user's name
  - [x] 7.4 Verify layout order matches spec: header → milestone → ratings → comparison → observations → error journey → action
  - [x] 7.5 Verify ErrorJourneyBar renders with error pattern data
  - [x] 7.6 Verify contextual action button navigates correctly
  - [x] 7.7 Verify "Close" text link dismisses feedback sheet

## Dev Notes

### This is Primarily a Refactor of the Existing Feedback Sheet

The feedback bottom sheet already exists in `[sessionId].tsx` (lines 730-867). This story reorganizes, reskins, and adds new sections -- but does NOT change the milestone detection, session comparison, or voice conversation logic. Those hooks and effects from stories 4-1 and 4-2 stay untouched.

### Current Feedback Sheet Structure (lines 730-867)

```
730: Overlay container
736: Sheet container (bgDarkCard, borderTopRadius 28)
746: Drag handle
748: Title "Bilan de conversation"  ← CHANGE to personalized
749: Subtitle (duration + message count)
755: Stat tiles (Your turns / Corrections)
770: ScrollView
772:   AI Feedback card (summary + ratings + strengths + improvements)  ← SPLIT UP
822:   MilestoneBanner  ← MOVE to top of ScrollView
829:   SessionComparison  ← KEEP position (after ratings)
835:   CorrectionBubble or "Impeccable!" message  ← KEEP but move after observations
852:   "Terminé" close button  ← REPLACE with contextual action + close link
```

### Target Layout

```
Header: "Great Session, [Name]!" + subtitle
Stat tiles: Your turns / Corrections
Summary text (from AI feedback)
─── ScrollView ───
  MilestoneBanner (if earned)
  Rating bars (fluency + grammar + vocabulary count)
  SessionComparison (if applicable)
  "What We Noticed" card (strengths + improvements reframed)
  CorrectionBubble or "Impeccable!"
  ErrorJourneyBar (if error patterns exist)
  Contextual action button
  "Close" text link
───────────────────
```

### ErrorJourneyBar Dark Mode Concern

`ErrorJourneyBar` in `src/components/home/ErrorJourneyBar.tsx` uses `skillTint(Colors.primary, 0.04)` as its background, which produces a light navy tint designed for the light home screen. On the dark feedback sheet (`Colors.bgDarkCard`), this would look wrong.

**Solution:** Wrap `ErrorJourneyBar` in a `<View>` with `style={{ backgroundColor: Colors.whiteAlpha07, borderRadius: Radii.card, overflow: 'hidden' }}`. The component's internal background will be overridden by the wrapper since the wrapper clips content. Alternatively, if the component's background shows through, pass a `style` prop override -- check if `ErrorJourneyBar` accepts a `style` prop. Looking at the component code: it does NOT accept a `style` prop. So use the wrapper approach, ensuring `overflow: 'hidden'` clips the internal background.

**Better approach:** The `ErrorJourneyBar` component's outermost `<View>` has a `style` prop with inline background. Since we cannot override it via prop, wrap it and use the wrapper's background. The wrapper's `overflow: 'hidden'` with matching `borderRadius` ensures the internal background is clipped. But actually, the inner component's background will still be visible because `overflow: 'hidden'` only clips children that extend beyond bounds. The best approach: add an optional `containerStyle` prop to `ErrorJourneyBar` so the feedback sheet can override the background color. This is a minimal, non-breaking change (one line in props interface, one spread in the style).

### Contextual Action Derivation Logic

The action button should be derived from `conversation.allCorrections` and `conversation.feedback.improvements`. Check corrections for categories:

1. Look at `conversation.allCorrections` -- each correction has properties. Check if any correction text mentions pronunciation-related words (accent, prononciation)
2. Check `conversation.feedback.improvements` array for keywords: "grammar" → grammar screen, "vocabulary" → vocabulary screen, "pronunciation/accent" → pronunciation screen
3. Simple keyword matching is sufficient -- this is a UX hint, not a routing engine

### Profile `first_name` Access

The `profile` object from `useAuthStore` includes `first_name` (from the `profiles` table). It's already referenced at line 92: `const profile = useAuthStore((s) => s.profile)`. Use `profile?.first_name` with fallback `"Learner"`.

Verify the field name -- check `src/types/` for the profile type:

- The profile type should have `first_name: string` from the `profiles` table schema
- If `first_name` doesn't exist, check for `display_name` or `full_name` and extract the first word

### Files to Modify (2 files)

| File                                      | Change                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/(tabs)/conversation/[sessionId].tsx` | Personalized header, layout reorder, rating bars, "What We Noticed", ErrorJourneyBar, contextual action button |
| `src/components/home/ErrorJourneyBar.tsx` | Add optional `containerStyle` prop for dark mode background override                                           |

### Files NOT to Modify

- `src/components/feedback/SessionComparison.tsx` -- leave as-is
- `src/components/feedback/MilestoneBanner.tsx` -- leave as-is
- `src/hooks/use-realtime-voice.ts` -- leave as-is
- `src/lib/activity.ts` -- leave as-is
- `src/lib/error-tracker.ts` -- leave as-is
- Database schema / migrations -- no changes needed

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function/Module                                    | Import Path                                      | Usage                                               |
| -------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `Colors`, `Typography`, `Radii`, `skillTint`       | `@/src/lib/design`                               | All design tokens                                   |
| `hapticSuccess`, `hapticLight`                     | `@/src/lib/haptics`                              | Haptic on action button press                       |
| `captureError`                                     | `@/src/lib/sentry`                               | Error reporting in catch blocks                     |
| `supabase`                                         | `@/src/lib/supabase`                             | Database queries (already imported)                 |
| `useAuthStore`                                     | `@/src/store/auth-store`                         | Profile + user (already imported)                   |
| `ErrorJourneyBar`                                  | `@/src/components/home/ErrorJourneyBar`          | Reuse existing component                            |
| `SessionComparison`                                | `@/src/components/feedback/SessionComparison`    | Already imported                                    |
| `MilestoneBanner`                                  | `@/src/components/feedback/MilestoneBanner`      | Already imported                                    |
| `CorrectionBubble`                                 | `@/src/components/conversation/CorrectionBubble` | Already imported                                    |
| `useSharedValue`, `useAnimatedStyle`, `withTiming` | `react-native-reanimated`                        | Rating bar animation (already imported)             |
| `router`                                           | `expo-router`                                    | Navigation for contextual action (already imported) |

### Anti-Patterns to Avoid

- Do NOT create separate component files for the rating bars or "What We Noticed" section -- they are specific to this feedback sheet. Inline them in `[sessionId].tsx`.
- Do NOT modify the milestone detection or session comparison `useEffect` logic -- those work correctly from stories 4-1 and 4-2.
- Do NOT move the feedback sheet to a separate screen file -- it's intentionally inline as a bottom sheet overlay.
- Do NOT add new database tables or columns -- all data exists.
- Do NOT duplicate ErrorJourneyBar -- import and reuse the existing one from `src/components/home/`.
- Do NOT use `ActivityIndicator` while loading error journey data -- just don't render until data is ready.
- Do NOT hardcode hex colors or raw fontSize -- use `Colors.*` and `Typography.*`.
- Do NOT change the corrections rendering (`CorrectionBubble`) -- keep as-is, just reposition in layout.
- Do NOT make the contextual action button navigation too complex -- simple keyword matching on improvements array is sufficient.

### Previous Story Intelligence (from Stories 4-1 and 4-2)

- Branch naming: `feature/4-3-narrative-feedback-screen-integration`
- Commit prefix: `feat(story-4-3):` for feature work, `chore:` for status updates
- ESLint import order enforced: react -> react-native -> expo -> external -> @/ internal
- Hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/`
- `conversationId` is exposed by `useRealtimeVoice()` hook (added in story 4-1)
- `comparisonMetrics` state + `useEffect` pattern in `[sessionId].tsx` is the established data fetch pattern
- `milestone` state + detection `useEffect` in `[sessionId].tsx` is the established milestone detection pattern
- Use `== null` checks (not `!value`) for numeric fields that could be 0 (code review finding from story 4-1)
- `ErrorJourneyBar` is in `src/components/home/` (not `src/components/common/` as UX spec originally suggested)

### Project Structure Notes

- All changes are in existing files -- no new files created
- `ErrorJourneyBar` is imported from `src/components/home/` where it was built in Epic 2
- Path alias `@/*` maps to repo root
- Feedback sheet stays as inline overlay in `[sessionId].tsx`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3 -- BDD acceptance criteria (lines 1031-1067)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Post-Conversation Narrative Feedback -- screen layout order (lines 1324-1335)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Post-Conversation Feedback: Narrative Progress Story -- design rationale (lines 717-725)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#ErrorJourneyBar -- component anatomy, props, styling (lines 1082-1116)]
- [Source: app/(tabs)/conversation/[sessionId].tsx -- feedback bottom sheet (lines 730-867), existing milestone/comparison effects (lines 155-334)]
- [Source: src/components/home/ErrorJourneyBar.tsx -- existing component with total/resolved props, returns null for total===0]
- [Source: _bmad-output/implementation-artifacts/4-2-milestonebanner-component-personal-best-detection.md -- milestone detection patterns, layout positioning]
- [Source: _bmad-output/implementation-artifacts/4-1-sessioncomparison-component-previous-session-data.md -- session comparison patterns, code review fixes]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Profile type uses `full_name` not `first_name` — extracted first word with `.split(" ")[0]`
- `Colors.whiteAlpha07` and `Colors.whiteAlpha65` did not exist — added to design.ts
- `ErrorJourneyBar` did not accept a `style` prop — added `containerStyle` prop for dark mode background override

### Completion Notes List

- **Task 1:** Personalized header — replaced "Bilan de conversation" with "Great Session, {firstName}!" using `profile.full_name` split to first name. Changed "messages" to "exchanges" in subtitle. Used Typography tokens.
- **Task 2:** Layout reorder — restructured ScrollView content: MilestoneBanner → Rating bars → SessionComparison → "What We Noticed" → CorrectionBubble → ErrorJourneyBar → Contextual action button → Close link. Moved summary text above ScrollView.
- **Task 3:** Rating bars — created inline `RatingBar` component with animated fill using `react-native-reanimated` `withTiming`. Fluency uses `Colors.success`, Grammar uses `Colors.accent`. 8px height, `Radii.chip` radius. Personal best callout shown when milestone matches.
- **Task 4:** "What We Noticed" — unified strengths/improvements section with companion-voiced observations. Check mark icon for strengths (green), arrow for improvements (amber). Error resolution celebration line when milestone type is `error_resolved`.
- **Task 5:** ErrorJourneyBar integration — added `containerStyle` prop to ErrorJourneyBar component. Queries error_patterns table for total/resolved counts. Renders with dark mode background override (`Colors.whiteAlpha07`). Hidden when no error patterns exist.
- **Task 6:** Contextual next action button — derives action from improvements + corrections text (pronunciation → pronunciation screen, grammar → grammar screen, vocabulary → vocabulary screen, fallback → practice tab). Accent background, 52px height, full width. Secondary "Close" text link below. Removed old "Terminé" button.
- **Task 7:** All quality gates pass — `npm run type-check`, `npm run lint`, `npm run format:check`, `scripts/check-hex-colors.sh` all clean.

### Change Log

- 2026-03-27: Implemented narrative feedback screen integration (Tasks 1-7)

### File List

- `app/(tabs)/conversation/[sessionId].tsx` — personalized header, layout reorder, RatingBar component, "What We Noticed" section, ErrorJourneyBar integration, contextual action button, close link
- `src/components/home/ErrorJourneyBar.tsx` — added optional `containerStyle` prop for dark mode background override
- `src/lib/design.ts` — added `Colors.whiteAlpha07` and `Colors.whiteAlpha65` tokens
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated to review
