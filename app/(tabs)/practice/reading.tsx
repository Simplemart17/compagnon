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
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 64, marginBottom: 16 }}>&#x1F4D6;</Text>
        <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F", marginBottom: 8 }}>
          Reading Practice
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "#666",
            textAlign: "center",
            marginBottom: 32,
            lineHeight: 20,
          }}
        >
          Read a French passage and answer comprehension questions.
          {"\n"}Tap highlighted words for explanations in French!
        </Text>
        <TouchableOpacity
          onPress={handleGenerate}
          style={{
            backgroundColor: "#1E3A5F",
            borderRadius: 12,
            paddingHorizontal: 32,
            paddingVertical: 16,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
            Generate Exercise
          </Text>
        </TouchableOpacity>
        {exercise.error && (
          <Text style={{ color: "#FF3B30", fontSize: 13, marginTop: 16, textAlign: "center" }}>
            {exercise.error}
          </Text>
        )}
      </View>
    );
  }

  // Loading
  if (exercise.isGenerating) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#1E3A5F" />
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>Generating passage...</Text>
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
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F5F5F0" }}
        contentContainerStyle={{ padding: 20 }}
      >
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
      style={{ flex: 1, backgroundColor: "#F5F5F0" }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Passage */}
      <TouchableOpacity
        onPress={() => setShowPassage(!showPassage)}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: "#E0E0CE",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: showPassage ? 12 : 0,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#1E3A5F" }}>Reading Passage</Text>
          <Text style={{ fontSize: 12, color: "#999" }}>
            {showPassage ? "Tap to hide" : "Tap to show"}
          </Text>
        </View>

        {showPassage && exercise.exercise?.passage && (
          <Text style={{ fontSize: 15, color: "#333", lineHeight: 24 }}>
            {exercise.exercise.passage.split(/(\s+)/).map((word, idx) => {
              const cleanWord = word.replace(/[.,;:!?'"()]/g, "").toLowerCase();
              const isExplainable = explainableWords.includes(cleanWord);

              if (isExplainable) {
                return (
                  <Text
                    key={idx}
                    onPress={() => handleWordTap(word)}
                    style={{
                      color: "#1E3A5F",
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
        <Text
          style={{
            fontSize: 11,
            color: "#999",
            textAlign: "center",
            marginBottom: 16,
            fontStyle: "italic",
          }}
        >
          Tap underlined words for explanations in French
        </Text>
      )}

      {/* Question counter */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 13, color: "#666" }}>
          Question {exercise.currentQuestionIndex + 1} of {totalQuestions}
        </Text>
        <Text style={{ fontSize: 13, color: "#666" }}>
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
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 24,
          gap: 12,
        }}
      >
        <TouchableOpacity
          onPress={exercise.previousQuestion}
          disabled={exercise.currentQuestionIndex === 0}
          style={{
            flex: 1,
            backgroundColor: exercise.currentQuestionIndex === 0 ? "#E0E0CE" : "#F0F0E8",
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: 15,
              fontWeight: "600",
              color: exercise.currentQuestionIndex === 0 ? "#999" : "#1E3A5F",
            }}
          >
            Previous
          </Text>
        </TouchableOpacity>

        {exercise.currentQuestionIndex < totalQuestions - 1 ? (
          <TouchableOpacity
            onPress={exercise.nextQuestion}
            style={{
              flex: 1,
              backgroundColor: "#1E3A5F",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#FFFFFF" }}>Next</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleFinish}
            disabled={answeredQuestions.size < totalQuestions}
            style={{
              flex: 1,
              backgroundColor: answeredQuestions.size < totalQuestions ? "#E0E0CE" : "#F5A623",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
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
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            padding: 32,
          }}
        >
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 24,
            }}
          >
            <Text
              style={{
                fontSize: 22,
                fontWeight: "800",
                color: "#1E3A5F",
                marginBottom: 8,
              }}
            >
              {selectedWord}
            </Text>
            <Text
              style={{
                fontSize: 15,
                color: "#333",
                lineHeight: 24,
                fontStyle: "italic",
              }}
            >
              {selectedWord && exercise.exercise?.wordExplanations?.[selectedWord]}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedWord(null)}
              style={{
                marginTop: 16,
                backgroundColor: "#F0F0E8",
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "600", color: "#1E3A5F" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}
