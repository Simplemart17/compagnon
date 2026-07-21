/**
 * Curated exercise item-bank schema — Story 19-4.
 *
 * Instead of generating lesson-drill questions live via the AI on every
 * round (Story 19-2 slice 2), each curriculum lesson can ship a bank of
 * pre-authored, human-reviewed MCQ items. The drill serves from the bank
 * (instant, zero AI cost, zero repetition) and falls back to live
 * generation only for lessons that have no bank yet.
 *
 * One content FILE = one lesson's bank (`src/content/item-banks/<lessonId>.json`).
 * Items reuse the exact `mcqQuestionSchema` the live drill produces, so the
 * runtime consumes bank items and generated items through one shape.
 */

import { z } from "zod";

import { mcqQuestionSchema } from "@/src/lib/schemas/ai-responses";

/**
 * Normalized key for stem-dedup (mirrors the curriculum `normalizeVocabKey`
 * discipline): NFKC + curly→straight apostrophe fold + whitespace collapse +
 * lowercase, so two items whose stems differ only in casing/spacing/quote
 * style are caught as duplicates.
 */
export function normalizeStemKey(stem: string): string {
  return stem.replace(/’/g, "'").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Lower bound so a 3-question drill has ≥2 rounds of fresh items before it
 * wraps; upper bound keeps a hand-authored bank reviewable. */
export const MIN_BANK_ITEMS = 6;
export const MAX_BANK_ITEMS = 30;

export const itemBankFileSchema = z
  .object({
    /** Bump on a breaking bank-shape change; the loader gates on versions it knows. */
    bankVersion: z.literal(1),
    /** The curriculum lesson this bank drills (e.g. "a1-u1-l1"). */
    lessonId: z.string().regex(/^[a-c][12]-u\d+-l\d+$/, "lessonId must look like a1-u1-l1"),
    items: z.array(mcqQuestionSchema).min(MIN_BANK_ITEMS).max(MAX_BANK_ITEMS),
  })
  .superRefine((bank, ctx) => {
    // No two items may share the same (normalized) stem — a duplicate stem
    // wastes a slot and lets the same question recur within one drill round.
    const seen = new Map<string, number>();
    bank.items.forEach((item, i) => {
      const key = normalizeStemKey(item.question);
      const firstAt = seen.get(key);
      if (firstAt !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate item stem "${item.question}" (also item ${firstAt})`,
          path: ["items", i, "question"],
        });
      } else {
        seen.set(key, i);
      }
    });
  });

export type ItemBankFile = z.infer<typeof itemBankFileSchema>;
export type DrillItem = z.infer<typeof mcqQuestionSchema>;
