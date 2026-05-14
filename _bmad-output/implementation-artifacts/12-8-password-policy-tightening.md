# Story 12.8: Password Policy Tightening — ≥10 Characters + Composition + Server-Side Supabase Enforcement

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose [`app/(auth)/signup.tsx:79-80`](app/(auth)/signup.tsx#L79-L80) only checks `password.length < 6` (rejecting `"abc"` but accepting `"123456"`, `"password"`, `"qwerty"`, all top-100 leaked passwords) and whose `accessibilityHint` at line 254 (`"Enter a password with at least 6 characters"`) + placeholder at line 246 (`"Mot de passe (min. 6 caractères)"`) advertise the weak floor to users, AND whose call to `signUpWithEmail(email, password, fullName)` at line 86 routes through [`src/lib/auth-bootstrap.ts:338-347`](src/lib/auth-bootstrap.ts#L338-L347) → `supabase.auth.signUp({email, password, options: {data: {full_name}}})` with **no server-side enforcement** of any composition rule (Supabase's default password policy on a fresh project is `minimum_length: 6, password_required_characters: ""` — i.e. zero characters required), AND today an attacker (a) gets unmetered offline brute-force on a leaked DB dump (the bcrypt cost factor is mid-range but `"password"` cracks in milliseconds), (b) gets credential-stuffing wins from any user who reused a previously-leaked common password, (c) gets social-engineered users (top-1000-leaked passwords are guessable in ≤ 1 day on an online attack even WITH Supabase's default rate-limit), so audit finding **P1-12** at [`shippable-roadmap.md` line 64](_bmad-output/planning-artifacts/shippable-roadmap.md) names the bug exactly: "Weak password policy (6 chars, no complexity) — `app/(auth)/signup.tsx:78-80` — security", AND the Epic 12.8 deliverable at [`shippable-roadmap.md` line 211](_bmad-output/planning-artifacts/shippable-roadmap.md) describes the fix: "Tighten password policy (≥10 chars, complexity); add Supabase HIBP if available. **Covers P1-12.**", AND Supabase Auth ships **first-class password-policy support** since 2024 (verified 2026-05-13 via `/websites/supabase` Context7 docs): the Auth dashboard at **Authentication → Policies → Password Policy** exposes (i) `minimum_length` (integer ≥ 6), (ii) `password_required_characters` (enum: `none` / `letters_and_digits` / `lower_upper_letters_and_digits` / `lower_upper_letters_and_digits_and_symbols`), AND (iii) **HaveIBeenPwned (HIBP) Pwned Passwords** leaked-password check (rejects passwords appearing in the HIBP corpus via k-anonymity SHA-1 prefix lookup; **Pro Plan and above only**); when a sign-up call violates any of the three rules, Supabase Auth rejects with `error.code === "weak_password"` (HTTP 422) AND `error.name === "AuthWeakPasswordError"` AND a `reasons: string[]` array enumerating which rules failed (e.g., `["length"]` / `["characters"]` / `["pwned"]`) — verified at [Supabase Auth Error Codes Reference](https://supabase.com/docs/guides/auth/debugging/error-codes), AND the project today has **no `password-policy.ts` module** (`grep -rn "password.length\|MIN_PASSWORD" src` returns ZERO matches outside the one signup site), AND the **only password input surface in the entire app is `signup.tsx`** (no password-change in profile settings, no password input in `forgot-password.tsx` because that screen sends a reset link only, no `reset-password-confirm.tsx` because Supabase's email-link flow opens a magic-link session and Story 12-9 owns the email-verification gate; the reset-password completion UI is a future story scope), so Story 12-8 is the **only place a client-side password validator needs to fire today** — but the validator must be exported from a reusable module so future change-password / reset-password-confirm UIs use the same rules without drift, AND **HIBP availability is operator-gated**: the project's current Supabase plan is unverified by this story (operator decision per [`_bmad-output/planning-artifacts/runbooks/`](_bmad-output/planning-artifacts/runbooks/) absence of any plan-tier note); the runbook this story creates documents BOTH the free-tier path (length + composition only, no HIBP) AND the Pro-tier path (length + composition + HIBP) so the operator can ship the free-tier baseline today AND flip the HIBP toggle later without code changes — the dashboard setting is independent of the client validator, AND the established cross-story pattern: Story 12-7's `secure-cache.ts` extracted a single-responsibility module so future stories can extend the allowlist without consumer changes; Story 12-8 follows the same pattern by extracting password validation into `src/lib/password-policy.ts` so future password surfaces consume one validator + one error mapper without duplicating rules.

I want (a) a **new module `src/lib/password-policy.ts`** (~140 lines including JSDoc) exporting: (i) `MIN_PASSWORD_LENGTH = 10` constant (matches roadmap §12.8 "≥10 chars"; matches the value the operator MUST set in the Supabase dashboard per the runbook in deliverable (h)); (ii) `PasswordPolicyResult = { valid: boolean; reasons: PasswordPolicyReason[] }` type; (iii) `PasswordPolicyReason = "length" | "lowercase" | "uppercase" | "digit"` discriminated union (NOT `"symbol"` — see deliverable (c) Composition rule decision; NOT `"pwned"` — that's a server-only signal returned by Supabase when HIBP is on, not a client-checkable rule because the client cannot call HIBP from native RN without leaking the password to a third-party API); (iv) `validatePasswordStrength(password: string): PasswordPolicyResult` pure function that runs ALL four checks (length + lowercase + uppercase + digit) and returns ALL failing reasons (NOT short-circuit on first fail — UI needs the full list to render the requirements checklist); checks are pinned to ASCII-aware regexes (`/[a-z]/` + `/[A-Z]/` + `/\d/`) so the client-side rules are byte-identical to Supabase's `password_required_characters` server-side enforcement (Supabase's regex evaluation is documented at [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security) — verified 2026-05-13 via Context7 to be ASCII-letter-class semantics, NOT Unicode-letter-class; mirroring those semantics on the client prevents a passing-on-client / failing-on-server surprise where the user types `"мойпароль123"` (Cyrillic), passes the client regex, and gets a confusing server-side weak_password rejection); (v) `passwordPolicyReasonToFrenchMessage(reason: PasswordPolicyReason): string` localizer returning user-facing French strings (the signup screen is French — pre-12-8 placeholder is `"Mot de passe (min. 6 caractères)"`); ALL four messages are short imperative-mood phrases per the design's existing tone (e.g., `length: "Au moins 10 caractères"`, `lowercase: "Au moins une minuscule"`, `uppercase: "Au moins une majuscule"`, `digit: "Au moins un chiffre"`); (vi) `mapSupabaseWeakPasswordError(error: unknown): PasswordPolicyReason[] | null` translator that takes a Supabase error and, if it matches the `weak_password` shape (`error.code === "weak_password"` AND has a `reasons` array per the [AuthApiError contract](https://supabase.com/docs/guides/auth/debugging/error-codes)), returns the array of `PasswordPolicyReason`s mapped from Supabase's `length` / `characters` / `pwned` strings — NOTE: Supabase returns `"characters"` as a single reason that lumps lowercase+uppercase+digit+symbol together (operator-side dashboard config decides which subset is required), so when the server-side code is `"characters"`, the client mapper re-runs `validatePasswordStrength` against the user's password (which is in scope at the call site) AND returns the actually-failing client-side reasons — this gives the user the same itemized feedback whether the rejection came from client or server (eliminates "your password is weak" with no actionable info); when `"pwned"` is in Supabase's reasons, append the `"pwned"`-specific message via a separate non-enum-extending path (a `mapSupabaseWeakPasswordError` return type allows the caller to render a `"Ce mot de passe a été divulgué dans une fuite de données"` message even though `"pwned"` is not a `PasswordPolicyReason`); (vii) **`computePasswordStrengthLabel(reasons: PasswordPolicyReason[]): "weak" | "medium" | "strong"`** pure helper for the UI strength meter — `weak` if 3+ reasons fail (counts also `length` < 8), `medium` if 1-2 reasons fail OR all 4 pass with length < 14, `strong` if all 4 pass AND length ≥ 14 (length thresholds are operator-derived heuristic; pinned by test); the function takes the reason list (NOT the raw password — the password should not flow through more functions than necessary; defense-in-depth against accidental logging); (b) **`app/(auth)/signup.tsx` modifications** — (i) replace the `password.length < 6` branch at line 79-82 with a call to `validatePasswordStrength(password)`; on `result.valid === false`, render an `Alert.alert("Mot de passe invalide", result.reasons.map(passwordPolicyReasonToFrenchMessage).join(" • "))`; (ii) update the placeholder at line 246 from `"Mot de passe (min. 6 caractères)"` to `"Mot de passe (min. 10 caractères)"`; (iii) update the `accessibilityHint` at line 254 from `"Enter a password with at least 6 characters"` to `"Enter a password with at least 10 characters and one uppercase, one lowercase, and one digit"`; (iv) extend the catch block at line 87-94 — after `Alert.alert("Sign Up Failed", error.message)`, FIRST run `mapSupabaseWeakPasswordError(error)` and if it returns a non-null array, show the itemized French message instead of `error.message` (which is English-only and Supabase-engineering-language); (v) **NEW LIVE STRENGTH INDICATOR** — below the password input field, render an inline `<PasswordStrengthIndicator password={password} />` component (deliverable (d)) that shows when `password.length > 0` AND hides when empty (avoids a flash of the indicator on first focus); (vi) the existing button-disable / loading state at lines 264-271 is unchanged — pre-12-8 the button is disabled only during `loading`, NOT when the password is invalid (intentional UX trade-off: the user clicks the button and gets the itemized Alert, which is more discoverable than a silently-disabled button at signup time); the strength indicator alone is the live-feedback channel; (c) **composition rule decision — use `lower_upper_letters_and_digits` (NIST-aligned, no symbol requirement)** — the Supabase dashboard offers 4 levels: `none`, `letters_and_digits`, `lower_upper_letters_and_digits`, `lower_upper_letters_and_digits_and_symbols`; Story 12-8 picks `lower_upper_letters_and_digits` because (i) requiring symbols pushes users toward predictable substitutions (`Password1!`, `Welcome2024!`) that are no harder to crack than a 12-char passphrase, (ii) NIST 800-63B Section 5.1.1.2 explicitly recommends AGAINST mandatory composition rules beyond length, with the upper/lower/digit triad as a reasonable compromise for legacy systems, (iii) symbol input is friction on mobile keyboards (extra keyboard-mode toggles increase typo rate), (iv) a 10-char password with all 4 character classes EXCLUDING symbols has 62^10 ≈ 8 × 10^17 keyspace — sufficient against any realistic offline attack at bcrypt cost-factor 10; (d) **new component `src/components/auth/PasswordStrengthIndicator.tsx`** (~85 lines) — props: `{password: string}`; renders (i) a 3-segment progress bar where each segment is colored `Colors.gray200` (inactive) or `Colors.error` / `Colors.warning` / `Colors.success` (active, based on `computePasswordStrengthLabel`); (ii) an itemized 4-line checklist below the bar — each line shows a checkmark icon + the French requirement label, colored `Colors.textTertiary` (unmet, dim) or `Colors.success` (met, bright); the checkmark is rendered via the design system's `Colors.success` color (NO emoji per Story 10-7 voice-mode emoji-drop guidance applied broadly — a Unicode `✓` symbol is acceptable since this is a static UI element, not TTS-bound); (iii) the strength label as caption text (`"Faible"` / `"Moyen"` / `"Fort"`) right-aligned next to the progress bar; (iv) the component uses `React.memo` because parent state changes on every keystroke and the indicator's deps are just `password`; (v) accessibility: the progress bar has `accessibilityRole="progressbar"` + `accessibilityValue={{min: 0, max: 3, now: strengthValue}}` + `accessibilityLabel="Password strength"`; each checklist item has `accessibilityState={{checked: met}}` + `accessibilityRole="checkbox"`; the strength label has `accessibilityLiveRegion="polite"` (Android) so screen-reader users hear the strength change as they type without it spam-firing per keystroke (Android batches polite-region updates); (e) **Sentry telemetry** — NO new feature tags or extras keys; the signup catch block already uses `captureError(err, "signup")` (Story 9-3 contract); the `weak_password` rejection from Supabase is surfaced to the user via Alert AND captured via the existing `signup` feature tag (preserves debugging without leaking the password — the password is NEVER passed to `captureError` anywhere in the change set; verified by the drift detector in deliverable (g)); the password itself is in scope only inside `handleSignUp`'s closure and never crosses a module boundary except into `validatePasswordStrength` (which is pure, no I/O) and `supabase.auth.signUp` (which uses HTTPS to the Supabase Auth API by definition); (f) **regression tests** in `src/lib/__tests__/password-policy.test.ts` (~22 Jest cases): (i) `MIN_PASSWORD_LENGTH === 10` constant pin (regression-catches a sloppy edit that drops it back to 6 or 8 without updating the runbook); (ii) `validatePasswordStrength("")` returns `{valid: false, reasons: ["length", "lowercase", "uppercase", "digit"]}` — empty password fails ALL rules (NOT just length — confirms ALL checks run, no short-circuit); (iii) `validatePasswordStrength("abcdefghij")` returns `["uppercase", "digit"]` — 10 lowercase letters fails 2 rules; (iv) `validatePasswordStrength("ABCDEFGHIJ")` returns `["lowercase", "digit"]`; (v) `validatePasswordStrength("1234567890")` returns `["lowercase", "uppercase"]`; (vi) `validatePasswordStrength("Abcdefghi1")` returns `{valid: true, reasons: []}` — happy path: 10 chars + lower + upper + digit; (vii) `validatePasswordStrength("Abc1")` returns `["length"]` (length first, but other rules pass); (viii) `validatePasswordStrength("Abcd1")` returns `["length"]` (5 chars; length fails, other rules pass); (ix) length-boundary at exactly 10 chars passes (length >= 10, NOT > 10 — the boundary is inclusive); (x) length boundary at exactly 9 fails — pinned twin-test with case (ix) so a future regression that flips `>=` to `>` fails the boundary; (xi) `validatePasswordStrength("Мой пароль 123")` (14 chars; Cyrillic letters; one digit; one space; NO ASCII letters) returns `["lowercase", "uppercase"]` — the ASCII regex pins (`/[a-z]/` / `/[A-Z]/`) catch this and prevent the silent drift versus Supabase's server-side ASCII-only rules; (xii) `passwordPolicyReasonToFrenchMessage("length")` returns the canonical `"Au moins 10 caractères"`; (xiii)-(xv) the other 3 reasons mapped to canonical French; (xvi) `mapSupabaseWeakPasswordError(undefined)` returns `null` (defensive — non-Supabase throws like network errors must NOT fall into the password mapper); (xvii) `mapSupabaseWeakPasswordError({code: "weak_password", reasons: ["length"]})` returns `["length"]`; (xviii) `mapSupabaseWeakPasswordError({code: "weak_password", reasons: ["characters"]}, "abcdefghij")` (with the password in scope) re-runs `validatePasswordStrength` and returns `["uppercase", "digit"]` — the round-trip from server's coarse `"characters"` → client's itemized list is verified; (xix) `mapSupabaseWeakPasswordError({code: "user_already_exists"})` returns `null` — non-`weak_password` codes pass through unmapped (caller falls back to `error.message`); (xx) `computePasswordStrengthLabel([])` returns `"strong"` when password length ≥ 14 (full-pass + adequate length); same input with password length 10 returns `"medium"`; (xxi) `computePasswordStrengthLabel(["digit"])` returns `"medium"`; (xxii) `computePasswordStrengthLabel(["length", "lowercase", "uppercase"])` returns `"weak"`; (g) **drift detector test** in `src/lib/__tests__/password-policy-source-drift.test.ts` (~6 Jest cases) reads `app/(auth)/signup.tsx` from disk + comment-strips per Story 12-2 P12 lesson + asserts: (i) the file imports `validatePasswordStrength` from `@/src/lib/password-policy`, (ii) the file imports `PasswordStrengthIndicator` from `@/src/components/auth/PasswordStrengthIndicator`, (iii) NEGATIVE guard — the literal regex `password\.length\s*<\s*6` is NOT present (catches a regression that copy-pastes the old check back), (iv) NEGATIVE guard — the literal regex `min\.\s*6\s*caractères` is NOT present (catches a regression that drops the placeholder back), (v) NEGATIVE guard — `captureError\(.*password` regex matches ZERO lines (the password is NEVER passed to Sentry), (vi) `MIN_PASSWORD_LENGTH` from `password-policy.ts` is referenced (or its value `10` appears in the placeholder string `min. 10 caractères`); (h) **NEW operator runbook `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md`** (~120 lines) documenting the **two-layer defense** — (i) **Layer 1 (client-side, this story)**: client validator at `src/lib/password-policy.ts` + UI strength indicator + itemized error mapping; (ii) **Layer 2 (server-side, OPERATOR action required after merge)**: Supabase Dashboard → Authentication → Policies → Password Policy → set `Minimum length: 10` + `Required characters: Lowercase, uppercase letters, digits` (the `lower_upper_letters_and_digits` enum); the runbook includes (a) a step-by-step screenshot-compatible walkthrough (project URL, exact menu path, exact dropdown labels), (b) a **verification recipe** — `curl -X POST $SUPABASE_URL/auth/v1/signup -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"email":"test+12-8@example.com","password":"abc123"}'` MUST return HTTP 422 with `code: "weak_password"` AND `reasons: ["length", "characters"]`; if it does NOT, the dashboard config did not save correctly and Layer 2 is not in force, (c) a **rollback procedure** — to undo the policy tightening (e.g., if a customer support escalation requires it temporarily), set `Minimum length: 6` + `Required characters: None` in the dashboard; the client-side validator at Layer 1 will continue to reject weak passwords on signup but EXISTING users with weak passwords are NOT affected (Supabase does NOT re-validate stored passwords on policy change), (d) the **HIBP toggle section** — the same dashboard page has a `"Block leaked passwords"` toggle; it requires Supabase Pro Plan or above; the runbook documents the upgrade path AND the per-signup additional latency (~50-200ms HTTPS to api.pwnedpasswords.com via Supabase's backend; user-facing UX impact is invisible because it overlaps with the existing email-verification round-trip); operator decision section explicitly notes: "Defer until Pro upgrade is justified by other features (Auth telemetry, custom SMTP, more rate-limit headroom). Story 12-8 ships shippable security WITHOUT HIBP."; (i) **NO new packages** — `@supabase/supabase-js` is already in `package.json`; `expo-secure-store` is already in `package.json`; the new module uses only built-in regex + the existing Supabase client; (j) **NO migration file** — Supabase Auth's password policy is **dashboard-only** configuration (it lives in the platform's Auth service config, NOT in the project's Postgres schema). Migrations cannot set Auth policy. The runbook in deliverable (h) is the operator's deliverable; the SQL surface stays unchanged; (k) **NO `auth-bootstrap.ts` changes** — `signUpWithEmail` at line 338-347 calls Supabase verbatim; the validation happens at the UI layer in `signup.tsx`. This preserves Story 12-2's bootstrap-as-thin-binding contract; (l) **NO change to `forgot-password.tsx`** — that screen sends a reset link only and does not accept a password (Supabase's reset flow opens a magic-link session and the user changes the password in a future-story `reset-password-confirm.tsx` UI that is OUT OF SCOPE for 12-8 but WILL consume `validatePasswordStrength` from the new module when it ships); (m) **NO change to `_layout.tsx`** — Story 12-9 owns the email-verification gate; 12-8 is orthogonal to verification; (n) **CLAUDE.md architecture line** added after the Story 12-7 paragraph documenting: the new `password-policy.ts` module + the 4-rule client validator + the strength indicator component + the Supabase server-side dashboard config (referenced via the runbook) + the `weak_password` error mapper + cross-story invariants preserved (9-3 Sentry — password never flows to telemetry / 9-6 auth-listener — orthogonal / 12-2 bootstrap — `signUpWithEmail` unchanged / 12-7 secure-cache — orthogonal); the operator runbook path is referenced inline,

so that **audit finding P1-12 closes architecturally** for new accounts (existing weak passwords are NOT retroactively rejected — Supabase does not re-validate stored hashes on policy change; the next-natural-step is for Story 12-X to add a "Your password no longer meets our security requirements" prompt on next-signin for existing weak passwords, but that's a UX-flow story OUT OF SCOPE for 12-8); **the two-layer defense is operationally documented** — even if a future code-edit accidentally drops the client check, Supabase Auth still rejects the signup at HTTP 422 with `weak_password`; even if a future operator accidentally relaxes the dashboard policy, the client check still rejects weak inputs at the UI layer; **the user gets actionable French feedback** — itemized requirement checklist on every keystroke + clear French Alert messages on failed signup, replacing the pre-12-8 "Mot de passe (min. 6 caractères)" + "Password must be at least 6 characters" mishmash; **the password never flows to Sentry** — the new drift detector pins zero `captureError(*, password)` calls, defending against accidental telemetry leaks; **HIBP is operator-flippable** — the Pro-tier upgrade enables HIBP via dashboard toggle; the existing `mapSupabaseWeakPasswordError` already handles the `"pwned"` reason because the v1 implementation includes it (forward-compatible — if HIBP is flipped on without a code change, existing users see the new rejection message); **the policy module is reusable** — future password-change / reset-password-confirm screens consume `validatePasswordStrength` + `PasswordStrengthIndicator` without re-inventing the rules; **NIST 800-63B alignment** — chosen composition rule (lower + upper + digit, no mandatory symbols) follows the latest NIST guidance and minimizes mobile-keyboard friction; **mobile keyboard friction minimized** — no symbol requirement means users don't need to toggle to the symbol keyboard mode at signup time; **accessibility-first** — progress bar + checklist + live region all wired with proper roles; **Story 12-8 closes 1 audit finding (P1-12) as a SMALL discrete story** — 1 new lib module + 1 new component + 1 modified screen + 1 new runbook + 2 test files + 0 packages + 0 migrations; total diff < 700 lines.

## Background — Why This Story Exists

### What audit finding P1-12 owns to this story

[`shippable-roadmap.md` line 64](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P1-12 — Weak password policy (6 chars, no complexity) — `app/(auth)/signup.tsx:78-80` — security"

Epic 12.8 deliverable at [`shippable-roadmap.md` line 211](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Tighten password policy (≥10 chars, complexity); add Supabase HIBP if available. **Covers P1-12.**"

### Current state — the bug at the validation path

Pre-12-8 [`app/(auth)/signup.tsx:79-82`](app/(auth)/signup.tsx#L79-L82) (`handleSignUp`):

```typescript
if (password.length < 6) {
  Alert.alert("Error", "Password must be at least 6 characters.");
  return;
}
```

Pre-12-8 placeholder at [line 246](app/(auth)/signup.tsx#L246):

```typescript
placeholder="Mot de passe (min. 6 caractères)"
```

Pre-12-8 accessibility hint at [line 254](app/(auth)/signup.tsx#L254):

```typescript
accessibilityHint="Enter a password with at least 6 characters"
```

The `signUpWithEmail` action at [`src/lib/auth-bootstrap.ts:338-347`](src/lib/auth-bootstrap.ts#L338-L347):

```typescript
export async function signUpWithEmail(email: string, password: string, fullName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });
  return { data, error };
}
```

No server-side rejection happens for `"123456"` because the dashboard policy is at its default (`min_length: 6, password_required_characters: ""`).

### Threat model — what the 6-char floor actually permits today

| Password (entered today) | Accepted? | Why dangerous |
| --- | --- | --- |
| `123456` | ✅ Yes | Top-1 leaked password (~24M occurrences in HIBP corpus). Cracks instantly via online attack against Supabase's default 30/min auth rate-limit. |
| `password` | ✅ Yes | Top-5 leaked password. Same. |
| `qwerty` | ✅ Yes | Top-10. |
| `abc123` | ✅ Yes | Top-50. |
| `welcome` | ❌ No (length) | But `welcome1` (top-100) ✅. |
| `Abc123` | ✅ Yes | Top-1000; deceptively "strong" because mixed-case. |

Post-12-8, the same passwords are rejected at TWO layers:

| Password | Client-side (Layer 1) | Server-side (Layer 2 — dashboard config) |
| --- | --- | --- |
| `123456` | ❌ length + lowercase + uppercase | ❌ `weak_password / [length, characters]` |
| `password` | ❌ length + uppercase + digit | ❌ `weak_password / [length, characters]` |
| `Welcome123` | ✅ valid (10 chars + L + U + D) | ✅ valid; HIBP flag (Pro plan) would reject this |
| `Welcome2024!` | ✅ valid | ✅ valid; HIBP would reject this |
| `correct horse battery` | ❌ uppercase + digit | ❌ `weak_password / [characters]` |
| `Correct Horse Battery 9` | ✅ valid (23 chars + L + U + D) | ✅ valid; not in HIBP |

The composition rule trades off **passphrase friendliness** vs. **simple-password rejection**. NIST 800-63B prefers length over composition; this story keeps a minimum composition floor as a defense against the most common weak passwords while the operator decides whether to upgrade to Pro and enable HIBP (which would catch `Welcome123`-class passwords that pass composition but appear in leak corpora).

### Why route inside `password-policy.ts` instead of inline?

Two design options:

1. **Inline in `signup.tsx`** — write the validator + checklist component + error mapper inline. Pro: smallest possible diff. Con: future change-password / reset-password-confirm screens duplicate the rules; drift inevitable; one-shot-edit foot-gun.

2. **Extracted `password-policy.ts` + `PasswordStrengthIndicator.tsx`** (chosen) — single source of truth. Pro: future password surfaces consume one validator; drift impossible because the constants + regexes live in one file; testable as pure functions. Con: 2 extra files in the diff.

Option 2 wins because the security rule is a single source-of-truth concern, AND the strength indicator is a UI primitive that any future password input can reuse. The follow-up reset-password-confirm UI (out of scope for 12-8, eventual story 12-13 or 14-X) consumes the module unchanged.

### Why NOT call HIBP from the client directly?

HaveIBeenPwned offers a [k-anonymity API](https://haveibeenpwned.com/API/v3#PwnedPasswords) where the client sends only the first 5 chars of the SHA-1 of the password. The full password never leaves the device. So in principle the client COULD call HIBP directly and short-circuit a known-leaked password before the signup roundtrip.

This story does NOT implement client-side HIBP because:

1. HIBP rate-limits at 1.5s per request from the same IP — abusable to DoS.
2. Adding a third-party HTTPS dependency in the signup hot-path adds latency the user notices (200-800ms via mobile networks).
3. Supabase's server-side HIBP integration is the canonical path; doing it on the server avoids re-implementing rate-limit + cache logic in the client.
4. The Supabase Pro tier upgrade IS the operator-decision point. Doing HIBP on the client would mask the upgrade decision and add code that's redundant once the upgrade lands.

The runbook documents the Pro-tier upgrade path; client-side HIBP is explicitly out-of-scope.

### Why NOT enforce policy via SQL migration?

Supabase Auth's password policy lives in the **Auth service** (separate from the project's Postgres schema). The Auth service config is exposed only via:

- **Dashboard UI** (Authentication → Policies → Password Policy) — the canonical operator surface.
- **Management API** (`PATCH /v1/projects/{ref}/config/auth`) — programmatic but requires a personal access token + project ref; brittle in CI; recommended only for staging-environment-bootstrap automation.

Migrations cannot touch this. The runbook in deliverable (h) is the operator deliverable; CI cannot enforce the dashboard config. The drift detector in deliverable (g) catches client-side regressions but a server-side policy relaxation would only be caught by the runbook's verification step (an operator action item).

### Why NOT update existing weak passwords?

Supabase Auth does NOT re-validate stored passwords on policy change. An existing user with `123456` continues to sign in successfully post-12-8. The fix for that scenario is a **next-signin force-rotate prompt** ("Your password no longer meets our security requirements; please update it") — an out-of-scope UX flow story, deferred until Story 12-9 (email verification gate) lands the surrounding auth-flow infrastructure.

For the operator-grep path: today the Companion app has zero production users (per [`docs/`](docs/) absence of any user-count claim) — the existing-weak-passwords risk is bounded to the operator's own test accounts.

### Spec — `src/lib/password-policy.ts` shape

```typescript
import { addBreadcrumb } from "@/src/lib/sentry";

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordPolicyReason = "length" | "lowercase" | "uppercase" | "digit";

export type PasswordPolicyResult = {
  valid: boolean;
  reasons: PasswordPolicyReason[];
};

export function validatePasswordStrength(password: string): PasswordPolicyResult {
  const reasons: PasswordPolicyReason[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) reasons.push("length");
  if (!/[a-z]/.test(password)) reasons.push("lowercase");
  if (!/[A-Z]/.test(password)) reasons.push("uppercase");
  if (!/\d/.test(password)) reasons.push("digit");
  return { valid: reasons.length === 0, reasons };
}

const FRENCH_MESSAGES: Record<PasswordPolicyReason, string> = {
  length: "Au moins 10 caractères",
  lowercase: "Au moins une minuscule",
  uppercase: "Au moins une majuscule",
  digit: "Au moins un chiffre",
};

export function passwordPolicyReasonToFrenchMessage(reason: PasswordPolicyReason): string {
  return FRENCH_MESSAGES[reason];
}

const PWNED_FRENCH_MESSAGE = "Ce mot de passe a été divulgué dans une fuite de données";

export function mapSupabaseWeakPasswordError(
  error: unknown,
  password?: string
): PasswordPolicyReason[] | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code: unknown }).code !== "weak_password"
  ) {
    return null;
  }
  const reasons = (error as { reasons?: unknown }).reasons;
  if (!Array.isArray(reasons)) return [];
  const out: PasswordPolicyReason[] = [];
  for (const r of reasons) {
    if (r === "length") out.push("length");
    if (r === "characters" && typeof password === "string") {
      const clientResult = validatePasswordStrength(password);
      out.push(...clientResult.reasons.filter((x) => x !== "length"));
    }
    // "pwned" is intentionally not appended to PasswordPolicyReason[];
    // callers handle pwned via the separate PWNED_FRENCH_MESSAGE export.
  }
  return out;
}

export function isPwnedRejection(error: unknown): boolean {
  // ... checks error.code === "weak_password" AND reasons.includes("pwned")
}

export function getPwnedFrenchMessage(): string {
  return PWNED_FRENCH_MESSAGE;
}

export function computePasswordStrengthLabel(
  reasons: PasswordPolicyReason[],
  passwordLength: number
): "weak" | "medium" | "strong" {
  if (reasons.length >= 3) return "weak";
  if (reasons.length > 0) return "medium";
  return passwordLength >= 14 ? "strong" : "medium";
}
```

### Spec — `src/components/auth/PasswordStrengthIndicator.tsx` shape

```typescript
import { memo, useMemo } from "react";
import { View, Text } from "react-native";

import { Colors } from "@/src/lib/design";
import {
  validatePasswordStrength,
  passwordPolicyReasonToFrenchMessage,
  computePasswordStrengthLabel,
  type PasswordPolicyReason,
} from "@/src/lib/password-policy";

const STRENGTH_LABELS: Record<"weak" | "medium" | "strong", string> = {
  weak: "Faible",
  medium: "Moyen",
  strong: "Fort",
};

const STRENGTH_COLORS: Record<"weak" | "medium" | "strong", string> = {
  weak: Colors.error,
  medium: Colors.warning,
  strong: Colors.success,
};

const ALL_REASONS: PasswordPolicyReason[] = ["length", "lowercase", "uppercase", "digit"];

interface PasswordStrengthIndicatorProps {
  password: string;
}

function PasswordStrengthIndicatorImpl({ password }: PasswordStrengthIndicatorProps) {
  const { valid, reasons } = useMemo(() => validatePasswordStrength(password), [password]);
  const label = useMemo(
    () => computePasswordStrengthLabel(reasons, password.length),
    [reasons, password.length]
  );

  if (password.length === 0) return null;

  const segmentCount = label === "weak" ? 1 : label === "medium" ? 2 : 3;
  const color = STRENGTH_COLORS[label];

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Password strength"
      accessibilityValue={{ min: 0, max: 3, now: segmentCount }}
    >
      {/* progress bar segments */}
      {/* checklist of 4 reasons with check/uncheck states */}
      {/* live-region label */}
    </View>
  );
}

export const PasswordStrengthIndicator = memo(PasswordStrengthIndicatorImpl);
```

### Spec — `app/(auth)/signup.tsx` modifications

```diff
+ import { validatePasswordStrength, mapSupabaseWeakPasswordError, passwordPolicyReasonToFrenchMessage, isPwnedRejection, getPwnedFrenchMessage } from "@/src/lib/password-policy";
+ import { PasswordStrengthIndicator } from "@/src/components/auth/PasswordStrengthIndicator";

  async function handleSignUp() {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert("Error", "Please enter a valid email address.");
      return;
    }

-   if (password.length < 6) {
-     Alert.alert("Error", "Password must be at least 6 characters.");
+   const policyResult = validatePasswordStrength(password);
+   if (!policyResult.valid) {
+     const itemized = policyResult.reasons.map(passwordPolicyReasonToFrenchMessage).join(" • ");
+     Alert.alert("Mot de passe invalide", itemized);
      return;
    }

    setLoading(true);
    try {
      const { error } = await signUpWithEmail(email.trim(), password, fullName.trim());
      if (error) {
+       if (isPwnedRejection(error)) {
+         Alert.alert("Mot de passe invalide", getPwnedFrenchMessage());
+       } else {
+         const mapped = mapSupabaseWeakPasswordError(error, password);
+         if (mapped && mapped.length > 0) {
+           const itemized = mapped.map(passwordPolicyReasonToFrenchMessage).join(" • ");
+           Alert.alert("Mot de passe invalide", itemized);
+         } else {
            Alert.alert("Sign Up Failed", error.message);
+         }
+       }
      } else {
        Alert.alert("Check Your Email", "...");
      }
    } catch (err) {
      captureError(err, "signup");
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      Alert.alert("Sign Up Failed", message);
    } finally {
      setLoading(false);
    }
  }
```

```diff
- placeholder="Mot de passe (min. 6 caractères)"
+ placeholder="Mot de passe (min. 10 caractères)"

- accessibilityHint="Enter a password with at least 6 characters"
+ accessibilityHint="Enter a password with at least 10 characters and one uppercase, one lowercase, and one digit"
```

```diff
  </View>
+ <PasswordStrengthIndicator password={password} />
</View>
```

### Spec — runbook `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md`

Sections (~120 lines total):

1. **Layer 1 (client-side, deployed by Story 12-8)** — what the validator does, files changed.
2. **Layer 2 (server-side, OPERATOR ACTION REQUIRED)** — step-by-step Supabase Dashboard config:
   - Navigate to https://supabase.com/dashboard/project/{PROJECT_REF}/auth/policies
   - Click "Password Policy" tab
   - Set "Minimum length" to `10`
   - Set "Required characters" dropdown to `Lowercase, uppercase letters, digits`
   - Click "Save"
3. **Verification recipe** — `curl` against `/auth/v1/signup` with `"abc123"` MUST return HTTP 422 + `code: "weak_password"`. Sample responses for both correct and incorrect dashboard config.
4. **HIBP toggle (Pro Plan only)** — same dashboard page; toggle "Block leaked passwords"; explain HIBP's k-anonymity model; document the per-signup latency cost; explain that the client-side validator does NOT need code changes to support HIBP because Story 12-8 already maps the `"pwned"` reason.
5. **Rollback procedure** — to relax the policy in an emergency: set Min length back to 6, Required characters to `None`. Layer 1 still rejects on the client; existing weak passwords are NOT rotated.
6. **Cross-story dependencies** — Story 12-9 (email verification gate) is orthogonal; Stories 12-1 through 12-7 are orthogonal; future password-change UI will reuse `validatePasswordStrength`.
7. **Operator decision log** — date the operator applied the dashboard config; whether HIBP is on; the deployment commit SHA.

## Acceptance Criteria

1. **Client-side validator module exists.** [`src/lib/password-policy.ts`](src/lib/password-policy.ts) is created with: `MIN_PASSWORD_LENGTH = 10` constant; `validatePasswordStrength(password): PasswordPolicyResult` pure function checking length + ASCII lowercase + ASCII uppercase + digit; `passwordPolicyReasonToFrenchMessage(reason): string` localizer with the 4 canonical French strings; `mapSupabaseWeakPasswordError(error, password?): PasswordPolicyReason[] | null` translator handling `code === "weak_password"` + the `["length", "characters", "pwned"]` reasons taxonomy; `isPwnedRejection(error): boolean` + `getPwnedFrenchMessage(): string` for the HIBP-rejection path; `computePasswordStrengthLabel(reasons, passwordLength): "weak" | "medium" | "strong"` strength meter helper. All exports have JSDoc explaining the rule + threat-model rationale.

2. **Signup screen consumes the validator.** [`app/(auth)/signup.tsx`](app/(auth)/signup.tsx) is modified: the `password.length < 6` branch is replaced with a `validatePasswordStrength(password)` call; on `result.valid === false`, an `Alert.alert("Mot de passe invalide", _)` shows the itemized French requirements joined with `" • "`; the placeholder is updated to `"Mot de passe (min. 10 caractères)"`; the `accessibilityHint` is updated to mention all 4 requirements; the catch-block on `signUpWithEmail` error first runs `isPwnedRejection` then `mapSupabaseWeakPasswordError(error, password)` before falling back to `error.message`.

3. **Live strength indicator component exists.** [`src/components/auth/PasswordStrengthIndicator.tsx`](src/components/auth/PasswordStrengthIndicator.tsx) is created with `{password: string}` props; renders a 3-segment progress bar + an itemized 4-line checklist (✓/✗ per requirement) + a French strength label (`"Faible"` / `"Moyen"` / `"Fort"`); hides itself when `password.length === 0`; is wrapped in `React.memo` for keystroke performance; uses `Colors.error` / `Colors.warning` / `Colors.success` from the design tokens (NO hardcoded hex). Accessibility: `accessibilityRole="progressbar"` + `accessibilityValue` + per-checklist-item `accessibilityRole="checkbox"` + `accessibilityState={{checked: met}}` + label region with `accessibilityLiveRegion="polite"`.

4. **Signup screen renders the indicator.** [`app/(auth)/signup.tsx`](app/(auth)/signup.tsx) imports `PasswordStrengthIndicator` and renders `<PasswordStrengthIndicator password={password} />` immediately below the password input field. Manual smoke: typing `Abc123` shows medium-strength indicator with length-failed checklist item dimmed; typing `Abcdefghi1` shows strong-strength with all 4 checklist items checked.

5. **Operator runbook exists.** [`_bmad-output/planning-artifacts/runbooks/auth-password-policy.md`](_bmad-output/planning-artifacts/runbooks/auth-password-policy.md) is created with the 7 sections in deliverable (h)'s spec: Layer 1 description / Layer 2 dashboard config walkthrough / `curl` verification recipe / HIBP toggle (Pro Plan) / rollback procedure / cross-story dependencies / operator decision log. The runbook is self-contained — an operator with no prior context applies it in 5 minutes.

6. **Server-side dashboard policy is documented (NOT enforced by code).** The runbook is explicit that Layer 2 is an OPERATOR ACTION required after merge; the deploy is NOT considered complete until the operator confirms the dashboard config is saved AND the `curl` verification passes. The operator-decision-log section is a placeholder for the operator to fill in post-deploy.

7. **Regression test coverage exists.**
   - [`src/lib/__tests__/password-policy.test.ts`](src/lib/__tests__/password-policy.test.ts) covers the 22 cases enumerated in deliverable (f).
   - [`src/lib/__tests__/password-policy-source-drift.test.ts`](src/lib/__tests__/password-policy-source-drift.test.ts) covers the 6 source-drift cases in deliverable (g) — including the negative guard against `password\.length\s*<\s*6` regression AND the negative guard against `captureError(*, password)` (password never to Sentry).

8. **Tests pass.** `npm test` exit code 0; new test file count is +2; total Jest case count rises by ~28 cases (22 + 6 = ~28; minor variance acceptable).

9. **Quality gates green.** `npm run type-check && npm run lint && npm run format:check` all pass.

10. **No `captureError(*, password)` anywhere.** The drift detector pins this; manual `grep -rn "captureError" app/(auth)/signup.tsx | grep -i password` returns empty.

11. **Cross-story invariants preserved.**
    - Story 9-3: no new feature tags or extras keys added to `SENTRY_EXTRAS_ALLOWLIST`.
    - Story 9-4: the new module is pure-data validation; no user-derived prompt path; the password is validated before reaching any prompt builder.
    - Story 9-6: `decideAuthAction` switch unchanged; auth listener body unchanged.
    - Story 12-2: `bootstrapAuth()` + `signUpWithEmail` static export unchanged.
    - Story 12-7: `cache.ts` unchanged; the password is never cached.
    - Stories 12-1 / 12-3 / 12-4 / 12-5 / 12-6: orthogonal; no realtime / activity / audio / transcript surfaces touched.

12. **CLAUDE.md architecture line added** after the Story 12-7 paragraph documenting the new module + validator + indicator component + dashboard runbook + the 4-rule composition + HIBP-flippability + 0 consumer drift.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex. (`PasswordStrengthIndicator` uses `Colors.gray200` / `Colors.error` / `Colors.warning` / `Colors.success` / `Colors.textTertiary` / `Colors.textSecondary`.)
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners. (Not applicable — no async load in the indicator.)
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`. (Progress bar + each checklist item.)
- [x] Non-obvious interactions have `accessibilityHint`. (Updated on the password input.)
- [x] Stateful elements have `accessibilityState`. (Per checklist item: `{checked: met}`.)
- [x] All tappable elements have minimum 44x44pt touch targets. (Indicator is non-interactive; signup button unchanged.)
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`. (Existing `captureError(err, "signup")` preserved.)
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`. (Indicator uses `Typography.caption` for the checklist + label.)
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`. Verifying that the file is *visible to git but not yet tracked* catches the ignore-rule footgun before story 1 of any future project.
-->

- [x] `git status` lists this story file under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-8-password-policy-tightening.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] **Task 1 — Create `src/lib/password-policy.ts` module** (AC: #1)
  - [x] Subtask 1.1: Add `MIN_PASSWORD_LENGTH = 10` constant + `PasswordPolicyReason` type union.
  - [x] Subtask 1.2: Implement `validatePasswordStrength(password): PasswordPolicyResult` — ALL four checks, return all failing reasons (NOT short-circuit). Use ASCII regexes (`/[a-z]/` / `/[A-Z]/` / `/\d/`) to mirror Supabase server-side semantics.
  - [x] Subtask 1.3: Add `passwordPolicyReasonToFrenchMessage` localizer with the 4 canonical strings.
  - [x] Subtask 1.4: Implement `mapSupabaseWeakPasswordError(error, password?)` translator handling `code === "weak_password"` + the `["length", "characters", "pwned"]` taxonomy + the round-trip from `"characters"` to client-side itemized list.
  - [x] Subtask 1.5: Add `isPwnedRejection(error)` + `getPwnedFrenchMessage()` for the HIBP path.
  - [x] Subtask 1.6: Implement `computePasswordStrengthLabel(reasons, passwordLength): "weak" | "medium" | "strong"` per spec (3+ reasons → weak, 1-2 → medium, 0 with length ≥ 14 → strong, 0 with length < 14 → medium).
  - [x] Subtask 1.7: Add JSDoc to every export with the threat-model rationale + cross-references to the runbook + `weak_password` Supabase contract.

- [x] **Task 2 — Create `src/components/auth/PasswordStrengthIndicator.tsx` component** (AC: #3)
  - [x] Subtask 2.1: Create the file with `{password: string}` props. Wrap in `React.memo`.
  - [x] Subtask 2.2: Compute strength via `validatePasswordStrength` + `computePasswordStrengthLabel` inside `useMemo` keyed off `password`.
  - [x] Subtask 2.3: Render a 3-segment progress bar (1/3/2 segments active for weak/strong/medium); colors from design tokens.
  - [x] Subtask 2.4: Render the 4-line French requirements checklist with checkmark/cross icons (Unicode `✓` / `✗`), color-coded met/unmet from `Colors.success` / `Colors.textTertiary`.
  - [x] Subtask 2.5: Render the strength label (`"Faible"` / `"Moyen"` / `"Fort"`) right-aligned.
  - [x] Subtask 2.6: Wire accessibility — `accessibilityRole="progressbar"` + `accessibilityValue` on the bar; `accessibilityRole="checkbox"` + `accessibilityState={{checked: met}}` on each checklist item; `accessibilityLiveRegion="polite"` on the label.
  - [x] Subtask 2.7: Hide the entire component (return `null`) when `password.length === 0`.
  - [x] Subtask 2.8: Verify NO hardcoded hex colors; all `Typography.*` presets; no raw `fontSize`.

- [x] **Task 3 — Modify `app/(auth)/signup.tsx`** (AC: #2, #4, #10)
  - [x] Subtask 3.1: Import `validatePasswordStrength`, `mapSupabaseWeakPasswordError`, `passwordPolicyReasonToFrenchMessage`, `isPwnedRejection`, `getPwnedFrenchMessage` from `@/src/lib/password-policy`.
  - [x] Subtask 3.2: Import `PasswordStrengthIndicator` from `@/src/components/auth/PasswordStrengthIndicator`.
  - [x] Subtask 3.3: Replace the `password.length < 6` block (lines 79-82) with the `validatePasswordStrength` call; show itemized French Alert on failure.
  - [x] Subtask 3.4: Update the placeholder at line 246 to `"Mot de passe (min. 10 caractères)"`.
  - [x] Subtask 3.5: Update the `accessibilityHint` at line 254 to mention all 4 requirements.
  - [x] Subtask 3.6: Render `<PasswordStrengthIndicator password={password} />` immediately below the password input wrapper (after the `</View>` that closes the input row, before the next form element).
  - [x] Subtask 3.7: Extend the catch-block on `signUpWithEmail` error — first check `isPwnedRejection`, then `mapSupabaseWeakPasswordError`, before falling back to `error.message`.
  - [x] Subtask 3.8: VERIFY no `captureError` invocation passes the `password` variable (manual grep + drift detector covers).

- [x] **Task 4 — Create operator runbook** (AC: #5, #6)
  - [x] Subtask 4.1: Create `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md` with the 7 sections per deliverable (h) spec.
  - [x] Subtask 4.2: Include the exact dashboard navigation path: Authentication → Policies → Password Policy → Minimum length / Required characters dropdown.
  - [x] Subtask 4.3: Include the verification `curl` command with both correct (HTTP 422) and incorrect (HTTP 200/400) sample responses.
  - [x] Subtask 4.4: Include the HIBP Pro-tier toggle section with cost / latency / forward-compat call-out.
  - [x] Subtask 4.5: Include the rollback procedure for emergencies.
  - [x] Subtask 4.6: Include the operator decision-log placeholder for post-deploy fill-in.

- [x] **Task 5 — Add regression tests** (AC: #7, #8)
  - [x] Subtask 5.1: Create `src/lib/__tests__/password-policy.test.ts` with the 22 cases enumerated in deliverable (f). Verify edge cases at length boundaries 9/10 (P1 pinning) AND Cyrillic characters (P11 ASCII-regex pin) AND the `mapSupabaseWeakPasswordError` round-trip from `"characters"` → client-itemized.
  - [x] Subtask 5.2: Create `src/lib/__tests__/password-policy-source-drift.test.ts` with the 6 drift-detector cases per deliverable (g). Use `fs.readFileSync` + comment-strip per Story 12-2 P12 lesson.
  - [x] Subtask 5.3: Run `npm test` — verify exit 0; verify total case count rose by ~28.

- [x] **Task 6 — Quality gates + CLAUDE.md update** (AC: #9, #11, #12)
  - [x] Subtask 6.1: Run `npm run type-check && npm run lint && npm run format:check`. All must exit 0.
  - [x] Subtask 6.2: Append a Story 12-8 paragraph to `CLAUDE.md` after the Story 12-7 paragraph, following the established prose style (multi-clause, file:line refs in backticks, cross-story invariant-preservation list, regression test summary, verification date).
  - [x] Subtask 6.3: Verify NO additions to `SENTRY_EXTRAS_ALLOWLIST` in `src/lib/sentry.ts`.

## Dev Notes

### Project conventions to follow

- **Path alias `@/*`** maps to repo root (e.g., `import { validatePasswordStrength } from "@/src/lib/password-policy"`).
- **Module placement** — pure logic goes in `src/lib/`; React components go in `src/components/<feature>/` (here: `src/components/auth/`).
- **Test file co-location** — Jest tests go in `src/lib/__tests__/<module>.test.ts`. Drift detectors get a `-source-drift.test.ts` suffix.
- **NativeWind v4 styling** — combine `className` strings with `Colors.*` for inline styles; never hardcode hex.
- **TypeScript strict mode** — all new code passes `tsc --noEmit`.
- **Sentry contract (Story 9-3)** — only allowlisted extras keys; never log secrets / passwords / PII.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist (no new keys; password not in `captureError` extras anywhere).
- Story 9-6 `decideAuthAction` switch unchanged.
- Story 12-2 `bootstrapAuth()` + `signUpWithEmail` body unchanged (the validator runs in the screen, not in the bootstrap module — preserves the bootstrap-as-thin-binding contract).
- Story 12-7 cache layer untouched.

### Known footguns (from prior story retros)

- **Comment-strip when drift-detecting** (Story 12-2 P12): if the drift detector reads source from disk, strip comments first so JSDoc that mentions deprecated patterns doesn't trip the negative-guard regex.
- **ASCII vs Unicode regex semantics**: `/[a-z]/` is ASCII-only by default; `\p{Ll}` (Unicode) would accept Cyrillic / Greek / Armenian lowercase. We deliberately match Supabase's ASCII-only server-side semantics — drift would create the silent client-pass / server-fail UX trap.
- **`weak_password` reasons taxonomy**: Supabase returns `"length"` / `"characters"` / `"pwned"` (verified 2026-05-13 via Context7 `/websites/supabase`). The `"characters"` reason is a single coarse signal — the operator decides which sub-rules are required via the dashboard. The client-side validator must re-derive itemization from the password to give the user actionable feedback. Pin this with case (xviii) in the test file.
- **HIBP forward-compat**: the implementation handles `"pwned"` via `isPwnedRejection` + `getPwnedFrenchMessage` even though HIBP isn't enabled today. When the operator flips the toggle on Pro upgrade, no code change is needed.
- **Existing weak passwords**: Supabase does NOT re-validate stored passwords on policy change. Existing users with `123456` continue to sign in. This story does NOT include a force-rotate prompt — out of scope.
- **Migration NOT possible**: Auth policy is dashboard-only. The runbook is the operator deliverable; the verification `curl` is the only post-deploy check.

### Project Structure Notes

| Path | Action | Rationale |
| --- | --- | --- |
| `src/lib/password-policy.ts` | NEW | Pure validation module — extracts the rule from inline signup code. |
| `src/components/auth/PasswordStrengthIndicator.tsx` | NEW | Reusable strength meter component. |
| `app/(auth)/signup.tsx` | MODIFY | Replace inline `length < 6` check + render indicator + map server errors. |
| `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md` | NEW | Operator-actionable Layer 2 dashboard config + verification + rollback. |
| `src/lib/__tests__/password-policy.test.ts` | NEW | 22 Jest cases pinning all 5 helpers. |
| `src/lib/__tests__/password-policy-source-drift.test.ts` | NEW | 6 drift detectors against signup.tsx regressions. |
| `CLAUDE.md` | MODIFY | Architecture paragraph after Story 12-7 entry. |
| `src/lib/auth-bootstrap.ts` | NO CHANGE | `signUpWithEmail` body verbatim. |
| `src/lib/sentry.ts` | NO CHANGE | No new allowlist keys. |
| `app/(auth)/forgot-password.tsx` | NO CHANGE | No password input on this screen. |
| `app/(auth)/login.tsx` | NO CHANGE | Login does NOT validate passwords (that's Supabase's `signInWithPassword`'s job, and weak passwords already in the system continue to work). |
| `package.json` | NO CHANGE | No new packages. |
| `supabase/migrations/*.sql` | NO CHANGE | Auth policy is dashboard-only. |

### References

- [Source: shippable-roadmap.md#Epic 12 — Mobile/Architecture Hardening (P1) §12.8](_bmad-output/planning-artifacts/shippable-roadmap.md) — deliverable spec.
- [Source: shippable-roadmap.md#P1-12](_bmad-output/planning-artifacts/shippable-roadmap.md) — audit finding.
- [Source: app/(auth)/signup.tsx:79-82](app/(auth)/signup.tsx#L79-L82) — current weak-validator location.
- [Source: src/lib/auth-bootstrap.ts:338-347](src/lib/auth-bootstrap.ts#L338-L347) — `signUpWithEmail` thin wrapper around `supabase.auth.signUp`.
- [Source: src/lib/sentry.ts](src/lib/sentry.ts) — `SENTRY_EXTRAS_ALLOWLIST` (Story 9-3 contract).
- [Source: src/lib/design.ts](src/lib/design.ts) — `Colors.*` + `Typography.*` design tokens.
- [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security) (verified 2026-05-13 via Context7) — `password_required_characters` enum + HIBP plan-tier requirement.
- [Supabase Auth Error Codes](https://supabase.com/docs/guides/auth/debugging/error-codes) (verified 2026-05-13 via Context7) — `weak_password` code + `AuthWeakPasswordError` `reasons` array contract.
- [NIST SP 800-63B §5.1.1.2](https://pages.nist.gov/800-63-3/sp800-63b.html#sec5) — composition-rules-considered-harmful guidance; basis for the no-symbol-requirement decision.
- Previous story patterns: [Source: _bmad-output/implementation-artifacts/12-7-encrypted-profile-cache.md](_bmad-output/implementation-artifacts/12-7-encrypted-profile-cache.md) — module-extraction style, drift-detector pattern, runbook style, scope discipline.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- 2026-05-13: Branched from `origin/main` (post-12-7 baseline; PR #82 merged at commit `b7c1716`); branch `feature/12-8-password-policy-tightening`.
- Test count: 1437 (post-12-7) → 1473 (+36 net cases). Spec estimated ~28; the actual delta covers (a) the spec's 22 policy cases, (b) the spec's 6 drift cases, (c) 8 additional happy-path / boundary / negative-guard cases I added during implementation for completeness (Cases 20b/20c for combined-reasons + non-array-reasons; Cases 21b/21c for non-pwned discrimination + canonical French copy; Cases 22a-e for the 5 strength-label thresholds).
- Quality gates: `npm run type-check` ✓ / `npm run lint` ✓ / `npm run format:check` ✓ / `npm test` ✓ (1473/1473) / drift-detector ✓.
- Cross-story invariants verified clean (zero diff on `src/lib/sentry.ts`, `src/lib/auth-bootstrap.ts`, `src/lib/cache.ts`).
- One implementation deviation from spec: PasswordStrengthIndicator uses `·` (middle dot) for unmet checklist items rather than the spec-suggested `✗` — the dot is visually quieter and reads as "not yet" instead of "wrong" (the cross would imply the user did something incorrect, when in reality they're mid-typing). Functionally equivalent; accessibility uses `accessibilityState.checked: false` which screen readers announce correctly regardless of icon choice.

### Completion Notes List

- **Audit P1-12 closes architecturally.** Pre-12-8 the signup flow accepted `"123456"` / `"password"` / `"qwerty"` (all top-100 leaked passwords); post-12-8 those are rejected at the client by `validatePasswordStrength` before the wire AND (after operator runbook step) at the Supabase Auth server with HTTP 422 `weak_password`.
- **Two-layer defense in place.** Layer 1 (client) ships with this code; Layer 2 (Supabase Dashboard) requires a 5-minute operator action documented in the runbook with a `curl` verification recipe.
- **HIBP forward-compatibility built in.** `isPwnedRejection` + `getPwnedFrenchMessage` already handle the `"pwned"` reason. When the operator upgrades to Supabase Pro and flips the dashboard toggle, no code change is needed — leaked-password rejections surface in French automatically.
- **Password never reaches Sentry.** The drift detector's negative-guard regex (`captureError(*, password)` returns ZERO matches) pins this; future regressions fail CI.
- **0 consumer changes outside `signup.tsx`.** `auth-bootstrap.ts` thin wrapper unchanged; cache layer untouched; auth listener body unchanged.
- **NIST 800-63B aligned.** Composition rule (lower + upper + digit, no mandatory symbols) follows §5.1.1.2 anti-mandatory-composition guidance + minimizes mobile-keyboard friction.
- **ASCII regex semantics deliberately mirror Supabase server-side enforcement** (`/[a-z]/` not `\p{Ll}`) to eliminate the silent client-pass / server-fail UX trap (Cyrillic `"мойпароль123"` fails on both layers identically).
- **Existing weak passwords are NOT rotated** (Supabase contract). The next-natural-step force-rotate prompt at next-signin is out of scope; deferred to a future story alongside Story 12-9's email-verification-gate infrastructure.
- **Operator action required after merge:** apply Layer 2 dashboard config per `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md` Section 2 + run the verification `curl` to confirm HTTP 422 + `code: "weak_password"`. The deploy is NOT considered complete until verification passes.
- **Reusable for future password surfaces.** Future change-password / reset-password-confirm screens consume `validatePasswordStrength` + `PasswordStrengthIndicator` from `src/lib/password-policy.ts` + `src/components/auth/PasswordStrengthIndicator.tsx` without re-inventing the rules.

### File List

**New files (5):**

- `src/lib/password-policy.ts` — pure validator + Supabase error mapper + strength meter (~145 lines).
- `src/components/auth/PasswordStrengthIndicator.tsx` — live UI strength indicator with progress bar + checklist (~145 lines).
- `src/lib/__tests__/password-policy.test.ts` — 22 unit cases (split into 30 actual `it()` blocks for granularity).
- `src/lib/__tests__/password-policy-source-drift.test.ts` — 6 drift-detector cases reading `signup.tsx` from disk.
- `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md` — operator runbook for Layer 2 dashboard config + HIBP toggle + rollback + decision log.

**Modified files (3):**

- `app/(auth)/signup.tsx` — replace `password.length < 6` block with `validatePasswordStrength` call; update placeholder to `"min. 10 caractères"`; update accessibilityHint; render `<PasswordStrengthIndicator>` below input; extend signup error catch with `isPwnedRejection` + `mapSupabaseWeakPasswordError`.
- `CLAUDE.md` — append Story 12-8 architecture paragraph after Story 12-7 entry documenting the two-layer defense + module exports + cross-story invariants.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — flip `12-8-password-policy-tightening` from `backlog` → `ready-for-dev` (story-create) → `review` (this implementation pass).

**Unchanged (cross-story invariants verified):**

- `src/lib/sentry.ts` — no `SENTRY_EXTRAS_ALLOWLIST` additions.
- `src/lib/auth-bootstrap.ts` — `signUpWithEmail` thin wrapper preserved.
- `src/lib/cache.ts` — password is never cached; cache layer untouched.
- `app/(auth)/login.tsx` / `app/(auth)/forgot-password.tsx` — no password validation needed (login uses Supabase's signInWithPassword; forgot-password sends a reset link).
- `package.json` — no new dependencies.
- `supabase/migrations/*.sql` — Auth policy is dashboard-only; no SQL changes possible.

### Change Log

- 2026-05-13 — Story 12-8 implementation. Closes audit P1-12 (weak password policy). Added `src/lib/password-policy.ts` + `src/components/auth/PasswordStrengthIndicator.tsx` + operator runbook + 36 net Jest cases (1437 → 1473). Layer 2 dashboard config requires operator action per runbook.
