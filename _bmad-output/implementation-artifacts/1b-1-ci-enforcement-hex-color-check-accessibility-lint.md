# Story 1B.1: CI Enforcement — Hex Color Check & Accessibility Lint

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want CI to automatically catch hardcoded hex colors and missing accessibility attributes,
So that recurring bug classes from Epic 1 are prevented from entering the codebase again.

## Acceptance Criteria

### A. Hex Color CI Check

1. **AC-A1:** A grep-based check in CI scans `app/` and `src/components/` for hardcoded hex color patterns (`#[0-9a-fA-F]{3,8}`) — fails if any new hardcoded hex values are found
2. **AC-A2:** The check excludes `src/lib/design.ts` and `src/lib/constants.ts` (where hex values are defined as design tokens)
3. **AC-A3:** The error output lists the exact file(s) and line(s) with hardcoded hex values
4. **AC-A4:** Using `Colors.*` design tokens or `skillTint()` from `@/src/lib/design` does NOT trigger the check — only raw hex literals are flagged
5. **AC-A5:** HTML entities (`&#10003;`, `&#9888;`, `&#10007;`) are NOT flagged — they are Unicode character references, not hex colors

### B. CI Pipeline Integration

6. **AC-B1:** The hex color check runs as a step in `.github/workflows/ci.yml` alongside `type-check`, `lint`, and `format:check`
7. **AC-B2:** The check does not increase CI run time by more than 10 seconds
8. **AC-B3:** The check can also be run locally via an npm script (e.g., `npm run check:colors`)

### C. Accessibility Lint

9. **AC-C1:** Research is conducted on `eslint-plugin-react-native-a11y` (or equivalent) for enforcing `accessibilityRole` and `accessibilityLabel` on `Pressable`, `TouchableOpacity`, and `TouchableHighlight`
10. **AC-C2:** If a suitable plugin exists and is compatible with ESLint 9 flat config + eslint-config-expo, it is added and configured
11. **AC-C3:** If no suitable plugin exists or is incompatible, the decision is documented with rationale in a comment in `eslint.config.js`

### D. Fix Known Violations

12. **AC-D1:** The one known remaining hex violation in `src/components/common/ErrorBoundary.tsx` (`text-[#666]`) is replaced with a design token
13. **AC-D2:** The CI hex color check passes cleanly on the current codebase after fixes

### E. Quality Gates

14. **AC-E1:** `npm run type-check && npm run lint && npm run format:check` passes with zero errors and zero warnings
15. **AC-E2:** All colors use `Colors.*` design tokens — no hardcoded hex
16. **AC-E3:** All loading states use skeleton animations — no `ActivityIndicator` spinners
17. **AC-E4:** All interactive elements have `accessibilityRole` + `accessibilityLabel`
18. **AC-E5:** All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`

## Tasks / Subtasks

- [x] Task 1: Create hex color check script (AC: A1-A5, B3, D2)
  - [x] 1.1 Create `scripts/check-hex-colors.sh` — grep-based scanner for `app/` and `src/components/`
  - [x] 1.2 Pattern: match `#[0-9a-fA-F]{3,8}` but exclude HTML entities (`&#...;`) and files `design.ts`, `constants.ts`
  - [x] 1.3 Exit code 1 on violations with file:line output; exit code 0 on clean
  - [x] 1.4 Add `"check:colors": "bash scripts/check-hex-colors.sh"` to `package.json` scripts
- [x] Task 2: Fix known hex violation (AC: D1)
  - [x] 2.1 In `src/components/common/ErrorBoundary.tsx` line 45: replace `text-[#666]` with inline `style={{ color: Colors.textSecondary }}` and import `Colors` from `@/src/lib/design`
- [x] Task 3: Add hex color check to CI pipeline (AC: B1-B2)
  - [x] 3.1 Add a new step in `.github/workflows/ci.yml` after the lint step: `name: Hex color check` → `run: npm run check:colors`
- [x] Task 4: Research and configure accessibility lint plugin (AC: C1-C3)
  - [x] 4.1 Research `eslint-plugin-react-native-a11y` — check compatibility with ESLint 9 flat config and `eslint-config-expo`
  - [x] 4.2 If compatible: `npm install -D eslint-plugin-react-native-a11y`, add to `eslint.config.js` with rules for `accessibilityRole`/`accessibilityLabel` on Pressable/TouchableOpacity/TouchableHighlight — N/A (incompatible)
  - [x] 4.3 If incompatible: add a block comment in `eslint.config.js` documenting the research, version tested, and incompatibility reason
  - [x] 4.4 If added, run `npm run lint` and fix any new warnings/errors it surfaces — N/A (not added)
- [x] Task 5: Quality gates (AC: E1)
  - [x] 5.1 Run `npm run type-check` — zero errors
  - [x] 5.2 Run `npm run lint` — zero warnings
  - [x] 5.3 Run `npm run format:check` — all pass
  - [x] 5.4 Run `npm run check:colors` — zero violations

## Dev Notes

### This is a CI/tooling story, NOT a feature story

You are adding automated enforcement to the CI pipeline. Do NOT:

- Refactor screens or components
- Change visual behavior
- Add new design tokens (except if needed for the ErrorBoundary fix — `Colors.textSecondary` already exists)
- Touch any screen files beyond fixing the one known hex violation

DO:

- Create a shell script for hex color scanning
- Add a CI step
- Research and potentially add an ESLint plugin
- Fix the one known violation in ErrorBoundary.tsx

### Current CI Pipeline (`.github/workflows/ci.yml`)

The pipeline runs on push/PR to `main` with these steps:

1. Checkout → Setup Node 20 → `npm ci`
2. `npm run type-check`
3. `npm run lint`
4. `npm run format:check`
5. SQL migration validation (basic syntax check)
6. `npx expo-doctor@latest` (informational, continue-on-error)

Add the hex color check as step between lint and format:check (or after format:check — order doesn't matter since they're independent).

### ESLint Configuration (`eslint.config.js`)

Uses ESLint 9 flat config with `eslint-config-expo/flat`. Key existing rules:

- `@typescript-eslint/no-floating-promises: "error"`
- `@typescript-eslint/no-unused-vars: "error"` (with `^_` ignore pattern)
- `import/order: "warn"`
- `no-console: "warn"` (allows `error` and `warn`)

The `ignores` array excludes `node_modules/`, `.expo/`, `.history/`, `dist/`, `supabase/functions/`.

### Hex Color Check Script Design

The script must:

1. Use `grep -rn` (or similar) to find `#[0-9a-fA-F]{3,8}` in `app/` and `src/components/`
2. Exclude `design.ts` and `constants.ts` via `--exclude`
3. Filter out HTML entities — patterns like `&#10003;`, `&#9888;`, `&#10007;` are Unicode references in JSX, NOT hex colors. These match `&#[0-9]+;` and must be excluded from results
4. Filter out comments — `// #hex` in comments documenting rationale are acceptable
5. Output violations in `file:line: content` format
6. Exit 0 if no violations, exit 1 if any found

**Known edge case:** NativeWind className hex values like `text-[#666]`, `bg-[#xxx]`, `border-[#xxx]` — these are exactly what this check should catch. They must be converted to inline `style` with design tokens in Story 1B.2.

**Current known violations:**

- `src/components/common/ErrorBoundary.tsx:45` — `text-[#666]` → fix in Task 2

### Accessibility Lint Plugin Research Notes

`eslint-plugin-react-native-a11y` is the primary candidate. Key considerations:

- **ESLint 9 flat config compatibility**: As of early 2026, many React Native ESLint plugins have been slow to adopt flat config. If the plugin only exports a legacy config, it may not work with `eslint.config.js` without a compatibility adapter.
- **`eslint-config-expo` interaction**: Expo's flat config may already include some a11y rules — check for conflicts.
- **Useful rules**: `has-accessibility-props`, `has-valid-accessibility-role`, `no-nested-touchables`
- **If incompatible**: Document the specific version tested, the error encountered, and recommend revisiting when the plugin supports flat config.

### Pre-commit Hook Context

Husky + lint-staged is configured. Pre-commit runs:

- `*.{ts,tsx}` → `eslint --max-warnings 0 --no-warn-ignored` + `prettier --write`
- `*.{js,json,md}` → `prettier --write`

The hex color check is NOT added to pre-commit — it's a CI-only check (fast feedback on PR, no developer friction during local commits). If the team later wants local enforcement, they can add `"*.{ts,tsx}": ["npm run check:colors", ...]` to lint-staged.

### ErrorBoundary Fix Details

```typescript
// BEFORE (line 45):
<Text className="mb-6 text-center text-sm leading-5 text-[#666]">

// AFTER:
<Text className="mb-6 text-center text-sm leading-5" style={{ color: Colors.textSecondary }}>

// Import to add:
import { Colors } from "@/src/lib/design";
```

`Colors.textSecondary` is `#5A6B82` (5.0:1 contrast on surface, WCAG AA). This is darker than the original `#666` but maintains readability and meets accessibility requirements.

### Project Structure Notes

- CI config: `.github/workflows/ci.yml`
- ESLint config: `eslint.config.js` (flat config, NOT `.eslintrc`)
- Package scripts: `package.json` → `scripts`
- Design tokens: `src/lib/design.ts` — `Colors`, `Typography`, `Spacing`, `Radii`, `Shadows`
- New script location: `scripts/check-hex-colors.sh` (create `scripts/` directory if needed)
- Sentry error capture: `src/lib/sentry.ts` → `captureError(err, contextTag)`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1B overview, lines 329-332]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 1B.1 acceptance criteria, lines 1599-1631]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR16-20 Accessibility, CI/CD pipeline]
- [Source: _bmad-output/implementation-artifacts/1-7-cross-platform-ux-polish-accessibility-audit.md — Previous story learnings on hex color patterns and accessibility]
- [Source: .github/workflows/ci.yml — Current CI pipeline structure]
- [Source: eslint.config.js — Current ESLint flat config setup]
- [Source: package.json — lint-staged configuration, scripts, devDependencies]

## Change Log

- 2026-03-26: Implemented all tasks — hex color check script, ErrorBoundary fix, CI step, a11y lint research, quality gates passed

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- ESLint import/order warning fixed: `Colors` import created empty line between internal imports in ErrorBoundary.tsx
- Prettier formatting auto-fixed after style prop addition to ErrorBoundary.tsx

### Completion Notes List

- Task 1: Created `scripts/check-hex-colors.sh` — grep-based scanner with HTML entity exclusion, design token file exclusion, file:line violation output. Added `check:colors` npm script.
- Task 2: Replaced `text-[#666]` with `style={{ color: Colors.textSecondary }}` in ErrorBoundary.tsx. Added `Colors` import from `@/src/lib/design`.
- Task 3: Added "Hex color check" step to `.github/workflows/ci.yml` after Prettier format check step.
- Task 4: Researched `eslint-plugin-react-native-a11y` v3.5.1 — incompatible with ESLint 9 flat config (peer deps cap at ^8, no flat config export, PR #167 stalled since May 2025). Documented in block comment in `eslint.config.js`.
- Task 5: All quality gates pass — type-check (0 errors), lint (0 warnings), format:check (all pass), check:colors (0 violations).

### File List

- scripts/check-hex-colors.sh (new)
- package.json (modified — added check:colors script)
- src/components/common/ErrorBoundary.tsx (modified — hex color fix + Colors import)
- .github/workflows/ci.yml (modified — added hex color check step)
- eslint.config.js (modified — added a11y lint incompatibility documentation)
- \_bmad-output/implementation-artifacts/sprint-status.yaml (modified — Epic 1B added, story status updated)
- \_bmad-output/implementation-artifacts/1b-1-ci-enforcement-hex-color-check-accessibility-lint.md (modified — status, tasks, dev record)
