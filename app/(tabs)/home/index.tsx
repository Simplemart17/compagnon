import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Pressable,
  StatusBar,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { CompanionMessage, CompanionMessageSkeleton } from "@/src/components/home/CompanionMessage";
import { ErrorJourneyBar, ErrorJourneyBarSkeleton } from "@/src/components/home/ErrorJourneyBar";
import { TodayPlanItem, TodayPlanSkeleton } from "@/src/components/home/TodayPlanItem";
import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { HeroHeader } from "@/src/components/common/HeroHeader";
import { useDailyBriefing } from "@/src/hooks/use-daily-briefing";
import { useProgress } from "@/src/hooks/use-progress";
import { LEVEL_COLORS, SKILL_LABELS } from "@/src/lib/constants";
import { Colors, Radii, Shadows, Typography } from "@/src/lib/design";
import { ActivityBar } from "@/src/components/common/ActivityBar";
import { Icon } from "@/src/components/common/Icon";
import { useAuthStore } from "@/src/store/auth-store";
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

// Story 13-7: hoisted off the `<AnimatedPressable>` to remove the per-frame
// `className`+`style` merge cost while `animStyle` writes from a Reanimated
// worklet on every press transition. Module-level constant = zero allocations
// per render. Tailwind→inline mapping: bg-primary → Colors.primary;
// rounded-2xl → Radii.card (16); p-4 → padding 16; gap-4 → 16. Shadow tuple
// preserved verbatim from pre-13-7 (does NOT match Shadows.card — a card-
// specific elevated tone).
/**
 * @internal — exported for Story 13-7 runtime tests; do NOT import in app code.
 *
 * Frozen at module-load (review-round-1 P2) so a debug session, runtime A/B
 * test, or future theming code path can't mutate this object and silently
 * change EVERY ConversationCard instance for the rest of the JS session.
 * Mirror of Story 12-1's `Object.freeze({...})` getState() defense.
 */
export const conversationCardStaticStyle: ViewStyle = Object.freeze({
  backgroundColor: Colors.primary,
  borderRadius: Radii.card,
  padding: 16,
  flexDirection: "row",
  alignItems: "center",
  gap: 16,
  shadowColor: Colors.primary,
  shadowOffset: { width: 0, height: 4 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
  shadowOpacity: 0.25, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke colored CTA shadow tone preserved verbatim by Story 13-7 P22
  shadowRadius: 12, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with bespoke colored CTA shadow above
  elevation: 6,
}) as ViewStyle;

/** @internal — exported for Story 13-7 runtime tests; do NOT import in app code. */
export function ConversationCard({ onPress }: ConversationCardProps) {
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
      style={[conversationCardStaticStyle, animStyle]}
    >
      {/* Mic icon circle */}
      <View
        className="w-[52px] h-[52px] rounded-full justify-center items-center"
        style={{
          backgroundColor: Colors.accent20,
          borderWidth: 1.5,
          borderColor: Colors.accent50,
        }}
      >
        <Icon name="mic" size={24} color={Colors.accent} />
      </View>

      {/* Text content */}
      <View className="flex-1">
        <Text className="text-white font-bold text-base">Talk with Companion</Text>
        <Text className="text-[13px] mt-[3px]" style={{ color: Colors.textOnDarkMuted }}>
          Real-time conversation with your AI
        </Text>
      </View>

      {/* Arrow pill */}
      <View
        className="rounded-2xl w-8 h-8 justify-center items-center"
        style={{
          backgroundColor: Colors.accent25,
          borderWidth: 1,
          borderColor: Colors.accent50,
        }}
      >
        <Icon name="chevron-right" size={18} color={Colors.accent} />
      </View>
    </AnimatedPressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const progress = useProgress();
  const briefing = useDailyBriefing();
  const [refreshing, setRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? true);
    });
    return unsubscribe;
  }, []);

  const handlePlanItemPress = useCallback(
    (route: string, params?: Record<string, string>) => {
      router.push({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes limitation
        pathname: route as any,
        params,
      });
    },
    [router]
  );

  const level = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const dailyGoal = profile?.daily_goal_minutes ?? 15;
  const minutesToday = progress.todayActivity?.minutes_practiced ?? 0;
  const goalPercent = Math.min(100, Math.round((minutesToday / dailyGoal) * 100));

  const refreshProgress = progress.refresh;
  const refreshBriefing = briefing.refresh;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshProgress(), refreshBriefing()]);
    setRefreshing(false);
  }, [refreshProgress, refreshBriefing]);

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
        {/* Story 14-9: skeleton hero via canonical HeroHeader (defaults: paddingTopOffset=16, paddingBottom=24) */}
        <HeroHeader>
          <SkeletonBar width={80} height={10} style={{ marginBottom: 14 }} />
          <SkeletonBar width={200} height={28} style={{ marginBottom: 12 }} />
          <View className="flex-row gap-2 mb-4">
            <SkeletonBar width={40} height={24} style={{ borderRadius: 20 }} />
            <SkeletonBar width={60} height={24} style={{ borderRadius: 20 }} />
          </View>
          <SkeletonBar width="100%" height={4} />
        </HeroHeader>
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
      {/* Hero header -- fixed, not scrollable.                                */}
      {/* Story 14-9: canonical HeroHeader (defaults: paddingTopOffset=16,    */}
      {/* paddingBottom=24); Shadows.hero applied internally by the component. */}
      {/* ------------------------------------------------------------------ */}
      <HeroHeader>
        {/* Row 1: brand label + notification bell */}
        <View className="flex-row justify-between items-center mb-[14px]">
          <Text className="text-[10px] font-bold text-accent tracking-[3px]">COMPANION</Text>
          <View
            className="w-[34px] h-[34px] rounded-full justify-center items-center"
            style={{
              backgroundColor: Colors.accent15,
              borderWidth: 1,
              borderColor: Colors.accent30,
            }}
          >
            <Icon name="bell" size={16} color={Colors.accent} />
          </View>
        </View>

        {/* Row 2: greeting */}
        <Text className="text-[28px] font-extrabold text-white mb-3">
          Hello{firstName ? `, ${firstName}` : ""}!
        </Text>

        {/* Row 3: chips */}
        <View className="flex-row items-center gap-2 mb-4 flex-wrap">
          {/* CEFR level pill */}
          <View
            className="px-[10px] py-1 rounded-full"
            style={{ borderWidth: 1.5, borderColor: Colors.accent }}
            accessibilityLabel={`Current level: ${level}`}
          >
            <Text className="text-accent font-bold text-[13px]">{level}</Text>
          </View>

          {/* Streak chip \u2014 Story 14-5 streak-cluster (informational chrome, NOT tappable).
              Text color uses Colors.streak (base hue, NOT streakText) because the chip
              renders on a DARK composite (home hero bgDark) where streakText's dark-brown
              (#92400E) gives ~1.59:1 contrast (fails WCAG AA). Colors.streak (#F59E0B)
              on the same composite gives ~8:1 (passes AA). streakText is reserved for
              text-on-LIGHT-bg only per Story 14-5 R1-P2. */}
          {progress.streakDays > 0 && (
            <View
              className="flex-row items-center px-[9px] py-1 rounded-full gap-1"
              style={{ backgroundColor: Colors.streak20 }}
              accessibilityLabel={`${progress.streakDays} day streak`}
            >
              <Icon name="zap" size={13} color={Colors.streak} />
              <Text className="text-xs font-bold" style={{ color: Colors.streak }}>
                {progress.streakDays}j
              </Text>
            </View>
          )}

          {/* Target pill */}
          <View
            className="flex-row items-center px-[9px] py-1 rounded-full gap-1"
            style={{ backgroundColor: Colors.whiteAlpha12 }}
            accessibilityLabel={`Target level: ${targetLevel}`}
          >
            <Text className="text-[11px]" style={{ color: Colors.textOnDarkSecondary }}>
              Target
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
          <View className="h-1 rounded-sm" style={{ backgroundColor: Colors.whiteAlpha20 }}>
            <View
              className="h-1 rounded-sm"
              style={{
                // Story 14-5 R1-P1: daily-goal progress bar is non-interactive
                // data feedback → Colors.progress (not Colors.accent which is
                // now CTA-cluster-only). Completed state stays on Colors.success.
                backgroundColor: goalPercent >= 100 ? Colors.success : Colors.progress,
                width: `${goalPercent}%`,
              }}
            />
          </View>
          <Text
            className="text-[11px] mt-[5px] text-right"
            style={{ color: Colors.textOnDarkMuted }}
          >
            {minutesToday}/{dailyGoal} min
          </Text>
        </View>
      </HeroHeader>

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
              backgroundColor: Colors.error10,
              borderWidth: 1,
              borderColor: Colors.error25,
            }}
          >
            <Text className="text-[13px] text-error flex-1 leading-[18px]">{progress.error}</Text>
            <Text className="text-xs text-error font-semibold">Dismiss</Text>
          </TouchableOpacity>
        )}

        {/* ---- Companion Message ---- */}
        {briefing.isLoading ? (
          <View className="mb-4 mt-2">
            <CompanionMessageSkeleton />
          </View>
        ) : briefing.companionMessage ? (
          <View className="mb-4 mt-2">
            <CompanionMessage message={briefing.companionMessage} />
          </View>
        ) : null}

        {/* ---- Hero conversation CTA ---- */}
        <Animated.View style={cardEntryStyle} className="mt-5">
          <ConversationCard onPress={() => router.push("/(tabs)/conversation")} />
        </Animated.View>

        {/* ---- Today's Plan section ---- */}
        {briefing.isLoading ? (
          <Animated.View style={cardEntryStyle} className="mt-5">
            <Text style={Typography.sectionHeader} className="mb-3" accessibilityRole="header">
              Today
            </Text>
            <TodayPlanSkeleton />
          </Animated.View>
        ) : briefing.todayPlan.length > 0 ? (
          <Animated.View style={cardEntryStyle} className="mt-5">
            <Text style={Typography.sectionHeader} className="mb-3" accessibilityRole="header">
              Today
            </Text>
            <View style={{ gap: 8 }}>
              {briefing.todayPlan.map((item) => (
                <TodayPlanItem
                  key={item.id}
                  title={item.title}
                  subtitle={item.subtitle}
                  iconColor={item.iconColor}
                  iconName={item.iconName}
                  badge={item.badge}
                  disabled={!isConnected && !item.offlineCapable}
                  onPress={() => handlePlanItemPress(item.route, item.params)}
                />
              ))}
            </View>
          </Animated.View>
        ) : briefing.error ? (
          <Animated.View style={cardEntryStyle} className="mt-5">
            <Text style={Typography.sectionHeader} className="mb-3" accessibilityRole="header">
              Today
            </Text>
            <TouchableOpacity
              onPress={briefing.refresh}
              accessibilityRole="button"
              accessibilityLabel="Failed to load plan. Tap to retry."
              activeOpacity={0.7}
              className="rounded-xl p-4 items-center"
              style={{
                backgroundColor: Colors.error10,
                borderWidth: 1,
                borderColor: Colors.error25,
              }}
            >
              <Text
                className="text-[13px] text-center leading-[19px]"
                style={{ color: Colors.error }}
              >
                Could not load the plan. Tap to retry.
              </Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        {/* ---- Error Journey section ---- */}
        {briefing.isLoading ? (
          <Animated.View style={cardEntryStyle} className="mt-5">
            <ErrorJourneyBarSkeleton />
          </Animated.View>
        ) : briefing.totalErrors > 0 ? (
          <Animated.View style={cardEntryStyle} className="mt-5">
            <ErrorJourneyBar total={briefing.totalErrors} resolved={briefing.resolvedErrors} />
          </Animated.View>
        ) : null}

        {/* ---- Skills overview section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text
            className="text-lg font-bold text-primary mt-7 mb-[10px]"
            accessibilityRole="header"
          >
            My skills
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
                  accessibilityLabel={`${SKILL_LABELS[skill.skill]?.en ?? skill.skill}: level ${skill.cefr_level}`}
                  className="bg-white rounded-xl px-3 py-2 flex-row items-center gap-2"
                  style={{
                    borderWidth: 1,
                    borderColor: Colors.borderOnDark,
                    ...Shadows.subtle,
                  }}
                >
                  <Text className="text-xs" style={{ color: Colors.gray700 }}>
                    {SKILL_LABELS[skill.skill]?.en}
                  </Text>
                  <View
                    className="px-[6px] py-[2px] rounded-md"
                    style={{
                      backgroundColor:
                        LEVEL_COLORS[skill.cefr_level as CEFRLevel] ?? Colors.gray500,
                    }}
                  >
                    <Text className="text-white text-[10px] font-bold">{skill.cefr_level}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View
              className="bg-white rounded-2xl p-5 items-center"
              style={{
                borderWidth: 1,
                borderColor: Colors.primary8,
              }}
            >
              <Text
                className="text-[13px] text-center leading-[19px]"
                style={{ color: Colors.textTertiary }}
              >
                Start an exercise or conversation to{"\n"}see your skills here.
              </Text>
            </View>
          )}
        </Animated.View>

        {/* ---- Weekly activity section ---- */}
        <Animated.View style={cardEntryStyle}>
          <Text className="text-lg font-bold text-primary mt-7 mb-3" accessibilityRole="header">
            Cette semaine
          </Text>
          {progress.recentActivity.length > 1 ? (
            <View className="bg-white rounded-2xl p-4" style={Shadows.card}>
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
                    const dayLabel = new Date(day.date).toLocaleDateString("en", {
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
              className="bg-white rounded-2xl p-5 items-center"
              style={{
                borderWidth: 1,
                borderColor: Colors.primary8,
              }}
            >
              <Text
                className="text-[13px] text-center leading-[19px]"
                style={{ color: Colors.textTertiary }}
              >
                Practice daily to see your{"\n"}weekly activity here.
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
