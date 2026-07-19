/**
 * AmplitudeEnvelopePacer — Story 18-4 completion pass (review R1 finding
 * #7 fixed, not just documented).
 *
 * THE PROBLEM: Realtime audio deltas arrive from the network FASTER than
 * the audio plays back (playSound queues them), so driving the avatar
 * mouth at delta-ARRIVAL time made the lips lead the heard voice by the
 * queue depth, and zeroing at `audio.done` ARRIVAL closed the mouth
 * ~300-800ms before the speaker drained (see AI_SPEECH_COOLDOWN_MS).
 *
 * THE FIX (no native playback callbacks needed): every PCM16 chunk's
 * playback DURATION is derivable from its byte length (frames / 24kHz), so
 * the pacer queues `{level, durationMs}` segments as chunks arrive and
 * REPLAYS the level envelope on a wall-clock schedule that mirrors what the
 * audio queue is playing. The buffered tail after `audio.done` drains
 * naturally — the mouth keeps moving until the queued envelope (≈ the
 * queued audio) runs out, then closes.
 *
 * Residual error sources (accepted; see the narrowed follow-up
 * `18-4-followup-playback-clocked-amplitude`): playback start latency of
 * the first chunk, and network underruns (the pacer emits 0 on an empty
 * queue — matching the silent speaker — and resumes on the next chunk).
 * Absolute-deadline scheduling bounds setTimeout drift: each segment's end
 * is computed from the PREVIOUS deadline (when the timer fired close to
 * on-time) so lateness doesn't accumulate across a long utterance.
 *
 * Threading contract: pure JS timers + a caller-provided emit sink. The
 * orchestrator wires `emit` to `emitAudioAmplitude` (latch + try/catch
 * live there), which feeds the Story 13-1-safe SharedValue path.
 */

/** Playback sample rate — MUST match `setSoundConfig({ sampleRate })` in
 * the orchestrator (24kHz PCM16, the Realtime GA API output format). */
export const PACER_SAMPLE_RATE_HZ = 24000;

/**
 * Max tolerated timer lateness (ms) for deadline carry-over. A timer firing
 * later than this resets pacing to "now" instead of compressing segments to
 * catch up (a huge JS stall should not fast-forward the mouth).
 */
export const PACER_MAX_CATCHUP_MS = 250;

export interface AmplitudeSegment {
  /** 0..1 mouth-drive level for this segment. */
  level: number;
  /** Playback duration of the segment's audio in ms. */
  durationMs: number;
}

/**
 * Playback duration in ms of a base64 PCM16 chunk at the given rate.
 * Defensive: non-string / empty input → 0.
 */
export function pcm16Base64DurationMs(
  base64: string,
  sampleRateHz: number = PACER_SAMPLE_RATE_HZ
): number {
  if (typeof base64 !== "string" || base64.length === 0) return 0;
  let bytes = Math.floor((base64.length * 3) / 4);
  if (base64.endsWith("==")) bytes -= 2;
  else if (base64.endsWith("=")) bytes -= 1;
  const frames = Math.floor(bytes / 2);
  if (frames <= 0 || sampleRateHz <= 0) return 0;
  return (frames / sampleRateHz) * 1000;
}

export class AmplitudeEnvelopePacer {
  private queue: AmplitudeSegment[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  /** Absolute wall-clock end of the currently-playing segment (0 = none). */
  private deadlineMs = 0;

  constructor(private readonly emit: (level: number) => void) {}

  /** Queue one chunk's level; starts the envelope clock if idle. */
  push(level: number, durationMs: number): void {
    if (!Number.isFinite(level) || !Number.isFinite(durationMs) || durationMs <= 0) return;
    this.queue.push({ level, durationMs });
    if (!this.playing) {
      this.startNext(Date.now());
    }
  }

  /**
   * Hard interrupt — barge-in / error / reconnect / dispose / start reset.
   * Flushes the queue, stops the clock, closes the mouth immediately.
   * NOT called at `audio.done` / `response.done`: those are soft stream
   * ends — the queued tail keeps draining, mirroring the speaker.
   */
  interrupt(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.playing = false;
    this.deadlineMs = 0;
    this.emit(0);
  }

  private startNext(nowMs: number): void {
    const segment = this.queue.shift();
    if (segment === undefined) {
      // Queue drained: stream end or network underrun — the speaker is
      // silent either way, so close the mouth. A later push resumes.
      this.playing = false;
      this.deadlineMs = 0;
      this.emit(0);
      return;
    }
    this.playing = true;
    this.emit(segment.level);
    // Absolute-deadline pacing: when the timer fired only slightly late,
    // anchor the next deadline to the PREVIOUS one so lateness doesn't
    // accumulate; after a big stall, re-anchor to now (no fast-forward).
    const carryOver =
      this.deadlineMs > 0 &&
      nowMs >= this.deadlineMs &&
      nowMs - this.deadlineMs < PACER_MAX_CATCHUP_MS;
    const base = carryOver ? this.deadlineMs : nowMs;
    this.deadlineMs = base + segment.durationMs;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.startNext(Date.now());
      },
      Math.max(0, this.deadlineMs - nowMs)
    );
  }
}
