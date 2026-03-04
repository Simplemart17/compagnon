/**
 * Multiple Choice Question Card
 *
 * Renders a single MCQ question with 4 options.
 * Shows correct/incorrect feedback after answering.
 */

import { View, Text, TouchableOpacity } from "react-native";

import type { MCQContent } from "@/src/types/exercise";

interface MCQCardProps {
  question: MCQContent;
  selectedAnswer: string | null;
  showResult: boolean;
  onSelect: (answerId: string) => void;
}

export function MCQCard({ question, selectedAnswer, showResult, onSelect }: MCQCardProps) {
  return (
    <View style={{ gap: 12 }}>
      {/* Question text */}
      <Text style={{ fontSize: 17, fontWeight: "600", color: "#1E3A5F", lineHeight: 24 }}>
        {question.question}
      </Text>

      {/* Options */}
      <View style={{ gap: 10 }}>
        {question.options.map((option, index) => {
          const isSelected = selectedAnswer === option.id;
          const isCorrect = option.isCorrect;

          let bgColor = "#FFFFFF";
          let borderColor = "#E0E0CE";
          let textColor = "#1E3A5F";

          if (showResult && isSelected && isCorrect) {
            bgColor = "#E8F5E9";
            borderColor = "#34C759";
            textColor = "#2E7D32";
          } else if (showResult && isSelected && !isCorrect) {
            bgColor = "#FFEBEE";
            borderColor = "#FF3B30";
            textColor = "#CC3333";
          } else if (showResult && isCorrect) {
            bgColor = "#E8F5E9";
            borderColor = "#34C759";
            textColor = "#2E7D32";
          } else if (isSelected) {
            bgColor = "#E3F2FD";
            borderColor = "#1E3A5F";
            textColor = "#1E3A5F";
          }

          const letter = String.fromCharCode(65 + index); // A, B, C, D

          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => !showResult && onSelect(option.id)}
              disabled={showResult}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: bgColor,
                borderRadius: 12,
                padding: 14,
                borderWidth: 1.5,
                borderColor,
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: isSelected ? borderColor : "#F0F0E8",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "700",
                    color: isSelected ? "#FFFFFF" : "#666",
                  }}
                >
                  {letter}
                </Text>
              </View>
              <Text
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: textColor,
                  fontWeight: isSelected ? "600" : "400",
                  lineHeight: 22,
                }}
              >
                {option.text}
              </Text>

              {/* Result icons */}
              {showResult && isSelected && isCorrect && (
                <Text style={{ fontSize: 18 }}>&#10003;</Text>
              )}
              {showResult && isSelected && !isCorrect && (
                <Text style={{ fontSize: 18, color: "#FF3B30" }}>&#10007;</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Explanation (shown after answering) */}
      {showResult && (
        <View
          style={{
            backgroundColor: "#F0F7FF",
            borderRadius: 12,
            padding: 14,
            borderLeftWidth: 3,
            borderLeftColor: "#1E3A5F",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#1E3A5F", marginBottom: 4 }}>
            Explanation
          </Text>
          <Text style={{ fontSize: 14, color: "#333", lineHeight: 20 }}>
            {question.explanation}
          </Text>
        </View>
      )}
    </View>
  );
}
