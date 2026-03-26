/**
 * Score Card Component
 *
 * Displays exercise results with score, correct/incorrect counts,
 * and a visual score indicator.
 */

import React, { useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import { hapticSuccess } from "@/src/lib/haptics";
import { Colors } from "@/src/lib/design";

interface ScoreCardProps {
  score: number;
  totalQuestions: number;
  correctCount: number;
  onRetry: () => void;
  onBack: () => void;
}

function getScoreColor(score: number): string {
  if (score >= 80) return Colors.success;
  if (score >= 60) return Colors.accent;
  return Colors.error;
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent!";
  if (score >= 80) return "Great job!";
  if (score >= 70) return "Good work!";
  if (score >= 60) return "Keep going!";
  if (score >= 50) return "Almost there!";
  return "Keep practicing!";
}

export const ScoreCard = React.memo(function ScoreCard({
  score,
  totalQuestions,
  correctCount,
  onRetry,
  onBack,
}: ScoreCardProps) {
  const color = getScoreColor(score);

  // Fire haptic when score is displayed
  useEffect(() => {
    hapticSuccess();
  }, []);

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
          backgroundColor: `${color}10`,
        }}
        accessibilityLabel={`${score} percent`}
      >
        <Text style={{ fontSize: 40, fontWeight: "800", color }}>{score}%</Text>
      </View>

      <Text className="text-[22px] font-bold text-primary">{getScoreLabel(score)}</Text>

      {/* Stats */}
      <View
        className="flex-row gap-6"
        accessibilityLabel={`${correctCount} correct, ${totalQuestions - correctCount} incorrect, ${totalQuestions} total`}
      >
        <View className="items-center">
          <Text className="text-[28px] font-extrabold text-success">{correctCount}</Text>
          <Text className="text-xs" style={{ color: Colors.gray700 }}>
            Correct
          </Text>
        </View>
        <View className="w-px bg-surface-300" />
        <View className="items-center">
          <Text className="text-[28px] font-extrabold text-error">
            {totalQuestions - correctCount}
          </Text>
          <Text className="text-xs" style={{ color: Colors.gray700 }}>
            Incorrect
          </Text>
        </View>
        <View className="w-px bg-surface-300" />
        <View className="items-center">
          <Text className="text-[28px] font-extrabold text-primary">{totalQuestions}</Text>
          <Text className="text-xs" style={{ color: Colors.gray700 }}>
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
