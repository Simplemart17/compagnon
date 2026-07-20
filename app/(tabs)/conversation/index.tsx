import { useState, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { useAuthStore } from "@/src/store/auth-store";
import { CONVERSATION_TOPICS, LEVEL_COLORS } from "@/src/lib/constants";
import type { ConversationTopic, ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { CEFR_ORDER } from "@/src/types/cefr";
import { Colors, skillTint } from "@/src/lib/design";
import {
  entryLessonIdForLevel,
  getCompletedLessonIds,
  nextLessonForUser,
} from "@/src/lib/lesson-progress";
import { Icon, type IconName } from "@/src/components/common/Icon";
import { ListItemCard } from "@/src/components/common/ListItemCard";
import { HeroHeader } from "@/src/components/common/HeroHeader";

/**
 * Story 14-3: `icon` is either a typed IconName (rendered via `<Icon />`) or
 * an emoji string (rendered as `<Text>`). The companion mode's pre-14-3
 * `\uD83D\uDCAC` chat emoji is replaced with a typed `message-circle` icon
 * per the icon-system unification. Debate `\u2694\uFE0F` + TCF Sim
 * `\uD83C\uDFAF` stay as emoji since Feather lacks a crossed-swords glyph
 * (debate semantic) and `target` would be visually noisy in the small mode
 * pill (TCF Sim is a content-ish reference anyway).
 */
type ModeIcon = { kind: "icon"; name: IconName } | { kind: "emoji"; value: string };

const CONVERSATION_MODES: { key: ConversationMode; label: string; icon: ModeIcon }[] = [
  { key: "companion", label: "Companion", icon: { kind: "icon", name: "message-circle" } },
  { key: "debate", label: "Debate", icon: { kind: "emoji", value: "\u2694\uFE0F" } },
  { key: "tcf_simulation", label: "TCF Sim", icon: { kind: "emoji", value: "\uD83C\uDFAF" } },
];

const TOPIC_EMOJIS: Record<string, string> = {
  "Se pr\u00e9senter": "\uD83D\uDC4B",
  "Commander au caf\u00e9": "\u2615",
  "Demander son chemin": "\uD83D\uDDFA\uFE0F",
  "D\u00e9crire sa famille": "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67",
  "Chez le m\u00e9decin": "\uD83C\uDFE5",
  "Plans du week-end": "\uD83D\uDCC5",
  "Au travail": "\uD83D\uDCBC",
  "Parler de ses voyages": "\u2708\uFE0F",
  "D\u00e9battre d\u2019actualit\u00e9s": "\uD83D\uDCF0",
  "Cin\u00e9ma et culture": "\uD83C\uDFAC",
  "Gastronomie fran\u00e7aise": "\uD83C\uDF77",
  "Philosophie et soci\u00e9t\u00e9": "\uD83E\uDDE0",
};

type LevelFilter = "All" | CEFRLevel;

function getDifficultyDots(level: string): number {
  const idx = CEFR_ORDER.indexOf(level as CEFRLevel);
  if (idx < 0) return 1;
  // A1=1, A2=2, B1=3, B2=4, C1=5, C2=6 -- clamp to 3 dots max
  return Math.min(Math.ceil((idx + 1) / 2), 3);
}

interface CardItemProps {
  item: ConversationTopic;
  index: number;
  onPress: (topic: ConversationTopic) => void;
}

/**
 * Story 14-2: pre-14-2 inline `CardItem` consolidated to `<ListItemCard>` from
 * `@/src/components/common`. Chrome rule (Story 14-1) preserved: titlePrimary
 * is EN (`item.title`); titleSecondary is the French topic name (`item.titleFr`)
 * \u2014 which is content, not chrome, since the topic name is what the learner is
 * learning to discuss. The CEFR badge + difficulty dots become the rightContent
 * slot.
 */
function CardItem({ item, index, onPress }: CardItemProps) {
  const stripColor = LEVEL_COLORS[item.cefr_level] ?? Colors.primary;
  const emoji = TOPIC_EMOJIS[item.titleFr] ?? "\uD83D\uDCAC";
  const difficultyDots = getDifficultyDots(item.cefr_level);

  return (
    <View className="mx-5 mb-3">
      <ListItemCard
        leftStripColor={stripColor}
        iconEmoji={emoji}
        iconColor={stripColor}
        titlePrimary={item.title}
        titleSecondary={item.titleFr}
        description={item.description}
        rightContent={
          <View className="items-end gap-2">
            <View
              className="rounded-lg px-2 py-[3px]"
              style={{ backgroundColor: stripColor + "22" }}
            >
              <Text className="text-[11px] font-bold" style={{ color: stripColor }}>
                {item.cefr_level}
              </Text>
            </View>
            <View className="flex-row gap-1">
              {[1, 2, 3].map((dot) => (
                <View
                  key={dot}
                  className="w-[7px] h-[7px] rounded-full"
                  style={{
                    backgroundColor: dot <= difficultyDots ? stripColor : Colors.gray300,
                  }}
                />
              ))}
            </View>
          </View>
        }
        delay={index * 60}
        accessibilityLabel={`Topic: ${item.title}, ${item.titleFr}. ${item.description}`}
        accessibilityHint="Double tap to start a conversation on this topic"
        onPress={() => onPress(item)}
      />
    </View>
  );
}

export default function ConversationTopicsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const userLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const streak = profile?.streak_days ?? 0;

  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>("All");
  const [selectedMode, setSelectedMode] = useState<ConversationMode>("companion");
  // Story 19-3: null = completion not yet loaded — the "Continue my lesson"
  // default holds until the first fetch settles (19-2 R1-P7 no-flash rule).
  const [completedIds, setCompletedIds] = useState<Set<string> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (user?.id) {
        void getCompletedLessonIds(user.id).then((ids) => {
          if (active) setCompletedIds(ids);
        });
      }
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  // Story 19-3: the picker's DEFAULT is the guided path — the learner's next
  // curriculum lesson (uncoerced profile level per 18-2 R1-P3; undefined
  // during hydration scans from the spine start).
  const continueLesson =
    completedIds !== null
      ? nextLessonForUser(completedIds, entryLessonIdForLevel(profile?.current_cefr_level))
      : undefined;

  // Show topics at or below user's level, plus one level above for challenge
  const userLevelIdx = CEFR_ORDER.indexOf(userLevel);
  const maxLevelIdx = Math.min(userLevelIdx + 1, CEFR_ORDER.length - 1);
  const availableLevels = CEFR_ORDER.slice(0, maxLevelIdx + 1);

  const baseFilteredTopics = CONVERSATION_TOPICS.filter(
    (t) => t.category === "free" || availableLevels.includes(t.cefr_level)
  );

  const filteredTopics =
    selectedLevel === "All"
      ? baseFilteredTopics
      : baseFilteredTopics.filter((t) => t.cefr_level === selectedLevel);

  const handleTopicPress = useCallback(
    (topic: ConversationTopic) => {
      router.push(`/(tabs)/conversation/${encodeURIComponent(topic.titleFr)}?mode=${selectedMode}`);
    },
    [router, selectedMode]
  );

  const renderTopic = useCallback(
    ({ item, index }: { item: ConversationTopic; index: number }) => (
      <CardItem item={item} index={index} onPress={handleTopicPress} />
    ),
    [handleTopicPress]
  );

  const initials = profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : "?";

  return (
    <View className="flex-1 bg-surface">
      <StatusBar barStyle="light-content" />
      {/* Story 14-9: hero section via canonical HeroHeader; the bespoke
          depth-overlay inner View is now produced by `overlay="depth-glow"`. */}
      <HeroHeader overlay="depth-glow">
        {/* Row 1: CEFR badge + initials */}
        <View className="flex-row justify-between items-center">
          <View
            className="rounded-full px-[10px] py-1"
            style={{
              backgroundColor: Colors.accent20,
              borderColor: Colors.accent,
              borderWidth: 1,
            }}
          >
            <Text className="text-xs font-bold text-accent">{userLevel}</Text>
          </View>

          <View className="flex-row gap-2 items-center">
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/conversation/history")}
              accessibilityRole="button"
              accessibilityLabel="Conversation history"
              accessibilityHint="Double tap to view past conversations"
              className="rounded-full px-3 justify-center"
              style={{
                minHeight: 44,
                backgroundColor: skillTint(Colors.surfaceWhite, 0.1),
                borderColor: skillTint(Colors.surfaceWhite, 0.2),
                borderWidth: 1,
              }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: skillTint(Colors.surfaceWhite, 0.8) }}
              >
                History
              </Text>
            </TouchableOpacity>
            <View
              className="w-9 h-9 rounded-full justify-center items-center"
              style={{
                backgroundColor: skillTint(Colors.surfaceWhite, 0.15),
                borderColor: skillTint(Colors.surfaceWhite, 0.25),
                borderWidth: 1,
              }}
            >
              <Text className="text-base font-bold text-white">{initials}</Text>
            </View>
          </View>
        </View>

        {/* Row 2: Heading */}
        <Text className="text-[26px] font-extrabold text-white tracking-[-0.3px] mt-3">
          Talk with Companion
        </Text>

        {/* Row 3: Subheading */}
        <Text className="text-sm mt-[6px]" style={{ color: skillTint(Colors.surfaceWhite, 0.6) }}>
          Choose a topic and start speaking.
        </Text>

        {/* Row 4: Stat chips */}
        <View className="flex-row gap-2 mt-6 flex-wrap">
          {[
            `\uD83D\uDD25 ${streak} day streak`,
            "\uD83D\uDCAC Practice",
            `\u2B50 ${userLevel}`,
          ].map((label) => (
            <View
              key={label}
              className="rounded-lg px-[10px] py-[6px]"
              style={{ backgroundColor: skillTint(Colors.surfaceWhite, 0.1) }}
            >
              <Text
                className="text-[11px] font-semibold"
                style={{ color: skillTint(Colors.surfaceWhite, 0.85) }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      </HeroHeader>

      {/* Mode selector */}
      <View className="flex-row justify-center px-5 pt-3 pb-1 gap-2">
        {CONVERSATION_MODES.map((m) => {
          const isActive = selectedMode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => setSelectedMode(m.key)}
              accessibilityRole="button"
              accessibilityLabel={`Conversation mode: ${m.label}`}
              accessibilityHint="Double tap to select this conversation mode"
              accessibilityState={{ selected: isActive }}
              className="flex-1 rounded-xl py-2.5 items-center"
              style={{
                minHeight: 44,
                justifyContent: "center",
                backgroundColor: isActive ? Colors.primary : Colors.surfaceWhite,
                borderColor: isActive ? Colors.primary : Colors.gray300,
                borderWidth: 1,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {m.icon.kind === "icon" ? (
                  <Icon
                    name={m.icon.name}
                    size={14}
                    color={isActive ? Colors.surfaceWhite : Colors.textSecondary}
                  />
                ) : (
                  <Text
                    className="text-[13px]"
                    style={{ color: isActive ? Colors.surfaceWhite : Colors.textSecondary }}
                  >
                    {m.icon.value}
                  </Text>
                )}
                <Text
                  className="text-[13px]"
                  style={{ color: isActive ? Colors.surfaceWhite : Colors.textSecondary }}
                >
                  {m.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Level filter bar -- only show levels that have topics */}
      <View className="flex-row justify-center px-5 py-3 gap-[10px]">
        {(["All", ...availableLevels] as const).map((level) => {
          const isActive = selectedLevel === level;
          return (
            <TouchableOpacity
              key={level}
              onPress={() => setSelectedLevel(level as LevelFilter)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by level: ${level}`}
              accessibilityHint="Double tap to filter topics by this level"
              accessibilityState={{ selected: isActive }}
              className="flex-1 max-w-[80px] rounded-full py-2 items-center"
              style={{
                minHeight: 44,
                justifyContent: "center",
                backgroundColor: isActive ? Colors.primary : Colors.surfaceWhite,
                borderColor: isActive ? Colors.primary : Colors.gray300,
                borderWidth: 1,
              }}
            >
              <Text
                className="text-[13px]"
                style={{
                  fontWeight: isActive ? "700" : "600",
                  color: isActive ? Colors.textOnDark : Colors.textSecondary,
                }}
              >
                {level}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Topic list */}
      <FlatList
        data={filteredTopics}
        keyExtractor={(item) => item.id}
        renderItem={renderTopic}
        ListHeaderComponent={
          continueLesson ? (
            <View className="mx-5 mb-3">
              {/* Story 19-3: "continue my lesson" default — routes to the
                  lesson PLAYER (not straight into a conversation) so the
                  teach → drill → apply loop stays intact. */}
              <ListItemCard
                leftStripColor={Colors.accent}
                iconNode={<Icon name="book-open" size={22} color={Colors.accent} />}
                iconColor={Colors.accent}
                titlePrimary="Continue my lesson"
                titleSecondary={continueLesson.canDoFr}
                description={continueLesson.canDoEn}
                rightContent={
                  <Text className="text-lg font-bold" style={{ color: Colors.accent }}>
                    {"\u2192"}
                  </Text>
                }
                accessibilityLabel={`Continue my lesson: ${continueLesson.canDoEn}`}
                accessibilityHint="Double tap to open your next lesson"
                onPress={() =>
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed-routes lag for the dynamic lesson route
                  router.push(`/(tabs)/practice/lesson/${continueLesson.id}` as any)
                }
              />
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
