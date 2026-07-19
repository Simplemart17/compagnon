/**
 * CompanionAvatar — the companion's face, center-stage on the Talk screen.
 *
 * Story 18-4 (Avatar v1, v2-vision-roadmap Epic 18). Evolves the AIOrb
 * (whose ring/breath/pulse/ripple DNA is ported here) into an EXPRESSIVE
 * CHARACTER: a warm face with blinking eyes, a state-driven gaze, and a
 * mouth driven by REAL output-audio amplitude from the Realtime PCM stream
 * (`pcm16Base64Level` → orchestrator `onAudioAmplitude` → SharedValue —
 * never React state, per the Story 13-1 render-storm contract).
 *
 * D-V1 amendment (documented in v2-vision-roadmap.md): the renderer is
 * code-drawn (Reanimated + Views — zero new native modules, OTA-able, no
 * authored asset dependency). The `AvatarState` union + amplitude
 * SharedValue form the renderer CONTRACT, so a Rive character can swap in
 * behind the same props later (18-4-followup-rive-renderer).
 *
 * State → expression:
 *   - idle:        soft breath, neutral gaze, gentle smile
 *   - connecting:  faster breath, soft eyes, small neutral mouth
 *   - listening:   attentive — eyes widen, closed smile, amber rings
 *   - thinking:    gaze up-left, "o" mouth, thinking dots above the head
 *   - speaking:    mouth opens with audio amplitude, ripple rings emanate
 *   - celebrating: bounce + happy-squint eyes + big smile + blush
 *
 * All animation runs in worklets off shared values; the only React-driven
 * changes are state transitions (a handful per conversation turn).
 */

import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { type AvatarState } from "@/src/lib/avatar-state";
import { Colors, Shadows, Typography } from "@/src/lib/design";

export interface CompanionAvatarProps {
  state: AvatarState;
  /**
   * AI output-audio level 0..1 (Story 18-4 amplitude plumbing). Drives the
   * mouth while `state === "speaking"`. Optional — without it the speaking
   * mouth falls back to a gentle open-close loop.
   */
  amplitude?: SharedValue<number>;
  /** Face diameter in px. Rings + features scale relative to this. */
  size?: number;
}

interface StateVisual {
  /** Ring color around the face (ambient + pulse + ripples). */
  ringColor: string;
  /**
   * Body halo hue — review R1: `Shadows.glow`'s token contract says
   * "Consumers MUST override shadowColor to a state-appropriate hue"; the
   * pre-R1 body used the token default (navy), invisible on the navy
   * screen background. The per-state glow restores the AIOrb's
   * distance-readable channel (amber while listening, white while
   * speaking) that the constant-white face otherwise lost.
   */
  glowColor: string;
  /** Ripple emanation active (speaking). */
  ripple: boolean;
  /** Breath cycle in ms (lower = more agitated). */
  breathMs: number;
}

const STATE_VISUALS: Record<AvatarState, StateVisual> = {
  idle: {
    ringColor: Colors.whiteAlpha15,
    glowColor: Colors.primaryLight,
    ripple: false,
    breathMs: 3600,
  },
  connecting: {
    ringColor: Colors.accent25,
    glowColor: Colors.accent,
    ripple: false,
    breathMs: 1400,
  },
  listening: {
    ringColor: Colors.accent30,
    glowColor: Colors.accent,
    ripple: false,
    breathMs: 1000,
  },
  thinking: { ringColor: Colors.accent25, glowColor: Colors.accent, ripple: false, breathMs: 1800 },
  speaking: {
    ringColor: Colors.whiteAlpha30,
    glowColor: Colors.surfaceWhite,
    ripple: true,
    breathMs: 1100,
  },
  celebrating: {
    ringColor: Colors.accent30,
    glowColor: Colors.accent,
    ripple: false,
    breathMs: 1200,
  },
};

/** Mouth geometry targets per state, as fractions of `size`. */
const MOUTH_TARGETS: Record<AvatarState, { w: number; h: number; round: boolean }> = {
  idle: { w: 0.3, h: 0.055, round: false },
  connecting: { w: 0.16, h: 0.04, round: false },
  listening: { w: 0.22, h: 0.05, round: false },
  thinking: { w: 0.1, h: 0.1, round: true },
  speaking: { w: 0.24, h: 0.06, round: false },
  celebrating: { w: 0.34, h: 0.14, round: false },
};

/** Ripple ring (ported from AIOrb) — expands + fades on a stagger. */
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
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        style,
      ]}
    />
  );
}

/** One thinking dot — staggered rise + fade loop. */
function ThinkingDot({ delay, size, offsetX }: { delay: number; size: number; offsetX: number }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.9, { duration: 350, easing: Easing.out(Easing.quad) }),
          withTiming(0.15, { duration: 650, easing: Easing.in(Easing.quad) })
        ),
        -1,
        false
      )
    );
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-4, { duration: 350, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 650, easing: Easing.in(Easing.quad) })
        ),
        -1,
        false
      )
    );
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.whiteAlpha65,
          marginLeft: offsetX,
        },
        style,
      ]}
    />
  );
}

export const CompanionAvatar = React.memo(function CompanionAvatar({
  state,
  amplitude,
  size = 180,
}: CompanionAvatarProps) {
  const visual = STATE_VISUALS[state];

  // ---- shared values -------------------------------------------------------
  // Body breath + celebrate bounce.
  const breathScale = useSharedValue(1);
  const bounceScale = useSharedValue(1);
  // Transition pulse ring (one-shot on state change).
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);
  // Ambient outer ring.
  const ambientScale = useSharedValue(1);
  const ambientOpacity = useSharedValue(0.18);
  // Eyes: blink (scaleY), gaze (translate), attentiveness (scale), squint.
  const blink = useSharedValue(1);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const eyeScale = useSharedValue(1);
  const eyeSquint = useSharedValue(0); // 0 = round eyes, 1 = happy-squint arcs
  // Mouth geometry targets (state-driven) + speaking flag for amplitude mix.
  const mouthW = useSharedValue(MOUTH_TARGETS.idle.w * size);
  const mouthH = useSharedValue(MOUTH_TARGETS.idle.h * size);
  const mouthRound = useSharedValue(0); // 1 = full circle ("o")
  const speakingFlag = useSharedValue(0);
  // Blush (celebrating).
  const blushOpacity = useSharedValue(0);

  // Amplitude: optional prop — fall back to a gentle loop while speaking.
  const internalLevel = useSharedValue(0);
  const level = amplitude ?? internalLevel;
  // Smooth the raw chunk levels (fast attack, soft release feel comes from
  // the short timing window re-targeting on every write).
  const smoothedLevel = useDerivedValue(() => withTiming(level.value, { duration: 90 }));

  // ---- state transitions ---------------------------------------------------
  useEffect(() => {
    // Breath tempo for this state.
    cancelAnimation(breathScale);
    breathScale.value = 1;
    breathScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: visual.breathMs / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: visual.breathMs / 2, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );

    // One-shot pulse ring.
    pulseScale.value = 1;
    pulseOpacity.value = 0.5;
    pulseScale.value = withTiming(1.45, { duration: 1100, easing: Easing.out(Easing.cubic) });
    pulseOpacity.value = withTiming(0, { duration: 1100, easing: Easing.out(Easing.cubic) });

    // Expression targets.
    const t = { duration: 220, easing: Easing.out(Easing.cubic) };
    gazeX.value = withTiming(state === "thinking" ? -size * 0.03 : 0, t);
    gazeY.value = withTiming(state === "thinking" ? -size * 0.035 : 0, t);
    eyeScale.value = withTiming(state === "listening" ? 1.18 : state === "connecting" ? 0.9 : 1, t);
    eyeSquint.value = withTiming(state === "celebrating" ? 1 : 0, t);
    blushOpacity.value = withTiming(state === "celebrating" ? 1 : 0, t);

    const mouth = MOUTH_TARGETS[state];
    mouthW.value = withTiming(mouth.w * size, t);
    mouthH.value = withTiming(mouth.h * size, t);
    mouthRound.value = withTiming(mouth.round ? 1 : 0, t);
    speakingFlag.value = withTiming(state === "speaking" ? 1 : 0, { duration: 150 });

    // Celebrate bounce (one-shot on entry).
    cancelAnimation(bounceScale);
    bounceScale.value = 1;
    if (state === "celebrating") {
      bounceScale.value = withSequence(
        withTiming(1.14, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(0.97, { duration: 140, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.06, { duration: 140, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 160, easing: Easing.out(Easing.quad) })
      );
    }

    // Speaking fallback loop when no amplitude source is wired.
    cancelAnimation(internalLevel);
    if (state === "speaking" && amplitude === undefined) {
      internalLevel.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 160, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.2, { duration: 220, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      );
    } else if (amplitude === undefined) {
      internalLevel.value = withTiming(0, { duration: 120 });
    }
    // Shared values are stable refs; re-run only on state/size change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, size, visual.breathMs, amplitude]);

  // Blink loop — independent of state, runs forever.
  useEffect(() => {
    blink.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2800 }),
        withTiming(0.08, { duration: 70, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) })
      ),
      -1,
      false
    );
    // Ambient ring breath.
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
      cancelAnimation(blink);
      cancelAnimation(ambientScale);
      cancelAnimation(ambientOpacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- animated styles -----------------------------------------------------
  const ambientStyle = useAnimatedStyle(() => ({
    opacity: ambientOpacity.value,
    transform: [{ scale: ambientScale.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulseScale.value }],
  }));

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathScale.value * bounceScale.value }],
  }));

  const eyeCommon = () => {
    "worklet";
    return {
      transform: [
        { translateX: gazeX.value },
        { translateY: gazeY.value + eyeSquint.value * 2 },
        // Blink multiplies into the squint so celebrating eyes stay arcs.
        { scaleY: blink.value * (1 - eyeSquint.value * 0.65) * eyeScale.value },
        { scaleX: eyeScale.value },
      ],
    };
  };
  const leftEyeStyle = useAnimatedStyle(eyeCommon);
  const rightEyeStyle = useAnimatedStyle(eyeCommon);

  // Review R1: SPLIT the mouth into a geometry mapper (layout props — only
  // change during the 220ms state tween, a handful of commits per turn) and
  // a transform-only mapper (the per-frame amplitude path). Pre-R1 a single
  // mapper wrote width/height/borderRadius at amplitude cadence — on New
  // Architecture every layout-prop update forces a ShadowTree commit + Yoga
  // pass, the one non-compositor animation in the component during the
  // FPS-critical speaking window. scaleY from the mouth's center opens the
  // mouth symmetrically; corner distortion is bounded by the ~1.0-2.5×
  // range on a small rounded rect.
  const mouthGeometryStyle = useAnimatedStyle(() => {
    const h = mouthH.value;
    return {
      width: mouthW.value,
      height: h,
      // Round ("o") mouth when thinking; otherwise a smile bar whose bottom
      // corners are much rounder than the top (gentle-smile silhouette).
      borderTopLeftRadius: mouthRound.value * (h / 2) + (1 - mouthRound.value) * 6,
      borderTopRightRadius: mouthRound.value * (h / 2) + (1 - mouthRound.value) * 6,
      borderBottomLeftRadius: h / 2 + 4,
      borderBottomRightRadius: h / 2 + 4,
    };
  });

  const mouthOpenStyle = useAnimatedStyle(() => ({
    // Relative open: at full level the speaking mouth reaches ~2.5× its
    // resting height (≈ the pre-R1 absolute boost of 0.16·size on the
    // 0.06·size speaking base). Transform-only — no layout pass per frame.
    transform: [{ scaleY: 1 + speakingFlag.value * smoothedLevel.value * 1.5 }],
  }));

  const blushStyle = useAnimatedStyle(() => ({ opacity: blushOpacity.value * 0.8 }));

  // ---- sizing --------------------------------------------------------------
  const ambientSize = size * 1.7;
  const pulseSize = size * 1.35;
  const rippleBaseSize = size * 1.1;
  const eyeW = size * 0.105;
  const eyeH = size * 0.15;
  const eyeOffsetX = size * 0.165;
  const eyeTop = size * 0.34;
  const mouthTop = size * 0.6;
  const blushSize = size * 0.11;

  return (
    <View
      style={[styles.container, { width: ambientSize, height: ambientSize }]}
      // Decorative — the AvatarStatusLabel below announces state changes.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {/* Ambient outer ring */}
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

      {/* Ripple rings while speaking */}
      {visual.ripple && (
        <>
          <RippleRing delay={0} size={rippleBaseSize} color={visual.ringColor} active />
          <RippleRing delay={600} size={rippleBaseSize} color={visual.ringColor} active />
          <RippleRing delay={1200} size={rippleBaseSize} color={visual.ringColor} active />
        </>
      )}

      {/* Transition pulse ring */}
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

      {/* Face body */}
      <Animated.View
        style={[
          styles.body,
          { width: size, height: size, borderRadius: size / 2, shadowColor: visual.glowColor },
          bodyStyle,
        ]}
      >
        {/* Top-left sheen */}
        <View
          style={{
            position: "absolute",
            top: size * 0.12,
            left: size * 0.16,
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: size * 0.17,
            backgroundColor: Colors.whiteAlpha35,
            opacity: 0.5,
          }}
        />

        {/* Eyes */}
        <Animated.View
          style={[
            styles.eye,
            {
              width: eyeW,
              height: eyeH,
              borderRadius: eyeW / 2,
              top: eyeTop,
              left: size / 2 - eyeOffsetX - eyeW / 2,
            },
            leftEyeStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.eye,
            {
              width: eyeW,
              height: eyeH,
              borderRadius: eyeW / 2,
              top: eyeTop,
              left: size / 2 + eyeOffsetX - eyeW / 2,
            },
            rightEyeStyle,
          ]}
        />

        {/* Blush (celebrating) */}
        <Animated.View
          style={[
            styles.blush,
            {
              width: blushSize,
              height: blushSize * 0.62,
              borderRadius: blushSize / 2,
              top: size * 0.52,
              left: size * 0.13,
            },
            blushStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.blush,
            {
              width: blushSize,
              height: blushSize * 0.62,
              borderRadius: blushSize / 2,
              top: size * 0.52,
              right: size * 0.13,
            },
            blushStyle,
          ]}
        />

        {/* Mouth */}
        <View
          style={{ position: "absolute", top: mouthTop, left: 0, right: 0, alignItems: "center" }}
        >
          <Animated.View style={[styles.mouth, mouthGeometryStyle, mouthOpenStyle]} />
        </View>
      </Animated.View>

      {/* Thinking dots — arc above the head, top-right */}
      {state === "thinking" && (
        <View
          style={{
            position: "absolute",
            top: ambientSize / 2 - size * 0.72,
            left: ambientSize / 2 + size * 0.3,
            flexDirection: "row",
            alignItems: "flex-end",
          }}
        >
          <ThinkingDot delay={0} size={size * 0.045} offsetX={0} />
          <ThinkingDot delay={180} size={size * 0.06} offsetX={5} />
          <ThinkingDot delay={360} size={size * 0.075} offsetX={5} />
        </View>
      )}
    </View>
  );
});
CompanionAvatar.displayName = "CompanionAvatar";

/** State subtitle beneath the avatar — EN chrome per Story 14-1. */
const STATE_LABELS: Record<AvatarState, string> = {
  idle: "Your turn — just talk",
  connecting: "Connecting...",
  listening: "Listening...",
  thinking: "Thinking...",
  speaking: "Speaking...",
  celebrating: "Well done!",
};

export const AvatarStatusLabel = React.memo(function AvatarStatusLabel({
  state,
}: {
  state: AvatarState;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);

  useEffect(() => {
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
});
AvatarStatusLabel.displayName = "AvatarStatusLabel";

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
  body: {
    backgroundColor: Colors.surfaceWhite,
    ...Shadows.glow,
  },
  eye: {
    position: "absolute",
    backgroundColor: Colors.primary,
  },
  blush: {
    position: "absolute",
    backgroundColor: Colors.accent30,
  },
  mouth: {
    backgroundColor: Colors.primary,
  },
  label: {
    ...Typography.caption,
    color: Colors.whiteAlpha65,
    marginTop: 28,
    letterSpacing: 1,
    textAlign: "center",
  },
});
