/**
 * TCF Mock Test Results Screen
 *
 * Displays TCF-calibrated scores (0-699), CEFR level per section,
 * overall composite score, and "distance to C1" indicator.
 */

import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { LEVEL_COLORS, TCF } from "@/src/lib/constants";
import { Colors, Typography } from "@/src/lib/design";
import type { CEFRLevel } from "@/src/types/cefr";

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

const SECTION_LABELS: Record<string, { name: string; emoji: string }> = {
  listening: { name: "Compréhension Orale", emoji: "\uD83C\uDFA7" },
  reading: { name: "Compréhension Écrite", emoji: "\uD83D\uDCD6" },
  // Legacy — TCF Canada has no Grammar section; kept for historical results only.
  grammar: { name: "Structures de la Langue", emoji: "\uD83E\uDDE0" },
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
  const distanceToC1 = Math.max(0, TCF.C1_MIN - results.overallTcfScore);
  const scoreColor = getScoreColor(results.overallTcfScore);

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Overall Score */}
      <View
        className="items-center mb-8"
        accessibilityLabel={`Your TCF score: ${results.overallTcfScore} out of 699, CEFR level ${results.overallCefrLevel}`}
      >
        <Text className="text-sm mb-2" style={{ color: Colors.gray700 }}>
          Your TCF Score
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
            / 699
          </Text>
        </View>

        {/* CEFR Badge */}
        <View
          className="px-5 py-2 rounded-[20px] mt-4"
          style={{
            backgroundColor: LEVEL_COLORS[results.overallCefrLevel as CEFRLevel] ?? Colors.gray500,
          }}
        >
          <Text className="text-white text-lg font-extrabold">{results.overallCefrLevel}</Text>
        </View>

        {/* Distance to C1 */}
        {distanceToC1 > 0 && (
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
          const sectionColor = getScoreColor(sectionResult.tcfScore);

          return (
            <View
              key={sectionKey}
              className="bg-white rounded-2xl p-4 border border-surface-300"
              accessibilityLabel={`${meta?.name}: TCF score ${sectionResult.tcfScore}, ${sectionResult.cefrLevel} level, ${sectionResult.correct} of ${sectionResult.total} correct`}
            >
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  <Text className="text-xl">{meta?.emoji}</Text>
                  <View>
                    <Text className="text-base font-bold text-primary">{meta?.name}</Text>
                    <Text className="text-[11px]" style={{ color: Colors.gray500 }}>
                      {sectionResult.correct}/{sectionResult.total} correct
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
                    width: `${Math.min(100, (sectionResult.tcfScore / 699) * 100)}%`,
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
