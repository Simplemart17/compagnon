# Story 2.2: Today's Plan — Curated Activity Recommendations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner opening the app for a daily session,
I want to see 2-3 curated activity recommendations with clear rationale,
So that I know what to practice today without decision fatigue.

## Acceptance Criteria

### A. TodayPlanItem Component

1. **AC-A1:** A `TodayPlanItem` component exists at `src/components/home/TodayPlanItem.tsx` displaying:
   - A 28px rounded-square icon container (`borderRadius: 8`, `skillTint(iconColor, 0.12)` background) containing the `iconEmoji`
   - A title using `Typography.label` style, color set to `iconColor`
   - A subtitle using `Typography.caption` style, `Colors.textSecondary`
   - A badge pill with variant-specific styling (see AC-A3)

2. **AC-A2:** The component background uses `skillTint(iconColor, 0.06)`, `borderRadius: Radii.button` (12), `padding: 10px 12px`

3. **AC-A3:** Badge variants:
   - `due` → amber tint background (`skillTint(Colors.accent, 0.12)`) + amber text (`Colors.accent`) + "Due" label
   - `suggested` → amber tint background + amber text + "Suggested" label
   - `error` → red tint background (`skillTint(Colors.error, 0.12)`) + red text (`Colors.error`) + "Fix" label

4. **AC-A4:** Press animation: scale 0.97 + opacity 0.8 during press, `hapticLight()` fires on press

5. **AC-A5:** The component is wrapped with `React.memo` using a named function: `export const TodayPlanItem = React.memo(function TodayPlanItem({...}: TodayPlanItemProps) {...})`

### B. Today's Plan Section Layout

6. **AC-B1:** A "Aujourd'hui" section header appears above the plan items using `Typography.sectionHeader` style (or `text-lg font-bold text-primary`), consistent with existing section headers ("Quick Start", "Mes compétences", "Cette semaine")

7. **AC-B2:** The Today's Plan section displays up to 3 `TodayPlanItem` cards in a vertical list with `gap: 8` between items

8. **AC-B3:** When `todayPlan` is empty (no recommendations), the section is not rendered (returns null)

### C. Navigation on Press

9. **AC-C1:** Tapping a TodayPlanItem navigates to the route specified in the item's `route` field with `params` passed through:
   - SRS item → `/(tabs)/practice/vocabulary`
   - Error drill → `/(tabs)/practice/grammar` with `errorId`, `errorType`, `errorDescription` params
   - Weakest skill → `/(tabs)/practice/{skill}`
   - Conversation fallback → `/(tabs)/conversation`

### D. Loading and Edge States

10. **AC-D1:** While `briefing.isLoading` is true, skeleton placeholders matching TodayPlanItem dimensions are shown (2 skeleton items using `SkeletonBar` from `src/components/common/SkeletonBar.tsx`)

11. **AC-D2:** If the app is offline and a plan item requires network, the item appears at `opacity: 0.5` and is non-tappable (disabled state)

### E. Home Screen Integration

12. **AC-E1:** The Today's Plan section is added to `app/(tabs)/home/index.tsx`, positioned after the `ConversationCard` (hero "Talk with Companion" card) and before the existing "Mes compétences" section. Layout order: CompanionMessage → ConversationCard → Today's Plan → Skills → Weekly Activity

13. **AC-E2:** The existing `SmallActionCard` 2-column grid ("Exercice du jour" + "Test TCF") and the inline "Fix This Mistake" card are replaced by the Today's Plan list, since TodayPlanItems now serve the same navigation purpose with better personalization

14. **AC-E3:** The existing home screen content (ConversationCard, Skills overview, Weekly Activity) remains functional

### F. Accessibility

15. **AC-F1:** TodayPlanItem has `accessibilityRole="button"`
16. **AC-F2:** `accessibilityLabel="{title}. {subtitle}. Status: {badge label}"`
17. **AC-F3:** `accessibilityHint="Double tap to start this activity"`
18. **AC-F4:** Minimum 44pt touch target height

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

- [x] Task 1: Create `src/components/home/TodayPlanItem.tsx` (AC: A1-A5, F1-F4)
  - [x]1.1 Define `TodayPlanItemProps` interface: `{ title, subtitle, iconColor, iconEmoji, badge, onPress, disabled? }`
  - [x]1.2 Build component layout: icon container (28px rounded square) + text column (title + subtitle) + badge pill
  - [x]1.3 Apply design tokens: `skillTint(iconColor, 0.06)` bg, `Radii.button` (12), padding 10px 12px
  - [x]1.4 Implement badge variants: `due`/`suggested` → amber, `error` → red (use `skillTint` for pill bg)
  - [x]1.5 Implement press animation: `Animated` scale 0.97 + opacity 0.8 (use `Pressable` with `onPressIn`/`onPressOut` or `react-native-reanimated`)
  - [x]1.6 Call `hapticLight()` from `@/src/lib/haptics` on press
  - [x]1.7 Add disabled state: `opacity: 0.5`, non-tappable when `disabled` prop is true
  - [x]1.8 Add accessibility: `accessibilityRole="button"`, composed label, hint, minimum 44pt height
  - [x]1.9 Wrap with `React.memo` using named function pattern

- [x] Task 2: Create `TodayPlanSkeleton` loading state (AC: D1)
  - [x]2.1 Build skeleton component showing 2 placeholder items using `SkeletonBar`
  - [x]2.2 Match TodayPlanItem dimensions (icon square + 2 text bars per item)

- [x] Task 3: Integrate Today's Plan into home screen (AC: B1-B3, C1, E1-E3)
  - [x]3.1 Import `TodayPlanItem` and `TodayPlanSkeleton` in `app/(tabs)/home/index.tsx`
  - [x]3.2 Add "Aujourd'hui" section header after ConversationCard, matching existing header style
  - [x]3.3 Render `briefing.todayPlan` items via `.map()`, each wrapped in `TodayPlanItem` with `onPress` navigating via `router.push({ pathname: item.route, params: item.params })`
  - [x]3.4 Show `TodayPlanSkeleton` while `briefing.isLoading`, null if `todayPlan` is empty
  - [x]3.5 Remove the `SmallActionCard` 2-column grid and the inline "Fix This Mistake" / empty error card — these are replaced by Today's Plan items
  - [x]3.6 Remove `SmallActionCard` inline component definition if no longer used anywhere
  - [x]3.7 Verify ConversationCard, Skills overview, and Weekly Activity sections remain functional

- [x] Task 4: Quality gates (AC: Z)
  - [x]4.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x]4.2 Verify no regressions in home screen functionality

## Dev Notes

### Critical: The `useDailyBriefing` hook already returns `todayPlan[]`

Story 2-1 already created the full `useDailyBriefing` hook at `src/hooks/use-daily-briefing.ts` which returns `todayPlan: TodayPlanItem[]`. The data fetching, priority algorithm, and item composition are **already implemented**. This story ONLY creates the UI component and wires it to the existing hook return value. Do NOT modify `use-daily-briefing.ts`.

### File Structure

```
NEW FILES:
  src/components/home/TodayPlanItem.tsx    — TodayPlanItem component + TodayPlanSkeleton

MODIFIED FILES:
  app/(tabs)/home/index.tsx                — Add Today's Plan section, remove SmallActionCard grid + Fix This Mistake card
```

### What to Remove from Home Screen

The following inline elements in `app/(tabs)/home/index.tsx` are replaced by Today's Plan:

1. **`SmallActionCard` 2-column grid** (lines ~431-446): "Exercice du jour" + "Test TCF" cards — these static shortcuts are replaced by personalized TodayPlanItem recommendations
2. **"Fix This Mistake" card** (lines ~448-504): The inline error card with "À corriger" header — error drills are now a TodayPlanItem with badge "error"
3. **`SmallActionCard` component definition**: Check if it's defined inline in `index.tsx`. If so and no longer used, remove it entirely.
4. **The "Quick Start" section header** (line ~422-424): Replace with "Aujourd'hui"

Keep the `ConversationCard` — it stays as the hero card above Today's Plan.

### Existing TodayPlanItem Interface (from use-daily-briefing.ts)

```typescript
interface TodayPlanItem {
  id: string;
  title: string;
  subtitle: string;
  iconColor: string;
  iconEmoji: string;
  badge: "due" | "suggested" | "error";
  route: string;
  params?: Record<string, string>;
}
```

The `onPress` callback is NOT part of the data interface — the component receives it as a separate prop. The home screen constructs `onPress` from the item's `route` and `params` using `router.push()`.

### TodayPlanItemProps (component props — different from data interface)

```typescript
interface TodayPlanItemProps {
  title: string;
  subtitle: string;
  iconColor: string;
  iconEmoji: string;
  badge: "due" | "suggested" | "error";
  onPress: () => void;
  disabled?: boolean;
}
```

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function | Import Path | Usage |
|----------|-------------|-------|
| `skillTint(color, opacity)` | `@/src/lib/design` | Tinted backgrounds for card, icon container, badge pill |
| `hapticLight()` | `@/src/lib/haptics` | Press feedback |
| `Colors.*`, `Typography.*`, `Radii.*` | `@/src/lib/design` | All design tokens |
| `SkeletonBar` | `@/src/components/common/SkeletonBar` | Loading skeleton bars |
| `useDailyBriefing()` | `@/src/hooks/use-daily-briefing` | Already called in HomeScreen — reuse `briefing.todayPlan` |
| `useRouter()` | `expo-router` | Navigation on press |

### Design Token Reference

| Token | Value | Usage |
|-------|-------|-------|
| `Colors.accent` | `#F5A623` | "Due" / "Suggested" badge color |
| `Colors.error` | `#FF3B30` | "Error" badge color |
| `Colors.textSecondary` | — | Subtitle text |
| `Typography.label` | — | Item title |
| `Typography.caption` | — | Item subtitle, badge text |
| `Radii.button` | 12 | Card border radius |
| `Radii.chip` | 8 | Icon container border radius |

### Press Animation Pattern

Use `Pressable` with `onPressIn`/`onPressOut` and `react-native-reanimated` `useSharedValue` + `useAnimatedStyle` + `withTiming`:

```typescript
const scale = useSharedValue(1);
const opacity = useSharedValue(1);

const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ scale: scale.value }],
  opacity: opacity.value,
}));

const handlePressIn = () => {
  scale.value = withTiming(0.97, { duration: 100 });
  opacity.value = withTiming(0.8, { duration: 100 });
};

const handlePressOut = () => {
  scale.value = withTiming(1, { duration: 150 });
  opacity.value = withTiming(1, { duration: 150 });
};
```

Wrap the `Pressable` content in `Animated.View` with the animated style.

### Badge Configuration Map

```typescript
const BADGE_CONFIG = {
  due: { label: "Due", color: Colors.accent, bg: skillTint(Colors.accent, 0.12) },
  suggested: { label: "Suggested", color: Colors.accent, bg: skillTint(Colors.accent, 0.12) },
  error: { label: "Fix", color: Colors.error, bg: skillTint(Colors.error, 0.12) },
} as const;
```

### Home Screen Integration Pattern

In `app/(tabs)/home/index.tsx`, the `briefing` variable already exists from Story 2-1:

```typescript
const briefing = useDailyBriefing();
```

Wire the Today's Plan section like this:

```tsx
{/* ---- Today's Plan section ---- */}
{briefing.isLoading ? (
  <TodayPlanSkeleton />
) : briefing.todayPlan.length > 0 ? (
  <Animated.View style={cardEntryStyle}>
    <Text className="text-lg font-bold text-primary mt-5 mb-3" accessibilityRole="header">
      Aujourd'hui
    </Text>
    <View style={{ gap: 8 }}>
      {briefing.todayPlan.map((item) => (
        <TodayPlanItem
          key={item.id}
          title={item.title}
          subtitle={item.subtitle}
          iconColor={item.iconColor}
          iconEmoji={item.iconEmoji}
          badge={item.badge}
          onPress={() => router.push({ pathname: item.route as any, params: item.params })}
        />
      ))}
    </View>
  </Animated.View>
) : null}
```

### Component Conventions (follow CompanionMessage.tsx pattern)

- Named functions inside `React.memo`: `export const TodayPlanItem = React.memo(function TodayPlanItem(...) { })`
- Props interface exported alongside component
- Static styles via NativeWind `className`, dynamic/computed via inline `style={{ }}`
- Import order: react → react-native → expo → external → @/ internal (ESLint enforced)
- `SkeletonBar` for loading states — never `ActivityIndicator`

### Anti-Patterns to Avoid

- Do NOT modify `src/hooks/use-daily-briefing.ts` — it's complete from Story 2-1
- Do NOT hardcode hex colors — use `Colors.*` from `@/src/lib/design`
- Do NOT hardcode font sizes — use `Typography.*` presets
- Do NOT use `TouchableOpacity` for the press animation — use `Pressable` + Reanimated for the scale/opacity effect
- Do NOT keep `SmallActionCard` if unused — clean up dead code
- Do NOT put the component in root `components/` dir — use `src/components/home/`
- Do NOT add inline sub-components in `index.tsx` — `TodayPlanItem` belongs in its own file

### Previous Story Intelligence (from Story 2-1)

- `useDailyBriefing()` is already called in HomeScreen and returns `todayPlan`, `isLoading`, etc.
- `CompanionMessage` + `CompanionMessageSkeleton` pattern in `src/components/home/` is the template to follow
- Pull-to-refresh already calls `briefing.refresh()` — no changes needed
- The `cardEntryStyle` animated style is used for fade-in on card sections
- `Animated.View` from `react-native-reanimated` is already imported in the home screen
- The hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/` — no raw hex allowed

### Git Intelligence

- Branch naming convention: `feature/2-2-todays-plan-curated-activity-recommendations`
- Commit prefix: `feat(story-2-2):` for feature work, `chore:` for status updates
- Recent pattern: single feature commit per logical change, then status update commit

### Project Structure Notes

- Component goes in `src/components/home/TodayPlanItem.tsx` (alongside existing `CompanionMessage.tsx`)
- Path alias: `@/*` maps to repo root — use `@/src/components/home/TodayPlanItem` not relative paths

### References

- [Source: _bmad-output/planning-artifacts/epic-2-architecture.md — Section 4: TodayPlanItemProps interface, visual spec, press animation, badge variants, accessibility]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.2 acceptance criteria (lines 743-784)]
- [Source: _bmad-output/planning-artifacts/epic-2-architecture.md — Section 3.5: Today's Plan item selection algorithm]
- [Source: _bmad-output/planning-artifacts/epic-2-architecture.md — Section 1: Component tree showing layout order]
- [Source: _bmad-output/implementation-artifacts/2-1-companionmessage-component-memory-driven-briefing.md — Previous story learnings, completion notes, file list]
- [Source: src/hooks/use-daily-briefing.ts — TodayPlanItem interface, todayPlan return value]
- [Source: src/components/home/CompanionMessage.tsx — Component pattern to follow (React.memo, named function, skillTint, SkeletonBar)]
- [Source: app/(tabs)/home/index.tsx — Current home screen layout, SmallActionCard/Fix This Mistake sections to replace]
- [Source: src/lib/design.ts — Colors, Typography, Spacing, Radii, skillTint()]
- [Source: src/lib/haptics.ts — hapticLight()]
- [Source: src/components/common/SkeletonBar.tsx — SkeletonBar(width, height, style?, accessibilityLabel?)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — no errors encountered during implementation.

### Completion Notes List

- **Task 1:** Created `src/components/home/TodayPlanItem.tsx` with `TodayPlanItemProps` interface. Component displays emoji icon in 28px rounded-square container (`skillTint(iconColor, 0.12)`), title (`Typography.label`, `iconColor`), subtitle (`Typography.caption`, `Colors.textSecondary`), and badge pill with 3 variants (due/suggested → amber, error → red). Press animation: Reanimated `useSharedValue` scale 0.97 + opacity 0.8. `hapticLight()` on press. Disabled state at 0.5 opacity. `accessibilityRole="button"`, composed label, hint, `accessibilityState`. Min 44pt height. Wrapped in `React.memo` with named function.
- **Task 2:** Created `TodayPlanSkeleton` in same file — 2 placeholder items using `SkeletonBar` matching TodayPlanItem dimensions (icon square + 2 text bars + badge pill per item).
- **Task 3:** Integrated into `app/(tabs)/home/index.tsx`. Added "Aujourd'hui" section header after ConversationCard. Renders `briefing.todayPlan` items via `.map()` with navigation via `router.push()`. Shows skeleton while loading, null if empty. Removed `SmallActionCard` component definition (dead code). Removed 2-column grid ("Exercice du jour" + "Test TCF") and inline "Fix This Mistake"/"À corriger" card — both replaced by personalized TodayPlanItem recommendations. Removed unused `skillTint` import. ConversationCard, Skills overview, and Weekly Activity sections remain unchanged.
- **Task 4:** All quality gates pass: `npm run type-check` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (all pass).

### Change Log

- 2026-03-26: Story 2.2 implementation complete — TodayPlanItem component, skeleton, home screen integration with SmallActionCard/Fix This Mistake removal.

### File List

- `src/components/home/TodayPlanItem.tsx` — NEW: TodayPlanItem component + TodayPlanSkeleton
- `app/(tabs)/home/index.tsx` — MODIFIED: added Today's Plan section, removed SmallActionCard grid + Fix This Mistake card + SmallActionCard component definition, removed unused skillTint import
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story 2-2 status updates
- `_bmad-output/implementation-artifacts/2-2-todays-plan-curated-activity-recommendations.md` — MODIFIED: tasks marked complete, status updated to review
