/**
 * Animated waveform equalizer visualization.
 * 7 vertical bars animate independently to simulate audio activity.
 *
 * Note: Most styles in this component remain inline because they are
 * dynamically computed from the `size` prop and animated via Reanimated
 * shared values. className is used where static layout classes apply.
 */

import { useEffect } from "react";
import { View } from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";

import { Colors, skillTint } from "@/src/lib/design";

interface AudioWaveformProps {
  isActive: boolean;
  speaker?: "user" | "ai" | "idle" | "processing";
  size?: number;
  isConnecting?: boolean;
  /** @deprecated Color is now derived from speaker prop. This prop is ignored. */
  color?: string;
}

const BAR_PERIODS_MS = [1100, 900, 750, 620, 750, 900, 1100];
// Fraction of maxBarHeight each bar reaches at its peak
const BAR_PEAK_FRACTIONS = [0.45, 0.65, 0.85, 1.0, 0.85, 0.65, 0.45];

function getBarColor(
  speaker: "user" | "ai" | "idle" | "processing",
  isConnecting: boolean
): string {
  if (isConnecting) return skillTint(Colors.accent, 0.6);
  if (speaker === "user") return Colors.accent;
  if (speaker === "processing") return Colors.accent;
  if (speaker === "ai") return Colors.surfaceWhite;
  return skillTint(Colors.surfaceWhite, 0.22);
}

interface BarProps {
  heightVal: SharedValue<number>;
  barWidth: number;
  maxBarHeight: number;
  color: string;
}

function Bar({ heightVal, barWidth, maxBarHeight, color }: BarProps) {
  const animStyle = useAnimatedStyle(() => ({
    height: heightVal.value,
  }));

  return (
    <View className="items-center justify-end" style={{ width: barWidth, height: maxBarHeight }}>
      <Reanimated.View
        style={[
          {
            width: barWidth,
            borderRadius: barWidth / 2,
            backgroundColor: color,
          },
          animStyle,
        ]}
      />
    </View>
  );
}

export function AudioWaveform({
  isActive,
  speaker = "idle",
  size = 180,
  isConnecting = false,
}: AudioWaveformProps) {
  const barWidth = size / 28;
  const maxBarHeight = size * 0.7;
  const minHeight = size * 0.1;
  const color = getBarColor(speaker, isConnecting);

  // One shared value per bar
  const h0 = useSharedValue(minHeight);
  const h1 = useSharedValue(minHeight);
  const h2 = useSharedValue(minHeight);
  const h3 = useSharedValue(minHeight);
  const h4 = useSharedValue(minHeight);
  const h5 = useSharedValue(minHeight);
  const h6 = useSharedValue(minHeight);

  const barHeights = [h0, h1, h2, h3, h4, h5, h6];

  // Ring pulse scale
  const ringScale = useSharedValue(1);

  useEffect(() => {
    if (isConnecting) {
      // All bars pulse in sync at 35% max height
      const connectingPeak = maxBarHeight * 0.35;
      barHeights.forEach((h) => {
        h.value = withRepeat(
          withSequence(
            withTiming(connectingPeak, {
              duration: 700,
              easing: Easing.inOut(Easing.sin),
            }),
            withTiming(minHeight, {
              duration: 700,
              easing: Easing.inOut(Easing.sin),
            })
          ),
          -1
        );
      });
      ringScale.value = withRepeat(
        withSequence(withTiming(1.05, { duration: 1000 }), withTiming(1.0, { duration: 1000 })),
        -1
      );
      return;
    }

    if (speaker === "processing") {
      // Smooth 300ms transition into processing pulse (AC-B4)
      const processingPeak = maxBarHeight * 0.4;
      barHeights.forEach((h) => {
        h.value = withTiming(processingPeak, { duration: 300 }, (finished) => {
          if (finished) {
            h.value = withRepeat(
              withSequence(
                withTiming(minHeight, {
                  duration: 800,
                  easing: Easing.inOut(Easing.sin),
                }),
                withTiming(processingPeak, {
                  duration: 800,
                  easing: Easing.inOut(Easing.sin),
                })
              ),
              -1
            );
          }
        });
      });
      ringScale.value = withRepeat(
        withSequence(withTiming(1.05, { duration: 1000 }), withTiming(1.0, { duration: 1000 })),
        -1
      );
      return;
    }

    if (isActive) {
      // Each bar loops independently between minHeight and its peak
      barHeights.forEach((h, i) => {
        const peakH = maxBarHeight * BAR_PEAK_FRACTIONS[i];
        const period = BAR_PERIODS_MS[i];
        h.value = withRepeat(
          withSequence(
            withTiming(peakH, {
              duration: period / 2,
              easing: Easing.inOut(Easing.sin),
            }),
            withTiming(minHeight, {
              duration: period / 2,
              easing: Easing.inOut(Easing.sin),
            })
          ),
          -1
        );
      });

      // Rings slowly pulse when active
      ringScale.value = withRepeat(
        withSequence(withTiming(1.05, { duration: 1000 }), withTiming(1.0, { duration: 1000 })),
        -1
      );
    } else {
      // Collapse to min then do slow breathing
      barHeights.forEach((h) => {
        h.value = withTiming(minHeight, { duration: 400 }, (finished) => {
          if (finished) {
            h.value = withRepeat(
              withSequence(
                withTiming(size * 0.15, { duration: 1500 }),
                withTiming(size * 0.1, { duration: 1500 })
              ),
              -1
            );
          }
        });
      });

      ringScale.value = withTiming(1.0, { duration: 400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, isConnecting, speaker]);

  const innerRingAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  const outerRingAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  // Derive ring border colors from bar color with reduced opacity
  const innerBorderColor = isActive
    ? speaker === "user" || speaker === "processing"
      ? skillTint(Colors.accent, 0.25)
      : speaker === "ai"
        ? skillTint(Colors.surfaceWhite, 0.25)
        : skillTint(Colors.surfaceWhite, 0.06)
    : skillTint(Colors.surfaceWhite, 0.06);

  const outerBorderColor = isActive
    ? speaker === "user" || speaker === "processing"
      ? skillTint(Colors.accent, 0.12)
      : speaker === "ai"
        ? Colors.borderOnDark
        : skillTint(Colors.surfaceWhite, 0.03)
    : skillTint(Colors.surfaceWhite, 0.03);

  return (
    <View className="items-center justify-center" style={{ width: size, height: size }}>
      {/* Outer glow ring */}
      <Reanimated.View
        style={[
          {
            position: "absolute",
            width: size * 0.9,
            height: size * 0.9,
            borderRadius: size * 0.45,
            borderWidth: 1,
            borderColor: outerBorderColor,
          },
          outerRingAnimStyle,
        ]}
      />

      {/* Inner glow ring */}
      <Reanimated.View
        style={[
          {
            position: "absolute",
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size * 0.35,
            borderWidth: 1,
            borderColor: innerBorderColor,
          },
          innerRingAnimStyle,
        ]}
      />

      {/* Bars cluster */}
      <View
        className="flex-row items-end"
        style={{
          gap: barWidth * 0.6,
          height: maxBarHeight,
        }}
      >
        {barHeights.map((h, i) => (
          <Bar
            key={i}
            heightVal={h}
            barWidth={barWidth}
            maxBarHeight={maxBarHeight}
            color={color}
          />
        ))}
      </View>
    </View>
  );
}
