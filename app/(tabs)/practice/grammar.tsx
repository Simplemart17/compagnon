/**
 * Grammar & Vocabulary Practice Screen
 *
 * MCQ exercises matching TCF "Maitrise des structures" format.
 * Topics: verb conjugation, tenses, prepositions, pronouns, articles.
 * Each wrong answer triggers an AI explanation.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";

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
import { Colors, Shadows, Typography } from "@/src/lib/design";

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
      <View className="flex-1 bg-surface p-5 pt-10">
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            entering={FadeInDown.delay(i * 80).duration(300)}
            className="bg-white rounded-2xl p-5 mb-3"
            style={{ ...Shadows.card }}
          >
            <View className="h-4 bg-surface-200 rounded-md" style={{ width: `${75 - i * 10}%` }} />
            <View
              className="h-3 bg-surface-200 rounded-md mt-3"
              style={{ width: `${55 + i * 5}%` }}
            />
            <View className="flex-row gap-2 mt-4">
              {[1, 2, 3, 4].map((j) => (
                <View key={j} className="h-10 flex-1 bg-surface-200 rounded-lg" />
              ))}
            </View>
          </Animated.View>
        ))}
        <Text className="text-center mt-4" style={Typography.caption}>
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
          className="flex-1 bg-surface"
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        >
          <View className="items-center pt-10">
            <Text className="text-[64px] mb-4">{allCorrect ? "\u2705" : "\uD83D\uDCAA"}</Text>
            <Text className="text-[22px] font-bold text-primary mb-2">
              {allCorrect ? "Parfait !" : "Bon travail !"}
            </Text>
            <Text className="text-sm text-center mb-2" style={{ color: Colors.gray700 }}>
              {drillCorrect}/{microDrill.questions.length} correct
            </Text>
            <View className="bg-accent/10 rounded-xl p-4 my-4 w-full">
              <Text
                style={{ color: Colors.accentText }}
                className="text-[13px] font-semibold mb-1.5"
              >
                Tip
              </Text>
              <Text className="text-sm text-primary leading-5">{microDrill.tip}</Text>
            </View>
            <View className="flex-row gap-3 mt-4 w-full">
              <TouchableOpacity
                onPress={() => {
                  if (allCorrect && params.errorId) {
                    resolveError(params.errorId).catch((err) => captureError(err, "resolve-error"));
                  }
                  router.back();
                }}
                accessibilityRole="button"
                accessibilityLabel="Done"
                className="flex-1 bg-primary rounded-xl py-3.5 items-center"
              >
                <Text className="text-white text-[15px] font-bold">Done</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGenerate}
                accessibilityRole="button"
                accessibilityLabel="Start full exercise"
                className="flex-1 bg-accent rounded-xl py-3.5 items-center"
              >
                <Text className="text-white text-[15px] font-bold">Full Exercise</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      );
    }

    return (
      <ScrollView
        className="flex-1 bg-surface"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {/* Drill header */}
        <View className="bg-accent/10 rounded-2xl p-4 mb-5 border border-accent/30">
          <Text accessibilityRole="header" className="text-base font-bold text-primary mb-1">
            {microDrill.title}
          </Text>
          <Text className="text-[13px] leading-[19px]" style={{ color: Colors.gray700 }}>
            {microDrill.explanation}
          </Text>
        </View>

        {/* Drill progress */}
        <Text className="text-[13px] mb-4" style={{ color: Colors.gray700 }}>
          Question {drillIndex + 1} of {microDrill.questions.length}
        </Text>

        {/* Drill question */}
        {drillQuestion && (
          <View className="bg-white rounded-2xl p-5 border border-surface-300">
            <Text className="text-base font-semibold text-primary mb-4 leading-6">
              {drillQuestion.question}
            </Text>
            {drillQuestion.options.map((option, optIdx) => {
              const isSelected = drillAnswers[drillIndex] === optIdx;
              const isCorrect = optIdx === drillQuestion.correctIndex;
              const showColor = isDrillRevealed;
              let bgColor: string = Colors.surface;
              let borderColor: string = Colors.border;
              if (showColor && isCorrect) {
                bgColor = Colors.success10;
                borderColor = Colors.success;
              } else if (showColor && isSelected && !isCorrect) {
                bgColor = Colors.error10;
                borderColor = Colors.error;
              } else if (isSelected && !showColor) {
                bgColor = Colors.primary10;
                borderColor = Colors.primary;
              }

              return (
                <TouchableOpacity
                  key={optIdx}
                  onPress={() => {
                    if (isDrillRevealed) return;
                    setDrillAnswers((prev) => ({ ...prev, [drillIndex]: optIdx }));
                    setDrillRevealed((prev) => new Set(prev).add(drillIndex));
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={option}
                  accessibilityState={{ selected: isSelected, disabled: isDrillRevealed }}
                  accessibilityHint={
                    isDrillRevealed ? undefined : "Double tap to select this answer"
                  }
                  className="rounded-xl p-3.5 mb-2"
                  style={{
                    backgroundColor: bgColor,
                    borderWidth: 1,
                    borderColor,
                  }}
                >
                  <Text className="text-[15px] text-primary">{option}</Text>
                </TouchableOpacity>
              );
            })}
            {isDrillRevealed && (
              <View className="bg-primary/5 rounded-[10px] p-3 mt-2">
                <Text className="text-[13px] leading-[19px]" style={{ color: Colors.gray700 }}>
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
            accessibilityRole="button"
            accessibilityLabel="Next question"
            className="bg-primary rounded-xl py-3.5 items-center mt-5"
          >
            <Text className="text-white text-[15px] font-semibold">Next</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // Pre-exercise
  if (!exercise.exercise && !exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">&#x1F9E0;</Text>
        <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
          Grammar & Vocabulary
        </Text>
        <Text className="text-sm text-center mb-8 leading-5" style={{ color: Colors.gray700 }}>
          Practice verb conjugation, tenses, prepositions,{"\n"}and vocabulary in TCF format.
        </Text>
        {exercise.error ? (
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
                <Text className="text-white text-[15px] font-bold">Retry</Text>
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
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            entering={FadeInDown.delay(i * 80).duration(300)}
            className="bg-white rounded-2xl p-5 mb-3"
            style={{ ...Shadows.card }}
          >
            <View className="h-4 bg-surface-200 rounded-md" style={{ width: `${75 - i * 10}%` }} />
            <View
              className="h-3 bg-surface-200 rounded-md mt-3"
              style={{ width: `${55 + i * 5}%` }}
            />
            <View className="flex-row gap-2 mt-4">
              {[1, 2, 3, 4].map((j) => (
                <View key={j} className="h-10 flex-1 bg-surface-200 rounded-lg" />
              ))}
            </View>
          </Animated.View>
        ))}
        <Text className="text-center mt-4" style={Typography.caption}>
          Generating questions...
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
    let color: string = Colors.border;
    if (answered) {
      const answer = exercise.answers[i];
      const correct = exercise.exercise?.questions[i]?.options.find((o) => o.isCorrect);
      color = answer === correct?.id ? Colors.success : Colors.error;
    } else if (isCurrent) {
      color = Colors.primary;
    }

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
        accessibilityRole="button"
        accessibilityLabel={`Question ${i + 1}${answered ? (color === Colors.success ? ", correct" : ", incorrect") : ""}${isCurrent ? ", current" : ""}`}
        accessibilityState={{ selected: isCurrent }}
        hitSlop={{ top: 16, bottom: 16, left: 6, right: 6 }}
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
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Progress dots */}
      <View className="flex-row justify-center gap-1.5 mb-5 flex-wrap">{dots}</View>

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
            backgroundColor: exercise.currentQuestionIndex === 0 ? Colors.gray300 : Colors.gray100,
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
                answeredQuestions.size < totalQuestions ? Colors.gray300 : Colors.accent,
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
    </ScrollView>
  );
}
