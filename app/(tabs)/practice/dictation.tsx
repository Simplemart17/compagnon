/**
 * Dictation Exercise Screen
 *
 * Generates CEFR-appropriate French sentences via AI, plays them as
 * audio using TTS, and has the user type what they hear. Compares
 * word-by-word and shows accuracy results.
 *
 * States: idle -> generating -> active -> checking -> results
 */

import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, TextInput, ScrollView, Pressable } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInRight } from "react-native-reanimated";
import { useRouter } from "expo-router";

import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { OfflineFallback } from "@/src/components/common/OfflineFallback";
import { useDictation } from "@/src/hooks/use-dictation";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import type { DifficultyTag, WordResult } from "@/src/hooks/use-dictation";
import { Colors, Shadows, Typography, skillTint } from "@/src/lib/design";
import { fireScoreHaptic, getScoreColor, getScoreLabel } from "@/src/lib/score-framing";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIMARY = Colors.primary;
const ACCENT = Colors.accent;
const SUCCESS = Colors.success;
const ERROR_COLOR = Colors.error;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Loading skeleton shown while generating sentences */
function GeneratingSkeleton({ sentenceCount, isSlow }: { sentenceCount: number; isSlow: boolean }) {
  return (
    <View className="flex-1 bg-surface p-5 pt-10">
      {/* Audio player skeleton */}
      <Animated.View
        entering={FadeInDown.duration(300)}
        className="bg-primary rounded-2xl p-5 mb-5 items-center"
        style={{ ...Shadows.card }}
      >
        <SkeletonBar width={56} height={56} style={{ borderRadius: 28, marginBottom: 12 }} />
        <SkeletonBar width={128} height={12} style={{ borderRadius: 6 }} />
      </Animated.View>
      {/* Sentence input skeleton */}
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
      <Text className="text-center mt-4" style={Typography.caption}>
        Generating {sentenceCount} sentences...
      </Text>
      {isSlow && (
        <Text style={[Typography.caption, { textAlign: "center", marginTop: 8 }]}>
          Taking longer than usual...
        </Text>
      )}
      <View className="mt-8 w-full gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Animated.View
            key={i}
            entering={FadeInDown.delay(i * 100).duration(300)}
            className="bg-white rounded-xl p-4 border border-surface-300"
          >
            <SkeletonBar width={`${60 + i * 10}%`} height={14} style={{ borderRadius: 7 }} />
            <SkeletonBar width="40%" height={10} style={{ borderRadius: 5, marginTop: 10 }} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** Progress bar */
function ProgressBar({ current, total }: { current: number; total: number }) {
  const progress = total > 0 ? (current / total) * 100 : 0;
  return (
    <View className="w-full h-1.5 bg-surface-200 rounded-sm overflow-hidden">
      <Animated.View
        entering={FadeIn.duration(200)}
        style={{ width: `${progress}%`, height: "100%", backgroundColor: ACCENT, borderRadius: 3 }}
      />
    </View>
  );
}

/** Difficulty badge */
function DifficultyBadge({ difficulty }: { difficulty: DifficultyTag }) {
  const colors: Record<DifficultyTag, { bg: string; text: string }> = {
    easy: { bg: Colors.success15, text: SUCCESS },
    medium: { bg: Colors.accent15, text: ACCENT },
    hard: { bg: Colors.error15, text: ERROR_COLOR },
  };
  const c = colors[difficulty];
  return (
    <View className="rounded-md px-2 py-0.5" style={{ backgroundColor: c.bg }}>
      <Text
        style={{
          fontSize: Typography.label.fontSize,
          fontWeight: "600",
          color: c.text,
          textTransform: "capitalize",
        }}
      >
        {difficulty}
      </Text>
    </View>
  );
}

/** Word chip showing comparison result */
const ComparisonWord = React.memo(function ComparisonWord({ result }: { result: WordResult }) {
  const colors: Record<WordResult["status"], string> = {
    correct: SUCCESS,
    missing: ERROR_COLOR,
    wrong: ACCENT,
  };
  const color = colors[result.status];

  return (
    <View className="items-center mb-1">
      <View
        className="rounded-lg px-2.5 py-1.5"
        style={{
          backgroundColor: `${color}18`,
          borderWidth: 1.5,
          borderColor: `${color}40`,
        }}
      >
        <Text style={{ fontSize: Typography.body.fontSize, fontWeight: "600", color }}>
          {result.word}
        </Text>
      </View>
      {result.status === "wrong" && result.typed && (
        <Text
          style={{
            fontSize: Typography.label.fontSize,
            color: ACCENT,
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
            color: ERROR_COLOR,
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

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function DictationScreen() {
  const router = useRouter();
  const d = useDictation();
  const isSlow = useSlowLoading(d.screenState === "generating");

  // Fire haptic when results appear
  useEffect(() => {
    if (d.screenState === "results") {
      fireScoreHaptic(d.overallAccuracy);
    }
  }, [d.screenState, d.overallAccuracy]);

  // -------------------------------------------------------------------------
  // Idle state (pre-exercise)
  // -------------------------------------------------------------------------
  if (d.screenState === "idle") {
    return (
      <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ flexGrow: 1 }}>
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 justify-center items-center p-6"
        >
          <Text className="text-[64px] mb-4">{"\uD83D\uDCDD"}</Text>
          <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
            Dictation Practice
          </Text>
          <Text className="text-sm text-center mb-2 leading-5" style={{ color: Colors.gray700 }}>
            Listen to French sentences and type{"\n"}what you hear. Test your ear!
          </Text>
          <Text className="text-[13px] mb-8" style={{ color: Colors.textTertiary }}>
            Level: {d.sentences.length > 0 ? "" : ""}
            {d.sentenceCount} sentences
          </Text>

          {d.offlineFallback ? (
            <OfflineFallback onDismiss={d.clearOfflineFallback} />
          ) : d.generateError ? (
            <>
              <Text className="text-error text-[13px] mb-4 text-center">{d.generateError}</Text>
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
                  onPress={d.generateSentences}
                  accessibilityLabel="Retry dictation practice"
                  accessibilityRole="button"
                  className="flex-1 bg-primary rounded-xl py-3.5 items-center"
                >
                  <Text className="text-[15px] font-bold text-white">Retry</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity
              onPress={d.generateSentences}
              accessibilityLabel="Start dictation practice"
              accessibilityRole="button"
              className="bg-primary rounded-xl px-8 py-4"
            >
              <Text className="text-white text-base font-bold">Start Practice</Text>
            </TouchableOpacity>
          )}

          {/* How it works */}
          <View className="bg-white rounded-2xl p-4 mt-8 w-full border border-surface-300">
            <Text className="text-sm font-bold text-primary mb-3">How it works</Text>
            {[
              { step: "1", text: "Listen to a French sentence" },
              { step: "2", text: "Type what you hear" },
              { step: "3", text: "Check your accuracy word by word" },
              { step: "4", text: "Review your overall score" },
            ].map((item) => (
              <View key={item.step} className="flex-row items-center gap-2.5 mb-2">
                <View
                  className="w-6 h-6 rounded-full justify-center items-center"
                  style={{ backgroundColor: skillTint(ACCENT, 0x20 / 255) }}
                >
                  <Text
                    style={{
                      fontSize: Typography.small.fontSize,
                      fontWeight: "700",
                      color: ACCENT,
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
      </ScrollView>
    );
  }

  // -------------------------------------------------------------------------
  // Generating state
  // -------------------------------------------------------------------------
  if (d.screenState === "generating") {
    return <GeneratingSkeleton sentenceCount={d.sentenceCount} isSlow={isSlow} />;
  }

  // -------------------------------------------------------------------------
  // Checking state (per sentence)
  // -------------------------------------------------------------------------
  if (d.screenState === "checking") {
    const latestResult = d.sentenceResults[d.sentenceResults.length - 1];
    if (!latestResult) return null;

    const isLast = d.currentIndex >= d.sentences.length - 1;
    const accuracyColor =
      latestResult.accuracy >= 80 ? SUCCESS : latestResult.accuracy >= 50 ? ACCENT : ERROR_COLOR;

    return (
      <View className="flex-1 bg-surface">
        {/* Header */}
        <View className="p-5 pb-3">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-[13px]" style={{ color: Colors.textSecondary }}>
              Sentence {d.currentIndex + 1} of {d.sentences.length}
            </Text>
            <View
              className="rounded-lg px-2.5 py-1"
              style={{ backgroundColor: `${accuracyColor}18` }}
            >
              <Text
                style={{
                  fontSize: Typography.bodySecondary.fontSize,
                  fontWeight: "700",
                  color: accuracyColor,
                }}
              >
                {latestResult.accuracy}%
              </Text>
            </View>
          </View>
          <ProgressBar current={d.currentIndex + 1} total={d.sentences.length} />
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}
        >
          {/* Result banner */}
          <Animated.View
            entering={FadeInDown.duration(300)}
            className="rounded-2xl p-4 mb-5 items-center"
            style={{
              backgroundColor: skillTint(
                latestResult.isFullyCorrect ? SUCCESS : ACCENT,
                0x12 / 255
              ),
              borderWidth: 1,
              borderColor: skillTint(latestResult.isFullyCorrect ? SUCCESS : ACCENT, 0x30 / 255),
            }}
          >
            <Text className="text-[28px] mb-1">
              {latestResult.isFullyCorrect ? "\u2705" : "\uD83D\uDD0D"}
            </Text>
            <Text
              className="text-base font-bold"
              style={{ color: latestResult.isFullyCorrect ? SUCCESS : ACCENT }}
            >
              {latestResult.isFullyCorrect ? "Perfect!" : "Almost there!"}
            </Text>
          </Animated.View>

          {/* Original sentence */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text
              style={{ color: Colors.accentText }}
              className="text-[11px] font-semibold tracking-wider uppercase mb-2"
            >
              Original
            </Text>
            <Text className="text-[17px] font-semibold text-primary leading-6">
              {latestResult.original}
            </Text>
          </Animated.View>

          {/* User's input */}
          <Animated.View
            entering={FadeInDown.delay(150).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-2"
              style={{ color: Colors.textSecondary }}
            >
              Your answer
            </Text>
            <Text className="text-[15px] leading-[22px]" style={{ color: Colors.gray700 }}>
              {latestResult.userInput}
            </Text>
          </Animated.View>

          {/* Word-by-word comparison */}
          <Animated.View
            entering={FadeInDown.delay(200).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text className="text-[11px] font-semibold text-primary tracking-wider uppercase mb-3">
              Word comparison
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {latestResult.wordResults.map((wr, i) => (
                <ComparisonWord key={i} result={wr} />
              ))}
            </View>

            {/* Legend */}
            <View className="flex-row gap-4 mt-3.5 pt-3 border-t border-surface-200">
              {[
                { color: SUCCESS, label: "Correct" },
                { color: ERROR_COLOR, label: "Missing" },
                { color: ACCENT, label: "Wrong" },
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

          {/* Translation */}
          <Animated.View
            entering={FadeInDown.delay(250).duration(300)}
            className="rounded-xl p-3.5 mb-5"
            style={{ backgroundColor: skillTint(PRIMARY, 0x08 / 255) }}
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-1"
              style={{ color: Colors.textSecondary }}
            >
              Translation
            </Text>
            <Text
              style={{
                fontSize: Typography.bodySecondary.fontSize,
                color: PRIMARY,
                fontStyle: "italic",
                lineHeight: 20,
              }}
            >
              {latestResult.translation}
            </Text>
          </Animated.View>

          {/* Next button */}
          <Animated.View entering={FadeInUp.delay(300).duration(300)}>
            <TouchableOpacity
              onPress={d.nextSentence}
              accessibilityLabel={isLast ? "View results" : "Next sentence"}
              accessibilityRole="button"
              className="bg-primary rounded-xl py-4 items-center"
            >
              <Text className="text-white text-base font-bold">
                {isLast ? "View Results" : "Next Sentence"}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Results state
  // -------------------------------------------------------------------------
  if (d.screenState === "results") {
    const accuracyColor = getScoreColor(d.overallAccuracy);

    return (
      <ScrollView
        className="flex-1 bg-surface"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
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
          >
            <Text
              style={{
                fontSize: Typography.scoreDisplay.fontSize,
                fontWeight: "800",
                color: accuracyColor,
              }}
            >
              {d.overallAccuracy}%
            </Text>
          </View>
          <Text style={{ ...Typography.subsectionHeader, color: Colors.primary, marginTop: 12 }}>
            {getScoreLabel(d.overallAccuracy)}
          </Text>

          {d.isSavingResults && (
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

        {/* Summary stats */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(300)}
          className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
        >
          <Text accessibilityRole="header" className="text-sm font-bold text-primary mb-3.5">
            Summary
          </Text>
          <View className="flex-row justify-around">
            <View className="items-center">
              <Text className="text-[28px] font-extrabold text-primary">{d.overallAccuracy}%</Text>
              <Text className="text-xs mt-0.5" style={{ color: Colors.textSecondary }}>
                Accuracy
              </Text>
            </View>
            <View className="w-px bg-surface-200" />
            <View className="items-center">
              <Text className="text-[28px] font-extrabold text-success">
                {d.fullyCorrectCount}/{d.sentenceResults.length}
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: Colors.textSecondary }}>
                Perfect
              </Text>
            </View>
            <View className="w-px bg-surface-200" />
            <View className="items-center">
              <Text style={{ color: Colors.accentText }} className="text-[28px] font-extrabold">
                {d.getElapsedMinutes()}m
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: Colors.textSecondary }}>
                Time
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Per-sentence breakdown */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(300)}
          className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
        >
          <Text accessibilityRole="header" className="text-sm font-bold text-primary mb-3">
            Sentence breakdown
          </Text>
          {d.sentenceResults.map((r, i) => {
            const color = getScoreColor(r.accuracy);
            return (
              <View
                key={i}
                className="flex-row justify-between items-center py-2.5"
                style={{
                  borderBottomWidth: i < d.sentenceResults.length - 1 ? 1 : 0,
                  borderBottomColor: Colors.gray200,
                }}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-[13px] text-primary font-medium" numberOfLines={1}>
                    {r.original}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  {r.isFullyCorrect && <Text className="text-sm">{"\u2705"}</Text>}
                  <View className="w-[50px] h-1.5 rounded-sm bg-surface-200 overflow-hidden">
                    <View
                      style={{
                        width: `${Math.min(r.accuracy, 100)}%`,
                        height: "100%",
                        backgroundColor: color,
                        borderRadius: 3,
                      }}
                    />
                  </View>
                  <Text
                    style={{
                      fontSize: Typography.caption.fontSize,
                      fontWeight: "700",
                      color,
                      width: 36,
                      textAlign: "right",
                    }}
                  >
                    {r.accuracy}%
                  </Text>
                </View>
              </View>
            );
          })}
        </Animated.View>

        {/* Error patterns */}
        {d.errorPatterns.length > 0 && (
          <Animated.View
            entering={FadeInDown.delay(300).duration(300)}
            className="rounded-2xl p-4 mb-4 border"
            style={{
              backgroundColor: skillTint(ACCENT, 0x08 / 255),
              borderColor: skillTint(ACCENT, 0x25 / 255),
            }}
          >
            <Text
              style={{
                fontSize: Typography.bodySecondary.fontSize,
                fontWeight: "700",
                color: ACCENT,
              }}
              className="mb-2.5"
            >
              Tips for improvement
            </Text>
            {d.errorPatterns.map((pattern, i) => (
              <View
                key={i}
                className="flex-row gap-2"
                style={{ marginBottom: i < d.errorPatterns.length - 1 ? 8 : 0 }}
              >
                <Text style={{ fontSize: Typography.caption.fontSize, color: ACCENT }}>
                  {"\u2022"}
                </Text>
                <Text
                  className="text-[13px] flex-1 leading-[18px]"
                  style={{ color: Colors.gray700 }}
                >
                  {pattern}
                </Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Action buttons */}
        <Animated.View entering={FadeInUp.delay(400).duration(300)} className="flex-row gap-3 mt-1">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityLabel="Back to practice"
            accessibilityRole="button"
            className="flex-1 bg-surface-200 rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-primary">Back to Practice</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={d.tryAgain}
            accessibilityLabel="Try again"
            accessibilityRole="button"
            className="flex-1 bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-white">Try Again</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    );
  }

  // -------------------------------------------------------------------------
  // Active state: listen and type
  // -------------------------------------------------------------------------
  return (
    <View className="flex-1 bg-surface">
      {/* Header with progress */}
      <View className="p-5 pb-3">
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-[13px]" style={{ color: Colors.textSecondary }}>
            Sentence {d.currentIndex + 1} of {d.sentences.length}
          </Text>
          {d.currentSentence && <DifficultyBadge difficulty={d.currentSentence.difficulty} />}
        </View>
        <ProgressBar current={d.currentIndex} total={d.sentences.length} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, padding: 20, paddingTop: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Instruction card */}
        <Animated.View
          key={`instruction-${d.currentIndex}`}
          entering={SlideInRight.duration(300)}
          className="bg-white rounded-2xl p-6 border border-surface-300 mb-6 items-center"
          style={Shadows.card}
        >
          <Text
            style={{ color: Colors.accentText }}
            className="text-[11px] font-semibold tracking-wider uppercase mb-4"
          >
            Listen and type
          </Text>

          {/* Play buttons */}
          <View className="flex-row gap-3 mb-2">
            <TouchableOpacity
              onPress={() => void d.playSentence(1.0)}
              disabled={d.isPlayingAudio}
              accessibilityLabel="Play sentence at normal speed"
              accessibilityRole="button"
              accessibilityState={{ disabled: d.isPlayingAudio }}
              accessibilityHint="Double tap to play the audio clip"
              className="rounded-2xl px-6 py-3.5 flex-row items-center gap-2"
              style={{
                backgroundColor: d.isPlayingAudio ? Colors.border : PRIMARY,
              }}
            >
              {d.isPlayingAudio ? (
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
                style={{ color: d.isPlayingAudio ? Colors.gray500 : Colors.surfaceWhite }}
              >
                Play
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void d.playSentence(0.8)}
              disabled={d.isPlayingAudio}
              accessibilityLabel="Play sentence at slow speed"
              accessibilityRole="button"
              accessibilityState={{ disabled: d.isPlayingAudio }}
              accessibilityHint="Double tap to play the audio clip at slower speed"
              className="rounded-2xl px-5 py-3.5 flex-row items-center gap-2"
              style={{
                backgroundColor: d.isPlayingAudio ? Colors.border : skillTint(PRIMARY, 0x15 / 255),
                borderWidth: 1,
                borderColor: d.isPlayingAudio ? Colors.border : skillTint(PRIMARY, 0x30 / 255),
              }}
            >
              <Text className="text-base">{"\uD83D\uDC22"}</Text>
              <Text
                className="text-[15px] font-semibold"
                style={{ color: d.isPlayingAudio ? Colors.gray500 : PRIMARY }}
              >
                Slow
              </Text>
            </TouchableOpacity>
          </View>

          {!d.hasPlayed && (
            <Text className="text-xs mt-2" style={{ color: Colors.textTertiary }}>
              Tap Play to hear the sentence
            </Text>
          )}

          {d.audioPlayer.isPlaying && (
            <Pressable
              onPress={() => void d.audioPlayer.stop()}
              accessibilityRole="button"
              accessibilityLabel="Stop playback"
              style={{ marginTop: 8 }}
            >
              <Text className="text-[13px] text-primary font-semibold">Stop playback</Text>
            </Pressable>
          )}
        </Animated.View>

        {/* Text input */}
        <Animated.View
          key={`input-${d.currentIndex}`}
          entering={FadeInDown.delay(150).duration(300)}
          className="bg-white rounded-2xl p-4 border border-surface-300 mb-4"
        >
          <Text
            className="text-[11px] font-semibold tracking-wider uppercase mb-2.5"
            style={{ color: Colors.textSecondary }}
          >
            Type what you hear
          </Text>
          <TextInput
            value={d.userInput}
            onChangeText={d.setUserInput}
            placeholder="Type the French sentence here..."
            placeholderTextColor={Colors.gray400}
            multiline
            autoCapitalize="sentences"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Type the French sentence you heard"
            style={{
              fontSize: Typography.cardTitle.fontSize,
              color: PRIMARY,
              minHeight: 60,
              textAlignVertical: "top",
              lineHeight: 24,
            }}
          />
        </Animated.View>

        {/* Audio errors */}
        {d.audioError && (
          <Text className="text-error text-[13px] mb-3 text-center">{d.audioError}</Text>
        )}
        {d.audioPlayer.error && (
          <Text className="text-error text-[13px] mb-3 text-center">
            Audio playback failed. Try tapping Play again.
          </Text>
        )}

        {/* Check button */}
        <TouchableOpacity
          onPress={d.checkAnswer}
          disabled={d.userInput.trim().length === 0}
          accessibilityLabel="Check your answer"
          accessibilityRole="button"
          accessibilityState={{ disabled: d.userInput.trim().length === 0 }}
          className="rounded-xl py-4 items-center mb-3"
          style={{
            backgroundColor: d.userInput.trim().length === 0 ? Colors.border : PRIMARY,
          }}
        >
          <Text
            className="text-base font-bold"
            style={{
              color: d.userInput.trim().length === 0 ? Colors.gray500 : Colors.surfaceWhite,
            }}
          >
            Check Answer
          </Text>
        </TouchableOpacity>

        {/* Skip button */}
        <TouchableOpacity
          onPress={d.skipSentence}
          accessibilityLabel="Skip this sentence"
          accessibilityRole="button"
          className="bg-transparent rounded-xl py-3 items-center"
        >
          <Text className="text-sm font-semibold" style={{ color: Colors.textTertiary }}>
            Skip this sentence
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
