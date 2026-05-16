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

/**
 * Story 14-2: second frozen static-style constant for the `featured` variant
 * — adopted from the pre-14-2 inline `VocabularyCard` on the practice screen.
 * Featured cards use the accent-tinted background + 1px accent border instead
 * of the default white + card shadow.
 *
 * @internal — exported for runtime tests; do NOT import in app code.
 * Same `Shadows.card` spread-first + `Object.freeze` defenses as the default
 * style (Story 13-7 R1-P1 + R1-P2).
 */
export const skillCardFeaturedStaticStyle: ViewStyle = Object.freeze({
  ...Shadows.card,
  backgroundColor: Colors.accent10,
  borderRadius: Radii.card,
  borderWidth: 1,
  borderColor: Colors.accent,
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
  /**
   * Story 14-2: render with `accent10` background + amber border instead of
   * the default white + card shadow. Used for the practice-screen featured
   * Vocabulary card (replaces the pre-14-2 inline `VocabularyCard`).
   */
  featured?: boolean;
  /**
   * Story 14-2: disable press handling — opacity 0.6 + no `onPress` + sets
   * `accessibilityState.disabled`. Used for the mock-test "Coming soon"
   * Speaking + Writing entries (replaces the pre-14-2 inline `ComingSoonCard`).
   */
  disabled?: boolean;
  /**
   * Story 14-2: override the left-strip color. Defaults to `accentColor`.
   * Lets featured / themed cards use a different left-strip tone than the
   * skill's primary color.
   */
  accent?: string;
}

export const SkillCard = React.memo(function SkillCard({
  emoji,
  titleFr,
  titleEn,
  description,
  accentColor,
  delay,
  onPress,
  featured = false,
  disabled = false,
  accent,
}: SkillCardProps) {
  const stripColor = accent ?? accentColor;
  const containerStyle = featured ? skillCardFeaturedStaticStyle : skillCardPressableStaticStyle;
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
          if (disabled) return;
          scale.value = withTiming(0.97, { duration: 100 });
        }}
        onPressOut={() => {
          if (disabled) return;
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        // Story 14-2 review-round-1 H1: when disabled, present as static
        // text (not a button) — VoiceOver / TalkBack must NOT promise
        // "Double tap to start ... practice" on a card that won't respond.
        // Pre-14-2 ComingSoonCard used accessibilityRole="text" + hint
        // "Not yet available"; the consolidated SkillCard restores that
        // semantic for the disabled branch.
        accessibilityRole={disabled ? "text" : "button"}
        accessibilityLabel={`${titleEn}. ${description}`}
        accessibilityHint={
          disabled ? "Not yet available" : `Double tap to start ${titleEn} practice`
        }
        accessibilityState={{ disabled }}
        style={[containerStyle, disabled ? { opacity: 0.6 } : null]}
      >
        {/* Left accent strip */}
        <View
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: stripColor }}
        />

        {/* Icon circle */}
        <View
          className="w-14 h-14 rounded-[28px] justify-center items-center"
          style={{ backgroundColor: skillTint(stripColor, 0.09) }}
        >
          <Text style={{ fontSize: Typography.statNumber.fontSize }}>{emoji}</Text>
        </View>

        {/* Labels (EN primary per Story 14-1 chrome rule; FR as pedagogical reinforcement) */}
        <View className="flex-1">
          <Text className="text-base font-bold text-primary">{titleEn}</Text>
          <Text className="text-xs mt-[2px]" style={{ color: Colors.textSecondary }}>
            {titleFr}
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
