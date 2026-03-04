/**
 * Listening Practice Screen
 *
 * AI generates a French passage, TTS renders audio.
 * User listens and answers MCQ comprehension questions.
 * Features: playback speed control, replay, transcript reveal.
 */

import { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";

import { useExercise } from "@/src/hooks/use-exercise";
import { useAudioPlayer } from "@/src/hooks/use-audio-player";
import { useAuthStore } from "@/src/store/auth-store";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { ScoreCard } from "@/src/components/practice/ScoreCard";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors } from "@/src/lib/design";

export default function ListeningScreen() {
  const router = useRouter();
  const exercise = useExercise();
  const audioPlayer = useAudioPlayer();
  const profile = useAuthStore((s) => s.profile);

  const [showTranscript, setShowTranscript] = useState(false);
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<number>>(new Set());
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const handleGenerate = useCallback(async () => {
    await exercise.generateExercise("listening", cefrLevel);
  }, [exercise, cefrLevel]);

  const handlePlayAudio = useCallback(async () => {
    if (exercise.exercise?.audioBase64) {
      await audioPlayer.playFromBase64(exercise.exercise.audioBase64);
    }
  }, [exercise.exercise, audioPlayer]);

  const handleSpeedChange = useCallback(async () => {
    const speeds = [0.75, 1.0, 1.25, 1.5];
    const currentIdx = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIdx + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    await audioPlayer.setPlaybackSpeed(nextSpeed);
  }, [playbackSpeed, audioPlayer]);

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

  // Pre-exercise: Generate button
  if (!exercise.exercise && !exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">&#x1F3A7;</Text>
        <Text className="text-[22px] font-bold text-primary mb-2">Listening Practice</Text>
        <Text className="text-sm text-[#4A5568] text-center mb-8 leading-5">
          Listen to a French passage and answer comprehension questions.
          {"\n"}Exercises adapt to your {cefrLevel} level.
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

  // Loading state
  if (exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-[#4A5568] mt-4 text-sm">Generating exercise...</Text>
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
            setShowTranscript(false);
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

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Audio player controls */}
      <View className="bg-primary rounded-2xl p-5 mb-5 items-center gap-3">
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={handlePlayAudio}
            className="w-14 h-14 rounded-full justify-center items-center"
            style={{
              backgroundColor: audioPlayer.isPlaying ? "rgba(255,255,255,0.3)" : "#F5A623",
            }}
          >
            <Text className="text-white text-2xl">
              {audioPlayer.isPlaying ? "\u23F8" : "\u25B6"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSpeedChange}
            className="bg-white/15 px-3.5 py-2 rounded-lg justify-center"
          >
            <Text className="text-white text-[13px] font-semibold">{playbackSpeed}x</Text>
          </TouchableOpacity>
        </View>

        <Text className="text-white/70 text-xs">
          Tap to {audioPlayer.isPlaying ? "pause" : "listen"} | Speed: {playbackSpeed}x
        </Text>

        {/* Transcript toggle */}
        <TouchableOpacity
          onPress={() => setShowTranscript(!showTranscript)}
          className="bg-white/10 px-4 py-2 rounded-lg"
        >
          <Text className="text-white/50 text-xs font-semibold">
            {showTranscript ? "Hide Transcript" : "Show Transcript"}
          </Text>
        </TouchableOpacity>

        {showTranscript && exercise.exercise?.passage && (
          <Text className="text-white text-sm leading-[22px] mt-2">
            {exercise.exercise.passage}
          </Text>
        )}
      </View>

      {/* Question counter */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-[13px] text-[#4A5568]">
          Question {exercise.currentQuestionIndex + 1} of {totalQuestions}
        </Text>
        <Text className="text-[13px] text-[#4A5568]">
          {answeredQuestions.size}/{totalQuestions} answered
        </Text>
      </View>

      {/* Question card */}
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
    </ScrollView>
  );
}
