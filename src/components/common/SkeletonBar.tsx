/**
 * Reusable skeleton placeholder bar with pulse animation.
 * Used across loading screens (mock test, vocabulary, etc.).
 */

import React from "react";
import type { DimensionValue, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
} from "react-native-reanimated";

import { Colors } from "@/src/lib/design";

interface SkeletonBarProps {
  width: DimensionValue;
  height: number;
  style?: ViewStyle;
  /** When provided, marks this skeleton as a loading indicator for screen readers */
  accessibilityLabel?: string;
}

export function SkeletonBar({ width, height, style, accessibilityLabel }: SkeletonBarProps) {
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 800 }), withTiming(0.3, { duration: 800 })),
      -1,
      false
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width,
          height,
          backgroundColor: Colors.border,
          borderRadius: 8,
        },
        style,
        animStyle,
      ]}
    />
  );
}
