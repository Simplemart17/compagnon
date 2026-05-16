import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Colors, Radii, Shadows, Typography } from "@/src/lib/design";

/**
 * Story 14-8 — themed dialog component to replace `Alert.alert` for
 * high-traffic confirmation flows (sign-out, level change, daily-goal
 * change, delete-account stage-1).
 *
 * Closes part of Epic 14 P2-x ui-ux: the OS-default `Alert.alert` chrome
 * (iOS-blue buttons + system font + system corner-radius) breaks the
 * Companion design system precisely when users are confirming important
 * actions. This component renders a centered card on a dimmed backdrop
 * using design tokens (Colors.accent for CTA, Colors.error for destructive,
 * Shadows.hero elevation, Typography.* presets).
 *
 * **Why NOT a full-screen modal:** the transcript modal in
 * `app/(tabs)/conversation/history.tsx` uses `<Modal presentationStyle=
 * "pageSheet">` (full-height bottom-sheet) for CONTENT. A confirmation
 * dialog needs to feel BLOCKING — centered card + dim backdrop matches
 * iOS HIG for Alert/Action Sheet.
 *
 * **Why NOT an imperative `dialog.show(...).then(result)` API:** matches
 * the codebase's established `useState` + conditional inline render
 * pattern (Story 12-9 EmailVerificationGate, Story 14-7 mock-test landing).
 * The `useThemedDialog()` hook in `src/hooks/use-themed-dialog.ts`
 * wraps the boilerplate.
 *
 * **Cross-story invariants:**
 *  - Story 13-7 frozen-static-style (`Object.freeze`) on card + button styles.
 *  - Story 14-1 chrome rule: all default chrome is English.
 *  - Story 14-3 R1-P1 3-prop decorative a11y on the backdrop.
 *  - Story 14-4 token enforcement: all colors `Colors.*`; all radii `Radii.*`.
 *  - Story 14-5 accent split: `default` button uses `Colors.accent` (CTA);
 *    `destructive` uses `Colors.error`; no streak/progress token usage.
 *  - Story 14-6 Typography.ctaLabel: action buttons use this preset.
 *
 * @see _bmad-output/implementation-artifacts/14-8-themed-dialog-component.md
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ThemedDialogButton {
  label: string;
  /**
   * Visual intent of the button.
   *  - `"default"` — filled `Colors.accent` (primary CTA, Story 14-5 cluster)
   *  - `"destructive"` — filled `Colors.error` (irreversible action)
   *  - `"cancel"` — transparent + `Colors.textSecondary` (de-emphasized)
   * Defaults to `"default"` when omitted.
   */
  style?: "default" | "destructive" | "cancel";
  onPress?: () => void;
}

export interface ThemedDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /**
   * 1-3 buttons. Layout:
   *  - 1 button: full-width single
   *  - 2 buttons: horizontal row, gap 12 — convention is cancel-LEFT,
   *    action-RIGHT (matches iOS HIG + Alert.alert array-order).
   *  - 3 buttons: stacked vertically, gap 8 — top-to-bottom matches input order.
   */
  buttons: ThemedDialogButton[];
  /**
   * Fires on backdrop tap OR Android hardware back. The caller is
   * responsible for setting `visible={false}` in response.
   *
   * **Suppressed when any button has `style: "destructive"`** — irreversible
   * actions must require explicit button confirmation (operator decision Q4
   * per Story 14-8 spec).
   */
  onRequestClose?: () => void;
  /**
   * Accessibility label override for the dialog as a whole. Defaults to
   * `${title}. ${message}`.
   */
  accessibilityLabel?: string;
}

// ---------------------------------------------------------------------------
// Frozen static styles (Story 13-7 R1-P1 + R1-P2 pattern)
// ---------------------------------------------------------------------------

/**
 * @internal — exported for runtime test pinning. Spread `Shadows.hero`
 * FIRST so explicit padding/radius/etc. always win over future
 * token additions (Story 14-2 R1-P1 pattern).
 */
export const themedDialogCardStaticStyle: ViewStyle = Object.freeze({
  ...Shadows.hero,
  backgroundColor: Colors.surfaceWhite,
  borderRadius: Radii.card,
  padding: 24,
  marginHorizontal: 32,
  maxWidth: 360,
  alignSelf: "center" as const,
  // Defensive — ensure the card doesn't bleed off-screen on tiny devices
  minWidth: 280,
}) as ViewStyle;

/** @internal — base button style; `backgroundColor` merged per-intent at render. */
const themedDialogButtonBaseStyle: ViewStyle = Object.freeze({
  borderRadius: Radii.button,
  paddingVertical: 12,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  minHeight: 44, // a11y: minimum tappable target
}) as ViewStyle;

/**
 * @internal — Reanimated entry/exit transition duration. 180ms keeps the
 * dialog feeling responsive (vs Alert.alert's ~300ms iOS-default which
 * feels sluggish on modern devices).
 */
export const THEMED_DIALOG_ANIM_DURATION_MS = 180;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ThemedDialogImpl({
  visible,
  title,
  message,
  buttons,
  onRequestClose,
  accessibilityLabel,
}: ThemedDialogProps): React.ReactElement | null {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.92);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, {
        duration: THEMED_DIALOG_ANIM_DURATION_MS,
        easing: Easing.out(Easing.quad),
      });
      scale.value = withTiming(1, {
        duration: THEMED_DIALOG_ANIM_DURATION_MS,
        easing: Easing.out(Easing.quad),
      });
    } else {
      opacity.value = withTiming(0, {
        duration: THEMED_DIALOG_ANIM_DURATION_MS,
        easing: Easing.in(Easing.quad),
      });
      scale.value = withTiming(0.92, {
        duration: THEMED_DIALOG_ANIM_DURATION_MS,
        easing: Easing.in(Easing.quad),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opacity/scale are stable Reanimated refs
  }, [visible]);

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const animatedCardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  // Backdrop tap is suppressed for destructive flows (Q4) so users must
  // make an explicit choice on irreversible actions.
  const hasDestructive = buttons.some((b) => b.style === "destructive");
  const backdropDismissable = !hasDestructive && onRequestClose !== undefined;

  const computedAccessibilityLabel = accessibilityLabel ?? `${title}. ${message}`;

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      // R1-P1: suppress Android hardware back on destructive dialogs so
      // users cannot bypass the forced-explicit-choice invariant (Q4).
      onRequestClose={hasDestructive ? undefined : onRequestClose}
      // accessibilityViewIsModal helps iOS VoiceOver focus only on the
      // dialog (rest of screen becomes inaccessible while modal is open)
      accessibilityViewIsModal
    >
      {/* R1-P2: dim overlay is a separate absolute sibling so Story 14-3
          R1-P1 decorative a11y props only suppress the overlay itself — NOT
          the dialog card below. Using accessibilityElementsHidden on a
          parent that also contains the card would hide the card from
          VoiceOver (iOS) and TalkBack (Android). */}
      <Animated.View
        style={[StyleSheet.absoluteFill, themedDialogDimLayerBaseStyle, animatedBackdropStyle]}
        // Story 14-3 R1-P1 3-prop decorative a11y — dim overlay must not
        // appear as a focusable element to screen-readers.
        accessible={false}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />

      {/* Backdrop press-target — only present when backdrop-dismiss is
          allowed (no destructive button + an onRequestClose handler). */}
      {backdropDismissable && (
        <Pressable
          style={themedDialogBackdropPressableStyle}
          onPress={onRequestClose}
          accessible={false}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
        />
      )}

      {/* Card container — flex centering; carries no a11y suppression so
          the card and its children are reachable by VoiceOver / TalkBack. */}
      <View style={themedDialogCardContainerStyle} pointerEvents="box-none">
        {/* Dialog card */}
        <Animated.View
          style={[themedDialogCardStaticStyle, animatedCardStyle]}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={computedAccessibilityLabel}
        >
          {/* R1-P5: removed accessibilityRole="header" — the parent alert
              container's accessibilityLabel already covers title + message;
              header role inside an alert is semantically incorrect. */}
          <Text style={titleTextStyle} numberOfLines={3} allowFontScaling={true}>
            {title}
          </Text>
          <Text style={messageTextStyle} numberOfLines={20} allowFontScaling={true}>
            {message}
          </Text>

          <ThemedDialogButtonRow buttons={buttons} />
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Internal — renders the button group with 1 / 2-horizontal / 3-vertical
 * layout. Each button has a synchronous `useRef`-based re-entrancy guard
 * (Story 12-9 / 14-7 R1-P6 pattern) so a double-tap doesn't double-fire
 * a slow `onPress` handler.
 */
interface ThemedDialogButtonRowProps {
  buttons: ThemedDialogButton[];
}

function ThemedDialogButtonRow({ buttons }: ThemedDialogButtonRowProps): React.ReactElement {
  // R1-P7: spec supports 1–3 buttons; 4+ produces squished horizontal layout.
  if (__DEV__ && buttons.length > 3) {
    console.warn(
      `ThemedDialog: received ${buttons.length} buttons — spec supports 1–3. Extra buttons will overflow the card.`
    );
  }
  const vertical = buttons.length === 3;
  return (
    <View
      style={{
        marginTop: 24,
        gap: vertical ? 8 : 12,
        flexDirection: vertical ? "column" : "row",
      }}
    >
      {buttons.map((button, idx) => (
        <ThemedDialogButtonImpl
          key={idx}
          button={button}
          // In horizontal layout, each button shares space equally.
          // In vertical layout, each button spans full width.
          flexFill={!vertical && buttons.length > 1}
        />
      ))}
    </View>
  );
}

interface ThemedDialogButtonImplProps {
  button: ThemedDialogButton;
  flexFill: boolean;
}

function ThemedDialogButtonImpl({
  button,
  flexFill,
}: ThemedDialogButtonImplProps): React.ReactElement {
  const tappedRef = useRef(false);

  const handlePress = () => {
    if (tappedRef.current) return;
    tappedRef.current = true;
    try {
      button.onPress?.();
    } finally {
      // Reset on next tick so a future show()→tap cycle works. The
      // `useEffect` re-mount on visible:true would reset this too, but
      // microtask reset is defensive against in-component re-renders.
      void Promise.resolve().then(() => {
        tappedRef.current = false;
      });
    }
  };

  const intent = button.style ?? "default";
  const buttonStyle =
    intent === "destructive"
      ? themedDialogDestructiveButtonStyle
      : intent === "cancel"
        ? themedDialogCancelButtonStyle
        : themedDialogDefaultButtonStyle;

  // R1-P3: split text style by intent — default uses Colors.primary (navy)
  // for 5.8:1 contrast on amber; destructive uses Colors.textOnDark (white)
  // for 3.55:1 contrast on red (passes WCAG AA for large/bold text).
  const textStyle =
    intent === "cancel"
      ? themedDialogCancelTextStyle
      : intent === "destructive"
        ? themedDialogDestructiveTextStyle
        : themedDialogDefaultTextStyle;

  return (
    <Pressable
      onPress={handlePress}
      style={[buttonStyle, flexFill ? { flex: 1 } : { width: "100%" }]}
      accessibilityRole="button"
      accessibilityLabel={button.label}
    >
      <Text style={textStyle}>{button.label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Per-intent style constants (frozen)
// ---------------------------------------------------------------------------

const themedDialogDefaultButtonStyle: ViewStyle = Object.freeze({
  ...themedDialogButtonBaseStyle,
  backgroundColor: Colors.accent,
}) as ViewStyle;

const themedDialogDestructiveButtonStyle: ViewStyle = Object.freeze({
  ...themedDialogButtonBaseStyle,
  backgroundColor: Colors.error,
}) as ViewStyle;

const themedDialogCancelButtonStyle: ViewStyle = Object.freeze({
  ...themedDialogButtonBaseStyle,
  backgroundColor: "transparent",
}) as ViewStyle;

// R1-P2: absolute-fill overlay for the dim background; separate from the
// card container so decorative a11y props don't swallow the dialog card.
const themedDialogDimLayerBaseStyle: ViewStyle = Object.freeze({
  backgroundColor: "rgba(0,0,0,0.5)",
}) as ViewStyle;

// Full-screen flex container that centers the card; carries no a11y
// suppression so VoiceOver/TalkBack can reach the card.
const themedDialogCardContainerStyle: ViewStyle = Object.freeze({
  flex: 1,
  justifyContent: "center" as const,
  alignItems: "center" as const,
}) as ViewStyle;

// R1-P4: pass the frozen constant directly — no spread to avoid per-render
// object allocation (Story 13-7 pattern).
const themedDialogBackdropPressableStyle: ViewStyle = Object.freeze({
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
}) as ViewStyle;

// ---------------------------------------------------------------------------
// Per-intent text styles (Story 14-6 Typography.ctaLabel)
// R1-P3: split by intent — default (amber bg) needs dark text for contrast;
// destructive (red bg) and cancel (transparent) have their own overrides.
// ---------------------------------------------------------------------------

// Navy on amber (#F5A623): ~5.8:1 WCAG AA contrast for normal text.
const themedDialogDefaultTextStyle: TextStyle = Object.freeze({
  ...Typography.ctaLabel,
  color: Colors.primary,
}) as TextStyle;

// White on red (#FF3B30): ~3.55:1 — passes WCAG AA for large/bold text (17px bold).
const themedDialogDestructiveTextStyle: TextStyle = Object.freeze({
  ...Typography.ctaLabel,
  color: Colors.textOnDark,
}) as TextStyle;

const themedDialogCancelTextStyle: TextStyle = Object.freeze({
  ...Typography.ctaLabel,
  color: Colors.textSecondary,
}) as TextStyle;

// ---------------------------------------------------------------------------
// Title + message text styles
// ---------------------------------------------------------------------------

const titleTextStyle: TextStyle = Object.freeze({
  ...Typography.sectionHeader,
  color: Colors.textPrimary,
}) as TextStyle;

const messageTextStyle: TextStyle = Object.freeze({
  ...Typography.body,
  color: Colors.textPrimary,
  marginTop: 12,
}) as TextStyle;

// ---------------------------------------------------------------------------
// Exported memo wrapper (Story 14-2 / 14-3 / 14-7 precedent)
// ---------------------------------------------------------------------------

export const ThemedDialog = React.memo(ThemedDialogImpl);
ThemedDialog.displayName = "ThemedDialog";

export default ThemedDialog;
