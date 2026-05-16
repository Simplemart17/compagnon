import { View, Text, ScrollView, Pressable, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

import { TCF } from "@/src/lib/constants";
import { Colors, Shadows, skillTint } from "@/src/lib/design";
import { SkillCard } from "@/src/components/common/SkillCard";
import { SPEAKING_TASK_NUMBERS } from "@/src/lib/prompts/speaking";
import { TCF_QCM_SECTIONS, roundToNearestFive } from "@/src/lib/tcf";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestSection = "full" | "listening" | "reading";

const QCM_TOTAL_MINUTES = TCF_QCM_SECTIONS.listening.minutes + TCF_QCM_SECTIONS.reading.minutes;

const QCM_PILL_MINUTES = roundToNearestFive(QCM_TOTAL_MINUTES);

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
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 16,
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
// Main screen
// ---------------------------------------------------------------------------

const SECTIONS: {
  id: "listening" | "reading";
  nameFr: string;
  nameSub: string;
  questions: number;
  minutes: number | null;
  emoji: string;
  color: string;
}[] = [
  {
    id: "listening",
    nameFr: TCF_QCM_SECTIONS.listening.nameFr,
    nameSub: TCF_QCM_SECTIONS.listening.nameEn,
    questions: TCF_QCM_SECTIONS.listening.questions,
    minutes: TCF_QCM_SECTIONS.listening.minutes,
    emoji: "\uD83C\uDFA7",
    color: Colors.skillListening,
  },
  {
    id: "reading",
    nameFr: TCF_QCM_SECTIONS.reading.nameFr,
    nameSub: TCF_QCM_SECTIONS.reading.nameEn,
    questions: TCF_QCM_SECTIONS.reading.questions,
    minutes: TCF_QCM_SECTIONS.reading.minutes,
    emoji: "\uD83D\uDCD6",
    color: Colors.skillReading,
  },
];

export default function MockTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const startTest = (section: TestSection) => {
    router.push({ pathname: "/(tabs)/mock-test/[testId]", params: { testId: section } });
  };

  return (
    <View className="flex-1 bg-surface">
      <StatusBar barStyle="light-content" />
      {/* ------------------------------------------------------------------ */}
      {/* Hero header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <View
        className="bg-primary px-6 pb-8 rounded-b-[28px] items-center"
        style={{
          paddingTop: insets.top + 20,
          ...Shadows.hero,
        }}
      >
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
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
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
                emoji={section.emoji}
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
            emoji="✍️"
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
            emoji="🎤"
            titleFr="Expression Orale"
            titleEn="Speaking"
            description={`${SPEAKING_TASK_NUMBERS.length} tasks | ${TCF.SPEAKING_MINUTES} min`}
            accentColor={Colors.skillPronunciation}
            // R1-M1: Speaking cascades AFTER Writing (one step further).
            delay={(SECTIONS.length + 1) * 80}
            onPress={() => router.push("/(tabs)/mock-test/speaking")}
          />
        </View>
      </ScrollView>
    </View>
  );
}
