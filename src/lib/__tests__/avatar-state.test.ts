/**
 * Story 18-4 — avatar state derivation (pure mapper).
 *
 * Pins the priority order extracted from the pre-18-4 inline `orbState`
 * IIFE (connecting → speaking → listening → thinking → idle). `celebrating`
 * is a union member set as a surface literal, not derived (review R1).
 */

import { deriveAvatarState, type AvatarStateInput } from "@/src/lib/avatar-state";

function input(overrides: Partial<AvatarStateInput> = {}): AvatarStateInput {
  return {
    status: "connected",
    isSpeaking: false,
    isAiSpeaking: false,
    isProcessing: false,
    ...overrides,
  };
}

describe("Story 18-4 — deriveAvatarState", () => {
  it("connected + no flags → idle", () => {
    expect(deriveAvatarState(input())).toBe("idle");
  });

  it("connecting and reconnecting both map to connecting — above every flag", () => {
    for (const status of ["connecting", "reconnecting"] as const) {
      expect(
        deriveAvatarState(
          input({ status, isAiSpeaking: true, isSpeaking: true, isProcessing: true })
        )
      ).toBe("connecting");
    }
  });

  it("AI speaking wins over user speaking and processing", () => {
    expect(
      deriveAvatarState(input({ isAiSpeaking: true, isSpeaking: true, isProcessing: true }))
    ).toBe("speaking");
  });

  it("user speaking wins over processing", () => {
    expect(deriveAvatarState(input({ isSpeaking: true, isProcessing: true }))).toBe("listening");
  });

  it("processing alone → thinking", () => {
    expect(deriveAvatarState(input({ isProcessing: true }))).toBe("thinking");
  });

  it("terminal / inactive statuses fall through to idle", () => {
    for (const status of ["idle", "error", "disconnected", "ended"] as const) {
      expect(deriveAvatarState(input({ status }))).toBe("idle");
    }
  });

  it("R1: celebrating is NOT derived — it is a surface-level literal (union member only)", () => {
    // Review R1 deleted the speculative opts.celebrating param (production-
    // dead). The union member stays: the end sheet mounts the state
    // directly. This pin ensures re-adding a second parameter is a
    // deliberate act, not drift.
    expect(deriveAvatarState.length).toBe(1);
    const celebratingMember: import("@/src/lib/avatar-state").AvatarState = "celebrating";
    expect(celebratingMember).toBe("celebrating");
  });
});
