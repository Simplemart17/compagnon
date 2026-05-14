/**
 * Story 12-1 — line-budget drift detector for `use-realtime-voice.ts`.
 *
 * Spec target: `useRealtimeVoice.ts ≤ 250 lines` per `shippable-roadmap.md`
 * line 218. Pre-12-1 the hook was 1,354 lines; post-12-1 it's a thin React
 * binding (~116 lines) around the `RealtimeOrchestrator` class.
 *
 * A future regression that grows the hook past the 250-line budget fails CI
 * loudly. Mirrors the Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 drift-detector
 * pattern (read source from disk + assert via regex).
 */

import { readFileSync } from "fs";
import { join } from "path";

const HOOK_PATH = join(__dirname, "..", "use-realtime-voice.ts");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf8");
const HOOK_LINE_COUNT = HOOK_SOURCE.split("\n").length;

const LINE_BUDGET = 250;
const MIN_LINE_COUNT = 50;

describe("Story 12-1 — useRealtimeVoice.ts line budget", () => {
  it(`line count ≤ ${LINE_BUDGET} (spec target: 'useRealtimeVoice.ts ≤ 250 lines')`, () => {
    expect(HOOK_LINE_COUNT).toBeLessThanOrEqual(LINE_BUDGET);
  });

  it(`line count > ${MIN_LINE_COUNT} (sanity — file shouldn't be empty)`, () => {
    expect(HOOK_LINE_COUNT).toBeGreaterThan(MIN_LINE_COUNT);
  });

  it("hook imports RealtimeOrchestrator from src/lib/realtime-orchestrator.ts", () => {
    expect(HOOK_SOURCE).toMatch(/from "@\/src\/lib\/realtime-orchestrator"/);
    expect(HOOK_SOURCE).toMatch(/RealtimeOrchestrator/);
  });

  it("hook is a pure React binding (uses useRef + useState + useEffect)", () => {
    expect(HOOK_SOURCE).toMatch(/useRef/);
    expect(HOOK_SOURCE).toMatch(/useState/);
    expect(HOOK_SOURCE).toMatch(/useEffect/);
  });

  it("hook does NOT import RealtimeSession directly (orchestrator owns it now)", () => {
    // Negative guard: pre-12-1 the hook imported RealtimeSession + RealtimeConfig.
    // Post-12-1 only the orchestrator imports them. Catches a regression that
    // re-introduces low-level WebSocket plumbing into the hook layer.
    expect(HOOK_SOURCE).not.toMatch(/from "@\/src\/lib\/realtime"/);
  });

  it("hook does NOT import buildConversationPrompt (orchestrator owns it now)", () => {
    expect(HOOK_SOURCE).not.toMatch(/buildConversationPrompt/);
  });

  it("hook does NOT import persistConversation helpers (orchestrator owns them now)", () => {
    // Pre-12-1 the hook imported `updateStreak`, `updateSkillProgress`,
    // `incrementDailyActivity`, `checkCefrPromotion`, `extractPostConversationAnalysis`,
    // `persistPostConversationAnalysis`, `persistErrorPatterns`. Post-12-1 the
    // orchestrator imports them; the hook is purely state-binding.
    expect(HOOK_SOURCE).not.toMatch(/checkCefrPromotion/);
    expect(HOOK_SOURCE).not.toMatch(/extractPostConversationAnalysis/);
    expect(HOOK_SOURCE).not.toMatch(/persistPostConversationAnalysis/);
  });

  it("hook does NOT import ExpoPlayAudioStream (orchestrator owns audio now)", () => {
    expect(HOOK_SOURCE).not.toMatch(/expo-audio-stream/);
  });

  it("hook does NOT import audio-stream-manager (orchestrator owns lifecycle now; Story 12-5 review-round-1 P10)", () => {
    // Negative guard for Story 12-5: only the orchestrator should consume
    // `acquireAudioStream` / `releaseAudioStream`. If the hook started
    // importing the manager directly it would mean the lifecycle moved
    // back into React-land — a regression that would re-introduce the
    // P1-19 destroy-on-unmount class of bugs by ceding refcount control
    // to React's render lifecycle.
    expect(HOOK_SOURCE).not.toMatch(/audio-stream-manager/);
  });

  it("P16 review-patch: hook's public methods are pure pass-throughs to orchestrator (negative-guard against business-logic regression)", () => {
    // Pin the 3 pass-through methods. A future refactor that re-introduces
    // business logic into the hook would break these patterns.
    expect(HOOK_SOURCE).toMatch(/orchestratorRef\.current\?\.start\(\)/);
    expect(HOOK_SOURCE).toMatch(/orchestratorRef\.current\?\.sendText\(text\)/);
    expect(HOOK_SOURCE).toMatch(/orchestratorRef\.current\?\.end\(\)/);
  });

  it("P16 review-patch: hook subscribes to orchestrator state changes (observer-pattern wiring)", () => {
    expect(HOOK_SOURCE).toMatch(/orchestratorRef\.current\?\.subscribe\(setState\)/);
  });

  it("P16 review-patch: hook calls orchestrator.dispose() on unmount (cleanup contract)", () => {
    expect(HOOK_SOURCE).toMatch(/orchestratorRef\.current\?\.dispose\(\)/);
  });
});
