import React from "react";
import { View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Radii, Shadows, skillTint } from "@/src/lib/design";

/**
 * Story 14-9 — canonical hero header used by all 5 top-level tabs
 * (home, conversation, practice, mock-test, profile).
 *
 * Replaces 7 bespoke hero surfaces (2 in home + 1 conversation + 1 practice
 * + 1 mock-test + 2 in profile) that varied on 4 axes (paddingTop offset,
 * paddingBottom, Shadows.hero applied?, items-center?). Closes the heroes
 * portion of audit P2-10 (cards portion closed by Story 14-2).
 *
 * **Canonical fingerprint** applied to all surfaces by construction:
 *  - `Colors.primary` background
 *  - `Radii.heroBottom` (28) on bottom-left + bottom-right corners
 *  - `Shadows.hero` (this was the consistency bug — only 3 of 7 surfaces
 *    applied it pre-14-9; post-14-9 all 7 carry it)
 *  - `paddingHorizontal: 24` (matched `px-6` across all pre-14-9 surfaces)
 *
 * **Per-screen variation** is expressed via 3 props (`paddingTopOffset`,
 * `paddingBottom`, `centered`) + an `overlay` discriminated union
 * (`"depth-glow" | "inner-dim" | undefined`).
 *
 * **Cross-story invariants:**
 *  - Story 13-7 R1-P1 frozen-static-style + Shadows-spread-FIRST pattern.
 *  - Story 14-3 R1-P1 3-prop decorative a11y on overlays.
 *  - Story 14-4 token enforcement: all colors `Colors.*`; all radii `Radii.*`.
 *  - Story 14-1 chrome rule: HeroHeader renders no text — content is fully
 *    delegated to `children`.
 *
 * @see _bmad-output/implementation-artifacts/14-9-hero-pattern-unification.md
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HeroHeaderProps {
  /** Caller-provided hero content (greeting, brand label, action buttons, etc). */
  children: React.ReactNode;
  /**
   * Added to `useSafeAreaInsets().top` to compute total paddingTop.
   * Defaults to 16 (home / conversation / practice majority).
   * Mock-test passes 20; profile passes 12.
   */
  paddingTopOffset?: number;
  /**
   * Inner content paddingBottom. Defaults to 24 (`pb-6` — home / conversation).
   * Practice passes 28 (`pb-7`); mock-test + profile pass 32 (`pb-8`).
   */
  paddingBottom?: number;
  /**
   * If `true`, sets `alignItems: "center"` on the inner content container.
   * Defaults to `false` (3 of 5 screens left-align — the majority pattern).
   */
  centered?: boolean;
  /**
   * Optional inner overlay rendered absolutely-positioned BEHIND children.
   *  - `"depth-glow"` reproduces conversation's bottom-50% `primaryDark` glow.
   *  - `"inner-dim"` reproduces profile-live's absolute-fill `bgDark` dim.
   * Default `undefined` renders no overlay.
   */
  overlay?: "depth-glow" | "inner-dim";
  /**
   * Escape hatch for one-off per-screen tweaks. Passed through to the outer
   * `<View>` style array. **Use sparingly** — every consumer should be
   * addressable by the documented props.
   */
  style?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Frozen static styles (Story 13-7 R1-P1 + R1-P2 pattern)
// ---------------------------------------------------------------------------

/**
 * @internal — exported for runtime test pinning. Spread `Shadows.hero` FIRST
 * so explicit properties always win over future token additions (Story 14-2
 * R1-P1 pattern; Story 13-7 R1-P1 frozen + Shadows-spread-first).
 *
 * Canonical fingerprint: this is THE hero base style; every per-screen
 * variation rides on top of `paddingTop` / `paddingBottom` / `alignItems` at
 * render time.
 */
export const heroHeaderContainerStaticStyle: ViewStyle = Object.freeze({
  ...Shadows.hero,
  backgroundColor: Colors.primary,
  borderBottomLeftRadius: Radii.heroBottom,
  borderBottomRightRadius: Radii.heroBottom,
  paddingHorizontal: 24,
}) as ViewStyle;

/** @internal — conversation depth-glow overlay (bottom 50%, primaryDark 0.4). */
const heroHeaderDepthGlowOverlayStyle: ViewStyle = Object.freeze({
  position: "absolute" as const,
  bottom: 0,
  left: 0,
  right: 0,
  height: "50%",
  backgroundColor: skillTint(Colors.primaryDark, 0.4),
  borderBottomLeftRadius: 32,
  borderBottomRightRadius: 32,
}) as ViewStyle;

/** @internal — profile inner-dim overlay (absolute fill, bgDark 0.35). */
const heroHeaderInnerDimOverlayStyle: ViewStyle = Object.freeze({
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: skillTint(Colors.bgDark, 0.35),
  borderBottomLeftRadius: 40,
  borderBottomRightRadius: 40,
}) as ViewStyle;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function HeroHeaderImpl({
  children,
  paddingTopOffset = 16,
  paddingBottom = 24,
  centered = false,
  overlay,
  style,
}: HeroHeaderProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const computedPaddingTop = insets.top + paddingTopOffset;

  return (
    <View
      style={[
        heroHeaderContainerStaticStyle,
        { paddingTop: computedPaddingTop, paddingBottom },
        centered ? heroHeaderCenteredStyle : null,
        style,
      ]}
    >
      {overlay === "depth-glow" && (
        <View
          style={heroHeaderDepthGlowOverlayStyle}
          // Story 14-3 R1-P1 3-prop decorative a11y — overlay must not appear
          // as a focusable element to screen-readers; children carry the
          // actual chrome.
          accessible={false}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        />
      )}
      {overlay === "inner-dim" && (
        <View
          style={heroHeaderInnerDimOverlayStyle}
          accessible={false}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        />
      )}
      {children}
    </View>
  );
}

/** @internal — `centered` toggle keeps the prop-driven branch allocation-free. */
const heroHeaderCenteredStyle: ViewStyle = Object.freeze({
  alignItems: "center" as const,
}) as ViewStyle;

// ---------------------------------------------------------------------------
// Exported memo wrapper (Story 14-2 / 14-3 / 14-7 / 14-8 precedent)
// ---------------------------------------------------------------------------

export const HeroHeader = React.memo(HeroHeaderImpl);
HeroHeader.displayName = "HeroHeader";

export default HeroHeader;
