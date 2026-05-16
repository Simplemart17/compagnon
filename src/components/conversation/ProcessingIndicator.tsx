import React, { useEffect } from "react";
import { View, Text } from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import { Colors, Typography } from "@/src/lib/design";

export interface ProcessingIndicatorProps {
  isVisible: boolean;
  label?: string;
}

function Dot({ index }: { index: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withDelay(index * 200, withRepeat(withTiming(1, { duration: 300 }), -1, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Reanimated.View
      style={[
        {
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: Colors.progress, // Story 14-5: non-interactive processing feedback
        },
        animStyle,
      ]}
    />
  );
}

export const ProcessingIndicator = React.memo(function ProcessingIndicator({
  isVisible,
  label,
}: ProcessingIndicatorProps) {
  const displayLabel = label ?? "Listening...";

  if (!isVisible) return null;

  return (
    <Reanimated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      className="items-center py-2"
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Processing: ${displayLabel}`}
    >
      <View className="flex-row items-center" style={{ gap: 4 }}>
        <Dot index={0} />
        <Dot index={1} />
        <Dot index={2} />
      </View>
      <Text
        style={[
          Typography.caption,
          {
            color: "rgba(255,255,255,0.5)",
            fontWeight: "500",
            marginTop: 6,
          },
        ]}
      >
        {displayLabel}
      </Text>
    </Reanimated.View>
  );
});
