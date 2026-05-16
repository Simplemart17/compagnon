/**
 * Story 14-7 — landing-screen data hook for the mock-test tab.
 *
 * Fires 2 parallel supabase queries via `Promise.all`:
 *   1. In-progress: most recent `mock_tests` row with `status = "in_progress"`
 *      (filtered to non-corrupt via the same logic as Story 13-4's
 *      `use-mock-test-generation.ts:300+` resume detection).
 *   2. Past results: latest 10 `mock_tests` rows with `status = "completed"`
 *      and non-null `completed_at`, ordered DESC by `completed_at`.
 *
 * Why not consolidated into an RPC (Story 13-2 pattern)?
 *   The mock-test landing has only 2 queries — over-engineering to bundle.
 *   If telemetry later shows the 2-query pattern matters, `14-7-followup-
 *   mock-test-landing-rpc` is filed.
 *
 * On error: route through `captureError(_, "mock-test-landing-fetch")`
 * (Story 9-3 allowlist; `feature` tag short categorical < 80 chars).
 *
 * On past-results truncation at exactly 10 rows: fire info breadcrumb so
 * operators can grep for "users with more than 10 completed mock tests"
 * (heuristic — exact count would need a separate `count()` query, out of
 * scope for v1).
 *
 * Public API:
 *   - `inProgress`: `MockTestInProgressSummary | null`
 *   - `pastResults`: `MockTestPastResult[]` (max 10)
 *   - `loading`: boolean
 *   - `error`: unknown
 *   - `refetch`: () => Promise<void>
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { captureError, addBreadcrumb } from "@/src/lib/sentry";
import { TCF_QCM_SECTIONS, type QcmSection } from "@/src/lib/tcf";
import type { MCQContent } from "@/src/types/exercise";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MockTestInProgressSummary {
  /** The `mock_tests.id` of the resumed row. */
  id: string;
  /** Resumed test_type — only QCM variants surface for resume in v1. */
  testType: "full" | "listening" | "reading";
  /** Clamped `currentSectionIndex` against the test's sections array. */
  savedSectionIndex: number;
  /** Clamped `currentQuestionIndex` against the section's questions array. */
  savedQuestionIndex: number;
  /** Seconds remaining (already adjusted for elapsed-since-save). */
  adjustedTimeRemaining: number;
  /** Count of `(section, question)` keys in `answeredQuestions`. */
  totalQuestionsAnswered: number;
  /** Sum of `questions.length` across all sections that have content. */
  totalQuestionsAcrossSections: number;
  /** ISO timestamp from `mock_tests.created_at`. */
  createdAt: string;
}

// R1-P2: Speaking past-results are EXCLUDED from v1 — Story 9-8 stores
// section_scores in a per-task shape (`{speaking:{task1,task2,task3,compositeOverall}}`)
// that `reconstructTestResultsFromMockTestRow` can't handle. Including them
// would surface "malformed score record" Alerts on every tap. When a
// speaking-results detail screen ships, add `"speaking"` back to
// `PastResultTestType` + `PAST_RESULT_TEST_TYPES` below + add a speaking
// branch in `reconstructTestResultsFromMockTestRow`.
export type PastResultTestType = "full" | "listening" | "reading";

export interface MockTestPastResult {
  id: string;
  testType: PastResultTestType;
  /**
   * TCF score (0-699). `null` for `speaking` (publisher uses 0-20 scale —
   * landing surfaces the CEFR badge only for speaking, per AC-C3).
   */
  totalScore: number | null;
  /** CEFR level (A1-C2). `null` when score wasn't computed. */
  cefrResult: CEFRLevel | null;
  /** Duration in seconds (null if not recorded). */
  durationSeconds: number | null;
  /** ISO timestamp from `mock_tests.completed_at` (non-null by query filter). */
  completedAt: string;
}

export interface UseMockTestLandingReturn {
  inProgress: MockTestInProgressSummary | null;
  pastResults: MockTestPastResult[];
  loading: boolean;
  error: unknown;
  refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAST_RESULTS_LIMIT = 10;
const RESUME_TEST_TYPES: ReadonlySet<string> = new Set(["full", "listening", "reading"]);
// R1-P2: speaking excluded — see PastResultTestType JSDoc above.
const PAST_RESULT_TEST_TYPES: ReadonlySet<string> = new Set(["full", "listening", "reading"]);
const VALID_CEFR_LEVELS: ReadonlySet<string> = new Set<CEFRLevel>([
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
]);

// ---------------------------------------------------------------------------
// In-progress validation (mirrors Story 13-4 resume corrupt detection)
// ---------------------------------------------------------------------------

interface InProgressValidationResult {
  summary: MockTestInProgressSummary | null;
  corrupt: boolean;
}

/**
 * Validate an in-progress row using the same `hasValidQuestions` heuristic
 * as `use-mock-test-generation.ts:320-323` — at least one section in the
 * test's sections array must have a non-empty questions array. If the row
 * is "corrupt" (no valid questions), return `{ summary: null, corrupt: true }`
 * so the caller can fire the warning breadcrumb without recursively
 * importing that hook's full corrupt-detection pipeline.
 *
 * @internal
 */
export function validateInProgressRow(row: {
  id: string;
  test_type: string;
  questions: unknown;
  section_scores: unknown;
  created_at: string;
}): InProgressValidationResult {
  // Test type must be a QCM variant (full/listening/reading) — speaking
  // tests don't use the section-resume model.
  if (!RESUME_TEST_TYPES.has(row.test_type)) {
    return { summary: null, corrupt: false };
  }
  const testType = row.test_type as "full" | "listening" | "reading";

  const rawQuestions =
    row.questions !== null && typeof row.questions === "object"
      ? (row.questions as Record<string, unknown>)
      : {};
  const resumedQuestions: Record<QcmSection, MCQContent[]> = {
    listening: Array.isArray(rawQuestions.listening)
      ? (rawQuestions.listening as MCQContent[])
      : [],
    reading: Array.isArray(rawQuestions.reading) ? (rawQuestions.reading as MCQContent[]) : [],
  };

  // Derive sections for this test_type (matches the test-runner mapping).
  const sections: QcmSection[] =
    testType === "full" ? ["listening", "reading"] : [testType as QcmSection];

  const hasValidQuestions = sections.some(
    (s) => Array.isArray(resumedQuestions[s]) && resumedQuestions[s].length > 0
  );
  if (!hasValidQuestions) {
    return { summary: null, corrupt: true };
  }

  // Parse save-state shape (defensive — same fields as Story 13-4).
  const ss =
    row.section_scores !== null && typeof row.section_scores === "object"
      ? (row.section_scores as {
          answers?: Record<string, string>;
          currentSectionIndex?: number;
          currentQuestionIndex?: number;
          timeRemaining?: number;
          savedAt?: number;
          answeredQuestions?: string[];
        })
      : {};

  // R1-P1: save-state gate — Story 13-4's resume detection at
  // `use-mock-test-generation.ts:302` requires BOTH `questions` AND
  // `section_scores.answers` to be present before resuming. A row with
  // `questions: [...]` but `section_scores: null` (user started a test and
  // backed out before answering) would otherwise show as resumable on
  // landing, but tapping triggers Story 13-4 to re-generate from scratch —
  // silent data loss + orphan in-progress rows. Hiding these rows here
  // matches the runner's eligibility rule.
  const hasSaveState =
    typeof ss === "object" &&
    ss !== null &&
    "answers" in ss &&
    typeof ss.answers === "object" &&
    ss.answers !== null;
  if (!hasSaveState) {
    return { summary: null, corrupt: false };
  }

  const safeSectionIndex = Math.min(Math.max(0, ss.currentSectionIndex ?? 0), sections.length - 1);
  const safeQuestionIndex = Math.max(0, ss.currentQuestionIndex ?? 0);

  const expectedTotalSeconds =
    sections.reduce((sum, s) => sum + TCF_QCM_SECTIONS[s].minutes, 0) * 60;
  let adjustedTimeRemaining = ss.timeRemaining ?? 0;
  if (ss.savedAt !== undefined && adjustedTimeRemaining > 0) {
    const elapsedSeconds = Math.floor((Date.now() - ss.savedAt) / 1000);
    adjustedTimeRemaining = Math.max(0, adjustedTimeRemaining - elapsedSeconds);
  }
  adjustedTimeRemaining = Math.min(adjustedTimeRemaining, expectedTotalSeconds);

  const totalQuestionsAnswered = Array.isArray(ss.answeredQuestions)
    ? ss.answeredQuestions.length
    : 0;

  // R1-P9: expired-time gate — when the saved timer has expired AND the
  // user hasn't answered any questions, hide the row. Tapping Resume on a
  // "Time's up" row sends the user to a test that immediately transitions
  // to results with zero answers — bad UX. If the user DID answer
  // questions, still surface the row so they can view partial progress
  // (the runner's expired-time path will show the results screen with their
  // partial answers).
  if (adjustedTimeRemaining === 0 && totalQuestionsAnswered === 0) {
    return { summary: null, corrupt: false };
  }

  const totalQuestionsAcrossSections = sections.reduce(
    (sum, s) => sum + (Array.isArray(resumedQuestions[s]) ? resumedQuestions[s].length : 0),
    0
  );

  return {
    summary: {
      id: row.id,
      testType,
      savedSectionIndex: safeSectionIndex,
      savedQuestionIndex: safeQuestionIndex,
      adjustedTimeRemaining,
      totalQuestionsAnswered,
      totalQuestionsAcrossSections,
      createdAt: row.created_at,
    },
    corrupt: false,
  };
}

/**
 * Map a raw `mock_tests` row to a `MockTestPastResult`. Returns `null` for
 * rows with `completed_at = null` (defensive — the query filter already
 * excludes these) or unknown `test_type`.
 *
 * @internal
 */
export function toPastResult(row: {
  id: string;
  test_type: string;
  total_score: number | null;
  cefr_result: string | null;
  duration_seconds: number | null;
  completed_at: string | null;
}): MockTestPastResult | null {
  if (row.completed_at === null) return null;
  if (!PAST_RESULT_TEST_TYPES.has(row.test_type)) {
    // R1-P12: legacy / future test_types are silently dropped from history.
    // Fire a breadcrumb so operators can grep for users with historical
    // test_types not surfaced in v1 landing (e.g., legacy `"grammar"` or
    // future `"writing"` rows pending detail-screen support). No PII; only
    // mockTestId + observed test_type categorical string.
    addBreadcrumb({
      category: "mock-test",
      level: "info",
      message: "Landing: past result test_type not surfaced in v1",
      data: { mockTestId: row.id, observedTestType: row.test_type },
    });
    return null;
  }
  const cefrResult =
    row.cefr_result !== null && VALID_CEFR_LEVELS.has(row.cefr_result)
      ? (row.cefr_result as CEFRLevel)
      : null;
  return {
    id: row.id,
    testType: row.test_type as PastResultTestType,
    totalScore: row.total_score,
    cefrResult,
    durationSeconds: row.duration_seconds,
    completedAt: row.completed_at,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMockTestLanding(): UseMockTestLandingReturn {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;

  const [inProgress, setInProgress] = useState<MockTestInProgressSummary | null>(null);
  const [pastResults, setPastResults] = useState<MockTestPastResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchLandingData = useCallback(async () => {
    if (userId === undefined) {
      // Auth not ready yet; surface empty state without error.
      if (mountedRef.current) {
        setInProgress(null);
        setPastResults([]);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) setLoading(true);

    try {
      // R1-P5: also filter by `completed_at IS NULL` — defense-in-depth
      // against the test-runner's fire-and-forget completion UPDATE racing
      // with the landing's refetch. A row marked `completed_at = now()`
      // but with `status` still `"in_progress"` (UPDATE pending) is excluded
      // here, preventing the just-completed test from being shown as
      // resumable simultaneously with appearing in past-results.
      const inProgressPromise = supabase
        .from("mock_tests")
        .select("id, test_type, questions, section_scores, created_at")
        .eq("user_id", userId)
        .eq("status", "in_progress")
        .is("completed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const pastResultsPromise = supabase
        .from("mock_tests")
        .select("id, test_type, total_score, cefr_result, duration_seconds, completed_at")
        .eq("user_id", userId)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(PAST_RESULTS_LIMIT);

      const [inProgressResult, pastResultsResult] = await Promise.all([
        inProgressPromise,
        pastResultsPromise,
      ]);

      if (!mountedRef.current) return;

      if (inProgressResult.error) throw inProgressResult.error;
      if (pastResultsResult.error) throw pastResultsResult.error;

      // ---- In-progress validation ----
      let nextInProgress: MockTestInProgressSummary | null = null;
      if (inProgressResult.data) {
        const validation = validateInProgressRow(inProgressResult.data);
        if (validation.corrupt) {
          addBreadcrumb({
            category: "mock-test",
            level: "warning",
            message: "Landing: in-progress row corrupt — hidden from resume surface",
            data: { mockTestId: inProgressResult.data.id },
          });
        }
        nextInProgress = validation.summary;
      }

      // ---- Past results mapping ----
      const rawPast = pastResultsResult.data ?? [];
      const nextPast = rawPast.map(toPastResult).filter((r): r is MockTestPastResult => r !== null);

      if (nextPast.length === PAST_RESULTS_LIMIT) {
        addBreadcrumb({
          category: "mock-test",
          level: "info",
          message: "Landing: past results truncated at 10",
          data: { actualCount: nextPast.length },
        });
      }

      if (mountedRef.current) {
        setInProgress(nextInProgress);
        setPastResults(nextPast);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      captureError(err, "mock-test-landing-fetch");
      if (mountedRef.current) {
        setInProgress(null);
        setPastResults([]);
        setError(err);
        setLoading(false);
      }
    }
  }, [userId]);

  // Initial-mount fetch. Consumers using `useFocusEffect(refetch)` should
  // ALSO skip the first focus invocation to prevent a double-fire (Story
  // 14-7 R1-P3) — see `app/(tabs)/mock-test/index.tsx`'s `firstFocusRef`
  // gate.
  useEffect(() => {
    void fetchLandingData();
  }, [fetchLandingData]);

  const refetch = useCallback(async () => {
    await fetchLandingData();
  }, [fetchLandingData]);

  return { inProgress, pastResults, loading, error, refetch };
}
