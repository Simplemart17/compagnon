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

import { SKILL_LABELS } from "@/src/lib/constants";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type PracticeSkill = "listening" | "reading" | "writing" | "grammar";

const PRACTICE_SKILLS: {
  skill: PracticeSkill;
  emoji: string;
  color: string;
  description: string;
}[] = [
  {
    skill: "listening",
    emoji: "\uD83C\uDFA7",
    color: "#2196F3",
    description: "Listen to passages and answer comprehension questions",
  },
  {
    skill: "reading",
    emoji: "\uD83D\uDCD6",
    color: "#4CAF50",
    description: "Read texts and test your comprehension",
  },
  {
    skill: "writing",
    emoji: "\u270D\uFE0F",
    color: "#FF9800",
    description: "Write essays and get AI-powered feedback",
  },
  {
    skill: "grammar",
    emoji: "\uD83E\uDDE0",
    color: "#9C27B0",
    description: "Master French grammar and vocabulary",
  },
];

// ---------------------------------------------------------------------------
// Animated card
// ---------------------------------------------------------------------------

interface SkillCardProps {
  emoji: string;
  titleFr: string;
  titleEn: string;
  description: string;
  accentColor: string;
  delay: number;
  onPress: () => void;
}

function SkillCard({
  emoji,
  titleFr,
  titleEn,
  description,
  accentColor,
  delay,
  onPress,
}: SkillCardProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 380 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 380 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

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
          overflow: "hidden",
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          gap: 14,
          shadowColor: "#1E3A5F",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 3,
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
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: `${accentColor}18`,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 26 }}>{emoji}</Text>
        </View>

        {/* Labels */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#1E3A5F" }}>{titleFr}</Text>
          <Text style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{titleEn}</Text>
          <Text style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{description}</Text>
        </View>

        {/* Arrow circle */}
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: `${accentColor}18`,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ color: accentColor, fontSize: 14, fontWeight: "700" }}>{"\u2192"}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Vocabulary featured card
// ---------------------------------------------------------------------------

interface VocabularyCardProps {
  onPress: () => void;
}

function VocabularyCard({ onPress }: VocabularyCardProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 380 });
    translateY.value = withTiming(0, { duration: 380 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

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
          backgroundColor: "rgba(245,166,35,0.12)",
          borderRadius: 20,
          borderWidth: 1,
          borderColor: "#F5A623",
          flexDirection: "row",
          alignItems: "center",
          padding: 18,
          gap: 16,
          overflow: "hidden",
        }}
      >
        {/* VEDETTE badge */}
        <View
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            backgroundColor: "#F5A623",
            borderRadius: 6,
            paddingHorizontal: 7,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 9, fontWeight: "700", letterSpacing: 1 }}>
            VEDETTE
          </Text>
        </View>

        {/* Icon circle */}
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: "rgba(245,166,35,0.2)",
            justifyContent: "center",
            alignItems: "center",
            borderWidth: 1.5,
            borderColor: "rgba(245,166,35,0.4)",
          }}
        >
          <Text style={{ fontSize: 24 }}>{"\uD83D\uDCDA"}</Text>
        </View>

        {/* Labels */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#1E3A5F" }}>Vocabulaire</Text>
          <Text style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Vocabulary</Text>
          <Text style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
            Review with spaced repetition
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function PracticeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      {/* ------------------------------------------------------------------ */}
      {/* Hero header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          paddingTop: insets.top + 16,
          paddingBottom: 28,
          paddingHorizontal: 24,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.12,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Text
          style={{
            fontSize: 26,
            fontWeight: "800",
            color: "#FFFFFF",
            marginBottom: 6,
          }}
        >
          Entra{"\xEE"}nement
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.65)",
            marginBottom: 20,
          }}
        >
          Choisissez une comp{"\xE9"}tence {"\xE0"} pratiquer.
        </Text>

        {/* Decorative colored dots */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["#2196F3", "#4CAF50", "#FF9800", "#9C27B0"].map((color, i) => (
            <View
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color,
              }}
            />
          ))}
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Vocabulary featured card */}
        <VocabularyCard onPress={() => router.push({ pathname: "/(tabs)/practice/vocabulary" })} />

        {/* Skill cards */}
        {PRACTICE_SKILLS.map(({ skill, emoji, color, description }, index) => (
          <SkillCard
            key={skill}
            emoji={emoji}
            titleFr={SKILL_LABELS[skill].fr}
            titleEn={SKILL_LABELS[skill].en}
            description={description}
            accentColor={color}
            delay={(index + 1) * 70}
            onPress={() => router.push({ pathname: `/(tabs)/practice/${skill}` })}
          />
        ))}
      </ScrollView>
    </View>
  );
}
