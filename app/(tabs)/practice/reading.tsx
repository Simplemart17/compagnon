/**
 * Reading Practice Screen
 *
 * AI generates a French reading passage with comprehension questions.
 * Features: Click-to-Explain (tap any highlighted word for French explanation),
 * progressive difficulty, passage types per CEFR level.
 */

import { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, Modal } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useExercise } from "@/src/hooks/use-exercise";
import { useAuthStore } from "@/src/store/auth-store";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { ScoreCard } from "@/src/components/practice/ScoreCard";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors, Shadows, Typography } from "@/src/lib/design";
import { OfflineFallback } from "@/src/components/common/OfflineFallback";

export default function ReadingScreen() {
  const router = useRouter();
  const exercise = useExercise();
  const profile = useAuthStore((s) => s.profile);

  const [answeredQuestions, setAnsweredQuestions] = useState<Set<number>>(new Set());
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [showPassage, setShowPassage] = useState(true);

  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const handleGenerate = useCallback(async () => {
    await exercise.generateExercise("reading", cefrLevel);
  }, [exercise, cefrLevel]);

  const handleAnswer = useCallback(
    (answerId: string) => {
      exercise.answerQuestion(exercise.currentQuestionIndex, answerId);
      setAnsweredQuestions((prev) => new Set(prev).add(exercise.currentQuestionIndex));
    },
    [exercise]
  );

  const handleFinish = useCallback(() => {
    void exercise.calculateScore();
  }, [exercise]);

  const handleWordTap = useCallback(
    (word: string) => {
      // Check if this word has an explanation
      const cleanWord = word.replace(/[.,;:!?'"()]/g, "").toLowerCase();
      if (exercise.exercise?.wordExplanations?.[cleanWord]) {
        setSelectedWord(cleanWord);
      }
    },
    [exercise.exercise]
  );

  // Pre-exercise
  if (!exercise.exercise && !exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">&#x1F4D6;</Text>
        <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
          Reading Practice
        </Text>
        <Text className="text-sm text-center mb-8 leading-5" style={{ color: Colors.gray700 }}>
          Read a French passage and answer comprehension questions.
          {"\n"}Tap highlighted words for explanations in French!
        </Text>
        {exercise.offlineFallback ? (
          <OfflineFallback onDismiss={exercise.clearOfflineFallback} />
        ) : exercise.error ? (
          <>
            <Text className="text-error text-[13px] mb-4 text-center">{exercise.error}</Text>
            <View className="flex-row gap-3 w-full px-4">
              <TouchableOpacity
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                className="flex-1 rounded-xl py-3.5 items-center"
                style={{ backgroundColor: Colors.gray100 }}
              >
                <Text className="text-[15px] font-bold" style={{ color: Colors.primary }}>
                  Back
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGenerate}
                accessibilityRole="button"
                accessibilityLabel="Retry generating exercise"
                className="flex-1 bg-primary rounded-xl py-3.5 items-center"
              >
                <Text className="text-[15px] font-bold text-white">Retry</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity
            onPress={handleGenerate}
            accessibilityRole="button"
            accessibilityLabel="Generate exercise"
            className="bg-primary rounded-xl px-8 py-4"
          >
            <Text className="text-white text-base font-bold">Generate Exercise</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Loading
  if (exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface p-5 pt-10">
        {/* Passage skeleton */}
        <Animated.View
          entering={FadeInDown.duration(300)}
          className="bg-white rounded-2xl p-5 mb-5"
          style={{ ...Shadows.card }}
        >
          <View className="h-3 bg-surface-200 rounded-md mb-2" style={{ width: "90%" }} />
          <View className="h-3 bg-surface-200 rounded-md mb-2" style={{ width: "80%" }} />
          <View className="h-3 bg-surface-200 rounded-md mb-2" style={{ width: "85%" }} />
          <View className="h-3 bg-surface-200 rounded-md" style={{ width: "60%" }} />
        </Animated.View>
        {/* Question skeletons */}
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            entering={FadeInDown.delay(100 + i * 80).duration(300)}
            className="bg-white rounded-2xl p-5 mb-3"
            style={{ ...Shadows.card }}
          >
            <View className="h-4 bg-surface-200 rounded-md" style={{ width: `${75 - i * 10}%` }} />
            <View className="flex-row gap-2 mt-4">
              {[1, 2, 3, 4].map((j) => (
                <View key={j} className="h-10 flex-1 bg-surface-200 rounded-lg" />
              ))}
            </View>
          </Animated.View>
        ))}
        <Text className="text-center mt-4" style={Typography.caption}>
          Generating passage...
        </Text>
      </View>
    );
  }

  // Score screen
  if (exercise.score !== null) {
    const totalQuestions = exercise.exercise?.questions.length ?? 0;
    let correctCount = 0;
    for (let i = 0; i < totalQuestions; i++) {
      const answer = exercise.answers[i];
      const correct = exercise.exercise?.questions[i]?.options.find((o) => o.isCorrect);
      if (answer === correct?.id) correctCount++;
    }

    return (
      <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ padding: 20 }}>
        <ScoreCard
          score={exercise.score}
          totalQuestions={totalQuestions}
          correctCount={correctCount}
          onRetry={() => {
            exercise.reset();
            setAnsweredQuestions(new Set());
            setShowPassage(true);
          }}
          onBack={() => router.back()}
        />
      </ScrollView>
    );
  }

  // Exercise in progress
  const currentQuestion = exercise.exercise?.questions[exercise.currentQuestionIndex];
  const totalQuestions = exercise.exercise?.questions.length ?? 0;
  const isAnswered = answeredQuestions.has(exercise.currentQuestionIndex);
  const explainableWords = exercise.exercise?.wordExplanations
    ? Object.keys(exercise.exercise.wordExplanations)
    : [];

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Passage */}
      <TouchableOpacity
        onPress={() => setShowPassage(!showPassage)}
        className="bg-white rounded-2xl p-5 mb-5 border border-surface-300"
        accessibilityRole="button"
        accessibilityLabel={
          showPassage
            ? "Reading passage, expanded. Tap to collapse"
            : "Reading passage, collapsed. Tap to expand"
        }
      >
        <View
          className="flex-row justify-between items-center"
          style={{ marginBottom: showPassage ? 12 : 0 }}
        >
          <Text className="text-[13px] font-bold text-primary">Reading Passage</Text>
          <Text className="text-xs" style={{ color: Colors.gray500 }}>
            {showPassage ? "Tap to hide" : "Tap to show"}
          </Text>
        </View>

        {showPassage && exercise.exercise?.passage && (
          <Text className="text-[15px] text-primary leading-6">
            {exercise.exercise.passage.split(/(\s+)/).map((word, idx) => {
              const cleanWord = word.replace(/[.,;:!?'"()]/g, "").toLowerCase();
              const isExplainable = explainableWords.includes(cleanWord);

              if (isExplainable) {
                return (
                  <Text
                    key={idx}
                    onPress={() => handleWordTap(word)}
                    accessibilityRole="link"
                    accessibilityLabel={`${cleanWord}, tap for explanation`}
                    accessibilityHint="Double tap to see the explanation in French"
                    style={{
                      color: Colors.textPrimary,
                      fontWeight: "600",
                      textDecorationLine: "underline",
                      textDecorationStyle: "dotted",
                    }}
                  >
                    {word}
                  </Text>
                );
              }
              return <Text key={idx}>{word}</Text>;
            })}
          </Text>
        )}
      </TouchableOpacity>

      {/* Info about tap-to-explain */}
      {explainableWords.length > 0 && showPassage && (
        <Text className="text-[11px] text-center mb-4 italic" style={{ color: Colors.gray500 }}>
          Tap underlined words for explanations in French
        </Text>
      )}

      {/* Question counter */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-[13px]" style={{ color: Colors.gray700 }}>
          Question {exercise.currentQuestionIndex + 1} of {totalQuestions}
        </Text>
        <Text className="text-[13px]" style={{ color: Colors.gray700 }}>
          {answeredQuestions.size}/{totalQuestions} answered
        </Text>
      </View>

      {/* MCQ */}
      {currentQuestion && (
        <MCQCard
          question={currentQuestion}
          selectedAnswer={exercise.answers[exercise.currentQuestionIndex] ?? null}
          showResult={isAnswered}
          onSelect={handleAnswer}
        />
      )}

      {/* Navigation */}
      <View className="flex-row justify-between mt-6 gap-3">
        <TouchableOpacity
          onPress={exercise.previousQuestion}
          disabled={exercise.currentQuestionIndex === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous question"
          accessibilityState={{ disabled: exercise.currentQuestionIndex === 0 }}
          className="flex-1 rounded-xl py-3.5 items-center"
          style={{
            backgroundColor: exercise.currentQuestionIndex === 0 ? Colors.border : Colors.gray100,
          }}
        >
          <Text
            className="text-[15px] font-semibold"
            style={{
              color: exercise.currentQuestionIndex === 0 ? Colors.gray500 : Colors.primary,
            }}
          >
            Previous
          </Text>
        </TouchableOpacity>

        {exercise.currentQuestionIndex < totalQuestions - 1 ? (
          <TouchableOpacity
            onPress={exercise.nextQuestion}
            accessibilityRole="button"
            accessibilityLabel="Next question"
            className="flex-1 bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-white">Next</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleFinish}
            disabled={answeredQuestions.size < totalQuestions}
            accessibilityRole="button"
            accessibilityLabel="Finish exercise"
            accessibilityState={{ disabled: answeredQuestions.size < totalQuestions }}
            accessibilityHint={
              answeredQuestions.size < totalQuestions ? "Answer all questions to finish" : undefined
            }
            className="flex-1 rounded-xl py-3.5 items-center"
            style={{
              backgroundColor:
                answeredQuestions.size < totalQuestions ? Colors.border : Colors.accent,
            }}
          >
            <Text
              className="text-[15px] font-bold"
              style={{
                color: answeredQuestions.size < totalQuestions ? Colors.gray500 : Colors.textOnDark,
              }}
            >
              Finish
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Word Explanation Modal */}
      <Modal
        visible={selectedWord !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedWord(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSelectedWord(null)}
          accessibilityLabel="Close word explanation"
          className="flex-1 justify-center p-8"
          style={{ backgroundColor: Colors.overlayDark }}
        >
          <View className="bg-white rounded-2xl p-6" accessibilityRole="alert">
            <Text className="text-[22px] font-extrabold text-primary mb-2">{selectedWord}</Text>
            <Text className="text-[15px] text-primary leading-6 italic">
              {selectedWord && exercise.exercise?.wordExplanations?.[selectedWord]}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedWord(null)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="mt-4 bg-surface-200 rounded-[10px] py-2.5 items-center"
            >
              <Text className="font-semibold text-primary">Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}
