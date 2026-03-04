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
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 64, marginBottom: 16 }}>&#x270D;&#xFE0F;</Text>
        <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F", marginBottom: 8 }}>
          Writing Practice
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
          Write in French and get AI-powered evaluation{"\n"}on grammar, cohesion, vocabulary, and
          register.
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
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>Generate Task</Text>
        </TouchableOpacity>
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
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>
          Generating writing task...
        </Text>
      </View>
    );
  }

  // Evaluation result
  if (exercise.evaluation) {
    const eval_ = exercise.evaluation;
    const dimensions = [
      { label: "Grammar & Syntax", score: eval_.grammarScore, color: "#2196F3" },
      { label: "Cohesion & Coherence", score: eval_.cohesionScore, color: "#4CAF50" },
      { label: "Lexical Richness", score: eval_.lexicalRichnessScore, color: "#FF9800" },
      { label: "Register", score: eval_.registerScore, color: "#9C27B0" },
    ];

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F5F5F0" }}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {/* Overall score */}
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              borderWidth: 5,
              borderColor:
                eval_.overallScore >= 70
                  ? "#34C759"
                  : eval_.overallScore >= 50
                    ? "#F5A623"
                    : "#FF3B30",
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: "#FFFFFF",
            }}
          >
            <Text
              style={{
                fontSize: 36,
                fontWeight: "800",
                color: "#1E3A5F",
              }}
            >
              {eval_.overallScore}
            </Text>
            <Text style={{ fontSize: 12, color: "#666" }}>/ 100</Text>
          </View>
        </View>

        {/* 4 Dimension scores */}
        <View style={{ gap: 12, marginBottom: 24 }}>
          {dimensions.map((dim) => (
            <View
              key={dim.label}
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 12,
                padding: 14,
                borderWidth: 1,
                borderColor: "#E0E0CE",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#1E3A5F" }}>
                  {dim.label}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: "700", color: dim.color }}>
                  {dim.score}/25
                </Text>
              </View>
              {/* Progress bar */}
              <View
                style={{
                  height: 6,
                  backgroundColor: "#F0F0E8",
                  borderRadius: 3,
                }}
              >
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
          <View style={{ marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "700",
                color: "#1E3A5F",
                marginBottom: 12,
              }}
            >
              Corrections
            </Text>
            {eval_.errors.map((err, i) => (
              <View
                key={i}
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 8,
                  borderLeftWidth: 3,
                  borderLeftColor: "#FF3B30",
                }}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      color: "#CC3333",
                      textDecorationLine: "line-through",
                    }}
                  >
                    {err.original}
                  </Text>
                  <Text style={{ color: "#999", marginHorizontal: 6 }}>{"\u2192"}</Text>
                  <Text style={{ fontSize: 14, color: "#2E7D32", fontWeight: "600" }}>
                    {err.correction}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: "#666", fontStyle: "italic" }}>
                  {err.explanation}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Suggestions */}
        {eval_.suggestions.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "700",
                color: "#1E3A5F",
                marginBottom: 12,
              }}
            >
              Suggestions
            </Text>
            {eval_.suggestions.map((suggestion, i) => (
              <View
                key={i}
                style={{
                  backgroundColor: "#F0F7FF",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 6,
                }}
              >
                <Text style={{ fontSize: 14, color: "#333", lineHeight: 20 }}>{suggestion}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Rewrite suggestion */}
        {eval_.rewriteSuggestion && (
          <View style={{ marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "700",
                color: "#1E3A5F",
                marginBottom: 12,
              }}
            >
              Suggested Rewrite
            </Text>
            <View
              style={{
                backgroundColor: "#E8F5E9",
                borderRadius: 12,
                padding: 16,
                borderLeftWidth: 3,
                borderLeftColor: "#34C759",
              }}
            >
              <Text style={{ fontSize: 14, color: "#333", lineHeight: 22, fontStyle: "italic" }}>
                {eval_.rewriteSuggestion}
              </Text>
            </View>
          </View>
        )}

        {/* Your original text */}
        {userText.trim().length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "700",
                color: "#1E3A5F",
                marginBottom: 12,
              }}
            >
              Your Text
            </Text>
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 12,
                padding: 16,
                borderLeftWidth: 3,
                borderLeftColor: "#1E3A5F",
              }}
            >
              <Text style={{ fontSize: 14, color: "#333", lineHeight: 22 }}>{userText}</Text>
            </View>
          </View>
        )}

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              flex: 1,
              backgroundColor: "#F0F0E8",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#1E3A5F" }}>Back</Text>
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
            style={{
              flex: 1,
              backgroundColor: "#1E3A5F",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#FFFFFF" }}>New Task</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Writing task in progress
  const writingPrompt = exercise.exercise?.writingPrompt;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F5F5F0" }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Task prompt */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <Text style={{ fontSize: 12, color: "#F5A623", fontWeight: "700", marginBottom: 8 }}>
          TASK {writingPrompt?.taskNumber} | {writingPrompt?.minWords}-{writingPrompt?.maxWords}{" "}
          words
        </Text>
        <Text style={{ fontSize: 16, color: "#FFFFFF", lineHeight: 24 }}>
          {writingPrompt?.prompt}
        </Text>
        {writingPrompt?.context && (
          <Text style={{ fontSize: 13, color: "#FFFFFF88", marginTop: 8, fontStyle: "italic" }}>
            {writingPrompt.context}
          </Text>
        )}
      </View>

      {/* Writing area */}
      <View
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: "#E0E0CE",
          minHeight: 200,
        }}
      >
        <TextInput
          value={userText}
          onChangeText={setUserText}
          placeholder="Write your response in French..."
          placeholderTextColor="#999"
          multiline
          textAlignVertical="top"
          style={{
            fontSize: 15,
            color: "#333",
            lineHeight: 24,
            minHeight: 180,
          }}
        />
      </View>

      {/* Word count */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Text
          style={{
            fontSize: 13,
            color: wordCount >= (writingPrompt?.minWords ?? 0) ? "#34C759" : "#999",
            fontWeight: "600",
          }}
        >
          {wordCount} words
        </Text>
        <Text style={{ fontSize: 13, color: "#999" }}>
          Target: {writingPrompt?.minWords}-{writingPrompt?.maxWords}
        </Text>
      </View>

      {/* Submit */}
      <TouchableOpacity
        onPress={handleSubmit}
        disabled={exercise.isEvaluating || userText.trim().length < 20}
        style={{
          backgroundColor:
            exercise.isEvaluating || userText.trim().length < 20 ? "#E0E0CE" : "#F5A623",
          borderRadius: 12,
          paddingVertical: 16,
          alignItems: "center",
        }}
      >
        {exercise.isEvaluating ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator color="#999" size="small" />
            <Text style={{ color: "#999", fontSize: 15, fontWeight: "600" }}>Evaluating...</Text>
          </View>
        ) : (
          <Text
            style={{
              color: userText.trim().length < 20 ? "#999" : "#FFFFFF",
              fontSize: 16,
              fontWeight: "700",
            }}
          >
            Submit for Evaluation
          </Text>
        )}
      </TouchableOpacity>

      {userText.trim().length > 0 && userText.trim().length < 20 && (
        <Text style={{ color: "#F5A623", fontSize: 12, marginTop: 8, textAlign: "center" }}>
          Minimum 20 characters required ({20 - userText.trim().length} more needed)
        </Text>
      )}

      {exercise.error && (
        <Text style={{ color: "#FF3B30", fontSize: 13, marginTop: 12, textAlign: "center" }}>
          {exercise.error}
        </Text>
      )}
    </ScrollView>
  );
}
