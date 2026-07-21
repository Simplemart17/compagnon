/**
 * Story 19-4 — item-bank content-integrity CI gate (mirrors the curriculum
 * directory-walk). Every JSON under src/content/item-banks/ must parse
 * against the schema, its filename must equal its lessonId, that lessonId
 * must be a REAL curriculum lesson, and it must be registered in ITEM_BANKS
 * (an authored-but-unregistered bank is silent content loss).
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { getLesson } from "@/src/lib/curriculum";
import { ITEM_BANKS } from "@/src/lib/item-bank";
import { itemBankFileSchema } from "@/src/lib/schemas/item-bank";

const BANK_DIR = join(__dirname, "../../content/item-banks");

describe("Story 19-4 — item-bank content integrity (CI gate)", () => {
  const files = readdirSync(BANK_DIR).filter((f) => f.endsWith(".json"));

  it("at least one item bank ships", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses against itemBankFileSchema + filename === lessonId", (file) => {
    const raw = JSON.parse(readFileSync(join(BANK_DIR, file), "utf8"));
    const result = itemBankFileSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`${file}: ${result.error.message}`);
    }
    expect(file).toBe(`${result.data.lessonId}.json`);
  });

  it.each(files)("%s targets a REAL curriculum lesson", (file) => {
    const raw = JSON.parse(readFileSync(join(BANK_DIR, file), "utf8"));
    const lessonId = raw.lessonId as string;
    expect(getLesson(lessonId)?.id).toBe(lessonId);
  });

  it("every bank file is registered in ITEM_BANKS (no silent content loss)", () => {
    const registered = [...ITEM_BANKS.keys()].sort();
    const onDisk = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(registered).toEqual(onDisk);
  });
});

describe("Story 19-4 — the drill prefers the bank (source-drift)", () => {
  // Comment-stripped read (Story 12-2 P12) so JSDoc mentioning the AI path
  // doesn't trip the pins.
  const hook = readFileSync(join(__dirname, "../../hooks/use-lesson-drill.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("imports the bank loader + rotating selector", () => {
    expect(hook).toMatch(/getItemBank\b/);
    expect(hook).toMatch(/selectDrillItems\b/);
  });

  it("the bank-first branch returns BEFORE the live-AI generation (no chatCompletionJSON on the bank path)", () => {
    const bankIdx = hook.indexOf("getItemBank(lesson.id)");
    // The CALL site (with open paren), not the top-of-file import.
    const aiCallIdx = hook.indexOf("chatCompletionJSON(", bankIdx);
    expect(bankIdx).toBeGreaterThan(-1);
    expect(aiCallIdx).toBeGreaterThan(bankIdx);
    // The bank branch selects items + returns before the AI call is reached.
    const bankBranch = hook.slice(bankIdx, aiCallIdx);
    expect(bankBranch).toMatch(/selectDrillItems\(/);
    expect(bankBranch).toMatch(/return;/);
    expect(bankBranch).not.toMatch(/chatCompletionJSON\(/);
  });
});
