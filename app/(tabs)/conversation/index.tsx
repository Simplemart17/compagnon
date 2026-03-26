import { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { useAuthStore } from "@/src/store/auth-store";
import { CONVERSATION_TOPICS, LEVEL_COLORS } from "@/src/lib/constants";
import type { ConversationTopic, ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { CEFR_ORDER } from "@/src/types/cefr";
import { Colors, skillTint } from "@/src/lib/design";

const CONVERSATION_MODES: { key: ConversationMode; label: string; icon: string }[] = [
  { key: "companion", label: "Companion", icon: "\uD83D\uDCAC" },
  { key: "debate", label: "Debate", icon: "\u2694\uFE0F" },
  { key: "tcf_simulation", label: "TCF Sim", icon: "\uD83C\uDFAF" },
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

function CardItem({ item, index, onPress }: CardItemProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(18);
  const scale = useSharedValue(1);

  useEffect(() => {
    const delay = index * 60;
    const timer = setTimeout(() => {
      opacity.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
      translateY.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const stripColor = LEVEL_COLORS[item.cefr_level] ?? Colors.primary;
  const emoji = TOPIC_EMOJIS[item.titleFr] ?? "\uD83D\uDCAC";
  const difficultyDots = getDifficultyDots(item.cefr_level);

  return (
    <Reanimated.View style={animStyle}>
      <TouchableOpacity
        onPress={() => onPress(item)}
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1.0, { duration: 150 });
        }}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`Topic: ${item.titleFr} - ${item.title}. ${item.description}`}
        accessibilityHint="Double tap to start a conversation on this topic"
        className="bg-white rounded-2xl mb-3 mx-5 p-4 pl-[22px]"
        style={{
          shadowColor: Colors.primary,
          shadowOpacity: 0.08,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }}
      >
        {/* Left accent strip */}
        <View
          className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
          style={{ backgroundColor: stripColor }}
        />

        {/* Content row */}
        <View className="flex-row items-center">
          {/* Icon circle */}
          <View
            className="w-11 h-11 rounded-full justify-center items-center mr-3"
            style={{ backgroundColor: stripColor + "20" }}
          >
            <Text className="text-[22px]">{emoji}</Text>
          </View>

          {/* Titles */}
          <View className="flex-1">
            <Text className="text-base font-bold text-primary" numberOfLines={1}>
              {item.titleFr}
            </Text>
            <Text
              className="text-[13px] mt-[1px]"
              style={{ color: Colors.textSecondary }}
              numberOfLines={1}
            >
              {item.title}
            </Text>
          </View>
        </View>

        {/* Description */}
        <Text
          className="text-[13px] leading-[19px] mt-2"
          style={{ color: Colors.textTertiary }}
          numberOfLines={2}
        >
          {item.description}
        </Text>

        {/* Footer row */}
        <View className="flex-row justify-between items-center mt-[10px]">
          {/* CEFR badge */}
          <View className="rounded-lg px-2 py-[3px]" style={{ backgroundColor: stripColor + "22" }}>
            <Text className="text-[11px] font-bold" style={{ color: stripColor }}>
              {item.cefr_level}
            </Text>
          </View>

          {/* Difficulty dots */}
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
      </TouchableOpacity>
    </Reanimated.View>
  );
}

export default function ConversationTopicsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAuthStore((s) => s.profile);
  const userLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const streak = profile?.streak_days ?? 0;

  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>("All");
  const [selectedMode, setSelectedMode] = useState<ConversationMode>("companion");

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
      {/* Hero section */}
      <View
        className="bg-primary rounded-b-[28px] pb-6 px-6"
        style={{ paddingTop: insets.top + 16 }}
      >
        {/* Depth overlay */}
        <View
          className="absolute bottom-0 left-0 right-0 rounded-b-[32px]"
          style={{
            height: "50%",
            backgroundColor: skillTint(Colors.primaryDark, 0.4),
          }}
          pointerEvents="none"
        />

        {/* Row 1: CEFR badge + initials */}
        <View className="flex-row justify-between items-center">
          <View
            className="rounded-[20px] px-[10px] py-1"
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
              className="rounded-[20px] px-3 justify-center"
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
              className="w-9 h-9 rounded-[18px] justify-center items-center"
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
          Parlez avec Compagnon
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
              className="rounded-[10px] px-[10px] py-[6px]"
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
      </View>

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
              <Text
                className="text-[13px]"
                style={{ color: isActive ? Colors.surfaceWhite : Colors.textSecondary }}
              >
                {m.icon} {m.label}
              </Text>
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
              className="flex-1 max-w-[80px] rounded-[20px] py-2 items-center"
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
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
