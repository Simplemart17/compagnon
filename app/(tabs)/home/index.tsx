import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Pressable,
  StatusBar,
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
import { Colors, Shadows, skillTint } from "@/src/lib/design";
import { SkeletonBar } from "@/src/components/common/SkeletonBar";
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
      accessibilityRole="button"
      accessibilityLabel="Talk with Companion"
      accessibilityHint="Start a real-time AI voice conversation"
      className="bg-primary rounded-2xl p-4 flex-row items-center gap-4"
      style={[
        {
          shadowColor: Colors.primary,
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
        className="w-[52px] h-[52px] rounded-[26px] justify-center items-center"
        style={{
          backgroundColor: "rgba(245,166,35,0.2)",
          borderWidth: 1.5,
          borderColor: "rgba(245,166,35,0.5)",
        }}
      >
        <Text className="text-[24px]">{"\uD83C\uDF99\uFE0F"}</Text>
      </View>

      {/* Text content */}
      <View className="flex-1">
        <Text className="text-white font-bold text-base">Parlez avec Compagnon</Text>
        <Text className="text-[13px] mt-[3px]" style={{ color: "rgba(255,255,255,0.65)" }}>
          Conversez en temps réel avec votre IA
        </Text>
      </View>

      {/* Arrow pill */}
      <View
        className="rounded-2xl w-8 h-8 justify-center items-center"
        style={{
          backgroundColor: "rgba(245,166,35,0.25)",
          borderWidth: 1,
          borderColor: "rgba(245,166,35,0.5)",
        }}
      >
        <Text className="text-accent text-base font-bold">{"\u2192"}</Text>
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
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      className="flex-1 bg-white rounded-2xl p-4 overflow-hidden"
      style={[
        {
          shadowColor: Colors.primary,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 3,
        },
        animStyle,
      ]}
    >
      {/* Left accent strip */}
      <View
        className="absolute left-0 top-0 bottom-0 w-1 rounded-tl-2xl rounded-bl-2xl"
        style={{ backgroundColor: accentColor }}
      />
      <Text className="text-[24px] mb-2">{emoji}</Text>
      <Text className="font-bold text-primary text-sm">{title}</Text>
      <Text className="text-xs text-[#94A3B8] mt-[2px]">{subtitle}</Text>
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
    <View className="flex-1 items-center">
      <View className="w-3/4 h-12 justify-end">
        <Animated.View
          style={[
            {
              backgroundColor: isGoalMet ? Colors.success : Colors.primary,
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
            },
            barStyle,
          ]}
        />
      </View>
      <Text className="text-[9px] text-[#94A3B8] mt-1">{dayLabel}</Text>
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
      <View className="flex-1 bg-surface">
        <StatusBar barStyle="light-content" />
        {/* Hero skeleton */}
        <View
          className="bg-primary pb-6 px-6 rounded-b-[28px]"
          style={{ paddingTop: insets.top + 16 }}
        >
          <SkeletonBar width={80} height={10} style={{ marginBottom: 14 }} />
          <SkeletonBar width={200} height={28} style={{ marginBottom: 12 }} />
          <View className="flex-row gap-2 mb-4">
            <SkeletonBar width={40} height={24} style={{ borderRadius: 20 }} />
            <SkeletonBar width={60} height={24} style={{ borderRadius: 20 }} />
          </View>
          <SkeletonBar width="100%" height={4} />
        </View>
        {/* Content skeleton */}
        <View style={{ padding: 20 }}>
          <SkeletonBar width={100} height={18} style={{ marginBottom: 12 }} />
          <SkeletonBar width="100%" height={80} style={{ borderRadius: 16, marginBottom: 12 }} />
          <View className="flex-row gap-3">
            <View style={{ flex: 1 }}>
              <SkeletonBar width="100%" height={100} style={{ borderRadius: 16 }} />
            </View>
            <View style={{ flex: 1 }}>
              <SkeletonBar width="100%" height={100} style={{ borderRadius: 16 }} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : null;
  const targetLevel = profile?.target_cefr_level ?? "C1";

  return (
    <View className="flex-1 bg-surface">
      <StatusBar barStyle="light-content" />
      {/* ------------------------------------------------------------------ */}
      {/* Hero header -- fixed, not scrollable                                */}
      {/* ------------------------------------------------------------------ */}
      <View
        className="bg-primary pb-6 px-6 rounded-b-[28px]"
        style={{
          paddingTop: insets.top + 16,
          ...Shadows.hero,
        }}
      >
        {/* Row 1: brand label + notification bell */}
        <View className="flex-row justify-between items-center mb-[14px]">
          <Text className="text-[10px] font-bold text-accent tracking-[3px]">COMPAGNON</Text>
          <View
            className="w-[34px] h-[34px] rounded-[17px] justify-center items-center"
            style={{
              backgroundColor: "rgba(245,166,35,0.15)",
              borderWidth: 1,
              borderColor: "rgba(245,166,35,0.3)",
            }}
          >
            <Text className="text-[15px]">{"\uD83D\uDD14"}</Text>
          </View>
        </View>

        {/* Row 2: greeting */}
        <Text className="text-[28px] font-extrabold text-white mb-3">
          Bonjour{firstName ? `, ${firstName}` : ""} !
        </Text>

        {/* Row 3: chips */}
        <View className="flex-row items-center gap-2 mb-4 flex-wrap">
          {/* CEFR level pill */}
          <View
            className="px-[10px] py-1 rounded-[20px]"
            style={{ borderWidth: 1.5, borderColor: Colors.accent }}
            accessibilityLabel={`Current level: ${level}`}
          >
            <Text className="text-accent font-bold text-[13px]">{level}</Text>
          </View>

          {/* Streak chip */}
          {progress.streakDays > 0 && (
            <View
              className="flex-row items-center px-[9px] py-1 rounded-[20px] gap-1"
              style={{ backgroundColor: Colors.accent20 }}
              accessibilityLabel={`${progress.streakDays} day streak`}
            >
              <Text className="text-xs">{"\uD83D\uDD25"}</Text>
              <Text className="text-xs font-bold text-accent">{progress.streakDays}j</Text>
            </View>
          )}

          {/* Target pill */}
          <View
            className="flex-row items-center px-[9px] py-1 rounded-[20px] gap-1"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          >
            <Text className="text-[11px]" style={{ color: "rgba(255,255,255,0.7)" }}>
              Objectif
            </Text>
            <Text className="text-xs font-bold text-white">{targetLevel}</Text>
          </View>
        </View>

        {/* Row 4: daily goal mini progress bar */}
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={`Daily goal: ${minutesToday} of ${dailyGoal} minutes, ${goalPercent} percent complete`}
          accessibilityValue={{ min: 0, max: dailyGoal, now: minutesToday }}
        >
          <View className="h-1 rounded-sm" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
            <View
              className="h-1 rounded-sm"
              style={{
                backgroundColor: goalPercent >= 100 ? Colors.success : Colors.accent,
                width: `${goalPercent}%`,
              }}
            />
          </View>
          <Text
            className="text-[11px] mt-[5px] text-right"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            {minutesToday}/{dailyGoal} min
          </Text>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Scrollable content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Error banner ---- */}
        {progress.error && (
          <TouchableOpacity
            onPress={progress.clearError}
            accessibilityRole="alert"
            accessibilityLabel={`Error: ${progress.error}. Tap to dismiss.`}
            activeOpacity={0.8}
            className="rounded-xl p-3 mb-2 flex-row items-center gap-2"
            style={{
              backgroundColor: "rgba(255,59,48,0.1)",
              borderWidth: 1,
              borderColor: "rgba(255,59,48,0.25)",
            }}
          >
            <Text className="text-[13px] text-error flex-1 leading-[18px]">{progress.error}</Text>
            <Text className="text-xs text-error font-semibold">Dismiss</Text>
          </TouchableOpacity>
        )}

        {/* ---- Quick Start section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text className="text-lg font-bold text-primary mt-5 mb-3">Quick Start</Text>

          <View className="gap-3">
            {/* Big CTA: Conversation */}
            <ConversationCard onPress={() => router.push("/(tabs)/conversation")} />

            {/* 2-column row */}
            <View className="flex-row gap-3">
              <SmallActionCard
                emoji={"\uD83D\uDCDD"}
                title="Exercice du jour"
                subtitle="Daily Practice"
                accentColor={Colors.accent}
                onPress={() => router.push("/(tabs)/practice")}
              />
              <SmallActionCard
                emoji={"\uD83C\uDFAF"}
                title="Test TCF"
                subtitle="Mock Test"
                accentColor={Colors.skillGrammar}
                onPress={() => router.push("/(tabs)/mock-test")}
              />
            </View>

            {/* Fix This Mistake card */}
            {progress.topErrors.length > 0 ? (
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/practice/grammar" as const,
                    params: {
                      errorId: progress.topErrors[0].id,
                      errorType: progress.topErrors[0].error_type,
                      errorDescription: progress.topErrors[0].error_description,
                    },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Fix this mistake: ${progress.topErrors[0].error_description}`}
                accessibilityHint="Practice a targeted grammar drill"
                className="rounded-2xl p-5"
                style={{
                  backgroundColor: Colors.accent10,
                  borderWidth: 1,
                  borderColor: Colors.accent,
                }}
                activeOpacity={0.75}
              >
                <View className="flex-row items-center mb-[6px] gap-[6px]">
                  <Text className="text-[15px]">{"\u26A0\uFE0F"}</Text>
                  <Text className="text-[13px] font-bold text-accent">À corriger</Text>
                </View>
                <Text className="text-sm text-primary leading-5">
                  {progress.topErrors[0].error_description}
                </Text>
                <Text className="text-xs text-accent mt-2 font-semibold">Pratiquer {"\u2192"}</Text>
              </TouchableOpacity>
            ) : (
              <View
                className="rounded-2xl p-5"
                style={{
                  backgroundColor: skillTint(Colors.accent, 0.07),
                  borderWidth: 1,
                  borderColor: Colors.accent30,
                }}
              >
                <View className="flex-row items-center mb-[6px] gap-[6px]">
                  <Text className="text-[15px]">{"\u26A0\uFE0F"}</Text>
                  <Text className="text-[13px] font-bold text-accent">À corriger</Text>
                </View>
                <Text className="text-sm text-[#4A5568] leading-5">
                  {"Terminez plus d'exercices pour voir vos corrections personnalisées ici."}
                </Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* ---- Skills overview section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text className="text-lg font-bold text-primary mt-7 mb-[10px]">Mes compétences</Text>
          {progress.skills.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {progress.skills.map((skill) => (
                <View
                  key={skill.skill}
                  accessibilityLabel={`${SKILL_LABELS[skill.skill]?.fr ?? skill.skill}: level ${skill.cefr_level}`}
                  className="bg-white rounded-xl px-3 py-2 flex-row items-center gap-2"
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.borderOnDark,
                    ...Shadows.subtle,
                  }}
                >
                  <Text className="text-xs text-[#4A5568]">{SKILL_LABELS[skill.skill]?.fr}</Text>
                  <View
                    className="px-[6px] py-[2px] rounded-md"
                    style={{
                      backgroundColor: LEVEL_COLORS[skill.cefr_level as CEFRLevel] ?? "#999",
                    }}
                  >
                    <Text className="text-white text-[10px] font-bold">{skill.cefr_level}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View
              className="bg-white rounded-[14px] p-5 items-center"
              style={{
                borderWidth: 1,
                borderColor: Colors.primary8,
              }}
            >
              <Text className="text-[13px] text-[#94A3B8] text-center leading-[19px]">
                Commencez un exercice ou une conversation pour{"\n"}voir vos compétences ici.
              </Text>
            </View>
          )}
        </Animated.View>

        {/* ---- Weekly activity section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text className="text-lg font-bold text-primary mt-7 mb-3">Cette semaine</Text>
          {progress.recentActivity.length > 1 ? (
            <View
              className="bg-white rounded-2xl p-4"
              style={{
                shadowColor: Colors.primary,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06,
                shadowRadius: 8,
                elevation: 2,
              }}
            >
              <View className="flex-row justify-between gap-1">
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
              className="bg-white rounded-[14px] p-5 items-center"
              style={{
                borderWidth: 1,
                borderColor: Colors.primary8,
              }}
            >
              <Text className="text-[13px] text-[#94A3B8] text-center leading-[19px]">
                Pratiquez chaque jour pour voir{"\n"}votre activité hebdomadaire ici.
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
