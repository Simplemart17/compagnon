/**
 * Story 18-4 — avatar state derivation (pure mapper).
 *
 * Pins the priority order extracted from the pre-18-4 inline `orbState`
 * IIFE (connecting → speaking → listening → thinking → idle) plus the new
 * `celebrating` override on top.
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

  it("celebrating overrides EVERYTHING — including connecting", () => {
    expect(
      deriveAvatarState(
        input({ status: "connecting", isAiSpeaking: true, isSpeaking: true, isProcessing: true }),
        { celebrating: true }
      )
    ).toBe("celebrating");
  });

  it("celebrating: false and absent opts behave identically", () => {
    expect(deriveAvatarState(input(), { celebrating: false })).toBe("idle");
    expect(deriveAvatarState(input(), {})).toBe("idle");
    expect(deriveAvatarState(input())).toBe("idle");
  });
});
