/**
 * Reading Practice Screen
 *
 * AI generates a French reading passage with comprehension questions.
 * Features: Click-to-Explain (tap any highlighted word for French explanation),
 * progressive difficulty, passage types per CEFR level.
 */

import { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from "react-native";
import { useRouter } from "expo-router";

import { useExercise } from "@/src/hooks/use-exercise";
import { useAuthStore } from "@/src/store/auth-store";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { ScoreCard } from "@/src/components/practice/ScoreCard";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors } from "@/src/lib/design";

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
        <Text className="text-[22px] font-bold text-primary mb-2">Reading Practice</Text>
        <Text className="text-sm text-[#4A5568] text-center mb-8 leading-5">
          Read a French passage and answer comprehension questions.
          {"\n"}Tap highlighted words for explanations in French!
        </Text>
        <TouchableOpacity onPress={handleGenerate} className="bg-primary rounded-xl px-8 py-4">
          <Text className="text-white text-base font-bold">Generate Exercise</Text>
        </TouchableOpacity>
        {exercise.error && (
          <Text className="text-error text-[13px] mt-4 text-center">{exercise.error}</Text>
        )}
      </View>
    );
  }

  // Loading
  if (exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-[#4A5568] mt-4 text-sm">Generating passage...</Text>
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
      >
        <View
          className="flex-row justify-between items-center"
          style={{ marginBottom: showPassage ? 12 : 0 }}
        >
          <Text className="text-[13px] font-bold text-primary">Reading Passage</Text>
          <Text className="text-xs text-[#94A3B8]">
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
        <Text className="text-[11px] text-[#94A3B8] text-center mb-4 italic">
          Tap underlined words for explanations in French
        </Text>
      )}

      {/* Question counter */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-[13px] text-[#4A5568]">
          Question {exercise.currentQuestionIndex + 1} of {totalQuestions}
        </Text>
        <Text className="text-[13px] text-[#4A5568]">
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
          className="flex-1 rounded-xl py-3.5 items-center"
          style={{
            backgroundColor: exercise.currentQuestionIndex === 0 ? "#E0E0CE" : "#F0F0E8",
          }}
        >
          <Text
            className="text-[15px] font-semibold"
            style={{
              color: exercise.currentQuestionIndex === 0 ? "#999" : "#1E3A5F",
            }}
          >
            Previous
          </Text>
        </TouchableOpacity>

        {exercise.currentQuestionIndex < totalQuestions - 1 ? (
          <TouchableOpacity
            onPress={exercise.nextQuestion}
            className="flex-1 bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-white">Next</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleFinish}
            disabled={answeredQuestions.size < totalQuestions}
            className="flex-1 rounded-xl py-3.5 items-center"
            style={{
              backgroundColor: answeredQuestions.size < totalQuestions ? "#E0E0CE" : "#F5A623",
            }}
          >
            <Text
              className="text-[15px] font-bold"
              style={{
                color: answeredQuestions.size < totalQuestions ? "#999" : "#FFFFFF",
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
          className="flex-1 justify-center p-8"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <View className="bg-white rounded-2xl p-6">
            <Text className="text-[22px] font-extrabold text-primary mb-2">{selectedWord}</Text>
            <Text className="text-[15px] text-primary leading-6 italic">
              {selectedWord && exercise.exercise?.wordExplanations?.[selectedWord]}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedWord(null)}
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
