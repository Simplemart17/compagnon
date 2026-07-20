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
  it("the active layout mounts SessionGoalChip with mode + topic + UNCOERCED cefrLevel", () => {
    const screen = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    // R1: per-prop tolerant matching scoped to the element's opening tag
    // (12-12 M1 / 13-7 lesson) — Epic 19 WILL add goalOverride here and
    // prettier will re-wrap the JSX; the pin must survive both.
    const tagStart = screen.indexOf("<SessionGoalChip");
    expect(tagStart).toBeGreaterThan(-1);
    const openingTag = screen.slice(tagStart, screen.indexOf("/>", tagStart));
    expect(openingTag).toMatch(/mode=\{mode\}/);
    expect(openingTag).toMatch(/topic=\{topic\}/);
    // R1: the chip takes the UNCOERCED level (18-2 R1-P3 pattern) so the
    // badge hides during hydration instead of showing "A1" to a B2 user.
    expect(openingTag).toMatch(/cefrLevel=\{correctionCefrLevel\}/);
    expect(openingTag).not.toMatch(/cefrLevel=\{cefrLevel\}/);
    // The chip renders ONLY in the active layout: exactly one mount site,
    // inside the isConversationActive branch.
    expect(screen.match(/<SessionGoalChip/g)).toHaveLength(1);
    const activeBranch = screen.indexOf("isConversationActive ? (");
    expect(activeBranch).toBeGreaterThan(-1);
    expect(tagStart).toBeGreaterThan(activeBranch);
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
