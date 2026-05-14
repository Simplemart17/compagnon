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
 *       contract). Uses balanced-paren extraction (review-round-1 P3)
 *       so a `password` reference inside a NESTED call like
 *       `captureError(err, "tag", buildExtras(password))` cannot slip
 *       through the regex's first-`)` truncation.
 *   (f) Post-12-8 placeholder uses `MIN_PASSWORD_LENGTH` constant via
 *       template literal (review-round-1 P6). Pre-patch the test
 *       accepted a vacuous `MIN_PASSWORD_LENGTH` import-without-use;
 *       post-patch the constant must appear inside a placeholder
 *       template literal so a reverted placeholder cannot satisfy the
 *       test by leaving the import alone.
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

/**
 * Extract every `captureError(...)` call's argument list using
 * balanced-paren walking (review-round-1 P3). Pre-patch the regex
 * `/captureError\s*\([\s\S]*?\)/g` was non-greedy and stopped at the
 * FIRST `)`, so a multi-line / nested call like
 * `captureError(err, "tag", buildExtras(password))` was captured as
 * `captureError(err, "tag", buildExtras(` — losing the `password`
 * reference and silently passing the negative-guard.
 *
 * This walker correctly handles arbitrary nesting up to a sane depth
 * by counting open/close parens character-by-character.
 */
function extractCaptureErrorCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = "captureError";
  let i = 0;
  while (i < source.length) {
    const idx = source.indexOf(needle, i);
    if (idx === -1) break;
    // Confirm word boundary BEFORE the match (defends against
    // identifiers like `mockCaptureError` matching by substring).
    const prevChar = idx > 0 ? source[idx - 1] : "";
    if (prevChar && /[A-Za-z0-9_$]/.test(prevChar)) {
      i = idx + needle.length;
      continue;
    }
    // Find the opening paren after optional whitespace.
    let j = idx + needle.length;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (source[j] !== "(") {
      i = idx + needle.length;
      continue;
    }
    // Walk forward counting parens.
    let depth = 0;
    const start = j;
    while (j < source.length) {
      const ch = source[j];
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
    expect(SIGNUP_CODE_ONLY).not.toMatch(/password\.length\s*<\s*6\b/);
  });

  it("Case 4: NEGATIVE — pre-12-8 `min. 6 caractères` placeholder is absent", () => {
    expect(SIGNUP_CODE_ONLY).not.toMatch(/min\.\s*6\s*caract[eè]res/i);
  });

  it("Case 5: NEGATIVE — captureError is NEVER passed the password variable (Story 9-3 contract; balanced-paren walker)", () => {
    const captureErrorCalls = extractCaptureErrorCalls(SIGNUP_CODE_ONLY);
    // Sanity: there IS at least one captureError call in this file
    // (the catch-block uses captureError(err, "signup")). If this drops
    // to zero, the walker is broken.
    expect(captureErrorCalls.length).toBeGreaterThan(0);
    for (const call of captureErrorCalls) {
      // Identifier-boundary match: \bpassword\b must not appear in the
      // argument list. A future refactor that includes `password` or
      // `password.length` as an arg — even nested — would fail this.
      expect(call).not.toMatch(/\bpassword\b/);
    }
  });

  it("Case 5b: walker self-check — extracts a synthetic call with nested parens completely", () => {
    // Defends against a future regression in `extractCaptureErrorCalls`
    // that re-introduces the first-`)` truncation bug. If the walker
    // breaks, this synthetic test fires loudly instead of silently
    // returning no findings on the real source.
    const synthetic = `captureError(err, "tag", buildExtras(password));`;
    const calls = extractCaptureErrorCalls(synthetic);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("password");
  });

  it("Case 6: post-12-8 placeholder uses MIN_PASSWORD_LENGTH constant via template literal (P6 strict)", () => {
    // Pre-patch this test was an OR — accepting either the literal
    // `min. 10 caractères` OR a bare `MIN_PASSWORD_LENGTH` import.
    // The import-only path was vacuous: a future regression that
    // reverted the placeholder to `min. 6 caractères` while leaving
    // the import in place would silently pass.
    // Post-patch: REQUIRE the constant to appear inside a template
    // literal in the placeholder (the JSX `placeholder=` attribute
    // value) so the source-of-truth is genuinely consumed.
    expect(SIGNUP_CODE_ONLY).toMatch(
      /placeholder=\{`Mot de passe \(min\.\s*\$\{MIN_PASSWORD_LENGTH\}\s*caract[eè]res\)`\}/
    );
  });
});
