/**
 * State subtitle that fades + slides beneath the AIOrb. The text crossfades
 * smoothly when the orb's state changes — a small "Listening...", "Speaking...",
 * "Thinking..." cue under the centerpiece that completes the "this AI is
 * present" illusion.
 */

import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Colors, Typography } from "@/src/lib/design";

import { type AIOrbState } from "./AIOrb";

interface AIOrbStatusLabelProps {
  state: AIOrbState;
}

const STATE_LABELS: Record<AIOrbState, string> = {
  idle: "Tap the mic when you're ready",
  connecting: "Connecting...",
  listening: "Listening...",
  processing: "Thinking...",
  "ai-speaking": "Speaking...",
};

export function AIOrbStatusLabel({ state }: AIOrbStatusLabelProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);

  useEffect(() => {
    // Crossfade-in on every state change.
    opacity.value = 0;
    translateY.value = 8;
    opacity.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.Text key={state} style={[styles.label, animStyle]} accessibilityLiveRegion="polite">
      {STATE_LABELS[state]}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  label: {
    ...Typography.caption,
    color: Colors.whiteAlpha65,
    marginTop: 28,
    letterSpacing: 1,
    textAlign: "center",
  },
});
