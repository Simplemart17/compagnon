/**
 * Story 12-9 — `app/_layout.tsx` source drift detector.
 *
 * Reads the root layout source from disk + comment-strips per Story 12-2
 * P12 lesson + asserts the post-12-9 invariants are present AND that the
 * pre-12-9 routing path (no verification guard) is impossible by regex.
 *
 * Load-bearing assertions:
 *   (a) `isEmailVerified` import from `@/src/lib/email-verification`.
 *   (b) `EmailVerificationGate` import from
 *       `@/src/components/auth/EmailVerificationGate`.
 *   (c) Routing-effect contains `!isEmailVerified(user)` guard.
 *   (d) Notification-registration effect contains `isEmailVerified(user)`
 *       in its condition (positive guard — only verified users register
 *       push tokens; unverified UIDs leave NO server-side token state).
 *   (e) NEGATIVE — `captureError` is NEVER passed the `email` variable
 *       (defends against telemetry leak of PII; Story 9-3 contract).
 *       Uses the STRING-LITERAL-AWARE balanced-paren walker (Story 12-8
 *       R2-P3 lesson) so a `captureError` with `)` inside a string literal
 *       can't bypass the guard.
 *   (f) Render-branch ordering — the `EmailVerificationGate` render-branch
 *       appears BEFORE the `ProfileRetryScreen` render-branch in the
 *       source. Source-line indexOf comparison.
 *   (g) `decideAuthAction` switch invariance — Story 9-6 contract is
 *       preserved. Reading `src/lib/auth-events.ts` and asserting the
 *       canonical case-arm strings are still present (drift catches a
 *       future edit that drops or renames an arm).
 */

import * as fs from "fs";
import * as path from "path";

const LAYOUT_FILE_PATH = path.resolve(__dirname, "../../../app/_layout.tsx");
const AUTH_EVENTS_FILE_PATH = path.resolve(__dirname, "../auth-events.ts");
// Review-round-1 M5 patch: the gate component is the actual file where
// `userEmail` is in lexical scope. Pre-patch the drift detector only
// covered `_layout.tsx` (which has no `email` to leak) — the Story 9-3
// PII-leak negative guard was structurally bypassable.
const GATE_FILE_PATH = path.resolve(
  __dirname,
  "../../../src/components/auth/EmailVerificationGate.tsx"
);

/**
 * Strip /* block * / comments + // line comments so JSDoc that mentions
 * deprecated patterns (e.g., a docstring saying "pre-12-9 the routing did
 * not check email_confirmed_at") does not trip the negative-guard regex.
 * (Story 12-2 P12 lesson.)
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * STRING-LITERAL-AWARE balanced-paren extractor for `captureError` calls.
 * Mirrors the Story 12-8 R2-P3 implementation in
 * `password-policy-source-drift.test.ts` so the negative-guard against
 * `captureError(*, email)` cannot be bypassed by a `)` inside a quoted
 * argument string.
 */
function extractCaptureErrorCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = "captureError";
  let i = 0;
  while (i < source.length) {
    const idx = source.indexOf(needle, i);
    if (idx === -1) break;
    const prevChar = idx > 0 ? source[idx - 1] : "";
    if (prevChar && /[A-Za-z0-9_$]/.test(prevChar)) {
      i = idx + needle.length;
      continue;
    }
    let j = idx + needle.length;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (source[j] !== "(") {
      i = idx + needle.length;
      continue;
    }
    let depth = 0;
    const start = j;
    let inString: false | '"' | "'" | "`" = false;
    let templateDepth = 0;
    while (j < source.length) {
      const ch = source[j];
      if (inString) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (inString === "`" && ch === "$" && source[j + 1] === "{") {
          templateDepth++;
          inString = false;
          j += 2;
          continue;
        }
        if (ch === inString) {
          inString = false;
          j++;
          continue;
        }
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        j++;
        continue;
      }
      if (templateDepth > 0 && ch === "}") {
        templateDepth--;
        inString = "`";
        j++;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
      j++;
    }
    calls.push(source.slice(start, j));
    i = j;
  }
  return calls;
}

const LAYOUT_SOURCE = fs.readFileSync(LAYOUT_FILE_PATH, "utf-8");
const LAYOUT_CODE_ONLY = stripComments(LAYOUT_SOURCE);
const AUTH_EVENTS_SOURCE = fs.readFileSync(AUTH_EVENTS_FILE_PATH, "utf-8");
const GATE_SOURCE = fs.readFileSync(GATE_FILE_PATH, "utf-8");
const GATE_CODE_ONLY = stripComments(GATE_SOURCE);

describe("_layout.tsx — Story 12-9 source drift detector", () => {
  it("Case 1: imports isEmailVerified from @/src/lib/email-verification", () => {
    expect(LAYOUT_CODE_ONLY).toMatch(
      /import\s*\{\s*isEmailVerified\s*\}\s*from\s*["']@\/src\/lib\/email-verification["']/
    );
  });

  it("Case 2: imports EmailVerificationGate from @/src/components/auth/EmailVerificationGate", () => {
    expect(LAYOUT_CODE_ONLY).toMatch(
      /import\s*\{\s*EmailVerificationGate\s*\}\s*from\s*["']@\/src\/components\/auth\/EmailVerificationGate["']/
    );
  });

  it("Case 3: routing-effect contains the `!isEmailVerified(user)` guard", () => {
    // Pin: the guard reads `user` (not `session.user` or some cached flag)
    // — server-authoritative semantics enforced.
    expect(LAYOUT_CODE_ONLY).toMatch(/!\s*isEmailVerified\s*\(\s*user\s*\)/);
  });

  it("Case 4: notification-registration effect contains `isEmailVerified(user)` in its condition", () => {
    // Pin: an unverified UID must NOT pre-register a push token.
    // The check appears alongside the existing `hasRegisteredNotifications.current` guard.
    expect(LAYOUT_CODE_ONLY).toMatch(
      /hasRegisteredNotifications\.current[\s\S]{0,80}?&&\s*isEmailVerified\s*\(\s*user\s*\)/
    );
  });

  it("Case 5: NEGATIVE — captureError is NEVER passed the `email` variable (Story 9-3 contract; string-literal-aware walker)", () => {
    const captureErrorCalls = extractCaptureErrorCalls(LAYOUT_CODE_ONLY);
    // _layout.tsx has at least the notification-registration captureError;
    // if the walker is broken this drops to 0 and the test fires loudly
    // instead of vacuously passing.
    expect(captureErrorCalls.length).toBeGreaterThan(0);
    for (const call of captureErrorCalls) {
      // The string "email-verification-resend" is a Sentry feature tag
      // string, not a reference to the `email` variable. Filter for the
      // bare `email` identifier — must not appear as an argument value
      // (i.e., outside a string literal). We already strip strings via
      // the walker; the captured slice retains string literals so test
      // them carefully.
      //
      // The literal `email` substring inside a string ("...email...")
      // would false-positive a `\bemail\b` match. Strip string contents
      // from the call slice before the membership check.
      const callCodeOnly = call
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, "``");
      expect(callCodeOnly).not.toMatch(/\bemail\b/);
    }
  });

  it("Case 6: render-branch ordering — EmailVerificationGate appears BEFORE ProfileRetryScreen", () => {
    // Story 12-9 contract: verification fires UPSTREAM of profile-retry.
    // An unverified user must never reach the profile-load path.
    const gateIdx = LAYOUT_CODE_ONLY.search(/<EmailVerificationGate\b/);
    const retryIdx = LAYOUT_CODE_ONLY.search(/<ProfileRetryScreen\b/);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(retryIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(retryIdx);
  });

  it("Case 7: `decideAuthAction` switch invariance — Story 9-6 contract preserved", () => {
    // Story 12-9 must NOT touch auth-events.ts. The drift catches a
    // future edit that drops or renames a case arm.
    expect(AUTH_EVENTS_SOURCE).toMatch(/case\s+"INITIAL_SESSION"/);
    expect(AUTH_EVENTS_SOURCE).toMatch(/case\s+"SIGNED_IN"/);
    expect(AUTH_EVENTS_SOURCE).toMatch(/case\s+"USER_UPDATED"/);
    expect(AUTH_EVENTS_SOURCE).toMatch(/case\s+"TOKEN_REFRESHED"/);
    expect(AUTH_EVENTS_SOURCE).toMatch(/case\s+"PASSWORD_RECOVERY"/);
    expect(AUTH_EVENTS_SOURCE).toMatch(/case\s+"MFA_CHALLENGE_VERIFIED"/);
    // The SIGNED_OUT pre-switch early-return also stays.
    expect(AUTH_EVENTS_SOURCE).toMatch(/event\s*===\s*"SIGNED_OUT"/);
  });

  // Review-round-1 M5 patch: pre-patch the negative captureError(*, email)
  // guard only ran against _layout.tsx (which has no `email` in scope).
  // The actual PII-leak risk site is EmailVerificationGate.tsx, where
  // `userEmail` is lexically in scope at every captureError call. These
  // cases close that bypass.
  it("Case 8 (M5): NEGATIVE — EmailVerificationGate.tsx — captureError never receives `email` / `userEmail`", () => {
    const captureErrorCalls = extractCaptureErrorCalls(GATE_CODE_ONLY);
    // Sanity: post-patch the gate has 3 captureError sites (resend / refresh
    // / signout error paths). If this drops to 0 the walker is broken.
    expect(captureErrorCalls.length).toBeGreaterThan(0);
    for (const call of captureErrorCalls) {
      // Strip string literals before the identifier-membership check so
      // `"email-verification-resend"` doesn't false-positive on the bare
      // `email` substring.
      const callCodeOnly = call
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, "``");
      // The bare `email` identifier and the `userEmail` identifier are
      // both unsafe to pass — fail if either appears.
      expect(callCodeOnly).not.toMatch(/\bemail\b/);
      expect(callCodeOnly).not.toMatch(/\buserEmail\b/);
    }
  });

  it("Case 9 (M5): GATE — three captureError sites present with categorical feature tags", () => {
    // Pin the three Story 9-3 feature-tag strings the post-round-1 gate
    // surfaces: resend / refresh / signout. A future refactor that
    // collapses them or renames any one should fail loudly.
    expect(GATE_CODE_ONLY).toMatch(/captureError\([^)]*"email-verification-resend"/);
    expect(GATE_CODE_ONLY).toMatch(/captureError\([^)]*"email-verification-refresh"/);
    expect(GATE_CODE_ONLY).toMatch(/captureError\([^)]*"email-verification-signout"/);
  });
});
