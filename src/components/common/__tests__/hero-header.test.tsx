/**
 * Story 14-9 runtime smoke test for the new shared `HeroHeader`.
 *
 * Pattern: `react-test-renderer` + `act` (Story 12-1 P8 / 13-4 P2 / 13-5 /
 * 13-7 / 14-2 / 14-3 / 14-7 / 14-8 precedent). Uses the shared test utilities
 * at `src/test-utils/` (Epic 13 retrospective AI #7).
 *
 * Cases:
 *   - Default render: outer container carries the canonical fingerprint
 *     (Colors.primary bg + Radii.heroBottom corners + paddingHorizontal:24 +
 *     Shadows.hero keys).
 *   - paddingTopOffset defaults to 16; override applies; insets.top is added.
 *   - paddingBottom defaults to 24; override to 32 applies.
 *   - centered={true} sets alignItems:"center" on the outer container; default
 *     does NOT set it.
 *   - overlay="depth-glow" renders an overlay with primaryDark tint + 32-radius
 *     + pointerEvents:"none" + Story 14-3 R1-P1 3-prop decorative a11y.
 *   - overlay="inner-dim" renders the bgDark tint variant.
 *   - overlay=undefined renders no overlay node.
 *   - heroHeaderContainerStaticStyle is Object.freeze'd (Story 13-7 R1-P2
 *     mutation defense pin).
 */

/* eslint-disable import/first -- jest.mock must precede the component import */
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

import React from "react";
import { Text, View } from "react-native";
import { act, create } from "react-test-renderer";

import { HeroHeader, heroHeaderContainerStaticStyle } from "@/src/components/common/HeroHeader";
import {
  findAllNodes,
  flattenStyle,
  type MinimalTestInstance,
} from "@/src/test-utils/react-test-renderer";
import { Colors, Radii, Shadows, skillTint } from "@/src/lib/design";

const MOCKED_INSETS_TOP = 47;

// Find the outermost <View> that carries the canonical container static style
// (filtered by backgroundColor === Colors.primary + the canonical radius).
function findContainerView(renderer: ReturnType<typeof create>): MinimalTestInstance {
  const matches = findAllNodes(renderer, (n: MinimalTestInstance) => {
    if (n.type !== View) return false;
    const merged = flattenStyle(n.props.style);
    return (
      merged.backgroundColor === Colors.primary &&
      merged.borderBottomLeftRadius === Radii.heroBottom
    );
  });
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

describe("Story 14-9 — HeroHeader", () => {
  describe("Canonical container fingerprint", () => {
    it("Case 1: applies Colors.primary bg + Radii.heroBottom corners + paddingHorizontal:24 + Shadows.hero", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      expect(style.backgroundColor).toBe(Colors.primary);
      expect(style.borderBottomLeftRadius).toBe(Radii.heroBottom);
      expect(style.borderBottomRightRadius).toBe(Radii.heroBottom);
      expect(style.paddingHorizontal).toBe(24);
      // Shadows.hero keys present
      expect(style.shadowColor).toBe(Shadows.hero.shadowColor);
      expect(style.shadowOpacity).toBe(Shadows.hero.shadowOpacity);
      expect(style.elevation).toBe(Shadows.hero.elevation);
    });
  });

  describe("paddingTopOffset prop", () => {
    it("Case 2a: defaults to 16 when omitted (paddingTop = insets.top + 16)", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      expect(style.paddingTop).toBe(MOCKED_INSETS_TOP + 16);
    });

    it("Case 2b: override (e.g., 20 for mock-test) applies (paddingTop = insets.top + override)", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader paddingTopOffset={20}>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      expect(style.paddingTop).toBe(MOCKED_INSETS_TOP + 20);
    });
  });

  describe("paddingBottom prop", () => {
    it("Case 3a: defaults to 24 when omitted", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      expect(style.paddingBottom).toBe(24);
    });

    it("Case 3b: override to 32 applies (e.g., for mock-test + profile)", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader paddingBottom={32}>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      expect(style.paddingBottom).toBe(32);
    });
  });

  describe("centered prop", () => {
    it("Case 4a: centered={true} sets alignItems:center on the container", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader centered>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      expect(style.alignItems).toBe("center");
    });

    it("Case 4b: default centered={false} does NOT set alignItems", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const container = findContainerView(renderer);
      const style = flattenStyle(container.props.style);
      // alignItems comes from the centered style branch ONLY (not from the
      // canonical static style); when centered=false the prop is omitted.
      expect(style.alignItems).toBeUndefined();
    });
  });

  describe("overlay prop", () => {
    it('Case 5a: overlay="depth-glow" renders primaryDark overlay with 3-prop decorative a11y', () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader overlay="depth-glow">
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const expectedColor = skillTint(Colors.primaryDark, 0.4);
      const matches = findAllNodes(renderer, (n: MinimalTestInstance) => {
        if (n.type !== View) return false;
        const merged = flattenStyle(n.props.style);
        return merged.backgroundColor === expectedColor;
      });
      expect(matches.length).toBe(1);
      const overlay = matches[0];
      const overlayStyle = flattenStyle(overlay.props.style);
      expect(overlayStyle.position).toBe("absolute");
      expect(overlayStyle.bottom).toBe(0);
      expect(overlayStyle.height).toBe("50%");
      expect(overlayStyle.borderBottomLeftRadius).toBe(32);
      expect(overlayStyle.borderBottomRightRadius).toBe(32);
      // Story 14-3 R1-P1 3-prop decorative a11y
      expect(overlay.props.accessible).toBe(false);
      expect(overlay.props.accessibilityElementsHidden).toBe(true);
      expect(overlay.props.importantForAccessibility).toBe("no-hide-descendants");
      // R1-P1: `pointerEvents: "none"` lives in the style (was a JSX prop pre-R1).
      expect(overlayStyle.pointerEvents).toBe("none");
    });

    it('Case 5b: overlay="inner-dim" renders bgDark absolute-fill overlay with 3-prop decorative a11y', () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader overlay="inner-dim">
            <Text>content</Text>
          </HeroHeader>
        );
      });
      const expectedColor = skillTint(Colors.bgDark, 0.35);
      const matches = findAllNodes(renderer, (n: MinimalTestInstance) => {
        if (n.type !== View) return false;
        const merged = flattenStyle(n.props.style);
        return merged.backgroundColor === expectedColor;
      });
      expect(matches.length).toBe(1);
      const overlay = matches[0];
      const overlayStyle = flattenStyle(overlay.props.style);
      expect(overlayStyle.position).toBe("absolute");
      expect(overlayStyle.top).toBe(0);
      expect(overlayStyle.bottom).toBe(0);
      expect(overlayStyle.left).toBe(0);
      expect(overlayStyle.right).toBe(0);
      expect(overlayStyle.borderBottomLeftRadius).toBe(40);
      expect(overlayStyle.borderBottomRightRadius).toBe(40);
      // Story 14-3 R1-P1 3-prop decorative a11y
      expect(overlay.props.accessible).toBe(false);
      expect(overlay.props.accessibilityElementsHidden).toBe(true);
      expect(overlay.props.importantForAccessibility).toBe("no-hide-descendants");
      // R1-P1: `pointerEvents: "none"` lives in the style (was a JSX prop pre-R1).
      expect(overlayStyle.pointerEvents).toBe("none");
    });

    it("Case 5c: overlay=undefined renders no overlay node", () => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader>
            <Text>content</Text>
          </HeroHeader>
        );
      });
      // The container has Colors.primary bg; an overlay node would carry a
      // skillTint(primaryDark/bgDark) bg. Confirm no node with either tint exists.
      const depthGlowColor = skillTint(Colors.primaryDark, 0.4);
      const innerDimColor = skillTint(Colors.bgDark, 0.35);
      const overlayMatches = findAllNodes(renderer, (n: MinimalTestInstance) => {
        if (n.type !== View) return false;
        const merged = flattenStyle(n.props.style);
        return (
          merged.backgroundColor === depthGlowColor || merged.backgroundColor === innerDimColor
        );
      });
      expect(overlayMatches.length).toBe(0);
    });

    it("Case 5d: overlay node is rendered BEFORE children (RN z-order = JSX order; children visually ON TOP of overlay) — R1-P3", () => {
      // Sentinel child via testID so we can find it by props.testID rather
      // than fragile string matching on <Text> contents.
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <HeroHeader overlay="depth-glow">
            <View testID="hero-sentinel-child">
              <Text>sentinel</Text>
            </View>
          </HeroHeader>
        );
      });

      // Use renderer.toJSON() to walk the host-component tree directly. The
      // root is the outer <View> container; its `children` array preserves
      // JSX order. Overlay (depth-glow tint) MUST appear before the sentinel
      // child so RN paints children ON TOP.
      type JsonNode = { type: string; props: Record<string, unknown>; children: JsonNode[] | null };
      const root = renderer.toJSON() as JsonNode | JsonNode[] | null;
      expect(root).not.toBeNull();
      const container = (Array.isArray(root) ? root[0] : root) as JsonNode;
      expect(container).not.toBeNull();
      const directChildren = (container.children ?? []) as JsonNode[];
      expect(directChildren.length).toBeGreaterThan(0);

      const overlayColor = skillTint(Colors.primaryDark, 0.4);
      const overlayIdx = directChildren.findIndex((child) => {
        if (!child || typeof child !== "object") return false;
        const merged = flattenStyle(child.props?.style);
        return merged.backgroundColor === overlayColor;
      });
      const sentinelIdx = directChildren.findIndex((child) => {
        if (!child || typeof child !== "object") return false;
        return child.props?.testID === "hero-sentinel-child";
      });

      expect(overlayIdx).toBeGreaterThanOrEqual(0);
      expect(sentinelIdx).toBeGreaterThanOrEqual(0);
      // The load-bearing invariant: overlay MUST appear before children in the
      // render tree. A future refactor that moves `{children}` above the overlay
      // would visually hide content behind the dim/glow and silently pass every
      // other test in this file.
      expect(overlayIdx).toBeLessThan(sentinelIdx);
    });
  });

  describe("Frozen-static-style invariant", () => {
    it("Case 6: heroHeaderContainerStaticStyle is Object.frozen (Story 13-7 R1-P2 mutation defense)", () => {
      expect(Object.isFrozen(heroHeaderContainerStaticStyle)).toBe(true);
      // Mutation attempt should silently fail in non-strict mode (or throw in strict).
      try {
        (heroHeaderContainerStaticStyle as { paddingHorizontal: number }).paddingHorizontal = 999;
      } catch {
        // strict-mode throws — expected
      }
      // Either way, the value is unchanged.
      expect(heroHeaderContainerStaticStyle.paddingHorizontal).toBe(24);
    });
  });
});
