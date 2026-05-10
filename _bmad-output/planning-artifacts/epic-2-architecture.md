# Epic 2: Companion Daily Briefing — Component Architecture

## Overview

Epic 2 evolves the home screen from a static quick-actions layout into a personalized daily briefing experience. Three new components and one data hook compose the feature.

**Stories:**

- **2-1:** CompanionMessage component + memory-driven briefing
- **2-2:** Today's Plan — curated activity recommendations
- **2-3:** ErrorJourneyBar + home screen integration

---

## 1. Component Tree

```
app/(tabs)/home/index.tsx (HomeScreen)
├── Hero Header (existing — greeting, level chip, streak, daily goal bar)
├── ScrollView (existing)
│   ├── Error Banner (existing — progress.error)
│   ├── CompanionMessage                    ← NEW (Story 2-1)
│   │   └── Avatar + name + message text
│   ├── "Aujourd'hui" section header        ← NEW (Story 2-2)
│   ├── TodayPlanItem (×3 max)             ← NEW (Story 2-2)
│   │   └── Icon + title + subtitle + badge
│   ├── ErrorJourneyBar                     ← NEW (Story 2-3)
│   │   └── Label + progress track + fill
│   ├── ConversationCard (existing)
│   ├── Weekly Activity section (existing)
│   └── Skills overview section (existing)
```

**Integration approach:** The new components slot into the existing `ScrollView` in `HomeScreen`. The "Quick Start" section's `SmallActionCard` grid is replaced by `TodayPlanItem` list. `ConversationCard` moves below Today's Plan. Existing `ActivityBar` and skills sections remain unchanged.

---

## 2. Directory Structure

**Decision: Create `src/components/home/`**

```
src/components/home/
├── CompanionMessage.tsx    (Story 2-1)
├── TodayPlanItem.tsx       (Story 2-2)
└── ErrorJourneyBar.tsx     (Story 2-3)
```

**Rationale:**

- These components are domain-specific to the home briefing feature and complex enough to justify isolation
- Follows the existing pattern: `src/components/conversation/`, `src/components/practice/`, `src/components/profile/`, `src/components/common/`
- All three may be reused in other contexts (post-conversation feedback, profile summary) — isolating them makes imports clean
- The current `HomeScreen` already contains 3 inline sub-components (`ConversationCard`, `SmallActionCard`, `ActivityBar`); adding 3 more inline would make the file too large (~800+ lines)

---

## 3. Data Hook Design: `src/hooks/use-daily-briefing.ts`

### 3.1 Responsibilities

The `use-daily-briefing` hook composes a personalized daily briefing from multiple data sources. It owns:

- Companion message text composition
- SRS due vocabulary count
- "Today's Plan" item list (priority-ordered, max 3)
- Briefing freshness/loading state

It does **NOT** own (these belong to `use-progress`):

- Skill progress data
- Daily activity totals
- Error pattern list
- Streak count

### 3.2 Supabase Queries

| Query                 | Table              | Operation                                                                                                    | Purpose                                           |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Companion memories    | `companion_memory` | Via `retrieveMemories(userId, "daily greeting", 3)` from `src/lib/memory.ts`                                 | Personal context for the companion message        |
| SRS due count         | `vocabulary`       | `.select("id", { count: "exact" }).eq("user_id", userId).lte("next_review", now)`                            | Count of vocabulary items due for review          |
| Weakest skill         | `skill_progress`   | `.select("skill, average_score").eq("user_id", userId).order("average_score", { ascending: true }).limit(1)` | Identify lowest-scoring skill for recommendations |
| Active error patterns | `error_patterns`   | Via `getTopErrors(userId, 3)` from `src/lib/error-tracker.ts`                                                | Error drill suggestions                           |
| Today's activity      | `daily_activity`   | `.select("*").eq("user_id", userId).eq("date", getLocalDateString()).maybeSingle()`                          | Greeting context (has user practiced today?)      |

### 3.3 Cache Strategy

**Reused existing cache keys:**
| Key | Constant | TTL | Source |
|-----|----------|-----|--------|
| `top_errors` | `CACHE_KEYS.TOP_ERRORS` | 1 hour | `CACHE_TTL.ERRORS` |
| `skills` | `CACHE_KEYS.SKILLS` | 30 min | `CACHE_TTL.SKILLS` |
| `daily_activity_today` | `CACHE_KEYS.DAILY_ACTIVITY_TODAY` | 15 min | `CACHE_TTL.DAILY_ACTIVITY` |

**New cache keys to add to `CACHE_KEYS` in `src/lib/cache.ts`:**
| Key | Constant | TTL | Rationale |
|-----|----------|-----|-----------|
| `daily_briefing` | `CACHE_KEYS.DAILY_BRIEFING` | 10 min | Composite briefing data; short TTL because it aggregates multiple data sources |
| `srs_due_count` | `CACHE_KEYS.SRS_DUE_COUNT` | 15 min | Simple integer count; matches `DAILY_ACTIVITY` TTL since it changes at similar frequency |

**New TTL values to add to `CACHE_TTL`:**

```typescript
DAILY_BRIEFING: 10 * 60 * 1000,  // 10 minutes
SRS_DUE: 15 * 60 * 1000,         // 15 minutes
```

**Pattern:** All queries use `cacheWithFallback()` from `src/lib/cache.ts`, consistent with `use-progress.ts`.

### 3.4 Companion Message Composition

The hook composes a natural-language companion message string using a template approach:

```
Template: "{greeting}, {name}! {memory_context} {activity_context}"

Examples:
- "Bonjour, Martin! I remember you mentioned your trip to Lyon. You have 12 words to review today — let's keep your streak going!"
- "Bonsoir, Martin! Ready for some practice? Your grammar could use some attention today."
- "Bonjour! You've already practiced today — great work! How about reviewing those 5 vocabulary words?"
```

**Composition logic:**

1. **Greeting:** Time-based (Bonjour before 18:00, Bonsoir after)
2. **Name:** From `useAuthStore().profile.full_name` (first name extracted)
3. **Memory context:** If `retrieveMemories` returns results, incorporate the most recent/relevant memory as a personal touch. If empty, omit.
4. **Activity context:** Based on:
   - If SRS due > 0: mention vocabulary review count
   - If today's activity exists: acknowledge today's progress
   - If weakest skill found: suggest practice area
   - Fallback: generic encouragement

**Implementation note:** Message composition is deterministic (no AI call needed). The hook builds the string from retrieved data using template logic. This keeps it fast and free of AI latency.

### 3.5 "Today's Plan" Item Selection Algorithm

The hook generates a prioritized list of up to **3 activity recommendations**.

**Priority ordering (highest → lowest):**

| Priority | Condition                  | Item                       | Badge               | Route                                  |
| -------- | -------------------------- | -------------------------- | ------------------- | -------------------------------------- |
| 1        | `srsDueCount > 0`          | "Review {N} words"         | `due` (amber)       | `/(tabs)/practice/vocabulary`          |
| 2        | `errorPatterns.length > 0` | "Fix: {error_description}" | `error` (red)       | `/(tabs)/practice/grammar?errorId=...` |
| 3        | `weakestSkill !== null`    | "Practice {skill_label}"   | `suggested` (amber) | `/(tabs)/practice/{skill}`             |
| 4        | Always (fallback)          | "Daily conversation"       | `suggested` (amber) | `/(tabs)/conversation`                 |

**Rules:**

- Maximum 3 items returned
- Each item has: `id`, `title`, `subtitle`, `iconColor`, `iconEmoji`, `badge`, `route`, `params`
- Items are deduplicated by route (e.g., if error drills and weakest skill both point to grammar, only the error drill item is shown)
- Fallback item (conversation) only appears if fewer than 3 items from priorities 1-3

### 3.6 Return Type Interface

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
  /** Personalized companion message string */
  companionMessage: string;
  /** Ordered list of recommended activities (max 3) */
  todayPlan: TodayPlanItem[];
  /** Total unresolved error count for ErrorJourneyBar */
  totalErrors: number;
  /** Resolved error count for ErrorJourneyBar */
  resolvedErrors: number;
  /** Number of SRS vocabulary items due for review */
  srsDueCount: number;
  /** Loading state */
  isLoading: boolean;
  /** Error message if data fetching fails */
  error: string | null;
  /** Refresh all briefing data */
  refresh: () => Promise<void>;
}
```

### 3.7 Error Handling and Loading States

- All Supabase queries wrapped in `cacheWithFallback` — graceful offline fallback
- Individual query failures don't block the entire briefing; the hook degrades gracefully:
  - If memories fail: companion message omits memory context
  - If SRS count fails: SRS item omitted from Today's Plan
  - If error patterns fail: error drill item omitted, ErrorJourneyBar hidden
  - If weakest skill fails: skill suggestion omitted
- Loading state: `isLoading: true` until all queries resolve (parallel via `Promise.allSettled`)
- Error capture: all catch blocks use `captureError(err, "daily-briefing-{query}")` from `@/src/lib/sentry`

---

## 4. Component Props Interfaces

### CompanionMessageProps (Story 2-1)

```typescript
interface CompanionMessageProps {
  /** The personalized message text to display */
  message: string;
}
```

**Visual spec:**

- Background: `skillTint(Colors.primary, 0.05)`
- Avatar: 32px circle, `Colors.primary` background, white "C" initial letter
- Name: `Typography.caption` style, `Colors.primary` color, fontWeight 700, text "Compagnon"
- Message: `Typography.bodySecondary` style, `Colors.textPrimary` color
- Container: `borderRadius: Radii.card` (16), `padding: Spacing.cardPadding` (16)
- Accessibility: `accessibilityRole="text"`, label includes full message content
- Wrapping: `React.memo` with named function

### TodayPlanItemProps (Story 2-2)

```typescript
interface TodayPlanItemProps {
  /** Activity title (e.g., "Review 12 words") */
  title: string;
  /** Activity subtitle (e.g., "Vocabulary SRS review") */
  subtitle: string;
  /** Icon color for the tinted background and icon container */
  iconColor: string;
  /** Emoji icon for the activity */
  iconEmoji: string;
  /** Badge type determining color and label */
  badge: "due" | "suggested" | "error";
  /** Callback when the item is pressed */
  onPress: () => void;
}
```

**Visual spec:**

- Background: `skillTint(iconColor, 0.06)`
- Icon container: 28px rounded square (borderRadius 8), `skillTint(iconColor, 0.12)`
- Title: `Typography.label` style, color set to `iconColor`
- Subtitle: `Typography.caption` style, `Colors.textSecondary`
- Badge variants: `due` → amber bg + "Due" label, `suggested` → amber bg + "Suggested", `error` → red bg + "Fix"
- Press animation: scale 0.97 + opacity 0.8 + `haptics.light()`
- Accessibility: `accessibilityRole="button"`, `accessibilityHint="Double tap to start this activity"`
- Touch target: minimum 44pt height
- Wrapping: `React.memo` with named function

### ErrorJourneyBarProps (Story 2-3)

```typescript
interface ErrorJourneyBarProps {
  /** Total number of error patterns tracked */
  total: number;
  /** Number of resolved error patterns */
  resolved: number;
}
```

**Visual spec:**

- Hidden when `total === 0`
- Background: `skillTint(Colors.primary, 0.04)`
- Container: `borderRadius: Radii.card` (16), `padding: Spacing.cardPadding` (16)
- Label: `Typography.caption` style, fontWeight 600, `Colors.primary`, text "{resolved}/{total} errors resolved"
- Bar track: `skillTint(Colors.primary, 0.08)`, height 6px, full-width, borderRadius 3
- Bar fill: `Colors.success`, animated width (`react-native-reanimated` `withTiming`), borderRadius 3
- Completion state: when `resolved === total`, show green "All resolved!" text with `Colors.success`
- Accessibility: `accessibilityRole="progressbar"`, `accessibilityValue={{ min: 0, max: total, now: resolved }}`
- Wrapping: `React.memo` with named function

---

## 5. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Supabase Tables                              │
├─────────────┬──────────────┬───────────────┬──────────┬────────────┤
│ companion_  │  vocabulary  │ skill_        │ error_   │ daily_     │
│ memory      │              │ progress      │ patterns │ activity   │
└──────┬──────┴──────┬───────┴───────┬───────┴────┬─────┴─────┬──────┘
       │             │               │            │           │
       │ retrieve    │ count where   │ min score  │ getTop    │ today's
       │ Memories()  │ next_review   │ query      │ Errors()  │ row
       │             │ <= now        │            │           │
       ▼             ▼               ▼            ▼           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  use-daily-briefing.ts hook                         │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Compose      │  │ Build Today  │  │ Count errors for         │  │
│  │ companion    │  │ Plan items   │  │ ErrorJourneyBar          │  │
│  │ message      │  │ (max 3)      │  │ (total vs resolved)      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │                │
│         ▼                 ▼                        ▼                │
│  companionMessage   todayPlan[]          totalErrors, resolvedErrors│
└─────────┬─────────────────┬────────────────────────┬───────────────┘
          │                 │                        │
          ▼                 ▼                        ▼
┌─────────────────┐ ┌──────────────────┐  ┌──────────────────────────┐
│ CompanionMessage│ │ TodayPlanItem    │  │ ErrorJourneyBar          │
│                 │ │ (×3 max)         │  │                          │
│ Props:          │ │ Props:           │  │ Props:                   │
│  - message      │ │  - title         │  │  - total                 │
│                 │ │  - subtitle      │  │  - resolved              │
│                 │ │  - iconColor     │  │                          │
│                 │ │  - iconEmoji     │  │                          │
│                 │ │  - badge         │  │                          │
│                 │ │  - onPress       │  │                          │
└─────────────────┘ └──────────────────┘  └──────────────────────────┘
```

**Data ownership boundaries:**

- `use-daily-briefing` makes its own Supabase queries with its own cache keys (`DAILY_BRIEFING`, `SRS_DUE_COUNT`)
- `use-progress` continues to own `SKILLS`, `DAILY_ACTIVITY_TODAY`, `RECENT_ACTIVITY`, `TOP_ERRORS`, `STREAK`
- The `HomeScreen` calls both hooks and passes data as props to the appropriate components
- `use-daily-briefing` imports `retrieveMemories` from `src/lib/memory.ts` and `getTopErrors` from `src/lib/error-tracker.ts` — it does NOT import from `use-progress`

---

## 6. Epic 1 Dependencies

### Verified Hooks (reused by Epic 2)

| Hook           | Path                        | What Epic 2 reuses                                                                         |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `useProgress`  | `src/hooks/use-progress.ts` | Existing home screen data (skills, activity, streak) — Epic 2 components coexist alongside |
| `useAuthStore` | `src/store/auth-store.ts`   | User profile for name, CEFR level, daily goal                                              |

### Verified Libraries (called by `use-daily-briefing`)

| Library            | Path                       | Function used                                                                            |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------- |
| `memory.ts`        | `src/lib/memory.ts`        | `retrieveMemories(userId, context, limit)` — vector similarity search with 0.7 threshold |
| `error-tracker.ts` | `src/lib/error-tracker.ts` | `getTopErrors(userId, limit)` — unresolved errors sorted by occurrences                  |
| `cache.ts`         | `src/lib/cache.ts`         | `cacheWithFallback()`, `CACHE_KEYS`, `CACHE_TTL`, `invalidateCache()`                    |
| `activity.ts`      | `src/lib/activity.ts`      | `getLocalDateString()` — for today's activity query                                      |
| `sentry.ts`        | `src/lib/sentry.ts`        | `captureError()` — error capture in catch blocks                                         |
| `supabase.ts`      | `src/lib/supabase.ts`      | Supabase client for direct queries                                                       |

### Verified Design Tokens (used by Epic 2 components)

| Token                                                                            | Source                 | Usage                                   |
| -------------------------------------------------------------------------------- | ---------------------- | --------------------------------------- |
| `Colors.primary`, `Colors.success`, `Colors.textPrimary`, `Colors.textSecondary` | `src/lib/design.ts`    | Component colors                        |
| `skillTint()`                                                                    | `src/lib/design.ts`    | Tinted backgrounds for all 3 components |
| `Typography.caption`, `Typography.bodySecondary`, `Typography.label`             | `src/lib/design.ts`    | Text styles                             |
| `Spacing.cardPadding`, `Radii.card`                                              | `src/lib/design.ts`    | Layout tokens                           |
| `Colors.accent`, `Colors.error`                                                  | `src/lib/design.ts`    | Badge colors                            |
| `SKILL_LABELS`                                                                   | `src/lib/constants.ts` | Skill name display in TodayPlanItem     |

### Verified UI Components (from Epic 1)

| Component     | Path                                    | Usage                                                |
| ------------- | --------------------------------------- | ---------------------------------------------------- |
| `SkeletonBar` | `src/components/common/SkeletonBar.tsx` | Loading state for CompanionMessage and TodayPlanItem |

### Verified Utilities

| Utility           | Path                 | Usage                        |
| ----------------- | -------------------- | ---------------------------- |
| `haptics.light()` | `src/lib/haptics.ts` | TodayPlanItem press feedback |

---

## 7. Architecture Validation

### Layer Boundary Compliance

All layers follow the established pattern:

```
Screens (app/) → Hooks (src/hooks/) → Libraries (src/lib/) → Supabase
     ↓                    ↓
Components (src/components/)   Store (src/store/)
```

- `HomeScreen` (screen) calls `useDailyBriefing()` (hook) and passes props to components
- `use-daily-briefing` (hook) calls library functions (`retrieveMemories`, `getTopErrors`, `cacheWithFallback`)
- Components receive data as props — no direct Supabase calls
- No new store created — all state is hook-local

### State Management Convention

- `use-daily-briefing` uses `useState` + `useCallback` + `useRef` (hook-local state)
- No new Zustand store — consistent with the single-store (`auth-store.ts`) convention
- Component state (animations, press state) is component-local via `useSharedValue` from Reanimated

### Caching Conventions

- Uses `cacheWithFallback` pattern identical to `use-progress.ts`
- New cache keys registered in `CACHE_KEYS` constant
- New TTL values registered in `CACHE_TTL` constant
- Cache invalidation on data writes (when user completes exercises or SRS reviews)

### Styling Conventions

- All colors from `Colors.*` design tokens
- All text styles from `Typography.*` presets
- Layout from `Spacing.*` and `Radii.*`
- Dynamic tints via `skillTint()`
- Static styles via NativeWind `className`
- Dynamic/computed styles via inline `style={{ }}`

### Component Conventions

- All 3 components: `export const Name = React.memo(function Name({...}: Props) {...})`
- Named functions (not arrow functions) inside `React.memo`
- Props interfaces defined: `CompanionMessageProps`, `TodayPlanItemProps`, `ErrorJourneyBarProps`
- Accessibility: `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` on interactive elements
- `accessibilityRole="progressbar"` with `accessibilityValue` on ErrorJourneyBar

### use-daily-briefing vs use-progress Boundary

| Aspect             | `use-progress`                                                              | `use-daily-briefing`                                                     |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Purpose**        | Raw progress data display                                                   | Composed briefing experience                                             |
| **Owns**           | skill_progress, daily_activity, error_patterns (top 5), streak              | companion message, SRS due count, Today's Plan items, briefing freshness |
| **Cache keys**     | `SKILLS`, `DAILY_ACTIVITY_TODAY`, `RECENT_ACTIVITY`, `TOP_ERRORS`, `STREAK` | `DAILY_BRIEFING`, `SRS_DUE_COUNT`                                        |
| **Error patterns** | Fetches top 5 unresolved for display in "Fix This Mistake" card             | Fetches top 3 unresolved for Today's Plan items                          |
| **Skills**         | Full skill list for skills overview                                         | Only weakest skill for recommendation                                    |
| **Daily activity** | Today + last 7 days for charts                                              | Today only for greeting context                                          |

**No duplication:** Both hooks query some of the same tables but with different filters, limits, and cache keys. The queries are lightweight and the caching prevents redundant DB hits. If the same data were shared, it would require either a shared store (violates convention) or prop drilling (increases coupling).

### No Conflicts with Existing Hooks

- `use-progress` is not modified — its queries, cache keys, and return type are unchanged
- `use-daily-briefing` uses separate cache keys, so no cache collisions
- Both hooks can be called in the same screen (`HomeScreen`) without interference
- `use-daily-briefing` does not import from `use-progress` — they are independent
