# Story 5.2: Exercise Score Framing & Tab Badge Indicators

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner completing exercises and navigating the app,
I want consistent, encouraging score feedback and visual indicators showing what needs my attention,
So that I never feel punished by scores and always know where to go next.

## Acceptance Criteria

### A. Standardized Score Framing

1. **AC-A1:** Given a user completing any exercise (listening, reading, writing, grammar, dictation, pronunciation), when the score is displayed, then the feedback label and color follow the standardized framing:
   - 90-100%: "Excellent!" in `Colors.success`
   - 80-89%: "Great job!" in `Colors.success`
   - 70-79%: "Good work!" in `Colors.accent`
   - 60-69%: "Keep going!" in `Colors.accent`
   - 50-59%: "Almost there!" in `Colors.primary`
   - Below 50%: "Keep practicing!" in `Colors.primary`
   And the label never uses "Failed," "Wrong," or "Poor."

2. **AC-A2:** Given a user scoring 80% or above, when haptic feedback fires, then `hapticSuccess()` is used. Given a user scoring below 80%, when haptic feedback fires, then `hapticLight()` is used -- never `hapticError()` on scores.

3. **AC-A3:** Given every ScoreCard displayed after exercises, when the actions render, then both "Try Again" and "Back" buttons are always present.

### B. Tab Badge Indicators

4. **AC-B1:** Given the tab bar on the main app, when the user has SRS vocabulary cards due for review, then a number badge appears on the Practice tab showing the due card count.

5. **AC-B2:** Given the tab bar on the main app, when the companion has context from recent user activity (e.g., new error patterns detected in conversations, new companion memories stored), then an amber dot badge appears on the Talk tab.

6. **AC-B3:** Given the tab badges, when the user addresses the badged item (reviews vocab, starts a conversation), then the badge clears or updates its count.

### C. Cross-Screen Consistency

7. **AC-C1:** Given all score framing changes, when applied across exercise screens, then the standardized labels and haptics are consistent in listening, reading, writing, grammar, dictation, and pronunciation screens.

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

- [x] Task 1: Extract score framing utilities into shared module (AC: A1, C1)
  - [x] 1.1 Create `src/lib/score-framing.ts` exporting `getScoreLabel(score: number): string` and `getScoreColor(score: number): string` with the standardized thresholds:
    - `getScoreColor`: >=80 → `Colors.success`, >=60 → `Colors.accent`, else → `Colors.primary` (NOTE: current ScoreCard uses `Colors.error` for <60 -- change to `Colors.primary` per spec)
    - `getScoreLabel`: >=90 "Excellent!", >=80 "Great job!", >=70 "Good work!", >=60 "Keep going!", >=50 "Almost there!", else "Keep practicing!"
  - [x] 1.2 Export `fireScoreHaptic(score: number): void` -- calls `hapticSuccess()` for >=80, `hapticLight()` for <80

- [x] Task 2: Update ScoreCard to use shared utilities (AC: A1, A2, A3)
  - [x] 2.1 In `src/components/practice/ScoreCard.tsx`, replace local `getScoreColor` and `getScoreLabel` functions with imports from `@/src/lib/score-framing`
  - [x] 2.2 Replace unconditional `hapticSuccess()` in `useEffect` with `fireScoreHaptic(score)` from the shared module
  - [x] 2.3 Verify "Back" and "Try Again" buttons are both present (they already are -- no change needed, just verify)
  - [x] 2.4 Replace the hardcoded `text-[22px]` on the score label with `Typography.sectionHeader` or equivalent design token
  - [x] 2.5 Replace the score circle's `fontSize: 40` with `Typography.bigNumber.fontSize` (or create a token if needed)
  - [x] 2.6 Replace `Colors.gray700` text color with `Colors.textSecondary`

- [x] Task 3: Update pronunciation score display (AC: A1, A2, C1)
  - [x] 3.1 In `app/(tabs)/practice/pronunciation.tsx`, remove the local `getScoreColor` (line 46) and `getScoreLabel` (line 52) functions
  - [x] 3.2 Import `getScoreColor`, `getScoreLabel`, `fireScoreHaptic` from `@/src/lib/score-framing`
  - [x] 3.3 Add a `useEffect` that calls `fireScoreHaptic(result.overallScore)` when the result screen appears (pronunciation currently has NO haptic feedback)
  - [x] 3.4 Note: pronunciation uses French labels ("Excellent !", "Très bien !") -- these MUST change to English labels to match the app-wide framing. The app's UI language is English (all other screens use English labels).

- [x] Task 4: Update dictation score display (AC: A1, A2, C1)
  - [x] 4.1 In `app/(tabs)/practice/dictation.tsx`, replace the inline ternary score label (line ~491-497) with `getScoreLabel(d.overallAccuracy)` from the shared module
  - [x] 4.2 Replace inline score color derivation with `getScoreColor(d.overallAccuracy)`
  - [x] 4.3 Add a `useEffect` that calls `fireScoreHaptic(d.overallAccuracy)` when dictation results appear (dictation currently has NO haptic feedback)
  - [x] 4.4 Note: dictation also uses French labels -- change to English to match the standardized framing

- [x] Task 5: Update writing score display (AC: A1, A2, C1)
  - [x] 5.1 In `app/(tabs)/practice/writing.tsx`, check the evaluation score display (lines ~129-190) -- verify it uses the standardized label and color from the shared module for `eval_.overallScore`
  - [x] 5.2 If writing uses hardcoded labels or colors, replace with `getScoreLabel` and `getScoreColor`
  - [x] 5.3 Add haptic feedback via `fireScoreHaptic(eval_.overallScore)` when evaluation results appear

- [x] Task 6: Create tab badge hook (AC: B1, B2, B3)
  - [x] 6.1 Create `src/hooks/use-tab-badges.ts` that exports a hook returning `{ practiceBadge: number | null, talkBadge: boolean }`
  - [x] 6.2 For `practiceBadge`: query `vocabulary` table for items where `next_review <= now()`, count them. Use `cacheWithFallback` from `@/src/lib/cache` with `CACHE_KEYS.SRS_DUE_COUNT` (already defined in cache.ts) and a 15-minute TTL. Return the count (or `null` if 0).
  - [x] 6.3 For `talkBadge`: query `error_patterns` table for recently-created patterns (`created_at > last_conversation_date` OR unresolved count > 0) AND/OR check `companion_memory` for recent entries. A simple heuristic: if the user has unresolved error patterns AND hasn't started a conversation today, show the badge. Return `true`/`false`.
  - [x] 6.4 Expose an `invalidateBadges()` function that clears the cache and refetches -- called when the user starts a conversation (clears talk badge) or reviews vocabulary (updates practice badge)
  - [x] 6.5 Subscribe to Supabase realtime or use a polling interval (60s) to keep badges fresh -- OR just refetch on tab focus using `useFocusEffect` from expo-router

- [x] Task 7: Integrate badges into tab bar (AC: B1, B2, B3)
  - [x] 7.1 In `app/(tabs)/_layout.tsx`, import and call `useTabBadges()` inside `TabLayout`
  - [x] 7.2 Add `tabBarBadge` prop to the Practice tab screen: `tabBarBadge={practiceBadge ?? undefined}` -- Expo Router / React Navigation supports this natively on `Tabs.Screen options`
  - [x] 7.3 Add `tabBarBadge` prop to the Talk tab screen: `tabBarBadge={talkBadge ? "" : undefined}` (empty string = dot badge, or use `tabBarBadge=" "`)
  - [x] 7.4 Style the badges: `tabBarBadgeStyle={{ backgroundColor: Colors.accent, fontSize: 10, fontWeight: "700" }}` for both badges to match the amber theme
  - [x] 7.5 Verify badges clear when the user navigates to the relevant tab and performs the action

- [x] Task 8: Quality gates (AC: Z)
  - [x] 8.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 8.2 Run `scripts/check-hex-colors.sh` -- verify no raw hex values in changed files
  - [x] 8.3 Verify ScoreCard shows correct label/color for scores: 95, 85, 75, 65, 55, 40
  - [x] 8.4 Verify haptic fires `hapticSuccess` for 80+, `hapticLight` for <80
  - [x] 8.5 Verify pronunciation and dictation screens show English labels (no French)
  - [x] 8.6 Verify Practice tab badge shows SRS due count
  - [x] 8.7 Verify Talk tab badge shows amber dot when applicable
  - [x] 8.8 Verify badges clear on user action

## Dev Notes

### This Story Has Two Distinct Parts

**Part A (Tasks 1-5): Score Framing Standardization** -- Extract duplicated score label/color logic into a shared utility and update all 6 exercise screens to use it. This is primarily a refactor.

**Part B (Tasks 6-7): Tab Badge Indicators** -- Add badge support to the existing tab bar. This requires a new hook and wiring into the tab layout.

### Current Score Label/Color Duplication (3 places)

| Location | Labels | Colors | Haptics |
|----------|--------|--------|---------|
| `src/components/practice/ScoreCard.tsx` (lines 22-35) | English, 6 tiers | >=80 success, >=60 accent, else **error** | `hapticSuccess()` always |
| `app/(tabs)/practice/pronunciation.tsx` (lines 46-57) | **French**, 5 tiers (missing 50-59) | >=80 success, >=60 accent, else **error** | **None** |
| `app/(tabs)/practice/dictation.tsx` (lines 491-497) | **French**, 4 tiers (missing 50-59, 70-79) | Inline ternary | **None** |

**Problems to fix:**
1. `getScoreColor` uses `Colors.error` for <60 -- spec says `Colors.primary` (never punish)
2. Pronunciation and dictation use French labels -- app UI is English
3. Pronunciation and dictation have no haptic feedback
4. Writing screen needs verification (may also have duplicated logic)

### Tab Badge Implementation

React Navigation (used by Expo Router `Tabs`) natively supports `tabBarBadge` and `tabBarBadgeStyle` on screen options. No additional libraries needed.

```tsx
<Tabs.Screen
  name="practice"
  options={{
    tabBarBadge: practiceBadge ?? undefined, // number or undefined
    tabBarBadgeStyle: { backgroundColor: Colors.accent, fontSize: 10, fontWeight: "700" },
  }}
/>
```

For the Talk tab "dot" badge, use `tabBarBadge=""` (empty string renders a dot in React Navigation).

### SRS Due Count Already Computed

`src/hooks/use-daily-briefing.ts` already queries `vocabulary` table for `next_review <= now()` at line 276-285 and caches the result under `CACHE_KEYS.SRS_DUE_COUNT`. The tab badge hook should reuse this cache key rather than running a duplicate query. Consider calling the same cache pattern or importing the count from the briefing hook.

### Talk Tab Badge Heuristic

Keep it simple. The "companion has context" condition maps to: user has unresolved error patterns that haven't been addressed in a conversation. Query:

```sql
SELECT count(*) FROM error_patterns
WHERE user_id = $uid AND resolved = false
```

If count > 0 and the user's last conversation was not today → show amber dot. Check last conversation date from the `conversations` table:

```sql
SELECT created_at FROM conversations
WHERE user_id = $uid
ORDER BY created_at DESC LIMIT 1
```

### Screens That Use ScoreCard (No Custom Score UI)

These screens import and render `<ScoreCard>` -- they get the fix automatically when ScoreCard is updated:
- `app/(tabs)/practice/grammar.tsx` (line ~357)
- `app/(tabs)/practice/reading.tsx` (line ~148)
- `app/(tabs)/practice/listening.tsx` (line ~155)

### Screens With Custom Score UI (Need Individual Updates)

These screens render their own score display and need manual updates:
- `app/(tabs)/practice/pronunciation.tsx` -- has local `getScoreColor`/`getScoreLabel` (French)
- `app/(tabs)/practice/dictation.tsx` -- inline ternary (French)
- `app/(tabs)/practice/writing.tsx` -- needs verification

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/score-framing.ts` | **NEW**: shared `getScoreLabel`, `getScoreColor`, `fireScoreHaptic` |
| `src/components/practice/ScoreCard.tsx` | Replace local functions with shared imports, fix haptic logic, replace raw fontSize/colors with design tokens |
| `app/(tabs)/practice/pronunciation.tsx` | Replace local score functions with shared imports, add haptic, switch to English labels |
| `app/(tabs)/practice/dictation.tsx` | Replace inline score ternary with shared imports, add haptic, switch to English labels |
| `app/(tabs)/practice/writing.tsx` | Verify/update score display to use shared module, add haptic |
| `src/hooks/use-tab-badges.ts` | **NEW**: hook computing practice due count + talk badge |
| `app/(tabs)/_layout.tsx` | Import `useTabBadges`, add `tabBarBadge` props to Practice and Talk tabs |

### Files NOT to Modify

- `app/(tabs)/practice/grammar.tsx` -- uses `<ScoreCard>`, auto-fixed
- `app/(tabs)/practice/reading.tsx` -- uses `<ScoreCard>`, auto-fixed
- `app/(tabs)/practice/listening.tsx` -- uses `<ScoreCard>`, auto-fixed
- `src/hooks/use-daily-briefing.ts` -- SRS query already exists, reuse cache key
- `src/lib/cache.ts` -- `CACHE_KEYS.SRS_DUE_COUNT` already defined
- Database schema / migrations -- no changes needed

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function/Module | Import Path | Usage |
|-----------------|-------------|-------|
| `Colors`, `Typography`, `Radii`, `skillTint` | `@/src/lib/design` | All design tokens |
| `hapticSuccess`, `hapticLight` | `@/src/lib/haptics` | Score-dependent haptics |
| `captureError` | `@/src/lib/sentry` | Error reporting in catch blocks |
| `supabase` | `@/src/lib/supabase` | Database queries for badge data |
| `cacheWithFallback`, `CACHE_KEYS`, `invalidateCache` | `@/src/lib/cache` | SRS due count caching (already keyed) |
| `useAuthStore` | `@/src/store/auth-store` | User ID for queries |
| `ScoreCard` | `@/src/components/practice/ScoreCard` | Shared score display (grammar, reading, listening) |

### Anti-Patterns to Avoid

- Do NOT duplicate the SRS due count query -- reuse `CACHE_KEYS.SRS_DUE_COUNT` from `src/lib/cache.ts`
- Do NOT keep French labels in pronunciation or dictation -- the app UI language is English everywhere
- Do NOT use `hapticError()` on any score result -- even sub-50% scores should use `hapticLight()`
- Do NOT use `Colors.error` for low scores -- use `Colors.primary` (the spec prohibits punitive coloring)
- Do NOT install a third-party badge library -- React Navigation's `tabBarBadge` handles this natively
- Do NOT create a Zustand store for badge state -- a hook with `useState` + cache is sufficient
- Do NOT modify the grammar/reading/listening screens -- they use `<ScoreCard>` and get the fix transitively
- Do NOT hardcode hex colors or raw fontSize -- use `Colors.*` and `Typography.*`
- Do NOT use `ActivityIndicator` -- project-wide rule

### Previous Story Intelligence (from Story 5-1)

- Branch naming: `feature/5-2-exercise-score-framing-tab-badge-indicators`
- Commit prefix: `feat(story-5-2):` for feature work, `chore:` for status updates
- ESLint import order enforced: react → react-native → expo → external → `@/` internal
- Hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/`
- Toast system is now available via `useToast()` -- consider using it to confirm badge-related actions (optional, not required)
- `PanResponder` was used instead of `react-native-gesture-handler` in story 5-1 because gesture handler is not installed
- Root layout structure in `app/_layout.tsx`: `AppErrorBoundary > ToastProvider > View > [NetworkBanner, ToastContainer, Stack]`

### Project Structure Notes

- New shared utility `src/lib/score-framing.ts` follows existing pattern (`src/lib/scoring.ts`, `src/lib/haptics.ts`)
- New hook `src/hooks/use-tab-badges.ts` follows existing hook pattern (`src/hooks/use-daily-briefing.ts`)
- Path alias `@/*` maps to repo root
- All components remain in their current locations

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2 -- BDD acceptance criteria (lines 1110-1154)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Exercise Score Feedback -- framing table (lines 1307-1322)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Tab Navigation -- badge spec (line 1361)]
- [Source: src/components/practice/ScoreCard.tsx -- current score display with local getScoreColor/getScoreLabel]
- [Source: app/(tabs)/practice/pronunciation.tsx -- local French getScoreLabel/getScoreColor (lines 46-57)]
- [Source: app/(tabs)/practice/dictation.tsx -- inline French score ternary (lines 491-497)]
- [Source: app/(tabs)/_layout.tsx -- current tab configuration with no badges]
- [Source: src/lib/cache.ts -- CACHE_KEYS.SRS_DUE_COUNT already defined (line 346)]
- [Source: src/hooks/use-daily-briefing.ts -- SRS due count query pattern (lines 276-285)]
- [Source: _bmad-output/implementation-artifacts/5-1-toast-notification-system.md -- previous story intelligence]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Writing `useEffect` for haptic was initially placed after an early return — moved before conditional returns to satisfy React hooks rules-of-hooks lint rule
- `Colors.error` was used for sub-60% scores in ScoreCard and pronunciation — changed to `Colors.primary` per spec (never punitive)
- Pronunciation and dictation had French labels — standardized to English
- Writing score display had no label at all — added `getScoreLabel` with `Typography.subsectionHeader`
- Dictation used template literal `${color}10` for background alpha — replaced with `skillTint(color, 0.06)`

### Completion Notes List

- **Task 1:** Created `src/lib/score-framing.ts` with `getScoreLabel`, `getScoreColor`, `fireScoreHaptic`. Color thresholds: >=80 success, >=60 accent, <60 primary (not error).
- **Task 2:** Updated ScoreCard — replaced local functions with shared imports, fixed haptic to be score-dependent (`fireScoreHaptic`), replaced raw `fontSize: 40` with `Typography.scoreDisplay`, raw `text-[22px]` with `Typography.subsectionHeader`, `Colors.gray700` with `Colors.textSecondary`.
- **Task 3:** Updated pronunciation — removed local French `getScoreColor`/`getScoreLabel`, imported shared English versions, added `fireScoreHaptic` useEffect on result display, updated score circle to use `Typography.bigNumber`.
- **Task 4:** Updated dictation — replaced inline French ternary with `getScoreLabel`, replaced inline color derivation with `getScoreColor`, replaced per-sentence color with `getScoreColor`, added `fireScoreHaptic` useEffect on results, fixed background alpha to use `skillTint`.
- **Task 5:** Updated writing — added `getScoreColor` for score circle border (was inline ternary with `Colors.error`), added `getScoreLabel` text below score circle, added `fireScoreHaptic` useEffect, replaced `Colors.gray700` with `Colors.textSecondary`.
- **Task 6:** Created `src/hooks/use-tab-badges.ts` — practice badge queries vocabulary `next_review <= now()` with 15min cache TTL (reuses `CACHE_KEYS.SRS_DUE_COUNT`), talk badge checks unresolved error patterns + no conversation today.
- **Task 7:** Updated `app/(tabs)/_layout.tsx` — added `useTabBadges` hook, `tabBarBadge` on Practice (number) and Talk (dot), amber `badgeStyle`.
- **Task 8:** All quality gates pass: type-check, lint, format:check, hex color check.

### Change Log

- 2026-03-28: Implemented score framing standardization and tab badge indicators (Tasks 1-8)

### File List

- `src/lib/score-framing.ts` — NEW: shared getScoreLabel, getScoreColor, fireScoreHaptic utilities
- `src/components/practice/ScoreCard.tsx` — MODIFIED: replaced local functions with shared imports, score-dependent haptic, Typography tokens
- `app/(tabs)/practice/pronunciation.tsx` — MODIFIED: removed local French helpers, imported shared English versions, added haptic, Typography tokens
- `app/(tabs)/practice/dictation.tsx` — MODIFIED: replaced French labels/inline colors with shared module, added haptic, fixed background alpha
- `app/(tabs)/practice/writing.tsx` — MODIFIED: added score label, shared color, haptic feedback
- `src/hooks/use-tab-badges.ts` — NEW: hook computing SRS due count and talk badge
- `app/(tabs)/_layout.tsx` — MODIFIED: added tab badge integration via useTabBadges hook
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status updated
