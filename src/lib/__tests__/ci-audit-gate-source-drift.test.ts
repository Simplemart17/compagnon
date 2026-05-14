/**
 * Story 12-10 — `.github/workflows/ci.yml` "Dependency vulnerability gate"
 * source drift detector.
 *
 * Pins the CI gate config against silent regression:
 *   (a) The step `Dependency vulnerability gate` exists with the exact name.
 *   (b) The run script contains `npm audit --audit-level=high`.
 *   (c) NEGATIVE — does NOT use `--audit-level=low` (would block on today's
 *       5 low vulns — moves the Epic 12 AC out of reach without explicit
 *       Section-2 decision-tree review).
 *   (d) NEGATIVE — does NOT use `--audit-level=moderate` (same — would
 *       block on today's 4 moderate postcss-chain vulns which are
 *       documented as build-time-only in the runbook).
 *   (e) Ordering — the gate step appears AFTER the `Tests` step in
 *       source-line order, so the gate runs after the existing test
 *       suite passes (a high-severity vuln introduced alongside failing
 *       tests still surfaces the test failure first).
 *
 * Mirrors Story 12-9's `email-verification-source-drift.test.ts` pattern:
 * read source from disk + regex assertions. YAML doesn't need block-comment
 * stripping (uses `#` line comments only, which appear in `run: |` blocks
 * we deliberately want to inspect).
 */

import * as fs from "fs";
import * as path from "path";

const CI_YML_PATH = path.resolve(__dirname, "../../../.github/workflows/ci.yml");
const CI_YML = fs.readFileSync(CI_YML_PATH, "utf-8");

describe("ci.yml — Story 12-10 Dependency vulnerability gate drift detector", () => {
  it("Case 1: step `Dependency vulnerability gate` is present (exact name)", () => {
    expect(CI_YML).toMatch(/- name:\s*Dependency vulnerability gate\b/);
  });

  it("Case 2: run-script contains `npm audit --audit-level=high`", () => {
    expect(CI_YML).toMatch(/npm audit --audit-level=high\b/);
  });

  it("Case 3: NEGATIVE — step does NOT use `--audit-level=low` (would block today's 5 lows)", () => {
    expect(CI_YML).not.toMatch(/--audit-level=low\b/);
  });

  it("Case 4: NEGATIVE — step does NOT use `--audit-level=moderate` (would block today's 4 moderates)", () => {
    expect(CI_YML).not.toMatch(/--audit-level=moderate\b/);
  });

  it("Case 5: ordering — gate step appears AFTER the `Tests` step", () => {
    const testsIdx = CI_YML.search(/- name:\s*Tests\b/);
    const gateIdx = CI_YML.search(/- name:\s*Dependency vulnerability gate\b/);
    expect(testsIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(testsIdx);
  });
});
