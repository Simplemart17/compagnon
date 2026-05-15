/**
 * Story 13-2 — `retrieveDailyGreetingMemories` module-level embedding cache tests
 * (audit P2-5 partial closure).
 *
 * Pins:
 *   - First call generates embedding + caches it.
 *   - Second+ calls within same module lifetime reuse the cached embedding
 *     (NO second `generateEmbedding` call).
 *   - `match_memories` RPC fires on EVERY call (the cache is for the
 *     embedding, not the result).
 *   - `__resetDailyGreetingEmbeddingForTests` clears the cache.
 *   - Runtime guard: `__resetDailyGreetingEmbeddingForTests` throws in
 *     non-test environments (Story 12-2 P11 / Story 12-5 / Story 12-7 pattern).
 *   - Story 9-4 sanitizeMemoryContent invariant preserved at read-time on
 *     every returned memory string.
 */

import { __resetDailyGreetingEmbeddingForTests, retrieveDailyGreetingMemories } from "../memory";

const mockGenerateEmbedding = jest.fn();
jest.mock("../openai", () => ({
  __esModule: true,
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  chatCompletion: jest.fn(),
  chatCompletionJSON: jest.fn(),
}));

// Story 13-2 review-round-1 P4: mock sentry so generateEmbedding-rejection
// test (Case 10) can assert captureError routing.
jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

const FAKE_EMBEDDING = new Array(1536).fill(0).map((_, i) => i / 1536);

beforeEach(() => {
  jest.clearAllMocks();
  __resetDailyGreetingEmbeddingForTests();
  mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
  mockRpc.mockResolvedValue({
    data: [{ content: "user is learning French for TCF" }],
    error: null,
  });
});

describe("retrieveDailyGreetingMemories — Story 13-2 embedding memoization", () => {
  it("Case 1: first call invokes generateEmbedding('daily greeting')", async () => {
    await retrieveDailyGreetingMemories("user-123", 3);

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("daily greeting");
  });

  it("Case 2: second call REUSES cached embedding (no second generateEmbedding call)", async () => {
    await retrieveDailyGreetingMemories("user-123", 3);
    await retrieveDailyGreetingMemories("user-123", 3);
    await retrieveDailyGreetingMemories("user-456", 3); // different user — same cache

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("Case 3: match_memories RPC fires on EVERY call (cache is for embedding, not result)", async () => {
    await retrieveDailyGreetingMemories("user-123", 3);
    await retrieveDailyGreetingMemories("user-123", 3);
    await retrieveDailyGreetingMemories("user-123", 3);

    const rpcCalls = mockRpc.mock.calls.filter((args) => args[0] === "match_memories");
    expect(rpcCalls.length).toBe(3);
  });

  it("Case 4: match_memories receives the cached embedding as query_embedding", async () => {
    await retrieveDailyGreetingMemories("user-123", 3);

    const rpcCall = mockRpc.mock.calls.find((args) => args[0] === "match_memories");
    expect(rpcCall).toBeDefined();
    const args = rpcCall![1] as { query_embedding: string; match_count: number };
    expect(args.match_count).toBe(3);
    expect(JSON.parse(args.query_embedding)).toEqual(FAKE_EMBEDDING);
  });

  it("Case 5: returns sanitized memory contents (Story 9-4 read-time invariant)", async () => {
    // Story 13-2 review-round-1 P9: the filter logic at the bottom of
    // retrieveDailyGreetingMemories is `.filter((c) => c.length > 0)`,
    // which depends on `sanitizeMemoryContent("")` returning a falsy/
    // empty value. Pre-patch we relied on the un-mocked production
    // sanitizer for that contract — a future Story 9-4 patch making
    // the sanitizer return a placeholder like "[empty]" would silently
    // break this test's intent (it'd pass for wrong reasons). Post-
    // patch we use input strings that the production sanitizer leaves
    // alone (non-empty, no injection markers), so the filter behavior
    // is observable independent of sanitizer internals.
    mockRpc.mockResolvedValueOnce({
      data: [
        { content: "first memory about French grammar" },
        { content: "third memory about pronunciation" },
      ],
      error: null,
    });

    const result = await retrieveDailyGreetingMemories("user-123", 3);

    expect(result.length).toBe(2);
    expect(result).toContain("first memory about French grammar");
    expect(result).toContain("third memory about pronunciation");
  });

  it("Case 6: __resetDailyGreetingEmbeddingForTests clears the cache", async () => {
    await retrieveDailyGreetingMemories("user-123", 3);
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);

    __resetDailyGreetingEmbeddingForTests();

    await retrieveDailyGreetingMemories("user-123", 3);
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2); // cache miss after reset
  });

  it("Case 7: __resetDailyGreetingEmbeddingForTests throws in non-test environment", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      // Bypass the narrowed-union type by going through a Record<string, string>
      // view of process.env. The runtime guard inside the helper reads via
      // `process.env.NODE_ENV !== "test"` — independent of TypeScript's
      // narrowing.
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(() => __resetDailyGreetingEmbeddingForTests()).toThrow(
        "__resetDailyGreetingEmbeddingForTests is test-only"
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    }
  });

  it("Case 8: limit defaults to 3 when omitted", async () => {
    await retrieveDailyGreetingMemories("user-123");

    const rpcCall = mockRpc.mock.calls.find((args) => args[0] === "match_memories");
    const args = rpcCall![1] as { match_count: number };
    expect(args.match_count).toBe(3);
  });

  it("Case 9 (P1): concurrent first-callers share ONE generateEmbedding via in-flight Promise gate", async () => {
    // Story 13-2 review-round-1 P1: two concurrent home mounts both
    // observing `dailyGreetingEmbeddingCache === null` must NOT each fire
    // their own `generateEmbedding` call. Pre-patch the cost-ledger would
    // double-charge for the embedding action under concurrent mounts.
    // Post-patch the in-flight Promise gate deduplicates.
    let resolveEmbedding: (value: number[]) => void = () => {};
    const slowEmbeddingPromise = new Promise<number[]>((resolve) => {
      resolveEmbedding = resolve;
    });
    mockGenerateEmbedding.mockReturnValueOnce(slowEmbeddingPromise);

    // Fire 3 concurrent calls BEFORE the embedding resolves.
    const call1 = retrieveDailyGreetingMemories("user-A", 3);
    const call2 = retrieveDailyGreetingMemories("user-B", 3);
    const call3 = retrieveDailyGreetingMemories("user-C", 3);

    // Even with 3 concurrent callers, only ONE generateEmbedding call
    // fires (the others await the in-flight Promise).
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);

    // Resolve the embedding so all 3 calls complete.
    resolveEmbedding(FAKE_EMBEDDING);
    await Promise.all([call1, call2, call3]);

    // All 3 callers got a result; the embedding was generated only once.
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("Case 10 (P4): generateEmbedding rejection routes through captureError", async () => {
    // Story 13-2 review-round-1 P4: pre-patch a generateEmbedding
    // rejection propagated silently (caller swallowed, user fell to
    // fetchRecentMemories) — embedding failure invisible in production
    // logs. Post-patch the rejection routes through captureError with
    // the "daily-greeting-embedding" feature tag BEFORE the throw.
    const embeddingError = new Error("OpenAI rate limit");
    mockGenerateEmbedding.mockRejectedValueOnce(embeddingError);

    // captureError is imported from ../sentry (already mocked above).
    const { captureError } = jest.requireMock("../sentry") as {
      captureError: jest.Mock;
    };

    await expect(retrieveDailyGreetingMemories("user-123", 3)).rejects.toBe(embeddingError);
    expect(captureError).toHaveBeenCalledWith(embeddingError, "daily-greeting-embedding");
  });
});
