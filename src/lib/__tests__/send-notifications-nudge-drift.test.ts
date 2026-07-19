/**
 * Story 18-3 — send-notifications nudge-type drift detector.
 *
 * Reads the Deno Edge Function source from disk (Story 11-3 real-source
 * drift pattern) and pins the third notification type's integration:
 * RPC dispatch, message shape (deep-link target + EN chrome), log type,
 * summary field, and the lock-screen privacy + truncation contract.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/send-notifications/index.ts"),
  "utf8"
);

/** Strip // and /* *\/ comments so prose can't satisfy structural pins. */
const CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("Story 18-3 — send-notifications nudge drift", () => {
  it("Case 1: dispatches the nudge targets RPC", () => {
    expect(CODE_ONLY).toMatch(/\.rpc\("get_nudge_notification_targets"\)/);
  });

  it("Case 2: nudge messages deep-link to the conversation screen", () => {
    expect(CODE_ONLY).toMatch(/data: \{ screen: "conversation" \}/);
  });

  it("Case 3: nudge sends are logged with type 'nudge' (idempotency backbone for the RPC's 20h cap)", () => {
    expect(CODE_ONLY).toMatch(/type: "nudge"/);
    // And the in-run 1h belt uses the same key shape as streak/srs.
    expect(CODE_ONLY).toMatch(/recentlyNotified\.has\(`\$\{row\.user_id\}:nudge`\)/);
  });

  it("Case 4: summary exposes nudgeNotifications for operator log-grepping", () => {
    expect(CODE_ONLY).toMatch(/nudgeNotifications: nudgeTokensSent\.size/);
  });

  it("Case 5: composeNudgeBody exists with the 60-char lock-screen snippet cap", () => {
    expect(CODE_ONLY).toMatch(/function composeNudgeBody\(row: NudgeRow\): string/);
    expect(CODE_ONLY).toMatch(/NUDGE_ERROR_SNIPPET_MAX = 60/);
  });

  it("Case 6: nudge rows participate in the invalid-token guard + tokenToUser log enrichment", () => {
    expect(CODE_ONLY).toMatch(
      /if \(nudgeRows\) \{\s*for \(const row of nudgeRows\) tokenToUser\.set\(row\.token, row\.user_id\);/
    );
  });

  it("Case 7: PRIVACY — the function never touches companion_memory (lock-screen surface)", () => {
    expect(CODE_ONLY).not.toContain("companion_memory");
  });

  it("Case 8: nudge query failures are isolated (queryErrors++, no throw) like streak/SRS", () => {
    expect(CODE_ONLY).toMatch(/nudge query failed/);
  });
});
