import React from "react";
import { View, Text } from "react-native";

import { Colors, Typography, Radii, skillTint } from "@/src/lib/design";

export interface SessionComparisonMetric {
  label: string;
  previous: string;
  current: string;
  direction: "up" | "down" | "same";
}

interface SessionComparisonProps {
  metrics: SessionComparisonMetric[];
}

function directionIndicator(direction: "up" | "down" | "same"): string {
  switch (direction) {
    case "up":
      return "\u2191";
    case "down":
      return "\u2193";
    case "same":
      return "=";
  }
}

function directionColor(direction: "up" | "down" | "same"): string {
  switch (direction) {
    case "up":
      return Colors.success;
    case "down":
      return Colors.error;
    case "same":
      return Colors.textTertiary;
  }
}

function SessionComparisonInner({ metrics }: SessionComparisonProps) {
  if (metrics.length === 0) return null;

  return (
    <View
      accessibilityRole="summary"
      style={{
        backgroundColor: skillTint(Colors.primary, 0.04),
        borderRadius: Radii.button,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text
        style={[Typography.caption, { fontWeight: "700", color: Colors.primary, marginBottom: 8 }]}
      >
        vs. Last Session
      </Text>
      {metrics.map((metric) => (
        <View
          key={metric.label}
          accessibilityLabel={`${metric.label}: changed from ${metric.previous} to ${metric.current}, ${metric.direction}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 4,
          }}
        >
          <Text style={Typography.caption}>{metric.label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={Typography.caption}>{metric.previous}</Text>
            <Text
              style={{
                ...Typography.caption,
                fontWeight: "700",
                color: directionColor(metric.direction),
              }}
            >
              {directionIndicator(metric.direction)}
            </Text>
            <Text
              style={[
                Typography.bodySecondary,
                { fontWeight: "700", color: directionColor(metric.direction) },
              ]}
            >
              {metric.current}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export const SessionComparison = React.memo(SessionComparisonInner);
