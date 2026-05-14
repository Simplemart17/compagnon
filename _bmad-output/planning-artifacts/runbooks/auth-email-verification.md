# Operator Runbook — Auth Email Verification (Story 12-9)

**Last updated:** 2026-05-14
**Story:** [12-9-email-verification-gate](../implementation-artifacts/12-9-email-verification-gate.md)
**Closes audit finding:** P1-15 (`shippable-roadmap.md` line 67)

This runbook covers the **two-layer email-verification defense** the project ships in Story 12-9. Layer 1 is enforced by code that ships with the app build; Layer 2 is enforced by the Supabase Auth dashboard config and **requires operator action** after each environment is provisioned.

---

## 1. Layer 1 — Client-side gate (deployed with the app build)

**Files (no operator action required after merge):**

- `src/lib/email-verification.ts` — pure helpers:
  - `isEmailVerified(user)` — server-state-only check against `user.email_confirmed_at`.
  - `RESEND_COOLDOWN_MS = 60_000` — client-side cooldown matching Supabase's server-side rate-limit.
  - `canResendNow(lastResendAtMs, now)` — boundary-inclusive predicate (`>=`).
  - `secondsUntilResend(lastResendAtMs, now)` — clamped-non-negative integer with `Math.ceil` rounding (never displays "0s remaining" while still waiting).
  - `formatVerificationEmailMask(email)` — privacy mask returning `a***@example.com`; falls back to `"votre adresse e-mail"` on malformed input.
- `src/components/auth/EmailVerificationGate.tsx` — French recovery surface with 3 buttons: Refresh / Resend (60s cooldown) / Sign-out.
- `src/lib/auth-bootstrap.ts` — adds two new module-level static action exports:
  - `resendVerificationEmail(email)` → `supabase.auth.resend({type: "signup", email})`.
  - `refreshSessionAfterVerification()` → `supabase.auth.refreshSession()`.
- `app/_layout.tsx` — three new guards: render-branch (UPSTREAM of `ProfileRetryScreen`) + routing-effect + notification-registration.

**Render-branch ordering enforced inside `RootLayoutNav`:**

```
isLoading → EmailVerificationGate (12-9) → ProfileRetryScreen (9-10) → main app
```

**Surfaces protected behind the gate (audit P1-15 closure):**

| Surface | Pre-12-9 exposure | Post-12-9 protection |
| --- | --- | --- |
| Onboarding placement test (~$0.05 per fresh UID) | Reachable | Blocked by gate |
| Realtime conversation (~$0.05 per 5-min) | Reachable | Blocked by gate |
| Practice exercises + Mock test (~$0.001-$0.04 per call) | Reachable | Blocked by gate |
| Push notification registration | Token registered to abandoned UID | Guarded by `isEmailVerified(user)` |
| Profile cache write (Story 12-7 SecureStore) | Encrypted PII for abandoned UID | Unreachable upstream of profile-load |
| Conversation persistence + memory + error patterns | Rows written under abandoned UID | Unreachable behind gate |

---

## 2. Layer 2 — Supabase Auth dashboard config (OPERATOR ACTION REQUIRED)

**You MUST complete this section after merging Story 12-9 OR after provisioning a new Supabase project (staging, production, etc.).**

### Step-by-step

1. Navigate to your Supabase project dashboard:

   ```
   https://supabase.com/dashboard/project/{PROJECT_REF}/auth/providers
   ```

   Replace `{PROJECT_REF}` with the project ID from the URL.

2. Click the **"Email"** provider.

3. Verify the **"Confirm email"** toggle is **ON**. This is the Supabase default; do NOT disable unless you are intentionally rolling back per Section 5.

4. **Operator decision** — choose between two modes (both supported by Story 12-9):

   | Mode | Behavior | Trade-off |
   | --- | --- | --- |
   | **"Required for sign-up"** (default) | `signUp` returns `{user, session: null}`; the user can then `signInWithPassword` successfully but `user.email_confirmed_at === null` until they click the verification link. The Story 12-9 gate fires post-sign-in. | Friendlier UX (clear French gate surface). The user is "signed in" but blocked. |
   | **"Required for sign-in too"** | `signInWithPassword` rejects with `error.code === "email_not_confirmed"`. The user never gets a session. | Stricter (no server-side state until verified). Worse UX — the user sees a confusing English server error. The Story 12-9 gate is never reached because sign-in fails first. |

   **Recommendation:** start with "Required for sign-up" (default). The Story 12-9 gate provides a clearer French recovery surface than the bare server error.

5. Click **Save**.

6. Wait ~10 seconds for the dashboard to confirm the change propagated to the Auth service.

### Verification recipe — Part A: server-side (`curl`)

Run the following `curl` against the Auth signup endpoint to confirm Layer 2 is in force. Replace `$SUPABASE_URL` and `$SUPABASE_ANON_KEY` with your project's values (from `.env.local`).

> **NOTE — password must satisfy Story 12-8 password policy AND any dashboard composition rules:**
> The example below uses `Abcdefghi1` (10 chars + lowercase + uppercase + digit — passes Story 12-8 client policy). If you've also enabled `lower_upper_letters_and_digits_and_symbols` at the dashboard (Story 12-8 Layer 2), you must add a symbol to satisfy server-side validation. If the password is rejected, you'll get a `weak_password` response — NOT the `email_confirmed_at: null` signal this recipe is checking for. (Review-round-1 L8 patch.)

```bash
# Note: email uses @invalid.localdomain so accidentally-created accounts
# are obviously fake AND the address contains no `+` (which requires
# shell-escaping in some operator shells).
curl -i -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"verify-12-9-gate@invalid.localdomain","password":"Abcdefghi1"}'
```

**Expected response (Layer 2 IS in force — "Confirm email" enabled):**

```json
{
  "id": "<uuid>",
  "aud": "authenticated",
  "email": "verify-12-9-gate@invalid.localdomain",
  "email_confirmed_at": null,
  ...
}
```

Key signal: `"email_confirmed_at": null` (or the field absent entirely). If it is a populated ISO timestamp, "Confirm email" is OFF and Layer 2 is NOT in force.

### Verification recipe — Part B: client-side (sign in and see the gate)

The `curl` confirms Layer 2 is enforcing server-side. To confirm Layer 1 (the in-app gate) is also wired, complete this end-to-end UI verification (review-round-1 L7 patch):

1. In the deployed app, navigate to `/auth/login`.
2. Sign in with the test account credentials from Part A (`verify-12-9-gate@invalid.localdomain` + the same password).
3. Expect the sign-in to succeed (session returned) AND the app to land on the **EmailVerificationGate** screen — NOT `/onboarding` and NOT `/(tabs)/home`. The screen shows:
   - Heading: "Vérifiez votre adresse e-mail"
   - Body: "Nous avons envoyé un lien de vérification à v***@invalid.localdomain. Cliquez sur le lien dans l'e-mail pour activer votre compte."
   - Buttons: "J'ai vérifié — actualiser" (primary) / "Renvoyer l'e-mail" / "Se déconnecter"
4. Tap "J'ai vérifié — actualiser" without clicking any email link first. Expect a French Alert: "Vérification non confirmée — assurez-vous d'avoir cliqué sur le lien dans votre e-mail, puis réessayez." This confirms the post-refresh re-check is wired.
5. Tap "Se déconnecter". Expect to land on `/auth/login`.

If steps 3-5 work as described, BOTH layers of the defense are in force.

**REQUIRED CLEANUP:** delete the test account from Supabase Dashboard → Authentication → Users → search for `verify-12-9-gate@invalid.localdomain` → "Delete user" so the abandoned test account is not a credential-stuffing target.

---

## 3. Email template customization (optional, OPERATOR FOLLOW-UP)

Supabase ships a generic English email template for the "Confirm signup" flow:

```
Confirm your signup
Follow this link to confirm your user:
{{ .ConfirmationURL }}
```

To swap this for a Companion-branded French template:

1. Dashboard → Authentication → Email Templates → "Confirm signup".
2. Replace subject + body with French copy (e.g., "Vérifiez votre adresse e-mail — Companion").
3. Save.

**This is OUT OF SCOPE for Story 12-9** and is deferred to a follow-up story. The default English template is functional and does not block deployment; a French-branded template is a nice-to-have.

---

## 4. Resend rate-limit (Supabase server-side)

`supabase.auth.resend({type: "signup", email})` is rate-limited server-side at 1 request per email per 60 seconds. The client-side `RESEND_COOLDOWN_MS = 60_000` in `src/lib/email-verification.ts` mirrors this duration so the user gets immediate "wait 60s" feedback without round-tripping for a 429.

If the operator changes the server-side rate-limit at the Auth dashboard (Authentication → Rate Limits), the client-side cooldown should be updated to match. The constant is the single source of truth for the resend UX — change ONLY the constant in `email-verification.ts`; the gate component + tests consume it transparently.

---

## 5. Rollback procedure

To disable the verification gate in an emergency (e.g., a P0 incident where verified email is blocking legitimate users):

1. Toggle "Confirm email" **OFF** in the Supabase dashboard (Auth → Providers → Email).
2. Existing unverified users continue to see the client-side gate UNTIL they verify OR until a follow-up code-deploy removes the client-side enforcement.
3. The client-side gate at Layer 1 cannot be remotely disabled — only a code-deploy can drop it.

**Emergency code-side rollback** (last resort):

- Comment out the render-branch in `app/_layout.tsx` (the `if (session && !isEmailVerified(user) && !inAuthGroupRender)` block).
- Comment out the routing-effect guard.
- Comment out the notification-registration guard's `isEmailVerified(user)` clause.
- Ship as a hotfix via OTA update (Story 16-2 OTA infrastructure).

Existing weak/unverified accounts are NOT rotated. The audit finding re-opens until the gate is restored.

---

## 6. Cross-story dependencies

Story 12-9 (email verification) and Story 12-8 (password policy) are **sibling stories** that BOTH must be applied at the dashboard for a hardened auth surface:

| Story | Dashboard surface | Operator action |
| --- | --- | --- |
| 12-8 | Auth → Policies → Password Policy | Min length 10 + Lower/Upper/Digit required |
| 12-9 | Auth → Providers → Email → Confirm email | Toggle ON |

Both run in parallel (no merge-order dependency). The recommended operator checklist post-deploy is to verify BOTH at the dashboard in a single visit.

Related runbooks:

- [auth-password-policy.md](auth-password-policy.md) — Story 12-8 sibling.

---

## 7. Operator decision log

Fill this in after applying Layer 2:

| Field | Value |
| --- | --- |
| Operator | _e.g., Simplemart_ |
| Date applied | _YYYY-MM-DD_ |
| Mode chosen | _"Required for sign-up" / "Required for sign-in too"_ |
| Deployment commit SHA | _e.g., abc1234_ |
| Verification curl returned `email_confirmed_at === null`? | _yes / no_ |
| Test account deleted post-verification? | _yes / no_ |
| Email template customization deferred to follow-up story? | _yes (story 14-X) / no_ |
| Notes | _Free-form_ |
