/**
 * Story 15-6 — CI coverage gating drift detector.
 *
 * Pins:
 *   - `jest.config.js` has `coverageThreshold` block with 40% floor on
 *     statements + branches + functions + lines.
 *   - `jest.config.js` has `collectCoverageFrom` scoped to src/lib/ + src/hooks/.
 *   - `package.json` has `test:coverage` script wired to `jest --coverage`.
 *   - `.github/workflows/ci.yml` has a "Tests with coverage threshold" step
 *     AFTER the existing `Tests` step.
 *   - The new step does NOT carry `continue-on-error: true` (Story 12-10
 *     R1-H2 lesson — silent-disable defense).
 *
 * Source-string drift only (Story 12-2 P12 + Story 13-2 P11 paired
 * POSITIVE+NEGATIVE pin discipline). Comment-stripped read so future
 * documentation that mentions deleted patterns doesn't false-positive.
 */
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
}

/** Strip YAML `#` comments to the end of line. */
function stripYamlComments(src: string): string {
  return src.replace(/(^|\s)#.*$/gm, "$1");
}

describe("Story 15-6 — CI coverage gating source drift", () => {
  describe("jest.config.js — coverage configuration", () => {
    // Intentionally NOT comment-stripped: the glob patterns
    // `"src/lib/**/*.{ts,tsx}"` contain `/**` and `/*` sequences that the
    // block-comment regex would match across, eating the strings. The
    // current jest.config.js comments don't false-positive these
    // assertions — if a future comment introduces drift, narrow the
    // regexes instead of broadening the strip.
    const jestConfig = readFile("jest.config.js");

    it("declares a coverageThreshold block with a 40% floor on all four metrics", () => {
      // Single regex pins the whole block so a partial-drop (e.g., dropping
      // `branches`) fails CI. Whitespace-tolerant.
      const thresholdBlockRegex =
        /coverageThreshold\s*:\s*\{\s*global\s*:\s*\{\s*statements\s*:\s*40\s*,\s*branches\s*:\s*40\s*,\s*functions\s*:\s*40\s*,\s*lines\s*:\s*40\s*,?\s*\}\s*,?\s*\}/;
      expect(jestConfig).toMatch(thresholdBlockRegex);
    });

    it("declares collectCoverageFrom scoped to src/lib/ + src/hooks/ with __tests__ + .d.ts excluded", () => {
      // Per-entry pins (not single regex) so a missing entry is reported
      // individually for clear diagnostics.
      expect(jestConfig).toMatch(/collectCoverageFrom\s*:/);
      expect(jestConfig).toMatch(/"src\/lib\/\*\*\/\*\.\{ts,tsx\}"/);
      expect(jestConfig).toMatch(/"src\/hooks\/\*\*\/\*\.\{ts,tsx\}"/);
      expect(jestConfig).toMatch(/"!\*\*\/__tests__\/\*\*"/);
      expect(jestConfig).toMatch(/"!\*\*\/\*\.d\.ts"/);
    });
  });

  describe("package.json — test:coverage script", () => {
    const pkgJson = JSON.parse(readFile("package.json"));

    it("declares a test:coverage script wired to `jest --coverage`", () => {
      expect(pkgJson.scripts["test:coverage"]).toBe("jest --coverage");
    });
  });

  describe(".github/workflows/ci.yml — coverage step", () => {
    const ciYmlRaw = readFile(".github/workflows/ci.yml");
    const ciYml = stripYamlComments(ciYmlRaw);

    it("contains the canonical `Tests with coverage threshold` step running `npm run test:coverage`", () => {
      expect(ciYml).toMatch(/- name:\s*Tests with coverage threshold/);
      // The run command must be the exact canonical script (catches a
      // future regression that inlines `jest --coverage --threshold=20`
      // bypassing the source-of-truth in jest.config.js).
      expect(ciYml).toMatch(/run:\s*npm run test:coverage/);
    });

    it("places the coverage step AFTER the no-coverage `Tests` step", () => {
      // Story 12-10 R1-M1 lesson: assert ordering via indexOf comparison
      // anchored to the exact step-name strings (defends against rename).
      const testsStepIdx = ciYml.indexOf("- name: Tests\n");
      const coverageStepIdx = ciYml.indexOf("- name: Tests with coverage threshold");
      expect(testsStepIdx).toBeGreaterThan(-1);
      expect(coverageStepIdx).toBeGreaterThan(-1);
      expect(coverageStepIdx).toBeGreaterThan(testsStepIdx);
    });

    it("does NOT silently disable the coverage step via `continue-on-error: true` or `if:`", () => {
      // Story 12-10 R1-H2 lesson: scope the negative guard to the coverage
      // step's block, not the file. Slice from `Tests with coverage
      // threshold` to the next `- name:` header.
      const coverageStepIdx = ciYmlRaw.indexOf("- name: Tests with coverage threshold");
      expect(coverageStepIdx).toBeGreaterThan(-1);
      const restOfFile = ciYmlRaw.slice(coverageStepIdx);
      const nextStepIdx = restOfFile.indexOf("\n      - name:", 10);
      const coverageStepBlock = nextStepIdx === -1 ? restOfFile : restOfFile.slice(0, nextStepIdx);
      expect(coverageStepBlock).not.toMatch(/continue-on-error\s*:\s*true/);
      expect(coverageStepBlock).not.toMatch(/^\s*if\s*:/m);
    });
  });
});
