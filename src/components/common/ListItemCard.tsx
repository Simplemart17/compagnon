import React, { useEffect } from "react";
import { View, Text, Pressable, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { Colors, Radii, Shadows, Typography, skillTint } from "@/src/lib/design";

/**
 * Story 14-2: shared "list item card" surface. Replaces 5 bespoke inline
 * card variants (ProfileSkillCard, error-pattern cards, conversation topic
 * cards, TodayPlanItem internals) that all rendered the same shape — colored
 * left strip (optional) + icon circle (optional) + primary EN title +
 * secondary FR pedagogical-reinforcement line (optional) + description
 * (optional) + right-slot content (optional) + thin progress bar (optional).
 *
 * Inherits Story 13-7's frozen-static-style pattern (no per-frame
 * `className`+`style` merge) and Story 14-1's chrome rule (titlePrimary is
 * EN; titleSecondary is FR pedagogical reinforcement — consumers pass
 * `SKILL_LABELS[skill]?.en` not `.fr`).
 *
 * @internal — `listItemCardStaticStyle` is exported for runtime tests; do NOT
 * import in app code.
 *
 * Frozen at module-load (Story 13-7 R1-P2) so a debug session, runtime A/B
 * test, or future theming code path can't mutate this object and silently
 * change EVERY ListItemCard instance for the rest of the JS session. Spread
 * `Shadows.card` FIRST (Story 13-7 R1-P1) so explicit `padding`/`gap`/etc.
 * always win over future token additions to `Shadows.card`.
 */
export const listItemCardStaticStyle: ViewStyle = Object.freeze({
  ...Shadows.card,
  backgroundColor: Colors.surfaceWhite,
  borderRadius: Radii.card,
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
  padding: 16,
  gap: 14,
}) as ViewStyle;

export interface ListItemCardProgressBar {
  /** 0-100 fill percentage. */
  fillPercent: number;
  /** Fill color (e.g., `SKILL_COLORS[skill]`). */
  color: string;
}

export interface ListItemCardProps {
  /** Required: primary headline (EN per Story 14-1 chrome rule). */
  titlePrimary: string;
  /** Optional FR pedagogical-reinforcement secondary line. */
  titleSecondary?: string;
  /** Optional one-line description below the title. */
  description?: string;
  /** Optional emoji rendered in a tinted icon circle on the left. */
  iconEmoji?: string;
  /** Required if `iconEmoji` provided — drives the circle tint. */
  iconColor?: string;
  /** Optional colored left vertical strip (1px wide). */
  leftStripColor?: string;
  /** Optional right-side content (CEFR badge, count pill, difficulty dots, etc). */
  rightContent?: React.ReactNode;
  /** Optional progress bar variant — renders a 2px bar below the title row. */
  progressBar?: ListItemCardProgressBar;
  /** Optional entry-animation delay in ms (Story 13-7 cascade pattern). */
  delay?: number;
  /** Optional press handler. If absent, renders as a static `View`. */
  onPress?: () => void;
  /** Disabled state — opacity 0.6 + press handler ignored. */
  disabled?: boolean;
  /** Accessibility label (defaults to `${titlePrimary}. ${description ?? ""}`). */
  accessibilityLabel?: string;
  /** Accessibility hint. */
  accessibilityHint?: string;
}

function ListItemCardImpl({
  titlePrimary,
  titleSecondary,
  description,
  iconEmoji,
  iconColor,
  leftStripColor,
  rightContent,
  progressBar,
  delay,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
}: ListItemCardProps) {
  const opacity = useSharedValue(delay === undefined ? 1 : 0);
  const translateY = useSharedValue(delay === undefined ? 0 : 20);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (delay === undefined) return;
    opacity.value = withDelay(delay, withTiming(1, { duration: 380 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 380 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const computedAccessibilityLabel =
    accessibilityLabel ?? `${titlePrimary}${description ? `. ${description}` : ""}`;

  // Story 14-2 review-round-1 M13: split rendering so the progressBar
  // (when present) spans the FULL card width instead of being squeezed
  // inside the title-stack column. Pre-14-2 ProfileSkillCard rendered
  // the bar full-width below the title row; that geometry is now
  // preserved by stacking the content-row + progress-row vertically
  // when progressBar is set.
  const renderContentRow = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flex: 1 }}>
      {/* Optional icon circle */}
      {iconEmoji !== undefined && iconColor !== undefined && (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: skillTint(iconColor, 0.09),
          }}
        >
          <Text style={{ fontSize: 24 }}>{iconEmoji}</Text>
        </View>
      )}

      {/* Labels */}
      <View style={{ flex: 1 }}>
        <Text style={Typography.cardTitle} numberOfLines={2}>
          {titlePrimary}
        </Text>
        {titleSecondary !== undefined && (
          <Text style={[Typography.caption, { marginTop: 2 }]} numberOfLines={1}>
            {titleSecondary}
          </Text>
        )}
        {description !== undefined && (
          <Text style={[Typography.bodySecondary, { marginTop: 4 }]} numberOfLines={2}>
            {description}
          </Text>
        )}
      </View>

      {/* Optional right slot */}
      {rightContent !== undefined && <View>{rightContent}</View>}
    </View>
  );

  const renderInner = (
    <>
      {/* Optional colored left strip */}
      {leftStripColor !== undefined && (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: leftStripColor,
          }}
        />
      )}

      {progressBar === undefined ? (
        // Default: horizontal content row only (matches SkillCard rhythm).
        renderContentRow
      ) : (
        // R1-M13: stack content + full-width progress bar so the bar
        // doesn't get squeezed between the title-column and rightContent.
        <View style={{ flex: 1 }}>
          {renderContentRow}
          <View
            style={{
              height: 2,
              marginTop: 8,
              borderRadius: 1,
              backgroundColor: Colors.surface,
            }}
          >
            <View
              style={{
                height: 2,
                borderRadius: 1,
                // R1-H2: NaN-guard. Without Number.isFinite,
                // `Math.max(0, Math.min(100, NaN))` returns NaN,
                // producing `width: "NaN%"` which RN's layout engine
                // treats as undefined — collapsing the fill bar to 0px
                // or inheriting the parent width. Trigger: a consumer
                // passing `undefined / 7` as the fillPercent calculation.
                width: `${
                  Number.isFinite(progressBar.fillPercent)
                    ? Math.max(0, Math.min(100, progressBar.fillPercent))
                    : 0
                }%`,
                backgroundColor: progressBar.color,
              }}
            />
          </View>
        </View>
      )}
    </>
  );

  if (onPress === undefined) {
    return (
      <Animated.View
        // Story 14-2 review-round-1 H4: default `accessibilityRole="text"`
        // on the non-press branch so Android TalkBack focuses the card as
        // a single read-only unit instead of skipping or reading only the
        // first child Text. Pre-14-2 inline ComingSoonCard had `accessible
        // accessibilityRole="text"` — restored here for static consumers.
        // L1: also wire accessibilityHint through (was silently dropped).
        accessible
        accessibilityRole="text"
        accessibilityLabel={computedAccessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={[listItemCardStaticStyle, animStyle, disabled ? { opacity: 0.6 } : null]}
      >
        {renderInner}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPressIn={() => {
          if (disabled === true) return;
          scale.value = withTiming(0.97, { duration: 100 });
        }}
        onPressOut={() => {
          if (disabled === true) return;
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={disabled === true ? undefined : onPress}
        disabled={disabled === true}
        accessibilityRole="button"
        accessibilityLabel={computedAccessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: disabled === true }}
        style={[listItemCardStaticStyle, disabled === true ? { opacity: 0.6 } : null]}
      >
        {renderInner}
      </Pressable>
    </Animated.View>
  );
}

export const ListItemCard = React.memo(ListItemCardImpl);
