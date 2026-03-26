/**
 * Vocabulary Review Screen
 *
 * Shows the user's saved vocabulary words with spaced repetition review.
 * Two views: "Review" for due cards and "All Words" for full list with search.
 * Uses SM-2 algorithm from src/lib/srs.ts to schedule reviews.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  TextInput,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";

import {
  cacheWithFallback,
  invalidateCache,
  enqueueWrite,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/src/lib/cache";
import { isOnline } from "@/src/lib/network";
import { captureError } from "@/src/lib/sentry";
import { useAuthStore } from "@/src/store/auth-store";
import { supabase } from "@/src/lib/supabase";
import { LEVEL_COLORS } from "@/src/lib/constants";
import { Colors, Typography } from "@/src/lib/design";
import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { calculateNextReview } from "@/src/lib/srs";
import type { ReviewQuality, SRSState } from "@/src/lib/srs";
import type { CEFRLevel } from "@/src/types/cefr";

/** Shape of a vocabulary row from Supabase */
interface VocabWord {
  id: string;
  user_id: string;
  french_word: string;
  english_translation: string;
  context_sentence: string | null;
  cefr_level: CEFRLevel;
  phonetic: string | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string;
}

type TabView = "review" | "all";

/** Rating buttons shown on the review card */
const RATING_OPTIONS: { label: string; quality: ReviewQuality; color: string }[] = [
  { label: "Forgot", quality: 0, color: Colors.error },
  { label: "Hard", quality: 2, color: Colors.skillWriting },
  { label: "Good", quality: 4, color: Colors.skillListening },
  { label: "Easy", quality: 5, color: Colors.success },
];

/** Skeleton loading screen for vocabulary */
function VocabSkeleton() {
  return (
    <View className="flex-1 bg-surface p-5">
      {/* Tab bar skeleton */}
      <View className="flex-row mb-4 bg-surface-300 rounded-xl p-1">
        <View className="flex-1 py-2.5 rounded-[10px] items-center bg-white">
          <SkeletonBar width={80} height={14} />
        </View>
        <View className="flex-1 py-2.5 rounded-[10px] items-center">
          <SkeletonBar width={90} height={14} />
        </View>
      </View>

      {/* Progress skeleton */}
      <SkeletonBar width={100} height={14} style={{ marginBottom: 12 }} />
      <SkeletonBar width="100%" height={4} style={{ marginBottom: 24 }} />

      {/* Flashcard skeleton */}
      <View
        className="bg-white rounded-[20px] border border-surface-300 p-8 justify-center items-center"
        style={{ minHeight: 280 }}
      >
        <SkeletonBar width={160} height={32} style={{ marginBottom: 8 }} />
        <SkeletonBar width={100} height={16} style={{ marginBottom: 24 }} />
        <SkeletonBar width={140} height={14} />
      </View>

      {/* Rating buttons skeleton */}
      <View className="flex-row gap-2 mt-6">
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            className="flex-1 rounded-xl py-3.5 items-center"
            style={{ backgroundColor: Colors.gray200 }}
          >
            <SkeletonBar width={40} height={14} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function VocabularyScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<TabView>("review");
  const [words, setWords] = useState<VocabWord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Review state
  const [dueWords, setDueWords] = useState<VocabWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  // Track whether data is from cache so we can show an indicator
  const [isOfflineData, setIsOfflineData] = useState(false);

  /** Fetch all vocabulary for the user, with cache fallback for offline use */
  const fetchVocabulary = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data: vocabulary, fromCache } = await cacheWithFallback<VocabWord[]>(
        user.id,
        CACHE_KEYS.VOCABULARY,
        async () => {
          const { data, error } = await supabase
            .from("vocabulary")
            .select("*")
            .eq("user_id", user.id)
            .order("cefr_level", { ascending: true })
            .order("french_word", { ascending: true });

          if (error) throw error;
          return (data ?? []) as VocabWord[];
        },
        CACHE_TTL.VOCABULARY
      );

      const words = vocabulary ?? [];
      setWords(words);
      setIsOfflineData(fromCache);

      // Filter words due for review
      const now = new Date();
      const due = words.filter((w) => new Date(w.next_review) <= now);
      setDueWords(due);
      setCurrentIndex(0);
      setIsRevealed(false);
      setReviewedCount(0);
    } catch (err) {
      captureError(err, "fetch-vocabulary");
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchVocabulary().finally(() => setIsLoading(false));
  }, [fetchVocabulary]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchVocabulary();
    setRefreshing(false);
  }, [fetchVocabulary]);

  /** Rate a word and update Supabase with the new SRS values.
   *  If offline, queue the write for later retry. */
  const handleRate = useCallback(
    async (quality: ReviewQuality) => {
      const word = dueWords[currentIndex];
      if (!word || isUpdating || !user?.id) return;

      setIsUpdating(true);

      const currentState: SRSState = {
        easeFactor: word.ease_factor,
        intervalDays: word.interval_days,
        repetitions: word.repetitions,
      };

      const update = calculateNextReview(currentState, quality);

      const updatePayload = {
        ease_factor: update.easeFactor,
        interval_days: update.intervalDays,
        repetitions: update.repetitions,
        next_review: update.nextReview.toISOString(),
      };

      const online = await isOnline();
      if (online) {
        const { error } = await supabase.from("vocabulary").update(updatePayload).eq("id", word.id);

        if (error) {
          captureError(error, "update-vocabulary-srs");
        }
      } else {
        // Queue the write for when network returns
        await enqueueWrite({
          table: "vocabulary",
          operation: "update",
          payload: updatePayload,
          filter: { column: "id", value: word.id },
        });
      }

      // Invalidate vocabulary cache so next fetch gets fresh data
      void invalidateCache(user.id, CACHE_KEYS.VOCABULARY);

      // Optimistically update local state so the word is no longer "due"
      const updatedWord: VocabWord = {
        ...word,
        ease_factor: update.easeFactor,
        interval_days: update.intervalDays,
        repetitions: update.repetitions,
        next_review: update.nextReview.toISOString(),
      };
      setWords((prev) => prev.map((w) => (w.id === word.id ? updatedWord : w)));

      setIsUpdating(false);
      setIsRevealed(false);
      setReviewedCount((prev) => prev + 1);

      if (currentIndex < dueWords.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        // All due words reviewed -- refresh the list
        await fetchVocabulary();
      }
    },
    [currentIndex, dueWords, isUpdating, user?.id, fetchVocabulary]
  );

  /** Format a relative date for display */
  const formatNextReview = useCallback((dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "Due now";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays < 7) return `In ${diffDays} days`;
    if (diffDays < 30) return `In ${Math.ceil(diffDays / 7)} weeks`;
    return `In ${Math.ceil(diffDays / 30)} months`;
  }, []);

  /** Filter words for the "All Words" search */
  const filteredWords = useMemo(
    () =>
      searchQuery.trim()
        ? words.filter(
            (w) =>
              w.french_word.toLowerCase().includes(searchQuery.toLowerCase()) ||
              w.english_translation.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : words,
    [words, searchQuery]
  );

  // ---------- FlatList helpers (must be declared before any early returns) ----------
  const vocabKeyExtractor = useCallback((item: VocabWord) => item.id, []);

  const renderVocabItem = useCallback(
    ({ item }: { item: VocabWord }) => {
      const isDue = new Date(item.next_review) <= new Date();
      return (
        <View
          className="bg-white rounded-[14px] p-4 flex-row items-center gap-3 mb-2.5"
          style={{
            borderWidth: 1,
            borderColor: isDue ? Colors.accent : Colors.border,
          }}
        >
          {/* CEFR badge */}
          <View
            className="rounded-lg px-2 py-1 items-center"
            style={{
              backgroundColor: LEVEL_COLORS[item.cefr_level] ?? Colors.gray500,
              minWidth: 36,
            }}
          >
            <Text className="text-[11px] font-bold text-white">{item.cefr_level}</Text>
          </View>

          {/* Word details */}
          <View className="flex-1">
            <Text className="text-base font-bold text-primary">{item.french_word}</Text>
            <Text className="text-[13px] mt-0.5" style={{ color: Colors.gray700 }}>
              {item.english_translation}
            </Text>
          </View>

          {/* Review status */}
          <View className="items-end">
            <Text
              style={{
                fontSize: Typography.label.fontSize,
                color: isDue ? Colors.accent : Colors.gray500,
                fontWeight: isDue ? "600" : "400",
              }}
            >
              {formatNextReview(item.next_review)}
            </Text>
          </View>
        </View>
      );
    },
    [formatNextReview]
  );

  const vocabListHeader = useMemo(
    () => (
      <View>
        {/* Search bar */}
        <View className="bg-white rounded-xl border border-surface-300 px-4 py-3 mb-4 flex-row items-center">
          <Text className="text-base mr-2" style={{ color: Colors.textTertiary }}>
            {"🔍"}
          </Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search words..."
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel="Search vocabulary words"
            className="flex-1 text-[15px] text-primary"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text className="text-base" style={{ color: Colors.textTertiary }}>
                {"✕"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Word count */}
        <Text className="text-[13px] mb-3" style={{ color: Colors.gray700 }}>
          {filteredWords.length} word{filteredWords.length !== 1 ? "s" : ""}
          {searchQuery.trim() ? " found" : ""}
        </Text>
      </View>
    ),
    [searchQuery, filteredWords.length]
  );

  const vocabListEmpty = useMemo(
    () => (
      <View className="items-center pt-10">
        <Text className="text-sm" style={{ color: Colors.textTertiary }}>
          No words match your search.
        </Text>
      </View>
    ),
    []
  );

  // ---------- Loading State (skeleton) ----------
  if (isLoading) {
    return <VocabSkeleton />;
  }

  // ---------- Empty State ----------
  if (words.length === 0) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">{"📚"}</Text>
        <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
          Build your word bank!
        </Text>
        <Text className="text-sm text-center leading-5 mb-6" style={{ color: Colors.gray700 }}>
          Words from your conversations and exercises{"\n"}will appear here for spaced repetition
          review.
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/(tabs)/conversation")}
          accessibilityRole="button"
          accessibilityLabel="Start a conversation to learn new words"
          className="bg-primary rounded-xl px-6 py-3.5"
        >
          <Text className="text-white text-[15px] font-bold">Start a Conversation</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- Review Complete State ----------
  const reviewComplete = activeTab === "review" && dueWords.length === 0 && reviewedCount > 0;

  // ---------- Tab Bar ----------
  const renderTabBar = () => (
    <View className="flex-row mb-4 bg-surface-300 rounded-xl p-1">
      {(["review", "all"] as TabView[]).map((tab) => {
        const isActive = activeTab === tab;
        const label =
          tab === "review" ? `Review (${dueWords.length})` : `All Words (${words.length})`;

        return (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
            className="flex-1 py-2.5 rounded-[10px] items-center"
            style={{
              backgroundColor: isActive ? Colors.surfaceWhite : "transparent",
            }}
          >
            <Text
              className="text-sm"
              style={{
                fontWeight: isActive ? "700" : "500",
                color: isActive ? Colors.primary : Colors.gray600,
              }}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ---------- Review Card ----------
  const renderReviewCard = () => {
    if (reviewComplete) {
      return (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-[64px] mb-4">{"🎉"}</Text>
          <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
            All Caught Up!
          </Text>
          <Text className="text-sm text-center leading-5 mb-6" style={{ color: Colors.gray700 }}>
            You reviewed {reviewedCount} word{reviewedCount !== 1 ? "s" : ""}.{"\n"}Come back later
            for more reviews.
          </Text>
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
            accessibilityRole="button"
            accessibilityLabel="View all words"
            className="bg-primary rounded-xl px-6 py-3.5"
          >
            <Text className="text-white text-[15px] font-bold">View All Words</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (dueWords.length === 0) {
      return (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-[64px] mb-4">{"✅"}</Text>
          <Text accessibilityRole="header" className="text-[22px] font-bold text-primary mb-2">
            You{"'"}re all caught up!
          </Text>
          <Text className="text-sm text-center leading-5 mb-6" style={{ color: Colors.gray700 }}>
            All your words are up to date.{"\n"}Check back later or browse your full word list.
          </Text>
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
            accessibilityRole="button"
            accessibilityLabel="View all words"
            className="bg-primary rounded-xl px-6 py-3.5"
          >
            <Text className="text-white text-[15px] font-bold">View All Words</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const word = dueWords[currentIndex];
    if (!word) return null;

    return (
      <View className="flex-1">
        {/* Progress indicator */}
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-[13px]" style={{ color: Colors.gray700 }}>
            Card {currentIndex + 1} of {dueWords.length}
          </Text>
          <View
            className="rounded-lg px-2.5 py-1"
            style={{ backgroundColor: LEVEL_COLORS[word.cefr_level] ?? Colors.gray500 }}
          >
            <Text className="text-xs font-bold text-white">{word.cefr_level}</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View className="h-1 bg-surface-300 rounded-sm mb-6">
          <View
            className="h-1 rounded-sm bg-accent"
            style={{
              width: `${((currentIndex + 1) / dueWords.length) * 100}%`,
            }}
          />
        </View>

        {/* Flashcard */}
        <TouchableOpacity
          onPress={() => setIsRevealed(true)}
          activeOpacity={isRevealed ? 1 : 0.7}
          accessibilityRole="button"
          accessibilityLabel={
            isRevealed
              ? `${word.french_word} — ${word.english_translation}`
              : `${word.french_word}. Tap to reveal translation`
          }
          className="bg-white rounded-[20px] border border-surface-300 p-8 justify-center items-center"
          style={{
            minHeight: 280,
            shadowColor: Colors.textPrimary,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          {/* French word */}
          <Text className="text-[32px] font-bold text-primary text-center mb-2">
            {word.french_word}
          </Text>

          {/* Phonetic */}
          {word.phonetic && (
            <Text className="text-base mb-4 italic" style={{ color: Colors.textTertiary }}>
              {word.phonetic}
            </Text>
          )}

          {!isRevealed ? (
            <Text className="text-sm mt-4" style={{ color: Colors.textTertiary }}>
              Tap to reveal translation
            </Text>
          ) : (
            <View className="items-center mt-4">
              {/* Divider */}
              <View className="w-[60px] h-0.5 bg-surface-300 mb-4" />

              {/* English translation */}
              <Text
                style={{ color: Colors.accentText }}
                className="text-[22px] font-semibold text-center mb-3"
              >
                {word.english_translation}
              </Text>

              {/* Context sentence */}
              {word.context_sentence && (
                <View className="bg-surface rounded-xl p-4 mt-2 w-full">
                  <Text
                    className="text-[13px] italic text-center leading-5"
                    style={{ color: Colors.gray700 }}
                  >
                    {word.context_sentence}
                  </Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Rating buttons (visible after reveal) */}
        {isRevealed && (
          <View className="mt-6">
            <Text className="text-[13px] text-center mb-3" style={{ color: Colors.gray700 }}>
              How well did you know this?
            </Text>
            <View className="flex-row gap-2">
              {RATING_OPTIONS.map(({ label, quality, color }) => (
                <TouchableOpacity
                  key={label}
                  onPress={() => handleRate(quality)}
                  disabled={isUpdating}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate: ${label}`}
                  accessibilityState={{ disabled: isUpdating }}
                  className="flex-1 rounded-xl py-3.5 items-center"
                  style={{
                    backgroundColor: color,
                    opacity: isUpdating ? 0.5 : 1,
                  }}
                >
                  <Text className="text-[13px] font-bold text-white">{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  // ---------- Word List ----------
  const renderWordList = () => (
    <View className="flex-1">
      <FlatList
        data={filteredWords}
        keyExtractor={vocabKeyExtractor}
        renderItem={renderVocabItem}
        ListHeaderComponent={vocabListHeader}
        ListEmptyComponent={vocabListEmpty}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );

  // ---------- Offline Banner ----------
  const renderOfflineBanner = () => {
    if (!isOfflineData) return null;
    return (
      <View className="bg-accent/10 rounded-[10px] px-3.5 py-2.5 mb-3 flex-row items-center gap-2">
        <Text className="text-xs flex-1" style={{ color: Colors.accentText }}>
          Showing cached data. Changes will sync when you are back online.
        </Text>
      </View>
    );
  };

  // ---------- Main Render ----------
  if (activeTab === "all") {
    // "All Words" tab uses FlatList -- avoid nesting inside ScrollView
    return (
      <View className="flex-1 bg-surface p-5 pb-0">
        {renderOfflineBanner()}
        {renderTabBar()}
        {renderWordList()}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={Colors.primary}
        />
      }
    >
      {renderOfflineBanner()}
      {renderTabBar()}
      {renderReviewCard()}
    </ScrollView>
  );
}
