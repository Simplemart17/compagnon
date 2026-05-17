/**
 * Story 15-4 — source-drift detector for Maestro E2E flow files.
 *
 * Pins the `.maestro/` directory structure against silent regression
 * (e.g., a future PR accidentally deletes a flow file). The flows
 * themselves are skeleton-only (carry `# TODO: verify selector` markers);
 * full CI wiring deferred to `15-4-followup-maestro-ci-wiring`.
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MAESTRO_DIR = path.join(REPO_ROOT, ".maestro");

const EXPECTED_FLOWS = [
  "01-signup-flow.yaml",
  "02-onboarding-flow.yaml",
  "03-first-exercise.yaml",
  "04-first-conversation.yaml",
  "05-mock-test-partial-review.yaml",
];

describe("Story 15-4 — Maestro flows source drift", () => {
  it("Case 1: `.maestro/config.yaml` exists with the canonical appId", () => {
    const configPath = path.join(MAESTRO_DIR, "config.yaml");
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toMatch(/appId:\s*com\.companion\.app/);
  });

  it("Case 2: all 5 canonical flow files exist", () => {
    for (const flow of EXPECTED_FLOWS) {
      const flowPath = path.join(MAESTRO_DIR, flow);
      expect(fs.existsSync(flowPath)).toBe(true);
    }
  });

  it("Case 3: each flow file has non-trivial body (>20 lines + appId declaration)", () => {
    for (const flow of EXPECTED_FLOWS) {
      const content = fs.readFileSync(path.join(MAESTRO_DIR, flow), "utf-8");
      const lineCount = content.split("\n").length;
      // Skeleton flows have ~30-70 lines; pure-placeholder would be < 10.
      expect(lineCount).toBeGreaterThan(20);
      expect(content).toMatch(/appId:\s*com\.companion\.app/);
    }
  });

  it("Case 4: each flow tags itself with `smoke` (the canonical Story 15-4 tag for golden-flow E2E)", () => {
    for (const flow of EXPECTED_FLOWS) {
      const content = fs.readFileSync(path.join(MAESTRO_DIR, flow), "utf-8");
      expect(content).toMatch(/^\s*-\s*smoke\s*$/m);
    }
  });

  it("Case 5: NO Maestro CI step has been wired in .github/workflows/ci.yml yet (15-4 SKELETON-ONLY scope — CI wiring deferred to 15-4-followup)", () => {
    const ciPath = path.join(REPO_ROOT, ".github/workflows/ci.yml");
    const ci = fs.readFileSync(ciPath, "utf-8");
    // No `maestro test` invocation should be present yet.
    expect(ci).not.toMatch(/maestro\s+test\b/);
    // No `get\.maestro\.mobile\.dev` install step should be present yet.
    expect(ci).not.toMatch(/get\.maestro\.mobile\.dev/);
  });
});
