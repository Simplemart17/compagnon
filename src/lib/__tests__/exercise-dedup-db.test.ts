/**
 * Story 10-8 — `getSeenHashes` Supabase I/O layer tests.
 *
 * Mocks `supabase.from(...)` chain via direct assignment (mirroring
 * the `speaking-mock-test-persist.test.ts` pattern). Verifies the
 * Story 9-10 resilience contract: every failure path returns an
 * empty `Set` and fires `captureError(_, "exercise-dedup-fetch")`
 * — never throws, never blocks the user.
 */

import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";

import { DEFAULT_SEEN_LIMIT, getSeenHashes } from "../exercise-dedup-db";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const originalSupabaseFrom = supabase.from;

interface QueryResult {
  data: { question_stem_hashes: string[] | null }[] | null;
  error: Error | null;
}

/**
 * Wire up the supabase query chain `from().select().eq()×5.order().limit()`
 * to resolve with the provided result. Returns a handle to inspect each
 * stage of the chain.
 *
 * Review-patch P3 (BH6+BH7+AA7): previously the test only asserted
 * `fromMock` was called with "exercises", leaving the per-column
 * `.eq()` filters and `.limit(N)` value uninstrumented. The mock now
 * exposes `eqMock` (captures every `(column, value)` pair) and
 * `limitMock` (captures the numeric limit) so tests can pin the
 * concrete filter contract (`completed = true`, `exercise_type =
 * mcq|free_write`, `limit = DEFAULT_SEEN_LIMIT | opts.limit`).
 */
function setupSupabaseMock(result: QueryResult | Error): {
  fromMock: jest.Mock;
  selectMock: jest.Mock;
  eqMock: jest.Mock;
  orderMock: jest.Mock;
  limitMock: jest.Mock;
} {
  const limitMock = jest.fn(async (_limit: number) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const orderMock = jest.fn(() => ({ limit: limitMock }));
  // Chained .eq() calls — each returns the same builder object so a
  // single `eqMock` captures all per-column filter invocations.
  const eqBuilder: Record<string, jest.Mock> = {};
  const eqMock = jest.fn(() => eqBuilder);
  eqBuilder.eq = eqMock;
  eqBuilder.order = orderMock;
  const selectMock = jest.fn(() => eqBuilder);
  const fromMock = jest.fn(() => ({ select: selectMock }));
  (supabase.from as unknown) = fromMock;
  return { fromMock, selectMock, eqMock, orderMock, limitMock };
}

afterEach(() => {
  jest.clearAllMocks();
  // Restore original so other test files in the same worker aren't affected
  (supabase.from as unknown) = originalSupabaseFrom;
});

describe("getSeenHashes — happy path", () => {
  it("returns the union of hashes from 3 rows × 5 hashes each (15 distinct)", async () => {
    setupSupabaseMock({
      data: [
        { question_stem_hashes: ["h1", "h2", "h3", "h4", "h5"] },
        { question_stem_hashes: ["h6", "h7", "h8", "h9", "h10"] },
        { question_stem_hashes: ["h11", "h12", "h13", "h14", "h15"] },
      ],
      error: null,
    });
    const result = await getSeenHashes("user-1", "listening", "B1");
    expect(result.size).toBe(15);
    expect(result.has("h1")).toBe(true);
    expect(result.has("h15")).toBe(true);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("dedupes hashes that repeat across rows (same hash in 2 rows → set contains it once)", async () => {
    setupSupabaseMock({
      data: [
        { question_stem_hashes: ["h1", "h2", "h3"] },
        { question_stem_hashes: ["h2", "h3", "h4"] }, // h2, h3 overlap
      ],
      error: null,
    });
    const result = await getSeenHashes("user-1", "reading", "B2");
    expect(result.size).toBe(4); // h1, h2, h3, h4
  });

  it("empty result (0 rows) returns empty set", async () => {
    setupSupabaseMock({ data: [], error: null });
    const result = await getSeenHashes("user-1", "grammar", "A1");
    expect(result.size).toBe(0);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("null data returns empty set", async () => {
    setupSupabaseMock({ data: null, error: null });
    const result = await getSeenHashes("user-1", "writing", "C1");
    expect(result.size).toBe(0);
  });
});

describe("getSeenHashes — resilience (Story 9-10 pattern)", () => {
  it("Supabase error → empty set + captureError with exercise-dedup-fetch tag", async () => {
    const supabaseError = new Error("connection refused");
    setupSupabaseMock({ data: null, error: supabaseError });
    const result = await getSeenHashes("user-1", "listening", "B1");
    expect(result.size).toBe(0);
    expect(captureError).toHaveBeenCalledWith(
      supabaseError,
      "exercise-dedup-fetch",
      expect.objectContaining({ skill: "listening", cefrLevel: "B1" })
    );
  });

  it("thrown exception (e.g., network failure mid-query) → empty set + captureError", async () => {
    const networkError = new Error("network timeout");
    setupSupabaseMock(networkError);
    const result = await getSeenHashes("user-1", "reading", "B2");
    expect(result.size).toBe(0);
    expect(captureError).toHaveBeenCalledWith(
      networkError,
      "exercise-dedup-fetch",
      expect.objectContaining({ skill: "reading", cefrLevel: "B2" })
    );
  });
});

describe("getSeenHashes — defensive handling", () => {
  it("row with NULL question_stem_hashes contributes nothing (no crash)", async () => {
    setupSupabaseMock({
      data: [
        { question_stem_hashes: null }, // pre-Story-10-8 row
        { question_stem_hashes: ["h1", "h2"] }, // post-10-8 row
      ],
      error: null,
    });
    const result = await getSeenHashes("user-1", "listening", "B1");
    expect(result.size).toBe(2);
    expect(result.has("h1")).toBe(true);
  });

  it("row with non-array (defensive — should never happen but guard against silent drift)", async () => {
    setupSupabaseMock({
      data: [
        { question_stem_hashes: "not-an-array" as unknown as string[] },
        { question_stem_hashes: ["h1"] },
      ],
      error: null,
    });
    const result = await getSeenHashes("user-1", "listening", "B1");
    // Non-array silently dropped; valid array still surfaces
    expect(result.size).toBe(1);
    expect(result.has("h1")).toBe(true);
  });
});

describe("getSeenHashes — query parameters (review-patch P3)", () => {
  it("default limit is DEFAULT_SEEN_LIMIT (100) and `.limit(100)` fires verbatim", async () => {
    expect(DEFAULT_SEEN_LIMIT).toBe(100);
    const { limitMock } = setupSupabaseMock({ data: [], error: null });
    await getSeenHashes("user-1", "listening", "B1");
    expect(limitMock).toHaveBeenCalledWith(100);
  });

  it("respects custom limit via opts.limit — `.limit(50)` fires with the override", async () => {
    const { limitMock } = setupSupabaseMock({ data: [], error: null });
    await getSeenHashes("user-1", "listening", "B1", { limit: 50 });
    expect(limitMock).toHaveBeenCalledWith(50);
  });

  it("filters by (user_id, skill, cefr_level, exercise_type, completed=true) — all five .eq() calls fire with the right values", async () => {
    const { fromMock, eqMock } = setupSupabaseMock({ data: [], error: null });
    await getSeenHashes("user-1", "listening", "B1");
    expect(fromMock).toHaveBeenCalledWith("exercises");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqMock).toHaveBeenCalledWith("skill", "listening");
    expect(eqMock).toHaveBeenCalledWith("cefr_level", "B1");
    expect(eqMock).toHaveBeenCalledWith("exercise_type", "mcq");
    expect(eqMock).toHaveBeenCalledWith("completed", true);
    // Exactly 5 .eq() calls — guards against a future patch that adds
    // a filter without updating the test surface.
    expect(eqMock).toHaveBeenCalledTimes(5);
  });

  it("writing skill maps to exercise_type='free_write' (P2/ECH1+ECH2 contract)", async () => {
    const { eqMock } = setupSupabaseMock({ data: [], error: null });
    await getSeenHashes("user-1", "writing", "C1");
    expect(eqMock).toHaveBeenCalledWith("skill", "writing");
    expect(eqMock).toHaveBeenCalledWith("exercise_type", "free_write");
    expect(eqMock).not.toHaveBeenCalledWith("exercise_type", "mcq");
  });

  it("orders by completed_at DESC", async () => {
    const { orderMock } = setupSupabaseMock({ data: [], error: null });
    await getSeenHashes("user-1", "listening", "B1");
    expect(orderMock).toHaveBeenCalledWith("completed_at", { ascending: false });
  });

  it("selects only the question_stem_hashes column (minimal payload)", async () => {
    const { selectMock } = setupSupabaseMock({ data: [], error: null });
    await getSeenHashes("user-1", "listening", "B1");
    expect(selectMock).toHaveBeenCalledWith("question_stem_hashes");
  });
});
