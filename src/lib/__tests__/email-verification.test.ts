/**
 * Story 12-9 — `email-verification` unit tests.
 *
 * Pins the client-side email-verification helper module contract. Load-bearing
 * assertions:
 *   (a) `RESEND_COOLDOWN_MS = 60_000` constant pin (drift-catches a sloppy edit).
 *   (b) `isEmailVerified` is server-state-only — reads `user.email_confirmed_at`
 *       from Supabase's `User` shape; null-safe + undefined-safe + malformed-ISO
 *       safe. Empty string is treated as "not verified" (defensive against
 *       legacy/malformed Supabase responses).
 *   (c) `canResendNow` semantics — first-time call (lastResendAtMs === null)
 *       always permits; boundary at exactly `RESEND_COOLDOWN_MS` is INCLUSIVE
 *       (permits). Pins `now - lastResendAtMs >= RESEND_COOLDOWN_MS` not `>`.
 *   (d) `secondsUntilResend` clamps non-negative via `Math.max(0, ...)` and
 *       rounds UP via `Math.ceil` so 1.1s remaining displays as "2s" — never
 *       displays "0s remaining" while still actually waiting.
 *   (e) `formatVerificationEmailMask` preserves first char + domain; falls back
 *       to `"your email address"` on undefined/empty/no-@/`@` at index 0
 *       (defensive against malformed input).
 */

import type { User } from "@supabase/supabase-js";

import {
  RESEND_COOLDOWN_MS,
  canResendNow,
  formatVerificationEmailMask,
  isEmailVerified,
  secondsUntilResend,
} from "../email-verification";

// Minimal User shape factory — only the fields we read.
function makeUser(overrides: Partial<User>): User {
  return {
    id: "test-user",
    aud: "authenticated",
    role: "authenticated",
    email: "test@example.com",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-05-14T00:00:00Z",
    ...overrides,
  } as User;
}

describe("email-verification: RESEND_COOLDOWN_MS constant pin", () => {
  it("Case 1: RESEND_COOLDOWN_MS equals 60000 ms (drift-catches edits)", () => {
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });
});

describe("email-verification: isEmailVerified — defensive semantics", () => {
  it("Case 2: null user → false (logged-out state)", () => {
    expect(isEmailVerified(null)).toBe(false);
  });

  it("Case 3: undefined user → false (defensive)", () => {
    expect(isEmailVerified(undefined)).toBe(false);
  });

  it("Case 4: undefined email_confirmed_at → false (pre-verification state)", () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: undefined }))).toBe(false);
  });

  it("Case 5: null email_confirmed_at → false (legacy data defensive)", () => {
    // Some Supabase responses materialize null instead of undefined.
    expect(isEmailVerified(makeUser({ email_confirmed_at: null as unknown as string }))).toBe(
      false
    );
  });

  it("Case 6: empty-string email_confirmed_at → false (malformed defensive)", () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "" }))).toBe(false);
  });

  it("Case 7: malformed ISO string → false (Date.parse returns NaN)", () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "not a date" }))).toBe(false);
  });

  it("Case 8: well-formed ISO timestamp → true", () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "2026-05-13T12:00:00Z" }))).toBe(true);
  });

  it("Case 9: fresh new Date().toISOString() → true", () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: new Date().toISOString() }))).toBe(true);
  });

  // Review-round-1 L4 patches: Date.parse is famously lenient on non-ISO
  // inputs. Pre-patch `"0"`, `"123"`, `"2020"` all produced finite numbers
  // on V8/Hermes and slipped through `Number.isFinite` checks. Post-patch
  // the ISO-shape regex rejects them BEFORE Date.parse runs.
  it('Case 9b: L4 — `"0"` rejected by strict-ISO regex (was accepted pre-patch on some engines)', () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "0" }))).toBe(false);
  });

  it('Case 9c: L4 — `"123"` rejected by strict-ISO regex', () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "123" }))).toBe(false);
  });

  it('Case 9d: L4 — `"2020"` (year-only) rejected by strict-ISO regex', () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "2020" }))).toBe(false);
  });

  it('Case 9e: L4 — `"2020-05-13"` (date-only, no T-separator) rejected', () => {
    // Date.parse accepts date-only as midnight-UTC; the ISO-prefix regex
    // requires `T\d{2}:\d{2}:\d{2}` so this fails.
    expect(isEmailVerified(makeUser({ email_confirmed_at: "2020-05-13" }))).toBe(false);
  });

  it('Case 9f: L4 — `"true"` rejected by strict-ISO regex', () => {
    expect(isEmailVerified(makeUser({ email_confirmed_at: "true" }))).toBe(false);
  });

  it("Case 9g: L4 — future-dated timestamp (`9999-01-01T00:00:00Z`) rejected by 24h tolerance window", () => {
    // Tampered local cache attack vector: pre-patch, a malicious app
    // rebuild could write `"9999-01-01T00:00:00Z"` to local cache to
    // bypass the gate. Post-patch the helper fails closed.
    expect(isEmailVerified(makeUser({ email_confirmed_at: "9999-01-01T00:00:00Z" }))).toBe(false);
  });

  it("Case 9h: L4 — near-future timestamp within 24h tolerance window accepted (clock-skew slack)", () => {
    // A 1-hour-future timestamp is within the 24h clock-skew tolerance —
    // accepted (legitimate NTP / timezone drift).
    const oneHourFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isEmailVerified(makeUser({ email_confirmed_at: oneHourFuture }))).toBe(true);
  });
});

describe("email-verification: canResendNow — cooldown predicate", () => {
  it("Case 10: lastResendAtMs === null → true (first-time send never gated)", () => {
    expect(canResendNow(null, 1_234_567_890)).toBe(true);
  });

  it("Case 11: 1ms before cooldown elapses → false", () => {
    expect(canResendNow(0, RESEND_COOLDOWN_MS - 1)).toBe(false);
  });

  it("Case 12: exact cooldown boundary → true (INCLUSIVE per spec)", () => {
    expect(canResendNow(0, RESEND_COOLDOWN_MS)).toBe(true);
  });

  it("Case 13: 1ms past cooldown → true", () => {
    expect(canResendNow(0, RESEND_COOLDOWN_MS + 1)).toBe(true);
  });

  // Review-round-1 M4 patch: clock-skew defense — `now - lastResendAtMs`
  // is clamped non-negative so an NTP correction or manual device-clock
  // rollback can't extend the cooldown past 60s.
  it("Case 13b: M4 — backward clock skew (`now < lastResendAtMs`) → false (cooldown still active)", () => {
    // System time moved backward by 30s mid-cooldown. Pre-patch:
    // `(now - lastResendAtMs) = -30_000`, which is < 60_000 trivially —
    // user waits forever. Post-patch: clamped to 0, treated as "no time
    // elapsed", cooldown stays active for full visible 60s.
    const lastResendAt = 1_000_000;
    const nowAfterRollback = lastResendAt - 30_000; // 30s backward
    expect(canResendNow(lastResendAt, nowAfterRollback)).toBe(false);
  });

  it("Case 13c: M4 — backward clock skew → no negative overflow", () => {
    // Extreme rollback (1 year backward) — must NOT wrap around to a
    // huge positive (no `>=` overflow shenanigans). Stays false.
    expect(canResendNow(1_000_000_000_000, 1)).toBe(false);
  });
});

describe("email-verification: secondsUntilResend — countdown formatter", () => {
  it("Case 14: lastResendAtMs === null → 0 (no countdown when not gated)", () => {
    expect(secondsUntilResend(null, 100)).toBe(0);
  });

  it("Case 15: 30s into cooldown → 30 (60 - 30)", () => {
    expect(secondsUntilResend(0, 30_000)).toBe(30);
  });

  it("Case 16: past cooldown end → 0 (Math.max clamp, never negative)", () => {
    expect(secondsUntilResend(0, 75_000)).toBe(0);
  });

  it("Case 17: 1.1s remaining → 2 (Math.ceil rounds up — never shows 0 while waiting)", () => {
    // 60_000 - (60_000 - 1100) = 1100 ms remaining → ceil(1.1) = 2 seconds.
    expect(secondsUntilResend(0, RESEND_COOLDOWN_MS - 1100)).toBe(2);
  });

  // Review-round-1 M4 patch: clock-skew defense — backward clock
  // movement must NOT produce a countdown that overshoots
  // `RESEND_COOLDOWN_MS / 1000` seconds.
  it("Case 17b: M4 — backward clock skew (`now < lastResendAtMs`) → countdown clamped to 60s max", () => {
    const lastResendAt = 1_000_000;
    const nowAfterRollback = lastResendAt - 30_000; // 30s backward
    // Pre-patch: `remainingMs = 60_000 - (-30_000) = 90_000` → 90s display.
    // Post-patch: elapsed clamped to 0 → remainingMs = 60_000 → 60s.
    expect(secondsUntilResend(lastResendAt, nowAfterRollback)).toBe(60);
  });
});

describe("email-verification: formatVerificationEmailMask — privacy mask", () => {
  it('Case 18: "alice@example.com" → "a***@example.com"', () => {
    expect(formatVerificationEmailMask("alice@example.com")).toBe("a***@example.com");
  });

  it('Case 19: "ab@example.com" (2-char local) → "a***@example.com"', () => {
    expect(formatVerificationEmailMask("ab@example.com")).toBe("a***@example.com");
  });

  it('Case 20: "a@example.com" (1-char local) → "a***@example.com"', () => {
    expect(formatVerificationEmailMask("a@example.com")).toBe("a***@example.com");
  });

  it('Case 21: undefined → "your email address" (fallback)', () => {
    expect(formatVerificationEmailMask(undefined)).toBe("your email address");
  });

  it('Case 22: "not-an-email" (no `@`) → fallback', () => {
    expect(formatVerificationEmailMask("not-an-email")).toBe("your email address");
  });

  it('Case 23: "" (empty) → fallback', () => {
    expect(formatVerificationEmailMask("")).toBe("your email address");
  });

  it('Case 24: "@example.com" (@ at index 0) → fallback (no local part)', () => {
    // Defensive: a malformed email with @ at index 0 has zero local-part to mask.
    expect(formatVerificationEmailMask("@example.com")).toBe("your email address");
  });

  // Review-round-1 L3 patch: trim before processing so a leading whitespace
  // (autocomplete keyboard / copy-paste) doesn't leak a space into the
  // rendered display string.
  it('Case 24b: L3 — " alice@example.com" (leading space) → "a***@example.com" (trim defense)', () => {
    expect(formatVerificationEmailMask(" alice@example.com")).toBe("a***@example.com");
  });

  it('Case 24c: L3 — "alice@example.com " (trailing space) → "a***@example.com"', () => {
    expect(formatVerificationEmailMask("alice@example.com ")).toBe("a***@example.com");
  });

  it('Case 24d: L3 — whitespace-only input ("   ") → fallback', () => {
    expect(formatVerificationEmailMask("   ")).toBe("your email address");
  });

  it('Case 24e: L3 — " @example.com" (space-then-@) → fallback (trimmed @-at-index-0)', () => {
    // After trim, "@example.com" has @ at index 0; the existing
    // <=0 check fires.
    expect(formatVerificationEmailMask(" @example.com")).toBe("your email address");
  });
});
