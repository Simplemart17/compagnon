/**
 * Story 18-4 completion pass — AmplitudeEnvelopePacer runtime contract.
 *
 * Fake-timer suite: the pacer must replay chunk levels at PLAYBACK pace
 * (duration-derived), drain the buffered tail after a soft stream end, cut
 * hard on interrupt, and close the mouth on underrun.
 */

import {
  AmplitudeEnvelopePacer,
  PACER_MAX_CATCHUP_MS,
  PACER_SAMPLE_RATE_HZ,
  pcm16Base64DurationMs,
} from "@/src/lib/amplitude-pacer";

/** Base64 of N silent PCM16 frames (2 bytes each). */
function framesBase64(frames: number): string {
  return Buffer.alloc(frames * 2).toString("base64");
}

describe("Story 18-4 — pcm16Base64DurationMs", () => {
  it("constants pinned: 24kHz playback rate + 250ms catch-up bound", () => {
    expect(PACER_SAMPLE_RATE_HZ).toBe(24000);
    expect(PACER_MAX_CATCHUP_MS).toBe(250);
  });

  it("4800 frames at 24kHz = 200ms (padding-free length)", () => {
    expect(pcm16Base64DurationMs(framesBase64(4800))).toBeCloseTo(200, 5);
  });

  it("handles base64 padding correctly (1 frame = 2 bytes → '=' padded)", () => {
    // 2 bytes → base64 "AAA=" (4 chars, 1 padding char).
    const b64 = Buffer.alloc(2).toString("base64");
    expect(b64.endsWith("=")).toBe(true);
    expect(pcm16Base64DurationMs(b64)).toBeCloseTo((1 / 24000) * 1000, 6);
  });

  it("defensive inputs → 0", () => {
    expect(pcm16Base64DurationMs("")).toBe(0);
    expect(pcm16Base64DurationMs(undefined as unknown as string)).toBe(0);
    expect(pcm16Base64DurationMs(framesBase64(100), 0)).toBe(0);
  });
});

describe("Story 18-4 — AmplitudeEnvelopePacer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function makePacer() {
    const emitted: number[] = [];
    const pacer = new AmplitudeEnvelopePacer((level) => emitted.push(level));
    return { pacer, emitted };
  }

  it("single segment: emits the level immediately, then 0 after its duration", () => {
    const { pacer, emitted } = makePacer();
    pacer.push(0.8, 200);
    expect(emitted).toEqual([0.8]);
    jest.advanceTimersByTime(199);
    expect(emitted).toEqual([0.8]);
    jest.advanceTimersByTime(1);
    expect(emitted).toEqual([0.8, 0]);
  });

  it("burst arrival replays sequentially at playback pace (the desync fix)", () => {
    // Three chunks arrive back-to-back (network faster than playback) —
    // the envelope must still take 300ms of wall clock, not 0.
    const { pacer, emitted } = makePacer();
    pacer.push(0.2, 100);
    pacer.push(0.9, 100);
    pacer.push(0.5, 100);
    expect(emitted).toEqual([0.2]);
    jest.advanceTimersByTime(100);
    expect(emitted).toEqual([0.2, 0.9]);
    jest.advanceTimersByTime(100);
    expect(emitted).toEqual([0.2, 0.9, 0.5]);
    jest.advanceTimersByTime(100);
    expect(emitted).toEqual([0.2, 0.9, 0.5, 0]);
  });

  it("soft stream end: the queued tail DRAINS (no premature close at audio.done)", () => {
    // audio.done arrival calls NOTHING on the pacer — chunks already queued
    // keep playing out, mirroring the buffered speaker tail.
    const { pacer, emitted } = makePacer();
    pacer.push(0.7, 150);
    pacer.push(0.6, 150);
    // (audio.done arrives here — no pacer call)
    jest.advanceTimersByTime(150);
    expect(emitted).toEqual([0.7, 0.6]);
    jest.advanceTimersByTime(150);
    expect(emitted).toEqual([0.7, 0.6, 0]);
  });

  it("interrupt: immediate 0, queue flushed, timer cleared", () => {
    const { pacer, emitted } = makePacer();
    pacer.push(0.9, 500);
    pacer.push(0.8, 500);
    pacer.interrupt();
    expect(emitted).toEqual([0.9, 0]);
    jest.advanceTimersByTime(2000);
    // Nothing further fires — the flushed queue never replays.
    expect(emitted).toEqual([0.9, 0]);
  });

  it("underrun: empty queue closes the mouth; a later push resumes", () => {
    const { pacer, emitted } = makePacer();
    pacer.push(0.6, 100);
    jest.advanceTimersByTime(100);
    expect(emitted).toEqual([0.6, 0]); // underrun close
    pacer.push(0.4, 100);
    expect(emitted).toEqual([0.6, 0, 0.4]); // resumed
    jest.advanceTimersByTime(100);
    expect(emitted).toEqual([0.6, 0, 0.4, 0]);
  });

  it("invalid pushes are ignored (no NaN segments, no zero-duration spins)", () => {
    const { pacer, emitted } = makePacer();
    pacer.push(NaN, 100);
    pacer.push(0.5, 0);
    pacer.push(0.5, -10);
    pacer.push(0.5, NaN);
    expect(emitted).toEqual([]);
    jest.advanceTimersByTime(1000);
    expect(emitted).toEqual([]);
  });

  it("interrupt while idle emits a single defensive 0", () => {
    const { pacer, emitted } = makePacer();
    pacer.interrupt();
    expect(emitted).toEqual([0]);
  });
});
