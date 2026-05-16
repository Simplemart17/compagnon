# Story 14.8: Themed Dialog Component — replace `Alert.alert` for high-traffic flows (sign-out, level change, daily-goal change, delete-account stage-1) with a custom design-token-styled dialog matching the Companion visual identity

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **a user encountering a confirmation prompt for a high-traffic action (signing out, changing my level, changing my daily goal, or starting account deletion)**,
I want **the prompt to feel like part of the Companion app — matching its colors, typography, button styles, and rhythm — instead of the OS-default `Alert.alert` chrome**,
so that **the trust-and-design continuity across screens isn't broken at exactly the moments where I'm being asked to confirm something important, AND the app feels polished + consistent across iOS and Android**.

## Background — Why This Story Exists

### What audit / roadmap owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 277 — Epic 14 deliverable 14.8:

> 14.8 Replace `Alert.alert` for high-traffic flows (sign-out, level change) with a custom themed dialog component.

This is one of the Epic 14 "P2-x ui-ux" closures (consistent visual identity). The default `Alert.alert` has 3 visible-design problems on this app:

1. **It's the OS-default chrome** — iOS-blue button text + iOS-system-font + iOS-system-corner-radius; on Android it's Material-default. The dialogs look like NOTHING ELSE in Companion (which is navy + amber + custom rounded-2xl + Typography presets).
2. **It can't carry icons / visual hierarchy** — every dialog is a wall of text. A delete-account flow has the same chrome weight as a "check your email" success message.
3. **It can't be subclassed** — the OS-default styling is impossible to override; you either accept it or render your own.

### Why this matters at the design-system level

Story 14-2 consolidated 9 inline card components into 2 reusable ones (`SkillCard`, `ListItemCard`). Story 14-3 replaced 33 chrome emoji with `Feather` icons. Story 14-4 enforced design tokens via ESLint + bash CI. Story 14-5 split the accent color into CTA / streak / progress clusters. **Every one of these stories aimed at a single product-feel.** A user who taps "Sign out" and gets a system-native Alert with iOS-blue buttons sees an instant break in that product-feel — the design discipline of the surrounding 200 screens vanishes for the 5 most-tapped confirmation flows.

### Scope discipline — high-traffic FIRST, defer the rest

The codebase has **44 `Alert.alert` call sites** (research from Explore agent, 2026-05-16):

- **5 high-traffic confirmation flows** (this story's target):
  - Sign out — `profile/index.tsx:82-92` + `profile/settings.tsx:299-309` (2 sites, same content)
  - Change current CEFR level — `profile/settings.tsx:121-141`
  - Change target CEFR level — `profile/settings.tsx:143-159`
  - Change daily goal minutes — `profile/settings.tsx:162-182`
  - Delete account stage-1 warning — `profile/settings.tsx:246-262`
- **~6 secondary confirmation flows** (defer to followup):
  - Leave conversation / leave test / end conversation early / submit test / skip-section / corrupt-resume recovery — these are also confirmation prompts, but they're triggered in conversation/test contexts (lower volume than settings)
- **~20+ error notifications** (out of scope per roadmap; defer):
  - Auth errors (login / signup / forgot-password / email-verification) — short transient errors; Alert is acceptable
  - Network errors (test generation, results loader) — same
- **~4 info / success messages** (out of scope; defer):
  - "Check your email", "Onboarding Complete", etc.

**Story 14-8 scope: build the `ThemedDialog` component + migrate the 5 high-traffic confirmation flows.** The remaining 39+ Alert.alert call sites are filed for `14-8-followup-alert-migration-completion` and can be migrated incrementally without blocking 14-8.

### Why NOT a full-screen modal (vs the transcript-modal precedent)

[`app/(tabs)/conversation/history.tsx:1039-1150`](<app/(tabs)/conversation/history.tsx#L1039-L1150>) uses `<Modal presentationStyle="pageSheet">` — a full-height bottom-sheet — for the transcript viewer. That pattern is correct for **content** (reading a long transcript) but WRONG for a **confirmation** ("Are you sure you want to sign out?"). The user-intent distinction:

- **Transcript modal:** "I want to consume this content; let me page through it." — full-screen sheet.
- **Confirmation dialog:** "I want to commit to a choice; STOP me and force a decision." — centered, backdrop-dimmed, blocks the screen.

Story 14-8 uses the **centered-dialog pattern** (small card centered with dim backdrop), matching iOS Human Interface Guidelines for "Alert" / "Action Sheet" vs "Modal". Native `<Modal transparent>` + Reanimated fade-in + frozen-style card.

### Why `useState`-driven inline render (NOT an imperative API)

An imperative API like `dialog.show({...}).then(result)` requires a global root provider + dispatcher and produces less-testable code. The codebase's established pattern (Story 12-9 `EmailVerificationGate`, Story 14-7 mock-test landing's `loadAndNavigate` confirmation Alerts) is **`useState<boolean>` + conditional inline render**. Story 14-8 follows that pattern: every consumer creates its own `useState<DialogConfig|null>` + renders `<ThemedDialog visible={state !== null} ... />` inline.

This is more boilerplate per consumer (each callsite must declare its own state + handlers) but it's:

- More testable (no provider wrapping needed in tests)
- More transparent (no "where does this dialog actually mount?" debugging)
- Consistent with the codebase's other interactive surfaces

A future story can introduce a `useDialog()` imperative wrapper on TOP of the declarative component without breaking the v1 API.

### Why `accessible={false}` on the BACKDROP (not the dialog content)

The dialog's CONTENT must be screen-reader-focusable (it's the active focus surface). The BACKDROP behind it is decorative — VoiceOver/TalkBack should never read "dim backdrop" as an element. Per Story 14-3 R1-P1 lesson (iOS-only `importantForAccessibility="no"` is a no-op on Android), the backdrop needs the 3-prop decorative pattern: `accessible={false}` + `accessibilityElementsHidden={true}` + `importantForAccessibility="no"`.

### Why NO icons in dialog v1

Story 14-3's `IconName` union doesn't include `"alert-triangle"`, `"info"`, or `"help-circle"` — the natural icons for a confirmation/info/destructive dialog. Adding 2-3 icons to the union is doable but it conflates the visual-design decision ("should dialogs have icons?") with the system-level decision ("which icons does the app's icon system support?"). Operator-decision per AC #11 Q3: v1 ships **text-only dialogs**; a future story can add `iconName?: IconName` prop + extend the union if the design call lands.

### What 14-8 does NOT do

- ❌ Migrate the 20+ error-notification Alerts (defer to `14-8-followup-alert-migration-completion`)
- ❌ Migrate the conversation/test confirmation Alerts (different surface; defer to followup)
- ❌ Imperative `useDialog()` hook API — v1 ships declarative inline-render only
- ❌ Multi-step dialogs (e.g., the delete-account "type DELETE" inline confirmation) — that's a follow-up story `14-8-followup-multi-step-confirm`; v1 only handles the STAGE-1 warning Alert
- ❌ Bottom-sheet variant (the transcript-modal pattern stays; ThemedDialog is centered-card only)
- ❌ Async-spinner state on buttons (consumers handle async themselves via their `onPress` handler returning a Promise; the dialog itself is sync-render-only in v1)
- ❌ Add `iconName?` to dialog props (Q3 deferred)
- ❌ Translate dialog strings to FR (Story 14-1 chrome rule: all dialog chrome is English)

## Acceptance Criteria

### A. NEW `ThemedDialog` component

1. **AC-A1:** NEW file `src/components/common/ThemedDialog.tsx` exports a default `ThemedDialog` component (React.memo-wrapped per Story 14-2 / 14-3 / 14-7 precedent) AND a named `ThemedDialogProps` interface AND a named `ThemedDialogButton` interface.

2. **AC-A2:** Component props:
   ```ts
   interface ThemedDialogButton {
     label: string;
     /** "default" = filled accent; "destructive" = filled error red; "cancel" = transparent + textSecondary. */
     style?: "default" | "destructive" | "cancel";
     onPress?: () => void;
   }

   interface ThemedDialogProps {
     visible: boolean;
     title: string;
     message: string;
     /** 1-3 buttons. Order: cancel (left) → default/destructive (right) for 2 buttons; stacked vertically for 3. */
     buttons: ThemedDialogButton[];
     /** Fires on backdrop tap or Android hardware back. Caller sets `visible=false`. Suppressed when any button is "destructive". */
     onRequestClose?: () => void;
     /** Optional accessibility label override (defaults to `${title}. ${message}`). */
     accessibilityLabel?: string;
   }
   ```

3. **AC-A3:** Renders via native `<Modal transparent animationType="none" visible={visible} onRequestClose={...}>`. The `animationType="none"` is intentional — Reanimated owns the fade-in animation (consistent with Story 13-1's animation-storm discipline; native Modal's `"fade"` animation can't be tuned for token-driven timing).

4. **AC-A4:** Inside the Modal: full-screen backdrop View with `backgroundColor: "rgba(0,0,0,0.5)"` (50% black dim — operator-decision Q1 default; raw RGBA acceptable per the Story 14-4 `check:tokens` exempt-set since `Colors.shadow` is `#000000` and the dim is a derived backdrop, not a tint). Backdrop has `accessible={false}` + `accessibilityElementsHidden={true}` + `importantForAccessibility="no"` (Story 14-3 R1-P1 cross-platform decorative pattern). Backdrop is tappable when `onRequestClose` is provided AND no button is `style: "destructive"` — tapping fires `onRequestClose`.

5. **AC-A5:** Dialog card centered on screen — module-level frozen `ViewStyle` constant `themedDialogCardStaticStyle` (Story 13-7 / 14-2 R1-P1 + R1-P2 pattern):
   ```ts
   export const themedDialogCardStaticStyle: ViewStyle = Object.freeze({
     ...Shadows.hero,
     backgroundColor: Colors.surfaceWhite,
     borderRadius: Radii.card,
     padding: 24,
     marginHorizontal: 32,
     maxWidth: 360,
     alignSelf: "center" as const,
   }) as ViewStyle;
   ```
   Spread `Shadows.hero` first (higher elevation than `Shadows.card` — dialogs sit on top of the dimmed backdrop).

6. **AC-A6:** Title styled with `Typography.sectionHeader` (fontSize:18, fontWeight:"700", color:Colors.textPrimary) + `accessibilityRole="header"` + `numberOfLines={3}` (defensive cap).

7. **AC-A7:** Message styled with `Typography.body` (fontSize:15, lineHeight:22, color:Colors.textPrimary) + `marginTop: 12` + no line cap (long messages wrap; rare edge case `numberOfLines={20}` defensive).

8. **AC-A8:** Buttons:
   - **2-button layout (default):** horizontal row, gap 12, marginTop 24. Cancel button on the LEFT (visually de-emphasized, conventionally non-destructive), action button on the RIGHT.
   - **3-button layout:** stacked vertically, gap 8, marginTop 24. Order: top-to-bottom matches input array order; conventionally action / alternative-action / cancel.
   - **1-button layout:** full-width single button, marginTop 24.

9. **AC-A9:** Button styling per `style` prop, all using module-level frozen `ViewStyle` constants (Story 13-7 frozen-static-style):
   - `default` → bg `Colors.accent`, text `Colors.textOnDark` (white), `Typography.ctaLabel` (Story 14-6 introduced this preset; 17pt 700-weight white).
   - `destructive` → bg `Colors.error`, text `Colors.textOnDark`, `Typography.ctaLabel`.
   - `cancel` → bg transparent, text `Colors.textSecondary`, `Typography.ctaLabel` (without color override — use `Colors.textSecondary` explicitly).
   - All buttons: `borderRadius: Radii.button` (12), `paddingVertical: 12`, `alignItems: "center"`, `flex: 1` in horizontal layout, `width: "100%"` in vertical layout.

10. **AC-A10:** Each button has `accessibilityRole="button"` + `accessibilityLabel={button.label}` (overrideable). Pressable handlers wrapped in synchronous re-entrancy guard via local `useRef<boolean>` (Story 12-9 / 14-7 R1-P6 pattern) — prevents double-fire if the user double-taps and the consumer's `onPress` is async.

11. **AC-A11:** Reanimated entry animation: opacity 0 → 1 + scale 0.92 → 1, withTiming 180ms, easing easeOut. Constants exported `@internal` for test pinning:
    ```ts
    export const THEMED_DIALOG_ANIM_DURATION_MS = 180;
    ```
    Fired on `visible` true→transitions; reverse on `visible` true→false (180ms fade-out + scale-down). Component must use `useAnimatedStyle` per Story 13-1 / 14-6 precedent.

### B. NEW `useThemedDialog()` hook (declarative state helper)

12. **AC-B1:** NEW file `src/hooks/use-themed-dialog.ts` exports `useThemedDialog()` returning `{ visible, config, show, hide }`:
    ```ts
    interface UseThemedDialogReturn {
      visible: boolean;
      config: ThemedDialogConfig | null;
      show: (config: ThemedDialogConfig) => void;
      hide: () => void;
    }
    type ThemedDialogConfig = Omit<ThemedDialogProps, "visible">;
    ```
    Consumers create one instance per surface that needs a dialog, then `<ThemedDialog visible={visible} {...config} />` renders the latest config. `show()` sets visible + config; `hide()` clears visible (config retained for the exit animation; cleared after `THEMED_DIALOG_ANIM_DURATION_MS`).

13. **AC-B2:** Hook handles double-show / show-while-visible by replacing the config (no animation interruption — the visible→visible transition is a no-op at the Reanimated layer).

### C. Migrate 5 high-traffic flows

14. **AC-C1:** `app/(tabs)/profile/index.tsx` `handleSignOut`:
    - Before: `Alert.alert("Sign Out", "Are you sure...", [Cancel, {style:"destructive", onPress: signOut}])`
    - After: `dialog.show({ title: "Sign Out", message: "Are you sure you want to sign out?", buttons: [{label:"Cancel", style:"cancel"}, {label:"Sign Out", style:"destructive", onPress: () => { dialog.hide(); void signOut(); }}] })`
    - Cancel button has no `onPress` — the dialog auto-hides on any button tap (button onPress wrapper calls `dialog.hide()` synchronously before any caller-provided handler).

15. **AC-C2:** `app/(tabs)/profile/settings.tsx` `handleSignOut`: identical migration to AC-C1 (same Alert content; both files contain the same handler).

16. **AC-C3:** `app/(tabs)/profile/settings.tsx` `handleUpdateLevel(level)`: migrate the `Alert.alert("Change Level", "Set your current level to ${level}? This may affect exercise difficulty.", [...])` to `dialog.show({ title: "Change Level", message: ..., buttons: [{label:"Cancel", style:"cancel"}, {label:"Confirm", style:"default", onPress: async () => { ... updateProfile + showToast ...}] })`.

17. **AC-C4:** `app/(tabs)/profile/settings.tsx` `handleUpdateTarget(level)`: same pattern as C3.

18. **AC-C5:** `app/(tabs)/profile/settings.tsx` `handleUpdateDailyGoal(minutes)`: same pattern as C3.

19. **AC-C6:** `app/(tabs)/profile/settings.tsx` `handleDeleteAccount` stage-1: migrate the `Alert.alert("Delete Account", "This will permanently delete...", [Cancel, Continue])` to `dialog.show({ title: "Delete Account", message: ..., buttons: [{label:"Cancel", style:"cancel"}, {label:"Continue", style:"destructive", onPress: () => { dialog.hide(); setDeleteConfirmText(""); setShowDeleteConfirm(true); }}] })`. The stage-2 inline confirmation (type "DELETE" to confirm) is OUT OF SCOPE for v1 — defer to `14-8-followup-multi-step-confirm`.

### D. Tests

20. **AC-D1:** NEW runtime test file `src/components/common/__tests__/themed-dialog.test.tsx` — covers (a) renders title + message + 1-button case, (b) 2-button horizontal layout with cancel-left/confirm-right ordering, (c) 3-button vertical stack ordering, (d) backdrop tap fires `onRequestClose` when NO destructive button + suppressed when ANY destructive button, (e) double-tap re-entrancy guard on a button, (f) backdrop a11y attrs (3-prop decorative), (g) button accessibilityRole/Label propagation, (h) visible:false does NOT render Modal content (mounting cost zero when hidden), (i) `Object.isFrozen(themedDialogCardStaticStyle) === true`. Spec target: **9-12 runtime cases**.

21. **AC-D2:** NEW hook test file `src/hooks/__tests__/use-themed-dialog.test.tsx` — covers (a) initial state `{visible:false, config:null}`, (b) `show(config)` sets visible+config, (c) `hide()` clears visible but retains config briefly (for exit anim), (d) `show()` called while visible replaces config without flicker, (e) `hide()` then `show()` re-shows correctly. Spec target: **5-7 cases**.

22. **AC-D3:** NEW source-drift test file `src/lib/__tests__/themed-dialog-migration-source-drift.test.ts` — Story 12-2 P12 comment-stripped readFile + Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline:
    - Case 1: `ThemedDialog` is imported in `profile/index.tsx` (sign-out migration).
    - Case 2: `ThemedDialog` is imported in `profile/settings.tsx`.
    - Case 3-7: NEGATIVE-pin — each of the 5 migrated handler bodies (`handleSignOut` × 2, `handleUpdateLevel`, `handleUpdateTarget`, `handleUpdateDailyGoal`, `handleDeleteAccount`) does NOT contain `Alert.alert(`.
    - Case 8: POSITIVE — `useThemedDialog` invoked in both screens.
    - Case 9: `themedDialogCardStaticStyle` exported AND frozen (regex pin `Object.freeze`).
    - Case 10: `THEMED_DIALOG_ANIM_DURATION_MS` exported as `180`.
    - Spec target: **8-10 drift cases**.

### Z. Polish Requirements

- [ ] All colors via `Colors.*` design tokens — no hardcoded hex (Story 14-4 invariant; the backdrop `rgba(0,0,0,0.5)` is exempt per AC-A4 documented rationale).
- [ ] All radii via `Radii.*` (`Radii.card` for the dialog card, `Radii.button` for buttons).
- [ ] All shadows via `Shadows.*` (`Shadows.hero` spread on the dialog card).
- [ ] All text uses `Typography.*` presets (`Typography.sectionHeader` title, `Typography.body` message, `Typography.ctaLabel` buttons).
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel`.
- [ ] Backdrop has the Story 14-3 R1-P1 3-prop decorative a11y pattern.
- [ ] All `catch` blocks use `captureError(err, "context")` (no Sentry surface in this component; consumers handle their own errors).
- [ ] Story 14-1 chrome rule: all dialog chrome (button labels, default title casing) is English.
- [ ] Story 13-7 frozen-static-style pattern: card + button styles are module-level `Object.freeze(...)` constants.
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test -- --no-coverage && npm run check:tokens`.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored.
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/14-8-themed-dialog-component.md` passes.

## Tasks / Subtasks

- [ ] **Task 1: Create `src/components/common/ThemedDialog.tsx`** (AC: A1-A11)
  - [ ] 1.1 Define `ThemedDialogButton` + `ThemedDialogProps` interfaces.
  - [ ] 1.2 Define `themedDialogCardStaticStyle` + button-style constants (frozen) at module level.
  - [ ] 1.3 Define `THEMED_DIALOG_ANIM_DURATION_MS = 180` constant exported `@internal`.
  - [ ] 1.4 Implement the component: native `<Modal transparent animationType="none">` + Reanimated `useAnimatedStyle` for fade+scale + backdrop View with 3-prop decorative a11y.
  - [ ] 1.5 Implement button layouts: 1 / 2-horizontal / 3-vertical.
  - [ ] 1.6 Per-button synchronous re-entrancy guard via `useRef<boolean>`.
  - [ ] 1.7 Backdrop-tap dismissal logic — only when `onRequestClose` provided AND no destructive button.
  - [ ] 1.8 Wrap in `React.memo`.
- [ ] **Task 2: Create `src/hooks/use-themed-dialog.ts`** (AC: B1-B2)
  - [ ] 2.1 Define `UseThemedDialogReturn` + `ThemedDialogConfig` types.
  - [ ] 2.2 `useState<{visible: boolean, config: ThemedDialogConfig | null}>` shape; `show(config)` sets both; `hide()` clears visible immediately, clears config after `THEMED_DIALOG_ANIM_DURATION_MS` via setTimeout (cleared on unmount via cleanup effect).
- [ ] **Task 3: Migrate `profile/index.tsx` sign-out flow** (AC: C1)
- [ ] **Task 4: Migrate `profile/settings.tsx` 5 flows** (AC: C2-C6)
  - [ ] 4.1 Sign-out
  - [ ] 4.2 Change current level
  - [ ] 4.3 Change target level
  - [ ] 4.4 Change daily goal
  - [ ] 4.5 Delete-account stage-1 warning
- [ ] **Task 5: Runtime tests for ThemedDialog** (AC: D1)
  - [ ] 5.1 Create `src/components/common/__tests__/themed-dialog.test.tsx` with 9-12 runtime cases per AC-D1.
- [ ] **Task 6: Runtime tests for `useThemedDialog`** (AC: D2)
  - [ ] 6.1 Create `src/hooks/__tests__/use-themed-dialog.test.tsx` with 5-7 cases per AC-D2.
- [ ] **Task 7: Source-drift tests** (AC: D3)
  - [ ] 7.1 Create `src/lib/__tests__/themed-dialog-migration-source-drift.test.ts` with 8-10 cases per AC-D3.
- [ ] **Task 8: Quality gates** (AC: Z)
  - [ ] 8.1 `npm run type-check` — 0 errors.
  - [ ] 8.2 `npm run lint` — 0 errors / 0 warnings.
  - [ ] 8.3 `npm run format:check` — pass.
  - [ ] 8.4 `npm test -- --no-coverage` — full suite + new test files pass. Spec target: **+22-29 net Jest cases** (2032 → 2054-2061).
  - [ ] 8.5 `npm run check:tokens` — Story 14-4 gate passes (no new raw tokens; the backdrop's `rgba(0,0,0,0.5)` is on the exempt-set as documented in AC-A4 inline comment).

## Operator-decision items (resolve before/during implementation)

**Q1 — Backdrop dim opacity:**

- **Recommended:** `rgba(0,0,0,0.5)` (50% black) — iOS Alert default; matches user expectation.
- **Alternates:** 0.4 (lighter, less blocking — feels more "soft modal"); 0.6 (heavier — feels more "modal interruption").
- Operator picks one for v1; future iteration can adjust per visual testing.

**Q2 — Button order on 2-button layouts:**

- **Recommended:** Cancel-LEFT, action-RIGHT (matches iOS Human Interface Guidelines; also matches `Alert.alert`'s array-order convention).
- **Alternate:** Reverse (cancel-right) — would match some Material Design conventions but is jarring for users coming from `Alert.alert` consistency.

**Q3 — Icons on dialogs:**

- **Recommended (v1):** NO icons (text-only). Adding `iconName?: IconName` would conflate visual-design decisions with icon-system extensions (Story 14-3 IconName union doesn't include `"alert-triangle"` / `"info"` / `"help-circle"`).
- **Alternate:** Add 2-3 new icons to the IconName union + `iconName?` prop — defer to `14-8-followup-add-dialog-icons` if visual testing surfaces demand.

**Q4 — Backdrop tap behavior with destructive button:**

- **Recommended:** Backdrop tap SUPPRESSED when any button has `style: "destructive"`. Force the user to make an explicit choice for irreversible actions.
- **Alternate:** Always allow backdrop tap to dismiss — risk: user fat-fingers near the dialog edge and silently dismisses a "Delete account" confirmation.

**Q5 — Multi-step dialog support:**

- **Recommended (v1):** Stage-1 warning Alert → migrate to `ThemedDialog`. Stage-2 inline confirmation (type "DELETE") stays as-is in `settings.tsx` (out of scope; the user already types in an inline TextInput within the screen, not a dialog).
- **Alternate:** Build `<ThemedDialog>` with an `inputField?` prop and a `confirmRequired?: string` validation rule (the user types the literal "DELETE" before the destructive button enables). Defer to `14-8-followup-multi-step-confirm`.

## Dev Notes

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist:** ThemedDialog has no telemetry surface (consumers handle their own errors via their `onPress` async handler). Zero new feature tags / extras keys.
- **Story 13-1 transcript render-storm fix:** `useAnimatedStyle` + `withTiming` pattern preserved; no `setState`-driven animation values.
- **Story 13-7 frozen static styles:** card + button styles MUST be module-level `Object.freeze(...) as ViewStyle` (Story 13-7 R1-P2 mutation-defense pattern); drift detector Case 9 pins this.
- **Story 14-1 chrome rule:** all dialog chrome English; `toLocaleDateString` not used (no dates in dialogs).
- **Story 14-2 ListItemCard pattern:** the dialog is NOT a `ListItemCard` consumer — it's a separate primitive (different layout intent: centered card with action buttons vs horizontal list row).
- **Story 14-3 Icon system:** v1 ships text-only dialogs (per Q3); IconName union NOT extended.
- **Story 14-4 design-token enforcement:** all colors `Colors.*`; backdrop `rgba(0,0,0,0.5)` is the only raw RGBA, documented in AC-A4 + handled by the check:tokens exempt-set (`Colors.shadow` is `#000000` so the dim derives from a token-known base).
- **Story 14-5 accent-color split:** `default` button uses `Colors.accent` (CTA-cluster — user is committing to an action). `destructive` uses `Colors.error`. No streak/progress token usage.
- **Story 14-6 Typography.ctaLabel:** the new Typography preset added in Story 14-6 (fontSize:17, fontWeight:"700", color:Colors.textOnDark) is the canonical CTA-label text style; the dialog's `default` + `destructive` buttons use it. `cancel` button overrides the `color` to `Colors.textSecondary` (transparent-bg + secondary-text).
- **Story 14-7 mock-test landing:** orthogonal — different surface.

### Pattern to follow

The CLOSEST precedent for the new component is Story 12-9's `EmailVerificationGate` (full-screen interactive component with multiple actions) — mirror its architecture for:

- `useRef`-based double-tap guards on async-onPress handlers
- `useState` + `useCallback` for action handlers
- Disabled state during in-flight operations (consumers handle this via their own state; the dialog itself is stateless)

The migration pattern (Alert.alert → useThemedDialog().show(...)) mirrors Story 14-2's inline-card → ListItemCard migration: each call site declares a hook instance + renders the component inline + invokes `show()` from the handler. Story 14-2 R1-H4 lesson applies: ensure the migrated handlers don't drop accessibility wiring (each button keeps its `accessibilityLabel`).

### References

- [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 277 — Epic 14 deliverable 14.8
- [`app/(tabs)/profile/index.tsx:82-92`](<app/(tabs)/profile/index.tsx#L82-L92>) — `handleSignOut` (migration target C1)
- [`app/(tabs)/profile/settings.tsx`](<app/(tabs)/profile/settings.tsx>) — 5 migration targets (C2-C6)
- [`src/components/common/ListItemCard.tsx`](src/components/common/ListItemCard.tsx) — Story 14-2 frozen-static-style + accessibility pattern
- [`src/components/auth/EmailVerificationGate.tsx`](src/components/auth/EmailVerificationGate.tsx) — Story 12-9 interactive component precedent
- [`src/lib/design.ts`](src/lib/design.ts) — `Colors.accent` / `Colors.error` / `Colors.textOnDark` / `Colors.textSecondary` / `Radii.card` / `Radii.button` / `Shadows.hero` / `Typography.sectionHeader` / `Typography.body` / `Typography.ctaLabel`
- Story 14-1 [`_bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md`](_bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md) — chrome/content rule
- Story 14-2 [`_bmad-output/implementation-artifacts/14-2-card-consolidation.md`](_bmad-output/implementation-artifacts/14-2-card-consolidation.md) — consolidation discipline + frozen-style pattern
- Story 14-3 [`_bmad-output/implementation-artifacts/14-3-icon-system-replacement.md`](_bmad-output/implementation-artifacts/14-3-icon-system-replacement.md) — R1-P1 cross-platform decorative a11y pattern
- Story 14-6 — `Typography.ctaLabel` introduction

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

### Completion Notes List

### File List

### Change Log
