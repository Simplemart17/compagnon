/**
 * Story 13-4 — `use-mock-test-generation.ts` source-drift detector
 * (audit P2-6 closure).
 *
 * Pins by reading the hook source from disk:
 *   (1) `Promise.allSettled` used (NOT `Promise.all` — sibling failure must
 *       NOT abort siblings).
 *   (2) NEGATIVE: pre-13-4 `for (const section of sections)` serial-await
 *       pattern GONE.
 *   (3) POSITIVE: `mountedRef.current` guard appears in every setState code
 *       path (count ≥ 4 since we have 4 setState sites in the generation +
 *       resume + INSERT/UPDATE paths).
 *   (4) POSITIVE: `insertFiredRef.current` guard around the INSERT call site.
 *   (5) POSITIVE: per-section `captureError(_, `mock-test-generate-${section}`)`
 *       template preserved (Story 9-3 telemetry contract).
 *   (6) POSITIVE: `captureError(_, "mock-test-section-update")` for INSERT/UPDATE
 *       failure paths.
 *   (7) POSITIVE: `captureError(_, "mock-test-undercount")` preserved verbatim
 *       (pre-13-4 byte-faithful at lines 347-360).
 *
 * Story 12-2 P12 lesson: strip comments so JSDoc that mentions pre-13-4
 * patterns doesn't trip the negative guards.
 */

import { readFileSync } from "fs";
import { join } from "path";

const HOOK_PATH = join(__dirname, "..", "use-mock-test-generation.ts");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf-8");

const HOOK_CODE_ONLY = HOOK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("use-mock-test-generation.ts — Story 13-4 source-drift detector (audit P2-6)", () => {
  it("Case 1: POSITIVE — uses Promise.allSettled (not Promise.all)", () => {
    expect(HOOK_CODE_ONLY).toMatch(/Promise\.allSettled\s*\(/);
  });

  it("Case 2: NEGATIVE — pre-13-4 serial-await loop pattern is GONE; POSITIVE — sections.map(async) parallel-fire present", () => {
    // Pre-13-4 had `let generationFailed = false; for (const section of sections) { ... await chatCompletionJSON ... }`.
    // The `generationFailed` variable name is unique to the pre-13-4 serial
    // pattern — its absence is a load-bearing anchor that the for-of loop
    // was deleted. (A benign `for (const s of sections)` survives in
    // helpers like initialSectionStatus + total-minute reduce, but those
    // never await chatCompletionJSON; the parallel-fire happens via
    // `sections.map(async)` instead.)
    expect(HOOK_CODE_ONLY).not.toMatch(/let\s+generationFailed/);
    // POSITIVE pin: post-13-4 parallel-fire shape.
    expect(HOOK_CODE_ONLY).toMatch(/sections\w*\.map\s*\(\s*async/);
  });

  it("Case 3: POSITIVE — mountedRef.current guard count ≥ 4 setState paths", () => {
    const matches = HOOK_CODE_ONLY.match(/mountedRef\.current/g) ?? [];
    // 1 init effect + 1 cancel-check inside the resume branch (multiple
    // occurrences) + 1 cancel-check after parallel-generation per-section
    // settle (success path) + 1 after failure path + retry() guard.
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("Case 4: POSITIVE — insertFiredRef.current guard around INSERT path", () => {
    expect(HOOK_CODE_ONLY).toMatch(/insertFiredRef\.current\s*=\s*true/);
    expect(HOOK_CODE_ONLY).toMatch(/!\s*insertFiredRef\.current/);
  });

  it("Case 5 (Story 9-3): POSITIVE — per-section `mock-test-generate-${section}` Sentry tag preserved", () => {
    // Allow either template-literal or string form; the section interpolation
    // is the load-bearing part for Story 9-3 telemetry.
    expect(HOOK_CODE_ONLY).toMatch(/`mock-test-generate-\$\{section\}`/);
  });

  it("Case 6 (Story 9-3): POSITIVE — `mock-test-section-update` Sentry tag present for INSERT/UPDATE failures", () => {
    expect(HOOK_CODE_ONLY).toMatch(/["']mock-test-section-update["']/);
  });

  it("Case 7 (Story 9-3): POSITIVE — `mock-test-undercount` Sentry tag preserved (pre-13-4 byte-faithful)", () => {
    expect(HOOK_CODE_ONLY).toMatch(/["']mock-test-undercount["']/);
  });
});
