/**
 * Writing Practice Screen
 *
 * TCF-format writing tasks with 4-dimension AI evaluation:
 * Grammar & Syntax, Cohesion & Coherence, Lexical Richness, Register.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";

import { useExercise } from "@/src/hooks/use-exercise";
import { useAuthStore } from "@/src/store/auth-store";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors } from "@/src/lib/design";

export default function WritingScreen() {
  const router = useRouter();
  const exercise = useExercise();
  const profile = useAuthStore((s) => s.profile);

  const [userText, setUserText] = useState("");

  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const handleGenerate = useCallback(async () => {
    await exercise.generateExercise("writing", cefrLevel);
  }, [exercise, cefrLevel]);

  const handleSubmit = useCallback(async () => {
    if (userText.trim().length < 20) return;
    await exercise.submitWriting(userText, cefrLevel);
  }, [exercise, userText, cefrLevel]);

  const wordCount = userText.trim().split(/\s+/).filter(Boolean).length;

  // Pre-exercise
  if (!exercise.exercise && !exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">&#x270D;&#xFE0F;</Text>
        <Text className="text-[22px] font-bold text-primary mb-2">Writing Practice</Text>
        <Text className="text-sm text-[#4A5568] text-center mb-8 leading-5">
          Write in French and get AI-powered evaluation{"\n"}on grammar, cohesion, vocabulary, and
          register.
        </Text>
        <TouchableOpacity onPress={handleGenerate} className="bg-primary rounded-xl px-8 py-4">
          <Text className="text-white text-base font-bold">Generate Task</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading
  if (exercise.isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-[#4A5568] mt-4 text-sm">Generating writing task...</Text>
      </View>
    );
  }

  // Evaluation result
  if (exercise.evaluation) {
    const eval_ = exercise.evaluation;
    const dimensions = [
      { label: "Grammar & Syntax", score: eval_.grammarScore, color: Colors.skillListening },
      { label: "Cohesion & Coherence", score: eval_.cohesionScore, color: Colors.skillReading },
      { label: "Lexical Richness", score: eval_.lexicalRichnessScore, color: Colors.skillWriting },
      { label: "Register", score: eval_.registerScore, color: Colors.skillGrammar },
    ];

    return (
      <ScrollView
        className="flex-1 bg-surface"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {/* Overall score */}
        <View className="items-center mb-6">
          <View
            className="w-[120px] h-[120px] rounded-full justify-center items-center bg-white"
            style={{
              borderWidth: 5,
              borderColor:
                eval_.overallScore >= 70
                  ? "#34C759"
                  : eval_.overallScore >= 50
                    ? "#F5A623"
                    : "#FF3B30",
            }}
          >
            <Text className="text-[36px] font-extrabold text-primary">{eval_.overallScore}</Text>
            <Text className="text-xs text-[#4A5568]">/ 100</Text>
          </View>
        </View>

        {/* 4 Dimension scores */}
        <View className="gap-3 mb-6">
          {dimensions.map((dim) => (
            <View key={dim.label} className="bg-white rounded-xl p-3.5 border border-surface-300">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm font-semibold text-primary">{dim.label}</Text>
                <Text style={{ fontSize: 14, fontWeight: "700", color: dim.color }}>
                  {dim.score}/25
                </Text>
              </View>
              {/* Progress bar */}
              <View className="h-1.5 bg-surface-200 rounded-sm">
                <View
                  style={{
                    height: 6,
                    width: `${(dim.score / 25) * 100}%`,
                    backgroundColor: dim.color,
                    borderRadius: 3,
                  }}
                />
              </View>
            </View>
          ))}
        </View>

        {/* Errors */}
        {eval_.errors.length > 0 && (
          <View className="mb-6">
            <Text className="text-lg font-bold text-primary mb-3">Corrections</Text>
            {eval_.errors.map((err, i) => (
              <View
                key={i}
                className="bg-white rounded-xl p-3.5 mb-2"
                style={{ borderLeftWidth: 3, borderLeftColor: Colors.error }}
              >
                <View className="flex-row flex-wrap mb-1">
                  <Text className="text-sm text-error line-through">{err.original}</Text>
                  <Text className="text-[#94A3B8] mx-1.5">{"\u2192"}</Text>
                  <Text className="text-sm text-success font-semibold">{err.correction}</Text>
                </View>
                <Text className="text-xs text-[#4A5568] italic">{err.explanation}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Suggestions */}
        {eval_.suggestions.length > 0 && (
          <View className="mb-6">
            <Text className="text-lg font-bold text-primary mb-3">Suggestions</Text>
            {eval_.suggestions.map((suggestion, i) => (
              <View key={i} className="bg-primary/5 rounded-[10px] p-3 mb-1.5">
                <Text className="text-sm text-primary leading-5">{suggestion}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Rewrite suggestion */}
        {eval_.rewriteSuggestion && (
          <View className="mb-6">
            <Text className="text-lg font-bold text-primary mb-3">Suggested Rewrite</Text>
            <View
              className="bg-success/10 rounded-xl p-4"
              style={{ borderLeftWidth: 3, borderLeftColor: Colors.success }}
            >
              <Text className="text-sm text-primary leading-[22px] italic">
                {eval_.rewriteSuggestion}
              </Text>
            </View>
          </View>
        )}

        {/* Your original text */}
        {userText.trim().length > 0 && (
          <View className="mb-6">
            <Text className="text-lg font-bold text-primary mb-3">Your Text</Text>
            <View
              className="bg-white rounded-xl p-4"
              style={{ borderLeftWidth: 3, borderLeftColor: Colors.primary }}
            >
              <Text className="text-sm text-primary leading-[22px]">{userText}</Text>
            </View>
          </View>
        )}

        {/* Actions */}
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={() => router.back()}
            className="flex-1 bg-surface-200 rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-primary">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                "New Task",
                "Start a new writing task? Your current work will be cleared.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "New Task",
                    onPress: () => {
                      exercise.reset();
                      setUserText("");
                    },
                  },
                ]
              );
            }}
            className="flex-1 bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-white">New Task</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Writing task in progress
  const writingPrompt = exercise.exercise?.writingPrompt;

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Task prompt */}
      <View className="bg-primary rounded-2xl p-5 mb-5">
        <Text className="text-xs text-accent font-bold mb-2">
          TASK {writingPrompt?.taskNumber} | {writingPrompt?.minWords}-{writingPrompt?.maxWords}{" "}
          words
        </Text>
        <Text className="text-base text-white leading-6">{writingPrompt?.prompt}</Text>
        {writingPrompt?.context && (
          <Text className="text-[13px] text-white/70 mt-2 italic">{writingPrompt.context}</Text>
        )}
      </View>

      {/* Writing area */}
      <View
        className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
        style={{ minHeight: 200 }}
      >
        <TextInput
          value={userText}
          onChangeText={setUserText}
          placeholder="Write your response in French..."
          placeholderTextColor={Colors.textTertiary}
          multiline
          textAlignVertical="top"
          style={{
            fontSize: 15,
            color: Colors.textPrimary,
            lineHeight: 24,
            minHeight: 180,
          }}
        />
      </View>

      {/* Word count */}
      <View className="flex-row justify-between mb-5">
        <Text
          className="text-[13px] font-semibold"
          style={{
            color: wordCount >= (writingPrompt?.minWords ?? 0) ? "#34C759" : "#999",
          }}
        >
          {wordCount} words
        </Text>
        <Text className="text-[13px] text-[#94A3B8]">
          Target: {writingPrompt?.minWords}-{writingPrompt?.maxWords}
        </Text>
      </View>

      {/* Submit */}
      <TouchableOpacity
        onPress={handleSubmit}
        disabled={exercise.isEvaluating || userText.trim().length < 20}
        accessibilityRole="button"
        accessibilityLabel="Submit writing for evaluation"
        accessibilityState={{ disabled: exercise.isEvaluating || userText.trim().length < 20 }}
        className="rounded-xl py-4 items-center"
        style={{
          backgroundColor:
            exercise.isEvaluating || userText.trim().length < 20 ? "#E0E0CE" : "#F5A623",
        }}
      >
        {exercise.isEvaluating ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator color="#999" size="small" />
            <Text className="text-[#94A3B8] text-[15px] font-semibold">Evaluating...</Text>
          </View>
        ) : (
          <Text
            className="text-base font-bold"
            style={{
              color: userText.trim().length < 20 ? "#999" : "#FFFFFF",
            }}
          >
            Submit for Evaluation
          </Text>
        )}
      </TouchableOpacity>

      {userText.trim().length > 0 && userText.trim().length < 20 && (
        <Text className="text-accent text-xs mt-2 text-center">
          Minimum 20 characters required ({20 - userText.trim().length} more needed)
        </Text>
      )}

      {exercise.error && (
        <Text className="text-error text-[13px] mt-3 text-center">{exercise.error}</Text>
      )}
    </ScrollView>
  );
}
