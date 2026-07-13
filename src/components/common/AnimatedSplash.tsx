/**
 * Animated splash screen — bridges the native `expo-splash-screen` (which
 * shows a static frame while the JS bundle loads) and the first real
 * screen of the app. While the parent layout waits for auth + cache
 * resolution to settle, this component:
 *
 *   1. Mounts on top of the app with a navy backdrop matching the
 *      static splash exactly — there is no visible "flash" between the
 *      native splash hiding and our component appearing.
 *   2. Plays a polished fade-in + scale-up animation on the glyph + a
 *      delayed slide-up on the "Companion" wordmark.
 *   3. After a minimum visible time (so the animation completes even on
 *      fast boots), fades itself out and calls `onDismiss()` so the
 *      parent can render the real route.
 *
 * Design tokens (Colors, Radii) match the system splash navy + the
 * generated splash-icon.png, so the static→animated handoff is seamless.
 */

import { useCallback, useEffect, useMemo } from "react";
import { Image, StyleSheet } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";

import { Colors, Typography } from "@/src/lib/design";

interface AnimatedSplashProps {
  /**
   * Called when the dismiss animation has finished — parent should unmount
   * this component immediately (a stale render of a fully-faded splash
   * blocks touches on the route below).
   */
  onDismiss: () => void;
  /**
   * Minimum on-screen time in ms so the entry animation always completes
   * cleanly even on instant cold-starts. Defaults to 1400ms (entry 600 +
   * settle 800).
   */
  minVisibleMs?: number;
}

/**
 * Glyph PNG — same asset as the native splash, so the static frame and
 * the animated frame are pixel-aligned at mount time.
 */
const GLYPH = require("../../../assets/images/splash-icon.png") as number;

export function AnimatedSplash({
  onDismiss,
  minVisibleMs = 1400,
}: AnimatedSplashProps): React.ReactElement {
  // Containing view — fades out the entire screen on dismiss.
  const containerOpacity = useSharedValue(1);

  // Glyph — scales up from 88% to 100% while fading in.
  const glyphOpacity = useSharedValue(0);
  const glyphScale = useSharedValue(0.88);

  // Wordmark — slides up + fades in, delayed so the glyph lands first.
  const wordOpacity = useSharedValue(0);
  const wordTranslateY = useSharedValue(12);

  const dismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    // Hide the native splash exactly when our React tree paints — this
    // makes the handoff frame-perfect because both screens share the
    // same navy background + centered glyph (the static splash IS our
    // splash-icon.png composited over navy by app.json). Without this,
    // a brief white flash can appear when the native splash hides
    // BEFORE our component finishes its first paint.
    void SplashScreen.hideAsync().catch(() => {
      // hideAsync rejects only if the native splash was already hidden
      // (idempotent / not-mounted); safe to swallow.
    });

    // Entry animation — runs on mount.
    glyphOpacity.value = withTiming(1, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
    // Pulse-settle: scale 0.88 → 1.04 → 1.0 for a gentle "bounce" feel
    // without overshoot that would look amateur. Total 720ms.
    glyphScale.value = withSequence(
      withTiming(1.04, { duration: 480, easing: Easing.out(Easing.cubic) }),
      withTiming(1.0, { duration: 240, easing: Easing.inOut(Easing.quad) })
    );
    wordOpacity.value = withDelay(
      400,
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) })
    );
    wordTranslateY.value = withDelay(
      400,
      withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) })
    );

    // Exit animation — kicks in after minVisibleMs and notifies parent
    // when the final opacity tick completes.
    const exitTimer = setTimeout(() => {
      containerOpacity.value = withTiming(
        0,
        { duration: 320, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(dismiss)();
          }
        }
      );
    }, minVisibleMs);

    return () => {
      clearTimeout(exitTimer);
    };
    // Shared values are stable references; we deliberately only run this
    // effect once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismiss, minVisibleMs]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const glyphStyle = useAnimatedStyle(() => ({
    opacity: glyphOpacity.value,
    transform: [{ scale: glyphScale.value }],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordTranslateY.value }],
  }));

  // accessibilityLabel covers screen-reader users — they get a single
  // concise announcement ("Companion") and the glyph + wordmark child
  // nodes are hidden from the a11y tree.
  const staticContainerStyle = useMemo(() => styles.container, []);

  return (
    <Animated.View
      style={[staticContainerStyle, containerStyle]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Companion"
      // Block touches under the splash while it's visible.
      pointerEvents="auto"
    >
      <Animated.View style={[styles.glyphWrapper, glyphStyle]}>
        <Image
          source={GLYPH}
          style={styles.glyph}
          resizeMode="contain"
          // The glyph PNG already encodes the brand mark; no a11y label.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Animated.View>
      <Animated.Text
        style={[styles.wordmark, wordStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        Companion
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    // Splash sits above every route but below modals / alerts.
    zIndex: 9999,
    elevation: 9999,
  },
  glyphWrapper: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    width: "100%",
    height: "100%",
  },
  wordmark: {
    ...Typography.screenTitle,
    color: Colors.surfaceWhite,
    marginTop: 24,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
});
