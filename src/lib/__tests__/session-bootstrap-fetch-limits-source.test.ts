/**
 * Story 11-7 — drift detector for `[sessionId].tsx` Realtime bootstrap fetch limits.
 *
 * Story 11-7 changed the bootstrap `retrieveMemories` + `getTopErrors` limits
 * from 8 + 5 to the new `MAX_PROMPT_MEMORIES` + `MAX_PROMPT_ERROR_PATTERNS`
 * constants exported from `src/lib/prompts/conversation.ts`. This drift
 * detector reads the screen file from disk and pins:
 *
 *   1. The screen imports both constants from the conversation prompt module.
 *   2. The fetch calls consume the constants (not hardcoded literals 8 / 5).
 *   3. The pre-11-7 hardcoded `retrieveMemories(user.id, topic, 8)` and
 *      `getTopErrors(user.id, 5)` literal forms are NOT present (negative guard).
 *
 * Pattern mirrors Story 11-3's `upstream-timeout-error.test.ts` and Story 11-6's
 * `error-patterns-migration-drift.test.ts` — both real-source disk-reading
 * detectors that bypass module-level mocks.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "(tabs)",
  "conversation",
  "[sessionId].tsx"
);

const SCREEN_SOURCE = readFileSync(SCREEN_PATH, "utf8");

describe("session-bootstrap fetch limits — drift detector (Story 11-7)", () => {
  it("imports MAX_PROMPT_MEMORIES and MAX_PROMPT_ERROR_PATTERNS from the conversation prompt module", () => {
    // The import line carries both constants from the single source of truth
    // at `src/lib/prompts/conversation.ts`. A regression that re-introduces
    // hardcoded literals would drop this import; the negative guards below
    // also catch it.
    expect(SCREEN_SOURCE).toMatch(/import\s+\{[^}]*MAX_PROMPT_MEMORIES[^}]*\}/);
    expect(SCREEN_SOURCE).toMatch(/import\s+\{[^}]*MAX_PROMPT_ERROR_PATTERNS[^}]*\}/);
    expect(SCREEN_SOURCE).toMatch(/from\s+"@\/src\/lib\/prompts\/conversation"/);
  });

  it("retrieveMemories is called with MAX_PROMPT_MEMORIES (multi-line whitespace tolerant — P5)", () => {
    // P5 review-patch: pre-patch used `\s*` between commas which works for
    // single-line Prettier output but would false-fail if Prettier ever
    // reflows the call across multiple lines (long argument names, future
    // refactor adding a 4th arg, etc.). Use `[\s\S]*?` (non-greedy any-char
    // including newlines) so the matcher tolerates any whitespace + comment
    // formatting between the named identifiers.
    expect(SCREEN_SOURCE).toMatch(
      /retrieveMemories\([\s\S]*?user\.id[\s\S]*?topic[\s\S]*?MAX_PROMPT_MEMORIES[\s\S]*?\)/
    );
  });

  it("getTopErrors is called with MAX_PROMPT_ERROR_PATTERNS (multi-line whitespace tolerant — P5)", () => {
    expect(SCREEN_SOURCE).toMatch(
      /getTopErrors\([\s\S]*?user\.id[\s\S]*?MAX_PROMPT_ERROR_PATTERNS[\s\S]*?\)/
    );
  });

  it("negative guard: pre-11-7 literal `retrieveMemories(user.id, topic, 8)` is gone (multi-line tolerant)", () => {
    expect(SCREEN_SOURCE).not.toMatch(
      /retrieveMemories\([\s\S]*?user\.id[\s\S]*?topic[\s\S]*?,\s*8\s*\)/
    );
  });

  it("negative guard: pre-11-7 literal `getTopErrors(user.id, 5)` is gone (multi-line tolerant)", () => {
    expect(SCREEN_SOURCE).not.toMatch(/getTopErrors\([\s\S]*?user\.id[\s\S]*?,\s*5\s*\)/);
  });
});
