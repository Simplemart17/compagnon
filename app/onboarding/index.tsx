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

// --- Animated pill for step progress ---

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

// --- Staggered list item wrapper ---

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

// --- Main component ---

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
    <View className="flex-1 bg-surface">
      {/* -- Header -- */}
      <View
        className="bg-primary px-6 pb-7 rounded-b-[28px]"
        style={{
          paddingTop: insets.top + 20,
          // Shadow kept inline -- NativeWind shadow support is limited on native
          shadowColor: "#0D2240",
          shadowOpacity: 0.35,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
        }}
      >
        {/* Brand */}
        <Text className="text-[#FFD180] text-[11px] font-extrabold tracking-[3px] mb-5">
          COMPAGNON
        </Text>

        {/* Step progress pills */}
        <View className="flex-row gap-2 mb-6">
          {STEPS.map((s) => (
            <StepPill key={s} active={s === step} />
          ))}
        </View>

        {/* Step title */}
        <Text className="text-[28px] font-extrabold text-white mb-[6px] leading-[34px]">
          {copy.title}
        </Text>
        <Text className="text-sm text-white/65 leading-5">{copy.subtitle}</Text>
      </View>

      {/* -- Scrollable content -- */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: 24,
          paddingHorizontal: 24,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* -- Step: level -- */}
        {step === "level" && (
          <View className="gap-[10px]">
            {CEFR_ORDER.map((level, index) => {
              const isSelected = selectedLevel === level;
              return (
                <StaggeredItem key={level} index={index} stepKey={step}>
                  <TouchableOpacity
                    onPress={() => setSelectedLevel(level)}
                    activeOpacity={0.75}
                    className="flex-row items-center overflow-hidden"
                    style={{
                      backgroundColor: isSelected ? "#1E3A5F" : "#FFFFFF",
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? "#1E3A5F" : "#E0E0CE",
                      shadowColor: "#1E3A5F",
                      shadowOpacity: isSelected ? 0.18 : 0.05,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: isSelected ? 4 : 1,
                    }}
                  >
                    {/* Amber left accent strip */}
                    {isSelected && (
                      <View className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
                    )}

                    <View
                      className="flex-row items-center gap-3 flex-1 py-4 pr-4"
                      style={{ paddingLeft: isSelected ? 20 : 16 }}
                    >
                      {/* Level color badge */}
                      <View
                        className="px-[10px] py-[5px] rounded-lg min-w-[42px] items-center"
                        style={{ backgroundColor: LEVEL_COLORS[level] }}
                      >
                        <Text className="text-white font-bold text-[13px]">{level}</Text>
                      </View>

                      {/* Name + description */}
                      <View className="flex-1">
                        <Text
                          className="font-bold text-[15px] mb-[2px]"
                          style={{ color: isSelected ? "#FFFFFF" : "#1E3A5F" }}
                        >
                          {CEFR_LEVELS[level].name}
                        </Text>
                        <Text
                          className="text-xs leading-4"
                          numberOfLines={1}
                          style={{
                            color: isSelected ? "rgba(255,255,255,0.65)" : "#999999",
                          }}
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

        {/* -- Step: goal -- */}
        {step === "goal" && (
          <View className="gap-[10px]">
            {GOALS.map((goal, index) => {
              const isSelected = selectedGoal === goal.id;
              return (
                <StaggeredItem key={goal.id} index={index} stepKey={step}>
                  <TouchableOpacity
                    onPress={() => setSelectedGoal(goal.id)}
                    activeOpacity={0.75}
                    className="flex-row items-center overflow-hidden"
                    style={{
                      backgroundColor: isSelected ? "#1E3A5F" : "#FFFFFF",
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? "#1E3A5F" : "#E0E0CE",
                      shadowColor: "#1E3A5F",
                      shadowOpacity: isSelected ? 0.18 : 0.05,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: isSelected ? 4 : 1,
                    }}
                  >
                    {/* Amber left accent strip */}
                    {isSelected && (
                      <View className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
                    )}

                    <View
                      className="flex-row items-center gap-[14px] flex-1 py-4 pr-4"
                      style={{ paddingLeft: isSelected ? 20 : 16 }}
                    >
                      {/* Emoji container */}
                      <View
                        className="w-[44px] h-[44px] rounded-xl justify-center items-center"
                        style={{
                          backgroundColor: isSelected ? "rgba(245,166,35,0.2)" : "rgba(0,0,0,0.05)",
                        }}
                      >
                        <Text className="text-[22px]">{goal.emoji}</Text>
                      </View>

                      <Text
                        className="font-bold text-base flex-1"
                        style={{ color: isSelected ? "#FFFFFF" : "#1E3A5F" }}
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

        {/* -- Step: daily -- */}
        {step === "daily" && (
          <View className="flex-row flex-wrap gap-3">
            {DAILY_OPTIONS.map((opt, index) => {
              const isSelected = selectedMinutes === opt.minutes;
              return (
                <StaggeredItem key={opt.minutes} index={index} stepKey={step}>
                  <TouchableOpacity
                    onPress={() => setSelectedMinutes(opt.minutes)}
                    activeOpacity={0.75}
                    className="items-center overflow-hidden"
                    style={{
                      width: (Dimensions.get("window").width - 48 - 12) / 2,
                      backgroundColor: isSelected ? "#1E3A5F" : "#FFFFFF",
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: isSelected ? "#1E3A5F" : "#E0E0CE",
                      paddingVertical: 24,
                      paddingHorizontal: 16,
                      shadowColor: "#1E3A5F",
                      shadowOpacity: isSelected ? 0.2 : 0.05,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: isSelected ? 5 : 1,
                    }}
                  >
                    {/* Top amber strip on selected */}
                    {isSelected && <View className="absolute top-0 left-0 right-0 h-1 bg-accent" />}

                    <Text
                      className="text-[30px] font-extrabold mb-[6px]"
                      style={{ color: isSelected ? "#F5A623" : "#1E3A5F" }}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      className="text-[13px] font-semibold"
                      style={{
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

      {/* -- Bottom CTA bar -- */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-4 bg-surface border-t border-black/[0.06]"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <TouchableOpacity
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.85}
          className="rounded-xl py-[18px] items-center"
          style={{
            backgroundColor: isFinalStep ? "#F5A623" : "#1E3A5F",
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
            <Text className="text-white text-[17px] font-bold tracking-wide">
              {isFinalStep ? "Passer le test de placement" : "Continuer \u2192"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
