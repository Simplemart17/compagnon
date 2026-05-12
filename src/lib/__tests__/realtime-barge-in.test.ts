/**
 * Story 11-2 — Realtime barge-in directive helper test suite.
 *
 * Exercises `computeBargeInDirective(state, now)` — the pure helper that
 * decides what barge-in action to take when the
 * `input_audio_buffer.speech_started` event fires while the AI may be
 * playing audio. The helper is pure (no side effects, no DOM/audio
 * mutation) so the test surface is straightforward.
 *
 * Lifecycle assertions for the actual `ExpoPlayAudioStream.stopSound` +
 * `sessionRef.sendRaw` dispatch live in the integration surface (the
 * hook's case "input_audio_buffer.speech_started" branch) and are NOT
 * covered here.
 */

import { computeBargeInDirective, type BargeInState } from "../realtime-barge-in";

function bargeInState(overrides: Partial<BargeInState> = {}): BargeInState {
  return {
    isAiSpeaking: false,
    inflightItemId: null,
    aiSpeakingStartedAtMs: null,
    ...overrides,
  };
}

describe("computeBargeInDirective (Story 11-2)", () => {
  it("AI not speaking → no cancel + no truncate (existing pre-11-2 behavior)", () => {
    const directive = computeBargeInDirective(bargeInState({ isAiSpeaking: false }), Date.now());
    expect(directive).toEqual({
      shouldCancelResponse: false,
      shouldTruncate: false,
      audioEndMs: null,
      itemId: null,
    });
  });

  it("AI speaking + both refs populated → full directive (cancel + truncate + audio_end_ms)", () => {
    const directive = computeBargeInDirective(
      bargeInState({
        isAiSpeaking: true,
        inflightItemId: "item_1",
        aiSpeakingStartedAtMs: 1000,
      }),
      2500
    );
    expect(directive).toEqual({
      shouldCancelResponse: true,
      shouldTruncate: true,
      audioEndMs: 1500,
      itemId: "item_1",
    });
  });

  it("AI speaking + inflightItemId null → cancel only, no truncate (defensive)", () => {
    const directive = computeBargeInDirective(
      bargeInState({
        isAiSpeaking: true,
        inflightItemId: null,
        aiSpeakingStartedAtMs: 1000,
      }),
      2500
    );
    expect(directive.shouldCancelResponse).toBe(true);
    expect(directive.shouldTruncate).toBe(false);
    expect(directive.itemId).toBeNull();
    // audio_end_ms is still computed (consumer ignores it when shouldTruncate is false).
    expect(directive.audioEndMs).toBe(1500);
  });

  it("AI speaking + aiSpeakingStartedAtMs null → cancel only, no truncate (defensive)", () => {
    const directive = computeBargeInDirective(
      bargeInState({
        isAiSpeaking: true,
        inflightItemId: "item_1",
        aiSpeakingStartedAtMs: null,
      }),
      2500
    );
    expect(directive.shouldCancelResponse).toBe(true);
    expect(directive.shouldTruncate).toBe(false);
    expect(directive.audioEndMs).toBeNull();
    expect(directive.itemId).toBe("item_1");
  });

  it("AI speaking + now < startedAt (clock-skew defense) → audio_end_ms clamped to 0", () => {
    // A non-monotonic clock change could push `now` backwards. The helper
    // clamps to 0 rather than emitting a negative value that the server
    // would reject.
    const directive = computeBargeInDirective(
      bargeInState({
        isAiSpeaking: true,
        inflightItemId: "item_1",
        aiSpeakingStartedAtMs: 5000,
      }),
      3000 // now is BEFORE startedAt
    );
    expect(directive.audioEndMs).toBe(0);
    expect(directive.shouldTruncate).toBe(true);
  });

  it("AI speaking + same instant (now === startedAt) → audio_end_ms = 0", () => {
    const directive = computeBargeInDirective(
      bargeInState({
        isAiSpeaking: true,
        inflightItemId: "item_1",
        aiSpeakingStartedAtMs: 1000,
      }),
      1000
    );
    expect(directive.audioEndMs).toBe(0);
    expect(directive.shouldTruncate).toBe(true);
  });

  it("audio_end_ms is a non-negative integer (no fractional ms)", () => {
    const directive = computeBargeInDirective(
      bargeInState({
        isAiSpeaking: true,
        inflightItemId: "item_1",
        aiSpeakingStartedAtMs: 1000.7,
      }),
      2500.3
    );
    // Math.floor(2500.3 - 1000.7) = Math.floor(1499.6) = 1499
    expect(directive.audioEndMs).toBe(1499);
    expect(Number.isInteger(directive.audioEndMs)).toBe(true);
  });
});
