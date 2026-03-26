# Story 1B.2: NativeWind className Hex Conversion & Design Token Cleanup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want all remaining hardcoded rgba/hex color values in inline styles converted to design tokens from `Colors.*`,
So that the design system is fully enforced, the CI hex check passes cleanly, and every color in the app is traceable to a single source of truth.

## Acceptance Criteria

### A. Hardcoded rgba() Conversion

1. **AC-A1:** All hardcoded `rgba(...)` values in `app/` and `src/components/` are replaced with named `Colors.*` tokens from `@/src/lib/design`
2. **AC-A2:** Where an exact token already exists (e.g., `rgba(245,166,35,0.15)` → `Colors.accent15`), use it directly
3. **AC-A3:** Where no matching token exists, add a new named constant to `Colors` in `design.ts` following existing naming conventions
4. **AC-A4:** Visual appearance is identical before and after conversion — same colors, same opacities
5. **AC-A5:** The `skillTint()` helper is used where a dynamic color needs an opacity variant (e.g., ScoreCard)

### B. Design Token Additions

6. **AC-B1:** All new tokens follow the existing naming pattern: `{base}{opacity}` for tints (e.g., `accent25`, `success12`), semantic names for UI-specific colors (e.g., `overlayDark`, `textOnDarkQuaternary`)
7. **AC-B2:** New tokens are added in the correct section of `Colors` in `design.ts` (grouped by base color family)
8. **AC-B3:** No duplicate tokens — if a value matches an existing token, reuse it

### C. Quality Gates

9. **AC-C1:** `npm run check:colors` passes with zero violations
10. **AC-C2:** `npm run type-check` passes with zero errors
11. **AC-C3:** `npm run lint` passes with zero warnings
12. **AC-C4:** `npm run format:check` passes clean

## Tasks / Subtasks

- [x] Task 1: Add missing design tokens to `src/lib/design.ts` (AC: B1-B3)
  - [x] 1.1 Add accent tints: `accent25`, `accent50`
  - [x] 1.2 Add success tints: `success12`, `success30`, `success35`
  - [x] 1.3 Add error tints: `error25`
  - [x] 1.4 Add white/dark UI tokens: `whiteAlpha06-85`, `textOnDarkQuaternary`, `textOnDarkMuted`, `textOnDarkBright`
  - [x] 1.5 Add overlay tokens: `overlayDark`, `bgDarkOverlay`

- [x] Task 2: Convert `app/(tabs)/home/index.tsx` — 13 rgba values (AC: A1-A4)
  - [x] 2.1-2.11 All 13 rgba values replaced with Colors.* tokens
  - [x] 2.12 Colors import already existed

- [x] Task 3: Convert `app/(tabs)/conversation/[sessionId].tsx` — 11 rgba values (AC: A1-A4)
  - [x] 3.1-3.10 All 10 planned rgba values replaced + 1 additional (`rgba(255,255,255,0.85)` → `Colors.whiteAlpha85`)

- [x] Task 4: Convert `app/onboarding/index.tsx` — 4 rgba values (AC: A1-A4)
  - [x] 4.1-4.3 All 4 rgba values replaced

- [x] Task 5: Convert `app/onboarding/placement-test.tsx` — 4 rgba values (AC: A1-A4)
  - [x] 5.1-5.4 All 4 rgba values replaced

- [x] Task 6: Convert `app/(tabs)/mock-test/[testId].tsx` — 3 rgba values (AC: A1-A4)
  - [x] 6.1 All 3 rgba values replaced with `Colors.whiteAlpha15`

- [x] Task 7: Convert `app/(tabs)/practice/dictation.tsx` — 3 rgba values (AC: A1-A4)
  - [x] 7.1-7.3 All 3 rgba values replaced

- [x] Task 8: Convert `app/(tabs)/practice/listening.tsx` — 1 rgba value (AC: A1-A4)
  - [x] 8.1 `rgba(255,255,255,0.3)` → `Colors.whiteAlpha30`

- [x] Task 9: Convert `app/(tabs)/practice/reading.tsx` — 1 rgba value (AC: A1-A4)
  - [x] 9.1 `rgba(0,0,0,0.5)` → `Colors.overlayDark`

- [x] Task 10: Fix `src/components/practice/ScoreCard.tsx` dynamic hex (AC: A5)
  - [x] 10.1 Replaced `` `${color}10` `` with `skillTint(color, 0.06)`
  - [x] 10.2 Added `skillTint` to existing Colors import

- [x] Task 11: Quality gates (AC: C1-C4)
  - [x] 11.1 `npm run check:colors` — zero violations
  - [x] 11.2 `npm run type-check` — zero errors
  - [x] 11.3 `npm run lint` — zero warnings
  - [x] 11.4 `npm run format:check` — all pass

## Dev Notes

### This is a design token cleanup story, NOT a feature story

You are replacing hardcoded rgba() values with design token references. Do NOT:
- Change any visual appearance (colors, opacities, layouts)
- Refactor screen logic or component structure
- Add features or modify behavior
- Change NativeWind className strings (they are fine — this is about inline `style` values)

DO:
- Add new tokens to `design.ts` Colors object
- Replace every hardcoded rgba() with the corresponding `Colors.*` token
- Fix the ScoreCard dynamic hex suffix with `skillTint()`
- Ensure imports are correct in every modified file

### Existing Design Token Mapping

Many rgba() values ALREADY have tokens in `design.ts`. Reuse these — do NOT create duplicates:

| rgba value | Existing Token |
|-----------|---------------|
| `rgba(245,166,35,0.1)` | `Colors.accent10` |
| `rgba(245,166,35,0.15)` | `Colors.accent15` |
| `rgba(245,166,35,0.2)` | `Colors.accent20` |
| `rgba(245,166,35,0.3)` | `Colors.accent30` |
| `rgba(52,199,89,0.1)` | `Colors.success10` |
| `rgba(52,199,89,0.15)` | `Colors.success15` |
| `rgba(255,59,48,0.1)` | `Colors.error10` |
| `rgba(255,59,48,0.15)` | `Colors.error15` |
| `rgba(255,255,255,0.7)` | `Colors.textOnDarkSecondary` |
| `rgba(255,255,255,0.5)` | `Colors.textOnDarkTertiary` |
| `rgba(255,255,255,0.12)` | `Colors.borderOnDark` |
| `rgba(255,255,255,0.1)` | `Colors.bubbleAi` |
| `rgba(0,0,0,0.06)` | `Colors.borderLight` |

### New Tokens Needed

These rgba() values do NOT have tokens yet — create them in Task 1:

**Accent family:**
- `accent25: "rgba(245,166,35,0.25)"` — used in home hero pill background
- `accent50: "rgba(245,166,35,0.5)"` — used in home icon circle border, arrow pill border

**Success family:**
- `success12: "rgba(52,199,89,0.12)"` — conversation success background
- `success30: "rgba(52,199,89,0.3)"` — conversation success border
- `success35: "rgba(52,199,89,0.35)"` — conversation success border variant

**Error family:**
- `error25: "rgba(255,59,48,0.25)"` — home error card border

**White alpha family** (for dark-theme UI):
- `whiteAlpha06` through `whiteAlpha35` — various dark-theme card/border/text opacities

**Semantic dark UI tokens:**
- `textOnDarkQuaternary: "rgba(255,255,255,0.55)"` — lowest-contrast text on dark
- `textOnDarkMuted: "rgba(255,255,255,0.65)"` — muted text on dark (subtitles, secondary info)
- `textOnDarkBright: "rgba(255,255,255,0.75)"` — brighter secondary text on dark
- `overlayDark: "rgba(0,0,0,0.5)"` — modal semi-transparent overlay
- `bgDarkOverlay: "rgba(8,18,35,0.92)"` — near-opaque dark overlay (conversation bottom sheet)

### ScoreCard Special Case

`src/components/practice/ScoreCard.tsx` line 62 uses `` `${color}10` `` which appends hex `10` (6.27% opacity) to a color string. This is fragile — use `skillTint(color, 0.06)` instead, which already exists in `design.ts` and handles the RGBA conversion properly.

### File-by-File Violation Counts

| File | Violations | Primary Pattern |
|------|-----------|----------------|
| `app/(tabs)/home/index.tsx` | 13 | accent + white alpha + error tints |
| `app/(tabs)/conversation/[sessionId].tsx` | 11 | white alpha + success + accent tints |
| `app/onboarding/index.tsx` | 4 | white alpha text on dark |
| `app/onboarding/placement-test.tsx` | 4 | white alpha dark UI |
| `app/(tabs)/mock-test/[testId].tsx` | 3 | white alpha skeleton |
| `app/(tabs)/practice/dictation.tsx` | 3 | success/accent/error tints |
| `app/(tabs)/practice/listening.tsx` | 1 | white alpha button |
| `app/(tabs)/practice/reading.tsx` | 1 | black overlay |
| `src/components/practice/ScoreCard.tsx` | 1 | dynamic hex suffix |
| **Total** | **41** | |

### Import Pattern

Every file that uses `Colors` needs:
```typescript
import { Colors } from "@/src/lib/design";
```
For ScoreCard, also import `skillTint`:
```typescript
import { Colors, skillTint } from "@/src/lib/design";
```

Most files already import `Colors` — verify before adding a duplicate import.

### Project Structure Notes

- Design tokens source of truth: `src/lib/design.ts`
- CI enforcement: `scripts/check-hex-colors.sh` — currently only catches `#hex` patterns, not `rgba()`
- Styling approach: NativeWind `className` for static layout, inline `style` for dynamic/token values
- After this story, consider extending `check-hex-colors.sh` to also catch raw `rgba()` — but that's out of scope for this story

### Previous Story (1B.1) Learnings

- ErrorBoundary fix pattern: replace `text-[#666]` className with `style={{ color: Colors.textSecondary }}` — same approach applies here but for inline `rgba()` values
- ESLint import/order rule is active — place `Colors` import with other `@/` imports, not in a separate group
- Prettier will auto-format after edits — run `npm run format:check` at the end
- The hex color CI check only catches `#hex` patterns — it will not fail on `rgba()` values, so the real validation is manual review + grep

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 1B.2 acceptance criteria, lines 1632-1658]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1B overview, lines 329-332]
- [Source: _bmad-output/planning-artifacts/architecture.md — Styling: NativeWind v4 className + inline style with design tokens, line 233]
- [Source: _bmad-output/planning-artifacts/architecture.md — NativeWind constraint: dynamic styles via inline style with design tokens, line 71]
- [Source: _bmad-output/implementation-artifacts/1b-1-ci-enforcement-hex-color-check-accessibility-lint.md — Previous story patterns and learnings]
- [Source: src/lib/design.ts — Current Colors tokens, skillTint() helper, Typography/Spacing/Radii/Shadows]
- [Source: scripts/check-hex-colors.sh — CI hex check scope and patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Prettier formatting fix required for `[sessionId].tsx` and `[testId].tsx` after token replacements
- Discovered 1 additional rgba value (`rgba(255,255,255,0.85)`) in conversation file not in original task list — added `whiteAlpha85` token

### Completion Notes List

- Task 1: Added 19 new design tokens to `src/lib/design.ts` — accent (accent25, accent50), success (success12, success30, success35), error (error25), white alpha (whiteAlpha06-85), text on dark (textOnDarkQuaternary, textOnDarkMuted, textOnDarkBright), overlays (overlayDark, bgDarkOverlay)
- Tasks 2-9: Converted 42 hardcoded rgba() values across 8 files to Colors.* token references. Zero rgba() values remain in `app/` and `src/components/`.
- Task 10: Replaced fragile `${color}10` hex suffix with `skillTint(color, 0.06)` in ScoreCard.tsx
- Task 11: All 4 quality gates pass — check:colors, type-check, lint, format:check

## Change Log

- 2026-03-26: Implemented all tasks — 19 new design tokens, 42 rgba conversions across 9 files, ScoreCard skillTint fix, all quality gates pass

### File List

- src/lib/design.ts (modified — 19 new color tokens added)
- app/(tabs)/home/index.tsx (modified — 13 rgba → Colors.* tokens)
- app/(tabs)/conversation/[sessionId].tsx (modified — 11 rgba → Colors.* tokens)
- app/onboarding/index.tsx (modified — 4 rgba → Colors.* tokens)
- app/onboarding/placement-test.tsx (modified — 4 rgba → Colors.* tokens)
- app/(tabs)/mock-test/[testId].tsx (modified — 3 rgba → Colors.* tokens)
- app/(tabs)/practice/dictation.tsx (modified — 3 rgba → Colors.* tokens)
- app/(tabs)/practice/listening.tsx (modified — 1 rgba → Colors.* token)
- app/(tabs)/practice/reading.tsx (modified — 1 rgba → Colors.* token)
- src/components/practice/ScoreCard.tsx (modified — dynamic hex → skillTint())
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — Epic 1B added, story status)
- _bmad-output/implementation-artifacts/1b-2-nativewind-classname-hex-conversion-design-token-cleanup.md (modified — tasks, status, dev record)
