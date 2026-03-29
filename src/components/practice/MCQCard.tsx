/**
 * Multiple Choice Question Card
 *
 * Renders a single MCQ question with 4 options.
 * Shows correct/incorrect feedback after answering.
 */

import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import { hapticLight, hapticSuccess } from "@/src/lib/haptics";
import type { MCQContent } from "@/src/types/exercise";
import { Colors } from "@/src/lib/design";

interface MCQCardProps {
  question: MCQContent;
  selectedAnswer: string | null;
  showResult: boolean;
  onSelect: (answerId: string) => void;
}

export const MCQCard = React.memo(function MCQCard({
  question,
  selectedAnswer,
  showResult,
  onSelect,
}: MCQCardProps) {
  // Fire haptic feedback when results are revealed after selection
  const prevShowResult = useRef(showResult);
  useEffect(() => {
    if (showResult && !prevShowResult.current && selectedAnswer) {
      const correctOption = question.options.find((o) => o.isCorrect);
      if (selectedAnswer === correctOption?.id) {
        hapticSuccess();
      } else {
        hapticLight();
      }
    }
    prevShowResult.current = showResult;
  }, [showResult, selectedAnswer, question.options]);

  return (
    <View className="gap-3">
      {/* Question text */}
      <Text className="text-[17px] font-semibold leading-6 text-primary" accessibilityRole="text">
        {question.question}
      </Text>

      {/* Options */}
      <View className="gap-2.5" accessibilityRole="radiogroup">
        {question.options.map((option, index) => {
          const isSelected = selectedAnswer === option.id;
          const isCorrect = option.isCorrect;

          let bgColor: string = Colors.surfaceWhite;
          let borderColor: string = Colors.border;
          let textColor: string = Colors.textPrimary;

          if (showResult && isSelected && isCorrect) {
            bgColor = Colors.success10;
            borderColor = Colors.success;
            textColor = Colors.success;
          } else if (showResult && isSelected && !isCorrect) {
            bgColor = Colors.error10;
            borderColor = Colors.error;
            textColor = Colors.error;
          } else if (showResult && isCorrect) {
            bgColor = Colors.success10;
            borderColor = Colors.success;
            textColor = Colors.success;
          } else if (isSelected) {
            bgColor = Colors.primary5;
            borderColor = Colors.primary;
            textColor = Colors.textPrimary;
          }

          const letter = String.fromCharCode(65 + index); // A, B, C, D

          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => {
                if (!showResult) {
                  hapticLight();
                  onSelect(option.id);
                }
              }}
              disabled={showResult}
              accessibilityRole="radio"
              accessibilityLabel={`Option ${letter}: ${option.text}`}
              accessibilityState={{ selected: isSelected }}
              accessibilityHint={showResult ? undefined : "Double tap to select this answer"}
              className="flex-row items-center gap-3 rounded-xl p-3.5"
              style={{
                backgroundColor: bgColor,
                borderWidth: 1.5,
                borderColor,
              }}
            >
              <View
                className="h-8 w-8 items-center justify-center rounded-full"
                style={{
                  backgroundColor: isSelected ? borderColor : Colors.gray100,
                }}
              >
                <Text
                  className="text-sm font-bold"
                  style={{ color: isSelected ? Colors.surfaceWhite : Colors.gray600 }}
                >
                  {letter}
                </Text>
              </View>
              <Text
                className="flex-1 text-[15px] leading-[22px]"
                style={{
                  color: textColor,
                  fontWeight: isSelected ? "600" : "400",
                }}
              >
                {option.text}
              </Text>

              {/* Result icons */}
              {showResult && isSelected && isCorrect && <Text className="text-lg">&#10003;</Text>}
              {showResult && isSelected && !isCorrect && (
                <Text className="text-lg text-error">&#10007;</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Explanation (shown after answering) */}
      {showResult && (
        <View
          className="rounded-xl p-3.5"
          style={{
            backgroundColor: Colors.primary5,
            borderLeftWidth: 3,
            borderLeftColor: Colors.primary,
          }}
        >
          <Text className="mb-1 text-xs font-bold text-primary">Explanation</Text>
          <Text className="text-sm leading-5 text-primary">{question.explanation}</Text>
        </View>
      )}
    </View>
  );
});
