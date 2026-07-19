/**
 * Story 18-3 — daily-nudges schema drift detector.
 *
 * IMPORTANT (schema-move convention, 2026-07-19): the `supabase/migrations/`
 * directory is DEPRECATED — the database moved to the `companion` schema in a
 * shared Supabase project, and the single consolidated
 * `supabase/companion-schema.sql` (idempotent; run via Dashboard SQL editor)
 * is the DB source of truth (see
 * `_bmad-output/planning-artifacts/runbooks/companion-schema-migration.md`).
 * New DDL lands THERE, in both forms: merged into CREATE TABLE (fresh
 * installs) AND ALTER TABLE ... IF NOT EXISTS (existing deployed DBs, where
 * CREATE TABLE IF NOT EXISTS is skipped).
 *
 * Pins the Story 18-3 contract:
 *   - profiles gains daily_nudge (default true) + nudge_utc_hour
 *     (default 17, CHECK 0-23) in BOTH forms
 *   - companion.get_nudge_notification_targets(): SECURITY DEFINER +
 *     `SET search_path = companion, extensions, public` (the consolidated
 *     file's convention — NOT the deprecated `= public`) + REVOKE
 *   - the four eligibility filters incl. the 20-hour one-per-day cap
 *   - PRIVACY pin: the nudge payload sources error_patterns ONLY — pushes
 *     render on the LOCK SCREEN, so companion_memory must never join here.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SQL = readFileSync(join(__dirname, "../../../supabase/companion-schema.sql"), "utf8");

/** Strip SQL comments so prose can't satisfy (or trip) structural pins. */
const CODE_ONLY = SQL.replace(/--[^\n]*/g, "");

/** Slice the nudge-RPC body so privacy pins can't false-trip on other functions. */
function extractNudgeRpcBody(): string {
  const start = CODE_ONLY.indexOf(
    "CREATE OR REPLACE FUNCTION companion.get_nudge_notification_targets()"
  );
  expect(start).toBeGreaterThan(-1);
  const end = CODE_ONLY.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return CODE_ONLY.slice(start, end);
}

describe("Story 18-3 — daily-nudges schema drift (companion-schema.sql)", () => {
  it("Case 0: the deprecated migrations-dir path is NOT used for 18-3 DDL", () => {
    // The consolidated file is the source of truth post-schema-move; a
    // resurrected supabase/migrations/*daily_nudges* file would silently
    // never run.
    const fs = jest.requireActual("fs") as typeof import("fs");
    const migrationDir = join(__dirname, "../../../supabase/migrations");
    const stray = fs.readdirSync(migrationDir).filter((f) => f.includes("daily_nudges"));
    expect(stray).toEqual([]);
  });

  it("Case 1: CREATE TABLE form — profiles carries daily_nudge + nudge_utc_hour with CHECK", () => {
    const createTable = CODE_ONLY.slice(
      CODE_ONLY.indexOf("CREATE TABLE IF NOT EXISTS companion.profiles"),
      CODE_ONLY.indexOf("CREATE TABLE IF NOT EXISTS companion.skill_progress")
    );
    expect(createTable).toMatch(/daily_nudge\s+BOOLEAN NOT NULL DEFAULT TRUE/);
    // R1: NULLABLE, NO UTC default (a fixed default = 1-3 AM pushes for
    // APAC users); named constraint for fresh/existing parity.
    expect(createTable).toMatch(
      /nudge_utc_hour\s+SMALLINT CONSTRAINT profiles_nudge_utc_hour_range CHECK \(nudge_utc_hour BETWEEN 0 AND 23\)/
    );
    expect(createTable).toMatch(
      /tz_offset_minutes\s+SMALLINT CONSTRAINT profiles_tz_offset_range CHECK \(tz_offset_minutes BETWEEN -720 AND 840\)/
    );
    // NEGATIVE: the timezone-blind default must never regress in.
    expect(createTable).not.toMatch(/nudge_utc_hour\s+SMALLINT NOT NULL DEFAULT/);
  });

  it("Case 2: ALTER form — existing deployed DBs get the same columns idempotently", () => {
    expect(CODE_ONLY).toMatch(
      /ALTER TABLE companion\.profiles\s+ADD COLUMN IF NOT EXISTS daily_nudge BOOLEAN NOT NULL DEFAULT TRUE/
    );
    expect(CODE_ONLY).toMatch(
      /ADD COLUMN IF NOT EXISTS nudge_utc_hour SMALLINT\s+CONSTRAINT profiles_nudge_utc_hour_range CHECK \(nudge_utc_hour BETWEEN 0 AND 23\)/
    );
    expect(CODE_ONLY).toMatch(
      /ADD COLUMN IF NOT EXISTS tz_offset_minutes SMALLINT\s+CONSTRAINT profiles_tz_offset_range CHECK \(tz_offset_minutes BETWEEN -720 AND 840\)/
    );
  });

  it("Case 2b (R1 CRITICAL): notification_log type CHECK accepts 'nudge' in BOTH forms", () => {
    // Pre-fix the first nudge poisoned the entire batched log insert —
    // streak/SRS idempotency died and every eligible user was re-pushed
    // hourly.
    expect(CODE_ONLY).toMatch(
      /CONSTRAINT notification_log_type_check CHECK \(type IN \('streak','srs','nudge'\)\)/
    );
    expect(CODE_ONLY).toMatch(
      /ALTER TABLE companion\.notification_log\s+DROP CONSTRAINT IF EXISTS notification_log_type_check/
    );
    expect(CODE_ONLY).toMatch(
      /ADD CONSTRAINT notification_log_type_check CHECK \(type IN \('streak','srs','nudge'\)\)/
    );
  });

  it("Case 2c (R1): partial index bounds the hourly targets scan", () => {
    expect(CODE_ONLY).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_profiles_nudge_hour\s+ON companion\.profiles \(nudge_utc_hour\) WHERE daily_nudge/
    );
  });

  it("Case 3: RPC is companion-qualified with the consolidated-file search_path convention", () => {
    const body = extractNudgeRpcBody();
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = companion, extensions, public/);
    // R1: shared-project defense — another app's ALTER DATABASE SET
    // timezone must not shift every user's nudge hour.
    expect(body).toMatch(/SET timezone = 'UTC'/);
    // NEGATIVE: the deprecated public-only search_path must not regress in.
    expect(body).not.toMatch(/SET search_path = public\s*$/m);
  });

  it("Case 4: REVOKE from public, anon, authenticated on the companion-qualified name", () => {
    expect(CODE_ONLY).toMatch(
      /REVOKE EXECUTE ON FUNCTION companion\.get_nudge_notification_targets\(\) FROM public, anon, authenticated/
    );
  });

  it("Case 5: all eligibility filters present (R1-hardened forms)", () => {
    const body = extractNudgeRpcBody();
    expect(body).toMatch(/p\.daily_nudge = true/);
    // R1: NULL hour = not-yet-activated (client writes the evening-local
    // default when the timezone is known).
    expect(body).toMatch(/p\.nudge_utc_hour IS NOT NULL/);
    // R1: trailing 2-hour catch-up window — a missed cron run no longer
    // skips the cohort for a day (the 20h cap dedups the catch-up).
    expect(body).toMatch(/IN \(p\.nudge_utc_hour, \(p\.nudge_utc_hour \+ 1\) % 24\)/);
    // R1: last_active_date is client-LOCAL (Story 9-2) — compare against
    // the user's LOCAL today via their reported offset, not UTC.
    expect(body).toMatch(/now\(\) - make_interval\(mins => COALESCE\(p\.tz_offset_minutes, 0\)\)/);
    // NEGATIVE: the UTC-date and strict-equality forms must not regress.
    expect(body).not.toMatch(/p\.last_active_date < CURRENT_DATE/);
    expect(body).not.toMatch(/p\.nudge_utc_hour = EXTRACT/);
    expect(body).toMatch(/nl\.type = 'nudge'/);
    expect(body).toMatch(/nl\.sent_at > now\(\) - INTERVAL '20 hours'/);
  });

  it("Case 6: context payload sources unresolved error_patterns, top by occurrences", () => {
    const body = extractNudgeRpcBody();
    expect(body).toMatch(/FROM error_patterns e/);
    expect(body).toMatch(/e\.resolved = false/);
    expect(body).toMatch(/ORDER BY e\.occurrences DESC, e\.last_occurred DESC/);
    expect(body).toMatch(/LIMIT 1/);
  });

  it("Case 7: PRIVACY — companion_memory never joins the nudge payload (lock-screen surface)", () => {
    const body = extractNudgeRpcBody();
    expect(body).not.toContain("companion_memory");
  });
});
