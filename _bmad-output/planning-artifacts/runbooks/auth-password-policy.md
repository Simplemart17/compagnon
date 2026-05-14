# Operator Runbook — Auth Password Policy (Story 12-8)

**Last updated:** 2026-05-13
**Story:** [12-8-password-policy-tightening](../implementation-artifacts/12-8-password-policy-tightening.md)
**Closes audit finding:** P1-12 (`shippable-roadmap.md` line 64)

This runbook covers the **two-layer password policy defense** the project ships in Story 12-8. Layer 1 is enforced by code that ships with the app build; Layer 2 is enforced by the Supabase Auth dashboard config and **requires operator action** after each environment is provisioned.

---

## 1. Layer 1 — Client-side validator (deployed with the app build)

**Files (no operator action required after merge):**

- `src/lib/password-policy.ts` — pure validator + Supabase error mapper. Exports:
  - `MIN_PASSWORD_LENGTH = 10` constant.
  - `validatePasswordStrength(password) → {valid, reasons[]}` — runs all 4 checks, returns all failing reasons.
  - `passwordPolicyReasonToFrenchMessage(reason)` — French localizer.
  - `mapSupabaseWeakPasswordError(error, password?)` — translates server `weak_password` errors to itemized client-side reasons.
  - `isPwnedRejection(error)` + `getPwnedFrenchMessage()` — HIBP rejection path.
  - `computePasswordStrengthLabel(reasons, length) → "weak" | "medium" | "strong"` — strength meter helper.
- `src/components/auth/PasswordStrengthIndicator.tsx` — 3-segment progress bar + 4-line French requirements checklist; live-updates as the user types.
- `app/(auth)/signup.tsx` — consumes both; renders the indicator below the password input; surfaces server `weak_password` rejections as itemized French Alerts.

**Rules enforced (v1):**

1. **Length ≥ 10 characters.**
2. **At least one ASCII lowercase letter** (`/[a-z]/`).
3. **At least one ASCII uppercase letter** (`/[A-Z]/`).
4. **At least one digit** (`/\d/`).

ASCII semantics deliberately mirror Supabase's server-side enforcement to avoid the silent client-pass / server-fail UX trap (e.g., a Cyrillic-only password passing client and rejected server).

---

## 2. Layer 2 — Supabase Auth dashboard config (OPERATOR ACTION REQUIRED)

**You MUST complete this section after merging Story 12-8 OR after provisioning a new Supabase project (staging, production, etc.).**

### Step-by-step

1. Navigate to your Supabase project dashboard:
   ```
   https://supabase.com/dashboard/project/{PROJECT_REF}/auth/policies
   ```
   Replace `{PROJECT_REF}` with the project ID from the URL (or from your Supabase project settings).

2. Click the **"Password Policy"** tab (or scroll to the "Password" section).

3. Find the **"Minimum password length"** input. Set it to:
   ```
   10
   ```

4. Find the **"Password requirements"** dropdown (label may also read "Required characters"). Select:
   ```
   Lowercase, uppercase letters, digits
   ```
   In the underlying API this corresponds to the enum value `lower_upper_letters_and_digits`.

5. Click **Save**.

6. Wait ~10 seconds for the dashboard to confirm the change propagated to the Auth service.

### Verification recipe

Run the following `curl` against the Auth signup endpoint to confirm Layer 2 is in force. Replace `$SUPABASE_URL` and `$SUPABASE_ANON_KEY` with your project's values (from `.env.local`).

```bash
curl -i -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test+12-8-policy@example.com","password":"abc123"}'
```

**Expected response (Layer 2 IS in force):**

```
HTTP/2 422
content-type: application/json
...

{
  "code": "weak_password",
  "msg": "Password should be at least 10 characters long, contain at least one lowercase letter, one uppercase letter, and one digit.",
  "weak_password": {
    "reasons": ["length", "characters"]
  }
}
```

**INCORRECT response (Layer 2 is NOT in force — dashboard config did not save):**

```
HTTP/2 200
content-type: application/json
...

{
  "user": { "id": "...", "email": "test+12-8-policy@example.com", ... },
  ...
}
```

If you see HTTP 200, the dashboard policy is still at its default (`min_length=6, password_required_characters=""`). Re-do steps 3-5; do NOT consider the deploy complete until the verification returns HTTP 422.

After verification, delete the test user from the Auth dashboard so the email can be re-used for future verifications.

---

## 3. HIBP — HaveIBeenPwned leaked-password protection (Pro Plan)

The same dashboard page exposes a **"Block leaked passwords"** toggle. When enabled, Supabase Auth rejects sign-ups (and password updates) with passwords that appear in the [HaveIBeenPwned Pwned Passwords corpus](https://haveibeenpwned.com/Passwords) (~600M+ leaked passwords). The check uses k-anonymity SHA-1 prefix lookup — only the first 5 chars of the password's SHA-1 hash leave Supabase's backend; the password itself never travels to a third-party service.

### Prerequisites

- **Supabase Pro Plan or above.** The toggle is hidden / disabled on the Free tier.
- Per-signup additional latency: ~50-200ms HTTPS round-trip from Supabase's backend to `api.pwnedpasswords.com`. The user-facing UX impact is invisible because it overlaps with the existing email-verification round-trip.

### How to enable (after Pro upgrade)

1. Go to the same dashboard page used in Section 2.
2. Toggle **"Block leaked passwords"** to **ON**.
3. Click **Save**.

### What changes for the client?

**Nothing.** Story 12-8's `password-policy.ts` already handles the `"pwned"` reason via `isPwnedRejection` + `getPwnedFrenchMessage`. Users who attempt to sign up with a leaked password (e.g., `Welcome2024!` — passes composition but appears in HIBP) see:

> **Mot de passe invalide**
> Ce mot de passe a été divulgué dans une fuite de données

No code change is needed. Forward-compatibility is built-in.

### Verification (HIBP)

After enabling, re-run the verification curl with a known-leaked password:

```bash
curl -i -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test+12-8-pwned@example.com","password":"Welcome2024!"}'
```

Expected: HTTP 422 with `weak_password` AND `reasons` includes `"pwned"`.

### Operator decision: enable HIBP today?

**Recommendation: defer until Pro upgrade is justified by other features** (Auth telemetry, custom SMTP, more rate-limit headroom). Story 12-8 ships shippable security WITHOUT HIBP because:

- Length + composition (Layer 2) catches >99% of automated weak-password attacks.
- HIBP adds catch-rate against credential-stuffing from leaked dumps, but Supabase's default 30-req/min auth rate-limit already throttles online attacks materially.
- The operator can flip the toggle anytime post-Pro-upgrade with zero code change.

---

## 4. Rollback procedure (emergency)

If a customer support escalation or broken policy requires temporarily relaxing the dashboard policy:

1. Go to the same dashboard page.
2. Set **Minimum length** back to `6`.
3. Set **Required characters** back to `None`.
4. Click **Save**.
5. Verify the curl returns HTTP 200 for `password=abc123`.

**What changes:**
- Server-side: Layer 2 is OFF; Supabase accepts weak passwords on signup again.
- Client-side: Layer 1 is STILL in force — the app's `validatePasswordStrength` continues to reject weak passwords at the UI before they reach the wire. Users on the deployed build cannot sign up with weak passwords until you also ship a code rollback.
- Existing users: NOT affected. Supabase does NOT re-validate stored password hashes on policy change. A user with `123456` continues to sign in successfully.

To fully revert, you would also need to redeploy a build with `MIN_PASSWORD_LENGTH = 6` in `password-policy.ts` AND remove the indicator + validator wiring from `signup.tsx` — DO NOT do this without a documented operator decision and incident ticket.

---

## 5. Cross-story dependencies

| Story | Relationship |
| --- | --- |
| Story 9-3 (Sentry telemetry) | The password is NEVER passed to `captureError` anywhere in the change set. The drift detector at `src/lib/__tests__/password-policy-source-drift.test.ts` pins this. No allowlist additions. |
| Story 9-6 (auth listener event gating) | Orthogonal — listener body unchanged. |
| Story 12-2 (auth bootstrap) | `signUpWithEmail` thin-wrapper at `src/lib/auth-bootstrap.ts:338-347` is unchanged. Validation runs at the UI layer, preserving the bootstrap-as-thin-binding contract. |
| Story 12-7 (encrypted profile cache) | Orthogonal — cache layer untouched; password is never cached. |
| Story 12-9 (email verification gate) | Orthogonal — runs after signup completes, regardless of password strength. Will land in a future PR. |
| Future password-change UI | Will reuse `validatePasswordStrength` + `PasswordStrengthIndicator` from `src/lib/password-policy.ts` + `src/components/auth/PasswordStrengthIndicator.tsx` without re-inventing the rules. |
| Future reset-password-confirm UI | Same as above. Today `forgot-password.tsx` only sends a reset link; the completion UI is out of scope for 12-8. |

---

## 6. Operator decision log

Fill in below after applying Layer 2:

| Environment | Date applied | Min length | Required chars | HIBP enabled | Verifying operator | Verification curl PASS? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (production) | _YYYY-MM-DD_ | 10 | lower + upper + digit | _yes/no_ | _name_ | _yes/no_ | |
| (staging, if exists) | _YYYY-MM-DD_ | 10 | lower + upper + digit | _yes/no_ | _name_ | _yes/no_ | |

---

## 7. References

- Audit finding: [`shippable-roadmap.md` line 64 (P1-12)](../shippable-roadmap.md)
- Story spec: [`12-8-password-policy-tightening.md`](../implementation-artifacts/12-8-password-policy-tightening.md)
- Supabase Auth password security: https://supabase.com/docs/guides/auth/password-security
- Supabase Auth error codes: https://supabase.com/docs/guides/auth/debugging/error-codes
- HIBP Pwned Passwords API: https://haveibeenpwned.com/API/v3#PwnedPasswords
- NIST SP 800-63B §5.1.1.2 (Memorized Secret Verifiers): https://pages.nist.gov/800-63-3/sp800-63b.html#sec5
