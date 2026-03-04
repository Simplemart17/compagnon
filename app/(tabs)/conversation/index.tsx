import { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { useAuthStore } from "@/src/store/auth-store";
import { CONVERSATION_TOPICS } from "@/src/lib/constants";
import type { ConversationTopic } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { CEFR_ORDER } from "@/src/types/cefr";

const CEFR_STRIP_COLORS: Record<string, string> = {
  A1: "#A8D5A2",
  A2: "#7BC4A0",
  B1: "#5BA4CF",
  B2: "#1E3A5F",
  C1: "#9B59B6",
  C2: "#6C3483",
};

const TOPIC_EMOJIS: Record<string, string> = {
  "Se présenter": "👋",
  "Commander au café": "☕",
  "Demander son chemin": "🗺️",
  "Décrire sa famille": "👨‍👩‍👧",
  "Chez le médecin": "🏥",
  "Plans du week-end": "📅",
  "Au travail": "💼",
  "Parler de ses voyages": "✈️",
  "Débattre d'actualités": "📰",
  "Cinéma et culture": "🎬",
  "Gastronomie française": "🍷",
  "Philosophie et société": "🧠",
};

type LevelFilter = "All" | CEFRLevel;

function getDifficultyDots(level: string): number {
  const idx = CEFR_ORDER.indexOf(level as CEFRLevel);
  if (idx < 0) return 1;
  // A1=1, A2=2, B1=3, B2=4, C1=5, C2=6 — clamp to 3 dots max
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

  const stripColor = CEFR_STRIP_COLORS[item.cefr_level] ?? "#1E3A5F";
  const emoji = TOPIC_EMOJIS[item.titleFr] ?? "💬";
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
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 18,
          marginBottom: 12,
          marginHorizontal: 20,
          padding: 16,
          paddingLeft: 22,
          shadowColor: "#1E3A5F",
          shadowOpacity: 0.08,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }}
      >
        {/* Left accent strip */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 4,
            borderRadius: 4,
            backgroundColor: stripColor,
          }}
        />

        {/* Content row */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Icon circle */}
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: stripColor + "20",
              justifyContent: "center",
              alignItems: "center",
              marginRight: 12,
            }}
          >
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
          </View>

          {/* Titles */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#1E3A5F" }} numberOfLines={1}>
              {item.titleFr}
            </Text>
            <Text style={{ fontSize: 13, color: "#8A8A7A", marginTop: 1 }} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
        </View>

        {/* Description */}
        <Text
          style={{
            fontSize: 13,
            color: "#9A9A8A",
            lineHeight: 19,
            marginTop: 8,
          }}
          numberOfLines={2}
        >
          {item.description}
        </Text>

        {/* Footer row */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 10,
          }}
        >
          {/* CEFR badge */}
          <View
            style={{
              backgroundColor: stripColor + "22",
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: stripColor,
              }}
            >
              {item.cefr_level}
            </Text>
          </View>

          {/* Difficulty dots */}
          <View style={{ flexDirection: "row", gap: 4 }}>
            {[1, 2, 3].map((dot) => (
              <View
                key={dot}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: dot <= difficultyDots ? stripColor : "#E0E0CE",
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
      router.push(`/(tabs)/conversation/${encodeURIComponent(topic.titleFr)}`);
    },
    [router]
  );

  const renderTopic = useCallback(
    ({ item, index }: { item: ConversationTopic; index: number }) => (
      <CardItem item={item} index={index} onPress={handleTopicPress} />
    ),
    [handleTopicPress]
  );

  const initials = profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : "?";

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      {/* Hero section */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
          paddingBottom: 24,
          paddingTop: insets.top + 16,
          paddingHorizontal: 24,
        }}
      >
        {/* Depth overlay */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "50%",
            backgroundColor: "rgba(10,25,55,0.4)",
            borderBottomLeftRadius: 32,
            borderBottomRightRadius: 32,
          }}
          pointerEvents="none"
        />

        {/* Row 1: CEFR badge + initials */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(245,166,35,0.2)",
              borderColor: "#F5A623",
              borderWidth: 1,
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#F5A623" }}>{userLevel}</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/conversation/history")}
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                borderColor: "rgba(255,255,255,0.2)",
                borderWidth: 1,
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.8)" }}>
                History
              </Text>
            </TouchableOpacity>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "rgba(255,255,255,0.15)",
                borderColor: "rgba(255,255,255,0.25)",
                borderWidth: 1,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFFFFF" }}>{initials}</Text>
            </View>
          </View>
        </View>

        {/* Row 2: Heading */}
        <Text
          style={{
            fontSize: 26,
            fontWeight: "800",
            color: "#FFFFFF",
            letterSpacing: -0.3,
            marginTop: 12,
          }}
        >
          Parlez avec Compagnon
        </Text>

        {/* Row 3: Subheading */}
        <Text
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.6)",
            marginTop: 6,
          }}
        >
          Choose a topic and start speaking.
        </Text>

        {/* Row 4: Stat chips */}
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            marginTop: 24,
            flexWrap: "wrap",
          }}
        >
          {[`🔥 ${streak} day streak`, "💬 Practice", `⭐ ${userLevel}`].map((label) => (
            <View
              key={label}
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: "rgba(255,255,255,0.85)",
                }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Level filter bar — only show levels that have topics */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          paddingHorizontal: 20,
          paddingVertical: 12,
          gap: 10,
        }}
      >
        {(["All", ...availableLevels] as const).map((level) => {
          const isActive = selectedLevel === level;
          return (
            <TouchableOpacity
              key={level}
              onPress={() => setSelectedLevel(level as LevelFilter)}
              style={{
                flex: 1,
                maxWidth: 80,
                backgroundColor: isActive ? "#1E3A5F" : "#FFFFFF",
                borderColor: isActive ? "#1E3A5F" : "#E0E0CE",
                borderWidth: 1,
                borderRadius: 20,
                paddingVertical: 8,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? "700" : "600",
                  color: isActive ? "#FFFFFF" : "#8A8A7A",
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
