/**
 * Story 9-8 — speaking mock-test persistence orchestrator tests.
 *
 * Mocks supabase + activity helpers + cache + sentry. Verifies the contract
 * specified in AC #5 of the story: one mock_tests insert, three
 * mock_test_answers rows, one updateSkillProgress call, and best-effort
 * isolation between activity steps (a failure on one does NOT skip the next).
 */

import { TCF } from "@/src/lib/constants";
import {
  checkCefrPromotion,
  incrementDailyActivity,
  updateSkillProgress,
  updateStreak,
} from "@/src/lib/activity";
import { invalidateCache } from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";

import { persistSpeakingMockTest } from "../speaking-mock-test-persist";
import type { SpeakingTaskEvaluation } from "../schemas/ai-responses";
import type { SpeakingTaskNumber, SpeakingTaskPromptResult } from "../prompts/speaking";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("../activity", () => ({
  __esModule: true,
  updateSkillProgress: jest.fn(async () => undefined),
  incrementDailyActivity: jest.fn(async () => undefined),
  updateStreak: jest.fn(async () => undefined),
  checkCefrPromotion: jest.fn(async () => undefined),
}));

jest.mock("../cache", () => ({
  __esModule: true,
  invalidateCache: jest.fn(async () => undefined),
  CACHE_KEYS: {
    PROFILE: "profile",
    SKILLS: "skills",
    DAILY_ACTIVITY_TODAY: "daily_activity_today",
    RECENT_ACTIVITY: "recent_activity",
  },
}));

// P16: capture the original `supabase.from` so we can restore it in
// `afterEach`. Tests below mutate `supabase.from = fromMock` directly to drive
// per-case insert behavior; without restoration any subsequent test (in this
// file or another file in the same Jest worker) would see the mocked `from`.
const originalSupabaseFrom = supabase.from;

interface MockSupabaseHandle {
  insertMock: jest.Mock;
  // Review patch P1 (Edge Case Hunter ECH1+ECH3): expose the
  // mock_tests insert payload so tests can assert on the persisted JSONB
  // blob — specifically `section_scores.speaking.task{1,2,3}.sociolinguistic`,
  // which Story 10-6 must write but was originally missed at
  // `buildTaskScoreEntry` in `speaking-mock-test-persist.ts`.
  mockTestsInsertMock: jest.Mock;
  selectMock: jest.Mock;
  singleMock: jest.Mock;
  fromMock: jest.Mock;
}

function setupSupabaseMock(opts: {
  mockTestsInsertResult?: { data: { id: string } | null; error: Error | null };
  mockTestAnswersInsertResult?: { error: Error | null };
}): MockSupabaseHandle {
  const mockTestsInsert = opts.mockTestsInsertResult ?? {
    data: { id: "mock-test-uuid" },
    error: null,
  };
  const answersInsert = opts.mockTestAnswersInsertResult ?? { error: null };

  const singleMock = jest.fn(async () => mockTestsInsert);
  const selectMock = jest.fn(() => ({ single: singleMock }));
  const insertMock = jest.fn();
  const mockTestsInsertMock = jest.fn();
  const fromMock = jest.fn();

  // Mock supabase.from(table) to return the right insert chain per table.
  fromMock.mockImplementation((table: string) => {
    if (table === "mock_tests") {
      return {
        insert: jest.fn((row: unknown) => {
          mockTestsInsertMock(row);
          return { select: selectMock };
        }),
      };
    }
    if (table === "mock_test_answers") {
      return {
        insert: jest.fn(async (rows: unknown) => {
          insertMock(rows);
          return answersInsert;
        }),
      };
    }
    throw new Error(`Unexpected supabase.from(${table})`);
  });

  (supabase as unknown as { from: jest.Mock }).from = fromMock;
  return { insertMock, mockTestsInsertMock, selectMock, singleMock, fromMock };
}

function evalOf(partial: Partial<SpeakingTaskEvaluation>): SpeakingTaskEvaluation {
  return {
    pronunciationFluencyScore: 16,
    vocabularyScore: 14,
    grammarScore: 15,
    interactionScore: 18,
    // Story 10-6: Sociolinguistique 5th publisher category required.
    sociolinguisticScore: 16,
    overallScore: 79,
    strengths: ["ok"],
    improvements: ["ok"],
    ...partial,
  };
}

const PROMPTS: Record<SpeakingTaskNumber, SpeakingTaskPromptResult> = {
  1: { instruction: "Task 1", promptFr: "Présentez-vous.", expectedDurationSec: 120 },
  2: { instruction: "Task 2", promptFr: "Scénario.", expectedDurationSec: 330 },
  3: { instruction: "Task 3", promptFr: "Sujet.", expectedDurationSec: 270 },
};

const TRANSCRIPTS: Record<SpeakingTaskNumber, string> = {
  1: "Je m'appelle Marc, j'habite à Toronto.",
  2: "Bonjour, je voudrais réserver une visite guidée.",
  3: "Je pense que les réseaux sociaux ont plus d'inconvénients.",
};

const EVALUATIONS: Record<SpeakingTaskNumber, SpeakingTaskEvaluation> = {
  1: evalOf({ overallScore: 80 }),
  2: evalOf({ overallScore: 75 }),
  3: evalOf({ overallScore: 70 }),
};

describe("persistSpeakingMockTest (story 9-8)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // P16: restore the original `supabase.from` so a stray mock from one test
    // does not leak into the next test (or another file's tests in the same
    // Jest worker).
    (supabase as unknown as { from: typeof supabase.from }).from = originalSupabaseFrom;
  });

  it("Case 1 — happy path: one mock_tests insert + 3 mock_test_answers + activity chain", async () => {
    const { insertMock } = setupSupabaseMock({});

    const result = await persistSpeakingMockTest({
      userId: "user-1",
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    // mock_tests insert returned a row id
    expect(result.mockTestId).toBe("mock-test-uuid");

    // mock_test_answers received 3 rows
    expect(insertMock).toHaveBeenCalledTimes(1);
    const rows = insertMock.mock.calls[0][0] as {
      mock_test_id: string;
      user_id: string;
      question_index: number;
      selected_option: string;
      is_correct: boolean | null;
    }[];
    expect(rows).toHaveLength(3);
    expect(rows[0].question_index).toBe(0);
    expect(rows[1].question_index).toBe(1);
    expect(rows[2].question_index).toBe(2);
    rows.forEach((r) => {
      expect(r.mock_test_id).toBe("mock-test-uuid");
      expect(r.user_id).toBe("user-1");
      expect(r.is_correct).toBeNull();
    });

    // Activity chain: skill progress + daily activity + streak + promotion all fired exactly once
    expect(updateSkillProgress).toHaveBeenCalledTimes(1);
    expect(updateSkillProgress).toHaveBeenCalledWith(
      "user-1",
      "speaking",
      "B1",
      expect.any(Number),
      TCF.SPEAKING_MINUTES
    );
    expect(incrementDailyActivity).toHaveBeenCalledWith("user-1", {
      exercises: 1,
      minutes: TCF.SPEAKING_MINUTES,
    });
    expect(updateStreak).toHaveBeenCalledWith("user-1");
    expect(checkCefrPromotion).toHaveBeenCalledWith("user-1");

    // Cache invalidations fired
    expect(invalidateCache).toHaveBeenCalled();

    // No errors captured
    expect(captureError).not.toHaveBeenCalled();
  });

  it("Case 2 — mock_tests insert fails: captureError fires + answers insert is SKIPPED", async () => {
    const { insertMock } = setupSupabaseMock({
      mockTestsInsertResult: { data: null, error: new Error("DB explode") },
    });

    const result = await persistSpeakingMockTest({
      userId: "user-2",
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    expect(result.mockTestId).toBeNull();
    expect(insertMock).not.toHaveBeenCalled(); // answers SKIPPED — no parent id
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), "speaking-mock-test-persist", {
      phase: "step-mock-tests-insert",
    });

    // BUT activity chain STILL ran (best-effort isolation)
    expect(updateSkillProgress).toHaveBeenCalled();
    expect(incrementDailyActivity).toHaveBeenCalled();
    expect(updateStreak).toHaveBeenCalled();
    expect(checkCefrPromotion).toHaveBeenCalled();
  });

  it("Case 3 — mock_test_answers insert fails: captureError fires AND updateSkillProgress STILL fires", async () => {
    setupSupabaseMock({
      mockTestAnswersInsertResult: { error: new Error("answers explode") },
    });

    await persistSpeakingMockTest({
      userId: "user-3",
      cefrLevel: "B2",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    expect(captureError).toHaveBeenCalledWith(expect.any(Error), "speaking-mock-test-persist", {
      phase: "step-mock-test-answers-insert",
    });
    expect(updateSkillProgress).toHaveBeenCalledTimes(1);
  });

  it("Case 4 — updateSkillProgress throws: captureError fires AND updateStreak STILL fires", async () => {
    setupSupabaseMock({});
    (updateSkillProgress as jest.Mock).mockRejectedValueOnce(new Error("skill explode"));

    await persistSpeakingMockTest({
      userId: "user-4",
      cefrLevel: "A2",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    expect(captureError).toHaveBeenCalledWith(expect.any(Error), "speaking-mock-test-persist", {
      phase: "step-skill-progress",
    });
    expect(updateStreak).toHaveBeenCalledTimes(1);
    expect(checkCefrPromotion).toHaveBeenCalledTimes(1);
  });

  it("Case 5 — transcript stored verbatim in selected_option (no truncation, no sanitization)", async () => {
    const { insertMock } = setupSupabaseMock({});
    const longTranscript = "Bonjour ! ".repeat(200); // ~2000 chars

    await persistSpeakingMockTest({
      userId: "user-5",
      cefrLevel: "C1",
      prompts: PROMPTS,
      transcripts: { ...TRANSCRIPTS, 1: longTranscript },
      evaluations: EVALUATIONS,
    });

    const rows = insertMock.mock.calls[0][0] as { selected_option: string }[];
    expect(rows[0].selected_option).toBe(longTranscript); // verbatim, no truncation
  });

  it("returns a results summary the caller can render even if everything else failed", async () => {
    setupSupabaseMock({
      mockTestsInsertResult: { data: null, error: new Error("DB explode") },
    });

    const result = await persistSpeakingMockTest({
      userId: "user-6",
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    expect(result.compositeOverall).toBeGreaterThan(0);
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.cefrResult).toMatch(/^(A1|A2|B1|B2|C1|C2)$/);
    expect(result.taskOveralls).toHaveLength(3);
  });

  // Story 10-2: persisted total_score is on the publisher's 0–20 scale.
  it("persists total_score on publisher 0–20 scale (Story 10-2)", async () => {
    let mockTestsInsertPayload: { total_score: number } | null = null;
    const fromMock = jest.fn((table: string) => {
      if (table === "mock_tests") {
        return {
          insert: jest.fn((payload: { total_score: number }) => {
            mockTestsInsertPayload = payload;
            return {
              select: jest.fn(() => ({
                single: jest.fn(async () => ({
                  data: { id: "mock-test-uuid" },
                  error: null,
                })),
              })),
            };
          }),
        };
      }
      if (table === "mock_test_answers") {
        return {
          insert: jest.fn(async () => ({ error: null })),
        };
      }
      throw new Error(`Unexpected supabase.from(${table})`);
    });
    (supabase as unknown as { from: jest.Mock }).from = fromMock;

    const result = await persistSpeakingMockTest({
      userId: "user-7",
      cefrLevel: "B2",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(20);
    expect(mockTestsInsertPayload).not.toBeNull();
    expect(mockTestsInsertPayload!.total_score).toBeGreaterThanOrEqual(0);
    expect(mockTestsInsertPayload!.total_score).toBeLessThanOrEqual(20);
  });

  // Story 10-2: known input → expected publisher score.
  // EVALUATIONS task overalls are 80/75/70 → composite 75 → 75/5 = 15 (CLB 9).
  it("maps EVALUATIONS (80/75/70) → composite 75 → publisher 15 → C1 (Story 10-2)", async () => {
    setupSupabaseMock({});

    const result = await persistSpeakingMockTest({
      userId: "user-8",
      cefrLevel: "C1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    expect(result.compositeOverall).toBe(75); // 0–100 internal composite
    expect(result.totalScore).toBe(15); // 75 / 5 = 15 on the 0–20 publisher scale
    expect(result.cefrResult).toBe("C1"); // 15 → CLB 9 → C1
  });

  // Review patch P1 (Edge Case Hunter ECH1 + ECH3): regression guard for the
  // 5th publisher category being persisted into the JSONB blob. Without this
  // assertion, a future patch that drops `sociolinguistic` from
  // `buildTaskScoreEntry` would silently revert the §6 citations-matrix
  // promise ("post-10-6 rows hold 5 dimensions"). The blob structure isn't
  // typed at the persist boundary (it's `Record<string, unknown>` JSONB), so
  // only an explicit assertion catches the drop.
  it("Story 10-6 — section_scores.speaking.task{1,2,3} JSONB includes the sociolinguistic dimension", async () => {
    const { mockTestsInsertMock } = setupSupabaseMock({});

    await persistSpeakingMockTest({
      userId: "user-socio",
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: {
        // Pick distinct per-task sociolinguistic values so the assertion
        // catches a future bug that wires them up to the wrong task index.
        1: evalOf({ sociolinguisticScore: 12, overallScore: null }),
        2: evalOf({ sociolinguisticScore: 14, overallScore: null }),
        3: evalOf({ sociolinguisticScore: 17, overallScore: null }),
      },
    });

    expect(mockTestsInsertMock).toHaveBeenCalledTimes(1);
    const insertedRow = mockTestsInsertMock.mock.calls[0][0] as {
      section_scores: {
        speaking: {
          task1: { sociolinguistic: number };
          task2: { sociolinguistic: number };
          task3: { sociolinguistic: number };
        };
      };
    };

    expect(insertedRow.section_scores.speaking.task1.sociolinguistic).toBe(12);
    expect(insertedRow.section_scores.speaking.task2.sociolinguistic).toBe(14);
    expect(insertedRow.section_scores.speaking.task3.sociolinguistic).toBe(17);
  });

  it("Story 10-6 — section_scores.speaking.task1 still carries the four pre-10-6 dimensions alongside sociolinguistic", async () => {
    // Defense-in-depth: a future patch could add `sociolinguistic` while
    // accidentally dropping one of the four pre-existing dimension keys.
    // Pin the full key set so the JSONB shape contract is regression-tested.
    const { mockTestsInsertMock } = setupSupabaseMock({});

    await persistSpeakingMockTest({
      userId: "user-socio2",
      cefrLevel: "B2",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluations: EVALUATIONS,
    });

    const insertedRow = mockTestsInsertMock.mock.calls[0][0] as {
      section_scores: { speaking: { task1: Record<string, unknown> } };
    };
    const task1 = insertedRow.section_scores.speaking.task1;
    expect(task1).toHaveProperty("pronunciationFluency");
    expect(task1).toHaveProperty("vocabulary");
    expect(task1).toHaveProperty("grammar");
    expect(task1).toHaveProperty("interaction");
    expect(task1).toHaveProperty("sociolinguistic");
    expect(task1).toHaveProperty("overall");
  });
});
