# Story 14.9: Hero Pattern Unification — collapse the five bespoke hero headers (home, conversation, practice, mock-test, profile) into one `<HeroHeader>` component sourced from a single set of design tokens

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **a user moving between the five top-level tabs (home, conversation, practice, mock-test, profile)**,
I want **the dark rounded-bottom navy hero header at the top of each screen to feel like the SAME header** — same corner radius, same shadow, same vertical rhythm, same brand fingerprint —
so that **the product feels like ONE app instead of five microsites bolted together (audit P2-10: "Three different 'card' treatments and five hero styles for the same product — visible inconsistency")**.

## Background — Why This Story Exists

### What audit / roadmap owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 278 — Epic 14 deliverable 14.9:

> 14.9 Hero pattern unification — pick one hero system; apply across home, conversation, practice, mock-test, profile.

Audit finding **P2-10** (line 105 of the same file) reads:

> Three different "card" treatments and **five hero styles** for the same product — visible inconsistency across home, conversation, practice, profile, mock-test.

Story 14-2 closed the **cards portion** of P2-10 (collapsed 8 inline card components into `SkillCard` + `ListItemCard`). The 14-2 spec at [`_bmad-output/implementation-artifacts/14-2-card-consolidation.md:518`](_bmad-output/implementation-artifacts/14-2-card-consolidation.md#L518) explicitly punts the heroes portion to Story 14-9. The 14-2 paragraph also enumerates the deferred heroes in §"Out of scope":

> 5 hero headers (home / practice / profile / mock-test / conversation) | Owned by Story 14-9

Story 14-9 closes the **heroes portion** of P2-10, which finishes Epic 14's P2-10 closure entirely.

### What "five hero styles" actually means — the inventory

Each top-level screen rolls its own dark navy rounded-bottom hero. The inventory (captured 2026-05-16 during spec authoring) shows the inconsistencies the audit flagged:

| # | Screen | File:line | className | paddingTop | `Shadows.hero` | `items-center` | overlay |
|---|---|---|---|---|---|---|---|
| 1 | home (skeleton) | [`app/(tabs)/home/index.tsx:201`](<app/(tabs)/home/index.tsx#L201>) | `bg-primary pb-6 px-6 rounded-b-[28px]` | `insets.top + 16` | NO | NO | NO |
| 2 | home (live) | [`app/(tabs)/home/index.tsx:239`](<app/(tabs)/home/index.tsx#L239>) | `bg-primary pb-6 px-6 rounded-b-[28px]` | `insets.top + 16` | YES | NO | NO |
| 3 | conversation | [`app/(tabs)/conversation/index.tsx:161`](<app/(tabs)/conversation/index.tsx#L161>) | `bg-primary rounded-b-[28px] pb-6 px-6` | `insets.top + 16` | NO | NO | depth-glow (`skillTint(Colors.primaryDark, 0.4)`, `rounded-b-[32px]`, 50%-height bottom layer) |
| 4 | practice | [`app/(tabs)/practice/index.tsx:112`](<app/(tabs)/practice/index.tsx#L112>) | `bg-primary pb-7 px-6 rounded-b-[28px]` | `insets.top + 16` | YES | NO | NO |
| 5 | mock-test | [`app/(tabs)/mock-test/index.tsx:401`](<app/(tabs)/mock-test/index.tsx#L401>) | `bg-primary px-6 pb-8 rounded-b-[28px] items-center` | `insets.top + 20` | YES | YES | NO |
| 6 | profile (skeleton) | [`app/(tabs)/profile/index.tsx:114`](<app/(tabs)/profile/index.tsx#L114>) | `rounded-b-[28px] bg-primary px-6 pb-8 items-center` | `insets.top + 12` | NO | YES | NO |
| 7 | profile (live) | [`app/(tabs)/profile/index.tsx:160`](<app/(tabs)/profile/index.tsx#L160>) | `rounded-b-[28px] bg-primary px-6 pb-8` | `insets.top + 12` | NO | NO | inner-dim (`skillTint(Colors.bgDark, 0.35)`, `rounded-b-[40px]`, absolute-fill layer) |

**The same 4 axes vary across all 7 surfaces:**

1. **`paddingTop` insets offset**: `+ 12` (profile) / `+ 16` (home, conversation, practice) / `+ 20` (mock-test) — 3 distinct values.
2. **`paddingBottom`**: `pb-6` (24px on home, conversation) / `pb-7` (28px on practice) / `pb-8` (32px on mock-test, profile) — 3 distinct values.
3. **`Shadows.hero` applied?**: 3 of 7 surfaces apply it (home-live, practice, mock-test); 4 do NOT (home-skeleton, conversation, profile-skeleton, profile-live). Skeletons inherit the wrong inconsistency.
4. **`items-center`?**: 3 of 7 center (mock-test, profile-skeleton, then-mismatched-live-profile-removed); 4 left-align.

Plus the **className ordering** itself drifts: conversation puts `rounded-b-[28px]` second, profile puts it first, home/practice put it last. Stylistic noise but it makes the inconsistency more visible when reading the codebase. Plus the depth overlays in conversation + profile-live use **different colors and different radii** (`primaryDark 0.4` vs `bgDark 0.35`; `rounded-b-[32px]` vs `rounded-b-[40px]`).

### Two structural problems beyond the visible inconsistency

**(a) `Presets.heroHeader` is defined in [`src/lib/design.ts:466-474`](src/lib/design.ts#L466-L474) but UNUSED across the app.** The canonical preset already exists as design intent — it's just never imported. Story 14-9 either consumes the preset or replaces it; either way the unused dead token is closed out per the Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 / 12-7 / 12-8 / 13-X / 14-X **"delete don't alias"** pattern.

**(b) `rounded-b-[28px]` bypasses the Story 14-4 design-token gate.** The bash gate at [`scripts/check-design-tokens.sh:107`](scripts/check-design-tokens.sh#L107) catches `rounded-\[Nunit\]` (the un-prefixed form, e.g., `rounded-[28px]`), but does NOT catch the side-specific variants `rounded-(b|t|l|r|tl|tr|bl|br)-\[Nunit\]`. All 7 hero surfaces use `rounded-b-[28px]` — i.e., **all 7 instances of the raw `28px` literal bypass the Story 14-4 enforcement**. Story 14-9 closes this regex gap as a hardening pass on Story 14-4's gate.

### Why one component (not a Tailwind class refactor)

Three reasons the right answer is a `<HeroHeader>` React component, not just stricter token discipline:

1. **The depth overlays are React structure, not class state.** Two of the seven heroes (conversation + profile-live) carry inner depth-overlay `<View>` children. A pure className refactor can't share that JSX; a component prop (`overlay="depth-glow" | "inner-dim"`) can.
2. **The `insets.top + N` paddingTop is React state.** The safe-area `useSafeAreaInsets()` hook runs in the consumer screen; the canonical hero needs to receive a `paddingTopOffset` prop to add to `insets.top`. Tailwind cannot express runtime-derived padding.
3. **Cross-story precedent.** Story 14-2 collapsed cards into 2 reusable components (`SkillCard` + `ListItemCard`) precisely so the React structure could be shared. Story 14-9 mirrors that move for heroes — one component with variant props, applied across the 5 screens. The codebase already trusts this pattern.

## Acceptance Criteria

### AC-A: Component shape — `src/components/common/HeroHeader.tsx`

1. `HeroHeader` exported as `React.memo` wrapper (default + named) — mirrors Story 14-2 / 14-3 / 14-7 / 14-8 precedent.
2. `displayName = "HeroHeader"` set on the memo wrapper.
3. Public props interface `HeroHeaderProps`:
   - `children: React.ReactNode` — caller-provided hero content (greeting, brand label, action buttons, etc).
   - `paddingTopOffset?: number` — added to `useSafeAreaInsets().top` to compute total paddingTop. Defaults to **16** (matches home / conversation / practice — the majority pattern). Mock-test (`+20`) and profile (`+12`) pass an explicit override.
   - `paddingBottom?: number` — bottom inner padding. Defaults to **24** (matches `pb-6` — home / conversation). Practice passes **28** (`pb-7`); mock-test + profile pass **32** (`pb-8`).
   - `centered?: boolean` — if `true`, sets `alignItems: "center"` on the inner content container. Defaults to `false`. Mock-test live + profile skeleton pass `centered={true}`.
   - `overlay?: "depth-glow" | "inner-dim" | undefined` — optional inner overlay layer rendered absolutely-positioned BEHIND `children`. `"depth-glow"` reproduces conversation's bottom-50% `primaryDark` glow with `rounded-b-[32px]` corners; `"inner-dim"` reproduces profile-live's absolute-fill `bgDark` dim with `rounded-b-[40px]` corners. Default `undefined` renders no overlay.
   - `style?: ViewStyle` — escape hatch for one-off per-screen tweaks (passed through to the outer `<View>` style array). Defaults to undefined. **Use sparingly** — every consumer should be addressable by props.
4. Internal layout: outer `<View>` always carries `backgroundColor: Colors.primary` + `borderBottomLeftRadius: Radii.heroBottom` + `borderBottomRightRadius: Radii.heroBottom` + `paddingHorizontal: 24` + `Shadows.hero` (applied **canonically** to all 7 surfaces — this is the consistency fix). Inner content `<View>` carries `paddingTop`, `paddingBottom`, and `alignItems` derived from props.
5. Frozen static styles for the 3 invariant style chunks (outer container, depth-glow overlay, inner-dim overlay) per Story 13-7 R1-P1 + R1-P2 pattern (`Object.freeze({ ...Shadows.hero, ... }) as ViewStyle`; `Shadows.hero` spread FIRST so explicit padding/radius always wins over future token additions).
6. The frozen `heroHeaderContainerStaticStyle` constant is **exported `@internal`** for runtime test pinning (Story 13-7 / 14-2 / 14-8 precedent).
7. `pointerEvents="none"` on both overlay variants so they never intercept touches from children.
8. Both overlay variants set the Story 14-3 R1-P1 3-prop decorative a11y pattern (`accessible={false}` + `accessibilityElementsHidden={true}` + `importantForAccessibility="no-hide-descendants"`) so VoiceOver / TalkBack treats them as decorative-of-children.

### AC-B: Migrate 5 screens — replace bespoke hero JSX with `<HeroHeader>`

9. `app/(tabs)/home/index.tsx` — **2 sites migrated**:
   - **Skeleton hero (line ~201)** → `<HeroHeader>{SkeletonBar rows}</HeroHeader>` (no overrides; default `paddingTopOffset=16`, `paddingBottom=24`).
   - **Live hero (line ~239)** → `<HeroHeader>{brand row + greeting + streak pill row + progress bar}</HeroHeader>` (no overrides).
   - The pre-14-9 `bg-primary pb-6 px-6 rounded-b-[28px]` className + the manually-applied `{ paddingTop: insets.top + 16, ...Shadows.hero }` inline style at line 239 are **deleted** ("delete don't alias").
10. `app/(tabs)/conversation/index.tsx` — **1 site migrated** (line ~161):
    - `<HeroHeader overlay="depth-glow">{CEFR badge row + transcript-icon button + initials row + topic strip}</HeroHeader>` (no override on padding; default `paddingTopOffset=16`, `paddingBottom=24`).
    - The bespoke depth-glow inner `<View>` (lines ~165-172) is **deleted**; its visual is now produced by the `overlay="depth-glow"` variant.
11. `app/(tabs)/practice/index.tsx` — **1 site migrated** (line ~112):
    - `<HeroHeader paddingBottom={28}>{title + subtitle + decorative dots row}</HeroHeader>` (only `paddingBottom` override; default `paddingTopOffset=16`).
12. `app/(tabs)/mock-test/index.tsx` — **1 site migrated** (line ~401):
    - `<HeroHeader paddingTopOffset={20} paddingBottom={32} centered>{thin amber line + TCF large title + subtitle}</HeroHeader>` (3 overrides: paddingTopOffset, paddingBottom, centered).
13. `app/(tabs)/profile/index.tsx` — **2 sites migrated**:
    - **Skeleton hero (line ~114)** → `<HeroHeader paddingTopOffset={12} paddingBottom={32} centered>{SkeletonBar rows}</HeroHeader>`.
    - **Live hero (line ~160)** → `<HeroHeader paddingTopOffset={12} paddingBottom={32} overlay="inner-dim">{title + settings button + avatar + name + level pills + target row}</HeroHeader>`.
    - The bespoke inner-dim `<View>` (lines ~163-167) is **deleted**; its visual is now produced by the `overlay="inner-dim"` variant.
14. After migration, the canonical SHADOW is applied to ALL 7 surfaces (fixing the inconsistency where 4 of 7 were missing it). Visual diff: the 4 surfaces that lacked `Shadows.hero` pre-14-9 (home-skeleton, conversation, profile-skeleton, profile-live) now have a subtle navy drop-shadow under the bottom rounded corners. **This is an intentional visual improvement, not a regression** — the 3 screens that already had it set the design intent; the 4 that lacked it were the bugs.

### AC-C: Token + lint cleanup

15. `Presets.heroHeader` in `src/lib/design.ts` (lines 466-474) is **DELETED** — the new `<HeroHeader>` component supersedes it. Search for any consumer with `grep -rn "Presets.heroHeader" app/ src/` post-deletion; result must be empty. (The preset was unused pre-14-9; verified during inventory.)
16. `scripts/check-design-tokens.sh` Pattern 1 regex at line 107 is **extended** to catch `rounded-(b|t|l|r|tl|tr|bl|br)-\[Nunit\]` side-specific variants:
    ```bash
    # Pre-14-9
    radius_pattern='rounded-\[[0-9]+(\.[0-9]+)?(px|pt|rem|em|%)\]'
    # Post-14-9
    radius_pattern='rounded-(b|t|l|r|tl|tr|bl|br)?-?\[[0-9]+(\.[0-9]+)?(px|pt|rem|em|%)\]'
    ```
    After the gate is widened, running `npm run check:tokens` reports the pre-14-9 `rounded-b-[28px]` instances as violations — which is OK because step AC-B deletes all 7 of them. The post-14-9 `check:tokens` pass must be clean.
17. The Story 14-4 design-token drift detector test at `src/lib/__tests__/design-token-enforcement-source-drift.test.ts` is **updated** to also assert that the bash gate's `radius_pattern` includes the side-specific variants. Add a single drift case: read `scripts/check-design-tokens.sh` from disk and assert `radius_pattern` contains the literal substring `rounded-(b|t|l|r|tl|tr|bl|br)?`.

### AC-D: Tests

18. **NEW** `src/components/common/__tests__/hero-header.test.tsx` — runtime smoke tests via `react-test-renderer` + `act` (Story 12-1 P8 / 13-4 P2 / 13-5 / 13-7 / 14-2 / 14-3 / 14-7 / 14-8 precedent). Minimum **6 cases**:
    - Case 1: Default render — outer container has `backgroundColor: Colors.primary` + `borderBottomLeftRadius: Radii.heroBottom` + `borderBottomRightRadius: Radii.heroBottom` + `paddingHorizontal: 24` + `Shadows.hero` keys.
    - Case 2: `paddingTopOffset` defaults to 16 when prop omitted; inner content `paddingTop` equals `mockedInsetsTop + 16`.
    - Case 3: `paddingBottom` defaults to 24; override to 32 applies.
    - Case 4: `centered={true}` sets `alignItems: "center"` on the inner content container; default `centered={false}` does NOT.
    - Case 5: `overlay="depth-glow"` renders an absolutely-positioned overlay View with `backgroundColor: skillTint(Colors.primaryDark, 0.4)` + `borderBottomLeftRadius/RightRadius: 32` + `pointerEvents="none"` + 3-prop decorative a11y; `overlay="inner-dim"` renders the bgDark variant; `overlay=undefined` renders no overlay node.
    - Case 6: `heroHeaderContainerStaticStyle` is `Object.freeze`'d — `Object.isFrozen(constant) === true` AND a mutation attempt is a no-op (Story 13-7 R1-P2 mutation defense).
19. **NEW** `src/lib/__tests__/hero-pattern-unification-source-drift.test.ts` — source-drift detector via Story 12-2 P12 comment-stripped `readScreen()` helper + Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline. Minimum **10 cases**:
    - Case 1: `Presets.heroHeader` is DELETED from `src/lib/design.ts` (NEGATIVE pin against `heroHeader:`).
    - Case 2: `HeroHeader` is imported in `app/(tabs)/home/index.tsx` AND `bg-primary pb-6 px-6 rounded-b-[28px]` substring is GONE.
    - Case 3: same pair for `app/(tabs)/conversation/index.tsx` AND the bespoke depth-overlay inner `<View>` shape (`skillTint(Colors.primaryDark, 0.4)` literal) is GONE.
    - Case 4: same pair for `app/(tabs)/practice/index.tsx` (`bg-primary pb-7 px-6 rounded-b-[28px]` GONE).
    - Case 5: same pair for `app/(tabs)/mock-test/index.tsx` (`bg-primary px-6 pb-8 rounded-b-[28px] items-center` GONE).
    - Case 6: same pair for `app/(tabs)/profile/index.tsx` BOTH live + skeleton sites; the `skillTint(Colors.bgDark, 0.35)` overlay literal is GONE.
    - Case 7: `scripts/check-design-tokens.sh` `radius_pattern` includes the `rounded-(b|t|l|r|tl|tr|bl|br)?` side-specific group.
    - Case 8: POSITIVE — each of the 5 screens contains exactly one `<HeroHeader\b` opening tag invocation (defends against half-migrations).
    - Case 9: POSITIVE — `HeroHeader.tsx` exports `heroHeaderContainerStaticStyle` (named export pin for runtime test).
    - Case 10: POSITIVE — `HeroHeader.tsx` body uses `Shadows.hero` (canonical shadow applied to all surfaces).

### AC-E: Spec compliance — operator decision items

20. The 5 spec questions in §"Operator Decisions" below are resolved per the **Recommended** column unless the dev agent flags a blocker; any deviation must be documented in Completion Notes with rationale.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex.
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners. **(N/A — the 2 skeleton hero migrations carry their existing `SkeletonBar` content through verbatim.)**
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`. **(N/A — `<HeroHeader>` is a container, not interactive; children carry their own a11y.)**
- [x] Non-obvious interactions have `accessibilityHint`. **(N/A — see above.)**
- [x] Stateful elements have `accessibilityState`. **(N/A — see above.)**
- [x] All tappable elements have minimum 44x44pt touch targets. **(N/A — see above.)**
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`. **(N/A — no async / error-path code in `<HeroHeader>`.)**
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`. **(N/A — `<HeroHeader>` renders no text itself; children carry text.)**
- [x] All quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm run check:tokens && npx jest`.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/14-9-hero-pattern-unification.md`) under "Untracked files".
- [x] `npx prettier --check _bmad-output/implementation-artifacts/14-9-hero-pattern-unification.md` passes.

## Operator Decisions

Five decisions the dev agent should resolve per the **Recommended** column; any deviation requires a rationale in Completion Notes.

| Q | Question | Options | Recommended | Rationale |
|---|---|---|---|---|
| **Q1** | Canonical default for `centered`? | (a) Default `true` — most modern apps center hero content; (b) Default `false` — preserves home/conversation/practice left-align which is the majority pattern (3 of 5 screens). | **(b) Default `false`** | 3 of 5 screens (home, conversation, practice) left-align; only 2 (mock-test, profile-skeleton) center. The minority opts into `centered`. |
| **Q2** | Default `paddingBottom`? | (a) 24 (`pb-6` — home / conversation); (b) 28 (`pb-7` — practice; midpoint); (c) 32 (`pb-8` — mock-test / profile). | **(a) 24 (matches majority)** | Home + conversation use 24; that's the 2-screen plurality on a 5-screen distribution. Practice opts into 28, mock-test + profile opt into 32. |
| **Q3** | Handle the 2 depth overlays (conversation + profile)? | (a) `overlay` prop with `"depth-glow"` and `"inner-dim"` variants (one prop, 2 literal values); (b) Two separate boolean props (`depthGlow={true}` + `innerDim={true}`); (c) Keep overlays as bespoke child JSX in each consumer (no overlay prop). | **(a) Single `overlay` prop with literal union** | TypeScript discriminated-union ergonomics; mutual-exclusion of `"depth-glow"` and `"inner-dim"` is enforced at compile time; default `undefined` is the clean no-overlay case. Matches Story 14-2 / 14-8 single-prop variant patterns. |
| **Q4** | Extend Story 14-4 token gate to catch `rounded-(b\|t\|l\|r\|tl\|tr\|bl\|br)-\[N\]` side-specific variants? | (a) Yes — extend in this story; (b) No — defer to a Story 14-4 follow-up. | **(a) Yes — extend here** | All 7 hero sites use `rounded-b-[28px]` which bypasses the current Story 14-4 gate. The widening is directly motivated by this story and is a one-line regex change. Filing a 14-4-follow-up would orphan the fix. |
| **Q5** | Delete unused `Presets.heroHeader` from `src/lib/design.ts`? | (a) Delete — "delete don't alias" pattern; (b) Refactor to back the new `<HeroHeader>` component internally. | **(a) Delete** | The preset is unused (grep returns 0 hits in app/ + src/components/); aliasing creates 2 sources of truth. The new component owns the canonical pattern. Mirrors Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 / 12-7 / 12-8 / 13-X / 14-X delete-don't-alias discipline. |

## Out of Scope

These would be ambitious extensions; reject any reviewer pressure to expand 14-9's scope into them:

- **`FullSimCard` migration** at [`app/(tabs)/mock-test/index.tsx:90`](<app/(tabs)/mock-test/index.tsx#L90>) — large `rounded-3xl` navy hero-style **card** with bespoke `shadowOpacity: 0.25` (escape-hatched in Story 14-4). It's a content card, not a tab-level hero header — different semantic surface. Defer to `14-9-followup-full-sim-card-unification` if telemetry / further audit motivates.
- **Auth-screen heroes** (`app/(auth)/login.tsx` / `signup.tsx` / `forgot-password.tsx`) — these are dark-gradient hero surfaces but they're NOT tab heroes; the roadmap line 278 explicitly scopes 14-9 to "home, conversation, practice, mock-test, profile" — the 5 tabs. Auth screens have their own design language (gradient + form below). Defer to `14-9-followup-auth-hero-unification`.
- **`[sessionId].tsx` conversation-session hero** — that's an in-conversation overlay, not a tab hero. Out of scope.
- **`onboarding/*` heroes** — onboarding is a separate stack outside the 5 tabs. Out of scope.
- **Per-screen padding tweaks beyond the 3 props** (`paddingTopOffset`, `paddingBottom`, `centered`) — keep prop surface minimal; future asks add new props with clear rationale.
- **Animation on the hero itself** — Reanimated entry transitions or parallax effects are out of scope. The 7 hero surfaces are static today; they stay static post-14-9.
- **Theming / dark-mode variants** — Companion is single-theme today (navy primary). Theming is a future epic.
- **`Spacing.screenPaddingLarge` vs `Radii.heroBottom` audit** — only consume what we already need (`Radii.heroBottom`); broader token audit is Story 14-4 territory.

## Tasks / Subtasks

- [x] **Task 1: Build the `HeroHeader` component** (AC: 1–8)
  - [x] Create `src/components/common/HeroHeader.tsx` with `HeroHeader` named + default exports wrapped in `React.memo`.
  - [x] Define `HeroHeaderProps` interface per AC-A3.
  - [x] Define 3 frozen static-style constants per Story 13-7 R1-P1 + R1-P2 pattern.
  - [x] Export `heroHeaderContainerStaticStyle` as `@internal` named export for runtime test pinning.
  - [x] Apply `Shadows.hero` canonically to the outer container.
  - [x] Use `useSafeAreaInsets()` internally; consumer no longer needs to pass `insets.top`.
  - [x] Render the 2 overlay variants conditionally; both carry the Story 14-3 R1-P1 3-prop decorative a11y + `pointerEvents="none"`.

- [x] **Task 2: Migrate the 5 screens** (AC: 9–14)
  - [x] `app/(tabs)/home/index.tsx` — both skeleton + live hero sites migrated to `<HeroHeader>` defaults; delete the bespoke className + inline-style blocks at lines 201 + 239. Pass all hero content as `children`.
  - [x] `app/(tabs)/conversation/index.tsx` — single live hero site migrated to `<HeroHeader overlay="depth-glow">`. Delete the bespoke inner-overlay `<View>` at lines 165-172.
  - [x] `app/(tabs)/practice/index.tsx` — single live hero site migrated to `<HeroHeader paddingBottom={28}>`.
  - [x] `app/(tabs)/mock-test/index.tsx` — single live hero site migrated to `<HeroHeader paddingTopOffset={20} paddingBottom={32} centered>`. **Do NOT touch `FullSimCard` (line 90) — out of scope per §Out of Scope.**
  - [x] `app/(tabs)/profile/index.tsx` — both skeleton + live hero sites migrated to `<HeroHeader paddingTopOffset={12} paddingBottom={32}>` (skeleton with `centered`; live with `overlay="inner-dim"`). Delete the bespoke inner-dim `<View>` at lines 163-167.
  - [x] Remove the now-unused `useSafeAreaInsets()` import from any screen that no longer needs `insets.top` for the hero (if `insets` is still used elsewhere in the screen, keep the import; only remove if fully unused).

- [x] **Task 3: Token + lint cleanup** (AC: 15–17)
  - [x] Delete `Presets.heroHeader` from `src/lib/design.ts` (lines 466-474). Verify `grep -rn "Presets.heroHeader" app/ src/ scripts/` returns empty.
  - [x] Extend `scripts/check-design-tokens.sh` `radius_pattern` to match the side-specific variants (`rounded-(b|t|l|r|tl|tr|bl|br)?-?\[Nunit\]`). Verify `npm run check:tokens` passes clean after the 5-screen migrations.
  - [x] Add a single drift case to `src/lib/__tests__/design-token-enforcement-source-drift.test.ts` pinning the extended regex.

- [x] **Task 4: Tests** (AC: 18–19)
  - [x] Create `src/components/common/__tests__/hero-header.test.tsx` with ≥6 runtime smoke cases.
  - [x] Create `src/lib/__tests__/hero-pattern-unification-source-drift.test.ts` with ≥10 source-drift cases (NEGATIVE + POSITIVE pins per Story 13-2 P11 discipline).
  - [x] Verify all 5 design-system gates green: `npm run type-check && npm run lint && npm run format:check && npm run check:tokens && npx jest`.

- [x] **Task 5: Spec compliance + visual verification** (AC: 20)
  - [x] Resolve all 5 operator decisions per the Recommended column or document rationale in Completion Notes.
  - [x] Run the app (iOS sim + Android emulator if available) and verify the 5 screens render visually equivalent to pre-14-9 EXCEPT for the intentional shadow-canonicalization on the 4 surfaces that previously lacked `Shadows.hero` (home-skeleton, conversation, profile-skeleton, profile-live).
  - [x] Update CLAUDE.md with a Story 14-9 paragraph following the established cross-story-invariant + closure narrative pattern.
  - [x] Update `_bmad-output/implementation-artifacts/sprint-status.yaml` `14-9-hero-pattern-unification` entry from `backlog` to `review` with implementation notes.

## Dev Notes

### Relevant architecture patterns and constraints

- **Single source of truth for design tokens** — `src/lib/design.ts` owns `Colors.*` / `Radii.*` / `Shadows.*` / `Typography.*` / `Spacing.*`. The new `HeroHeader` consumes `Colors.primary` + `Radii.heroBottom` + `Shadows.hero`; no raw literals in component source.
- **Frozen-static-style pattern (Story 13-7 R1-P1 + R1-P2)** — every module-level `ViewStyle` MUST be `Object.freeze(...) as ViewStyle`. Spread design tokens FIRST so explicit properties always win over future token additions.
- **React.memo + displayName** — Story 14-2 / 14-3 / 14-7 / 14-8 established this for every reusable common component.
- **`@internal` runtime test exports** — the 3 frozen static-style constants in `HeroHeader.tsx` should be exported `@internal` so the runtime smoke test can pin them via direct import (Story 13-7 / 14-8 precedent).
- **Story 14-3 R1-P1 3-prop decorative a11y** — overlays carry `accessible={false}` + `accessibilityElementsHidden={true}` + `importantForAccessibility="no-hide-descendants"`. iOS + Android parity.
- **Story 14-1 chrome rule** — `HeroHeader` renders no text; the chrome/content distinction is fully delegated to children. No new chrome FR strings introduced.
- **Story 12-2 P12 comment-stripped readScreen pattern + Story 13-2 P11 paired pin discipline** — drift detector tests strip comments before regex assertions; every NEGATIVE legacy-pattern pin is paired with a POSITIVE replacement-pattern pin to defend against vacuous-pass.

### Source tree components to touch

**NEW files (3):**
- `src/components/common/HeroHeader.tsx`
- `src/components/common/__tests__/hero-header.test.tsx`
- `src/lib/__tests__/hero-pattern-unification-source-drift.test.ts`

**MODIFIED files (8):**
- `src/lib/design.ts` (delete `Presets.heroHeader`)
- `src/lib/__tests__/design-token-enforcement-source-drift.test.ts` (1 new case)
- `scripts/check-design-tokens.sh` (1-line regex extension)
- `app/(tabs)/home/index.tsx`
- `app/(tabs)/conversation/index.tsx`
- `app/(tabs)/practice/index.tsx`
- `app/(tabs)/mock-test/index.tsx`
- `app/(tabs)/profile/index.tsx`

**HOUSEKEEPING files (3):**
- `CLAUDE.md` (story paragraph)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status update)
- `_bmad-output/implementation-artifacts/14-9-hero-pattern-unification.md` (this file — Status: review on completion)

### Testing standards summary

- **Runtime smoke tests** use `react-test-renderer` + `act` per Story 12-1 P8 precedent; mock `react-native-reanimated` via the shared `src/test-utils/mocks/reanimated.ts` factory if any Reanimated import surfaces transitively. Mock `react-native-safe-area-context` `useSafeAreaInsets` to return predictable values (e.g., `{top: 47, bottom: 34, left: 0, right: 0}` — iPhone 14 Pro notch).
- **Source-drift tests** read source from disk via the shared `readScreen()` comment-stripping helper. Paired NEGATIVE-pin (legacy pattern gone) + POSITIVE-pin (new pattern present) per Story 13-2 P11.
- **Quality gate budget** — type-check + lint + format + check:tokens + jest. Pre-14-9 baseline is **2062 tests** (post-Story 14-8); expected post-14-9 target is **+16 net** (6 runtime + 10 drift) = **2078 tests**. Spec target range: **+14–20 net**.

### Project Structure Notes

- The new component lives in `src/components/common/` alongside `SkillCard`, `ListItemCard`, `Icon`, `ThemedDialog` — the 4 prior reusable common components. This is the established home for Epic 14 reusables.
- No new packages required. `react` + `react-native` + `react-native-safe-area-context` (already a dep) + the existing design token module are the only imports.
- No migrations, no Edge Function changes, no CI workflow changes (the `check-design-tokens.sh` edit is a one-line regex extension to an existing script; the existing CI step at `.github/workflows/ci.yml` continues running it unchanged).
- The Story 14-4 `npm run check:tokens` CI step automatically picks up the new gate strictness.

### References

- [`_bmad-output/planning-artifacts/shippable-roadmap.md:278`](_bmad-output/planning-artifacts/shippable-roadmap.md#L278) — Epic 14 deliverable 14.9.
- [`_bmad-output/planning-artifacts/shippable-roadmap.md:105`](_bmad-output/planning-artifacts/shippable-roadmap.md#L105) — Audit finding P2-10 (cards + heroes).
- [`_bmad-output/implementation-artifacts/14-2-card-consolidation.md:518`](_bmad-output/implementation-artifacts/14-2-card-consolidation.md#L518) — Story 14-2 explicitly defers heroes to 14-9.
- [`src/lib/design.ts:466-474`](src/lib/design.ts#L466-L474) — Pre-existing `Presets.heroHeader` to be deleted.
- [`src/lib/design.ts:373-374`](src/lib/design.ts#L373-L374) — `Radii.heroBottom = 28`.
- [`src/lib/design.ts:393-403`](src/lib/design.ts#L393-L403) — `Shadows.hero`.
- [`scripts/check-design-tokens.sh:107`](scripts/check-design-tokens.sh#L107) — Pre-14-9 `radius_pattern` to extend.
- [Story 13-7 R1-P1 + R1-P2](_bmad-output/implementation-artifacts/13-7-className-style-resolution-hot-paths.md) — Frozen-static-style + `Shadows.X` spread-first pattern.
- [Story 14-2 spec](_bmad-output/implementation-artifacts/14-2-card-consolidation.md) — Cross-story prior for "collapse N bespoke surfaces into 1 reusable component".
- [Story 14-3 R1-P1](_bmad-output/implementation-artifacts/14-3-icon-system-replacement.md) — 3-prop decorative a11y for cross-platform parity.
- [Story 14-4](_bmad-output/implementation-artifacts/14-4-token-enforcement-lint.md) — Token enforcement gate that this story extends.
- [Story 14-8 spec](_bmad-output/implementation-artifacts/14-8-themed-dialog-component.md) — Most recent precedent for new reusable common component.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- **Babel-parser quirk in drift test:** initial draft of `src/lib/__tests__/hero-pattern-unification-source-drift.test.ts` failed Jest's Babel parse phase with "Missing semicolon" pointing at backticks inside `//` line comments. Removing the backticks from comments resolved it; the runtime regexes are unchanged. Captured for future story authors — when writing drift detector tests that quote literal patterns containing backticks in their JSDoc / inline comments, use plain ASCII delimiters instead.
- **`check:tokens` flagged a pre-existing onboarding hero literal:** the extended `radius_pattern` (now catching `rounded-b-[N]`) flagged `app/onboarding/index.tsx:198`. Onboarding is Out-of-Scope per the spec, but the inline `borderBottomLeftRadius/RightRadius: 28` already set the radius — the Tailwind class was redundant. Dropped the className and switched the inline literals to `Radii.heroBottom`; the onboarding hero stays bespoke (preserves its intentionally heavier Story 14-4 R1 escape-hatched shadow).

### Completion Notes List

- Built `src/components/common/HeroHeader.tsx` (~170 LOC) per the spec contract — frozen-static-style + Story 14-3 R1-P1 3-prop decorative a11y on both overlay variants + `Shadows.hero` applied canonically. Uses `useSafeAreaInsets()` internally so consumers no longer plumb `insets.top`.
- Migrated 7 hero surfaces across 5 screens (home × 2, conversation, practice, mock-test, profile × 2). Removed orphan `useSafeAreaInsets` imports + hook calls from all 5 files. The 2 bespoke depth overlays (conversation `primaryDark 0.4`; profile `bgDark 0.35`) now ride on the `overlay` prop variants.
- Deleted unused `Presets.heroHeader` from `src/lib/design.ts` per Q5 recommended (delete-dont-alias); replaced with a JSDoc note pointing future readers to the component.
- Extended Story 14-4 design-token gate regex (`scripts/check-design-tokens.sh` `radius_pattern`) to catch `rounded-(b|t|l|r|tl|tr|bl|br)-[N]` side-specific variants per Q4 recommended. Updated `design-token-enforcement-source-drift.test.ts` Case 5 to pin the new regex.
- Found + fixed a pre-existing Story 14-4 gap in `app/onboarding/index.tsx:198` that the extended gate flagged. The fix dropped the redundant `rounded-b-[28px]` className (already covered by inline `borderBottomLeftRadius/RightRadius`) and switched the inline literals to `Radii.heroBottom`; onboarding hero stays bespoke per spec Out-of-Scope.
- Resolved all 5 operator decisions per Recommended column: Q1 `centered` default `false`; Q2 `paddingBottom` default `24`; Q3 single discriminated-union `overlay` prop; Q4 extend gate here; Q5 delete `Presets.heroHeader`.
- 11 hero-header runtime smoke cases + 25 source-drift cases = **+36 net Jest cases (2062 → 2098)**. Spec target was +14–20; exceeded because the screen-migration drift block uses a per-screen iteration loop that generates a sub-case per legacy pattern per screen.
- All 5 quality gates green: type-check (0 errors), lint (0 warnings), prettier (clean), `npm run check:tokens` (clean), jest (111 suites / 2098 tests).
- **Visual impact** (intentional, documented in the spec): the 4 surfaces that lacked `Shadows.hero` pre-14-9 (home-skeleton, conversation, profile-skeleton, profile-live) now carry it. This was the inconsistency bug — 3 of 7 surfaces already had it; this canonicalises all 7. Visually a faint navy drop-shadow under the rounded bottom corners on those 4 surfaces.

### File List

**NEW (3):**

- `src/components/common/HeroHeader.tsx`
- `src/components/common/__tests__/hero-header.test.tsx`
- `src/lib/__tests__/hero-pattern-unification-source-drift.test.ts`

**MODIFIED (10):**

- `src/lib/design.ts` (deleted unused `Presets.heroHeader`)
- `src/lib/__tests__/design-token-enforcement-source-drift.test.ts` (Case 5 updated to pin extended regex)
- `scripts/check-design-tokens.sh` (`radius_pattern` extended for side-specific variants)
- `app/(tabs)/home/index.tsx`
- `app/(tabs)/conversation/index.tsx`
- `app/(tabs)/practice/index.tsx`
- `app/(tabs)/mock-test/index.tsx`
- `app/(tabs)/profile/index.tsx`
- `app/onboarding/index.tsx` (incidental fix — gate-flagged redundant Tailwind class dropped; inline literal switched to `Radii.heroBottom`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status update)

**HOUSEKEEPING (2):**

- `CLAUDE.md` (Story 14-9 paragraph — added during dev-story completion)
- `_bmad-output/implementation-artifacts/14-9-hero-pattern-unification.md` (this file — Status: review)

### Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-05-16 | Story 14-9 implementation complete — `HeroHeader` component + 5 screens migrated + Story 14-4 gate widened + `Presets.heroHeader` deleted. 111 suites / 2098 tests pass. All 5 quality gates green. Audit P2-10 heroes portion architecturally closed. Epic 14 implementation work complete (retrospective is next workflow step). Status: review. | claude-opus-4-7 |
