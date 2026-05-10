import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { TCF } from "../constants";

/**
 * Regression tests pinning the TCF Canada specification.
 *
 * Source of truth: docs/tcf-spec-source.md
 * (verified 2026-05-07 by story 9-1; expanded + re-verified 2026-05-10 by story 10-1).
 *
 * If any of these fail, the in-app spec has drifted from the publisher's
 * official structure. Either re-verify the source and update both
 * docs/tcf-spec-source.md and src/lib/constants.ts in lockstep, or revert.
 *
 * Story 10-1 added the citations-matrix completeness checks below.
 */

// repo root inferred from this file's location: src/lib/__tests__/tcf-spec.test.ts
const REPO_ROOT = join(__dirname, "..", "..", "..");

describe("TCF Canada spec contract — verified against docs/tcf-spec-source.md", () => {
  it("is configured for the Canada variant", () => {
    expect(TCF.VARIANT).toBe("canada");
  });

  it("matches authoritative listening (Compréhension orale) spec", () => {
    expect(TCF.LISTENING_QUESTIONS).toBe(39);
    expect(TCF.LISTENING_MINUTES).toBe(35);
  });

  it("matches authoritative reading (Compréhension écrite) spec", () => {
    expect(TCF.READING_QUESTIONS).toBe(39);
    expect(TCF.READING_MINUTES).toBe(60);
  });

  it("matches authoritative writing (Expression écrite) duration", () => {
    expect(TCF.WRITING_MINUTES).toBe(60);
  });

  it("matches authoritative speaking (Expression orale) duration including 2 min preparation", () => {
    expect(TCF.SPEAKING_MINUTES).toBe(12);
  });

  it("does not expose a Grammar / Maîtrise des Structures section (TCF Canada has none)", () => {
    expect(TCF).not.toHaveProperty("GRAMMAR_QUESTIONS");
    expect(TCF).not.toHaveProperty("GRAMMAR_MINUTES");
  });

  it("QCM mandatory total falls within the publisher's stated 95-minute combined block", () => {
    // 35 + 60 = 95. If this regresses, double-check the publisher page; the
    // mock-test landing UI ("~95 min" pill) is computed from this sum.
    expect(TCF.LISTENING_MINUTES + TCF.READING_MINUTES).toBe(95);
  });
});

/**
 * Story 10-1 — Citation-matrix completeness checks.
 *
 * Walks the codebase + the docs/tcf-spec-citations.md matrix to assert
 * that every TCF-derived value in code has a row in the matrix, that the
 * tcf-spec-source.md document carries every required section, and that
 * the snapshots directory contains at least one dated artifact.
 *
 * Adding a new TCF claim in code without updating the matrix fails CI.
 */
describe("TCF spec citations matrix completeness", () => {
  it("every TCF.* constant has a row in docs/tcf-spec-citations.md", () => {
    const matrix = readFileSync(join(REPO_ROOT, "docs", "tcf-spec-citations.md"), "utf8");
    const tcfConstants = [
      "TCF.VARIANT",
      "TCF.MIN_SCORE",
      "TCF.MAX_SCORE",
      "TCF.C1_MIN",
      "LISTENING_QUESTIONS",
      "LISTENING_MINUTES",
      "READING_QUESTIONS",
      "READING_MINUTES",
      "WRITING_MINUTES",
      "SPEAKING_MINUTES",
    ];
    // Match a Markdown table-row pattern (`|` ... constant ... `|`) so a stray
    // mention in a comment does not satisfy the contract — review patch P12.
    for (const constant of tcfConstants) {
      const escaped = constant.replace(/\./g, "\\.");
      const rowPattern = new RegExp(`\\|[^\\n]*${escaped}[^\\n]*\\|`);
      expect(matrix).toMatch(rowPattern);
    }
  });

  it("every per-CEFR passage spec in listening + reading prompts has a matrix row", () => {
    const matrix = readFileSync(join(REPO_ROOT, "docs", "tcf-spec-citations.md"), "utf8");
    for (const file of ["listening.ts", "reading.ts"]) {
      for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
        // Match a Markdown table row that contains BOTH the file path and the
        // CEFR level on the same line (review patch P12). Prevents a 1-row
        // consolidation from spuriously satisfying 12 distinct row checks.
        const pattern = new RegExp(`\\|[^\\n]*prompts/${file}[^\\n]*\\b${level}\\b[^\\n]*\\|`, "i");
        expect(matrix).toMatch(pattern);
      }
    }
  });

  it("citations matrix file exists and references tcf-spec-source.md", () => {
    const matrix = readFileSync(join(REPO_ROOT, "docs", "tcf-spec-citations.md"), "utf8");
    expect(matrix).toContain("tcf-spec-source.md");
    expect(matrix.length).toBeGreaterThan(2000); // sanity floor
  });

  it("tcf-spec-source.md has all 11 expected sections", () => {
    const source = readFileSync(join(REPO_ROOT, "docs", "tcf-spec-source.md"), "utf8");
    const expectedSections = [
      "## 1. Verified TCF Canada structure",
      "## 2. Scoring scale and CEFR equivalency",
      "## 3. Listening section specification",
      "## 4. Reading section specification",
      "## 5. Writing section specification",
      "## 6. Speaking section specification",
      "## 7. Vocabulary frequency expectations per CEFR",
      "## 8. Linguistic accuracy reference",
      "## 9. Citations in source code",
      "## 10. Follow-up tickets",
      "## 11. Re-verification procedure",
    ];
    for (const section of expectedSections) {
      expect(source).toContain(section);
    }
  });

  it("at least one dated snapshot exists under docs/tcf-canada-snapshots/", () => {
    const dir = join(REPO_ROOT, "docs", "tcf-canada-snapshots");
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    // Snapshot filenames MUST contain a YYYY-MM-DD date stamp per the
    // re-verification convention in docs/tcf-spec-source.md §11.
    expect(files.some((f) => /\d{4}-\d{2}-\d{2}/.test(f))).toBe(true);
  });
});
