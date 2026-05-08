/**
 * Regression suite for `flushWriteQueue`'s in-flight Promise guard (story 9-6)
 * extended for story 9-10 (atomic merge on persist + IIFE catch-and-return-0).
 *
 * Mocks `@react-native-async-storage/async-storage` and `src/lib/network`
 * (`isOnline`) so the test runs without RN bridges or real network. Each
 * test resets the mocks between runs.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { enqueueWrite, flushWriteQueue } from "../cache";
import { isOnline } from "../network";
import { captureError } from "../sentry";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      multiRemove: jest.fn(async (keys: string[]) => {
        for (const k of keys) delete store[k];
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      __reset: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  };
});

jest.mock("../network", () => ({
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  multiRemove: jest.Mock;
  getAllKeys: jest.Mock;
  __reset: () => void;
};
const mockedIsOnline = isOnline as jest.Mock;
const mockedCaptureError = captureError as jest.Mock;

interface MockSupabaseClient {
  from: jest.Mock;
  inserts: Record<string, unknown>[];
  insertCalls: number;
  insertDelayMs: number;
}

function makeMockSupabase(insertDelayMs = 0): MockSupabaseClient {
  const inserts: Record<string, unknown>[] = [];
  const client: MockSupabaseClient = {
    from: jest.fn(),
    inserts,
    insertCalls: 0,
    insertDelayMs,
  };
  client.from.mockImplementation(() => ({
    insert: jest.fn(async (payload: Record<string, unknown>) => {
      client.insertCalls++;
      inserts.push(payload);
      if (client.insertDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, client.insertDelayMs));
      }
      return { error: null };
    }),
    update: jest.fn(() => ({
      eq: jest.fn(async () => ({ error: null })),
    })),
    upsert: jest.fn(async () => ({ error: null })),
  }));
  return client;
}

describe("flushWriteQueue idempotency guard", () => {
  beforeEach(() => {
    mockedStorage.__reset();
    mockedStorage.getItem.mockClear();
    mockedStorage.setItem.mockClear();
    mockedIsOnline.mockClear();
    mockedIsOnline.mockResolvedValue(true);
    mockedCaptureError.mockClear();
  });

  // Case 13 — concurrent calls share a single replay pass
  it("two concurrent flushWriteQueue calls share one replay pass (no double inserts)", async () => {
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "w1" } });
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "w2" } });

    const client = makeMockSupabase(50); // 50ms delay per insert to widen the race window
    mockedStorage.getItem.mockClear();

    const [a, b] = await Promise.all([flushWriteQueue(client), flushWriteQueue(client)]);

    expect(a).toBe(2);
    expect(b).toBe(2);
    expect(client.insertCalls).toBe(2); // exactly two inserts (one per queued write), NOT four
    expect(client.inserts.map((p) => p.id).sort()).toEqual(["w1", "w2"]);

    // Story 9-10 AC #2 changed the read count: the IIFE now performs a
    // second `readQueue()` just before the terminal `persistQueue` so it can
    // merge any writes added mid-flight. So a single replay pass reads the
    // queue twice — but still exactly one replay pass for both concurrent
    // callers (no double inserts), which is the property under test.
    const queueGetItemCalls = mockedStorage.getItem.mock.calls.filter(
      ([key]) => key === "@companion_write_queue"
    );
    expect(queueGetItemCalls.length).toBe(2);
  });

  // Case 17 (replaces former Case 14, story 9-10 AC #4) — IIFE-internal
  // failure resolves to 0 (does NOT reject) and `captureError` is recorded
  // with context "cache-flush-internal".
  //
  // We mock `isOnline` to throw because it is NOT wrapped in `readQueue`'s
  // swallow-and-return-[] guard. Pre-9-10 the rejection propagated up
  // through the IIFE and the awaited Promise rejected. Post-9-10 the IIFE
  // body is wrapped in `try/catch` so concurrent callers awaiting the same
  // in-flight Promise are not poisoned — both see `0`. The `finally` block
  // still resets `flushInFlight = null` so subsequent calls proceed.
  it("IIFE-internal failure resolves to 0 (was: rejected) and captures via Sentry", async () => {
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "wA" } });

    // First call: isOnline throws — IIFE catches, returns 0.
    mockedIsOnline.mockImplementationOnce(async () => {
      throw new Error("network-check failure");
    });

    const client1 = makeMockSupabase();
    const result1 = await flushWriteQueue(client1);
    expect(result1).toBe(0);
    expect(client1.insertCalls).toBe(0);

    // captureError recorded with the agreed context.
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    const [errArg, contextArg] = mockedCaptureError.mock.calls[0];
    expect(errArg).toBeInstanceOf(Error);
    expect((errArg as Error).message).toBe("network-check failure");
    expect(contextArg).toBe("cache-flush-internal");

    // Second call (default mocks restored): queue still has wA; the
    // `finally` block must have reset `flushInFlight` to null, otherwise
    // this call would either hang or replay the cleared promise.
    const client2 = makeMockSupabase();
    const result2 = await flushWriteQueue(client2);
    expect(result2).toBe(1);
    expect(client2.insertCalls).toBe(1);

    // P10 (9-10 review): the success path must NOT emit
    // `captureError("cache-flush-internal")` — the count stays at 1 from
    // the first call. A regression that captures on every flush would
    // bump this to 2 and is caught here.
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
  });

  // Case 15 — empty queue short-circuits
  it("empty queue resolves to 0 without calling Supabase", async () => {
    const client = makeMockSupabase();
    const result = await flushWriteQueue(client);
    expect(result).toBe(0);
    expect(client.insertCalls).toBe(0);
  });

  // Bonus — offline short-circuit (verifies isOnline gate is preserved)
  it("offline state resolves to 0 without reading the queue", async () => {
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "wB" } });
    mockedIsOnline.mockResolvedValueOnce(false);
    const client = makeMockSupabase();
    const result = await flushWriteQueue(client);
    expect(result).toBe(0);
    expect(client.insertCalls).toBe(0);
  });

  // Case 16 (story 9-10 AC #2) — `enqueueWrite` issued mid-flush is
  // preserved by the atomic merge before the terminal `persistQueue`.
  //
  // Sequence:
  //   1. queue starts at [w1, w2]
  //   2. flushWriteQueue starts; reads snapshot = [w1, w2]
  //   3. flush replays w1 (50ms), then w2 (50ms)
  //   4. mid-flight, enqueueWrite(w3) persists [w1, w2, w3]
  //   5. flush completes; merge step re-reads queue, identifies w3 as
  //      not-in-snapshot, persists [w3] for the next flush.
  //
  // Pre-9-10 the flush's `persistQueue([])` overwrote [w1, w2, w3] and w3
  // was silently lost.
  it("enqueueWrite during a flush is preserved across the flush boundary", async () => {
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "w1" } });
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "w2" } });

    // Wide replay window so we have room to enqueue mid-flight.
    const client = makeMockSupabase(50);

    // Start the flush but do NOT await yet.
    const flushPromise = flushWriteQueue(client);

    // 25ms in (between w1 and w2 inserts), enqueue a new write.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "w3" } });

    const flushed = await flushPromise;
    expect(flushed).toBe(2);
    expect(client.insertCalls).toBe(2);
    expect(client.inserts.map((p) => p.id).sort()).toEqual(["w1", "w2"]);

    // The post-flush queue must contain w3 (preserved). A second flush
    // replays it; the queue is then empty.
    const client2 = makeMockSupabase();
    const flushed2 = await flushWriteQueue(client2);
    expect(flushed2).toBe(1);
    expect(client2.inserts.map((p) => p.id)).toEqual(["w3"]);

    const client3 = makeMockSupabase();
    const flushed3 = await flushWriteQueue(client3);
    expect(flushed3).toBe(0);
    expect(client3.insertCalls).toBe(0);
  });

  // Case 18 (story 9-10 AC #4) — two concurrent callers awaiting the same
  // in-flight Promise both see `0` when the IIFE fails internally; neither
  // rejects. The in-flight guard is reset so a third call proceeds.
  it("two concurrent flushWriteQueue calls both resolve to 0 on internal failure", async () => {
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "wA" } });

    // Single mock that throws once — both concurrent callers share the same
    // in-flight Promise, so isOnline only fires once on the IIFE's first
    // await.
    mockedIsOnline.mockImplementationOnce(async () => {
      throw new Error("isOnline panic");
    });

    const c1 = makeMockSupabase();
    const c2 = makeMockSupabase();

    const [r1, r2] = await Promise.all([flushWriteQueue(c1), flushWriteQueue(c2)]);
    expect(r1).toBe(0);
    expect(r2).toBe(0);
    expect(c1.insertCalls).toBe(0);
    expect(c2.insertCalls).toBe(0);

    // captureError fired exactly once (one IIFE pass, not one per caller).
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError.mock.calls[0][1]).toBe("cache-flush-internal");

    // Third call after the guard reset proceeds normally with default mocks.
    const c3 = makeMockSupabase();
    const r3 = await flushWriteQueue(c3);
    expect(r3).toBe(1);
    expect(c3.insertCalls).toBe(1);
  });
});
