/**
 * Story 18-4 — avatar amplitude plumbing drift pins.
 *
 * The amplitude path is orchestrator → hook → screen SharedValue → avatar
 * worklet, and its load-bearing property is what it does NOT do: touch
 * React state at audio-delta cadence (the Story 13-1 render-storm
 * contract). These pins hold each link of the chain in place.
 *
 * Drift discipline: comment-stripped source reads (Story 12-2 P12) +
 * paired POSITIVE/NEGATIVE pins (Story 13-2 P11).
 */

import { readFileSync } from "fs";
import { join } from "path";

function readSrc(rel: string): string {
  const raw = readFileSync(join(__dirname, "../../..", rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 18-4 — orchestrator amplitude plumbing", () => {
  const src = readSrc("src/lib/realtime-orchestrator.ts");

  it("options expose onAudioAmplitude and the delta case emits a computed level", () => {
    expect(src).toMatch(/onAudioAmplitude\?: \(level: number\) => void/);
    expect(src).toMatch(
      /this\.amplitudePacer\.push\(pcm16Base64Level\(delta\), pcm16Base64DurationMs\(delta\)\)/
    );
  });

  it("R1+completion: HARD interrupts via onAiOutputInterrupted; SOFT ends + TEXT arms drain, never flush", () => {
    // Review R1 P1 decoupled the mouth from the text-stream helper; the
    // completion pass split boundaries further: HARD interrupts (barge-in,
    // error, reconnect, dispose, start reset) flush the pacer immediately,
    // while SOFT stream ends (audio.done, response.done) let the queued
    // envelope drain in sync with the buffered speaker tail.
    const helperStart = src.indexOf("private onAiOutputInterrupted()");
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = src.slice(helperStart, src.indexOf("\n  }", helperStart));
    expect(helperBody).toContain("this.cancelPendingAiTextRaf()");
    expect(helperBody).toContain("this.amplitudePacer.interrupt()");
    // NEGATIVE: cancelPendingAiTextRaf itself touches no amplitude state.
    const cancelStart = src.indexOf("private cancelPendingAiTextRaf()");
    const cancelBody = src.slice(cancelStart, src.indexOf("\n  }", cancelStart));
    expect(cancelBody).not.toContain("emitAudioAmplitude");
    expect(cancelBody).not.toContain("amplitudePacer");
    // TEXT-finalization arms: rAF cancel only.
    for (const arm of [
      'case "response.output_text.done"',
      'case "response.output_audio_transcript.done"',
    ]) {
      const armStart = src.indexOf(arm);
      expect(armStart).toBeGreaterThan(-1);
      const armBody = src.slice(armStart, src.indexOf("case ", armStart + arm.length));
      expect(armBody).toContain("cancelPendingAiTextRaf");
      expect(armBody).not.toContain("onAiOutputInterrupted");
      expect(armBody).not.toContain("amplitudePacer");
    }
    // SOFT stream ends: rAF cancel present, NO hard flush (tail must drain).
    const audioDoneStart = src.indexOf('case "response.output_audio.done"');
    expect(audioDoneStart).toBeGreaterThan(-1);
    const audioDoneBody = src.slice(audioDoneStart, src.indexOf("case ", audioDoneStart + 10));
    expect(audioDoneBody).toContain("cancelPendingAiTextRaf");
    expect(audioDoneBody).not.toContain("onAiOutputInterrupted");
    const respDoneStart = src.indexOf("private handleResponseDone()");
    expect(respDoneStart).toBeGreaterThan(-1);
    const respDoneBody = src.slice(respDoneStart, src.indexOf("\n  }\n", respDoneStart));
    expect(respDoneBody).toContain("cancelPendingAiTextRaf");
    expect(respDoneBody).not.toContain("onAiOutputInterrupted");
  });

  it("R1+completion: guarded delta case pushes DURATION-PACED levels; decode is prefix-bounded; rates match", () => {
    expect(src).toMatch(
      /if \(this\.options\.onAudioAmplitude\) \{[\s\S]{0,200}?this\.amplitudePacer\.push\(pcm16Base64Level\(delta\), pcm16Base64DurationMs\(delta\)\)/
    );
    // NEGATIVE: no direct arrival-time emit remains in the delta case.
    const deltaStart = src.indexOf('case "response.output_audio.delta"');
    const deltaBody = src.slice(deltaStart, src.indexOf("case ", deltaStart + 10));
    expect(deltaBody).not.toContain("this.emitAudioAmplitude(pcm16Base64Level");
    const amp = readSrc("src/lib/audio-amplitude.ts");
    expect(amp).toContain("AMPLITUDE_MAX_DECODE_BASE64_CHARS = 5460");
    expect(amp).toMatch(/base64\.slice\(0, AMPLITUDE_MAX_DECODE_BASE64_CHARS\)/);
    // The pacer's playback rate must match the orchestrator's sound config.
    const pacer = readSrc("src/lib/amplitude-pacer.ts");
    expect(pacer).toContain("PACER_SAMPLE_RATE_HZ = 24000");
    expect(src).toMatch(/sampleRate: 24000/);
  });

  it("R1: the latch truly MUTES (early return before invoke) and is reset in start()", () => {
    const emitStart = src.indexOf("private emitAudioAmplitude");
    const emitBody = src.slice(emitStart, src.indexOf("\n  }", emitStart));
    const latchCheck = emitBody.indexOf("if (this.amplitudeCallbackErrorLatched) return;");
    const invoke = emitBody.indexOf("this.options.onAudioAmplitude(level)");
    expect(latchCheck).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(latchCheck);
    expect(src).toMatch(/this\.amplitudeCallbackErrorLatched = false;/);
  });

  it("a throwing consumer callback is swallowed with a one-shot breadcrumb, never error-tier at delta cadence", () => {
    expect(src).toMatch(/amplitudeCallbackErrorLatched/);
    expect(src).toContain('feature: "avatar-amplitude-callback-error"');
    // NEGATIVE: no captureError in the emit path (would spam Sentry ~50Hz).
    const emitStart = src.indexOf("private emitAudioAmplitude");
    const emitBody = src.slice(emitStart, src.indexOf("\n  }", emitStart));
    expect(emitBody).not.toContain("captureError");
  });
});

describe("Story 18-4 — hook + screen wiring", () => {
  it("useRealtimeVoice passes onAudioAmplitude through to the orchestrator", () => {
    const hook = readSrc("src/hooks/use-realtime-voice.ts");
    expect(hook).toMatch(/onAudioAmplitude\?: \(level: number\) => void/);
    expect(hook).toMatch(/onAudioAmplitude: options\.onAudioAmplitude/);
  });

  it("the screen routes amplitude into a SharedValue — NEVER React state (13-1 contract)", () => {
    const screen = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    // R1: scope the pin to the callback BODY — the pre-R1 file-wide
    // /set\w+\(level\)/ guard false-positived on innocent identifiers and
    // missed setFoo(level * 1) shapes. The 13-1 contract governs exactly
    // this closure: it must contain ONLY the shared-value write.
    const cbMatch = screen.match(/onAudioAmplitude: \(level\) => \{([^}]*)\}/);
    expect(cbMatch).not.toBeNull();
    const body = cbMatch![1];
    expect(body).toMatch(/aiAmplitude\.value = level;/);
    expect(body).not.toMatch(/set[A-Z]\w*\(/);
    expect(body.trim().split("\n").length).toBe(1);
  });

  it("the screen consumes deriveAvatarState + CompanionAvatar; the AIOrb files are GONE", () => {
    const screen = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    expect(screen).toMatch(/deriveAvatarState\(conversation\)/);
    expect(screen).toMatch(/<CompanionAvatar state=\{avatarState\} amplitude=\{aiAmplitude\}/);
    expect(screen).toMatch(/<AvatarStatusLabel state=\{avatarState\}/);
    // Delete-don't-alias: the superseded orb must not resurface.
    expect(screen).not.toMatch(/\bAIOrb\b/);
    expect(() =>
      readFileSync(join(__dirname, "../../..", "src/components/conversation/AIOrb.tsx"))
    ).toThrow();
    expect(() =>
      readFileSync(join(__dirname, "../../..", "src/components/conversation/AIOrbStatusLabel.tsx"))
    ).toThrow();
  });

  it("celebrating is wired: the milestone card mounts a celebrating mini-avatar", () => {
    const screen = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    expect(screen).toMatch(/<CompanionAvatar state="celebrating" size=\{64\}/);
  });
});
