/**
 * TCF Mock Test Results Screen
 *
 * Displays TCF-calibrated scores (0-699 for QCM tests; publisher-scale
 * 0-20 for speaking tests — Story 20-4 R1 scale-aware fork), CEFR level per section,
 * overall composite score, and "distance to C1" indicator.
 */

import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { LEVEL_COLORS, TCF } from "@/src/lib/constants";
import { Colors, Typography } from "@/src/lib/design";
import type { CEFRLevel } from "@/src/types/cefr";
import { Icon, type IconName } from "@/src/components/common/Icon";

interface SectionResult {
  score: number;
  correct: number;
  total: number;
  tcfScore: number;
  cefrLevel: string;
}

interface TestResults {
  sections: Record<string, SectionResult>;
  overallTcfScore: number;
  overallCefrLevel: string;
  testType: string;
}

const SECTION_LABELS: Record<string, { name: string; iconName: IconName }> = {
  listening: { name: "Listening Comprehension", iconName: "headphones" },
  reading: { name: "Reading Comprehension", iconName: "book-open" },
  // Legacy — TCF Canada has no Grammar section; kept for historical results only.
  grammar: { name: "Language Structures", iconName: "activity" },
  // Story 20-4 R2: the speaking flow navigates here with sections.speaking —
  // without this entry the card title rendered blank and the accessibility
  // label announced the literal string "undefined".
  speaking: { name: "Oral Expression", iconName: "mic" },
};

function getScoreColor(tcfScore: number): string {
  if (tcfScore >= 500) return Colors.success; // C1+
  if (tcfScore >= 400) return Colors.accent; // B2
  if (tcfScore >= 300) return Colors.skillWriting; // B1
  return Colors.error; // Below B1
}

export default function MockTestResultsScreen() {
  const { data } = useLocalSearchParams<{ data: string }>();
  const router = useRouter();

  let results: TestResults;
  try {
    results = JSON.parse(data ?? "{}") as TestResults;
  } catch {
    results = {
      sections: {},
      overallTcfScore: 0,
      overallCefrLevel: "A1",
      testType: "unknown",
    };
  }

  // UX continuity hint — `TCF.C1_MIN` is the UI round-number band per
  // src/types/cefr.ts CEFR_LEVELS JSDoc. For IRCC math, use
  // src/lib/ircc-bands.ts instead.
  // Story 20-4 R1: speaking composites are on the PUBLISHER 0-20 scale
  // (Story 10-2 — computeSpeakingScore0to20), NOT the 0-699 TCF scale. The
  // pre-R1 render showed a strong 16/20 as "16 / 699" in failing red with a
  // nonsense "~484 points to C1" card — directly beneath the 20-4 honesty
  // note. Scale-aware rendering: /20 denominator, CEFR-level color (the
  // 0-699 color bands are meaningless at 0-20), no distance-to-C1 card.
  const isSpeakingScale = results.testType === "speaking";
  const scoreDenominator = isSpeakingScale ? 20 : 699;
  const distanceToC1 = Math.max(0, TCF.C1_MIN - results.overallTcfScore);
  const scoreColor = isSpeakingScale
    ? (LEVEL_COLORS[results.overallCefrLevel as CEFRLevel] ?? Colors.gray500)
    : getScoreColor(results.overallTcfScore);

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Overall Score */}
      <View
        className="items-center mb-8"
        accessibilityLabel={`Your estimated TCF score: ${results.overallTcfScore} out of ${scoreDenominator}, CEFR level ${results.overallCefrLevel}. Estimated from practice items, not an official TCF prediction.`}
      >
        <Text className="text-sm mb-2" style={{ color: Colors.gray700 }}>
          Your Estimated TCF Score
        </Text>
        <View
          className="w-40 h-40 rounded-full justify-center items-center bg-white"
          style={{
            borderWidth: 8,
            borderColor: scoreColor,
          }}
        >
          <Text className="text-[48px] font-extrabold text-primary">{results.overallTcfScore}</Text>
          <Text className="text-xs" style={{ color: Colors.gray500 }}>
            / {scoreDenominator}
          </Text>
        </View>

        {/* CEFR Badge */}
        <View
          className="px-5 py-2 rounded-full mt-4"
          style={{
            backgroundColor: LEVEL_COLORS[results.overallCefrLevel as CEFRLevel] ?? Colors.gray500,
          }}
        >
          <Text className="text-white text-lg font-extrabold">{results.overallCefrLevel}</Text>
        </View>

        {/* Epic 20.1 (v2-vision-roadmap): score-honesty disclaimer. Practice
            items are AI-generated and not psychometrically calibrated against
            real TCF results — presenting the number as an official prediction
            risks over-confident exam booking (immigration stakes). */}
        <Text
          className="text-xs mt-3 text-center"
          style={{ color: Colors.gray500, maxWidth: 300 }}
          accessibilityRole="text"
        >
          Estimated from practice items — not an official TCF prediction. Confirm your level with an
          official sample test before booking the exam.
        </Text>

        {/* Story 20-4 (v2-vision-roadmap Epic 20): speaking-honesty note.
            Speaking tasks are scored from a Whisper TRANSCRIPT, which
            normalizes pronunciation — the evaluator cannot hear articulation,
            intonation, or accent (the rubric's dimension 1 is scored on
            transcript-observable fluency/coherence only). Azure phoneme-level
            assessment caps at ~30s of PCM audio, so full 5.5-min AAC task
            recordings cannot be routed through it at this architecture tier;
            the honest path is disclosure + a pointer to the surface that DOES
            assess pronunciation. */}
        {results.testType === "speaking" && (
          <View className="mt-3 items-center" style={{ maxWidth: 300 }}>
            <Text
              className="text-xs text-center"
              style={{ color: Colors.gray500 }}
              accessibilityRole="text"
            >
              This estimate covers fluency, vocabulary, grammar, interaction, and register —
              pronunciation is not scored from exam recordings.
            </Text>
            <TouchableOpacity
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing typed-routes widening pattern in this file
              onPress={() => router.push("/(tabs)/practice/pronunciation" as any)}
              accessibilityRole="button"
              accessibilityLabel="Get phoneme-level pronunciation feedback in Pronunciation Practice"
              accessibilityHint="Opens the Pronunciation Practice screen"
            >
              <Text className="text-xs mt-1 font-semibold" style={{ color: Colors.accentText }}>
                Get pronunciation feedback in Pronunciation Practice →
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Distance to C1 */}
        {!isSpeakingScale && distanceToC1 > 0 && (
          <View
            className="bg-accent/10 rounded-xl p-4 mt-4 w-full items-center"
            accessibilityLabel={`${distanceToC1} points away from C1 level`}
            accessibilityRole="text"
          >
            <Text className="text-[13px] mb-1" style={{ color: Colors.gray700 }}>
              Distance to C1 (500+)
            </Text>
            <Text style={{ color: Colors.accentText }} className="text-[28px] font-extrabold">
              {distanceToC1} points
            </Text>
            {/* Progress bar to C1 */}
            <View
              className="w-full h-2 bg-surface-300 rounded-sm mt-2"
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 500, now: results.overallTcfScore }}
            >
              <View
                style={{
                  width: `${Math.min(100, (results.overallTcfScore / 500) * 100)}%`,
                  height: 8,
                  backgroundColor: scoreColor,
                  borderRadius: 4,
                }}
              />
            </View>
          </View>
        )}

        {distanceToC1 === 0 && (
          <View className="bg-success/10 rounded-xl p-4 mt-4 w-full items-center">
            <Text className="text-xl font-extrabold text-success">C1 Achieved!</Text>
            <Text className="text-[13px] mt-1" style={{ color: Colors.gray700 }}>
              You&apos;ve reached the C1 threshold on this mock test.
            </Text>
          </View>
        )}
      </View>

      {/* Section Breakdown */}
      <Text className="text-lg font-bold text-primary mb-3" accessibilityRole="header">
        Section Breakdown
      </Text>

      <View className="gap-3 mb-6">
        {Object.entries(results.sections).map(([sectionKey, sectionResult]) => {
          const meta = SECTION_LABELS[sectionKey];
          const sectionColor = isSpeakingScale
            ? (LEVEL_COLORS[sectionResult.cefrLevel as CEFRLevel] ?? Colors.gray500)
            : getScoreColor(sectionResult.tcfScore);

          return (
            <View
              key={sectionKey}
              className="bg-white rounded-2xl p-4 border border-surface-300"
              accessibilityLabel={`${meta?.name}: score ${sectionResult.tcfScore} out of ${scoreDenominator}, ${sectionResult.cefrLevel} level${isSpeakingScale ? `, ${sectionResult.total} tasks` : `, ${sectionResult.correct} of ${sectionResult.total} correct`}`}
            >
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  {meta !== undefined && (
                    <Icon name={meta.iconName} size={20} color={Colors.primary} />
                  )}
                  <View>
                    <Text className="text-base font-bold text-primary">{meta?.name}</Text>
                    <Text className="text-[11px]" style={{ color: Colors.gray500 }}>
                      {isSpeakingScale
                        ? `${sectionResult.total} tasks`
                        : `${sectionResult.correct}/${sectionResult.total} correct`}
                    </Text>
                  </View>
                </View>

                <View className="items-end">
                  <Text
                    style={{
                      fontSize: Typography.subsectionHeader.fontSize,
                      fontWeight: "800",
                      color: sectionColor,
                    }}
                  >
                    {sectionResult.tcfScore}
                  </Text>
                  <View
                    className="px-2 py-0.5 rounded-md mt-0.5"
                    style={{
                      backgroundColor:
                        LEVEL_COLORS[sectionResult.cefrLevel as CEFRLevel] ?? Colors.gray500,
                    }}
                  >
                    <Text className="text-white text-[11px] font-bold">
                      {sectionResult.cefrLevel}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Score bar */}
              <View className="h-1.5 bg-surface-200 rounded-sm">
                <View
                  style={{
                    height: 6,
                    width: `${Math.min(100, (sectionResult.tcfScore / scoreDenominator) * 100)}%`,
                    backgroundColor: sectionColor,
                    borderRadius: 3,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* Actions */}
      <View className="gap-3">
        <TouchableOpacity
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
          onPress={() => router.replace("/(tabs)/mock-test" as any)}
          accessibilityRole="button"
          accessibilityLabel="Take another test"
          className="bg-primary rounded-xl py-4 items-center"
        >
          <Text className="text-white text-base font-bold">Take Another Test</Text>
        </TouchableOpacity>
        <TouchableOpacity
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
          onPress={() => router.replace("/(tabs)/home" as any)}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          className="bg-surface-200 rounded-xl py-4 items-center"
        >
          <Text className="text-primary text-base font-semibold">Back to Home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
