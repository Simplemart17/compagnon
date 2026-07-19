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

  it("every AI-output boundary zeroes the mouth: the zero lives INSIDE cancelPendingAiTextRaf", () => {
    // All boundary sites (start reset, the three .done arms, barge-in,
    // response.done, error, reconnect) call cancelPendingAiTextRaf — the
    // zero inherits every current and future boundary by construction.
    const helperStart = src.indexOf("private cancelPendingAiTextRaf()");
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = src.slice(helperStart, src.indexOf("}", src.indexOf("{", helperStart)));
    expect(helperBody).toContain("this.emitAudioAmplitude(0)");
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
    expect(screen).toMatch(/onAudioAmplitude: \(level\) => \{\s*aiAmplitude\.value = level;\s*\}/);
    // NEGATIVE: no setState-shaped call consumes the amplitude level.
    expect(screen).not.toMatch(/set\w+\(level\)/);
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
