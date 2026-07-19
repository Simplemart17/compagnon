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
    expect(src).toMatch(/this\.emitAudioAmplitude\(pcm16Base64Level\(event\.delta as string\)\)/);
  });

  it("R1: audio boundaries route through onAiOutputBoundary; TEXT-done arms do NOT zero the mouth", () => {
    // Review R1: the zero originally lived inside cancelPendingAiTextRaf,
    // but that helper is ALSO called by the transcript/text-done arms which
    // can fire while audio deltas are still streaming — snapping the mouth
    // shut mid-utterance. The dedicated onAiOutputBoundary couples both
    // concerns at the genuine audio boundaries only.
    const helperStart = src.indexOf("private onAiOutputBoundary()");
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = src.slice(helperStart, src.indexOf("\n  }", helperStart));
    expect(helperBody).toContain("this.cancelPendingAiTextRaf()");
    expect(helperBody).toContain("this.emitAudioAmplitude(0)");
    // NEGATIVE: cancelPendingAiTextRaf itself must NOT zero the mouth.
    const cancelStart = src.indexOf("private cancelPendingAiTextRaf()");
    const cancelBody = src.slice(cancelStart, src.indexOf("\n  }", cancelStart));
    expect(cancelBody).not.toContain("emitAudioAmplitude");
    // NEGATIVE: the two TEXT-finalization arms keep only the rAF cancel.
    for (const arm of [
      'case "response.output_text.done"',
      'case "response.output_audio_transcript.done"',
    ]) {
      const armStart = src.indexOf(arm);
      expect(armStart).toBeGreaterThan(-1);
      const armBody = src.slice(armStart, src.indexOf("case ", armStart + arm.length));
      expect(armBody).toContain("cancelPendingAiTextRaf");
      expect(armBody).not.toContain("onAiOutputBoundary");
      expect(armBody).not.toContain("emitAudioAmplitude");
    }
  });

  it("R1: the delta-case guard is hoisted (no eager decode for callback-less consumers) and the decode is prefix-bounded", () => {
    expect(src).toMatch(
      /if \(this\.options\.onAudioAmplitude\) \{\s*this\.emitAudioAmplitude\(pcm16Base64Level\(event\.delta as string\)\);/
    );
    const amp = readSrc("src/lib/audio-amplitude.ts");
    expect(amp).toContain("AMPLITUDE_MAX_DECODE_BASE64_CHARS = 5460");
    expect(amp).toMatch(/base64\.slice\(0, AMPLITUDE_MAX_DECODE_BASE64_CHARS\)/);
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
