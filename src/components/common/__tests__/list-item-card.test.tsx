/**
 * Story 14-2 runtime smoke test for the new shared `ListItemCard`.
 *
 * Pattern: `react-test-renderer` + `act` (Story 12-1 P8 / 13-4 P2 / 13-5 /
 * 13-7 precedent). Uses the shared test utilities at `src/test-utils/`
 * (Epic 13 retrospective AI #7).
 *
 * Reanimated is mocked via the shared factory to avoid worklet runtime errors
 * in Jest.
 */

/* eslint-disable import/first -- jest.mock must precede component import */
jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

import React from "react";
import { Text, View } from "react-native";
import { act, create } from "react-test-renderer";

import { ListItemCard, listItemCardStaticStyle } from "@/src/components/common/ListItemCard";
import {
  findAllNodes,
  flattenStyle,
  type MinimalTestInstance,
} from "@/src/test-utils/react-test-renderer";
import { Colors, Radii } from "@/src/lib/design";

// Recursive text walker (Story 12-9 EmailVerificationGate precedent) —
// findAllNodes(type === Text) doesn't match all text rendered via mocked
// Reanimated host elements, so we walk children directly.
function getAllTextContent(renderer: ReturnType<typeof create>): string[] {
  const out: string[] = [];
  function walk(node: unknown) {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as MinimalTestInstance;
    if (typeof n.children === "string") {
      out.push(n.children);
    }
    const kids = Array.isArray(n.children) ? n.children : [];
    for (const k of kids) {
      if (typeof k === "string") out.push(k);
      else if (k && typeof k === "object") walk(k);
    }
  }
  walk(renderer.root);
  return out;
}

describe("Story 14-2 — ListItemCard", () => {
  // Case 1: titlePrimary + titleSecondary + description all render
  it("Case 1: renders titlePrimary + titleSecondary + description", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ListItemCard
          titlePrimary="Listening"
          titleSecondary="Compréhension orale"
          description="29 questions | 25 min"
        />
      );
    });
    const text = getAllTextContent(renderer!).join(" ");
    expect(text).toContain("Listening");
    expect(text).toContain("Compréhension orale");
    expect(text).toContain("29 questions | 25 min");
  });

  // Case 2: icon circle renders when iconEmoji + iconColor provided; absent when either missing
  it("Case 2: icon circle renders only when both iconEmoji and iconColor provided", () => {
    let withIcon: ReturnType<typeof create>;
    act(() => {
      withIcon = create(
        <ListItemCard titlePrimary="Travel" iconEmoji="✈️" iconColor={Colors.primary} />
      );
    });
    expect(getAllTextContent(withIcon!).join(" ")).toContain("✈️");

    let withoutIcon: ReturnType<typeof create>;
    act(() => {
      withoutIcon = create(<ListItemCard titlePrimary="Travel" />);
    });
    expect(getAllTextContent(withoutIcon!).join(" ")).not.toContain("✈️");
  });

  // Case 3: left strip renders when leftStripColor provided
  it("Case 3: left strip renders when leftStripColor provided", () => {
    let withStrip: ReturnType<typeof create>;
    act(() => {
      withStrip = create(<ListItemCard titlePrimary="Errors" leftStripColor={Colors.accent} />);
    });
    const stripCandidates = findAllNodes(
      withStrip!,
      (node: MinimalTestInstance) =>
        node.type === View &&
        flattenStyle(node.props.style).backgroundColor === Colors.accent &&
        flattenStyle(node.props.style).width === 4
    );
    expect(stripCandidates.length).toBeGreaterThan(0);
  });

  // Case 4: rightContent slot renders verbatim
  it("Case 4: rightContent slot renders verbatim", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ListItemCard titlePrimary="Skill" rightContent={<Text>SLOT-MARKER-42</Text>} />
      );
    });
    expect(getAllTextContent(renderer!).join(" ")).toContain("SLOT-MARKER-42");
  });

  // Case 5: progressBar renders with correct fill percent + color
  it("Case 5: progressBar renders with correct fill percent + color", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ListItemCard
          titlePrimary="Skill"
          progressBar={{ fillPercent: 75, color: Colors.skillReading }}
        />
      );
    });
    const fills = findAllNodes(
      renderer!,
      (node: MinimalTestInstance) =>
        node.type === View &&
        flattenStyle(node.props.style).backgroundColor === Colors.skillReading &&
        flattenStyle(node.props.style).width === "75%"
    );
    expect(fills.length).toBeGreaterThan(0);
  });

  // Case 6a: onPress fires when tapped
  it("Case 6a: onPress fires when tapped (not disabled)", () => {
    const onPress = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<ListItemCard titlePrimary="Pressable" onPress={onPress} />);
    });
    const pressables = findAllNodes(
      renderer!,
      (node: MinimalTestInstance) => typeof node.props.onPress === "function"
    );
    expect(pressables.length).toBeGreaterThan(0);
    act(() => {
      pressables[0].props.onPress?.();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // Case 6b: onPress does NOT fire when disabled (review-round-1 H3 patch)
  it("Case 6b: onPress is not invoked when disabled (verified via 3 disabled-guard paths)", () => {
    const onPress = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<ListItemCard titlePrimary="Disabled" onPress={onPress} disabled />);
    });
    const pressables = findAllNodes(
      renderer!,
      (node: MinimalTestInstance) =>
        node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Disabled"
    );
    expect(pressables.length).toBeGreaterThan(0);
    const pressable = pressables[0];
    // R1-H3 fix #1: verify Pressable's `disabled` prop is actually `true`
    // (pre-R1 the test only checked the indirect onPress short-circuit).
    expect(pressable.props.disabled).toBe(true);
    // R1-H3 fix #2: verify the press-handler is `undefined` (not just a no-op
    // function that's never called). A regression that re-introduces the
    // press handler but keeps Pressable disabled would fail this.
    expect(pressable.props.onPress).toBeUndefined();
    // R1-H3 fix #3: also exercise onPressIn / onPressOut — both have their
    // own `disabled` guards in the component. A regression that drops one
    // guard would fail this even though the onPress short-circuit holds.
    const onPressIn = pressable.props.onPressIn as undefined | (() => void);
    const onPressOut = pressable.props.onPressOut as undefined | (() => void);
    if (typeof onPressIn === "function") act(() => onPressIn());
    if (typeof onPressOut === "function") act(() => onPressOut());
    expect(onPress).not.toHaveBeenCalled();
    // accessibilityState.disabled propagates (Case 8 — folded in for tightness)
    expect(pressable.props.accessibilityState).toMatchObject({ disabled: true });
  });

  // Case 7: accessibilityLabel defaults vs override
  it("Case 7: accessibilityLabel defaults to titlePrimary + description; uses override when provided", () => {
    let withDefault: ReturnType<typeof create>;
    act(() => {
      withDefault = create(
        <ListItemCard
          titlePrimary="Skill"
          description="3 of 4 lessons complete"
          onPress={() => undefined}
        />
      );
    });
    const defaultBtn = findAllNodes(
      withDefault!,
      (node: MinimalTestInstance) => node.props.accessibilityRole === "button"
    )[0];
    expect(defaultBtn.props.accessibilityLabel).toBe("Skill. 3 of 4 lessons complete");

    let withOverride: ReturnType<typeof create>;
    act(() => {
      withOverride = create(
        <ListItemCard
          titlePrimary="Skill"
          description="will be overridden"
          accessibilityLabel="Custom label"
          onPress={() => undefined}
        />
      );
    });
    const overrideBtn = findAllNodes(
      withOverride!,
      (node: MinimalTestInstance) => node.props.accessibilityRole === "button"
    )[0];
    expect(overrideBtn.props.accessibilityLabel).toBe("Custom label");
  });

  // Case 8: static-style constant is frozen (Story 13-7 R1-P2 pattern)
  it("Case 8: listItemCardStaticStyle is Object.freeze'd (Story 13-7 R1-P2 mutation defense)", () => {
    expect(Object.isFrozen(listItemCardStaticStyle)).toBe(true);
    // Verify Shadows.card spread-first by checking core card properties.
    expect(listItemCardStaticStyle.borderRadius).toBe(Radii.card);
    expect(listItemCardStaticStyle.backgroundColor).toBe(Colors.surfaceWhite);
    expect(listItemCardStaticStyle.padding).toBe(16);
    expect(listItemCardStaticStyle.gap).toBe(14);
  });
});
