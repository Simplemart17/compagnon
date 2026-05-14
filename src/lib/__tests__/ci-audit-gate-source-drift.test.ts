/**
 * Story 12-10 — `.github/workflows/ci.yml` "Dependency vulnerability gate"
 * source drift detector.
 *
 * Pins the CI gate config against silent regression. Review-round-1 made
 * every regex `run:`-line-anchored (was whole-file substring matches, which
 * had two failure modes: (i) the gate's own comment block contained
 * `--audit-level=high` so the positive guard could pass even if `run:` was
 * disabled; (ii) a benign future comment like `# Don't use --audit-level=low`
 * would have failed the negative guards). Post-round-1 the drift detector
 * also catches step-level disable patterns (`continue-on-error`, `if:`,
 * `|| true`) and pins both the `--audit-level=critical` and `--omit=dev`
 * negative guards that the spec called for.
 *
 * Cases:
 *   (1) Step `Dependency vulnerability gate` is present with exact name.
 *   (2) The step's `run:` line is EXACTLY `npm audit --audit-level=high`
 *       (no `||`, `&&`, `;`, redirect chars, trailing flags). Run-anchored
 *       regex — H1 / Edge-#3 patch.
 *   (3) NEGATIVE — the gate's `run:` line does NOT use `--audit-level=low`.
 *   (4) NEGATIVE — the gate's `run:` line does NOT use `--audit-level=moderate`.
 *   (5) NEGATIVE — the gate's `run:` line does NOT use `--audit-level=critical`
 *       (H3 / Edge-#2 patch — spec AC #1 required all three negative guards).
 *   (6) NEGATIVE — the gate's `run:` line does NOT use `--omit=dev` (L2 /
 *       Edge-#10 patch — Story 12-10 deliberately includes dev-deps because
 *       a high-severity dev-dep vuln can exfiltrate secrets).
 *   (7) NEGATIVE — the gate step block does NOT contain `continue-on-error:`
 *       or `if:` keys (H2 / Edge-#1 patch — these would silently disable
 *       the gate while leaving the `run:` line intact).
 *   (8) Ordering — the gate step appears after the `Tests` step AND after
 *       all the other quality-gate steps (Type check, Lint, Format, Tests).
 *       M1 / Edge-#4 patch — pre-round-1 the ordering check used the first
 *       match of `- name: Tests` which is brittle to step rename and to
 *       multi-`Tests`-prefix scenarios. Post-round-1 we parse the workflow
 *       step list and assert the gate is the FIRST step whose name matches
 *       the new-gate pattern AND that it comes AFTER all four quality-gate
 *       steps' names appear in the file.
 *
 * Mirrors Story 12-9's `email-verification-source-drift.test.ts` source-
 * drift pattern: read `ci.yml` from disk + targeted regex assertions.
 */

import * as fs from "fs";
import * as path from "path";

const CI_YML_PATH = path.resolve(__dirname, "../../../.github/workflows/ci.yml");
const CI_YML = fs.readFileSync(CI_YML_PATH, "utf-8");

/**
 * Extract the YAML block for the gate step — from its `- name:` line to the
 * next sibling `- name:` line (or EOF). The block is what the negative
 * guards (low / moderate / critical / --omit=dev / continue-on-error / if:)
 * inspect; the previously-broken whole-file-substring approach was the
 * round-1 H1 failure mode.
 */
const GATE_STEP_NAME = "Dependency vulnerability gate";
function extractGateStepBlock(yaml: string): string {
  const startIdx = yaml.search(new RegExp(`^\\s*- name:\\s*${GATE_STEP_NAME}\\b`, "m"));
  if (startIdx === -1) return "";
  const rest = yaml.slice(startIdx);
  // Find the next `- name:` at the same indent or EOF.
  // Step indent in the validate job is 6 spaces before `-` per ci.yml.
  const nextStepIdx = rest.slice(1).search(/\n\s*- name:\s/);
  return nextStepIdx === -1 ? rest : rest.slice(0, nextStepIdx + 1);
}

/**
 * Extract the gate step's `run:` line value (the command actually executed).
 * Returns the trimmed value AFTER `run:` on the gate step's block — multi-line
 * `run: |` blocks are NOT supported here (the gate is a single-line command);
 * if a future edit converts the gate to a multi-line `run: |` block, the
 * regex falls through to the empty string and Case 2 fails loudly.
 */
function extractGateRunCommand(yaml: string): string {
  const block = extractGateStepBlock(yaml);
  if (block === "") return "";
  const match = block.match(/^\s*run:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

describe("ci.yml — Story 12-10 Dependency vulnerability gate drift detector (review-round-1 hardened)", () => {
  it("Case 1: step `Dependency vulnerability gate` is present (exact name)", () => {
    expect(CI_YML).toMatch(/- name:\s*Dependency vulnerability gate\b/);
  });

  // H1 patch: positive guard is anchored to the actual `run:` line value,
  // not a whole-file substring. Pre-patch the comment block contained
  // `--audit-level=high` (in a backtick-quoted reference), so Case 2 could
  // pass even if a future edit changed `run:` to a no-op like `echo "skipped"`.
  it("Case 2: gate step's run line is EXACTLY `npm audit --audit-level=high` (no chained operators / flags)", () => {
    const runCmd = extractGateRunCommand(CI_YML);
    expect(runCmd).toBe("npm audit --audit-level=high");
  });

  // Negative guards — run-line-scoped (H1 + Edge-#3 patch).
  it("Case 3: NEGATIVE — gate's run line does NOT use `--audit-level=low` (would block today's 5 lows)", () => {
    const runCmd = extractGateRunCommand(CI_YML);
    expect(runCmd).not.toMatch(/--audit-level=low\b/);
  });

  it("Case 4: NEGATIVE — gate's run line does NOT use `--audit-level=moderate` (would block today's 4 moderates)", () => {
    const runCmd = extractGateRunCommand(CI_YML);
    expect(runCmd).not.toMatch(/--audit-level=moderate\b/);
  });

  it("Case 5 (H3): NEGATIVE — gate's run line does NOT use `--audit-level=critical` (would weaken the gate to ignore high)", () => {
    // Spec AC #1: "The step does NOT use `--audit-level=critical`, `--audit-level=moderate`, or `--audit-level=low`".
    // Pre-round-1 the drift detector only pinned low + moderate; this case
    // closes the AC #1 gap.
    const runCmd = extractGateRunCommand(CI_YML);
    expect(runCmd).not.toMatch(/--audit-level=critical\b/);
  });

  it("Case 6 (L2): NEGATIVE — gate's run line does NOT use `--omit=dev` (Story 12-10 deliberately includes dev-deps)", () => {
    // A high-severity dev-dep vuln can exfiltrate secrets from a dev's
    // machine or a CI runner. The story rationale explicitly argues for
    // gating dev-deps too.
    const runCmd = extractGateRunCommand(CI_YML);
    expect(runCmd).not.toMatch(/--omit=dev\b/);
  });

  it("Case 7 (H2): NEGATIVE — gate step block does NOT contain `continue-on-error:` or `if:` keys (silent-disable patterns)", () => {
    // A future PR could weaken the gate to a no-op via `continue-on-error: true`
    // or `if: ${{ false }}`. The current 5 cases didn't catch these because
    // they only inspect the `run:` line value.
    const block = extractGateStepBlock(CI_YML);
    expect(block).not.toMatch(/^\s*continue-on-error:\s*true\b/m);
    expect(block).not.toMatch(/^\s*if:\s/m);
  });

  it("Case 8 (M1): ordering — gate step appears AFTER `Type check`, `Lint`, `Prettier format check`, and `Tests` steps", () => {
    // Pre-round-1 the ordering check used only the first `- name:\s*Tests`
    // match, which is brittle to: (i) Tests-step rename, (ii) any future
    // step with `Tests` prefix added before the gate. Post-round-1 we
    // assert ordering against all four quality-gate predecessors so a
    // refactor that moves the gate above any of them fails loudly.
    //
    // We use `.search()` on the first occurrence of each — sufficient because
    // these step names are unique (the existing ci.yml has one of each).
    const typeCheckIdx = CI_YML.search(/- name:\s*TypeScript type check\b/);
    const lintIdx = CI_YML.search(/- name:\s*Lint\b/);
    const formatIdx = CI_YML.search(/- name:\s*Prettier format check\b/);
    const testsIdx = CI_YML.search(/- name:\s*Tests\b/);
    const gateIdx = CI_YML.search(/- name:\s*Dependency vulnerability gate\b/);

    // All five must exist.
    expect(typeCheckIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(-1);
    expect(formatIdx).toBeGreaterThan(-1);
    expect(testsIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);

    // Gate must come after all four quality-gate predecessors.
    expect(gateIdx).toBeGreaterThan(typeCheckIdx);
    expect(gateIdx).toBeGreaterThan(lintIdx);
    expect(gateIdx).toBeGreaterThan(formatIdx);
    expect(gateIdx).toBeGreaterThan(testsIdx);
  });
});
