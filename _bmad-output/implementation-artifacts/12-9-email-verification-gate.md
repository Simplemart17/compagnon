# Story 12.9: Email Verification Gate Before App Loads

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose [`app/_layout.tsx:115-139`](app/_layout.tsx#L115-L139) auth guard branches purely on `session`, `isOnboarded`, and `profileFetchFailed` — it routes any user with a non-null `session` straight to `/onboarding` (or `/(tabs)/home` if already onboarded) **regardless of whether the user has verified their email address** — and whose Supabase project has "Confirm email" enabled (the default; verified via [`/auth/v1/signup`](https://supabase.com/docs/reference/javascript/auth-signup) returning `data.session === null` post-signup when confirmation is required, per [Supabase auth-js GoTrueClient.d.ts:142-148](node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts#L142-L148)), so today an attacker can (a) sign up with `victim@example.com` (a typo of the real owner) and reach onboarding + collect placement-test data + start a Realtime conversation with the AI on the victim's apparent identity until the real owner notices the verification email and clicks the link (which finalises a session for the attacker's device the moment they tap "Verify" in the email — Supabase's magic-link flow is device-bound only when `emailRedirectTo` is set + the device-local browser opens the link), AND (b) automate signup-then-burn flows that abuse the AI cost budget (Story 11-4's `daily_cost_ledger` is per-`auth.uid()` — each fresh unverified account gets a fresh $1.00 daily budget; an automated farm could spin up N accounts and consume N × $1.00 / day in OpenAI charges before any verification gate fires), AND (c) the [`app/(auth)/signup.tsx:133-136`](<app/(auth)/signup.tsx#L133-L136>) success Alert (`"Check Your Email — We sent you a confirmation link"`) tells the user the verification step exists but does NOT block them — the user dismisses the Alert + clicks anywhere + the auth guard's `session && !isOnboarded` branch routes them into onboarding because in fact `signUp` DID return a non-null session (Supabase's behavior: with "Confirm email" ON, the `signUp` response shape is `{user: User | null, session: Session | null}` — `session` is null **when confirmation is required AND the email is NOT yet confirmed**, but `data.user.email_confirmed_at` is undefined, AND on a confirmed-email project `data.session` is populated immediately; the post-12-9 fix verifies via `user.email_confirmed_at` because the `session.user` shape carries the same field and is the authoritative server signal), AND the audit finding **P1-15** at [`shippable-roadmap.md` line 67](_bmad-output/planning-artifacts/shippable-roadmap.md) names the bug exactly: "No email-verification gate before app loads — unconfirmed users reach onboarding — `app/_layout.tsx`, `src/hooks/use-auth.ts` — security", AND the Epic 12.9 deliverable at [`shippable-roadmap.md` line 212](_bmad-output/planning-artifacts/shippable-roadmap.md) describes the fix: "Email verification gate before app loads. **Covers P1-15.**", AND Supabase Auth ships the verification signal as a **first-class field on the `User` object** (`user.email_confirmed_at: string | undefined` per [`auth-js/lib/types.d.ts:356`](node_modules/@supabase/auth-js/dist/main/lib/types.d.ts#L356) — verified 2026-05-13 via Context7 + on-disk type inspection): when the user signs up with confirm-email enabled, the post-signup session (if any) carries a `user` with `email_confirmed_at === undefined`; the **second** `INITIAL_SESSION` event fires after the user taps the confirmation link in their email AND Supabase upgrades the session — at that point `email_confirmed_at` is a timestamp; the **resend-verification API** at `supabase.auth.resend({type: "signup", email})` per [`auth-js/GoTrueClient.d.ts:399`](node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts#L399) lets the user re-trigger the email if they didn't get it, AND the project today has **no email-verification screen** (`grep -rn "email_confirmed_at\|verify\|verification" app src 2>/dev/null` returns ZERO matches outside the `auth-js` node_modules + the existing irrelevant `MFA_CHALLENGE_VERIFIED` switch arm in `auth-events.ts`), AND the **Realtime engine + AI cost budget** that's currently exposed to unverified users is the most direct attack-surface: `realtime-session/index.ts` checks `auth.uid()` via Story 11-4's `check_and_increment_rate_limit` + `check_daily_cost_budget` RPCs, both of which see the fresh-UID attacker as a brand-new user with a fresh $1.00 budget; closing the gate at `app/_layout.tsx` is the architectural single-chokepoint fix that protects every downstream surface (Realtime, AI proxy, mock tests, onboarding placement test, conversation persistence) without needing per-surface guards, AND the established cross-story pattern: Story 9-10's `ProfileRetryScreen` introduced a non-routing render-branch inside `RootLayoutNav` (between `isLoading === false` and the auth-guard's `router.replace`); Story 12-9 adds a **second** non-routing render-branch with the identical pattern — `EmailVerificationGate` — so the verification surface lives in the root layout's render-tree (not a route), preserving the auth guard's invariant that **session-bearing-but-not-app-ready users see a recovery surface, not the wrong route**.

I want (a) a **new pure helper module `src/lib/email-verification.ts`** (~80 lines including JSDoc) exporting: (i) `isEmailVerified(user: User | null): boolean` returning `true` iff `user?.email_confirmed_at` is a non-empty string AND parseable as a finite `Date.parse` value (defense-in-depth: Supabase returns ISO-8601 strings, but a malformed/empty value should be treated as "not verified" rather than panic); the function is null-safe AND undefined-safe; (ii) `RESEND_COOLDOWN_MS = 60_000` constant + `canResendNow(lastResendAtMs: number | null, now: number): boolean` pure helper deciding whether the resend button is enabled (60s cooldown matches Supabase's server-side rate-limit on `resend` — verified 2026-05-13 via the project's Supabase Auth rate-limit defaults; a client-side cooldown gives immediate UX feedback instead of round-tripping to the server to discover the 429); (iii) `secondsUntilResend(lastResendAtMs: number | null, now: number): number` for the countdown UI (returns 0 when cooldown is satisfied; clamps via `Math.max(0, ...)`); (iv) `formatVerificationEmailMask(email: string | undefined): string` localizer returning the user-facing email-display string with the local-part masked (`m***@example.com`) — a defense-in-depth privacy gesture so a user who hands their phone to a stranger to demo the app doesn't reveal their full email; on undefined/empty/malformed input returns `"votre adresse e-mail"` as the French fallback; (b) a **new screen-component `src/components/auth/EmailVerificationGate.tsx`** (~180 lines) — props: `{userEmail: string | undefined; onResendVerification: () => Promise<{error: unknown}>; onSignOut: () => Promise<void>; onRefreshSession: () => Promise<void>}`; renders a centered card with (i) a French headline `"Vérifiez votre adresse e-mail"`, (ii) French body copy `"Nous avons envoyé un lien de vérification à ${maskedEmail}. Cliquez sur le lien dans l'e-mail pour activer votre compte."`, (iii) a "Renvoyer l'e-mail" (Resend) button that calls `onResendVerification` AND on success starts a 60s cooldown timer (the button is disabled + shows `"Renvoyer dans Xs"` countdown; the button re-enables after 60s); on resend error, show an `Alert.alert` with a French message AND `captureError(err, "email-verification-resend")` (NEW Sentry feature tag — added to the Sentry breadcrumb path, NOT to the `SENTRY_EXTRAS_ALLOWLIST` since `feature` is already allowlisted), (iv) a "J'ai vérifié — actualiser" (I've verified — refresh) button that calls `onRefreshSession` — this is the user-driven manual re-check path; calls `supabase.auth.refreshSession()` (verified API per [`auth-js/GoTrueClient.d.ts:411`](node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts#L411) — refreshes the JWT + the `user` object so a freshly-confirmed email reflects in `email_confirmed_at`); the button shows a brief spinner during the refresh + on success the auth guard re-evaluates the (now-verified) user automatically (the `setSession` call inside `decideAuthAction`'s handler triggers a re-render with the updated `user.email_confirmed_at`), (v) a "Se déconnecter" (Sign out) tertiary button that calls `onSignOut` so the user can switch accounts without being trapped on the gate, (vi) the component uses `React.memo` + the cooldown countdown uses a `useEffect` interval that clears on unmount (no setState-after-unmount leak), (vii) **NO polling for verification status** — Supabase does NOT push email-confirmation events to the client automatically; the user MUST come back to the app and click "I've verified" OR re-launch the app for the listener's `INITIAL_SESSION` to re-evaluate (operator decision: client-side polling against `supabase.auth.refreshSession()` every N seconds would consume rate-limit budget + drain battery without adding meaningful UX over the explicit-refresh button), (viii) accessibility: the resend button has `accessibilityRole="button"` + `accessibilityLabel="Resend verification email"` + `accessibilityState={{disabled: !canResend, busy: isResending}}` + the countdown text uses `accessibilityLiveRegion="polite"` so screen readers announce the cooldown progress without spam; (c) **`app/_layout.tsx` modifications** — (i) add `import { EmailVerificationGate } from "@/src/components/auth/EmailVerificationGate"` + `import { isEmailVerified } from "@/src/lib/email-verification"` + `import { resendVerificationEmail, refreshSessionAfterVerification } from "@/src/lib/auth-bootstrap"` (the two new action methods added to `auth-bootstrap.ts` per deliverable (d)); (ii) extract `session` + `user` (already destructured from `useAuth()` at line 68) — `user` is the post-12-9 reading-path; (iii) add a **new render-branch** in `RootLayoutNav` immediately BEFORE the existing `ProfileRetryScreen` branch at line 155 (ordering: `isLoading` → `EmailVerificationGate` → `ProfileRetryScreen` → main app; verification fires UPSTREAM of profile-retry because a user who never verified should never see the retry screen — they shouldn't have reached profile-load), (iv) the new branch reads `if (session && !isEmailVerified(user) && !inAuthGroupRender) return <AppErrorBoundary><EmailVerificationGate userEmail={user?.email} onResendVerification={() => resendVerificationEmail(user?.email ?? "")} onSignOut={signOut} onRefreshSession={refreshSessionAfterVerification} /></AppErrorBoundary>` (signOut comes from `useAuth()`'s existing destructure — the hook already exposes it; we extract it at the top of the component); (v) the routing `useEffect` at lines 115-139 ALSO gets a guard: a session-bearing user whose `!isEmailVerified(user)` is true MUST NOT be redirected to `/onboarding` or `/(tabs)/home` (the render-branch above handles them — but if the routing effect fires first and pushes them into a route, the render-branch will then unmount and the user lands on the wrong screen); the guard is a single `if (session && !isEmailVerified(user) && !inAuthGroup) return;` line added immediately after the existing `if (session && !profile && profileFetchFailed && !inAuthGroup) return;` at line 129, mirroring the ProfileRetryScreen pattern verbatim; (vi) the existing notification-registration `useEffect` at lines 82-92 ALSO gets the verification guard — `if (session && !hasRegisteredNotifications.current && isEmailVerified(user))` — so unverified users don't pre-register push tokens that get orphaned when they abandon the account (an attacker who signs up + abandons should leave NO server-side state attached to their UID); (d) **`src/lib/auth-bootstrap.ts` additions** — add two new exported async functions: (i) `resendVerificationEmail(email: string): Promise<{error: unknown}>` that calls `supabase.auth.resend({type: "signup", email})` (the canonical Supabase API per [auth-js types.d.ts:685-694](node_modules/@supabase/auth-js/dist/main/lib/types.d.ts#L685-L694); the `type: "signup"` discriminator is required to resend a signup-confirmation specifically as opposed to email-change confirmation); returns `{error}` matching the existing `signInWithEmail` / `signUpWithEmail` shape; on `supabase.auth.resend` rate-limit (HTTP 429 from server-side) the error is `{name: "AuthApiError", code: "over_email_send_rate_limit"}` — caller's UX should show a French message; (ii) `refreshSessionAfterVerification(): Promise<void>` that calls `supabase.auth.refreshSession()` — the listener at line 163 will receive a `USER_UPDATED` or `TOKEN_REFRESHED` event with the freshly-confirmed user shape if successful (per Supabase docs; verified via the auth-js type signature returning `AuthTokenResponse` containing `data.user.email_confirmed_at`); on success the listener's `setSession(session)` call updates the store + the auth-guard re-renders against the new `user.email_confirmed_at` and falls through to the routing arms; both functions are **module-level static exports** matching the Story 12-2 bootstrap-as-thin-binding contract (NO React state captured); (e) **`src/hooks/use-auth.ts` re-exports** — add `resendVerificationEmail` + `refreshSessionAfterVerification` to the `export { ... } from "@/src/lib/auth-bootstrap"` block at lines 39-47, mirroring the existing pattern for `signInWithEmail` / `signOut` / etc., AND add them to the `useAuth()` return object at lines 57-69 so consumers can dispatch verification actions through the hook (the gate component is the only consumer in v1, but the symmetry with other auth actions is load-bearing for future test stability + future change-email UI); (f) **`src/lib/auth-events.ts` no change required** — `decideAuthAction` already routes `USER_UPDATED` to `load-profile` with `invalidateCache: true` AND `TOKEN_REFRESHED` to `session-only`; both events fire after `refreshSession()` resolves with a confirmed user; the existing branches are correct AND verified by Story 9-6's test suite — DO NOT touch the switch (regression risk); (g) **Sentry telemetry** — add ONE new feature tag string `"email-verification-resend"` for `captureError` on resend failures; `feature` is already in `SENTRY_EXTRAS_ALLOWLIST` (Story 9-3); NO new extras keys needed (the resend payload is just `{type, email}` and the email is PII so it MUST NOT flow into telemetry — the drift detector in deliverable (k) pins zero `captureError(*, email)` calls); ALSO add ONE new `addBreadcrumb` site in `app/_layout.tsx` when the verification gate first renders (`addBreadcrumb({category: "auth", level: "info", message: "Email verification gate shown", data: {feature: "email-verification-gate"}})`) so operator-side analytics can measure the gate-shown rate; this breadcrumb fires at most once per session-with-unverified-user (the gate component owns a `useEffect` that fires the breadcrumb on first mount, NOT on every re-render); (h) **regression tests** in `src/lib/__tests__/email-verification.test.ts` (~18 Jest cases): (i) `isEmailVerified(null)` returns `false`; (ii) `isEmailVerified({email_confirmed_at: undefined} as User)` returns `false`; (iii) `isEmailVerified({email_confirmed_at: null as any} as User)` returns `false`; (iv) `isEmailVerified({email_confirmed_at: ""} as User)` returns `false` (empty-string defensive); (v) `isEmailVerified({email_confirmed_at: "not a date"} as User)` returns `false` (malformed string defensive — `Date.parse("not a date")` returns NaN); (vi) `isEmailVerified({email_confirmed_at: "2026-05-13T12:00:00Z"} as User)` returns `true`; (vii) `isEmailVerified({email_confirmed_at: new Date().toISOString()} as User)` returns `true`; (viii) `canResendNow(null, 1234567890)` returns `true` — first-time send is never rate-limited by the client; (ix) `canResendNow(0, RESEND_COOLDOWN_MS - 1)` returns `false` (boundary case 1ms before cooldown elapses); (x) `canResendNow(0, RESEND_COOLDOWN_MS)` returns `true` (boundary case at exact cooldown — inclusive boundary); (xi) `canResendNow(0, RESEND_COOLDOWN_MS + 1)` returns `true`; (xii) `secondsUntilResend(null, 100)` returns `0`; (xiii) `secondsUntilResend(0, 30_000)` returns `30` (60 - 30 = 30s remaining); (xiv) `secondsUntilResend(0, 75_000)` returns `0` (clamped, not negative); (xv) `formatVerificationEmailMask("alice@example.com")` returns `"a***@example.com"` (preserves first char + domain); (xvi) `formatVerificationEmailMask("ab@example.com")` returns `"a***@example.com"` (single-char local-part still masked); (xvii) `formatVerificationEmailMask("a@example.com")` returns `"a***@example.com"`; (xviii) `formatVerificationEmailMask(undefined)` returns `"votre adresse e-mail"` (French fallback); (xix) `formatVerificationEmailMask("not-an-email")` returns `"votre adresse e-mail"` (no `@` → fallback); (xx) `formatVerificationEmailMask("")` returns `"votre adresse e-mail"`; (i) **drift detector test** in `src/lib/__tests__/email-verification-source-drift.test.ts` (~7 Jest cases) reads `app/_layout.tsx` from disk + comment-strips per Story 12-2 P12 lesson + asserts: (i) the file imports `isEmailVerified` from `@/src/lib/email-verification`, (ii) the file imports `EmailVerificationGate` from `@/src/components/auth/EmailVerificationGate`, (iii) the routing `useEffect` contains a `!isEmailVerified(user)` guard BEFORE the redirect-to-onboarding branch (regex: an `isEmailVerified` call appears in the routing-effect's body via `extractMethodBody`-style helper or the function-source regex pattern), (iv) the notification-registration `useEffect` contains `isEmailVerified(user)` in the condition (regex match), (v) NEGATIVE guard — `captureError\(.*email\b` regex matches ZERO lines (the email is NEVER passed to Sentry as a free variable — only via the bounded `feature` tag), (vi) the render-branch for the gate appears BEFORE the `ProfileRetryScreen` branch (regex source-line ordering check), (vii) `decideAuthAction` body at `src/lib/auth-events.ts` is NOT modified (the test reads the file from disk and asserts the line count is identical to the current pre-12-9 baseline; OR matches a key invariant string — operator-choose); (j) **regression test on the gate component** in `src/components/auth/__tests__/EmailVerificationGate.test.tsx` (~10 Jest + react-test-renderer cases per Story 12-1 P8 pattern using `react-test-renderer`'s `create` + `act` + a `HookHost`-style consumer): (i) renders with `userEmail="alice@example.com"` → the masked email `"a***@example.com"` appears in the rendered tree; (ii) `userEmail={undefined}` → the French fallback `"votre adresse e-mail"` appears; (iii) tapping "Renvoyer" calls `onResendVerification` once; (iv) immediately after a successful resend, the button is disabled + the countdown text shows `"Renvoyer dans 60s"`; (v) after 60 seconds (`jest.advanceTimersByTime`), the button re-enables; (vi) the resend error path: `onResendVerification` resolves with `{error: {name: "AuthApiError"}}` → an `Alert.alert` is shown with a French message AND `captureError` is called with the `email-verification-resend` feature tag AND the email is NOT in the extras; (vii) tapping "J'ai vérifié — actualiser" calls `onRefreshSession` once; (viii) tapping "Se déconnecter" calls `onSignOut` once; (ix) on unmount, the cooldown interval is cleared (no setState-after-unmount warning — verified by `console.error` spy); (x) accessibility: the resend button has the correct `accessibilityState` flips between disabled/enabled/busy; (k) **NO new packages** — `@supabase/supabase-js` already exports `auth.resend` + `auth.refreshSession`; the new module + component use only built-in React + the existing Supabase client; (l) **NO migration file** — verification status lives in Supabase's `auth.users.email_confirmed_at` column (auto-managed by the Auth service); no schema change; (m) **NO change to `src/lib/auth-events.ts`** — the `decideAuthAction` switch is unchanged (Story 9-6 contract); the verification gate operates on `user.email_confirmed_at` after the listener has already routed the event; (n) **NO change to `app/(auth)/signup.tsx`** — the existing `"Check Your Email"` Alert at line 133-136 stays AS A NUDGE; the verification gate at the root layout is the **enforcement** layer, the Alert is a **discoverability** layer (a future story could remove the Alert if telemetry shows users find the gate equally well, but Story 12-9 keeps both for belt-and-braces); (o) **NO change to `app/(auth)/login.tsx`** — a user with verified email simply doesn't trigger the gate; a user with unverified email logs in successfully (Supabase allows sign-in even with unconfirmed email when "Confirm email" is set to "required for sign-up only" — verified via project-level Auth config; if "required for sign-in" is configured at the dashboard, the sign-in fails before reaching the gate AND the user sees the standard `Login Failed` Alert with the Supabase server message — that's the operator's Layer 2 lever per the runbook in deliverable (q)); (p) **NO change to `auth-bootstrap.ts` action methods OTHER than the two new additions** — `signInWithEmail` / `signUpWithEmail` / `signOut` / `updateProfile` / `retryProfileFetch` bodies are unchanged; (q) **NEW operator runbook `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md`** (~110 lines) documenting the **two-layer defense** — Layer 1 (client-side gate at `_layout.tsx` + new module + gate component) + Layer 2 (Supabase Dashboard → Authentication → Providers → Email → **"Confirm email"** toggle + the related rate-limit + email-template config); the runbook includes (a) a step-by-step walkthrough for the operator to verify "Confirm email" is ON, (b) the **email-template customization** sub-section (Supabase Dashboard → Authentication → Email Templates → "Confirm signup") — operator-side action item to swap the default Supabase generic template for a Companion-branded French email AS A FOLLOW-UP STORY (out of scope for 12-9; documented here so the operator knows the surface exists), (c) a **verification recipe** — sign up a fresh account with `curl` against `/auth/v1/signup`, confirm the response body contains `user.email_confirmed_at === null`, sign in with the same credentials, expect to land on the EmailVerificationGate screen; then manually click the confirmation link in the inbox; refresh the app; expect to land on `/onboarding`, (d) **HIBP rate-limit doc cross-link** — the resend cooldown matches Supabase's server-side rate-limit; (e) **operator decision log placeholder** for post-deploy fill-in, AND (f) cross-story dependencies — Story 12-8 (password policy) + 12-9 (email verification) are sibling-stories that BOTH must be applied at the dashboard for a hardened auth surface; (r) **CLAUDE.md architecture line** added after the Story 12-8 paragraph documenting: the new `email-verification.ts` module + `isEmailVerified` semantics + the gate component + the `auth-bootstrap.ts` `resendVerificationEmail` + `refreshSessionAfterVerification` actions + the 3 new auth guards in `_layout.tsx` (render-branch + routing-effect + notification-registration) + cross-story invariants preserved (9-3 Sentry — one new feature tag only / 9-6 auth-listener — unchanged / 9-10 ProfileRetryScreen — verification fires UPSTREAM / 12-2 bootstrap — additive only / 12-8 password-policy — orthogonal) + closes audit P1-15 architecturally; the operator runbook path is referenced inline,

so that **audit finding P1-15 closes architecturally** — every screen + every Edge Function downstream of the auth guard is protected by the single chokepoint; new attackers cannot reach AI cost budget, Realtime sessions, or onboarding placement-test surface until they prove email ownership via the verification link; **abandoned-account abuse is bounded** — an unverified UID has zero server-side write footprint (no push token, no profile, no progress rows) because the gate fires UPSTREAM of every state-mutating screen; **the user gets clear French recovery paths** — masked email display, 60s-cooldown resend, manual refresh button, sign-out escape hatch; **the resend cooldown is client-side fast-feedback** — no server round-trip to discover the 429; **the operator gets full Layer 2 control** — dashboard toggle + email template customization documented; **the email never flows to Sentry** — the new drift detector pins zero `captureError(*, email)` calls; **the verification status is server-authoritative** — `email_confirmed_at` comes from Supabase, not from any client-cached flag (so a malicious app rebuild that flips a local flag cannot bypass the gate); **cross-story invariants are preserved** — `decideAuthAction` switch untouched, `signUpWithEmail` body unchanged, Story 12-8 password validator + Story 12-7 secure-cache untouched, Story 9-10 ProfileRetryScreen ordering preserved (verification fires UPSTREAM of profile-retry by deliberate placement), Story 11-4 daily-cost-cap continues to enforce per-UID quotas (now applied only to verified users); **the password change story will reuse this gate** — a future password-change-confirm screen consuming the `refreshSessionAfterVerification` symmetry will use the same pattern; **NIST + OWASP alignment** — NIST 800-63B §4.2 implies email-ownership verification before granting subscriber binding; OWASP ASVS V6.1.1 requires verified email before account activation; **Story 12-9 closes 1 audit finding (P1-15) as a SMALL discrete story** — 1 new lib module + 1 new component + 1 modified screen (`_layout.tsx`) + 2 new action methods + 1 new runbook + 2 test files + 0 packages + 0 migrations; total diff < 800 lines.

## Background — Why This Story Exists

### What audit finding P1-15 owns to this story

[`shippable-roadmap.md` line 67](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P1-15 — No email-verification gate before app loads — unconfirmed users reach onboarding — `app/_layout.tsx`, `src/hooks/use-auth.ts` — security"

Epic 12.9 deliverable at [`shippable-roadmap.md` line 212](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Email verification gate before app loads. **Covers P1-15.**"

### Current state — the bug at the auth-guard path

Pre-12-9 [`app/_layout.tsx:115-139`](app/_layout.tsx#L115-L139) (`RootLayoutNav`'s routing `useEffect`):

```typescript
if (session && !profile && profileFetchFailed && !inAuthGroup) return;

if (!session && !inAuthGroup) {
  router.replace("/(auth)/login");
} else if (session && !isOnboarded && !inOnboarding) {
  router.replace("/onboarding");
} else if (session && isOnboarded && (inAuthGroup || inOnboarding)) {
  router.replace("/(tabs)/home");
}
```

There is **no guard on `user.email_confirmed_at`**. A session-bearing user with `email_confirmed_at === undefined` is routed straight to `/onboarding` (or `/(tabs)/home` if onboarded).

### Threat model — what unverified-but-session-bearing access permits today

| Surface | Pre-12-9 exposure | Post-12-9 protection |
| --- | --- | --- |
| Onboarding placement test (15 AI-generated MCQs at `gpt-4o`) | ✅ Reachable; ~$0.05 in AI cost per fresh UID | ❌ Gate fires; placement test unreachable |
| Realtime conversation (`gpt-realtime-mini` at ~5¢/5-min) | ✅ Reachable; daily cap $1.00 per UID | ❌ Gate fires; Realtime unreachable |
| Practice exercises (listening/reading/writing/grammar via `gpt-4o`) | ✅ Reachable; ~$0.001 per exercise | ❌ Gate fires; practice unreachable |
| Mock test generation (~$0.04 per section × 3 sections) | ✅ Reachable | ❌ Gate fires |
| Push notification registration | ✅ Token registered to abandoned UID | ❌ Guarded by `isEmailVerified(user)` |
| Profile cache write to SecureStore (Story 12-7) | ✅ Encrypted PII for abandoned UID | ❌ Verification fires upstream of profile load |
| Conversation persistence + transcript + memory + error patterns | ✅ Rows written under abandoned UID | ❌ Unreachable behind gate |
| Account-delete Edge Function | ✅ Available | ✅ Still available (the gate user can sign out + abandon the UID — auto-cleanup is Epic 16.X scope) |

The economic worst case is a botnet spinning up N fresh UIDs and consuming N × $1.00 / day in OpenAI charges via Story 11-4's per-UID daily-cost-cap. The gate closes this at the chokepoint.

### Supabase `email_confirmed_at` semantics — verified 2026-05-13

From [`auth-js/lib/types.d.ts:356`](node_modules/@supabase/auth-js/dist/main/lib/types.d.ts#L356) (verified via on-disk inspection of `node_modules` in the project + cross-checked against the [Supabase Auth API Reference](https://supabase.com/docs/reference/javascript/auth-getuser)):

```typescript
type User = {
  // ...
  email_confirmed_at?: string;  // ISO-8601 timestamp; undefined when unverified
  // ...
};
```

The field is **server-authoritative** — it lives in Supabase's `auth.users` table and is set by the Auth service when the user clicks the confirmation link in their email. The session JWT does NOT carry it directly, but `getSession()` + `refreshSession()` always return a fresh `user` object that reflects the latest server state. The auth listener's `setSession(session)` call (already wired in Story 9-6 at [`auth-bootstrap.ts:165`](src/lib/auth-bootstrap.ts#L165)) propagates the latest `session.user` to `useAuthStore`, so consumers reading `user.email_confirmed_at` always see the post-refresh value.

### The `signUp` response shape with "Confirm email" enabled — verified

From [`auth-js/GoTrueClient.d.ts:142-148`](node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts#L142-L148):

> "By default, the user needs to verify their email address before logging in. To turn this off, disable **Confirm email** in [your project](/dashboard/project/_/auth/providers).
> - If **Confirm email** is enabled, a `user` is returned but `session` is null.
> - If **Confirm email** is disabled, both a `user` and a `session` are returned."

So a **fresh signup against a Supabase project with "Confirm email" enabled** returns `{user: <user with email_confirmed_at: undefined>, session: null}`. The user is then redirected to login (existing `_layout.tsx` behavior since `session === null`), AND can sign in with their credentials — at which point Supabase issues a session AND the `user` object STILL has `email_confirmed_at: undefined` until the user clicks the confirmation link. The post-12-9 gate runs against this `user` shape.

### Why route inside `email-verification.ts` instead of inline?

Two design options:

1. **Inline in `_layout.tsx`** — write the boolean check + the gate component + the resend action inline. Pro: smallest possible diff. Con: future re-verification UI (change-email confirmation, MFA enrollment) duplicates the rule; drift inevitable.

2. **Extracted `email-verification.ts` + `EmailVerificationGate.tsx`** (chosen) — single source of truth. Pro: future verification surfaces consume one helper; drift impossible because the rule + ms constants live in one file; testable as pure functions. Con: 2 extra files in the diff.

Option 2 mirrors Story 12-8's `password-policy.ts` extraction pattern and Story 12-7's `secure-cache.ts` pattern — both ratified by the round-1/round-2 review process.

### Why NOT poll for verification status?

Two alternatives considered:

1. **Client-side polling** — call `supabase.auth.refreshSession()` every 5s while the gate is open. **Rejected** because (a) it consumes Supabase's per-IP rate-limit budget (default 30/min — a 5s poll burns 12/min), (b) drains battery + cellular data, (c) the user has to come back to the app anyway after clicking the email link (mobile email clients open the link in their default browser; the app is backgrounded), so polling provides zero UX over the explicit "I've verified — refresh" button.

2. **Push-based notification from Supabase** — Supabase does NOT push email-confirmation events to the client (no realtime channel for `auth.users` row updates by default; the `auth` schema is excluded from row-level replication for security reasons; verified via the [Supabase Realtime docs](https://supabase.com/docs/guides/realtime/postgres-changes) — auth tables are not in the default replication set). **Rejected** because it would require server-side custom plumbing out of scope.

The explicit "I've verified — refresh" button is the chosen UX: low-cost, user-driven, and the same pattern reset-password flows use.

### Why NOT integrate with Linking deep-link handler?

Supabase's confirmation email contains a link of the form `https://<project>.supabase.co/auth/v1/verify?token=...` which redirects to the `emailRedirectTo` URL configured in `supabase.auth.signUp({options: {emailRedirectTo}})`. If `emailRedirectTo` is set to `companion://verify-email`, the Companion app could intercept the link via Expo Router's deep-link handler + auto-refresh the session.

**Out of scope for 12-9** because:
1. The `signUp` call at [`auth-bootstrap.ts:339-346`](src/lib/auth-bootstrap.ts#L339-L346) does NOT pass `emailRedirectTo` today; adding it requires testing the iOS/Android deep-link round-trip across simulator + real-device with email-client-controlled link handling.
2. Most users open email on a different device (laptop) than the one they signed up on (phone) — deep-link interception would only work in a minority of flows.
3. The explicit "I've verified — refresh" button is the universal fallback that works regardless of deep-link wiring.

A follow-up story can wire deep-link interception once the chokepoint gate ships.

### Why NOT enforce policy via SQL trigger?

Verification status lives in `auth.users.email_confirmed_at` — a column owned by the Supabase Auth service, NOT a project-schema table. Operator-application code cannot trigger on it (RLS doesn't run on `auth.*` for non-service-role connections). Even if it could, gating server-side at every RPC + Edge Function call would multiply the surface area to defend; the client-side `_layout.tsx` chokepoint is the architecturally correct boundary because (a) it's a single chokepoint, (b) it provides UX recovery flows (resend, refresh, sign-out), (c) all downstream surfaces inherit protection for free.

### Why NOT block sign-in at the Supabase Auth dashboard layer?

Supabase Auth's "Confirm email" toggle (Dashboard → Auth → Providers → Email) has TWO modes:

1. **"Required for sign-up"** (default) — `signUp` returns `{user, session: null}` AND `signInWithPassword` succeeds with `{user, session}` where `user.email_confirmed_at === null`. Story 12-9 handles this mode.
2. **"Required for sign-in too"** — `signInWithPassword` rejects with `error.code === "email_not_confirmed"`. The user never gets a session.

**Story 12-9 does NOT depend on which mode is configured.** Mode 1: the gate fires after sign-in completes. Mode 2: the gate is never reached because sign-in fails first, BUT the sign-in error surfaces as a Supabase error code; the runbook in deliverable (q) documents both modes and the operator-decision rationale (Mode 2 is stricter but has worse UX — users get a confusing English error message; Mode 1 + gate gives a French recovery surface).

### Spec — `src/lib/email-verification.ts` shape

```typescript
import type { User } from "@supabase/supabase-js";

/**
 * Resend cooldown in milliseconds (client-side fast-feedback layer).
 * Mirrors Supabase's server-side rate-limit on `auth.resend` so the user
 * gets immediate "wait 60s" feedback instead of a server 429.
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Returns true iff the user's email is server-confirmed.
 *
 * Defensive against:
 *   - null / undefined user (logged-out state).
 *   - undefined / null `email_confirmed_at` field (pre-verification state).
 *   - empty string `email_confirmed_at` (malformed/legacy data).
 *   - non-ISO-8601 strings (malformed/legacy data — `Date.parse` returns NaN).
 */
export function isEmailVerified(user: User | null | undefined): boolean {
  const ts = user?.email_confirmed_at;
  if (typeof ts !== "string" || ts.length === 0) return false;
  const ms = Date.parse(ts);
  return Number.isFinite(ms);
}

/**
 * Returns true iff the resend button should be enabled NOW.
 *
 * @param lastResendAtMs The Date.now() value at the previous resend, or null
 *   if no resend has been issued yet this session.
 * @param now The current Date.now() value.
 */
export function canResendNow(lastResendAtMs: number | null, now: number): boolean {
  if (lastResendAtMs === null) return true;
  return now - lastResendAtMs >= RESEND_COOLDOWN_MS;
}

/**
 * Returns the integer seconds remaining until resend is permitted again.
 * Clamped at 0 (never returns negative).
 */
export function secondsUntilResend(lastResendAtMs: number | null, now: number): number {
  if (lastResendAtMs === null) return 0;
  const remainingMs = RESEND_COOLDOWN_MS - (now - lastResendAtMs);
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * Returns a user-facing display string with the local-part masked.
 *
 * Examples:
 *   formatVerificationEmailMask("alice@example.com")  // "a***@example.com"
 *   formatVerificationEmailMask("a@example.com")      // "a***@example.com"
 *   formatVerificationEmailMask(undefined)             // "votre adresse e-mail"
 *   formatVerificationEmailMask("not-an-email")        // "votre adresse e-mail"
 */
export function formatVerificationEmailMask(email: string | undefined): string {
  if (!email || email.length === 0) return "votre adresse e-mail";
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return "votre adresse e-mail";
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  return `${local[0]}***${domain}`;
}
```

### Spec — `src/components/auth/EmailVerificationGate.tsx` shape

```typescript
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import {
  RESEND_COOLDOWN_MS,
  canResendNow,
  formatVerificationEmailMask,
  secondsUntilResend,
} from "@/src/lib/email-verification";
import { Colors, Radii, Spacing, Typography } from "@/src/lib/design";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";

interface Props {
  userEmail: string | undefined;
  onResendVerification: (email: string) => Promise<{ error: unknown }>;
  onSignOut: () => Promise<void>;
  onRefreshSession: () => Promise<void>;
}

function EmailVerificationGateImpl({
  userEmail,
  onResendVerification,
  onSignOut,
  onRefreshSession,
}: Props) {
  const [lastResendAtMs, setLastResendAtMs] = useState<number | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const resendingRef = useRef(false);
  const breadcrumbFiredRef = useRef(false);

  // Tick once per second while the cooldown is active to drive the
  // countdown UI. Stops automatically when canResendNow becomes true.
  useEffect(() => {
    if (canResendNow(lastResendAtMs, now)) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [lastResendAtMs, now]);

  // Fire the gate-shown breadcrumb exactly once per gate-mount.
  useEffect(() => {
    if (breadcrumbFiredRef.current) return;
    breadcrumbFiredRef.current = true;
    addBreadcrumb({
      category: "auth",
      level: "info",
      message: "Email verification gate shown",
      data: { feature: "email-verification-gate" },
    });
  }, []);

  const handleResend = useCallback(async () => {
    if (resendingRef.current) return;
    if (!canResendNow(lastResendAtMs, Date.now())) return;
    if (!userEmail) return;
    resendingRef.current = true;
    setIsResending(true);
    try {
      const { error } = await onResendVerification(userEmail);
      if (error) {
        captureError(error, "email-verification-resend");
        Alert.alert(
          "Erreur",
          "Impossible d'envoyer l'e-mail de vérification. Veuillez réessayer dans une minute."
        );
        return;
      }
      setLastResendAtMs(Date.now());
      setNow(Date.now());
    } finally {
      resendingRef.current = false;
      setIsResending(false);
    }
  }, [lastResendAtMs, onResendVerification, userEmail]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefreshSession();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshSession]);

  const handleSignOut = useCallback(async () => {
    await onSignOut();
  }, [onSignOut]);

  const canResend = canResendNow(lastResendAtMs, now) && !isResending && !!userEmail;
  const remainingSeconds = secondsUntilResend(lastResendAtMs, now);
  const maskedEmail = formatVerificationEmailMask(userEmail);

  return (
    <View /* layout — see Polish Requirements */>
      {/* Headline: "Vérifiez votre adresse e-mail" */}
      {/* Body: "Nous avons envoyé un lien de vérification à {maskedEmail}..." */}
      {/* Resend button — disabled state + "Renvoyer dans Xs" countdown */}
      {/* Refresh button — primary CTA */}
      {/* Sign-out button — tertiary */}
    </View>
  );
}

export const EmailVerificationGate = memo(EmailVerificationGateImpl);
```

### Spec — `src/lib/auth-bootstrap.ts` additions

```typescript
/**
 * Resend the email-verification confirmation email (Story 12-9).
 *
 * Uses the `type: "signup"` discriminator per Supabase's
 * ResendParams contract. The server-side rate-limit is 1 request per email
 * per 60s; the client-side `RESEND_COOLDOWN_MS` cooldown fires the same
 * duration to give immediate UX feedback before the server 429.
 */
export async function resendVerificationEmail(email: string): Promise<{ error: unknown }> {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
  });
  return { error };
}

/**
 * Manually refresh the session — the user-driven re-check path after they
 * tap the verification link in their email (Story 12-9).
 *
 * The auth listener (Story 9-6 / 12-2) receives a USER_UPDATED or
 * TOKEN_REFRESHED event with the freshly-confirmed user shape and
 * propagates `setSession(session)` to the store. The gate component then
 * re-renders against the new `user.email_confirmed_at` and the auth-guard
 * falls through to the routing arms.
 */
export async function refreshSessionAfterVerification(): Promise<void> {
  await supabase.auth.refreshSession();
}
```

### Spec — `app/_layout.tsx` modifications

```diff
+ import { isEmailVerified } from "@/src/lib/email-verification";
+ import { EmailVerificationGate } from "@/src/components/auth/EmailVerificationGate";

  function RootLayoutNav() {
-   const { session, user, profile, isLoading, isOnboarded, profileFetchFailed, retryProfileFetch } =
-     useAuth();
+   const {
+     session,
+     user,
+     profile,
+     isLoading,
+     isOnboarded,
+     profileFetchFailed,
+     retryProfileFetch,
+     resendVerificationEmail,
+     refreshSessionAfterVerification,
+     signOut,
+   } = useAuth();

    // ... existing effects ...

    // Notification registration — guard on verification (prevents
    // orphan tokens from abandoned unverified UIDs).
-   if (session && !hasRegisteredNotifications.current) {
+   if (session && !hasRegisteredNotifications.current && isEmailVerified(user)) {
      // ...
    }

    // Routing effect:
    if (session && !profile && profileFetchFailed && !inAuthGroup) return;

+   // Story 12-9: unverified-but-session-bearing users must not be
+   // routed into onboarding / app. The render-branch below shows the gate.
+   if (session && !isEmailVerified(user) && !inAuthGroup) return;

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && !isOnboarded && !inOnboarding) {
      // ...
    }
  }

  // Render-branch ordering: isLoading → EmailVerificationGate → ProfileRetryScreen → main
  if (isLoading) return null;

+ // Story 12-9: render the verification gate UPSTREAM of ProfileRetryScreen
+ // so an unverified user never reaches profile-load.
+ const inAuthGroupRender = segments[0] === "(auth)";
+ if (session && !isEmailVerified(user) && !inAuthGroupRender) {
+   return (
+     <AppErrorBoundary>
+       <EmailVerificationGate
+         userEmail={user?.email}
+         onResendVerification={resendVerificationEmail}
+         onSignOut={signOut}
+         onRefreshSession={refreshSessionAfterVerification}
+       />
+     </AppErrorBoundary>
+   );
+ }

  if (session && !profile && profileFetchFailed && !inAuthGroupRender) {
    // ... ProfileRetryScreen branch (unchanged) ...
  }
```

### Spec — runbook `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md`

Sections (~110 lines total):

1. **Layer 1 (client-side, deployed by Story 12-9)** — what the gate does; files changed; ordering relative to `ProfileRetryScreen`.
2. **Layer 2 (server-side, OPERATOR ACTION REQUIRED)** — Supabase Dashboard config:
   - Navigate to `https://supabase.com/dashboard/project/{PROJECT_REF}/auth/providers`.
   - Click "Email" provider.
   - Verify "Confirm email" toggle is **ON** (this is the Supabase default; do not disable unless rolling back).
   - Operator decision: leave at "Required for sign-up" (default) OR set to "Required for sign-in too" (stricter; rejects login until email confirmed). Story 12-9 supports BOTH modes; trade-offs documented inline.
3. **Email template customization (optional, OPERATOR FOLLOW-UP)** — Dashboard → Authentication → Email Templates → "Confirm signup". Default Supabase template is generic English; a follow-up story can swap it for a Companion-branded French template. **Out of scope for 12-9.**
4. **Verification recipe** — `curl` against `/auth/v1/signup` with a fresh email; expect `user.email_confirmed_at === null` in the response; sign in with the same credentials; expect to land on the verification gate in the app.
5. **Rollback procedure** — to disable verification gating in an emergency: toggle "Confirm email" OFF in the dashboard. Existing unverified users continue to see the client-side gate until they verify OR until a follow-up story removes the client-side enforcement.
6. **Cross-story dependencies** — Story 12-8 (password policy) + 12-9 (email verification) are sibling stories that BOTH must be applied at the dashboard for a hardened auth surface.
7. **Operator decision log** — date the operator confirmed the Auth dashboard config; whether "Confirm email" is set to "Required for sign-up" or "Required for sign-in too"; the deployment commit SHA.

## Acceptance Criteria

1. **Client-side verification helper module exists.** [`src/lib/email-verification.ts`](src/lib/email-verification.ts) is created with: `isEmailVerified(user)` server-state-only check; `RESEND_COOLDOWN_MS = 60_000` constant; `canResendNow(lastResendAtMs, now)` boundary-inclusive predicate; `secondsUntilResend(lastResendAtMs, now)` clamped-non-negative integer formatter; `formatVerificationEmailMask(email)` privacy-mask localizer with the French `"votre adresse e-mail"` fallback. All exports have JSDoc explaining the rule + cross-references to the runbook + Supabase API contract.

2. **Verification gate component exists.** [`src/components/auth/EmailVerificationGate.tsx`](src/components/auth/EmailVerificationGate.tsx) is created with `{userEmail, onResendVerification, onSignOut, onRefreshSession}` props; renders the French headline + masked-email body + 3 buttons (Resend / Refresh / Sign-out); uses `React.memo`; tracks resend cooldown in local state; fires the `"Email verification gate shown"` breadcrumb exactly once per mount; uses `Colors.*` / `Typography.*` design tokens (NO hardcoded hex / NO raw fontSize); has full accessibility wiring (`accessibilityRole` + `accessibilityLabel` + `accessibilityState` + `accessibilityLiveRegion="polite"` on the countdown).

3. **Auth bootstrap exports the two new action methods.** [`src/lib/auth-bootstrap.ts`](src/lib/auth-bootstrap.ts) gains `resendVerificationEmail(email)` (calls `supabase.auth.resend({type: "signup", email})`) AND `refreshSessionAfterVerification()` (calls `supabase.auth.refreshSession()`). Both are module-level static exports matching the Story 12-2 thin-binding contract.

4. **`useAuth()` hook re-exports the new actions.** [`src/hooks/use-auth.ts`](src/hooks/use-auth.ts)'s `export { ... } from "@/src/lib/auth-bootstrap"` block adds the two new functions AND the `useAuth()` return object exposes them as fields — the gate component reads them through the hook return shape, NOT via direct module import.

5. **`app/_layout.tsx` enforces the gate.** [`app/_layout.tsx`](app/_layout.tsx) is modified to (a) import `isEmailVerified` + `EmailVerificationGate`; (b) destructure `signOut`, `resendVerificationEmail`, `refreshSessionAfterVerification` from `useAuth()`; (c) add the routing-effect guard `if (session && !isEmailVerified(user) && !inAuthGroup) return;` immediately AFTER the existing `ProfileRetryScreen` routing guard; (d) add the notification-registration guard `&& isEmailVerified(user)`; (e) add the render-branch for `EmailVerificationGate` immediately BEFORE the `ProfileRetryScreen` render-branch.

6. **Render-branch ordering is verification-first.** Inside `RootLayoutNav`, the render-branches fire in this order: `isLoading` → `EmailVerificationGate` (Story 12-9) → `ProfileRetryScreen` (Story 9-10) → main app. An unverified user MUST NOT reach the profile-retry path.

7. **Operator runbook exists.** [`_bmad-output/planning-artifacts/runbooks/auth-email-verification.md`](_bmad-output/planning-artifacts/runbooks/auth-email-verification.md) is created with the 7 sections in deliverable (q)'s spec: Layer 1 description / Layer 2 dashboard config walkthrough / email-template customization follow-up / verification recipe / rollback procedure / cross-story dependencies / operator decision log.

8. **Helper-module regression tests pass.** [`src/lib/__tests__/email-verification.test.ts`](src/lib/__tests__/email-verification.test.ts) covers the 20 cases enumerated in deliverable (h). Key edge cases: empty-string `email_confirmed_at` → false; malformed ISO string → false; valid ISO → true; cooldown boundary at exactly `RESEND_COOLDOWN_MS` is inclusive (true); single-char local-part still masks (`"a@..."` → `"a***@..."`); undefined email → French fallback.

9. **Source-drift detector test passes.** [`src/lib/__tests__/email-verification-source-drift.test.ts`](src/lib/__tests__/email-verification-source-drift.test.ts) covers the 7 source-drift cases in deliverable (i) — reads `app/_layout.tsx` from disk, comment-strips per Story 12-2 P12 lesson, and asserts the imports + the guard regex inside the routing-effect body + the notification-effect body + the render-branch ordering + the negative `captureError(*, email)` guard + the `decideAuthAction` invariance check.

10. **Gate-component runtime test passes.** [`src/components/auth/__tests__/EmailVerificationGate.test.tsx`](src/components/auth/__tests__/EmailVerificationGate.test.tsx) covers the 10 runtime cases in deliverable (j) using `react-test-renderer`'s `create` + `act` + `jest.useFakeTimers()` for the cooldown countdown. Verifies: masked email renders / Resend dispatches / cooldown 60s lockout / countdown decrement / re-enable on tick / Resend error → captureError + French Alert + email NOT in extras / Refresh dispatch / Sign-out dispatch / no setState-after-unmount / accessibility state flips.

11. **Tests pass.** `npm test` exit code 0; new test file count is +3; total Jest case count rises by ~37 cases (20 + 7 + 10 = 37; minor variance acceptable).

12. **Quality gates green.** `npm run type-check && npm run lint && npm run format:check` all pass.

13. **No `captureError(*, email)` anywhere.** The drift detector pins this; manual `grep -rn "captureError" app src 2>/dev/null | grep -i email` returns empty (modulo the literal `"email-verification-resend"` feature-tag string which is a categorical Sentry breadcrumb tag, not the user's email value).

14. **Cross-story invariants preserved.**
    - Story 9-3: ONE new feature tag string `"email-verification-resend"` (no new extras keys; `feature` already allowlisted).
    - Story 9-4: the new module is pure-data validation; no user-derived prompt path; the email is never injected into AI prompts.
    - Story 9-6: `decideAuthAction` switch unchanged; auth listener body unchanged.
    - Story 9-10: `ProfileRetryScreen` ordering preserved — verification gate fires UPSTREAM. The `profileFetchFailed` flag is NOT consumed by the verification path.
    - Story 11-4: per-UID daily-cost-cap continues to enforce quotas (now applied only to verified users — UNVERIFIED UIDs cannot reach the AI surface to consume budget).
    - Story 12-1: `RealtimeOrchestrator` is unreachable behind the gate — the conversation screen mount is blocked by the routing-effect guard.
    - Story 12-2: `bootstrapAuth()` body unchanged; only NEW module-level static action exports are added.
    - Story 12-3 / 12-4 / 12-5 / 12-6 / 12-7: orthogonal; no realtime / activity / audio / transcript / cache surfaces touched.
    - Story 12-8: orthogonal — password policy and email verification are sibling Auth surfaces; both consume Supabase Auth APIs at the signup boundary without overlap.

15. **CLAUDE.md architecture line added** after the Story 12-8 paragraph documenting the new module + gate component + `auth-bootstrap.ts` additions + the 3 new auth guards in `_layout.tsx` (render-branch + routing-effect + notification-registration) + cross-story invariant-preservation list + verification date.

16. **No new packages, no migrations, no Edge Function changes.** `package.json` diff: 0 lines. `supabase/migrations/` diff: 0 files added. `supabase/functions/` diff: 0 lines.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (the gate uses `Colors.bgDark` / `Colors.surfaceWhite` / `Colors.accent` / `Colors.error` / `Colors.textPrimary` / `Colors.textSecondary` / `Colors.textTertiary` / `Colors.textOnDark`).
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners. (Resend / Refresh have brief in-button state changes via `accessibilityState.busy`; no spinner component required because both are sub-second operations on success path.)
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`. (Resend / Refresh / Sign-out buttons each carry both.)
- [x] Non-obvious interactions have `accessibilityHint`. (Resend button: `"Sends a fresh verification email to your address. Disabled for 60s after each send."`; Refresh button: `"Checks if you've verified your email. Tap after clicking the link in your inbox."`.)
- [x] Stateful elements have `accessibilityState`. (Resend button: `{disabled: !canResend, busy: isResending}`; Refresh button: `{busy: isRefreshing}`.)
- [x] All tappable elements have minimum 44x44pt touch targets. (All 3 buttons have `minHeight: 44` per the existing `ProfileRetryScreen` pattern at [`app/_layout.tsx:245`](app/_layout.tsx#L245).)
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`. (The resend error path uses `captureError(err, "email-verification-resend")`; the refresh error path is a fire-and-forget — Supabase logs the failure server-side AND the user can re-tap.)
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`. (Gate uses `Typography.screenTitle` for headline, `Typography.body` for body copy, `Typography.label` for buttons, `Typography.caption` for the countdown text.)
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`. Verifying that the file is *visible to git but not yet tracked* catches the ignore-rule footgun before story 1 of any future project.
-->

- [x] `git status` lists this story file under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-9-email-verification-gate.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] **Task 1 — Create `src/lib/email-verification.ts` module** (AC: #1)
  - [x] Subtask 1.1: Add `RESEND_COOLDOWN_MS = 60_000` constant.
  - [x] Subtask 1.2: Implement `isEmailVerified(user): boolean` with defensive checks for null user / undefined-or-empty `email_confirmed_at` / malformed-ISO via `Date.parse` + `Number.isFinite`.
  - [x] Subtask 1.3: Implement `canResendNow(lastResendAtMs, now): boolean` with first-time-true semantics on null AND inclusive boundary at exactly `RESEND_COOLDOWN_MS`.
  - [x] Subtask 1.4: Implement `secondsUntilResend(lastResendAtMs, now): number` clamped-non-negative via `Math.max(0, ...)` and rounded UP via `Math.ceil` so 1.1s remaining displays as "2s" (never "0s remaining" while still actually waiting).
  - [x] Subtask 1.5: Implement `formatVerificationEmailMask(email): string` with the `"votre adresse e-mail"` French fallback for undefined/empty/no-`@` input.
  - [x] Subtask 1.6: Add JSDoc to every export with the threat-model rationale + cross-references to the runbook + Supabase API contract.

- [x] **Task 2 — Add `auth-bootstrap.ts` action methods** (AC: #3)
  - [x] Subtask 2.1: Add `resendVerificationEmail(email: string): Promise<{error: unknown}>` calling `supabase.auth.resend({type: "signup", email})`.
  - [x] Subtask 2.2: Add `refreshSessionAfterVerification(): Promise<void>` calling `supabase.auth.refreshSession()` (return value intentionally discarded — the listener handles the resolved session via the existing event-driven flow).
  - [x] Subtask 2.3: Add JSDoc to both functions documenting the Supabase API contract + cross-references to Story 12-9.

- [x] **Task 3 — Update `useAuth()` hook re-exports** (AC: #4)
  - [x] Subtask 3.1: Add `resendVerificationEmail` + `refreshSessionAfterVerification` to the `export { ... } from "@/src/lib/auth-bootstrap"` block.
  - [x] Subtask 3.2: Add both fields to the `useAuth()` return object.
  - [x] Subtask 3.3: Verify all 8 existing `useAuth()` callers still compile (TypeScript exhaustiveness — adding a return field is backwards-compatible).

- [x] **Task 4 — Create `src/components/auth/EmailVerificationGate.tsx` component** (AC: #2)
  - [x] Subtask 4.1: Scaffold the file with `{userEmail, onResendVerification, onSignOut, onRefreshSession}` props. Wrap in `React.memo`.
  - [x] Subtask 4.2: Local state: `lastResendAtMs: number | null` + `isResending: boolean` + `isRefreshing: boolean` + `now: number` (for cooldown countdown ticking). Refs: `resendingRef` (synchronous double-tap guard) + `breadcrumbFiredRef` (one-shot breadcrumb).
  - [x] Subtask 4.3: Implement the cooldown-tick `useEffect` — `setInterval(() => setNow(Date.now()), 1000)` while `!canResendNow`; clear interval on cooldown-satisfied OR unmount. Verify no setState-after-unmount via cleanup.
  - [x] Subtask 4.4: Implement the one-shot gate-shown breadcrumb `useEffect` — fires `addBreadcrumb({category: "auth", level: "info", message: "Email verification gate shown", data: {feature: "email-verification-gate"}})` exactly once per mount.
  - [x] Subtask 4.5: Implement `handleResend` with the synchronous double-tap guard (Story 9-10 ProfileRetryScreen pattern) + the email-empty short-circuit + the success-path `setLastResendAtMs(Date.now())` + the error-path `captureError(err, "email-verification-resend")` + French Alert.
  - [x] Subtask 4.6: Implement `handleRefresh` calling `onRefreshSession()` with `isRefreshing` state.
  - [x] Subtask 4.7: Implement `handleSignOut` calling `onSignOut()` (fire-and-forget; the auth listener will handle the SIGNED_OUT event).
  - [x] Subtask 4.8: Render the layout — centered card with headline + masked-email body + Resend button + Refresh button + Sign-out tertiary. Use `Colors.*` + `Typography.*` + design-token spacing throughout.
  - [x] Subtask 4.9: Wire accessibility — per-button `accessibilityRole="button"` + `accessibilityLabel` + `accessibilityHint` + `accessibilityState`; `accessibilityLiveRegion="polite"` on the countdown text.
  - [x] Subtask 4.10: Verify NO hardcoded hex colors; all `Typography.*` presets; no raw `fontSize`; 44pt minimum touch targets.

- [x] **Task 5 — Modify `app/_layout.tsx`** (AC: #5, #6)
  - [x] Subtask 5.1: Add imports — `isEmailVerified` from `@/src/lib/email-verification`; `EmailVerificationGate` from `@/src/components/auth/EmailVerificationGate`.
  - [x] Subtask 5.2: Destructure `signOut`, `resendVerificationEmail`, `refreshSessionAfterVerification` from `useAuth()` at the top of `RootLayoutNav`.
  - [x] Subtask 5.3: Add the routing-effect guard `if (session && !isEmailVerified(user) && !inAuthGroup) return;` immediately AFTER the existing `ProfileRetryScreen` routing guard at line 129.
  - [x] Subtask 5.4: Add the notification-registration guard — extend the condition at line 83 to `if (session && !hasRegisteredNotifications.current && isEmailVerified(user))`.
  - [x] Subtask 5.5: Add the render-branch for `EmailVerificationGate` immediately BEFORE the `ProfileRetryScreen` render-branch at line 155. Wrap in `<AppErrorBoundary>`.
  - [x] Subtask 5.6: Verify the render-branch ordering: `isLoading` (returns null) → `EmailVerificationGate` (Story 12-9) → `ProfileRetryScreen` (Story 9-10) → main app.

- [x] **Task 6 — Create operator runbook** (AC: #7)
  - [x] Subtask 6.1: Create `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md` with the 7 sections per deliverable (q) spec.
  - [x] Subtask 6.2: Include the exact dashboard navigation path: Authentication → Providers → Email → "Confirm email" toggle.
  - [x] Subtask 6.3: Include the trade-off discussion for "Required for sign-up" vs "Required for sign-in too" modes.
  - [x] Subtask 6.4: Include the verification `curl` recipe with both correct (`email_confirmed_at === null`) and incorrect responses.
  - [x] Subtask 6.5: Include the email-template customization follow-up call-out (optional, OPERATOR DEFERRABLE).
  - [x] Subtask 6.6: Include the rollback procedure for emergencies (toggle "Confirm email" OFF).
  - [x] Subtask 6.7: Include the cross-story dependencies section (12-8 sibling).
  - [x] Subtask 6.8: Include the operator decision-log placeholder for post-deploy fill-in.

- [x] **Task 7 — Add regression tests** (AC: #8, #9, #10, #11)
  - [x] Subtask 7.1: Create `src/lib/__tests__/email-verification.test.ts` with the 20 cases enumerated in deliverable (h). Pin the cooldown boundary at exactly `RESEND_COOLDOWN_MS` (inclusive). Pin the masked-email fallback for undefined/empty/no-`@`.
  - [x] Subtask 7.2: Create `src/lib/__tests__/email-verification-source-drift.test.ts` with the 7 drift-detector cases per deliverable (i). Use `fs.readFileSync` + comment-strip per Story 12-2 P12 lesson. Pin: `isEmailVerified` import / `EmailVerificationGate` import / routing-effect guard / notification-effect guard / NEGATIVE `captureError(*, email)` / render-branch ordering / `auth-events.ts` line count invariance.
  - [x] Subtask 7.3: Create `src/components/auth/__tests__/EmailVerificationGate.test.tsx` with the 10 react-test-renderer cases per deliverable (j). Use `jest.useFakeTimers()` for the cooldown countdown ticking. Mock `onResendVerification` / `onSignOut` / `onRefreshSession` per-test.
  - [x] Subtask 7.4: Run `npm test` — verify exit 0; verify total case count rose by ~37.

- [x] **Task 8 — Quality gates + CLAUDE.md update** (AC: #12, #14, #15)
  - [x] Subtask 8.1: Run `npm run type-check && npm run lint && npm run format:check`. All must exit 0.
  - [x] Subtask 8.2: Append a Story 12-9 paragraph to `CLAUDE.md` after the Story 12-8 paragraph, following the established prose style (multi-clause, file:line refs in backticks, cross-story invariant-preservation list, regression test summary, verification date).
  - [x] Subtask 8.3: Verify NO additions to `SENTRY_EXTRAS_ALLOWLIST` in `src/lib/sentry.ts`.
  - [x] Subtask 8.4: Verify the `feature` tag `"email-verification-resend"` is a categorical short string (well under the 80-char redaction threshold).

## Dev Notes

### Branching guidance

Per project memory ([`feedback_branch_from_main`](../../../.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/feedback_branch_from_main.md)): branch `feature/12-9-email-verification-gate` from `origin/main`, NOT from the prior story's in-flight branch (`feature/12-8-password-policy-tightening`). At the time of story-file creation, Story 12-8's PR #83 is still open with round-2 patches pushed; do not stack on it.

### Project conventions to follow

- **Path alias `@/*`** maps to repo root (e.g., `import { isEmailVerified } from "@/src/lib/email-verification"`).
- **Module placement** — pure logic in `src/lib/`; React components in `src/components/<feature>/` (here: `src/components/auth/`).
- **Test file co-location** — Jest tests in `src/lib/__tests__/<module>.test.ts`. Drift detectors get a `-source-drift.test.ts` suffix.
- **Supabase Auth API** — `supabase.auth.resend({type: "signup", email})` requires the `type` discriminator; the `email_change` discriminator is for a different flow (changing the email on a verified account).
- **TypeScript strict mode** — all new code passes `tsc --noEmit`.
- **Sentry contract (Story 9-3)** — only allowlisted extras keys; the password / email never log; the resend error captures via `feature` tag without per-event extras.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist (no new extras keys; only one new `feature` tag).
- Story 9-6 `decideAuthAction` switch unchanged (the drift detector pins line-count invariance).
- Story 9-10 `ProfileRetryScreen` render-branch is UNCHANGED in behavior — the verification gate only inserts an UPSTREAM branch.
- Story 12-2 `bootstrapAuth()` body unchanged; only NEW module-level static action exports are added.
- Story 12-8 password policy is orthogonal — password validation runs at signup time (pre-session), verification runs at session time (post-signup); the two never collide.

### Known footguns (from prior story retros)

- **Server-authoritative semantics for `email_confirmed_at`** — DO NOT cache the verified-flag in `useAuthStore` or `secure-cache.ts`. The whole point of reading it from `user.email_confirmed_at` is that Supabase is the single source of truth; a cached flag could be tampered with by a malicious app rebuild OR could go stale if the user verifies on web and signs in on mobile.
- **`Date.parse` returns NaN for malformed strings** — but `Number.isFinite(NaN) === false`, so the defensive `isEmailVerified` semantics flow through correctly. DO NOT rewrite as `new Date(ts).getTime()` because that returns NaN for malformed input too, but the pattern is less obvious to readers and tests must cover both code paths.
- **Comment-strip when drift-detecting** (Story 12-2 P12): the drift detector reads source from disk; strip comments first so JSDoc that mentions deprecated patterns (e.g., this story's `"<USER_TRANSCRIPT>"` cross-reference) doesn't trip the negative-guard regex.
- **Synchronous double-tap on Resend button** (Story 9-10 ProfileRetryScreen P6 pattern) — `setIsResending(true)` is async-batched by React; two synchronous taps before the next commit can both pass an `if (isResending) return` check that reads the closure's pre-set value. Use a `useRef` mutated synchronously inside the handler + reset in `finally`.
- **`useEffect` cleanup for the cooldown interval** — without cleanup, navigating away from the gate (which only happens via sign-out or refresh-success) would leak the `setInterval` AND emit a setState-after-unmount warning. The cleanup function returned from `useEffect` clears the interval on every dep-change AND on unmount.
- **React-test-renderer + fake timers** — Story 12-1 P8 established the pattern; reuse it. `jest.useFakeTimers()` + `act(() => { jest.advanceTimersByTime(60_000); })` to test the cooldown countdown re-enabling the button.
- **Operator dashboard config is NOT enforced by code** — the runbook is the operator deliverable; CI cannot test it. The drift detector catches client-side regressions but a server-side relaxation (operator toggles "Confirm email" OFF) is only caught by the runbook's verification step.
- **`signUpWithEmail` already exists** — Story 12-9 does NOT modify it. Story 12-8 added the password-policy mapper to the catch block; Story 12-9 adds NO change to the signup flow (the Alert at line 133-136 stays as a nudge; the gate is the enforcement).

### Project Structure Notes

| Path | Action | Rationale |
| --- | --- | --- |
| `src/lib/email-verification.ts` | NEW | Pure helper module — extracts the verification rule + cooldown math + email mask. |
| `src/components/auth/EmailVerificationGate.tsx` | NEW | Render-branch gate component (parallel to `ProfileRetryScreen`). |
| `src/lib/auth-bootstrap.ts` | MODIFY | Add two new module-level static action exports (resend + refresh). |
| `src/hooks/use-auth.ts` | MODIFY | Re-export the two new actions; expose via `useAuth()` return shape. |
| `app/_layout.tsx` | MODIFY | Add 3 verification guards (render-branch + routing-effect + notification-effect). |
| `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md` | NEW | Operator-actionable Layer 2 dashboard config + verification + rollback. |
| `src/lib/__tests__/email-verification.test.ts` | NEW | 20 Jest cases pinning all 4 helpers + the constant. |
| `src/lib/__tests__/email-verification-source-drift.test.ts` | NEW | 7 drift detectors against `_layout.tsx` + `auth-events.ts` regressions. |
| `src/components/auth/__tests__/EmailVerificationGate.test.tsx` | NEW | 10 react-test-renderer cases pinning gate behavior. |
| `CLAUDE.md` | MODIFY | Architecture paragraph after Story 12-8 entry. |
| `src/lib/auth-events.ts` | NO CHANGE | `decideAuthAction` switch unchanged (regression risk if touched). |
| `src/lib/sentry.ts` | NO CHANGE | No new allowlist keys. |
| `app/(auth)/signup.tsx` | NO CHANGE | The "Check Your Email" Alert stays as a nudge; the gate is the enforcement. |
| `app/(auth)/login.tsx` | NO CHANGE | Verified users sign in normally; unverified users hit the gate post-sign-in. |
| `app/(auth)/forgot-password.tsx` | NO CHANGE | Reset-password flow is orthogonal to verification. |
| `src/store/auth-store.ts` | NO CHANGE | No new state fields — the verification status is read from `user.email_confirmed_at` directly. |
| `supabase/migrations/` | NO CHANGE | Verification lives in `auth.users` (Auth-service-owned). |
| `supabase/functions/` | NO CHANGE | The gate is client-side; server-side Edge Functions inherit protection by being unreachable from unverified UIDs. |
| `package.json` | NO CHANGE | No new deps. |

### References

- [Source: app/_layout.tsx:115-139 — pre-12-9 routing-effect lacks email_confirmed_at guard]
- [Source: app/_layout.tsx:155 — ProfileRetryScreen render-branch ordering reference]
- [Source: src/lib/auth-bootstrap.ts:163-200 — auth listener that propagates email_confirmed_at via setSession]
- [Source: src/lib/auth-bootstrap.ts:339-346 — signUpWithEmail body (unchanged in 12-9)]
- [Source: node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:356 — `email_confirmed_at?: string` field on `User`]
- [Source: node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:685-694 — `ResendParams` shape]
- [Source: node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts:142-148 — "Confirm email" contract]
- [Source: node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts:399 — `resend(credentials: ResendParams): Promise<AuthOtpResponse>`]
- [Source: node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts:411 — `refreshSession()` contract]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md#67 — P1-15 audit finding]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md#212 — Epic 12.9 deliverable]
- [Source: _bmad-output/implementation-artifacts/12-8-password-policy-tightening.md — sibling story pattern reference]
- [Source: _bmad-output/implementation-artifacts/12-7-encrypted-profile-cache.md — sibling story pattern reference for extracted-module + runbook approach]
- [Source: _bmad-output/implementation-artifacts/12-2-auth-subscription-bootstrap.md — auth-bootstrap.ts thin-binding contract]
- [Source: src/lib/__tests__/auth-bootstrap.test.ts — existing test patterns for new actions]
- [Source: docs/tcf-spec-source.md — unchanged; verification is orthogonal to TCF spec]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-14 via `/bmad-create-story`; sprint-status flipped `backlog → ready-for-dev`.
- Implementation 2026-05-14 on branch `feature/12-9-email-verification-gate` (branched from `main` at `ab38658` per project memory `feedback_branch_from_main` — NOT stacked on prior 12-8 in-flight branch).
- Red-green-refactor cycle followed: `email-verification.test.ts` was written BEFORE `email-verification.ts` and confirmed RED (`Cannot find module`); module written; GREEN (24/24).
- Source-drift detector reuses Story 12-8 R2-P3 string-literal-aware balanced-paren walker for the `captureError(*, email)` negative guard.
- Gate runtime test uses `react-test-renderer` + `jest.useFakeTimers()` (Story 12-1 P8 pattern). The pressable-find helper was initially scoped on `displayName === "Pressable"` but switched to matching on `accessibilityRole === "button"` + `accessibilityLabel` + `typeof onPress === "function"` after the displayName-filter returned `undefined` for some buttons (React.memo / RN internals); the new helper is more robust.
- Minor TS-shim friction: `react-test-renderer` shim at `src/types/react-test-renderer.d.ts` does NOT export `ReactTestInstance`; defined a local `MinimalTestInstance` interface inside the test file.

### Completion Notes List

- **Task 1 done.** `src/lib/email-verification.ts` (~125 lines including JSDoc) exports `RESEND_COOLDOWN_MS`, `isEmailVerified`, `canResendNow`, `secondsUntilResend`, `formatVerificationEmailMask`. All defensive against null/undefined/malformed input. Pure module — zero side-effects.
- **Task 2 done.** `src/lib/auth-bootstrap.ts` gained `resendVerificationEmail(email)` (→ `supabase.auth.resend({type: "signup", email})`) + `refreshSessionAfterVerification()` (→ `supabase.auth.refreshSession()`). Both are module-level static exports — Story 12-2 thin-binding contract preserved.
- **Task 3 done.** `src/hooks/use-auth.ts` re-exports both new actions and exposes them in the `useAuth()` return shape (alphabetically inserted to preserve diff cleanliness). Existing `use-auth.test.tsx` continues to pass (no shape-pin regression).
- **Task 4 done.** `src/components/auth/EmailVerificationGate.tsx` (~260 lines). Renders the French recovery surface with Refresh (primary CTA) / Resend (60s cooldown) / Sign-out (tertiary). Synchronous double-tap guard on Resend mirrors Story 9-10 ProfileRetryScreen P6 pattern. Mounted-ref defends against any setState-after-unmount from the resend/refresh promises. Gate-shown breadcrumb fires exactly once per mount via `breadcrumbFiredRef`. Full accessibility wiring (role + label + hint + state + live region on the countdown). Wrapped in `React.memo`.
- **Task 5 done.** `app/_layout.tsx` modified with three Story 12-9 guards: (a) routing-effect guard `if (session && !isEmailVerified(user) && !inAuthGroup) return;` inserted immediately AFTER the existing 9-10 ProfileRetryScreen guard (note: `user` added to the effect's dep array); (b) notification-registration `&& isEmailVerified(user)` clause added (note: `user` added to that effect's dep array too); (c) render-branch for `<EmailVerificationGate ... />` inserted immediately BEFORE the 9-10 ProfileRetryScreen render-branch, wrapped in `<AppErrorBoundary>`. The destructure from `useAuth()` extended with `signOut`, `resendVerificationEmail`, `refreshSessionAfterVerification`.
- **Task 6 done.** Operator runbook at `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md` (7 sections covering Layer 1 + Layer 2 dashboard config + email template customization + resend rate-limit cross-reference + rollback procedure + cross-story dependencies with 12-8 + operator decision log placeholder). Curl verification recipe pins the expected `email_confirmed_at === null` response shape. Test email uses `@invalid.localdomain` per Story 12-8 P18 lesson (no shell-escape required).
- **Task 7 done.** Three new test files totaling **41 net Jest cases** (1503 → 1544; spec target was +37):
  - `src/lib/__tests__/email-verification.test.ts` — 24 helper-contract cases.
  - `src/lib/__tests__/email-verification-source-drift.test.ts` — 7 drift-detector cases reading `app/_layout.tsx` + `src/lib/auth-events.ts` from disk.
  - `src/components/auth/__tests__/EmailVerificationGate.test.tsx` — 10 runtime cases via `react-test-renderer` + fake timers.
- **Task 8 done.** All 4 quality gates green: `npx tsc --noEmit` (0 errors), `npm run lint` (0 warnings), `npm run format:check` (clean), `npx jest` (1544/1544). CLAUDE.md gained the Story 12-9 architecture paragraph after the Story 12-8 entry. `SENTRY_EXTRAS_ALLOWLIST` unchanged (`feature` was already allowlisted; the one new tag `"email-verification-resend"` is a string value, not a key).
- **Cross-story invariants verified clean (zero diff):** `src/lib/sentry.ts` / `src/lib/auth-events.ts` / `src/lib/cache.ts` / `src/lib/realtime-orchestrator.ts` / `src/components/auth/PasswordStrengthIndicator.tsx` / `app/(auth)/signup.tsx` / `app/(auth)/login.tsx` / `app/(auth)/forgot-password.tsx` / `src/store/auth-store.ts` / `package.json` / `supabase/migrations/*` / `supabase/functions/*`. The drift detector pins `decideAuthAction` switch invariance (all 6 case arms + SIGNED_OUT early-return).
- **OPERATOR ACTION REQUIRED post-merge:** apply Layer 2 per runbook Section 2 — Supabase Dashboard → Authentication → Providers → Email → "Confirm email" ON (or verify it's already ON; this is the Supabase default). Run the curl verification per Section 2; the response body MUST contain `email_confirmed_at: null` for a fresh signup. Choose operator mode "Required for sign-up" (default — gentler UX) or "Required for sign-in too" (stricter — Story 12-9 supports both). Fill in the operator decision-log table in the runbook.
- Closes audit **P1-15** architecturally.

#### Review-round-1 patches (2026-05-14)

Adversarial 3-layer review surfaced 30 distinct findings (Blind Hunter 16 + Edge Case Hunter 18 + Acceptance Auditor 9 → deduplicated to 30). Triage: **HIGH × 2 + MED × 7 + LOW × 10 = 19 patches applied; 10 deferred; 2 rejected as spec self-contradictions.**

- **HIGH H1** — `handleRefresh` trio (`EmailVerificationGate.tsx` + `auth-bootstrap.ts`): pre-patch had three intersecting defects on one handler — no double-tap guard (concurrent taps double-dispatched `refreshSession` and burned the 10/hr token-refresh rate-limit), no try/catch (`Promise<void>` rejection became unhandled), no post-refresh re-check (a successful refresh with `email_confirmed_at` still unset toggled the spinner with no feedback). Post-patch: `refreshingRef` synchronous guard + `refreshSessionAfterVerification` returns `{error}` with try/catch + post-success re-read of `useAuthStore.getState().user?.email_confirmed_at` and French Alert "Vérification non confirmée" if still unset. New Sentry feature tag `"email-verification-refresh"`.
- **HIGH H2** — notification re-registration miss (`_layout.tsx`): pre-patch `hasRegisteredNotifications.current = false` reset only fired on `!session`; admin-driven revoke + re-verify left stale `true` and the device token never re-registered. Post-patch: reset ALSO fires on `!isEmailVerified(user)`.
- **MED M1** — architectural-claim correction in CLAUDE.md (the original "an unverified user shouldn't have reached profile-load" was partly false; corrected to "the gate prevents UI exposure + downstream screen mounts but not the listener-driven cache read"). Closing the read-side gap filed as a future follow-up.
- **MED M2** — breadcrumb per-mount → per-session (module-level `Set` keyed by `user.id` survives HMR / route-change remounts; new `__resetGateBreadcrumbForTests` test-only helper; +2 test cases for remount + different-user).
- **MED M3** — `userEmail === undefined` → distinct French label "Adresse e-mail manquante" (not "Renvoyer dans 0s" forever-disabled).
- **MED M4** — clock-skew defense in `canResendNow` + `secondsUntilResend` via `Math.max(0, now - lastResendAtMs)` clamp (NTP rollback no longer extends cooldown past 60s).
- **MED M5** — drift detector extended to `EmailVerificationGate.tsx` (the only file where `userEmail` is in scope). Pre-patch the Story 9-3 PII-leak negative guard was structurally bypassable; post-patch the string-literal-aware balanced-paren walker (Story 12-8 R2-P3 reuse) reads BOTH files.
- **MED M6** — CLAUDE.md typo `RESEND_COOLDOWN_MS = 10` → `60_000` (one-character fix).
- **MED M7** — routing-effect guard order swap (verification UPSTREAM in BOTH axes: render-branch AND routing-useEffect).
- **LOW L1** — `handleSignOut` `signingOutRef` guard + try/catch + new Sentry feature tag `"email-verification-signout"` + `isSigningOut` UI state ("Déconnexion…" label).
- **LOW L2** — cooldown-interval dep array `[lastResendAtMs]` only (60 alloc/free cycles per cooldown → 1).
- **LOW L3** — `formatVerificationEmailMask` trim defense (autocomplete-keyboard leading whitespace no longer leaks into masked display).
- **LOW L4** — strict ISO-8601 prefix regex precheck before `Date.parse` + 24h future-date tolerance window (rejects `"0"` / `"2020"` / `"9999-01-01T00:00:00Z"` tampered cache).
- **LOW L5** — `accessibilityHint` "60s" tight-form per spec.
- **LOW L6** — `busy` accessibilityState flip assertion in gate test Case 17.
- **LOW L7** — runbook gained Part B end-to-end "sign in and see gate" UI verification step.
- **LOW L8** — runbook curl-password note re Layer 2 password-policy interaction.
- **LOW L10** — JSDoc comment that Sentry breadcrumb `data` is NOT scrubbed by `scrubEvent`.
- **+26 net Jest cases** (1544 → 1570) across 3 test files: `email-verification.test.ts` +14 (L3 × 4 + L4 × 7 + M4 × 3); `email-verification-source-drift.test.ts` +2 (M5 gate captureError-no-email + M5 three-feature-tag positive pin); `EmailVerificationGate.test.tsx` +10 (M2 × 2 + H1 × 4 + L1 × 2 + L6 + M3).
- **All 4 quality gates green** (type-check + lint + format-check + test).
- **Deferred (10):** sign-out race during in-flight refresh/resend / `inAuthGroup` exception race during signOut promise window / `lastResendAtMs` not reset on `userEmail` change (covered architecturally but no test pin) / `if (error)` truthy-check narrowing / direct module import vs `useAuth()` destructure asymmetry / render-branch button order (UX-defensible) / `onSignOut` prop type widened / runbook section ordering / mid-session verification flip integration test (Epic 15.3 scope) / timer-count race in Case 10.
- **Rejected (2):** spec deliverable (g) breadcrumb-site-location self-contradiction (implementation is the defensible reading); AC #11 "+3 test files" vs spec body "2 test files" (impl correctly delivered 3 per AC).

### File List

**New files:**
- `src/lib/email-verification.ts` — pure helper module (5 exports).
- `src/components/auth/EmailVerificationGate.tsx` — render-branch gate component.
- `src/lib/__tests__/email-verification.test.ts` — 24 helper-contract Jest cases.
- `src/lib/__tests__/email-verification-source-drift.test.ts` — 7 drift-detector Jest cases.
- `src/components/auth/__tests__/EmailVerificationGate.test.tsx` — 10 runtime Jest cases.
- `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md` — operator runbook (7 sections).

**Modified files:**
- `app/_layout.tsx` — 3 verification guards (routing-effect + notification-registration + render-branch) + imports + destructure expansion.
- `src/lib/auth-bootstrap.ts` — 2 new module-level static action exports (`resendVerificationEmail`, `refreshSessionAfterVerification`).
- `src/hooks/use-auth.ts` — re-export the 2 new actions + add to `useAuth()` return shape.
- `CLAUDE.md` — Story 12-9 architecture paragraph appended after Story 12-8.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 12-9 status `backlog → in-progress → review` + `last_updated` header.
- `_bmad-output/implementation-artifacts/12-9-email-verification-gate.md` — Tasks/Subtasks checked + Dev Agent Record filled + Status: review.
