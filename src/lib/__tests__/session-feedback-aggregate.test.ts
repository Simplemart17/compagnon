/**
 * Story 13-3 — `getSessionFeedbackAggregate` client helper tests (audit P2-4 closure).
 *
 * Pins:
 *   - RPC call shape (function name + 4 args including p_now ISO string).
 *   - Sentry routing on error (`feature: "session-feedback-aggregate-fetch"`).
 *   - `isValidSessionFeedbackAggregate` shape-guard accepts well-formed +
 *     rejects per-key + per-nested-row malformations (Story 13-2 P7/P8 lesson).
 *   - Story 13-2 P3 timezone-consistency: client passes its own "now" ISO.
 */

import {
  getSessionFeedbackAggregate,
  isValidSessionFeedbackAggregate,
  type SessionFeedbackAggregate,
} from "../session-feedback-aggregate";
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

const validAggregate: SessionFeedbackAggregate = {
  prev_session: {
    ai_feedback: { fluencyRating: 3, grammarRating: 4 },
    duration_seconds: 240,
    completed_at: "2026-05-10T12:00:00Z",
  },
  cefr_promotion: { from: "A2", to: "B1" },
  max_fluency_rating: 4,
  max_grammar_rating: 4,
  recent_resolved_error: { error_description: "subject-verb agreement" },
  error_counts: { total: 10, resolved: 7 },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getSessionFeedbackAggregate — Story 13-3 client helper", () => {
  it("Case 1: calls supabase.rpc with 4-arg shape including p_now ISO string", async () => {
    mockRpc.mockResolvedValueOnce({ data: validAggregate, error: null });

    await getSessionFeedbackAggregate("user-123", "convo-456", "A2");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockRpc.mock.calls[0];
    expect(fnName).toBe("get_session_feedback_aggregate");
    expect(args.p_user_id).toBe("user-123");
    expect(args.p_conversation_id).toBe("convo-456");
    expect(args.p_pre_cefr_level).toBe("A2");
    expect(typeof args.p_now).toBe("string");
    expect(args.p_now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("Case 2: returns the aggregate verbatim on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: validAggregate, error: null });

    const result = await getSessionFeedbackAggregate("u", "c", "A2");

    expect(result).toBe(validAggregate);
  });

  it("Case 3: throws + captureError on RPC error", async () => {
    const rpcError = new Error("RPC failed");
    mockRpc.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(getSessionFeedbackAggregate("u", "c", "A2")).rejects.toBe(rpcError);
    expect(captureError).toHaveBeenCalledWith(rpcError, "session-feedback-aggregate-fetch");
  });

  it("Case 4: throws + captureError on malformed shape", async () => {
    mockRpc.mockResolvedValueOnce({ data: { foo: 1 }, error: null });

    await expect(getSessionFeedbackAggregate("u", "c", "A2")).rejects.toThrow(
      "get_session_feedback_aggregate returned malformed shape"
    );
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      "session-feedback-aggregate-fetch"
    );
  });

  it("Case 5: passes null preCefrLevel through verbatim", async () => {
    mockRpc.mockResolvedValueOnce({ data: validAggregate, error: null });

    await getSessionFeedbackAggregate("u", "c", null);

    const [, args] = mockRpc.mock.calls[0];
    expect(args.p_pre_cefr_level).toBeNull();
  });

  // Story 13-2 P7 lesson: per-key rejection matrix.
  const keyRejectionMatrix: readonly {
    name: string;
    mutation: (v: SessionFeedbackAggregate) => unknown;
  }[] = [
    { name: "prev_session wrong type", mutation: (v) => ({ ...v, prev_session: 42 }) },
    {
      name: "prev_session missing completed_at",
      mutation: (v) => ({ ...v, prev_session: { ai_feedback: null, duration_seconds: null } }),
    },
    {
      name: "cefr_promotion missing `to`",
      mutation: (v) => ({ ...v, cefr_promotion: { from: "A2" } }),
    },
    {
      name: "max_fluency_rating as string",
      mutation: (v) => ({ ...v, max_fluency_rating: "4" }),
    },
    {
      name: "max_grammar_rating null",
      mutation: (v) => ({ ...v, max_grammar_rating: null }),
    },
    {
      name: "recent_resolved_error wrong type",
      mutation: (v) => ({ ...v, recent_resolved_error: 42 }),
    },
    {
      name: "recent_resolved_error missing error_description",
      mutation: (v) => ({ ...v, recent_resolved_error: {} }),
    },
    {
      name: "error_counts missing total",
      mutation: (v) => ({ ...v, error_counts: { resolved: 0 } }),
    },
    {
      name: "error_counts missing resolved",
      mutation: (v) => ({ ...v, error_counts: { total: 5 } }),
    },
    {
      name: "error_counts non-object",
      mutation: (v) => ({ ...v, error_counts: 42 }),
    },
  ];
  it.each(keyRejectionMatrix)(
    "Case 6-matrix: rejects malformed shape — $name",
    async ({ mutation }) => {
      mockRpc.mockResolvedValueOnce({ data: mutation(validAggregate), error: null });
      await expect(getSessionFeedbackAggregate("u", "c", "A2")).rejects.toThrow(
        "get_session_feedback_aggregate returned malformed shape"
      );
    }
  );
});

describe("isValidSessionFeedbackAggregate — Story 13-3 shape guard", () => {
  it("accepts a well-formed aggregate", () => {
    expect(isValidSessionFeedbackAggregate(validAggregate)).toBe(true);
  });

  it("rejects non-object inputs", () => {
    expect(isValidSessionFeedbackAggregate(null)).toBe(false);
    expect(isValidSessionFeedbackAggregate(undefined)).toBe(false);
    expect(isValidSessionFeedbackAggregate("string")).toBe(false);
    expect(isValidSessionFeedbackAggregate(42)).toBe(false);
  });

  it("accepts null prev_session + null cefr_promotion + null recent_resolved_error", () => {
    const variant: SessionFeedbackAggregate = {
      prev_session: null,
      cefr_promotion: null,
      max_fluency_rating: 0,
      max_grammar_rating: 0,
      recent_resolved_error: null,
      error_counts: { total: 0, resolved: 0 },
    };
    expect(isValidSessionFeedbackAggregate(variant)).toBe(true);
  });

  it("accepts prev_session with null ai_feedback (rating fields absent server-side)", () => {
    const variant = {
      ...validAggregate,
      prev_session: {
        ai_feedback: null,
        duration_seconds: 100,
        completed_at: "2026-05-10T12:00:00Z",
      },
    };
    expect(isValidSessionFeedbackAggregate(variant)).toBe(true);
  });

  it("accepts prev_session with null duration_seconds", () => {
    const variant = {
      ...validAggregate,
      prev_session: {
        ai_feedback: { fluencyRating: 3, grammarRating: 4 },
        duration_seconds: null,
        completed_at: "2026-05-10T12:00:00Z",
      },
    };
    expect(isValidSessionFeedbackAggregate(variant)).toBe(true);
  });
});
