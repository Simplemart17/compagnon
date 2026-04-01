import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";

import { Colors, Typography, Radii, Spacing, skillTint } from "@/src/lib/design";

export interface OfflineFallbackProps {
  /** Called when user dismisses the fallback (optional) */
  onDismiss?: () => void;
}

export const OfflineFallback = React.memo(function OfflineFallback({
  onDismiss,
}: OfflineFallbackProps) {
  const router = useRouter();

  return (
    <View
      style={{
        backgroundColor: skillTint(Colors.accent, 0.12),
        borderRadius: Radii.card,
        padding: Spacing.cardPadding,
        marginHorizontal: Spacing.screenPadding,
        alignItems: "center",
      }}
      accessible
      accessibilityRole="alert"
      accessibilityLabel="Offline notice: Can't generate exercise offline. Review vocabulary instead."
    >
      <Text
        style={{
          ...Typography.cardTitle,
          color: Colors.textPrimary,
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        Can&#39;t generate exercise offline
      </Text>
      <Text
        style={{
          ...Typography.body,
          color: Colors.textSecondary,
          textAlign: "center",
          marginBottom: 16,
        }}
      >
        Review vocabulary instead?
      </Text>
      <TouchableOpacity
        onPress={() => {
          onDismiss?.();
          router.push("/(tabs)/practice/vocabulary");
        }}
        accessibilityRole="button"
        accessibilityLabel="Review vocabulary"
        accessibilityHint="Double tap to go to vocabulary review"
        style={{
          backgroundColor: Colors.accent,
          borderRadius: Radii.button,
          paddingHorizontal: 24,
          paddingVertical: 12,
          minWidth: 44,
          minHeight: 44,
        }}
      >
        <Text style={{ ...Typography.label, color: Colors.textOnDark }}>Review Vocabulary</Text>
      </TouchableOpacity>
    </View>
  );
});
