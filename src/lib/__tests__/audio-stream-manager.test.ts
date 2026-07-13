/**
 * Story 12-5 — `audio-stream-manager` unit tests.
 *
 * Pins the refcount + lifecycle contract of the new singleton-manager
 * wrapper around `ExpoPlayAudioStream`. The load-bearing assertions:
 *   (a) `ExpoPlayAudioStream.destroy()` is NEVER called — audit P1-19's
 *       structural fix is verified at the manager level.
 *   (b) `stopRecording()` + `stopSound()` fire EXACTLY ONCE at the
 *       last release (refcount → 0), not on intermediate releases.
 *   (c) Release-when-zero is defended via a Sentry breadcrumb +
 *       refcount stays at 0 (no negative drift).
 *   (d) 5-mount/unmount-cycle smoke test directly verifies the Epic 12
 *       acceptance criterion at `shippable-roadmap.md` line 220.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  acquireAudioStream,
  markRecordingStarted,
  releaseAudioStream,
  getAudioStreamRefCountForTests,
  __resetAudioStreamManagerForTests,
} from "../audio-stream-manager";
import { addBreadcrumb } from "../sentry";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const mockStopRecording = jest.fn(async () => undefined);
const mockStopSound = jest.fn(async () => undefined);
const mockDestroy = jest.fn();

// Story 12-5 review-round-1 P15 REVERTED: direct mock-var wiring (`destroy: mockDestroy`)
// breaks the test because the const-declared `mock*` vars live in the Temporal
// Dead Zone when jest.mock's factory is invoked during the test file's first
// `import`. The arrow-function indirection captures the NAME, not the value, so
// the lookup happens at call-time (post-TDZ) when the consts are initialized.
// P15 was a noise patch; reverting preserves test correctness.
jest.mock("@mykin-ai/expo-audio-stream", () => ({
  ExpoPlayAudioStream: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setSoundConfig: jest.fn(async () => undefined),
    startRecording: jest.fn(async () => ({ subscription: { remove: jest.fn() } })),
    stopRecording: (...args: unknown[]) =>
      (mockStopRecording as unknown as (...a: unknown[]) => unknown)(...args),
    playSound: jest.fn(),
    stopSound: (...args: unknown[]) =>
      (mockStopSound as unknown as (...a: unknown[]) => unknown)(...args),
    destroy: (...args: unknown[]) =>
      (mockDestroy as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

beforeEach(() => {
  __resetAudioStreamManagerForTests();
  mockStopRecording.mockClear();
  mockStopSound.mockClear();
  mockDestroy.mockClear();
  (addBreadcrumb as jest.Mock).mockClear();
});

describe("Story 12-5 — audio-stream-manager refcount happy paths", () => {
  it("Case 1: initial refcount is 0", () => {
    expect(getAudioStreamRefCountForTests()).toBe(0);
  });

  it("Case 2: 1 acquire → refcount 1; 1 release → refcount 0; last release calls stopRecording + stopSound exactly once each", async () => {
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(1);
    expect(mockStopRecording).not.toHaveBeenCalled();
    expect(mockStopSound).not.toHaveBeenCalled();

    await releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(0);
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockStopSound).toHaveBeenCalledTimes(1);
  });

  it("Case 3: 3 acquires + 3 releases — stopRecording + stopSound fire exactly once each (on the last release only)", async () => {
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(3);

    await releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(2);
    expect(mockStopRecording).not.toHaveBeenCalled();
    expect(mockStopSound).not.toHaveBeenCalled();

    await releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(1);
    expect(mockStopRecording).not.toHaveBeenCalled();
    expect(mockStopSound).not.toHaveBeenCalled();

    await releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(0);
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockStopSound).toHaveBeenCalledTimes(1);
  });

  it("Case 4: intermediate releases (refcount > 0) do NOT call stopRecording / stopSound", async () => {
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();

    await releaseAudioStream();
    // refcount = 1 > 0 — no cleanup
    expect(mockStopRecording).not.toHaveBeenCalled();
    expect(mockStopSound).not.toHaveBeenCalled();

    await releaseAudioStream();
    // refcount = 0 — cleanup fires
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockStopSound).toHaveBeenCalledTimes(1);
  });
});

describe("Story 12-5 — NEVER-destroy negative guards (audit P1-19 closure)", () => {
  it("Case 5: end-to-end acquire/release × 5 cycles → ExpoPlayAudioStream.destroy is NEVER called (Epic 12 AC line 220 verification)", async () => {
    // 5 successive mount/unmount cycles — the exact shape of the
    // shippable-roadmap.md AC for Epic 12: "audio works after 5
    // successive screen mount/unmount cycles".
    for (let i = 0; i < 5; i++) {
      acquireAudioStream();
      markRecordingStarted();
      expect(getAudioStreamRefCountForTests()).toBe(1);
      await releaseAudioStream();
      expect(getAudioStreamRefCountForTests()).toBe(0);
    }
    expect(mockDestroy).not.toHaveBeenCalled();
    // stopRecording + stopSound fire exactly 5 times — once per
    // release-to-zero.
    expect(mockStopRecording).toHaveBeenCalledTimes(5);
    expect(mockStopSound).toHaveBeenCalledTimes(5);
  });

  it("Case 6: drift detector — `audio-stream-manager.ts` source contains NO `.destroy(` invocation (load-bearing audit-P1-19 closure)", () => {
    const path = join(__dirname, "..", "audio-stream-manager.ts");
    const source = readFileSync(path, "utf-8");
    // Strip block + line comments so the JSDoc that mentions
    // "never call destroy()" doesn't false-positive the regex.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No `.destroy(` calls in the code portion of the manager source.
    expect(codeOnly).not.toMatch(/\.destroy\(/);
  });
});

describe("Story 12-5 — defensive guards", () => {
  it("Case 7: release when refcount is 0 → breadcrumb fires + refcount stays at 0 (no negative)", async () => {
    expect(getAudioStreamRefCountForTests()).toBe(0);

    await releaseAudioStream();

    expect(getAudioStreamRefCountForTests()).toBe(0);
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect((addBreadcrumb as jest.Mock).mock.calls[0][0]).toMatchObject({
      category: "audio",
      level: "warning",
      message: "Audio stream released when no acquires outstanding",
      data: { feature: "audio-stream-release-when-zero" },
    });
    // Cleanup methods should NOT fire on a release-when-zero (the
    // guard returns early before the refCount === 0 branch).
    expect(mockStopRecording).not.toHaveBeenCalled();
    expect(mockStopSound).not.toHaveBeenCalled();
  });

  it("Case 8: __resetAudioStreamManagerForTests throws when NODE_ENV !== 'test' (Story 12-2 P11 runtime guard)", () => {
    // `process.env.NODE_ENV` is typed as a read-only string in
    // @types/node strict mode; use the indexed-access form to bypass
    // the type-only restriction while preserving the runtime mutation.
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      expect(() => __resetAudioStreamManagerForTests()).toThrow(
        "__resetAudioStreamManagerForTests must only be called from tests"
      );
    } finally {
      env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe("Story 12-5 — test-only inspector + best-effort cleanup", () => {
  it("Case 9: __resetAudioStreamManagerForTests resets count to 0 even after partial acquires", () => {
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(3);

    __resetAudioStreamManagerForTests();

    expect(getAudioStreamRefCountForTests()).toBe(0);
    // After reset, a fresh acquire/release cycle works correctly.
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(1);
  });

  it("Case 10: stopRecording / stopSound throwing on last release does NOT propagate (best-effort cleanup)", async () => {
    mockStopRecording.mockRejectedValueOnce(new Error("native module busy"));
    mockStopSound.mockRejectedValueOnce(new Error("playback engine error"));

    acquireAudioStream();
    markRecordingStarted();
    // releaseAudioStream should resolve cleanly despite both throws.
    await expect(releaseAudioStream()).resolves.toBeUndefined();
    expect(getAudioStreamRefCountForTests()).toBe(0);
  });
});

// ============================================================================
// Story 12-5 review-round-1 P2 + P4 — concurrent-orchestrators contract
// ============================================================================

describe("Story 12-5 review-round-1 P2 + P4 — concurrent-orchestrators (Epic 12 AC #4)", () => {
  it("Case 11: peer acquires DURING last-release stopRecording await → cleanup chain abandons, peer's session stays alive", async () => {
    // Simulate the concurrent-orchestrators race. Orchestrator A acquires,
    // orchestrator B acquires (refCount=2). A releases (refCount=1) — no
    // cleanup yet. A releases again? No — A only has 1 acquire.
    //
    // The interesting case: A acquires, releases ONLY (refCount=1→0), A's
    // release awaits stopRecording, B's acquire lands SYNCHRONOUSLY mid-await
    // (refCount=0→1). A then re-checks refCount after the stopRecording
    // resolution, sees 1 ≠ 0, ABANDONS the remaining cleanup (stopSound).
    // This protects B's freshly-started session.
    let stopRecordingResolve!: () => void;
    const stopRecordingDeferred = new Promise<undefined>((resolve) => {
      stopRecordingResolve = () => resolve(undefined);
    });
    mockStopRecording.mockReturnValueOnce(stopRecordingDeferred);

    // A acquires, then begins releasing (hangs on stopRecording).
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(1);
    const releasePromise = releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(0);

    // B's synchronous acquire lands DURING A's await — this is the race.
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(1);

    // Now unblock A's stopRecording. The post-await re-check sees refCount=1,
    // so A abandons the remaining cleanup. stopSound MUST NOT fire — that
    // would kill B's session.
    stopRecordingResolve();
    await releasePromise;

    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockStopSound).not.toHaveBeenCalled();
    expect(getAudioStreamRefCountForTests()).toBe(1);

    // B eventually releases — refCount=0, cleanup chain runs normally now.
    await releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(0);
    expect(mockStopRecording).toHaveBeenCalledTimes(2);
    expect(mockStopSound).toHaveBeenCalledTimes(1);
  });

  it("Case 12: 5 concurrent orchestrators interleaved acquire/release → refcount math stays correct, no destroy() ever", async () => {
    // Epic 12 AC #4 ("audio works after 5 successive screen mount/unmount
    // cycles") + concurrent-orchestrators contract: 5 orchestrators all
    // acquire, then release in arbitrary order. Net refcount is 0; destroy
    // is never called; stopRecording / stopSound fire exactly once each at
    // the moment refcount hits 0 for the final time.
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    acquireAudioStream();
    markRecordingStarted();
    expect(getAudioStreamRefCountForTests()).toBe(5);

    // Releases in interleaved order — refcount stays > 0 until the last.
    await releaseAudioStream();
    await releaseAudioStream();
    expect(mockStopRecording).not.toHaveBeenCalled();

    // Mid-cycle: a new orchestrator joins, then leaves. Cleanup must not
    // fire until ALL outstanding consumers have released.
    acquireAudioStream();
    markRecordingStarted();
    await releaseAudioStream();
    expect(mockStopRecording).not.toHaveBeenCalled();
    expect(mockStopSound).not.toHaveBeenCalled();

    await releaseAudioStream();
    await releaseAudioStream();
    expect(mockStopRecording).not.toHaveBeenCalled();

    // Final release — refCount hits 0, cleanup fires.
    await releaseAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(0);
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockStopSound).toHaveBeenCalledTimes(1);
    expect(mockDestroy).not.toHaveBeenCalled();
  });
});
