/**
 * TCF Mock Test Results Screen
 *
 * Displays TCF-calibrated scores (0-699), CEFR level per section,
 * overall composite score, and "distance to C1" indicator.
 */

import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { LEVEL_COLORS } from "@/src/lib/constants";
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
  grammar: { name: "Structures de la Langue", emoji: "\uD83E\uDDE0" },
};

function getScoreColor(tcfScore: number): string {
  if (tcfScore >= 500) return "#34C759"; // C1+
  if (tcfScore >= 400) return "#F5A623"; // B2
  if (tcfScore >= 300) return "#FF9800"; // B1
  return "#FF3B30"; // Below B1
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

  const distanceToC1 = Math.max(0, 500 - results.overallTcfScore);
  const scoreColor = getScoreColor(results.overallTcfScore);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F5F5F0" }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Overall Score */}
      <View style={{ alignItems: "center", marginBottom: 32 }}>
        <Text style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>Your TCF Score</Text>
        <View
          style={{
            width: 160,
            height: 160,
            borderRadius: 80,
            borderWidth: 8,
            borderColor: scoreColor,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#FFFFFF",
          }}
        >
          <Text
            style={{
              fontSize: 44,
              fontWeight: "900",
              color: "#1E3A5F",
            }}
          >
            {results.overallTcfScore}
          </Text>
          <Text style={{ fontSize: 12, color: "#999" }}>/ 699</Text>
        </View>

        {/* CEFR Badge */}
        <View
          style={{
            backgroundColor: LEVEL_COLORS[results.overallCefrLevel as CEFRLevel] ?? "#999",
            paddingHorizontal: 20,
            paddingVertical: 8,
            borderRadius: 20,
            marginTop: 16,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800" }}>
            {results.overallCefrLevel}
          </Text>
        </View>

        {/* Distance to C1 */}
        {distanceToC1 > 0 && (
          <View
            style={{
              backgroundColor: "#FFF8F0",
              borderRadius: 12,
              padding: 16,
              marginTop: 16,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
              Distance to C1 (500+)
            </Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: "#F5A623" }}>
              {distanceToC1} points
            </Text>
            {/* Progress bar to C1 */}
            <View
              style={{
                width: "100%",
                height: 8,
                backgroundColor: "#E0E0CE",
                borderRadius: 4,
                marginTop: 8,
              }}
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
          <View
            style={{
              backgroundColor: "#E8F5E9",
              borderRadius: 12,
              padding: 16,
              marginTop: 16,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#2E7D32" }}>C1 Achieved!</Text>
            <Text style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              You&apos;ve reached the C1 threshold on this mock test.
            </Text>
          </View>
        )}
      </View>

      {/* Section Breakdown */}
      <Text
        style={{
          fontSize: 18,
          fontWeight: "700",
          color: "#1E3A5F",
          marginBottom: 12,
        }}
      >
        Section Breakdown
      </Text>

      <View style={{ gap: 12, marginBottom: 24 }}>
        {Object.entries(results.sections).map(([sectionKey, sectionResult]) => {
          const meta = SECTION_LABELS[sectionKey];
          const sectionColor = getScoreColor(sectionResult.tcfScore);

          return (
            <View
              key={sectionKey}
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: "#E0E0CE",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 20 }}>{meta?.emoji}</Text>
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#1E3A5F" }}>
                      {meta?.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: "#999" }}>
                      {sectionResult.correct}/{sectionResult.total} correct
                    </Text>
                  </View>
                </View>

                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={{
                      fontSize: 22,
                      fontWeight: "800",
                      color: sectionColor,
                    }}
                  >
                    {sectionResult.tcfScore}
                  </Text>
                  <View
                    style={{
                      backgroundColor: LEVEL_COLORS[sectionResult.cefrLevel as CEFRLevel] ?? "#999",
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 6,
                      marginTop: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 11,
                        fontWeight: "700",
                      }}
                    >
                      {sectionResult.cefrLevel}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Score bar */}
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
      <View style={{ gap: 12 }}>
        <TouchableOpacity
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
          onPress={() => router.replace("/(tabs)/mock-test" as any)}
          style={{
            backgroundColor: "#1E3A5F",
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
            Take Another Test
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
          onPress={() => router.replace("/(tabs)/home" as any)}
          style={{
            backgroundColor: "#F0F0E8",
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#1E3A5F", fontSize: 16, fontWeight: "600" }}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
