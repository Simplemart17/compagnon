import React, { useEffect } from "react";
import { Text, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Colors, Radii, Typography } from "@/src/lib/design";

export interface StatTileProps {
  value: string;
  unit: string;
  label: string;
  delay: number;
}

// Story 13-7: hoisted off the `<Animated.View>` to remove the per-frame
// `className`+`style` merge cost while the entry-fade worklet writes
// `opacity` + `translateY` from the Reanimated UI thread for ~400ms on every
// home-screen mount (3 tiles in parallel via the StatNumbers row). Tailwind→
// inline mapping: flex-1 → flex 1; items-center → alignItems "center";
// rounded-2xl → Radii.card (16); bg-white → Colors.surfaceWhite; px-2.5 →
// paddingHorizontal 10; py-3.5 → paddingVertical 14. Shadow tuple preserved
// verbatim from pre-13-7 (does NOT match Shadows.card — uses Colors.shadow
// with a heavier elevation than the card default).
/**
 * @internal — exported for Story 13-7 runtime tests; do NOT import in app code.
 *
 * Frozen at module-load (review-round-1 P2) — same defense as
 * `conversationCardStaticStyle` in `app/(tabs)/home/index.tsx`.
 */
export const statTileStaticStyle: ViewStyle = Object.freeze({
  flex: 1,
  alignItems: "center",
  borderRadius: Radii.card,
  backgroundColor: Colors.surfaceWhite,
  paddingHorizontal: 10,
  paddingVertical: 14,
  shadowColor: Colors.shadow,
  shadowOffset: { width: 0, height: 3 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
  shadowOpacity: 0.1, // eslint-disable-line no-restricted-syntax -- design-token-exempt: StatTile bespoke shadow tone preserved verbatim by Story 13-7
  shadowRadius: 8, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with StatTile bespoke shadow above
  elevation: 6,
}) as ViewStyle;

export const StatTile = React.memo(function StatTile({ value, unit, label, delay }: StatTileProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) })
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) })
    );
  }, [delay, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      accessibilityLabel={`${label}: ${value}${unit.length > 0 ? ` ${unit}` : ""}`}
      style={[statTileStaticStyle, animStyle]}
    >
      <Text className="text-2xl font-extrabold text-primary">{value}</Text>
      {unit.length > 0 ? (
        <Text
          style={{ marginTop: 1, fontSize: Typography.tiny.fontSize, color: Colors.textTertiary }}
        >
          {unit}
        </Text>
      ) : null}
      <Text className="mt-0.5 text-xs" style={{ color: Colors.gray700 }}>
        {label}
      </Text>
    </Animated.View>
  );
});
