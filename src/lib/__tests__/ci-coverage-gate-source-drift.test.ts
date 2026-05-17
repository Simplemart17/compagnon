/**
 * Story 15-6 — CI coverage gating drift detector.
 *
 * Pins:
 *   - `jest.config.js` has `coverageThreshold` block with 40% floor on
 *     statements + branches + functions + lines AT THREE SCOPES:
 *     `global` + `./src/lib/` + `./src/hooks/` (R1 BH-2/EH-4).
 *   - `jest.config.js` has `collectCoverageFrom` scoped to src/lib/ +
 *     src/hooks/, with `__tests__` + sibling `.test.*` + `.spec.*` + `.d.ts`
 *     all excluded (R1 EH-10).
 *   - `jest.config.js` does NOT have its coverageThreshold block wrapped
 *     in a block comment (R1 EH-1 silent-disable defense).
 *   - `package.json` has `test:coverage` script wired to `jest --coverage`.
 *   - `.github/workflows/ci.yml` has a "Tests with coverage threshold" step
 *     AFTER the existing `Tests` step, with `Upload coverage report` step
 *     immediately after (R1 BH-8).
 *   - The new step does NOT carry `continue-on-error: true` (Story 12-10
 *     R1-H2 lesson — silent-disable defense).
 *
 * Source-string drift only (Story 12-2 P12 + Story 13-2 P11 paired
 * POSITIVE+NEGATIVE pin discipline). YAML side comment-stripped; JS side
 * NOT comment-stripped (glob patterns contain `/**` sequences that the
 * block-comment regex would eat) but Case 0 NEGATIVE-guards against the
 * block-comment-wrap bypass.
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
    // block-comment regex would match across, eating the strings. Case 0
    // below replaces the strip with a targeted NEGATIVE guard against the
    // specific bypass vector (someone wrapping the threshold block in a
    // block comment).
    const jestConfig = readFile("jest.config.js");

    it("Case 0: coverageThreshold block is NOT wrapped in a block comment (R1 EH-1: silent-disable defense)", () => {
      // The drift detector intentionally doesn't comment-strip (see above),
      // which leaves a bypass: wrap the whole `coverageThreshold: { ... }`
      // block in `/* ... */`. Jest reads no threshold; the other Cases
      // still see the regex-matched text and pass vacuously.
      //
      // Defense: locate the `coverageThreshold:` token and assert the
      // ~200 chars immediately PRECEDING it do not contain `/*` without a
      // closing `*/` before the token (which would indicate the block is
      // inside a comment).
      const idx = jestConfig.indexOf("coverageThreshold:");
      expect(idx).toBeGreaterThan(-1);
      const preceding = jestConfig.slice(Math.max(0, idx - 200), idx);
      // If `/*` appears in `preceding` AND no `*/` appears between it and
      // `coverageThreshold:`, the block is commented out.
      const lastOpen = preceding.lastIndexOf("/*");
      const lastClose = preceding.lastIndexOf("*/");
      // `lastClose < lastOpen` means an unmatched opening block-comment
      // marker appears before the token — bypass detected.
      expect(lastClose).toBeGreaterThanOrEqual(lastOpen);
    });

    it("declares a coverageThreshold block with floors on all four metrics at THREE scopes: global + ./src/lib/ + ./src/hooks/", () => {
      // R1 BH-2 / EH-4 (load-bearing): per-directory thresholds enforce
      // the spec conjunction ("on src/lib AND src/hooks") that global-only
      // averaging does NOT enforce. The PER-DIRECTORY floors may differ
      // from `global` because Story 15-6 spec AC-E says "if measured is
      // below 40% on ANY metric, lower the threshold to floor-minus-3%
      // of actual coverage." For src/hooks/ this calibrated to 20/24/22/20
      // per the measured 23-27% baseline.
      //
      // Approach: extract each scope's block body via a brace-bounded
      // walker, then assert all 4 metrics + a numeric floor are present.
      // Tolerates inline comments (the calibrated src/hooks/ block has a
      // multi-line comment header) AND any ordering of metrics within
      // the block.
      const numericFloor = String.raw`\d+(?:\.\d+)?`;

      function extractScopeBody(scope: string): string {
        // Match `"<scope>": {` or `<scope>: {` and capture body via brace
        // depth counter. Returns the body text (between the `{` and the
        // matching `}`).
        const headerRegex = new RegExp(
          String.raw`(?:"?${scope.replace(/[/.]/g, "\\$&")}"?)\s*:\s*\{`
        );
        const match = jestConfig.match(headerRegex);
        if (!match || match.index === undefined) {
          throw new Error(`Scope "${scope}" not found in jest.config.js`);
        }
        const startIdx = match.index + match[0].length;
        let depth = 1;
        let i = startIdx;
        while (i < jestConfig.length && depth > 0) {
          const c = jestConfig[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          if (depth === 0) break;
          i++;
        }
        return jestConfig.slice(startIdx, i);
      }

      expect(jestConfig).toMatch(new RegExp(String.raw`coverageThreshold\s*:\s*\{`));

      // `global` scope: ALL 4 metrics MUST be at 40 (spec floor).
      const globalBody = extractScopeBody("global");
      for (const metric of ["statements", "branches", "functions", "lines"]) {
        expect(globalBody).toMatch(new RegExp(String.raw`${metric}\s*:\s*40(?:\.0+)?\b`));
      }

      // Per-directory scopes: ALL 4 metrics MUST have a numeric floor
      // (calibrated per spec AC-E). Values not hardcoded.
      for (const scope of ["./src/lib/", "./src/hooks/"]) {
        const body = extractScopeBody(scope);
        for (const metric of ["statements", "branches", "functions", "lines"]) {
          expect(body).toMatch(new RegExp(String.raw`${metric}\s*:\s*${numericFloor}\b`));
        }
      }
    });

    it("declares collectCoverageFrom scoped to src/lib/ + src/hooks/ with __tests__ + .test.* + .spec.* + .d.ts excluded (R1 EH-10)", () => {
      // Per-entry pins (not single regex) so a missing entry is reported
      // individually for clear diagnostics.
      expect(jestConfig).toMatch(/collectCoverageFrom\s*:/);
      expect(jestConfig).toMatch(/"src\/lib\/\*\*\/\*\.\{ts,tsx\}"/);
      expect(jestConfig).toMatch(/"src\/hooks\/\*\*\/\*\.\{ts,tsx\}"/);
      expect(jestConfig).toMatch(/"!\*\*\/__tests__\/\*\*"/);
      // R1 EH-10: sibling-test convention exclusions
      expect(jestConfig).toMatch(/"!\*\*\/\*\.test\.\{ts,tsx\}"/);
      expect(jestConfig).toMatch(/"!\*\*\/\*\.spec\.\{ts,tsx\}"/);
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

    it("contains `Upload coverage report` step using actions/upload-artifact (R1 BH-8/EH-2)", () => {
      // R1 BH-8 / EH-2: AC #5 called artifact upload "recommended" — added
      // in round-1 so coverage-gate failures are operationally debuggable
      // (CI logs only show text-summary aggregate; per-file diagnosis
      // requires lcov + HTML reports).
      expect(ciYml).toMatch(/- name:\s*Upload coverage report/);
      expect(ciYml).toMatch(/uses:\s*actions\/upload-artifact@v4/);
      // `if: always()` so the artifact uploads even on failure.
      expect(ciYml).toMatch(/if:\s*always\(\)/);
      // Path must be the coverage directory.
      expect(ciYml).toMatch(/path:\s*coverage\//);
    });

    it("places the coverage step AFTER the no-coverage `Tests` step (R1 BH-1: line-end anchor defends against `Tests with coverage threshold` matching first)", () => {
      // R1 BH-1 (PR #115 EH-4 lesson applied): the pre-R1 anchor
      // `indexOf("- name: Tests\n")` was fragile to trailing-whitespace
      // drift. The `\b` word-boundary alone would also match the
      // `Tests with coverage threshold` step's "Tests" prefix. Anchor
      // strictly to line-end via `/^\s{6}- name:\s*Tests\s*$/m` so
      // ordering remains correct even after Prettier/CRLF/whitespace
      // normalizations.
      const testsStepMatch = ciYml.match(/^\s{6}- name:\s*Tests\s*$/m);
      expect(testsStepMatch).not.toBeNull();
      const testsStepIdx = testsStepMatch!.index!;
      const coverageStepIdx = ciYml.indexOf("- name: Tests with coverage threshold");
      expect(coverageStepIdx).toBeGreaterThan(-1);
      expect(coverageStepIdx).toBeGreaterThan(testsStepIdx);
    });

    it("does NOT silently disable the coverage step via `continue-on-error: true` or `if:` (R1 BH-3: safer tail-slice fallback)", () => {
      // Story 12-10 R1-H2 lesson: scope the negative guard to the coverage
      // step's block, not the file. Slice from `Tests with coverage
      // threshold` to the next `- name:` header.
      //
      // R1 BH-3: if the coverage step is ever moved to be the last step,
      // the pre-R1 fallback (`restOfFile`) would sweep all the way to EOF
      // and false-positive on `Expo Doctor`'s legitimate `continue-on-error:
      // true`. Bound the slice to at most 1500 chars so a misplaced step
      // surfaces as "not found" rather than as a false-positive.
      const coverageStepIdx = ciYmlRaw.indexOf("- name: Tests with coverage threshold");
      expect(coverageStepIdx).toBeGreaterThan(-1);
      const restOfFile = ciYmlRaw.slice(coverageStepIdx);
      const nextStepIdx = restOfFile.indexOf("\n      - name:", 10);
      const MAX_BLOCK_CHARS = 1500;
      const coverageStepBlock =
        nextStepIdx === -1
          ? restOfFile.slice(0, MAX_BLOCK_CHARS)
          : restOfFile.slice(0, nextStepIdx);
      expect(coverageStepBlock).not.toMatch(/continue-on-error\s*:\s*true/);
      // The coverage step itself should have NO `if:` key. The Upload
      // step's `if: always()` is OUTSIDE the slice (after the next
      // `- name:` boundary). Pin step-level 6-space indent so `if:`
      // inside a `run:` shell script body doesn't false-flag.
      expect(coverageStepBlock).not.toMatch(/^\s{6}if\s*:/m);
    });
  });
});
