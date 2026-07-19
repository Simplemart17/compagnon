/**
 * Story 18-4 — CompanionAvatar runtime smoke test.
 *
 * Mounts the avatar in every state via react-test-renderer + the shared
 * reanimated mock (Epic 13 retro AI #7 factory) and pins the decorative
 * a11y contract, the face-feature presence, the memo identities, and the
 * status-label copy (EN chrome per Story 14-1).
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

import { create, act } from "react-test-renderer";

import { AvatarStatusLabel, CompanionAvatar } from "@/src/components/conversation/CompanionAvatar";
import { type AvatarState } from "@/src/lib/avatar-state";
import { findAllNodes } from "@/src/test-utils/react-test-renderer";

const ALL_STATES: AvatarState[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "celebrating",
];

function mount(el: React.ReactElement) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(el);
  });
  return renderer;
}

describe("Story 18-4 — CompanionAvatar", () => {
  it.each(ALL_STATES)("renders without crashing in state %s", (state) => {
    const renderer = mount(<CompanionAvatar state={state} />);
    expect(renderer.toJSON()).toBeTruthy();
    act(() => renderer.unmount());
  });

  it("root container is decorative for screen readers (3-prop cross-platform contract, Story 14-3 R1-P1)", () => {
    const renderer = mount(<CompanionAvatar state="idle" />);
    const decorative = findAllNodes(renderer, (n) => n.props?.accessibilityElementsHidden === true);
    expect(decorative.length).toBeGreaterThan(0);
    expect(decorative[0].props.importantForAccessibility).toBe("no-hide-descendants");
    expect(decorative[0].props.pointerEvents).toBe("none");
    act(() => renderer.unmount());
  });

  it("thinking state mounts the three thinking dots; other states do not", () => {
    const thinking = mount(<CompanionAvatar state="thinking" />);
    const thinkingJson = JSON.stringify(thinking.toJSON());
    act(() => thinking.unmount());
    const idle = mount(<CompanionAvatar state="idle" />);
    const idleJson = JSON.stringify(idle.toJSON());
    act(() => idle.unmount());
    // The dots are the only marginLeft:5 members of the tree.
    expect((thinkingJson.match(/"marginLeft":5/g) ?? []).length).toBe(2);
    expect(idleJson).not.toContain('"marginLeft":5');
  });

  it("memo identities are exported with displayNames (13-5 L2 precedent)", () => {
    expect((CompanionAvatar as { displayName?: string }).displayName).toBe("CompanionAvatar");
    expect((AvatarStatusLabel as { displayName?: string }).displayName).toBe("AvatarStatusLabel");
  });
});

describe("Story 18-4 — AvatarStatusLabel copy (EN chrome, Story 14-1)", () => {
  const EXPECTED: Record<AvatarState, string> = {
    idle: "Your turn — just talk",
    connecting: "Connecting...",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
    celebrating: "Well done!",
  };

  it.each(ALL_STATES)("state %s renders its label with a polite live region", (state) => {
    const renderer = mount(<AvatarStatusLabel state={state} />);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain(EXPECTED[state]);
    expect(json).toContain('"accessibilityLiveRegion":"polite"');
    act(() => renderer.unmount());
  });
});
