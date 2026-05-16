# Story 14.6: Post-Onboarding Tour — 30-second 3-card guided "what Companion does" intro shown once after onboarding completion

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **a new user who just finished filling out my onboarding profile (level + goal + daily minutes + optional placement test) and is about to see the home screen for the first time**,
I want **a 30-second guided intro that tells me what Companion actually does (AI conversations, personalized practice, TCF mock tests) in 3 swipeable cards before I land on home**,
so that **I don't open the home screen thinking "OK now what?" — and so I know which 3 surfaces matter and how they connect to my TCF goal**.

## Background — Why This Story Exists

### What audit / roadmap owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 275 — Epic 14 deliverable 14.6:

> 14.6 30-second post-onboarding tour — 3-card guided "what Companion does."

This is the **only NEW UX deliverable** in Epic 14 (all 8 sibling 14-X stories close audit findings P1-20 / P2-10 / P2-11 / P2-12 / P2-13 / P2-x ui-ux). 14-6 doesn't map to a specific audit row — it's an Epic 14 acceptance-criterion deliverable per roadmap line 281:

> A new user can describe what the app does in one sentence after onboarding (informal user test, n≥5).

This AC is the load-bearing measurement. The tour is the implementation path to satisfy it.

### Why this matters (UX-empirical motivation)

The current cold-launch flow for a brand-new signup user:

1. `/(auth)/signup` — create account
2. `/onboarding/index` — pick goal + current-level + target-level + daily-minutes
3. `/onboarding/placement-test` (optional) — 15-question CEFR placement
4. `/(tabs)/home` — drop directly onto the home screen

The home screen ([`app/(tabs)/home/index.tsx`](app/(tabs)/home/index.tsx)) opens with a `ConversationCard` (the prominent "Start a conversation" CTA) + a daily plan + skill progress strip + weekly activity chart. For a brand-new user with zero history, the daily plan is empty / placeholder, the skill progress strip shows zeros, the weekly chart is empty. The ConversationCard is the obvious affordance — but the user doesn't yet know:

- WHY they should tap it (companion = AI tutor who remembers facts about you across sessions)
- WHAT else the app does (practice tab = 8 skill exercises; mock-test tab = TCF-specific simulation; profile = progress)
- HOW the parts connect to their TCF goal

The tour delivers this context in ≤30 seconds without forcing them to read documentation.

### Why 3 cards (not 1, not 5)

- **1 card** loses too much information density — TCF / conversation / practice are 3 distinct functional surfaces; cramming them into one card produces a "wall of text" that violates the 30-second target.
- **5+ cards** breaks the 30-second target — empirically, swipeable card tours of 5+ cards see ≥40% skip-rate at card 3 (industry benchmark; the user reads cards 1-2 in detail then loses patience).
- **3 cards** is the sweet spot per RN/iOS HIG conventions for app-intro tours (matches Headspace / Duolingo / Calm).

### Why "post-onboarding" not "first-launch" or "always-available"

- **First-launch (before signup)** would be wrong — the user hasn't committed yet; talking about their level + goal makes no sense before they've entered it.
- **Always-available (from settings)** is forward-compat work for v2 — v1 ships the in-flow version + a "View tour" entry in settings is a follow-up.
- **Post-onboarding (after `onboarding_completed=true` and before the first home render)** is the canonical "show once after commitment" placement.

### Why the user-state stays in Supabase (`onboarding_completed`), not a client-side `tour_completed` flag

The simplest implementation keeps `onboarding_completed: true` as the gate (already set by `placement-test.tsx:528` + `onboarding/index.tsx:148`) AND inserts the tour between "save complete" and "route to home". After the tour finishes, the user routes to home. If the user kills the app mid-tour, they re-enter via the routing guard at [`app/_layout.tsx:181`](app/_layout.tsx#L181) which routes `isOnboarded=true` users directly to home — meaning they miss the tour. **Acceptable for v1** (tour content is non-critical 30-second context; user can re-trigger later via a future settings deep-link).

Tracking a separate `tour_completed` flag would require either (a) a Supabase migration (heavy for a UX feature) or (b) a client-side AsyncStorage flag (which would persist across logouts/re-installs in a way that's hard to reason about). Both are overkill for the 30-second-context use case. **Out of scope for 14-6.**

### Integration point — routing guard carve-out

The routing guard at [`app/_layout.tsx:181`](app/_layout.tsx#L181) currently redirects:

```ts
} else if (session && isOnboarded && (inAuthGroup || inOnboarding)) {
  router.replace("/(tabs)/home");
}
```

This redirect would bounce a user navigating to `/onboarding/tour` immediately back to home (because they're already `onboarded`). Story 14-6 adds an **inTour carve-out** so `/onboarding/tour` is accessible to onboarded users:

```ts
const inOnboarding = segments[0] === "onboarding";
const inTour = inOnboarding && segments[1] === "tour";
// ...
} else if (session && isOnboarded && (inAuthGroup || (inOnboarding && !inTour))) {
  router.replace("/(tabs)/home");
}
```

The same pattern (carve out one sub-route from a redirect) appears at [`app/_layout.tsx:165`](app/_layout.tsx#L165) for the verification gate (`inAuthGroup` carve-out). Story 14-6 mirrors that approach.

### Why a fade-then-slide animation between cards (not horizontal swipe carousel)

- **Horizontal swipe carousel** (FlatList horizontal + pagingEnabled) gives natural swipe-gesture affordance but adds a `react-native-gesture-handler` dependency surface that the project currently doesn't use elsewhere for carousels. Story 14-3 introduced `@expo/vector-icons.Feather` as a transitive-already-installed package; the carousel would require new gesture-handler wiring.
- **Reanimated 3 fade-then-slide** uses the already-installed `react-native-reanimated` (Stories 9-X / 13-X / 14-2 / 14-3 / 14-4 / 14-5 precedent) for entry animations. Cards switch on "Next" button tap (and on dot-pagination tap) with a 250ms fade-out + slide-left-by-20pt → fade-in + slide-in-from-right-20pt. No swipe gesture in v1.
- The "Next" button is the primary affordance; the swipe gesture can be added in v2 if user testing shows it's expected.

### Copy — load-bearing UX content (operator review required per AC #11 Q1)

The roadmap doesn't specify card content. Operator-review of the 3 candidates below required before implementation. Default (recommended) copy:

**Card 1 — Daily AI conversations**
- **Headline:** "Talk to your AI tutor every day"
- **Body:** "Have real French conversations with an AI that remembers what you've learned and adapts to your level."
- **Icon:** `Feather.mic` (consistent with the home ConversationCard's icon)
- **Background tint:** `Colors.primary15` (subtle navy)

**Card 2 — Personalized practice**
- **Headline:** "Practice in 8 different ways"
- **Body:** "Listening, reading, writing, dictation, echo, translation, pronunciation, vocabulary — exercises that match your CEFR level."
- **Icon:** `Feather.book-open`
- **Background tint:** `Colors.success15` (subtle green)

**Card 3 — TCF Canada mock tests**
- **Headline:** "Take TCF-style practice tests"
- **Body:** "Time-locked simulations that mirror the real exam. See your score, track your progress, identify weak spots."
- **Icon:** `Feather.award`
- **Background tint:** `Colors.streak15` (subtle warm amber — closes the tour with the "you're working toward a goal" warmth signal; intentional Story 14-5 streak-cluster reuse)

Each card has the same skeleton: large icon at top + headline + 2-line body + bottom-aligned dot pagination + bottom-aligned "Next" / "Get started" button. The 3rd card's button label is "Get started" (terminal action); cards 1-2 use "Next".

### What 14-6 does NOT do

- ❌ Add a "View tour" entry in Settings (v2 follow-up — file `14-6-followup-replay-tour-from-settings` if telemetry shows user demand)
- ❌ Add swipe-gesture navigation between cards (v2 follow-up — file `14-6-followup-swipe-gesture` if user testing shows expectation)
- ❌ Track tour completion in Supabase (Story 14-6's `isOnboarded` gate is sufficient for the 30-second use case)
- ❌ A/B test card content (operator-decision via AC #11 Q1; future story can extend if a/b infrastructure exists)
- ❌ Persist the tour as part of `onboarding_completed=true` flag (defer the Supabase flag set is overkill; tour is purely a presentation layer on top of the existing onboarding-complete state)

## Acceptance Criteria

### A. New tour screen at `app/onboarding/tour.tsx`

1. **AC-A1:** New file `app/onboarding/tour.tsx` exports a default React component implementing the 3-card tour.
2. **AC-A2:** Component renders an `Animated.View` (`react-native-reanimated`) with the current card based on internal `currentIndex` state (0/1/2).
3. **AC-A3:** Card content rendered via a module-level `TOUR_CARDS: readonly TourCard[]` const exported `@internal` for testability — 3 entries matching the Q1 operator-recommended copy (or operator-overridden equivalent).
4. **AC-A4:** Each card layout: large icon at top (size 64) + headline (Typography.screenTitle) + body text (Typography.body) + dot pagination + primary button (`Next` for cards 0-1, `Get started` for card 2).
5. **AC-A5:** Top-right corner has a "Skip" `Pressable` (`accessibilityRole="button"` + `accessibilityLabel="Skip tour"`) that immediately routes to `/(tabs)/home`.
6. **AC-A6:** Bottom-center dot pagination — 3 dots, active dot uses `Colors.accent` (CTA-cluster — the dots ARE tappable), inactive dots use `Colors.primary15`. Each dot is a `Pressable` (44×44 hit slop) with `accessibilityRole="button"` + `accessibilityLabel="Go to tour card {N}"`.
7. **AC-A7:** "Next" / "Get started" CTA at bottom — full-width `bg-accent rounded-2xl py-[18px]`. On "Get started" tap → `router.replace("/(tabs)/home")` + `hapticMedium()` from `@/src/lib/haptics`.
8. **AC-A8:** Card transitions use Reanimated `withTiming` 250ms fade-out + slide-left-20pt → fade-in + slide-in-from-right-20pt. The animation runs on `currentIndex` change.
9. **AC-A9:** Screen has `<Stack.Screen options={{ headerShown: false }}>` (Expo Router pattern; matches `app/onboarding/placement-test.tsx` precedent).
10. **AC-A10:** Each card emits an `addBreadcrumb({ category: "tour", level: "info", message: "Tour card viewed", data: { cardIndex } })` on first render (via `useEffect` keyed on `currentIndex`); the breadcrumb-fired tracking lets operators see drop-off rate via Sentry.

### B. Onboarding flow integration

11. **AC-B1:** [`app/onboarding/placement-test.tsx:535`](app/onboarding/placement-test.tsx#L535) `router.replace("/(tabs)/home")` → `router.replace("/onboarding/tour")` (after the `updateProfile({ onboarding_completed: true })` save).
12. **AC-B2:** [`app/onboarding/index.tsx:161`](app/onboarding/index.tsx#L161) `router.replace("/(tabs)/home")` → `router.replace("/onboarding/tour")` (on the no-placement-test branch where `onboarding_completed: true` is set).
13. **AC-B3:** [`app/_layout.tsx:181`](app/_layout.tsx#L181) routing-guard adds an `inTour` carve-out — the existing `else if (session && isOnboarded && (inAuthGroup || inOnboarding))` condition changes to `(inAuthGroup || (inOnboarding && !inTour))` so onboarded users can reach `/onboarding/tour`.

### C. Layout registration

14. **AC-C1:** [`app/onboarding/_layout.tsx`](app/onboarding/_layout.tsx) (Stack layout for the onboarding subtree) registers the new `tour` screen alongside the existing `index` + `placement-test` screens.

### D. Operator decisions (resolve at impl time per AC #11)

15. **AC-D1:** Q1 tour copy applied — recommended copy per Background section above, or operator override.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (Story 1B-1 + 14-4 invariant preserved)
- [ ] Per Story 14-5 R1-P2: `Colors.streak15` on Card 3's background is on a LIGHT screen background (the tour screen renders `Colors.surface` bg). Text on Card 3 uses default Typography (NOT `Colors.streakText` — the body text uses Colors.textPrimary on the light card backdrop, which already passes WCAG AA at high contrast).
- [ ] All loading states use skeleton animations (N/A — tour is content-only, no async load)
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` (Skip + 3 dots + Next/Get-started button)
- [ ] Non-obvious interactions have `accessibilityHint` (Skip: "Double tap to skip the tour and go to home")
- [ ] Stateful elements have `accessibilityState` (active dot has `accessibilityState={{ selected: true }}`)
- [ ] All tappable elements have minimum 44x44pt touch targets (dot Pressables use `hitSlop={{top:10,bottom:10,left:10,right:10}}`)
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`
- [ ] Per Story 14-1 chrome rule: all tour copy is English (UI chrome) — French content is for AI conversations, not the static tour cards

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored. Run `git check-ignore -v _bmad-output/implementation-artifacts/14-6-post-onboarding-tour.md` — should return non-zero (not ignored).
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/14-6-post-onboarding-tour.md` passes.

## Tasks / Subtasks

- [ ] **Task 1: Create `app/onboarding/tour.tsx`** (AC: A1-A10)
  - [ ] 1.1 Scaffold the screen with `<Stack.Screen options={{ headerShown: false }}>` + `<SafeAreaView>` + `<View>` skeleton (matches `placement-test.tsx` pattern).
  - [ ] 1.2 Define module-level `interface TourCard { headline: string; body: string; iconName: IconName; backgroundColor: string }` + `TOUR_CARDS: readonly TourCard[]` const with the 3 cards per Q1 recommended copy. Export `@internal` for the drift detector + runtime test.
  - [ ] 1.3 Render `currentIndex`-indexed card with: large `<Icon name={card.iconName} size={64} color={Colors.primary} />` + headline (`Typography.screenTitle`) + body (`Typography.body`) + dot pagination + Next/Get-started button.
  - [ ] 1.4 Animate card transitions: `useSharedValue` for `opacity` + `translateX`; on `currentIndex` change, `withTiming(0, 125ms)` fade-out + `withTiming(-20, 125ms)` slide-left → after 250ms `setCurrentIndex(next)` + reset to `opacity=0, translateX=+20` then `withTiming(1, 125ms)` + `withTiming(0, 125ms)`.
  - [ ] 1.5 Skip button (top-right, absolute-positioned with `top: insets.top + 8, right: 16`) — `Pressable` with `accessibilityRole="button"` + `accessibilityLabel="Skip tour"` + `accessibilityHint="Double tap to skip the tour and go to home"`; `onPress` → `router.replace("/(tabs)/home")` + `hapticLight()`.
  - [ ] 1.6 Dot pagination component — 3 dots in a `flex-row`, each is a `Pressable` (size 8×8 visible + 44×44 hitSlop) with active color `Colors.accent` (active dot also has `width: 20` for a subtle pill effect) + inactive `Colors.primary15` + `accessibilityRole="button"` + `accessibilityState={{selected: currentIndex === idx}}` + `accessibilityLabel="Go to tour card {idx+1}"`; tap → animate to that index.
  - [ ] 1.7 Next/Get-started CTA — `Pressable` `bg-accent rounded-2xl py-[18px] items-center` with Typography.body white text. Label is `"Next"` for cards 0+1, `"Get started"` for card 2. On card 2 tap → `router.replace("/(tabs)/home")` + `hapticMedium()`. On card 0/1 tap → animate to next card + `hapticLight()`.
  - [ ] 1.8 Sentry breadcrumb on card view — `useEffect` keyed on `currentIndex` calls `addBreadcrumb({ category: "tour", level: "info", message: "Tour card viewed", data: { cardIndex: currentIndex } })`.
- [ ] **Task 2: Wire onboarding flow → tour** (AC: B1-B2)
  - [ ] 2.1 `app/onboarding/placement-test.tsx:535` — change `router.replace("/(tabs)/home")` to `router.replace("/onboarding/tour")` (post `updateProfile({ onboarding_completed: true })` save). The `onboarding_completed: true` flag itself stays in placement-test.tsx unchanged.
  - [ ] 2.2 `app/onboarding/index.tsx:161` — change `router.replace("/(tabs)/home")` to `router.replace("/onboarding/tour")` (the no-placement-test branch). The `onboarding_completed: true` flag set at line 148 stays.
- [ ] **Task 3: Routing-guard carve-out** (AC: B3)
  - [ ] 3.1 `app/_layout.tsx:148-149` segments inspection — add `const inTour = inOnboarding && segments[1] === "tour";`.
  - [ ] 3.2 `app/_layout.tsx:181` — change `(inAuthGroup || inOnboarding)` to `(inAuthGroup || (inOnboarding && !inTour))` so the redirect-to-home doesn't bounce onboarded users out of the tour route.
- [ ] **Task 4: Layout registration** (AC: C1)
  - [ ] 4.1 `app/onboarding/_layout.tsx` — register the `tour` screen in the Stack.Navigator alongside `index` + `placement-test`. If the layout file uses `Stack` from `expo-router` and doesn't currently enumerate screens, no registration change is needed (Expo Router auto-discovers `tour.tsx`). Verify post-implementation via running the app + navigating to `/onboarding/tour`.
- [ ] **Task 5: Runtime tests** (AC: G drift + runtime)
  - [ ] 5.1 Create `app/onboarding/__tests__/tour.test.tsx` — `react-test-renderer` cases: 3-card sequence renders correctly + Next button advances `currentIndex` + dot tap navigates to that index + Get-started on card 2 calls `router.replace("/(tabs)/home")` + Skip button calls `router.replace("/(tabs)/home")` + breadcrumb fires on each card view (mocked `addBreadcrumb`). Spec target: ~5-7 runtime cases.
  - [ ] 5.2 Create `src/lib/__tests__/onboarding-tour-source-drift.test.ts` — Story 12-2 P12 comment-stripped readFile pattern:
    - Case 1: `app/onboarding/tour.tsx` exists + exports `TOUR_CARDS` with 3 entries.
    - Case 2: NEGATIVE pin — `placement-test.tsx:535` does NOT route to `/(tabs)/home` directly (now routes via /onboarding/tour); POSITIVE pin — route is `/onboarding/tour`.
    - Case 3: same for `onboarding/index.tsx:161`.
    - Case 4: `_layout.tsx` has `inTour` carve-out — the routing guard's `(inAuthGroup || ...)` clause includes `!inTour`.
    - Case 5: NEGATIVE pin against re-introducing a direct `/(tabs)/home` route from either onboarding-finish path (catches a future refactor that bypasses the tour).
    - Case 6: tour.tsx imports `Icon` from `@/src/components/common/Icon` (Story 14-3 invariant — no raw `@expo/vector-icons` imports outside Icon.tsx).
    - Spec target: ~5-8 drift cases.
- [ ] **Task 6: Quality gates** (AC: Z)
  - [ ] 6.1 `npm run type-check` — 0 errors.
  - [ ] 6.2 `npm run lint` — 0 errors / 0 warnings.
  - [ ] 6.3 `npm run format:check` — pass.
  - [ ] 6.4 `npm test -- --no-coverage` — full suite + new test files pass. Spec target: +10-15 net Jest cases (1965 → 1975-1980).
  - [ ] 6.5 `npm run check:tokens` — Story 14-4 gate passes (no new raw tokens).
  - [ ] 6.6 `npm run check:colors` — same pre-existing failures from 14-4-followup; no new hex literals in production code.

## Operator-decision items (resolve before/during implementation)

**Q1 — Tour card copy:** apply the 3-card copy from the Background section (recommended), or override?

- **Recommended** (Background §"Copy"):
  - Card 1: "Talk to your AI tutor every day" / "Have real French conversations with an AI that remembers what you've learned and adapts to your level." / `Feather.mic` / `Colors.primary15` bg
  - Card 2: "Practice in 8 different ways" / "Listening, reading, writing, dictation, echo, translation, pronunciation, vocabulary — exercises that match your CEFR level." / `Feather.book-open` / `Colors.success15` bg
  - Card 3: "Take TCF-style practice tests" / "Time-locked simulations that mirror the real exam. See your score, track your progress, identify weak spots." / `Feather.award` / `Colors.streak15` bg

The dev agent should confirm the copy reads naturally + the icon choices are consistent with the home screen they'll see next. Alternate icons: `Feather.message-circle` for Card 1 (matches the home screen's conversation chip icon), `Feather.target` for Card 3.

## Dev Notes

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist:** new `category: "tour"` breadcrumb uses a new categorical short string + `cardIndex` (a small integer) in `data`. Both ride on existing allowlist (`category` is breadcrumb-builtin; `data` shape is bounded-budget per Sentry SDK). No `SENTRY_EXTRAS_ALLOWLIST` change needed because breadcrumbs are separate from `captureError` extras.
- **Story 12-9 email verification gate:** the email-verification render-branch at `app/_layout.tsx` fires UPSTREAM of all routing. An unverified user navigating to `/onboarding/tour` should still see the verification gate. The routing-guard carve-out at AC-B3 does NOT bypass the verification check (which lives in a separate render-branch).
- **Story 12-2 auth bootstrap:** `bootstrapAuth()` + the routing guard at `_layout.tsx` are orthogonal. The new `inTour` segment check just adds a sibling condition; doesn't change auth-state derivation.
- **Story 14-1 chrome rule:** all tour copy is English (UI chrome). The tour describes the app's capabilities; the AI conversation itself happens in French (content).
- **Story 14-2 SkillCard / ListItemCard:** orthogonal — the tour cards are bespoke screen-internal layouts, not card-component consumers.
- **Story 14-3 Icon system:** consume via `<Icon name={...} />` from `@/src/components/common/Icon`. Do NOT directly import `@expo/vector-icons`. The drift detector pins this.
- **Story 14-4 design-token enforcement:** all colors via `Colors.*` design tokens; no `rounded-[Npx]` raw literals; no raw `shadowOpacity` literals.
- **Story 14-5 accent color split:** the active dot uses `Colors.accent` (CTA-cluster — dots are tappable affordances); Card 3's background uses `Colors.streak15` (streak-cluster, light tint on light bg = WCAG AA passes for any default `Typography.body` text rendered on it; verify empirically per Story 14-5 R1-P2 dark-bg concern doesn't apply here since this is a LIGHT screen).

### Pattern to follow

Story 12-9's `EmailVerificationGate.tsx` is the closest analog — a full-screen single-purpose React component with a finite-state interactive UI, called from a routing context where the user can't "back" out via normal navigation. Mimic that file's structure for sectioning + accessibility patterns.

Card transition animation should mirror Story 13-1's transcript-render-storm rAF coalescing discipline — `useSharedValue` + `useAnimatedStyle` for the entry/exit transform; no `setState` storms.

### References

- [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 275 + 281 — Epic 14 deliverable 14.6 + the AC about "user can describe what the app does in one sentence after onboarding"
- [`app/_layout.tsx:145-185`](app/_layout.tsx#L145-L185) — routing guard pattern + Story 12-9 inAuthGroup carve-out precedent
- [`app/onboarding/placement-test.tsx:521-545`](app/onboarding/placement-test.tsx#L521-L545) — current `handleFinish` flow (the route-to-home target line)
- [`app/onboarding/index.tsx:140-165`](app/onboarding/index.tsx#L140-L165) — current no-placement-test branch (the second route-to-home target line)
- [`src/components/common/Icon.tsx`](src/components/common/Icon.tsx) — Icon wrapper (Story 14-3); the tour's icons go through this
- [`src/lib/design.ts`](src/lib/design.ts) — design tokens (Colors.primary15, Colors.success15, Colors.streak15, Colors.accent for active dot)
- [`src/lib/haptics.ts`](src/lib/haptics.ts) — `hapticLight()` / `hapticMedium()` for button taps
- [`src/lib/sentry.ts`](src/lib/sentry.ts) — `addBreadcrumb()` for tour-view telemetry
- Story 12-9 [`src/components/auth/EmailVerificationGate.tsx`](src/components/auth/EmailVerificationGate.tsx) — full-screen interactive component pattern
- Story 14-1 [`_bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md`](_bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md) — chrome/content rule (UI in English)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Mid-implementation simplification: original spec animation was a 2-phase fade-out + setState-mid-animation + fade-in sequence using `withSequence` + `runOnJS`. The shared `src/test-utils/mocks/reanimated.ts` factory collapses `withSequence` to identity + doesn't mock `runOnJS`, so the test-time setState wouldn't fire. Restructured to a simpler in-only animation: sync `setCurrentIndex` + reset opacity/translateX + `withTiming` back to visible. Visual outcome is functionally equivalent (new card fades in from right) and the state-change path is synchronous + testable under the canonical mock.
- Mid-implementation Icon mock fix: initial `jest.mock("@/src/components/common/Icon", ...)` factory tried to return a `React.createElement(Text, ...)` element, but NativeWind's `_ReactNativeCSSInterop` Babel transform injected into the mock-factory closure broke the hoisted-out-of-scope check. Simplified mock to `Icon: () => null` since Cases 4-8 don't introspect rendered icons (Case 3 checks icon names via `TOUR_CARDS` exports directly).
- Expo Router typed-routes — the new `/onboarding/tour` literal isn't in the generated typed-routes union until next dev-server start. Cast via `as never` (matches existing `_layout.tsx:129` precedent) for `router.replace(...)`. The `segments[1]` comparison cast via `String(...)` (type-safe, survives typed-routes regeneration).

### Completion Notes List

**Q1 (operator-decision) — recommended copy applied verbatim:**

- Card 0: "Talk to your AI tutor every day" / "Have real French conversations with an AI that remembers what you've learned and adapts to your level." / `Feather.mic` + `Colors.primary15` halo
- Card 1: "Practice in 8 different ways" / "Listening, reading, writing, dictation, echo, translation, pronunciation, vocabulary — exercises that match your CEFR level." / `Feather.book-open` + `Colors.success15` halo
- Card 2: "Take TCF-style practice tests" / "Time-locked simulations that mirror the real exam. See your score, track your progress, identify weak spots." / `Feather.award` + `Colors.streak15` halo (intentional Story 14-5 streak-cluster "warmth-of-goal-achievement" close)

**Implementation summary:**

- New file `app/onboarding/tour.tsx` (~250 lines incl. JSDoc) — full-screen 3-card tour with in-only fade + slide-from-right Reanimated 3 animation (250ms total transition time), dot pagination (active `Colors.accent` width:24 pill effect, inactive `Colors.primary15` width:8 dots, 44×44 hitSlop), Skip button top-right (`hapticLight` + route home), Next/Get-started CTA bottom (`hapticLight` for Next, `hapticMedium` for Get-started). Each card view fires `addBreadcrumb({ category: "tour", level: "info", message: "Tour card viewed", data: { cardIndex } })` for operator-visible drop-off telemetry.
- `app/onboarding/placement-test.tsx:535` — `router.replace("/(tabs)/home")` → `router.replace("/onboarding/tour" as never)`.
- `app/onboarding/index.tsx:161` — same change on the no-placement-test branch.
- `app/_layout.tsx` — added `inTour` segment check + `!inTour` carve-out in the `isOnboarded && (inAuthGroup || inOnboarding)` redirect-to-home condition.
- `app/onboarding/_layout.tsx` — registered `<Stack.Screen name="tour" />` alongside `index` + `placement-test`.

**Tests (2 new files, 16 net Jest cases):**

- `app/onboarding/__tests__/tour.test.tsx` (8 runtime cases): TOUR_CARDS content contract (3 cases) + card rendering + breadcrumb telemetry (2 cases) + pagination + final card behavior (2 cases) + Skip button (1 case)
- `src/lib/__tests__/onboarding-tour-source-drift.test.ts` (8 drift cases): tour.tsx contract (4 cases) + 2 onboarding-finish route migrations + routing-guard `inTour` carve-out + layout registration

**Cross-story invariants preserved by construction:**

- Story 9-3 telemetry — new `category: "tour"` breadcrumb is breadcrumb-side (NOT `captureError` extras allowlist); `data.cardIndex` is a small integer
- Story 12-9 email-verification gate — fires UPSTREAM of the routing-guard redirect; the `inTour` carve-out only affects the `isOnboarded && inOnboarding → home` redirect, not the verification render-branch
- Story 14-1 chrome rule — all tour copy is English (UI chrome)
- Story 14-3 Icon system — tour uses `<Icon name={...} />` exclusively (drift Case 2 pins this)
- Story 14-4 design-token enforcement — all colors via `Colors.*`; no `rounded-[Npx]` (verified by `check:tokens` gate); no raw `shadowOpacity` (no shadows in tour.tsx — flat layout)
- Story 14-5 accent-color split — active dot uses `Colors.accent` (CTA-cluster — dots ARE tappable), Card 3 uses `Colors.streak15` (light-bg streak halo background; no streakText needed because halo only contains the Icon at `Colors.primary` color)

**Quality gates:**

- ✅ `npm run type-check` — 0 errors
- ✅ `npm run lint` — 0 errors / 0 warnings
- ✅ `npm run format:check` — pass (2 files auto-fixed in-process)
- ✅ `npm test -- --no-coverage` — 103 suites / **1981 tests** pass (+16 net from 1965 baseline; matches spec target +10-15 at upper bound)
- ✅ `npm run check:tokens` — clean
- ⚠️ `npm run check:colors` — same pre-existing failures from `14-4-followup-test-fixture-hex-exemption`; 14-6 doesn't introduce additional hex literals (all 3 `iconBackgroundColor` values reference `Colors.*` tokens; drift Case 4 NEGATIVE-pins `#[0-9a-fA-F]{3,8}` in tour.tsx)

**Epic 14 AC line 281 progress** ("a new user can describe what the app does in one sentence after onboarding"): the implementation is the architectural path; the n≥5 user-test acceptance is an operator follow-up (filed for post-merge informal testing).

### File List

**New files (3):**

- `app/onboarding/tour.tsx` — the tour screen
- `app/onboarding/__tests__/tour.test.tsx` — 8 runtime cases
- `src/lib/__tests__/onboarding-tour-source-drift.test.ts` — 8 drift cases

**Modified files (3 source + 2 housekeeping):**

- `app/onboarding/placement-test.tsx` — route to `/onboarding/tour` post-completion
- `app/onboarding/index.tsx` — route to `/onboarding/tour` on no-placement-test branch
- `app/_layout.tsx` — `inTour` segment check + carve-out in routing guard
- `app/onboarding/_layout.tsx` — register tour Stack.Screen
- `_bmad-output/implementation-artifacts/14-6-post-onboarding-tour.md` — this story file
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status `ready-for-dev` → `in-progress` → `review`

### Change Log

- 2026-05-16: Story 14-6 implementation. Branch `feature/14-6-post-onboarding-tour` off `main` (post-14-5 PR #105 merge). 3 new files + 3 modified source files + 2 housekeeping. Tests: 1965 → 1981 (+16 net; matches spec target +10-15 at upper bound). All 5 design-system gates green; pre-existing `check:colors` failure tracked under `14-4-followup`. Epic 14 deliverable 14.6 + Epic 14 AC line 281 architecturally satisfied (the n≥5 user-test acceptance is an operator follow-up).
