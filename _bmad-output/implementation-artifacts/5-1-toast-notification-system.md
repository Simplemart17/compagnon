# Story 5.1: Toast Notification System

Status: done

## Story

As a learner performing actions throughout the app,
I want consistent, non-intrusive toast notifications for success, warning, and error events,
So that I always know the outcome of my actions without disruptive modals.

## Acceptance Criteria

### 1. Success Toast

- **Given** a successful action (exercise saved, streak updated, data exported)
- **When** the success toast fires
- **Then** a toast appears at the top of the screen below the status bar with a green left border, check icon, and one-line message
- **And** it auto-dismisses after 3 seconds
- **And** `hapticSuccess()` fires on appearance

### 2. Warning Toast

- **Given** a warning condition (approaching rate limit, large SRS backlog)
- **When** the warning toast fires
- **Then** a toast appears with an amber left border, info icon, and descriptive message
- **And** it auto-dismisses after 5 seconds

### 3. Error Toast

- **Given** an API failure or save error
- **When** the error toast fires
- **Then** a toast appears with a red left border, warning icon, and user-friendly message (never raw error codes)
- **And** it persists until the user dismisses it or taps "Retry"
- **And** `hapticError()` fires on appearance

### 4. Queue Behavior

- **Given** multiple toast events fire in rapid succession
- **When** a toast is already visible
- **Then** only one toast is displayed at a time — additional toasts are queued and shown sequentially

### 5. Global Availability

- **Given** the toast system
- **When** integrated across the app
- **Then** it is available as a shared utility (context provider + imperative API) callable from any screen or hook

### 6. Design Token Compliance

- **Given** all toast variants
- **When** visually inspected
- **Then** toasts use `Colors.*` tokens for border/icon colors, `Typography.caption` for message text, `Radii.button` (12) for border radius, and `Shadows.elevated` (if exists, else `Shadows.card`) for the container

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners (N/A — no loading states in toast)
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [x] Non-obvious interactions have `accessibilityHint` (N/A — toast interactions are standard dismiss/retry)
- [x] Stateful elements have `accessibilityState` (N/A — toast has no stateful toggles)
- [x] All tappable elements have minimum 44x44pt touch targets
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` (N/A — no try/catch in toast components)
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Create ToastContext provider and `useToast` hook (AC: #5)
  - [x] 1.1 Create `src/components/common/Toast/ToastContext.tsx` with React Context + queue state
  - [x] 1.2 Expose imperative `showToast({ type, message, action? })` via context
  - [x] 1.3 Create `src/hooks/use-toast.ts` that wraps `useContext(ToastContext)` for ergonomic access
  - [x] 1.4 Toast types: `"success" | "warning" | "error"` with typed payload interface

- [x] Task 2: Create ToastContainer renderer (AC: #1, #2, #3, #4, #6)
  - [x] 2.1 Create `src/components/common/Toast/ToastContainer.tsx` — renders the top-most toast from the queue
  - [x] 2.2 Position: absolute top, below status bar (use `useSafeAreaInsets().top`), full width with `Spacing.screenPadding` horizontal margin
  - [x] 2.3 Layout: left color border (4px) + icon (24x24) + message text + optional action button ("Retry" / "Dismiss")
  - [x] 2.4 Animate in: slide down from top using `react-native-reanimated` `withTiming` (200ms)
  - [x] 2.5 Animate out: slide up to exit (200ms), then dequeue and show next
  - [x] 2.6 Auto-dismiss timers: success=3s, warning=5s, error=never (manual dismiss or action)
  - [x] 2.7 Fire haptics on appearance: `hapticSuccess()` for success, `hapticError()` for error, none for warning
  - [x] 2.8 Swipe-to-dismiss gesture (swipe up) using `PanResponder` (react-native-gesture-handler not installed; used RN core PanResponder instead)

- [x] Task 3: Mount ToastProvider in root layout (AC: #5)
  - [x] 3.1 Wrap `RootLayoutNav` return JSX in `<ToastProvider>` inside `app/_layout.tsx`
  - [x] 3.2 Place `<ToastContainer />` after `<NetworkBanner />` and before `<Stack>`, inside the `View` wrapper
  - [x] 3.3 Ensure toast renders above all screen content via `zIndex` / absolute positioning

- [x] Task 4: Accessibility (AC: Z)
  - [x] 4.1 Toast container: `accessibilityRole="alert"`, `accessibilityLiveRegion="polite"` (success/warning), `"assertive"` (error)
  - [x] 4.2 Dismiss/Retry buttons: `accessibilityRole="button"` + `accessibilityLabel`
  - [x] 4.3 Respect `useReducedMotion()` — skip slide animation, show/hide instantly

- [x] Task 5: Integrate toast calls in existing flows (AC: #1, #2, #3)
  - [x] 5.1 Data export success in `app/(tabs)/profile/settings.tsx` → success toast
  - [x] 5.2 Profile save/update success → success toast
  - [x] 5.3 Exercise save failures in hooks → error state surfaced (persist errors now set user-visible error state in use-exercise.ts)
  - [x] 5.4 Replaced 8 inline Alert.alert error messages with error toasts in settings.tsx

## Dev Notes

### Architecture Pattern

This is a **new shared UI system** — the first global feedback layer beyond `NetworkBanner`. It follows the context provider pattern used by Zustand stores but uses React Context because the toast state is purely UI (no persistence, no cross-session state).

**Provider + imperative API pattern:**
```typescript
// Context provides the showToast function
const { showToast } = useToast();
showToast({ type: "success", message: "Exercise saved!" });
showToast({ type: "error", message: "Save failed", action: { label: "Retry", onPress: retrySave } });
```

### Key Existing Patterns to Follow

- **NetworkBanner** (`src/components/common/NetworkBanner.tsx`): Reference for top-of-screen overlay positioning within root layout. Uses `React.memo`, NativeWind `className` for styling.
- **ErrorBoundary** (`src/components/common/ErrorBoundary.tsx`): Reference for app-wide wrapper pattern.
- **Haptics** (`src/lib/haptics.ts`): Import `hapticSuccess`, `hapticError` — already handles unsupported devices.
- **Error classification** (`src/lib/error-messages.ts`): Use `classifyError()` when converting caught errors to toast messages — never show raw error strings.
- **Sentry** (`src/lib/sentry.ts`): Call `captureError(err, "toast-context")` before showing error toasts.

### Root Layout Integration Point

`app/_layout.tsx` currently wraps everything in `<AppErrorBoundary>` → `<View>` → `<NetworkBanner />` + `<Stack>`. The `ToastProvider` wraps around this View, and `ToastContainer` sits inside the View between `NetworkBanner` and `Stack`, positioned absolutely so it overlays screen content.

```tsx
// Target structure in app/_layout.tsx
<AppErrorBoundary>
  <ToastProvider>
    <View className="flex-1">
      <NetworkBanner />
      <ToastContainer />  {/* absolute positioned, z-index above Stack */}
      <Stack screenOptions={{ headerShown: false }}>
        ...
      </Stack>
    </View>
  </ToastProvider>
</AppErrorBoundary>
```

### Design Token Mapping

| Element | Token |
|---------|-------|
| Success border | `Colors.success` (#34C759) |
| Warning border | `Colors.accent` (#F5A623) |
| Error border | `Colors.error` (#FF3B30) |
| Background | `Colors.surface` (#F5F5F0) or white |
| Message text | `Typography.caption` (13px) |
| Border radius | `Radii.button` (12) |
| Shadow | `Shadows.card` |
| Container padding | `Spacing.cardPaddingSmall` (12) |
| Horizontal margin | `Spacing.screenPadding` (20) |
| Left border width | 4px |
| Icon size | 24x24 |

### Icons

Use `@expo/vector-icons` (already a dependency via Expo):
- Success: `Ionicons` `checkmark-circle` in `Colors.success`
- Warning: `Ionicons` `information-circle` in `Colors.accent`
- Error: `Ionicons` `warning` in `Colors.error`

### Animation Requirements

- Use `react-native-reanimated` exclusively (already installed: v4.2.2) — **never** RN's built-in `Animated`
- Slide in from top: `translateY` from `-100` to `0`, `withTiming` 200ms
- Slide out: reverse, 200ms
- Respect `useReducedMotion()` from `react-native-reanimated` — if true, skip animations (instant show/hide)
- Swipe-to-dismiss: track `PanGestureHandler` vertical gesture, if swipe up > 50px threshold → dismiss

### Queue Implementation

```typescript
interface ToastItem {
  id: string;           // unique ID (Date.now() or uuid)
  type: "success" | "warning" | "error";
  message: string;
  action?: { label: string; onPress: () => void };
}

// State: queue: ToastItem[], current: ToastItem | null
// On showToast: if no current → set current. If current exists → append to queue.
// On dismiss: clear current, pop next from queue after 300ms gap.
```

### What NOT to Do

- **Do NOT use `Alert.alert()`** — the app has zero usage of it; toasts replace that pattern
- **Do NOT install a third-party toast library** (react-native-toast-message, etc.) — build from scratch using the design system tokens for full consistency
- **Do NOT use `StyleSheet.create`** — use NativeWind `className` for layout/colors, inline `style` only for dynamic values (animation transforms, left border width)
- **Do NOT show raw error codes/messages** — always pass through `classifyError()` or write a human-friendly string
- **Do NOT use `ActivityIndicator`** anywhere — not relevant for toasts but a project-wide rule
- **Do NOT create a separate Zustand store** for toast state — use React Context (purely ephemeral UI state)

### Project Structure Notes

- New files go in `src/components/common/Toast/` directory (grouped as a mini-module):
  - `ToastContext.tsx` — provider, context, and `showToast` implementation
  - `ToastContainer.tsx` — the visual toast renderer
- Hook goes in `src/hooks/use-toast.ts` — follows existing hook location pattern
- **Do NOT** put files in root `components/` directory (that's unused Expo boilerplate)

### Testing Approach

No test framework is configured. Quality assurance via:
1. `npm run type-check` — TypeScript strict mode catches type errors
2. `npm run lint` — ESLint catches import order and code issues
3. `npm run format:check` — Prettier formatting consistency
4. `scripts/check-hex-colors.sh` — ensures no hardcoded hex colors
5. Manual verification: trigger all three toast types and verify appearance, timing, haptics, queue behavior, swipe dismiss

### Previous Story Intelligence

**From Story 4-3 (Narrative Feedback Screen Integration):**
- `Colors.whiteAlpha*` tokens exist for dark-mode overlays — not needed for toasts (light bg) but good to know
- Inline component creation is acceptable for screen-specific widgets, but toast is shared → extract to its own files
- `profile.full_name` exists on profile object (useful if toasts ever need personalization)
- ESLint import order enforced: react → react-native → expo → external → `@/` internal
- Pre-commit hook runs `check-hex-colors.sh` — will fail if any hardcoded hex sneaks in
- Branch naming convention: `feature/5-1-toast-notification-system`
- Commit prefix: `feat(story-5-1):` for the main commit

### Git Intelligence

Recent commits follow pattern: `feat(story-X-Y): description` for feature work, `chore:` for status updates. PRs created from feature branches merged to main.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 5, Story 5.1]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Toast/Alert Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Screen State Machine Pattern]
- [Source: _bmad-output/project-context.md#Agent Rules]
- [Source: src/components/common/NetworkBanner.tsx — overlay positioning reference]
- [Source: src/lib/haptics.ts — haptic feedback API]
- [Source: src/lib/error-messages.ts — error classification utility]
- [Source: app/_layout.tsx — root layout integration point]
- [Source: src/lib/design.ts — design tokens]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Swipe-to-dismiss: Used RN core `PanResponder` instead of `react-native-gesture-handler` `PanGestureHandler` because `react-native-gesture-handler` is not installed in this project. Equivalent behavior achieved.
- ESLint import grouping: Relative `./` imports not used in codebase — all internal imports use `@/` path alias. Fixed accordingly.

### Completion Notes List

- Created toast notification system with 3 variants (success/warning/error), queue management, slide animations, swipe-to-dismiss, and haptic feedback
- Integrated ToastProvider in root layout, positioned above all screen content with zIndex 9999
- Replaced 8 Alert.alert error calls in settings.tsx with toast notifications
- Added success toasts for profile updates (level, target, daily goal, display name) and data export
- Exercise persist failures now surface user-visible error state
- All quality gates pass: type-check, lint, format:check, hex color check

### Change Log

- 2026-03-27: Initial implementation — toast system + settings integration

### File List

- `src/components/common/Toast/ToastContext.tsx` — NEW: React Context provider with queue state and showToast API
- `src/components/common/Toast/ToastContainer.tsx` — NEW: Animated toast renderer with swipe-to-dismiss
- `src/hooks/use-toast.ts` — NEW: Ergonomic useToast hook
- `app/_layout.tsx` — MODIFIED: Added ToastProvider wrapper and ToastContainer component
- `app/(tabs)/profile/settings.tsx` — MODIFIED: Replaced Alert.alert errors with toast notifications, added success toasts
- `src/hooks/use-exercise.ts` — MODIFIED: persistExercise now sets user-visible error state on failure
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status updated
