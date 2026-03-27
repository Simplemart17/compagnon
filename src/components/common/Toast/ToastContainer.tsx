import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { hapticError, hapticSuccess } from "@/src/lib/haptics";
import { Colors, Shadows, Spacing, Typography } from "@/src/lib/design";
import { ToastContext } from "@/src/components/common/Toast/ToastContext";
import type { ToastType } from "@/src/components/common/Toast/ToastContext";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SLIDE_DURATION = 200;
const SWIPE_THRESHOLD = 50;
const AUTO_DISMISS: Record<ToastType, number | null> = {
  success: 3000,
  warning: 5000,
  error: null, // manual dismiss only
};

const BORDER_COLOR: Record<ToastType, string> = {
  success: Colors.success,
  warning: Colors.accent,
  error: Colors.error,
};

const ICON_NAME: Record<ToastType, "checkmark-circle" | "information-circle" | "warning"> = {
  success: "checkmark-circle",
  warning: "information-circle",
  error: "warning",
};

const ICON_COLOR: Record<ToastType, string> = {
  success: Colors.success,
  warning: Colors.accent,
  error: Colors.error,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ToastContainer = React.memo(function ToastContainer() {
  const ctx = useContext(ToastContext);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const translateY = useSharedValue(-100);
  const panY = useSharedValue(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAnimatingOut = useRef(false);

  const current = ctx?.current ?? null;
  const dismiss = ctx?.dismiss;

  // Ref to always have latest dismiss, used by panResponder and worklet callback
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Named JS function for runOnJS — P1 fix
  const onSlideOutComplete = useCallback(() => {
    panY.value = 0;
    dismissRef.current?.();
    isAnimatingOut.current = false;
  }, [panY]);

  // --- Dismiss helper ---
  const handleDismiss = useCallback(() => {
    if (!dismissRef.current || isAnimatingOut.current) return;
    isAnimatingOut.current = true;

    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    if (reducedMotion) {
      translateY.value = -100;
      panY.value = 0;
      dismissRef.current();
      isAnimatingOut.current = false;
    } else {
      translateY.value = withTiming(-100, { duration: SLIDE_DURATION }, (finished) => {
        if (finished) {
          runOnJS(onSlideOutComplete)();
        }
      });
    }
  }, [reducedMotion, translateY, panY, onSlideOutComplete]);

  // Ref to latest handleDismiss, used by panResponder — P2 fix
  const handleDismissRef = useRef(handleDismiss);
  handleDismissRef.current = handleDismiss;

  // --- Pan responder for swipe-to-dismiss (uses refs to avoid stale closures) ---
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
        onPanResponderMove: (_, gestureState) => {
          // Only allow upward swipe (negative dy)
          if (gestureState.dy < 0) {
            panY.value = gestureState.dy;
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy < -SWIPE_THRESHOLD) {
            handleDismissRef.current();
          } else {
            panY.value = 0;
          }
        },
      }),
    [panY]
  );

  // --- Animate in when a new toast appears ---
  useEffect(() => {
    if (!current) {
      translateY.value = -100;
      panY.value = 0;
      isAnimatingOut.current = false;
      return;
    }

    isAnimatingOut.current = false;

    // Haptics
    if (current.type === "success") hapticSuccess();
    if (current.type === "error") hapticError();

    // Animate in
    if (reducedMotion) {
      translateY.value = 0;
    } else {
      translateY.value = -100;
      translateY.value = withTiming(0, { duration: SLIDE_DURATION });
    }

    // Auto-dismiss timer
    const duration = AUTO_DISMISS[current.type];
    if (duration !== null) {
      dismissTimerRef.current = setTimeout(() => handleDismissRef.current(), duration);
    }

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [current, reducedMotion, translateY, panY]);

  // --- Animated style ---
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + panY.value }],
  }));

  if (!current) return null;

  const liveRegion = current.type === "error" ? "assertive" : "polite";
  const hasAction = !!current.action;

  return (
    <Animated.View
      className="absolute"
      style={[
        {
          top: insets.top + 8,
          left: Spacing.screenPadding,
          right: Spacing.screenPadding,
          zIndex: 9999,
        },
        animatedStyle,
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion={liveRegion}
      accessibilityHint="Swipe up to dismiss"
      {...panResponder.panHandlers}
    >
      <View
        className="flex-row items-center rounded-xl bg-white"
        style={[
          {
            borderLeftWidth: 4,
            borderLeftColor: BORDER_COLOR[current.type],
            padding: Spacing.cardPaddingSmall,
            gap: 10,
          },
          Shadows.card,
        ]}
      >
        <Ionicons name={ICON_NAME[current.type]} size={24} color={ICON_COLOR[current.type]} />

        <Text
          style={[Typography.caption, { flex: 1, color: Colors.textPrimary }]}
          numberOfLines={2}
        >
          {current.message}
        </Text>

        {hasAction && (
          <Pressable
            onPress={() => {
              current.action?.onPress();
              handleDismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel={current.action!.label}
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Text style={[Typography.caption, { fontWeight: "700", color: Colors.primary }]}>
              {current.action!.label}
            </Text>
          </Pressable>
        )}

        {!hasAction && current.type === "error" && (
          <Pressable
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Ionicons name="close" size={20} color={Colors.textSecondary} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
});
