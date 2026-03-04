/**
 * Correction Bubble Component
 *
 * Shows "You said X -> A native would say Y" with tap for explanation.
 * Dark-mode card design with animated entry.
 */

import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { Correction } from "@/src/types/conversation";
import { Colors } from "@/src/lib/design";

interface CorrectionBubbleProps {
  corrections: Correction[];
  compact?: boolean;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  grammar: { bg: "rgba(255,59,48,0.2)", text: Colors.error, label: "Grammar" },
  pronunciation: { bg: "rgba(90,164,207,0.2)", text: "#7DBFE8", label: "Pronunciation" },
  vocabulary: { bg: "rgba(245,166,35,0.2)", text: Colors.accent, label: "Vocabulary" },
  register: { bg: "rgba(52,199,89,0.2)", text: Colors.success, label: "Register" },
};

export const CorrectionBubble = React.memo(function CorrectionBubble({
  corrections,
  compact = false,
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

  const categoryStyles = CATEGORY_STYLES;

  return (
    <Reanimated.View style={animStyle}>
      <View
        className="rounded-[20px] border p-3.5"
        style={{
          backgroundColor: "rgba(255,255,255,0.09)",
          borderColor: "rgba(245,166,35,0.3)",
        }}
      >
        {/* Top accent marker */}
        <View
          className="mb-2.5 h-[3px] w-10 self-center rounded-sm"
          style={{ backgroundColor: "rgba(245,166,35,0.7)" }}
        />

        {/* Section label */}
        <Text
          className="mb-2 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "rgba(245,166,35,0.75)" }}
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
              <View className="mb-1.5 flex-row items-center">
                <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: catStyle.bg }}>
                  <Text className="text-[9px] font-semibold" style={{ color: catStyle.text }}>
                    {catStyle.label}
                  </Text>
                </View>
              </View>

              {/* Original -> Corrected */}
              <View className="flex-row flex-wrap items-center">
                <Text className="text-sm italic" style={{ color: "rgba(255,107,107,0.85)" }}>
                  {correction.original}
                </Text>
                <Text className="mx-2 text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                  {"\u2192"}
                </Text>
                <Text className="text-sm font-bold text-success">{correction.corrected}</Text>
              </View>

              {/* Explanation (expandable) */}
              {isExpanded && (
                <Text
                  className="mt-1.5 text-xs italic leading-[18px]"
                  style={{ color: "rgba(255,255,255,0.55)" }}
                >
                  {correction.explanation}
                </Text>
              )}

              {!isExpanded && (
                <Text className="mt-1 text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                  Tap for explanation
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </Reanimated.View>
  );
});
