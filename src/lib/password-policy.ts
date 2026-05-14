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
 * **Non-ASCII digit categories also rejected (Hermes engine note):**
 * `/\d/` without the `u` flag matches ONLY ASCII `[0-9]` per ECMA-262.
 * Arabic-Indic digits (`٠١٢٣٤٥٦٧٨٩` U+0660-U+0669), Persian digits, and
 * other Unicode-decimal categories are NOT counted as `digit`. This is
 * intentional — Supabase's server-side check is also ASCII-only — but a
 * user typing on an Arabic keyboard expecting Arabic digits will see a
 * confusing rejection. Surface in JSDoc + pinned by regression test.
 *
 * **Whitespace-padding defense (review-round-1 P5):**
 * The length check uses `password.trim().length` so a password like
 * `"Aa1Aa1Aa1\t"` (10 raw chars with trailing tab) is treated as 9
 * content chars and fails the length rule. Rationale: trailing/leading
 * whitespace is silently lost on most native iOS/Android keyboards at
 * sign-in time AND is normalized by Supabase server-side. Without this
 * fix, the user could sign up with whitespace-padding tricks that fail
 * to round-trip on next sign-in. Inner whitespace (e.g.,
 * `"correct horse battery 9A"`) is preserved — only the outer trim
 * matters for length.
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

/**
 * Minimum acceptable password length, in code units after trimming
 * leading/trailing whitespace. Mirrors Supabase dashboard
 * `Authentication → Policies → Password Policy → Minimum length`
 * which the operator MUST set to the same value per the Layer 2 runbook
 * at `_bmad-output/planning-artifacts/runbooks/auth-password-policy.md`.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Length threshold above which a fully-passing password earns the
 * `"strong"` strength label (combined with the uniqueness floor below).
 * Operator-derived heuristic; pinned by test.
 */
const STRONG_LENGTH_THRESHOLD = 14;

/**
 * Length threshold below which ANY rule failure (even just one) demotes
 * the strength label all the way to `"weak"`. Operator-derived; pinned
 * by test. Spec deliverable (a)(vii) "(counts also length < 8)".
 */
const VERY_SHORT_LENGTH_THRESHOLD = 8;

/**
 * Distinct-character floor for the `"strong"` label. Defends against
 * passwords like `"Aaaaaaaaaaaaa1"` that satisfy all 4 rules but have
 * trivial entropy. Operator-derived; pinned by test.
 */
const STRONG_DISTINCT_CHARS_THRESHOLD = 6;

export type PasswordPolicyReason = "length" | "lowercase" | "uppercase" | "digit";

export type PasswordPolicyResult = {
  valid: boolean;
  reasons: PasswordPolicyReason[];
};

/**
 * Returns ALL failing reasons (not short-circuit) so the UI can render
 * the full requirements checklist on every keystroke.
 *
 * The length rule uses the TRIMMED password (review-round-1 P5) to defend
 * against whitespace-padding tricks like `"Aa1Aa1Aa1\t"` that would
 * otherwise pass while failing to round-trip at next sign-in.
 */
export function validatePasswordStrength(password: string): PasswordPolicyResult {
  const reasons: PasswordPolicyReason[] = [];
  if (password.trim().length < MIN_PASSWORD_LENGTH) reasons.push("length");
  if (!/[a-z]/.test(password)) reasons.push("lowercase");
  if (!/[A-Z]/.test(password)) reasons.push("uppercase");
  if (!/\d/.test(password)) reasons.push("digit");
  return { valid: reasons.length === 0, reasons };
}

/**
 * French user-facing requirement messages, one per reason. Built lazily
 * via template literals so a future bump to `MIN_PASSWORD_LENGTH`
 * propagates atomically (review-round-1 P4) — the source-of-truth lives
 * exactly once in the constant above.
 */
const FRENCH_MESSAGES: Record<PasswordPolicyReason, string> = {
  length: `Au moins ${MIN_PASSWORD_LENGTH} caractères`,
  lowercase: "Au moins une minuscule",
  uppercase: "Au moins une majuscule",
  digit: "Au moins un chiffre",
};

/**
 * Localizer for a single failing reason. Returns the canonical French
 * imperative-mood phrase. Used by both the live strength indicator
 * checklist AND the post-submit Alert.
 */
export function passwordPolicyReasonToFrenchMessage(reason: PasswordPolicyReason): string {
  return FRENCH_MESSAGES[reason];
}

const PWNED_FRENCH_MESSAGE = "Ce mot de passe a été divulgué dans une fuite de données";

const GENERIC_WEAK_PASSWORD_FRENCH_MESSAGE =
  "Mot de passe trop faible. Veuillez en choisir un autre.";

/**
 * Canonical French message for HIBP (HaveIBeenPwned) leaked-password
 * rejections. Surfaced when `isPwnedRejection(error) === true`.
 * Forward-compatible — fires when the operator flips the Supabase Pro
 * Plan HIBP toggle without any code change.
 */
export function getPwnedFrenchMessage(): string {
  return PWNED_FRENCH_MESSAGE;
}

/**
 * Generic French fallback for `weak_password` rejections that have no
 * itemized reasons (server returned malformed/empty `reasons` array OR
 * an unrecognized reason taxonomy). Used by `signup.tsx` to ensure the
 * French UI never surfaces an English Supabase engineering message
 * (review-round-1 P7).
 */
export function getGenericWeakPasswordFrenchMessage(): string {
  return GENERIC_WEAK_PASSWORD_FRENCH_MESSAGE;
}

/**
 * Narrowing helper for the Supabase `weak_password` error shape.
 *
 * Per https://supabase.com/docs/guides/auth/debugging/error-codes the
 * server returns `code === "weak_password"` AND
 * `name === "AuthWeakPasswordError"` AND a `reasons: string[]` array.
 * The reasons taxonomy: `"length"` / `"characters"` / `"pwned"`.
 *
 * Defense-in-depth (review-round-1 P11): accepts EITHER the `code`
 * match OR the `name` match, so a future Supabase release that renames
 * the code without renaming the error class still triggers French
 * fallback (or vice versa).
 */
function isWeakPasswordError(
  error: unknown
): error is { code?: string; name?: string; reasons?: unknown } {
  if (typeof error !== "object" || error === null) return false;
  const codeMatches = "code" in error && (error as { code: unknown }).code === "weak_password";
  const nameMatches =
    "name" in error && (error as { name: unknown }).name === "AuthWeakPasswordError";
  return codeMatches || nameMatches;
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
 * **Review-round-1 P1 — always-merge-client-reasons:** When `password`
 * is provided, this function ALWAYS merges `validatePasswordStrength`'s
 * failing reasons into the result, regardless of which server reasons
 * fired. Pre-patch a server response of `["length"]` would return only
 * `["length"]` even if the password ALSO failed composition (e.g.,
 * `"abc"` is short AND missing upper/digit) — causing moving-goalpost
 * UX where the user fixes length, resubmits, and gets a SECOND error
 * for missing uppercase. Post-patch the user sees ALL failing rules at
 * once on the first round-trip.
 *
 * **Review-round-1 P7 — generic fallback for missing reasons:** When
 * the server returns `weak_password` without a parseable `reasons`
 * array AND `password` is provided, this function still returns the
 * client-derived itemized reasons. The caller (`signup.tsx`) treats an
 * empty result as "show generic French fallback" via
 * `getGenericWeakPasswordFrenchMessage`, never falling through to the
 * English `error.message`.
 *
 * **Review-round-1 P8 — `password` arg is required for itemized
 * feedback:** If `password` is omitted, this function returns whatever
 * server reasons it can recognize (length only, since `"characters"`
 * cannot be itemized without the password). The caller is responsible
 * for falling back to the generic French message when the result is
 * empty. A future maintainer extending this module should NOT call
 * this function without `password` in production code paths.
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

  // Build the union of:
  //   (a) server-reported reasons that map cleanly (only "length" is
  //       directly itemizable; "characters" lumps everything),
  //   (b) client-derived reasons when `password` is provided
  //       (review-round-1 P1: always merge to guarantee the user sees
  //       every failing rule on the first round-trip).
  const out: PasswordPolicyReason[] = [];
  const addReason = (r: PasswordPolicyReason): void => {
    if (!out.includes(r)) out.push(r);
  };

  if (Array.isArray(reasons)) {
    for (const r of reasons) {
      if (r === "length") addReason("length");
      // "pwned" is intentionally not appended — handle via isPwnedRejection.
      // "characters" is handled by the always-merge-client-reasons block below.
    }
  }

  if (typeof password === "string") {
    const clientResult = validatePasswordStrength(password);
    for (const reason of clientResult.reasons) {
      addReason(reason);
    }
  }

  return out;
}

/**
 * Strength meter helper for the UI indicator.
 *
 * Tightened post-review-round-1 (P2) to defend against false-confidence
 * on trivially-weak passwords:
 *
 * - `"weak"` if 3+ reasons fail OR (any reason fails AND length < 8).
 *   The length<8 clause implements spec deliverable (a)(vii) — even a
 *   single rule failure on a very-short password should NOT show
 *   `"medium"` (which reads as "almost there" to users).
 * - `"medium"` if 1-2 reasons fail OR all 4 pass with length < 14
 *   OR all 4 pass with distinct-char count below the entropy floor.
 *   Catches passwords like `"Aaaaaaaaaaaaa1"` (14 chars, all 4 rules
 *   satisfied, but only 3 distinct chars — trivial dictionary attack
 *   target) which pre-patch was rated `"strong"`.
 * - `"strong"` ONLY if all 4 pass AND length ≥ 14 AND distinct-char
 *   count ≥ 6.
 *
 * `passwordLength` is the **raw** length (not trimmed) — a long-but-
 * mostly-whitespace password should NOT be rated strong because the
 * trimmed-length check in `validatePasswordStrength` will already have
 * pushed `"length"` into reasons.
 *
 * Length / uniqueness thresholds (`STRONG_LENGTH_THRESHOLD` = 14,
 * `VERY_SHORT_LENGTH_THRESHOLD` = 8, `STRONG_DISTINCT_CHARS_THRESHOLD`
 * = 6) are operator-derived heuristics, exported as constants only via
 * test imports; pinned by test to defend against silent regressions.
 */
export function computePasswordStrengthLabel(
  reasons: PasswordPolicyReason[],
  passwordLength: number,
  password?: string
): "weak" | "medium" | "strong" {
  if (reasons.length >= 3) return "weak";
  if (reasons.length > 0 && passwordLength < VERY_SHORT_LENGTH_THRESHOLD) return "weak";
  if (reasons.length > 0) return "medium";
  if (passwordLength < STRONG_LENGTH_THRESHOLD) return "medium";
  if (typeof password === "string") {
    const distinctChars = new Set(password).size;
    if (distinctChars < STRONG_DISTINCT_CHARS_THRESHOLD) return "medium";
  }
  return "strong";
}

/**
 * @internal Test-only exports for pinning the heuristic thresholds.
 * Production code does NOT consume these — they exist solely so the
 * regression test can detect silent threshold drift.
 */
export const __THRESHOLDS_FOR_TESTS = {
  STRONG_LENGTH_THRESHOLD,
  VERY_SHORT_LENGTH_THRESHOLD,
  STRONG_DISTINCT_CHARS_THRESHOLD,
} as const;
