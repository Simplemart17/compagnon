import React from "react";
import { Text, View } from "react-native";

import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { Colors, Radii, Spacing, Typography, skillTint } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompanionMessageProps {
  /** The personalized message text to display */
  message: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays a personalized companion message with an avatar and name label.
 * Used on the home screen to greet the user with context from their learning history.
 */
export const CompanionMessage = React.memo(function CompanionMessage({
  message,
}: CompanionMessageProps) {
  if (!message) return null;

  // Parse bold spans: **text** → <Text style={{fontWeight:"700"}}>text</Text>
  const renderMessage = () => {
    const parts = message.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <Text key={i} style={{ fontWeight: "700" }}>
            {part.slice(2, -2)}
          </Text>
        );
      }
      return part;
    });
  };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Your companion says: ${message.replace(/\*\*/g, "")}`}
      style={{
        backgroundColor: skillTint(Colors.primary, 0.05),
        borderRadius: Radii.card,
        padding: Spacing.cardPadding,
        flexDirection: "row",
        gap: 12,
      }}
    >
      {/* Avatar */}
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: Colors.primary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: Colors.textOnDark,
            fontSize: Typography.bodySecondary.fontSize,
            fontWeight: "700",
          }}
        >
          C
        </Text>
      </View>

      {/* Text content */}
      <View className="flex-1">
        <Text
          style={{
            ...Typography.caption,
            color: Colors.primary,
            fontWeight: "700",
            marginBottom: 4,
          }}
        >
          Compagnon
        </Text>
        <Text style={{ ...Typography.bodySecondary, color: Colors.textPrimary }}>
          {renderMessage()}
        </Text>
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Skeleton placeholder matching CompanionMessage card dimensions.
 * Shown while briefing data is loading.
 */
export const CompanionMessageSkeleton = React.memo(function CompanionMessageSkeleton() {
  return (
    <View
      accessibilityLabel="Loading companion message"
      style={{
        backgroundColor: skillTint(Colors.primary, 0.05),
        borderRadius: Radii.card,
        padding: Spacing.cardPadding,
        flexDirection: "row",
        gap: 12,
      }}
    >
      {/* Avatar skeleton */}
      <SkeletonBar width={32} height={32} style={{ borderRadius: 16 }} />

      {/* Text skeleton */}
      <View className="flex-1" style={{ gap: 8 }}>
        <SkeletonBar width={80} height={13} />
        <SkeletonBar width="100%" height={14} />
        <SkeletonBar width="70%" height={14} />
      </View>
    </View>
  );
});
