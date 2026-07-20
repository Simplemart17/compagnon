/**
 * Story 18-6 R1 — SessionGoalChip runtime mount cases.
 *
 * The goalOverride precedence is the story's load-bearing Epic 19 hook —
 * a source-regex pin alone can pass vacuously (14-2 R1-H3 class), so these
 * cases assert the RENDERED output.
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

import { SessionGoalChip } from "@/src/components/conversation/SessionGoalChip";
import { mountWithAct, registerMountCleanup } from "@/src/test-utils/react-test-renderer";

registerMountCleanup();

function json(el: React.ReactElement): string {
  return JSON.stringify(mountWithAct(el).toJSON());
}

describe("Story 18-6 R1 — SessionGoalChip runtime", () => {
  it("renders the derived goal + level badge + full a11y label", () => {
    const out = json(<SessionGoalChip mode="companion" topic="Au café" cefrLevel="B2" />);
    expect(out).toContain("Keep the conversation going — Au café");
    expect(out).toContain('"B2"');
    expect(out).toContain("Session goal: Keep the conversation going — Au café. Level B2.");
  });

  it("goalOverride takes precedence over the derived text (the Epic 19 hook, verified at render)", () => {
    const out = json(
      <SessionGoalChip
        mode="companion"
        topic="Au café"
        cefrLevel="B1"
        goalOverride="Order a meal politely"
      />
    );
    expect(out).toContain("Order a meal politely");
    expect(out).not.toContain("Keep the conversation going");
    expect(out).toContain("Session goal: Order a meal politely. Level B1.");
  });

  it("whitespace-only override falls back to the derived goal", () => {
    const out = json(
      <SessionGoalChip
        mode="debate"
        topic="Les réseaux sociaux"
        cefrLevel="B1"
        goalOverride="   "
      />
    );
    expect(out).toContain("Defend your position — Les réseaux sociaux");
  });

  it("undefined cefrLevel: badge hidden, a11y label carries no level clause (hydration window)", () => {
    const out = json(<SessionGoalChip mode="companion" topic="Au café" />);
    expect(out).toContain("Session goal: Keep the conversation going — Au café.");
    expect(out).not.toContain("Level");
  });
});
