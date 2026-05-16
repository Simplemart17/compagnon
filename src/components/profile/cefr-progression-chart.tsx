/**
 * CEFR Progression Chart
 *
 * A lightweight step chart built with basic React Native Views (no chart library).
 * Shows CEFR level progression over time with:
 * - Y-axis: CEFR levels (A1 at bottom, C2 at top)
 * - X-axis: Time (dates)
 * - Stepped line connecting data points
 * - Dashed target level indicator
 * - Current level badge
 */

import React, { useMemo } from "react";
import { View, Text } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Colors, Typography } from "@/src/lib/design";
import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";
import type { CEFRDataPoint } from "@/src/hooks/use-cefr-history";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total height of the chart area (excluding labels). */
const CHART_HEIGHT = 200;

/** Left margin for Y-axis labels. */
const Y_AXIS_WIDTH = 32;

/** Bottom margin for X-axis labels. */
const X_AXIS_HEIGHT = 28;

/** Size of data point circles. */
const POINT_RADIUS = 6;

/** The 6 CEFR levels in display order (bottom to top). */
const LEVELS = CEFR_ORDER; // ["A1", "A2", "B1", "B2", "C1", "C2"]

/** Number of steps (gaps between levels). */
const LEVEL_COUNT = LEVELS.length;

/** Vertical spacing per level. */
const STEP_HEIGHT = CHART_HEIGHT / (LEVEL_COUNT - 1);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CEFRProgressionChartProps {
  dataPoints: CEFRDataPoint[];
  targetLevel: CEFRLevel;
  currentLevel: CEFRLevel;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a CEFR level to a Y position (0 = bottom of chart = A1). */
function levelToY(level: CEFRLevel): number {
  const idx = CEFR_ORDER.indexOf(level);
  // Y is measured from the top of the chart container,
  // so A1 (idx 0) should be at the bottom (CHART_HEIGHT) and C2 at the top (0).
  return CHART_HEIGHT - idx * STEP_HEIGHT;
}

/**
 * Format a date string (YYYY-MM-DD) to a short display format.
 * Shows "DD/MM" for compactness.
 */
function formatDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CEFRProgressionChartInner({
  dataPoints,
  targetLevel,
  currentLevel,
}: CEFRProgressionChartProps) {
  // Calculate the horizontal positions for data points
  const chartLayout = useMemo(() => {
    if (dataPoints.length === 0) return { points: [], lines: [], chartWidth: 0 };

    // For a single point, center it; for multiple, distribute evenly
    const availableWidth = 280; // Will be constrained by parent
    const padding = 16;
    const usableWidth = availableWidth - padding * 2;

    const points = dataPoints.map((dp, idx) => {
      const x =
        dataPoints.length === 1
          ? usableWidth / 2 + padding
          : padding + (idx / (dataPoints.length - 1)) * usableWidth;
      const y = levelToY(dp.level);
      return { ...dp, x, y };
    });

    // Build step-line segments: horizontal then vertical
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];

      // Horizontal segment at the current level
      lines.push({ x1: from.x, y1: from.y, x2: to.x, y2: from.y });
      // Vertical segment to the next level (if different)
      if (from.y !== to.y) {
        lines.push({ x1: to.x, y1: from.y, x2: to.x, y2: to.y });
      }
    }

    return { points, lines, chartWidth: availableWidth };
  }, [dataPoints]);

  const targetY = levelToY(targetLevel);

  return (
    <Animated.View
      entering={FadeIn.delay(300).duration(400)}
      style={{
        backgroundColor: Colors.surfaceWhite,
        borderRadius: 16,
        padding: 16,
        shadowColor: Colors.shadow,
        shadowOffset: { width: 0, height: 2 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
        shadowOpacity: 0.06, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke chart-card shadow tone (Colors.shadow gray, not Shadows.card navy) preserved per Story 14-4 R1-P2
        shadowRadius: 6, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with bespoke chart-card shadow above
        elevation: 3,
      }}
    >
      {/* Section title */}
      <Text
        style={{
          ...Typography.sectionHeader,
          marginBottom: 16,
        }}
      >
        Progression
      </Text>

      {/* Chart container */}
      <View
        style={{
          flexDirection: "row",
          height: CHART_HEIGHT + X_AXIS_HEIGHT,
        }}
      >
        {/* Y-axis labels */}
        <View
          style={{
            width: Y_AXIS_WIDTH,
            height: CHART_HEIGHT,
            justifyContent: "space-between",
          }}
        >
          {[...LEVELS].reverse().map((level) => (
            <View
              key={level}
              style={{
                height: 0,
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: level === currentLevel ? "700" : "400",
                  color: level === currentLevel ? Colors.progress : Colors.textTertiary,
                }}
              >
                {level}
              </Text>
            </View>
          ))}
        </View>

        {/* Chart area */}
        <View style={{ flex: 1, height: CHART_HEIGHT + X_AXIS_HEIGHT }}>
          {/* Grid lines and chart */}
          <View
            style={{
              height: CHART_HEIGHT,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Horizontal grid lines */}
            {LEVELS.map((level) => {
              const y = levelToY(level);
              return (
                <View
                  key={`grid-${level}`}
                  style={{
                    position: "absolute",
                    top: y,
                    left: 0,
                    right: 0,
                    height: 1,
                    backgroundColor: Colors.gray200,
                  }}
                />
              );
            })}

            {/* Target level dashed line */}
            <View
              style={{
                position: "absolute",
                top: targetY,
                left: 0,
                right: 0,
                height: 1,
                flexDirection: "row",
                alignItems: "center",
              }}
              accessibilityLabel={`Target level: ${targetLevel}`}
            >
              {/* Dashed line: alternating filled/empty segments */}
              {Array.from({ length: 30 }).map((_, i) => (
                <View
                  key={`dash-${i}`}
                  style={{
                    width: 6,
                    height: 1,
                    backgroundColor: i % 2 === 0 ? Colors.textTertiary : "transparent",
                    marginRight: 2,
                  }}
                />
              ))}
            </View>

            {/* Target level label */}
            <View
              style={{
                position: "absolute",
                top: targetY - 16,
                right: 0,
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  color: Colors.textTertiary,
                  fontWeight: "600",
                }}
              >
                Objectif {targetLevel}
              </Text>
            </View>

            {/* Step-line segments */}
            {chartLayout.lines.map((line, idx) => {
              const isHorizontal = line.y1 === line.y2;
              if (isHorizontal) {
                const left = Math.min(line.x1, line.x2);
                const width = Math.abs(line.x2 - line.x1);
                return (
                  <Animated.View
                    key={`line-h-${idx}`}
                    entering={FadeIn.delay(400 + idx * 50).duration(300)}
                    style={{
                      position: "absolute",
                      top: line.y1 - 1,
                      left,
                      width,
                      height: 2,
                      backgroundColor: Colors.progress, // Story 14-5: chart-data feedback (NOT a CTA)
                    }}
                  />
                );
              }
              // Vertical segment
              const top = Math.min(line.y1, line.y2);
              const height = Math.abs(line.y2 - line.y1);
              return (
                <Animated.View
                  key={`line-v-${idx}`}
                  entering={FadeIn.delay(400 + idx * 50).duration(300)}
                  style={{
                    position: "absolute",
                    top,
                    left: line.x1 - 1,
                    width: 2,
                    height,
                    backgroundColor: Colors.progress, // Story 14-5: chart-data feedback
                  }}
                />
              );
            })}

            {/* Data points */}
            {chartLayout.points.map((point, idx) => (
              <Animated.View
                key={`point-${idx}`}
                entering={FadeIn.delay(500 + idx * 80).duration(300)}
                accessibilityLabel={`${point.label}: ${point.level} on ${point.date}`}
                style={{
                  position: "absolute",
                  top: point.y - POINT_RADIUS,
                  left: point.x - POINT_RADIUS,
                  width: POINT_RADIUS * 2,
                  height: POINT_RADIUS * 2,
                  borderRadius: POINT_RADIUS,
                  backgroundColor: Colors.surfaceWhite,
                  borderWidth: 2.5,
                  borderColor: Colors.progress, // Story 14-5: chart-marker (data feedback)
                  // Shadow for depth
                  shadowColor: Colors.progress,
                  shadowOffset: { width: 0, height: 1 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
                  shadowOpacity: 0.3, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke chart-marker dot shadow per Q6
                  shadowRadius: 3, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with chart-marker dot shadow above
                  elevation: 2,
                }}
              />
            ))}

            {/* Current level badge on the last data point */}
            {chartLayout.points.length > 0 && (
              <Animated.View
                entering={FadeIn.delay(700).duration(350)}
                style={{
                  position: "absolute",
                  top: chartLayout.points[chartLayout.points.length - 1].y - POINT_RADIUS - 22,
                  left: chartLayout.points[chartLayout.points.length - 1].x - 16,
                  backgroundColor: Colors.progress, // Story 14-5: chart-data badge (NOT a CTA)
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "700",
                    color: Colors.textOnDark,
                  }}
                >
                  {currentLevel}
                </Text>
              </Animated.View>
            )}
          </View>

          {/* X-axis date labels */}
          <View
            style={{
              height: X_AXIS_HEIGHT,
              position: "relative",
            }}
          >
            {chartLayout.points.map((point, idx) => (
              <Text
                key={`date-${idx}`}
                style={{
                  position: "absolute",
                  top: 6,
                  left: point.x - 18,
                  width: 36,
                  textAlign: "center",
                  fontSize: 9,
                  color: Colors.textTertiary,
                }}
              >
                {formatDate(point.date)}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function CEFRProgressionEmpty() {
  return (
    <Animated.View
      entering={FadeIn.delay(300).duration(400)}
      style={{
        backgroundColor: Colors.surfaceWhite,
        borderRadius: 16,
        padding: 20,
        shadowColor: Colors.shadow,
        shadowOffset: { width: 0, height: 2 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
        shadowOpacity: 0.06, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke chart-card shadow tone preserved per Story 14-4 R1-P2
        shadowRadius: 6, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with bespoke chart-card shadow above
        elevation: 3,
      }}
    >
      <Text
        style={{
          ...Typography.sectionHeader,
          marginBottom: 12,
        }}
      >
        Progression
      </Text>
      <Text
        style={{
          ...Typography.caption,
          textAlign: "center",
          lineHeight: 19,
          paddingVertical: 16,
        }}
      >
        Complete exercises to track your progression over time.
      </Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper
// ---------------------------------------------------------------------------

interface CEFRProgressionChartWrapperProps {
  dataPoints: CEFRDataPoint[];
  targetLevel: CEFRLevel;
  currentLevel: CEFRLevel;
  loading: boolean;
}

export const CEFRProgressionChart = React.memo(function CEFRProgressionChart({
  dataPoints,
  targetLevel,
  currentLevel,
  loading,
}: CEFRProgressionChartWrapperProps) {
  if (loading) {
    return null;
  }

  // Show empty state if we have 0 or only 1 data point at the same starting level
  // (i.e., user hasn't progressed yet -- but still show 1 point if they have data)
  if (dataPoints.length === 0) {
    return <CEFRProgressionEmpty />;
  }

  return (
    <CEFRProgressionChartInner
      dataPoints={dataPoints}
      targetLevel={targetLevel}
      currentLevel={currentLevel}
    />
  );
});
