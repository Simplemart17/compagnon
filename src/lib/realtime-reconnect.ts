/**
 * Realtime reconnect-decision helper — Story 11-2.
 *
 * Pure function that decides whether to attempt a WebSocket reconnect on an
 * `onclose` event, and at what delay. Extracted from `src/lib/realtime.ts`
 * `RealtimeSession` so the reconnect-decision logic can be unit-tested
 * without mounting React or mocking a WebSocket.
 *
 * Lifecycle (consumer = `RealtimeSession.ws.onclose`):
 *   1. Close fires → consumer calls `shouldReconnect(reason, wasConnected, attemptCount)`.
 *   2. If `{ reconnect: false }` → no retry; consumer emits the terminal
 *      `connection_lost` error event (existing pre-11-2 behavior).
 *   3. If `{ reconnect: true, delayMs, attempt }` → consumer schedules
 *      `setTimeout(attemptReconnect, delayMs)`. Each `attemptReconnect`
 *      increments the internal counter and re-runs `establishConnection()`;
 *      on failure, the new connect's own `onclose` runs this helper again
 *      with the incremented counter.
 *
 * The fixed schedule `[500, 1000, 2000, 4000, 8000]` totals ~15.5s of
 * backoff (plus connect-time per attempt). Matches Epic 11 AC "Disconnect
 * simulation mid-conversation reconnects within 5s" for the FIRST attempt
 * while leaving budget for true network-blip recovery. Adaptive backoff
 * (jitter, network-aware delays) is intentionally NOT included per the
 * story's Out-of-scope list.
 */

/**
 * Backoff schedule in milliseconds. Indexed by `attemptCount` (the number
 * of completed attempts so far). `RECONNECT_BACKOFF_MS[0]` is the delay
 * before the FIRST attempt (right after the initial unexpected close).
 *
 * Story 11-2 review patch P9-pattern: pinned via lockstep test (the
 * `MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length` invariant
 * prevents drift between the two constants).
 */
export const RECONNECT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];

/**
 * Per-disconnect upper bound on reconnect attempts. After this many failed
 * attempts, the session emits the terminal `connection_lost` error and the
 * hook's existing teardown path runs (no regression to the pre-11-2 failure
 * mode).
 */
export const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length;

/**
 * Reason for the WebSocket close. Used by the reconnect-decision helper to
 * skip retries on intentional disconnects.
 *
 * - `"user"` — `RealtimeSession.disconnect({ reason: "user" })` (default).
 *   Fired by `useRealtimeVoice` `end()` + unmount cleanup. NO reconnect.
 * - `"reconnect"` — internal to `RealtimeSession`; not currently used by
 *   any external caller but reserved for a future explicit-reconnect API
 *   (e.g., a manual "reconnect now" button) that would also skip the
 *   intentional-disconnect path.
 * - `"unknown"` — the close fired without a known reason (the server hung
 *   up, the network dropped, or the WebSocket library closed for any
 *   other cause). This is the path that triggers reconnect attempts.
 */
export type CloseReason = "user" | "reconnect" | "unknown";

export interface ReconnectDecision {
  /** True if a reconnect attempt should be scheduled. */
  reconnect: boolean;
  /**
   * Delay in milliseconds before the attempt. 0 means "no attempt" (paired
   * with `reconnect: false`). The caller uses `setTimeout(_, delayMs)`.
   */
  delayMs: number;
  /**
   * The attempt number (1-indexed) for Sentry-breadcrumb data. `0` means
   * "no attempt" (paired with `reconnect: false`).
   */
  attempt: number;
}

/**
 * Decide whether to attempt a reconnect on a WebSocket onclose event.
 *
 * Returns `{ reconnect: false, delayMs: 0, attempt: 0 }` when:
 *   - The close was intentional (`closeReason === "user"`).
 *   - The close happened before the initial open (`wasConnected === false`).
 *   - The attempt count has reached `MAX_RECONNECT_ATTEMPTS` (exhausted).
 *
 * Returns `{ reconnect: true, delayMs: RECONNECT_BACKOFF_MS[attemptCount], attempt: attemptCount + 1 }`
 * otherwise.
 *
 * Pure function — no side effects, no clock access; the caller schedules
 * the actual `setTimeout`.
 *
 * @param closeReason - intent of the close (user / reconnect / unknown)
 * @param wasConnected - whether the WebSocket ever reached `onopen` before
 *   the close fired. Pre-open closes are handled by the existing
 *   connect-promise reject path; reconnect is for post-open closes only.
 * @param attemptCount - number of completed attempts so far (0 on the
 *   first close after a successful initial connect)
 */
export function shouldReconnect(
  closeReason: CloseReason,
  wasConnected: boolean,
  attemptCount: number
): ReconnectDecision {
  if (closeReason === "user") {
    return { reconnect: false, delayMs: 0, attempt: 0 };
  }
  if (!wasConnected) {
    return { reconnect: false, delayMs: 0, attempt: 0 };
  }
  if (attemptCount >= MAX_RECONNECT_ATTEMPTS) {
    return { reconnect: false, delayMs: 0, attempt: 0 };
  }
  return {
    reconnect: true,
    delayMs: RECONNECT_BACKOFF_MS[attemptCount],
    attempt: attemptCount + 1,
  };
}
