import React, { useEffect } from "react";
import { View, Text, Pressable, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { Colors, Radii, Shadows, Typography, skillTint } from "@/src/lib/design";

// Story 13-7: hoisted off the inner `<Pressable>` to remove the per-frame
// `className`+`style` merge cost. The outer `<Animated.View style={entryStyle}>`
// is already canonical (single `style` prop). The Pressable rerenders in JS on
// press-state change AND its parent transforms via worklet on every press cycle
// of `scale.value`; converting to a single `style` constant collapses the
// pre-13-7 merge cost AND amortizes static-style allocation across all 5
// SkillCard instances rendered on the home screen. Tailwind→inline mapping:
// bg-white → Colors.surfaceWhite; rounded-2xl → Radii.card (16); overflow-
// hidden → overflow "hidden"; flex-row → flexDirection "row"; items-center →
// alignItems "center"; p-4 → padding 16; gap-[14px] → 14. Shadow uses the
// Shadows.card design token (Story 14-4 token-enforcement precedent).
/**
 * @internal — exported for Story 13-7 runtime tests; do NOT import in app code.
 *
 * Review-round-1 P1: spread `Shadows.card` FIRST so explicit `padding`/`gap`/
 * `backgroundColor`/`borderRadius` etc. always win over future token-additions
 * to `Shadows.card`. Pre-patch the spread was LAST and a token-internal regression
 * (e.g., `Shadows.card` adding a `padding` key) would have silently clobbered
 * the explicit settings. Frozen for runtime mutation defense (P2).
 */
export const skillCardPressableStaticStyle: ViewStyle = Object.freeze({
  ...Shadows.card,
  backgroundColor: Colors.surfaceWhite,
  borderRadius: Radii.card,
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
  padding: 16,
  gap: 14,
}) as ViewStyle;

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
        style={skillCardPressableStaticStyle}
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
