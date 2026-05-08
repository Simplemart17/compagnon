/**
 * Regression suite for `flushWriteQueue`'s in-flight Promise guard (story 9-6).
 *
 * Mocks `@react-native-async-storage/async-storage` and `src/lib/network`
 * (`isOnline`) so the test runs without RN bridges or real network. Each
 * test resets the mocks between runs.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { enqueueWrite, flushWriteQueue } from "../cache";
import { isOnline } from "../network";

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

    // The queue was read exactly once during the in-flight window. Subsequent
    // reads (e.g. by `getPendingWriteCount`) are not part of this assertion.
    const queueGetItemCalls = mockedStorage.getItem.mock.calls.filter(
      ([key]) => key === "@companion_write_queue"
    );
    expect(queueGetItemCalls.length).toBe(1);
  });

  // Case 14 — guard resets after a true rejection from inside the IIFE.
  //
  // We mock `isOnline` to throw because it is NOT wrapped in the swallow-
  // and-return-[] guard that `readQueue` uses; the rejection propagates up
  // through the IIFE, the awaited Promise rejects, and the `finally` block
  // must reset `flushInFlight = null` so the next caller proceeds.
  it("in-flight guard resets after a true rejection so subsequent calls proceed", async () => {
    await enqueueWrite({ table: "exercises", operation: "insert", payload: { id: "wA" } });

    // First call: isOnline throws — readQueue is never reached, IIFE rejects.
    mockedIsOnline.mockImplementationOnce(async () => {
      throw new Error("network-check failure");
    });

    const client1 = makeMockSupabase();
    let rejection: unknown = null;
    try {
      await flushWriteQueue(client1);
    } catch (err) {
      rejection = err;
    }
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe("network-check failure");
    expect(client1.insertCalls).toBe(0);

    // Second call (default mocks restored): queue still has wA; the
    // `finally` block must have reset `flushInFlight` to null, otherwise
    // this call would either hang or replay the rejected promise.
    const client2 = makeMockSupabase();
    const result2 = await flushWriteQueue(client2);
    expect(result2).toBe(1);
    expect(client2.insertCalls).toBe(1);
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
});
