/**
 * Grammar & Vocabulary Practice Screen
 *
 * MCQ exercises matching TCF "Maitrise des structures" format.
 * Topics: verb conjugation, tenses, prepositions, pronouns, articles.
 * Each wrong answer triggers an AI explanation.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";

import { useExercise } from "@/src/hooks/use-exercise";
import { useAuthStore } from "@/src/store/auth-store";
import {
  generateMicroDrill,
  resolveError,
  type MicroDrill,
  type ErrorType,
} from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { ScoreCard } from "@/src/components/practice/ScoreCard";
import type { CEFRLevel } from "@/src/types/cefr";

export default function GrammarScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    errorId?: string;
    errorType?: string;
    errorDescription?: string;
  }>();
  const exercise = useExercise();
  const profile = useAuthStore((s) => s.profile);

  const [answeredQuestions, setAnsweredQuestions] = useState<Set<number>>(new Set());

  // Micro-drill state (when navigated from "Fix This Mistake")
  const [microDrill, setMicroDrill] = useState<MicroDrill | null>(null);
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillAnswers, setDrillAnswers] = useState<Record<number, number>>({});
  const [drillRevealed, setDrillRevealed] = useState<Set<number>>(new Set());
  const [drillLoading, setDrillLoading] = useState(false);
  const drillGenerated = useRef(false);

  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  // Auto-generate micro-drill when navigated with error context
  useEffect(() => {
    if (params.errorId && params.errorDescription && !drillGenerated.current) {
      drillGenerated.current = true;
      setDrillLoading(true);
      void generateMicroDrill(
        {
          id: params.errorId,
          user_id: "",
          error_type: (params.errorType ?? "grammar") as ErrorType,
          error_description: params.errorDescription,
          occurrences: 3,
          last_occurred: new Date().toISOString(),
          resolved: false,
          created_at: new Date().toISOString(),
        },
        cefrLevel
      )
        .then((drill) => setMicroDrill(drill))
        .catch((err) => captureError(err, "micro-drill-generation"))
        .finally(() => setDrillLoading(false));
    }
  }, [params.errorId, params.errorDescription, params.errorType, cefrLevel]);

  const handleGenerate = useCallback(async () => {
    setMicroDrill(null); // Clear micro-drill if switching to regular exercise
    await exercise.generateExercise("grammar", cefrLevel);
  }, [exercise, cefrLevel]);

  const handleAnswer = useCallback(
    (answerId: string) => {
      exercise.answerQuestion(exercise.currentQuestionIndex, answerId);
      setAnsweredQuestions((prev) => new Set(prev).add(exercise.currentQuestionIndex));
    },
    [exercise]
  );

  const handleFinish = useCallback(() => {
    exercise.calculateScore();
  }, [exercise]);

  // Micro-drill loading
  if (drillLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#F5A623" />
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>
          Generating targeted drill...
        </Text>
      </View>
    );
  }

  // Micro-drill UI (targeted error practice)
  if (microDrill) {
    const drillQuestion = microDrill.questions[drillIndex];
    const isLastDrill = drillIndex >= microDrill.questions.length - 1;
    const isDrillRevealed = drillRevealed.has(drillIndex);
    const drillCorrect = Object.entries(drillAnswers).filter(
      ([idx, ans]) => ans === microDrill.questions[Number(idx)]?.correctIndex
    ).length;
    const allDrillAnswered = Object.keys(drillAnswers).length === microDrill.questions.length;

    // Drill complete
    if (allDrillAnswered && isLastDrill && isDrillRevealed) {
      const allCorrect = drillCorrect === microDrill.questions.length;
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: "#F5F5F0" }}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        >
          <View style={{ alignItems: "center", paddingTop: 40 }}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>
              {allCorrect ? "\u2705" : "\uD83D\uDCAA"}
            </Text>
            <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F", marginBottom: 8 }}>
              {allCorrect ? "Parfait !" : "Bon travail !"}
            </Text>
            <Text style={{ fontSize: 14, color: "#666", textAlign: "center", marginBottom: 8 }}>
              {drillCorrect}/{microDrill.questions.length} correct
            </Text>
            <View
              style={{
                backgroundColor: "rgba(245,166,35,0.1)",
                borderRadius: 12,
                padding: 16,
                marginVertical: 16,
                width: "100%",
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#F5A623", marginBottom: 6 }}>
                Tip
              </Text>
              <Text style={{ fontSize: 14, color: "#333", lineHeight: 20 }}>{microDrill.tip}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 16, width: "100%" }}>
              <TouchableOpacity
                onPress={() => {
                  if (allCorrect && params.errorId) {
                    resolveError(params.errorId).catch((err) => captureError(err, "resolve-error"));
                  }
                  router.back();
                }}
                style={{
                  flex: 1,
                  backgroundColor: "#1E3A5F",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGenerate}
                style={{
                  flex: 1,
                  backgroundColor: "#F5A623",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
                  Full Exercise
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F5F5F0" }}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {/* Drill header */}
        <View
          style={{
            backgroundColor: "rgba(245,166,35,0.1)",
            borderRadius: 16,
            padding: 16,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: "rgba(245,166,35,0.3)",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#1E3A5F", marginBottom: 4 }}>
            {microDrill.title}
          </Text>
          <Text style={{ fontSize: 13, color: "#666", lineHeight: 19 }}>
            {microDrill.explanation}
          </Text>
        </View>

        {/* Drill progress */}
        <Text style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
          Question {drillIndex + 1} of {microDrill.questions.length}
        </Text>

        {/* Drill question */}
        {drillQuestion && (
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 20,
              borderWidth: 1,
              borderColor: "#E0E0CE",
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: "#1E3A5F",
                marginBottom: 16,
                lineHeight: 24,
              }}
            >
              {drillQuestion.question}
            </Text>
            {drillQuestion.options.map((option, optIdx) => {
              const isSelected = drillAnswers[drillIndex] === optIdx;
              const isCorrect = optIdx === drillQuestion.correctIndex;
              const showColor = isDrillRevealed;
              let bgColor = "#F5F5F0";
              let borderColor = "#E0E0CE";
              if (showColor && isCorrect) {
                bgColor = "rgba(52,199,89,0.1)";
                borderColor = "#34C759";
              } else if (showColor && isSelected && !isCorrect) {
                bgColor = "rgba(255,59,48,0.1)";
                borderColor = "#FF3B30";
              } else if (isSelected && !showColor) {
                bgColor = "rgba(30,58,95,0.1)";
                borderColor = "#1E3A5F";
              }

              return (
                <TouchableOpacity
                  key={optIdx}
                  onPress={() => {
                    if (isDrillRevealed) return;
                    setDrillAnswers((prev) => ({ ...prev, [drillIndex]: optIdx }));
                    setDrillRevealed((prev) => new Set(prev).add(drillIndex));
                  }}
                  style={{
                    backgroundColor: bgColor,
                    borderWidth: 1,
                    borderColor,
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontSize: 15, color: "#333" }}>{option}</Text>
                </TouchableOpacity>
              );
            })}
            {isDrillRevealed && (
              <View
                style={{
                  backgroundColor: "rgba(30,58,95,0.05)",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 8,
                }}
              >
                <Text style={{ fontSize: 13, color: "#666", lineHeight: 19 }}>
                  {drillQuestion.explanation}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Drill navigation */}
        {isDrillRevealed && !isLastDrill && (
          <TouchableOpacity
            onPress={() => setDrillIndex((prev) => prev + 1)}
            style={{
              backgroundColor: "#1E3A5F",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
              marginTop: 20,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "600" }}>Next</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

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
        <Text style={{ fontSize: 64, marginBottom: 16 }}>&#x1F9E0;</Text>
        <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F", marginBottom: 8 }}>
          Grammar & Vocabulary
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
          Practice verb conjugation, tenses, prepositions,{"\n"}and vocabulary in TCF format.
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
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>Generating questions...</Text>
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

  // Question dot indicators
  const dots = Array.from({ length: totalQuestions }, (_, i) => {
    const answered = answeredQuestions.has(i);
    const isCurrent = i === exercise.currentQuestionIndex;
    let color = "#E0E0CE";
    if (answered) {
      const answer = exercise.answers[i];
      const correct = exercise.exercise?.questions[i]?.options.find((o) => o.isCorrect);
      color = answer === correct?.id ? "#34C759" : "#FF3B30";
    }
    if (isCurrent) color = "#1E3A5F";

    return (
      <TouchableOpacity
        key={i}
        onPress={() =>
          exercise.currentQuestionIndex !== i &&
          // Navigate to specific question
          Array.from({ length: Math.abs(i - exercise.currentQuestionIndex) }).forEach(() =>
            i > exercise.currentQuestionIndex
              ? exercise.nextQuestion()
              : exercise.previousQuestion()
          )
        }
        style={{
          width: isCurrent ? 24 : 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: color,
        }}
      />
    );
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F5F5F0" }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Progress dots */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 6,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {dots}
      </View>

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
    </ScrollView>
  );
}
