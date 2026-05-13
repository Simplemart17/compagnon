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
    acquireAudioStream();
    acquireAudioStream();
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
    acquireAudioStream();

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
    acquireAudioStream();
    acquireAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(3);

    __resetAudioStreamManagerForTests();

    expect(getAudioStreamRefCountForTests()).toBe(0);
    // After reset, a fresh acquire/release cycle works correctly.
    acquireAudioStream();
    expect(getAudioStreamRefCountForTests()).toBe(1);
  });

  it("Case 10: stopRecording / stopSound throwing on last release does NOT propagate (best-effort cleanup)", async () => {
    mockStopRecording.mockRejectedValueOnce(new Error("native module busy"));
    mockStopSound.mockRejectedValueOnce(new Error("playback engine error"));

    acquireAudioStream();
    // releaseAudioStream should resolve cleanly despite both throws.
    await expect(releaseAudioStream()).resolves.toBeUndefined();
    expect(getAudioStreamRefCountForTests()).toBe(0);
  });
});
