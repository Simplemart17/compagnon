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
    expect(createTable).toMatch(
      /nudge_utc_hour\s+SMALLINT NOT NULL DEFAULT 17 CHECK \(nudge_utc_hour BETWEEN 0 AND 23\)/
    );
  });

  it("Case 2: ALTER form — existing deployed DBs get the same columns idempotently", () => {
    expect(CODE_ONLY).toMatch(
      /ALTER TABLE companion\.profiles\s+ADD COLUMN IF NOT EXISTS daily_nudge BOOLEAN NOT NULL DEFAULT TRUE/
    );
    expect(CODE_ONLY).toMatch(
      /ADD COLUMN IF NOT EXISTS nudge_utc_hour SMALLINT NOT NULL DEFAULT 17\s+CONSTRAINT profiles_nudge_utc_hour_range CHECK \(nudge_utc_hour BETWEEN 0 AND 23\)/
    );
  });

  it("Case 3: RPC is companion-qualified with the consolidated-file search_path convention", () => {
    const body = extractNudgeRpcBody();
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = companion, extensions, public/);
    // NEGATIVE: the deprecated public-only search_path must not regress in.
    expect(body).not.toMatch(/SET search_path = public\s*$/m);
  });

  it("Case 4: REVOKE from public, anon, authenticated on the companion-qualified name", () => {
    expect(CODE_ONLY).toMatch(
      /REVOKE EXECUTE ON FUNCTION companion\.get_nudge_notification_targets\(\) FROM public, anon, authenticated/
    );
  });

  it("Case 5: all four eligibility filters present", () => {
    const body = extractNudgeRpcBody();
    expect(body).toMatch(/p\.daily_nudge = true/);
    expect(body).toMatch(/p\.nudge_utc_hour = EXTRACT\(HOUR FROM now\(\)\)::smallint/);
    expect(body).toMatch(/p\.last_active_date IS NULL OR p\.last_active_date < CURRENT_DATE/);
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
