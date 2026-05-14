/**
 * Email verification helper module (Story 12-9).
 *
 * Pure helpers consumed by `src/components/auth/EmailVerificationGate.tsx`
 * and the auth-guard at `app/_layout.tsx`. Closes audit P1-15 architecturally
 * (`_bmad-output/planning-artifacts/shippable-roadmap.md#67`).
 *
 * Two-layer defense (Story 12-9):
 *   - Layer 1 (this module + gate + `_layout.tsx` chokepoint): client-side
 *     enforcement. A session-bearing user with `user.email_confirmed_at`
 *     unset cannot reach onboarding, the practice/conversation surfaces,
 *     or push-notification registration.
 *   - Layer 2 (Supabase Dashboard config): "Confirm email" toggle on the
 *     Email provider. Operator deliverable per
 *     `_bmad-output/planning-artifacts/runbooks/auth-email-verification.md`.
 *
 * Cross-story invariants this module preserves by construction:
 *   - Story 9-3 Sentry: zero new extras keys; the email NEVER flows here.
 *   - Story 9-4 stored-prompt-injection: no user-derived prompt path.
 *   - Story 9-6 `decideAuthAction`: untouched — verification operates on the
 *     `user.email_confirmed_at` field AFTER the listener routes events.
 *   - Story 9-10 `ProfileRetryScreen`: the verification render-branch fires
 *     UPSTREAM by deliberate placement in `RootLayoutNav` (verification ⇒
 *     profile-retry ⇒ main).
 *   - Story 12-2 `bootstrapAuth`: untouched; only NEW module-level action
 *     exports (`resendVerificationEmail`, `refreshSessionAfterVerification`)
 *     are added in `auth-bootstrap.ts`.
 */
import type { User } from "@supabase/supabase-js";

/**
 * Resend cooldown in milliseconds (client-side fast-feedback layer).
 *
 * Mirrors Supabase's server-side rate-limit on `auth.resend` so the user
 * gets immediate "wait 60s" feedback instead of round-tripping to discover
 * a 429. Defaults documented at the Auth provider settings — 60s is the
 * project's effective floor unless an operator has explicitly relaxed it.
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Strict ISO-8601 shape guard — pinned by review-round-1 L4 patch.
 *
 * `Date.parse` is famously lenient on non-ISO inputs: `"0"`, `"123"`, `"2020"`,
 * and partial-shape strings like `"2026-13-45T99:99:99Z"` all return a finite
 * number on V8/Hermes (engine-specific underspecification per ECMA-262).
 * Without this regex precheck, a corrupted Supabase row carrying
 * `email_confirmed_at = "0"` would mark the user as verified.
 *
 * Requirement: `YYYY-MM-DDTHH:MM:SS[.fff]Z|±HH:MM` shape — the canonical
 * Postgres `timestamptz` serialization Supabase emits.
 */
const ISO_8601_PREFIX_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Clock-skew tolerance for future-dated `email_confirmed_at` values
 * (review-round-1 L4 patch). 24 hours covers legitimate NTP correction
 * + reasonable cross-zone clock-drift between client and server. Beyond
 * this, treat as malicious / tampered.
 */
const FUTURE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Returns true iff the user's email is server-confirmed.
 *
 * Server-authoritative — reads `user.email_confirmed_at` (an ISO-8601
 * timestamp string set by Supabase when the user clicks the confirmation
 * link in their email). Defensive against:
 *   - null / undefined user (logged-out state).
 *   - undefined / null `email_confirmed_at` (pre-verification state).
 *   - empty-string `email_confirmed_at` (malformed/legacy data).
 *   - non-ISO-8601 strings — `Date.parse` is lenient, so an ISO-shape
 *     regex precheck (review-round-1 L4) rejects `"0"` / `"123"` /
 *     `"2020"` etc. before `Date.parse` runs.
 *   - future-dated timestamps beyond a 24h clock-skew tolerance
 *     (review-round-1 L4) — defends against tampered local cache.
 *
 * DO NOT cache the result — the whole point of reading the field directly
 * is that Supabase is the single source of truth. A cached flag could be
 * tampered with by a malicious app rebuild OR could go stale across
 * device sync (verify on web, sign in on mobile).
 *
 * @see node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:356 for the
 *      `email_confirmed_at?: string` field declaration.
 */
export function isEmailVerified(user: User | null | undefined): boolean {
  const ts = user?.email_confirmed_at;
  if (typeof ts !== "string" || ts.length === 0) return false;
  // L4 patch: reject non-ISO-shape strings BEFORE Date.parse leniency
  // can promote them to finite numbers.
  if (!ISO_8601_PREFIX_REGEX.test(ts)) return false;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return false;
  // L4 patch: reject future-dated timestamps beyond clock-skew tolerance.
  // A tampered local cache could carry `"9999-01-01T00:00:00Z"` to bypass
  // the gate; this defense fails closed.
  if (ms > Date.now() + FUTURE_DATE_TOLERANCE_MS) return false;
  return true;
}

/**
 * Returns true iff the resend button should be enabled NOW.
 *
 * - First-time (lastResendAtMs === null): always permits.
 * - Boundary at exactly `RESEND_COOLDOWN_MS` is INCLUSIVE (`>=`) — verified
 *   by Case 12 in the regression test suite.
 * - Clock-skew defense (review-round-1 M4): `now - lastResendAtMs` is
 *   clamped non-negative so an NTP correction or manual device-clock
 *   rollback cannot extend the cooldown past 60s. Negative diffs are
 *   interpreted as "no time has elapsed" — the cooldown remains active
 *   for the full configured duration relative to the more recent of the
 *   two clock readings.
 *
 * @param lastResendAtMs The Date.now() value at the previous resend, or null
 *   if no resend has been issued yet this session.
 * @param now The current Date.now() value.
 */
export function canResendNow(lastResendAtMs: number | null, now: number): boolean {
  if (lastResendAtMs === null) return true;
  // M4 patch: clamp negative diffs to 0 (clock moved backward → treat as
  // "no time has elapsed"). Without this, an NTP correction during cooldown
  // makes `now - lastResendAtMs` negative which trivially fails `>= 60_000`
  // — the user waits the full visible 60s and the button still won't enable.
  const elapsed = Math.max(0, now - lastResendAtMs);
  return elapsed >= RESEND_COOLDOWN_MS;
}

/**
 * Returns the integer seconds remaining until resend is permitted again.
 * Clamped at 0 (never returns negative). Rounded UP via `Math.ceil` so
 * 1.1s remaining displays as "2s" — never displays "0s remaining" while
 * the user is still actually waiting.
 *
 * Clock-skew defense (review-round-1 M4): the elapsed time is clamped
 * non-negative so a backward clock movement doesn't produce a countdown
 * that overshoots `RESEND_COOLDOWN_MS / 1000` seconds.
 */
export function secondsUntilResend(lastResendAtMs: number | null, now: number): number {
  if (lastResendAtMs === null) return 0;
  // M4 patch: clamp negative elapsed to 0 so the countdown never exceeds
  // the configured cooldown duration even when the clock moves backward.
  const elapsed = Math.max(0, now - lastResendAtMs);
  const remainingMs = RESEND_COOLDOWN_MS - elapsed;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

const VERIFICATION_EMAIL_FALLBACK_FR = "votre adresse e-mail";

/**
 * Returns a user-facing display string with the local-part masked.
 *
 * Defense-in-depth privacy gesture: a user demoing the app on a stranger's
 * device doesn't reveal their full email address. The first character of
 * the local-part is preserved (sufficient hint for the owner), the rest is
 * `***`, the domain is preserved (lets the user recognise which inbox to
 * check).
 *
 * Examples:
 *   formatVerificationEmailMask("alice@example.com")  // "a***@example.com"
 *   formatVerificationEmailMask("a@example.com")      // "a***@example.com"
 *   formatVerificationEmailMask(undefined)             // "votre adresse e-mail"
 *   formatVerificationEmailMask("not-an-email")        // "votre adresse e-mail"
 *
 * Defensive fallbacks (return the French generic string):
 *   - undefined / empty string input.
 *   - no `@` separator.
 *   - `@` at index 0 (zero-length local-part).
 *   - whitespace-only input (after trim — review-round-1 L3 patch).
 *
 * Review-round-1 L3 patch: input is trimmed before processing so a
 * leading whitespace (autocomplete keyboard / copy-paste) doesn't leak
 * a space into the rendered display string (e.g., `" alice@..."` would
 * have produced `" ***@..."` — visible UI bug).
 */
export function formatVerificationEmailMask(email: string | undefined): string {
  if (!email) return VERIFICATION_EMAIL_FALLBACK_FR;
  // L3 patch: trim before length/index checks so leading whitespace
  // doesn't bypass the `@`-at-index-0 fallback OR produce a leaked
  // space in the rendered display.
  const trimmed = email.trim();
  if (trimmed.length === 0) return VERIFICATION_EMAIL_FALLBACK_FR;
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0) return VERIFICATION_EMAIL_FALLBACK_FR;
  const firstChar = trimmed[0];
  const domain = trimmed.slice(atIdx);
  return `${firstChar}***${domain}`;
}
