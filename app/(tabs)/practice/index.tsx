import { useEffect } from "react";
import { View, Text, ScrollView, Pressable, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { SKILL_LABELS } from "@/src/lib/constants";
import { Colors, Shadows, skillTint } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type PracticeSkill =
  | "listening"
  | "reading"
  | "writing"
  | "grammar"
  | "pronunciation"
  | "dictation";

/** Extend SKILL_LABELS with pronunciation and dictation (not TCFSkills, so not in constants) */
const PRACTICE_LABELS: Record<PracticeSkill, { en: string; fr: string }> = {
  ...SKILL_LABELS,
  pronunciation: { en: "Pronunciation", fr: "Prononciation" },
  dictation: { en: "Dictation", fr: "Dict\u00e9e" },
};

const PRACTICE_SKILLS: {
  skill: PracticeSkill;
  emoji: string;
  color: string;
  description: string;
}[] = [
  {
    skill: "listening",
    emoji: "\uD83C\uDFA7",
    color: Colors.skillListening,
    description: "Listen to passages and answer comprehension questions",
  },
  {
    skill: "reading",
    emoji: "\uD83D\uDCD6",
    color: Colors.skillReading,
    description: "Read texts and test your comprehension",
  },
  {
    skill: "writing",
    emoji: "\u270D\uFE0F",
    color: Colors.skillWriting,
    description: "Write essays and get AI-powered feedback",
  },
  {
    skill: "grammar",
    emoji: "\uD83E\uDDE0",
    color: Colors.skillGrammar,
    description: "Master French grammar and vocabulary",
  },
  {
    skill: "pronunciation",
    emoji: "\uD83C\uDF99",
    color: Colors.skillPronunciation,
    description: "Read aloud and get phoneme-level pronunciation feedback",
  },
  {
    skill: "dictation",
    emoji: "\uD83D\uDCDD",
    color: Colors.skillDictation,
    description: "Listen to French sentences and type what you hear",
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
        accessibilityRole="button"
        accessibilityLabel={`${titleFr} - ${titleEn}. ${description}`}
        className="bg-white rounded-2xl overflow-hidden flex-row items-center p-4 gap-[14px]"
        style={{
          ...Shadows.card,
        }}
      >
        {/* Left accent strip */}
        <View
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: accentColor }}
        />

        {/* Icon circle */}
        <View
          className="w-14 h-14 rounded-[28px] justify-center items-center"
          style={{ backgroundColor: skillTint(accentColor, 0.09) }}
        >
          <Text className="text-[26px]">{emoji}</Text>
        </View>

        {/* Labels */}
        <View className="flex-1">
          <Text className="text-base font-bold text-primary">{titleFr}</Text>
          <Text className="text-xs text-[#6B7C93] mt-[2px]">{titleEn}</Text>
          <Text className="text-xs text-[#94A3B8] mt-1">{description}</Text>
        </View>

        {/* Arrow circle */}
        <View
          className="w-7 h-7 rounded-[14px] justify-center items-center"
          style={{ backgroundColor: skillTint(accentColor, 0.09) }}
        >
          <Text className="text-sm font-bold" style={{ color: accentColor }}>
            {"\u2192"}
          </Text>
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
        accessibilityRole="button"
        accessibilityLabel="Vocabulaire - Vocabulary. Review with spaced repetition"
        className="rounded-2xl flex-row items-center p-[18px] gap-4 overflow-hidden"
        style={{
          backgroundColor: Colors.accent10,
          borderWidth: 1,
          borderColor: Colors.accent,
        }}
      >
        {/* VEDETTE badge */}
        <View className="absolute top-2 right-2 bg-accent rounded-md px-[7px] py-[3px]">
          <Text className="text-white text-[9px] font-bold tracking-[1px]">VEDETTE</Text>
        </View>

        {/* Icon circle */}
        <View
          className="w-[52px] h-[52px] rounded-[26px] justify-center items-center"
          style={{
            backgroundColor: Colors.accent20,
            borderWidth: 1.5,
            borderColor: Colors.accent30,
          }}
        >
          <Text className="text-[24px]">{"\uD83D\uDCDA"}</Text>
        </View>

        {/* Labels */}
        <View className="flex-1">
          <Text className="text-base font-bold text-primary">Vocabulaire</Text>
          <Text className="text-[13px] text-[#6B7C93] mt-[2px]">Vocabulary</Text>
          <Text className="text-xs text-[#94A3B8] mt-1">Review with spaced repetition</Text>
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
    <View className="flex-1 bg-surface">
      <StatusBar barStyle="light-content" />
      {/* ------------------------------------------------------------------ */}
      {/* Hero header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <View
        className="bg-primary pb-7 px-6 rounded-b-[28px]"
        style={{
          paddingTop: insets.top + 16,
          ...Shadows.hero,
        }}
      >
        <Text className="text-[26px] font-extrabold text-white mb-[6px]">Entraînement</Text>
        <Text className="text-sm mb-5" style={{ color: "rgba(255,255,255,0.65)" }}>
          Choisissez une compétence à pratiquer.
        </Text>

        {/* Decorative colored dots */}
        <View className="flex-row gap-2">
          {[
            Colors.skillListening,
            Colors.skillReading,
            Colors.skillWriting,
            Colors.skillGrammar,
            Colors.skillPronunciation,
            Colors.skillDictation,
          ].map((color, i) => (
            <View key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          ))}
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        className="flex-1"
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
            titleFr={PRACTICE_LABELS[skill].fr}
            titleEn={PRACTICE_LABELS[skill].en}
            description={description}
            accentColor={color}
            delay={(index + 1) * 70}
            onPress={() => router.push(`/(tabs)/practice/${skill}` as `/(tabs)/practice/grammar`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
