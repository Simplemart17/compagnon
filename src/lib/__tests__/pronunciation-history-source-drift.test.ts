/**
 * Story 12-12 — `use-pronunciation.ts` source-drift detector.
 *
 * Pins the post-12-12 integration contract by reading the hook source
 * from disk and asserting:
 *   (1) `appendCappedHistory` is imported from `@/src/lib/pronunciation-history`.
 *   (2) POSITIVE: `appendCappedHistory(prev.history, result)` appears TWICE
 *       — both `finishAssessment` and `assessFromUri` setState updaters.
 *   (3) NEGATIVE: the pre-12-12 `[...prev.history, result]` spread pattern
 *       is GONE (catches a regression that re-introduces the unbounded
 *       append).
 *   (4) `identifyWeakSounds(newHistory)` call is preserved (catches an
 *       accidental deletion of the aggregate computation).
 *   (5) Import line shape — whitespace-tolerant per Story 12-2 P12 lesson.
 *
 * Comment-stripping (Story 12-2 P12) is applied so JSDoc explaining the
 * deprecated pattern doesn't trip the NEGATIVE regex in Case 3.
 */

import * as fs from "fs";
import * as path from "path";

const HOOK_PATH = path.resolve(__dirname, "../../../src/hooks/use-pronunciation.ts");
const HOOK_SOURCE = fs.readFileSync(HOOK_PATH, "utf-8");

/**
 * Strip /* block * / comments + // line comments so JSDoc that mentions
 * deprecated patterns (e.g., a docstring saying "pre-12-12 we used
 * [...prev.history, result]") does not trip the negative-guard regex in
 * Case 3. (Story 12-2 P12 lesson.)
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const HOOK_CODE_ONLY = stripComments(HOOK_SOURCE);

describe("use-pronunciation.ts — Story 12-12 source-drift detector", () => {
  it("Case 1: imports `appendCappedHistory` from `@/src/lib/pronunciation-history`", () => {
    expect(HOOK_CODE_ONLY).toMatch(
      /import\s*\{\s*appendCappedHistory[\s\S]*?\}\s*from\s*["']@\/src\/lib\/pronunciation-history["']/
    );
  });

  it("Case 2: POSITIVE — `appendCappedHistory(prev.history, result)` appears TWICE (both setState updaters)", () => {
    // Both `finishAssessment` and `assessFromUri` route through the
    // helper. Globally count occurrences in the comment-stripped source
    // to defend against a future refactor that drops one call site
    // without dropping the other.
    //
    // Review-round-1 M1 patch: loosened regex to (a) tolerate optional
    // chaining `prev?.history` (a future defensive guard), (b) accept
    // any identifier as the second argument (so a benign rename of
    // `result` → `assessmentResult` doesn't break this guard despite
    // contract preservation).
    const matches = HOOK_CODE_ONLY.match(
      /appendCappedHistory\s*\(\s*prev\??\.history\s*,\s*\w+\s*\)/g
    );
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(2);
  });

  it("Case 3: NEGATIVE — pre-12-12 unbounded-append patterns are GONE", () => {
    // The exact pre-12-12 leak shape `[...prev.history, result]` is the
    // primary regression target. Review-round-1 M1 patch ALSO guards
    // against alternative unbounded-append idioms a future contributor
    // might reach for (e.g., `prev.history.concat(...)`) that would
    // re-introduce the same defect via a different syntax.
    //
    // Whitespace-tolerant — catches formatter variations like
    // `[...prev.history,result]` or `[ ...prev.history , result ]`.

    // (a) Original pre-12-12 spread pattern (loosened to accept any
    //     identifier as the appended value).
    expect(HOOK_CODE_ONLY).not.toMatch(/\[\s*\.\.\.\s*prev\??\.history\s*,\s*\w+\s*\]/);

    // (b) Alternative leak pattern: `.concat()` on history.
    expect(HOOK_CODE_ONLY).not.toMatch(/prev\??\.history\.concat\s*\(/);
  });

  it("Case 4: `identifyWeakSounds(<any-identifier>)` call is preserved at TWO sites", () => {
    // The aggregate computation is the load-bearing diagnostic. A future
    // refactor that drops the call without replacing it loses the
    // weak-phoneme surface entirely.
    //
    // Review-round-1 M1 patch: loosened the argument regex from the
    // hardcoded `newHistory` to `\w+` so a benign rename (e.g.,
    // `newHistory` → `cappedHistory`) doesn't break this guard despite
    // contract preservation.
    const matches = HOOK_CODE_ONLY.match(/identifyWeakSounds\s*\(\s*\w+\s*\)/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(2);
  });

  it("Case 5: import line shape — `appendCappedHistory` is a named import from the helper module", () => {
    // Tighter check than Case 1: ensure the import statement is a clean
    // named import (no `* as` alias) so the call sites in Case 2 are
    // unambiguous about which symbol they reference.
    expect(HOOK_CODE_ONLY).toMatch(
      /import\s*\{[^}]*\bappendCappedHistory\b[^}]*\}\s*from\s*["']@\/src\/lib\/pronunciation-history["']/
    );
  });
});
