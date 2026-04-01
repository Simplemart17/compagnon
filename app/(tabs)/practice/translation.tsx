/**
 * Translation Practice Screen
 *
 * Multi-step exercise: listen → record → evaluate for each sentence.
 * Each sentence is scored on accuracy, fluency, and naturalness.
 *
 * States: idle → generating → listen → recording → evaluating → results
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, FlatList } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInRight,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { OfflineFallback } from "@/src/components/common/OfflineFallback";
import { NetworkBanner } from "@/src/components/common/NetworkBanner";
import { useTranslation } from "@/src/hooks/use-translation";
import type { TranslationSentenceResult } from "@/src/hooks/use-translation";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import { useAuthStore } from "@/src/store/auth-store";
import { Colors, Shadows, Typography, skillTint } from "@/src/lib/design";
import { fireScoreHaptic, getScoreColor, getScoreLabel } from "@/src/lib/score-framing";
import type { WordScore } from "@/src/lib/pronunciation";

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

/** Dimension score display tile */
function DimensionScore({ label, score }: { label: string; score: number }) {
  const color = getScoreColor(score);
  return (
    <View className="items-center flex-1">
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
}

/** Sub-score tile for results averages */
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
  item: TranslationSentenceResult;
  isLast: boolean;
}) {
  const score = item.skipped ? 0 : (item.evaluation?.overallScore ?? 0);
  const color = getScoreColor(score);

  return (
    <View
      className="py-2.5 flex-row items-center justify-between"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: Colors.gray200,
      }}
    >
      <Text className="text-[13px] text-primary font-medium flex-1 mr-3" numberOfLines={1}>
        {item.skipped ? "(skipped)" : (item.evaluation?.userTranscription ?? "")}
      </Text>
      <View className="rounded-md px-2 py-1" style={{ backgroundColor: skillTint(color, 0.12) }}>
        <Text style={{ fontSize: Typography.label.fontSize, fontWeight: "700", color }}>
          {score}%
        </Text>
      </View>
    </View>
  );
});

/** Pulsing mic recording indicator */
function RecordingMicButton({
  isRecording,
  onPress,
}: {
  isRecording: boolean;
  onPress: () => void;
}) {
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (isRecording) {
      pulseOpacity.value = withRepeat(
        withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isRecording ? "Stop recording" : "Start recording"}
      accessibilityHint={
        isRecording ? "Double tap to stop recording" : "Double tap to start recording"
      }
      accessibilityState={{ selected: isRecording }}
      className="w-[72px] h-[72px] rounded-full justify-center items-center"
      style={{
        backgroundColor: isRecording ? Colors.error : Colors.primary,
      }}
    >
      <Animated.View style={isRecording ? pulseStyle : undefined}>
        <Text className="text-[28px]">{isRecording ? "\u23F9" : "\uD83C\uDF99\uFE0F"}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function TranslationPracticeScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const t = useTranslation();
  const isSlow = useSlowLoading(t.screenState === "generating");

  // Track whether user has completed at least one recording cycle
  const [hasStoppedRecording, setHasStoppedRecording] = useState(false);
  const prevIsRecording = useRef(false);

  // Detect recording stop: isRecording transitions from true → false
  useEffect(() => {
    if (prevIsRecording.current && !t.recorder.isRecording) {
      setHasStoppedRecording(true);
    }
    prevIsRecording.current = t.recorder.isRecording;
  }, [t.recorder.isRecording]);

  // Reset when entering a new sentence (listen state)
  useEffect(() => {
    if (t.screenState === "listen") {
      setHasStoppedRecording(false);
    }
  }, [t.screenState]);

  const isAdvanced = ["B2", "C1", "C2"].includes(profile?.current_cefr_level ?? "A1");
  const modeLabel = t.exercise?.content.mode === "paraphrasing" ? "Paraphrasing" : "Translation";

  // Stable renderItem for FlatList — avoids defeating React.memo on SentenceResultRow
  const renderSentenceRow = useCallback(
    ({ item, index }: { item: TranslationSentenceResult; index: number }) => (
      <SentenceResultRow item={item} isLast={index === t.sentenceResults.length - 1} />
    ),
    [t.sentenceResults.length]
  );

  // Fire haptic when results appear
  useEffect(() => {
    if (t.screenState === "results") {
      fireScoreHaptic(t.overallScore);
    }
  }, [t.screenState, t.overallScore]);

  // After evaluation completes, show per-sentence result before moving on
  const isPerSentenceResult = t.screenState === "evaluating" && t.currentEvaluation !== null;

  // -------------------------------------------------------------------------
  // Idle state
  // -------------------------------------------------------------------------
  if (t.screenState === "idle") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 justify-center items-center p-6"
        >
          <Text className="text-[64px] mb-4">{"\uD83C\uDF10"}</Text>
          <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
            Translation Practice
          </Text>
          <Text className="text-sm text-center mb-2 leading-5" style={{ color: Colors.gray700 }}>
            Hear a sentence, speak the French translation,{"\n"}and receive AI evaluation on
            accuracy, fluency,{"\n"}and naturalness.
          </Text>

          {isAdvanced && (
            <Text
              className="text-xs text-center mb-4 leading-4"
              style={{ color: Colors.accentText }}
            >
              At your level, you{"'"}ll rephrase French sentences{"\n"}in your own words.
            </Text>
          )}

          {!isAdvanced && <View className="mb-4" />}

          {t.offlineFallback ? (
            <OfflineFallback onDismiss={t.clearOfflineFallback} />
          ) : t.generateError ? (
            <>
              <Text className="text-error text-[13px] mb-4 text-center">{t.generateError}</Text>
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
                  onPress={t.generateExercise}
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
              onPress={t.generateExercise}
              accessibilityRole="button"
              accessibilityLabel="Start translation practice"
              accessibilityHint="Generates a new translation exercise"
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
              { step: "1", text: "Listen to a sentence" },
              { step: "2", text: "Record your French translation" },
              { step: "3", text: "Receive AI evaluation" },
            ].map((item) => (
              <View key={item.step} className="flex-row items-center gap-2.5 mb-2">
                <View
                  className="w-6 h-6 rounded-full justify-center items-center"
                  style={{ backgroundColor: skillTint(Colors.skillTranslation, 0.15) }}
                >
                  <Text
                    style={{
                      fontSize: Typography.small.fontSize,
                      fontWeight: "700",
                      color: Colors.skillTranslation,
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
  if (t.screenState === "generating") {
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
  if (t.screenState === "listen") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        {/* Header */}
        <View className="p-5 pb-3">
          <Text className="text-[13px] mb-1" style={{ color: Colors.textSecondary }}>
            Sentence {t.currentIndex + 1} of {t.sentenceCount}
          </Text>
          <Text
            className="text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: Colors.skillTranslation }}
          >
            {modeLabel}
          </Text>
        </View>

        <Animated.View
          key={`listen-${t.currentIndex}`}
          entering={SlideInRight.duration(300)}
          className="flex-1 justify-center items-center px-6"
        >
          {/* Source sentence — visible for translation */}
          <Animated.View
            entering={FadeInDown.duration(300)}
            className="bg-white rounded-2xl p-5 mb-6 w-full border border-surface-300"
            style={{ ...Shadows.card }}
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-2"
              style={{ color: Colors.accentText }}
            >
              {t.exercise?.content.mode === "paraphrasing" ? "Rephrase this" : "Translate this"}
            </Text>
            <Text
              className="text-[18px] font-semibold text-primary leading-7"
              accessibilityRole="text"
            >
              {t.currentSentence?.source}
            </Text>
          </Animated.View>

          {/* Play buttons */}
          <View className="flex-row gap-3 mb-6">
            <TouchableOpacity
              onPress={() => void t.playSource(1.0)}
              disabled={t.audioPlayer.isPlaying}
              accessibilityRole="button"
              accessibilityLabel="Play sentence at normal speed"
              accessibilityState={{ disabled: t.audioPlayer.isPlaying }}
              accessibilityHint="Double tap to play the audio"
              className="rounded-[14px] px-6 py-3.5 flex-row items-center gap-2"
              style={{
                backgroundColor: t.audioPlayer.isPlaying ? Colors.border : Colors.primary,
                minHeight: 44,
              }}
            >
              {t.audioPlayer.isPlaying ? (
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
                  color: t.audioPlayer.isPlaying ? Colors.gray500 : Colors.surfaceWhite,
                }}
              >
                Play
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void t.playSource(0.75)}
              disabled={t.audioPlayer.isPlaying}
              accessibilityRole="button"
              accessibilityLabel="Play sentence at slow speed"
              accessibilityState={{ disabled: t.audioPlayer.isPlaying }}
              accessibilityHint="Double tap to play at slower speed"
              className="rounded-[14px] px-5 py-3.5 flex-row items-center gap-2"
              style={{
                backgroundColor: t.audioPlayer.isPlaying
                  ? Colors.border
                  : skillTint(Colors.primary, 0.08),
                borderWidth: 1,
                borderColor: t.audioPlayer.isPlaying
                  ? Colors.border
                  : skillTint(Colors.primary, 0.18),
                minHeight: 44,
              }}
            >
              <Text className="text-base">{"\uD83D\uDC22"}</Text>
              <Text
                className="text-[15px] font-semibold"
                style={{
                  color: t.audioPlayer.isPlaying ? Colors.gray500 : Colors.primary,
                }}
              >
                Slow
              </Text>
            </TouchableOpacity>
          </View>

          {!t.hasPlayed && (
            <Text className="text-xs mb-6" style={{ color: Colors.textTertiary }}>
              Tap Play to hear the sentence
            </Text>
          )}

          {/* Record Translation button */}
          <TouchableOpacity
            onPress={() => void t.startRecording()}
            disabled={!t.hasPlayed}
            accessibilityRole="button"
            accessibilityLabel="Record translation"
            accessibilityState={{ disabled: !t.hasPlayed }}
            accessibilityHint="Move to the recording step"
            className="rounded-xl px-8 py-4"
            style={{
              backgroundColor: t.hasPlayed ? Colors.primary : Colors.border,
              minHeight: 44,
            }}
          >
            <Text
              className="text-base font-bold"
              style={{ color: t.hasPlayed ? Colors.surfaceWhite : Colors.gray500 }}
            >
              Record Translation
            </Text>
          </TouchableOpacity>

          {/* Skip */}
          <TouchableOpacity
            onPress={t.skipSentence}
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
  // Recording state
  // -------------------------------------------------------------------------
  if (t.screenState === "recording") {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        {/* Header */}
        <View className="p-5 pb-3">
          <Text className="text-[13px] mb-1" style={{ color: Colors.textSecondary }}>
            Sentence {t.currentIndex + 1} of {t.sentenceCount}
          </Text>
          <Text
            className="text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: Colors.skillTranslation }}
          >
            {modeLabel}
          </Text>
        </View>

        <Animated.View
          entering={FadeIn.duration(300)}
          className="flex-1 px-6"
          style={{ paddingTop: 24 }}
        >
          {/* Source sentence reference */}
          <Animated.View
            entering={FadeInDown.duration(300)}
            className="bg-white rounded-2xl p-4 mb-6 border border-surface-300"
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-2"
              style={{ color: Colors.accentText }}
            >
              Source
            </Text>
            <Text className="text-[16px] font-semibold text-primary leading-6">
              {t.currentSentence?.source}
            </Text>
          </Animated.View>

          <Text
            className="text-[11px] font-semibold tracking-wider uppercase mb-6 text-center"
            style={{ color: Colors.accentText }}
          >
            {t.recorder.isRecording ? "Recording..." : "Record your translation"}
          </Text>

          {/* Mic button */}
          <View className="items-center mb-6">
            <RecordingMicButton
              isRecording={t.recorder.isRecording}
              onPress={
                t.recorder.isRecording
                  ? () => void t.stopRecording()
                  : () => void t.startRecording()
              }
            />

            {t.recorder.isRecording && (
              <Animated.Text
                entering={FadeIn.duration(200)}
                className="text-xs mt-2 font-semibold"
                style={{ color: Colors.error }}
              >
                Tap to stop
              </Animated.Text>
            )}
          </View>

          {/* After stopping: Re-record + Submit */}
          {hasStoppedRecording && !t.recorder.isRecording && (
            <Animated.View entering={FadeInDown.duration(300)} className="gap-3">
              <TouchableOpacity
                onPress={() => void t.submitRecording()}
                accessibilityRole="button"
                accessibilityLabel="Submit recording"
                accessibilityHint="Submits your translation for evaluation"
                className="bg-primary rounded-xl py-4 items-center"
                style={{ minHeight: 44 }}
              >
                <Text className="text-base font-bold text-white">Submit</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => void t.startRecording()}
                accessibilityRole="button"
                accessibilityLabel="Re-record translation"
                accessibilityHint="Clears your recording and starts over"
                className="rounded-xl py-3 items-center"
                style={{ minHeight: 44 }}
              >
                <Text className="text-sm font-semibold" style={{ color: Colors.primary }}>
                  Re-record
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Skip */}
          <TouchableOpacity
            onPress={t.skipSentence}
            accessibilityRole="button"
            accessibilityLabel="Skip this sentence"
            accessibilityHint="Records zero scores and moves to next sentence"
            className="mt-4 py-3 items-center"
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
  // Evaluating state
  // -------------------------------------------------------------------------
  if (t.screenState === "evaluating" && !t.currentEvaluation) {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <View
          className="flex-1 justify-center items-center p-6"
          accessibilityLabel="Evaluating translation"
          accessibilityRole="progressbar"
        >
          <Animated.View entering={FadeIn.duration(300)} className="items-center">
            {[0, 1, 2].map((i) => (
              <SkeletonBar
                key={i}
                width={180 - i * 30}
                height={14}
                style={{ borderRadius: 7, marginBottom: 12 }}
              />
            ))}
            <Text className="text-sm mt-4" style={{ color: Colors.textSecondary }}>
              Evaluating your translation...
            </Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Per-sentence result (after evaluating, before nextSentence or results)
  // -------------------------------------------------------------------------
  if (isPerSentenceResult && t.currentEvaluation) {
    const isLast = t.currentIndex >= t.sentenceCount - 1;

    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <View className="p-5 pb-3">
          <Text className="text-[13px]" style={{ color: Colors.textSecondary }}>
            Sentence {t.currentIndex + 1} of {t.sentenceCount}
          </Text>
        </View>

        <Animated.ScrollView
          entering={FadeIn.duration(300)}
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}
        >
          {/* Dimension scores */}
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
              <DimensionScore label="Accuracy" score={t.currentEvaluation.accuracy.score} />
              <DimensionScore label="Fluency" score={t.currentEvaluation.fluency.score} />
              <DimensionScore label="Naturalness" score={t.currentEvaluation.naturalness.score} />
            </View>
          </Animated.View>

          {/* Feedback per dimension */}
          <Animated.View
            entering={FadeInDown.delay(70).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-3"
              style={{ color: Colors.textSecondary }}
            >
              Feedback
            </Text>
            {[
              { label: "Accuracy", feedback: t.currentEvaluation.accuracy.feedback },
              { label: "Fluency", feedback: t.currentEvaluation.fluency.feedback },
              { label: "Naturalness", feedback: t.currentEvaluation.naturalness.feedback },
            ].map(({ label, feedback }) => (
              <View key={label} className="mb-2">
                <Text className="text-xs font-bold mb-0.5" style={{ color: Colors.textPrimary }}>
                  {label}
                </Text>
                <Text style={Typography.caption}>{feedback}</Text>
              </View>
            ))}
          </Animated.View>

          {/* Comparison: expected vs user */}
          <Animated.View
            entering={FadeInDown.delay(140).duration(300)}
            className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
          >
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-2"
              style={{ color: Colors.accentText }}
            >
              Expected
            </Text>
            <Text className="text-[15px] font-semibold text-primary leading-6 mb-3">
              {t.currentSentence?.target}
            </Text>
            <Text
              className="text-[11px] font-semibold tracking-wider uppercase mb-1"
              style={{ color: Colors.textSecondary }}
            >
              You said
            </Text>
            <Text
              style={{
                fontSize: Typography.bodySecondary.fontSize,
                color: Colors.primary,
                fontStyle: "italic",
                lineHeight: 20,
              }}
            >
              {t.currentEvaluation.userTranscription || "(no transcription)"}
            </Text>
          </Animated.View>

          {/* Pronunciation word chips */}
          {t.currentPronunciationResult && (
            <Animated.View
              entering={FadeInDown.delay(210).duration(300)}
              className="bg-white rounded-2xl p-4 mb-4 border border-surface-300"
            >
              <Text
                className="text-[11px] font-semibold tracking-wider uppercase mb-3"
                style={{ color: Colors.textSecondary }}
              >
                Pronunciation
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {t.currentPronunciationResult.words.map((w, i) => (
                  <PronunciationWordChip key={i} wordScore={w} />
                ))}
              </View>
            </Animated.View>
          )}

          {/* Next / See Results button */}
          <Animated.View entering={FadeInUp.delay(280).duration(300)}>
            <TouchableOpacity
              onPress={t.nextSentence}
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
  if (t.screenState === "results") {
    const scoreColor = getScoreColor(t.overallScore);

    const nonSkipped = t.sentenceResults.filter((r) => !r.skipped && r.evaluation);
    const avgAccuracy =
      nonSkipped.length > 0
        ? Math.round(
            nonSkipped.reduce((s, r) => s + (r.evaluation?.accuracy.score ?? 0), 0) /
              nonSkipped.length
          )
        : 0;
    const avgFluency =
      nonSkipped.length > 0
        ? Math.round(
            nonSkipped.reduce((s, r) => s + (r.evaluation?.fluency.score ?? 0), 0) /
              nonSkipped.length
          )
        : 0;
    const avgNaturalness =
      nonSkipped.length > 0
        ? Math.round(
            nonSkipped.reduce((s, r) => s + (r.evaluation?.naturalness.score ?? 0), 0) /
              nonSkipped.length
          )
        : 0;

    return (
      <SafeAreaView className="flex-1 bg-surface" edges={["bottom"]}>
        <NetworkBanner />
        <FlatList
          data={t.sentenceResults}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderSentenceRow}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Overall score circle */}
              <Animated.View entering={FadeIn.duration(400)} className="items-center mb-6 mt-3">
                <View
                  className="w-[140px] h-[140px] rounded-full justify-center items-center"
                  style={{
                    borderWidth: 6,
                    borderColor: scoreColor,
                    backgroundColor: skillTint(scoreColor, 0.06),
                  }}
                  accessibilityLabel={`Overall score ${t.overallScore} percent`}
                >
                  <Text
                    style={{
                      fontSize: Typography.scoreDisplay.fontSize,
                      fontWeight: "800",
                      color: scoreColor,
                    }}
                  >
                    {t.overallScore}%
                  </Text>
                </View>
                <Text
                  style={{
                    ...Typography.subsectionHeader,
                    color: Colors.primary,
                    marginTop: 12,
                  }}
                >
                  {getScoreLabel(t.overallScore)}
                </Text>

                {/* Time elapsed */}
                <Text className="text-xs mt-2" style={{ color: Colors.textTertiary }}>
                  {t.getElapsedMinutes()} min
                </Text>

                {t.isSavingResults && (
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
                  <SubScoreTile label="Accuracy" score={avgAccuracy} />
                  <View className="w-px bg-surface-200" />
                  <SubScoreTile label="Fluency" score={avgFluency} />
                  <View className="w-px bg-surface-200" />
                  <SubScoreTile label="Naturalness" score={avgNaturalness} />
                </View>
              </Animated.View>

              {/* Sentence breakdown header */}
              <Animated.View
                entering={FadeInDown.delay(200).duration(300)}
                className="bg-white rounded-2xl p-4 mb-0 border border-surface-300"
              >
                <Text accessibilityRole="header" className="text-sm font-bold text-primary mb-1">
                  Sentence breakdown
                </Text>
              </Animated.View>
            </>
          }
          ListFooterComponent={
            <Animated.View
              entering={FadeInUp.delay(300).duration(300)}
              className="flex-row gap-3 mt-4"
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
                onPress={t.tryAgain}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                accessibilityHint="Generates a new translation exercise"
                className="flex-1 bg-primary rounded-xl py-3.5 items-center"
                style={{ minHeight: 44 }}
              >
                <Text className="text-[15px] font-semibold text-white">Try Again</Text>
              </TouchableOpacity>
            </Animated.View>
          }
        />
      </SafeAreaView>
    );
  }

  return null;
}
