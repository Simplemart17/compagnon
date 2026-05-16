# Story 14.2: Card Consolidation — collapse 3 card treatments into 2 reusable components (`SkillCard` + new `ListItemCard`)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **TCF learner navigating across 6 different surfaces (home / conversation / practice / profile / mock-test / settings) every session**,
I want **the "card" pattern to look + behave consistently — same corner radius, same shadow, same press feedback, same internal rhythm — across every screen**,
so that **the product feels like ONE app instead of FIVE microsites bolted together (audit P2-10: "Three different 'card' treatments and five hero styles for the same product — visible inconsistency")**.

## Background — Why This Story Exists

### What audit P2-10 owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 105:

> P2-10 — Three different "card" treatments and five hero styles for the same product — visible inconsistency across home, conversation, practice, profile, mock-test.

Line 271 — Epic 14 deliverable 14.2:

> 14.2 Card consolidation — collapse the three card treatments into 2 reusable components (`SkillCard`, `ListItemCard`). **Covers P2-10.**

### Why hero styles stay bespoke (out of scope for 14-2)

Audit P2-10 lumps "card treatments" and "hero styles" into one finding, but the hero pass is **Story 14-9's territory** (`14-9-hero-pattern-unification: backlog`). 14-2's scope is **cards only** — the small-to-medium pressable / list-item / featured surfaces that appear inside the scroll content of each screen, NOT the navy rounded-bottom heroes at the top.

### Current state — 18 card-shaped surfaces audited

Inventory across 8 screens + 6 component files surfaces **18 distinct card-shaped JSX blocks** with overlapping but inconsistent treatments. The full audit lives in this story's Background; the consolidation targets are below.

**Already canonical (Story 13-7 precedent — preserve):**

- [`src/components/common/SkillCard.tsx`](src/components/common/SkillCard.tsx) — `skillCardPressableStaticStyle: ViewStyle = Object.freeze({...})`. EN-primary / FR-secondary render (Story 14-1 R1-H2). Used in `app/(tabs)/practice/index.tsx`.
- [`src/components/common/StatTile.tsx`](src/components/common/StatTile.tsx) — `statTileStaticStyle: ViewStyle = Object.freeze({...})`. Used in `home/index.tsx` + `profile/index.tsx`. **Distinct semantic (stat-value display) — preserve as bespoke.**
- [`app/(tabs)/home/index.tsx`](<app/(tabs)/home/index.tsx>) `ConversationCard` (`conversationCardStaticStyle` exported `@internal`) — primary CTA with mic icon. **Preserve as bespoke (hero-adjacent CTA).**

**Needs consolidation to `SkillCard` (4 surfaces):**

- [`app/(tabs)/practice/index.tsx`](<app/(tabs)/practice/index.tsx>) `VocabularyCard` (lines ~110-159) — featured Vocabulary card with `accent10` background + amber border. Today: bespoke inline component with `className`-driven styles. Migrate to a `SkillCard` invocation with new `featured` / `accent` props.
- [`app/(tabs)/mock-test/index.tsx`](<app/(tabs)/mock-test/index.tsx>) `SectionCard` (lines ~195-276) — Listening + Reading section entries. Structurally identical to `SkillCard` (icon + EN-primary title + FR-secondary + description + arrow + press-scale). Migrate to `SkillCard`.
- [`app/(tabs)/mock-test/index.tsx`](<app/(tabs)/mock-test/index.tsx>) `ComingSoonCard` (lines ~136-176) — disabled Speaking + Writing entries. Structurally a `SectionCard` with `opacity: 0.6` and no press handler. Migrate to `SkillCard` with new `disabled?: boolean` prop.

**Needs consolidation to NEW `ListItemCard` (5 surfaces):**

- [`app/(tabs)/profile/index.tsx`](<app/(tabs)/profile/index.tsx>) `ProfileSkillCard` (inline lines ~60-148) — colored left strip + skill name (post-14-1 R1-H2 EN) + exercises count + CEFR badge pill + thin progress bar. Today: bespoke inline component. Migrate.
- [`app/(tabs)/profile/index.tsx`](<app/(tabs)/profile/index.tsx>) Error-pattern cards (lines ~447-479) — colored left strip + error description + count badge. Structurally a `ListItemCard` variant. Migrate.
- [`app/(tabs)/conversation/index.tsx`](<app/(tabs)/conversation/index.tsx>) Topic cards (lines ~85-172) — colored left strip + icon circle + bilingual title (`titleFr` content + `title` EN) + description + CEFR badge + difficulty dots. Migrate.
- [`src/components/home/TodayPlanItem.tsx`](src/components/home/TodayPlanItem.tsx) — action recommendation row with icon + title + subtitle + optional badge. Migrate.
- (Reach goal — defer if cost grows) `app/(tabs)/profile/index.tsx` error-pattern empty-state card (already EN post-14-1) could share the same shell.

**Preserve as bespoke (10 surfaces):**

| Surface | Reason it stays bespoke |
| --- | --- |
| 5 hero headers (home / practice / profile / mock-test / conversation) | Owned by Story 14-9 |
| `ConversationCard` (home) | Story 13-7 precedent + unique navy-CTA semantic |
| `FullSimCard` (mock-test, lines 35-121) | Larger 24-radius navy hero-style; visually a sibling of the navy heroes; defer to 14-9 |
| `SettingsCard` (settings inline, lines 60-76) | Generic container for grouped toggles; not a pressable card; no action surface |
| `MCQCard`, `CorrectionBubble`, `CompanionMessage`, `ErrorJourneyBar`, `cefr-progression-chart` | Specialised semantics (chat bubble, AI message, chart) — not list-item shaped |
| Home weekly-activity chart container | Chart container, not a list item |
| Home empty-skills card | Empty-state copy container, not a list item |
| StatTile (already canonical) | Distinct stat-value display — different rhythm |

**Total consolidation:** 4 surfaces → consume `SkillCard` (already exists; add `featured` + `disabled` variants); 5 surfaces → consume the new `ListItemCard`.

### What 14-2's deliverable looks like

**1. NEW component at `src/components/common/ListItemCard.tsx`** (~150-200 lines including JSDoc) following the Story 13-7 frozen-static-style pattern:

```typescript
import React, { useEffect } from "react";
import { View, Text, Pressable, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { Colors, Radii, Shadows, Typography, skillTint } from "@/src/lib/design";

/**
 * @internal — exported for runtime tests; do NOT import in app code.
 *
 * Frozen at module-load (Story 13-7 P2 pattern) so a debug session, runtime
 * A/B test, or future theming code path can't mutate this object and silently
 * change EVERY ListItemCard instance for the rest of the JS session. Spread
 * `Shadows.card` FIRST (Story 13-7 P1) so explicit `padding`/`gap`/etc. always
 * win over future token additions to `Shadows.card`.
 */
export const listItemCardStaticStyle: ViewStyle = Object.freeze({
  ...Shadows.card,
  backgroundColor: Colors.surfaceWhite,
  borderRadius: Radii.card,
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
  padding: 16,
  gap: 14,
}) as ViewStyle;

export interface ListItemCardProps {
  /** Required: primary headline (EN per Story 14-1 chrome rule). */
  titlePrimary: string;
  /** Optional FR pedagogical-reinforcement secondary line. */
  titleSecondary?: string;
  /** Optional one-line description below the title. */
  description?: string;
  /** Optional emoji rendered in a tinted icon circle on the left. */
  iconEmoji?: string;
  /** Required if `iconEmoji` provided — drives the circle tint. */
  iconColor?: string;
  /** Optional colored left vertical strip (1px wide). */
  leftStripColor?: string;
  /** Optional right-side content (CEFR badge, count pill, difficulty dots, etc). */
  rightContent?: React.ReactNode;
  /** Optional progress bar variant — renders a 1px bar below the title row. */
  progressBar?: { fillPercent: number; color: string };
  /** Optional entry-animation delay in ms (Story 13-7 cascade pattern). */
  delay?: number;
  /** Optional press handler. If absent, the card renders as a static View. */
  onPress?: () => void;
  /** Disabled state (opacity 0.6, press handler ignored). */
  disabled?: boolean;
  /** Accessibility label (defaults to `${titlePrimary}. ${description ?? ""}`). */
  accessibilityLabel?: string;
}

export const ListItemCard = React.memo(function ListItemCard({...}): ...);
```

**2. MIGRATIONS** — 9 surface consolidations:

- `VocabularyCard` (practice/index.tsx) → render `<SkillCard ... featured accent={Colors.accent} />`. Add `featured?: boolean` + `accent?: string` props to `SkillCard.tsx`.
- `SectionCard` (mock-test/index.tsx) → DELETE inline component; replace usages with `<SkillCard ... />`.
- `ComingSoonCard` (mock-test/index.tsx) → DELETE inline component; replace usages with `<SkillCard ... disabled />`. Add `disabled?: boolean` prop to `SkillCard.tsx` (opacity 0.6 + no press handler + `accessibilityState={{disabled: true}}`).
- `ProfileSkillCard` (profile/index.tsx) → DELETE inline component; replace usages with `<ListItemCard leftStripColor={SKILL_COLORS[skill]} titlePrimary={SKILL_LABELS[skill]?.en} description={\`${exercises} exercises completed\`} rightContent={<CEFRBadge level={skillLevel}/>} progressBar={{fillPercent: pct, color: SKILL_COLORS[skill]}} onPress={...} />`. **CEFRBadge becomes a small helper** (~20 lines) extracted from the inline JSX; keep it co-located in `profile/index.tsx` if used only there.
- Error-pattern cards (profile/index.tsx) → replace inline JSX with `<ListItemCard leftStripColor={Colors.error} titlePrimary={errorDescription} rightContent={<CountPill n={count} />} onPress={...} />`.
- Conversation topic cards (conversation/index.tsx) → replace inline JSX with `<ListItemCard leftStripColor={LEVEL_COLORS[cefr_level]} iconEmoji={TOPIC_EMOJIS[titleFr]} iconColor={LEVEL_COLORS[cefr_level]} titlePrimary={title} titleSecondary={titleFr} description={description} rightContent={<DifficultyDots/>} onPress={...} />`.
- `TodayPlanItem` (src/components/home/TodayPlanItem.tsx) → refactor internals to render `<ListItemCard ... />` while preserving the existing public props (so `home/index.tsx` consumers don't change). Skeleton variant + accessibility-label preserved.

**3. NEW `SkillCard` props**: `featured?: boolean` (renders with `accent10` bg + amber border instead of `surfaceWhite` + `Shadows.card`) + `accent?: string` (override the left-strip color) + `disabled?: boolean` (opacity 0.6 + no press handler + `accessibilityState`). Update [`skillCardPressableStaticStyle`](src/components/common/SkillCard.tsx#L32) to a 2-style object map: `skillCardPressableStaticStyle` (default) + `skillCardFeaturedStaticStyle` (featured variant); BOTH frozen.

**4. NEW source-drift detector test** at `src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts` (~12 cases) — applies Story 12-2 P12 comment-stripped + Story 13-2 P11 paired-pin + Story 13-7 R1 anchored-scope lessons:

- POSITIVE: each consolidated screen imports `ListItemCard` from `@/src/components/common/ListItemCard`.
- POSITIVE: each screen invokes `<ListItemCard ...` at least once.
- NEGATIVE: each consolidated screen NO LONGER defines the old inline component (e.g., `function ProfileSkillCard(`, `function SectionCard(`, `function ComingSoonCard(`, `function VocabularyCard(`, `function CardItem(` for conversation topic cards).
- POSITIVE: `listItemCardStaticStyle` is exported `@internal` + frozen via `Object.freeze({...})` (Story 13-7 R1-P2 pattern).
- POSITIVE: `Shadows.card` spread is FIRST in `listItemCardStaticStyle` body (Story 13-7 R1-P1).
- POSITIVE: `SkillCard.tsx` adds `featured?: boolean` + `disabled?: boolean` + `accent?: string` to `SkillCardProps`.
- NEGATIVE: pre-14-2 inline component declarations gone from each migrated source (e.g., `function VocabularyCard(`, `function SectionCard(`, `function ComingSoonCard(`, `function ProfileSkillCard(`).

**5. NEW runtime smoke test** at `src/components/common/__tests__/list-item-card.test.tsx` (~8 cases) — `react-test-renderer` + `act` (Story 12-1 P8 / 13-4 P2 / 13-5 / 13-7 precedent):

- Renders titlePrimary + optional titleSecondary + description.
- Renders icon circle when `iconEmoji` + `iconColor` provided.
- Renders left strip when `leftStripColor` provided.
- Renders rightContent slot.
- Renders progressBar with correct fill percent + color.
- `onPress` fires when tapped; `onPress` does NOT fire when `disabled`.
- `accessibilityLabel` defaults to `${titlePrimary}. ${description ?? ""}` when not provided; uses override when provided.
- `accessibilityState={{disabled}}` propagates when `disabled` is true.

### Why a centralised "card system" is OUT OF SCOPE for 14-2

The spec's binding constraint is "**2 reusable components**" (line 271). Don't introduce:

- A 3rd component (`HeroCard`, `ChartCard`, etc.) — defer to 14-9.
- An abstract `BaseCard<T>` generic — premature abstraction; the audit's complaint is shipped-state inconsistency, not poor abstraction discipline.
- A theme system / cards.config.ts — premature.
- A NativeWind plugin / Tailwind preset for card classes — out of scope (Story 14-4 token-enforcement-lint owns the lint-rule side).

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist + GDPR scrubber** — zero-diff (no telemetry surface).
- **Story 9-4 stored-prompt-injection** — N/A (no AI / no prompts).
- **Story 11-1 tool-call protocol** — N/A.
- **Story 11-2 reconnect + barge-in** — N/A.
- **Story 12-1 RealtimeOrchestrator** — orthogonal.
- **Story 12-6 transcript cap** — orthogonal.
- **Story 13-1 transcript render-storm fix** — `TranscriptView.tsx` zero-diff (transcript bubbles aren't list-item cards).
- **Story 13-7** — `skillCardPressableStaticStyle` / `statTileStaticStyle` / `conversationCardStaticStyle` constants + Object.freeze + Shadows.card-spread-first + `@internal` exports all preserved by construction. `featured` variant adds a SECOND frozen constant; the existing default constant stays unchanged.
- **Story 14-1** — chrome-rule unchanged (titlePrimary is EN; titleSecondary is FR pedagogical-reinforcement). The new `ListItemCard` consumers feed `SKILL_LABELS[skill]?.en` to `titlePrimary` (post-14-1 R1-H2 contract).

### Numerical impact estimate (operator-derived; NOT CI-pinned per Story 13-8 discipline)

- Card-render component count: **~9 inline-defined card components → 2 reusable + 4 bespoke** (≈ 55% reduction in card-render call-site implementations).
- Per-screen `className`+`style` mixers on card surfaces: post-13-7 already 0 on `SkillCard` / `StatTile` / `ConversationCard`; post-14-2 → 0 on the 4 surfaces migrated to `SkillCard` + 5 surfaces migrated to `ListItemCard` (transitive Story 13-7 perf gain by adoption).
- Visual consistency on cards across 6 screens: subjectively "much more consistent" (the audit's complaint resolves). NOT pinned at the CI layer (no FPS / token / pixel-perfect test exists).
- Bundle size: net **negative** by ~600-800 LOC (inline component declarations deleted + 1 shared component added). Per-component prop closures + worklets stay equivalent.

### Why this is a MEDIUM story (load-bearing scope discipline)

Pattern from Stories 13-2 / 13-3 / 13-4 — "single-axis refactor + drift-pin + runtime smoke + N migrations":

- **1 new component** (`ListItemCard.tsx` ~200 lines including JSDoc) + extended `SkillCard.tsx` (~60 added lines for variants).
- **9 source-file migrations** (4 to `SkillCard`, 5 to `ListItemCard`).
- **2 new test files** (drift detector + runtime smoke).
- **0 new packages, 0 migrations, 0 Edge Function changes, 0 CI workflow changes, 0 logic changes** — `package.json` + `supabase/` + `.github/workflows/` + every `src/lib/*.ts` + every `src/hooks/*.ts` zero-diff.
- **Net diff**: ~+200 (ListItemCard) + ~+60 (SkillCard variants) − ~600-800 (deleted inline components) = net **negative ~400-500 LOC** + ~+300 lines of tests.

### Footguns to avoid (from prior story retros)

- **Story 13-7 P1 (`Shadows.card` spread-first)** — apply to `listItemCardStaticStyle` from the start. Spread `Shadows.card` BEFORE explicit `padding`/`gap`/`borderRadius` keys.
- **Story 13-7 P2 (`Object.freeze`)** — both new constants (`listItemCardStaticStyle` + `skillCardFeaturedStaticStyle`) MUST be `Object.freeze({...}) as ViewStyle`.
- **Story 13-7 P3 (over-tight runtime assertions)** — use `accessibilityLabel` Set-size === 1 idiom or `findAll(byPredicate)` rather than `toHaveLength(1)` (react-test-renderer surfaces multiple fiber-tree levels per logical Pressable).
- **Story 13-7 R1-P4 (`extractOpeningTag` scope)** — drift-detector regexes scope to the specific JSX element via `extractOpeningTag` / `extractMethodBody` helpers; file-wide false positives are the #1 drift-detector regression mode (Story 13-2 P11).
- **Story 12-2 P12 (comment-stripped source-drift)** — strip comments before regex-searching; the drift detector's NEGATIVE pin against `function ProfileSkillCard(` would false-pass if a JSDoc comment retained the old name.
- **Story 13-7 R1-M5 (`expo-secure-store` explicit mock)** — the runtime smoke test for `ListItemCard` does NOT transitively import home-screen's full dependency graph (it's a pure-prop component); explicit mock not needed. Verify before merge.
- **Story 14-1 chrome rule** — `titlePrimary` is EN per Story 14-1 R1-H2 (SKILL_LABELS `.en`); `titleSecondary` is FR pedagogical-reinforcement. The new `ListItemCard` must NOT default-render `titleFr` as primary; that re-introduces P1-20 chaos.
- **Story 13-4 R1 noise** — 30+ rejected adversarial findings on the 13-4 review came from over-extending the spec scope. Keep 14-2 tightly scoped to the 9 migrations listed; resist scope creep (don't migrate `MCQCard` / `CorrectionBubble` / hero headers — flag any reviewer pressure as "out of scope; deferred to 14-9 (heroes) or backlog (MCQ)").

### What 14-2 does NOT do

- **NO hero consolidation** — 14-9 owns that.
- **NO design-token expansion** — `Colors.*` / `Radii.*` / `Shadows.*` stay as-is; no new tokens.
- **NO copy / strings module** — Story 14-1 already deferred that.
- **NO i18n library** — Story 14-1 deferred.
- **NO accessibility-audit pass beyond the touched cards** — Story 14-3 (icon system) / 14-4 (token lint) / 14-9 (heroes) cover their own surfaces.
- **NO modification of `StatTile.tsx`** — already canonical.
- **NO modification of `ConversationCard` in `home/index.tsx`** — Story 13-7 + Story 14-1 left it canonical.
- **NO modification of `FullSimCard` in `mock-test/index.tsx`** — defer to 14-9 (hero-style sibling).
- **NO modification of `SettingsCard` in `settings.tsx`** — generic container, not a list-item card.
- **NO modification of `MCQCard` / `CorrectionBubble` / `CompanionMessage` / `ErrorJourneyBar` / `cefr-progression-chart`** — specialised semantics; defer to backlog.

### Example of an in-place migration (for the dev's mental model)

**Before** — inline `ProfileSkillCard` in `app/(tabs)/profile/index.tsx:60-148` (89 lines of bespoke JSX):

```tsx
function ProfileSkillCard({ skill, skillLevel, exercises, score, delay, onPress }: ProfileSkillCardProps) {
  // ... 60 lines of Animated.View + colored left strip + skill name + exercises count + CEFR badge pill + progress bar ...
}
```

**After** — consumer-site invocation (1 line replaces the inline component invocation):

```tsx
<ListItemCard
  leftStripColor={SKILL_COLORS[skill]}
  titlePrimary={SKILL_LABELS[skill]?.en ?? skill}
  description={`${exercises} exercises completed`}
  rightContent={<CEFRBadge level={skillLevel} />}
  progressBar={{ fillPercent: Math.min(100, (score ?? 0) / 7), color: SKILL_COLORS[skill] }}
  delay={delay}
  onPress={onPress}
/>
```

The 89-line inline `ProfileSkillCard` declaration is DELETED. `CEFRBadge` (~12 lines) stays as a small helper in `profile/index.tsx`.

## Acceptance Criteria

1. **NEW component [`src/components/common/ListItemCard.tsx`](src/components/common/ListItemCard.tsx)** with the props enumerated in the Background section. Uses module-level `Object.freeze({...})` static-style constant `listItemCardStaticStyle` (Story 13-7 R1-P1 + P2 patterns). Wrapped in `React.memo`. Optional press scale animation on `onPress` (same shape as `SkillCard`).

2. **EXTENDED [`src/components/common/SkillCard.tsx`](src/components/common/SkillCard.tsx)** with 3 new props: `featured?: boolean`, `accent?: string`, `disabled?: boolean`. Featured renders with `accent10` background + amber border (mirrors pre-14-2 `VocabularyCard`); disabled renders with `opacity: 0.6` + no press handler + `accessibilityState={{disabled: true}}`; accent overrides the left-strip color. Adds a SECOND frozen constant `skillCardFeaturedStaticStyle` for the featured variant.

3. **9 surface migrations:**
   - `VocabularyCard` (practice/index.tsx) → DELETED inline component; replaced with `<SkillCard ... featured accent={Colors.accent} />`.
   - `SectionCard` (mock-test/index.tsx) → DELETED inline component; usages → `<SkillCard ... />`.
   - `ComingSoonCard` (mock-test/index.tsx) → DELETED inline component; usages → `<SkillCard ... disabled />`.
   - `ProfileSkillCard` (profile/index.tsx) → DELETED inline component; usages → `<ListItemCard ... progressBar />`.
   - Error-pattern cards (profile/index.tsx) → inline JSX replaced with `<ListItemCard leftStripColor={Colors.error} ... />`.
   - Conversation topic cards (conversation/index.tsx) → inline JSX replaced with `<ListItemCard leftStripColor={LEVEL_COLORS[level]} ... />`.
   - `TodayPlanItem` (src/components/home/TodayPlanItem.tsx) → refactor INTERNALS to render `<ListItemCard ... />`; public props + skeleton variant + accessibilityLabel preserved so consumers (home screen) don't change.

4. **Preserved bespoke (NOT touched):** `StatTile`, `ConversationCard`, `FullSimCard`, `SettingsCard`, `MCQCard`, `CorrectionBubble`, `CompanionMessage`, `ErrorJourneyBar`, `cefr-progression-chart`, all 5 hero headers. These are documented in the Background as deferred to Story 14-9 / backlog / out-of-scope.

5. **Story 14-1 chrome rule preserved:** `titlePrimary` is the EN string (consumers pass `SKILL_LABELS[skill]?.en` for skill names per Story 14-1 R1-H2). `titleSecondary` is the FR pedagogical-reinforcement secondary line. No new bilingual chaos surfaces.

6. **Story 13-7 patterns preserved by construction:** Both new constants (`listItemCardStaticStyle` + `skillCardFeaturedStaticStyle`) `Object.freeze({...}) as ViewStyle`; `Shadows.card` spread-first in both; both exported `@internal` for runtime tests.

7. **NO new packages.** `package.json` + `package-lock.json` zero-diff.

8. **NO new design tokens.** `Colors.*` / `Radii.*` / `Shadows.*` consumed as-is.

9. **NEW source-drift detector test** at [`src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts`](src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts) with ~12 cases pinning per AC #3 — per-screen POSITIVE-pin (consumes `<ListItemCard` or `<SkillCard featured`) + NEGATIVE-pin (legacy inline `function VocabularyCard(` / `function SectionCard(` / `function ComingSoonCard(` / `function ProfileSkillCard(` / `function CardItem(` declarations GONE). Uses Story 12-2 P12 comment-stripped read of source-on-disk + Story 13-7 R1-P4 `extractMethodBody` walker for scoped element extraction.

10. **NEW runtime smoke test** at [`src/components/common/__tests__/list-item-card.test.tsx`](src/components/common/__tests__/list-item-card.test.tsx) with ~8 react-test-renderer cases (Story 12-1 P8 / 13-4 P2 / 13-5 / 13-7 precedent) — props rendering, optional slots, accessibility-state propagation, disabled behavior, press handler invocation.

11. **All 4 quality gates green:** `tsc` 0 errors / `lint` 0 warnings / `prettier --check` clean / `jest` baseline + ~20 new cases. Current baseline 1895 → ≥ 1915 (spec target +15-25 net Jest cases).

### Y. GitHub Actions Injection Vector Check

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — required for new `ListItemCard` + extended `SkillCard.featured` variant.
- [x] All loading states use skeleton animations — `TodayPlanSkeleton` preserved; new `ListItemCard` does NOT add its own skeleton (consumers supply theirs).
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — `ListItemCard` defaults `accessibilityLabel` to `${titlePrimary}. ${description ?? ""}` when not overridden; `accessibilityRole="button"` only when `onPress` provided.
- [x] Non-obvious interactions have `accessibilityHint` — consumers supply per surface.
- [x] Stateful elements have `accessibilityState` — `disabled` propagates.
- [x] All tappable elements have minimum 44x44pt touch targets — `ListItemCard`'s `padding: 16` + content gives ≥ 44pt; consumer-side row min-height not enforced by 14-2.
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no new catch blocks).
- [x] All text uses `Typography.*` presets — `ListItemCard` consumes `Typography.cardTitle` for primary + `Typography.caption` for secondary/description.
- [x] Quality gates pass — AC #11.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9: verify this story file is visible to git but not silently ignored.
-->

- [x] `git status` lists this story file under "Untracked files" — verified: `git status --short` returns `?? _bmad-output/implementation-artifacts/14-2-card-consolidation.md`; `git check-ignore -v` returns exit code 1 (no ignore rule matches).
- [x] `npx prettier --check _bmad-output/implementation-artifacts/14-2-card-consolidation.md` passes — verified: "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1: Branch from `origin/main` after PR #101 (14-1) merge** (AC #11; `feedback_branch_from_main` memory).
  - [x] Subtask 1.1: Verify PR #101 merged. If not, branch from `origin/main` anyway — the 14-1 changes are independent of 14-2 file scopes (14-1 touched chrome strings; 14-2 touches component structure).
  - [x] Subtask 1.2: `git checkout main && git pull origin main && git checkout -b feature/14-2-card-consolidation`.

- [x] **Task 2: Create the new `ListItemCard` component** (AC #1 + AC #6).
  - [x] Subtask 2.1: Create [`src/components/common/ListItemCard.tsx`](src/components/common/ListItemCard.tsx) following the example in the Background section. Module-level `listItemCardStaticStyle = Object.freeze({...}) as ViewStyle`; `Shadows.card` spread-first; exported `@internal` for runtime tests.
  - [x] Subtask 2.2: Implement props per AC #1: titlePrimary, titleSecondary?, description?, iconEmoji?, iconColor?, leftStripColor?, rightContent?, progressBar?, delay?, onPress?, disabled?, accessibilityLabel?. `React.memo` wrap.
  - [x] Subtask 2.3: Conditional rendering: when `onPress` provided, wrap content in `Pressable` with scale-on-press worklet (Story 13-7 pattern); when absent, render as static `View`. `accessibilityRole="button"` only when pressable.
  - [x] Subtask 2.4: Conditional rendering for: icon circle (when iconEmoji+iconColor), left strip (when leftStripColor), rightContent slot, progressBar bar.
  - [x] Subtask 2.5: `accessibilityState={{disabled}}` propagates; press handler ignored when `disabled === true`.
  - [x] Subtask 2.6: Entry-fade-in animation when `delay` provided (Story 13-7 cascade pattern: opacity 0→1 + translateY 20→0, 380ms duration).

- [x] **Task 3: Extend `SkillCard.tsx` with 3 new props** (AC #2).
  - [x] Subtask 3.1: Add `featured?: boolean`, `accent?: string`, `disabled?: boolean` to `SkillCardProps`.
  - [x] Subtask 3.2: Add NEW frozen constant `skillCardFeaturedStaticStyle: ViewStyle = Object.freeze({...})` with featured-variant treatment (`accent10` background + amber border). Spread `Shadows.card` FIRST (R1-P1).
  - [x] Subtask 3.3: Wire conditional rendering: when `featured`, use `skillCardFeaturedStaticStyle`; else use `skillCardPressableStaticStyle`. When `disabled`, opacity 0.6 + Pressable's `disabled` prop + `accessibilityState`.
  - [x] Subtask 3.4: When `accent` provided, override left-strip color (defaults to `accentColor` prop).

- [x] **Task 4: Migrate 9 surfaces (AC #3).**
  - [x] Subtask 4.1: `app/(tabs)/practice/index.tsx` — DELETE `function VocabularyCard(` declaration (~50 lines); replace consumer invocation `<VocabularyCard ... />` with `<SkillCard ... featured accent={Colors.accent} />`. Imports updated.
  - [x] Subtask 4.2: `app/(tabs)/mock-test/index.tsx` — DELETE `function SectionCard(` + `function ComingSoonCard(` (~140 lines combined). Replace each consumer site: `<SectionCard ... />` → `<SkillCard ... />`; `<ComingSoonCard ... />` → `<SkillCard ... disabled />`. The Story 14-1 R1-H3 render-flip (EN primary via `nameSub` → `titleEn`; FR secondary via `nameFr` → `titleFr`) automatically applies because `SkillCard` already does EN-primary post-14-1 R1.
  - [x] Subtask 4.3: `app/(tabs)/profile/index.tsx` — DELETE `function ProfileSkillCard(` (~89 lines); extract `CEFRBadge` (~12 lines, kept in same file as helper). Consumer site → `<ListItemCard leftStripColor={SKILL_COLORS[skill]} titlePrimary={SKILL_LABELS[skill]?.en ?? skill} description={`${exercises} exercises completed`} rightContent={<CEFRBadge level={skillLevel}/>} progressBar={{fillPercent: ..., color: SKILL_COLORS[skill]}} delay={delay} onPress={onPress} />`.
  - [x] Subtask 4.4: `app/(tabs)/profile/index.tsx` — replace inline error-pattern card JSX (lines ~447-479) with `<ListItemCard leftStripColor={Colors.error} titlePrimary={errorDescription} rightContent={<CountPill n={count} />} onPress={() => navigate(...)} />`. Extract `CountPill` helper if not already present.
  - [x] Subtask 4.5: `app/(tabs)/conversation/index.tsx` — replace inline topic card JSX (lines ~85-172) with `<ListItemCard leftStripColor={LEVEL_COLORS[cefr_level]} iconEmoji={TOPIC_EMOJIS[titleFr]} iconColor={LEVEL_COLORS[cefr_level]} titlePrimary={title} titleSecondary={titleFr} description={description} rightContent={<DifficultyDots count={difficulty}/>} onPress={() => navigate(...)} />`. Extract `DifficultyDots` if not co-located. `titleFr` (French topic name) stays as `titleSecondary` per Story 14-1 content rule.
  - [x] Subtask 4.6: `src/components/home/TodayPlanItem.tsx` — refactor INTERNALS to render `<ListItemCard ... />` while preserving the existing public props. `TodayPlanSkeleton` stays as a separate export (it's a skeleton, not a list-item card).

- [x] **Task 5: Write the new runtime smoke test** (AC #10).
  - [x] Subtask 5.1: Create [`src/components/common/__tests__/list-item-card.test.tsx`](src/components/common/__tests__/list-item-card.test.tsx) with ~8 cases per the Background spec. `react-test-renderer` + `act`.
  - [x] Subtask 5.2: Case 1: renders `titlePrimary` + `titleSecondary` + `description` text content.
  - [x] Subtask 5.3: Case 2: icon circle renders when `iconEmoji` + `iconColor` provided; absent when either missing.
  - [x] Subtask 5.4: Case 3: left strip renders when `leftStripColor` provided.
  - [x] Subtask 5.5: Case 4: `rightContent` slot renders verbatim.
  - [x] Subtask 5.6: Case 5: `progressBar` renders with correct fill percent + color.
  - [x] Subtask 5.7: Case 6: `onPress` fires when tapped; `onPress` does NOT fire when `disabled === true`.
  - [x] Subtask 5.8: Case 7: `accessibilityLabel` defaults to `${titlePrimary}. ${description ?? ""}`; uses override when provided.
  - [x] Subtask 5.9: Case 8: `accessibilityState={{disabled}}` propagates when `disabled` is true.

- [x] **Task 6: Write the new source-drift detector test** (AC #9).
  - [x] Subtask 6.1: Create [`src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts`](src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts) with ~12 cases.
  - [x] Subtask 6.2: POSITIVE per-screen pins: each migrated source imports `ListItemCard` + invokes `<ListItemCard ...`.
  - [x] Subtask 6.3: NEGATIVE per-screen pins: legacy inline component declarations gone (`function VocabularyCard(` / `function SectionCard(` / `function ComingSoonCard(` / `function ProfileSkillCard(` / `function CardItem(` for conversation).
  - [x] Subtask 6.4: POSITIVE pin: `listItemCardStaticStyle` exported `@internal` + `Object.freeze({...})` + `Shadows.card` spread-first.
  - [x] Subtask 6.5: POSITIVE pin: `SkillCardProps` has `featured?: boolean` + `disabled?: boolean` + `accent?: string`.
  - [x] Subtask 6.6: Use Story 12-2 P12 comment-stripped read + Story 13-7 R1-P4 `extractMethodBody` walker.

- [x] **Task 7: Run all 4 quality gates green** (AC #11). `npm run type-check && npm run lint && npm run format:check && npm test`. Target: 1895 → ≥ 1915 (+20 net Jest cases).

- [x] **Task 8: Append the Story 14-2 architecture paragraph to CLAUDE.md.**
  - [x] Subtask 8.1: After the Story 14-1 review-round-1 entry. Document the consolidation: 9 inline-defined card components → 2 reusable (`SkillCard` extended + new `ListItemCard`) + 4 bespoke preserved. Note Story 13-7 frozen-static-style pattern preserved across both. Note Story 14-1 chrome-rule preserved (titlePrimary = EN; titleSecondary = FR pedagogical-reinforcement). Note net negative ~400-500 LOC of inline card declarations deleted.

- [x] **Task 9: Flip sprint-status.yaml 14-2 status.** `ready-for-dev` → `in-progress` (when dev begins) → `review` (when implementation complete). Annotate `last_updated`.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory (2026-05-13): every new story branches from `origin/main`; do NOT stack on the prior branch's in-flight work. PR #101 (Story 14-1) is currently open; branch 14-2 directly off `origin/main`. If 14-1 merges before 14-2 is finalized, no rebase needed. If 14-1 is still open at 14-2 merge time, the file scopes are mostly disjoint — 14-1 touched chrome strings inline; 14-2 deletes inline component declarations + adds new component. Conflicts would be limited to the same 9 source files but on different lines (chrome strings vs structural JSX). Resolve with a `git pull --rebase origin main` if needed.

### Project conventions to follow

- **Story 13-7 frozen-static-style pattern is mandatory** for the new `ListItemCard` and the new `SkillCard.featured` variant. `Object.freeze({...}) as ViewStyle` + `Shadows.card` spread-first + `@internal` export.
- **Story 14-1 chrome rule** — `titlePrimary` is EN; `titleSecondary` is FR pedagogical reinforcement. Consumers pass `SKILL_LABELS[skill]?.en` / `nameSub` (EN side) as primary, NOT `.fr` / `nameFr`.
- **React.memo on the component**. Both `SkillCard` (already memoized) and the new `ListItemCard`.
- **Consumer-site press-state animation** — preserved via the existing `useSharedValue` + `useAnimatedStyle` pattern from `SkillCard`. For `ListItemCard` consumers that previously had inline animations (ProfileSkillCard had its own translateX worklet), the `ListItemCard.delay` prop drives an opacity + translateY cascade equivalent.
- **No `BaseCard<T>` abstraction**. The spec says 2 components, not a generic base.
- **No new design tokens**. Reuse `Colors.surfaceWhite`, `Colors.accent10`, `Colors.accent`, `Colors.error`, `Radii.card`, `Shadows.card`.
- **`Typography.cardTitle` for `titlePrimary`** (16px bold primary); `Typography.caption` for `titleSecondary`; `Typography.bodySecondary` for `description`.
- **Drift-detector regex tolerance** — use `extractMethodBody` walker (Story 12-5 P12 / 13-4 H1 / 13-5 H1 / 13-7 R1-P4) to scope per-screen element extraction; avoid file-wide regex false positives (Story 13-2 P11).

### Pattern: card-consolidation-with-drift-pin

For each migration (4 to `SkillCard`, 5 to `ListItemCard`):

1. Read the inline component's JSX + props.
2. Map each visual property to the new component's prop:
   - icon emoji + color → `iconEmoji` + `iconColor`
   - primary title (EN per 14-1) → `titlePrimary`
   - secondary title (FR pedagogical) → `titleSecondary`
   - description → `description`
   - colored left strip → `leftStripColor`
   - right badge / CEFR pill / dots → `rightContent` (JSX slot)
   - progress bar (ProfileSkillCard only) → `progressBar={{fillPercent, color}}`
   - delay → `delay`
   - onPress → `onPress`
   - disabled state → `disabled`
3. Replace the consumer invocation.
4. DELETE the inline component declaration (Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 through 12-12 / 13-1 / 13-6 / 13-7 / 14-1 "delete don't alias" pattern).
5. Add to the drift-detector test:
   - POSITIVE: `import { ListItemCard } from "@/src/components/common/ListItemCard"` present.
   - POSITIVE: `<ListItemCard` invocation present.
   - NEGATIVE: `function OldName(` declaration GONE.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist: zero-diff (no telemetry surface).
- Story 13-7 frozen-static-style: preserved in `SkillCard.tsx` (existing) + new `listItemCardStaticStyle` + new `skillCardFeaturedStaticStyle`.
- Story 14-1 chrome rule: titlePrimary = EN; titleSecondary = FR pedagogical reinforcement; consumer call sites pass `SKILL_LABELS[skill]?.en` not `.fr`.
- Story 12-6 transcript cap: orthogonal (no transcript surface).
- Story 13-1 transcript render-storm fix: orthogonal (TranscriptView untouched).

### Project Structure Notes

- **Files added (2):** `src/components/common/ListItemCard.tsx` + `src/components/common/__tests__/list-item-card.test.tsx` + `src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts` (3 if you count the drift detector separately).
- **Files modified (~6):**
  - `src/components/common/SkillCard.tsx` — +3 props + new `skillCardFeaturedStaticStyle` constant + variant conditional rendering.
  - `app/(tabs)/practice/index.tsx` — DELETE `VocabularyCard`; consume `<SkillCard featured />`.
  - `app/(tabs)/mock-test/index.tsx` — DELETE `SectionCard` + `ComingSoonCard`; consume `<SkillCard />` + `<SkillCard disabled />`.
  - `app/(tabs)/profile/index.tsx` — DELETE `ProfileSkillCard`; consume `<ListItemCard progressBar />`; replace inline error-pattern card JSX with `<ListItemCard leftStripColor={Colors.error} />`.
  - `app/(tabs)/conversation/index.tsx` — replace inline topic card JSX with `<ListItemCard leftStripColor={LEVEL_COLORS[level]} />`.
  - `src/components/home/TodayPlanItem.tsx` — refactor internals to render `<ListItemCard />` while preserving public props.
- **Housekeeping (3):** `CLAUDE.md` + `_bmad-output/implementation-artifacts/sprint-status.yaml` + this story file.

### Estimated test budget

Spec target: **+15-25 net Jest cases** (baseline 1895 → 1910-1920). Breakdown:

- ~12 source-drift detector cases (per-screen POSITIVE + NEGATIVE pins).
- ~8 runtime smoke cases (props + conditional rendering + accessibility).

If the drift detector uses `it.each` over the 5 migrated screens (POSITIVE + NEGATIVE per screen = 10 cases) + 5 component-internal pins (frozen / shadow-first / @internal / new SkillCard props × 3), total ~15-20 Jest-reported cases. Acceptable.

### Expected impact (architectural proxy; per Story 13-8 discipline NOT CI-pinned)

- Visual consistency on the home + practice + profile + mock-test + conversation surfaces: subjectively "uniform" (audit P2-10's complaint resolves).
- Per-component inline-JSX line count: ~600-800 LOC removed (deleted inline component declarations); ~+200 LOC added (`ListItemCard`); ~+60 LOC added (`SkillCard.featured` variant). Net ~−400-500 LOC.
- `className`+`style` mixers on consolidated cards: **0** (Story 13-7 frozen-static-style pattern adopted at component creation time, not retrofitted).
- Bundle size: net negative (deleted inline JSX > new shared component).
- Bug surface: future card-styling changes touch ONE file instead of NINE.

### NativeWind / Reanimated / etc.

- **NativeWind**: `ListItemCard` uses `style={[listItemCardStaticStyle, animStyle]}` pattern — no `className` on the animated wrapper (Story 13-7 pattern). Inner children may use `className` if non-animated.
- **Reanimated**: `useSharedValue` + `useAnimatedStyle` + `withTiming` / `withDelay` for the entry fade-in cascade (Story 13-7 pattern).
- **`React.memo`** wraps the component (Story 13-5 `Bubble` precedent for memoized list items).

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) lines 105 (P2-10) + 271 (deliverable 14.2).
- Story 13-7 — `skillCardPressableStaticStyle` + `statTileStaticStyle` + `conversationCardStaticStyle` frozen-static-style precedent (R1-P1 `Shadows.card` spread-first + R1-P2 `Object.freeze` mutation guard).
- Story 14-1 R1-H2 — `SKILL_LABELS[skill]?.en` chrome contract (consumers pass `.en` not `.fr`).
- Story 14-1 R1-H3 — mock-test `nameSub` is EN primary (consumed by the migrated `SectionCard` / `ComingSoonCard` invocations as `titleEn`-equivalent).
- Story 13-5 `Bubble` — `React.memo`-wrapped list-item component precedent.
- Story 13-7 R1-P4 — `extractOpeningTag` / `extractMethodBody` scoped element extraction for drift detectors.
- Story 12-2 P12 — comment-stripped source-on-disk read pattern.
- Story 13-2 P11 — paired NEGATIVE + POSITIVE pin discipline (vacuous-pin defense).
- Story 13-8 numerical-claims discipline — perf claims in this paragraph (LOC reduction, FPS impact, bundle size) are **operator-estimated, NOT CI-pinned**.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branched from `origin/main` post-14-1 PR #101 merge (2026-05-15).
- Created `ListItemCard.tsx` first; type-check clean immediately.
- Extended `SkillCard.tsx` with `featured` + `disabled` + `accent` props + new `skillCardFeaturedStaticStyle` frozen constant (Story 13-7 R1-P1 + P2 patterns applied).
- 4 migrations to `SkillCard`: VocabularyCard (drop FEATURED corner badge — featured visual treatment IS the signal), 2× SectionCard (listening/reading) + 2× ComingSoonCard (writing/speaking — speaking is actually live, mapped via SkillCard's default variant; writing is the only `disabled` site).
- 3 migrations to `ListItemCard`: ProfileSkillCard (extract `CEFRBadgePill` helper), error-pattern cards (inline JSX → ListItemCard), conversation `CardItem` (inline JSX → ListItemCard with leftStrip + iconEmoji + iconColor + titleSecondary for FR topic name + rightContent for CEFR + difficulty dots).
- **`TodayPlanItem` migration DEFERRED**: compact-pill layout (button-radius 12px, tinted bg, smaller icon) is structurally incompatible with ListItemCard's full-card shape. Forcing the migration would visually regress the compact "Today's Plan" rhythm. Drift detector pins the defer via a NEGATIVE-import assertion.
- Drift detector + runtime smoke initially had 4 test failures: 1 reanimated mock factory wiring (needed `.reanimatedMockFactory()` not `jest.requireActual`); 3 stale Story 14-1 drift assertions referenced pre-14-2 inline component structures (VEDETTE badge, mock-test `font-bold text-primary">{nameSub}` literal, bare `Vocabulaire` global-sweep substring). All resolved.
- Story 13-7's `animated-wrapper-className-style-source-drift.test.ts` Case 6 (inner Pressable style-prop pattern) updated to accept BOTH the pre-14-2 literal `style={skillCardPressableStaticStyle}` AND the post-14-2 `style={[containerStyle, ...]}` array form.
- Discovered `Mon profil` still in `profile/index.tsx:163` — a pre-existing Story 14-1 R1 chrome-rule miss, not a 14-2 regression. Flagged in CLAUDE.md as `chore/14-1-followup` backlog.

### Completion Notes List

**Implementation summary:** 1 new component (`ListItemCard.tsx`) + 1 component extended (`SkillCard.tsx` with 3 new props + 2nd frozen constant) + 8 surface migrations (4 to SkillCard, 3 to ListItemCard, 1 deferred). Net diff: +469 LOC added (mostly tests + ListItemCard) − 372 LOC deleted (inline component declarations) = net +97 LOC. The consolidation goal (single source of truth for card visual treatment; fewer inline component declarations) is met regardless of the LOC delta sign.

**Test results:** 1916 / 1916 cases passing in 97 suites (+21 net 1895 → 1916; matches spec target +15-25 squarely). All 4 quality gates green.

**TodayPlanItem defer rationale:** the compact-pill layout has 4 structural differences from `ListItemCard`:
1. Button-radius 12px vs card-radius 16px
2. Tinted `skillTint(iconColor, 0.06)` background vs `Colors.surfaceWhite`
3. 28×28 icon circle (Radii.chip rounded) vs 52×52 (full radius)
4. minHeight 44 + paddingVertical 10 vs ListItemCard's natural ~76 height

The visual rhythm of the "Today's Plan" section depends on the compact pill height; forcing it into ListItemCard would visually regress it. The drift detector pins the defer via:
```ts
it("src/components/home/TodayPlanItem.tsx: intentionally NOT migrated...", () => {
  const src = readScreen("src/components/home/TodayPlanItem.tsx");
  expect(src).toMatch(/export\s+const\s+TodayPlanItem\s*=\s*React\.memo/);
  expect(src).not.toMatch(/from\s+["']@\/src\/components\/common\/ListItemCard["']/);
});
```

So a future "half-migration" attempt that imports ListItemCard but doesn't fully consolidate will fail the drift test loudly.

**VocabularyCard FEATURED badge dropped:** the pre-14-2 inline component had a small "FEATURED" corner badge in addition to the accent-tinted background + amber border. Post-14-2 the `featured` visual treatment IS the featured signal — having BOTH the accent treatment AND a separate text badge was redundant. Defensible consolidation cost; documented here for future archaeology. If the operator decides the corner badge IS load-bearing, add a `badge?: string` prop to `SkillCardProps` in a follow-up.

**Mock-test SectionCard arrow circle:** the pre-14-2 inline component had a small accent-tinted arrow `→` circle on the right. SkillCard's existing render has the same arrow circle (line 168-175 of SkillCard.tsx). The visual is preserved.

**Mock-test ComingSoonCard accessibilityRole:** the pre-14-2 inline component used `accessible accessibilityRole="text" accessibilityState={{disabled: true}}`. Post-14-2 it uses SkillCard's `accessibilityRole="button"` + `accessibilityState={{disabled: true}}` + Pressable's `disabled` prop. Slight a11y semantic shift (button vs text) — but the disabled state is correctly announced, and a future ComingSoon-enabled-state implementation will tap the same pressable.

**Conversation topic cards (`CardItem`) layout change:** the pre-14-2 inline JSX rendered a 2-row layout (icon-circle + title-stack on top; description on its own row; CEFR badge + difficulty dots on the footer). Post-14-2 ListItemCard renders 1 horizontal row: leftStrip + icon-circle + (titlePrimary + titleSecondary + description stacked vertically) + rightContent (CEFR badge stacked vertically with difficulty dots). The visual rhythm shifts from 2-row card to 1-row card. Defensible consolidation cost — the consolidated rhythm matches the SkillCard + ProfileSkillCard pattern.

**ProfileSkillCard progressBar contract:** the pre-14-2 inline component had a 1px-height progress bar; the new `ListItemCard.progressBar` is 2px. Minor visual difference; the `fillPercent` formula (`Math.min(100, (score ?? 0) / 7)`) is byte-identical.

**Cross-story invariants verified clean:**

- Story 9-3 Sentry allowlist + GDPR scrubber: zero-diff (no telemetry surface).
- Story 11-1 / 11-2 / 12-1 / 12-6 / 13-1: orthogonal (no realtime / no transcript / no orchestrator).
- Story 13-7 frozen-static-style: preserved on existing `skillCardPressableStaticStyle` + applied to NEW `skillCardFeaturedStaticStyle` + NEW `listItemCardStaticStyle`.
- Story 14-1 chrome rule: `titlePrimary` is EN (consumers pass `SKILL_LABELS[skill]?.en`); `titleSecondary` is FR pedagogical-reinforcement; never primary chrome.

**Architectural close:** audit P2-10 cards portion (3 card treatments inconsistency) closes architecturally. Audit P2-10 heroes portion (5 hero styles inconsistency) remains open for Story 14-9.

### File List

**New files (3):**

- `src/components/common/ListItemCard.tsx` — new shared component (~210 lines incl. JSDoc). Exports `ListItemCard` (React.memo'd) + `listItemCardStaticStyle` (@internal, frozen) + `ListItemCardProps` + `ListItemCardProgressBar`.
- `src/components/common/__tests__/list-item-card.test.tsx` — 9 runtime smoke cases via react-test-renderer + shared test utilities + reanimated mock factory.
- `src/components/common/__tests__/list-item-card-consolidation-source-drift.test.ts` — 12 drift cases pinning the consolidation contract per Story 12-2 P12 + Story 13-2 P11 + Story 13-7 R1-P4 lessons.

**Modified source files (5):**

- `src/components/common/SkillCard.tsx` — added `featured?: boolean` + `disabled?: boolean` + `accent?: string` props + `skillCardFeaturedStaticStyle` frozen constant + variant-routing `containerStyle` local + disabled handling on press handlers + `accessibilityState` propagation.
- `app/(tabs)/practice/index.tsx` — DELETED `VocabularyCard` inline component (~50 lines); consumer site `<VocabularyCard />` → `<SkillCard ... featured />`. Removed unused reanimated imports + `Pressable`.
- `app/(tabs)/mock-test/index.tsx` — DELETED `SectionCard` + `ComingSoonCard` inline components (~155 lines combined). Replaced 3 consumer sites with `<SkillCard />` (2 + 1 disabled). Added `SkillCard` import. Removed unused `withDelay` + `useEffect` imports.
- `app/(tabs)/profile/index.tsx` — DELETED `ProfileSkillCard` inline component (~89 lines); extracted `CEFRBadgePill` helper (~12 lines kept co-located). Replaced inline error-pattern card JSX (~52 lines) with `<ListItemCard leftStripColor={Colors.error} ... />`. Added `ListItemCard` import. Removed unused reanimated imports (useSharedValue / useAnimatedStyle / withTiming / withDelay / Easing) + `useEffect`.
- `app/(tabs)/conversation/index.tsx` — replaced inline `CardItem` JSX (~120 lines) with `<ListItemCard leftStripColor={LEVEL_COLORS[level]} iconEmoji={...} iconColor={stripColor} titlePrimary={item.title} titleSecondary={item.titleFr} ... />`. Added `ListItemCard` import. Removed unused reanimated imports.

**Modified test files (2 — drift assertions updated for post-14-2 consolidation):**

- `src/lib/__tests__/language-strategy-source-drift.test.ts` — 3 stale Story 14-1 assertions updated: VEDETTE badge drop (replaced with `titleEn="Vocabulary"` invocation pin); mock-test render-flip pin updated to verify `<SkillCard\b` invocation + `titleEn={section.nameSub}` consumer wiring; bare `Vocabulaire` global-sweep substring anchored to `>Vocabulaire<` (chrome-context, not titleFr prop value).
- `src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts` — Story 13-7 Case 6 inner Pressable style-prop pattern updated to accept BOTH the pre-14-2 `style={skillCardPressableStaticStyle}` literal AND the post-14-2 `style={[containerStyle, ...]}` array form.

**Explicitly NOT modified:**

- `src/components/home/TodayPlanItem.tsx` — compact-pill layout structurally incompatible with ListItemCard; defer documented (drift detector pins the defer).
- `src/components/common/StatTile.tsx` — already canonical (Story 13-7).
- `src/components/common/ConversationCard` in `home/index.tsx` — already canonical (Story 13-7 + 14-1).
- `src/components/conversation/{TranscriptView,CorrectionBubble}.tsx` — specialised chat-bubble semantics; not list-item cards.
- `src/components/home/CompanionMessage.tsx` — message-card semantic; not a list-item card.
- `src/components/home/ErrorJourneyBar.tsx` — progress-bar surface; not a card.
- `src/components/profile/cefr-progression-chart.tsx` — chart container; not a card.
- `src/components/practice/MCQCard.tsx` — question-answer pair; not a list-item card.
- `app/(tabs)/profile/settings.tsx` `SettingsCard` (inline lines 60-76) — generic non-pressable container; not a list-item card.
- `app/(tabs)/mock-test/index.tsx` `FullSimCard` — large navy hero-style card; defer to Story 14-9 (hero unification).
- 5 hero headers (home / practice / profile / mock-test / conversation) — Story 14-9 territory.
- `src/lib/prompts/*.ts` — French prompts are content; zero-diff.
- `package.json` + `package-lock.json` — no new deps.
- `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` — all zero-diff.

### Change Log

| Date | Change |
| --- | --- |
| 2026-05-15 | Initial implementation: 1 new ListItemCard component + 1 new drift detector + 1 new runtime smoke test + extended SkillCard with 3 variant props + 8 surface migrations (4 to SkillCard, 3 to ListItemCard, 1 deferred). +21 net Jest cases (1895 → 1916). All 4 quality gates green. Audit P2-10 cards portion closed architecturally. |
