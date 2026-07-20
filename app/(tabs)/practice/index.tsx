import { View, Text, ScrollView, StatusBar } from "react-native";
import { useRouter } from "expo-router";

import { SKILL_LABELS } from "@/src/lib/constants";
import { Colors } from "@/src/lib/design";
import { SkillCard } from "@/src/components/common/SkillCard";
import { Icon, type IconName } from "@/src/components/common/Icon";
import { HeroHeader } from "@/src/components/common/HeroHeader";

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

/**
 * Story 14-3: emoji strings replaced with typed `IconName` values. Renders
 * through SkillCard's new `iconNode` slot. The `emoji` prop on SkillCard
 * stays required by the component API (the 12 conversation topic cards still
 * pass content emoji); we pass an empty string here because `iconNode`
 * overrides the rendered child. Grammar \uD83E\uDDE0 \u2192 `activity` per Q5 (Feather
 * lacks Brain).
 */
const PRACTICE_SKILLS: {
  skill: PracticeSkill;
  iconName: IconName;
  color: string;
  description: string;
}[] = [
  {
    skill: "listening",
    iconName: "headphones",
    color: Colors.skillListening,
    description: "Listen to passages and answer comprehension questions",
  },
  {
    skill: "reading",
    iconName: "book-open",
    color: Colors.skillReading,
    description: "Read texts and test your comprehension",
  },
  {
    skill: "writing",
    iconName: "edit-3",
    color: Colors.skillWriting,
    description: "Write essays and get AI-powered feedback",
  },
  {
    skill: "grammar",
    iconName: "activity",
    color: Colors.skillGrammar,
    description: "Master French grammar and vocabulary",
  },
  {
    skill: "pronunciation",
    iconName: "mic",
    color: Colors.skillPronunciation,
    description: "Read aloud and get phoneme-level pronunciation feedback",
  },
  {
    skill: "dictation",
    iconName: "file-text",
    color: Colors.skillDictation,
    description: "Listen to French sentences and type what you hear",
  },
  {
    skill: "echo",
    iconName: "repeat",
    color: Colors.skillListening,
    description: "Listen, repeat aloud, then type what you heard",
  },
  {
    skill: "translation",
    iconName: "globe",
    color: Colors.skillTranslation,
    description: "Hear a sentence, speak the French translation",
  },
];

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function PracticeScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-surface">
      <StatusBar barStyle="light-content" />
      {/* ------------------------------------------------------------------ */}
      {/* Hero header — Story 14-9: canonical HeroHeader (paddingBottom=28).   */}
      {/* ------------------------------------------------------------------ */}
      <HeroHeader paddingBottom={28}>
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
      </HeroHeader>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Curriculum featured card (Story 19-2): the guided path — every
            lesson ends in a conversation practicing what it just taught. */}
        <SkillCard
          emoji=""
          iconNode={<Icon name="book-open" size={24} color={Colors.accent} />}
          titleFr="Le parcours guidé"
          titleEn="Lessons"
          description="Learn, then practice it in conversation"
          accentColor={Colors.accent}
          delay={0}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed-routes lag for the new screen (regenerates on expo start; results.tsx precedent)
          onPress={() => router.push({ pathname: "/(tabs)/practice/lessons" as any })}
          featured
        />

        {/* Vocabulary featured card (Story 14-2: consolidated to SkillCard featured variant) */}
        <SkillCard
          emoji=""
          iconNode={<Icon name="book" size={24} color={Colors.accent} />}
          titleFr="Vocabulaire"
          titleEn="Vocabulary"
          description="Review with spaced repetition"
          accentColor={Colors.accent}
          delay={70}
          onPress={() => router.push({ pathname: "/(tabs)/practice/vocabulary" })}
          featured
        />

        {/* Skill cards (Story 14-3: emoji → Icon via iconNode slot) */}
        {PRACTICE_SKILLS.map(({ skill, iconName, color, description }, index) => (
          <SkillCard
            key={skill}
            emoji=""
            iconNode={<Icon name={iconName} size={24} color={color} />}
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
