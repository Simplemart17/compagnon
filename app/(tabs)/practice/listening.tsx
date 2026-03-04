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
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 64, marginBottom: 16 }}>&#x1F3A7;</Text>
        <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F", marginBottom: 8 }}>
          Listening Practice
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
          Listen to a French passage and answer comprehension questions.
          {"\n"}Exercises adapt to your {cefrLevel} level.
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

  // Loading state
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
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>Generating exercise...</Text>
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
      style={{ flex: 1, backgroundColor: "#F5F5F0" }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Audio player controls */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
          alignItems: "center",
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity
            onPress={handlePlayAudio}
            style={{
              backgroundColor: audioPlayer.isPlaying ? "rgba(255,255,255,0.3)" : "#F5A623",
              width: 56,
              height: 56,
              borderRadius: 28,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 24 }}>
              {audioPlayer.isPlaying ? "\u23F8" : "\u25B6"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSpeedChange}
            style={{
              backgroundColor: "rgba(255,255,255,0.15)",
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>
              {playbackSpeed}x
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: "#FFFFFF88", fontSize: 12 }}>
          Tap to {audioPlayer.isPlaying ? "pause" : "listen"} | Speed: {playbackSpeed}x
        </Text>

        {/* Transcript toggle */}
        <TouchableOpacity
          onPress={() => setShowTranscript(!showTranscript)}
          style={{
            backgroundColor: "rgba(255,255,255,0.1)",
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#FFFFFF99", fontSize: 12, fontWeight: "600" }}>
            {showTranscript ? "Hide Transcript" : "Show Transcript"}
          </Text>
        </TouchableOpacity>

        {showTranscript && exercise.exercise?.passage && (
          <Text
            style={{
              color: "#FFFFFFCC",
              fontSize: 14,
              lineHeight: 22,
              marginTop: 8,
            }}
          >
            {exercise.exercise.passage}
          </Text>
        )}
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
