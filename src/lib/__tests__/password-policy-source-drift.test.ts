/**
 * Story 12-8 — `app/(auth)/signup.tsx` source drift detector.
 *
 * Reads the signup screen source from disk + comment-strips per Story
 * 12-2 P12 lesson + asserts the post-12-8 invariants are present AND
 * the pre-12-8 patterns are absent. Catches a regression that would
 * silently weaken the password floor or leak the password to telemetry.
 *
 * Load-bearing assertions:
 *   (a) `validatePasswordStrength` import from `@/src/lib/password-policy`.
 *   (b) `PasswordStrengthIndicator` import from
 *       `@/src/components/auth/PasswordStrengthIndicator`.
 *   (c) NEGATIVE — the literal `password.length < 6` block is gone.
 *   (d) NEGATIVE — the literal placeholder `min. 6 caractères` is gone.
 *   (e) NEGATIVE — `captureError` is NEVER passed the `password`
 *       variable (defends against accidental telemetry leak; Story 9-3
 *       contract).
 *   (f) Post-12-8 placeholder `min. 10 caractères` is present (or the
 *       MIN_PASSWORD_LENGTH constant is referenced).
 */

import * as fs from "fs";
import * as path from "path";

const SIGNUP_FILE_PATH = path.resolve(__dirname, "../../../app/(auth)/signup.tsx");

/**
 * Strip /* block * / comments + // line comments so JSDoc that mentions
 * deprecated patterns (e.g., a docstring saying "pre-12-8 used password.length < 6")
 * does not trip the negative-guard regex. (Story 12-2 P12 lesson.)
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SIGNUP_SOURCE = fs.readFileSync(SIGNUP_FILE_PATH, "utf-8");
const SIGNUP_CODE_ONLY = stripComments(SIGNUP_SOURCE);

describe("signup.tsx — Story 12-8 source drift detector", () => {
  it("Case 1: imports validatePasswordStrength from @/src/lib/password-policy", () => {
    // Allow either named-import or namespace; keep the regex permissive on
    // exact import shape so a future refactor adding more exports doesn't
    // false-trip.
    expect(SIGNUP_CODE_ONLY).toMatch(
      /import\s*\{[\s\S]*?validatePasswordStrength[\s\S]*?\}\s*from\s*["']@\/src\/lib\/password-policy["']/
    );
  });

  it("Case 2: imports PasswordStrengthIndicator from the auth components dir", () => {
    expect(SIGNUP_CODE_ONLY).toMatch(
      /import\s*\{[\s\S]*?PasswordStrengthIndicator[\s\S]*?\}\s*from\s*["']@\/src\/components\/auth\/PasswordStrengthIndicator["']/
    );
  });

  it("Case 3: NEGATIVE — pre-12-8 `password.length < 6` regression is absent", () => {
    // Match `password.length` with optional whitespace + `<` + optional ws + 6
    // Comment-stripped source so JSDoc cannot false-positive.
    expect(SIGNUP_CODE_ONLY).not.toMatch(/password\.length\s*<\s*6\b/);
  });

  it("Case 4: NEGATIVE — pre-12-8 `min. 6 caractères` placeholder is absent", () => {
    // The `\.` literal dot in the placeholder; keep tolerant of NBSP.
    expect(SIGNUP_CODE_ONLY).not.toMatch(/min\.\s*6\s*caract[eè]res/i);
  });

  it("Case 5: NEGATIVE — captureError is NEVER passed the password variable (Story 9-3 contract)", () => {
    // Match `captureError(...)` arguments and assert no occurrence carries
    // the bare `password` identifier. Tolerant of whitespace + multi-line
    // arg lists.
    const captureErrorCalls = SIGNUP_CODE_ONLY.match(/captureError\s*\(([\s\S]*?)\)/g) ?? [];
    for (const call of captureErrorCalls) {
      // Identifier-boundary match: \bpassword\b must not appear in the
      // argument list. (A future refactor that includes `password.length`
      // as an arg would fail this.)
      expect(call).not.toMatch(/\bpassword\b/);
    }
  });

  it("Case 6: post-12-8 `min. 10 caractères` placeholder OR MIN_PASSWORD_LENGTH ref is present", () => {
    const hasNewPlaceholder = /min\.\s*10\s*caract[eè]res/i.test(SIGNUP_CODE_ONLY);
    const hasConstantRef = /MIN_PASSWORD_LENGTH/.test(SIGNUP_CODE_ONLY);
    expect(hasNewPlaceholder || hasConstantRef).toBe(true);
  });
});
