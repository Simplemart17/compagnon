import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
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
 *  - Story 14-4 token enforcement: all colors `Colors.*`; all radii `Radii.*`
 *    (with documented overlay exemption — see overlay style constants below).
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
   * **R1-P2 contract:** consumer-provided base style is rendered FIRST in the
   * style array. The canonical fingerprint (`Colors.primary` bg,
   * `Radii.heroBottom` corners, `paddingHorizontal: 24`, `Shadows.hero`) plus
   * the prop-controlled `paddingTop` / `paddingBottom` / `centered` toggle
   * are layered ON TOP. This means consumers can ADD properties (margins,
   * borderWidth, etc.) via `style`, but they CANNOT silently override the
   * canonical fingerprint or the documented prop-controlled values — the
   * "single canonical hero" goal of Story 14-9 is structurally enforced.
   *
   * Typed as `StyleProp<ViewStyle>` (R1-P5) so consumers can pass arrays,
   * registered styles, or falsy entries (matches `<View>`'s native surface).
   */
  style?: StyleProp<ViewStyle>;
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

/**
 * @internal — conversation depth-glow overlay (bottom 50%, primaryDark 0.4).
 *
 * design-token-exempt (R1-P6): the 32px bottom-corner radius INTENTIONALLY
 * extends ~4px beyond the hero's `Radii.heroBottom` (28) so the glow's
 * bottom edge peeks below the hero corner — a subtle depth effect. Adding a
 * `Radii.heroOverlayDepth = 32` token for a single consumer would be
 * over-engineering; the literal stays local to this constant.
 *
 * R1-P1: `pointerEvents: "none"` moved off the JSX prop (deprecated in RN
 * 0.74+) into the style field per the canonical RN migration path.
 */
const heroHeaderDepthGlowOverlayStyle: ViewStyle = Object.freeze({
  position: "absolute" as const,
  bottom: 0,
  left: 0,
  right: 0,
  height: "50%",
  backgroundColor: skillTint(Colors.primaryDark, 0.4),
  borderBottomLeftRadius: 32,
  borderBottomRightRadius: 32,
  pointerEvents: "none" as const,
}) as ViewStyle;

/**
 * @internal — profile inner-dim overlay (absolute fill, bgDark 0.35).
 *
 * design-token-exempt (R1-P6): the 40px bottom-corner radius INTENTIONALLY
 * extends ~12px beyond `Radii.heroBottom` for a softer dim edge that bleeds
 * past the hero corner. Same rationale as `heroHeaderDepthGlowOverlayStyle`
 * — single-use literal, no shared token.
 *
 * R1-P1: `pointerEvents: "none"` moved off the JSX prop into the style field.
 */
const heroHeaderInnerDimOverlayStyle: ViewStyle = Object.freeze({
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: skillTint(Colors.bgDark, 0.35),
  borderBottomLeftRadius: 40,
  borderBottomRightRadius: 40,
  pointerEvents: "none" as const,
}) as ViewStyle;

/**
 * @internal — `centered` toggle keeps the prop-driven branch allocation-free.
 *
 * R1-P4: declared ABOVE the component (alongside the 3 other frozen-static
 * constants) for placement consistency. Pre-R1 this lived after the
 * component function and worked by hoisting, but the inconsistent placement
 * was an HMR / module-evaluation footgun.
 */
const heroHeaderCenteredStyle: ViewStyle = Object.freeze({
  alignItems: "center" as const,
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
      // R1-P2: consumer `style` is rendered FIRST so the canonical fingerprint
      // + prop-controlled padding + centered toggle always win over consumer
      // overrides. Consumers can ADD properties (margins, borderWidth) but
      // cannot silently OVERRIDE canonical ones — the unification invariant
      // of Story 14-9 is structurally enforced.
      style={[
        style,
        heroHeaderContainerStaticStyle,
        { paddingTop: computedPaddingTop, paddingBottom },
        centered ? heroHeaderCenteredStyle : null,
      ]}
    >
      {overlay === "depth-glow" && (
        <View
          style={heroHeaderDepthGlowOverlayStyle}
          // Story 14-3 R1-P1 3-prop decorative a11y — overlay must not appear
          // as a focusable element to screen-readers; children carry the
          // actual chrome. `pointerEvents: "none"` lives in the style (R1-P1).
          accessible={false}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
        />
      )}
      {overlay === "inner-dim" && (
        <View
          style={heroHeaderInnerDimOverlayStyle}
          accessible={false}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
        />
      )}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Exported memo wrapper (Story 14-2 / 14-3 / 14-7 / 14-8 precedent)
// ---------------------------------------------------------------------------

export const HeroHeader = React.memo(HeroHeaderImpl);
HeroHeader.displayName = "HeroHeader";

export default HeroHeader;
