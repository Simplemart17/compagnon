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
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from "react-native";

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
import { Colors } from "@/src/lib/design";
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

export default function VocabularyScreen() {
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
  const filteredWords = searchQuery.trim()
    ? words.filter(
        (w) =>
          w.french_word.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.english_translation.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : words;

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
            borderColor: isDue ? "#F5A623" : "#E0E0CE",
          }}
        >
          {/* CEFR badge */}
          <View
            className="rounded-lg px-2 py-1 items-center"
            style={{
              backgroundColor: LEVEL_COLORS[item.cefr_level] ?? "#999",
              minWidth: 36,
            }}
          >
            <Text className="text-[11px] font-bold text-white">{item.cefr_level}</Text>
          </View>

          {/* Word details */}
          <View className="flex-1">
            <Text className="text-base font-bold text-primary">{item.french_word}</Text>
            <Text className="text-[13px] text-[#4A5568] mt-0.5">{item.english_translation}</Text>
          </View>

          {/* Review status */}
          <View className="items-end">
            <Text
              style={{
                fontSize: 11,
                color: isDue ? "#F5A623" : "#999",
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
          <Text className="text-base mr-2 text-[#94A3B8]">{"🔍"}</Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search words..."
            placeholderTextColor={Colors.textTertiary}
            className="flex-1 text-[15px] text-primary"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Text className="text-base text-[#94A3B8]">{"✕"}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Word count */}
        <Text className="text-[13px] text-[#4A5568] mb-3">
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
        <Text className="text-sm text-[#94A3B8]">No words match your search.</Text>
      </View>
    ),
    []
  );

  // ---------- Loading State ----------
  if (isLoading) {
    return (
      <View className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-[#4A5568] mt-4 text-sm">Loading vocabulary...</Text>
      </View>
    );
  }

  // ---------- Empty State ----------
  if (words.length === 0) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">{"📚"}</Text>
        <Text className="text-[22px] font-bold text-primary mb-2">No Vocabulary Yet</Text>
        <Text className="text-sm text-[#4A5568] text-center leading-5">
          Words from your conversations and exercises{"\n"}will appear here for spaced repetition
          review.
        </Text>
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
            className="flex-1 py-2.5 rounded-[10px] items-center"
            style={{
              backgroundColor: isActive ? "#FFFFFF" : "transparent",
            }}
          >
            <Text
              className="text-sm"
              style={{
                fontWeight: isActive ? "700" : "500",
                color: isActive ? "#1E3A5F" : "#666",
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
          <Text className="text-[22px] font-bold text-primary mb-2">All Caught Up!</Text>
          <Text className="text-sm text-[#4A5568] text-center leading-5 mb-6">
            You reviewed {reviewedCount} word{reviewedCount !== 1 ? "s" : ""}.{"\n"}Come back later
            for more reviews.
          </Text>
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
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
          <Text className="text-[22px] font-bold text-primary mb-2">No Reviews Due</Text>
          <Text className="text-sm text-[#4A5568] text-center leading-5 mb-6">
            All your words are up to date.{"\n"}Check back later or browse your full word list.
          </Text>
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
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
          <Text className="text-[13px] text-[#4A5568]">
            Card {currentIndex + 1} of {dueWords.length}
          </Text>
          <View
            className="rounded-lg px-2.5 py-1"
            style={{ backgroundColor: LEVEL_COLORS[word.cefr_level] ?? "#999" }}
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
          className="bg-white rounded-[20px] border border-surface-300 p-8 justify-center items-center"
          style={{
            minHeight: 280,
            shadowColor: "#000",
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
            <Text className="text-base text-[#94A3B8] mb-4 italic">{word.phonetic}</Text>
          )}

          {!isRevealed ? (
            <Text className="text-sm text-[#94A3B8] mt-4">Tap to reveal translation</Text>
          ) : (
            <View className="items-center mt-4">
              {/* Divider */}
              <View className="w-[60px] h-0.5 bg-surface-300 mb-4" />

              {/* English translation */}
              <Text className="text-[22px] font-semibold text-accent text-center mb-3">
                {word.english_translation}
              </Text>

              {/* Context sentence */}
              {word.context_sentence && (
                <View className="bg-surface rounded-xl p-4 mt-2 w-full">
                  <Text className="text-[13px] text-[#4A5568] italic text-center leading-5">
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
            <Text className="text-[13px] text-[#4A5568] text-center mb-3">
              How well did you know this?
            </Text>
            <View className="flex-row gap-2">
              {RATING_OPTIONS.map(({ label, quality, color }) => (
                <TouchableOpacity
                  key={label}
                  onPress={() => handleRate(quality)}
                  disabled={isUpdating}
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
        <Text className="text-xs text-accent flex-1">
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
