import { useEffect } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { TCF } from "@/src/lib/constants";
import { Colors, Shadows, skillTint } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestSection = "full" | "listening" | "reading" | "grammar";

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
          shadowColor: "#000",
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
        accessibilityLabel="TCF Complet. Full simulation with 3 mandatory sections, approximately 95 minutes"
        className="bg-primary rounded-3xl p-6 overflow-hidden"
      >
        {/* Subtle inner overlay for depth */}
        <View
          className="absolute w-[120px] h-[120px] rounded-full"
          style={{
            top: 0,
            right: 0,
            backgroundColor: "rgba(245,166,35,0.06)",
            transform: [{ translateX: 40 }, { translateY: -40 }],
          }}
        />

        {/* Badge */}
        <Text className="text-accent text-[10px] font-bold tracking-[1.5px] mb-[10px]">
          SIMULATION COMPLÈTE
        </Text>

        {/* Title */}
        <Text className="text-white text-[22px] font-extrabold mb-2">TCF Complet</Text>

        {/* Description */}
        <Text className="text-[13px] leading-5 mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>
          3 sections obligatoires : {"\xC9"}coute ({TCF.LISTENING_MINUTES} min) + Lecture (
          {TCF.READING_MINUTES} min) + Grammaire
        </Text>

        {/* Bottom row: time pill + section dots */}
        <View className="flex-row items-center justify-between">
          {/* ~95 min amber pill */}
          <View
            className="rounded-2xl px-[14px] py-[6px]"
            style={{
              backgroundColor: "rgba(245,166,35,0.2)",
              borderWidth: 1,
              borderColor: "rgba(245,166,35,0.4)",
            }}
          >
            <Text className="text-accent text-xs font-bold">~95 min</Text>
          </View>

          {/* 3 section dots: blue, green, purple */}
          <View className="flex-row gap-[6px]">
            {[Colors.skillListening, Colors.skillReading, Colors.skillGrammar].map((color, i) => (
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
// Individual section card
// ---------------------------------------------------------------------------

interface SectionCardProps {
  emoji: string;
  nameFr: string;
  nameSub: string;
  questions: number | null;
  minutes: number | null;
  accentColor: string;
  delay: number;
  onPress: () => void;
}

function SectionCard({
  emoji,
  nameFr,
  nameSub,
  questions,
  minutes,
  accentColor,
  delay,
  onPress,
}: SectionCardProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(16);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 380 }));
    translateX.value = withDelay(delay, withTiming(0, { duration: 380 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
  }));

  const metaParts: string[] = [];
  if (questions !== null) metaParts.push(`${questions} questions`);
  if (minutes !== null) metaParts.push(`${minutes} min`);
  const metaText = metaParts.join(" | ");

  return (
    <Animated.View style={entryStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${nameFr} - ${nameSub}${metaText ? `. ${metaText}` : ""}`}
        className="bg-white rounded-2xl flex-row items-center p-4 gap-[14px] overflow-hidden"
        style={{ ...Shadows.card }}
      >
        {/* Left accent strip */}
        <View
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: accentColor }}
        />

        {/* Icon circle */}
        <View
          className="w-[52px] h-[52px] rounded-[26px] justify-center items-center"
          style={{ backgroundColor: skillTint(accentColor, 0.09) }}
        >
          <Text className="text-[24px]">{emoji}</Text>
        </View>

        {/* Labels */}
        <View className="flex-1">
          <Text className="text-base font-bold text-primary">{nameFr}</Text>
          <Text className="text-xs text-[#94A3B8] mt-[3px]">
            {nameSub}
            {metaText ? `  |  ${metaText}` : ""}
          </Text>
        </View>

        {/* Arrow circle */}
        <View
          className="w-8 h-8 rounded-2xl justify-center items-center"
          style={{ backgroundColor: skillTint(accentColor, 0.09) }}
        >
          <Text className="text-base font-bold" style={{ color: accentColor }}>
            {"\u2192"}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const SECTIONS: {
  id: "listening" | "reading" | "grammar";
  nameFr: string;
  nameSub: string;
  questions: number;
  minutes: number | null;
  emoji: string;
  color: string;
}[] = [
  {
    id: "listening",
    nameFr: "Compr\xE9hension Orale",
    nameSub: "Listening",
    questions: 10,
    minutes: TCF.LISTENING_MINUTES,
    emoji: "\uD83C\uDFA7",
    color: Colors.skillListening,
  },
  {
    id: "reading",
    nameFr: "Compr\xE9hension \xC9crite",
    nameSub: "Reading",
    questions: 10,
    minutes: TCF.READING_MINUTES,
    emoji: "\uD83D\uDCD6",
    color: Colors.skillReading,
  },
  {
    id: "grammar",
    nameFr: "Structures de la Langue",
    nameSub: "Grammar & Vocabulary",
    questions: 10,
    minutes: null,
    emoji: "\uD83E\uDDE0",
    color: Colors.skillGrammar,
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
          style={{ color: "rgba(255,255,255,0.65)" }}
        >
          Test de Connaissance du Fran{"\xE7"}ais
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
        <Text className="text-lg font-bold text-primary mx-5 mt-7 mb-3">
          Sections individuelles
        </Text>

        {/* Individual section cards */}
        <View className="px-5 gap-3">
          {SECTIONS.map((section, index) => (
            <SectionCard
              key={section.id}
              emoji={section.emoji}
              nameFr={section.nameFr}
              nameSub={section.nameSub}
              questions={section.questions}
              minutes={section.minutes}
              accentColor={section.color}
              delay={index * 80}
              onPress={() => startTest(section.id)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
