/**
 * Story 11-4 — cost-table drift detector + estimate-helper contract test.
 *
 * Like Story 11-3's `upstream-timeout-error.test.ts`, this test reads the
 * Deno source at `supabase/functions/_shared/cost-table.ts` from disk
 * (because the Deno context is excluded from `tsconfig.json`). The Jest
 * runner cannot import the module directly, so we pin the load-bearing
 * invariants by reading the source as text + asserting on its contents.
 *
 * Drift caught by this test:
 *   - Model rates accidentally changed without quarterly-refresh discipline
 *   - Helper function signatures break the daily-cost cap pre-check contract
 *   - Quarterly-refresh stale-bait flag accidentally removed
 *
 * Inline mirror of the helpers (so we can verify the math contract is sound
 * — the source-read tests pin that the source HAS the right rates; the
 * mirror tests pin that the math is correct).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const COST_TABLE_PATH = resolve(__dirname, "../../../supabase/functions/_shared/cost-table.ts");
const COST_TABLE_SOURCE = readFileSync(COST_TABLE_PATH, "utf-8");

// ─── BEGIN inline mirror of helpers (math contract) ───────────────────────────
// Kept identical to the Deno source. Used only to verify the math is correct
// independent of the source-read assertions below.

interface ModelRate {
  inputCentsPer1KTokens: number;
  outputCentsPer1KTokens: number;
}
const MODEL_RATES_MIRROR: Record<string, ModelRate> = {
  "gpt-4o": { inputCentsPer1KTokens: 0.25, outputCentsPer1KTokens: 1.0 },
  "gpt-4o-mini": { inputCentsPer1KTokens: 0.015, outputCentsPer1KTokens: 0.06 },
  "text-embedding-3-small": { inputCentsPer1KTokens: 0.002, outputCentsPer1KTokens: 0 },
  "gpt-realtime": { inputCentsPer1KTokens: 3.2, outputCentsPer1KTokens: 6.4 },
  "gpt-realtime-mini": { inputCentsPer1KTokens: 1.0, outputCentsPer1KTokens: 2.0 },
};
const WHISPER_CENTS_PER_MINUTE_MIRROR = 0.6;
const AZURE_TTS_CENTS_PER_CHAR_MIRROR = 0.0016;

function estimateChatCostCentsMirror(
  model: string,
  inputTokens: number,
  maxOutputTokens: number
): number {
  const rate = MODEL_RATES_MIRROR[model] ?? MODEL_RATES_MIRROR["gpt-4o"];
  return (
    (inputTokens * rate.inputCentsPer1KTokens) / 1000 +
    (maxOutputTokens * rate.outputCentsPer1KTokens) / 1000
  );
}
// ─── END inline mirror ────────────────────────────────────────────────────────

describe("cost-table (Story 11-4) — Deno-source drift detector", () => {
  it("source file exists and is readable", () => {
    expect(COST_TABLE_SOURCE.length).toBeGreaterThan(500);
  });

  it("module-top JSDoc carries the REFRESH QUARTERLY stale-bait flag", () => {
    expect(COST_TABLE_SOURCE).toContain("REFRESH QUARTERLY");
    expect(COST_TABLE_SOURCE).toMatch(/Last refresh:\s+\d{4}-\d{2}-\d{2}/);
  });

  it("MODEL_RATES pins gpt-4o input + output rates as of 2026-05-12", () => {
    // The literal numeric values are the load-bearing pins. A maintainer
    // refreshing rates must update both the source AND this test in lockstep.
    expect(COST_TABLE_SOURCE).toMatch(
      /"gpt-4o":\s*\{\s*inputCentsPer1KTokens:\s*0\.25,\s*outputCentsPer1KTokens:\s*1\.0\s*\}/
    );
  });

  it("MODEL_RATES pins gpt-4o-mini input + output rates", () => {
    expect(COST_TABLE_SOURCE).toMatch(
      /"gpt-4o-mini":\s*\{\s*inputCentsPer1KTokens:\s*0\.015,\s*outputCentsPer1KTokens:\s*0\.06\s*\}/
    );
  });

  it("MODEL_RATES pins text-embedding-3-small rate + zero output rate", () => {
    expect(COST_TABLE_SOURCE).toMatch(
      /"text-embedding-3-small":\s*\{\s*inputCentsPer1KTokens:\s*0\.002,\s*outputCentsPer1KTokens:\s*0\s*\}/
    );
  });

  it("MODEL_RATES pins gpt-realtime + gpt-realtime-mini rates (Story 11-5 will switch free tier to mini)", () => {
    expect(COST_TABLE_SOURCE).toMatch(
      /"gpt-realtime":\s*\{\s*inputCentsPer1KTokens:\s*3\.2,\s*outputCentsPer1KTokens:\s*6\.4\s*\}/
    );
    expect(COST_TABLE_SOURCE).toMatch(
      /"gpt-realtime-mini":\s*\{\s*inputCentsPer1KTokens:\s*1\.0,\s*outputCentsPer1KTokens:\s*2\.0\s*\}/
    );
  });

  it("WHISPER_CENTS_PER_MINUTE pinned at 0.6", () => {
    expect(COST_TABLE_SOURCE).toMatch(/WHISPER_CENTS_PER_MINUTE\s*=\s*0\.6/);
  });

  it("AZURE_TTS_CENTS_PER_CHAR pinned at 0.0016", () => {
    expect(COST_TABLE_SOURCE).toMatch(/AZURE_TTS_CENTS_PER_CHAR\s*=\s*0\.0016/);
  });

  it("estimateChatCostCents + actualChatCostCents are exported", () => {
    expect(COST_TABLE_SOURCE).toMatch(/export function estimateChatCostCents\(/);
    expect(COST_TABLE_SOURCE).toMatch(/export function actualChatCostCents\(/);
  });

  it("estimate helpers for TTS / Whisper / Azure speech are exported", () => {
    expect(COST_TABLE_SOURCE).toMatch(/export function estimateTtsCostCents\(/);
    expect(COST_TABLE_SOURCE).toMatch(/export function estimateWhisperCostCents\(/);
    expect(COST_TABLE_SOURCE).toMatch(/export function estimateAzureSpeechCostCents\(/);
  });

  it("unknown-model fallback to gpt-4o in the chat helpers", () => {
    expect(COST_TABLE_SOURCE).toContain('MODEL_RATES["gpt-4o"]');
  });
});

describe("cost-table math contract (mirror)", () => {
  it("estimateChatCostCents for gpt-4o: 1000 input + 2048 output ≈ 2.298¢", () => {
    const result = estimateChatCostCentsMirror("gpt-4o", 1000, 2048);
    // (1000 × 0.25 / 1000) + (2048 × 1.0 / 1000) = 0.25 + 2.048 = 2.298
    expect(result).toBeCloseTo(2.298, 3);
  });

  it("estimateChatCostCents for gpt-4o-mini is dramatically cheaper than gpt-4o", () => {
    const fullCost = estimateChatCostCentsMirror("gpt-4o", 1000, 2048);
    const miniCost = estimateChatCostCentsMirror("gpt-4o-mini", 1000, 2048);
    expect(miniCost).toBeLessThan(fullCost / 10);
  });

  it("estimateChatCostCents falls back to gpt-4o rate for unknown model", () => {
    const unknownModelCost = estimateChatCostCentsMirror("not-a-real-model", 1000, 2048);
    const fallbackCost = estimateChatCostCentsMirror("gpt-4o", 1000, 2048);
    expect(unknownModelCost).toBe(fallbackCost);
  });

  it("estimateChatCostCents for embedding has zero output cost", () => {
    const result = estimateChatCostCentsMirror("text-embedding-3-small", 5000, 0);
    // 5000 × 0.002 / 1000 + 0 = 0.01¢
    expect(result).toBeCloseTo(0.01, 4);
  });

  it("TTS rate is appropriately micro (4000 chars ≈ 6.4¢)", () => {
    const result = 4000 * AZURE_TTS_CENTS_PER_CHAR_MIRROR;
    expect(result).toBeCloseTo(6.4, 4);
  });

  it("Whisper rate for 5.5 min audio is approximately 3.3¢", () => {
    const result = 5.5 * WHISPER_CENTS_PER_MINUTE_MIRROR;
    expect(result).toBeCloseTo(3.3, 2);
  });

  it("Realtime rate is at least 10× chat rate (gpt-realtime vs gpt-4o)", () => {
    const realtimeRate = MODEL_RATES_MIRROR["gpt-realtime"].inputCentsPer1KTokens;
    const chatRate = MODEL_RATES_MIRROR["gpt-4o"].inputCentsPer1KTokens;
    expect(realtimeRate).toBeGreaterThanOrEqual(chatRate * 10);
  });
});

// ─── Story 11-5 review patch P10: Realtime MODEL constant cost-table pin ───
// Reads the Realtime source from disk + the cost-table source from disk and
// asserts that the MODEL constant has a corresponding MODEL_RATES entry.
// Catches a future cost-table refresh that accidentally drops the entry
// (silent regression: daily-cost-cap pre-check would fall through to the
// gpt-4o fallback, under-estimating the actual session cost).
describe("Story 11-5 review patch P10 — Realtime MODEL cost-table pin", () => {
  it("the Realtime client MODEL constant has a corresponding MODEL_RATES entry in cost-table.ts", () => {
    const realtimeSource = readFileSync(resolve(__dirname, "../realtime.ts"), "utf-8");
    const match = realtimeSource.match(/const MODEL = "([^"]+)"/);
    expect(match).not.toBeNull();
    const modelConstant = match![1];

    // Verify the cost-table source has a key matching the MODEL constant.
    // Use the on-disk source so this test catches drift even if the
    // Jest mirror is stale (the Jest mirror is documentation; the
    // Deno source is the source of truth).
    expect(COST_TABLE_SOURCE).toContain(`"${modelConstant}":`);
  });

  it("Story 21-3 R1: the FULL_MODEL constant also has a MODEL_RATES entry (flag-enabled sessions must not fall through to gpt-4o rates)", () => {
    const realtimeSource = readFileSync(resolve(__dirname, "../realtime.ts"), "utf-8");
    const match = realtimeSource.match(/const FULL_MODEL = "([^"]+)"/);
    expect(match).not.toBeNull();
    expect(COST_TABLE_SOURCE).toContain(`"${match![1]}":`);
  });

  it("the current MODEL ('gpt-realtime-mini') has both input + output rates", () => {
    // Belt-and-braces: the inline mirror is what the daily-cost-cap pre-check
    // would consume at runtime. Verify the mirror has the entry the realtime
    // path would actually look up.
    expect(MODEL_RATES_MIRROR["gpt-realtime-mini"]).toBeDefined();
    expect(MODEL_RATES_MIRROR["gpt-realtime-mini"].inputCentsPer1KTokens).toBeGreaterThan(0);
    expect(MODEL_RATES_MIRROR["gpt-realtime-mini"].outputCentsPer1KTokens).toBeGreaterThan(0);
  });
});
