import React, { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { Colors, Radii, Typography, skillTint } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ErrorJourneyBarProps {
  /** Total number of error patterns tracked */
  total: number;
  /** Number of resolved error patterns */
  resolved: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays a progress bar showing how many error patterns the learner has
 * resolved. Hidden when there are no error patterns. Shows a completion
 * message when all patterns are resolved.
 */
export const ErrorJourneyBar = React.memo(function ErrorJourneyBar({
  total,
  resolved: rawResolved,
}: ErrorJourneyBarProps) {
  // Clamp resolved to total to handle race conditions between parallel count queries
  const resolved = Math.min(rawResolved, total);
  const ratio = total > 0 ? resolved / total : 0;

  const progress = useSharedValue(ratio);

  useEffect(() => {
    progress.value = withTiming(ratio, { duration: 600 });
  }, [ratio, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  if (total === 0) return null;

  const isComplete = resolved >= total;
  const percentage = Math.round(ratio * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={
        isComplete
          ? "All error patterns resolved"
          : `Error patterns: ${resolved} of ${total} resolved, ${percentage} percent`
      }
      accessibilityValue={{ min: 0, max: total, now: resolved }}
      style={{
        backgroundColor: skillTint(Colors.primary, 0.04),
        borderRadius: Radii.button,
        paddingVertical: 8,
        paddingHorizontal: 10,
      }}
    >
      {/* Label row */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        {isComplete ? (
          <Text
            style={{
              ...Typography.caption,
              fontWeight: "700",
              color: Colors.success,
            }}
          >
            All patterns resolved!
          </Text>
        ) : (
          <>
            <Text
              style={{
                ...Typography.caption,
                fontWeight: "600",
                color: Colors.primary,
              }}
            >
              {resolved}/{total} errors resolved
            </Text>
            <Text
              style={{
                ...Typography.caption,
                fontWeight: "700",
                color: Colors.success,
              }}
            >
              {percentage}%
            </Text>
          </>
        )}
      </View>

      {/* Progress bar */}
      <View
        style={{
          height: 6,
          backgroundColor: skillTint(Colors.primary, 0.08),
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={[
            {
              height: 6,
              backgroundColor: Colors.success,
              borderRadius: 3,
            },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Skeleton placeholder matching ErrorJourneyBar dimensions.
 * Shown while briefing data is loading.
 */
export const ErrorJourneyBarSkeleton = React.memo(function ErrorJourneyBarSkeleton() {
  return (
    <View
      accessibilityLabel="Loading error journey progress"
      style={{
        backgroundColor: skillTint(Colors.primary, 0.04),
        borderRadius: Radii.button,
        paddingVertical: 8,
        paddingHorizontal: 10,
      }}
    >
      {/* Label skeleton */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <SkeletonBar width={140} height={13} />
        <SkeletonBar width={30} height={13} />
      </View>

      {/* Bar skeleton */}
      <SkeletonBar width="100%" height={6} style={{ borderRadius: 3 }} />
    </View>
  );
});
