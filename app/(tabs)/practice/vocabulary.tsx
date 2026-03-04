/**
 * Vocabulary Review Screen
 *
 * Shows the user's saved vocabulary words with spaced repetition review.
 * Two views: "Review" for due cards and "All Words" for full list with search.
 * Uses SM-2 algorithm from src/lib/srs.ts to schedule reviews.
 */

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from "react-native";

import { useAuthStore } from "@/src/store/auth-store";
import { supabase } from "@/src/lib/supabase";
import { LEVEL_COLORS } from "@/src/lib/constants";
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
  { label: "Forgot", quality: 0, color: "#FF3B30" },
  { label: "Hard", quality: 2, color: "#FF9800" },
  { label: "Good", quality: 4, color: "#2196F3" },
  { label: "Easy", quality: 5, color: "#34C759" },
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

  /** Fetch all vocabulary for the user */
  const fetchVocabulary = useCallback(async () => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from("vocabulary")
      .select("*")
      .eq("user_id", user.id)
      .order("cefr_level", { ascending: true })
      .order("french_word", { ascending: true });

    if (error) {
      console.error("Failed to fetch vocabulary:", error.message);
      return;
    }

    const vocabulary = (data ?? []) as VocabWord[];
    setWords(vocabulary);

    // Filter words due for review
    const now = new Date();
    const due = vocabulary.filter((w) => new Date(w.next_review) <= now);
    setDueWords(due);
    setCurrentIndex(0);
    setIsRevealed(false);
    setReviewedCount(0);
  }, [user?.id]);

  useEffect(() => {
    void fetchVocabulary().finally(() => setIsLoading(false));
  }, [fetchVocabulary]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchVocabulary();
    setRefreshing(false);
  }, [fetchVocabulary]);

  /** Rate a word and update Supabase with the new SRS values */
  const handleRate = useCallback(
    async (quality: ReviewQuality) => {
      const word = dueWords[currentIndex];
      if (!word || isUpdating) return;

      setIsUpdating(true);

      const currentState: SRSState = {
        easeFactor: word.ease_factor,
        intervalDays: word.interval_days,
        repetitions: word.repetitions,
      };

      const update = calculateNextReview(currentState, quality);

      const { error } = await supabase
        .from("vocabulary")
        .update({
          ease_factor: update.easeFactor,
          interval_days: update.intervalDays,
          repetitions: update.repetitions,
          next_review: update.nextReview.toISOString(),
        })
        .eq("id", word.id);

      if (error) {
        console.error("Failed to update vocabulary:", error.message);
      }

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
    [currentIndex, dueWords, isUpdating, fetchVocabulary]
  );

  /** Format a relative date for display */
  const formatNextReview = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "Due now";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays < 7) return `In ${diffDays} days`;
    if (diffDays < 30) return `In ${Math.ceil(diffDays / 7)} weeks`;
    return `In ${Math.ceil(diffDays / 30)} months`;
  };

  /** Filter words for the "All Words" search */
  const filteredWords = searchQuery.trim()
    ? words.filter(
        (w) =>
          w.french_word.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.english_translation.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : words;

  // ---------- Loading State ----------
  if (isLoading) {
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
        <Text style={{ color: "#666", marginTop: 16, fontSize: 14 }}>Loading vocabulary...</Text>
      </View>
    );
  }

  // ---------- Empty State ----------
  if (words.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 64, marginBottom: 16 }}>{"📚"}</Text>
        <Text
          style={{
            fontSize: 22,
            fontWeight: "700",
            color: "#1E3A5F",
            marginBottom: 8,
          }}
        >
          No Vocabulary Yet
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "#666",
            textAlign: "center",
            lineHeight: 20,
          }}
        >
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
    <View
      style={{
        flexDirection: "row",
        marginBottom: 16,
        backgroundColor: "#E0E0CE",
        borderRadius: 12,
        padding: 4,
      }}
    >
      {(["review", "all"] as TabView[]).map((tab) => {
        const isActive = activeTab === tab;
        const label =
          tab === "review" ? `Review (${dueWords.length})` : `All Words (${words.length})`;

        return (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: isActive ? "#FFFFFF" : "transparent",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 14,
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
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text style={{ fontSize: 64, marginBottom: 16 }}>{"🎉"}</Text>
          <Text
            style={{
              fontSize: 22,
              fontWeight: "700",
              color: "#1E3A5F",
              marginBottom: 8,
            }}
          >
            All Caught Up!
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#666",
              textAlign: "center",
              lineHeight: 20,
              marginBottom: 24,
            }}
          >
            You reviewed {reviewedCount} word{reviewedCount !== 1 ? "s" : ""}.{"\n"}Come back later
            for more reviews.
          </Text>
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
            style={{
              backgroundColor: "#1E3A5F",
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
              View All Words
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (dueWords.length === 0) {
      return (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text style={{ fontSize: 64, marginBottom: 16 }}>{"✅"}</Text>
          <Text
            style={{
              fontSize: 22,
              fontWeight: "700",
              color: "#1E3A5F",
              marginBottom: 8,
            }}
          >
            No Reviews Due
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#666",
              textAlign: "center",
              lineHeight: 20,
              marginBottom: 24,
            }}
          >
            All your words are up to date.{"\n"}Check back later or browse your full word list.
          </Text>
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
            style={{
              backgroundColor: "#1E3A5F",
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
              View All Words
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    const word = dueWords[currentIndex];
    if (!word) return null;

    return (
      <View style={{ flex: 1 }}>
        {/* Progress indicator */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Text style={{ fontSize: 13, color: "#666" }}>
            Card {currentIndex + 1} of {dueWords.length}
          </Text>
          <View
            style={{
              backgroundColor: LEVEL_COLORS[word.cefr_level] ?? "#999",
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#FFFFFF" }}>
              {word.cefr_level}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View
          style={{
            height: 4,
            backgroundColor: "#E0E0CE",
            borderRadius: 2,
            marginBottom: 24,
          }}
        >
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: "#F5A623",
              width: `${((currentIndex + 1) / dueWords.length) * 100}%`,
            }}
          />
        </View>

        {/* Flashcard */}
        <TouchableOpacity
          onPress={() => setIsRevealed(true)}
          activeOpacity={isRevealed ? 1 : 0.7}
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "#E0E0CE",
            padding: 32,
            minHeight: 280,
            justifyContent: "center",
            alignItems: "center",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          {/* French word */}
          <Text
            style={{
              fontSize: 32,
              fontWeight: "700",
              color: "#1E3A5F",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            {word.french_word}
          </Text>

          {/* Phonetic */}
          {word.phonetic && (
            <Text
              style={{
                fontSize: 16,
                color: "#999",
                marginBottom: 16,
                fontStyle: "italic",
              }}
            >
              {word.phonetic}
            </Text>
          )}

          {!isRevealed ? (
            <Text style={{ fontSize: 14, color: "#999", marginTop: 16 }}>
              Tap to reveal translation
            </Text>
          ) : (
            <View style={{ alignItems: "center", marginTop: 16 }}>
              {/* Divider */}
              <View
                style={{
                  width: 60,
                  height: 2,
                  backgroundColor: "#E0E0CE",
                  marginBottom: 16,
                }}
              />

              {/* English translation */}
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "600",
                  color: "#F5A623",
                  textAlign: "center",
                  marginBottom: 12,
                }}
              >
                {word.english_translation}
              </Text>

              {/* Context sentence */}
              {word.context_sentence && (
                <View
                  style={{
                    backgroundColor: "#F5F5F0",
                    borderRadius: 12,
                    padding: 16,
                    marginTop: 8,
                    width: "100%",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: "#666",
                      fontStyle: "italic",
                      textAlign: "center",
                      lineHeight: 20,
                    }}
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
          <View style={{ marginTop: 24 }}>
            <Text
              style={{
                fontSize: 13,
                color: "#666",
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              How well did you know this?
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {RATING_OPTIONS.map(({ label, quality, color }) => (
                <TouchableOpacity
                  key={label}
                  onPress={() => handleRate(quality)}
                  disabled={isUpdating}
                  style={{
                    flex: 1,
                    backgroundColor: color,
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                    opacity: isUpdating ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#FFFFFF",
                    }}
                  >
                    {label}
                  </Text>
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
    <View style={{ flex: 1 }}>
      {/* Search bar */}
      <View
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#E0E0CE",
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginBottom: 16,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 16, marginRight: 8, color: "#999" }}>{"🔍"}</Text>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search words..."
          placeholderTextColor="#999"
          style={{
            flex: 1,
            fontSize: 15,
            color: "#1E3A5F",
          }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Text style={{ fontSize: 16, color: "#999" }}>{"✕"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Word count */}
      <Text style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
        {filteredWords.length} word{filteredWords.length !== 1 ? "s" : ""}
        {searchQuery.trim() ? " found" : ""}
      </Text>

      {/* Word list */}
      {filteredWords.length === 0 ? (
        <View style={{ alignItems: "center", paddingTop: 40 }}>
          <Text style={{ fontSize: 14, color: "#999" }}>No words match your search.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {filteredWords.map((word) => {
            const isDue = new Date(word.next_review) <= new Date();
            return (
              <View
                key={word.id}
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: isDue ? "#F5A623" : "#E0E0CE",
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {/* CEFR badge */}
                <View
                  style={{
                    backgroundColor: LEVEL_COLORS[word.cefr_level] ?? "#999",
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    minWidth: 36,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      color: "#FFFFFF",
                    }}
                  >
                    {word.cefr_level}
                  </Text>
                </View>

                {/* Word details */}
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "700",
                      color: "#1E3A5F",
                    }}
                  >
                    {word.french_word}
                  </Text>
                  <Text style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                    {word.english_translation}
                  </Text>
                </View>

                {/* Review status */}
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: isDue ? "#F5A623" : "#999",
                      fontWeight: isDue ? "600" : "400",
                    }}
                  >
                    {formatNextReview(word.next_review)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  // ---------- Main Render ----------
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F5F5F0" }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1E3A5F" />
      }
    >
      {renderTabBar()}
      {activeTab === "review" ? renderReviewCard() : renderWordList()}
    </ScrollView>
  );
}
