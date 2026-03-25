import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
} from "react-native-reanimated";

import { useAuth } from "@/src/hooks/use-auth";
import { useCefrHistory } from "@/src/hooks/use-cefr-history";
import { useProgress } from "@/src/hooks/use-progress";
import { CEFRProgressionChart } from "@/src/components/profile/cefr-progression-chart";
import { CEFR_LEVELS } from "@/src/types/cefr";
import { LEVEL_COLORS, SKILL_LABELS } from "@/src/lib/constants";
import { Colors, SKILL_COLORS } from "@/src/lib/design";
import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS: TCFSkill[] = ["listening", "reading", "speaking", "writing", "grammar"];

const SKILL_ROUTES: Record<string, string> = {
  listening: "/(tabs)/practice/listening",
  reading: "/(tabs)/practice/reading",
  speaking: "/(tabs)/conversation",
  writing: "/(tabs)/practice/writing",
  grammar: "/(tabs)/practice/grammar",
};

// ---------------------------------------------------------------------------
// Animated stat tile
// ---------------------------------------------------------------------------

interface StatTileProps {
  value: string;
  unit: string;
  label: string;
  delay: number;
}

function StatTile({ value, unit, label, delay }: StatTileProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) })
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) })
    );
  }, [delay, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      className="flex-1 items-center rounded-2xl bg-white px-2.5 py-3.5"
      style={[
        animStyle,
        {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 6,
        },
      ]}
    >
      <Text className="text-2xl font-extrabold text-primary">{value}</Text>
      {unit.length > 0 ? <Text className="mt-px text-[10px] text-[#94A3B8]">{unit}</Text> : null}
      <Text className="mt-0.5 text-xs text-[#4A5568]">{label}</Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Animated skill card
// ---------------------------------------------------------------------------

interface SkillCardProps {
  skill: TCFSkill;
  skillLevel: CEFRLevel;
  exercises: number;
  score: number;
  delay: number;
  onPress?: () => void;
}

function SkillCard({ skill, skillLevel, exercises, score, delay, onPress }: SkillCardProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-20);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) })
    );
    translateX.value = withDelay(
      delay,
      withTiming(0, { duration: 380, easing: Easing.out(Easing.quad) })
    );
  }, [delay, opacity, translateX]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const color = SKILL_COLORS[skill];
  const fillPct: `${number}%` = `${Math.min(100, (score ?? 0) / 7)}%`;

  const card = (
    <Animated.View
      className="overflow-hidden rounded-2xl bg-white"
      style={[
        animStyle,
        {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
          elevation: 3,
        },
      ]}
    >
      {/* Colored left strip */}
      <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: color }} />
      <View className="py-3.5 pl-[18px] pr-3.5">
        <View className="mb-2.5 flex-row items-center justify-between">
          <View>
            <Text className="text-sm font-semibold text-primary">{SKILL_LABELS[skill]?.fr}</Text>
            <Text className="mt-0.5 text-[11px] text-[#94A3B8]">
              {exercises} exercices complétés
            </Text>
          </View>
          {/* CEFR badge pill */}
          <View
            className="rounded-[10px] px-2.5 py-1"
            style={{ backgroundColor: LEVEL_COLORS[skillLevel] }}
          >
            <Text className="text-xs font-bold text-white">{skillLevel}</Text>
          </View>
        </View>
        {/* Progress bar */}
        <View className="h-1 rounded-sm bg-surface-200">
          <View
            className="h-1 rounded-sm"
            style={{
              width: fillPct,
              backgroundColor: color,
            }}
          />
        </View>
      </View>
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${SKILL_LABELS[skill]?.fr ?? skill}: ${skillLevel}, ${exercises} exercises`}
      >
        {card}
      </TouchableOpacity>
    );
  }
  return card;
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, signOut } = useAuth();
  const progress = useProgress();
  const cefrHistory = useCefrHistory();
  const [refreshing, setRefreshing] = useState(false);

  const level = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const target = (profile?.target_cefr_level ?? "C1") as CEFRLevel;

  const totalExercises = progress.skills.reduce((sum, s) => sum + s.exercises_completed, 0);
  const totalMinutes = progress.skills.reduce((sum, s) => sum + s.total_time_minutes, 0);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([progress.refresh(), cefrHistory.refresh()]);
    setRefreshing(false);
  }, [progress, cefrHistory]);

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  }

  const initials = (profile?.full_name ?? "U")[0].toUpperCase();
  const displayName = profile?.full_name ?? "Utilisateur";

  if (progress.isLoading && !refreshing) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 items-center justify-center bg-surface">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="mt-4 text-sm text-[#4A5568]">Chargement du profil...</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" />
      <View className="flex-1 bg-surface">
        {/* ----------------------------------------------------------------
            Hero header -- not scrollable
        ---------------------------------------------------------------- */}
        <View
          className="rounded-b-[28px] bg-primary px-6 pb-8"
          style={{ paddingTop: insets.top + 12 }}
        >
          {/* Inner dark overlay layer for depth */}
          <View
            className="absolute bottom-0 left-0 right-0 top-0 rounded-b-[40px]"
            style={{ backgroundColor: "rgba(13,34,64,0.35)" }}
          />

          {/* Top row: title + settings button */}
          <View className="mb-6 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-white">Mon profil</Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile/settings")}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
            >
              <Text className="text-lg">{"\u2699\uFE0F"}</Text>
            </TouchableOpacity>
          </View>

          {/* Avatar */}
          <View className="items-center">
            <View
              className="h-[84px] w-[84px] items-center justify-center rounded-full border-[3px] border-accent"
              style={{ backgroundColor: "rgba(245,166,35,0.2)" }}
            >
              <Text className="text-[34px] font-bold text-white">{initials}</Text>
            </View>

            {/* Name */}
            <Text className="mt-3 text-[22px] font-extrabold text-white">{displayName}</Text>

            {/* Level + target row */}
            <View className="mt-2.5 flex-row items-center gap-2.5">
              {/* Current level pill */}
              <View
                className="rounded-2xl px-3.5 py-[5px]"
                style={{ backgroundColor: LEVEL_COLORS[level] }}
              >
                <Text className="text-sm font-bold text-white">{level}</Text>
              </View>
              <Text className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                {"\u2192"}
              </Text>
              <View
                className="rounded-2xl px-3 py-[5px]"
                style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
              >
                <Text className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
                  {target}
                </Text>
              </View>
            </View>

            {/* Streak chip */}
            {progress.streakDays > 0 ? (
              <View
                className="mt-3 flex-row items-center gap-[5px] rounded-[20px] border px-3.5 py-1.5"
                style={{
                  backgroundColor: "rgba(255,111,0,0.18)",
                  borderColor: "rgba(255,140,0,0.35)",
                }}
              >
                <Text className="text-[15px]">{"🔥"}</Text>
                <Text className="text-[13px] font-bold text-accent">
                  {progress.streakDays} jour{progress.streakDays !== 1 ? "s" : ""}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ----------------------------------------------------------------
            Stat tiles -- overlapping hero with negative margin
        ---------------------------------------------------------------- */}
        <View className="-mt-7 mb-1 flex-row gap-2.5 px-5">
          <StatTile value={`${progress.streakDays}`} unit="jours" label="Série" delay={0} />
          <StatTile value={`${totalExercises}`} unit="" label="Exercices" delay={80} />
          <StatTile value={`${totalMinutes}`} unit="min" label="Pratique" delay={160} />
        </View>

        {/* ----------------------------------------------------------------
            Scrollable content
        ---------------------------------------------------------------- */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {/* Skills section */}
          <Text className="mb-3 text-lg font-bold text-primary">Mes compétences</Text>
          <View className="mb-7 gap-2.5">
            {SKILLS.map((skill, idx) => {
              const skillData = progress.skills.find((s) => s.skill === skill);
              const skillLevel = (skillData?.cefr_level ?? level) as CEFRLevel;
              const exerciseCount = skillData?.exercises_completed ?? 0;
              const skillScore = skillData?.score ?? 0;

              return (
                <SkillCard
                  key={skill}
                  skill={skill}
                  skillLevel={skillLevel}
                  exercises={exerciseCount}
                  score={skillScore}
                  delay={idx * 60}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
                  onPress={() => router.push(SKILL_ROUTES[skill] as any)}
                />
              );
            })}
          </View>

          {/* CEFR progression chart */}
          <View className="mb-7">
            <CEFRProgressionChart
              dataPoints={cefrHistory.dataPoints}
              targetLevel={cefrHistory.targetLevel}
              currentLevel={cefrHistory.currentLevel}
              loading={cefrHistory.loading}
            />
          </View>

          {/* CEFR level card */}
          <Animated.View
            entering={FadeIn.delay(200).duration(400)}
            className="mb-7 rounded-2xl border p-4"
            style={{
              backgroundColor: "rgba(245,166,35,0.08)",
              borderColor: "rgba(245,166,35,0.35)",
            }}
          >
            <View className="mb-2 flex-row items-center gap-2.5">
              {/* Level badge */}
              <View
                className="rounded-[10px] px-3 py-1"
                style={{ backgroundColor: LEVEL_COLORS[level] }}
              >
                <Text className="text-[13px] font-bold text-white">{level}</Text>
              </View>
              <Text className="text-sm text-[#94A3B8]">{"\u2192"}</Text>
              <Text className="text-[15px] font-bold text-primary">{CEFR_LEVELS[level].name}</Text>
              <Text className="text-sm text-[#4A5568]">
                {"\u2014"} {CEFR_LEVELS[level].nameFr}
              </Text>
            </View>
            <Text className="text-[13px] leading-[19px] text-[#4A5568]">
              {CEFR_LEVELS[level].description}
            </Text>
            <Text className="mt-2 text-xs font-semibold text-accent">
              Score TCF : {CEFR_LEVELS[level].tcfScoreMin}
              {"\u2013"}
              {CEFR_LEVELS[level].tcfScoreMax}
            </Text>
          </Animated.View>

          {/* Error patterns section */}
          {progress.topErrors.length > 0 ? (
            <View className="mb-7">
              <Text className="mb-3 text-lg font-bold text-primary">À améliorer</Text>
              <View className="gap-2">
                {progress.topErrors.map((error, idx) => (
                  <TouchableOpacity
                    key={error.id}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Error pattern: ${error.error_description}. Tap for practice drill.`}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/practice/grammar",
                        params: {
                          errorId: error.id,
                          errorType: error.error_type,
                          errorDescription: error.error_description,
                        },
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
                      } as any)
                    }
                  >
                    <Animated.View
                      entering={FadeIn.delay(idx * 60 + 100).duration(350)}
                      className="overflow-hidden rounded-2xl bg-white"
                      style={{
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.06,
                        shadowRadius: 6,
                        elevation: 3,
                      }}
                    >
                      {/* Amber left strip */}
                      <View className="absolute bottom-0 left-0 top-0 w-1 bg-accent" />
                      <View className="flex-row items-center justify-between py-3.5 pl-[18px] pr-3.5">
                        <Text className="flex-1 text-[13px] leading-[18px] text-primary">
                          {error.error_description}
                        </Text>
                        <View
                          className="ml-2.5 rounded-lg border px-2 py-[3px]"
                          style={{
                            backgroundColor: Colors.accent10,
                            borderColor: "rgba(245,166,35,0.3)",
                          }}
                        >
                          <Text className="text-[11px] font-bold text-accent">
                            {error.occurrences}x
                          </Text>
                        </View>
                      </View>
                    </Animated.View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <View className="mb-7">
              <Text className="mb-3 text-lg font-bold text-primary">À améliorer</Text>
              <View
                className="items-center rounded-2xl border bg-white p-5"
                style={{ borderColor: "rgba(30,58,95,0.08)" }}
              >
                <Text className="text-center text-[13px] leading-[19px] text-[#94A3B8]">
                  Aucune erreur détectée pour le moment.{"\n"}Continuez à pratiquer !
                </Text>
              </View>
            </View>
          )}

          {/* Sign Out */}
          <TouchableOpacity
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            className="mt-2 items-center rounded-2xl border border-error bg-white p-4"
          >
            <Text className="text-base font-semibold text-error">Se déconnecter</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </>
  );
}
