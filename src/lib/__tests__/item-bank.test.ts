/**
 * Story 19-4 — item-bank registry (getItemBank/hasItemBank) + the pure
 * rotating drill selector (selectDrillItems).
 */

import { getItemBank, hasItemBank, ITEM_BANKS, selectDrillItems } from "@/src/lib/item-bank";
import type { DrillItem } from "@/src/lib/schemas/item-bank";

function mkItem(n: number): DrillItem {
  return {
    question: `Q${n} ___ ?`,
    options: [
      { id: "a", text: "a", isCorrect: n % 4 === 0 },
      { id: "b", text: "b", isCorrect: n % 4 === 1 },
      { id: "c", text: "c", isCorrect: n % 4 === 2 },
      { id: "d", text: "d", isCorrect: n % 4 === 3 },
    ],
    explanation: `because ${n}`,
  };
}

const NINE = Array.from({ length: 9 }, (_, i) => mkItem(i));

describe("Story 19-4 — item-bank registry", () => {
  it("ships A1 Unit 1 banks and resolves them by lessonId", () => {
    for (const id of ["a1-u1-l1", "a1-u1-l2", "a1-u1-l3", "a1-u1-l4", "a1-u1-l5"]) {
      expect(hasItemBank(id)).toBe(true);
      expect(getItemBank(id)?.lessonId).toBe(id);
    }
  });

  it("returns undefined / false for a lesson without a bank", () => {
    expect(getItemBank("a2-u1-l1")).toBeUndefined();
    expect(hasItemBank("a2-u1-l1")).toBe(false);
    expect(getItemBank("zz-u9-l9")).toBeUndefined();
  });

  it("every shipped bank's items obey the drill contract (4 options, 1 correct, unique ids)", () => {
    for (const [, bank] of ITEM_BANKS) {
      for (const q of bank.items) {
        expect(q.options).toHaveLength(4);
        expect(q.options.filter((o) => o.isCorrect)).toHaveLength(1);
        expect(new Set(q.options.map((o) => o.id)).size).toBe(4);
      }
    }
  });
});

describe("Story 19-4 — selectDrillItems (pure, rotating)", () => {
  it("returns `count` items", () => {
    expect(selectDrillItems(NINE, 3, 0)).toHaveLength(3);
  });

  it("round 0/1/2 walk disjoint contiguous windows", () => {
    expect(selectDrillItems(NINE, 3, 0).map((i) => i.question)).toEqual([
      "Q0 ___ ?",
      "Q1 ___ ?",
      "Q2 ___ ?",
    ]);
    expect(selectDrillItems(NINE, 3, 1).map((i) => i.question)).toEqual([
      "Q3 ___ ?",
      "Q4 ___ ?",
      "Q5 ___ ?",
    ]);
    expect(selectDrillItems(NINE, 3, 2).map((i) => i.question)).toEqual([
      "Q6 ___ ?",
      "Q7 ___ ?",
      "Q8 ___ ?",
    ]);
  });

  it("wraps around after the bank cycles (round 3 → back to the start)", () => {
    expect(selectDrillItems(NINE, 3, 3).map((i) => i.question)).toEqual(
      selectDrillItems(NINE, 3, 0).map((i) => i.question)
    );
  });

  it("never repeats an item WITHIN a round, even when the window wraps", () => {
    const eight = Array.from({ length: 8 }, (_, i) => mkItem(i));
    // round 2 → start (2*3)%8 = 6 → items 6,7,0 (wraps) — all distinct
    const picked = selectDrillItems(eight, 3, 2).map((i) => i.question);
    expect(new Set(picked).size).toBe(3);
  });

  it("returns the whole bank (no dup) when count >= bank size", () => {
    expect(selectDrillItems(NINE.slice(0, 3), 3, 5)).toHaveLength(3);
    expect(selectDrillItems(NINE.slice(0, 2), 3, 0)).toHaveLength(2);
  });

  it("is deterministic and pure (input unmutated; same args → same result)", () => {
    const snapshot = NINE.map((i) => i.question);
    const a = selectDrillItems(NINE, 3, 1);
    const b = selectDrillItems(NINE, 3, 1);
    expect(a.map((i) => i.question)).toEqual(b.map((i) => i.question));
    expect(NINE.map((i) => i.question)).toEqual(snapshot);
  });

  it("clamps a negative / NaN round to 0 (defensive)", () => {
    expect(selectDrillItems(NINE, 3, -5).map((i) => i.question)).toEqual(
      selectDrillItems(NINE, 3, 0).map((i) => i.question)
    );
    expect(selectDrillItems(NINE, 3, NaN).map((i) => i.question)).toEqual(
      selectDrillItems(NINE, 3, 0).map((i) => i.question)
    );
  });
});
