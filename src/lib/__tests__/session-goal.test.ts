/**
 * Story 18-6 — session goal derivation + goal-chip wiring drift pins.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { deriveSessionGoal } from "@/src/lib/session-goal";

function readSrc(rel: string): string {
  const raw = readFileSync(join(__dirname, "../../..", rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 18-6 — deriveSessionGoal", () => {
  it("companion mode keeps the FR topic as content inside EN chrome", () => {
    expect(deriveSessionGoal("companion", "Au café")).toBe("Keep the conversation going — Au café");
  });

  it("debate mode frames the position defense", () => {
    expect(deriveSessionGoal("debate", "Les réseaux sociaux")).toBe(
      "Defend your position — Les réseaux sociaux"
    );
  });

  it("tcf_simulation ignores the topic — the goal is format practice", () => {
    expect(deriveSessionGoal("tcf_simulation", "Au café")).toBe("Exam practice — Expression Orale");
  });

  it("empty / whitespace topics degrade to the bare goal (no dangling em-dash)", () => {
    expect(deriveSessionGoal("companion", "")).toBe("Keep the conversation going");
    expect(deriveSessionGoal("debate", "   ")).toBe("Defend your position");
    expect(deriveSessionGoal("companion", undefined as unknown as string)).toBe(
      "Keep the conversation going"
    );
  });
});

describe("Story 18-6 — goal-chip wiring drift pins", () => {
  it("the active layout mounts SessionGoalChip with mode + topic + cefrLevel", () => {
    const screen = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    expect(screen).toMatch(
      /<SessionGoalChip mode=\{mode\} topic=\{topic\} cefrLevel=\{cefrLevel\}/
    );
  });

  it("the chip exposes the Epic 19 lesson hook (goalOverride takes precedence)", () => {
    const chip = readFileSync(
      join(__dirname, "../../..", "src/components/conversation/SessionGoalChip.tsx"),
      "utf8"
    );
    expect(chip).toMatch(/goalOverride\?: string/);
    expect(chip).toMatch(/goalOverride !== undefined && goalOverride\.trim\(\)\.length > 0/);
  });
});
