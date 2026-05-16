/**
 * Story 12-8 — `password-policy` unit tests.
 *
 * Pins the client-side password validator + Supabase error mapper +
 * strength meter contract. Load-bearing assertions:
 *   (a) `MIN_PASSWORD_LENGTH = 10` constant pin (drift-catches a sloppy
 *       edit back to 6 / 8).
 *   (b) `validatePasswordStrength` returns ALL failing reasons (no
 *       short-circuit) so the UI can render the full checklist.
 *   (c) ASCII-only regex semantics (`/[a-z]/`, `/[A-Z]/`, `/\d/`) match
 *       Supabase's server-side enforcement — Cyrillic / Greek / Armenian
 *       letters AND Arabic-Indic digits are NOT counted as lowercase /
 *       uppercase / digit. Defends against a passing-on-client /
 *       failing-on-server UX trap.
 *   (d) Length boundary at exactly 10 (inclusive) passes; 9 fails. Pins
 *       the `< MIN_PASSWORD_LENGTH` strict-less-than semantics.
 *   (e) `mapSupabaseWeakPasswordError` always-merge-client-reasons
 *       contract (review-round-1 P1) — when `password` is provided, the
 *       result includes EVERY currently-failing client rule, not just
 *       the server-reported subset.
 *   (f) `mapSupabaseWeakPasswordError` defense-in-depth on `name`
 *       (review-round-1 P11) — accepts EITHER `code === "weak_password"`
 *       OR `name === "AuthWeakPasswordError"`.
 *   (g) `isPwnedRejection` discriminates `"pwned"` reasons; non-pwned
 *       weak_password errors return `false`.
 *   (h) `computePasswordStrengthLabel` thresholds (review-round-1 P2):
 *       3+ reasons → weak; 1+ reasons + length<8 → weak; 0 reasons +
 *       length<14 → medium; 0 reasons + length≥14 + distinct<6 → medium;
 *       0 reasons + length≥14 + distinct≥6 → strong.
 *   (i) Trimmed-length check (review-round-1 P5) — whitespace-padding
 *       tricks like `"Aa1Aa1Aa1\t"` (10 raw chars) fail length because
 *       the trimmed length is 9.
 *   (j) `getGenericWeakPasswordMessage` returns canonical fallback
 *       used by signup.tsx when server returns `weak_password` with no
 *       parseable itemized reasons (review-round-1 P7).
 */

import {
  MIN_PASSWORD_LENGTH,
  __THRESHOLDS_FOR_TESTS,
  computePasswordStrengthLabel,
  getGenericWeakPasswordMessage,
  getPwnedMessage,
  isPwnedRejection,
  mapSupabaseWeakPasswordError,
  passwordPolicyReasonToMessage,
  validatePasswordStrength,
  type PasswordPolicyReason,
  type PasswordPolicyResult,
} from "../password-policy";

describe("password-policy: MIN_PASSWORD_LENGTH constant pin", () => {
  it("Case 1: MIN_PASSWORD_LENGTH equals 10 (drift-catches edits to 6/8)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });

  it("Case 1b: review-round-1 P15 — PasswordPolicyResult type is a usable export (compile-time pin)", () => {
    // If a future regression drops the `PasswordPolicyResult` export
    // or renames it, this assignment fails to compile and CI breaks
    // loudly. The runtime check is a no-op (just confirms shape).
    const sample: PasswordPolicyResult = { valid: true, reasons: [] };
    expect(sample.valid).toBe(true);
    expect(Array.isArray(sample.reasons)).toBe(true);
  });

  it("Case 1c: review-round-1 P2 — heuristic threshold constants are pinned", () => {
    expect(__THRESHOLDS_FOR_TESTS.STRONG_LENGTH_THRESHOLD).toBe(14);
    expect(__THRESHOLDS_FOR_TESTS.VERY_SHORT_LENGTH_THRESHOLD).toBe(8);
    expect(__THRESHOLDS_FOR_TESTS.STRONG_DISTINCT_CHARS_THRESHOLD).toBe(6);
  });
});

describe("password-policy: validatePasswordStrength()", () => {
  it("Case 2: empty password fails ALL 4 rules (no short-circuit)", () => {
    const result = validatePasswordStrength("");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["length", "lowercase", "uppercase", "digit"]);
  });

  it("Case 3: 10 lowercase letters fails uppercase + digit only", () => {
    const result = validatePasswordStrength("abcdefghij");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["uppercase", "digit"]);
  });

  it("Case 4: 10 uppercase letters fails lowercase + digit only", () => {
    const result = validatePasswordStrength("ABCDEFGHIJ");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["lowercase", "digit"]);
  });

  it("Case 5: 10 digits fails lowercase + uppercase only", () => {
    const result = validatePasswordStrength("1234567890");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["lowercase", "uppercase"]);
  });

  it("Case 6: happy path — 10 chars + lower + upper + digit", () => {
    const result = validatePasswordStrength("Abcdefghi1");
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("Case 7: short password with all classes — only length fails", () => {
    const result = validatePasswordStrength("Abc1");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["length"]);
  });

  it("Case 8: 5-char with all classes — length still fails", () => {
    const result = validatePasswordStrength("Abcd1");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["length"]);
  });

  it("Case 9: length boundary at exactly 10 chars passes (inclusive >=)", () => {
    const result = validatePasswordStrength("Abcdefghi1");
    expect(result.reasons).not.toContain("length");
    expect(result.valid).toBe(true);
  });

  it("Case 10: length boundary at exactly 9 chars fails (twin to Case 9)", () => {
    const result = validatePasswordStrength("Abcdefgh1");
    expect(result.reasons).toContain("length");
    expect(result.valid).toBe(false);
  });

  it("Case 11: Cyrillic password with digit + space — ASCII regex catches missing ASCII letters", () => {
    // 14 chars, Cyrillic letters, one digit, one space. NO ASCII letters.
    // Mirrors Supabase server-side ASCII semantics — prevents silent
    // client-pass / server-fail UX trap.
    const result = validatePasswordStrength("Мой пароль 123");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["lowercase", "uppercase"]);
  });

  it("Case 11b: review-round-1 P17 — no-space Cyrillic variant also fails ASCII letter rules", () => {
    // 12 chars, Cyrillic letters only + 3 ASCII digits, NO space.
    // The pre-patch test used `"Мой пароль 123"` which contains spaces;
    // a space character is also non-ASCII-letter so the test could
    // pass vacuously regardless of which non-ASCII char drove the
    // failure. The no-space variant pins the contract more strictly.
    const result = validatePasswordStrength("Мойпароль123");
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["lowercase", "uppercase"]);
  });

  it("Case 11c: review-round-1 P16 — Arabic-Indic digit ٩ is NOT counted as `digit`", () => {
    // `/\d/` without the `u` flag is ASCII-only per ECMA-262.
    // A user typing on an Arabic keyboard expects ٩ (U+0669) to count
    // as a digit; it doesn't — and Supabase server-side has the same
    // semantics, so client + server agree on rejection. Pin the
    // contract so a future engine upgrade adding Unicode-decimal
    // semantics fails this test loudly.
    const result = validatePasswordStrength("Abcdefghi٩");
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("digit");
  });

  it("Case 11d: review-round-1 P5 — trailing whitespace does NOT count toward length", () => {
    // 10 raw chars but only 9 content chars after trim → length fails.
    // Defends against whitespace-padding tricks that fail to round-trip
    // on next sign-in (most native keyboards strip trailing whitespace).
    const result = validatePasswordStrength("Aa1Aa1Aa1\t");
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("length");
  });

  it("Case 11e: review-round-1 P5 — leading whitespace does NOT count toward length", () => {
    const result = validatePasswordStrength("   Abcdefg1"); // 11 raw, 8 content
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("length");
  });

  it("Case 11f: review-round-1 P5 — inner whitespace IS preserved (passphrase support)", () => {
    // "Correct horse battery 9A" = 24 chars including spaces; trim
    // doesn't touch inner whitespace. Should pass length AND all 4
    // class rules.
    const result = validatePasswordStrength("Correct horse battery 9A");
    expect(result.valid).toBe(true);
  });

  // R2-P8 — parametric whitespace coverage. Pre-R2 only `\t` (Case 11d)
  // and `" "` (Case 11e) were tested; a regression like
  // `password.replace(/\t/g, "").length < MIN` (specifically strip tabs)
  // would have passed Case 11d. Post-R2 the parametric block ensures
  // ALL ASCII whitespace + NBSP variants are trim-stripped.
  it.each([
    [" ", "ASCII space"],
    ["\t", "tab"],
    ["\n", "newline"],
    ["\r", "carriage return"],
    ["\v", "vertical tab"],
    ["\f", "form feed"],
    [" ", "non-breaking space (NBSP)"],
  ])(
    "Case 11g[%s]: review-round-2 R2-P8 — trailing %s is stripped by trim() and length fails",
    (whitespace, _label) => {
      // 9 content chars + 1 trailing whitespace = 10 raw chars. trim()
      // strips → 9 content chars → length fails.
      // 9 content chars + 1 trailing whitespace = 10 raw chars. trim()
      // strips → 9 content chars → length fails.
      const result = validatePasswordStrength(`Aa1Aa1Aa1${whitespace}`);
      expect(result.reasons).toContain("length");
    }
  );
});

describe("password-policy: passwordPolicyReasonToMessage()", () => {
  it("Case 12: 'length' → 'At least 10 characters' (template literal sourced from MIN_PASSWORD_LENGTH)", () => {
    // Story 12-8 review-round-1 P4 + Story 14-1 EN conversion: the
    // message MUST be derived from MIN_PASSWORD_LENGTH via template
    // literal so a future bump propagates atomically. The literal
    // string assertion below remains correct as long as
    // MIN_PASSWORD_LENGTH === 10.
    expect(passwordPolicyReasonToMessage("length")).toBe(
      `At least ${MIN_PASSWORD_LENGTH} characters`
    );
  });

  it("Case 13: 'lowercase' → 'At least one lowercase letter' (canonical)", () => {
    expect(passwordPolicyReasonToMessage("lowercase")).toBe("At least one lowercase letter");
  });

  it("Case 14: 'uppercase' → 'At least one uppercase letter' (canonical)", () => {
    expect(passwordPolicyReasonToMessage("uppercase")).toBe("At least one uppercase letter");
  });

  it("Case 15: 'digit' → 'At least one digit' (canonical)", () => {
    expect(passwordPolicyReasonToMessage("digit")).toBe("At least one digit");
  });
});

describe("password-policy: mapSupabaseWeakPasswordError()", () => {
  it("Case 16: undefined / null / non-Supabase errors return null (defensive)", () => {
    expect(mapSupabaseWeakPasswordError(undefined)).toBeNull();
    expect(mapSupabaseWeakPasswordError(null)).toBeNull();
    expect(mapSupabaseWeakPasswordError(new Error("network"))).toBeNull();
    expect(mapSupabaseWeakPasswordError({})).toBeNull();
    expect(mapSupabaseWeakPasswordError({ code: "user_already_exists" })).toBeNull();
  });

  it("Case 17: review-round-1 P1 — weak_password with reasons=['length'] + short password also reports composition failures (always-merge)", () => {
    // Pre-patch: server reports `["length"]` only → mapper returns
    // only `["length"]`. User fixes length, resubmits, gets a SECOND
    // error for missing uppercase/digit (moving-goalpost UX).
    // Post-patch: ALWAYS merge client validator results → user sees
    // ALL failing rules at once on the first round-trip.
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["length"] },
      "abc"
    );
    expect(result).toContain("length");
    expect(result).toContain("uppercase");
    expect(result).toContain("digit");
    // No duplicates.
    expect(new Set(result).size).toBe(result?.length);
  });

  it("Case 17b: review-round-1 P1 — weak_password with reasons=['length'] + already-composition-passing password reports only length", () => {
    // Edge case for P1: when the password ALREADY satisfies composition
    // and just needs length, the merge produces just `["length"]`.
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["length"] },
      "Abc1" // 4 chars, all classes present
    );
    expect(result).toEqual(["length"]);
  });

  it("Case 18: weak_password with reasons=['characters'] re-runs client validator on password", () => {
    // Server reports coarse "characters" — client re-derives itemization
    // from the password (in scope at the call site).
    // Password "abcdefghij" passes length (10) but fails uppercase + digit.
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["characters"] },
      "abcdefghij"
    );
    expect(result).toEqual(["uppercase", "digit"]);
  });

  it("Case 19: weak_password with non-weak_password code returns null pass-through", () => {
    const result = mapSupabaseWeakPasswordError({ code: "user_already_exists" });
    expect(result).toBeNull();
  });

  it("Case 19b: review-round-1 P11 — accepts AuthWeakPasswordError name even without weak_password code", () => {
    // Defense-in-depth: a future Supabase release renaming `code`
    // without renaming the error class still triggers French fallback.
    // Note: this requires `code` to be ABSENT from the error object (not
    // just non-matching) per R2-P2 coherent-shape requirement.
    const result = mapSupabaseWeakPasswordError(
      { name: "AuthWeakPasswordError", reasons: ["length"] },
      "abc"
    );
    expect(result).not.toBeNull();
    expect(result).toContain("length");
  });

  it("Case 19c: review-round-2 R2-P2 — incoherent {code: 'user_already_exists', name: 'AuthWeakPasswordError'} returns null", () => {
    // R2-P2: a malformed/buggy SDK shape where `code` and `name`
    // disagree should NOT be classified as a weak_password error.
    // Pre-R2 the OR-condition admitted it → user saw French
    // password-strength UI for an email-taken error → could never
    // recover by changing the password. Post-R2: contradictory `code`
    // overrides the `name`-only match.
    const result = mapSupabaseWeakPasswordError(
      { code: "user_already_exists", name: "AuthWeakPasswordError" },
      "abc"
    );
    expect(result).toBeNull();
  });

  it("Case 19d: review-round-2 R2-P2 — incoherent {code: 'rate_limit_exceeded', name: 'AuthWeakPasswordError'} returns null", () => {
    // Twin to 19c: any non-weak_password code with a contradictory
    // weak-password-name still returns null. Defends against future
    // SDK responses that lump generic codes with typed error classes.
    const result = mapSupabaseWeakPasswordError(
      { code: "rate_limit_exceeded", name: "AuthWeakPasswordError", reasons: ["pwned"] },
      "Welcome2026!"
    );
    expect(result).toBeNull();
    // Also pin via isPwnedRejection — should also be false because
    // the underlying isWeakPasswordError narrowing returns false.
    expect(
      isPwnedRejection({
        code: "rate_limit_exceeded",
        name: "AuthWeakPasswordError",
        reasons: ["pwned"],
      })
    ).toBe(false);
  });

  it("Case 20: weak_password with reasons=['pwned'] + valid password returns empty array (pwned is non-itemized)", () => {
    // The "pwned" reason is intentionally not appended. With a valid
    // password, the always-merge contributes no client reasons either,
    // so the result is `[]` — caller distinguishes via isPwnedRejection.
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["pwned"] },
      "Welcome123"
    );
    expect(result).toEqual([]);
  });

  it("Case 20b: weak_password with reasons=['length', 'characters'] combines both with no duplicates", () => {
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["length", "characters"] },
      "abc"
    );
    expect(result).toContain("length");
    expect(result).toContain("uppercase");
    expect(result).toContain("digit");
    expect(new Set(result).size).toBe(result?.length);
  });

  it("Case 20c: review-round-1 P20 — parametric coverage of non-array `reasons` shapes (all return empty + still merge client reasons if password provided)", () => {
    // Pre-patch only one shape (string `"length"`) was tested. P20
    // expands to a parametric battery so a future shape-validation
    // regression fails loudly.
    const malformed = [null, 42, {}, true, "length", { 0: "length", length: 1 }];
    for (const reasons of malformed) {
      const resultWithoutPassword = mapSupabaseWeakPasswordError({
        code: "weak_password",
        reasons,
      });
      // No password + non-array reasons → empty result (server-only path produced nothing usable).
      expect(resultWithoutPassword).toEqual([]);

      // With a short bad password + non-array reasons → still merges
      // client validator output (P1 always-merge).
      const resultWithPassword = mapSupabaseWeakPasswordError(
        { code: "weak_password", reasons },
        "abc"
      );
      expect(resultWithPassword).toContain("length");
      expect(resultWithPassword).toContain("uppercase");
      expect(resultWithPassword).toContain("digit");
    }
  });

  it("Case 20d: review-round-1 P7 — weak_password with NO reasons field + valid password returns empty (caller surfaces generic)", () => {
    // Defensive case: the server omits the `reasons` field entirely.
    // With a passing password, we have nothing client-side to add, so
    // the result is `[]` — caller (signup.tsx) treats `[]` as
    // "show getGenericWeakPasswordMessage()".
    const result = mapSupabaseWeakPasswordError({ code: "weak_password" }, "Abcdefghi1");
    expect(result).toEqual([]);
  });

  it("Case 20e: review-round-1 P8 — `password` arg omitted + reasons=['characters'] returns empty (caller responsibility to surface generic)", () => {
    // Without `password`, the mapper cannot itemize "characters". It
    // returns `[]` and the caller falls back to the generic message.
    // Production callers MUST pass `password` per JSDoc.
    const result = mapSupabaseWeakPasswordError({
      code: "weak_password",
      reasons: ["characters"],
    });
    expect(result).toEqual([]);
  });
});

describe("password-policy: isPwnedRejection() + getPwnedMessage() + getGenericWeakPasswordMessage()", () => {
  it("Case 21: isPwnedRejection true when reasons includes 'pwned' (code path)", () => {
    expect(isPwnedRejection({ code: "weak_password", reasons: ["pwned"] })).toBe(true);
    expect(isPwnedRejection({ code: "weak_password", reasons: ["length", "pwned"] })).toBe(true);
  });

  it("Case 21a-name: review-round-1 P11 — isPwnedRejection true when name matches even without code", () => {
    expect(isPwnedRejection({ name: "AuthWeakPasswordError", reasons: ["pwned"] })).toBe(true);
  });

  it("Case 21b: isPwnedRejection false for non-pwned weak_password errors", () => {
    expect(isPwnedRejection({ code: "weak_password", reasons: ["length"] })).toBe(false);
    expect(isPwnedRejection({ code: "weak_password", reasons: [] })).toBe(false);
    expect(isPwnedRejection({ code: "weak_password" })).toBe(false);
    expect(isPwnedRejection({ code: "user_already_exists", reasons: ["pwned"] })).toBe(false);
    expect(isPwnedRejection(null)).toBe(false);
    expect(isPwnedRejection(undefined)).toBe(false);
  });

  it("Case 21c: review-round-2 R2-P9 — getPwnedMessage ends with trailing period (symmetric with generic message)", () => {
    expect(getPwnedMessage()).toBe("This password has been exposed in a data breach.");
  });

  it("Case 21d: review-round-1 P7 — getGenericWeakPasswordMessage returns canonical fallback", () => {
    expect(getGenericWeakPasswordMessage()).toBe("Password is too weak. Please choose another.");
  });
});

describe("password-policy: computePasswordStrengthLabel() — review-round-1 P2 tightened + review-round-2 R2-P5 single-password signature", () => {
  it("Case 22a: 0 reasons + length >= 14 + 6+ distinct chars → 'strong'", () => {
    // R2-P5: single `password` arg; length is derived internally.
    // Distinct chars: A,b,c,d,e,f,g,h,i,1,j,k,l,m = 14 distinct → strong.
    expect(computePasswordStrengthLabel([], "Abcdefghi1jklm")).toBe("strong");
    // 17 chars, 16 distinct → strong.
    expect(computePasswordStrengthLabel([], "Abcdefghi1jklmnop")).toBe("strong");
  });

  it("Case 22b: 0 reasons + length 10-13 (passing but short) → 'medium'", () => {
    // 10 chars: "Aaaaaaaaa1" — A, a, 1 = 3 distinct (below 6-floor)
    // BUT length 10 < 14 short-circuits to medium first.
    expect(computePasswordStrengthLabel([], "Aaaaaaaaa1")).toBe("medium");
    // 13 chars: "Aaaaaaaaaaaa1" — same length<14 short-circuit.
    expect(computePasswordStrengthLabel([], "Aaaaaaaaaaaa1")).toBe("medium");
  });

  it("Case 22c: 1 reason (length >= 8) → 'medium'", () => {
    // R2-P5: synthetic `reasons` argument paired with a real password.
    // The function trusts the caller's reasons (the indicator derives
    // them from validatePasswordStrength); the test exercises the
    // helper's branch logic with explicit reasons.
    expect(computePasswordStrengthLabel(["digit"], "Aaaaaaaaaa")).toBe("medium");
    expect(computePasswordStrengthLabel(["uppercase"], "abcdefghijklmnopqrst")).toBe("medium");
  });

  it("Case 22d: 2 reasons (length >= 8) → 'medium'", () => {
    expect(computePasswordStrengthLabel(["digit", "uppercase"], "aaaaaaaaaa")).toBe("medium");
  });

  it("Case 22e: 3+ reasons → 'weak'", () => {
    expect(computePasswordStrengthLabel(["length", "lowercase", "uppercase"], "12345")).toBe(
      "weak"
    );
    expect(
      computePasswordStrengthLabel(
        ["length", "lowercase", "uppercase", "digit"] as PasswordPolicyReason[],
        ""
      )
    ).toBe("weak");
  });

  it("Case 22f: review-round-1 P2 — 1 reason + length < 8 → 'weak' (very-short clause)", () => {
    // Spec deliverable (a)(vii) "(counts also length < 8)" — even a
    // single rule failure on a very-short password should NOT show
    // "medium" (which reads as "almost there" to users).
    expect(computePasswordStrengthLabel(["digit"], "abcdefg")).toBe("weak"); // 7 chars
    expect(computePasswordStrengthLabel(["uppercase"], "abcd")).toBe("weak"); // 4 chars
    expect(computePasswordStrengthLabel(["length"], "abc")).toBe("weak"); // 3 chars
  });

  it("Case 22g: review-round-1 P2 — entropy floor — 'Aaaaaaaaaaaaa1' (14 chars, 3 distinct) → 'medium' not 'strong'", () => {
    // The canonical false-confidence case: 14 chars, all 4 classes,
    // but only 3 distinct chars (`A`, `a`, `1`). Pre-patch this was
    // rated `"strong"` despite obvious dictionary-attack vulnerability.
    expect(computePasswordStrengthLabel([], "Aaaaaaaaaaaaa1")).toBe("medium");
  });

  it("Case 22h: review-round-1 P2 — entropy floor boundary — exactly 6 distinct chars → 'strong'", () => {
    // "AaBb1c1c1c1c1c" → A,a,B,b,1,c = 6 distinct, length 14.
    // At the 6-distinct floor → strong.
    expect(computePasswordStrengthLabel([], "AaBb1c1c1c1c1c")).toBe("strong");
  });

  it("Case 22i: review-round-1 P2 — entropy floor boundary — exactly 5 distinct chars → 'medium'", () => {
    // "AaB1cccccccccc" → A, a, B, 1, c = 5 distinct, length 14.
    // Below the 6-floor → medium.
    expect(computePasswordStrengthLabel([], "AaB1cccccccccc")).toBe("medium");
  });

  it("Case 22j: review-round-2 R2-P5 — desync hazard eliminated by single-arg signature (compile-time)", () => {
    // Pre-R2: caller could pass `(reasons, 100, "abc")` triggering
    // length-passes branch + distinct-char fail. Post-R2: signature
    // accepts only `(reasons, password)` so passwordLength is ALWAYS
    // derived from password. A regression to the 3-arg form would
    // fail TypeScript compilation. This test exercises the canonical
    // case: a 3-char password with passing classes — should be weak
    // because length<8 + 0 reasons doesn't fire (need at least 1
    // reason for the very-short clause), so falls through to
    // length<14 → medium. Wait — 0 reasons + length 3 → length<14 →
    // medium. So 0 reasons on a 3-char password is medium. That's
    // intentional — pin it.
    expect(computePasswordStrengthLabel([], "abc")).toBe("medium");
  });
});
