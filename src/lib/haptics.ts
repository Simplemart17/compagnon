/**
 * Haptic Feedback Utilities
 *
 * Thin wrappers around expo-haptics for consistent haptic feedback
 * across the app. All calls silently catch errors so haptics never
 * crash the app (e.g. on unsupported devices or simulators).
 */

import * as Haptics from "expo-haptics";

export function hapticLight(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticMedium(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticSuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticError(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
