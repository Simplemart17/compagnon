/**
 * Story 18-3 — daily-nudges migration drift detector.
 *
 * Reads `supabase/migrations/20260719000000_daily_nudges.sql` from disk and
 * pins the load-bearing contract (Story 12-2 P12 comment-stripped pattern +
 * Story 13-2 P11 paired POSITIVE/NEGATIVE pin discipline):
 *   - profiles gains daily_nudge (default true) + nudge_utc_hour
 *     (default 17, CHECK 0-23)
 *   - get_nudge_notification_targets(): Story 9-9 hardening (SECURITY
 *     DEFINER + SET search_path + REVOKE from public/anon/authenticated)
 *   - the four eligibility filters: opt-in, per-user UTC hour window,
 *     no-practice-today, and the 20-hour one-per-day cap against
 *     notification_log type 'nudge'
 *   - PRIVACY pin: the payload sources error_patterns ONLY — a nudge
 *     renders on the LOCK SCREEN, so companion_memory content must NEVER
 *     enter this RPC.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SQL = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260719000000_daily_nudges.sql"),
  "utf8"
);

/** Strip SQL comments so prose can't satisfy (or trip) structural pins. */
const CODE_ONLY = SQL.replace(/--[^\n]*/g, "");

describe("Story 18-3 — daily-nudges migration drift", () => {
  it("Case 1: profiles gains daily_nudge boolean NOT NULL DEFAULT true", () => {
    expect(CODE_ONLY).toMatch(/ADD COLUMN IF NOT EXISTS daily_nudge boolean NOT NULL DEFAULT true/);
  });

  it("Case 2: profiles gains nudge_utc_hour smallint DEFAULT 17 with a 0-23 range CHECK", () => {
    expect(CODE_ONLY).toMatch(
      /ADD COLUMN IF NOT EXISTS nudge_utc_hour smallint NOT NULL DEFAULT 17/
    );
    expect(CODE_ONLY).toMatch(/CHECK \(nudge_utc_hour BETWEEN 0 AND 23\)/);
  });

  it("Case 3: RPC exists with Story 9-9 hardening (SECURITY DEFINER + search_path)", () => {
    expect(CODE_ONLY).toMatch(/CREATE OR REPLACE FUNCTION get_nudge_notification_targets\(\)/);
    expect(CODE_ONLY).toMatch(/SECURITY DEFINER/);
    expect(CODE_ONLY).toMatch(/SET search_path = public/);
  });

  it("Case 4: REVOKE from public, anon, authenticated (service_role only)", () => {
    expect(CODE_ONLY).toMatch(
      /REVOKE EXECUTE ON FUNCTION get_nudge_notification_targets\(\) FROM public, anon, authenticated/
    );
  });

  it("Case 5: all four eligibility filters present", () => {
    // Opt-in
    expect(CODE_ONLY).toMatch(/p\.daily_nudge = true/);
    // Per-user UTC hour window
    expect(CODE_ONLY).toMatch(/p\.nudge_utc_hour = EXTRACT\(HOUR FROM now\(\)\)::smallint/);
    // No practice today (NULL-tolerant for never-active users)
    expect(CODE_ONLY).toMatch(/p\.last_active_date IS NULL OR p\.last_active_date < CURRENT_DATE/);
    // 20-hour one-per-day cap against notification_log
    expect(CODE_ONLY).toMatch(/nl\.type = 'nudge'/);
    expect(CODE_ONLY).toMatch(/nl\.sent_at > now\(\) - INTERVAL '20 hours'/);
  });

  it("Case 6: context payload sources unresolved error_patterns, top by occurrences", () => {
    expect(CODE_ONLY).toMatch(/FROM error_patterns e/);
    expect(CODE_ONLY).toMatch(/e\.resolved = false/);
    expect(CODE_ONLY).toMatch(/ORDER BY e\.occurrences DESC, e\.last_occurred DESC/);
    expect(CODE_ONLY).toMatch(/LIMIT 1/);
  });

  it("Case 7: PRIVACY — companion_memory must never enter the nudge payload (lock-screen surface)", () => {
    expect(CODE_ONLY).not.toContain("companion_memory");
  });
});
