import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";

import { useAuth } from "@/src/hooks/use-auth";
import { CEFR_ORDER, CEFR_LEVELS } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";
import { LEVEL_COLORS } from "@/src/lib/constants";

type Step = "level" | "goal" | "daily";

const STEPS: Step[] = ["level", "goal", "daily"];

const GOALS = [
  { id: "tcf_c1", label: "Pass TCF at C1", emoji: "🎯" },
  { id: "tcf_c2", label: "Pass TCF at C2", emoji: "🏆" },
  { id: "travel", label: "Travel in France", emoji: "✈️" },
  { id: "work", label: "Work in France", emoji: "💼" },
  { id: "study", label: "Study in France", emoji: "🎓" },
  { id: "general", label: "General fluency", emoji: "🗣️" },
];

const DAILY_OPTIONS = [
  { minutes: 5, label: "5 min", subtitle: "Casual" },
  { minutes: 10, label: "10 min", subtitle: "Regular" },
  { minutes: 15, label: "15 min", subtitle: "Committed" },
  { minutes: 30, label: "30 min", subtitle: "Intensive" },
];

const STEP_COPY: Record<Step, { title: string; subtitle: string }> = {
  level: {
    title: "Votre niveau actuel",
    subtitle: "We'll calibrate precisely with a placement test after.",
  },
  goal: {
    title: "Quel est votre objectif ?",
    subtitle: "This helps us tailor your personal learning path.",
  },
  daily: {
    title: "Objectif quotidien",
    subtitle: "Consistency matters more than duration. You can change this later.",
  },
};

// ─── Animated pill for step progress ──────────────────────────────────────────

interface StepPillProps {
  active: boolean;
}

function StepPill({ active }: StepPillProps) {
  const width = useSharedValue(active ? 80 : 32);

  useEffect(() => {
    width.value = withTiming(active ? 80 : 32, {
      duration: 350,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: width.value,
  }));

  return (
    <Animated.View
      style={[
        {
          height: 6,
          borderRadius: 3,
          backgroundColor: active ? "#F5A623" : "rgba(255,255,255,0.25)",
        },
        animatedStyle,
      ]}
    />
  );
}

// ─── Staggered list item wrapper ──────────────────────────────────────────────

interface StaggeredItemProps {
  index: number;
  stepKey: Step;
  children: React.ReactNode;
}

function StaggeredItem({ index, stepKey, children }: StaggeredItemProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    opacity.value = 0;
    translateY.value = 16;
    opacity.value = withDelay(
      index * 55,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) })
    );
    translateY.value = withDelay(
      index * 55,
      withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) })
    );
  }, [stepKey, index, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useAuth();
  const [step, setStep] = useState<Step>("level");
  const [selectedLevel, setSelectedLevel] = useState<CEFRLevel>("A1");
  const [selectedGoal, setSelectedGoal] = useState("tcf_c1");
  const [selectedMinutes, setSelectedMinutes] = useState(15);
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    setLoading(true);
    const targetLevel = selectedGoal === "tcf_c2" ? "C2" : "C1";
    const { error } = await updateProfile({
      current_cefr_level: selectedLevel,
      target_cefr_level: targetLevel as CEFRLevel,
      daily_goal_minutes: selectedMinutes,
    });
    setLoading(false);

    if (error) {
      Alert.alert("Error", "Failed to save your preferences. Please try again.");
      return;
    }

    router.push("/onboarding/placement-test");
  }

  const isFinalStep = step === "daily";

  function handleContinue() {
    if (step === "level") {
      setStep("goal");
    } else if (step === "goal") {
      setStep("daily");
    } else {
      void handleComplete();
    }
  }

  const copy = STEP_COPY[step];

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          paddingTop: insets.top + 20,
          paddingHorizontal: 24,
          paddingBottom: 28,
          borderBottomLeftRadius: 40,
          borderBottomRightRadius: 40,
          // Simulate depth with shadow
          shadowColor: "#0D2240",
          shadowOpacity: 0.35,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        {/* Brand */}
        <Text
          style={{
            color: "#F5A623",
            fontSize: 11,
            fontWeight: "800",
            letterSpacing: 3,
            marginBottom: 20,
          }}
        >
          COMPAGNON
        </Text>

        {/* Step progress pills */}
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            marginBottom: 24,
          }}
        >
          {STEPS.map((s) => (
            <StepPill key={s} active={s === step} />
          ))}
        </View>

        {/* Step title */}
        <Text
          style={{
            fontSize: 28,
            fontWeight: "800",
            color: "#FFFFFF",
            marginBottom: 6,
            lineHeight: 34,
          }}
        >
          {copy.title}
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.65)",
            lineHeight: 20,
          }}
        >
          {copy.subtitle}
        </Text>
      </View>

      {/* ── Scrollable content ───────────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 24,
          paddingHorizontal: 20,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Step: level ───────────────────────────────────────────────────── */}
        {step === "level" && (
          <View style={{ gap: 10 }}>
            {CEFR_ORDER.map((level, index) => {
              const isSelected = selectedLevel === level;
              return (
                <StaggeredItem key={level} index={index} stepKey={step}>
                  <TouchableOpacity
                    onPress={() => setSelectedLevel(level)}
                    activeOpacity={0.75}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: isSelected ? "#1E3A5F" : "#FFFFFF",
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? "#1E3A5F" : "#E0E0CE",
                      overflow: "hidden",
                      // Card shadow
                      shadowColor: "#1E3A5F",
                      shadowOpacity: isSelected ? 0.18 : 0.05,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: isSelected ? 4 : 1,
                    }}
                  >
                    {/* Amber left accent strip */}
                    {isSelected && (
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
                    )}

                    <View
                      style={{
                        paddingVertical: 16,
                        paddingLeft: isSelected ? 20 : 16,
                        paddingRight: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        flex: 1,
                      }}
                    >
                      {/* Level color badge */}
                      <View
                        style={{
                          backgroundColor: LEVEL_COLORS[level],
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 8,
                          minWidth: 42,
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontWeight: "700",
                            fontSize: 13,
                          }}
                        >
                          {level}
                        </Text>
                      </View>

                      {/* Name + description */}
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontWeight: "700",
                            fontSize: 15,
                            color: isSelected ? "#FFFFFF" : "#1E3A5F",
                            marginBottom: 2,
                          }}
                        >
                          {CEFR_LEVELS[level].name}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: isSelected ? "rgba(255,255,255,0.65)" : "#999999",
                            lineHeight: 16,
                          }}
                          numberOfLines={1}
                        >
                          {CEFR_LEVELS[level].description}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                </StaggeredItem>
              );
            })}
          </View>
        )}

        {/* ── Step: goal ────────────────────────────────────────────────────── */}
        {step === "goal" && (
          <View style={{ gap: 10 }}>
            {GOALS.map((goal, index) => {
              const isSelected = selectedGoal === goal.id;
              return (
                <StaggeredItem key={goal.id} index={index} stepKey={step}>
                  <TouchableOpacity
                    onPress={() => setSelectedGoal(goal.id)}
                    activeOpacity={0.75}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: isSelected ? "#1E3A5F" : "#FFFFFF",
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? "#1E3A5F" : "#E0E0CE",
                      overflow: "hidden",
                      shadowColor: "#1E3A5F",
                      shadowOpacity: isSelected ? 0.18 : 0.05,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: isSelected ? 4 : 1,
                    }}
                  >
                    {/* Amber left accent strip */}
                    {isSelected && (
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
                    )}

                    <View
                      style={{
                        paddingVertical: 16,
                        paddingLeft: isSelected ? 20 : 16,
                        paddingRight: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 14,
                        flex: 1,
                      }}
                    >
                      {/* Emoji container */}
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          backgroundColor: isSelected ? "rgba(245,166,35,0.2)" : "rgba(0,0,0,0.05)",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ fontSize: 22 }}>{goal.emoji}</Text>
                      </View>

                      <Text
                        style={{
                          fontWeight: "700",
                          fontSize: 16,
                          color: isSelected ? "#FFFFFF" : "#1E3A5F",
                          flex: 1,
                        }}
                      >
                        {goal.label}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </StaggeredItem>
              );
            })}
          </View>
        )}

        {/* ── Step: daily ───────────────────────────────────────────────────── */}
        {step === "daily" && (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            {DAILY_OPTIONS.map((opt, index) => {
              const isSelected = selectedMinutes === opt.minutes;
              return (
                <StaggeredItem key={opt.minutes} index={index} stepKey={step}>
                  <TouchableOpacity
                    onPress={() => setSelectedMinutes(opt.minutes)}
                    activeOpacity={0.75}
                    style={{
                      width: (Dimensions.get("window").width - 40 - 12) / 2,
                      backgroundColor: isSelected ? "#1E3A5F" : "#FFFFFF",
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: isSelected ? "#1E3A5F" : "#E0E0CE",
                      paddingVertical: 24,
                      paddingHorizontal: 16,
                      alignItems: "center",
                      overflow: "hidden",
                      shadowColor: "#1E3A5F",
                      shadowOpacity: isSelected ? 0.2 : 0.05,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: isSelected ? 5 : 1,
                    }}
                  >
                    {/* Top amber strip on selected */}
                    {isSelected && (
                      <View
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: 4,
                          backgroundColor: "#F5A623",
                        }}
                      />
                    )}

                    <Text
                      style={{
                        fontSize: 30,
                        fontWeight: "800",
                        color: isSelected ? "#F5A623" : "#1E3A5F",
                        marginBottom: 6,
                      }}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: isSelected ? "rgba(255,255,255,0.75)" : "#999999",
                      }}
                    >
                      {opt.subtitle}
                    </Text>
                  </TouchableOpacity>
                </StaggeredItem>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Bottom CTA bar ───────────────────────────────────────────────────── */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 16,
          paddingTop: 16,
          backgroundColor: "#F5F5F0",
          // Top border fade
          borderTopWidth: 1,
          borderTopColor: "rgba(0,0,0,0.06)",
        }}
      >
        <TouchableOpacity
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.85}
          style={{
            backgroundColor: isFinalStep ? "#F5A623" : "#1E3A5F",
            borderRadius: 16,
            paddingVertical: 18,
            alignItems: "center",
            opacity: loading ? 0.7 : 1,
            shadowColor: "#1E3A5F",
            shadowOpacity: 0.2,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 17,
                fontWeight: "700",
                letterSpacing: 0.3,
              }}
            >
              {isFinalStep ? "Passer le test de placement" : "Continuer →"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
