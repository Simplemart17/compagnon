/**
 * Pronunciation Practice Screen
 *
 * Generates CEFR-appropriate French sentences, records the user
 * reading them aloud, and shows phoneme-level pronunciation scoring
 * via Azure Speech Service (through the usePronunciation hook).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";

import { usePronunciation } from "@/src/hooks/use-pronunciation";
import { useAuthStore } from "@/src/store/auth-store";
import { chatCompletionJSON } from "@/src/lib/openai";
import { captureError } from "@/src/lib/sentry";
import type { CEFRLevel } from "@/src/types/cefr";
import type { WordScore } from "@/src/lib/pronunciation";
import { Colors, skillTint } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedSentence {
  sentence: string;
  translation: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getScoreColor(score: number): string {
  if (score >= 80) return Colors.success;
  if (score >= 60) return Colors.accent;
  return Colors.error;
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent !";
  if (score >= 80) return "Tres bien !";
  if (score >= 70) return "Bon travail !";
  if (score >= 60) return "Pas mal !";
  return "Continuez !";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Expandable word chip showing phoneme details on tap */
function WordChip({ wordScore }: { wordScore: WordScore }) {
  const [expanded, setExpanded] = useState(false);
  const color = getScoreColor(wordScore.accuracyScore);

  return (
    <Pressable onPress={() => setExpanded((v) => !v)}>
      <View
        className="rounded-lg px-2.5 py-1.5 border"
        style={{
          backgroundColor: skillTint(color, 0.09),
          borderColor: skillTint(color, 0.25),
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: "600", color }}>{wordScore.word}</Text>
        <Text className="text-[10px] text-[#6B7C93] mt-0.5">
          {Math.round(wordScore.accuracyScore)}%
        </Text>
      </View>

      {expanded && (
        <View className="bg-white rounded-[10px] p-2.5 mt-1 border border-surface-300 gap-1">
          {wordScore.errorType !== "None" && (
            <Text className="text-[11px] text-error font-semibold">
              Error: {wordScore.errorType}
            </Text>
          )}
          {wordScore.phonemes.map((p, i) => (
            <View key={i} className="flex-row justify-between items-center">
              <Text className="text-[13px] text-primary font-medium">/{p.phoneme}/</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: getScoreColor(p.accuracyScore),
                  fontWeight: "600",
                }}
              >
                {Math.round(p.accuracyScore)}%
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

/** Score breakdown row */
function ScoreRow({ label, score }: { label: string; score: number }) {
  const color = getScoreColor(score);
  return (
    <View
      className="flex-row justify-between items-center py-2.5"
      style={{ borderBottomWidth: 1, borderBottomColor: "#F0F0E8" }}
    >
      <Text className="text-sm text-[#333]">{label}</Text>
      <View className="flex-row items-center gap-2">
        <View className="w-20 h-1.5 rounded-sm bg-surface-200 overflow-hidden">
          <View
            style={{
              width: `${Math.min(score, 100)}%`,
              height: "100%",
              backgroundColor: color,
              borderRadius: 3,
            }}
          />
        </View>
        <Text style={{ fontSize: 14, fontWeight: "700", color, width: 40, textAlign: "right" }}>
          {Math.round(score)}%
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function PronunciationScreen() {
  const profile = useAuthStore((s) => s.profile);
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const pronunciation = usePronunciation();

  const [sentence, setSentence] = useState<GeneratedSentence | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Pulsing animation for the microphone button while recording
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    if (pronunciation.isRecording) {
      pulseScale.value = withRepeat(
        withSequence(withTiming(1.15, { duration: 600 }), withTiming(1.0, { duration: 600 })),
        -1
      );
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = withTiming(1.0, { duration: 200 });
    }
  }, [pronunciation.isRecording, pulseScale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  // Track whether we have started recording at least once for this sentence
  const hasRecordedRef = useRef(false);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const generateSentence = useCallback(async () => {
    setIsGenerating(true);
    setGenerateError(null);
    pronunciation.clearResult();
    hasRecordedRef.current = false;

    try {
      const result = await chatCompletionJSON<GeneratedSentence>(
        [
          {
            role: "system",
            content:
              "You are a French language teacher. Generate a single French sentence appropriate " +
              `for CEFR level ${cefrLevel}. Return JSON with keys "sentence" (the French text) ` +
              `and "translation" (the English translation). The sentence should be 5-15 words, ` +
              "natural, and useful for pronunciation practice. Do not include punctuation marks " +
              "that would be confusing for speech recognition. Use everyday vocabulary.",
          },
          {
            role: "user",
            content: `Generate a ${cefrLevel}-level French sentence for pronunciation practice.`,
          },
        ],
        { temperature: 0.9 }
      );
      setSentence(result);
    } catch (err) {
      captureError(err, "pronunciation-sentence-generation");
      setGenerateError(err instanceof Error ? err.message : "Failed to generate sentence");
    } finally {
      setIsGenerating(false);
    }
  }, [cefrLevel, pronunciation]);

  const handleMicPress = useCallback(async () => {
    if (pronunciation.isRecording) {
      // Stop recording and assess
      if (sentence) {
        hasRecordedRef.current = true;
        await pronunciation.finishAssessment(sentence.sentence);
      }
    } else {
      // Start recording
      pronunciation.clearResult();
      await pronunciation.startAssessment();
    }
  }, [pronunciation, sentence]);

  const handleTryAgain = useCallback(() => {
    pronunciation.clearResult();
    hasRecordedRef.current = false;
  }, [pronunciation]);

  const handleNewSentence = useCallback(() => {
    pronunciation.clearResult();
    setSentence(null);
    hasRecordedRef.current = false;
    void generateSentence();
  }, [pronunciation, generateSentence]);

  // -----------------------------------------------------------------------
  // Pre-exercise state
  // -----------------------------------------------------------------------
  if (!sentence && !isGenerating) {
    return (
      <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-[64px] mb-4">{"\uD83C\uDF99"}</Text>
          <Text className="text-[22px] font-bold text-primary mb-2">Pronunciation Practice</Text>
          <Text className="text-sm text-[#4A5568] text-center mb-2 leading-5">
            Read French sentences aloud and get{"\n"}phoneme-level pronunciation feedback.
          </Text>
          <Text className="text-[13px] text-[#94A3B8] mb-8">Level: {cefrLevel}</Text>

          <TouchableOpacity onPress={generateSentence} className="bg-primary rounded-xl px-8 py-4">
            <Text className="text-white text-base font-bold">Start Practice</Text>
          </TouchableOpacity>

          {generateError && (
            <Text className="text-error text-[13px] mt-4 text-center">{generateError}</Text>
          )}

          {/* Weak sounds summary from previous sessions */}
          {pronunciation.weakSounds.length > 0 && (
            <View className="bg-white rounded-2xl p-4 mt-8 w-full border border-surface-300">
              <Text className="text-lg font-bold text-primary mb-2.5">Sounds to work on</Text>
              <View className="flex-row flex-wrap gap-2">
                {pronunciation.weakSounds.map((ws) => (
                  <View
                    key={ws.phoneme}
                    className="rounded-lg px-2.5 py-1.5 border"
                    style={{
                      backgroundColor: "rgba(255,59,48,0.1)",
                      borderColor: "rgba(255,59,48,0.25)",
                    }}
                  >
                    <Text className="text-sm font-semibold text-error">/{ws.phoneme}/</Text>
                    <Text className="text-[10px] text-[#6B7C93]">
                      avg {Math.round(ws.avgScore)}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  // -----------------------------------------------------------------------
  // Generating state
  // -----------------------------------------------------------------------
  if (isGenerating) {
    return (
      <View className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-[#4A5568] mt-4 text-sm">Generating sentence...</Text>
      </View>
    );
  }

  // -----------------------------------------------------------------------
  // Results state
  // -----------------------------------------------------------------------
  if (pronunciation.result && sentence) {
    const result = pronunciation.result;
    const overallColor = getScoreColor(result.overallScore);

    return (
      <ScrollView
        className="flex-1 bg-surface"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {/* Overall score circle */}
        <View className="items-center mb-6">
          <View
            className="w-[140px] h-[140px] rounded-full justify-center items-center"
            style={{
              borderWidth: 6,
              borderColor: overallColor,
              backgroundColor: skillTint(overallColor, 0.06),
            }}
          >
            <Text style={{ fontSize: 48, fontWeight: "800", color: overallColor }}>
              {Math.round(result.overallScore)}%
            </Text>
          </View>
          <Text className="text-xl font-bold text-primary mt-3">
            {getScoreLabel(result.overallScore)}
          </Text>
        </View>

        {/* Reference sentence */}
        <View className="bg-primary/[0.06] rounded-xl p-3.5 mb-5">
          <Text className="text-[15px] text-primary leading-[22px]">{sentence.sentence}</Text>
          <Text className="text-xs text-[#6B7C93] mt-1 italic">{sentence.translation}</Text>
        </View>

        {/* Word-by-word breakdown */}
        <Text className="text-lg font-bold text-primary mb-2.5">Word-by-word breakdown</Text>
        <Text className="text-[11px] text-[#94A3B8] mb-3">Tap a word to see phoneme details</Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {result.words.map((ws, i) => (
            <WordChip key={i} wordScore={ws} />
          ))}
        </View>

        {/* Score breakdown */}
        <View className="bg-white rounded-2xl p-4 border border-surface-300 mb-6">
          <Text className="text-lg font-bold text-primary mb-2">Score breakdown</Text>
          <ScoreRow label="Accuracy" score={result.accuracyScore} />
          <ScoreRow label="Fluency" score={result.fluencyScore} />
          <ScoreRow label="Prosody" score={result.prosodyScore} />
          <ScoreRow label="Completeness" score={result.completenessScore} />
        </View>

        {/* Weak phonemes */}
        {result.weakPhonemes.length > 0 && (
          <View
            className="rounded-2xl p-4 border mb-6"
            style={{
              backgroundColor: "rgba(255,59,48,0.06)",
              borderColor: "rgba(255,59,48,0.15)",
            }}
          >
            <Text className="text-lg font-bold text-error mb-2.5">Weak phonemes</Text>
            <View className="flex-row flex-wrap gap-2">
              {result.weakPhonemes.map((p, i) => (
                <View
                  key={i}
                  className="rounded-lg px-2.5 py-1.5"
                  style={{ backgroundColor: "rgba(255,59,48,0.1)" }}
                >
                  <Text className="text-sm font-semibold text-error">/{p.phoneme}/</Text>
                  <Text className="text-[10px] text-[#6B7C93]">{Math.round(p.accuracyScore)}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Action buttons */}
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={handleTryAgain}
            className="flex-1 bg-surface-200 rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-primary">Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNewSentence}
            className="flex-1 bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-white">New Sentence</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // -----------------------------------------------------------------------
  // Active state: sentence displayed, recording controls
  // -----------------------------------------------------------------------
  return (
    <View className="flex-1 bg-surface">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        {/* Sentence card */}
        {sentence && (
          <View
            className="bg-white rounded-2xl p-6 border border-surface-300 mb-8"
            style={{
              shadowColor: Colors.primary,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.07,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            <Text className="text-[11px] font-semibold text-accent tracking-wider uppercase mb-3">
              Read aloud
            </Text>
            <Text className="text-[22px] font-semibold text-primary leading-8 text-center">
              {sentence.sentence}
            </Text>
            <Text className="text-[13px] text-[#6B7C93] mt-3 text-center italic">
              {sentence.translation}
            </Text>
          </View>
        )}

        {/* Microphone button */}
        <View className="items-center">
          {pronunciation.isRecording && (
            <Text className="text-sm text-error font-semibold mb-4">Recording... Tap to stop</Text>
          )}

          {pronunciation.isAssessing && (
            <View className="items-center mb-4">
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text className="text-[13px] text-[#4A5568] mt-2">Assessing pronunciation...</Text>
            </View>
          )}

          <Animated.View style={pulseStyle}>
            <TouchableOpacity
              onPress={handleMicPress}
              disabled={pronunciation.isAssessing}
              accessibilityRole="button"
              accessibilityLabel={pronunciation.isRecording ? "Stop recording" : "Start recording"}
              className="w-[88px] h-[88px] rounded-full justify-center items-center"
              style={{
                backgroundColor: pronunciation.isRecording ? "#FF3B30" : "#1E3A5F",
                shadowColor: pronunciation.isRecording ? "#FF3B30" : "#1E3A5F",
                shadowOpacity: 0.4,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
                elevation: 8,
                opacity: pronunciation.isAssessing ? 0.5 : 1,
              }}
            >
              <Text className="text-[36px] text-white">
                {pronunciation.isRecording ? "\u23F9" : "\uD83C\uDF99"}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {!pronunciation.isRecording && !pronunciation.isAssessing && (
            <Text className="text-[13px] text-[#94A3B8] mt-4">
              Tap the microphone to start recording
            </Text>
          )}
        </View>

        {/* Error display */}
        {pronunciation.error && (
          <Text className="text-error text-[13px] mt-5 text-center">{pronunciation.error}</Text>
        )}
      </ScrollView>

      {/* Bottom: New Sentence button */}
      <View className="px-6 pb-6 pt-3">
        <TouchableOpacity
          onPress={handleNewSentence}
          disabled={pronunciation.isRecording || pronunciation.isAssessing}
          className="rounded-xl py-3.5 items-center"
          style={{
            backgroundColor:
              pronunciation.isRecording || pronunciation.isAssessing
                ? "#E0E0CE"
                : "rgba(30,58,95,0.08)",
          }}
        >
          <Text
            className="text-sm font-semibold"
            style={{
              color: pronunciation.isRecording || pronunciation.isAssessing ? "#999" : "#1E3A5F",
            }}
          >
            Skip / New Sentence
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
