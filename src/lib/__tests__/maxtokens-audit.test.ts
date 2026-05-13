/**
 * Story 11-5 — maxTokens audit drift detector.
 *
 * Reads each AI-call-site file from disk and pins the post-11-5
 * right-sized maxTokens value via regex. Catches future regressions
 * where a maintainer reverts a value (e.g., back to 2048) without
 * thinking about the daily-cost-cap impact downstream.
 *
 * Drift detector pattern from Story 11-3 (`upstream-timeout-error.test.ts`)
 * and Story 11-4 (`cost-table.test.ts` / `rate-limit-db.test.ts`).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

function read(path: string): string {
  return readFileSync(resolve(__dirname, path), "utf-8");
}

describe("Story 11-5 maxTokens audit — drift detector", () => {
  it("openai.ts default dropped 2048 → 800 (sentinel surface for mis-sized calls)", () => {
    const src = read("../openai.ts");
    expect(src).toMatch(/maxTokens:\s*options\?\.maxTokens\s*\?\?\s*800/);
    // Negative guard: ensure the pre-11-5 value is no longer present in the
    // chatCompletion body.
    const chatBodyStart = src.indexOf("body: {");
    const chatBodyEnd = src.indexOf("});", chatBodyStart);
    const body = src.slice(chatBodyStart, chatBodyEnd);
    expect(body).not.toMatch(/maxTokens:\s*options\?\.maxTokens\s*\?\?\s*2048/);
  });

  it("translation-generation.ts generation call right-sized to 1200", () => {
    const src = read("../translation-generation.ts");
    // The file has both a generation and an evaluation call. Use a context
    // anchor (feature: "translation-generation") to pin the right one.
    const genIdx = src.indexOf('feature: "translation-generation"');
    expect(genIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, genIdx - 200), genIdx);
    expect(window).toMatch(/maxTokens:\s*1200/);
  });

  it("translation-generation.ts evaluation call right-sized to 800", () => {
    const src = read("../translation-generation.ts");
    const evalIdx = src.indexOf('feature: "translation-evaluation"');
    expect(evalIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, evalIdx - 200), evalIdx);
    expect(window).toMatch(/maxTokens:\s*800/);
  });

  it("echo-generation.ts right-sized to 1200", () => {
    const src = read("../echo-generation.ts");
    expect(src).toMatch(/maxTokens:\s*1200/);
    // Negative guard: pre-11-5 value gone.
    expect(src).not.toMatch(/maxTokens:\s*2048/);
  });

  it("speaking-evaluator.ts kept at 1024 (well-sized; not in scope for 11-5)", () => {
    const src = read("../speaking-evaluator.ts");
    expect(src).toMatch(/maxTokens:\s*1024/);
  });

  it("error-tracker.ts micro-drill kept at 1024 (well-sized; not in scope for 11-5)", () => {
    const src = read("../error-tracker.ts");
    const microDrillIdx = src.indexOf('feature: "error-tracker-micro-drill"');
    expect(microDrillIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, microDrillIdx - 200), microDrillIdx);
    expect(window).toMatch(/maxTokens:\s*1024/);
  });

  it("error-tracker.ts batch extractor kept at 1024 (still used by echo + translation flows; Realtime uses consolidated post-conv)", () => {
    const src = read("../error-tracker.ts");
    const batchIdx = src.indexOf('feature: "error-tracker-batch"');
    expect(batchIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, batchIdx - 200), batchIdx);
    expect(window).toMatch(/maxTokens:\s*1024/);
  });

  it("post-conversation-analysis.ts (consolidated module) uses maxTokens=1500", () => {
    const src = read("../post-conversation-analysis.ts");
    expect(src).toMatch(/POST_CONVERSATION_ANALYSIS_MAX_TOKENS\s*=\s*1500/);
  });
});
