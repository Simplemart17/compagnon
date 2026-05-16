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
 * matters for length. **Belt-and-suspenders defense (review-round-2
 * R2-P1):** signup.tsx ALSO trims the password before passing it to
 * `signUpWithEmail`, so the validated bytes match the bytes Supabase
 * stores. This eliminates the round-trip hazard where Supabase's bcrypt
 * stores the raw (untrimmed) password and the next sign-in fails when
 * the user's keyboard auto-strips trailing whitespace.
 *
 * **Unicode whitespace caveat (review-round-2 R2-P7):**
 * `String.prototype.trim()` strips ECMA-262 whitespace + line
 * terminators (per the §22.1.3.32 / §22.1.3.34 list — includes ASCII
 * tab/space/CR/LF, U+00A0 NBSP, BOM U+FEFF, etc.) but does NOT strip:
 * U+200B (ZERO WIDTH SPACE), U+200C/D (zero-width joiners), U+2060
 * (WORD JOINER), U+180E (MONGOLIAN VOWEL SEPARATOR — pre-Unicode-6.3
 * was whitespace, now ZWNBSP-class). A user pasting a password with
 * one of these characters at the boundary will see a different content
 * length than the displayed glyph count. The practical impact is
 * minimal (these characters are rarely in passwords); operators
 * monitoring authentication failure rates can extend the trim regex if
 * telemetry surfaces a real-world hit.
 *
 * **HIBP (HaveIBeenPwned) forward-compat:**
 * The `mapSupabaseWeakPasswordError` translator handles a `"pwned"`
 * reason in addition to `"length"` and `"characters"`. HIBP is a
 * Supabase Pro Plan feature; when the operator flips the dashboard
 * toggle on Pro upgrade, no code change is needed — the existing
 * `isPwnedRejection` + `getPwnedMessage` helpers surface the
 * leaked-password rejection to the user.
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
 * English user-facing requirement messages, one per reason. Built lazily
 * via template literals so a future bump to `MIN_PASSWORD_LENGTH`
 * propagates atomically — the source-of-truth lives exactly once in the
 * constant above. Story 14-1 converted the messages from French to
 * English under the EN-UI / FR-content rule (Decision Matrix row D1).
 */
const MESSAGES: Record<PasswordPolicyReason, string> = {
  length: `At least ${MIN_PASSWORD_LENGTH} characters`,
  lowercase: "At least one lowercase letter",
  uppercase: "At least one uppercase letter",
  digit: "At least one digit",
};

/**
 * Localizer for a single failing reason. Returns the canonical English
 * imperative-mood phrase. Used by both the live strength indicator
 * checklist AND the post-submit Alert.
 */
export function passwordPolicyReasonToMessage(reason: PasswordPolicyReason): string {
  return MESSAGES[reason];
}

// Trailing-period punctuation is symmetric across both message constants
// so Alert dialogs render consistent sentence terminators.
const PWNED_MESSAGE = "This password has been exposed in a data breach.";

const GENERIC_WEAK_PASSWORD_MESSAGE = "Password is too weak. Please choose another.";

/**
 * Canonical English message for HIBP (HaveIBeenPwned) leaked-password
 * rejections. Surfaced when `isPwnedRejection(error) === true`.
 * Forward-compatible — fires when the operator flips the Supabase Pro
 * Plan HIBP toggle without any code change.
 */
export function getPwnedMessage(): string {
  return PWNED_MESSAGE;
}

/**
 * Generic English fallback for `weak_password` rejections that have no
 * itemized reasons (server returned malformed/empty `reasons` array OR
 * an unrecognized reason taxonomy). Used by `signup.tsx` to ensure the
 * UI never surfaces a raw Supabase engineering message.
 */
export function getGenericWeakPasswordMessage(): string {
  return GENERIC_WEAK_PASSWORD_MESSAGE;
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
 *
 * **Review-round-2 R2-P2 — coherent-shape requirement:** when BOTH
 * `code` and `name` are present and they DISAGREE (e.g.,
 * `{code: "user_already_exists", name: "AuthWeakPasswordError"}` from a
 * malformed SDK release), this helper returns `false`. Pre-patch the OR
 * was too permissive — a name-match alone fired even when the code
 * field clearly contradicted it, causing the user to see a French
 * password-strength UI for an email-taken / rate-limit error they
 * couldn't recover from by changing their password. Post-patch:
 *   - `code === "weak_password"` (with or without `name`): true.
 *   - `name === "AuthWeakPasswordError"` AND no `code` field: true.
 *   - `name === "AuthWeakPasswordError"` AND `code` is NOT
 *     `"weak_password"`: false (contradictory shape).
 *   - Neither matches: false.
 */
function isWeakPasswordError(
  error: unknown
): error is { code?: string; name?: string; reasons?: unknown } {
  if (typeof error !== "object" || error === null) return false;
  const hasCodeField = "code" in error;
  const codeMatches = hasCodeField && (error as { code: unknown }).code === "weak_password";
  const nameMatches =
    "name" in error && (error as { name: unknown }).name === "AuthWeakPasswordError";

  // Coherent-shape requirement: a contradictory `code` (present but not
  // matching) overrides a `name`-only match. This prevents misclassifying
  // non-password errors as weak-password rejections.
  if (codeMatches) return true;
  if (nameMatches && !hasCodeField) return true;
  return false;
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
 * rule); callers handle pwned via `isPwnedRejection` + `getPwnedMessage`.
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
 * empty result as "show generic fallback" via
 * `getGenericWeakPasswordMessage`, never falling through to the raw
 * Supabase `error.message`.
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
 * **Review-round-2 R2-P5 — single-`password` signature:** pre-R2 the
 * function accepted `(reasons, passwordLength, password?)` which let a
 * caller pass desynchronized values like `(reasons, 100, "abc")` —
 * length-passes branch would fire while the entropy gate ran on a
 * 3-char string. Post-R2 the function takes only `password` and
 * derives `password.length` internally, eliminating the desync hazard.
 * Consumers (tests + indicator) MUST pass the actual password string.
 *
 * `password.length` is the **raw** length (not trimmed) — a long-but-
 * mostly-whitespace password should NOT be rated strong because the
 * trimmed-length check in `validatePasswordStrength` will already have
 * pushed `"length"` into reasons.
 *
 * The distinct-char counter uses `new Set(password)` which iterates by
 * code points (per ES2015 String iterator) — emoji surrogate pairs
 * count as ONE distinct char, which is the correct entropy semantic.
 *
 * Length / uniqueness thresholds (`STRONG_LENGTH_THRESHOLD` = 14,
 * `VERY_SHORT_LENGTH_THRESHOLD` = 8, `STRONG_DISTINCT_CHARS_THRESHOLD`
 * = 6) are operator-derived heuristics, exported as constants only via
 * test imports; pinned by test to defend against silent regressions.
 */
export function computePasswordStrengthLabel(
  reasons: PasswordPolicyReason[],
  password: string
): "weak" | "medium" | "strong" {
  const passwordLength = password.length;
  if (reasons.length >= 3) return "weak";
  if (reasons.length > 0 && passwordLength < VERY_SHORT_LENGTH_THRESHOLD) return "weak";
  if (reasons.length > 0) return "medium";
  if (passwordLength < STRONG_LENGTH_THRESHOLD) return "medium";
  const distinctChars = new Set(password).size;
  if (distinctChars < STRONG_DISTINCT_CHARS_THRESHOLD) return "medium";
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
