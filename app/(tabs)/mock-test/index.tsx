import { useCallback, useRef } from "react";
import { View, Text, ScrollView, Pressable, StatusBar } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

import { LEVEL_COLORS, TCF } from "@/src/lib/constants";
import { Colors, Radii, Typography, skillTint } from "@/src/lib/design";
import { SkillCard } from "@/src/components/common/SkillCard";
import { ListItemCard } from "@/src/components/common/ListItemCard";
import { Icon, type IconName } from "@/src/components/common/Icon";
import { HeroHeader } from "@/src/components/common/HeroHeader";
import { SPEAKING_TASK_NUMBERS } from "@/src/lib/prompts/speaking";
import { TCF_QCM_SECTIONS, roundToNearestFive } from "@/src/lib/tcf";
import { useMockTestLanding } from "@/src/hooks/use-mock-test-landing";
import { useMockTestResultsLoader } from "@/src/hooks/use-mock-test-results-loader";
import {
  formatTimeRemaining,
  formatPastResultDate,
  formatPastResultDuration,
} from "@/src/lib/mock-test-results";
import type {
  MockTestInProgressSummary,
  MockTestPastResult,
  PastResultTestType,
} from "@/src/hooks/use-mock-test-landing";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestSection = "full" | "listening" | "reading";

const QCM_TOTAL_MINUTES = TCF_QCM_SECTIONS.listening.minutes + TCF_QCM_SECTIONS.reading.minutes;

const QCM_PILL_MINUTES = roundToNearestFive(QCM_TOTAL_MINUTES);

// Per-test-type chrome for past-results rows (Story 14-1 chrome rule:
// titlePrimary EN, titleSecondary FR pedagogical reinforcement).
//
// R1-P2: speaking entry removed. Speaking past-results are excluded from
// the v1 landing because `reconstructTestResultsFromMockTestRow` can't
// handle the per-task `section_scores: {speaking:{task1,task2,task3,
// compositeOverall}}` shape Story 9-8 persists. When a speaking-results
// detail screen ships, restore the entry + add a speaking branch in the
// reconstruction helper.
const PAST_RESULT_LABELS: Record<
  PastResultTestType,
  {
    titlePrimary: string;
    titleSecondary: string;
    iconName: IconName;
    iconColor: string;
  }
> = {
  full: {
    titlePrimary: "Full QCM",
    titleSecondary: "Listening + Reading",
    iconName: "award",
    iconColor: Colors.primary,
  },
  listening: {
    titlePrimary: "Listening",
    titleSecondary: "Compréhension orale",
    iconName: "headphones",
    iconColor: Colors.skillListening,
  },
  reading: {
    titlePrimary: "Reading",
    titleSecondary: "Compréhension écrite",
    iconName: "book-open",
    iconColor: Colors.skillReading,
  },
};

const RESUME_TITLES: Record<MockTestInProgressSummary["testType"], string> = {
  full: "TCF Canada — Full QCM",
  listening: "Listening section",
  reading: "Reading section",
};

// ---------------------------------------------------------------------------
// Full simulation card
// ---------------------------------------------------------------------------

interface FullSimCardProps {
  onPress: () => void;
}

function FullSimCard({ onPress }: FullSimCardProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      className="mx-5 mt-[15px] rounded-3xl"
      style={[
        {
          shadowColor: Colors.textPrimary,
          shadowOffset: { width: 0, height: 8 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
          shadowOpacity: 0.25, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke prominent hero CTA shadow for FullSimCard
          shadowRadius: 16, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with hero CTA above
          elevation: 10,
        },
        animStyle,
      ]}
    >
      <Pressable
        onPressIn={() => {
          scale.value = withTiming(0.98, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`TCF Canada comprehension. Listening and reading sections back-to-back, approximately ${QCM_PILL_MINUTES} minutes.`}
        className="bg-primary rounded-3xl p-6 overflow-hidden"
      >
        {/* Subtle inner overlay for depth */}
        <View
          className="absolute w-[120px] h-[120px] rounded-full"
          style={{
            top: 0,
            right: 0,
            backgroundColor: skillTint(Colors.accent, 0.06),
            transform: [{ translateX: 40 }, { translateY: -40 }],
          }}
        />

        {/* Badge */}
        <Text className="text-accent text-[10px] font-bold tracking-[1.5px] mb-[10px]">
          FULL COMPREHENSION
        </Text>

        {/* Title */}
        <Text className="text-white text-[22px] font-extrabold mb-2">TCF Canada — QCM</Text>

        {/* Description */}
        <Text className="text-[13px] leading-5 mb-4" style={{ color: Colors.textOnDarkSecondary }}>
          2 comprehension sections: Listening ({TCF_QCM_SECTIONS.listening.minutes} min) + Reading (
          {TCF_QCM_SECTIONS.reading.minutes} min)
        </Text>

        {/* Bottom row: time pill + section dots */}
        <View className="flex-row items-center justify-between">
          {/* QCM total pill, computed from TCF.* */}
          <View
            className="rounded-2xl px-[14px] py-[6px]"
            style={{
              backgroundColor: skillTint(Colors.accent, 0.2),
              borderWidth: 1,
              borderColor: skillTint(Colors.accent, 0.4),
            }}
          >
            <Text className="text-accent text-xs font-bold">~{QCM_PILL_MINUTES} min</Text>
          </View>

          {/* 2 section dots: listening, reading */}
          <View className="flex-row gap-[6px]">
            {[Colors.skillListening, Colors.skillReading].map((color, i) => (
              <View
                key={i}
                className="w-[10px] h-[10px] rounded-full"
                style={{ backgroundColor: color }}
              />
            ))}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Resume row (Story 14-7 — uses ListItemCard with accent left strip)
// ---------------------------------------------------------------------------

function ResumeInProgressRow({
  inProgress,
  onPress,
}: {
  inProgress: MockTestInProgressSummary;
  onPress: () => void;
}) {
  // R1-P15: changed from "Question ${savedQuestionIndex+1} of
  // ${totalQuestionsAcrossSections}" (misleading — mixed section-relative
  // numerator with across-sections denominator; rendered as "Question 5 of
  // 78" when user was on Reading section question 5) to an answered-count
  // formulation: "${answered} of ${total} answered". This is user-meaningful
  // ("how close to done am I?") and the two numbers share the same scope.
  const sectionLabel = `Section ${inProgress.savedSectionIndex + 1}`;
  const progressLabel =
    inProgress.totalQuestionsAcrossSections > 0
      ? `${inProgress.totalQuestionsAnswered} of ${inProgress.totalQuestionsAcrossSections} answered`
      : `${inProgress.totalQuestionsAnswered} answered`;
  const progressLine = `${sectionLabel} · ${progressLabel}`;
  const timeLine = formatTimeRemaining(inProgress.adjustedTimeRemaining);

  return (
    <ListItemCard
      titlePrimary={RESUME_TITLES[inProgress.testType]}
      titleSecondary={progressLine}
      description={timeLine}
      iconNode={<Icon name="play-circle" size={24} color={Colors.accent} />}
      iconColor={Colors.accent}
      leftStripColor={Colors.accent}
      rightContent={
        // R1-P10: Story 14-3 R1-P1 cross-platform decorative pattern.
        // `accessibilityElementsHidden` alone is iOS-only — Android
        // TalkBack still focuses + announces "right arrow". The 3-prop
        // combination is required for both platforms.
        <Text
          style={[Typography.cardTitle, { color: Colors.accent }]}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          →
        </Text>
      }
      onPress={onPress}
      accessibilityLabel={`Resume ${RESUME_TITLES[inProgress.testType]}, ${progressLine}, ${timeLine}`}
      accessibilityHint="Double tap to continue your test where you left off."
    />
  );
}

// ---------------------------------------------------------------------------
// Past-result row
// ---------------------------------------------------------------------------

function PastResultRow({
  result,
  index,
  onPress,
}: {
  result: MockTestPastResult;
  index: number;
  onPress: (id: string) => void;
}) {
  const labels = PAST_RESULT_LABELS[result.testType];
  const dateLabel = formatPastResultDate(result.completedAt);
  const durationLabel = formatPastResultDuration(result.durationSeconds);
  const description = `${dateLabel} · ${durationLabel}`;
  const cefrColor =
    result.cefrResult !== null ? LEVEL_COLORS[result.cefrResult as CEFRLevel] : Colors.borderLight;

  // Right-content: CEFR badge pill + (for non-speaking) TCF score below
  const rightContent = (
    <View style={{ alignItems: "flex-end", gap: 4 }}>
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: Radii.chip,
          backgroundColor: cefrColor,
        }}
      >
        <Text style={{ ...Typography.caption, color: Colors.textOnDark, fontWeight: "700" }}>
          {result.cefrResult ?? "—"}
        </Text>
      </View>
      {/* R1-P2: All past-result test_types in v1 use the TCF 0-699 scale
          (speaking was excluded; see PastResultTestType JSDoc). When
          speaking is restored, branch this back to suppress the score
          line for `testType === "speaking"`. */}
      <Text style={[Typography.caption, { color: Colors.textSecondary }]}>
        {result.totalScore !== null ? `${result.totalScore}/699` : "—"}
      </Text>
    </View>
  );

  const accessibilityLabel = `${labels.titlePrimary} on ${dateLabel}, scored ${result.cefrResult ?? "no rating"}`;

  return (
    <ListItemCard
      titlePrimary={labels.titlePrimary}
      titleSecondary={labels.titleSecondary}
      description={description}
      iconNode={<Icon name={labels.iconName} size={24} color={labels.iconColor} />}
      iconColor={labels.iconColor}
      leftStripColor={cefrColor}
      rightContent={rightContent}
      delay={index * 80}
      onPress={() => onPress(result.id)}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Double tap to view detailed results."
    />
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (~76pt height matches ListItemCard's natural row height)
// ---------------------------------------------------------------------------

function LandingSkeletonRow() {
  return (
    <View
      style={{
        height: 76,
        backgroundColor: Colors.primary5,
        borderRadius: Radii.card,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const SECTIONS: {
  id: "listening" | "reading";
  nameFr: string;
  nameSub: string;
  questions: number;
  minutes: number | null;
  iconName: IconName;
  color: string;
}[] = [
  {
    id: "listening",
    nameFr: TCF_QCM_SECTIONS.listening.nameFr,
    nameSub: TCF_QCM_SECTIONS.listening.nameEn,
    questions: TCF_QCM_SECTIONS.listening.questions,
    minutes: TCF_QCM_SECTIONS.listening.minutes,
    iconName: "headphones",
    color: Colors.skillListening,
  },
  {
    id: "reading",
    nameFr: TCF_QCM_SECTIONS.reading.nameFr,
    nameSub: TCF_QCM_SECTIONS.reading.nameEn,
    questions: TCF_QCM_SECTIONS.reading.questions,
    minutes: TCF_QCM_SECTIONS.reading.minutes,
    iconName: "book-open",
    color: Colors.skillReading,
  },
];

export default function MockTestScreen() {
  const router = useRouter();
  const { inProgress, pastResults, loading, refetch } = useMockTestLanding();
  const { loadAndNavigate } = useMockTestResultsLoader();

  // R1-P7 + R1-P8: track whether we've completed at least one fetch so
  // skeletons only render during the COLD load — subsequent refetches
  // (from focus events, etc.) keep displaying the previously-loaded data
  // without flickering through skeletons. First-time users with zero data
  // see skeletons briefly then transitioning sections collapse cleanly
  // instead of phantom-row flashes; returning users see their previous
  // data immediately on tab focus, then quietly updated by the background
  // refetch.
  const hasFetchedOnceRef = useRef(false);
  const showSkeletons = loading && !hasFetchedOnceRef.current;
  if (!loading && !hasFetchedOnceRef.current) {
    hasFetchedOnceRef.current = true;
  }

  // R1-P3: skip the FIRST focus invocation to prevent a double-fetch with
  // the hook's own initial-mount `useEffect`. `useFocusEffect` fires on
  // first focus (which on a tab screen coincides with mount). The hook
  // already dispatches the initial fetch in its `useEffect`; we only want
  // useFocusEffect to refresh on SUBSEQUENT focus events (e.g., returning
  // from the test runner / results screen).
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void refetch();
    }, [refetch])
  );

  const startTest = (section: TestSection) => {
    router.push({ pathname: "/(tabs)/mock-test/[testId]", params: { testId: section } });
  };

  const resumeInProgress = () => {
    if (inProgress === null) return;
    router.push({
      pathname: "/(tabs)/mock-test/[testId]",
      params: { testId: inProgress.testType },
    });
  };

  return (
    <View className="flex-1 bg-surface">
      <StatusBar barStyle="light-content" />
      {/* ------------------------------------------------------------------ */}
      {/* Hero header — Story 14-9: canonical HeroHeader                       */}
      {/* (paddingTopOffset=20, paddingBottom=32, centered).                   */}
      {/* ------------------------------------------------------------------ */}
      <HeroHeader paddingTopOffset={20} paddingBottom={32} centered>
        {/* Thin amber horizontal line above TCF */}
        <View className="w-[60px] h-[2px] bg-accent rounded-sm mb-[10px]" />

        {/* TCF large title */}
        <Text className="text-[48px] font-extrabold text-accent tracking-[4px] leading-[56px]">
          TCF
        </Text>

        {/* Subtitle */}
        <Text
          className="text-xs tracking-[0.5px] text-center mt-1"
          style={{ color: Colors.textOnDarkSecondary }}
        >
          Test de Connaissance du Fran{"\xE7"}ais — Canada
        </Text>
      </HeroHeader>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Resume in-progress section (Story 14-7) — renders ABOVE the
            FullSimCard when an in-progress test exists. Skeleton during
            COLD load only (R1-P7+P8 — `showSkeletons`); hidden entirely
            when no in-progress test. */}
        {showSkeletons ? (
          <View className="mx-5 mt-[15px]">
            <LandingSkeletonRow />
          </View>
        ) : inProgress !== null ? (
          <View className="mx-5 mt-[15px]">
            <Text className="text-lg font-bold text-primary mb-3" accessibilityRole="header">
              Resume
            </Text>
            <ResumeInProgressRow inProgress={inProgress} onPress={resumeInProgress} />
          </View>
        ) : null}

        {/* Full simulation card overlapping the hero */}
        <FullSimCard onPress={() => startTest("full")} />

        {/* Section label */}
        <Text className="text-lg font-bold text-primary mx-5 mt-7 mb-3" accessibilityRole="header">
          Individual sections
        </Text>

        {/* Individual section cards (Story 14-2: consolidated to SkillCard) */}
        <View className="px-5 gap-3">
          {SECTIONS.map((section, index) => {
            const meta: string[] = [];
            if (section.questions !== null) meta.push(`${section.questions} questions`);
            if (section.minutes !== null) meta.push(`${section.minutes} min`);
            return (
              <SkillCard
                key={section.id}
                emoji=""
                iconNode={<Icon name={section.iconName} size={24} color={section.color} />}
                titleFr={section.nameFr}
                titleEn={section.nameSub}
                description={meta.join(" | ")}
                accentColor={section.color}
                delay={index * 80}
                onPress={() => startTest(section.id)}
              />
            );
          })}
        </View>

        {/* Production sections — Speaking is live (story 9-8); Writing is Epic 10.6 */}
        <Text className="text-lg font-bold text-primary mx-5 mt-7 mb-3" accessibilityRole="header">
          Written and spoken production
        </Text>
        <View className="px-5 gap-3">
          <SkillCard
            emoji=""
            iconNode={<Icon name="edit-3" size={24} color={Colors.skillWriting} />}
            titleFr="Expression Écrite"
            titleEn="Writing"
            description={`${TCF.WRITING_MINUTES} min · Coming soon · Epic 10`}
            accentColor={Colors.skillWriting}
            // Story 14-2 review-round-1 M1: cascade Writing into place AFTER
            // the SECTIONS cards (Listening at 0ms, Reading at 80ms) but
            // BEFORE Speaking (at SECTIONS.length * 80 = 160ms). Pre-R1 had
            // `delay={0}` which made Writing pop in instantly while the
            // Listening/Reading cascade was still animating — visually
            // jarring.
            delay={SECTIONS.length * 80}
            onPress={() => undefined}
            disabled
          />
          <SkillCard
            emoji=""
            iconNode={<Icon name="mic" size={24} color={Colors.skillPronunciation} />}
            titleFr="Expression Orale"
            titleEn="Speaking"
            description={`${SPEAKING_TASK_NUMBERS.length} tasks | ${TCF.SPEAKING_MINUTES} min`}
            accentColor={Colors.skillPronunciation}
            // R1-M1: Speaking cascades AFTER Writing (one step further).
            delay={(SECTIONS.length + 1) * 80}
            onPress={() => router.push("/(tabs)/mock-test/speaking")}
          />
        </View>

        {/* Past results section (Story 14-7) — renders BELOW production when
            at least one completed test exists. Skeleton during COLD load
            only (R1-P7+P8 — `showSkeletons`); hidden entirely when no
            completed tests. */}
        {showSkeletons ? (
          <View className="px-5 gap-3 mt-7">
            <LandingSkeletonRow />
            <LandingSkeletonRow />
          </View>
        ) : pastResults.length > 0 ? (
          <>
            <Text
              className="text-lg font-bold text-primary mx-5 mt-7 mb-3"
              accessibilityRole="header"
            >
              Past results
            </Text>
            <View className="px-5 gap-3">
              {pastResults.map((result, index) => (
                <PastResultRow
                  key={result.id}
                  result={result}
                  index={index}
                  onPress={loadAndNavigate}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
