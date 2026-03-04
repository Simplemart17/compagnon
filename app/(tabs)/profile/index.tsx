import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
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
import { useProgress } from "@/src/hooks/use-progress";
import { CEFR_LEVELS } from "@/src/types/cefr";
import { LEVEL_COLORS, SKILL_LABELS } from "@/src/lib/constants";
import type { CEFRLevel, TCFSkill } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS: TCFSkill[] = ["listening", "reading", "speaking", "writing", "grammar"];

const SKILL_COLORS: Record<string, string> = {
  listening: "#2196F3",
  reading: "#4CAF50",
  speaking: "#E91E63",
  writing: "#FF9800",
  grammar: "#9C27B0",
};

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
      style={[
        animStyle,
        {
          flex: 1,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          paddingVertical: 14,
          paddingHorizontal: 10,
          alignItems: "center",
          // Shadow iOS
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          // Shadow Android
          elevation: 6,
        },
      ]}
    >
      <Text style={{ fontSize: 24, fontWeight: "800", color: "#1E3A5F" }}>{value}</Text>
      {unit.length > 0 ? (
        <Text style={{ fontSize: 10, color: "#999", marginTop: 1 }}>{unit}</Text>
      ) : null}
      <Text style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{label}</Text>
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
      style={[
        animStyle,
        {
          backgroundColor: "#FFFFFF",
          borderRadius: 14,
          overflow: "hidden",
          // Shadow iOS
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
          // Shadow Android
          elevation: 3,
        },
      ]}
    >
      {/* Colored left strip */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: color,
        }}
      />
      <View style={{ paddingLeft: 18, paddingRight: 14, paddingVertical: 14 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <View>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#1E3A5F" }}>
              {SKILL_LABELS[skill]?.fr}
            </Text>
            <Text style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
              {exercises} exercices compl{"\u00E9"}t{"\u00E9"}s
            </Text>
          </View>
          {/* CEFR badge pill */}
          <View
            style={{
              backgroundColor: LEVEL_COLORS[skillLevel],
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>{skillLevel}</Text>
          </View>
        </View>
        {/* Progress bar */}
        <View style={{ height: 4, backgroundColor: "#F0F0E8", borderRadius: 2 }}>
          <View
            style={{
              height: 4,
              width: fillPct,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
        </View>
      </View>
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
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
  const [refreshing, setRefreshing] = useState(false);

  const level = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const target = (profile?.target_cefr_level ?? "C1") as CEFRLevel;

  const totalExercises = progress.skills.reduce((sum, s) => sum + s.exercises_completed, 0);
  const totalMinutes = progress.skills.reduce((sum, s) => sum + s.total_time_minutes, 0);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await progress.refresh();
    setRefreshing(false);
  }, [progress]);

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
        <View
          style={{
            flex: 1,
            backgroundColor: "#F5F5F0",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator size="large" color="#1E3A5F" />
          <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>
            Chargement du profil...
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
        {/* ----------------------------------------------------------------
            Hero header — not scrollable
        ---------------------------------------------------------------- */}
        <View
          style={{
            backgroundColor: "#1E3A5F",
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
            paddingTop: insets.top + 12,
            paddingBottom: 32,
            paddingHorizontal: 24,
          }}
        >
          {/* Inner dark overlay layer for depth */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderBottomLeftRadius: 40,
              borderBottomRightRadius: 40,
              backgroundColor: "rgba(13,34,64,0.35)",
            }}
          />

          {/* Top row: title + settings button */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "700", color: "#FFFFFF" }}>Mon profil</Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile/settings")}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "rgba(255,255,255,0.15)",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 18 }}>{"\u2699\uFE0F"}</Text>
            </TouchableOpacity>
          </View>

          {/* Avatar */}
          <View style={{ alignItems: "center" }}>
            <View
              style={{
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: "rgba(245,166,35,0.2)",
                borderWidth: 3,
                borderColor: "#F5A623",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 34, fontWeight: "700", color: "#FFFFFF" }}>{initials}</Text>
            </View>

            {/* Name */}
            <Text
              style={{
                fontSize: 22,
                fontWeight: "800",
                color: "#FFFFFF",
                marginTop: 12,
              }}
            >
              {displayName}
            </Text>

            {/* Level + target row */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginTop: 10,
              }}
            >
              {/* Current level pill */}
              <View
                style={{
                  backgroundColor: LEVEL_COLORS[level],
                  paddingHorizontal: 14,
                  paddingVertical: 5,
                  borderRadius: 14,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>{level}</Text>
              </View>
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>{"\u2192"}</Text>
              <View
                style={{
                  backgroundColor: "rgba(255,255,255,0.12)",
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 14,
                }}
              >
                <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "600", fontSize: 14 }}>
                  {target}
                </Text>
              </View>
            </View>

            {/* Streak chip */}
            {progress.streakDays > 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  marginTop: 12,
                  backgroundColor: "rgba(255,111,0,0.18)",
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "rgba(255,140,0,0.35)",
                }}
              >
                <Text style={{ fontSize: 15 }}>{"🔥"}</Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "700",
                    color: "#FFB347",
                  }}
                >
                  {progress.streakDays} jour{progress.streakDays !== 1 ? "s" : ""}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ----------------------------------------------------------------
            Stat tiles — overlapping hero with negative margin
        ---------------------------------------------------------------- */}
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            paddingHorizontal: 20,
            marginTop: -28,
            marginBottom: 4,
          }}
        >
          <StatTile value={`${progress.streakDays}`} unit="jours" label="Série" delay={0} />
          <StatTile value={`${totalExercises}`} unit="" label="Exercices" delay={80} />
          <StatTile value={`${totalMinutes}`} unit="min" label="Pratique" delay={160} />
        </View>

        {/* ----------------------------------------------------------------
            Scrollable content
        ---------------------------------------------------------------- */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1E3A5F" />
          }
        >
          {/* Skills section */}
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: "#1E3A5F",
              marginBottom: 12,
            }}
          >
            Mes compétences
          </Text>
          <View style={{ gap: 10, marginBottom: 28 }}>
            {SKILLS.map((skill, idx) => {
              const skillData = progress.skills.find((s) => s.skill === skill);
              const skillLevel = (skillData?.cefr_level ?? level) as CEFRLevel;
              const exercises = skillData?.exercises_completed ?? 0;
              const score = skillData?.score ?? 0;

              return (
                <SkillCard
                  key={skill}
                  skill={skill}
                  skillLevel={skillLevel}
                  exercises={exercises}
                  score={score}
                  delay={idx * 60}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
                  onPress={() => router.push(SKILL_ROUTES[skill] as any)}
                />
              );
            })}
          </View>

          {/* CEFR level card */}
          <Animated.View
            entering={FadeIn.delay(200).duration(400)}
            style={{
              backgroundColor: "rgba(245,166,35,0.08)",
              borderWidth: 1,
              borderColor: "rgba(245,166,35,0.35)",
              borderRadius: 16,
              padding: 16,
              marginBottom: 28,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              {/* Level badge */}
              <View
                style={{
                  backgroundColor: LEVEL_COLORS[level],
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>{level}</Text>
              </View>
              <Text style={{ color: "#999", fontSize: 14 }}>{"\u2192"}</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: "#1E3A5F" }}>
                {CEFR_LEVELS[level].name}
              </Text>
              <Text style={{ fontSize: 14, color: "#666" }}>— {CEFR_LEVELS[level].nameFr}</Text>
            </View>
            <Text style={{ fontSize: 13, color: "#555", lineHeight: 19 }}>
              {CEFR_LEVELS[level].description}
            </Text>
            <Text style={{ fontSize: 12, color: "#F5A623", marginTop: 8, fontWeight: "600" }}>
              Score TCF : {CEFR_LEVELS[level].tcfScoreMin}–{CEFR_LEVELS[level].tcfScoreMax}
            </Text>
          </Animated.View>

          {/* Error patterns section */}
          {progress.topErrors.length > 0 ? (
            <View style={{ marginBottom: 28 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: "#1E3A5F",
                  marginBottom: 12,
                }}
              >
                {"\u00C0"} améliorer
              </Text>
              <View style={{ gap: 8 }}>
                {progress.topErrors.map((error, idx) => (
                  <TouchableOpacity
                    key={error.id}
                    activeOpacity={0.7}
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
                      style={{
                        backgroundColor: "#FFFFFF",
                        borderRadius: 14,
                        overflow: "hidden",
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.06,
                        shadowRadius: 6,
                        elevation: 3,
                      }}
                    >
                      {/* Amber left strip */}
                      <View
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 4,
                          backgroundColor: "#F5A623",
                        }}
                      />
                      <View
                        style={{
                          paddingLeft: 18,
                          paddingRight: 14,
                          paddingVertical: 14,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ fontSize: 13, color: "#333", flex: 1, lineHeight: 18 }}>
                          {error.error_description}
                        </Text>
                        <View
                          style={{
                            backgroundColor: "#FEF5E7",
                            borderWidth: 1,
                            borderColor: "rgba(245,166,35,0.3)",
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 8,
                            marginLeft: 10,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "700", color: "#F5A623" }}>
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
            <View style={{ marginBottom: 28 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: "#1E3A5F",
                  marginBottom: 12,
                }}
              >
                {"\u00C0"} am{"\u00E9"}liorer
              </Text>
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
                  Aucune erreur d{"\u00E9"}tect{"\u00E9"}e pour le moment.{"\n"}Continuez à
                  pratiquer !
                </Text>
              </View>
            </View>
          )}

          {/* Sign Out */}
          <TouchableOpacity
            onPress={handleSignOut}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 14,
              padding: 16,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#FF3B30",
              marginTop: 8,
            }}
          >
            <Text style={{ color: "#FF3B30", fontWeight: "600", fontSize: 16 }}>
              Se déconnecter
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </>
  );
}
