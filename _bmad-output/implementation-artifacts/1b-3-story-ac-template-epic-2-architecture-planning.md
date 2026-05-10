# Story 1B.3: Story AC Template & Epic 2 Architecture Planning

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want standardized story acceptance criteria that include polish requirements and a documented component architecture for Epic 2,
So that every future story ships with design tokens, accessibility, and skeleton loaders from day one, and Epic 2 development starts with a clear component plan.

## Acceptance Criteria

### A. Standardized Polish Checklist for Story Creation

1. **AC-A1:** The BMad `create-story` template at `.claude/skills/bmad-create-story/template.md` includes a "Polish Requirements" section appended to every new story's acceptance criteria with the following checklist items:
   - All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
   - All loading states use skeleton animations — no `ActivityIndicator` spinners
   - All interactive elements have `accessibilityRole` + `accessibilityLabel`
   - Non-obvious interactions have `accessibilityHint`
   - Stateful elements have `accessibilityState`
   - All tappable elements have minimum 44x44pt touch targets
   - All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
   - All text uses `Typography.*` presets — no raw pixel `fontSize`
   - Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

2. **AC-A2:** The checklist is formatted as a dedicated section titled "### Z. Polish Requirements" (last lettered section) so it appears consistently at the end of every story's acceptance criteria

3. **AC-A3:** The `project-context.md` file is updated with a reference to the polish checklist so all agents are aware of it

### B. Epic 2 Component Architecture Document

4. **AC-B1:** A document is created at `_bmad-output/planning-artifacts/epic-2-architecture.md` containing all items in AC-B2 through AC-B7

5. **AC-B2:** Component tree showing how `CompanionMessage`, `TodayPlanItem`, and `ErrorJourneyBar` integrate into the existing home screen (`app/(tabs)/home/index.tsx`)

6. **AC-B3:** Directory structure decision documented: whether to create `src/components/home/` for Epic 2 components or use the existing inline pattern — with rationale

7. **AC-B4:** Data hook design for a new `src/hooks/use-daily-briefing.ts` hook, including:
   - Which Supabase queries it makes (memory retrieval, SRS due count, weakest skill, active error patterns)
   - Which `CACHE_KEYS` it uses from `src/lib/cache.ts` (and any new keys needed)
   - How it composes the companion message string
   - How it determines "Today's Plan" items (SRS due → vocabulary, weakest skill → practice, error drills → grammar)
   - Return type interface (`UseDailyBriefingReturn`)
   - Error handling and loading states

8. **AC-B5:** Props interface definitions for each new component (`CompanionMessageProps`, `TodayPlanItemProps`, `ErrorJourneyBarProps`) matching the UX design specification

9. **AC-B6:** Data flow diagram showing: Supabase tables → `use-daily-briefing` hook → component props → rendered UI

10. **AC-B7:** Dependencies on Epic 1 verified components explicitly listed (existing hooks, libs, design tokens that Epic 2 stories will reuse)

### C. Daily Briefing Data Hook Design Documentation

11. **AC-C1:** The hook's Supabase query list is specified:
    - `companion_memory` — retrieve recent memories via `retrieveMemories()` from `src/lib/memory.ts`
    - `vocabulary` — count where `next_review <= now` for SRS due count
    - `skill_progress` — find weakest skill by lowest `average_score`
    - `error_patterns` — fetch unresolved patterns via `getTopErrors()` from `src/lib/error-tracker.ts`
    - `daily_activity` — today's activity for greeting context

12. **AC-C2:** Cache strategy documented: which existing `CACHE_KEYS` are reused vs. new keys needed, with TTL values

13. **AC-C3:** Companion message composition logic documented: template for combining greeting + memory context + due items + weakest skill into a natural-language briefing string

14. **AC-C4:** "Today's Plan" item determination algorithm documented: priority ordering (SRS due > error drills > weakest skill > suggested practice), maximum 3 items, badge type assignment logic

### D. Architecture Validation

15. **AC-D1:** The architecture document validates against existing codebase patterns:
    - Layer boundary compliance (screens → hooks → libs)
    - State management convention (hook-local state, no new Zustand stores)
    - Caching conventions (`cacheWithFallback` pattern from `src/lib/cache.ts`)
    - Styling conventions (design tokens, NativeWind className + inline style)
    - Component conventions (React.memo, named functions, props interfaces, accessibility)

16. **AC-D2:** No conflicts with existing `useProgress` hook — document clearly delineates which data `use-daily-briefing` owns vs. what `use-progress` already provides

### E. Quality Gates

17. **AC-E1:** All new/modified files pass `npm run type-check && npm run lint && npm run format:check` with zero errors and zero warnings
18. **AC-E2:** No code changes break existing functionality — this is a planning/documentation story with minimal code changes (template update + project-context update only)

## Tasks / Subtasks

- [x] Task 1: Update story creation template with polish checklist (AC: A1-A2)
  - [x] 1.1 Add "### Z. Polish Requirements" section to `.claude/skills/bmad-create-story/template.md`
  - [x] 1.2 Include all 9 checklist items from AC-A1
  - [x] 1.3 Verify the template renders correctly when used by `create-story`

- [x] Task 2: Update project-context.md with polish reference (AC: A3)
  - [x] 2.1 Add a note in the "Code Quality & Style Rules" section referencing the mandatory polish checklist

- [x] Task 3: Create Epic 2 component architecture document (AC: B1-B7)
  - [x] 3.1 Create `_bmad-output/planning-artifacts/epic-2-architecture.md`
  - [x] 3.2 Write component tree showing CompanionMessage, TodayPlanItem, ErrorJourneyBar integration with home screen
  - [x] 3.3 Document directory structure decision for `src/components/home/`
  - [x] 3.4 Design `use-daily-briefing.ts` hook interface and responsibilities
  - [x] 3.5 Define props interfaces for all 3 new components
  - [x] 3.6 Create data flow diagram (text-based)
  - [x] 3.7 List Epic 1 dependencies that Epic 2 reuses

- [x] Task 4: Document daily briefing data hook design (AC: C1-C4)
  - [x] 4.1 Specify all Supabase queries with table names and operations
  - [x] 4.2 Document cache strategy (existing keys + new keys + TTLs)
  - [x] 4.3 Define companion message composition template
  - [x] 4.4 Define "Today's Plan" item selection algorithm

- [x] Task 5: Validate architecture against codebase (AC: D1-D2)
  - [x] 5.1 Verify layer boundary compliance
  - [x] 5.2 Document use-daily-briefing vs use-progress boundary
  - [x] 5.3 Confirm no conflicts with existing hooks

- [x] Task 6: Quality gates (AC: E1-E2)
  - [x] 6.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 6.2 Verify no existing functionality is broken

## Dev Notes

### This is primarily a planning/documentation story

Two code files are modified (template.md, project-context.md). The main deliverable is the Epic 2 architecture document. Do NOT:

- Create any React Native components or screens
- Create the `use-daily-briefing.ts` hook (that's Epic 2 work)
- Create the `src/components/home/` directory (that's Epic 2 work)
- Modify any existing screens or hooks
- Add dependencies

DO:

- Update the story creation template with the polish checklist
- Update project-context.md with a reference to the polish checklist
- Create a thorough architecture planning document for Epic 2
- Validate the architecture plan against the existing codebase patterns

### Story Creation Template Location

The BMad create-story template is at: `.claude/skills/bmad-create-story/template.md`

Current template content:

```markdown
# Story {{epic_num}}.{{story_num}}: {{story_title}}

Status: ready-for-dev

## Story

## Acceptance Criteria

## Tasks / Subtasks

## Dev Notes

## Dev Agent Record
```

Add the "### Z. Polish Requirements" section inside the "## Acceptance Criteria" section as the last subsection, so every new story gets it automatically.

### Epic 2 Component Architecture — Key Context

Epic 2 is "Companion Daily Briefing (Home Screen Evolution)" with 3 stories:

- **2-1:** CompanionMessage component + memory-driven briefing
- **2-2:** Today's Plan — curated activity recommendations
- **2-3:** ErrorJourneyBar + home screen integration

The architecture document must give each Epic 2 story's developer everything they need to implement without ambiguity.

### Current Home Screen Structure

`app/(tabs)/home/index.tsx` currently has:

- Fixed header with greeting, level chip, streak badge
- ScrollView with RefreshControl
- Inline sub-components: `ConversationCard`, `SmallActionCard`, `ActivityBar`
- Data from `useProgress()` hook
- `SkeletonBar` loading state

Epic 2 will evolve this screen by:

1. Adding a `CompanionMessage` card at the top (below header)
2. Replacing the quick-actions grid with a "Today's Plan" list of `TodayPlanItem` components
3. Adding an `ErrorJourneyBar` below Today's Plan
4. Keeping existing Weekly Activity section

### Existing Data Sources for Daily Briefing

The `use-daily-briefing.ts` hook should compose data from existing libraries:

| Data Need             | Source                        | Function                                        |
| --------------------- | ----------------------------- | ----------------------------------------------- |
| Companion memories    | `src/lib/memory.ts`           | `retrieveMemories(userId, context, limit)`      |
| SRS due count         | Direct Supabase query         | `vocabulary` table where `next_review <= now()` |
| Weakest skill         | `src/lib/cache.ts` + Supabase | `skill_progress` table, min `average_score`     |
| Active error patterns | `src/lib/error-tracker.ts`    | `getTopErrors(userId, limit)`                   |
| Today's activity      | Direct Supabase query         | `daily_activity` table for today's date         |
| User profile          | `src/store/auth-store.ts`     | `useAuthStore()` for name, level, goals         |

Existing `CACHE_KEYS` that can be reused: `SKILLS`, `TOP_ERRORS`, `DAILY_ACTIVITY_TODAY`, `STREAK`

New cache keys needed: `DAILY_BRIEFING` (suggested TTL: 10-15 minutes), `SRS_DUE_COUNT` (suggested TTL: 15 minutes)

### Component Specifications from UX Design

**CompanionMessage:**

- Background: `Colors.primary` at 5% opacity → `skillTint(Colors.primary, 0.05)`
- Avatar: 32px circle, `Colors.primary` bg, white "C" initial
- Name: `Typography.caption`, `Colors.primary`, weight 700
- Message: `Typography.bodySecondary`, `Colors.textPrimary`
- Border radius: `Radii.card` (16px), Padding: `Spacing.cardPadding` (16px)
- Accessibility: `accessibilityRole="text"`, label includes message content

**TodayPlanItem:**

- Background: `skillTint(iconColor, 0.06)`
- Icon container: 28px rounded square, `skillTint(iconColor, 0.12)`
- Title: `Typography.label`, skill color
- Subtitle: `Typography.caption`, `Colors.textSecondary`
- Badge variants: `due` (amber), `suggested` (amber), `error` (red)
- Press: scale 0.97 + opacity 0.8 + haptic light
- Accessibility: `accessibilityRole="button"`, hint "Double tap to start this activity"

**ErrorJourneyBar:**

- Background: `skillTint(Colors.primary, 0.04)`
- Label: `Typography.caption`, weight 600, `Colors.primary`
- Bar track: `skillTint(Colors.primary, 0.08)`, 6px height
- Bar fill: `Colors.success`, animated width
- Hidden when `total === 0`, green "All resolved!" when complete
- Accessibility: `accessibilityRole="progressbar"` with min/max/now values

### Directory Structure Recommendation

Create `src/components/home/` for Epic 2 components:

- `src/components/home/CompanionMessage.tsx`
- `src/components/home/TodayPlanItem.tsx`
- `src/components/home/ErrorJourneyBar.tsx`

Rationale: These are reusable across multiple contexts (home screen, profile, post-conversation feedback) and complex enough to benefit from isolation. Follows the existing pattern of `src/components/conversation/`, `src/components/practice/`, `src/components/profile/`.

### Hook Boundary: use-daily-briefing vs use-progress

- `use-progress` owns: skill_progress data, daily_activity data, error patterns, streak
- `use-daily-briefing` owns: companion message composition, SRS due count, "Today's Plan" item list, briefing freshness
- `use-daily-briefing` READS from the same Supabase tables but has different cache keys and different data composition logic
- The hook should NOT duplicate `useProgress` queries — it should either import from `use-progress` or make its own targeted queries with different cache keys

### Previous Story Learnings (from 1B.1 and 1B.2)

- ESLint import/order rule is active — place imports correctly per group
- Prettier will auto-format — run `npm run format:check` at the end
- The hex color CI check (`scripts/check-hex-colors.sh`) only scans `app/` and `src/components/` for `#hex` patterns — it does NOT affect `.md` files or template files
- All 19 new design tokens from Story 1B.2 are available (accent25, success12, whiteAlpha06-85, etc.)
- `skillTint(color, opacity)` is the standard way to create tinted backgrounds

### Git Intelligence

Recent commits show the pattern:

- `feat(story-1b-2):` prefix for feature work
- `chore:` prefix for status updates
- Branch naming: `feature/1b-3-story-ac-template-epic-2-architecture-planning`

### Project Structure Notes

- Template file: `.claude/skills/bmad-create-story/template.md` — this is a BMad skill file, not app code
- Project context: `_bmad-output/project-context.md` — loaded by all AI agents
- Architecture output: `_bmad-output/planning-artifacts/epic-2-architecture.md` — new file
- Existing planning artifacts: `_bmad-output/planning-artifacts/` contains `epics.md`, `prd.md`, `architecture.md`, `ux-design-specification.md`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 1B.3 acceptance criteria and technical requirements]
- [Source: _bmad-output/planning-artifacts/architecture.md — Layer boundaries, hook vs lib rules, component patterns, Edge Function template, screen state machine pattern]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — CompanionMessage, TodayPlanItem, ErrorJourneyBar component specs, home screen design]
- [Source: _bmad-output/planning-artifacts/prd.md — Functional requirements FR7-FR15 (conversation/memory), FR37-FR42 (progress)]
- [Source: _bmad-output/project-context.md — Critical implementation rules, naming conventions, design system rules]
- [Source: src/hooks/use-progress.ts — Existing progress data hook pattern, cache usage, return type]
- [Source: src/lib/memory.ts — retrieveMemories() function, vector search with 0.7 threshold]
- [Source: src/lib/error-tracker.ts — getTopErrors(), ErrorPattern type, micro-drill generation]
- [Source: src/lib/cache.ts — CACHE_KEYS, CACHE_TTL, cacheWithFallback pattern]
- [Source: src/lib/srs.ts — SM-2 algorithm, SRSState/SRSUpdate types]
- [Source: src/lib/activity.ts — Shared activity utilities, getLocalDateString()]
- [Source: src/lib/design.ts — Colors, Typography, Spacing, Radii, Shadows, skillTint()]
- [Source: app/(tabs)/home/index.tsx — Current home screen structure with inline components]
- [Source: _bmad-output/implementation-artifacts/1b-1-ci-enforcement-hex-color-check-accessibility-lint.md — Previous story patterns]
- [Source: _bmad-output/implementation-artifacts/1b-2-nativewind-classname-hex-conversion-design-token-cleanup.md — Previous story patterns and design token additions]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — no errors encountered during implementation.

### Completion Notes List

- **Task 1:** Added "### Z. Polish Requirements" section with 9 checklist items to `.claude/skills/bmad-create-story/template.md`. Template verified to render correctly.
- **Task 2:** Added mandatory polish checklist reference to `_bmad-output/project-context.md` in the "Code Quality & Style Rules" section.
- **Task 3:** Created comprehensive architecture document at `_bmad-output/planning-artifacts/epic-2-architecture.md` with component tree, directory structure decision, hook design, props interfaces, data flow diagram, and Epic 1 dependencies.
- **Task 4:** Documented daily briefing hook design including all 5 Supabase queries, cache strategy (2 new keys + 3 reused), companion message composition template, and Today's Plan selection algorithm with priority ordering.
- **Task 5:** Validated architecture against codebase — verified all library functions exist (`retrieveMemories`, `getTopErrors`, `getLocalDateString`, `captureError`), confirmed layer boundary compliance, documented `use-daily-briefing` vs `use-progress` boundary, confirmed no conflicts.
- **Task 6:** All quality gates pass: `npm run type-check` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (all files pass). No existing functionality broken.

### Change Log

- 2026-03-26: Story 1B.3 implementation complete — template updated, project-context updated, Epic 2 architecture document created.

### File List

- `.claude/skills/bmad-create-story/template.md` — MODIFIED: added "### Z. Polish Requirements" section
- `_bmad-output/project-context.md` — MODIFIED: added mandatory polish checklist reference
- `_bmad-output/planning-artifacts/epic-2-architecture.md` — NEW: Epic 2 component architecture document
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status updated
- `_bmad-output/implementation-artifacts/1b-3-story-ac-template-epic-2-architecture-planning.md` — MODIFIED: tasks marked complete, status updated
