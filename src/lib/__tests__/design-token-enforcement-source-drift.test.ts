/**
 * Story 14-4 — design-token enforcement source-drift detector.
 *
 * Pins the 3 enforcement surfaces (bash gate, npm script, ESLint AST rule)
 * + the 2 new design.ts token definitions + the magic-comment escape
 * hatch contract against silent regression. Mirrors Story 12-10's
 * `ci-audit-gate-source-drift.test.ts` patterns: read source files from
 * disk + targeted regex assertions.
 *
 * Cases:
 *   (1) `package.json` exposes `check:tokens` script wired to
 *       `bash scripts/check-design-tokens.sh`.
 *   (2) `ci.yml` contains a `Design token check` step.
 *   (3) The `Design token check` step's `run:` line is EXACTLY
 *       `npm run check:tokens` (no `||`, `&&`, redirect chars).
 *   (4) `ci.yml` ordering — the `Design token check` step appears AFTER
 *       the `Hex color check` step (sibling pattern; both gates run after
 *       the 4 quality-gate predecessors).
 *   (5) `scripts/check-design-tokens.sh` is executable + has `#!/usr/bin/env bash`
 *       + `set -euo pipefail` + matches the 2 enforcement patterns
 *       (`rounded-\[[0-9]+px\]` + `(shadowOpacity|shadowRadius)\s*:\s*[0-9.]+`)
 *       + recognizes the `design-token-exempt` magic-comment escape hatch.
 *   (6) `src/lib/design.ts` exports `Shadows.bottomSheet` (Story 14-4 new
 *       token) with the negative-height invariant (`height: -4`).
 *   (7) `eslint.config.js` declares the `no-restricted-syntax` rule with
 *       the canonical AST selector for `shadow(Opacity|Radius)` Literal
 *       properties.
 *   (8) `eslint.config.js` exempts `src/lib/design.ts` from the rule
 *       (token definitions live there; would otherwise self-flag).
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

describe("Story 14-4 — design-token enforcement source drift", () => {
  describe("Bash gate + npm script wiring", () => {
    it("Case 1: `package.json` exposes `check:tokens` → `bash scripts/check-design-tokens.sh`", () => {
      const pkg = JSON.parse(readFile("package.json"));
      expect(pkg.scripts["check:tokens"]).toBe("bash scripts/check-design-tokens.sh");
    });

    it("Case 2: `ci.yml` contains a `Design token check` step", () => {
      const ci = readFile(".github/workflows/ci.yml");
      expect(ci).toMatch(/- name:\s*Design token check\b/);
    });

    it("Case 3: `Design token check` run line invokes `npm run check:tokens`", () => {
      const ci = readFile(".github/workflows/ci.yml");
      // Extract the step block from `- name: Design token check` to the next sibling `- name:`.
      const startIdx = ci.search(/- name:\s*Design token check\b/);
      expect(startIdx).toBeGreaterThan(-1);
      const after = ci.slice(startIdx);
      const nextStepIdx = after.slice(1).search(/\n\s*- name:\s/);
      const block = nextStepIdx === -1 ? after : after.slice(0, nextStepIdx + 1);
      const runMatch = block.match(/^\s*run:\s*(.+)$/m);
      expect(runMatch).not.toBeNull();
      // Story 14-4 R1-P16: use `.toContain()` instead of strict `.toBe()` so a
      // benign trailing inline comment (`run: npm run check:tokens # CI`) or
      // a future multi-line `run: |` block doesn't trip the assertion.
      expect(runMatch![1]).toContain("npm run check:tokens");
    });

    it("Case 4: ordering — `Design token check` appears AFTER `Hex color check`", () => {
      const ci = readFile(".github/workflows/ci.yml");
      const hexIdx = ci.search(/- name:\s*Hex color check\b/);
      const tokensIdx = ci.search(/- name:\s*Design token check\b/);
      expect(hexIdx).toBeGreaterThan(-1);
      expect(tokensIdx).toBeGreaterThan(-1);
      expect(tokensIdx).toBeGreaterThan(hexIdx);
    });

    it("Case 5: `scripts/check-design-tokens.sh` has the expected enforcement surface (post-R1 hardening)", () => {
      const script = readFile("scripts/check-design-tokens.sh");
      // Shebang + safety flags
      expect(script).toMatch(/^#!\/usr\/bin\/env bash\b/);
      expect(script).toMatch(/set -euo pipefail/);
      // R1-P11: `rounded-[Nunit]` pattern accepts decimal + unit variation (px / pt / rem / em / %)
      expect(script).toContain("rounded-\\[[0-9]+(\\.[0-9]+)?(px|pt|rem|em|%)\\]");
      // R1-P7: shadow-primitive pattern accepts negative numerics
      expect(script).toContain("(shadowOpacity|shadowRadius)\\s*:\\s*-?[0-9.]+");
      // R1-P9: shadowOffset object form covered
      expect(script).toContain("shadowOffset\\s*:\\s*\\{");
      // R1-P6: magic-comment escape hatch is comment-context-anchored
      expect(script).toContain("design-token-exempt");
      expect(script).toMatch(/\(\/\/\|\/\\\*\|\\\{\/\\\*\)\[\^"\]\*design-token-exempt/);
      // R1-P8: path-based exemption (NOT filename `--exclude=design.ts`)
      expect(script).toContain("EXEMPT_PATHS=");
      expect(script).toContain("src/lib/design.ts");
      // R1-P15: scans entire src/ (NOT only src/components/+src/hooks/+src/store/+src/lib/)
      expect(script).toContain("DIRS=(app/ src/)");
    });
  });

  describe("design.ts token additions", () => {
    it("Case 6: `Shadows.bottomSheet` is exported with `shadowOffset: { height: -4 }` invariant", () => {
      const design = readFile("src/lib/design.ts");
      // Token block present
      expect(design).toMatch(/bottomSheet:\s*{/);
      // Story 14-4 R1-P19: bound the slice to the bottomSheet token's
      // closing `} as ViewStyle,` (the canonical closer for all `Shadows.*`
      // tokens). Pre-R1 the slice ran to EOF, so a future token added AFTER
      // bottomSheet that happened to contain `height: -4` or `shadowOpacity: 0.06`
      // would have passed Case 6 vacuously. We use `} as ViewStyle,` to skip the
      // inner `shadowOffset: { ... }` brace which would close prematurely.
      const start = design.indexOf("bottomSheet:");
      const fromStart = design.slice(start);
      const closerIdx = fromStart.indexOf("} as ViewStyle,");
      expect(closerIdx).toBeGreaterThan(-1);
      const bottomSheetBlock = fromStart.slice(0, closerIdx);
      // Negative-height invariant — the load-bearing semantic that distinguishes
      // this from `Shadows.hero` / `Shadows.subtle` / `Shadows.card`. A future
      // refactor that flips the sign breaks the auth-screen sheet illusion.
      expect(bottomSheetBlock).toMatch(/height:\s*-4\b/);
      expect(bottomSheetBlock).toMatch(/shadowOpacity:\s*0\.06\b/);
      expect(bottomSheetBlock).toMatch(/shadowRadius:\s*12\b/);
    });
  });

  describe("ESLint AST rule wiring", () => {
    it("Case 7: `eslint.config.js` declares `no-restricted-syntax` for shadow* literal properties", () => {
      const eslintConfig = readFile("eslint.config.js");
      expect(eslintConfig).toContain('"no-restricted-syntax"');
      // The AST selector pinned — catches `shadowOpacity` + `shadowRadius` literal
      // properties anywhere (Property nodes with literal value).
      expect(eslintConfig).toContain(
        "Property[key.name=/^shadow(Opacity|Radius)$/][value.type='Literal']"
      );
      // Error severity (not warn) so CI gates on it
      const ruleBlock = eslintConfig.slice(eslintConfig.indexOf('"no-restricted-syntax"'));
      expect(ruleBlock).toMatch(/"no-restricted-syntax":\s*\[\s*"error"/);
    });

    it("Case 8: `eslint.config.js` exempts `src/lib/design.ts` from `no-restricted-syntax`", () => {
      const eslintConfig = readFile("eslint.config.js");
      // The override block scoping the off-rule to design.ts (R1-P9: the drift
      // detector test file itself is also exempt — included in the same files: array).
      expect(eslintConfig).toContain("src/lib/design.ts");
      // Whose rules turn no-restricted-syntax off
      const offRuleIdx = eslintConfig.indexOf('"no-restricted-syntax": "off"');
      expect(offRuleIdx).toBeGreaterThan(-1);
    });
  });

  describe("Workflow-level disable guard (Story 14-4 R1-P13 / Story 12-10 R1-H2)", () => {
    it("Case 9: `Design token check` step does NOT carry `continue-on-error: true` or `if:` keys (silent-disable patterns)", () => {
      // A future PR could silently disable the gate by adding `continue-on-error: true`
      // or `if: ${{ false }}` to the step block — the `run:` line stays intact but the
      // step becomes a no-op. Story 12-10 R1-H2 surfaced this pattern; applying the
      // same defense here.
      const ci = readFile(".github/workflows/ci.yml");
      const startIdx = ci.search(/- name:\s*Design token check\b/);
      expect(startIdx).toBeGreaterThan(-1);
      const after = ci.slice(startIdx);
      const nextStepIdx = after.slice(1).search(/\n\s*- name:\s/);
      const block = nextStepIdx === -1 ? after : after.slice(0, nextStepIdx + 1);
      expect(block).not.toMatch(/^\s*continue-on-error:\s*true\b/m);
      expect(block).not.toMatch(/^\s*if:\s/m);
    });
  });
});
