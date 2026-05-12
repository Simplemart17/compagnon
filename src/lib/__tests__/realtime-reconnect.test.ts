/**
 * Story 11-2 — Realtime reconnect-decision helper test suite.
 *
 * Exercises `shouldReconnect(closeReason, wasConnected, attemptCount)` —
 * the pure helper that decides whether `RealtimeSession.ws.onclose` should
 * trigger a reconnect attempt and at what delay. The helper is pure (no
 * side effects, no clock) so the test surface is straightforward.
 *
 * Lifecycle assertions for the actual setTimeout scheduling + WebSocket
 * lifecycle live in the integration surface and are NOT covered here.
 */

import {
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BACKOFF_MS,
  shouldReconnect,
} from "../realtime-reconnect";

describe("shouldReconnect (Story 11-2)", () => {
  it("intentional close (`reason: user`) → no reconnect", () => {
    const decision = shouldReconnect("user", true, 0);
    expect(decision).toEqual({ reconnect: false, delayMs: 0, attempt: 0 });
  });

  it("pre-open close → no reconnect (regardless of attemptCount)", () => {
    // wasConnected = false means the WebSocket never reached onopen.
    // The existing connect-promise reject path handles pre-open failures.
    for (const attempts of [0, 1, 2, 3, 4, 5]) {
      const decision = shouldReconnect("unknown", false, attempts);
      expect(decision).toEqual({ reconnect: false, delayMs: 0, attempt: 0 });
    }
  });

  it("first post-open unexpected close → reconnect with 500ms delay", () => {
    const decision = shouldReconnect("unknown", true, 0);
    expect(decision).toEqual({
      reconnect: true,
      delayMs: 500,
      attempt: 1,
    });
  });

  it.each([
    [0, 500, 1],
    [1, 1000, 2],
    [2, 2000, 3],
    [3, 4000, 4],
    [4, 8000, 5],
  ])(
    "attempt count %i → reconnect with %ims delay, attempt #%i",
    (attemptCount, expectedDelay, expectedAttempt) => {
      const decision = shouldReconnect("unknown", true, attemptCount);
      expect(decision).toEqual({
        reconnect: true,
        delayMs: expectedDelay,
        attempt: expectedAttempt,
      });
    }
  );

  it("attempt count equals MAX_RECONNECT_ATTEMPTS → no reconnect (exhausted)", () => {
    const decision = shouldReconnect("unknown", true, MAX_RECONNECT_ATTEMPTS);
    expect(decision).toEqual({ reconnect: false, delayMs: 0, attempt: 0 });
  });

  it("attempt count exceeds MAX_RECONNECT_ATTEMPTS → no reconnect (defensive)", () => {
    const decision = shouldReconnect("unknown", true, MAX_RECONNECT_ATTEMPTS + 10);
    expect(decision).toEqual({ reconnect: false, delayMs: 0, attempt: 0 });
  });

  it("intentional close trumps every other condition (defensive)", () => {
    // Even with all reconnect-favorable conditions, a user-initiated
    // disconnect must NOT trigger a reconnect.
    const decision = shouldReconnect("user", true, 0);
    expect(decision.reconnect).toBe(false);
  });

  it("MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length (lockstep pin)", () => {
    // Lockstep invariant: a maintainer can't change one constant without
    // the other. Same defense Story 11-1 P19 used for MAX_PENDING_CORRECTIONS.
    expect(MAX_RECONNECT_ATTEMPTS).toBe(RECONNECT_BACKOFF_MS.length);
    // Pin the value to 5 explicitly so a silent change (5 → 1 or 5 → 100)
    // fails CI with an obvious diff.
    expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
  });

  it("RECONNECT_BACKOFF_MS is the canonical exponential-backoff schedule", () => {
    // Pin the schedule so a maintainer can't silently change 500ms → 5000ms
    // (defeats the "within 5s" Epic 11 AC) or change the growth factor.
    expect(RECONNECT_BACKOFF_MS).toEqual([500, 1000, 2000, 4000, 8000]);
    // Total budget across all 5 attempts ≈ 15.5s — matches the story's
    // claimed "~15s total budget."
    const totalDelayMs = RECONNECT_BACKOFF_MS.reduce((sum, d) => sum + d, 0);
    expect(totalDelayMs).toBe(15500);
  });

  it("Review-round-2 P25 boundary: first attempt + second attempt + last attempt delays form the canonical schedule", () => {
    // The lifecycle assertion: after a network blip the FIRST attempt
    // delay must be 500ms (matches Epic 11 AC "within 5s"), the SECOND
    // attempt delay must be 1000ms, and the 5th attempt (last before
    // exhaustion) must be 8000ms. Per-attempt counter increment + helper
    // index are correctly aligned.
    expect(shouldReconnect("unknown", true, 0).delayMs).toBe(500);
    expect(shouldReconnect("unknown", true, 1).delayMs).toBe(1000);
    expect(shouldReconnect("unknown", true, 4).delayMs).toBe(8000);
    // 5th attempt's onclose would call with attemptCount=5 → exhausted.
    expect(shouldReconnect("unknown", true, 5).reconnect).toBe(false);
  });
});
