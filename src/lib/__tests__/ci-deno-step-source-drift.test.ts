/**
 * Story 15-3 — source-drift detector for the Deno test CI step.
 *
 * Pins the new `Deno tests (Edge Function _shared utilities)` step in
 * `.github/workflows/ci.yml` against silent regression:
 *   - Setup step uses the official `denoland/setup-deno@v2` action
 *   - Step name + `deno test` invocation + canonical permission flag
 *   - NEGATIVE: no over-permissive `--allow-all`
 *   - NEGATIVE: no silent-disable patterns (`continue-on-error: true` /
 *     blanket `if:` keys — Story 12-10 R1-H2 lesson)
 *   - Ordering: appears AFTER the `Tests` step so a failing `npm test`
 *     short-circuits before the Deno install (build-time efficiency)
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readCiYml(): string {
  return fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf-8");
}

describe("Story 15-3 — Deno test CI step source drift", () => {
  const ci = readCiYml();

  it("Case 1: Setup Deno step uses denoland/setup-deno@v2 action with pinned v1.x version", () => {
    expect(ci).toMatch(/- name:\s*Setup Deno\b/);
    expect(ci).toMatch(/uses:\s*denoland\/setup-deno@v2\b/);
    expect(ci).toMatch(/deno-version:\s*v1\.x\b/);
  });

  it("Case 2: Deno test step name + canonical run command pinned", () => {
    expect(ci).toMatch(/- name:\s*Deno tests \(Edge Function _shared utilities\)/);
    // Canonical run command: deno test + scoped permission + scoped dir
    expect(ci).toMatch(
      /run:\s*deno test --allow-net=127\.0\.0\.1 supabase\/functions\/_shared\/__tests__\//
    );
  });

  it("Case 3: NEGATIVE guard — no --allow-all (over-permissive); permission surface stays minimal", () => {
    // Find the Deno test run line specifically (avoid false positives if
    // another step happens to mention --allow-all in a comment).
    const runLineMatch = ci.match(
      /run:\s*deno test [^\n]+supabase\/functions\/_shared\/__tests__\/[^\n]*/
    );
    expect(runLineMatch).not.toBeNull();
    expect(runLineMatch![0]).not.toContain("--allow-all");
  });

  it("Case 4: NEGATIVE guard — Deno test step does NOT carry `continue-on-error: true` or unrestricted `if:` (Story 12-10 R1-H2 silent-disable defense)", () => {
    // Extract the block from "name: Deno tests" to the next "- name:" or EOF.
    const denoBlockMatch = ci.match(
      /- name:\s*Deno tests \(Edge Function _shared utilities\)[\s\S]*?(?=\n\s*- name:|\n\s*$)/
    );
    expect(denoBlockMatch).not.toBeNull();
    const block = denoBlockMatch![0];
    expect(block).not.toMatch(/continue-on-error:\s*true/);
    // No top-level `if:` key that would conditionally skip the step.
    // (Note: `if:` inside the `run:` shell script is fine — only flag the
    // step-level `if:` key.)
    const stepLevelIf = block.match(/^\s{6}if:\s/m); // 6-space indent matches step-level keys
    expect(stepLevelIf).toBeNull();
  });

  it("Case 5: Ordering — Deno test step appears AFTER the Tests step (so npm test failures short-circuit before Deno install)", () => {
    const testsIdx = ci.search(/- name:\s*Tests\b/);
    const denoIdx = ci.search(/- name:\s*Deno tests \(Edge Function _shared utilities\)/);
    const setupDenoIdx = ci.search(/- name:\s*Setup Deno\b/);
    expect(testsIdx).toBeGreaterThan(0);
    expect(denoIdx).toBeGreaterThan(testsIdx);
    expect(setupDenoIdx).toBeGreaterThan(testsIdx);
    expect(setupDenoIdx).toBeLessThan(denoIdx); // setup comes before test invocation
  });
});
