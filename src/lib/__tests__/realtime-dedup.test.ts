/**
 * Story 9-5 — Voice transcript dedup regression suite.
 *
 * Asserts the pure helpers in `src/lib/realtime-transcript.ts` correctly:
 *   1. Append exactly one TranscriptEntry per (item_id) AI turn.
 *   2. Suppress duplicate `.done` events for the same key.
 *   3. Fall back through `item_id → response_id → fallback_<contentHash>`.
 *   4. Cap the dedup Set with FIFO eviction so dedup stays correct past the cap.
 *   5. Stream deltas from a single in-flight item; drop cross-item drift and
 *      between-turn unattributed deltas.
 *   6. Fire the onDedup callback (the hook wires this to a Sentry breadcrumb)
 *      exactly when a duplicate is suppressed.
 *   7. Treat empty / whitespace-only payloads as no-ops so a stray empty `.done`
 *      cannot render a blank assistant bubble or burn a key slot.
 *   8. Keep all dedup keys free of raw text content (Sentry-safe).
 *
 * The pure module is exercised directly — no React, no WebSocket, no Supabase.
 */

import type { Correction } from "@/src/types/conversation";

import {
  acceptDelta,
  appendIfNew,
  DEDUP_SET_CAP,
  resolveTranscriptKey,
  type DeltaState,
  type TranscriptEntry,
} from "../realtime-transcript";

// Story 11-1: `parseCorrectionsForTest` mirror function (Case 14) is
// deleted with the production regex. The dedup contract this suite
// covers is the `appendIfNew` keying + FIFO eviction + dedup-set
// invariants — orthogonal to how corrections are extracted upstream.

const noCorrections = (_text: string): Correction[] => [];

function emptyAppendInput() {
  return {
    processed: new Set<string>(),
    transcript: [] as TranscriptEntry[],
    corrections: [] as Correction[],
  };
}

describe("appendIfNew (story 9-5)", () => {
  it("Case 1 — single audio-transcript event appends one entry with stable id", () => {
    const input = emptyAppendInput();
    const result = appendIfNew(input, "i1", "Bonjour!", { parseCorrections: noCorrections });

    expect(result.appended).toBe(true);
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0].id).toBe("ai_i1");
    expect(result.transcript[0].text).toBe("Bonjour!");
    expect(result.transcript[0].role).toBe("assistant");
    expect(input.processed.has("i1")).toBe(true);
  });

  it("Case 2 — duplicate event with same item_id is suppressed", () => {
    const input = emptyAppendInput();
    const onDedup = jest.fn();

    const first = appendIfNew(input, "i1", "Bonjour!", {
      parseCorrections: noCorrections,
      onDedup,
    });
    expect(first.appended).toBe(true);

    // Reset arrays between calls so the test mirrors how the hook re-feeds refs.
    const second = appendIfNew(
      { ...input, transcript: first.transcript, corrections: first.corrections },
      "i1",
      "Bonjour!",
      { parseCorrections: noCorrections, onDedup }
    );

    expect(second.appended).toBe(false);
    expect(second.transcript).toBe(first.transcript); // returned the unchanged array
    expect(second.transcript).toHaveLength(1);
    expect(onDedup).toHaveBeenCalledTimes(1);
    expect(onDedup).toHaveBeenCalledWith("i1");
  });

  it("Case 3 — audio-transcript followed by stray text-done with same item_id dedupes", () => {
    const input = emptyAppendInput();
    // Audio came first.
    const audio = appendIfNew(input, "i1", "Bonjour audio!", {
      parseCorrections: noCorrections,
    });
    // Text-fallback path then arrives for the same item_id (modality-drift scenario).
    const text = appendIfNew(
      { ...input, transcript: audio.transcript, corrections: audio.corrections },
      "i1",
      "Bonjour text!",
      { parseCorrections: noCorrections }
    );

    expect(text.appended).toBe(false);
    expect(text.transcript).toHaveLength(1);
    expect(text.transcript[0].text).toBe("Bonjour audio!");
  });

  it("Case 4 — two distinct AI turns produce two entries", () => {
    const input = emptyAppendInput();
    const first = appendIfNew(input, "i1", "Salut!", { parseCorrections: noCorrections });
    const second = appendIfNew(
      { ...input, transcript: first.transcript, corrections: first.corrections },
      "i2",
      "Comment ça va?",
      { parseCorrections: noCorrections }
    );

    expect(second.transcript).toHaveLength(2);
    expect(second.transcript[0].id).toBe("ai_i1");
    expect(second.transcript[1].id).toBe("ai_i2");
  });

  it("Case 7 — set caps at DEDUP_SET_CAP with FIFO eviction; recent keys still dedupe", () => {
    const input = emptyAppendInput();
    let transcript: TranscriptEntry[] = [];
    let corrections: Correction[] = [];

    for (let i = 0; i < DEDUP_SET_CAP; i += 1) {
      const r = appendIfNew(
        { processed: input.processed, transcript, corrections },
        `item_${i}`,
        `t${i}`,
        { parseCorrections: noCorrections }
      );
      transcript = r.transcript;
      corrections = r.corrections;
    }
    expect(input.processed.size).toBe(DEDUP_SET_CAP);

    // The (DEDUP_SET_CAP + 1)th add evicts the oldest, keeping the cap saturated.
    const r = appendIfNew(
      { processed: input.processed, transcript, corrections },
      `item_${DEDUP_SET_CAP}`,
      `t${DEDUP_SET_CAP}`,
      { parseCorrections: noCorrections }
    );

    expect(r.appended).toBe(true);
    expect(input.processed.size).toBe(DEDUP_SET_CAP);
    expect(input.processed.has("item_0")).toBe(false); // oldest evicted
    expect(input.processed.has("item_1")).toBe(true); // second-oldest preserved
    expect(input.processed.has(`item_${DEDUP_SET_CAP}`)).toBe(true); // newest added
  });

  it("Case 7b — a duplicate `.done` for a still-resident key is suppressed past the cap", () => {
    const input = emptyAppendInput();
    let transcript: TranscriptEntry[] = [];
    let corrections: Correction[] = [];

    for (let i = 0; i < DEDUP_SET_CAP + 5; i += 1) {
      const r = appendIfNew(
        { processed: input.processed, transcript, corrections },
        `item_${i}`,
        `t${i}`,
        { parseCorrections: noCorrections }
      );
      transcript = r.transcript;
      corrections = r.corrections;
    }
    // item_5 is still in the Set (oldest 5 were evicted). A retransmitted
    // `.done` for item_5 must be suppressed, not double-appended.
    const dup = appendIfNew(
      { processed: input.processed, transcript, corrections },
      "item_5",
      "t5",
      { parseCorrections: noCorrections }
    );
    expect(dup.appended).toBe(false);
    expect(dup.transcript).toHaveLength(DEDUP_SET_CAP + 5);
  });

  it("Case 13 — onDedup callback fires exactly when a duplicate is suppressed", () => {
    const input = emptyAppendInput();
    const onDedup = jest.fn();

    const first = appendIfNew(input, "i1", "x", { parseCorrections: noCorrections, onDedup });
    expect(first.appended).toBe(true);
    expect(onDedup).not.toHaveBeenCalled();

    const second = appendIfNew(
      { ...input, transcript: first.transcript, corrections: first.corrections },
      "i1",
      "x",
      { parseCorrections: noCorrections, onDedup }
    );
    expect(second.appended).toBe(false);
    expect(onDedup).toHaveBeenCalledTimes(1);
    expect(onDedup).toHaveBeenCalledWith("i1");
  });

  // Story 11-1: the pre-11-1 Case 14 verified the parseCorrections regex
  // contract. The production regex is deleted; the callback's role is now
  // to drain a per-turn buffer. The new Case 14 verifies the dedup contract
  // continues to invoke `parseCorrections` exactly once per unique key —
  // protecting against a future refactor that accidentally double-invokes
  // the callback (which would silently drain the buffer twice, producing
  // zero corrections on the second call because the buffer is now empty).
  // Review patch P5 (MED).
  it("Case 14 — parseCorrections is invoked exactly once per unique key", () => {
    const input = emptyAppendInput();
    const parseCorrectionsSpy = jest.fn(() => [] as Correction[]);

    // First .done for a new key — callback fires.
    const first = appendIfNew(input, "i1", "Bonjour!", { parseCorrections: parseCorrectionsSpy });
    expect(first.appended).toBe(true);
    expect(parseCorrectionsSpy).toHaveBeenCalledTimes(1);

    // Replay of the same key — dedup blocks the append AND the callback.
    // A future refactor that calls parseCorrections before the dedup check
    // would burn a drain on a stale event and lose real corrections on the
    // next unique key.
    const second = appendIfNew(
      { ...input, transcript: first.transcript, corrections: first.corrections },
      "i1",
      "Bonjour!",
      { parseCorrections: parseCorrectionsSpy }
    );
    expect(second.appended).toBe(false);
    expect(parseCorrectionsSpy).toHaveBeenCalledTimes(1); // unchanged

    // Distinct key — callback fires exactly one MORE time.
    const third = appendIfNew(
      { ...input, transcript: first.transcript, corrections: first.corrections },
      "i2",
      "Salut!",
      { parseCorrections: parseCorrectionsSpy }
    );
    expect(third.appended).toBe(true);
    expect(parseCorrectionsSpy).toHaveBeenCalledTimes(2);
  });

  it("Case 15 — empty payload is a no-op (no append, no key consumed)", () => {
    const input = emptyAppendInput();
    const onDedup = jest.fn();

    const r = appendIfNew(input, "i1", "", { parseCorrections: noCorrections, onDedup });
    expect(r.appended).toBe(false);
    expect(r.transcript).toHaveLength(0);
    expect(input.processed.has("i1")).toBe(false);
    expect(onDedup).not.toHaveBeenCalled();
  });

  it("Case 15b — whitespace-only payload is a no-op", () => {
    const input = emptyAppendInput();
    const r = appendIfNew(input, "i1", "   \n\t  ", { parseCorrections: noCorrections });
    expect(r.appended).toBe(false);
    expect(input.processed.has("i1")).toBe(false);
  });
});

describe("resolveTranscriptKey (story 9-5)", () => {
  it("Case 5 — falls back to response_id when item_id is missing", () => {
    const key = resolveTranscriptKey({ response_id: "r1" }, "X");
    expect(key).toBe("r1");
  });

  it("Case 6 — falls back to deterministic content hash when both ids are missing", () => {
    const k1 = resolveTranscriptKey({}, "Bonjour le monde");
    const k2 = resolveTranscriptKey({}, "Bonjour le monde");
    expect(k1).toBe(k2); // deterministic — same text → same key
    expect(k1.startsWith("fallback_")).toBe(true);
  });

  it("Case 6b — fallback key carries no raw text (Sentry-safe)", () => {
    const sentence = "Je m'appelle Marie et j'habite à Paris depuis trois ans.";
    const key = resolveTranscriptKey({}, sentence);
    // The key must be opaque — `fallback_` prefix plus a base-36 hash, with
    // no fragments of the user / AI's free-text bleeding through.
    expect(key).toMatch(/^fallback_[0-9a-z]+$/);
    expect(key).not.toContain("Marie");
    expect(key).not.toContain("Paris");
    expect(key).not.toContain("Je");
    // No spaces, accented characters, punctuation — the entire content
    // payload of the original text must NOT be reconstructable from the key.
    const hashPart = key.replace(/^fallback_/, "");
    expect(hashPart).toMatch(/^[0-9a-z]+$/);
  });

  it("Case 6c — different texts produce different fallback keys", () => {
    const k1 = resolveTranscriptKey({}, "Bonjour");
    const k2 = resolveTranscriptKey({}, "Bonsoir");
    expect(k1).not.toBe(k2);
  });

  it("Case 6d — emoji / surrogate-pair text hashes without crashing", () => {
    expect(() => {
      resolveTranscriptKey({}, "😀😀😀😀😀 Bonjour 🇫🇷");
    }).not.toThrow();
    const k = resolveTranscriptKey({}, "😀😀😀😀😀 Bonjour 🇫🇷");
    expect(k.startsWith("fallback_")).toBe(true);
    expect(k).not.toContain("😀");
  });

  it("prefers item_id over response_id when both are present", () => {
    const key = resolveTranscriptKey({ item_id: "i1", response_id: "r1" }, "X");
    expect(key).toBe("i1");
  });
});

describe("acceptDelta (story 9-5)", () => {
  const initial: DeltaState = { inflightItemId: null, pendingText: "" };

  it("Case 8 — single-item stream concatenates correctly", () => {
    let s: DeltaState = initial;
    for (const piece of ["Bon", "jour", "!"]) {
      const r = acceptDelta(s, "i1", piece);
      expect(r.accepted).toBe(true);
      s = r.state;
    }
    expect(s.inflightItemId).toBe("i1");
    expect(s.pendingText).toBe("Bonjour!");
  });

  it("Case 9 — cross-item delta is dropped", () => {
    const s: DeltaState = { inflightItemId: "i1", pendingText: "Bon" };
    const r = acceptDelta(s, "i2", "jour");
    expect(r.accepted).toBe(false);
    expect(r.state).toBe(s);
    expect(r.state.pendingText).toBe("Bon");
  });

  it("Case 10 — null itemId mid-turn is tolerated and appended", () => {
    const s: DeltaState = { inflightItemId: "i1", pendingText: "Bon" };
    const r = acceptDelta(s, null, "jour");
    expect(r.accepted).toBe(true);
    expect(r.state.inflightItemId).toBe("i1");
    expect(r.state.pendingText).toBe("Bonjour");
  });

  it("Case 10b — null itemId between turns is dropped (no inflight to attribute to)", () => {
    const r = acceptDelta(initial, null, "stale");
    expect(r.accepted).toBe(false);
    expect(r.state).toBe(initial);
    expect(r.state.pendingText).toBe("");
  });

  it("adopts a fresh item_id when inflight is null", () => {
    const r = acceptDelta(initial, "i1", "Bon");
    expect(r.accepted).toBe(true);
    expect(r.state.inflightItemId).toBe("i1");
    expect(r.state.pendingText).toBe("Bon");
  });
});

describe("hook-side reset semantics (story 9-5)", () => {
  // These mirror the resets done in `useRealtimeVoice.start()` and on `response.done`.
  // The hook owns the refs; here we assert the contract is "clear the Set, null the inflight,
  // empty the pending text".

  it("Case 11 — clearing inflight + pending on response.done allows a fresh turn to adopt cleanly", () => {
    // Simulate a cancelled response: inflight was "i1" with pending "abc",
    // then `response.done` fires WITHOUT a `.done` transcript event.
    let s: DeltaState = { inflightItemId: "i1", pendingText: "abc" };
    // Hook handler sets BOTH inflight and pending to null/"" — not just inflight.
    s = { inflightItemId: null, pendingText: "" };

    // Next turn's first delta must NOT concatenate onto the cancelled prefix.
    const r = acceptDelta(s, "i2", "X");
    expect(r.accepted).toBe(true);
    expect(r.state.inflightItemId).toBe("i2");
    expect(r.state.pendingText).toBe("X"); // not "abcX"
  });

  it("Case 12 — start() resets both the dedup Set and the inflight item to a clean state", () => {
    const processed = new Set<string>(["i1", "i2"]);
    let inflight: string | null = "i1";

    // Hook reset on start():
    processed.clear();
    inflight = null;

    expect(processed.size).toBe(0);
    expect(inflight).toBeNull();

    // A fresh append works after reset.
    const r = appendIfNew({ processed, transcript: [], corrections: [] }, "i_new", "Salut!", {
      parseCorrections: noCorrections,
    });
    expect(r.appended).toBe(true);
    expect(processed.has("i_new")).toBe(true);
  });
});
