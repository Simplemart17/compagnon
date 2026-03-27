# Story 4.1: SessionComparison Component & Previous Session Data

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner who practices regularly,
I want to see how my fluency, grammar, and duration compare to my last session,
So that I can see tangible progress or know where to focus next.

## Acceptance Criteria

### A. SessionComparison Component

1. **AC-A1:** Given a user who has completed at least two conversations, when the post-conversation feedback screen loads, then a SessionComparison component displays showing fluency, grammar, and duration with previous values, current values, and direction arrows (up/down/same).

2. **AC-A2:** Given a user completing their first conversation ever, when the feedback screen loads, then the SessionComparison component is hidden (returns `null` — no previous session exists).

3. **AC-A3:** Given a user returning after a long absence (3+ weeks), when they complete their first conversation back, then the SessionComparison component is hidden (per Journey 3 design — no "vs. last session" on first return).

4. **AC-A4:** Given the SessionComparison component with metrics, when a metric direction is "up", then the arrow and current value display in `Colors.success` (green). When a metric direction is "down", then the arrow and current value display in `Colors.error` (red). When a metric direction is "same", then an equals sign displays in `Colors.textTertiary`.

5. **AC-A5:** Given the previous session's ratings, when the current conversation ends, then the current session's fluency rating, grammar rating, and duration are stored to enable comparison for the next session. (Note: this data already exists in the `conversations` table via `ai_feedback` JSONB and `duration_seconds` — no schema change needed.)

### B. Styling

6. **AC-B1:** The SessionComparison component uses: `Colors.primary` at 4% opacity background (via `skillTint(Colors.primary, 0.04)`), `Typography.caption` (weight 700, `Colors.primary`) for the "vs. Last Session" title, `Typography.caption` for metric labels and previous values, `Typography.bodySecondary` (weight 700) for current values, `Radii.button` (12px) border radius, and 10px vertical / 12px horizontal padding.

### C. Accessibility

7. **AC-C1:** The SessionComparison component has `accessibilityRole="summary"` and each metric row has `accessibilityLabel="[label]: changed from [previous] to [current], [direction]"`.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [ ] Non-obvious interactions have `accessibilityHint`
- [ ] Stateful elements have `accessibilityState`
- [ ] All tappable elements have minimum 44x44pt touch targets
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Create `SessionComparison` component (AC: A1, A4, B1, C1)
  - [x] 1.1 Create `src/components/feedback/SessionComparison.tsx` — new file in new `feedback/` directory
  - [x] 1.2 Define `SessionComparisonMetric` type: `{ label: string; previous: string; current: string; direction: "up" | "down" | "same" }`
  - [x] 1.3 Define `SessionComparisonProps`: `{ metrics: SessionComparisonMetric[] }`
  - [x] 1.4 Return `null` if `metrics` array is empty
  - [x] 1.5 Render "vs. Last Session" title row + one row per metric with previous value, direction indicator (arrow up ↑ / arrow down ↓ / equals =), and current value
  - [x] 1.6 Color the direction indicator and current value: `Colors.success` for "up", `Colors.error` for "down", `Colors.textTertiary` for "same"
  - [x] 1.7 Apply styling per AC-B1: `skillTint(Colors.primary, 0.04)` background, `Radii.button` radius, 10/12 padding, Typography presets with weight overrides
  - [x] 1.8 Add `accessibilityRole="summary"` on container, per-row `accessibilityLabel`
  - [x] 1.9 Wrap with `React.memo`

- [x] Task 2: Fetch previous session data and compute comparison metrics (AC: A1, A2, A3, A5)
  - [x] 2.1 In `app/(tabs)/conversation/[sessionId].tsx`, after conversation ends (when `feedbackVisible` becomes true), query the previous completed conversation for this user:
    ```
    supabase.from("conversations")
      .select("ai_feedback, duration_seconds, completed_at")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .neq("id", currentConversationId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .single()
    ```
  - [x] 2.2 If no previous conversation exists → set `comparisonMetrics` to `null` (AC-A2: first conversation)
  - [x] 2.3 If previous conversation exists but `completed_at` is > 21 days before current session → set `comparisonMetrics` to `null` (AC-A3: long absence, 3+ weeks)
  - [x] 2.4 If previous conversation exists and is within 21 days, compute metrics array:
    - Fluency: previous `ai_feedback.fluencyRating` vs current `conversation.feedback.fluencyRating`, format as "N/5"
    - Grammar: previous `ai_feedback.grammarRating` vs current `conversation.feedback.grammarRating`, format as "N/5"
    - Duration: previous `duration_seconds` vs current `conversation.durationSeconds`, format as "Nm" (minutes)
  - [x] 2.5 Direction logic: `current > previous` → "up", `current < previous` → "down", `current === previous` → "same"
  - [x] 2.6 Wrap the fetch in `try/catch` with `captureError(err, "session-comparison-fetch")` — on error, silently hide the component (set metrics to `null`)

- [x] Task 3: Integrate SessionComparison into the feedback bottom sheet (AC: A1, A2, A3)
  - [x] 3.1 Import `SessionComparison` from `@/src/components/feedback/SessionComparison`
  - [x] 3.2 Render `<SessionComparison metrics={comparisonMetrics} />` inside the feedback bottom sheet's `<ScrollView>`, positioned **after** the AI feedback summary card (ratings + strengths/improvements) and **before** the corrections section
  - [x] 3.3 Add `mb-3` margin below the SessionComparison for spacing consistency with other cards
  - [x] 3.4 Only render the component when `comparisonMetrics` is not null (the component also returns null for empty metrics, but skip rendering entirely if no data)

- [x] Task 4: Quality gates (AC: Z)
  - [x] 4.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 4.2 Run `scripts/check-hex-colors.sh` — verify no raw hex values
  - [x] 4.3 Verify component renders correctly with mock data (2+ sessions)
  - [x] 4.4 Verify component is hidden on first session (no previous data)

## Dev Notes

### Critical: Data Already Exists — No Schema Migration Needed

The `conversations` table already stores everything needed:
- `ai_feedback` JSONB contains `fluencyRating` (1-5) and `grammarRating` (1-5)
- `duration_seconds` INTEGER
- `completed_at` TIMESTAMPTZ
- `user_id` UUID with RLS

The previous session query simply fetches the most recent completed conversation before the current one. No new tables, columns, or migrations required.

### Current Feedback Bottom Sheet Structure (lines 525-649 of [sessionId].tsx)

The feedback sheet currently renders in this order:
1. Drag handle
2. Title "Bilan de conversation" + duration/message count
3. Stat tiles (Your turns, Corrections)
4. AI Feedback card (summary, fluency/grammar/vocabulary ratings, strengths, improvements)
5. Corrections list OR "Impeccable!" message
6. "Terminé" close button

**Insert SessionComparison between items 4 and 5** — after the AI feedback card, before corrections.

### The `conversation` Object in [sessionId].tsx

The `useRealtimeVoice()` hook returns a state object with:
- `conversation.status` — "idle" | "connecting" | "connected" | "ended" | "error"
- `conversation.feedback` — `ConversationFeedback | null` (populated after conversation ends)
- `conversation.durationSeconds` — number
- `conversation.transcript` — array of transcript entries

The current user's ID is available from `useAuthStore()` as `user?.id`.

### Timing: When to Fetch Previous Session

The comparison data should be fetched **when feedback becomes available** (not on mount). Use a `useEffect` watching `conversation.feedback` — when it transitions from null to a value, trigger the previous session query. This ensures the current session's ratings are known before computing deltas.

### Duration Formatting

Duration is stored as seconds. Format for display as minutes: `Math.round(seconds / 60)` + "m". If < 1 minute, show "< 1m".

### Files to Create (1 new file)

| File | Purpose |
|------|---------|
| `src/components/feedback/SessionComparison.tsx` | New SessionComparison component |

### Files to Modify (1 file)

| File | Change |
|------|--------|
| `app/(tabs)/conversation/[sessionId].tsx` | Add previous session query, compute comparison metrics, render SessionComparison in feedback sheet |

### What NOT to Change

- `use-realtime-voice.ts` — feedback generation already works correctly. No changes to how feedback is stored.
- `src/types/conversation.ts` — existing `ConversationFeedback` type already has `fluencyRating` and `grammarRating`.
- Database schema / migrations — all required data already exists.
- Supabase Edge Functions — no server-side changes needed.
- Other feedback sheet elements — keep existing stat tiles, ratings, strengths/improvements, corrections exactly as-is.

### Existing Libraries/Functions to Use (DO NOT reimplement)

| Function/Module | Import Path | Usage |
|-----------------|-------------|-------|
| `Colors`, `Typography`, `Radii`, `skillTint` | `@/src/lib/design` | All design tokens |
| `captureError` | `@/src/lib/sentry` | Error reporting in catch blocks |
| `supabase` | `@/src/lib/supabase` | Database queries (already imported in [sessionId].tsx) |
| `useAuthStore` | `@/src/store/auth-store` | Get current user ID (already used in [sessionId].tsx) |
| `React.memo` | `react` | Component memoization |

### Anti-Patterns to Avoid

- Do NOT create a new hook for this — the query is simple and specific to the feedback sheet. Inline the `useEffect` + state in `[sessionId].tsx`.
- Do NOT add a new database column or migration — the data already exists in `ai_feedback` JSONB and `duration_seconds`.
- Do NOT modify the `ConversationFeedback` type — it already has the fields needed.
- Do NOT use `ActivityIndicator` while loading previous session — just don't render the component until data is ready.
- Do NOT use hardcoded hex colors — use `Colors.*` and `skillTint()`.
- Do NOT use raw `fontSize` — use `Typography.*` presets with weight overrides via `style` prop.
- Do NOT fetch previous session on component mount — wait until `conversation.feedback` is available so you can compute deltas.
- Do NOT compare sessions across different modes (companion vs debate vs TCF) — compare any completed conversation regardless of mode (the metrics are universal).

### Previous Story Intelligence (from Story 3-3)

- Branch naming convention: `feature/4-1-sessioncomparison-component-previous-session-data`
- Commit prefix: `feat(story-4-1):` for feature work, `chore:` for status updates
- ESLint import order enforced: react -> react-native -> expo -> external -> @/ internal
- Hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/`
- Quality gates: `npm run type-check && npm run lint && npm run format:check`
- Feedback bottom sheet is in `[sessionId].tsx` lines 525-649
- `useRealtimeVoice()` saves `ai_feedback` to conversations table on end
- `supabase` client is already imported in `[sessionId].tsx`

### Project Structure Notes

- New component goes in `src/components/feedback/SessionComparison.tsx` (new `feedback/` directory per UX spec component implementation strategy)
- Path alias `@/*` maps to repo root
- Component follows existing convention: `React.memo` with named function, props interface, `design.ts` tokens

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1 — BDD acceptance criteria (lines 946-985)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#SessionComparison — component anatomy, props, styling, accessibility (lines 1118-1152)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Post-Conversation Narrative Feedback — screen layout order (lines 1324-1335)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey 3 — returning after absence, no session comparison on first return (lines 860-900)]
- [Source: app/(tabs)/conversation/[sessionId].tsx — feedback bottom sheet (lines 525-649), useRealtimeVoice usage]
- [Source: src/types/conversation.ts — ConversationFeedback type with fluencyRating/grammarRating]
- [Source: supabase/migrations/20260301000000_initial_schema.sql — conversations table with ai_feedback JSONB, duration_seconds, completed_at]
- [Source: src/lib/design.ts — Colors, Typography, Radii, skillTint exports]
- [Source: _bmad-output/implementation-artifacts/3-3-waveform-centered-layout-latency-masking.md — previous story conventions and patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- (Resolved) `conversationId` was not exposed by `useRealtimeVoice` — added it to `ConversationState` interface and return value, enabling deterministic `.neq("id", ...)` exclusion instead of fragile `range(1, 1)`.

### Completion Notes List

- Created `SessionComparison` component with `React.memo`, `accessibilityRole="summary"`, per-row accessibility labels, direction-colored arrows, and design system tokens
- Added `useEffect` in `[sessionId].tsx` that watches `conversation.feedback` — fetches previous completed conversation via `.neq("id", conversationId)`, computes fluency/grammar/duration deltas
- Handles AC-A2 (first conversation → null), AC-A3 (21+ day absence → null), and AC-A4 (direction coloring)
- Integrated component in feedback bottom sheet between AI feedback card and corrections section
- All quality gates pass: type-check, lint, format:check, hex color check

### Code Review Fixes (2026-03-27)

- **F1 (bad_spec):** Exposed `conversationId` from `useRealtimeVoice` hook via `ConversationState` interface; replaced fragile `.range(1, 1)` with deterministic `.neq("id", conversationId).limit(1)`; captured `currentFeedback` before async gap to eliminate `!` non-null assertions
- **F2 (patch):** Changed `!prevFeedback?.fluencyRating || !prevFeedback?.grammarRating` to `== null` checks to avoid treating a zero rating as missing

### Change Log

- 2026-03-27: Story implementation complete — SessionComparison component created, previous session fetch logic added, integrated into feedback bottom sheet
- 2026-03-27: Code review fixes — exposed conversationId from hook, deterministic query exclusion, null-safe rating check

### File List

- `src/components/feedback/SessionComparison.tsx` (new)
- `app/(tabs)/conversation/[sessionId].tsx` (modified)
- `src/hooks/use-realtime-voice.ts` (modified — added `conversationId` to ConversationState)
