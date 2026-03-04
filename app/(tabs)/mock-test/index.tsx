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
      style={[
        {
          marginHorizontal: 20,
          marginTop: 15,
          borderRadius: 24,
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
        style={{
          backgroundColor: "#1E3A5F",
          borderRadius: 24,
          padding: 24,
          overflow: "hidden",
        }}
      >
        {/* Subtle inner overlay for depth */}
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: "rgba(245,166,35,0.06)",
            transform: [{ translateX: 40 }, { translateY: -40 }],
          }}
        />

        {/* Badge */}
        <Text
          style={{
            color: "#F5A623",
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 1.5,
            marginBottom: 10,
          }}
        >
          SIMULATION COMPL{"\u00C8"}TE
        </Text>

        {/* Title */}
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 22,
            fontWeight: "800",
            marginBottom: 8,
          }}
        >
          TCF Complet
        </Text>

        {/* Description */}
        <Text
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 13,
            lineHeight: 20,
            marginBottom: 16,
          }}
        >
          3 sections obligatoires : {"\xC9"}coute ({TCF.LISTENING_MINUTES} min) + Lecture (
          {TCF.READING_MINUTES} min) + Grammaire
        </Text>

        {/* Bottom row: time pill + section dots */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* ~95 min amber pill */}
          <View
            style={{
              backgroundColor: "rgba(245,166,35,0.2)",
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderWidth: 1,
              borderColor: "rgba(245,166,35,0.4)",
            }}
          >
            <Text style={{ color: "#F5A623", fontSize: 12, fontWeight: "700" }}>~95 min</Text>
          </View>

          {/* 3 section dots: blue, green, purple */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {["#2196F3", "#4CAF50", "#9C27B0"].map((color, i) => (
              <View
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: color,
                }}
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
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 20,
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          gap: 14,
          shadowColor: "#1E3A5F",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 3,
          overflow: "hidden",
        }}
      >
        {/* Left accent strip */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: accentColor,
          }}
        />

        {/* Icon circle */}
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: `${accentColor}18`,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 24 }}>{emoji}</Text>
        </View>

        {/* Labels */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: "#1E3A5F" }}>{nameFr}</Text>
          <Text style={{ fontSize: 12, color: "#999", marginTop: 3 }}>
            {nameSub}
            {metaText ? `  |  ${metaText}` : ""}
          </Text>
        </View>

        {/* Arrow circle */}
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: `${accentColor}18`,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ color: accentColor, fontSize: 16, fontWeight: "700" }}>{"\u2192"}</Text>
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
    color: "#2196F3",
  },
  {
    id: "reading",
    nameFr: "Compr\xE9hension \xC9crite",
    nameSub: "Reading",
    questions: 10,
    minutes: TCF.READING_MINUTES,
    emoji: "\uD83D\uDCD6",
    color: "#4CAF50",
  },
  {
    id: "grammar",
    nameFr: "Structures de la Langue",
    nameSub: "Grammar & Vocabulary",
    questions: 10,
    minutes: null,
    emoji: "\uD83E\uDDE0",
    color: "#9C27B0",
  },
];

export default function MockTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const startTest = (section: TestSection) => {
    router.push({ pathname: "/(tabs)/mock-test/[testId]", params: { testId: section } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      {/* ------------------------------------------------------------------ */}
      {/* Hero header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          paddingTop: insets.top + 20,
          paddingBottom: 32,
          paddingHorizontal: 24,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
          alignItems: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        {/* Thin amber horizontal line above TCF */}
        <View
          style={{
            width: 60,
            height: 2,
            backgroundColor: "#F5A623",
            borderRadius: 1,
            marginBottom: 10,
          }}
        />

        {/* TCF large title */}
        <Text
          style={{
            fontSize: 48,
            fontWeight: "800",
            color: "#F5A623",
            letterSpacing: 4,
            lineHeight: 56,
          }}
        >
          TCF
        </Text>

        {/* Subtitle */}
        <Text
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.65)",
            letterSpacing: 0.5,
            textAlign: "center",
            marginTop: 4,
          }}
        >
          Test de Connaissance du Fran{"\xE7"}ais
        </Text>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Full simulation card overlapping the hero */}
        <FullSimCard onPress={() => startTest("full")} />

        {/* Section label */}
        <Text
          style={{
            fontSize: 15,
            fontWeight: "700",
            color: "#1E3A5F",
            marginHorizontal: 20,
            marginTop: 28,
            marginBottom: 12,
          }}
        >
          Sections individuelles
        </Text>

        {/* Individual section cards */}
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
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
