# Story 1.7: Cross-Platform UX Polish & Accessibility Audit

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner using iOS or Android,
I want the app to look and feel polished with consistent design and accessibility support,
So that I can use the app comfortably regardless of device, font size preferences, or assistive technology.

## Acceptance Criteria

### A. Design Token Consistency

1. **AC-A1:** All screens and components use `Colors`, `Typography`, `Spacing`, `Radii`, `Shadows` from `@/src/lib/design` — zero hardcoded hex values or magic numbers
2. **AC-A2:** Colors, typography, spacing, and border radii are visually consistent between iOS and Android

### B. Accessibility — Interactive Elements

3. **AC-B1:** Every interactive element (buttons, cards, chips, MCQ options, links) has an appropriate `accessibilityRole` and `accessibilityLabel`
4. **AC-B2:** Non-obvious interactions have `accessibilityHint` (e.g., "Double tap to start conversation")
5. **AC-B3:** Stateful elements (MCQ options, SRS ratings, toggles) use `accessibilityState` with `{ selected, disabled, checked }` as appropriate

### C. Touch Targets

6. **AC-C1:** All tappable elements have a minimum touch target of 44x44 points (enforced via padding or `minHeight`/`minWidth`)

### D. Dynamic Type

7. **AC-D1:** With Dynamic Type set to 1.3x on iOS, no layout breakage occurs — text wraps or containers expand
8. **AC-D2:** All text containers use flexible height — no fixed-height text boxes
9. **AC-D3:** Typography presets from `design.ts` are used (they inherit system scaling) — no raw pixel font sizes

### E. WCAG Contrast

10. **AC-E1:** Body text meets 4.5:1 contrast ratio (navy on off-white = 8.2:1 already passes)
11. **AC-E2:** Large text meets 3:1 contrast ratio
12. **AC-E3:** No information is conveyed by color alone — always accompanied by text label or icon

### F. Loading States

13. **AC-F1:** All loading states show skeleton animations matching content shape — no `ActivityIndicator` spinners remain
14. **AC-F2:** If loading exceeds 2x expected duration, a subtle text message appears (e.g., "Taking longer than usual...")

### G. Error States

15. **AC-G1:** All error states show user-friendly messages (never raw error codes)
16. **AC-G2:** Every error state includes at least one action (Retry, Back, or fallback)
17. **AC-G3:** Errors are captured to Sentry with context tags via `captureError(err, "context")`

### H. Empty States

18. **AC-H1:** All empty states use contextual, encouraging language (never "No data" or "Empty")
19. **AC-H2:** Empty states for core features include a direct action to start (e.g., "Start a conversation", "Try an exercise")

## Tasks / Subtasks

### Task 1: Replace Hardcoded Hex Colors with Design Tokens (AC: A1)

The following 16 files have hardcoded hex values that must be replaced with `Colors.*` constants from `@/src/lib/design`:

- [x] 1.1 `app/(auth)/login.tsx` — replace hex colors with `Colors.*`
- [x] 1.2 `app/(auth)/signup.tsx`
- [x] 1.3 `app/(auth)/forgot-password.tsx`
- [x] 1.4 `app/(auth)/_layout.tsx`
- [x] 1.5 `app/(tabs)/conversation/index.tsx`
- [x] 1.6 `app/(tabs)/conversation/history.tsx`
- [x] 1.7 `app/(tabs)/conversation/_layout.tsx`
- [x] 1.8 `app/(tabs)/profile/index.tsx`
- [x] 1.9 `app/(tabs)/profile/settings.tsx`
- [x] 1.10 `app/(tabs)/profile/_layout.tsx`
- [x] 1.11 `app/(tabs)/home/index.tsx`
- [x] 1.12 `app/onboarding/index.tsx`
- [x] 1.13 `app/onboarding/placement-test.tsx`
- [x] 1.14 `src/components/conversation/CorrectionBubble.tsx`
- [x] 1.15 `src/components/conversation/TranscriptView.tsx`
- [x] 1.16 `src/components/conversation/AudioWaveform.tsx`

**Approach:** For each file, `grep` for `#[0-9a-fA-F]{3,8}` patterns, map each to the closest `Colors.*` constant. If no matching constant exists, add it to `design.ts` first — never hardcode inline.

### Task 2: Replace ActivityIndicator with Skeleton Animations (AC: F1)

10 files still use `ActivityIndicator` — replace each with a skeleton placeholder matching the content shape:

- [x] 2.1 `app/(auth)/login.tsx` — replace button loading spinner with disabled button + opacity
- [x] 2.2 `app/(auth)/signup.tsx` — same as login
- [x] 2.3 `app/(auth)/forgot-password.tsx` — same as login
- [x] 2.4 `app/(tabs)/practice/writing.tsx` — skeleton for exercise content area
- [x] 2.5 `app/(tabs)/practice/pronunciation.tsx` — skeleton for word list area
- [x] 2.6 `app/(tabs)/practice/dictation.tsx` — skeleton for exercise content area
- [x] 2.7 `app/(tabs)/conversation/history.tsx` — skeleton rows for conversation list
- [x] 2.8 `app/onboarding/index.tsx` — skeleton or animated transition for loading state
- [x] 2.9 `app/onboarding/placement-test.tsx` — skeleton for question card
- [x] 2.10 `app/(tabs)/profile/settings.tsx` — skeleton for settings sections

**Pattern to follow:** See existing skeleton implementations in `app/(tabs)/home/index.tsx` and `app/(tabs)/practice/listening.tsx` — use `Animated` from `react-native-reanimated` with pulsing opacity on placeholder shapes. Auth screens (login/signup/forgot-password) are an exception: button loading states should use disabled button with reduced opacity, not skeleton shapes.

### Task 3: Accessibility Labels & Roles Audit (AC: B1-B3)

- [x] 3.1 `app/onboarding/index.tsx` — add `accessibilityRole` and `accessibilityLabel` to all interactive elements (continue button, step indicators)
- [x] 3.2 `app/onboarding/placement-test.tsx` — add to MCQ options, progress indicator, next/submit buttons
- [x] 3.3 `app/index.tsx` — add to any interactive elements (splash/redirect screen)
- [x] 3.4 Audit ALL practice screens (`grammar.tsx`, `listening.tsx`, `reading.tsx`, `writing.tsx`, `dictation.tsx`, `pronunciation.tsx`, `vocabulary.tsx`) — verify every button, card, and interactive element has `accessibilityRole` + `accessibilityLabel`
- [x] 3.5 Audit conversation screens (`index.tsx`, `[sessionId].tsx`, `history.tsx`) — verify topic cards, mic button, end button, history items
- [x] 3.6 Audit mock-test screens (`index.tsx`, `[testId].tsx`, `results.tsx`) — verify start button, MCQ options (`accessibilityRole="radio"`), submit button, navigation buttons
- [x] 3.7 Audit profile screens (`index.tsx`, `settings.tsx`) — verify all tappable items, toggles, links
- [x] 3.8 Audit home screen (`index.tsx`) — verify skill cards, streak card, weekly activity, any tappable elements
- [x] 3.9 Add `accessibilityHint` on non-obvious interactions:
  - Topic cards: "Double tap to start a conversation on this topic"
  - Skill cards on home: "Double tap to practice this skill"
  - Error pattern items: "Double tap to start a micro-drill on this error"
  - Vocabulary items: "Double tap to review this word"
- [x] 3.10 Add `accessibilityState` on stateful elements:
  - MCQ options: `{ selected: isSelected }` (verify already done per UX spec)
  - SRS rating buttons: `{ selected: selectedRating === rating }`
  - Mock test answers: `{ selected: selectedAnswer === option }`

### Task 4: Touch Target Enforcement (AC: C1)

- [x] 4.1 Audit all tappable elements — verify minimum 44x44pt touch area
- [x] 4.2 Fix any undersized targets by adding padding, `minHeight: 44`, or wrapping in a `Pressable` with hit slop
- [x] 4.3 Pay special attention to: small icon buttons (back arrows, close icons), chip/tag elements, link text, bottom tab bar items

### Task 5: Dynamic Type Resilience (AC: D1-D3)

- [x] 5.1 Verify all text uses `Typography.*` presets or `className` text utilities (not raw pixel `fontSize`)
- [x] 5.2 Check for fixed-height containers wrapping text — replace with `minHeight` or remove height constraint
- [x] 5.3 Verify stat rows on home screen handle font scaling (should stack vertically if width exceeded)
- [x] 5.4 Test on iOS simulator with Settings > Accessibility > Display & Text Size > Larger Text at 1.3x — fix any layout breakage

### Task 6: Error & Empty State Polish (AC: G1-G3, H1-H2)

- [x] 6.1 Audit all screens for error handling — verify user-friendly messages, never raw error codes or generic "Error"
- [x] 6.2 Verify all error states include Retry/Back action
- [x] 6.3 Verify all `catch` blocks call `captureError(err, "screen-context")` from `@/src/lib/sentry`
- [x] 6.4 Audit empty states — verify encouraging language and direct action CTAs
- [x] 6.5 Screens to check: home (no skills, no activity), conversation history (no conversations), vocabulary (no words), practice screens (no exercises generated), mock-test (no tests taken), profile errors (no patterns)

### Task 7: WCAG Contrast Verification (AC: E1-E3)

- [x] 7.1 Verify all text color combinations against `design.ts` values meet WCAG AA ratios (most already pass per UX spec)
- [x] 7.2 Check secondary/tertiary text colors (`Colors.textSecondary`, `Colors.textTertiary`) on surface backgrounds
- [x] 7.3 Verify no information is conveyed by color alone — corrections have category text, scores have labels, pronunciation has error type text
- [x] 7.4 If any new color constant was added in Task 1, verify its contrast ratio

### Task 8: Quality Gates (AC: all)

- [x] 8.1 Run `npm run type-check` — zero errors
- [x] 8.2 Run `npm run lint` — zero warnings
- [x] 8.3 Run `npm run format:check` — all files pass (run `npm run format` to auto-fix first)

## Dev Notes

### This is a polish/audit story, NOT a feature story

You are auditing and fixing existing screens. Do NOT:
- Add new features or screens
- Refactor working logic
- Change component APIs or hook interfaces
- Reorganize file structure

DO:
- Replace hardcoded values with design tokens
- Add/fix accessibility attributes
- Replace spinners with skeletons
- Fix contrast issues
- Improve error/empty state text

### Existing Design Token System

All tokens live in `@/src/lib/design`:

```typescript
import { Colors, Typography, Spacing, Radii, Shadows, Presets, skillTint } from '@/src/lib/design';
```

- `Colors.primary` (#1E3A5F), `Colors.accent` (#F5A623), `Colors.surface` (#F5F5F0)
- `Colors.success` (#34C759), `Colors.error` (#FF3B30)
- `Colors.textPrimary`, `Colors.textSecondary`, `Colors.textTertiary`, `Colors.textOnDark`
- `Colors.bgDark`, `Colors.bgDarkCard`
- `Colors.border`, `Colors.borderLight`
- `Colors.skillListening`, `Colors.skillReading`, `Colors.skillWriting`, `Colors.skillGrammar`, `Colors.skillSpeaking`
- `Typography.screenTitle`, `.sectionHeader`, `.cardTitle`, `.body`, `.bodySecondary`, `.caption`, `.label`, `.bigNumber`, `.statNumber`
- `Spacing.screenPadding` (20), `.screenPaddingLarge` (24), `.sectionGap` (16), `.cardPadding` (16)
- `Radii.card` (16), `.button` (12), `.chip` (8), `.heroBottom` (28)
- `Shadows.card`, `.hero`, `.subtle`

Domain constants (`LEVEL_COLORS`, `SKILL_LABELS`, `CONVERSATION_TOPICS`) live in `@/src/lib/constants`.

### Skeleton Animation Pattern

Follow the existing pattern used across the app. Example from home screen:

```typescript
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// Pulsing skeleton
const opacity = useSharedValue(0.3);
useEffect(() => {
  opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
}, []);
const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

// Skeleton placeholder
<Animated.View style={[animStyle, { height: 80, borderRadius: Radii.card, backgroundColor: Colors.border }]} />
```

For auth screen buttons: do NOT use skeleton — use disabled button state with `opacity: 0.6` while loading.

### Accessibility Pattern

```typescript
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Start grammar exercise"
  accessibilityHint="Double tap to generate a new grammar exercise"
  accessibilityState={{ disabled: isLoading }}
  style={{ minHeight: 44, minWidth: 44 }}
>
```

For MCQ options: `accessibilityRole="radio"`, `accessibilityState={{ selected: isSelected, disabled: isSubmitted }}`
For links: `accessibilityRole="link"`
For text content: `accessibilityRole="text"` or `accessibilityRole="header"` for section titles

### WCAG Contrast Ratios (Pre-Verified)

| Combination | Ratio | Passes |
|---|---|---|
| Navy (#1E3A5F) on off-white (#F5F5F0) | 8.2:1 | AAA |
| White on navy | 8.2:1 | AAA |
| Amber (#F5A623) on navy | 4.8:1 | AA large text |
| Success green on white | 4.6:1 | AA |
| Error red on white | 4.5:1 | AA |

If `Colors.textTertiary` (typically a gray) is used on `Colors.surface`, verify it meets 4.5:1. If not, darken it in `design.ts`.

### Files Already Using Design Tokens Correctly (Skip or Light Audit)

Many screens were updated in the "Design System Consistency Pass" (see MEMORY.md). However, the codebase scan found regressions or missed files — the 16 files listed in Task 1 still have hardcoded hex values.

### Common Bug Patterns from Story 1-6 (Watch For)

1. **Hardcoded `#ffffff` / `#000000` / `#333333`** — These commonly slip through. Map to `Colors.textOnDark`, `Colors.textPrimary`, `Colors.textSecondary` respectively
2. **`backgroundColor: 'transparent'`** — This is fine, not a hex color issue
3. **`rgba()` with hardcoded hex** — Replace the hex portion with `skillTint(Colors.X, opacity)` or add a new tinted constant
4. **Missing `captureError` in catch blocks** — Import from `@/src/lib/sentry` and add context string
5. **Empty state text says "No X found"** — Rewrite to encouraging language: "You haven't [action] yet. [CTA to start]"

### Project Structure Notes

- Screens: `app/` directory — file-based routing with Expo Router
- Components: `src/components/{feature}/` — never root `components/`
- Design tokens: `src/lib/design.ts`
- Error capture: `src/lib/sentry.ts` → `captureError(err, contextTag)`
- Haptics: `src/lib/haptics.ts` → `hapticLight()`, `hapticMedium()`, `hapticSuccess()`, `hapticError()`
- No test files — quality via `type-check` + `lint` + `format:check`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.7 acceptance criteria, lines 652-699]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Accessibility Strategy, lines 1521-1619]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Dynamic Type & Font Scaling, lines 1501-1519]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Contrast Compliance, lines 660-679]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR16-20 Accessibility, Design System Consistency]
- [Source: _bmad-output/project-context.md — Styling rules, Accessibility rules, Critical Don't-Miss Rules]
- [Source: _bmad-output/implementation-artifacts/1-6-edge-function-deployment-security-verification.md — Previous story learnings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- ✅ Task 1: Replaced all hardcoded hex colors across 20 files (16 listed + 4 privacy/terms) with `Colors.*` constants. Added `accentLight`, `warning`, `accentText` tokens to `design.ts`. Also added `correctionOriginal`, `correctionPronunciation`, `correctionPronunciationText` for CorrectionBubble component.
- ✅ Task 2: Replaced all `ActivityIndicator` spinners (10 files). Auth screens use disabled button + opacity:0.6. Practice/history screens use `SkeletonBar` component. Onboarding uses contextual loading text.
- ✅ Task 3: Full accessibility audit across all 25+ screens. Added `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, `accessibilityState` to all interactive elements. MCQ options use `radio` role with `selected`/`disabled` state. Section headers use `header` role. Progress bars use `progressbar` with `accessibilityValue`.
- ✅ Task 4: Touch target enforcement — fixed undersized targets in 9 files. Added `minHeight: 44`/`minWidth: 44` to chips, links, icon buttons. Added `hitSlop` to navigation dots and progress bars.
- ✅ Task 5: Dynamic type resilience — replaced raw `fontSize` with `Typography.*` presets in 7 files. Fixed 2 `height:` → `minHeight:` on text-wrapping containers. Verified home screen stats handle font scaling.
- ✅ Task 6: Error/empty state polish — sanitized error messages in 4 hooks to prevent raw error codes reaching UI. Added Retry buttons to 3 screens missing them. Improved empty state language in conversation history and vocabulary. Added "Start a Conversation" CTA to empty vocabulary.
- ✅ Task 7: WCAG contrast — darkened `textSecondary` (#6B7C93→#5A6B82, 5.0:1), `textTertiary` (#94A3B8→#637085, 4.6:1), `warning` (#FF9500→#9A6400, 4.6:1). Added `accentText` (#8B6914, 4.7:1) for amber text on light backgrounds. Replaced `text-accent` with `accentText` on 10 light-background screens. Verified no color-only information across corrections, MCQ, pronunciation, and placement test.
- ✅ Task 8: Quality gates — `type-check` (0 errors), `lint` (0 warnings), `format:check` (all pass). Fixed 6 import order warnings.

### Change Log

- 2026-03-26: Story 1-7 implementation complete — Cross-Platform UX Polish & Accessibility Audit

### File List

- `src/lib/design.ts` — added `accentLight`, `warning`, `accentText`, `correctionOriginal`, `correctionPronunciation`, `correctionPronunciationText` tokens; darkened `textSecondary`, `textTertiary`, `gray500`, `gray600` for WCAG AA compliance
- `app/(auth)/login.tsx` — hex colors → design tokens, ActivityIndicator → disabled button, touch targets, accessibility
- `app/(auth)/signup.tsx` — hex colors → design tokens, ActivityIndicator → disabled button, touch targets, accessibility
- `app/(auth)/forgot-password.tsx` — hex colors → design tokens, ActivityIndicator → disabled button, accessibility
- `app/(auth)/_layout.tsx` — hex colors → design tokens
- `app/(auth)/privacy-policy.tsx` — hex colors → design tokens
- `app/(auth)/terms.tsx` — hex colors → design tokens
- `app/(tabs)/conversation/index.tsx` — hex colors → design tokens, touch targets, accessibility hints
- `app/(tabs)/conversation/[sessionId].tsx` — touch targets, accessibility hints
- `app/(tabs)/conversation/history.tsx` — hex colors → design tokens, ActivityIndicator → skeleton, touch targets, accessibility, dynamic type, empty state
- `app/(tabs)/conversation/_layout.tsx` — hex colors → design tokens
- `app/(tabs)/home/index.tsx` — hex colors → design tokens, accessibility headers/labels, accentText contrast
- `app/(tabs)/mock-test/index.tsx` — accessibility headers
- `app/(tabs)/mock-test/[testId].tsx` — touch targets, accessibility
- `app/(tabs)/mock-test/results.tsx` — accessibility labels, accentText contrast
- `app/(tabs)/practice/grammar.tsx` — touch targets (hitSlop on dots), accessibility, Typography preset, accentText
- `app/(tabs)/practice/listening.tsx` — touch targets, accessibility, Typography preset
- `app/(tabs)/practice/reading.tsx` — accessibility, Typography preset
- `app/(tabs)/practice/writing.tsx` — ActivityIndicator → skeleton, accessibility, Typography preset, accentText
- `app/(tabs)/practice/dictation.tsx` — ActivityIndicator → skeleton, accessibility, Typography preset, error messages, accentText
- `app/(tabs)/practice/pronunciation.tsx` — ActivityIndicator → skeleton, accessibility, Typography preset, error messages, accentText
- `app/(tabs)/practice/vocabulary.tsx` — accessibility, empty state CTA, accentText
- `app/(tabs)/profile/index.tsx` — hex colors → design tokens, accessibility, accentText
- `app/(tabs)/profile/settings.tsx` — hex colors → design tokens, ActivityIndicator → disabled button, touch targets, accessibility, accentText
- `app/(tabs)/profile/_layout.tsx` — hex colors → design tokens
- `app/(tabs)/profile/privacy-policy.tsx` — hex colors → design tokens
- `app/(tabs)/profile/terms.tsx` — hex colors → design tokens
- `app/onboarding/index.tsx` — hex colors → design tokens, ActivityIndicator → disabled button, accessibility (step indicators, level/goal/daily selections)
- `app/onboarding/placement-test.tsx` — hex colors → design tokens, ActivityIndicator → skeleton, accessibility, error state improvements, accentText
- `src/components/conversation/CorrectionBubble.tsx` — hex colors → design tokens
- `src/components/conversation/TranscriptView.tsx` — hex colors → design tokens
- `src/components/conversation/AudioWaveform.tsx` — hex colors → design tokens, import order fix
- `src/components/profile/cefr-progression-chart.tsx` — Typography presets
- `src/hooks/use-exercise.ts` — sanitized error messages
- `src/hooks/use-dictation.ts` — sanitized error messages
- `src/hooks/use-pronunciation.ts` — sanitized error messages
- `src/hooks/use-progress.ts` — sanitized error messages
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated
- `_bmad-output/implementation-artifacts/1-7-cross-platform-ux-polish-accessibility-audit.md` — story file updated
