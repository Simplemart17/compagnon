/**
 * Story 12-2 — Drift detector for the pure-consumer hook contract.
 *
 * Pre-12-2 `src/hooks/use-auth.ts` was 359 lines and installed a listener
 * inside `useEffect`. Post-12-2 the hook is a pure consumer with no
 * `useEffect`, no listener install, no closures. This drift detector reads
 * the hook source from disk and pins those negative-guards via regex so a
 * future refactor that re-introduces business logic into the hook fails CI
 * loudly.
 *
 * Pattern matches Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 / 12-1 drift
 * detectors (read source from disk + assert positive AND negative guards).
 */

import { readFileSync } from "fs";
import { join } from "path";

const HOOK_PATH = join(__dirname, "..", "use-auth.ts");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf-8");
const HOOK_LINE_COUNT = HOOK_SOURCE.split("\n").length;

/**
 * Strip block comments (`/* ... *\/`) and line comments (`// ...`) from
 * the hook source so the negative-guard regexes test the CODE only.
 * Without this, JSDoc that legitimately mentions e.g. "pre-12-2 installed
 * the listener inside `useEffect`" would trip the negative-guard.
 */
const HOOK_CODE_ONLY = HOOK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Spec target: ~40-60 lines. Budget: 80.
const LINE_BUDGET = 80;
// Sanity lower bound — anything below this means the file was accidentally
// truncated to less than the import block + hook signature + return shape.
const LINE_FLOOR = 30;

describe("Story 12-2 — use-auth.ts line-budget drift detector", () => {
  it(`Case 1: line count is within budget (≤ ${LINE_BUDGET}); current = ${HOOK_LINE_COUNT}`, () => {
    expect(HOOK_LINE_COUNT).toBeLessThanOrEqual(LINE_BUDGET);
  });

  it(`Case 2: line count sanity floor (≥ ${LINE_FLOOR}); current = ${HOOK_LINE_COUNT}`, () => {
    expect(HOOK_LINE_COUNT).toBeGreaterThan(LINE_FLOOR);
  });

  it("Case 3: hook imports from @/src/lib/auth-bootstrap (action methods + applyProfileIfFresh)", () => {
    expect(HOOK_SOURCE).toMatch(/from\s+["']@\/src\/lib\/auth-bootstrap["']/);
  });

  it("Case 4: hook does NOT contain `useEffect` (negative-guard against pre-12-2 listener install)", () => {
    expect(HOOK_CODE_ONLY).not.toMatch(/\buseEffect\b/);
  });

  it("Case 5: hook does NOT import supabase directly (auth listener is owned by bootstrap)", () => {
    expect(HOOK_CODE_ONLY).not.toMatch(/from\s+["']@\/src\/lib\/supabase["']/);
  });

  it("Case 6: hook does NOT call onAuthStateChange (architectural negative-guard)", () => {
    expect(HOOK_CODE_ONLY).not.toMatch(/onAuthStateChange/);
  });

  it("Case 7: hook does NOT call getSession (cold-start is owned by bootstrap)", () => {
    expect(HOOK_CODE_ONLY).not.toMatch(/getSession/);
  });

  it("Case 8: hook uses per-field selectors (useAuthStore((s) => s.X) pattern, not single destructure)", () => {
    // Review-round-1 P8: tolerate optional type annotation on the
    // parameter (e.g., `(s: AuthState) =>`) and a renamed param (`state`
    // instead of `s`). The body still has to read a single property off
    // the param, but the regex no longer breaks on benign typing changes.
    const matches =
      HOOK_CODE_ONLY.match(
        /useAuthStore\(\((?:s|state)(?:\s*:\s*\w+)?\)\s*=>\s*\w+\.[a-zA-Z]+\)/g
      ) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });
});
