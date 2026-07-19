/**
 * PCM16 amplitude extraction — Story 18-4 (Avatar v1).
 *
 * The Realtime API streams AI speech as base64 PCM16 little-endian chunks
 * (`response.output_audio.delta` → `playSound(delta, turnId, "pcm_s16le")`).
 * The avatar's mouth is driven by the RMS level of each chunk.
 *
 * PERF CONTRACT (Story 13-1 lesson): this runs at audio-delta cadence
 * (~10-50Hz). It must stay cheap — the decode is capped at a bounded PREFIX
 * of the chunk (review R1: atob of a full 10-20KB chunk per delta was
 * ~0.5MB/s of transient string allocation on the JS thread; the prefix RMS
 * is indistinguishable for a mouth level smoothed through a 90ms timing) and
 * stride sampling bounds the loop — and its output must be routed to a
 * Reanimated SharedValue, NEVER through React state (a setState at delta
 * cadence would recreate the exact render storm Story 13-1 killed).
 *
 * KNOWN v1 LIMITATION (review R1, follow-up
 * `18-4-followup-playback-clocked-amplitude`): the level is computed at
 * delta-ARRIVAL time. Chunks arrive from the network faster than the audio
 * plays back, so the mouth LEADS the heard audio by the playback-queue
 * depth, and the boundary zero fires ~300-800ms before the speaker drains
 * (see AI_SPEECH_COOLDOWN_MS in the orchestrator). Syllable-accurate
 * lip-sync needs playback-position callbacks from the native audio layer.
 *
 * Level ≠ raw RMS: conversational speech RMS rarely exceeds ~0.35 of
 * full-scale, so the raw value is perceptually boosted (×2.8, clamped to 1)
 * to drive the mouth through most of its range on ordinary speech.
 */

/** Sample every Nth PCM16 frame — bounds the RMS loop. */
export const AMPLITUDE_SAMPLE_STRIDE = 16;

/**
 * Decode at most this many base64 chars per chunk (multiple of 4 → 4095
 * binary bytes ≈ 85ms of 24kHz PCM16) — bounds the atob cost regardless of
 * chunk size. Review R1.
 */
export const AMPLITUDE_MAX_DECODE_BASE64_CHARS = 5460;

/** Perceptual gain applied to raw RMS before clamping (speech ≈ 0.35 FS). */
export const AMPLITUDE_PERCEPTUAL_GAIN = 2.8;

/**
 * Compute a 0..1 mouth-drive level from a base64 PCM16LE chunk.
 *
 * Defensive by design: malformed base64, empty input, or a missing `atob`
 * return 0 (mouth closed) rather than throwing into the audio pipeline.
 */
export function pcm16Base64Level(base64: string, stride = AMPLITUDE_SAMPLE_STRIDE): number {
  try {
    if (typeof base64 !== "string" || base64.length === 0) return 0;
    const binary = globalThis.atob(
      base64.length > AMPLITUDE_MAX_DECODE_BASE64_CHARS
        ? base64.slice(0, AMPLITUDE_MAX_DECODE_BASE64_CHARS)
        : base64
    );
    const byteLen = binary.length - (binary.length % 2);
    if (byteLen < 2) return 0;
    const step = 2 * Math.max(1, Math.floor(stride));
    let sumSquares = 0;
    let count = 0;
    for (let i = 0; i + 1 < byteLen; i += step) {
      const lo = binary.charCodeAt(i);
      const hi = binary.charCodeAt(i + 1);
      let sample = (hi << 8) | lo;
      if (sample >= 0x8000) sample -= 0x10000;
      sumSquares += sample * sample;
      count += 1;
    }
    if (count === 0) return 0;
    const rms = Math.sqrt(sumSquares / count) / 32768;
    return Math.min(1, rms * AMPLITUDE_PERCEPTUAL_GAIN);
  } catch {
    return 0;
  }
}
