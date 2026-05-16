/**
 * Post-Onboarding Tour — 30-second 3-card guided "what Companion does" intro.
 *
 * Shown ONCE between onboarding completion (via `app/onboarding/index.tsx` or
 * `app/onboarding/placement-test.tsx`) and the first home-screen render. The
 * routing guard at `app/_layout.tsx` carves out the `/onboarding/tour` route
 * so onboarded users can reach it (`inTour` segment check).
 *
 * v1 doesn't track tour_completed separately — if the user kills the app
 * mid-tour, they miss it (acceptable: tour content is non-critical context).
 * A future story (14-6-followup-replay-tour-from-settings) can add a
 * "View tour" entry-point.
 *
 * Story 14-6 — Epic 14 deliverable line 275 + Epic 14 AC line 281.
 */

import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

import { Colors, Typography } from "@/src/lib/design";
import { hapticLight, hapticMedium } from "@/src/lib/haptics";
import { addBreadcrumb } from "@/src/lib/sentry";
import { Icon, type IconName } from "@/src/components/common/Icon";

// ---------------------------------------------------------------------------
// Tour card content
// ---------------------------------------------------------------------------

/** @internal — exported for runtime + drift tests. */
export interface TourCard {
  headline: string;
  body: string;
  iconName: IconName;
  /** Background tint for the icon halo (Card-specific accent). */
  iconBackgroundColor: string;
}

/**
 * @internal — exported for runtime + drift tests. Spec-recommended copy per
 * Story 14-6 Q1; operator can override individual fields without changing the
 * 3-card sequence (Story 14-3 Icon system + Story 14-5 streak-cluster reuse
 * on Card 3 — `Colors.streak15` "warmth of goal-achievement" close).
 */
export const TOUR_CARDS: readonly TourCard[] = [
  {
    headline: "Talk to your AI tutor every day",
    body: "Have real French conversations with an AI that remembers what you've learned and adapts to your level.",
    iconName: "mic",
    iconBackgroundColor: Colors.primary15,
  },
  {
    headline: "Practice in 8 different ways",
    body: "Listening, reading, writing, dictation, echo, translation, pronunciation, vocabulary — exercises that match your CEFR level.",
    iconName: "book-open",
    iconBackgroundColor: Colors.success15,
  },
  {
    headline: "Take TCF-style practice tests",
    body: "Time-locked simulations that mirror the real exam. See your score, track your progress, identify weak spots.",
    iconName: "award",
    iconBackgroundColor: Colors.streak15,
  },
] as const;

/** @internal — Reanimated transition duration (half-fade + half-fade-in). */
export const TOUR_TRANSITION_HALF_MS = 125;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DotPaginationProps {
  count: number;
  activeIndex: number;
  onDotPress: (index: number) => void;
}

function DotPagination({ count, activeIndex, onDotPress }: DotPaginationProps) {
  return (
    <View className="flex-row items-center justify-center gap-2" accessibilityRole="tablist">
      {Array.from({ length: count }).map((_, idx) => {
        const isActive = idx === activeIndex;
        return (
          <Pressable
            key={idx}
            onPress={() => onDotPress(idx)}
            hitSlop={{ top: 18, bottom: 18, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Go to tour card ${idx + 1}`}
            accessibilityState={{ selected: isActive }}
          >
            <View
              style={{
                height: 8,
                width: isActive ? 24 : 8,
                borderRadius: 4,
                backgroundColor: isActive ? Colors.accent : Colors.primary15,
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function TourScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Reanimated entry/exit transform — fade-out + slide-left → fade-in from right
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);

  // Sentry breadcrumb on each card view — operators can grep "Tour card viewed"
  // to measure drop-off rate per card (no PII; only `cardIndex` integer).
  useEffect(() => {
    addBreadcrumb({
      category: "tour",
      level: "info",
      message: "Tour card viewed",
      data: { cardIndex: currentIndex },
    });
  }, [currentIndex]);

  const finishTour = useCallback(() => {
    hapticMedium();
    router.replace("/(tabs)/home");
  }, [router]);

  const skipTour = useCallback(() => {
    hapticLight();
    router.replace("/(tabs)/home");
  }, [router]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  /**
   * Advance to `nextIndex` with an in-only fade + slide-from-right animation.
   *
   * Implementation: sync-setState the new index (so the new card content is
   * already mounted) + reset opacity to 0 + translateX to +20pt, then animate
   * back to opacity=1 + translateX=0 over `TOUR_TRANSITION_HALF_MS * 2 = 250ms`.
   * The visual effect: new card fades in from the right.
   *
   * The simpler in-only animation (vs. a 2-phase fade-out-then-fade-in) keeps
   * the state change synchronous + testable under the canonical Reanimated
   * mock (which collapses `withSequence` callbacks to identity). See
   * `src/test-utils/mocks/reanimated.ts` scope note.
   */
  const animateToIndex = useCallback(
    (nextIndex: number) => {
      if (nextIndex === currentIndex) return;
      setCurrentIndex(nextIndex);
      // Reset to off-right + invisible, then animate in
      opacity.value = 0;
      translateX.value = 20;
      opacity.value = withTiming(1, { duration: TOUR_TRANSITION_HALF_MS * 2 });
      translateX.value = withTiming(0, { duration: TOUR_TRANSITION_HALF_MS * 2 });
    },
    [currentIndex, opacity, translateX]
  );

  const handleNextPress = useCallback(() => {
    if (currentIndex < TOUR_CARDS.length - 1) {
      hapticLight();
      animateToIndex(currentIndex + 1);
    } else {
      finishTour();
    }
  }, [currentIndex, animateToIndex, finishTour]);

  const handleDotPress = useCallback(
    (idx: number) => {
      hapticLight();
      animateToIndex(idx);
    },
    [animateToIndex]
  );

  const currentCard = TOUR_CARDS[currentIndex];
  const isFinalCard = currentIndex === TOUR_CARDS.length - 1;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        {/* Skip button — top-right */}
        <View className="flex-row justify-end px-5 pt-2">
          <Pressable
            onPress={skipTour}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
            accessibilityHint="Double tap to skip the tour and go to home"
          >
            <Text
              style={{
                ...Typography.body,
                color: Colors.textSecondary,
                fontWeight: "600",
              }}
            >
              Skip
            </Text>
          </Pressable>
        </View>

        {/* Animated card content */}
        <Reanimated.View
          style={[{ flex: 1, justifyContent: "center", paddingHorizontal: 28 }, animatedCardStyle]}
        >
          {/* Icon halo */}
          <View
            className="items-center justify-center self-center mb-8 rounded-full"
            style={{
              width: 120,
              height: 120,
              backgroundColor: currentCard.iconBackgroundColor,
            }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Icon name={currentCard.iconName} size={56} color={Colors.primary} />
          </View>

          {/* Headline */}
          <Text
            style={{
              ...Typography.screenTitle,
              color: Colors.textPrimary,
              textAlign: "center",
              marginBottom: 16,
            }}
            accessibilityRole="header"
          >
            {currentCard.headline}
          </Text>

          {/* Body */}
          <Text
            style={{
              ...Typography.body,
              color: Colors.textSecondary,
              textAlign: "center",
              lineHeight: 24,
            }}
          >
            {currentCard.body}
          </Text>
        </Reanimated.View>

        {/* Pagination + CTA — bottom-anchored */}
        <View className="px-6 pb-6 gap-6">
          <DotPagination
            count={TOUR_CARDS.length}
            activeIndex={currentIndex}
            onDotPress={handleDotPress}
          />

          <Pressable
            onPress={handleNextPress}
            accessibilityRole="button"
            accessibilityLabel={isFinalCard ? "Get started" : "Next card"}
            accessibilityHint={
              isFinalCard
                ? "Double tap to finish the tour and go to home"
                : "Double tap to view the next tour card"
            }
            className="rounded-2xl py-[18px] items-center"
            style={{ backgroundColor: Colors.accent }}
          >
            <Text
              style={{
                ...Typography.body,
                color: Colors.textOnDark,
                fontWeight: "700",
                fontSize: 17,
              }}
            >
              {isFinalCard ? "Get started" : "Next"}
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}
