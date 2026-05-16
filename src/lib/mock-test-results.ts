/**
 * Story 14-7 — pure helpers for the mock-test landing screen.
 *
 * - `formatTimeRemaining(seconds)` — used in the Resume row description.
 * - `formatPastResultDate(iso)` — used in past-results row description.
 * - `formatPastResultDuration(seconds)` — used in past-results row description.
 * - `reconstructTestResultsFromMockTestRow(row)` — converts a stored
 *   `mock_tests` row's `section_scores` JSONB into the `TestResults` shape
 *   consumed by `app/(tabs)/mock-test/results.tsx`. Returns `null` on
 *   malformed input (caller surfaces UI error).
 *
 * No React, no Supabase — purely synchronous. Easy to unit-test at the
 * boundary; runs in microsecond range.
 *
 * Closes audit P2-13 architecturally as a building block for the landing
 * screen's "Resume in-progress" + "Past results" sections.
 */

import { addBreadcrumb } from "@/src/lib/sentry";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of the `mock_tests` table row consumed by the landing screen +
 * results-loader hook. Matches the column shape from
 * `supabase/migrations/20260301000000_initial_schema.sql:164-176`.
 */
export interface MockTestRow {
  id: string;
  user_id: string;
  test_type: string;
  total_score: number | null;
  section_scores: unknown; // JSONB — runtime-validated by reconstructTestResultsFromMockTestRow
  cefr_result: string | null;
  duration_seconds: number | null;
  questions: unknown;
  status: string;
  created_at: string;
  completed_at: string | null;
}

/**
 * Subset of the `section_scores` JSONB body that the results screen consumes.
 * The full shape includes other fields (mock-test save state — answers,
 * currentSectionIndex, etc.) which we intentionally ignore here.
 */
interface SectionResultPayload {
  score: number;
  correct: number;
  total: number;
  tcfScore: number;
  cefrLevel: string;
}

/**
 * Mirror of `TestResults` in `app/(tabs)/mock-test/results.tsx:24-29`. Kept
 * here as a separate type so this module has zero React dependencies. The
 * results screen reads this shape via `JSON.parse(params.data)`.
 */
export interface TestResultsPayload {
  sections: Record<string, SectionResultPayload>;
  overallTcfScore: number;
  overallCefrLevel: string;
  testType: string;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Format a seconds-remaining value for the Resume row description.
 * - `seconds <= 0` → `"Time's up"`
 * - `seconds < 60` → `"<1 min remaining"`
 * - else → `"~N min remaining"` where N = round(seconds / 60)
 *
 * @internal — exported for runtime tests.
 */
export function formatTimeRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Time's up";
  if (seconds < 60) return "<1 min remaining";
  return `~${Math.round(seconds / 60)} min remaining`;
}

/**
 * Format an ISO timestamp as a compact en-locale short date — e.g.
 * `"May 14"`. Story 14-1 R1-M5 chrome rule: locale is hardcoded `"en"`,
 * NEVER `"fr"`. Returns `"—"` for invalid input.
 *
 * @internal — exported for runtime tests.
 */
export function formatPastResultDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/**
 * Format a duration in seconds as a compact `"N min"` string. `null` →
 * `"—"`. Rounds to nearest minute. Negative values clamp to 0.
 *
 * @internal — exported for runtime tests.
 */
export function formatPastResultDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  return `${Math.max(0, Math.round(seconds / 60))} min`;
}

// ---------------------------------------------------------------------------
// section_scores → TestResults reconstruction
// ---------------------------------------------------------------------------

const VALID_CEFR_LEVELS: ReadonlySet<string> = new Set<CEFRLevel>([
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
]);

function isSectionResultPayload(value: unknown): value is SectionResultPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.score === "number" &&
    typeof v.correct === "number" &&
    typeof v.total === "number" &&
    typeof v.tcfScore === "number" &&
    typeof v.cefrLevel === "string"
  );
}

/**
 * Reconstruct a `TestResultsPayload` (the shape consumed by
 * `results.tsx` via `JSON.parse(params.data)`) from a stored `mock_tests`
 * row.
 *
 * The `mock_tests.section_scores` JSONB stores BOTH the save-state
 * payload (answers, currentSectionIndex, savedAt, ...) AND the final
 * per-section scores (when the test was completed). We surface only the
 * latter and let the results screen consume it.
 *
 * Returns `null` on malformed input — fires a Sentry warning breadcrumb
 * (no PII) so operators can grep for drift in stored payloads.
 *
 * @internal — exported for runtime tests.
 */
export function reconstructTestResultsFromMockTestRow(row: MockTestRow): TestResultsPayload | null {
  if (row.section_scores === null || typeof row.section_scores !== "object") {
    addBreadcrumb({
      category: "mock-test",
      level: "warning",
      message: "Landing: reconstructTestResultsFromMockTestRow validation failed",
      data: { mockTestId: row.id, reason: "missing-section-scores" },
    });
    return null;
  }

  const ss = row.section_scores as Record<string, unknown>;

  // Find per-section score payloads. The valid keys are the section names
  // (`listening`, `reading`, etc.) but `section_scores` ALSO contains
  // save-state keys like `answers`, `currentSectionIndex`, `savedAt`.
  // We filter to entries that match the SectionResultPayload shape.
  const sections: Record<string, SectionResultPayload> = {};
  for (const [key, value] of Object.entries(ss)) {
    if (isSectionResultPayload(value)) {
      sections[key] = value;
    }
  }

  if (Object.keys(sections).length === 0) {
    addBreadcrumb({
      category: "mock-test",
      level: "warning",
      message: "Landing: reconstructTestResultsFromMockTestRow validation failed",
      data: { mockTestId: row.id, reason: "no-section-results" },
    });
    return null;
  }

  // overallCefrLevel: prefer the row's `cefr_result` column; fall back to
  // the highest CEFR level found across sections (alphabetical ordering
  // accidentally matches CEFR ordering A1→C2 — but we use the explicit
  // CEFR_LEVELS index for correctness).
  const cefrFromRow =
    row.cefr_result !== null && VALID_CEFR_LEVELS.has(row.cefr_result) ? row.cefr_result : null;
  const overallCefrLevel = cefrFromRow ?? "A1";

  // overallTcfScore: prefer the row's `total_score` column; fall back to
  // the average of section tcfScores.
  let overallTcfScore: number;
  if (row.total_score !== null && Number.isFinite(row.total_score)) {
    overallTcfScore = row.total_score;
  } else {
    const sectionScores = Object.values(sections).map((s) => s.tcfScore);
    overallTcfScore =
      sectionScores.length > 0
        ? Math.round(sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length)
        : 0;
  }

  return {
    sections,
    overallTcfScore,
    overallCefrLevel,
    testType: row.test_type,
  };
}
