/**
 * Story 11-1 — Realtime correction-protocol helpers test suite.
 *
 * Exercises the pure helpers extracted from `use-realtime-voice.ts` so the
 * `report_correction` tool-call pipeline can be unit-tested without
 * mounting the hook or mocking a WebSocket. Covers:
 *
 *   1. Valid args → `outcome: "recorded"` + structured `Correction`.
 *   2. Invalid args (4 shapes) → `outcome: "invalid"` + Zod issue code.
 *   3. Multiple invocations accumulate in the buffer in insertion order.
 *   4. `drainPendingCorrections` returns the buffer's contents AND
 *      empties the original buffer (subsequent invocations of either
 *      `pendingToolCorrectionsRef.current.push` or `drainPendingCorrections`
 *      operate on the cleared buffer).
 *   5. Drain on an already-empty buffer returns `[]` and is idempotent.
 *
 * The lifecycle assertions for the `response.done` / `case "error"`
 * cleanup paths live in the hook integration surface (the buffer-clear
 * pattern is `ref.current = []`, not a helper invocation) and are not
 * tested here.
 */

import type { Correction } from "@/src/types/conversation";

import {
  drainPendingCorrections,
  FUNCTION_RESULT_ACK,
  MAX_PENDING_CORRECTIONS,
  mergeOrphanCorrections,
  processReportCorrectionCall,
} from "../realtime-corrections";

const VALID_GRAMMAR_ARGS = {
  original: "je suis allé",
  corrected: "je suis allée",
  explanation: "Accord du participe passé avec être au féminin.",
  category: "grammar" as const,
};

const VALID_VOCAB_ARGS = {
  original: "voiture",
  corrected: "automobile",
  explanation: "Register more formal in this context.",
  category: "vocabulary" as const,
};

const VALID_PRONUNCIATION_ARGS = {
  original: "rouge",
  corrected: "rouge",
  explanation: "Don't trill the R; use the French uvular [ʁ].",
  category: "pronunciation" as const,
};

describe("processReportCorrectionCall (Story 11-1)", () => {
  it("accepts well-formed args and returns the structured Correction with short ack", () => {
    const result = processReportCorrectionCall(VALID_GRAMMAR_ARGS);
    expect(result.outcome).toBe("recorded");
    if (result.outcome === "recorded") {
      expect(result.correction).toEqual(VALID_GRAMMAR_ARGS);
      // Story 11-1 review patch P8: short lowercase ack ("ok") prevents
      // the model from echoing the result in its audio response.
      expect(result.resultMessage).toBe(FUNCTION_RESULT_ACK);
      expect(result.resultMessage).toBe("ok");
    }
  });

  it.each(["grammar", "pronunciation", "vocabulary", "register"] as const)(
    "accepts category=%s",
    (category) => {
      const result = processReportCorrectionCall({ ...VALID_GRAMMAR_ARGS, category });
      expect(result.outcome).toBe("recorded");
    }
  );

  it("rejects args with missing required field (no explanation) and includes the field path", () => {
    const result = processReportCorrectionCall({
      original: "x",
      corrected: "y",
      // explanation missing
      category: "grammar",
    });
    expect(result.outcome).toBe("invalid");
    if (result.outcome === "invalid") {
      // Story 11-1 review patch P6: result message includes the issue
      // path so the model can self-correct on its next invocation.
      // Review-round-2 patch P20: rejection message shape standardized
      // to `"Rejected: <reason>. ..."` across all three rejection paths.
      expect(result.resultMessage).toContain("Rejected: invalid-shape");
      expect(result.resultMessage).toContain("Correction not recorded");
      expect(result.resultMessage).toContain("explanation");
      expect(result.issueCode).toBeTruthy();
    }
  });

  it("rejects args with category outside the 4-literal enum (path = category)", () => {
    const result = processReportCorrectionCall({
      ...VALID_GRAMMAR_ARGS,
      category: "spelling",
    });
    expect(result.outcome).toBe("invalid");
    if (result.outcome === "invalid") {
      expect(result.issueCode).toBe("invalid_enum_value");
      expect(result.resultMessage).toContain("category");
      expect(result.resultMessage).toContain("Rejected: invalid-shape");
    }
  });

  it("rejects args with empty string on a required field", () => {
    const result = processReportCorrectionCall({ ...VALID_GRAMMAR_ARGS, original: "" });
    expect(result.outcome).toBe("invalid");
  });

  it("rejects strings exceeding the per-field max-length cap", () => {
    // Story 11-1 review patch P10: schema caps original/corrected at 500
    // chars, explanation at 1000 chars. Overflow triggers `too_big`.
    const result = processReportCorrectionCall({
      ...VALID_GRAMMAR_ARGS,
      original: "x".repeat(501),
    });
    expect(result.outcome).toBe("invalid");
    if (result.outcome === "invalid") {
      expect(result.issueCode).toBe("too_big");
    }
  });

  it("rejects null / undefined / non-object input with invalid_type", () => {
    for (const bad of [null, undefined, 42, "string", [], true]) {
      const result = processReportCorrectionCall(bad);
      expect(result.outcome).toBe("invalid");
      if (result.outcome === "invalid") {
        // Story 11-1 review patch P13: pin the issueCode so a future Zod
        // major release that changes array-vs-object parsing semantics
        // can't slip a regression past the test.
        expect(result.issueCode).toBe("invalid_type");
      }
    }
  });

  it("surfaces the standardized rejection message in the invalid path", () => {
    const result = processReportCorrectionCall({ wrong: "shape" });
    expect(result.outcome).toBe("invalid");
    if (result.outcome === "invalid") {
      // Review-round-2 patch P20: standardized `"Rejected: <reason>."`
      // shape across all three rejection paths so the model can
      // pattern-match and self-correct uniformly.
      expect(result.resultMessage).toMatch(/^Rejected: invalid-shape\./);
      expect(result.resultMessage).toContain("Correction not recorded");
    }
  });

  it("MAX_PENDING_CORRECTIONS is pinned to 20 (Story 11-1 P9 + review-round-2 P19)", () => {
    // Review-round-2 patch P19: pin the exact value so a maintainer
    // can't silently change 20 → 1 (breaks every realistic turn) or
    // 20 → 1000 (defeats the runaway-model defense) without explicit
    // re-justification + test update.
    expect(MAX_PENDING_CORRECTIONS).toBe(20);
  });
});

describe("drainPendingCorrections (Story 11-1)", () => {
  it("returns the buffer's contents and empties the original", () => {
    const buffer: Correction[] = [VALID_GRAMMAR_ARGS, VALID_VOCAB_ARGS];
    const drained = drainPendingCorrections(buffer);

    expect(drained).toEqual([VALID_GRAMMAR_ARGS, VALID_VOCAB_ARGS]);
    expect(buffer).toEqual([]);
    expect(buffer.length).toBe(0);
  });

  it("preserves insertion order (multiple invocations in one turn)", () => {
    const buffer: Correction[] = [];
    // Simulate three tool-call invocations during one AI turn.
    const r1 = processReportCorrectionCall(VALID_GRAMMAR_ARGS);
    const r2 = processReportCorrectionCall(VALID_PRONUNCIATION_ARGS);
    const r3 = processReportCorrectionCall(VALID_VOCAB_ARGS);
    if (r1.outcome === "recorded") buffer.push(r1.correction);
    if (r2.outcome === "recorded") buffer.push(r2.correction);
    if (r3.outcome === "recorded") buffer.push(r3.correction);

    const drained = drainPendingCorrections(buffer);
    expect(drained.map((c) => c.category)).toEqual(["grammar", "pronunciation", "vocabulary"]);
  });

  it("is idempotent on an empty buffer", () => {
    const buffer: Correction[] = [];
    const drained1 = drainPendingCorrections(buffer);
    expect(drained1).toEqual([]);
    const drained2 = drainPendingCorrections(buffer);
    expect(drained2).toEqual([]);
    expect(buffer).toEqual([]);
  });

  it("returns a defensive copy — mutations to the drained array do not refill the buffer", () => {
    const buffer: Correction[] = [VALID_GRAMMAR_ARGS];
    const drained = drainPendingCorrections(buffer);
    drained.push(VALID_VOCAB_ARGS);

    expect(buffer).toEqual([]);
    expect(drained).toHaveLength(2);
  });

  it("subsequent pushes after drain land in the same (now-empty) buffer", () => {
    const buffer: Correction[] = [VALID_GRAMMAR_ARGS];
    drainPendingCorrections(buffer);
    // The hook reassigns `ref.current = []` in some paths and mutates the
    // existing array in the drain path. This test models the in-place
    // mutation case: after drain, the same buffer reference accepts new
    // pushes.
    buffer.push(VALID_VOCAB_ARGS);
    expect(buffer).toEqual([VALID_VOCAB_ARGS]);
  });
});

// ---------------------------------------------------------------------------
// Review-round-2 patch P18: pure-helper coverage for the orphan-drain
// merge pattern used by `case "response.done"` and `case "error"` in the
// hook. These tests pin the high-risk code paths that silently preserve
// user-correction data on the error / no-audio paths.
// ---------------------------------------------------------------------------

describe("mergeOrphanCorrections (Story 11-1 P18)", () => {
  it("empty buffer → returns conversation unchanged + no breadcrumb", () => {
    const conversation: Correction[] = [VALID_GRAMMAR_ARGS];
    const buffer: Correction[] = [];
    const result = mergeOrphanCorrections(conversation, buffer);
    expect(result.conversation).toEqual([VALID_GRAMMAR_ARGS]);
    expect(result.shouldBreadcrumb).toBe(false);
    // Conversation is returned as-is (same reference) when buffer empty.
    expect(result.conversation).toBe(conversation);
    expect(buffer).toEqual([]);
  });

  it("non-empty buffer → merges into conversation + emits breadcrumb signal + empties buffer", () => {
    const conversation: Correction[] = [VALID_GRAMMAR_ARGS];
    const buffer: Correction[] = [VALID_VOCAB_ARGS, VALID_PRONUNCIATION_ARGS];
    const result = mergeOrphanCorrections(conversation, buffer);
    expect(result.conversation).toEqual([
      VALID_GRAMMAR_ARGS,
      VALID_VOCAB_ARGS,
      VALID_PRONUNCIATION_ARGS,
    ]);
    expect(result.shouldBreadcrumb).toBe(true);
    expect(buffer).toEqual([]);
    // Returned conversation is a NEW array, not the input.
    expect(result.conversation).not.toBe(conversation);
  });

  it("idempotent on already-empty buffer after a prior drain", () => {
    const conversation: Correction[] = [VALID_GRAMMAR_ARGS];
    const buffer: Correction[] = [VALID_VOCAB_ARGS];
    const first = mergeOrphanCorrections(conversation, buffer);
    expect(first.shouldBreadcrumb).toBe(true);
    expect(buffer).toEqual([]);
    // Second call on the now-empty buffer is a no-op.
    const second = mergeOrphanCorrections(first.conversation, buffer);
    expect(second.shouldBreadcrumb).toBe(false);
    expect(second.conversation).toBe(first.conversation);
  });

  it("preserves insertion order across multiple merge rounds", () => {
    const buffer: Correction[] = [];
    let conversation: Correction[] = [];

    // Round 1: 2 corrections from turn N
    buffer.push(VALID_GRAMMAR_ARGS, VALID_VOCAB_ARGS);
    let merged = mergeOrphanCorrections(conversation, buffer);
    conversation = merged.conversation;

    // Round 2: 1 correction from turn N+1
    buffer.push(VALID_PRONUNCIATION_ARGS);
    merged = mergeOrphanCorrections(conversation, buffer);
    conversation = merged.conversation;

    expect(conversation.map((c) => c.category)).toEqual(["grammar", "vocabulary", "pronunciation"]);
  });

  it("treats the conversation array as immutable (does NOT mutate input)", () => {
    const conversation: Correction[] = [VALID_GRAMMAR_ARGS];
    const conversationSnapshot = [...conversation];
    const buffer: Correction[] = [VALID_VOCAB_ARGS];
    mergeOrphanCorrections(conversation, buffer);
    // The input `conversation` array is unchanged; the new array is in result.
    expect(conversation).toEqual(conversationSnapshot);
  });
});

// ---------------------------------------------------------------------------
// Review-round-2 patch P18 integration coverage — buffer-cap scenario.
// Simulates a runaway-model spam scenario: invoke processReportCorrectionCall
// MAX_PENDING_CORRECTIONS + 1 times, push valid ones into the buffer, verify
// the cap blocks the overflow at the call site that mirrors the hook.
// ---------------------------------------------------------------------------

describe("buffer-cap integration scenario (Story 11-1 P9 + P18)", () => {
  it("rejects the (MAX_PENDING_CORRECTIONS + 1)th push attempt at the cap-check call site", () => {
    const buffer: Correction[] = [];
    let rejectedCount = 0;
    let acceptedCount = 0;

    // Simulate the hook's pattern: cap check BEFORE processReportCorrectionCall.
    for (let i = 0; i < MAX_PENDING_CORRECTIONS + 5; i++) {
      if (buffer.length >= MAX_PENDING_CORRECTIONS) {
        rejectedCount++;
        continue;
      }
      const r = processReportCorrectionCall({ ...VALID_GRAMMAR_ARGS, explanation: `e${i}` });
      if (r.outcome === "recorded") {
        buffer.push(r.correction);
        acceptedCount++;
      }
    }

    expect(acceptedCount).toBe(MAX_PENDING_CORRECTIONS);
    expect(rejectedCount).toBe(5);
    expect(buffer).toHaveLength(MAX_PENDING_CORRECTIONS);
  });
});
