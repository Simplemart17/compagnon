/**
 * Password policy validator (Story 12-8).
 *
 * Closes audit finding **P1-12** at
 * `_bmad-output/planning-artifacts/shippable-roadmap.md` line 64
 * ("Weak password policy (6 chars, no complexity)"). The Epic 12.8
 * deliverable at line 211 specifies "≥10 chars, complexity"; this
 * module owns the **client-side** layer (Layer 1). The **server-side**
 * layer (Layer 2) lives in the Supabase Auth dashboard configuration
 * and is operator-applied per
 * `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md`.
 *
 * **Two-layer defense:**
 * - Layer 1 (this module + `app/(auth)/signup.tsx` consumer): rejects
 *   weak passwords at the UI before they reach the wire. Provides
 *   itemized French feedback so the user knows exactly what to fix.
 * - Layer 2 (Supabase dashboard, operator action): rejects weak
 *   passwords server-side with `error.code === "weak_password"` and
 *   `reasons: string[]` per
 *   https://supabase.com/docs/guides/auth/debugging/error-codes.
 *
 * **Rule choice — NIST 800-63B aligned (lower + upper + digit, no
 * mandatory symbols):**
 * The Supabase dashboard offers 4 enum levels; we pick
 * `lower_upper_letters_and_digits`. NIST §5.1.1.2 explicitly
 * recommends AGAINST mandatory composition rules beyond length, with
 * the upper/lower/digit triad as a reasonable compromise for legacy
 * systems. Symbols push users toward predictable substitutions
 * (`Password1!`) that are no harder to crack than a 12-char passphrase
 * AND symbol input is friction on mobile keyboards. A 10-char password
 * with all 4 character classes EXCLUDING symbols has 62^10 ≈ 8 × 10^17
 * keyspace — sufficient against any realistic offline attack at bcrypt
 * cost-factor 10.
 *
 * **ASCII semantics — pinned to mirror Supabase server-side:**
 * The regex pins `/[a-z]/`, `/[A-Z]/`, `/\d/` are ASCII-only by
 * default. Supabase's `password_required_characters` server-side
 * enforcement uses ASCII-letter-class semantics, NOT Unicode-letter-
 * class. Mirroring those semantics on the client prevents a passing-
 * on-client / failing-on-server surprise where a user types
 * `"мойпароль123"` (Cyrillic), passes the client regex, and gets a
 * confusing server-side `weak_password` rejection.
 *
 * **HIBP (HaveIBeenPwned) forward-compat:**
 * The `mapSupabaseWeakPasswordError` translator handles a `"pwned"`
 * reason in addition to `"length"` and `"characters"`. HIBP is a
 * Supabase Pro Plan feature; when the operator flips the dashboard
 * toggle on Pro upgrade, no code change is needed — the existing
 * `isPwnedRejection` + `getPwnedFrenchMessage` helpers surface the
 * leaked-password rejection in French to the user.
 *
 * **Cross-story invariants preserved:**
 * - Story 9-3 Sentry — the password is never passed to `captureError`
 *   anywhere in the change set; verified by the drift detector.
 * - Story 12-2 — `signUpWithEmail` thin-wrapper body unchanged.
 * - Story 12-7 — cache layer untouched; password is never cached.
 *
 * **Out of scope (deferred):**
 * - Existing-weak-password rotation prompt at next-signin (Supabase
 *   does NOT re-validate stored hashes on policy change; existing
 *   `123456`-class users continue to sign in successfully).
 * - Client-side HIBP API call (would leak password's SHA-1 prefix to
 *   a third-party AND adds 200-800ms latency to the signup hot-path;
 *   server-side HIBP via Supabase Pro is the canonical path).
 * - Reset-password-confirm UI (no such screen exists today;
 *   `forgot-password.tsx` only sends a reset link). The future
 *   reset-password-confirm screen will reuse `validatePasswordStrength`
 *   from this module.
 */

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordPolicyReason = "length" | "lowercase" | "uppercase" | "digit";

export type PasswordPolicyResult = {
  valid: boolean;
  reasons: PasswordPolicyReason[];
};

/**
 * Returns ALL failing reasons (not short-circuit) so the UI can render
 * the full requirements checklist on every keystroke.
 */
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

export function getPwnedFrenchMessage(): string {
  return PWNED_FRENCH_MESSAGE;
}

/**
 * Narrowing helper for the Supabase `weak_password` error shape.
 *
 * Per https://supabase.com/docs/guides/auth/debugging/error-codes the
 * server returns `code === "weak_password"` AND
 * `name === "AuthWeakPasswordError"` AND a `reasons: string[]` array.
 * The reasons taxonomy: `"length"` / `"characters"` / `"pwned"`.
 */
function isWeakPasswordError(
  error: unknown
): error is { code: "weak_password"; reasons?: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "weak_password"
  );
}

/**
 * Returns `true` iff the Supabase error carries a `"pwned"` reason
 * (HIBP rejection). Forward-compatible with the Pro Plan HIBP toggle.
 */
export function isPwnedRejection(error: unknown): boolean {
  if (!isWeakPasswordError(error)) return false;
  const reasons = (error as { reasons?: unknown }).reasons;
  if (!Array.isArray(reasons)) return false;
  return reasons.includes("pwned");
}

/**
 * Translate a Supabase `weak_password` error to client-side itemized
 * reasons.
 *
 * The server returns `"characters"` as a single coarse signal that
 * lumps lowercase+uppercase+digit+symbol together. To give the user
 * the same itemized feedback whether the rejection came from client or
 * server, this function re-runs `validatePasswordStrength` against the
 * password (in scope at the call site) and returns the actually-failing
 * client-side reasons. The `"pwned"` reason is intentionally NOT
 * returned in the `PasswordPolicyReason[]` (it is not a client-checkable
 * rule); callers handle pwned via `isPwnedRejection` + `getPwnedFrenchMessage`.
 *
 * Returns `null` for non-`weak_password` errors so the caller can fall
 * back to the original `error.message` (e.g., `user_already_exists`,
 * network errors).
 */
export function mapSupabaseWeakPasswordError(
  error: unknown,
  password?: string
): PasswordPolicyReason[] | null {
  if (!isWeakPasswordError(error)) return null;
  const reasons = (error as { reasons?: unknown }).reasons;
  if (!Array.isArray(reasons)) return [];

  const out: PasswordPolicyReason[] = [];
  for (const r of reasons) {
    if (r === "length") {
      if (!out.includes("length")) out.push("length");
    } else if (r === "characters" && typeof password === "string") {
      const clientResult = validatePasswordStrength(password);
      for (const reason of clientResult.reasons) {
        if (reason !== "length" && !out.includes(reason)) {
          out.push(reason);
        }
      }
    }
    // "pwned" is intentionally not appended — handle via isPwnedRejection.
  }
  return out;
}

/**
 * Strength meter helper for the UI indicator.
 *
 * - `"weak"` if 3+ reasons fail (e.g., empty / only-letters / only-digits).
 * - `"medium"` if 1-2 reasons fail OR all 4 pass with length < 14.
 * - `"strong"` if all 4 pass AND length ≥ 14.
 *
 * Length thresholds (10 / 14) are operator-derived heuristic; pinned by
 * test to defend against a future regression that flips the boundaries.
 */
export function computePasswordStrengthLabel(
  reasons: PasswordPolicyReason[],
  passwordLength: number
): "weak" | "medium" | "strong" {
  if (reasons.length >= 3) return "weak";
  if (reasons.length > 0) return "medium";
  return passwordLength >= 14 ? "strong" : "medium";
}
