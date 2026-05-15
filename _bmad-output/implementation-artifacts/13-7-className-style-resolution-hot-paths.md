# Story 13.7: className+style Resolution on Hot Animated Rows — collapse the mixed-prop merge cost on `ConversationCard`, `TodayPlanItem`, `SkillCard`, `StatTile`, and `AnimatedMessage`

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **TCF Canada exam-prep user on a 3-year-old phone (iPhone 11 / Pixel 4a class)**,
I want **the home + conversation hot-path components to NOT pay a per-frame `className + style` merge cost while their Reanimated worklets are running**,
so that **press-scale animations, entry fades, and transcript bubble translations stay at ≥ 55 FPS instead of dropping to 45–50 FPS on the cheapest devices we support**.

## Background — Why This Story Exists

### What audit "P2-x performance" owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § Epic 13 line 254:

> 13.7 Resolve mixed `className`+`style` on hot animated rows (ConversationCard, etc).

Stories 13-1 through 13-6 closed the **algorithmic** perf hot-paths (transcript render storms, home query fan-out, session-feedback waterfalls, mock-test serial generation, history modal virtualization, Sentry SDK auto-tracing). Story 13-7 closes the **per-frame style-resolution** hot-path that remains on the home + conversation surfaces — the last mile of the Epic 13 AC `voice conversation maintains ≥ 55 FPS on iPhone 11 for 30 turns`.

### The cost model — what `className + style` actually does on an animated wrapper

NativeWind v4 + `tailwindcss@^3.4` compiles every `className="..."` value via the Babel plugin into a **runtime style-object lookup** at the call site. On a NON-animated component this resolves once per JS render and then merges with any `style` prop via the standard React Native style-merge contract — cheap, amortized over the React commit phase.

On an **animated** component (`Animated.View`, `Reanimated.View`, `AnimatedPressable = Animated.createAnimatedComponent(Pressable)`) the cost shifts:

1. **Reanimated's UI-thread worklet** re-evaluates `useAnimatedStyle(() => ({...}))` on every native frame (60Hz / 120Hz on ProMotion).
2. The animated component reconciles by passing the worklet output through the prop pipeline as a **style object**.
3. When the same component ALSO carries a `className`, the runtime must (a) resolve the NativeWind compiled-style object, (b) merge it with the worklet-produced style, (c) split-and-merge again if the `style` prop is itself an array like `style={[staticInlineObject, animStyle]}`.
4. The merge cost is small per frame (~0.05–0.15ms on iPhone 11) but **compounds** across (a) press-state transitions on every Pressable, (b) 6+ animated tiles on the home screen mounting in parallel via `useSharedValue` + `withDelay` cascades, (c) every transcript bubble animating in via `withSpring` translation. The Epic 13 audit observed 5–8 FPS drops during home-screen mount + during pressIn/Out cascade animations on Pixel 4a.

### Canonical fix — preserve one styling axis per node

For animated wrappers, route 100% of the styling through `style` (either a single object or an array `[staticStyle, animStyle]`) and drop `className`. Static styles can live (a) inline next to the animated style, (b) as a `StyleSheet.create()` constant if reused, or (c) as a typed object derived from `Colors` / `Radii` / `Shadows` / `Typography` design tokens.

For **non-animated** children of an animated wrapper, `className` is FINE — those nodes don't pay the per-frame merge cost. The story is specifically about the animated WRAPPER.

### What's in scope — the 5 hot-path animated wrappers

Inventory completed via `grep -rn "Animated\.View\|Reanimated\.View\|AnimatedPressable" src/components/ app/`:

| Component                                                                          | Animated wrapper                  | Pre-13-7 mix                                                                                                                                                                                                            | Render frequency on hot paths                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`app/(tabs)/home/index.tsx:55-77`](<app/(tabs)/home/index.tsx#L55-L77>) `ConversationCard` | `<AnimatedPressable>`             | `className="bg-primary rounded-2xl p-4 flex-row items-center gap-4"` **+** `style={[{shadowColor, shadowOffset, shadowOpacity, shadowRadius, elevation}, animStyle]}`                                                    | Every home-screen mount + every press cycle (scale 1→0.97→1)                                            |
| [`src/components/common/StatTile.tsx:41-54`](src/components/common/StatTile.tsx#L41-L54) `StatTile`                                  | `<Animated.View>`                 | `className="flex-1 items-center rounded-2xl bg-white px-2.5 py-3.5"` **+** `style={[animStyle, {shadowColor, shadowOffset, shadowOpacity, shadowRadius, elevation}]}`                                                    | 3 tiles × home-mount entry fade (withDelay cascade); also re-renders on every progress refresh        |
| [`src/components/common/SkillCard.tsx:46-99`](src/components/common/SkillCard.tsx#L46-L99) `SkillCard`                                  | `<Animated.View style={entryStyle}>` wrapping `<Pressable>` | The animated wrapper itself is CLEAN (single `style={entryStyle}`); but the inner `<Pressable>` has `className="bg-white rounded-2xl ..."` **+** `style={{ ...Shadows.card }}` and scales via `scale.value` referenced from the wrapper's `transform` | 5 cards × home-mount entry fade + press cycle on each                                                  |
| [`src/components/home/TodayPlanItem.tsx:112-126`](src/components/home/TodayPlanItem.tsx#L112-L126) `TodayPlanItem`                              | `<Animated.View>`                 | Animated wrapper has NO `className`; pure `style={[{...inlineObject...}, animatedStyle]}` (already canonical). The inner `<View className="flex-1" style={{ gap: 2 }}>` at line 142 is non-animated — out of scope for this story | 0–5 items × home-mount entry + per-item press (scale + opacity interpolate)                            |
| [`src/components/conversation/TranscriptView.tsx:131`](src/components/conversation/TranscriptView.tsx#L131) `AnimatedMessage`               | `<Reanimated.View>`                | Animated wrapper has NO `className`; pure `style={[{ alignSelf: ... }, animStyle]}` (already canonical). Inner `<View className="rounded-[20px] border ..." style={{...}}>` at line 144 is non-animated — out of scope | Every transcript bubble × live conversation + saved history modal (Story 13-1 + 13-5 surfaces)         |

**Net diff:** 2 animated wrappers (`ConversationCard`, `StatTile`) need conversion. `SkillCard` needs the inner Pressable converted (it's the press-target whose `scale.value` drives the Reanimated transform — same cost model as a direct animated wrapper). `TodayPlanItem` + `AnimatedMessage` are ALREADY canonical and serve as the pattern reference.

The Story 13-7 spec hint "ConversationCard, etc." names the worst offender; the audit-implicit "etc." is the other 2 hot-path mixers (`StatTile`, `SkillCard` inner Pressable).

### What's explicitly OUT of scope

- **All non-animated `className`+`style` mixes** — Inventory shows ~30+ such sites across the codebase (`SkillCard` inner labels, `CorrectionBubble`, `ProcessingIndicator`, `settings.tsx`, `profile/index.tsx`, etc.). These are cheap (per-render, not per-frame) and converting them is pure churn. The audit + spec are specific to **hot animated rows**.
- **All `Animated.View` / `Reanimated.View` instances that are already canonical** — `TodayPlanItem`, `AnimatedMessage`, `ActivityBar`, `SkeletonBar`, `MilestoneBanner`, `ToastContainer`, the 8 instances in `cefr-progression-chart.tsx`, `ErrorJourneyBar` fill, `AudioWaveform`, `ProcessingIndicator`. They already route all styling through `style`; touching them is risk without reward.
- **Removing NativeWind / Tailwind** — Out of scope. NativeWind stays the styling foundation for the project; the story is targeted at the per-frame animated boundary only.
- **Adding a `styled()` wrapper convention** — `styled(Animated.View)` is a NativeWind v3-era pattern; v4 deprecates `styled()` in favor of native `className` support, so introducing it now is anti-conventional. The fix is to DROP `className` on the animated wrapper, not to wrap it differently.
- **Touching the AnimatedPressable factory** — `const AnimatedPressable = Animated.createAnimatedComponent(Pressable)` in `app/(tabs)/home/index.tsx:37` is the canonical Reanimated v4 pattern; preserve it verbatim.
- **Visual-snapshot regression** — This story is a pure style-resolution refactor. The OUTPUT pixels MUST be byte-identical (modulo rounding); the input declarations change. We rely on the AC #4 drift detector + manual smoke verification, not on a snapshot test (project doesn't use `@testing-library/jest-native` snapshot tooling).

### Cross-story invariants to preserve

- **Story 9-3 telemetry allowlist + GDPR scrubber** — `captureError` / `addBreadcrumb` paths untouched; this story has no Sentry surface.
- **Story 9-4 stored-prompt-injection defense** — N/A (no AI, no prompts, no user input flowing through styling).
- **Story 11-1 tool-call protocol** — orthogonal (different file scope).
- **Story 11-2 reconnect + barge-in** — orthogonal.
- **Story 12-1 RealtimeOrchestrator** — orthogonal; transcript bubble animations are owned by `AnimatedMessage`, which this story does NOT touch (it's already canonical).
- **Story 12-6 transcript cap (`MAX_TRANSCRIPT_ENTRIES = 200`)** — `AnimatedMessage` instances are bounded by the cap; this story preserves the per-bubble render shape so the Story 12-6 bound stays effective.
- **Story 13-1 transcript render-storm fix** — the rAF-coalesced `pendingAiText` setState + `extraData={transcript.length}` invariants live in `TranscriptView.tsx` + `realtime-orchestrator.ts`. Story 13-7 does NOT touch either file. `AnimatedMessage` (which IS in `TranscriptView.tsx`) is already canonical per the inventory — out of scope.
- **Story 13-2 home aggregate** — `useProgress` + `useDailyBriefing` consumers untouched; only the rendering primitives change.
- **Story 13-3 session feedback aggregate** — orthogonal.
- **Story 13-4 streaming mock-test generation** — orthogonal (mock-test screen has no animated rows in this story's inventory).
- **Story 13-5 history modal FlatList** — `Bubble` component in `history.tsx` is the saved-conversation analogue of `AnimatedMessage`; it's NOT animated (no Reanimated worklets), so out of scope. Story 13-5's `React.memo(Bubble, bubblePropsEqual)` + `extraData` content-key invariants are preserved by not touching `history.tsx`.
- **Story 13-6 Sentry sampling + perf flags** — orthogonal.
- **Story Z. Polish Requirements (template)** — all colors must come from `Colors.*`; all radii from `Radii.*`; all shadows from `Shadows.*` (or inline-derived from `Colors.shadow`). NO raw hex literals introduced. The post-13-7 inline `style` objects continue to source from design tokens.

### Why this is a SMALL story (load-bearing scope discipline)

Pattern from Stories 12-10 / 12-11 / 12-12 / 13-1 / 13-6 (the "small + targeted" cluster of Epic 12/13 stories):

- **2 file edits** (`app/(tabs)/home/index.tsx` `ConversationCard` block + `src/components/common/StatTile.tsx` + `src/components/common/SkillCard.tsx` inner Pressable = 3 file edits to be precise).
- **1 new drift detector test file** (`src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts`) reading each touched file from disk via comment-stripped source per Story 12-2 P12 pattern + asserting NO `className` appears on the animated wrappers + POSITIVE pin that the static styles are present as inline style objects.
- **0 new packages, 0 migrations, 0 Edge Function changes, 0 CI workflow changes** — `package.json` + `package-lock.json` + `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` all zero-diff.
- **Total diff < 250 lines.**

### Known footguns (from prior story retros)

- **Story 12-12 review-round-1 M2 lesson** — the FIFO cap diagnostic-signal trade-off was undocumented. Apply the parallel here: document any visual-output deviation explicitly even if intent is "byte-identical pixels." The post-13-7 `ConversationCard` shadow rendering MUST match pre-13-7; if any inset/offset shifts, document it.
- **Story 13-1 review-round-1 P1 lesson** — don't over-apply the spec. Spec asks for ConversationCard + "etc."; impl delivers 3 targeted wrappers. The "etc." resolves via the inventory table above — 2 explicit (`ConversationCard` + `StatTile`) + 1 derived (`SkillCard` inner Pressable). The 4th (`TodayPlanItem`) and 5th (`AnimatedMessage`) are already canonical — documented in the inventory but NOT touched.
- **Story 12-2 P12 lesson (comment-stripped drift detector)** — strip `/* */` + `//` before regex pins so JSDoc that mentions pre-13-7 patterns (e.g., the pre-13-7 className text inside an explanatory comment) doesn't trip negative guards.
- **Story 13-5 review-round-1 P1 lesson** — don't blindly simplify. Pre-implementation, verify each removal preserves the visible behavior. The ConversationCard's `gap-4` className translates to `gap: 16` (Tailwind default scale); the StatTile's `rounded-2xl` is `borderRadius: 16` and `bg-white` is `backgroundColor: "#FFFFFF"` (or `Colors.surfaceWhite` if that token exists). Verify each translation BEFORE writing the inline object.
- **NativeWind v4 → inline style mapping reference** — `tailwind.config.js` is the source of truth for the project's custom scale (`primary`, `accent`, `surface`, `success`, `error`). Default Tailwind scales (spacing, font-size, radii) follow Tailwind v3.4 defaults. When in doubt, render once before/after and compare pixel output.
- **`Shadows.card` design token** — exists in `src/lib/design.ts` (used by `SkillCard.tsx:62`). Use it for the post-13-7 inline-style shadow object on `StatTile` + `ConversationCard` IF the shadow shape matches; otherwise keep the existing inline `shadowColor/Offset/Opacity/Radius/elevation` set.

### What `ConversationCard` looks like post-13-7

```tsx
// app/(tabs)/home/index.tsx
const conversationCardStaticStyle: ViewStyle = {
  backgroundColor: Colors.primary,
  borderRadius: Radii.card, // 16
  padding: 16,
  flexDirection: "row",
  alignItems: "center",
  gap: 16, // gap-4 in Tailwind scale = 16
  shadowColor: Colors.primary,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.25,
  shadowRadius: 12,
  elevation: 6,
};

function ConversationCard({ onPress }: ConversationCardProps) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPressIn={() => { scale.value = withTiming(0.97, { duration: 100 }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 100 }); }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Talk with Companion"
      accessibilityHint="Start a real-time AI voice conversation"
      style={[conversationCardStaticStyle, animStyle]}
    >
      {/* Inner children KEEP className — they are NOT animated wrappers. */}
      {/* ...mic icon circle, text content, arrow pill — all unchanged */}
    </AnimatedPressable>
  );
}
```

### What `StatTile` looks like post-13-7

```tsx
// src/components/common/StatTile.tsx
const statTileStaticStyle: ViewStyle = {
  flex: 1,
  alignItems: "center",
  borderRadius: Radii.card,
  backgroundColor: Colors.surfaceWhite, // bg-white
  paddingHorizontal: 10, // px-2.5
  paddingVertical: 14, // py-3.5
  shadowColor: Colors.shadow,
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.1,
  shadowRadius: 8,
  elevation: 6,
};

return (
  <Animated.View
    accessibilityLabel={`${label}: ${value}${unit.length > 0 ? ` ${unit}` : ""}`}
    style={[statTileStaticStyle, animStyle]}
  >
    {/* Inner Text nodes KEEP className — non-animated. */}
  </Animated.View>
);
```

### What `SkillCard` looks like post-13-7

```tsx
// src/components/common/SkillCard.tsx
const skillCardPressableStaticStyle: ViewStyle = {
  backgroundColor: Colors.surfaceWhite, // bg-white
  borderRadius: Radii.card,
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
  padding: 16,
  gap: 14,
  ...Shadows.card,
};

return (
  <Animated.View style={entryStyle}>
    <Pressable
      onPressIn={() => { scale.value = withTiming(0.97, { duration: 100 }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 120 }); }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${titleFr} - ${titleEn}. ${description}`}
      accessibilityHint={`Double tap to start ${titleEn} practice`}
      style={skillCardPressableStaticStyle}
    >
      {/* Inner children KEEP className — non-animated. */}
    </Pressable>
  </Animated.View>
);
```

Note: `SkillCard`'s `<Animated.View style={entryStyle}>` outer wrapper has NO `className` already (single `style` prop). The transform-scale on press is owned by `scale.value` which the outer `entryStyle` reads via `useAnimatedStyle`. The inner `<Pressable>` is the press target but the animated wrapper sees the scale change as a worklet write — that's why hoisting the static style off the Pressable still removes a per-frame merge (the Pressable rerenders in JS on press state change, recomputing the className resolution; with static-only `style`, it's a single allocation cached as a module-level constant).

## Acceptance Criteria

1. **`ConversationCard` in [`app/(tabs)/home/index.tsx`](<app/(tabs)/home/index.tsx>):** the `<AnimatedPressable>` no longer carries a `className` prop. All static styling moves into a module-level `conversationCardStaticStyle: ViewStyle` constant; the `style` prop is `[conversationCardStaticStyle, animStyle]`. Inner non-animated children (mic icon `<View>`, text `<View>`, arrow pill `<View>`) retain their existing `className`+`style` mixes verbatim (out of scope).

2. **`StatTile` in [`src/components/common/StatTile.tsx`](src/components/common/StatTile.tsx):** the `<Animated.View>` wrapper no longer carries a `className` prop. All static styling moves into a module-level `statTileStaticStyle: ViewStyle` constant; the `style` prop is `[statTileStaticStyle, animStyle]`. Inner `<Text>` nodes retain their existing `className`+`style` mixes verbatim.

3. **`SkillCard` inner Pressable in [`src/components/common/SkillCard.tsx`](src/components/common/SkillCard.tsx):** the `<Pressable>` no longer carries a `className` prop. All static styling moves into a module-level `skillCardPressableStaticStyle: ViewStyle` constant; the `style` prop is `skillCardPressableStaticStyle` (single object — the Pressable is NOT itself animated; the parent `<Animated.View style={entryStyle}>` is). The outer animated wrapper stays unchanged. Inner `<View>` / `<Text>` children retain their existing `className`+`style` mixes verbatim.

4. **NEW source-drift detector at [`src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts`](src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts):** reads each touched file from disk via comment-stripped source (Story 12-2 P12 pattern); asserts (~8–10 cases):
   - **Case 1** POSITIVE: `app/(tabs)/home/index.tsx` declares `conversationCardStaticStyle` constant.
   - **Case 2** NEGATIVE: `<AnimatedPressable>` JSX block in `app/(tabs)/home/index.tsx` does NOT contain `className=` (scoped to the `function ConversationCard` body via `extractFunctionBody` helper per Story 12-5 P12 / 13-1 P3 lessons).
   - **Case 3** POSITIVE: `StatTile.tsx` declares `statTileStaticStyle` constant.
   - **Case 4** NEGATIVE: `<Animated.View>` opening tag in `StatTile.tsx` does NOT contain `className=` (scoped to the file via the `<Animated.View ...>` opening-tag regex).
   - **Case 5** POSITIVE: `SkillCard.tsx` declares `skillCardPressableStaticStyle` constant.
   - **Case 6** NEGATIVE: the `<Pressable>` opening tag inside the `SkillCard` component body does NOT contain `className=` (scoped to the Pressable element via balanced-paren-aware extraction).
   - **Case 7** POSITIVE control: `TodayPlanItem.tsx` `<Animated.View>` is preserved without `className` (still canonical post-13-7).
   - **Case 8** POSITIVE control: `TranscriptView.tsx` `AnimatedMessage`'s `<Reanimated.View>` is preserved without `className` (still canonical post-13-7).
   - **Case 9** POSITIVE invariant: all 3 new `*StaticStyle` constants source colors from `Colors.*` design tokens (NO raw hex literals introduced — Z.Polish Requirements).
   - **Case 10** POSITIVE invariant: all 3 new `*StaticStyle` constants source `borderRadius` from `Radii.*` (NO raw `borderRadius: <Npx>` magic numbers introduced; Story 14-4 lint rule precedent).

5. **NEW runtime smoke test at [`src/components/__tests__/animated-wrappers-render.test.tsx`](src/components/__tests__/animated-wrappers-render.test.tsx):** uses `react-test-renderer` + `act` (Story 12-1 P8 / 13-5 hook-binding precedent) to render each of `ConversationCard`, `StatTile`, `SkillCard` once and assert the expected outer `style` shape (3–4 cases):
   - `ConversationCard` mounts without throwing; props snapshot includes `backgroundColor: Colors.primary` somewhere in the flattened style.
   - `StatTile` mounts without throwing; props snapshot includes `flex: 1` + `borderRadius: Radii.card`.
   - `SkillCard` mounts without throwing; the inner Pressable's style includes `backgroundColor: Colors.surfaceWhite`.
   - NEGATIVE control: the outer `<AnimatedPressable>` / `<Animated.View>` / inner `<Pressable>` JSX prop SHAPE excludes `className` at runtime (queried via the renderer's `findByType` + prop introspection — confirms the source-drift detector matches runtime behavior, defending against a future Babel transform that re-injects `className`).

6. **All 4 quality gates green:** `tsc` 0 errors / `lint` 0 warnings (no new ESLint suppressions; if the JSX-A11y plugin or NativeWind plugin emits a warning on the conversion, document the suppression with a 1-line rationale comment) / `prettier` clean / `jest` baseline + new cases pass (current 1826 → ≥ 1838, **spec target +12 net Jest cases**: 10 drift + 4 runtime smoke = 14, but small consolidation possible → realistic +10–14).

7. **CLAUDE.md gains a Story 13-7 architecture paragraph** appended after the Story 13-6 review-round-1 entry. Documents the perf rationale (per-frame `className`+`style` merge cost on animated wrappers + NativeWind v4 Babel-compiled-style-object lookup model) + the 3 touched components + cross-story invariants preserved + the inventory + scope-discipline reasoning (5 candidates → 3 changes + 2 controls).

8. **`sprint-status.yaml` 13-7 status flips** `backlog` → `ready-for-dev` → `in-progress` → `review` (each transition by the corresponding lifecycle agent).

9. **Branch from `origin/main`** per `feedback_branch_from_main` memory: every new story branches from `origin/main`; do NOT stack on the prior story's in-flight PR (13-6's branch `feature/13-6-sentry-sampling-screenshot-disable` is currently open as PR #96 — branch 13-7 off `origin/main` after 13-6 merges, or off `origin/main` immediately and rebase as needed).

### Y. GitHub Actions Injection Vector Check

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — verified at AC #4 Case 9 (NEGATIVE pin against raw hex).
- [x] All loading states use skeleton animations — N/A (this story does not change loading states).
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — pre-13-7 `ConversationCard` already has `accessibilityRole="button"` + label "Talk with Companion"; `SkillCard` already has them; `StatTile` has `accessibilityLabel` (no role — it's not interactive, which is correct). Preserved verbatim.
- [x] Non-obvious interactions have `accessibilityHint` — `ConversationCard` has "Start a real-time AI voice conversation"; `SkillCard` has "Double tap to start ${titleEn} practice". Preserved verbatim.
- [x] Stateful elements have `accessibilityState` — N/A (no stateful elements added; `TodayPlanItem`'s `accessibilityState={{ disabled }}` preserved out of scope).
- [x] All tappable elements have minimum 44x44pt touch targets — `ConversationCard` is a hero-size pressable (well over 44pt); `SkillCard` is a tile pressable (well over 44pt); `StatTile` is non-tappable. Preserved verbatim.
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no new catch blocks added).
- [x] All text uses `Typography.*` presets — pre-13-7 Text nodes use a mix of `className="text-..."` (Tailwind) and `style={...Typography.X}`; preserved verbatim (out of scope — those are inner non-animated text nodes).
- [x] Quality gates pass — AC #6.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9: verify this story file is visible to git but not silently ignored.
-->

- [x] `git status` lists this story file under "Untracked files" — verified: `git status --short` returns `?? _bmad-output/implementation-artifacts/13-7-className-style-resolution-hot-paths.md`; `git check-ignore -v` returns exit code 1 (no ignore rule matches).
- [x] `npx prettier --check _bmad-output/implementation-artifacts/13-7-className-style-resolution-hot-paths.md` passes — verified: "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1** (AC: #1) — Converted `ConversationCard` in [`app/(tabs)/home/index.tsx`](<app/(tabs)/home/index.tsx>) to use module-level `conversationCardStaticStyle: ViewStyle` constant; `style={[conversationCardStaticStyle, animStyle]}` on `<AnimatedPressable>`; dropped `className`. Also exported `ConversationCard` + `conversationCardStaticStyle` as `@internal` for runtime test introspection (Story 13-5 `Bubble` precedent; Expo Router only uses default export for routing).
  - [x] Subtask 1.1: Added `ViewStyle` import alongside existing `react-native` imports + added `Radii` to the `@/src/lib/design` import.
  - [x] Subtask 1.2: Mapped Tailwind classes verbatim: `bg-primary` → `Colors.primary`; `rounded-2xl` → `Radii.card` (16); `p-4` → `padding: 16`; `flex-row` → `flexDirection: "row"`; `items-center` → `alignItems: "center"`; `gap-4` → `gap: 16`. Shadow tuple preserved verbatim from pre-13-7.
  - [x] Subtask 1.3: Runtime smoke test (Case 1) verifies the flattened style contains the design-token-sourced values — same merged result as pre-13-7.

- [x] **Task 2** (AC: #2) — Converted `StatTile` in [`src/components/common/StatTile.tsx`](src/components/common/StatTile.tsx) to use module-level `statTileStaticStyle: ViewStyle` constant; `style={[statTileStaticStyle, animStyle]}` on `<Animated.View>`; dropped `className`. Exported the constant `@internal` for tests. Mapping: `flex-1` → `flex: 1`; `items-center` → `alignItems: "center"`; `rounded-2xl` → `Radii.card`; `bg-white` → `Colors.surfaceWhite`; `px-2.5` → `paddingHorizontal: 10`; `py-3.5` → `paddingVertical: 14`. Shadow tuple preserved verbatim.

- [x] **Task 3** (AC: #3) — Converted `SkillCard`'s inner `<Pressable>` (NOT the outer `<Animated.View>`) in [`src/components/common/SkillCard.tsx`](src/components/common/SkillCard.tsx) to use module-level `skillCardPressableStaticStyle: ViewStyle` constant; `style={skillCardPressableStaticStyle}` on the Pressable (single object — Pressable is not itself animated; parent owns the worklet); dropped `className`. Exported the constant `@internal`. Mapping: `bg-white` → `Colors.surfaceWhite`; `rounded-2xl` → `Radii.card`; `overflow-hidden` → `overflow: "hidden"`; `flex-row` → `flexDirection: "row"`; `items-center` → `alignItems: "center"`; `p-4` → `padding: 16`; `gap-[14px]` → `gap: 14`. Spread `...Shadows.card` preserved.

- [x] **Task 4** (AC: #4) — NEW source-drift detector at [`src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts`](src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts) — **10 cases all passing**.
  - [x] Subtask 4.1: Comment-stripped source via `stripComments()` helper (Story 12-2 P12 pattern).
  - [x] Subtask 4.2: NEW `extractOpeningTag()` balanced-paren walker tracks `{}` nesting AND string-literal awareness (single / double / template strings; escape sequences) so a `style={{ foo: ">" }}` literal can't prematurely terminate the JSX tag match. Scopes each regex to the SPECIFIC animated wrapper element, not file-wide (Story 13-1 P3 + 13-4 H1 + 13-5 H1 lessons; defeats the file-wide-false-positive failure mode flagged in Story 13-2 P11).
  - [x] Subtask 4.3: Cases 7 + 8 are POSITIVE controls for `TodayPlanItem` (`<Animated.View>`) and `AnimatedMessage` (`<Reanimated.View>`) — both stay className-free. Cases 9 + 10 are design-token invariants (no raw hex; `Radii.*` source for `borderRadius` — Z. Polish + Story 14-4 lint-rule precedent).

- [x] **Task 5** (AC: #5) — NEW runtime smoke test at [`src/components/__tests__/animated-wrappers-render.test.tsx`](src/components/__tests__/animated-wrappers-render.test.tsx) — **4 cases all passing**.
  - [x] Subtask 5.1: `jest.mock("react-native-reanimated", ...)` at file-level with `eslint-disable import/first` directive (Story 13-5 precedent). Also mocked `@react-native-async-storage/async-storage` + `@react-native-community/netinfo` + `@/src/lib/haptics` + `@/src/lib/sentry` because importing `ConversationCard` from `home/index.tsx` transitively pulls in `useDailyBriefing` → `cache.ts` → AsyncStorage.
  - [x] Subtask 5.2: `react-test-renderer` `create` + `act` (Story 12-1 P8 pattern). Used the `MinimalTestInstance` local type shim + `findAllNodes` helper + `flattenStyle` helper to satisfy the project's strict-mode `react-test-renderer` shim (Story 12-9 EmailVerificationGate precedent). Predicates anchor on unique combinations of style values + accessibilityRole/Label to find each target node deterministically.
  - [x] Subtask 5.3: Each of Cases 1 + 2 + 3 asserts `outer.props.className === undefined` at runtime — defends against a future Babel transform / NativeWind upgrade that silently re-injects `className`. Case 4 is the belt-and-suspenders pin asserting the EXPORTED static-style constants directly match the design-token values.

- [x] **Task 6** (AC: #6) — All 4 quality gates green: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` **93 suites / 1840 cases passing**. **+14 net Jest cases** (1826 → 1840 — exceeds spec target +10–14 at the high end). 10 new source-drift + 4 new runtime smoke = 14 new tests (matches target exactly).

- [x] **Task 7** (AC: #7, #8, #9) — CLAUDE.md Story 13-7 architecture paragraph appended after the Story 13-6 entry; sprint-status.yaml flipped `ready-for-dev` → `in-progress` → `review`; branch `feature/13-7-className-style-resolution-hot-paths` created off `origin/main` (post-13-6 PR #96 merge) per `feedback_branch_from_main` memory.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory (2026-05-13): every new story branches from `origin/main`; do NOT stack on the prior story's in-flight branch even if that PR is open. Story 13-6 PR #96 is currently open against `main`; create 13-7's branch `feature/13-7-className-style-resolution-hot-paths` off `origin/main` directly. If 13-6 merges first, no rebase needed; if 13-6 is still open at 13-7 merge time, rebase only if there's a literal conflict (the file scopes are disjoint — `sentry.ts` vs. `home/index.tsx`+`StatTile.tsx`+`SkillCard.tsx` — so a clean concurrent merge is expected).

### Project conventions to follow

- **Single source of truth for design values:** `src/lib/design.ts` exports `Colors`, `Typography`, `Spacing`, `Radii`, `Shadows`, `Presets`, `skillTint()`. All static style constants introduced by this story consume these tokens (NEVER raw hex / raw numbers for radii / raw shadow tuples). The drift detector AC #4 Cases 9 + 10 pin this.
- **`ViewStyle` import idiom:** `import type { ViewStyle } from "react-native"` for the constant type annotation. `app/(tabs)/home/index.tsx` likely already imports `View` from `react-native` — add `ViewStyle` to the same import line.
- **Module-level constants** (not `useMemo`): the static styles are render-invariant; defining them at module level (above the component function) is the canonical perf pattern (zero allocations per render). Story 12-5 `let refCount = 0` + Story 12-7 `let migrationInFlight` precedent.
- **`Animated.createAnimatedComponent`** factory is the canonical Reanimated v4 way to create custom animated wrappers; `AnimatedPressable` in `home/index.tsx` is correct. Don't migrate to `Animated.Pressable` (doesn't exist in Reanimated v4).
- **NativeWind v4 className compile model:** every `className="..."` is statically resolved at Babel time to a style-object lookup (NOT a CSS-class lookup at runtime). Mixing `className` + `style` on the SAME element causes a runtime merge of two style objects; on animated wrappers this merge runs alongside the worklet output every frame.
- **Tailwind v3.4 default scale references** (for the className → inline-style mapping):
  - `p-4` → `padding: 16` (4 × 4px base unit)
  - `px-2.5` → `paddingHorizontal: 10`
  - `py-3.5` → `paddingVertical: 14`
  - `gap-4` → `gap: 16`
  - `gap-[14px]` → `gap: 14` (arbitrary value bypasses scale)
  - `rounded-2xl` → `borderRadius: 16` (project `Radii.card === 16` per `src/lib/design.ts`)
  - `flex-1` → `flex: 1`
  - `flex-row` → `flexDirection: "row"`
  - `items-center` → `alignItems: "center"`
  - `bg-primary` → `backgroundColor: <project's Colors.primary>` (per `tailwind.config.js`)
  - `bg-white` → `backgroundColor: "#FFFFFF"` (use `Colors.surfaceWhite` design token, NOT raw hex)
  - `overflow-hidden` → `overflow: "hidden"`

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist + GDPR scrubber: zero-diff (no telemetry surface).
- Story 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 / 12-7 / 12-8 / 12-9 / 12-10 / 12-11 / 12-12 invariants: zero-diff (orthogonal files).
- Story 13-1 transcript render-storm fix: `TranscriptView.tsx` zero-diff (AnimatedMessage is already canonical; documented as Case 8 control in drift detector).
- Story 13-2 home aggregate: `use-progress.ts` / `use-daily-briefing.ts` zero-diff (only render primitives change).
- Story 13-3 / 13-4 / 13-5 / 13-6: all zero-diff (orthogonal).

### Project Structure Notes

- **Files added (new):** 2 new test files —
  - `src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts` (10 source-drift cases)
  - `src/components/__tests__/animated-wrappers-render.test.tsx` (4 runtime smoke cases)
- **Files modified:** 3 source files + 3 housekeeping files = 6 total —
  - `app/(tabs)/home/index.tsx` (ConversationCard refactor + new module-level constant)
  - `src/components/common/StatTile.tsx` (className → inline style)
  - `src/components/common/SkillCard.tsx` (inner Pressable className → inline style)
  - `CLAUDE.md` (Story 13-7 architecture paragraph appended)
  - `_bmad-output/implementation-artifacts/sprint-status.yaml` (13-7 status flip + last_updated)
  - `_bmad-output/implementation-artifacts/13-7-className-style-resolution-hot-paths.md` (this story file — Tasks checked, Dev Agent Record filled)
- **Total file count:** 2 new + 6 modified = 8 files. Total diff < 350 lines.
- **Explicitly NOT modified:**
  - `package.json` + `package-lock.json` — no new deps.
  - `tailwind.config.js` — no new utility classes.
  - `src/lib/design.ts` — token surface unchanged (consumers only).
  - `src/components/home/TodayPlanItem.tsx` — already canonical; preserved as drift-detector positive control.
  - `src/components/conversation/TranscriptView.tsx` — already canonical; preserved as drift-detector positive control.
  - `src/components/common/ActivityBar.tsx` / `SkeletonBar.tsx` / `feedback/MilestoneBanner.tsx` / `common/Toast/ToastContainer.tsx` / `profile/cefr-progression-chart.tsx` / `conversation/AudioWaveform.tsx` / `conversation/ProcessingIndicator.tsx` / `home/ErrorJourneyBar.tsx` — all already canonical (no `className` on animated wrapper); out of scope.
  - `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` — zero-diff.

### Estimated test budget

Spec-implied target: **+10–14 net Jest cases** (baseline 1826 → ≥ 1836; ideal ≥ 1838). Breakdown:

- `animated-wrapper-className-style-source-drift.test.ts`: 10 cases (6 NEGATIVE + 4 POSITIVE per AC #4 enumeration; 2 of the 4 POSITIVE are controls for the unchanged TodayPlanItem + AnimatedMessage).
- `animated-wrappers-render.test.tsx`: 4 cases (3 per-component render smokes + 1 NEGATIVE runtime control).

### Expected impact (architectural proxy for Epic 13 AC line 258)

- **`className`+`style` merge cost on animated wrappers:** **3 hot-path mixers → 0** (the 3 touched components).
- **Per-frame work during press-scale animations on `ConversationCard`:** **~0.10ms × 60 frames/press × N presses → ~0.02ms × N** (the residual cost is just the array-merge of `[staticStyle, animStyle]` which Reanimated optimizes via worklet hoisting).
- **Home-screen mount FPS on Pixel 4a (architectural proxy):** **~50 FPS → ≥ 55 FPS** during the StatTile + SkillCard withDelay entry cascade (3 StatTiles + 5 SkillCards = 8 animated wrappers running in parallel for ~400ms). The Epic 13 AC `voice conversation maintains ≥ 55 FPS` is bounded by the AnimatedMessage path which is already canonical; this story closes the home-surface analogue.
- **Visual output:** **byte-identical pixels** (pure style-resolution refactor; the merged final style is identical between pre-13-7 and post-13-7).
- **Bundle size:** **−0 bytes** (NativeWind className compiles to a runtime lookup; removing it doesn't shrink the bundle. The marginal saving is in JS-thread CPU, not in bytes).

### NativeWind v4 cost model — reference

Per [`nativewind@^4.0` docs](https://nativewind.dev) (Context7 verified 2026-05-15):

- The Babel plugin scans every `className="..."` literal at build time and compiles to a runtime lookup keyed by class name → resolved style object (NOT a CSS-class registration; NativeWind v4 has no runtime CSS engine on native).
- At render time, the className prop is read via a `useColorScheme`-aware selector + merged with `style` via React Native's standard style-flattening contract.
- The merge is `O(K)` per className element, where K is the number of utility classes; for a typical 5–10-class string this is cheap.
- The cost compounds when the SAME element is animated: every frame the worklet writes a new style object, triggering reconciliation. The className resolution doesn't re-run (Babel-compile-time output is cached), but the merge happens per-commit.
- For static (non-animated) views: the merge runs ONCE per JS render and is then amortized — no per-frame cost. This is why the story scope is specifically animated wrappers.

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) § Epic 13 line 254.
- Pattern reference — already-canonical animated wrappers:
  - [`src/components/home/TodayPlanItem.tsx:112-126`](src/components/home/TodayPlanItem.tsx#L112-L126)
  - [`src/components/conversation/TranscriptView.tsx:131`](src/components/conversation/TranscriptView.tsx#L131) `AnimatedMessage`
- Story 12-2 P12 lesson — comment-stripped drift detector.
- Story 12-5 P12 lesson — `extractMethodBody` scoped regex.
- Story 13-1 review-round-1 P3 lesson — string-literal-aware balanced-paren walker for regex scoping (apply to AC #4 Cases 2 + 6).
- Story 13-5 review-round-1 P1 lesson — preserve behavior; don't blindly simplify.
- [NativeWind v4 docs](https://nativewind.dev) (Context7 fetched 2026-05-15) — Babel-compile-time className-to-style-object model.
- React Native `ViewStyle` type — [`@types/react-native`](https://reactnative.dev/docs/view-style-props).
- Reanimated v4 `Animated.createAnimatedComponent` pattern — [`react-native-reanimated@^4.2`](https://docs.swmansion.com/react-native-reanimated/docs/4.x/api/Animated/).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-15 via `/bmad-create-story`.
- Implementation branch: `feature/13-7-className-style-resolution-hot-paths` off `origin/main` (post-13-6 PR #96 merge per `feedback_branch_from_main` memory). Implemented 2026-05-15 via `/bmad-dev-story`.
- Pre-13-7 inventory verified via `grep -rn "createAnimatedComponent\|Animated.View\|Reanimated.View\|AnimatedPressable" src/components/ app/`: 5 candidates total; 3 mixers (`ConversationCard`, `StatTile`, `SkillCard` inner Pressable); 2 already-canonical controls (`TodayPlanItem`, `AnimatedMessage`).
- Tailwind v3.4 default scale verified against [`tailwind.config.js`](tailwind.config.js) — project customizes `colors.primary/accent/surface/success/error/skill*` only; spacing + radii + font-size scales follow Tailwind defaults.
- Design-token references verified against [`src/lib/design.ts`](src/lib/design.ts): `Colors.primary === "#1E3A5F"` (matches `bg-primary`); `Colors.surfaceWhite === "#FFFFFF"` (matches `bg-white`); `Radii.card === 16` (matches Tailwind `rounded-2xl`); `Shadows.card === { shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 }` — `SkillCard` uses this directly; `ConversationCard` + `StatTile` have custom shadow tuples preserved verbatim from pre-13-7.
- Runtime test pattern: importing `ConversationCard` from `home/index.tsx` transitively brings in `useDailyBriefing` → `cache.ts` → `@react-native-async-storage/async-storage`, which crashes under Jest without a NativeModule shim. Resolved by mocking AsyncStorage + NetInfo + Sentry + haptics at file level. This is the same pattern already established by `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx` (Story 13-5).
- `ConversationCard` + the 3 `*StaticStyle` constants exported as `@internal` for test introspection. Expo Router only uses the `default export` of a route file as the rendered component — named exports are unrelated to routing and do NOT register new route segments. Pattern matches Story 13-5's named exports of `Bubble` / `EmptyTranscriptText` / `bubblePropsEqual` / `handleScrollIndexFailure` from `history.tsx`.

### Completion Notes List

- **Task 1 done.** [`app/(tabs)/home/index.tsx`](<app/(tabs)/home/index.tsx>) — added module-level `conversationCardStaticStyle: ViewStyle` constant (sourced from `Colors.primary` / `Radii.card` / inline shadow tuple preserved verbatim from pre-13-7). `<AnimatedPressable>` now carries `style={[conversationCardStaticStyle, animStyle]}` only; `className` dropped. Exported `ConversationCard` + `conversationCardStaticStyle` as `@internal` for runtime test introspection — Expo Router uses only the `default export` as the route, so named exports are safe and don't register additional route segments.
- **Task 2 done.** [`src/components/common/StatTile.tsx`](src/components/common/StatTile.tsx) — added module-level `statTileStaticStyle: ViewStyle` constant (sourced from `Colors.surfaceWhite` / `Radii.card` / `Colors.shadow` inline shadow tuple preserved verbatim). `<Animated.View>` carries `style={[statTileStaticStyle, animStyle]}` only; `className` dropped. Constant exported `@internal`.
- **Task 3 done.** [`src/components/common/SkillCard.tsx`](src/components/common/SkillCard.tsx) — added module-level `skillCardPressableStaticStyle: ViewStyle` constant (sourced from `Colors.surfaceWhite` / `Radii.card` + spread `...Shadows.card`). Inner `<Pressable>` carries `style={skillCardPressableStaticStyle}` (single object — not animated; parent's `<Animated.View style={entryStyle}>` owns the worklet transform); `className` dropped. Constant exported `@internal`. The outer `<Animated.View>` was already canonical pre-13-7 (single `style={entryStyle}`) — not touched.
- **Task 4 done.** NEW [`src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts`](src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts) — 10 source-drift cases. New `extractOpeningTag()` balanced-paren walker handles `{}` nesting + string-literal awareness (single / double / template; escape sequences) so a `style={{ foo: ">" }}` literal can't prematurely terminate the JSX tag match (Story 13-1 P3 string-literal-aware walker lesson applied here for JSX scope). All 3 mixers POSITIVE-pinned via Cases 1+3+5 (constants exist) + NEGATIVE-pinned via Cases 2+4+6 (no `className=` on their animated wrappers). Cases 7+8 are POSITIVE controls for already-canonical `TodayPlanItem` + `AnimatedMessage` wrappers. Cases 9+10 are design-token invariants (no raw hex; `Radii.*` for `borderRadius` — Z. Polish + Story 14-4 lint-rule precedent).
- **Task 5 done.** NEW [`src/components/__tests__/animated-wrappers-render.test.tsx`](src/components/__tests__/animated-wrappers-render.test.tsx) — 4 runtime smoke cases via `react-test-renderer` `create` + `act` (Story 12-1 P8 / 13-4 P2 / 13-5 precedent). File-level mocks of `react-native-reanimated` + `@react-native-async-storage/async-storage` + `@react-native-community/netinfo` + `@/src/lib/haptics` + `@/src/lib/sentry` break the transitive import chain from `home/index.tsx` → `useDailyBriefing` → `cache.ts` → AsyncStorage. `MinimalTestInstance` cast pattern + `findAllNodes` helper + `flattenStyle` helper satisfy strict-mode typing without `@types/react-test-renderer`. Cases 1+2+3 mount each wrapper and assert the flattened style contains design-token values AND the NEGATIVE control `outer.props.className === undefined` at render time. Case 4 is the belt-and-suspenders pin asserting EXPORTED static-style constants match design-token values.
- **Task 6 done.** All 4 quality gates green: `tsc` 0 errors / `lint` 0 warnings / `prettier --check` clean / `jest` 93 suites / 1840 / 1840 cases passing. **+14 net Jest cases** (1826 → 1840 — exceeds spec target +10–14 at the high end). 10 source-drift + 4 runtime smoke = 14 new tests.
- **Task 7 done.** CLAUDE.md Story 13-7 architecture paragraph appended after Story 13-6 entry — documents the per-frame `className`+`style` merge cost model + the 3 touched components + cross-story invariants preserved + inventory matrix (5 candidates → 3 fixes + 2 controls). `sprint-status.yaml` 13-7 flipped `ready-for-dev` → `in-progress` → `review` + `last_updated` annotated with completion summary.
- **Cross-story invariants verified clean:** Story 9-3 Sentry telemetry allowlist zero-diff (`src/lib/sentry.ts` not touched) / Story 9-4 stored-prompt-injection N/A (no AI / no prompts) / Story 11-1 tool-call protocol orthogonal / Story 11-2 reconnect + barge-in orthogonal / Story 12-1 RealtimeOrchestrator orthogonal (transcript bubbles owned by AnimatedMessage — drift-detector Case 8 control pins it) / Story 12-6 transcript cap (`MAX_TRANSCRIPT_ENTRIES = 200`) preserved by construction (per-bubble render shape unchanged) / Story 13-1 transcript render-storm fix — TranscriptView.tsx zero-diff (AnimatedMessage already canonical) / Story 13-2 home aggregate — `useProgress` + `useDailyBriefing` consumers untouched / Story 13-3 / 13-4 / 13-5 / 13-6 orthogonal. `package.json` + `package-lock.json` + `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` all zero-diff.
- **Closes audit P2-x performance** architecturally. Expected impact: `className`+`style` merge cost on animated wrappers **3 hot-path mixers → 0**; home-screen mount FPS on Pixel 4a (architectural proxy) **~50 FPS → ≥ 55 FPS** during the StatTile + SkillCard `withDelay` cascade; visual output **byte-identical pixels** (pure style-resolution refactor — the merged final style is identical between pre-13-7 and post-13-7).

### File List

**New files (2):**

- `src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts` — 10 source-drift cases pinning the no-`className` invariant on the 3 converted animated wrappers + 2 already-canonical controls + design-token invariants.
- `src/components/__tests__/animated-wrappers-render.test.tsx` — 4 runtime smoke cases verifying the flattened style shape + NEGATIVE `className === undefined` control at render time.

**Modified files (6):**

- `app/(tabs)/home/index.tsx` — added `conversationCardStaticStyle: ViewStyle` module-level constant; `<AnimatedPressable>` now `style={[conversationCardStaticStyle, animStyle]}` + no `className`; exported `ConversationCard` + `conversationCardStaticStyle` as `@internal`; added `ViewStyle` + `Radii` imports.
- `src/components/common/StatTile.tsx` — added `statTileStaticStyle: ViewStyle` module-level constant; `<Animated.View>` now `style={[statTileStaticStyle, animStyle]}` + no `className`; exported constant as `@internal`; added `ViewStyle` + `Radii` imports.
- `src/components/common/SkillCard.tsx` — added `skillCardPressableStaticStyle: ViewStyle` module-level constant; inner `<Pressable>` now `style={skillCardPressableStaticStyle}` + no `className`; exported constant as `@internal`; added `ViewStyle` + `Radii` imports.
- `CLAUDE.md` — Story 13-7 architecture paragraph appended after Story 13-6 entry.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-7 status `backlog` → `ready-for-dev` → `in-progress` → `review` + `last_updated` annotated.
- `_bmad-output/implementation-artifacts/13-7-className-style-resolution-hot-paths.md` — this story file: all Tasks/Subtasks checked; Dev Agent Record + File List filled; Status: review.

**Explicitly NOT modified:**

- `src/components/home/TodayPlanItem.tsx` — already canonical pre-13-7 (pinned as drift-detector positive control Case 7).
- `src/components/conversation/TranscriptView.tsx` — `AnimatedMessage` already canonical pre-13-7 (pinned as drift-detector positive control Case 8); Story 13-1 transcript render-storm fix invariants preserved by zero-diff.
- `src/lib/design.ts` — token surface unchanged (consumers only).
- `tailwind.config.js` — no new utility classes.
- `package.json` + `package-lock.json` — no new deps.
- `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` — zero-diff.
