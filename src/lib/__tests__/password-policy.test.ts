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
 *       letters are NOT counted as lowercase / uppercase. Defends
 *       against a passing-on-client / failing-on-server UX trap.
 *   (d) Length boundary at exactly 10 (inclusive) passes; 9 fails. Pins
 *       the `< MIN_PASSWORD_LENGTH` strict-less-than semantics.
 *   (e) `mapSupabaseWeakPasswordError` round-trip from server's coarse
 *       `"characters"` to client's itemized list (excluding `"length"`
 *       which the server reports separately).
 *   (f) `isPwnedRejection` discriminates `"pwned"` reasons; non-pwned
 *       weak_password errors return `false`.
 *   (g) `computePasswordStrengthLabel` thresholds: 3+ reasons → weak,
 *       1-2 → medium, 0 with length<14 → medium, 0 with length≥14 →
 *       strong.
 */

import {
  MIN_PASSWORD_LENGTH,
  computePasswordStrengthLabel,
  getPwnedFrenchMessage,
  isPwnedRejection,
  mapSupabaseWeakPasswordError,
  passwordPolicyReasonToFrenchMessage,
  validatePasswordStrength,
  type PasswordPolicyReason,
} from "../password-policy";

describe("password-policy: MIN_PASSWORD_LENGTH constant pin", () => {
  it("Case 1: MIN_PASSWORD_LENGTH equals 10 (drift-catches edits to 6/8)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
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
});

describe("password-policy: passwordPolicyReasonToFrenchMessage()", () => {
  it("Case 12: 'length' → 'Au moins 10 caractères' (canonical)", () => {
    expect(passwordPolicyReasonToFrenchMessage("length")).toBe("Au moins 10 caractères");
  });

  it("Case 13: 'lowercase' → 'Au moins une minuscule' (canonical)", () => {
    expect(passwordPolicyReasonToFrenchMessage("lowercase")).toBe("Au moins une minuscule");
  });

  it("Case 14: 'uppercase' → 'Au moins une majuscule' (canonical)", () => {
    expect(passwordPolicyReasonToFrenchMessage("uppercase")).toBe("Au moins une majuscule");
  });

  it("Case 15: 'digit' → 'Au moins un chiffre' (canonical)", () => {
    expect(passwordPolicyReasonToFrenchMessage("digit")).toBe("Au moins un chiffre");
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

  it("Case 17: weak_password with reasons=['length'] returns ['length']", () => {
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["length"] },
      "abc"
    );
    expect(result).toEqual(["length"]);
  });

  it("Case 18: weak_password with reasons=['characters'] re-runs client validator on password", () => {
    // Server reports coarse "characters" — client re-derives itemization
    // from the password (in scope at the call site).
    // Password "abcdefghij" passes length (10) but fails uppercase + digit.
    // The server reported "characters" generically; the mapper expands it.
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["characters"] },
      "abcdefghij"
    );
    expect(result).toEqual(["uppercase", "digit"]);
  });

  it("Case 19: weak_password with non-weak_password code returns null pass-through", () => {
    // Already covered partially in Case 16; this is the explicit
    // weak_password-vs-other-codes discriminator.
    const result = mapSupabaseWeakPasswordError({ code: "user_already_exists" });
    expect(result).toBeNull();
  });

  it("Case 20: weak_password with reasons=['pwned'] returns empty array (pwned is non-itemized)", () => {
    // The "pwned" reason is intentionally not appended to PasswordPolicyReason[].
    // Callers handle pwned via isPwnedRejection + getPwnedFrenchMessage.
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["pwned"] },
      "Welcome123"
    );
    expect(result).toEqual([]);
  });

  it("Case 20b: weak_password with reasons=['length', 'characters'] combines both", () => {
    const result = mapSupabaseWeakPasswordError(
      { code: "weak_password", reasons: ["length", "characters"] },
      "abc"
    );
    expect(result).toContain("length");
    expect(result).toContain("uppercase");
    expect(result).toContain("digit");
    // No duplicates.
    expect(new Set(result).size).toBe(result?.length);
  });

  it("Case 20c: weak_password with non-array reasons returns empty array", () => {
    const result = mapSupabaseWeakPasswordError({
      code: "weak_password",
      reasons: "length",
    });
    expect(result).toEqual([]);
  });
});

describe("password-policy: isPwnedRejection() + getPwnedFrenchMessage()", () => {
  it("Case 21: isPwnedRejection true when reasons includes 'pwned'", () => {
    expect(isPwnedRejection({ code: "weak_password", reasons: ["pwned"] })).toBe(true);
    expect(isPwnedRejection({ code: "weak_password", reasons: ["length", "pwned"] })).toBe(true);
  });

  it("Case 21b: isPwnedRejection false for non-pwned weak_password errors", () => {
    expect(isPwnedRejection({ code: "weak_password", reasons: ["length"] })).toBe(false);
    expect(isPwnedRejection({ code: "weak_password", reasons: [] })).toBe(false);
    expect(isPwnedRejection({ code: "weak_password" })).toBe(false);
    expect(isPwnedRejection({ code: "user_already_exists", reasons: ["pwned"] })).toBe(false);
    expect(isPwnedRejection(null)).toBe(false);
    expect(isPwnedRejection(undefined)).toBe(false);
  });

  it("Case 21c: getPwnedFrenchMessage returns canonical French copy", () => {
    expect(getPwnedFrenchMessage()).toBe(
      "Ce mot de passe a été divulgué dans une fuite de données"
    );
  });
});

describe("password-policy: computePasswordStrengthLabel()", () => {
  it("Case 22a: 0 reasons + length >= 14 → 'strong'", () => {
    expect(computePasswordStrengthLabel([], 14)).toBe("strong");
    expect(computePasswordStrengthLabel([], 100)).toBe("strong");
  });

  it("Case 22b: 0 reasons + length 10 (passing but short) → 'medium'", () => {
    expect(computePasswordStrengthLabel([], 10)).toBe("medium");
    expect(computePasswordStrengthLabel([], 13)).toBe("medium");
  });

  it("Case 22c: 1 reason → 'medium' regardless of length", () => {
    expect(computePasswordStrengthLabel(["digit"], 10)).toBe("medium");
    expect(computePasswordStrengthLabel(["uppercase"], 20)).toBe("medium");
  });

  it("Case 22d: 2 reasons → 'medium'", () => {
    expect(computePasswordStrengthLabel(["digit", "uppercase"], 10)).toBe("medium");
  });

  it("Case 22e: 3+ reasons → 'weak'", () => {
    expect(computePasswordStrengthLabel(["length", "lowercase", "uppercase"], 5)).toBe("weak");
    expect(
      computePasswordStrengthLabel(
        ["length", "lowercase", "uppercase", "digit"] as PasswordPolicyReason[],
        0
      )
    ).toBe("weak");
  });
});
