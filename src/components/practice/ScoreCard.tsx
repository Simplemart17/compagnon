/**
 * Score Card Component
 *
 * Displays exercise results with score, correct/incorrect counts,
 * and a visual score indicator.
 */

import { View, Text, TouchableOpacity } from "react-native";

interface ScoreCardProps {
  score: number;
  totalQuestions: number;
  correctCount: number;
  onRetry: () => void;
  onBack: () => void;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#34C759";
  if (score >= 60) return "#F5A623";
  return "#FF3B30";
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent!";
  if (score >= 80) return "Great job!";
  if (score >= 70) return "Good work!";
  if (score >= 60) return "Keep going!";
  if (score >= 50) return "Almost there!";
  return "Keep practicing!";
}

export function ScoreCard({
  score,
  totalQuestions,
  correctCount,
  onRetry,
  onBack,
}: ScoreCardProps) {
  const color = getScoreColor(score);

  return (
    <View style={{ alignItems: "center", padding: 24, gap: 24 }}>
      {/* Score circle */}
      <View
        style={{
          width: 140,
          height: 140,
          borderRadius: 70,
          borderWidth: 6,
          borderColor: color,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: `${color}10`,
        }}
      >
        <Text style={{ fontSize: 40, fontWeight: "800", color }}>{score}%</Text>
      </View>

      <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F" }}>
        {getScoreLabel(score)}
      </Text>

      {/* Stats */}
      <View style={{ flexDirection: "row", gap: 24 }}>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: "#34C759" }}>{correctCount}</Text>
          <Text style={{ fontSize: 12, color: "#666" }}>Correct</Text>
        </View>
        <View
          style={{
            width: 1,
            backgroundColor: "#E0E0CE",
          }}
        />
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: "#FF3B30" }}>
            {totalQuestions - correctCount}
          </Text>
          <Text style={{ fontSize: 12, color: "#666" }}>Incorrect</Text>
        </View>
        <View
          style={{
            width: 1,
            backgroundColor: "#E0E0CE",
          }}
        />
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: "#1E3A5F" }}>
            {totalQuestions}
          </Text>
          <Text style={{ fontSize: 12, color: "#666" }}>Total</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
        <TouchableOpacity
          onPress={onBack}
          style={{
            flex: 1,
            backgroundColor: "#F0F0E8",
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#1E3A5F" }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRetry}
          style={{
            flex: 1,
            backgroundColor: "#1E3A5F",
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#FFFFFF" }}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
