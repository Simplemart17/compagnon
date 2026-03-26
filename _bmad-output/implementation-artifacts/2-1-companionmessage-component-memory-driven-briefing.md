# Story 2.1: CompanionMessage Component & Memory-Driven Briefing

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a returning learner,
I want to see a personalized companion message when I open the app,
So that I feel recognized and know what the companion remembers about me and my learning journey.

## Acceptance Criteria

### A. CompanionMessage Component

1. **AC-A1:** A `CompanionMessage` component exists at `src/components/home/CompanionMessage.tsx` displaying:
   - A 32px avatar circle (`Colors.primary` background, white "C" initial letter)
   - A companion name label ("Compagnon") using `Typography.caption`, `Colors.primary`, fontWeight 700
   - A personalized briefing message using `Typography.bodySecondary`, `Colors.textPrimary`
   - Bold spans highlight key data points (card counts, skill names)

2. **AC-A2:** The component background uses `skillTint(Colors.primary, 0.05)`, `borderRadius: Radii.card` (16), `padding: Spacing.cardPadding` (16)

3. **AC-A3:** The component is wrapped with `React.memo` using a named function: `export const CompanionMessage = React.memo(function CompanionMessage({...}: CompanionMessageProps) {...})`

### B. Companion Message Composition

4. **AC-B1:** A `useDailyBriefing` hook exists at `src/hooks/use-daily-briefing.ts` that composes a personalized companion message from multiple data sources using `Promise.allSettled`

5. **AC-B2:** The companion message string is assembled from:
   - **Greeting:** Time-based ("Bonjour" before 18:00, "Bonsoir" after)
   - **Name:** First name extracted from `useAuthStore().profile.full_name`
   - **Memory context:** Most relevant memory from `retrieveMemories(userId, "daily greeting", 3)` — omitted if empty
   - **Activity context:** Based on SRS due count, today's activity, and weakest skill

6. **AC-B3:** Message composition is deterministic (no AI call). Message is built from parts: greeting, optional memory context (prefixed with "I remember:", truncated to 80 chars), and activity context. Templates:
   - First-time user (no memories, no activity, no SRS), no name: "Welcome! Let's start with a conversation."
   - First-time user with name: "{greeting}, {name}! Welcome! Let's start with a conversation."
   - Returning, no activity today + SRS due: "{greeting}, {name}! [I remember: {memory}] You have **{N} words** to review today — let's keep your streak going!"
   - Returning, no activity today + no SRS + weakest skill: "{greeting}, {name}! [I remember: {memory}] Your **{skill}** could use some attention today."
   - Returning, no activity today + no SRS + no weakest skill: "{greeting}, {name}! [I remember: {memory}] Ready for some practice today?"
   - Returning with today's activity + SRS due: "{greeting}, {name}! [I remember: {memory}] You've already practiced today — great work! How about reviewing those **{N} vocabulary words**?"
   - Returning with today's activity + weakest skill: "{greeting}, {name}! [I remember: {memory}] You've already practiced today — great work! Your **{skill}** could use some attention."
   - Returning with today's activity only: "{greeting}, {name}! [I remember: {memory}] You've already practiced today — great work! Keep it up!"
   - Note: Memory context (`[I remember: ...]`) is omitted when no memories are available. Name is omitted when `full_name` is null.

### C. Data Queries (use-daily-briefing hook)

7. **AC-C1:** The hook queries these Supabase tables (all via `cacheWithFallback` from `src/lib/cache.ts`):
   - `companion_memory` via `retrieveMemories(userId, "daily greeting", 3)` from `src/lib/memory.ts`
   - `vocabulary` — count where `next_review <= now` (SRS due count)
   - `skill_progress` — weakest skill by lowest `average_score`
   - `error_patterns` via `getTopErrors(userId, 3)` from `src/lib/error-tracker.ts`
   - `daily_activity` — today's row via `getLocalDateString()` from `src/lib/activity.ts`

8. **AC-C2:** New cache keys added to `src/lib/cache.ts`:
   - `CACHE_KEYS.DAILY_BRIEFING` with `CACHE_TTL.DAILY_BRIEFING = 10 * 60 * 1000` (10 min)
   - `CACHE_KEYS.SRS_DUE_COUNT` with `CACHE_TTL.SRS_DUE = 15 * 60 * 1000` (15 min)

9. **AC-C3:** The hook returns `UseDailyBriefingReturn` matching the interface defined in `epic-2-architecture.md` section 3.6 (companionMessage, todayPlan, totalErrors, resolvedErrors, srsDueCount, isLoading, error, refresh)

10. **AC-C4:** Individual query failures don't block the briefing — graceful degradation per query:
    - Memories fail → message omits memory context
    - SRS count fails → SRS item omitted from Today's Plan
    - Error patterns fail → error drill item omitted, ErrorJourneyBar hidden
    - Weakest skill fails → skill suggestion omitted

### D. Loading and Edge States

11. **AC-D1:** While data loads, a skeleton placeholder matching the CompanionMessage card dimensions is shown (using `SkeletonBar` from `src/components/common/SkeletonBar.tsx`)

12. **AC-D2:** If no message content is available (empty data from all sources), the component returns null (not rendered)

13. **AC-D3:** First-time users with no companion memories see a welcome greeting (AC-B3 template)

### E. Home Screen Integration (Partial)

14. **AC-E1:** `CompanionMessage` is added to `app/(tabs)/home/index.tsx` inside the existing `ScrollView`, positioned below the error banner and above the existing `ConversationCard`

15. **AC-E2:** `HomeScreen` calls `useDailyBriefing()` and passes `companionMessage` to the `CompanionMessage` component

16. **AC-E3:** The existing home screen content (ConversationCard, SmallActionCard grid, Weekly Activity, Skills) remains unchanged and functional

### F. Accessibility

17. **AC-F1:** CompanionMessage has `accessibilityRole="text"` and `accessibilityLabel="Your companion says: {message content}"`

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

- [x] Task 1: Add new cache keys to `src/lib/cache.ts` (AC: C2)
  - [x] 1.1 Add `DAILY_BRIEFING` and `SRS_DUE_COUNT` to `CACHE_KEYS` object
  - [x] 1.2 Add `DAILY_BRIEFING: 10 * 60 * 1000` and `SRS_DUE: 15 * 60 * 1000` to `CACHE_TTL` object

- [x] Task 2: Create `src/hooks/use-daily-briefing.ts` hook (AC: B1-B3, C1, C3-C4)
  - [x] 2.1 Define `TodayPlanItem` and `UseDailyBriefingReturn` interfaces (match architecture doc section 3.6)
  - [x] 2.2 Implement parallel data fetching with `Promise.allSettled` for all 6 queries
  - [x] 2.3 Implement companion message composition logic (greeting + name + memory + activity context)
  - [x] 2.4 Implement Today's Plan item selection algorithm (priority: SRS due > errors > weakest skill > conversation fallback, max 3, deduplicate by route)
  - [x] 2.5 Implement error/resolved counts for ErrorJourneyBar
  - [x] 2.6 Implement `refresh()` function that invalidates `DAILY_BRIEFING` and `SRS_DUE_COUNT` caches
  - [x] 2.7 Wrap all catch blocks with `captureError(err, "daily-briefing-{query}")`

- [x] Task 3: Create `src/components/home/CompanionMessage.tsx` (AC: A1-A3, D1-D2, F1)
  - [x] 3.1 Create `src/components/home/` directory
  - [x] 3.2 Implement `CompanionMessageProps` interface: `{ message: string }`
  - [x] 3.3 Build component with avatar (32px circle, primary bg, white "C"), name label, message text
  - [x] 3.4 Apply design tokens: `skillTint(Colors.primary, 0.05)` bg, `Radii.card`, `Spacing.cardPadding`
  - [x] 3.5 Add accessibility: `accessibilityRole="text"`, `accessibilityLabel="Your companion says: {message}"`
  - [x] 3.6 Wrap with `React.memo` using named function pattern

- [x] Task 4: Create `CompanionMessageSkeleton` loading state (AC: D1)
  - [x] 4.1 Build skeleton component using `SkeletonBar` from `src/components/common/SkeletonBar.tsx`
  - [x] 4.2 Match CompanionMessage card dimensions (avatar circle + 2 text bars)

- [x] Task 5: Integrate into home screen (AC: E1-E3)
  - [x] 5.1 Import `useDailyBriefing` and `CompanionMessage` in `app/(tabs)/home/index.tsx`
  - [x] 5.2 Call `useDailyBriefing()` in HomeScreen
  - [x] 5.3 Render CompanionMessage (or skeleton while loading, or null if empty) below error banner, above ConversationCard
  - [x] 5.4 Verify existing home screen content is unaffected

- [x] Task 6: Quality gates (AC: Z)
  - [x] 6.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 6.2 Verify no regressions in home screen functionality

## Dev Notes

### Critical: This story creates the shared `use-daily-briefing` hook

Story 2-1 creates the **full** `useDailyBriefing` hook including `todayPlan[]`, `totalErrors`, and `resolvedErrors` — even though those are visually consumed by Stories 2-2 and 2-3. This is because the hook owns all the data queries and composition logic. Stories 2-2 and 2-3 only create their respective UI components and wire them to the hook's existing return values.

### File Structure

```
NEW FILES:
  src/hooks/use-daily-briefing.ts      — Hook with all briefing logic
  src/components/home/CompanionMessage.tsx — CompanionMessage component

MODIFIED FILES:
  src/lib/cache.ts                     — Add DAILY_BRIEFING and SRS_DUE_COUNT keys/TTLs
  app/(tabs)/home/index.tsx            — Import hook + component, render CompanionMessage
```

### Existing Library Functions to Call (DO NOT reimplement)

| Function | Import Path | Usage |
|----------|-------------|-------|
| `retrieveMemories(userId, context, limit)` | `@/src/lib/memory` | Vector similarity search, returns `string[]` |
| `getTopErrors(userId, limit)` | `@/src/lib/error-tracker` | Returns `ErrorPattern[]` with `id, error_type, error_description, occurrences, resolved` |
| `cacheWithFallback(userId, key, fetchFn, ttlMs)` | `@/src/lib/cache` | Returns `{ data: T \| null; fromCache: boolean }` |
| `getLocalDateString(date?)` | `@/src/lib/activity` | Returns `YYYY-MM-DD` in local timezone |
| `captureError(error, context, extras?)` | `@/src/lib/sentry` | Sentry error reporting |
| `skillTint(color, opacity)` | `@/src/lib/design` | Converts hex to rgba string |

### Existing Design Tokens to Use

| Token | Value | Usage |
|-------|-------|-------|
| `Colors.primary` | `#1E3A5F` | Avatar bg, name label color |
| `Colors.textPrimary` | — | Message text color |
| `Colors.textSecondary` | — | Subtitle text color |
| `Colors.accent` | `#F5A623` | "Due" / "Suggested" badge color |
| `Colors.error` | `#FF3B30` | "Error" badge color |
| `Colors.success` | `#34C759` | ErrorJourneyBar fill |
| `Typography.caption` | — | Name label ("Compagnon") |
| `Typography.bodySecondary` | — | Message text |
| `Typography.label` | — | TodayPlanItem title |
| `Spacing.cardPadding` | 16 | Card internal padding |
| `Radii.card` | 16 | Card border radius |
| `skillTint(color, opacity)` | — | Tinted backgrounds |

### User Profile Data

From `useAuthStore().profile`:
- `full_name: string | null` — extract first name via `split(" ")[0]`
- `current_cefr_level: CEFRLevel`
- `daily_goal_minutes: number`
- `streak_days: number`

### Today's Plan Algorithm (implement in hook, consumed by Story 2-2)

Priority order (highest first), max 3 items, deduplicate by `route`:

| Priority | Condition | Title | Badge | Route |
|----------|-----------|-------|-------|-------|
| 1 | `srsDueCount > 0` | "Review {N} words" | `due` | `/(tabs)/practice/vocabulary` |
| 2 | `errorPatterns.length > 0` | "Fix: {error_description}" | `error` | `/(tabs)/practice/grammar?errorId=...` |
| 3 | `weakestSkill !== null` | "Practice {SKILL_LABELS[skill].en}" | `suggested` | `/(tabs)/practice/{skill}` |
| 4 | Always (fallback) | "Daily conversation" | `suggested` | `/(tabs)/conversation` |

Import `SKILL_LABELS` from `@/src/lib/constants` for skill display names.

### Hook Return Type (full interface)

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

interface UseDailyBriefingReturn {
  companionMessage: string;
  todayPlan: TodayPlanItem[];
  totalErrors: number;
  resolvedErrors: number;
  srsDueCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
```

### Caching Pattern (follow use-progress.ts exactly)

```typescript
const { data } = await cacheWithFallback<number>(
  userId,
  CACHE_KEYS.SRS_DUE_COUNT,
  async () => {
    const { count } = await supabase
      .from("vocabulary")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .lte("next_review", new Date().toISOString());
    return count ?? 0;
  },
  CACHE_TTL.SRS_DUE,
);
```

### use-daily-briefing vs use-progress Boundary

- `use-progress` owns: `SKILLS`, `DAILY_ACTIVITY_TODAY`, `RECENT_ACTIVITY`, `TOP_ERRORS`, `STREAK` cache keys
- `use-daily-briefing` owns: `DAILY_BRIEFING`, `SRS_DUE_COUNT` cache keys
- Both hooks can be called in `HomeScreen` without interference — no shared state, no cache collisions
- `use-daily-briefing` does NOT import from `use-progress` — they are independent

### Component Conventions

- Named functions inside `React.memo`: `export const CompanionMessage = React.memo(function CompanionMessage(...) { })`
- Props interface exported alongside component
- Static styles via NativeWind `className`, dynamic/computed via inline `style={{ }}`
- Import order: react → react-native → expo → external → @/ internal (ESLint enforced)

### Anti-Patterns to Avoid

- Do NOT use `ActivityIndicator` — use `SkeletonBar` for loading states
- Do NOT hardcode hex colors — use `Colors.*` from `@/src/lib/design`
- Do NOT hardcode font sizes — use `Typography.*` presets
- Do NOT create a Zustand store — all state is hook-local (`useState` + `useCallback`)
- Do NOT duplicate queries from `use-progress` — use different cache keys
- Do NOT make AI calls for message composition — it's deterministic template logic
- Do NOT put new components in root `components/` dir — use `src/components/home/`

### Previous Story Intelligence (from Story 1B.3)

- ESLint import/order rule is active — group imports correctly
- Prettier auto-formats — run `npm run format:check` at end
- The hex color CI check (`scripts/check-hex-colors.sh`) scans `app/` and `src/components/` for hardcoded `#hex` patterns
- All 19 design tokens from Story 1B.2 are available (accent25, success12, whiteAlpha06-85, etc.)
- `skillTint(color, opacity)` is the standard way to create tinted backgrounds

### Git Intelligence

- Branch naming: `feature/2-1-companionmessage-component-memory-driven-briefing`
- Commit prefix: `feat(story-2-1):` for feature work, `chore:` for status updates
- Recent pattern: single feature commit per logical change, then status update commit

### Project Structure Notes

- New components go in `src/components/home/` (follows existing `conversation/`, `practice/`, `profile/` pattern)
- The hook goes in `src/hooks/use-daily-briefing.ts` (follows existing `use-progress.ts`, `use-exercise.ts` pattern)
- Path alias: `@/*` maps to repo root — use `@/src/lib/cache` not `../../lib/cache`

### References

- [Source: _bmad-output/planning-artifacts/epic-2-architecture.md — Full component architecture, hook design, props interfaces, data flow, cache strategy]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.1 acceptance criteria (line 709-741)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX design principles, emotional design, home screen briefing concept]
- [Source: _bmad-output/planning-artifacts/architecture.md — Layer boundaries, caching conventions, component conventions]
- [Source: src/hooks/use-progress.ts — Existing hook pattern with cacheWithFallback, return type structure]
- [Source: src/lib/memory.ts — retrieveMemories(userId, context, limit) returns string[]]
- [Source: src/lib/error-tracker.ts — getTopErrors(userId, limit) returns ErrorPattern[]]
- [Source: src/lib/cache.ts — CACHE_KEYS, CACHE_TTL, cacheWithFallback pattern]
- [Source: src/lib/design.ts — Colors, Typography, Spacing, Radii, skillTint()]
- [Source: src/lib/activity.ts — getLocalDateString()]
- [Source: src/lib/sentry.ts — captureError()]
- [Source: src/components/common/SkeletonBar.tsx — SkeletonBar(width, height, style?, accessibilityLabel?)]
- [Source: src/store/auth-store.ts — useAuthStore().profile with full_name, current_cefr_level, daily_goal_minutes]
- [Source: src/lib/constants.ts — SKILL_LABELS for skill display names]
- [Source: app/(tabs)/home/index.tsx — Current home screen structure with inline ConversationCard, SmallActionCard, ActivityBar]
- [Source: _bmad-output/implementation-artifacts/1b-3-story-ac-template-epic-2-architecture-planning.md — Previous story learnings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — no errors encountered during implementation.

### Completion Notes List

- **Task 1:** Added `DAILY_BRIEFING` and `SRS_DUE_COUNT` to `CACHE_KEYS`, added `DAILY_BRIEFING` (10 min) and `SRS_DUE` (15 min) to `CACHE_TTL` in `src/lib/cache.ts`.
- **Task 2:** Created `src/hooks/use-daily-briefing.ts` with full `UseDailyBriefingReturn` interface. Hook fetches 6 data sources in parallel via `Promise.allSettled` with `cacheWithFallback`. Deterministic companion message composition with time-based greeting, name extraction, memory context, and activity context. Today's Plan algorithm with priority ordering (SRS > errors > weakest skill > conversation fallback), max 3 items, route deduplication. Error/resolved counts for ErrorJourneyBar. All failures captured via `captureError`.
- **Task 3:** Created `src/components/home/CompanionMessage.tsx` with 32px avatar circle (`Colors.primary` bg, `Colors.textOnDark` "C" initial), "Compagnon" name label (`Typography.caption`, `Colors.primary`, weight 700), message body (`Typography.bodySecondary`, `Colors.textPrimary`) with `**bold**` span parsing. Background: `skillTint(Colors.primary, 0.05)`, `Radii.card`, `Spacing.cardPadding`. `accessibilityRole="text"` with full message label. Wrapped in `React.memo` with named function.
- **Task 4:** Added `CompanionMessageSkeleton` in same file using `SkeletonBar` — matches card dimensions with avatar circle skeleton + 3 text bar skeletons.
- **Task 5:** Integrated into `app/(tabs)/home/index.tsx`. `useDailyBriefing()` called alongside `useProgress()`. CompanionMessage rendered below error banner, above Quick Start section. Shows skeleton while loading, null if empty. Pull-to-refresh refreshes both hooks.
- **Task 6:** All quality gates pass: `npm run type-check` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (all pass). Existing home screen content unchanged.

### Change Log

- 2026-03-26: Story 2.1 implementation complete — hook, component, skeleton, and home screen integration.

### File List

- `src/lib/cache.ts` — MODIFIED: added DAILY_BRIEFING and SRS_DUE_COUNT cache keys and TTLs
- `src/hooks/use-daily-briefing.ts` — NEW: daily briefing hook with message composition, Today's Plan algorithm, error counts
- `src/components/home/CompanionMessage.tsx` — NEW: CompanionMessage component + CompanionMessageSkeleton
- `app/(tabs)/home/index.tsx` — MODIFIED: integrated useDailyBriefing hook and CompanionMessage component
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: epic-2 in-progress, story 2-1 status updates
- `_bmad-output/implementation-artifacts/2-1-companionmessage-component-memory-driven-briefing.md` — MODIFIED: tasks marked complete, status updated to review
