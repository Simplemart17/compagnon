/**
 * Story 19-4 — item-bank schema rejection matrix + stem-dedup normalizer.
 */

import {
  itemBankFileSchema,
  MAX_BANK_ITEMS,
  MIN_BANK_ITEMS,
  normalizeStemKey,
} from "@/src/lib/schemas/item-bank";

function item(question: string, correctId = "b") {
  return {
    question,
    options: [
      { id: "a", text: "suis", isCorrect: correctId === "a" },
      { id: "b", text: "es", isCorrect: correctId === "b" },
      { id: "c", text: "est", isCorrect: correctId === "c" },
      { id: "d", text: "sont", isCorrect: correctId === "d" },
    ],
    explanation: "With je, être is suis.",
  };
}

function bank(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { bankVersion: 1, lessonId: "a1-u1-l1", items, ...overrides };
}

// Distinct stems so the base fixture is always dedup-clean.
const validItems = Array.from({ length: MIN_BANK_ITEMS }, (_, i) =>
  item(`Je ___ Marie numéro ${i}.`)
);

describe("Story 19-4 — itemBankFileSchema", () => {
  it("accepts a well-formed bank (min items, distinct stems, 1 correct each)", () => {
    expect(itemBankFileSchema.safeParse(bank(validItems)).success).toBe(true);
  });

  it("accepts up to MAX_BANK_ITEMS", () => {
    const many = Array.from({ length: MAX_BANK_ITEMS }, (_, i) => item(`Stem ${i} ___ ?`));
    expect(itemBankFileSchema.safeParse(bank(many)).success).toBe(true);
  });

  it("rejects a bankVersion other than 1 (the loader gates on known versions)", () => {
    expect(itemBankFileSchema.safeParse(bank(validItems, { bankVersion: 2 })).success).toBe(false);
  });

  it("rejects fewer than MIN_BANK_ITEMS (too few for round variety)", () => {
    expect(
      itemBankFileSchema.safeParse(bank(validItems.slice(0, MIN_BANK_ITEMS - 1))).success
    ).toBe(false);
  });

  it("rejects more than MAX_BANK_ITEMS (keeps a hand-authored bank reviewable)", () => {
    const tooMany = Array.from({ length: MAX_BANK_ITEMS + 1 }, (_, i) => item(`Over ${i} ___ ?`));
    expect(itemBankFileSchema.safeParse(bank(tooMany)).success).toBe(false);
  });

  it("rejects a malformed lessonId", () => {
    expect(itemBankFileSchema.safeParse(bank(validItems, { lessonId: "lesson-1" })).success).toBe(
      false
    );
    expect(itemBankFileSchema.safeParse(bank(validItems, { lessonId: "a1-u1" })).success).toBe(
      false
    );
  });

  it("rejects duplicate item stems (normalized) within a bank", () => {
    const dup = [...validItems, item(`  ${validItems[0].question.toUpperCase()}  `)];
    const result = itemBankFileSchema.safeParse(bank(dup));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((iss) => /Duplicate item stem/.test(iss.message))).toBe(true);
    }
  });

  it("inherits mcqQuestionSchema invariants: rejects not-exactly-4-options and not-exactly-1-correct", () => {
    const threeOptions = { ...item("Trois ___ ?"), options: item("x").options.slice(0, 3) };
    expect(itemBankFileSchema.safeParse(bank([threeOptions, ...validItems])).success).toBe(false);

    const twoCorrect = {
      ...item("Deux ___ ?"),
      options: [
        { id: "a", text: "x", isCorrect: true },
        { id: "b", text: "y", isCorrect: true },
        { id: "c", text: "z", isCorrect: false },
        { id: "d", text: "w", isCorrect: false },
      ],
    };
    expect(itemBankFileSchema.safeParse(bank([twoCorrect, ...validItems])).success).toBe(false);
  });
});

describe("Story 19-4 — normalizeStemKey", () => {
  it("folds case, whitespace, and curly apostrophes so near-duplicate stems collide", () => {
    expect(normalizeStemKey("  J’ai   FAIM ?  ")).toBe(normalizeStemKey("j'ai faim ?"));
  });

  it("keeps genuinely different stems distinct", () => {
    expect(normalizeStemKey("Je suis ___.")).not.toBe(normalizeStemKey("Tu es ___."));
  });
});
