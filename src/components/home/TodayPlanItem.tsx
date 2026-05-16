import React, { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from "react-native-reanimated";

import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { Colors, Radii, Typography, skillTint } from "@/src/lib/design";
import { hapticLight } from "@/src/lib/haptics";
import { captureError } from "@/src/lib/sentry";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TodayPlanItemProps {
  /** Activity title (e.g., "Review 12 words") */
  title: string;
  /** Activity subtitle (e.g., "Vocabulary SRS review") */
  subtitle: string;
  /** Icon color for tinted backgrounds */
  iconColor: string;
  /** Emoji icon for the activity */
  iconEmoji: string;
  /** Badge type determining color and label */
  badge: "due" | "suggested" | "error";
  /** Callback when the item is pressed */
  onPress: () => void;
  /** Whether the item is disabled (e.g., offline) */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Badge config
// ---------------------------------------------------------------------------

const BADGE_CONFIG = {
  due: { label: "Due", color: Colors.accent, bg: skillTint(Colors.accent, 0.12) },
  suggested: { label: "Suggested", color: Colors.accent, bg: skillTint(Colors.accent, 0.12) },
  error: { label: "Fix", color: Colors.error, bg: skillTint(Colors.error, 0.12) },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A single recommended activity item in the Today's Plan section.
 * Displays an emoji icon, title, subtitle, and badge with press animation.
 */
export const TodayPlanItem = React.memo(function TodayPlanItem({
  title,
  subtitle,
  iconColor,
  iconEmoji,
  badge,
  onPress,
  disabled = false,
}: TodayPlanItemProps) {
  const scale = useSharedValue(1);
  const pressOpacity = useSharedValue(1);
  const navigatingRef = useRef(false);

  const animatedStyle = useAnimatedStyle(() => {
    const baseOpacity = disabled ? 0.5 : 1;
    return {
      transform: [{ scale: scale.value }],
      opacity: interpolate(pressOpacity.value, [0, 1], [0, baseOpacity]),
    };
  });

  const handlePressIn = () => {
    scale.value = withTiming(0.97, { duration: 100 });
    pressOpacity.value = withTiming(0.8, { duration: 100 });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, { duration: 150 });
    pressOpacity.value = withTiming(1, { duration: 150 });
  };

  const handlePress = () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    hapticLight();
    try {
      onPress();
    } catch (err) {
      captureError(err, "today-plan-item-press");
    }
    setTimeout(() => {
      navigatingRef.current = false;
    }, 500);
  };

  const badgeCfg = BADGE_CONFIG[badge];

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}. Status: ${badgeCfg.label}`}
      accessibilityHint="Double tap to start this activity"
      accessibilityState={{ disabled }}
    >
      <Animated.View
        style={[
          {
            backgroundColor: skillTint(iconColor, 0.06),
            borderRadius: Radii.button,
            paddingVertical: 10,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
          },
          animatedStyle,
        ]}
      >
        {/* Icon container */}
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: Radii.chip,
            backgroundColor: skillTint(iconColor, 0.12),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 14 }}>{iconEmoji}</Text>
        </View>

        {/* Text content */}
        <View className="flex-1" style={{ gap: 2 }}>
          <Text style={{ ...Typography.label, color: iconColor }}>{title}</Text>
          <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>{subtitle}</Text>
        </View>

        {/* Badge pill */}
        <View
          style={{
            backgroundColor: badgeCfg.bg,
            borderRadius: Radii.full,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          <Text
            style={{
              ...Typography.tiny,
              fontWeight: "700",
              color: badgeCfg.color,
            }}
          >
            {badgeCfg.label}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Skeleton placeholder for the Today's Plan section.
 * Shows 2 placeholder items while briefing data loads.
 */
export const TodayPlanSkeleton = React.memo(function TodayPlanSkeleton() {
  return (
    <View accessibilityLabel="Loading today's plan" style={{ gap: 8 }}>
      {[0, 1].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: skillTint(Colors.primary, 0.04),
            borderRadius: Radii.button,
            paddingVertical: 10,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
          }}
        >
          {/* Icon skeleton */}
          <SkeletonBar width={28} height={28} style={{ borderRadius: Radii.chip }} />

          {/* Text skeleton */}
          <View className="flex-1" style={{ gap: 6 }}>
            <SkeletonBar width={120} height={11} />
            <SkeletonBar width={180} height={13} />
          </View>

          {/* Badge skeleton */}
          <SkeletonBar width={40} height={18} style={{ borderRadius: Radii.full }} />
        </View>
      ))}
    </View>
  );
});
