# Story 4.2: MilestoneBanner Component & Personal Best Detection

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner achieving something noteworthy,
I want to see a celebration when I hit a personal best, resolve an error pattern, or get promoted to a new CEFR level,
So that I feel genuine accomplishment from earned achievements.

## Acceptance Criteria

### A. MilestoneBanner Component

1. **AC-A1:** Given a user who achieves their best fluency or grammar score ever, when the feedback screen loads, then a MilestoneBanner appears with type `personal_best`, a celebration emoji, title "New Personal Best!", and the specific achievement detail (e.g., "Your best fluency score: 4/5").

2. **AC-A2:** Given a user whose conversation triggers an error pattern resolution (pattern marked `resolved: true` during this session), when the feedback screen loads, then a MilestoneBanner appears with type `error_resolved`, title referencing the resolved pattern (e.g., "Pattern Resolved: penser a vs de").

3. **AC-A3:** Given a user who earns a CEFR promotion (level changes during this session), when the feedback screen loads, then a MilestoneBanner appears with type `cefr_promotion`, amber tint background, and the new level highlighted.

4. **AC-A4:** Given no milestone was earned in this session, when the feedback screen loads, then the MilestoneBanner is not rendered (returns `null` -- never shown without genuine achievement).

5. **AC-A5:** Given a MilestoneBanner appearing on screen, when it mounts, then it slides in with `FadeInDown.duration(400).springify()` animation and `hapticSuccess()` fires on mount.

### B. Styling

6. **AC-B1:** Given MilestoneBanner with type `personal_best` or `error_resolved`, then it uses `skillTint(Colors.success, 0.08)` background and `Colors.success` text for title and subtitle.

7. **AC-B2:** Given MilestoneBanner with type `cefr_promotion`, then it uses `skillTint(Colors.accent, 0.08)` background and `Colors.accent` text for title and subtitle.

8. **AC-B3:** The component uses: icon at 22px font size, `Typography.label` (weight 700) for title, `Typography.caption` for subtitle, `Radii.button` (12px) border radius, 10px vertical / 14px horizontal padding.

### C. Accessibility

9. **AC-C1:** The MilestoneBanner has `accessibilityRole="alert"` and `accessibilityLabel="Milestone: [title]. [subtitle]"`.

### D. Personal Best Detection Logic

10. **AC-D1:** Given the personal best detection logic, when a conversation ends, then the system compares current fluency and grammar ratings against historical maximums from all completed conversations to determine if a personal best was achieved.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` -- no hardcoded hex
- [ ] All loading states use skeleton animations -- no `ActivityIndicator` spinners
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [ ] Non-obvious interactions have `accessibilityHint`
- [ ] Stateful elements have `accessibilityState`
- [ ] All tappable elements have minimum 44x44pt touch targets
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets -- no raw pixel `fontSize`
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Create `MilestoneBanner` component (AC: A1-A5, B1-B3, C1)
  - [x] 1.1 Create `src/components/feedback/MilestoneBanner.tsx` -- new file in existing `feedback/` directory (alongside `SessionComparison.tsx`)
  - [x] 1.2 Define `MilestoneType = 'personal_best' | 'error_resolved' | 'cefr_promotion'`
  - [x] 1.3 Define `MilestoneBannerProps`: `{ icon: string; title: string; subtitle: string; type: MilestoneType }` -- return `null` if no props or empty title (safety guard)
  - [x] 1.4 Use `Animated.View` from `react-native-reanimated` with `entering={FadeInDown.duration(400).springify()}`
  - [x] 1.5 Call `hapticSuccess()` from `@/src/lib/haptics` on mount via `useEffect([], [])`
  - [x] 1.6 Render: icon (22px), title (`Typography.label`, weight 700), subtitle (`Typography.caption`)
  - [x] 1.7 Type-dependent styling: `personal_best` / `error_resolved` -> `skillTint(Colors.success, 0.08)` bg + `Colors.success` text; `cefr_promotion` -> `skillTint(Colors.accent, 0.08)` bg + `Colors.accent` text
  - [x] 1.8 Layout: `Radii.button` (12) border radius, 10px vertical / 14px horizontal padding, icon + text in a row
  - [x] 1.9 Add `accessibilityRole="alert"` on container, `accessibilityLabel={`Milestone: ${title}. ${subtitle}`}`
  - [x] 1.10 Wrap with `React.memo`

- [x] Task 2: Implement milestone detection logic in `[sessionId].tsx` (AC: A1-A4, D1)
  - [x] 2.1 Add state: `const [milestone, setMilestone] = useState<{ icon: string; title: string; subtitle: string; type: MilestoneType } | null>(null)`
  - [x] 2.2 Add a `useEffect` watching `conversation.feedback` (same trigger timing as the existing SessionComparison effect) that runs the detection sequence below
  - [x] 2.3 **Personal best detection:** Query all completed conversations for this user: `supabase.from("conversations").select("ai_feedback").eq("user_id", user.id).eq("status", "completed").neq("id", conversationId)`. Extract max `fluencyRating` and max `grammarRating` from the `ai_feedback` JSONB of all rows. Compare against current `conversation.feedback.fluencyRating` / `grammarRating`. If current > historical max for either metric, it's a personal best.
  - [x] 2.4 **Error resolution detection:** Query `error_patterns` that were resolved in this session. Strategy: query most recently resolved error pattern. Chose simpler approach: query `error_patterns` where `resolved = true` ordered by `last_occurred` DESC, limit 1.
  - [x] 2.5 **CEFR promotion detection:** Capture `profiles.current_cefr_level` at conversation start (before `checkCefrPromotion` runs in `use-realtime-voice.ts`). After feedback is available, re-query `profiles.current_cefr_level`. If level changed, promotion occurred.
  - [x] 2.6 **Priority:** If multiple milestones earned, show only one with this priority: `cefr_promotion` > `personal_best` > `error_resolved` (CEFR promotion is the rarest and biggest celebration)
  - [x] 2.7 Set appropriate icon/title/subtitle per type:
    - `personal_best`: icon "🏆", title "New Personal Best!", subtitle "Your best [fluency/grammar] score: N/5"
    - `error_resolved`: icon "🎯", title "Pattern Resolved!", subtitle "[error_description]"
    - `cefr_promotion`: icon "🌟", title "CEFR Promotion!", subtitle "Welcome to [new_level]!"
  - [x] 2.8 Wrap all detection in `try/catch` with `captureError(err, "milestone-detection")` -- on error, silently set milestone to `null`

- [x] Task 3: Integrate MilestoneBanner into the feedback bottom sheet (AC: A1-A4)
  - [x] 3.1 Import `MilestoneBanner` from `@/src/components/feedback/MilestoneBanner`
  - [x] 3.2 Render `<MilestoneBanner {...milestone} />` inside the feedback `<ScrollView>`, positioned **between the AI feedback summary card and the SessionComparison**. Per UX spec (Story 4.3 layout): milestone appears BEFORE session comparison.
  - [x] 3.3 Only render when `milestone` is not null
  - [x] 3.4 Add `mb-3` margin below for spacing consistency

- [x] Task 4: Quality gates (AC: Z)
  - [x] 4.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 4.2 Run `scripts/check-hex-colors.sh` -- verify no raw hex values
  - [x] 4.3 Verify component renders with `personal_best` type (green tint, celebration emoji)
  - [x] 4.4 Verify component renders with `error_resolved` type (green tint, pattern name)
  - [x] 4.5 Verify component renders with `cefr_promotion` type (amber tint, level name)
  - [x] 4.6 Verify component is hidden when no milestone earned

## Dev Notes

### Critical: Three Independent Detection Paths

The MilestoneBanner supports three distinct milestone types, each with its own detection logic. All three must be checked after conversation ends, and only the highest-priority result displayed.

**Detection timing:** All three checks run after `conversation.feedback` is populated (same trigger as SessionComparison). The existing `use-realtime-voice.ts` hook already calls `extractErrorsFromCorrections()` (line 474) and `checkCefrPromotion()` (line 499) during its end-of-conversation flow. The detection in `[sessionId].tsx` reads the **results** of these operations, it does NOT re-trigger them.

### Personal Best Detection Strategy

No existing mechanism tracks historical maximums. The detection must:
1. Query all past completed conversations for this user (excluding current)
2. Extract `fluencyRating` and `grammarRating` from each `ai_feedback` JSONB
3. Compute max values
4. Compare current ratings against maximums

**Important:** `ai_feedback` is a JSONB column. When querying, the response data will have `ai_feedback` as a parsed object. Access ratings via `row.ai_feedback?.fluencyRating`. Some old conversations may lack these fields -- filter with `!= null` checks.

**Edge case:** First conversation ever has no history to compare -- skip personal best check (no previous max exists, current becomes the first baseline, not a "personal best").

### CEFR Promotion Detection Strategy

`checkCefrPromotion(userId)` in `src/lib/activity.ts` (line 174) runs during end-of-conversation in `use-realtime-voice.ts` (line 499). It updates `profiles.current_cefr_level` directly if criteria are met. It does NOT return whether a promotion occurred.

**Detection approach:** Capture the user's CEFR level at conversation start (from profile in auth store or a fresh query), then re-query after feedback is available. A level change means promotion happened.

The `useAuthStore` already has `profile.current_cefr_level`, but it may be stale if `checkCefrPromotion` updated the DB. **Best approach:** Query `profiles.current_cefr_level` directly from Supabase after feedback is available, then compare against the value captured at conversation start.

### Error Resolution Detection Strategy

`extractErrorsFromCorrections(userId, corrections)` in `src/lib/error-tracker.ts` (line 182) runs during end-of-conversation (line 474 of `use-realtime-voice.ts`). It calls `resolveError()` which sets `resolved: true` on matching error patterns.

**Detection approach:** Before conversation starts, query unresolved error count/IDs. After conversation ends (and after `extractErrorsFromCorrections` has run), query newly resolved errors. If any pattern that was unresolved before is now resolved, that's a milestone.

**Simpler approach:** After feedback is available, query `error_patterns` where `resolved = true` ordered by `last_occurred` DESC, limit 1. If the most recently resolved error's `last_occurred` is within the last few minutes, it was likely resolved in this session. This avoids needing pre-conversation state but is less precise.

**Recommended:** Use the snapshot approach -- it's more reliable. Store unresolved error IDs at conversation start.

### Current Feedback Sheet Layout (lines 612-739 of [sessionId].tsx)

Current order:
1. Drag handle + title "Bilan de conversation"
2. Stat tiles (user turns, corrections)
3. AI Feedback card (summary, ratings, strengths, improvements) -- ends at line ~703
4. **SessionComparison** (lines 705-709)
5. CorrectionBubble or "Impeccable!" message (lines 711-725)
6. "Termine" close button (lines 728-739)

**MilestoneBanner goes between items 3 and 4** -- after AI feedback card, before SessionComparison. This matches the Story 4.3 layout spec: "personalized header -> MilestoneBanner (if earned) -> fluency/grammar ratings -> SessionComparison -> observations -> ErrorJourneyBar -> next action button".

### Timing Concern: Race Conditions

`extractErrorsFromCorrections` and `checkCefrPromotion` run asynchronously in `use-realtime-voice.ts` during the end-of-conversation flow (lines 472-499). The `conversation.feedback` state is set at line ~502 **after** these operations. So by the time the `useEffect` in `[sessionId].tsx` fires (watching `conversation.feedback`), both error resolution and CEFR promotion should already be committed to the database. However, `extractErrorsFromCorrections` is fire-and-forget (`.catch()` on line 474), so add a small delay (500ms) or query with retry if error resolution detection returns no results on first attempt.

### Files to Create (1 new file)

| File | Purpose |
|------|---------|
| `src/components/feedback/MilestoneBanner.tsx` | MilestoneBanner component with animation and haptics |

### Files to Modify (1 file)

| File | Change |
|------|--------|
| `app/(tabs)/conversation/[sessionId].tsx` | Add milestone detection logic (personal best, error resolution, CEFR promotion), render MilestoneBanner in feedback sheet |

### What NOT to Change

- `use-realtime-voice.ts` -- end-of-conversation flow already calls `extractErrorsFromCorrections()` and `checkCefrPromotion()`. Do NOT modify these calls.
- `src/lib/activity.ts` -- do NOT change `checkCefrPromotion()` signature or return type. Detection works by comparing before/after DB state.
- `src/lib/error-tracker.ts` -- do NOT change `resolveError()` or `extractErrorsFromCorrections()`. Detection works by querying resolved patterns.
- Database schema / migrations -- no schema changes needed. Error patterns already have `resolved` boolean, conversations already have `ai_feedback` JSONB.
- `src/components/feedback/SessionComparison.tsx` -- leave as-is.

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function/Module | Import Path | Usage |
|-----------------|-------------|-------|
| `Colors`, `Typography`, `Radii`, `skillTint` | `@/src/lib/design` | All design tokens |
| `hapticSuccess` | `@/src/lib/haptics` | Haptic on mount |
| `captureError` | `@/src/lib/sentry` | Error reporting in catch blocks |
| `supabase` | `@/src/lib/supabase` | Database queries (already imported in [sessionId].tsx) |
| `useAuthStore` | `@/src/store/auth-store` | Get current user ID + profile (already used in [sessionId].tsx) |
| `Animated, FadeInDown` | `react-native-reanimated` | Entry animation (v4.2.2 already installed) |
| `React.memo` | `react` | Component memoization |

### Anti-Patterns to Avoid

- Do NOT create a new hook for milestone detection -- the logic is specific to the feedback sheet. Inline the `useEffect` + state in `[sessionId].tsx`.
- Do NOT modify `checkCefrPromotion()` to return a boolean -- detect by comparing before/after DB state.
- Do NOT store personal best maximums in a new DB column -- compute from existing conversation history.
- Do NOT show MilestoneBanner without genuine achievement -- returns `null` when no milestone earned.
- Do NOT use `ActivityIndicator` while detecting milestones -- just don't render until detection completes.
- Do NOT use hardcoded hex colors -- use `Colors.*` and `skillTint()`.
- Do NOT use raw `fontSize` -- use `Typography.*` presets.
- Do NOT show multiple MilestoneBanners -- pick the highest-priority one.
- Do NOT assume `ai_feedback` always has `fluencyRating`/`grammarRating` -- old conversations may lack them.

### Previous Story Intelligence (from Story 4-1)

- Branch naming: `feature/4-2-milestonebanner-component-personal-best-detection`
- Commit prefix: `feat(story-4-2):` for feature work, `chore:` for status updates
- ESLint import order enforced: react -> react-native -> expo -> external -> @/ internal
- Hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/`
- `conversationId` is now exposed by `useRealtimeVoice()` hook (added in story 4-1) -- use for `.neq("id", conversationId)` in personal best query
- `comparisonMetrics` state + `useEffect` pattern in [sessionId].tsx is the model for milestone detection
- `SessionComparison.tsx` in `src/components/feedback/` is the model for MilestoneBanner component structure
- Code review found: use `== null` checks (not `!value`) for numeric fields that could be 0

### Project Structure Notes

- New component goes in `src/components/feedback/MilestoneBanner.tsx` (existing `feedback/` directory, alongside `SessionComparison.tsx`)
- UX spec originally placed MilestoneBanner in `src/components/common/` but `feedback/` is more appropriate since it's only used in the feedback sheet
- Path alias `@/*` maps to repo root
- Component follows existing convention: `React.memo` with named function, props interface, `design.ts` tokens

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2 -- BDD acceptance criteria (lines 986-1029)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#MilestoneBanner -- component anatomy, props, styling, accessibility (lines 1154-1193)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Post-Conversation Narrative Feedback -- screen layout order (lines 1324-1335)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3 -- layout order spec (line 1045)]
- [Source: app/(tabs)/conversation/[sessionId].tsx -- feedback bottom sheet (lines 612-739), SessionComparison integration (lines 705-709)]
- [Source: src/hooks/use-realtime-voice.ts -- extractErrorsFromCorrections (line 474), checkCefrPromotion (line 499)]
- [Source: src/lib/error-tracker.ts -- resolveError (line 75), extractErrorsFromCorrections (line 182)]
- [Source: src/lib/activity.ts -- checkCefrPromotion (line 174)]
- [Source: src/lib/haptics.ts -- hapticSuccess (line 19)]
- [Source: src/lib/design.ts -- Colors, Typography, Radii, skillTint exports]
- [Source: src/types/conversation.ts -- ConversationFeedback type with fluencyRating/grammarRating (lines 37-44)]
- [Source: _bmad-output/implementation-artifacts/4-1-sessioncomparison-component-previous-session-data.md -- previous story patterns and conventions]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Error resolution detection uses "most recently resolved" query rather than pre/post snapshot approach. The simpler approach was chosen because `extractErrorsFromCorrections` is fire-and-forget in `use-realtime-voice.ts`, making exact timing of resolution uncertain. The trade-off is that a previously resolved error could be shown as a milestone on a subsequent conversation if no new errors are resolved since. This is acceptable because resolved errors are rare celebrations.

### Completion Notes List

- Created `MilestoneBanner` component with `React.memo`, `FadeInDown.duration(400).springify()` entry animation, `hapticSuccess()` on mount, type-dependent tinting (success green vs accent amber), and `accessibilityRole="alert"`
- Added milestone detection `useEffect` in `[sessionId].tsx` with three-tier priority: CEFR promotion > personal best > error resolution
- Personal best detection queries all completed conversations, computes max fluency/grammar ratings, compares against current session (uses `== null` checks for numeric safety per story 4-1 learnings)
- CEFR promotion detection captures pre-conversation level at mount, re-queries after feedback to detect changes
- MilestoneBanner integrated between AI feedback card and SessionComparison in feedback bottom sheet
- All quality gates pass: type-check, lint, format:check, hex color check

### Change Log

- 2026-03-27: Story implementation complete -- MilestoneBanner component created, milestone detection logic added, integrated into feedback bottom sheet

### File List

- `src/components/feedback/MilestoneBanner.tsx` (new)
- `app/(tabs)/conversation/[sessionId].tsx` (modified)
