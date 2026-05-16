import { View, Text, ScrollView, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SKILL_LABELS } from "@/src/lib/constants";
import { Colors, Shadows } from "@/src/lib/design";
import { SkillCard } from "@/src/components/common/SkillCard";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type PracticeSkill =
  | "listening"
  | "reading"
  | "writing"
  | "grammar"
  | "pronunciation"
  | "dictation"
  | "echo"
  | "translation";

/** Extend SKILL_LABELS with pronunciation and dictation (not TCFSkills, so not in constants) */
const PRACTICE_LABELS: Record<PracticeSkill, { en: string; fr: string }> = {
  ...SKILL_LABELS,
  pronunciation: { en: "Pronunciation", fr: "Prononciation" },
  dictation: { en: "Dictation", fr: "Dict\u00e9e" },
  echo: { en: "Echo Practice", fr: "Pratique d'\u00e9cho" },
  translation: { en: "Translation", fr: "Traduction" },
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
  {
    skill: "echo",
    emoji: "\uD83C\uDF99\uFE0F",
    color: Colors.skillListening,
    description: "Listen, repeat aloud, then type what you heard",
  },
  {
    skill: "translation",
    emoji: "\uD83C\uDF10",
    color: Colors.skillTranslation,
    description: "Hear a sentence, speak the French translation",
  },
];

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
        <Text className="text-[26px] font-extrabold text-white mb-[6px]">Practice</Text>
        <Text className="text-sm mb-5" style={{ color: Colors.textOnDarkSecondary }}>
          Choose a skill to practice.
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
            Colors.skillTranslation,
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
        {/* Vocabulary featured card (Story 14-2: consolidated to SkillCard featured variant) */}
        <SkillCard
          emoji={"📚"}
          titleFr="Vocabulaire"
          titleEn="Vocabulary"
          description="Review with spaced repetition"
          accentColor={Colors.accent}
          delay={0}
          onPress={() => router.push({ pathname: "/(tabs)/practice/vocabulary" })}
          featured
        />

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
