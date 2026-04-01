import React, { useEffect } from "react";
import { Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Colors, Typography } from "@/src/lib/design";

export interface StatTileProps {
  value: string;
  unit: string;
  label: string;
  delay: number;
}

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
      className="flex-1 items-center rounded-2xl bg-white px-2.5 py-3.5"
      accessibilityLabel={`${label}: ${value}${unit.length > 0 ? ` ${unit}` : ""}`}
      style={[
        animStyle,
        {
          shadowColor: Colors.shadow,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 6,
        },
      ]}
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
