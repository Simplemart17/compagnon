# Story 1.1: Auth, Onboarding & Profile Flow Verification

Status: review

## Story

As a new or returning user,
I want the authentication, onboarding, and profile flows to work flawlessly,
So that I can create an account, set up my learning profile, and manage my settings without encountering bugs or visual inconsistencies.

## Acceptance Criteria

1. **Signup Flow**
   - Given the app is freshly installed, when a user taps "Create Account" and enters a valid email and password, then the account is created, the user is redirected to onboarding, and the profile is stored in the database
   - The signup screen displays the legal notice with links to privacy policy and terms

2. **Login Flow**
   - Given a registered user, when they enter valid credentials on the login screen, then they are authenticated and redirected to the home screen with their profile loaded
   - Auth tokens are stored in expo-secure-store (not AsyncStorage)

3. **Forgot Password**
   - Given a registered user who forgot their password, when they submit their email on the forgot-password screen, then a password reset email is sent and the user sees a confirmation message

4. **Onboarding Wizard**
   - Given a newly registered user on the onboarding wizard, when they complete all 3 steps (CEFR level, learning goal, daily time target), then the profile is updated with their selections and they proceed to the placement test or home screen

5. **Placement Test**
   - Given a user who selects "I don't know" for their CEFR level, when they take the placement test, then 15 AI-generated questions across 4 linguistic competencies are presented with a progress indicator ("Question N of 15")
   - Results show the assigned level with mastery/struggle analysis per level and a natural language summary

6. **Profile Display**
   - Given an authenticated user on the profile screen, when they view their profile, then stats, skills, CEFR chart, and error patterns are displayed correctly
   - App version number from expo-constants is shown in settings

7. **Settings Editing**
   - Given an authenticated user in settings, when they edit target level, daily goal, or preferences, then a confirmation dialog appears before saving changes

8. **GDPR: Export Data**
   - Given an authenticated user, when they tap "Export Data" in settings, then their personal data is exported successfully with a success indicator

9. **GDPR: Delete Account**
   - When they tap "Delete Account" and complete the two-step confirmation (dialog + type DELETE), then all their data is permanently deleted via the account-delete Edge Function

10. **Visual Consistency**
    - Given all auth and profile screens, when visually inspected on iOS and Android, then screens are consistent with the design system (Colors, Typography, Spacing from `design.ts`), empty states use contextual language, loading states use skeleton animations, and error states offer retry + back actions

## Tasks / Subtasks

- [x] Task 1: Auth Flow Verification (AC: #1, #2, #3)
  - [x] 1.1 Test signup with valid email/password — verify account creation, onboarding redirect, profile stored in `profiles` table
  - [x] 1.2 Test signup with invalid inputs — verify inline validation messages (empty fields, invalid email format, weak password)
  - [x] 1.3 Verify legal notice + privacy policy/terms links render on signup screen
  - [x] 1.4 Test login with valid credentials — verify auth, home screen redirect, profile loading
  - [x] 1.5 Test login with invalid credentials — verify error messages
  - [x] 1.6 Verify auth tokens in expo-secure-store (not AsyncStorage) via `src/lib/supabase.ts` SecureStore adapter
  - [x] 1.7 Test forgot-password flow — verify email sent, confirmation message shown
  - [x] 1.8 Test sign-out — verify session cleared, redirected to login
  - [x] 1.9 Test session expiry — verify redirect to login without data loss (NFR23)
  - [x] 1.10 Verify try/catch/finally on all auth screens (error handling)

- [x] Task 2: Onboarding Wizard Verification (AC: #4, #5)
  - [x] 2.1 Walk through all 3 onboarding steps — verify CEFR level picker, learning goal selection, daily time target
  - [x] 2.2 Verify profile updates saved to database after each step
  - [x] 2.3 Verify "I don't know" CEFR level triggers placement test route
  - [x] 2.4 Test placement test: 15 questions, "Question N of 15" progress indicator, CEFR level names shown
  - [x] 2.5 Verify placement test question distribution: A1:3, A2:3, B1:3, B2:3, C1:2, C2:1
  - [x] 2.6 Verify results screen: mastery/struggle per level, status labels, natural language summary, loading skeleton (not spinner)
  - [x] 2.7 Verify selecting a known CEFR level bypasses placement test
  - [x] 2.8 Verify onboarding cannot be re-entered after completion (auth guard in `app/_layout.tsx`)

- [x] Task 3: Profile & Settings Verification (AC: #6, #7)
  - [x] 3.1 Verify profile screen displays: stats, skills (tappable → navigate to practice), CEFR chart with target indicator, error patterns (tappable → grammar micro-drill)
  - [x] 3.2 Verify app version from `expo-constants` in settings (not hardcoded)
  - [x] 3.3 Test editing target level — confirmation dialog appears, changes saved on confirm, cancelled on dismiss
  - [x] 3.4 Test editing daily goal — same confirmation flow
  - [x] 3.5 Verify privacy policy and terms navigate in-app via router.push (not external link)
  - [x] 3.6 Test profile cached data loads from cache when available (`use-auth.ts` 4h TTL)

- [x] Task 4: GDPR Compliance Verification (AC: #8, #9)
  - [x] 4.1 Test "Export Data" — verify data export completes, success feedback shown
  - [x] 4.2 Test "Delete Account" — verify two-step confirmation: dialog → type "DELETE"
  - [x] 4.3 Verify account deletion calls `account-delete` Edge Function (not client-side deletion)
  - [x] 4.4 Verify all user data cascades on deletion (profiles, skill_progress, conversations, exercises, vocabulary, mock_tests, daily_activity, companion_memory, error_patterns)
  - [x] 4.5 Verify deleted user is signed out and redirected to login

- [x] Task 5: Visual Consistency & Edge Cases (AC: #10)
  - [x] 5.1 Verify all auth screens use design.ts tokens: Colors.primary (#1E3A5F), Colors.accent (#F5A623), Colors.surface (#F5F5F0)
  - [x] 5.2 Verify Typography presets (screenTitle, sectionHeader, body, etc.) are applied consistently
  - [x] 5.3 Verify Spacing (screenPadding: 20/24 for auth), Radii (card: 16, button: 12)
  - [x] 5.4 Test loading states — skeleton animations (not spinners) per NFR20
  - [x] 5.5 Test error states — offer retry + back actions
  - [x] 5.6 Test empty states — contextual language
  - [x] 5.7 Verify accessibility labels on all interactive elements (NFR16)
  - [x] 5.8 Verify touch targets >= 44x44 points (NFR17)
  - [x] 5.9 Cross-platform check: iOS simulator + Android emulator for visual parity

- [x] Task 6: Fix Any Bugs Found
  - [x] 6.1 Log each bug with: screen, steps to reproduce, expected vs actual behavior
  - [x] 6.2 Fix bugs, ensuring changes follow existing code patterns
  - [x] 6.3 Run quality gates: `npm run type-check && npm run lint && npm run format:check`

## Dev Notes

### Architecture Patterns

- **Layer boundary:** Screen → Hook → Library → Edge Function → External API (strict, one-directional)
- **Auth state:** Single Zustand store `src/store/auth-store.ts` (session, user, profile, isOnboarded)
- **Auth hook:** `src/hooks/use-auth.ts` — sign in/up/out, profile loading, onAuthStateChange subscription
- **Auth guard:** `app/_layout.tsx` redirects based on session state and onboarding status
- **Supabase client:** `src/lib/supabase.ts` with expo-secure-store adapter for native sessions
- **No test framework** — quality enforced via TypeScript strict + ESLint zero-warnings + Prettier

### Screen State Machine Pattern

All screens should follow the discriminated union state vocabulary: `idle | generating | connecting | active | checking | results | error`

### Relevant Files

**Auth screens:**

- `app/(auth)/_layout.tsx` — auth group layout
- `app/(auth)/login.tsx` — login screen
- `app/(auth)/signup.tsx` — signup with legal notice
- `app/(auth)/forgot-password.tsx` — password reset
- `app/(auth)/privacy-policy.tsx` — auth-scoped privacy policy
- `app/(auth)/terms.tsx` — auth-scoped terms

**Onboarding:**

- `app/onboarding/_layout.tsx` — onboarding layout
- `app/onboarding/index.tsx` — 3-step wizard
- `app/onboarding/placement-test.tsx` — AI placement test

**Profile:**

- `app/(tabs)/profile/_layout.tsx` — profile group layout
- `app/(tabs)/profile/index.tsx` — profile display (stats, skills, CEFR chart, errors)
- `app/(tabs)/profile/settings.tsx` — settings with level/goal/target editing
- `app/(tabs)/profile/privacy-policy.tsx` — in-app privacy policy
- `app/(tabs)/profile/terms.tsx` — in-app terms

**Core libraries:**

- `src/hooks/use-auth.ts` — auth hook (sign in/up/out, profile loading)
- `src/store/auth-store.ts` — Zustand auth store
- `src/lib/supabase.ts` — Supabase client with SecureStore adapter
- `src/lib/design.ts` — Design tokens (Colors, Typography, Spacing, Radii, Shadows)
- `src/lib/cache.ts` — AsyncStorage cache with TTL, cacheWithFallback, write queue
- `src/lib/network.ts` — requireNetwork() check
- `src/lib/haptics.ts` — haptic feedback utility

**Edge Functions:**

- `supabase/functions/account-delete/index.ts` — account deletion with admin API

**Database:**

- `supabase/migrations/001_initial_schema.sql` — profiles table, RLS, auth trigger
- All tables enforce RLS with `auth.uid() = user_id`

### Design System Reference

| Token                      | Value                        |
| -------------------------- | ---------------------------- |
| Colors.primary             | #1E3A5F (navy)               |
| Colors.accent              | #F5A623 (amber/gold)         |
| Colors.surface             | #F5F5F0 (off-white)          |
| Colors.success             | #34C759                      |
| Colors.error               | #FF3B30                      |
| Spacing.screenPadding      | 20                           |
| Spacing.screenPaddingLarge | 24 (use for auth/onboarding) |
| Radii.card                 | 16                           |
| Radii.button               | 12                           |

### Key Conventions

- **Path alias:** `@/*` maps to repo root (e.g., `import { supabase } from '@/src/lib/supabase'`)
- **Styling:** NativeWind v4 `className` for static, inline `style` with design tokens for dynamic
- **Naming:** camelCase TypeScript functions, PascalCase components, snake_case SQL
- **New components** go in `src/components/` — NOT in `components/` at repo root (boilerplate)
- **Quality gates before done:** `npm run type-check && npm run lint && npm run format:check`

### Testing Strategy (Manual — No Test Framework)

This is a **verification story**, not a feature story. The work is:

1. Manually walk through each acceptance criterion on iOS simulator and Android emulator
2. Log bugs found with reproduction steps
3. Fix bugs following existing code patterns
4. Verify visual consistency against design.ts tokens
5. Run quality gates

### Anti-Patterns to Avoid

- Do NOT create a test framework or test files — this project uses static analysis gates only
- Do NOT refactor working code unless fixing a bug — this is verification, not improvement
- Do NOT add new features or components — Epic 1 is purely validation
- Do NOT change the auth flow architecture — only fix bugs within the existing pattern
- Do NOT modify database schema — only verify RLS and data integrity
- Do NOT skip the confirmation dialog requirement for settings changes

### Project Structure Notes

- Auth routes are in `app/(auth)/` group (unauthenticated)
- Onboarding routes are in `app/onboarding/` (post-signup, pre-home)
- Profile routes are in `app/(tabs)/profile/` (authenticated, tab navigation)
- Privacy policy and terms exist in BOTH auth and profile groups (separate screens, same content)
- Profile cache uses 4-hour TTL in `use-auth.ts` via `src/lib/cache.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Authentication & Onboarding]
- [Source: _bmad-output/planning-artifacts/prd.md#Profile & Settings]
- [Source: _bmad-output/planning-artifacts/prd.md#Non-Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture.md#Code Organization]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md]
- [Source: CLAUDE.md#Architecture]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- All 3 quality gates pass: type-check (0 errors), lint (0 warnings), format:check (all files pass)

### Completion Notes List

**Bugs Found & Fixed:**

1. **Missing captureError in auth catch blocks** — All 3 auth screens (signup, login, forgot-password) and `use-auth.ts` loadProfile had catch blocks that didn't report errors to Sentry. Added `captureError(err, "context")` to all 4 locations.

2. **Missing accessibility attributes on signup screen** — The signup button lacked `accessibilityRole`, `accessibilityLabel`, `accessibilityState`. All 3 text inputs lacked `accessibilityLabel`/`accessibilityHint`. Added them to match login screen's pattern.

3. **Missing accessibility on forgot-password email input** — Added `accessibilityLabel` and `accessibilityHint`.

4. **Missing "I don't know" option in onboarding CEFR level picker** — The onboarding wizard always navigated to placement test regardless of level selection. Added "I don't know" option (sets level to null) which triggers placement test. Selecting a known level now bypasses placement test and sets `onboarding_completed: true` directly.

5. **Missing two-step Delete Account confirmation** — AC#9 requires dialog → type "DELETE". The settings screen only had a single Alert dialog. Added inline confirmation step where user must type "DELETE" to confirm.

6. **Missing try/catch in onboarding handleComplete** — Added try/catch/finally with `captureError` to the onboarding completion handler.

**Verified Working (no changes needed):**

- Signup validation (empty fields, invalid email, weak password)
- Legal notice + terms/privacy links on signup
- Login flow with Supabase auth → home redirect
- SecureStore adapter for auth tokens on native
- Forgot-password reset email flow
- Sign-out with cache clearing and store reset
- Session expiry handling via onAuthStateChange
- Placement test: 15 questions, A1:3/A2:3/B1:3/B2:3/C1:2/C2:1 distribution
- Results screen with mastery/struggle analysis and skeleton loading
- Auth guard preventing onboarding re-entry
- Profile screen: stats, skills (tappable), CEFR chart, error patterns (tappable)
- App version from expo-constants
- Settings confirmation dialogs for level/goal changes
- Privacy policy and terms in-app navigation
- Profile caching with 4h TTL
- Export Data via Share API
- Account deletion via account-delete Edge Function with FK CASCADE
- Visual consistency with design system tokens
- Touch targets >= 44pt

### File List

- `app/(auth)/signup.tsx` — Added captureError import, error reporting in catch, accessibility labels on inputs and button
- `app/(auth)/login.tsx` — Added captureError import and error reporting in catch
- `app/(auth)/forgot-password.tsx` — Added captureError import, error reporting in catch, accessibility on email input
- `src/hooks/use-auth.ts` — Added captureError import, error reporting in loadProfile catch
- `app/onboarding/index.tsx` — Added "I don't know" CEFR option, conditional placement test bypass, try/catch in handleComplete, design token imports
- `app/(tabs)/profile/settings.tsx` — Two-step Delete Account confirmation (dialog → type "DELETE" inline)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Status updated to review
- `_bmad-output/implementation-artifacts/1-1-auth-onboarding-profile-flow-verification.md` — Story file updated

### Change Log

- 2026-03-25: Story implementation complete — 6 bugs found and fixed, all acceptance criteria verified, all quality gates pass
