import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { useAuthStore } from "@/src/store/auth-store";
import { useProgress } from "@/src/hooks/use-progress";
import { LEVEL_COLORS, SKILL_LABELS } from "@/src/lib/constants";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Animated wrappers
// ---------------------------------------------------------------------------

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ConversationCardProps {
  onPress: () => void;
}

function ConversationCard({ onPress }: ConversationCardProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 100 });
      }}
      onPress={onPress}
      style={[
        {
          backgroundColor: "#1E3A5F",
          borderRadius: 20,
          padding: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          shadowColor: "#1E3A5F",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 12,
          elevation: 6,
        },
        animStyle,
      ]}
    >
      {/* Mic icon circle */}
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: "rgba(245,166,35,0.2)",
          justifyContent: "center",
          alignItems: "center",
          borderWidth: 1.5,
          borderColor: "rgba(245,166,35,0.5)",
        }}
      >
        <Text style={{ fontSize: 24 }}>{"\uD83C\uDF99\uFE0F"}</Text>
      </View>

      {/* Text content */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16 }}>
          Parlez avec Compagnon
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, marginTop: 3 }}>
          Conversez en temps réel avec votre IA
        </Text>
      </View>

      {/* Arrow pill */}
      <View
        style={{
          backgroundColor: "rgba(245,166,35,0.25)",
          borderRadius: 16,
          width: 32,
          height: 32,
          justifyContent: "center",
          alignItems: "center",
          borderWidth: 1,
          borderColor: "rgba(245,166,35,0.5)",
        }}
      >
        <Text style={{ color: "#F5A623", fontSize: 16, fontWeight: "700" }}>{"\u2192"}</Text>
      </View>
    </AnimatedPressable>
  );
}

interface SmallActionCardProps {
  emoji: string;
  title: string;
  subtitle: string;
  accentColor: string;
  onPress: () => void;
}

function SmallActionCard({ emoji, title, subtitle, accentColor, onPress }: SmallActionCardProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withTiming(0.96, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 100 });
      }}
      onPress={onPress}
      style={[
        {
          flex: 1,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          padding: 16,
          shadowColor: "#1E3A5F",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 3,
          overflow: "hidden",
        },
        animStyle,
      ]}
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
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
        }}
      />
      <Text style={{ fontSize: 24, marginBottom: 8 }}>{emoji}</Text>
      <Text style={{ fontWeight: "700", color: "#1E3A5F", fontSize: 14 }}>{title}</Text>
      <Text style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{subtitle}</Text>
    </AnimatedPressable>
  );
}

interface ActivityBarProps {
  heightPx: number;
  isGoalMet: boolean;
  delay: number;
  dayLabel: string;
}

function ActivityBar({ heightPx, isGoalMet, delay, dayLabel }: ActivityBarProps) {
  const animHeight = useSharedValue(0);

  useEffect(() => {
    animHeight.value = withDelay(delay, withTiming(heightPx, { duration: 400 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightPx, delay]);

  const barStyle = useAnimatedStyle(() => ({
    height: animHeight.value,
  }));

  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <View
        style={{
          width: "75%",
          height: 48,
          justifyContent: "flex-end",
        }}
      >
        <Animated.View
          style={[
            {
              backgroundColor: isGoalMet ? "#34C759" : "#1E3A5F",
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
            },
            barStyle,
          ]}
        />
      </View>
      <Text style={{ fontSize: 9, color: "#999", marginTop: 4 }}>{dayLabel}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAuthStore((s) => s.profile);
  const progress = useProgress();
  const [refreshing, setRefreshing] = useState(false);

  const level = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const dailyGoal = profile?.daily_goal_minutes ?? 15;
  const minutesToday = progress.todayActivity?.minutes_practiced ?? 0;
  const goalPercent = Math.min(100, Math.round((minutesToday / dailyGoal) * 100));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await progress.refresh();
    setRefreshing(false);
  }, [progress]);

  // Card fade-in on mount
  const cardOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(16);
  useEffect(() => {
    cardOpacity.value = withDelay(120, withTiming(1, { duration: 350 }));
    cardTranslateY.value = withDelay(120, withTiming(0, { duration: 350 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardEntryStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  if (progress.isLoading && !refreshing) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#1E3A5F" />
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>Chargement...</Text>
      </View>
    );
  }

  const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : null;
  const targetLevel = profile?.target_cefr_level ?? "C1";

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      {/* ------------------------------------------------------------------ */}
      {/* Hero header — fixed, not scrollable                                  */}
      {/* ------------------------------------------------------------------ */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          paddingTop: insets.top + 16,
          paddingBottom: 24,
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
        {/* Row 1: brand label + notification bell */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: "700",
              color: "#F5A623",
              letterSpacing: 3,
            }}
          >
            COMPAGNON
          </Text>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: "rgba(245,166,35,0.15)",
              borderWidth: 1,
              borderColor: "rgba(245,166,35,0.3)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 15 }}>{"\uD83D\uDD14"}</Text>
          </View>
        </View>

        {/* Row 2: greeting */}
        <Text
          style={{
            fontSize: 28,
            fontWeight: "800",
            color: "#FFFFFF",
            marginBottom: 12,
          }}
        >
          Bonjour{firstName ? `, ${firstName}` : ""} !
        </Text>

        {/* Row 3: chips */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {/* CEFR level pill */}
          <View
            style={{
              borderWidth: 1.5,
              borderColor: "#F5A623",
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
            }}
          >
            <Text style={{ color: "#F5A623", fontWeight: "700", fontSize: 13 }}>{level}</Text>
          </View>

          {/* Streak chip */}
          {progress.streakDays > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(255,149,0,0.2)",
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 20,
                gap: 4,
              }}
            >
              <Text style={{ fontSize: 12 }}>{"\uD83D\uDD25"}</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#FF9500" }}>
                {progress.streakDays}j
              </Text>
            </View>
          )}

          {/* Target pill */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "rgba(255,255,255,0.12)",
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 20,
              gap: 4,
            }}
          >
            <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>Objectif</Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                color: "#FFFFFF",
              }}
            >
              {targetLevel}
            </Text>
          </View>
        </View>

        {/* Row 4: daily goal mini progress bar */}
        <View>
          <View
            style={{
              height: 4,
              backgroundColor: "rgba(255,255,255,0.2)",
              borderRadius: 2,
            }}
          >
            <View
              style={{
                height: 4,
                backgroundColor: goalPercent >= 100 ? "#34C759" : "#F5A623",
                borderRadius: 2,
                width: `${goalPercent}%`,
              }}
            />
          </View>
          <Text
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.65)",
              marginTop: 5,
              textAlign: "right",
            }}
          >
            {minutesToday}/{dailyGoal} min
          </Text>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1E3A5F" />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Quick Start section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: "#1E3A5F",
              marginTop: 20,
              marginBottom: 12,
            }}
          >
            Quick Start
          </Text>

          <View style={{ gap: 12 }}>
            {/* Big CTA: Conversation */}
            <ConversationCard onPress={() => router.push("/(tabs)/conversation")} />

            {/* 2-column row */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <SmallActionCard
                emoji={"\uD83D\uDCDD"}
                title="Exercice du jour"
                subtitle="Daily Practice"
                accentColor="#F5A623"
                onPress={() => router.push("/(tabs)/practice")}
              />
              <SmallActionCard
                emoji={"\uD83C\uDFAF"}
                title="Test TCF"
                subtitle="Mock Test"
                accentColor="#9C27B0"
                onPress={() => router.push("/(tabs)/mock-test")}
              />
            </View>

            {/* Fix This Mistake card */}
            {progress.topErrors.length > 0 ? (
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/practice/grammar",
                    params: {
                      errorId: progress.topErrors[0].id,
                      errorType: progress.topErrors[0].error_type,
                      errorDescription: progress.topErrors[0].error_description,
                    },
                  } as { pathname: string; params: Record<string, string> })
                }
                style={{
                  backgroundColor: "rgba(245,166,35,0.1)",
                  borderRadius: 16,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: "#F5A623",
                }}
                activeOpacity={0.75}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 6,
                    gap: 6,
                  }}
                >
                  <Text style={{ fontSize: 15 }}>{"\u26A0\uFE0F"}</Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#F5A623",
                    }}
                  >
                    {"\xC0"} corriger
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: "#333", lineHeight: 20 }}>
                  {progress.topErrors[0].error_description}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: "#F5A623",
                    marginTop: 8,
                    fontWeight: "600",
                  }}
                >
                  Pratiquer {"\u2192"}
                </Text>
              </TouchableOpacity>
            ) : (
              <View
                style={{
                  backgroundColor: "rgba(245,166,35,0.07)",
                  borderRadius: 16,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: "rgba(245,166,35,0.4)",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 6,
                    gap: 6,
                  }}
                >
                  <Text style={{ fontSize: 15 }}>{"\u26A0\uFE0F"}</Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#F5A623",
                    }}
                  >
                    {"\xC0"} corriger
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: "#666", lineHeight: 20 }}>
                  Terminez plus d{"\u2019"}exercices pour voir vos corrections personnalis{"\xE9"}es
                  ici.
                </Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* ---- Skills overview section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "700",
              color: "#1E3A5F",
              marginTop: 28,
              marginBottom: 10,
            }}
          >
            Mes comp{"\xE9"}tences
          </Text>
          {progress.skills.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {progress.skills.map((skill) => (
                <View
                  key={skill.skill}
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    borderWidth: 1,
                    borderColor: "rgba(30,58,95,0.12)",
                    shadowColor: "#1E3A5F",
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <Text style={{ fontSize: 12, color: "#555" }}>
                    {SKILL_LABELS[skill.skill]?.fr}
                  </Text>
                  <View
                    style={{
                      backgroundColor: LEVEL_COLORS[skill.cefr_level as CEFRLevel] ?? "#999",
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFF",
                        fontSize: 10,
                        fontWeight: "700",
                      }}
                    >
                      {skill.cefr_level}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 14,
                padding: 20,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "rgba(30,58,95,0.08)",
              }}
            >
              <Text style={{ fontSize: 13, color: "#999", textAlign: "center", lineHeight: 19 }}>
                Commencez un exercice ou une conversation pour{"\n"}voir vos comp{"\xE9"}tences ici.
              </Text>
            </View>
          )}
        </Animated.View>

        {/* ---- Weekly activity section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "700",
              color: "#1E3A5F",
              marginTop: 28,
              marginBottom: 12,
            }}
          >
            Cette semaine
          </Text>
          {progress.recentActivity.length > 1 ? (
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 16,
                padding: 16,
                shadowColor: "#1E3A5F",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06,
                shadowRadius: 8,
                elevation: 2,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 4,
                }}
              >
                {progress.recentActivity
                  .slice(0, 7)
                  .reverse()
                  .map((day, i) => {
                    const maxMinutes = dailyGoal;
                    const heightPx = Math.max(
                      3,
                      Math.min(48, (day.minutes_practiced / maxMinutes) * 48)
                    );
                    const isGoalMet = day.minutes_practiced >= maxMinutes;
                    const dayLabel = new Date(day.date).toLocaleDateString("fr", {
                      weekday: "narrow",
                    });
                    return (
                      <ActivityBar
                        key={i}
                        heightPx={heightPx}
                        isGoalMet={isGoalMet}
                        delay={i * 80}
                        dayLabel={dayLabel}
                      />
                    );
                  })}
              </View>
            </View>
          ) : (
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 14,
                padding: 20,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "rgba(30,58,95,0.08)",
              }}
            >
              <Text style={{ fontSize: 13, color: "#999", textAlign: "center", lineHeight: 19 }}>
                Pratiquez chaque jour pour voir{"\n"}votre activit{"\xE9"} hebdomadaire ici.
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
