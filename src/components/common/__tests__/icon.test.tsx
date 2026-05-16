/**
 * Story 14-3 runtime smoke test for the new shared `Icon` component.
 *
 * Pattern: `react-test-renderer` + `act` (Story 12-1 P8 / 13-4 P2 / 13-5 /
 * 13-7 / 14-2 precedent). Uses the shared test utilities at
 * `src/test-utils/` (Epic 13 retrospective AI #7).
 *
 * The `@expo/vector-icons` Feather export is mocked file-level so the
 * runtime smoke test doesn't try to register native vector glyphs (which
 * fail under Jest). The mock renders a Text host element carrying the
 * `name` / `size` / `color` / `accessibilityLabel` /
 * `importantForAccessibility` props verbatim — that's all the assertions
 * need to verify.
 */

/* eslint-disable import/first -- jest.mock must precede component import */
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- inside factory
  const mockReact = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockRN = require("react-native");

  const mockFeather = (props: Record<string, unknown>) =>
    mockReact.createElement(mockRN.Text, props, props.name as string);

  return { Feather: mockFeather };
});

import React from "react";
import { act, create } from "react-test-renderer";

import { Icon } from "@/src/components/common/Icon";
import { findAllNodes, type MinimalTestInstance } from "@/src/test-utils/react-test-renderer";
import { Colors } from "@/src/lib/design";

function findFeatherProps(renderer: ReturnType<typeof create>): Record<string, unknown> {
  // The Feather mock renders as a Text host with `name` + `size` + `color`
  // passed through. Match the node that has BOTH `name` (string) AND
  // numeric `size` — that's the Feather mock invocation (post-default
  // resolution), NOT the outer Icon component node (which doesn't carry
  // `size` when defaults are applied internally).
  const matches = findAllNodes(
    renderer,
    (n: MinimalTestInstance) =>
      typeof n.props === "object" &&
      n.props !== null &&
      typeof (n.props as { name?: unknown }).name === "string" &&
      typeof (n.props as { size?: unknown }).size === "number"
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0].props as Record<string, unknown>;
}

describe("Story 14-3 — Icon component", () => {
  // Case 1: renders Feather child + forwards `name` verbatim
  it("Case 1: renders Feather with the provided name", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Icon name="mail" />);
    });
    const props = findFeatherProps(renderer!);
    expect(props.name).toBe("mail");
  });

  // Case 2: respects size + color props (overrides defaults)
  it("Case 2: respects custom size + color props", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Icon name="lock" size={32} color="#FF0000" />);
    });
    const props = findFeatherProps(renderer!);
    expect(props.size).toBe(32);
    expect(props.color).toBe("#FF0000");
  });

  // Case 3: defaults size=24, color=Colors.textPrimary
  it("Case 3: defaults size=24 and color=Colors.textPrimary when not provided", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Icon name="user" />);
    });
    const props = findFeatherProps(renderer!);
    expect(props.size).toBe(24);
    expect(props.color).toBe(Colors.textPrimary);
  });

  // Case 4: accessibilityLabel pass-through when provided
  it("Case 4: passes accessibilityLabel through when provided", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Icon name="check" accessibilityLabel="Password requirement met" />);
    });
    const props = findFeatherProps(renderer!);
    expect(props.accessibilityLabel).toBe("Password requirement met");
    // POSITIVE: when accessibilityLabel IS provided, the decorative-default
    // branch is NOT taken — `importantForAccessibility` is undefined.
    expect(props.importantForAccessibility).toBeUndefined();
  });

  // Case 5: defaults to decorative-of-text when accessibilityLabel omitted
  // (Story 14-2 R1-H1 a11y-regression lesson applied)
  it('Case 5: sets importantForAccessibility="no" when accessibilityLabel omitted', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Icon name="headphones" />);
    });
    const props = findFeatherProps(renderer!);
    expect(props.importantForAccessibility).toBe("no");
    // Belt-and-suspenders: no stray accessibilityLabel.
    expect(props.accessibilityLabel).toBeUndefined();
  });
});
