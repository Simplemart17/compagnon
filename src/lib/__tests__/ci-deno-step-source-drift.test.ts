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

  it("Case 2: Deno test step name + canonical run command pinned (explicit file paths + --no-check + --allow-net=127.0.0.1)", () => {
    expect(ci).toMatch(/- name:\s*Deno tests \(Edge Function _shared utilities\)/);
    // Canonical run command form (R1 BH-2/EH-1 vacuous-pass defense:
    // explicit file names instead of directory match; R1 EH-10:
    // --no-check skips redundant TS check):
    expect(ci).toMatch(/deno test --no-check --allow-net=127\.0\.0\.1/);
    // Both _test.ts files named explicitly so a rename/move fails loudly
    // at "Module not found" instead of silently passing an empty match.
    expect(ci).toMatch(/supabase\/functions\/_shared\/__tests__\/fetch-with-timeout_test\.ts/);
    expect(ci).toMatch(/supabase\/functions\/_shared\/__tests__\/parse-upstream-error_test\.ts/);
    // Bounded execution time so a hung worker can't burn the GitHub
    // Actions 6-hour default timeout (R1 BH-6).
    const denoBlockMatch = ci.match(
      /- name:\s*Deno tests \(Edge Function _shared utilities\)[\s\S]*?(?=\n\s{6}- name:|\n\s*$)/
    );
    expect(denoBlockMatch).not.toBeNull();
    expect(denoBlockMatch![0]).toMatch(/timeout-minutes:\s*3\b/);
  });

  it("Case 3: NEGATIVE guard — no --allow-all (over-permissive); permission surface stays minimal", () => {
    // Scope to the Deno test step's block so a comment elsewhere
    // mentioning --allow-all isn't false-flagged.
    const denoBlockMatch = ci.match(
      /- name:\s*Deno tests \(Edge Function _shared utilities\)[\s\S]*?(?=\n\s{6}- name:|\n\s*$)/
    );
    expect(denoBlockMatch).not.toBeNull();
    // Strip comment lines so the "NO `--allow-all`" comment doesn't
    // false-flag against the negative guard.
    const blockNoComments = denoBlockMatch![0].replace(/^\s*#.*$/gm, "");
    expect(blockNoComments).not.toMatch(/--allow-all\b/);
  });

  it("Case 4: NEGATIVE guard — BOTH Setup Deno + Deno test steps lack silent-disable patterns (R1 BH-5: tightly-coupled steps need parity)", () => {
    // R1 BH-5 lesson: silent-disable on the Setup Deno step would leave
    // `deno` uninstalled; the subsequent test step would fail with
    // `deno: command not found` — BUT if BOTH steps carry the disable,
    // CI green-passes vacuously. Pin both blocks.
    const blocks: [string, RegExp][] = [
      ["Setup Deno", /- name:\s*Setup Deno\b[\s\S]*?(?=\n\s{6}- name:|\n\s*$)/],
      [
        "Deno tests",
        /- name:\s*Deno tests \(Edge Function _shared utilities\)[\s\S]*?(?=\n\s{6}- name:|\n\s*$)/,
      ],
    ];
    for (const [label, blockRegex] of blocks) {
      const m = ci.match(blockRegex);
      if (!m) {
        throw new Error(`${label} block not found in ci.yml`);
      }
      const block = m[0];
      if (/continue-on-error:\s*true/.test(block)) {
        throw new Error(
          `${label} step carries \`continue-on-error: true\` (R1 BH-5 silent-disable)`
        );
      }
      // No step-level `if:` key (6-space indent). `if:` inside a `run:`
      // shell script is fine — only flag the step-level YAML key.
      if (/^\s{6}if:\s/m.test(block)) {
        throw new Error(`${label} step carries step-level \`if:\` key (R1 BH-5 silent-disable)`);
      }
    }
    // Belt-and-suspenders structural pin: both regexes matched.
    expect(blocks.length).toBe(2);
  });

  it("Case 5: Ordering — Deno test step appears AFTER the no-coverage Tests step (so npm test failures short-circuit before Deno install)", () => {
    // R1 EH-4: anchor the `Tests` regex to line-end (`$/m`) so the
    // `Tests with coverage threshold` step that PR #116 inserts cannot
    // match this pattern. `\b` alone would match both "Tests" and
    // "Tests with..." (both have a word boundary after "Tests").
    const testsIdx = ci.search(/^\s{6}- name:\s*Tests\s*$/m);
    const denoIdx = ci.search(/- name:\s*Deno tests \(Edge Function _shared utilities\)/);
    const setupDenoIdx = ci.search(/- name:\s*Setup Deno\b/);
    expect(testsIdx).toBeGreaterThan(0);
    expect(denoIdx).toBeGreaterThan(testsIdx);
    expect(setupDenoIdx).toBeGreaterThan(testsIdx);
    expect(setupDenoIdx).toBeLessThan(denoIdx); // setup comes before test invocation
  });
});
