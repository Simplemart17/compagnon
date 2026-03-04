/**
 * Correction Bubble Component
 *
 * Shows "You said X → A native would say Y" with tap for explanation.
 * Dark-mode card design with animated entry.
 */

import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { Correction } from "@/src/types/conversation";

interface CorrectionBubbleProps {
  corrections: Correction[];
  compact?: boolean;
  theme?: "dark" | "light";
}

const DARK_CATEGORY: Record<string, { bg: string; text: string; label: string }> = {
  grammar: { bg: "rgba(255,59,48,0.2)", text: "#FF6B6B", label: "Grammar" },
  pronunciation: { bg: "rgba(90,164,207,0.2)", text: "#7DBFE8", label: "Pronunciation" },
  vocabulary: { bg: "rgba(245,166,35,0.2)", text: "#F5A623", label: "Vocabulary" },
  register: { bg: "rgba(52,199,89,0.2)", text: "#5DD67A", label: "Register" },
};

export function CorrectionBubble({
  corrections,
  compact = false,
  theme: _theme = "dark",
}: CorrectionBubbleProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const translateY = useSharedValue(30);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (corrections.length > 0) {
      opacity.value = withTiming(1, { duration: 300 });
      translateY.value = withSpring(0, { stiffness: 220, damping: 24 });
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(30, { duration: 200 });
    }
  }, [corrections.length, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (corrections.length === 0) return null;

  // compact mode shows at most 2 corrections
  const visibleCorrections = compact ? corrections.slice(0, 2) : corrections;

  const categoryStyles = DARK_CATEGORY;

  return (
    <Reanimated.View style={animStyle}>
      <View
        style={{
          backgroundColor: "rgba(255,255,255,0.09)",
          borderRadius: 20,
          borderWidth: 1,
          borderColor: "rgba(245,166,35,0.3)",
          padding: 14,
        }}
      >
        {/* Top accent marker */}
        <View
          style={{
            width: 40,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: "rgba(245,166,35,0.7)",
            alignSelf: "center",
            marginBottom: 10,
          }}
        />

        {/* Section label */}
        <Text
          style={{
            fontSize: 10,
            fontWeight: "700",
            color: "rgba(245,166,35,0.75)",
            textTransform: "uppercase",
            letterSpacing: 0.8,
            marginBottom: 8,
          }}
        >
          Compagnon noticed
        </Text>

        {visibleCorrections.map((correction, index) => {
          const catStyle = categoryStyles[correction.category] ?? categoryStyles.grammar;
          const isExpanded = expandedIndex === index;

          return (
            <TouchableOpacity
              key={`${correction.original}-${index}`}
              onPress={() => setExpandedIndex(isExpanded ? null : index)}
              activeOpacity={0.7}
              style={{
                marginBottom: index < visibleCorrections.length - 1 ? 10 : 0,
              }}
            >
              {/* Category badge */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 5,
                }}
              >
                <View
                  style={{
                    backgroundColor: catStyle.bg,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: "600",
                      color: catStyle.text,
                    }}
                  >
                    {catStyle.label}
                  </Text>
                </View>
              </View>

              {/* Original → Corrected */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontStyle: "italic",
                    color: "rgba(255,107,107,0.85)",
                  }}
                >
                  {correction.original}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.3)",
                    marginHorizontal: 8,
                  }}
                >
                  {"\u2192"}
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "700",
                    color: "#34C759",
                  }}
                >
                  {correction.corrected}
                </Text>
              </View>

              {/* Explanation (expandable) */}
              {isExpanded && (
                <Text
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.55)",
                    marginTop: 5,
                    lineHeight: 18,
                    fontStyle: "italic",
                  }}
                >
                  {correction.explanation}
                </Text>
              )}

              {!isExpanded && (
                <Text
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.25)",
                    marginTop: 3,
                  }}
                >
                  Tap for explanation
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </Reanimated.View>
  );
}
