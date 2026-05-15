/**
 * Story 13-2 — `getHomeAggregate` client helper tests (audit P2-5 closure).
 *
 * Pins:
 *   - RPC call shape (function name + args).
 *   - Sentry routing on error (`feature: "home-aggregate-fetch"`).
 *   - `isValidHomeAggregate` shape-guard accepts well-formed; rejects
 *     non-object / missing key / wrong type per key.
 *   - Type round-trip: `HomeAggregate` interface is exported and matches
 *     the SQL function's JSONB output (TypeScript compile-time check).
 */

import { getHomeAggregate, isValidHomeAggregate, type HomeAggregate } from "../home-aggregate";
import { captureError } from "../sentry";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const validAggregate: HomeAggregate = {
  skills: [
    {
      skill: "listening",
      cefr_level: "B1",
      score: 75,
      exercises_completed: 12,
      total_time_minutes: 60,
    },
  ],
  daily_activity_today: {
    date: "2026-05-14",
    minutes_practiced: 20,
    exercises_completed: 3,
    conversations_completed: 1,
    words_learned: 5,
  },
  recent_activity: [],
  top_errors: [],
  streak_days: 7,
  weakest_skill: { skill: "writing", average_score: 45 },
  srs_due_count: 4,
  error_counts: { total: 10, resolved: 7 },
  has_activity_today: true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getHomeAggregate — Story 13-2 client helper", () => {
  it("Case 1: calls supabase.rpc with the correct function name + arg shape", async () => {
    mockRpc.mockResolvedValueOnce({ data: validAggregate, error: null });

    await getHomeAggregate("user-123", "2026-05-14");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("get_home_aggregate", {
      p_user_id: "user-123",
      p_date: "2026-05-14",
    });
  });

  it("Case 2: returns the aggregate verbatim on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: validAggregate, error: null });

    const result = await getHomeAggregate("user-123", "2026-05-14");

    expect(result).toBe(validAggregate);
  });

  it("Case 3: throws + captureError with `home-aggregate-fetch` feature on RPC error", async () => {
    const rpcError = new Error("RPC failed");
    mockRpc.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(getHomeAggregate("user-123", "2026-05-14")).rejects.toBe(rpcError);
    expect(captureError).toHaveBeenCalledWith(rpcError, "home-aggregate-fetch");
  });

  it("Case 4: throws + captureError on malformed shape", async () => {
    // Missing required keys → shape guard rejects.
    mockRpc.mockResolvedValueOnce({ data: { skills: [] }, error: null });

    await expect(getHomeAggregate("user-123", "2026-05-14")).rejects.toThrow(
      "get_home_aggregate returned malformed shape"
    );
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), "home-aggregate-fetch");
  });
});

describe("isValidHomeAggregate — Story 13-2 shape guard", () => {
  it("Case 5: accepts a well-formed aggregate", () => {
    expect(isValidHomeAggregate(validAggregate)).toBe(true);
  });

  it("Case 6: rejects non-object inputs", () => {
    expect(isValidHomeAggregate(null)).toBe(false);
    expect(isValidHomeAggregate(undefined)).toBe(false);
    expect(isValidHomeAggregate("string")).toBe(false);
    expect(isValidHomeAggregate(42)).toBe(false);
    expect(isValidHomeAggregate(true)).toBe(false);
  });

  it("Case 7: rejects missing `skills` array", () => {
    const bad = { ...validAggregate, skills: "not-array" as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 8: rejects missing `recent_activity` array", () => {
    const bad = { ...validAggregate, recent_activity: undefined as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 9: rejects missing `top_errors` array", () => {
    const bad = { ...validAggregate, top_errors: null as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 10: rejects non-number `streak_days`", () => {
    const bad = { ...validAggregate, streak_days: "7" as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 11: rejects non-number `srs_due_count`", () => {
    const bad = { ...validAggregate, srs_due_count: null as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 12: rejects malformed `error_counts` (missing total)", () => {
    const bad = { ...validAggregate, error_counts: { resolved: 0 } as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 13: rejects non-boolean `has_activity_today`", () => {
    const bad = { ...validAggregate, has_activity_today: 1 as unknown };
    expect(isValidHomeAggregate(bad)).toBe(false);
  });

  it("Case 14: accepts null `daily_activity_today` (no row for today)", () => {
    const variant = { ...validAggregate, daily_activity_today: null };
    expect(isValidHomeAggregate(variant)).toBe(true);
  });

  it("Case 15: accepts null `weakest_skill` (no skills practiced yet)", () => {
    const variant = { ...validAggregate, weakest_skill: null };
    expect(isValidHomeAggregate(variant)).toBe(true);
  });
});
