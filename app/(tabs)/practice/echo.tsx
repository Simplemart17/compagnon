/**
 * Echo Practice Screen
 *
 * Multi-step exercise: listen → speak → type for each sentence.
 * Each sentence is scored on listening comprehension, pronunciation, and spelling.
 *
 * States: idle → generating → listen → speak → type → checking → results
 */

import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, TextInput, ScrollView } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { OfflineFallback } from "@/src/components/common/OfflineFallback";
import { NetworkBanner } from "@/src/components/common/NetworkBanner";
import { useEchoPractice } from "@/src/hooks/use-echo-practice";
import type { EchoPracticeSentenceResult } from "@/src/hooks/use-echo-practice";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import { Colors, Shadows, Typography, skillTint } from "@/src/lib/design";
import { fireScoreHaptic, getScoreColor, getScoreLabel } from "@/src/lib/score-framing";
import type { WordScore } from "@/src/lib/pronunciation";
import type { WordResult } from "@/src/hooks/use-dictation";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Loading skeleton shown while generating exercise */
function GeneratingSkeleton({ isSlow }: { isSlow: boolean }) {
  return (
    <View
      className="flex-1 bg-surface p-5 pt-10"
      accessibilityLabel="Generating exercise"
      accessibilityRole="progressbar"
    >
      {/* Audio player skeleton */}
      <Animated.View
        entering={FadeInDown.duration(300)}
        className="bg-primary rounded-2xl p-5 mb-5 items-center"
        style={{ ...Shadows.card }}
      >
        <SkeletonBar width={56} height={56} style={{ borderRadius: 28, marginBottom: 12 }} />
        <SkeletonBar width={128} height={12} style={{ borderRadius: 6 }} />
      </Animated.View>
      {/* Sentence skeletons */}
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          entering={FadeInDown.delay(100 + i * 80).duration(300)}
          className="bg-white rounded-2xl p-5 mb-3"
          style={{ ...Shadows.card }}
        >
          <SkeletonBar
            width={`${85 - i * 10}%`}
            height={12}
            style={{ borderRadius: 6, marginBottom: 8 }}
          />
          <SkeletonBar width="100%" height={40} style={{ borderRadius: 8, marginTop: 8 }} />
        </Animated.View>
      ))}
      {/* Fourth skeleton */}
      <Animated.View
        entering={FadeInDown.delay(340).duration(300)}
        className="bg-white rounded-2xl p-5 mb-3"
        style={{ ...Shadows.card }}
      >
        <SkeletonBar width="55%" height={12} style={{ borderRadius: 6, marginBottom: 8 }} />
        <SkeletonBar width="100%" height={40} style={{ borderRadius: 8, marginTop: 8 }} />
      </Animated.View>
      <Text className="text-center mt-4" style={Typography.caption}>
        Generating exercise...
      </Text>
      {isSlow && (
        <Text style={[Typography.caption, { textAlign: "center", marginTop: 8 }]}>
          Taking longer than usual...
        </Text>
      )}
    </View>
  );
}

/** Pronunciation word chip — color-coded by accuracy */
const PronunciationWordChip = React.memo(function PronunciationWordChip({
  wordScore,
}: {
  wordScore: WordScore;
}) {
  const color = getScoreColor(wordScore.accuracyScore);
  return (
    <View
      className="rounded-lg px-2.5 py-1.5"
      style={{
        backgroundColor: skillTint(color, 0.09),
        borderWidth: 1.5,
        borderColor: skillTint(color, 0.25),
      }}
      accessibilityLabel={`${wordScore.word}, ${Math.round(wordScore.accuracyScore)} percent`}
    >
      <Text style={{ fontSize: Typography.body.fontSize, fontWeight: "600", color }}>
        {wordScore.word}
      </Text>
      <Text className="text-[10px] mt-0.5" style={{ color: Colors.textSecondary }}>
        {Math.round(wordScore.accuracyScore)}%
      </Text>
    </View>
  );
});

/** Spelling comparison word chip */
const SpellingWordChip = React.memo(function SpellingWordChip({ result }: { result: WordResult }) {
  const colors: Record<WordResult["status"], string> = {
    correct: Colors.success,
    missing: Colors.error,
    wrong: Colors.accent,
  };
  const color = colors[result.status];

  return (
    <View className="items-center mb-1">
      <View
        className="rounded-lg px-2.5 py-1.5"
        style={{
          backgroundColor: skillTint(color, 0.09),
          borderWidth: 1.5,
          borderColor: skillTint(color, 0.25),
        }}
        accessibilityLabel={`${result.word}, ${result.status}`}
      >
        <Text style={{ fontSize: Typography.body.fontSize, fontWeight: "600", color }}>
          {result.word}
        </Text>
      </View>
      {result.status === "wrong" && result.typed && (
        <Text
          style={{
            fontSize: Typography.label.fontSize,
            color: Colors.accent,
            marginTop: 2,
            fontStyle: "italic",
          }}
        >
          you typed: {result.typed}
        </Text>
      )}
      {result.status === "missing" && (
        <Text
          style={{
            fontSize: Typography.label.fontSize,
            color: Colors.error,
            marginTop: 2,
            fontStyle: "italic",
          }}
        >
          missing
        </Text>
      )}
    </View>
  );
});

/** Sub-score tile for results */
function SubScoreTile({ label, score }: { label: string; score: number }) {
  const color = getScoreColor(score);
  return (
    <View className="items-center flex-1">
      <Text
        style={{
          fontSize: Typography.statNumber.fontSize,
          fontWeight: "800",
          color,
        }}
      >
        {score}%
      </Text>
      <Text className="text-xs mt-0.5" style={{ color: Colors.textSecondary }}>
        {label}
      </Text>
    </View>
  );
}

/** Per-sentence result row for the FlatList in results state */
const SentenceResultRow = React.memo(function SentenceResultRow({
  item,
  isLast,
}: {
  item: EchoPracticeSentenceResult;
  isLast: boolean;
}) {
  return (
    <View
      className="py-2.5"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: Colors.gray200,
      }}
    >
      <Text className="text-[13px] text-primary font-medium mb-1" numberOfLines={1}>
        {item.sentence.sentence}
      </Text>
      <View className="flex-row gap-3">
        {[
          { label: "L", score: item.listeningScore },
          { label: "P", score: item.pronunciationScore },
          { label: "S", score: item.spellingScore },
        ].map(({ label, score }) => (
          <Text
            key={label}
            style={{
              fontSize: Typography.caption.fontSize,
              fontWeight: "600",
              color: getScoreColor(score),
            }}
          >
            {label}: {score}%
          </Text>
        ))}
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function EchoPracticeScreen() {
  const router = useRouter();
  const echo = useEchoPractice();
  const isSlow = useSlowLoading(echo.screenState === "generating");
  const inputRef = useRef<TextInput>(null);

  // Fire haptic when results appear
  useEffect(() => {
    if (echo.screenState === "results") {
      fireScoreHaptic(echo.overallAccuracy);
    }
  }, [echo.screenState, echo.overallAccuracy]);

  // Auto-focus input in type state
  useEffect(() => {
    if (echo.screenState === "type") {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [echo.screenState]);

  // -------------------------------------------------------------------------
  // Idle state
  // -------------------------------------------------------------------------
  if (echo.screenState === "idle") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 justify-center items-center p-6"
        >
          <Text className="text-[64px] mb-4">{"\uD83C\uDF99\uFE0F"}</Text>
          <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
            Echo Practice
          </Text>
          <Text className="text-sm text-center mb-8 leading-5" style={{ color: Colors.gray700 }}>
            Listen to a sentence, repeat it aloud,{"\n"}then type what you heard.
          </Text>

          {echo.offlineFallback ? (
            <OfflineFallback onDismiss={echo.clearOfflineFallback} />
          ) : echo.generateError ? (
            <>
              <Text className="text-error text-[13px] mb-4 text-center">{echo.generateError}</Text>
              <View className="flex-row gap-3 w-full px-4">
                <TouchableOpacity
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  className="flex-1 rounded-xl py-3.5 items-center"
                  style={{ backgroundColor: Colors.gray100, minHeight: 44 }}
                >
                  <Text className="text-[15px] font-bold" style={{ color: Colors.primary }}>
                    Back
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={echo.generateExercise}
                  accessibilityRole="button"
                  accessibilityLabel="Retry exercise generation"
                  className="flex-1 bg-primary rounded-xl py-3.5 items-center"
                  style={{ minHeight: 44 }}
                >
                  <Text className="text-[15px] font-bold text-white">Retry</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity
              onPress={echo.generateExercise}
              accessibilityRole="button"
              accessibilityLabel="Start echo practice"
              accessibilityHint="Generates a new exercise"
              className="bg-primary rounded-xl px-8 py-4"
              style={{ minHeight: 44 }}
            >
              <Text className="text-white text-base font-bold">Start Practice</Text>
            </TouchableOpacity>
          )}

          {/* How it works */}
          <View className="bg-white rounded-2xl p-4 mt-8 w-full border border-surface-300">
            <Text className="text-sm font-bold text-primary mb-3">How it works</Text>
            {[
              { step: "1", text: "Listen to a French sentence" },
              { step: "2", text: "Repeat the sentence aloud" },
              { step: "3", text: "Type what you heard" },
              { step: "4", text: "Review your scores" },
            ].map((item) => (
              <View key={item.step} className="flex-row items-center gap-2.5 mb-2">
                <View
                  className="w-6 h-6 rounded-full justify-center items-center"
                  style={{ backgroundColor: skillTint(Colors.accent, 0x20 / 255) }}
                >
                  <Text
                    style={{
                      fontSize: Typography.small.fontSize,
                      fontWeight: "700",
                      color: Colors.accent,
                    }}
                  >
                    {item.step}
                  </Text>
                </View>
                <Text className="text-[13px] flex-1" style={{ color: Colors.gray700 }}>
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Generating state
  // -------------------------------------------------------------------------
  if (echo.screenState === "generating") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <GeneratingSkeleton isSlow={isSlow} />
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Listen state
  // -------------------------------------------------------------------------
  if (echo.screenState === "listen") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        {/* Header */}
        <View className="p-5 pb-3">
          <Text className="text-[13px] mb-2" style={{ color: Colors.textSecondary }}>
            Sentence {echo.currentIndex + 1} of {echo.sentences.length}
          </Text>
        </View>

        <Animated.View
          key={`listen-${echo.currentIndex}`}
          entering={SlideInRight.duration(300)}
          className="flex-1 justify-center items-center px-6"
        >
          <Text
            className="text-[11px] font-semibold tracking-wider uppercase mb-6"
            style={{ color: Colors.accentText }}
          >
            Listen carefully
          </Text>

          {/* Play buttons */}
          <View className="flex-row gap-3 mb-6">
            <TouchableOpacity
              onPress={() => void echo.playSentence(1.0)}
              disabled={echo.audioPlayer.isPlaying}
              accessibilityRole="button"
              accessibilityLabel="Play sentence at normal speed"
              accessibilityState={{ disabled: echo.audioPlayer.isPlaying }}
              accessibilityHint="Double tap to play the audio"
              className="rounded-2xl px-6 py-3.5 flex-row items-center gap-2"
              style={{
                backgroundColor: echo.audioPlayer.isPlaying ? Colors.border : Colors.primary,
                minHeight: 44,
              }}
            >
              {echo.audioPlayer.isPlaying ? (
                <SkeletonBar
                  width={20}
                  height={20}
                  style={{ borderRadius: 10 }}
                  accessibilityLabel="Playing audio"
                />
              ) : (
                <Text className="text-xl">{"\u25B6\uFE0F"}</Text>
              )}
              <Text
                className="text-[15px] font-bold"
                style={{
                  color: echo.audioPlayer.isPlaying ? Colors.gray500 : Colors.surfaceWhite,
                }}
              >
                Play
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void echo.playSentence(0.75)}
              disabled={echo.audioPlayer.isPlaying}
              accessibilityRole="button"
              accessibilityLabel="Play sentence at slow speed"
              accessibilityState={{ disabled: echo.audioPlayer.isPlaying }}
              accessibilityHint="Double tap to play at slower speed"
              className="rounded-2xl px-5 py-3.5 flex-row items-center gap-2"
              style={{
                backgroundColor: echo.audioPlayer.isPlaying
                  ? Colors.border
                  : skillTint(Colors.primary, 0x15 / 255),
                borderWidth: 1,
                borderColor: echo.audioPlayer.isPlaying
                  ? Colors.border
                  : skillTint(Colors.primary, 0x30 / 255),
                minHeight: 44,
              }}
            >
              <Text className="text-base">{"\uD83D\uDC22"}</Text>
              <Text
                className="text-[15px] font-semibold"
                style={{
                  color: echo.audioPlayer.isPlaying ? Colors.gray500 : Colors.primary,
                }}
              >
                Slow
              </Text>
            </TouchableOpacity>
          </View>

          {!echo.hasPlayed && (
            <Text className="text-xs mb-6" style={{ color: Colors.textTertiary }}>
              Tap Play to hear the sentence
            </Text>
          )}

          {/* Next button */}
          <TouchableOpacity
            onPress={echo.advanceToSpeak}
            disabled={!echo.hasPlayed}
            accessibilityRole="button"
            accessibilityLabel="Advance to speak step"
            accessibilityState={{ disabled: !echo.hasPlayed }}
            accessibilityHint="Move to the pronunciation step"
            className="rounded-xl px-8 py-4"
            style={{
              backgroundColor: echo.hasPlayed ? Colors.primary : Colors.border,
              minHeight: 44,
            }}
          >
            <Text
              className="text-base font-bold"
              style={{ color: echo.hasPlayed ? Colors.surfaceWhite : Colors.gray500 }}
            >
              Next
            </Text>
          </TouchableOpacity>

          {/* Skip */}
          <TouchableOpacity
            onPress={echo.skipSentence}
            accessibilityRole="button"
            accessibilityLabel="Skip this sentence"
            accessibilityHint="Records zero scores and moves to next sentence"
            className="mt-4 py-3"
            style={{ minHeight: 44 }}
          >
            <Text className="text-sm font-semibold" style={{ color: Colors.textTertiary }}>
              Skip this sentence
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Speak state
  // -------------------------------------------------------------------------
  if (echo.screenState === "speak") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        {/* Header */}
        <View className="p-5 pb-3">
          <Text className="text-[13px] mb-2" style={{ color: Colors.textSecondary }}>
            Sentence {echo.currentIndex + 1} of {echo.sentences.length}
          </Text>
        </View>

        <Animated.View
          entering={FadeIn.duration(300)}
          className="flex-1 px-6"
          style={{ paddingTop: 24 }}
        >
          <Text
            className="text-[11px] font-semibold tracking-wider uppercase mb-6 text-center"
            style={{ color: Colors.accentText }}
          >
            Repeat aloud
          </Text>

          {/* Mic button */}
          <View className="items-center mb-6">
            <TouchableOpacity
              onPress={echo.pronunciation.isRecording ? echo.stopRecording : echo.startRecording}
              disabled={echo.pronunciation.isAssessing}
              accessibilityRole="button"
              accessibilityLabel={
                echo.pronunciation.isRecording ? "Stop recording" : "Start recording"
              }
              accessibilityState={{ disabled: echo.pronunciation.isAssessing }}
              accessibilityHint={
                echo.pronunciation.isRecording
                  ? "Double tap to stop recording"
                  : "Double tap to start recording your pronunciation"
              }
              className="w-[72px] h-[72px] rounded-full justify-center items-center"
              style={{
                backgroundColor: echo.pronunciation.isRecording ? Colors.error : Colors.primary,
              }}
            >
              <Text className="text-[28px]">
                {echo.pronunciation.isRecording ? "\u23F9" : "\uD83C\uDF99\uFE0F"}
              </Text>
            </TouchableOpacity>

            {echo.pronunciation.isRecording && (
              <Animated.Text
                entering={FadeIn.duration(200)}
                className="text-xs mt-2 font-semibold"
                style={{ color: Colors.error }}
              >
                Recording...
              </Animated.Text>
            )}
          </View>

          {/* Assessing spinner */}
          {echo.pronunciation.isAssessing && (
            <Animated.View entering={FadeIn.duration(200)} className="items-center mb-4">
              <SkeletonBar width={160} height={14} style={{ borderRadius: 7 }} />
              <Text className="text-xs mt-2" style={{ color: Colors.textTertiary }}>
                Assessing pronunciation...
              </Text>
            </Animated.View>
          )}

          {/* Pronunciation error */}
          {echo.pronunciation.error && (
            <Text className="text-error text-[13px] mb-4 text-center">
              {echo.pronunciation.error}
            </Text>
          )}

          {/* Pronunciation word results */}
          {echo.currentPronunciationResult && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
            >
              <Text
                className="text-[11px] font-semibold tracking-wider uppercase mb-3"
                style={{ color: Colors.textSecondary }}
              >
                Pronunciation
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {echo.currentPronunciationResult.words.map((w, i) => (
                  <PronunciationWordChip key={i} wordScore={w} />
                ))}
              </View>

              {/* Re-record option */}
              <TouchableOpacity
                onPress={echo.startRecording}
                disabled={echo.pronunciation.isAssessing}
                accessibilityRole="button"
                accessibilityLabel="Re-record pronunciation"
                accessibilityHint="Overwrites your previous recording"
                accessibilityState={{ disabled: echo.pronunciation.isAssessing }}
                className="mt-3 py-2 items-center"
                style={{ minHeight: 44 }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color: echo.pronunciation.isAssessing ? Colors.gray500 : Colors.primary,
                  }}
                >
                  Re-record
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Next button */}
          <TouchableOpacity
            onPress={echo.advanceToType}
            disabled={echo.currentPronunciationResult === null}
            accessibilityRole="button"
            accessibilityLabel="Advance to type step"
            accessibilityState={{ disabled: echo.currentPronunciationResult === null }}
            className="rounded-xl py-4 items-center"
            style={{
              backgroundColor:
                echo.currentPronunciationResult !== null ? Colors.primary : Colors.border,
              minHeight: 44,
            }}
          >
            <Text
              className="text-base font-bold"
              style={{
                color:
                  echo.currentPronunciationResult !== null ? Colors.surfaceWhite : Colors.gray500,
              }}
            >
              Next
            </Text>
          </TouchableOpacity>

          {/* Skip */}
          <TouchableOpacity
            onPress={echo.skipSentence}
            accessibilityRole="button"
            accessibilityLabel="Skip this sentence"
            accessibilityHint="Records zero scores and moves to next sentence"
            className="mt-3 py-3 items-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-sm font-semibold" style={{ color: Colors.textTertiary }}>
              Skip this sentence
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Type state
  // -------------------------------------------------------------------------
  if (echo.screenState === "type") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        {/* Header */}
        <View className="p-5 pb-3">
          <Text className="text-[13px] mb-2" style={{ color: Colors.textSecondary }}>
            Sentence {echo.currentIndex + 1} of {echo.sentences.length}
          </Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeIn.duration(300)}>
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-4 text-center"
              style={{ color: Colors.accentText }}
            >
              Type what you heard
            </Text>

            <View className="bg-white rounded-2xl p-4 border border-surface-300 mb-4">
              <TextInput
                ref={inputRef}
                value={echo.userInput}
                onChangeText={echo.setUserInput}
                placeholder="Type the French sentence here..."
                placeholderTextColor={Colors.gray400}
                multiline
                autoCapitalize="sentences"
                autoCorrect={false}
                spellCheck={false}
                accessibilityLabel="Type the French sentence you heard"
                style={{
                  fontSize: Typography.cardTitle.fontSize,
                  color: Colors.primary,
                  minHeight: 60,
                  textAlignVertical: "top",
                  lineHeight: 24,
                }}
              />
            </View>

            {/* Check button */}
            <TouchableOpacity
              onPress={echo.checkSpelling}
              disabled={echo.userInput.trim() === ""}
              accessibilityRole="button"
              accessibilityLabel="Check your spelling"
              accessibilityHint="Compares your input against the original sentence"
              accessibilityState={{ disabled: echo.userInput.trim() === "" }}
              className="rounded-xl py-4 items-center mb-3"
              style={{
                backgroundColor: echo.userInput.trim() === "" ? Colors.border : Colors.primary,
                minHeight: 44,
              }}
            >
              <Text
                className="text-base font-bold"
                style={{
                  color: echo.userInput.trim() === "" ? Colors.gray500 : Colors.surfaceWhite,
                }}
              >
                Check
              </Text>
            </TouchableOpacity>

            {/* Skip */}
            <TouchableOpacity
              onPress={echo.skipSentence}
              accessibilityRole="button"
              accessibilityLabel="Skip this sentence"
              accessibilityHint="Records zero scores and moves to next sentence"
              className="py-3 items-center"
              style={{ minHeight: 44 }}
            >
              <Text className="text-sm font-semibold" style={{ color: Colors.textTertiary }}>
                Skip this sentence
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Checking state (per-sentence result)
  // -------------------------------------------------------------------------
  if (echo.screenState === "checking") {
    const latestResult = echo.sentenceResults[echo.sentenceResults.length - 1];
    if (!latestResult) return null;

    const isLast = echo.currentIndex >= echo.sentences.length - 1;

    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <View className="p-5 pb-3">
          <Text className="text-[13px]" style={{ color: Colors.textSecondary }}>
            Sentence {echo.currentIndex + 1} of {echo.sentences.length}
          </Text>
        </View>

        <Animated.ScrollView
          entering={FadeIn.duration(300)}
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}
        >
          {/* Sub-scores */}
          <Animated.View
            entering={FadeInDown.duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-3"
              style={{ color: Colors.textSecondary }}
            >
              Scores
            </Text>
            <View className="flex-row justify-around">
              {[
                { label: "Listening", score: latestResult.listeningScore },
                { label: "Pronunciation", score: latestResult.pronunciationScore },
                { label: "Spelling", score: latestResult.spellingScore },
              ].map(({ label, score }) => {
                const color = getScoreColor(score);
                return (
                  <View key={label} className="items-center">
                    <Text
                      style={{
                        fontSize: Typography.subsectionHeader.fontSize,
                        fontWeight: "800",
                        color,
                      }}
                    >
                      {score}%
                    </Text>
                    <Text className="text-[11px] mt-0.5" style={{ color: Colors.textSecondary }}>
                      {label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Animated.View>

          {/* Spelling word comparison */}
          {latestResult.spellingResult.wordResults.length > 0 && (
            <Animated.View
              entering={FadeInDown.delay(100).duration(300)}
              className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
            >
              <Text className="text-[11px] font-semibold text-primary tracking-wider uppercase mb-3">
                Spelling comparison
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {latestResult.spellingResult.wordResults.map((wr, i) => (
                  <SpellingWordChip key={i} result={wr} />
                ))}
              </View>
              {/* Legend */}
              <View className="flex-row gap-4 mt-3.5 pt-3 border-t border-surface-200">
                {[
                  { color: Colors.success, label: "Correct" },
                  { color: Colors.error, label: "Missing" },
                  { color: Colors.accent, label: "Wrong" },
                ].map((item) => (
                  <View key={item.label} className="flex-row items-center gap-1">
                    <View
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <Text className="text-[11px]" style={{ color: Colors.textSecondary }}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Original sentence + translation */}
          <Animated.View
            entering={FadeInDown.delay(200).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-2"
              style={{ color: Colors.accentText }}
            >
              Original
            </Text>
            <Text className="text-[17px] font-semibold text-primary leading-6 mb-3">
              {latestResult.sentence.sentence}
            </Text>
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-1"
              style={{ color: Colors.textSecondary }}
            >
              Translation
            </Text>
            <Text
              style={{
                fontSize: Typography.bodySecondary.fontSize,
                color: Colors.primary,
                fontStyle: "italic",
                lineHeight: 20,
              }}
            >
              {latestResult.sentence.translation}
            </Text>
          </Animated.View>

          {/* Next / See Results button */}
          <Animated.View entering={FadeInUp.delay(300).duration(300)}>
            <TouchableOpacity
              onPress={echo.nextSentence}
              accessibilityRole="button"
              accessibilityLabel={isLast ? "See results" : "Next sentence"}
              className="bg-primary rounded-xl py-4 items-center"
              style={{ minHeight: 44 }}
            >
              <Text className="text-white text-base font-bold">
                {isLast ? "See Results" : "Next Sentence"}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.ScrollView>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Results state
  // -------------------------------------------------------------------------
  if (echo.screenState === "results") {
    const accuracyColor = getScoreColor(echo.overallAccuracy);

    // Compute average sub-scores
    const count = echo.sentenceResults.length;
    const avgListening =
      count > 0
        ? Math.round(echo.sentenceResults.reduce((sum, r) => sum + r.listeningScore, 0) / count)
        : 0;
    const avgPronunciation =
      count > 0
        ? Math.round(echo.sentenceResults.reduce((sum, r) => sum + r.pronunciationScore, 0) / count)
        : 0;
    const avgSpelling =
      count > 0
        ? Math.round(echo.sentenceResults.reduce((sum, r) => sum + r.spellingScore, 0) / count)
        : 0;

    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Overall score circle */}
          <Animated.View entering={FadeIn.duration(400)} className="items-center mb-6 mt-3">
            <View
              className="w-[140px] h-[140px] rounded-full justify-center items-center"
              style={{
                borderWidth: 6,
                borderColor: accuracyColor,
                backgroundColor: skillTint(accuracyColor, 0.06),
              }}
              accessibilityLabel={`Overall score ${echo.overallAccuracy} percent`}
            >
              <Text
                style={{
                  fontSize: Typography.scoreDisplay.fontSize,
                  fontWeight: "800",
                  color: accuracyColor,
                }}
              >
                {echo.overallAccuracy}%
              </Text>
            </View>
            <Text
              style={{
                ...Typography.subsectionHeader,
                color: Colors.primary,
                marginTop: 12,
              }}
            >
              {getScoreLabel(echo.overallAccuracy)}
            </Text>

            {echo.isSavingResults && (
              <View className="flex-row items-center gap-1.5 mt-2">
                <SkeletonBar
                  width={12}
                  height={12}
                  style={{ borderRadius: 6 }}
                  accessibilityLabel="Saving results"
                />
                <Text className="text-xs" style={{ color: Colors.textTertiary }}>
                  Saving results...
                </Text>
              </View>
            )}
          </Animated.View>

          {/* Sub-score averages */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text accessibilityRole="header" className="text-sm font-bold text-primary mb-3.5">
              Average Scores
            </Text>
            <View className="flex-row justify-around">
              <SubScoreTile label="Listening" score={avgListening} />
              <View className="w-px bg-surface-200" />
              <SubScoreTile label="Pronunciation" score={avgPronunciation} />
              <View className="w-px bg-surface-200" />
              <SubScoreTile label="Spelling" score={avgSpelling} />
            </View>
          </Animated.View>

          {/* Sentence breakdown card */}
          <Animated.View
            entering={FadeInDown.delay(200).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text accessibilityRole="header" className="text-sm font-bold text-primary mb-1">
              Sentence breakdown
            </Text>
            {echo.sentenceResults.map((r, i) => (
              <SentenceResultRow key={i} item={r} isLast={i === echo.sentenceResults.length - 1} />
            ))}
          </Animated.View>

          {/* Action buttons */}
          <Animated.View
            entering={FadeInUp.delay(300).duration(300)}
            className="flex-row gap-3 mt-2"
          >
            <TouchableOpacity
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back to practice"
              accessibilityHint="Returns to the practice hub"
              className="flex-1 bg-surface-200 rounded-xl py-3.5 items-center"
              style={{ minHeight: 44 }}
            >
              <Text className="text-[15px] font-semibold text-primary">Back to Practice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={echo.tryAgain}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              accessibilityHint="Generates a new echo practice exercise"
              className="flex-1 bg-primary rounded-xl py-3.5 items-center"
              style={{ minHeight: 44 }}
            >
              <Text className="text-[15px] font-semibold text-white">Try Again</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}
