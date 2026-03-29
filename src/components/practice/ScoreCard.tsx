/**
 * Score Card Component
 *
 * Displays exercise results with score, correct/incorrect counts,
 * and a visual score indicator.
 */

import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import { Colors, Typography, skillTint } from "@/src/lib/design";
import { fireScoreHaptic, getScoreColor, getScoreLabel } from "@/src/lib/score-framing";

interface ScoreCardProps {
  score: number;
  totalQuestions: number;
  correctCount: number;
  onRetry: () => void;
  onBack: () => void;
}

export const ScoreCard = React.memo(function ScoreCard({
  score,
  totalQuestions,
  correctCount,
  onRetry,
  onBack,
}: ScoreCardProps) {
  const color = getScoreColor(score);
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    if (!hapticFiredRef.current) {
      hapticFiredRef.current = true;
      fireScoreHaptic(score);
    }
  }, [score]);

  return (
    <View
      className="items-center gap-6 p-6"
      accessibilityLabel={`Score: ${score} percent. ${correctCount} correct out of ${totalQuestions}. ${getScoreLabel(score)}`}
    >
      {/* Score circle */}
      <View
        className="h-[140px] w-[140px] items-center justify-center rounded-full"
        style={{
          borderWidth: 6,
          borderColor: color,
          backgroundColor: skillTint(color, 16 / 255),
        }}
        accessibilityLabel={`${score} percent`}
      >
        <Text style={{ ...Typography.scoreDisplay, color }}>{score}%</Text>
      </View>

      <Text style={{ ...Typography.subsectionHeader, color: Colors.primary }}>
        {getScoreLabel(score)}
      </Text>

      {/* Stats */}
      <View
        className="flex-row gap-6"
        accessibilityLabel={`${correctCount} correct, ${totalQuestions - correctCount} incorrect, ${totalQuestions} total`}
      >
        <View className="items-center">
          <Text style={{ ...Typography.statNumber, color: Colors.success }}>{correctCount}</Text>
          <Text className="text-xs" style={{ color: Colors.textSecondary }}>
            Correct
          </Text>
        </View>
        <View className="w-px bg-surface-300" />
        <View className="items-center">
          <Text style={{ ...Typography.statNumber, color: Colors.error }}>
            {totalQuestions - correctCount}
          </Text>
          <Text className="text-xs" style={{ color: Colors.textSecondary }}>
            Incorrect
          </Text>
        </View>
        <View className="w-px bg-surface-300" />
        <View className="items-center">
          <Text style={{ ...Typography.statNumber, color: Colors.primary }}>{totalQuestions}</Text>
          <Text className="text-xs" style={{ color: Colors.textSecondary }}>
            Total
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View className="w-full flex-row gap-3">
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="flex-1 items-center rounded-xl bg-surface-200 py-3.5"
        >
          <Text className="text-[15px] font-semibold text-primary">Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          className="flex-1 items-center rounded-xl bg-primary py-3.5"
        >
          <Text className="text-[15px] font-semibold text-white">Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
