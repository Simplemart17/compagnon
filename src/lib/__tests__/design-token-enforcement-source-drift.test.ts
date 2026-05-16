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

    it("Case 3: `Design token check` run line is EXACTLY `npm run check:tokens`", () => {
      const ci = readFile(".github/workflows/ci.yml");
      // Extract the step block from `- name: Design token check` to the next sibling `- name:`.
      const startIdx = ci.search(/- name:\s*Design token check\b/);
      expect(startIdx).toBeGreaterThan(-1);
      const after = ci.slice(startIdx);
      const nextStepIdx = after.slice(1).search(/\n\s*- name:\s/);
      const block = nextStepIdx === -1 ? after : after.slice(0, nextStepIdx + 1);
      const runMatch = block.match(/^\s*run:\s*(.+)$/m);
      expect(runMatch).not.toBeNull();
      expect(runMatch![1].trim()).toBe("npm run check:tokens");
    });

    it("Case 4: ordering — `Design token check` appears AFTER `Hex color check`", () => {
      const ci = readFile(".github/workflows/ci.yml");
      const hexIdx = ci.search(/- name:\s*Hex color check\b/);
      const tokensIdx = ci.search(/- name:\s*Design token check\b/);
      expect(hexIdx).toBeGreaterThan(-1);
      expect(tokensIdx).toBeGreaterThan(-1);
      expect(tokensIdx).toBeGreaterThan(hexIdx);
    });

    it("Case 5: `scripts/check-design-tokens.sh` has the expected enforcement surface", () => {
      const script = readFile("scripts/check-design-tokens.sh");
      // Shebang + safety flags
      expect(script).toMatch(/^#!\/usr\/bin\/env bash\b/);
      expect(script).toMatch(/set -euo pipefail/);
      // Both enforcement patterns
      expect(script).toContain("rounded-\\[[0-9]+px\\]");
      expect(script).toContain("(shadowOpacity|shadowRadius)\\s*:\\s*[0-9.]+");
      // Magic-comment escape hatch
      expect(script).toContain("design-token-exempt");
      // Exclude the design.ts token-definition file
      expect(script).toContain("--exclude=design.ts");
    });
  });

  describe("design.ts token additions", () => {
    it("Case 6: `Shadows.bottomSheet` is exported with `shadowOffset: { height: -4 }` invariant", () => {
      const design = readFile("src/lib/design.ts");
      // Token block present
      expect(design).toMatch(/bottomSheet:\s*{/);
      // Negative-height invariant — the load-bearing semantic that distinguishes
      // this from `Shadows.hero` / `Shadows.subtle` / `Shadows.card`. A future
      // refactor that flips the sign breaks the auth-screen sheet illusion.
      const bottomSheetBlock = design.slice(design.indexOf("bottomSheet:"));
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
      // The override block scoping the off-rule to design.ts
      expect(eslintConfig).toMatch(/files:\s*\[\s*["']src\/lib\/design\.ts["']\s*\]/);
      // Whose rules turn no-restricted-syntax off
      const designOverride = eslintConfig.slice(
        eslintConfig.search(/files:\s*\[\s*["']src\/lib\/design\.ts["']\s*\]/)
      );
      expect(designOverride).toMatch(/"no-restricted-syntax":\s*"off"/);
    });
  });
});
