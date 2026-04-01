import React, { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { Colors, Typography } from "@/src/lib/design";

export interface ActivityBarProps {
  heightPx: number;
  isGoalMet: boolean;
  delay: number;
  dayLabel: string;
}

export const ActivityBar = React.memo(function ActivityBar({
  heightPx,
  isGoalMet,
  delay,
  dayLabel,
}: ActivityBarProps) {
  const animHeight = useSharedValue(0);

  useEffect(() => {
    animHeight.value = withDelay(delay, withTiming(heightPx, { duration: 400 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightPx, delay]);

  const barStyle = useAnimatedStyle(() => ({
    height: animHeight.value,
  }));

  return (
    <View
      className="flex-1 items-center"
      accessibilityLabel={`${dayLabel}: ${isGoalMet ? "daily goal met" : "daily goal not met"}`}
    >
      <View className="w-3/4 h-12 justify-end">
        <Animated.View
          style={[
            {
              backgroundColor: isGoalMet ? Colors.success : Colors.primary,
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
            },
            barStyle,
          ]}
        />
      </View>
      <Text
        style={{ fontSize: Typography.tiny.fontSize, color: Colors.textTertiary, marginTop: 4 }}
      >
        {dayLabel}
      </Text>
    </View>
  );
});
