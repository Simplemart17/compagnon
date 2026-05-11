/**
 * Story 10-8 — `hashText` shared module tests.
 *
 * Pins the djb2 hash contract that Story 9-5's voice-transcript
 * fallback-key path and Story 10-8's exercise-dedup question-stem
 * path both depend on. A regression here would silently break
 * both consumers.
 */

import { hashText } from "../text-hash";

describe("hashText (Story 10-8 / Story 9-5 shared djb2)", () => {
  it("empty string returns the base-36 djb2 seed (5381)", () => {
    // djb2 initial seed = 5381 → base-36 = "44b"
    expect(hashText("")).toBe((5381).toString(36));
  });

  it("ASCII determinism — same input produces the same output across calls", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("hello world")).toBe(hashText("hello world"));
  });

  it("Unicode codepoint handling — diacritics produce a distinct hash from their ASCII fold", () => {
    expect(hashText("café")).not.toBe(hashText("cafe"));
  });

  it("surrogate-pair / emoji handling — emoji codepoints hash cleanly (no UTF-16 surrogates leak)", () => {
    const result = hashText("🎯");
    expect(result).toMatch(/^[0-9a-z]+$/);
    expect(result.length).toBeGreaterThan(0);
    // Emoji at the same codepoint should hash identically across calls
    expect(hashText("🎯")).toBe(result);
  });

  it("idempotence across 5 sample inputs", () => {
    const samples = [
      "Selon le texte, pourquoi le personnage principal est-il triste ?",
      "What is the capital of France?",
      "1234567890",
      "Bonjour ! Comment allez-vous ?",
      "🇫🇷 français",
    ];
    for (const s of samples) {
      const a = hashText(s);
      const b = hashText(s);
      expect(a).toBe(b);
    }
  });

  it("sentinel pin — `hashText('hello world')` is a stable base-36 string", () => {
    // Compute the literal expected value from the djb2 recurrence:
    //   h = 5381
    //   for ch in "hello world": h = ((h << 5) + h + cp) >>> 0
    // Run once at fixture-author-time, paste the literal here. Any
    // future change to the algorithm will break this assertion loudly.
    const result = hashText("hello world");
    // Verified: djb2("hello world") base-36 = "eslcxt" (894552257)
    // (calculated independently against a reference djb2 impl).
    expect(result).toBe("eslcxt");
    expect(result).toMatch(/^[0-9a-z]+$/);
  });

  it("distinct inputs produce distinct hashes — collision-resistance smoke", () => {
    const inputs = ["a", "b", "ab", "ba", "aa", "aaa", "1", "10", "01", "café"];
    const hashes = new Set(inputs.map(hashText));
    expect(hashes.size).toBe(inputs.length);
  });
});
