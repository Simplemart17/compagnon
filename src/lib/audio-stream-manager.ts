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
 */
import { ExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";

import { addBreadcrumb } from "@/src/lib/sentry";

/**
 * Module-level active-consumer count. Single source of truth for
 * native-module lifecycle decisions.
 */
let refCount = 0;

/**
 * Acquire a reference to the audio-stream singleton. Increments the
 * refcount synchronously and returns the underlying
 * `ExpoPlayAudioStream` reference for callers to use for per-operation
 * methods (`requestPermissionsAsync`, `setSoundConfig`,
 * `startRecording`, `playSound`, etc. — all unchanged from pre-12-5;
 * callers can either use the returned reference or continue importing
 * `ExpoPlayAudioStream` directly since it's a singleton).
 *
 * Callers MUST pair this with a matching `releaseAudioStream()` call.
 * Unmatched releases are defended against via the release-when-zero
 * guard, but unmatched acquires (refcount leaks) hold the native module
 * open indefinitely — which is the SAFE failure mode (audio keeps
 * working; only resource is the underlying engine staying allocated).
 */
export function acquireAudioStream(): typeof ExpoPlayAudioStream {
  refCount++;
  return ExpoPlayAudioStream;
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
 */
export async function releaseAudioStream(): Promise<void> {
  if (refCount === 0) {
    addBreadcrumb({
      category: "audio",
      level: "warning",
      message: "Audio stream released when no acquires outstanding",
      data: { feature: "audio-stream-release-when-zero" },
    });
    return;
  }
  refCount--;
  if (refCount === 0) {
    // Last consumer — stop active streams. Best-effort; swallow because
    // we never call destroy() (the only operation that would matter
    // for cross-instance regression) and stopRecording / stopSound on
    // an idle module are no-ops on iOS / Android.
    try {
      await ExpoPlayAudioStream.stopRecording();
    } catch {
      // Cleanup-path swallow.
    }
    try {
      await ExpoPlayAudioStream.stopSound();
    } catch {
      // Cleanup-path swallow.
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
 * state across boundaries. Must NOT be called from production code;
 * the runtime guard throws on `NODE_ENV !== "test"` (Story 12-2 P11
 * pattern).
 */
export function __resetAudioStreamManagerForTests(): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
    throw new Error(
      "__resetAudioStreamManagerForTests must only be called from tests (NODE_ENV must be 'test')"
    );
  }
  refCount = 0;
}
