import React, { useEffect } from "react";
import { View, Text, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { Colors, Shadows, Typography, skillTint } from "@/src/lib/design";

export interface SkillCardProps {
  emoji: string;
  titleFr: string;
  titleEn: string;
  description: string;
  accentColor: string;
  delay: number;
  onPress: () => void;
}

export const SkillCard = React.memo(function SkillCard({
  emoji,
  titleFr,
  titleEn,
  description,
  accentColor,
  delay,
  onPress,
}: SkillCardProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 380 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 380 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={entryStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${titleFr} - ${titleEn}. ${description}`}
        accessibilityHint={`Double tap to start ${titleEn} practice`}
        className="bg-white rounded-2xl overflow-hidden flex-row items-center p-4 gap-[14px]"
        style={{
          ...Shadows.card,
        }}
      >
        {/* Left accent strip */}
        <View
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: accentColor }}
        />

        {/* Icon circle */}
        <View
          className="w-14 h-14 rounded-[28px] justify-center items-center"
          style={{ backgroundColor: skillTint(accentColor, 0.09) }}
        >
          <Text style={{ fontSize: Typography.statNumber.fontSize }}>{emoji}</Text>
        </View>

        {/* Labels */}
        <View className="flex-1">
          <Text className="text-base font-bold text-primary">{titleFr}</Text>
          <Text className="text-xs mt-[2px]" style={{ color: Colors.textSecondary }}>
            {titleEn}
          </Text>
          <Text className="text-xs mt-1" style={{ color: Colors.textTertiary }}>
            {description}
          </Text>
        </View>

        {/* Arrow circle */}
        <View
          className="w-7 h-7 rounded-[14px] justify-center items-center"
          style={{ backgroundColor: skillTint(accentColor, 0.09) }}
        >
          <Text className="text-sm font-bold" style={{ color: accentColor }}>
            {"\u2192"}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
});
