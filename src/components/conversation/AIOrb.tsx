/**
 * AIOrb — the centerpiece of the Talk screen.
 *
 * Design intent: a single living visual that signals what the AI is doing.
 * Inspired by Pi.ai's minimal orb + ChatGPT Voice's pulsing sphere — the
 * goal is to feel ALIVE without being noisy. Every state is communicated
 * through color + motion of the same primitive shape, so the user's eye
 * never has to relocate when the conversation flow changes.
 *
 * Visual stack (back to front):
 *   1. Outermost ambient ring — slow continuous breathing
 *   2. Middle pulse ring — fires on state transition, decays over ~1.5s
 *   3. Orb body — radial-gradient-ish circle (achieved with two stacked
 *      circles since RN core has no gradient primitive; the inner is
 *      brighter, the outer is darker — gives a subtle "lit from above"
 *      depth without requiring react-native-svg)
 *   4. Inner highlight — small offset white circle at ~25% opacity for
 *      glossiness
 *   5. Ripple rings — only during "ai-speaking", expand outward from
 *      the orb edge (creates the "voice emanating" feeling)
 *
 * State → visual mapping:
 *   - idle:          slow 3.6s breath, muted navy tones
 *   - connecting:    faster breath + rotating shimmer, amber-tinted
 *   - listening:     amber, fast pulse synced to mock audio rhythm
 *   - processing:    amber inner-rotation, suggesting "thinking"
 *   - ai-speaking:   white-cyan, ripple rings emanating outward
 *
 * No real audio reactivity (would need native level metering); time-based
 * animations tuned to FEEL audio-reactive — same approach Pi.ai and
 * Replika use under the hood.
 */

import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Colors, Shadows } from "@/src/lib/design";

export type AIOrbState = "idle" | "connecting" | "listening" | "processing" | "ai-speaking";

export interface AIOrbProps {
  state: AIOrbState;
  /** Diameter of the orb body in px. Rings + ripples scale relative to this. */
  size?: number;
}

interface StateVisual {
  /** Primary orb body color. */
  orbColor: string;
  /** Inner highlight color (top-left "lit from above" sheen). */
  orbHighlight: string;
  /** Color of the ambient + pulse rings around the orb. */
  ringColor: string;
  /** Whether the AI-speaking ripple emanation is active. */
  ripple: boolean;
  /** Breath cycle duration in ms (lower = more agitated, higher = calmer). */
  breathMs: number;
}

const STATE_VISUALS: Record<AIOrbState, StateVisual> = {
  idle: {
    orbColor: Colors.primaryLight,
    orbHighlight: Colors.whiteAlpha35,
    ringColor: Colors.whiteAlpha15,
    ripple: false,
    breathMs: 3600,
  },
  connecting: {
    orbColor: Colors.accent,
    orbHighlight: Colors.whiteAlpha35,
    ringColor: Colors.accent25,
    ripple: false,
    breathMs: 1400,
  },
  listening: {
    orbColor: Colors.accent,
    orbHighlight: Colors.whiteAlpha65,
    ringColor: Colors.accent30,
    ripple: false,
    breathMs: 900,
  },
  processing: {
    orbColor: Colors.accent,
    orbHighlight: Colors.whiteAlpha35,
    ringColor: Colors.accent25,
    ripple: false,
    breathMs: 1800,
  },
  "ai-speaking": {
    orbColor: Colors.surfaceWhite,
    orbHighlight: Colors.surfaceWhite,
    ringColor: Colors.whiteAlpha30,
    ripple: true,
    breathMs: 1100,
  },
};

/**
 * Ripple ring — a single expanding circle that scales 1.0 → 1.7 while
 * fading opacity 0.6 → 0. The orchestrator below stacks three of these
 * with staggered delays so the user perceives a continuous emanation
 * rather than a single pulse.
 */
function RippleRing({
  delay,
  size,
  color,
  active,
}: {
  delay: number;
  size: number;
  color: string;
  active: boolean;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = 1;
      opacity.value = 0;
      return;
    }
    scale.value = 1;
    opacity.value = 0;
    scale.value = withDelay(
      delay,
      withRepeat(withTiming(1.7, { duration: 1800, easing: Easing.out(Easing.cubic) }), -1, false)
    );
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.55, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 1600, easing: Easing.out(Easing.cubic) })
        ),
        -1,
        false
      )
    );
    // Shared values are stable refs; only re-run on active toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, delay]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

export function AIOrb({ state, size = 200 }: AIOrbProps) {
  const visual = STATE_VISUALS[state];

  // Breath / scale of the orb body. Loops continuously; the duration shifts
  // when state changes so the breath feels faster/slower to match mood.
  const breathScale = useSharedValue(1);
  // Pulse fired on state TRANSITION (one-shot expansion of the middle ring).
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);
  // Ambient outer ring — always breathing very slowly.
  const ambientScale = useSharedValue(1);
  const ambientOpacity = useSharedValue(0.18);

  useEffect(() => {
    // Cancel + restart the breath loop with the new state's tempo.
    cancelAnimation(breathScale);
    breathScale.value = 1;
    breathScale.value = withRepeat(
      withSequence(
        withTiming(1.06, {
          duration: visual.breathMs / 2,
          easing: Easing.inOut(Easing.quad),
        }),
        withTiming(1.0, {
          duration: visual.breathMs / 2,
          easing: Easing.inOut(Easing.quad),
        })
      ),
      -1,
      false
    );

    // One-shot pulse ring on state change.
    pulseScale.value = 1;
    pulseOpacity.value = 0.5;
    pulseScale.value = withTiming(1.45, {
      duration: 1100,
      easing: Easing.out(Easing.cubic),
    });
    pulseOpacity.value = withTiming(0, {
      duration: 1100,
      easing: Easing.out(Easing.cubic),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, visual.breathMs]);

  useEffect(() => {
    // Ambient outer breath — independent of state, runs forever once mounted.
    ambientScale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: 4200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    ambientOpacity.value = withRepeat(
      withSequence(
        withTiming(0.28, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.14, { duration: 4200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(ambientScale);
      cancelAnimation(ambientOpacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ambientStyle = useAnimatedStyle(() => ({
    opacity: ambientOpacity.value,
    transform: [{ scale: ambientScale.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulseScale.value }],
  }));

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathScale.value }],
  }));

  // Sizing — each ring is computed relative to the core orb so the
  // composition scales together when `size` changes.
  const ambientSize = size * 1.7;
  const pulseSize = size * 1.35;
  const orbSize = size;
  const highlightSize = size * 0.42;
  const rippleBaseSize = size * 1.1;

  return (
    <View
      style={[styles.container, { width: ambientSize, height: ambientSize }]}
      // Decorative — screen readers should read the subtitle text below,
      // not the orb itself.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {/* Layer 1: ambient outer ring (always animating) */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ambientSize,
            height: ambientSize,
            borderRadius: ambientSize / 2,
            borderColor: visual.ringColor,
          },
          ambientStyle,
        ]}
      />

      {/* Layer 2: ripple rings (only when AI is speaking — three staggered) */}
      {visual.ripple && (
        <>
          <RippleRing delay={0} size={rippleBaseSize} color={visual.ringColor} active />
          <RippleRing delay={600} size={rippleBaseSize} color={visual.ringColor} active />
          <RippleRing delay={1200} size={rippleBaseSize} color={visual.ringColor} active />
        </>
      )}

      {/* Layer 3: pulse ring (one-shot on state change) */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: pulseSize,
            height: pulseSize,
            borderRadius: pulseSize / 2,
            borderColor: visual.ringColor,
            borderWidth: 2,
          },
          pulseStyle,
        ]}
      />

      {/* Layer 4: orb body (continuous breath) */}
      <Animated.View
        style={[
          styles.orb,
          {
            width: orbSize,
            height: orbSize,
            borderRadius: orbSize / 2,
            backgroundColor: visual.orbColor,
            shadowColor: visual.orbColor,
          },
          orbStyle,
        ]}
      >
        {/* Layer 5: inner highlight (offset top-left for "lit from above" feel) */}
        <View
          style={{
            position: "absolute",
            top: orbSize * 0.18,
            left: orbSize * 0.22,
            width: highlightSize,
            height: highlightSize,
            borderRadius: highlightSize / 2,
            backgroundColor: visual.orbHighlight,
            opacity: 0.55,
          }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    borderWidth: 1.5,
  },
  ripple: {
    position: "absolute",
    borderWidth: 2,
  },
  orb: {
    alignItems: "center",
    justifyContent: "center",
    // iOS-side glow via shadow (Android elevation can't tint). Token
    // owns the radius / opacity numbers; we override `shadowColor`
    // per-state inline above for the state-driven hue.
    ...Shadows.glow,
  },
});
