# Story 2.3: Error Journey Progress Bar & Home Screen Integration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner tracking my improvement,
I want to see how many error patterns I've resolved on my home screen,
So that I have tangible proof of mastery and motivation to keep practicing.

## Acceptance Criteria

### A. ErrorJourneyBar Component

1. **AC-A1:** An `ErrorJourneyBar` component exists at `src/components/home/ErrorJourneyBar.tsx` displaying:
   - A label: "{resolved}/{total} errors resolved" using `Typography.caption` style, fontWeight 600, `Colors.primary`
   - A percentage text: "{percentage}%" using `Typography.caption` style, fontWeight 700, `Colors.success`
   - A proportional fill bar: 6px height, full-width track, animated fill width

2. **AC-A2:** The component container uses:
   - Background: `skillTint(Colors.primary, 0.04)`
   - Border radius: `Radii.button` (12)
   - Padding: `8px` vertical, `10px` horizontal

3. **AC-A3:** The progress bar track uses:
   - Background: `skillTint(Colors.primary, 0.08)`
   - Height: 6px, full-width
   - Border radius: 3px (half of height)

4. **AC-A4:** The progress bar fill uses:
   - Color: `Colors.success`
   - Width: animated proportionally (`resolved / total * 100%`) using `react-native-reanimated` `withTiming`
   - Border radius: 3px

5. **AC-A5:** When `total === 0`, the component returns `null` (not rendered)

6. **AC-A6:** When `resolved === total` (all resolved), the bar is fully filled green and the label text changes to "All patterns resolved!" in `Colors.success`

7. **AC-A7:** When the `resolved` count changes, the fill bar width animates smoothly to the new proportion (not an instant jump)

8. **AC-A8:** The component is wrapped with `React.memo` using a named function: `export const ErrorJourneyBar = React.memo(function ErrorJourneyBar({...}: ErrorJourneyBarProps) {...})`

### B. Home Screen Integration

9. **AC-B1:** The ErrorJourneyBar is added to `app/(tabs)/home/index.tsx`, positioned after the Today's Plan section and before the existing "Mes competences" (Skills) section

10. **AC-B2:** Layout order in the ScrollView: CompanionMessage -> hero ConversationCard -> Today's Plan list -> ErrorJourneyBar -> Skills overview -> Weekly Activity

11. **AC-B3:** The ErrorJourneyBar section uses the same `cardEntryStyle` animated entry pattern as other sections

12. **AC-B4:** The ErrorJourneyBar receives `total={briefing.totalErrors}` and `resolved={briefing.resolvedErrors}` from the existing `useDailyBriefing()` hook

13. **AC-B5:** While `briefing.isLoading`, an `ErrorJourneyBarSkeleton` is shown (matching component dimensions)

14. **AC-B6:** All existing home screen content (CompanionMessage, ConversationCard, Today's Plan, Skills, Weekly Activity) remains functional

### C. Accessibility

15. **AC-C1:** `accessibilityRole="progressbar"` on the component container
16. **AC-C2:** `accessibilityLabel="Error patterns: {resolved} of {total} resolved, {percentage} percent"` (or "All error patterns resolved" when complete)
17. **AC-C3:** `accessibilityValue={{ min: 0, max: total, now: resolved }}`

### D. Visual Consistency

18. **AC-D1:** All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
19. **AC-D2:** The layout follows single-column flow with `Spacing.sectionGap` (16px) between sections and `Spacing.screenPadding` (20px) screen padding
20. **AC-D3:** The component matches the visual language of CompanionMessage and TodayPlanItem (tinted backgrounds, design tokens, `skillTint()`)

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

- [x] Task 1: Create `src/components/home/ErrorJourneyBar.tsx` (AC: A1-A8, C1-C3)
  - [x] 1.1 Define `ErrorJourneyBarProps` interface: `{ total: number; resolved: number }`
  - [x] 1.2 Implement early return `null` when `total === 0`
  - [x] 1.3 Build component layout: row with label + percentage text, then progress bar below
  - [x] 1.4 Apply design tokens: `skillTint(Colors.primary, 0.04)` bg, `Radii.button` (12) border radius, padding `8px 10px`
  - [x] 1.5 Build progress bar: 6px track (`skillTint(Colors.primary, 0.08)`), fill (`Colors.success`), both borderRadius 3
  - [x] 1.6 Animate fill width with Reanimated: `useSharedValue` for progress, `useEffect` to update `withTiming(resolved / total, { duration: 600 })`, `useAnimatedStyle` for width percentage
  - [x] 1.7 Implement completion state: when `resolved === total`, show "All patterns resolved!" in `Colors.success` instead of normal label
  - [x] 1.8 Add accessibility: `accessibilityRole="progressbar"`, composed label, `accessibilityValue={{ min: 0, max: total, now: resolved }}`
  - [x] 1.9 Wrap with `React.memo` using named function pattern

- [x] Task 2: Create `ErrorJourneyBarSkeleton` loading state (AC: B5)
  - [x] 2.1 Build skeleton component using `SkeletonBar` from `@/src/components/common/SkeletonBar`
  - [x] 2.2 Match ErrorJourneyBar dimensions: one text bar (label) + one bar (progress track)

- [x] Task 3: Integrate ErrorJourneyBar into home screen (AC: B1-B6, D1-D3)
  - [x] 3.1 Import `ErrorJourneyBar` and `ErrorJourneyBarSkeleton` in `app/(tabs)/home/index.tsx`
  - [x] 3.2 Add ErrorJourneyBar section after Today's Plan, before Skills overview
  - [x] 3.3 Pass `total={briefing.totalErrors}` and `resolved={briefing.resolvedErrors}` from existing `briefing` variable
  - [x] 3.4 Show `ErrorJourneyBarSkeleton` while `briefing.isLoading`; render `ErrorJourneyBar` when loaded (component handles `total === 0` internally)
  - [x] 3.5 Wrap in `Animated.View` with `cardEntryStyle` for consistent entry animation
  - [x] 3.6 Verify all existing sections (CompanionMessage, ConversationCard, Today's Plan, Skills, Weekly Activity) remain functional

- [x] Task 4: Quality gates (AC: Z)
  - [x] 4.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 4.2 Verify no regressions in home screen functionality

## Dev Notes

### Critical: `useDailyBriefing` already returns error counts

Story 2-1 created the `useDailyBriefing` hook at `src/hooks/use-daily-briefing.ts` which already returns `totalErrors: number` and `resolvedErrors: number`. These are fetched via the `CACHE_KEYS.BRIEFING_ERROR_COUNTS` query that counts all `error_patterns` rows and separately counts those with `resolved = true`. Do NOT modify `use-daily-briefing.ts` — just consume the existing return values.

### File Structure

```
NEW FILES:
  src/components/home/ErrorJourneyBar.tsx  — ErrorJourneyBar component + ErrorJourneyBarSkeleton

MODIFIED FILES:
  app/(tabs)/home/index.tsx                — Add ErrorJourneyBar section between Today's Plan and Skills
```

### ErrorJourneyBarProps Interface

```typescript
interface ErrorJourneyBarProps {
  /** Total number of error patterns tracked */
  total: number;
  /** Number of resolved error patterns */
  resolved: number;
}
```

### Animated Fill Bar Implementation

Use `useSharedValue` for the progress ratio and animate with `withTiming` when props change:

```typescript
const progress = useSharedValue(total > 0 ? resolved / total : 0);

useEffect(() => {
  progress.value = withTiming(total > 0 ? resolved / total : 0, { duration: 600 });
}, [resolved, total]);

const fillStyle = useAnimatedStyle(() => ({
  width: `${progress.value * 100}%`,
}));
```

Note: Reanimated `useAnimatedStyle` supports percentage widths via string. The fill `Animated.View` sits inside the track `View`.

### Completion State Logic

```typescript
const isComplete = resolved === total && total > 0;
const percentage = total > 0 ? Math.round((resolved / total) * 100) : 0;

// Label text:
// - Complete: "All patterns resolved!" in Colors.success
// - In progress: "{resolved}/{total} errors resolved" in Colors.primary + "{percentage}%" in Colors.success
```

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function | Import Path | Usage |
|----------|-------------|-------|
| `skillTint(color, opacity)` | `@/src/lib/design` | Tinted backgrounds for container and bar track |
| `Colors.*`, `Typography.*`, `Radii.*`, `Spacing.*` | `@/src/lib/design` | All design tokens |
| `SkeletonBar` | `@/src/components/common/SkeletonBar` | Loading skeleton bars |
| `useDailyBriefing()` | `@/src/hooks/use-daily-briefing` | Already called in HomeScreen — reuse `briefing.totalErrors` and `briefing.resolvedErrors` |

### Design Token Reference

| Token | Value | Usage |
|-------|-------|-------|
| `Colors.primary` | `#1E3A5F` | Label text color, tint base |
| `Colors.success` | `#34C759` | Bar fill color, percentage text, completion text |
| `Typography.caption` | `{ fontSize: 13, color: Colors.textTertiary }` | Base text style (override color/weight) |
| `Radii.button` | 12 | Container border radius |
| `Radii.chip` | 8 | Not used here; bar uses hardcoded 3px (half of 6px height) |
| `skillTint()` | `rgba(r,g,b,opacity)` | Container bg (0.04), track bg (0.08) |

### Reanimated Imports Needed

```typescript
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
```

These are already used across the home screen and sibling components — no new dependency.

### Component Pattern (follow CompanionMessage.tsx / TodayPlanItem.tsx)

- Named function inside `React.memo`: `export const ErrorJourneyBar = React.memo(function ErrorJourneyBar(...) { })`
- Props interface with JSDoc on each field, exported alongside component
- Styles via inline `style={{}}` using design tokens — NOT Tailwind `className` for layout-critical styles
- Paired skeleton export (`ErrorJourneyBarSkeleton`) in the same file
- `SkeletonBar` for loading states — never `ActivityIndicator`

### Home Screen Integration Pattern

In `app/(tabs)/home/index.tsx`, the `briefing` variable already exists:

```typescript
const briefing = useDailyBriefing();
```

Insert the ErrorJourneyBar section after Today's Plan and before Skills:

```tsx
{/* ---- Error Journey section ---- */}
{briefing.isLoading ? (
  <ErrorJourneyBarSkeleton />
) : (
  <Animated.View style={cardEntryStyle}>
    <ErrorJourneyBar
      total={briefing.totalErrors}
      resolved={briefing.resolvedErrors}
    />
  </Animated.View>
)}
```

Note: The component handles `total === 0` internally by returning `null`, so no conditional rendering needed at the home screen level (besides the loading skeleton).

### Anti-Patterns to Avoid

- Do NOT modify `src/hooks/use-daily-briefing.ts` — error counts are already returned
- Do NOT hardcode hex colors — use `Colors.*` from `@/src/lib/design`
- Do NOT hardcode font sizes — use `Typography.*` presets
- Do NOT use `ActivityIndicator` — use `SkeletonBar` for loading state
- Do NOT put the component in root `components/` or `src/components/common/` — architecture decision places it in `src/components/home/` alongside siblings
- Do NOT add interactivity (onPress) to this component — it's a read-only progress display
- Do NOT use `Animated.createAnimatedComponent` for the fill bar — use `Animated.View` directly from reanimated

### Architecture Note: Component Location

UX-DR6 originally specified `src/components/common/` but the Epic 2 architecture document (`epic-2-architecture.md`, Section 2) decided on `src/components/home/` for all three Epic 2 components. Follow the architecture decision: `src/components/home/ErrorJourneyBar.tsx`. Epic 4 will import from this same location when reusing the component.

### Previous Story Intelligence (from Story 2-2)

- `briefing` variable already exists in HomeScreen from Story 2-1, with `totalErrors` and `resolvedErrors` fields
- `cardEntryStyle` animated style is used for fade-in on card sections — reuse it
- `Animated.View` from `react-native-reanimated` is already imported in home screen
- Pull-to-refresh already calls `briefing.refresh()` — no changes needed
- The hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/` — no raw hex allowed
- Import order: react -> react-native -> expo -> external -> @/ internal (ESLint enforced)

### Git Intelligence

- Branch naming: `feature/2-3-error-journey-progress-bar-home-screen-integration`
- Commit prefix: `feat(story-2-3):` for feature work, `chore:` for status updates
- Pattern: single feature commit per logical change, then status update commit

### Epic 4 Reuse Context

This component will be reused in Epic 4 (Narrative Post-Conversation Feedback) on the feedback screen. The current props interface (`total`, `resolved`) is sufficient for reuse. No `compact` prop needed yet — add it in Epic 4 if the feedback screen requires a visually smaller variant.

### Project Structure Notes

- Component path: `src/components/home/ErrorJourneyBar.tsx` (alongside `CompanionMessage.tsx` and `TodayPlanItem.tsx`)
- Path alias: `@/*` maps to repo root — use `@/src/components/home/ErrorJourneyBar` not relative paths
- All styles inline with design tokens — NativeWind `className` only for flex shorthands

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3 — BDD acceptance criteria, visual spec, layout order]
- [Source: _bmad-output/planning-artifacts/epic-2-architecture.md — Section 2: directory structure, Section 4: ErrorJourneyBarProps, Section 5: data flow, Section 7: architecture validation]
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR6 — ErrorJourneyBar component spec: props, states, accessibility]
- [Source: _bmad-output/implementation-artifacts/2-2-todays-plan-curated-activity-recommendations.md — Previous story patterns, completion notes, file list]
- [Source: src/hooks/use-daily-briefing.ts — totalErrors, resolvedErrors return fields, BRIEFING_ERROR_COUNTS cache key]
- [Source: src/components/home/CompanionMessage.tsx — Component pattern (React.memo, named function, skillTint, SkeletonBar)]
- [Source: src/components/home/TodayPlanItem.tsx — Animation pattern (Reanimated useSharedValue, withTiming)]
- [Source: src/lib/design.ts — Colors, Typography, Spacing, Radii, skillTint()]
- [Source: src/components/common/SkeletonBar.tsx — SkeletonBar(width, height, style?, accessibilityLabel?)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — no errors encountered during implementation.

### Completion Notes List

- **Task 1:** Created `src/components/home/ErrorJourneyBar.tsx` with `ErrorJourneyBarProps` interface (`total`, `resolved`). Returns `null` when `total === 0`. Displays label row with "{resolved}/{total} errors resolved" (`Typography.caption`, fontWeight 600, `Colors.primary`) and "{percentage}%" (`Typography.caption`, fontWeight 700, `Colors.success`). Progress bar: 6px track (`skillTint(Colors.primary, 0.08)`), animated fill (`Colors.success`) using Reanimated `useSharedValue` + `withTiming(600ms)` + `useAnimatedStyle` for width percentage. Completion state: "All patterns resolved!" in `Colors.success`. Container: `skillTint(Colors.primary, 0.04)` bg, `Radii.button` (12) radius, 8/10 padding. Accessibility: `progressbar` role, composed label, `accessibilityValue`. Wrapped in `React.memo` with named function.
- **Task 2:** Created `ErrorJourneyBarSkeleton` in same file — label row (2 `SkeletonBar` for text + percentage) + full-width bar skeleton, matching ErrorJourneyBar dimensions.
- **Task 3:** Integrated into `app/(tabs)/home/index.tsx`. Imported `ErrorJourneyBar` + `ErrorJourneyBarSkeleton`. Added section between Today's Plan and Skills overview. Shows skeleton while `briefing.isLoading`, renders `ErrorJourneyBar` with `briefing.totalErrors`/`briefing.resolvedErrors` when loaded. Wrapped in `Animated.View` with `cardEntryStyle`. All existing sections remain unchanged.
- **Task 4:** All quality gates pass: `npm run type-check` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (all pass).

### Change Log

- 2026-03-26: Story 2.3 implementation complete — ErrorJourneyBar component with animated progress, skeleton, and home screen integration.

### File List

- `src/components/home/ErrorJourneyBar.tsx` — NEW: ErrorJourneyBar component + ErrorJourneyBarSkeleton
- `app/(tabs)/home/index.tsx` — MODIFIED: added ErrorJourneyBar section between Today's Plan and Skills overview
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story 2-3 status updates
- `_bmad-output/implementation-artifacts/2-3-error-journey-progress-bar-home-screen-integration.md` — MODIFIED: tasks marked complete, status updated to review
