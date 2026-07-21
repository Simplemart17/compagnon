/**
 * Curated item-bank registry + drill selection — Story 19-4.
 *
 * Bank files are statically imported (Metro bundles JSON; no runtime I/O,
 * works offline) and validated ONCE at module init — a malformed file
 * throws at import time in dev/test, and the CI content test fails before
 * that can ever ship (same throw-loud contract as the curriculum spine).
 *
 * The drill (`use-lesson-drill`) prefers the bank: a lesson WITH a bank
 * serves pre-authored items instantly (zero AI cost, zero repetition);
 * a lesson WITHOUT one falls back to live AI generation. As banks are
 * authored per lesson, the curriculum path shifts off live generation
 * incrementally with no engine change.
 */

import a1u1l1 from "@/src/content/item-banks/a1-u1-l1.json";
import a1u1l2 from "@/src/content/item-banks/a1-u1-l2.json";
import a1u1l3 from "@/src/content/item-banks/a1-u1-l3.json";
import a1u1l4 from "@/src/content/item-banks/a1-u1-l4.json";
import a1u1l5 from "@/src/content/item-banks/a1-u1-l5.json";
import { type DrillItem, type ItemBankFile, itemBankFileSchema } from "@/src/lib/schemas/item-bank";

function parseBankFile(raw: unknown, sourceName: string): ItemBankFile {
  const result = itemBankFileSchema.safeParse(raw);
  if (!result.success) {
    // Content is in-repo — a parse failure is a BUILD defect, not a runtime
    // condition to degrade around. Fail loudly (curriculum.ts precedent).
    throw new Error(`Item-bank file ${sourceName} failed validation: ${result.error.message}`);
  }
  // File name must equal the lessonId so the registry stays greppable against
  // the directory and a misfiled bank can't silently drill the wrong lesson.
  if (`${result.data.lessonId}.json` !== sourceName) {
    throw new Error(
      `Item-bank file ${sourceName} has mismatched lessonId "${result.data.lessonId}"`
    );
  }
  return result.data;
}

/** All shipped item banks, keyed by lessonId. */
export const ITEM_BANKS: ReadonlyMap<string, ItemBankFile> = new Map(
  [
    parseBankFile(a1u1l1, "a1-u1-l1.json"),
    parseBankFile(a1u1l2, "a1-u1-l2.json"),
    parseBankFile(a1u1l3, "a1-u1-l3.json"),
    parseBankFile(a1u1l4, "a1-u1-l4.json"),
    parseBankFile(a1u1l5, "a1-u1-l5.json"),
  ].map((bank) => [bank.lessonId, bank])
);

/** The curated bank for a lesson, or undefined when none is shipped (→ the
 * drill falls back to live AI generation). */
export function getItemBank(lessonId: string): ItemBankFile | undefined {
  return ITEM_BANKS.get(lessonId);
}

/** True when a lesson has a curated bank (drill serves from it, no AI call). */
export function hasItemBank(lessonId: string): boolean {
  return ITEM_BANKS.has(lessonId);
}

/**
 * Pick `count` drill items from a bank for round `round` (0-indexed) — a
 * rotating contiguous window so successive rounds ("New round") show fresh
 * items before the bank cycles. PURE + deterministic given (items, count,
 * round). No intra-round duplicate while `count < items.length` (the window
 * is a contiguous slice of the ring); when `count >= items.length` the whole
 * bank is returned.
 */
export function selectDrillItems(
  items: readonly DrillItem[],
  count: number,
  round: number
): DrillItem[] {
  if (count >= items.length) return [...items];
  const safeRound = Number.isFinite(round) && round > 0 ? Math.floor(round) : 0;
  const start = (safeRound * count) % items.length;
  const out: DrillItem[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[(start + i) % items.length]);
  }
  return out;
}
