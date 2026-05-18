/**
 * Reference-counted singleton-manager wrapper around the
 * `ExpoPlayAudioStream` native module (Story 12-5).
 *
 * Pre-12-5 `RealtimeOrchestrator.dispose()` called
 * `ExpoPlayAudioStream.destroy()` on every unmount, tearing down the
 * process-wide singleton native module and breaking subsequent
 * orchestrator mounts until app reload (audit finding P1-19).
 *
 * Post-12-5 the orchestrator calls `acquireAudioStream()` in
 * `startAudioStreaming()` and `releaseAudioStream()` in `dispose()`. The
 * manager tracks active consumers via a module-level `refCount` and
 * only invokes the per-conversation cleanup (`stopRecording` +
 * `stopSound`) when the LAST consumer releases. The singleton native
 * module is **never destroyed** — the OS owns its lifecycle on app
 * exit. `ExpoPlayAudioStream.destroy()` is intended for app-shutdown
 * cleanup, NOT for per-screen lifecycle (a misleading API-name
 * collision — `destroy` ≠ `cleanup` here).
 *
 * **Architectural pattern alignment:**
 * - Module-level `let refCount = 0` mirrors Story 12-2's
 *   `bootstrapAuth()` one-call-guard pattern (`let bootstrapState`) and
 *   Story 9-6's `flushWriteQueue` idempotency (`let inFlight`).
 * - Defensive `release-when-zero` Sentry breadcrumb mirrors Story 12-4's
 *   `safeSessionCall`-with-breadcrumb observability pattern.
 * - `__resetAudioStreamManagerForTests` with `NODE_ENV !== "test"`
 *   runtime guard mirrors Story 12-2 P11.
 *
 * **Concurrency contract (review-round-1 P2 + P7):**
 * - `acquireAudioStream()` is SYNCHRONOUS and must NOT be awaited between
 *   the call and the consumer's `acquireWasCalled = true` bookkeeping
 *   write. The synchronous-acquire invariant guarantees that a peer
 *   orchestrator's `releaseAudioStream()` cannot interleave between
 *   acquire and bookkeeping. Violating this is a refcount-leak hazard.
 * - `releaseAudioStream()` is ASYNC because it awaits native cleanup. The
 *   `isLastRelease` snapshot is captured AFTER decrement and re-checked
 *   after each native-cleanup await — so if a peer orchestrator acquires
 *   the singleton DURING our cleanup-await window, we skip the remaining
 *   cleanup steps and let the new consumer keep the engine alive.
 * - `end()`-then-`dispose()` is tolerated: `dispose()` is idempotent via
 *   `isDisposed`; even if release runs twice across the pair, the
 *   release-when-zero breadcrumb catches the unmatched second call
 *   without negative-state pollution.
 */
import { ExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";

import { addBreadcrumb } from "@/src/lib/sentry";

/**
 * Module-level active-consumer count. Single source of truth for
 * native-module lifecycle decisions.
 */
let refCount = 0;

/**
 * Module-level flag tracking whether `ExpoPlayAudioStream.startRecording`
 * has ever been called successfully since the last cleanup. The library's
 * `stopRecording()` does `console.error(error); throw` when called against
 * an idle engine — even our try/catch around the throw can't suppress the
 * already-emitted console.error, so we end up with a noisy red LogBox
 * during dev whenever the orchestrator disposes before successfully
 * starting recording (e.g., mic permission denied, or a startRecording
 * error in the orchestrator's catch path).
 *
 * Consumers call `markRecordingStarted()` from inside their own
 * `startRecording` success branch; the manager only fires
 * `stopRecording()` during cleanup when this flag is true. The flag is
 * cleared back to false at the end of the cleanup path so the next
 * conversation lifecycle starts fresh.
 */
let recordingActive = false;

/**
 * Acquire a reference to the audio-stream singleton. Increments the
 * refcount SYNCHRONOUSLY (Story 12-5 review-round-1 P7) — callers MUST
 * record their `acquireWasCalled = true` bookkeeping immediately after
 * this returns, with no `await` between acquire and the write. The
 * synchronous-acquire invariant guarantees that a peer orchestrator's
 * `releaseAudioStream` cannot interleave through the gap.
 *
 * Callers MUST pair this with a matching `releaseAudioStream()` call.
 * Unmatched releases are defended against via the release-when-zero
 * guard, but unmatched acquires (refcount leaks) hold the native module
 * open indefinitely — which is the SAFE failure mode (audio keeps
 * working; only resource is the underlying engine staying allocated).
 *
 * Returns void (Story 12-5 review-round-1 P11): the singleton is a
 * process-wide module already imported at consumer sites — there's no
 * value in handing it back through the acquire path. Callers continue
 * importing `ExpoPlayAudioStream` directly for per-operation methods.
 */
export function acquireAudioStream(): void {
  refCount++;
}

/**
 * Mark that `ExpoPlayAudioStream.startRecording` has been called
 * successfully. Consumers MUST call this immediately after their own
 * `startRecording(...)` await resolves without throwing — without it the
 * manager will skip `stopRecording()` on the final release, and a true
 * mic-leak would go uncaught.
 *
 * Idempotent: calling twice is a no-op (the flag stays true). Cleared
 * automatically by `releaseAudioStream()` when the cleanup branch fires.
 */
export function markRecordingStarted(): void {
  recordingActive = true;
}

/**
 * Release a previously-acquired reference. Decrements the refcount;
 * when it hits 0, fires `stopRecording()` + `stopSound()` to halt any
 * active streams. **Never calls `destroy()`** — the singleton native
 * module survives for the app's lifetime; the OS handles teardown on
 * process exit.
 *
 * Defensive: if called with `refCount === 0` (unmatched release),
 * emits a Sentry breadcrumb (`feature: "audio-stream-release-when-zero"`)
 * and silently returns without decrementing (refcount stays at 0; no
 * negative-state pollution).
 *
 * Story 12-5 review-round-1 P2: the `isLastRelease` snapshot is captured
 * AFTER the decrement and re-checked after each native-cleanup await.
 * If a peer orchestrator's `acquireAudioStream()` lands DURING our
 * await window (refCount goes 0 → 1 between our decrement and our
 * stopRecording / stopSound resolution), we abandon the remaining
 * cleanup. Pre-patch a concurrent-orchestrator race could kill the new
 * consumer's freshly-started recording.
 */
export async function releaseAudioStream(): Promise<void> {
  if (refCount === 0) {
    // Story 12-5 review-round-1 P8 REVERTED: the original spec proposed
    // silencing this breadcrumb under `__DEV__`, but the breadcrumb is the
    // load-bearing observability signal for the release-when-zero contract
    // (Case 7 in `audio-stream-manager.test.ts` explicitly asserts it fires).
    // Tests that legitimately reset the manager via
    // `__resetAudioStreamManagerForTests()` clear `addBreadcrumb` in their
    // `beforeEach`, so no test pollution actually occurs.
    addBreadcrumb({
      category: "audio",
      level: "warning",
      message: "Audio stream released when no acquires outstanding",
      data: { feature: "audio-stream-release-when-zero" },
    });
    return;
  }
  refCount--;
  // Snapshot AFTER decrement (P2). The cleanup arm runs only when the
  // post-decrement count is 0 AND remains 0 across each native await.
  if (refCount === 0) {
    // Last consumer — stop active streams. Best-effort; swallow because
    // we never call destroy() (the only operation that would matter
    // for cross-instance regression) and stopRecording / stopSound on
    // an idle module are no-ops on iOS / Android.
    //
    // Re-check refCount after each await: a peer orchestrator that
    // synchronously acquires during the await window would land
    // refCount = 1, in which case we abandon the remaining cleanup
    // (the new consumer expects the engine alive).
    //
    // Gate `stopRecording` behind `recordingActive`: the library throws
    // (and console.error's BEFORE throwing) when called against an idle
    // engine. Pre-fix the orchestrator would acquire → fail to start
    // recording (mic permission / native error) → dispose → release-to-0
    // → stopRecording → noisy red LogBox screen during dev. Post-fix the
    // call is skipped when nothing was ever recording.
    //
    // NOTE: we do NOT clear `recordingActive` here. If a peer orchestrator
    // acquires + markRecordingStarted's DURING our await, the post-await
    // refCount re-check below abandons our remaining cleanup; clearing
    // the flag here would let the peer's eventual release skip its
    // stopRecording. The flag is only cleared after BOTH native cleanups
    // complete AND no peer acquired (i.e., we reached the end of the
    // critical section without abandoning).
    if (recordingActive) {
      try {
        await ExpoPlayAudioStream.stopRecording();
      } catch {
        // Cleanup-path swallow — true cleanup failures here are operator-
        // unactionable (the OS reclaims native resources on app exit).
      }
    }
    if (refCount !== 0) {
      // Peer orchestrator acquired during the stopRecording await.
      // Abandon the rest of the cleanup chain so we don't kill their
      // freshly-started sound playback. The peer's eventual release
      // re-enters this branch when they're done.
      return;
    }
    try {
      await ExpoPlayAudioStream.stopSound();
    } catch {
      // Cleanup-path swallow.
    }
    // Reached only when refCount stayed at 0 across the full critical
    // section (no peer mid-cleanup acquire). Safe to clear so the next
    // conversation lifecycle starts with `recordingActive = false` and
    // markRecordingStarted has to be called again before stopRecording
    // will fire.
    if (refCount === 0) {
      recordingActive = false;
    }
  }
}

/**
 * @internal — test-only inspector. Returns the current refcount so
 * tests can assert lifecycle correctness without coupling to internal
 * storage.
 */
export function getAudioStreamRefCountForTests(): number {
  return refCount;
}

/**
 * @internal — test-only reset. Resets the refcount so tests don't leak
 * state across boundaries. Must NOT be called from production code; the
 * runtime guard throws unless BOTH conditions hold: NODE_ENV === 'test'
 * AND a `jest` global is defined (Story 12-2 P11 base guard + Story
 * 12-5 review-round-1 P14 belt-and-suspenders against accidental ESM
 * imports in non-Jest runtimes that happen to set NODE_ENV=test, e.g.,
 * Storybook / Playwright / Vitest workers).
 */
export function __resetAudioStreamManagerForTests(): void {
  const inJest = typeof jest !== "undefined";
  const inTestEnv = typeof process !== "undefined" && process.env.NODE_ENV === "test";
  if (!inJest || !inTestEnv) {
    throw new Error(
      "__resetAudioStreamManagerForTests must only be called from tests (NODE_ENV must be 'test' AND running under Jest)"
    );
  }
  refCount = 0;
  recordingActive = false;
}
