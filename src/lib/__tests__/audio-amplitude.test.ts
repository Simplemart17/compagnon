/**
 * Story 18-4 — PCM16 base64 amplitude extraction.
 *
 * Runtime math contract for `pcm16Base64Level`: synthetic little-endian
 * PCM16 buffers with known RMS values, defensive-input paths, and the
 * stride/gain constants.
 */

import {
  AMPLITUDE_PERCEPTUAL_GAIN,
  AMPLITUDE_SAMPLE_STRIDE,
  pcm16Base64Level,
} from "@/src/lib/audio-amplitude";

/** Build a base64 PCM16LE chunk from an array of sample values. */
function pcmBase64(samples: number[]): string {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf.toString("base64");
}

describe("Story 18-4 — pcm16Base64Level", () => {
  it("constants pinned", () => {
    expect(AMPLITUDE_SAMPLE_STRIDE).toBe(16);
    expect(AMPLITUDE_PERCEPTUAL_GAIN).toBe(2.8);
  });

  it("silence → 0", () => {
    expect(pcm16Base64Level(pcmBase64(new Array(1024).fill(0)))).toBe(0);
  });

  it("full-scale square wave → clamped to 1", () => {
    // RMS of constant ±32767 ≈ 1.0 full-scale; ×2.8 gain clamps to 1.
    const samples = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 32767 : -32767));
    expect(pcm16Base64Level(pcmBase64(samples))).toBe(1);
  });

  it("constant 1/8-scale signal → rms 0.125 × gain = 0.35", () => {
    const level = pcm16Base64Level(pcmBase64(new Array(1024).fill(4096)));
    expect(level).toBeCloseTo(0.125 * AMPLITUDE_PERCEPTUAL_GAIN, 3);
  });

  it("negative samples contribute the same energy as positive (RMS, not mean)", () => {
    const pos = pcm16Base64Level(pcmBase64(new Array(512).fill(8192)));
    const neg = pcm16Base64Level(pcmBase64(new Array(512).fill(-8192)));
    expect(neg).toBeCloseTo(pos, 6);
  });

  it("stride sampling: constant signal gives the same level at stride 1 and default stride", () => {
    const samples = new Array(1024).fill(2048);
    const b64 = pcmBase64(samples);
    expect(pcm16Base64Level(b64, 1)).toBeCloseTo(pcm16Base64Level(b64), 6);
  });

  it("defensive inputs → 0 (mouth closed), never a throw", () => {
    expect(pcm16Base64Level("")).toBe(0);
    expect(pcm16Base64Level("!!!not-base64!!!")).toBe(0);
    // Single byte (below one PCM16 frame).
    expect(pcm16Base64Level(Buffer.from([0x7f]).toString("base64"))).toBe(0);
    // Non-string smuggled through a loose call site.
    expect(pcm16Base64Level(undefined as unknown as string)).toBe(0);
  });

  it("odd byte count: trailing half-frame is ignored, not mis-read", () => {
    const buf = Buffer.alloc(9); // 4 full frames + 1 dangling byte
    for (let i = 0; i < 4; i += 1) buf.writeInt16LE(4096, i * 2);
    buf[8] = 0x7f;
    const level = pcm16Base64Level(buf.toString("base64"), 1);
    expect(level).toBeCloseTo(0.125 * AMPLITUDE_PERCEPTUAL_GAIN, 3);
  });

  it("output is always within [0, 1]", () => {
    const noisy = Array.from({ length: 2048 }, (_, i) =>
      Math.round(32767 * Math.sin(i / 3) * (i % 5 === 0 ? -1 : 1))
    );
    const level = pcm16Base64Level(pcmBase64(noisy));
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(1);
  });
});
