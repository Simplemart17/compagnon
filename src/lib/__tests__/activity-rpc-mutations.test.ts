/**
 * Story 12-3 — integration tests for the 4 atomic-RPC mutation helpers in
 * `src/lib/activity.ts`. Pins the client-side contract: each helper invokes
 * exactly one `supabase.rpc(...)` call with the correct function name + arg
 * shape, and routes RPC errors through `captureError` with the pre-12-3
 * Sentry tag preserved.
 *
 * The pure `evaluatePromotion` helper coverage stays in `activity.test.ts`
 * (Story 9-2) — this sibling file is for the Supabase-touching boundary
 * which `activity.test.ts` did not previously cover at all.
 */

import type { Session } from "@supabase/supabase-js";

import {
  updateStreak,
  updateSkillProgress,
  incrementDailyActivity,
  checkCefrPromotion,
  getLocalDateString,
} from "../activity";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}));

// Mock supabase BEFORE importing activity.ts so the helpers pick up the mock.
const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    rpc: (...args: unknown[]) => (mockRpc as unknown as (...a: unknown[]) => unknown)(...args),
    from: (...args: unknown[]) => (mockFrom as unknown as (...a: unknown[]) => unknown)(...args),
    auth: {
      getSession: jest
        .fn()
        .mockResolvedValue({ data: { session: null as Session | null }, error: null }),
    },
  },
}));

const mockCaptureError = jest.fn();
const mockAddBreadcrumb = jest.fn();
jest.mock("../sentry", () => ({
  captureError: (...args: unknown[]) =>
    (mockCaptureError as unknown as (...a: unknown[]) => unknown)(...args),
  addBreadcrumb: (...args: unknown[]) =>
    (mockAddBreadcrumb as unknown as (...a: unknown[]) => unknown)(...args),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockCaptureError.mockClear();
  mockAddBreadcrumb.mockClear();
});

describe("Story 12-3 — updateStreak rpc contract", () => {
  it("Case 1: dispatches `supabase.rpc('update_streak_atomic', { p_user_id, p_today, p_yesterday })` exactly once", async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });

    await updateStreak("user-A");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockRpc.mock.calls[0];
    expect(fnName).toBe("update_streak_atomic");
    expect(args).toMatchObject({
      p_user_id: "user-A",
      p_today: getLocalDateString(),
    });
    // p_yesterday is today - 1 day
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(args.p_yesterday).toBe(getLocalDateString(yesterday));
  });

  it("Case 2: rpc error routes through captureError with Sentry tag 'update-streak'", async () => {
    const err = new Error("Postgres unreachable");
    mockRpc.mockResolvedValueOnce({ data: null, error: err });

    await updateStreak("user-A");

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][0]).toBe(err);
    expect(mockCaptureError.mock.calls[0][1]).toBe("update-streak");
  });

  it("Case 3: rpc throw (sync) routes through captureError + does NOT propagate (fail-OPEN)", async () => {
    mockRpc.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });

    // Must NOT throw — fail-OPEN policy for fire-and-forget activity ticks.
    await expect(updateStreak("user-A")).resolves.toBeUndefined();
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][1]).toBe("update-streak");
  });

  it("Case 4: never falls back to a SELECT-then-UPDATE pipeline (no `supabase.from('profiles')` call)", async () => {
    mockRpc.mockResolvedValueOnce({ data: 5, error: null });
    await updateStreak("user-A");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("Story 12-3 — updateSkillProgress rpc contract", () => {
  it("Case 5: dispatches `supabase.rpc('update_skill_progress_atomic', {...})` with clamped score", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    // Score 95.5 (in range) — should pass through verbatim
    await updateSkillProgress("user-A", "listening", "B1", 95.5, 4);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockRpc.mock.calls[0];
    expect(fnName).toBe("update_skill_progress_atomic");
    expect(args).toEqual({
      p_user_id: "user-A",
      p_skill: "listening",
      p_cefr_level: "B1",
      p_incoming_score: 95.5,
      p_time_minutes: 4,
    });
  });

  it("Case 6: out-of-range score is clamped client-side to [0, 100] before RPC dispatch", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await updateSkillProgress("user-A", "speaking", "B2", 150, 3);
    expect(mockRpc.mock.calls[0][1].p_incoming_score).toBe(100); // clamped down

    mockRpc.mockClear();
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await updateSkillProgress("user-A", "speaking", "B2", -25, 3);
    expect(mockRpc.mock.calls[0][1].p_incoming_score).toBe(0); // clamped up
  });

  it("Case 7: NaN score clamped to 0 client-side (Story 9-2 clampScore contract)", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await updateSkillProgress("user-A", "reading", "A2", NaN, 2);
    expect(mockRpc.mock.calls[0][1].p_incoming_score).toBe(0);
  });

  it("Case 8: rpc error routes through captureError with Sentry tag + extras (skill, score, cefrLevel)", async () => {
    const err = new Error("RLS denied");
    mockRpc.mockResolvedValueOnce({ data: null, error: err });

    await updateSkillProgress("user-A", "grammar", "C1", 80, 5);

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][0]).toBe(err);
    expect(mockCaptureError.mock.calls[0][1]).toBe("update-skill-progress");
    expect(mockCaptureError.mock.calls[0][2]).toMatchObject({
      skill: "grammar",
      score: 80,
      cefrLevel: "C1",
    });
  });
});

describe("Story 12-3 — incrementDailyActivity rpc contract", () => {
  it("Case 9: dispatches `supabase.rpc('increment_daily_activity_atomic', {...})` with all 4 deltas + today", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await incrementDailyActivity("user-A", {
      minutes: 5,
      exercises: 2,
      conversations: 1,
      words: 10,
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockRpc.mock.calls[0];
    expect(fnName).toBe("increment_daily_activity_atomic");
    expect(args).toEqual({
      p_user_id: "user-A",
      p_date: getLocalDateString(),
      p_minutes: 5,
      p_exercises: 2,
      p_conversations: 1,
      p_words: 10,
    });
  });

  it("Case 10: missing fields default to 0 (preserves pre-12-3 nullish-coalescing semantics)", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await incrementDailyActivity("user-A", { minutes: 3 }); // only minutes

    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_user_id: "user-A",
      p_date: getLocalDateString(),
      p_minutes: 3,
      p_exercises: 0,
      p_conversations: 0,
      p_words: 0,
    });
  });

  it("Case 11: rpc error routes through captureError with 'increment-daily-activity' tag", async () => {
    const err = new Error("network blip");
    mockRpc.mockResolvedValueOnce({ data: null, error: err });

    await incrementDailyActivity("user-A", { minutes: 1 });

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][1]).toBe("increment-daily-activity");
  });
});

describe("Story 12-3 — checkCefrPromotion compare-and-swap rpc contract", () => {
  /**
   * checkCefrPromotion keeps its pre-step SELECT pipeline (current_cefr_level
   * + skill_progress rows for evaluatePromotion) — only the FINAL UPDATE
   * step is replaced by the `promote_cefr_level_atomic` RPC.
   *
   * To exercise the rpc dispatch we need to mock both the SELECT pipeline AND
   * the RPC. We use lightweight builder mocks here for the SELECTs.
   */
  function setupSelectMocks(
    currentLevel: string,
    skillRows: { skill: string; score: number; exercises_completed: number }[]
  ) {
    let callIdx = 0;
    mockFrom.mockImplementation((table: string) => {
      callIdx += 1;
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { current_cefr_level: currentLevel }, error: null }),
            }),
          }),
        };
      }
      if (table === "skill_progress") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: skillRows, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from() table: ${table} (call ${callIdx})`);
    });
  }

  /**
   * Review-round-1 P14: each `checkCefrPromotion` test uses a unique userId
   * so the module-level `lastSkippedBreadcrumb` Map (in activity.ts) can't
   * dedup-suppress this test's breadcrumb because of a previous test's
   * fingerprint (`${currentLevel}:${reason}`). Jest's module-isolation
   * makes this safe today, but unique IDs are belt-and-braces against
   * future test additions in the same file.
   */

  // Review-round-1 P15: table-driven adjacency coverage replaces the single
  // A1→A2 happy-path case. Catches a future refactor that hardcodes
  // `p_next_level: "A2"` instead of computing it from CEFR_ORDER[idx + 1].
  // Covers all 5 CEFR adjacencies. Note that for the higher levels (C1→C2)
  // we use a passing 5-skill set with high scores — `evaluatePromotion`
  // doesn't gate on level, just on per-skill passing counts.
  const PASSING_5_SKILLS = [
    { skill: "listening", score: 90, exercises_completed: 4 },
    { skill: "reading", score: 90, exercises_completed: 3 },
    { skill: "speaking", score: 88, exercises_completed: 2 },
    { skill: "writing", score: 50, exercises_completed: 1 },
    { skill: "grammar", score: 60, exercises_completed: 1 },
  ];

  it.each([
    ["A1", "A2"],
    ["A2", "B1"],
    ["B1", "B2"],
    ["B2", "C1"],
    ["C1", "C2"],
  ])(
    "Case 12: promotion %s → %s dispatches `promote_cefr_level_atomic` with computed p_next_level (table-driven adjacency)",
    async (currentLevel, expectedNextLevel) => {
      setupSelectMocks(currentLevel, PASSING_5_SKILLS);
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const userId = `user-case-12-${currentLevel}`;

      await checkCefrPromotion(userId);

      expect(mockRpc).toHaveBeenCalledTimes(1);
      const [fnName, args] = mockRpc.mock.calls[0];
      expect(fnName).toBe("promote_cefr_level_atomic");
      expect(args).toMatchObject({
        p_user_id: userId,
        p_expected_current_level: currentLevel,
        p_next_level: expectedNextLevel,
      });
    }
  );

  it("Case 13: rpc returning FALSE (CAS-mismatch) emits info breadcrumb + does NOT route through captureError (Review-round-1 P6)", async () => {
    setupSelectMocks("B1", [
      { skill: "listening", score: 90, exercises_completed: 4 },
      { skill: "reading", score: 90, exercises_completed: 3 },
      { skill: "speaking", score: 90, exercises_completed: 2 },
      { skill: "writing", score: 90, exercises_completed: 1 },
      { skill: "grammar", score: 90, exercises_completed: 1 },
    ]);
    // CAS mismatch: data=false, no error — concurrent worker promoted first
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    await checkCefrPromotion("user-case-13");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    // Review-round-1 P6: FALSE is now distinguished from a real promotion —
    // info breadcrumb fires; captureError does NOT (FALSE is an expected race
    // outcome, not an error).
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb.mock.calls[0][0]).toMatchObject({
      category: "cefr-promotion",
      level: "info",
      message: expect.stringContaining("raced"),
      data: { fromLevel: "B1", toLevel: "B2" },
    });
  });

  it("Case 14: rpc error routes through captureError with 'cefr-promotion' tag + level extras", async () => {
    setupSelectMocks("A1", [
      { skill: "listening", score: 90, exercises_completed: 4 },
      { skill: "reading", score: 90, exercises_completed: 3 },
      { skill: "speaking", score: 90, exercises_completed: 2 },
      { skill: "writing", score: 90, exercises_completed: 1 },
      { skill: "grammar", score: 90, exercises_completed: 1 },
    ]);
    const err = new Error("Postgres down");
    mockRpc.mockResolvedValueOnce({ data: null, error: err });

    await checkCefrPromotion("user-case-14");

    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][0]).toBe(err);
    expect(mockCaptureError.mock.calls[0][1]).toBe("cefr-promotion");
    expect(mockCaptureError.mock.calls[0][2]).toMatchObject({ fromLevel: "A1", toLevel: "A2" });
  });

  it("Case 15: non-promoting outcome → addBreadcrumb fires, NO RPC dispatched (no spurious writes)", async () => {
    // Missing skills (only 2 of 5) → "missing-skills" reason
    setupSelectMocks("A1", [
      { skill: "listening", score: 90, exercises_completed: 4 },
      { skill: "reading", score: 90, exercises_completed: 4 },
    ]);

    await checkCefrPromotion("user-case-15");

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb.mock.calls[0][0]).toMatchObject({
      category: "cefr-promotion",
      level: "info",
    });
  });

  it("Case 16: C2 user short-circuit → no RPC, no breadcrumb (already terminal)", async () => {
    setupSelectMocks("C2", []);

    await checkCefrPromotion("user-case-16");

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });
});
