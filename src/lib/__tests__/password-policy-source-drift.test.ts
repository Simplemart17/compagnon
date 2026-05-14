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
 *       contract). Uses STRING-LITERAL-AWARE balanced-paren extraction
 *       (review-round-2 R2-P3) so a `password` reference inside a
 *       NESTED call OR after a string literal containing `)` like
 *       `captureError(err, "tag with )", buildExtras(password))` cannot
 *       slip through.
 *   (f) Post-12-8 placeholder uses `MIN_PASSWORD_LENGTH` constant via
 *       template literal (review-round-1 P6 + review-round-2 R2-P13
 *       Prettier-multi-line tolerance).
 *   (g) Call-site ordering — `isPwnedRejection` MUST be called BEFORE
 *       `mapSupabaseWeakPasswordError` in signup.tsx (review-round-2
 *       R2-P12). The current contract relies on this ordering: if
 *       flipped, a `["pwned"]` rejection would surface the generic
 *       French message instead of the pwned-specific message.
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
 * STRING-LITERAL-AWARE balanced-paren walking. Pre-R1 a non-greedy
 * regex truncated at the first `)`; pre-R2 a naive paren-counter
 * truncated at any `)` inside a string literal (e.g.,
 * `captureError(err, "tag with )", buildExtras(password))` got
 * captured as `(err, "tag with )` — losing the `password` reference).
 *
 * R2-P3 fix: the walker tracks `inString` state and skips chars
 * inside `"..."`, `'...'`, and `` `...` `` literals (handling \` /
 * `\\` / `${...}` template-expression nesting too). Outside strings,
 * `(` / `)` count toward depth as before.
 *
 * Handles arbitrary `()` nesting outside string literals
 * (review-round-2 R2-P11 JSDoc tightening).
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
    // Walk forward counting parens, with string-literal awareness.
    let depth = 0;
    const start = j;
    let inString: false | '"' | "'" | "`" = false;
    let templateDepth = 0; // depth of `${...}` inside a template literal
    while (j < source.length) {
      const ch = source[j];
      if (inString) {
        if (ch === "\\") {
          // Escape sequence — skip the next char (defends against
          // `"foo\""` ending the literal prematurely).
          j += 2;
          continue;
        }
        if (inString === "`" && ch === "$" && source[j + 1] === "{") {
          // Entering a template-literal expression `${...}` — switch
          // back to code mode but remember the template depth so we
          // can re-enter the template literal when the expression's
          // closing `}` matches.
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
      // Code mode (outside string literals).
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        j++;
        continue;
      }
      if (templateDepth > 0 && ch === "}") {
        // Closing a `${...}` expression — re-enter the template literal.
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

  it("Case 5: NEGATIVE — captureError is NEVER passed the password variable (Story 9-3 contract; string-literal-aware walker)", () => {
    const captureErrorCalls = extractCaptureErrorCalls(SIGNUP_CODE_ONLY);
    // Sanity: there IS at least one captureError call in this file
    // (the catch-block uses captureError(err, "signup")). If this drops
    // to zero, the walker is broken.
    expect(captureErrorCalls.length).toBeGreaterThan(0);
    for (const call of captureErrorCalls) {
      // Identifier-boundary match: \bpassword\b must not appear in the
      // argument list. A future refactor that includes `password` or
      // `password.length` as an arg — even nested in a string literal
      // OR a balanced-paren expression — would fail this.
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

  it("Case 5c: review-round-2 R2-P3 — walker handles `)` inside string literals without truncating", () => {
    // The R2 fix: walker's `inString` state skips parens inside quoted
    // strings + template literals. Pre-R2 a naive paren counter would
    // truncate at the `)` inside "tag with )" and miss the `password`
    // reference entirely.
    const cases = [
      // Double-quoted string with `)` inside.
      `captureError(err, "tag with )", buildExtras(password));`,
      // Single-quoted string with `)` inside.
      `captureError(err, 'tag with )', { x: password });`,
      // Template literal with `)` inside.
      `captureError(err, \`tag with )\`, { x: password });`,
      // Template literal with nested `${expr(arg)}` containing the
      // password reference inside the expression.
      `captureError(err, \`tag with \${password.length}\`, {});`,
      // Escaped quote inside string — `\"` shouldn't terminate the literal.
      `captureError(err, "tag \\"with quote and )", buildExtras(password));`,
    ];
    for (const synthetic of cases) {
      const calls = extractCaptureErrorCalls(synthetic);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("password");
    }
  });

  it("Case 6: post-12-8 placeholder uses MIN_PASSWORD_LENGTH constant via template literal (R2-P13 Prettier-tolerant)", () => {
    // Pre-R1 this test was an OR — accepting either the literal
    // `min. 10 caractères` OR a bare `MIN_PASSWORD_LENGTH` import.
    // R1-P6 made it strict but used a tight regex that failed if
    // Prettier wrapped the JSX attribute across lines.
    // Post-R2-P13 the regex tolerates `[\s\S]*?` between key segments
    // so any reformat preserving the constant-inside-placeholder
    // semantic passes.
    expect(SIGNUP_CODE_ONLY).toMatch(
      /placeholder=\s*\{\s*`[\s\S]*?\$\{\s*MIN_PASSWORD_LENGTH\s*\}[\s\S]*?caract[eè]res[\s\S]*?`\s*\}/
    );
  });

  it("Case 7: review-round-2 R2-P12 — isPwnedRejection MUST be called BEFORE mapSupabaseWeakPasswordError in the catch-block", () => {
    // The signup catch-block contract: if the rejection is HIBP-pwned,
    // surface the pwned-specific French message ("Ce mot de passe a
    // été divulgué..."). Otherwise fall through to the always-merge
    // mapper. If a future refactor flips the order, a `["pwned"]`
    // rejection would silently surface the generic French message
    // ("Mot de passe trop faible. Veuillez en choisir un autre.")
    // instead of the pwned-specific one because mapSupabaseWeakPasswordError
    // returns `[]` for pwned-only reasons (P1 contract).
    //
    // Anchor on the CALL-SITE form (`identifier(`) — not the bare
    // identifier — so the alphabetically-sorted import block doesn't
    // make the test vacuous (both names appear in the import; the
    // call-site form pins the runtime ordering inside handleSignUp).
    const isPwnedCallIdx = SIGNUP_CODE_ONLY.search(/isPwnedRejection\s*\(/);
    const mapperCallIdx = SIGNUP_CODE_ONLY.search(/mapSupabaseWeakPasswordError\s*\(/);
    // Both should exist as call sites.
    expect(isPwnedCallIdx).toBeGreaterThan(-1);
    expect(mapperCallIdx).toBeGreaterThan(-1);
    // Ordering: the FIRST call to isPwnedRejection appears before the
    // FIRST call to mapSupabaseWeakPasswordError. A regression flipping
    // the order — even by accident during a refactor — fails this.
    expect(isPwnedCallIdx).toBeLessThan(mapperCallIdx);
  });
});
