/**
 * Story 12-6 — `transcript-cap` pure-helper unit tests.
 *
 * Pins the cap + spill contract for the in-memory voice-conversation
 * transcript bookkeeping. The load-bearing assertions:
 *   (a) `MAX_TRANSCRIPT_ENTRIES === 200` — constant pin (regression guard
 *       against silent operator drift).
 *   (b) `applyTranscriptCap` is pure FIFO: input arrays are never mutated;
 *       new arrays are always returned; FIFO eviction order preserved.
 *   (c) Cap-then-evict sequencing: the newly-appended entry is NEVER
 *       evicted in the same operation, even at exact-200-then-add-one.
 *   (d) `toMessagePayload` drops `id` + `timestamp`, preserves `corrections`
 *       (defaults to `null` when absent — matches the existing `?? null`
 *       idiom in `realtime-orchestrator.ts` Slot 1).
 */

import type { TranscriptEntry } from "../realtime-transcript";
import { MAX_TRANSCRIPT_ENTRIES, applyTranscriptCap, toMessagePayload } from "../transcript-cap";

function makeEntry(i: number, role: "user" | "assistant" = "assistant"): TranscriptEntry {
  return {
    id: `${role}_${i}`,
    role,
    text: `entry ${i}`,
    timestamp: 1000 + i,
  };
}

describe("Story 12-6 — transcript-cap constant pin", () => {
  it("Case 1: MAX_TRANSCRIPT_ENTRIES === 200 (regression guard)", () => {
    expect(MAX_TRANSCRIPT_ENTRIES).toBe(200);
  });
});

describe("Story 12-6 — applyTranscriptCap identity (no eviction)", () => {
  it("Case 2: empty transcript + 1 new entry → 1-entry transcript + empty evicted", () => {
    const entry = makeEntry(0);
    const result = applyTranscriptCap([], entry);
    expect(result.transcript).toEqual([entry]);
    expect(result.evicted).toEqual([]);
  });

  it("Case 3: 199-entry transcript + 1 new entry → 200-entry transcript + empty evicted (exact boundary, no eviction yet)", () => {
    const input = Array.from({ length: 199 }, (_, i) => makeEntry(i));
    const newEntry = makeEntry(199);
    const result = applyTranscriptCap(input, newEntry);
    expect(result.transcript).toHaveLength(200);
    expect(result.transcript[199]).toBe(newEntry);
    expect(result.evicted).toEqual([]);
  });
});

describe("Story 12-6 — applyTranscriptCap eviction (FIFO)", () => {
  it("Case 4: 200-entry transcript + 1 new entry → 200-entry transcript + 1-entry evicted (the OLDEST)", () => {
    const input = Array.from({ length: 200 }, (_, i) => makeEntry(i));
    const newEntry = makeEntry(200);
    const result = applyTranscriptCap(input, newEntry);
    expect(result.transcript).toHaveLength(200);
    // Newest is at the tail.
    expect(result.transcript[199]).toBe(newEntry);
    // Oldest (index 0 in input) is evicted.
    expect(result.evicted).toHaveLength(1);
    expect(result.evicted[0]).toBe(input[0]);
    // Tail-200 of the returned transcript begins with entry[1] (entry[0] evicted).
    expect(result.transcript[0]).toBe(input[1]);
  });

  it("Case 5: FIFO ordering — the new entry is ALWAYS at the END of the returned transcript", () => {
    const input = Array.from({ length: 200 }, (_, i) => makeEntry(i));
    const newEntry = makeEntry(999);
    const result = applyTranscriptCap(input, newEntry);
    expect(result.transcript[result.transcript.length - 1]).toBe(newEntry);
  });

  it("Case 6: hot-loop simulation — 250 entries fed one-at-a-time → final transcript=200; evicted set covers all 50 oldest entries in FIFO order", () => {
    let transcript: TranscriptEntry[] = [];
    const evictedAccumulator: TranscriptEntry[] = [];
    for (let i = 0; i < 250; i++) {
      const result = applyTranscriptCap(transcript, makeEntry(i));
      transcript = result.transcript;
      for (const evicted of result.evicted) {
        evictedAccumulator.push(evicted);
      }
    }
    expect(transcript).toHaveLength(200);
    // Tail-200 are entries 50..249 (the 50 oldest evicted).
    expect(transcript[0].id).toBe("assistant_50");
    expect(transcript[199].id).toBe("assistant_249");
    // Evicted entries are 0..49 in chronological FIFO order.
    expect(evictedAccumulator).toHaveLength(50);
    expect(evictedAccumulator[0].id).toBe("assistant_0");
    expect(evictedAccumulator[49].id).toBe("assistant_49");
  });
});

describe("Story 12-6 — applyTranscriptCap immutability", () => {
  it("Case 7: input transcript array is NOT mutated; result.transcript is a brand-new array (even on identity path)", () => {
    const input = Array.from({ length: 50 }, (_, i) => makeEntry(i));
    const inputSnapshot = [...input];
    const inputRef = input;
    const newEntry = makeEntry(50);

    const result = applyTranscriptCap(input, newEntry);

    // Input reference unchanged.
    expect(input).toBe(inputRef);
    // Input contents unchanged.
    expect(input).toEqual(inputSnapshot);
    // Result is a NEW array (reference inequality).
    expect(result.transcript).not.toBe(input);
  });
});

describe("Story 12-6 — toMessagePayload contract", () => {
  it("Case 8: shape — id + timestamp dropped; conversation_id added; role + content + corrections preserved", () => {
    const entry: TranscriptEntry = {
      id: "ai_xyz",
      role: "assistant",
      text: "Bonjour!",
      timestamp: 1234567,
      corrections: [
        {
          original: "Salut",
          corrected: "Bonjour",
          explanation: "more formal",
          category: "register",
        },
      ],
    };
    const payload = toMessagePayload(entry, "convo-id-123");
    expect(payload).toEqual({
      conversation_id: "convo-id-123",
      role: "assistant",
      content: "Bonjour!",
      corrections: entry.corrections,
    });
    // Explicit: id + timestamp are NOT present in the payload.
    expect((payload as unknown as Record<string, unknown>).id).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).timestamp).toBeUndefined();
  });

  it("Case 9: entry.corrections === undefined → payload.corrections === null (matches existing `?? null` idiom)", () => {
    const entry = makeEntry(0, "user");
    const payload = toMessagePayload(entry, "convo-id-456");
    expect(payload.corrections).toBeNull();
  });

  it("Case 10: entry.corrections === [c1, c2] → payload.corrections === [c1, c2] (array preserved verbatim)", () => {
    const corrections = [
      { original: "a", corrected: "b", explanation: "x", category: "grammar" as const },
      { original: "c", corrected: "d", explanation: "y", category: "vocabulary" as const },
    ];
    const entry: TranscriptEntry = {
      id: "u_1",
      role: "user",
      text: "test",
      timestamp: 9999,
      corrections,
    };
    const payload = toMessagePayload(entry, "convo-789");
    expect(payload.corrections).toBe(corrections);
  });
});
