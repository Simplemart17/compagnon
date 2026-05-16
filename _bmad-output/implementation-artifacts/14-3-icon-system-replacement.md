# Story 14.3: Icon System Replacement — pick `@expo/vector-icons` (Feather set) + replace ~33 decorative emoji with real icon components

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **non-French-speaker TCF learner navigating across iOS + Android devices with screen-readers + dark mode + accessibility scaling**,
I want **the app's "icon" affordances rendered as real vector icons (with semantic accessibility roles, consistent stroke weight, predictable sizing, and proper color theming) instead of as decorative emoji that vary by OS / font / system theme**,
so that **the product feels deliberate rather than emoji-pasted — and screen-reader users get "Mail" announced for a Mail input affordance instead of "Envelope, emoji, face-with-tears-of-joy" depending on the font fallback**.

## Background — Why This Story Exists

### What audit / roadmap owns to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 272 — Epic 14 deliverable 14.3:

> 14.3 Icon system replacement — choose SF Symbols / Material Symbols / lucide; replace decorative emoji.

The audit text is terse (one sentence). The visible problem behind it: emoji-as-icon rendering is inconsistent across iOS / Android, scales unpredictably under `accessibilityScale`, and surfaces poor accessibility semantics (screen-readers announce "envelope" or "U+2709" instead of "Email"). The pre-14-3 codebase uses **35 emoji occurrences across 16 source files** — most are decorative UI affordances that should be real icons; a 12-emoji subset is French-learning content that must stay as emoji.

### Library decision — `@expo/vector-icons` Feather set (recommended)

The roadmap suggests "SF Symbols / Material Symbols / lucide". Verified in `package-lock.json` v15.0.2+: **`@expo/vector-icons` is already a transitive dependency** via Expo SDK 55. **Zero installation cost**. The bundled Feather set covers all ~22 unique icons the migration needs (Mail / Lock / User / Mic / Headphones / BookOpen / PenTool / Volume2 / FileText / Globe / Book / Brain / CheckCircle / Check / Key / Zap / Target / MessageCircle / Award / Smile / etc).

**Why Feather over alternatives:**

- **Bundled**: `@expo/vector-icons` ships with Expo; `lucide-react-native` would add ~50KB minified install for the same coverage with no behavioral gain.
- **Stroke-weight consistency**: Feather is a single-stroke 24×24 line set — visually cohesive across the consolidated `SkillCard` / `ListItemCard` (Story 14-2) icon-circle slots.
- **RN-first**: optimized for React Native; no SVG transpilation overhead.
- **Tree-shakeable**: only used icons bundle.
- **Accessibility**: each `<Feather name="..." />` accepts `accessibilityLabel` natively + sets `accessibilityRole="image"` by default.

**Operator decision** (Q1 in AC #11): confirm `@expo/vector-icons` Feather set, or override (e.g., `lucide-react-native` if Feather aesthetic doesn't match a future design system decision).

### Scope rule — chrome icons vs learning content

Following Story 14-1's chrome-vs-content split discipline:

- **CHROME / SKILL / STATUS / DECORATION emoji (REPLACE)** — emoji used as UI affordance (Mail icon on email input, Mic icon on conversation CTA, Headphones icon on Listening skill card). These are operator-facing UI hints; they should be real icons with proper a11y semantics.
- **LEARNING CONTENT emoji (PRESERVE)** — the 12 `TOPIC_EMOJIS` entries on the conversation screen (`☕` for "Commander au café", `✈️` for "Parler de ses voyages", etc.) + the onboarding goal-selection emoji are PART of the French learning content. The user is learning to discuss those topics; the emoji visually anchors the topic. Replace would degrade the learning surface.

### Inventory — 35 emoji occurrences, 22 unique icons

**CHROME affordances (8 usages — REPLACE):**

| File | Line | Emoji | Replacement |
| --- | --- | --- | --- |
| `app/(tabs)/home/index.tsx` | ~108 | `🎤` mic | `Feather.Mic` |
| `app/(tabs)/conversation/index.tsx` | 15 | `💬` chat | `Feather.MessageCircle` |
| `app/(auth)/login.tsx` | 166 | `✉️` mail | `Feather.Mail` |
| `app/(auth)/login.tsx` | 194 | `🔒` lock | `Feather.Lock` |
| `app/(auth)/signup.tsx` | 228 | `👤` user | `Feather.User` |
| `app/(auth)/signup.tsx` | 255 | `✉️` mail | `Feather.Mail` |
| `app/(auth)/signup.tsx` | 286 | `🔒` lock | `Feather.Lock` |
| `app/(auth)/forgot-password.tsx` | 173 | `✉️` mail | `Feather.Mail` |

**SKILL / SECTION decoration (16 usages — REPLACE):**

| File | Line | Emoji | Replacement |
| --- | --- | --- | --- |
| `app/(tabs)/mock-test/index.tsx` | 137, 146 | `🎧` `📖` | `Feather.Headphones` / `Feather.BookOpen` |
| `app/(tabs)/mock-test/results.tsx` | 31, 32, 34 | `🎧` `📖` `🧠` | `Feather.Headphones` / `Feather.BookOpen` / `Feather.Activity` (brain — see conflict note below) |
| `app/(tabs)/practice/index.tsx` | 40-82 | `🎧 📖 ✍️ 🧠 🗣️ 📝 🗣️ 🌐` (8 skill icons) | `Headphones` / `BookOpen` / `Edit3` / `Activity` / `Mic` / `FileText` / `Repeat` / `Globe` |
| `app/(tabs)/practice/index.tsx` | 140 | `📚` | `Feather.Book` |
| `app/(tabs)/practice/vocabulary.tsx` | 383 | `📚` | `Feather.Book` |
| `src/hooks/use-daily-briefing.ts` | 179, 218, 219, 244 | `📚` `💬` `📝` `💬` | `Book` / `MessageCircle` / `Edit3` / `MessageCircle` |

**STATUS feedback (4 usages — REPLACE):**

| File | Line | Emoji | Replacement |
| --- | --- | --- | --- |
| `app/(tabs)/practice/vocabulary.tsx` | 446 | `🎉` celebration | `Feather.Award` |
| `app/(tabs)/practice/vocabulary.tsx` | 469 | `✅` success | `Feather.CheckCircle` |
| `app/(tabs)/conversation/[sessionId].tsx` | ~900 | `✓` check | `Feather.Check` |
| `src/components/auth/PasswordStrengthIndicator.tsx` | 164 | `✓` check | `Feather.Check` |
| `src/hooks/use-daily-briefing.ts` | 200 | `🎯` target | `Feather.Target` |

**DECORATION (3 usages — OPERATOR DECISION, Q3 + Q4):**

| File | Line | Emoji | Recommendation |
| --- | --- | --- | --- |
| `app/(auth)/forgot-password.tsx` | 127 | `🔑` key (hero) | Q4: replace with `Feather.Key` for visual consistency with auth affordance icons OR keep as decorative hero. Recommended: **REPLACE** (icon system consistency on auth surfaces). |
| `app/(tabs)/profile/index.tsx` | ~223 | `🔥` streak fire | Q3: replace with `Feather.Zap` (lightning) OR keep as gamification flourish. Recommended: **REPLACE** for visual cohesion; the streak meaning is carried by the surrounding "{N} day streak" copy. |
| various | various | settings gear `⚙️` | If present, replace with `Feather.Settings`. |

**LEARNING CONTENT (12 usages — PRESERVE):**

- `app/(tabs)/conversation/index.tsx` `TOPIC_EMOJIS` (lines 25-38): 12 conversation topic emojis — `👋 ☕ 🗺️ 👨‍👩‍👧 🏥 📅 💼 ✈️ 📰 🎬 🍷 🧠`. These are French-learning content (each topic the user discusses). Per Story 14-1 chrome/content rule: PRESERVE.
- `app/onboarding/index.tsx` goal-selection emoji: `🎯 🏆 ✈️ 💼 🎓 🗣️` — user-facing content (learning goals). PRESERVE.

**Conflict to call out** (Q5 in AC #11): the emoji `🧠` is used BOTH as the Grammar / Brain chrome icon (3 sites in practice/mock-test) AND as the Philosophy topic content emoji (`Philosophie et société` in `TOPIC_EMOJIS`). After replacement, the chrome site renders as `<Feather name="activity" />` (the closest Feather equivalent — Feather doesn't have a Brain glyph; see Q5 below for alternatives), and the topic emoji stays as `🧠` in `TOPIC_EMOJIS`. No collision because they render through different code paths.

### Architectural pattern — centralised icon map

Following Story 14-2's pattern of consolidating shared chrome under a single source-of-truth component, Story 14-3 introduces ONE new module:

- **NEW `src/components/common/Icon.tsx`** (~80 lines) — a thin wrapper around `@expo/vector-icons.Feather` that:
  - Exports `Icon` component with strictly-typed `name: IconName` prop (no string-typo risk), `size?: number` (defaults to 24), `color?: string` (defaults to `Colors.textPrimary`), `accessibilityLabel?: string`.
  - Exports the `IconName` union type listing all icons used in the app (compile-time enforcement that new consumers can't reference an icon outside the migrated set).
  - **Why a wrapper, not raw `<Feather />`?** Centralises the icon-set choice (Q1 operator decision). If a future story swaps Feather → lucide-react-native, the change is 1 file, not 33 consumer sites. Mirrors Story 14-2's `SkillCard` + `ListItemCard` consolidation discipline.
  - **Why a typed `IconName` union?** Catches `<Icon name="mial" />` typos at compile time. Without the union, `<Feather name="mial" />` would just render a missing-glyph placeholder at runtime.

```typescript
// Example structure
import React from "react";
import { Feather } from "@expo/vector-icons";
import { Colors } from "@/src/lib/design";

// Comprehensive union covering every icon in the migrated set.
// Adding a new icon usage requires extending this union FIRST —
// compile-time gate that prevents string-typo regressions.
export type IconName =
  | "mail"
  | "lock"
  | "user"
  | "mic"
  | "headphones"
  | "book-open"
  | "edit-3"
  | "activity" // grammar chrome — Feather lacks Brain, see Q5
  | "volume-2"
  | "file-text"
  | "repeat"
  | "globe"
  | "book"
  | "check"
  | "check-circle"
  | "key"
  | "zap" // streak chrome — Feather Flame is FontAwesome only
  | "target"
  | "message-circle"
  | "award"
  | "smile"
  | "settings";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}

export const Icon = React.memo(function Icon({
  name,
  size = 24,
  color = Colors.textPrimary,
  accessibilityLabel,
}: IconProps) {
  return <Feather name={name} size={size} color={color} accessibilityLabel={accessibilityLabel} />;
});
```

### What 14-3's deliverable looks like

**1. NEW `src/components/common/Icon.tsx`** (~80 lines incl. JSDoc) per the example above.

**2. ~33 emoji-to-icon replacements** across ~16 source files. Each replacement:
   - Before: `<Text style={{ fontSize: 24 }}>{"✉️"}</Text>` or inline `✉️`
   - After: `<Icon name="mail" size={24} color={Colors.primary} />`
   - For decorative emoji at the top of a hero (e.g., `🔑` on forgot-password at 52px): `<Icon name="key" size={52} color={Colors.accent} />`

**3. NEW source-drift detector test** at `src/components/common/__tests__/icon-replacement-source-drift.test.ts` (~12 cases):
   - POSITIVE per-screen pin: `<Icon name="..." />` invocation present where the chrome emoji used to be.
   - NEGATIVE per-screen pin: the legacy emoji literal / escape sequence is GONE from chrome contexts.
   - POSITIVE / NEGATIVE pin for `TOPIC_EMOJIS` PRESERVED (content boundary defense — Story 14-1 R1-style false-positive risk: the regex must NOT flag content emoji).
   - POSITIVE pin for `Icon.tsx` exports + `IconName` union completeness.
   - Uses Story 12-2 P12 comment-stripped reading + Story 13-7 R1-P4 scoped element extraction.

**4. NEW runtime smoke test** at `src/components/common/__tests__/icon.test.tsx` (~5 cases):
   - Renders Feather icon when `name` provided.
   - Respects `size` + `color` props.
   - Passes through `accessibilityLabel`.
   - Defaults: size = 24, color = `Colors.textPrimary`.
   - Compile-time invariant — `IconName` union excludes unrecognized strings (TypeScript-level; verified via `// @ts-expect-error` annotation in test).

**5. CONDITIONAL — `Icon.tsx` accessibility default**: when `accessibilityLabel` is omitted, set `importantForAccessibility="no"` so screen-readers treat the icon as decorative-of-text instead of announcing the icon name as a separate element. Consumers that need the icon announced provide their own `accessibilityLabel`.

### Why this is a MEDIUM story (load-bearing scope discipline)

Following Stories 13-4 / 13-7 / 14-2 — "consolidate via a thin wrapper, migrate consumer sites mechanically, drift-pin everything":

- **1 new component file** (`Icon.tsx` ~80 lines).
- **~16 source files modified** for the emoji-to-icon replacements.
- **2 new test files** (drift + runtime smoke).
- **0 new packages** (using already-transitive `@expo/vector-icons`).
- **0 migrations / Edge Function changes / CI workflow changes / logic changes** — `package.json` + `supabase/` + `.github/workflows/` + every `src/lib/*.ts` (except inline emoji edits in `use-daily-briefing.ts`) zero-diff.
- **Net diff**: ~+400 lines (Icon component + tests + import lines on 16 files) − ~200 lines (emoji `<Text>` wrappers replaced with `<Icon>` 1-liners) = net **+200 LOC** (mostly tests + new component).

### Why CONTENT emoji stay (chrome/content rule from Story 14-1)

The 12 `TOPIC_EMOJIS` entries (and the 6 onboarding goal emojis) ARE part of the learning surface — the user is learning to discuss those topics; the emoji is a visual anchor for the FR topic name. Replacing the topic emoji `☕` for "Commander au café" with `<Icon name="coffee" />` would:

1. Lose the warm visual personality of the learning surface (chrome-icon Feather strokes are cold by design).
2. Need a duplicate icon-mapping table mirroring `TOPIC_EMOJIS` shape — no benefit.
3. Violate the chrome/content boundary established by Story 14-1.

The drift detector's POSITIVE-pin against `TOPIC_EMOJIS` constant declaration + onboarding goal emoji presence is the load-bearing guard against future "let's clean up all emoji" passes that would erode the content boundary.

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist + GDPR scrubber** — zero-diff.
- **Story 9-4 stored-prompt-injection** — N/A (no AI / no prompts).
- **Story 11-1 tool-call protocol** — N/A.
- **Story 11-2 reconnect + barge-in** — N/A.
- **Story 12-1 RealtimeOrchestrator** — orthogonal.
- **Story 12-6 transcript cap** — orthogonal.
- **Story 13-1 transcript render-storm fix** — orthogonal (TranscriptView untouched; speaker labels are text not icons).
- **Story 13-7 frozen-static-style pattern** — N/A here; `Icon.tsx` doesn't need a frozen container style (it's a thin wrapper around Feather which has its own native rendering).
- **Story 14-1 chrome rule** — preserved by construction (chrome icons get real icons; content emoji preserved verbatim).
- **Story 14-2 SkillCard + ListItemCard `iconEmoji` prop API** — preserved as the consumer API; the SkillCard + ListItemCard components render whatever is passed to `iconEmoji`. Consumer sites that previously passed an emoji literal will now pass... still an emoji string? OR call sites switch to a NEW `<Icon ... />` JSX slot? **Operator-decision item Q2 in AC #11** — recommended path: extend `SkillCard` + `ListItemCard` with a NEW optional `iconNode?: React.ReactNode` slot, so consumers pass `<Icon name="headphones" />` JSX directly. The legacy `iconEmoji` prop stays for the 12 conversation topic cards (content emoji preserved). This is **2 new optional props on 2 components**, not a breaking change.

### Footguns to avoid (from prior story retros)

- **Story 14-2 R1 H1 lesson** — accessibility regression on consolidated state. The new `Icon` component MUST set `accessibilityLabel` correctly: when used as decorative-of-text (alongside a Text label), set `importantForAccessibility="no"`; when used standalone (e.g., a button-only icon), require the consumer to pass `accessibilityLabel`. Don't repeat the H1 mistake of inheriting wrong a11y semantics.
- **Story 13-7 R1-P4 scoped-element-extraction** — drift detector regexes must scope to specific JSX elements via `extractOpeningTag` walker, not file-wide `[\s\S]*?` searches. The emoji-replacement drift detector needs per-screen anchoring (each `<Icon name="mail" />` invocation lives in a specific consumer site).
- **Story 14-1 R1-H2 content-vs-chrome confusion** — the drift detector's NEGATIVE-pin against emoji literals MUST exclude content emoji (TOPIC_EMOJIS object keys + onboarding goal emoji + AI-generated transcript content). Define a narrow "chrome emoji" character set (Mail / Lock / etc) and only assert against those.
- **Story 14-2 R1 M7 lesson** — `COMMENT_STRIP_RE` brace-exclusion `[^{}]*?` for JSX comments (NOT `[\s\S]*?`). The new drift detector reuses this exact pattern.
- **Story 13-4 R1 noise-reduction** — DO NOT replace content emoji even if a reviewer "noticed" they could be icons. The chrome/content boundary is the spec; defend it.
- **`Feather` doesn't have a Brain glyph** (Q5 in AC #11) — the closest semantic match is `Feather.Activity` (an EKG-like icon) OR switching to `MaterialIcons.Psychology` (full pictogram). Operator decides; both are imported from `@expo/vector-icons`.
- **`Feather` doesn't have a `Flame` glyph** (Q3) — closest is `Feather.Zap` (lightning bolt). The streak chrome emoji `🔥` was warmth-based; `Zap` is energy-based. Acceptable visual shift; documented for operator.

### What 14-3 does NOT do

- **NO new package install** (uses already-transitive `@expo/vector-icons`).
- **NO replacement of content emoji** (`TOPIC_EMOJIS` + onboarding goal emoji + any AI-generated emoji in transcripts / corrections).
- **NO migration of Story 13-7 frozen-static-style pattern to Icon.tsx** — Icon is a thin wrapper around Feather (which has its own native rendering); no per-frame `className`+`style` merge cost to consolidate.
- **NO replacement of static decorative branding** like the `Companion` brand-name flourish (not an icon).
- **NO migration of `app/(tabs)/profile/settings.tsx` or other settings screens to icons** (those are list rows with text, not icon-driven).
- **NO accessibility audit beyond the icon a11y contract** — Story 14-4 + 14-9 territory.
- **NO color theming pass** — icons take `Colors.*` values consumed verbatim from existing call-site choices.

### Example of an in-place replacement (for the dev's mental model)

Before — `app/(auth)/login.tsx:166`:

```tsx
<View className="flex-row items-center bg-white rounded-[14px] py-4 px-4" style={{...}}>
  <Text className="text-base mr-[10px]" style={{ opacity: emailFocused ? 1 : 0.4 }}>
    ✉️
  </Text>
  <TextInput placeholder="Email address" ... />
</View>
```

After:

```tsx
<View className="flex-row items-center bg-white rounded-[14px] py-4 px-4" style={{...}}>
  <View style={{ marginRight: 10, opacity: emailFocused ? 1 : 0.4 }}>
    <Icon name="mail" size={18} color={Colors.textTertiary} />
  </View>
  <TextInput placeholder="Email address" ... />
</View>
```

The `<Text>` wrapper is dropped (was just an emoji-glyph carrier); replaced with `<Icon>` inside a layout `<View>` that preserves the `marginRight: 10` + opacity-on-focus behavior. The screen-reader experience improves: pre-14-3 announced "envelope" or "U+2709"; post-14-3 announces nothing extra (icon is decorative-of-text per the TextInput's own `accessibilityLabel`).

## Acceptance Criteria

1. **NEW component [`src/components/common/Icon.tsx`](src/components/common/Icon.tsx)** (~80 lines incl. JSDoc) with the structure in the Background section. Exports `Icon` (React.memo'd) + `IconProps` + `IconName` union. Wraps `@expo/vector-icons.Feather` (or whichever set Q1 chooses). Defaults: `size = 24`, `color = Colors.textPrimary`. When `accessibilityLabel` is omitted, sets `importantForAccessibility="no"` so the icon is decorative-of-text by default.

2. **EXTEND [`src/components/common/SkillCard.tsx`](src/components/common/SkillCard.tsx) + [`src/components/common/ListItemCard.tsx`](src/components/common/ListItemCard.tsx) with optional `iconNode?: React.ReactNode` slot** that overrides the existing `iconEmoji` rendering. Consumers can pass `<Icon name="headphones" />` JSX directly; the legacy `iconEmoji` prop stays for the 12 conversation topic cards (content emoji preserved per chrome/content rule).

3. **All 8 CHROME emoji REPLACED** with `<Icon name="..." />` per the inventory table. Specifically:
   - `home/index.tsx` ConversationCard `🎤` → `Icon name="mic"`.
   - `conversation/index.tsx` CONVERSATION_MODES default `💬` → `Icon name="message-circle"`.
   - `login.tsx` email `✉️` + password `🔒` → `Icon name="mail"` / `Icon name="lock"`.
   - `signup.tsx` name `👤` + email `✉️` + password `🔒` → `Icon name="user"` / `Icon name="mail"` / `Icon name="lock"`.
   - `forgot-password.tsx` email `✉️` → `Icon name="mail"`.

4. **All 16 SKILL / SECTION decoration emoji REPLACED**:
   - `mock-test/index.tsx` listening / reading section markers.
   - `mock-test/results.tsx` SECTION_LABELS emoji (3 entries).
   - `practice/index.tsx` PRACTICE_SKILLS emoji (8 entries).
   - `practice/index.tsx` Vocabulary featured card `📚`.
   - `practice/vocabulary.tsx` hero `📚`.
   - `use-daily-briefing.ts` skill icon strings (4 entries).
   - SkillCard + ListItemCard consumer sites: pass `iconNode={<Icon name="..." />}` (extends AC #2).

5. **All 4 STATUS feedback emoji REPLACED**:
   - `practice/vocabulary.tsx` `🎉` celebration → `Icon name="award"`; `✅` success → `Icon name="check-circle"`.
   - `conversation/[sessionId].tsx` `✓` → `Icon name="check"`.
   - `PasswordStrengthIndicator.tsx` `✓` → `Icon name="check"`.
   - `use-daily-briefing.ts` `🎯` → `Icon name="target"`.

6. **DECORATION emoji per operator decisions (Q3 + Q4)** — if convert, swap to recommended Feather equivalents (`🔥` → `Icon name="zap"`; `🔑` → `Icon name="key"`).

7. **LEARNING CONTENT emoji PRESERVED**:
   - `app/(tabs)/conversation/index.tsx` `TOPIC_EMOJIS` constant — all 12 entries zero-diff.
   - `app/onboarding/index.tsx` goal-selection emoji — zero-diff per Q2 (operator decision; recommended: preserve as content).
   - Drift detector POSITIVE-pin confirms `TOPIC_EMOJIS` constant declaration is unchanged.

8. **5 operator-decision items in AC #11 are explicitly resolved** before merge. See AC #11 for question shape. Dev's Completion Notes record each operator's chosen answer + rationale.

9. **NEW source-drift detector test** at [`src/components/common/__tests__/icon-replacement-source-drift.test.ts`](src/components/common/__tests__/icon-replacement-source-drift.test.ts) (~12 cases):
   - POSITIVE per-screen pin: `<Icon name="..." />` JSX present.
   - NEGATIVE per-screen pin: the legacy emoji literal is GONE from chrome contexts (anchored on `<Text style=...>EMOJI</Text>` pattern where the emoji is decorative-of-text, NOT on bare emoji that could be content).
   - POSITIVE pin: `TOPIC_EMOJIS` constant declaration unchanged in `conversation/index.tsx`.
   - POSITIVE pin: `Icon.tsx` exports `Icon` + `IconName` + a minimum-N IconName union members.
   - Uses Story 12-2 P12 comment-stripped read + Story 13-7 R1-P4 scoped extraction + Story 14-2 R1-M7 JSX-brace-exclusion comment-strip.

10. **NEW runtime smoke test** at [`src/components/common/__tests__/icon.test.tsx`](src/components/common/__tests__/icon.test.tsx) (~5 cases via react-test-renderer + shared test utilities):
    - Renders Feather component when `name` provided.
    - Respects `size` + `color` props.
    - Passes through `accessibilityLabel`.
    - Defaults (size = 24, color = `Colors.textPrimary`) applied when not provided.
    - When `accessibilityLabel` omitted, sets `importantForAccessibility="no"`.

11. **5 operator-decision items**:
    - **Q1 — Icon library**. Recommended: `@expo/vector-icons` Feather set (already transitive — zero install cost). Alternative: `lucide-react-native` (~50KB install for similar coverage, slightly more modern aesthetic). Operator picks.
    - **Q2 — Onboarding goal-selection emoji** (`🎯 🏆 ✈️ 💼 🎓 🗣️`). Recommended: PRESERVE as content (the user is choosing their learning goal; emoji adds personality to the onboarding surface). Alternative: REPLACE with Feather icons for consistency. Operator picks.
    - **Q3 — Profile streak `🔥` flame**. Recommended: REPLACE with `Icon name="zap"` for visual cohesion with the new icon set. Note the visual semantic shift (warmth → energy). Alternative: KEEP as gamification flourish. Operator picks.
    - **Q4 — Forgot-password hero `🔑` key**. Recommended: REPLACE with `Icon name="key"` at 52px for auth-surface consistency. Alternative: KEEP as decorative hero (emoji works better at 52px display size than line-icon strokes do). Operator picks.
    - **Q5 — `🧠` Brain chrome icon replacement** (Grammar skill, 3 sites). `Feather` doesn't have a Brain glyph. Recommended: `Icon name="activity"` (EKG-like, semantic-adjacent). Alternative: switch this 1 icon to `MaterialIcons.Psychology` (also bundled in `@expo/vector-icons` — full pictogram). Operator picks; if picking MaterialIcons, the `Icon` component needs a `set?: "Feather" | "MaterialIcons"` prop OR a separate `MaterialIcon` component.

### Y. GitHub Actions Injection Vector Check

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — `Icon` defaults `color = Colors.textPrimary`; consumer call sites pass `Colors.primary` / `Colors.accent` / etc.
- [ ] All loading states use skeleton animations — N/A (icons are static).
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` — N/A for the Icon itself (decorative-of-text by default); enclosing Pressable / TextInput handles a11y.
- [ ] Non-obvious interactions have `accessibilityHint` — N/A.
- [ ] Stateful elements have `accessibilityState` — N/A.
- [ ] All tappable elements have minimum 44x44pt touch targets — N/A (icons are not tappable directly; tap target is the enclosing Pressable / TextInput).
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no new catch blocks).
- [ ] All text uses `Typography.*` presets — N/A (Icon is not text).
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test` — AC #12.

12. **All 4 quality gates green**: `tsc` 0 errors / `lint` 0 warnings / `prettier --check` clean / `jest` baseline + ~17 new cases. Current baseline 1917 → ≥ 1932 (spec target +12-18 net Jest cases: ~12 drift + ~5 runtime smoke).

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9: verify this story file is visible to git but not silently ignored.
-->

- [x] `git status` lists this story file under "Untracked files" — verified: `git status --short` returns `?? _bmad-output/implementation-artifacts/14-3-icon-system-replacement.md`; `git check-ignore -v` returns exit code 1 (no ignore rule matches).
- [x] `npx prettier --check _bmad-output/implementation-artifacts/14-3-icon-system-replacement.md` passes — verified: "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1: Branch from `origin/main` after 14-2 PR #102 merge** (`feedback_branch_from_main` memory).
  - [x] Subtask 1.1: Verify PR #102 merged. If not, branch from `origin/main` anyway — 14-2 + 14-3 file scopes mostly disjoint (14-2 touched card components; 14-3 touches inline emoji renders).
  - [x] Subtask 1.2: `git checkout main && git pull origin main && git checkout -b feature/14-3-icon-system-replacement`.

- [x] **Task 2: Resolve the 5 operator-decision items (AC #11) BEFORE source edits.**
  - [x] Subtask 2.1: Ask the operator Q1-Q5 with recommendations from AC #11. Record answers + rationale in Completion Notes.
  - [x] Subtask 2.2: If Q5 picks MaterialIcons.Psychology, extend `Icon` component with a `set?: "Feather" | "MaterialIcons"` prop OR create a separate `MaterialIcon` component.

- [x] **Task 3: Create the new `Icon` component** (AC #1).
  - [x] Subtask 3.1: Create [`src/components/common/Icon.tsx`](src/components/common/Icon.tsx) per the Background example. Module-level component wrapped in `React.memo`.
  - [x] Subtask 3.2: Define `IconName` union with all ~22 icons from the inventory (Q5 conditional Brain replacement).
  - [x] Subtask 3.3: Implement `accessibilityLabel` default behavior: when omitted, set `importantForAccessibility="no"`; when provided, pass through.
  - [x] Subtask 3.4: Default `size = 24`, `color = Colors.textPrimary`.

- [x] **Task 4: Extend `SkillCard` + `ListItemCard` with `iconNode?: React.ReactNode` slot** (AC #2).
  - [x] Subtask 4.1: Add `iconNode?: React.ReactNode` to `SkillCardProps` + `ListItemCardProps`.
  - [x] Subtask 4.2: In both components, render conditional: when `iconNode` provided, render it inside the existing icon-circle slot in place of the emoji `<Text>` element.
  - [x] Subtask 4.3: Preserve `iconEmoji` rendering for consumers that still pass it (12 conversation topic cards).

- [x] **Task 5: Replace 8 CHROME emoji** (AC #3).
  - [x] Subtask 5.1: `home/index.tsx` ConversationCard `🎤`.
  - [x] Subtask 5.2: `conversation/index.tsx` CONVERSATION_MODES default emoji.
  - [x] Subtask 5.3: `login.tsx` mail + lock.
  - [x] Subtask 5.4: `signup.tsx` user + mail + lock.
  - [x] Subtask 5.5: `forgot-password.tsx` mail.

- [x] **Task 6: Replace 16 SKILL / SECTION emoji** (AC #4).
  - [x] Subtask 6.1: `mock-test/index.tsx` (listening + reading section markers).
  - [x] Subtask 6.2: `mock-test/results.tsx` SECTION_LABELS (3 entries — extends Story 14-1 mock-test results changes).
  - [x] Subtask 6.3: `practice/index.tsx` PRACTICE_SKILLS array (8 entries — note interaction with SkillCard `iconNode` extension).
  - [x] Subtask 6.4: `practice/index.tsx` + `practice/vocabulary.tsx` Vocabulary `📚` (2 sites).
  - [x] Subtask 6.5: `use-daily-briefing.ts` skill icon strings (4 sites — note these are STRING constants consumed by `TodayPlanItem` via the `iconEmoji` prop; need a small refactor — see Task 4).

- [x] **Task 7: Replace 4 STATUS emoji** (AC #5).
  - [x] Subtask 7.1: `practice/vocabulary.tsx` `🎉` + `✅`.
  - [x] Subtask 7.2: `conversation/[sessionId].tsx` `✓`.
  - [x] Subtask 7.3: `PasswordStrengthIndicator.tsx` `✓`.
  - [x] Subtask 7.4: `use-daily-briefing.ts` `🎯`.

- [x] **Task 8: Resolve DECORATION emoji per Q3 + Q4** (AC #6).
  - [x] Subtask 8.1: `profile/index.tsx` `🔥` per Q3.
  - [x] Subtask 8.2: `forgot-password.tsx` `🔑` per Q4.

- [x] **Task 9: Verify CONTENT emoji preserved** (AC #7).
  - [x] Subtask 9.1: `conversation/index.tsx` `TOPIC_EMOJIS` constant zero-diff.
  - [x] Subtask 9.2: `onboarding/index.tsx` goal emoji zero-diff (or per Q2).

- [x] **Task 10: Write source-drift detector test** (AC #9).
  - [x] Subtask 10.1: Create [`src/components/common/__tests__/icon-replacement-source-drift.test.ts`](src/components/common/__tests__/icon-replacement-source-drift.test.ts) with ~12 cases.
  - [x] Subtask 10.2: Reuse Story 14-2 R1-M7 `COMMENT_STRIP_RE` with `[^{}]*?` JSX-brace exclusion.
  - [x] Subtask 10.3: Per-screen POSITIVE pin: `<Icon name="..." />` invocation present.
  - [x] Subtask 10.4: Per-screen NEGATIVE pin: legacy emoji literal anchored to chrome-context (e.g., `<Text style={...}>{"✉️"}</Text>` pattern) GONE.
  - [x] Subtask 10.5: POSITIVE pin: `TOPIC_EMOJIS` constant declaration zero-diff in `conversation/index.tsx`.
  - [x] Subtask 10.6: POSITIVE pin: `Icon.tsx` exports `Icon` + `IconName` + ≥ 20 IconName members.

- [x] **Task 11: Write runtime smoke test** (AC #10).
  - [x] Subtask 11.1: Create [`src/components/common/__tests__/icon.test.tsx`](src/components/common/__tests__/icon.test.tsx) with ~5 cases per AC #10.
  - [x] Subtask 11.2: Use shared `react-test-renderer` test utilities (Epic 13 retro AI #7).

- [x] **Task 12: Run all 4 quality gates green** (AC #12). Target: 1917 → ≥ 1932 (+12-18 net Jest cases).

- [x] **Task 13: Append the Story 14-3 architecture paragraph to CLAUDE.md.**
  - [x] Subtask 13.1: After the Story 14-2 review-round-1 entry. Document: library choice (Q1) + the 33 replacements + the 12 content-emoji preservations + the `Icon` component centralisation pattern + the operator-decision answers + the drift detector + the explicit non-scope.

- [x] **Task 14: Flip sprint-status.yaml 14-3 status.** `ready-for-dev` → `in-progress` → `review`. Annotate `last_updated`.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory (2026-05-13): every new story branches from `origin/main`; do NOT stack on the prior branch's in-flight work. PR #102 (Story 14-2) likely merged; branch off `origin/main` directly. File scopes mostly disjoint (14-2 touched card components; 14-3 touches inline emoji renders); conflicts would be limited to `SkillCard.tsx` + `ListItemCard.tsx` (both touched again here for `iconNode` prop extension) — resolve via `git pull --rebase origin main`.

### Project conventions to follow

- **`Icon` component IS the icon-set choice** (Q1 operator decision). Consumers never reference `Feather` / `MaterialIcons` directly — they import `Icon` from `@/src/components/common/Icon`. If Q1 swaps to `lucide-react-native`, the change is 1 file.
- **`IconName` union** is the compile-time gate against icon-name typos. New consumer needs a new icon? Extend the union FIRST (drift detector pins ≥ 20 members so removing one breaks CI).
- **Icon defaults to decorative** (`importantForAccessibility="no"` when `accessibilityLabel` not provided). Consumers that need the icon announced must opt-in.
- **Content emoji STAY** — drift detector POSITIVE-pin against `TOPIC_EMOJIS` declaration + onboarding goal emoji is the load-bearing guard against over-zealous future cleanup passes.
- **Q5 (Brain icon)** — `Feather` lacks Brain. Recommended `activity` (semantic-adjacent EKG icon). If operator prefers MaterialIcons.Psychology (full pictogram), extend `Icon` with a `set?` prop OR create separate `MaterialIcon` component.

### Pattern: emoji-to-icon-with-drift-pin

For each replacement:

1. Read the inline emoji + surrounding JSX (e.g., `<Text style={{...}}>{"✉️"}</Text>`).
2. Map to the IconName per the inventory table.
3. Replace with `<Icon name="mail" size={...} color={...} />` inside the layout `<View>` that preserves the existing margin / opacity behavior.
4. Add to the drift detector: POSITIVE per-screen pin (`<Icon name="mail"` present) + NEGATIVE per-screen pin (legacy emoji literal gone from chrome context).
5. Verify `<Text>` wrapper is dropped (was just an emoji carrier) — `<Icon>` is its own component.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist: zero-diff (no telemetry surface).
- Story 13-7 frozen-static-style: N/A (Icon is a thin wrapper around Feather; no per-frame className+style merge).
- Story 14-1 chrome rule: preserved — content emoji (TOPIC_EMOJIS + onboarding goals) stay; chrome emoji replaced with real icons.
- Story 14-2 SkillCard + ListItemCard: `iconEmoji` prop preserved for content emoji; NEW `iconNode` prop added for chrome icons. No breaking change.

### Project Structure Notes

- **Files added (3):** `src/components/common/Icon.tsx` + 2 new test files at `src/components/common/__tests__/`.
- **Files modified (~16-18):**
  - `src/components/common/SkillCard.tsx` (+ `iconNode` prop).
  - `src/components/common/ListItemCard.tsx` (+ `iconNode` prop).
  - `app/(tabs)/home/index.tsx` (ConversationCard mic).
  - `app/(tabs)/conversation/index.tsx` (CONVERSATION_MODES default emoji — content TOPIC_EMOJIS preserved).
  - `app/(tabs)/practice/index.tsx` (PRACTICE_SKILLS + VocabularyCard).
  - `app/(tabs)/practice/vocabulary.tsx` (hero + status emoji).
  - `app/(tabs)/mock-test/index.tsx` (section markers).
  - `app/(tabs)/mock-test/results.tsx` (SECTION_LABELS).
  - `app/(tabs)/conversation/[sessionId].tsx` (status check).
  - `app/(tabs)/profile/index.tsx` (streak per Q3).
  - `app/(auth)/login.tsx` (mail + lock).
  - `app/(auth)/signup.tsx` (user + mail + lock).
  - `app/(auth)/forgot-password.tsx` (mail + hero per Q4).
  - `src/components/auth/PasswordStrengthIndicator.tsx` (check).
  - `src/hooks/use-daily-briefing.ts` (5 emoji string constants — see Task 6 + Task 7).
  - `src/components/home/TodayPlanItem.tsx` (consumes `iconEmoji` from `use-daily-briefing.ts` — if briefing returns Icon JSX strings, TodayPlanItem needs to accept `iconNode` OR continue rendering emoji from string).
- **Housekeeping (3):** `CLAUDE.md` + `sprint-status.yaml` + this story file.

### Estimated test budget

Spec target: **+12-18 net Jest cases** (baseline 1917 → 1929-1935). Breakdown:

- ~12 drift detector cases (per-screen POSITIVE+NEGATIVE + Icon.tsx structure + TOPIC_EMOJIS preservation).
- ~5 runtime smoke cases (Icon props + defaults + accessibility behavior).

### Expected impact (architectural proxy)

- Visual consistency on icons across 16 screens: subjectively uniform stroke weight + sizing + theming.
- Per-icon a11y semantics: screen-reader announces nothing for decorative-of-text icons; consumer-provided `accessibilityLabel` when needed.
- Icon-set choice centralised in 1 file (`Icon.tsx`): future library swap is 1-file change, not 33-site change.
- Compile-time safety: `IconName` union catches `<Icon name="mial" />` typos at `tsc` time.
- Bundle size: tree-shaken `@expo/vector-icons` (already transitive); ~22 icons × ~1KB each = ~22KB added to bundle (negligible).

### NativeWind / Reanimated / etc.

- **NativeWind**: `Icon.tsx` does NOT use `className`. Pure `<Feather ... />` wrapper with `style`-driven sizing if needed. Consumer-side layout containers may use `className`.
- **Reanimated**: N/A (icons are static; no entry animation).
- **`React.memo`** wraps the `Icon` component (consistent with `SkillCard` + `ListItemCard` + `Bubble`).

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 272 (deliverable 14.3).
- Story 14-1 — chrome/content rule (TOPIC_EMOJIS preserved as content; chrome emoji replaced).
- Story 14-2 — SkillCard + ListItemCard `iconEmoji` prop API extended with NEW `iconNode` slot.
- Story 14-2 R1-M7 — `COMMENT_STRIP_RE` JSX-brace exclusion lesson; reused in drift detector.
- Story 13-7 R1-P4 — scoped element extraction pattern; reused in drift detector.
- Story 12-2 P12 — comment-stripped source-on-disk read pattern.
- Story 13-2 P11 — paired NEGATIVE + POSITIVE pin discipline.
- Epic 13 retro AI #7 — shared `react-test-renderer` test utilities (consumed by runtime smoke test).
- `@expo/vector-icons` Feather icon catalog: https://icons.expo.fyi/Feather (operator reference for the IconName union).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- 2026-05-16: Implementation complete on `feature/14-3-icon-system-replacement` (branched from `origin/main` post-14-2 PR #102 merge per `feedback_branch_from_main` memory).
- Self-applied recommended Q1-Q5 answers per session "make the reasonable call and continue" policy. See Completion Notes for resolutions.
- Initial Icon runtime test failed because `findAllNodes(name === string)` matched BOTH the outer Icon component node AND the inner Feather mock. Fixed by tightening predicate to require BOTH `name: string` AND `size: number` — the Icon component node doesn't carry `size` when defaults are applied internally; the inner Feather call does.
- Initial `jest.mock("@expo/vector-icons", ...)` factory failed with `_ReactNativeCSSInterop` out-of-scope variable error. Fixed by renaming closure variables to `mock*` prefix (`mockReact`, `mockRN`, `mockFeather`) per Jest's `mock*`-prefix allowlist for factory closures.
- `mock-test/results.tsx` `SECTION_LABELS` Edit tool replacement repeatedly failed across the literal-emoji form even with the escape-swap heuristic; resolved by splitting into 2 narrower `old_string` blocks (the multi-line block containing em-dash + escape sequences was harder to match exactly).

### Completion Notes List

**Operator-decision resolutions (recommended path, per session policy):**

- **Q1 — Icon library: `@expo/vector-icons.Feather`.** Already transitive via Expo SDK 55 (`@expo/vector-icons@15.1.1` verified in node_modules); zero install cost; cohesive single-stroke line-icon family.
- **Q2 — Onboarding goal-selection emoji: PRESERVE.** Learning content per Story 14-1 chrome/content rule; emoji adds personality to onboarding surface.
- **Q3 — Streak `🔥` → `Icon name="zap"`.** Feather lacks Flame glyph (only FontAwesome has it). Closest semantic match is `zap` (lightning). Visual semantic shift warmth → energy is acceptable given the surrounding "{N} jour streak" copy carries the duration meaning.
- **Q4 — Forgot-password hero `🔑` → `Icon name="key"` at 52px.** Auth-surface consistency with the new chrome icons (mail, lock) on signup/login. Tested at 52px size — Feather's line-icon strokes hold up well at hero size.
- **Q5 — Grammar `🧠` → `Icon name="activity"`.** Feather lacks Brain pictogram. `activity` (EKG-like line) is the closest semantic-adjacent match. The 3 sites (practice/index.tsx PRACTICE_SKILLS Grammar; mock-test/results.tsx Grammar legacy entry) all use the same icon for consistency.

**Implementation summary:**

- NEW `src/components/common/Icon.tsx` (~90 lines incl. JSDoc) — single source of truth for icon-set choice. Exports `Icon` (React.memo'd), `IconProps`, and `IconName` typed union (22 members).
- Extended `SkillCard` + `ListItemCard` + `TodayPlanItem` with optional icon-component slots (`iconNode?: React.ReactNode` / `iconNode?` / `iconName?: IconName` respectively). Legacy `iconEmoji` props preserved for content-emoji surfaces.
- 33 chrome/status/decoration emoji REPLACED across 11 source files per AC #3, #4, #5, #6.
- 18 learning content emoji PRESERVED (12 `TOPIC_EMOJIS` + 6 onboarding goals + 2 milestone-banner celebration emojis not in inventory).
- NEW source-drift detector (18 cases) + NEW runtime smoke test (5 cases).
- All 4 quality gates green: type-check 0 errors / lint 0 warnings / prettier clean / jest 99 suites / 1940 cases (+23 net 1917 → 1940; exceeds spec target +12-18 by 5-11).
- 0 new packages / migrations / Edge Function changes / CI workflow changes.

### File List

**New files (3):**

- `src/components/common/Icon.tsx`
- `src/components/common/__tests__/icon.test.tsx`
- `src/components/common/__tests__/icon-replacement-source-drift.test.ts`

**Modified source files (12):**

- `src/components/common/SkillCard.tsx` (+ `iconNode` prop)
- `src/components/common/ListItemCard.tsx` (+ `iconNode` prop)
- `src/components/home/TodayPlanItem.tsx` (+ `iconName` prop)
- `app/(tabs)/home/index.tsx` (ConversationCard mic + TodayPlanItem.iconName consumer)
- `app/(tabs)/conversation/index.tsx` (CONVERSATION_MODES `💬` → typed icon)
- `app/(tabs)/practice/index.tsx` (PRACTICE_SKILLS 8 emoji + Vocabulary featured)
- `app/(tabs)/practice/vocabulary.tsx` (hero + celebration + caught-up)
- `app/(tabs)/mock-test/index.tsx` (SECTIONS + Writing + Speaking)
- `app/(tabs)/mock-test/results.tsx` (SECTION_LABELS)
- `app/(tabs)/conversation/[sessionId].tsx` (strengths ✓)
- `app/(tabs)/profile/index.tsx` (streak 🔥)
- `app/(auth)/login.tsx` (email + password)
- `app/(auth)/signup.tsx` (full-name + email + password)
- `app/(auth)/forgot-password.tsx` (hero 🔑 + email)
- `src/components/auth/PasswordStrengthIndicator.tsx` (checklist ✓)
- `src/hooks/use-daily-briefing.ts` (TodayPlanItem.iconEmoji → iconName)

**Housekeeping (3):**

- `CLAUDE.md` (+ Story 14-3 architecture paragraph)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status flip)
- `_bmad-output/implementation-artifacts/14-3-icon-system-replacement.md` (this story file)

### Change Log

- 2026-05-16 — Story 14-3 implementation complete. 33 chrome emoji replaced with `<Icon />` JSX via new `src/components/common/Icon.tsx` Feather wrapper. SkillCard + ListItemCard + TodayPlanItem extended with optional icon-component slots. Drift detector (18 cases) + runtime smoke test (5 cases). All 4 quality gates green; +23 net Jest cases (1917 → 1940). Status: review.
