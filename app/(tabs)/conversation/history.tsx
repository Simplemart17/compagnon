/**
 * Conversation History Screen
 *
 * Displays past conversations with topic, date, duration,
 * corrections count, and CEFR level. Tapping a conversation
 * shows the full transcript.
 *
 * Features:
 * - Search bar to filter conversations by topic name or date
 * - Transcript modal with in-text search, match highlighting,
 *   match count, and up/down navigation between matches
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Platform,
} from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { captureError } from "@/src/lib/sentry";
import { LEVEL_COLORS } from "@/src/lib/constants";
import { Colors } from "@/src/lib/design";
import { useDebounce } from "@/src/hooks/use-debounce";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationRecord {
  id: string;
  topic: string;
  cefr_level: string;
  duration_seconds: number | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  ai_feedback: {
    summary?: string;
    fluencyRating?: number;
    grammarRating?: number;
  } | null;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  corrections:
    | {
        original: string;
        corrected: string;
        explanation: string;
      }[]
    | null;
}

/** A single match position within the transcript */
interface TranscriptMatch {
  /** Index of the message in the messages array */
  messageIndex: number;
  /** Character start index within that message's content */
  charStart: number;
  /** Character end index within that message's content */
  charEnd: number;
}

// ---------------------------------------------------------------------------
// Skeleton loading
// ---------------------------------------------------------------------------

function SkeletonCard() {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Reanimated.View
      style={[
        {
          marginHorizontal: 16,
          marginBottom: 10,
          borderRadius: 16,
          padding: 16,
          backgroundColor: Colors.surfaceWhite,
        },
      ]}
    >
      <Reanimated.View style={animStyle}>
        <View className="h-4 w-3/5 rounded-md mb-2" style={{ backgroundColor: Colors.gray200 }} />
        <View className="h-3 w-2/5 rounded-md mb-3" style={{ backgroundColor: Colors.gray200 }} />
        <View className="h-3 w-4/5 rounded-md" style={{ backgroundColor: Colors.gray200 }} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

function ModalSafeArea({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-surface"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {children}
    </View>
  );
}

function HistoryLoadingSkeleton() {
  return (
    <View className="flex-1 bg-surface pt-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Formats a date string for search matching.
 * Returns multiple representations so the user can type
 * "today", "yesterday", "Jan 5", "2026", etc.
 */
const dateSearchTokens = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const parts: string[] = [];
  if (diffDays === 0) parts.push("today");
  if (diffDays === 1) parts.push("yesterday");

  parts.push(
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  );
  parts.push(
    date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  );

  return parts.join(" ");
};

/**
 * Build an array of TranscriptMatch objects from messages and a query.
 */
function buildTranscriptMatches(msgs: ConversationMessage[], query: string): TranscriptMatch[] {
  if (query.length === 0) return [];

  const lowerQuery = query.toLowerCase();
  const matches: TranscriptMatch[] = [];

  msgs.forEach((msg, msgIdx) => {
    const lowerContent = msg.content.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < lowerContent.length) {
      const idx = lowerContent.indexOf(lowerQuery, searchFrom);
      if (idx === -1) break;

      matches.push({
        messageIndex: msgIdx,
        charStart: idx,
        charEnd: idx + query.length,
      });

      searchFrom = idx + 1;
    }
  });

  return matches;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Renders message text with highlighted search matches.
 */
function HighlightedText({
  content,
  matches,
  activeMatchIndex,
  globalOffset,
  textColor,
}: {
  content: string;
  matches: TranscriptMatch[];
  activeMatchIndex: number;
  globalOffset: number;
  textColor: string;
}) {
  if (matches.length === 0) {
    return <Text style={{ fontSize: 14, color: textColor, lineHeight: 20 }}>{content}</Text>;
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, localIdx) => {
    // Text before the match
    if (match.charStart > cursor) {
      segments.push(<Text key={`pre-${localIdx}`}>{content.slice(cursor, match.charStart)}</Text>);
    }

    const isActive = globalOffset + localIdx === activeMatchIndex;

    segments.push(
      <Text
        key={`match-${localIdx}`}
        style={{
          backgroundColor: isActive ? Colors.accent : Colors.accent20,
          color: isActive ? Colors.textOnDark : textColor,
          borderRadius: 2,
          fontWeight: isActive ? "700" : "400",
        }}
      >
        {content.slice(match.charStart, match.charEnd)}
      </Text>
    );

    cursor = match.charEnd;
  });

  // Text after last match
  if (cursor < content.length) {
    segments.push(<Text key="post">{content.slice(cursor)}</Text>);
  }

  return <Text style={{ fontSize: 14, color: textColor, lineHeight: 20 }}>{segments}</Text>;
}

// ---------------------------------------------------------------------------
// Main Screen Component
// ---------------------------------------------------------------------------

export default function ConversationHistoryScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // History list search
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Transcript modal
  const [selectedConvo, setSelectedConvo] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Transcript search
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const debouncedTranscriptSearch = useDebounce(transcriptSearch, 300);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const transcriptScrollRef = useRef<ScrollView>(null);
  /** Map from message index to its Y layout position */
  const messageLayoutMap = useRef<Map<number, number>>(new Map());

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, topic, cefr_level, duration_seconds, status, completed_at, created_at, ai_feedback"
        )
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(50);

      if (error) {
        captureError(error, "fetch-conversation-history");
        return;
      }

      setConversations((data ?? []) as ConversationRecord[]);
    } catch (err) {
      captureError(err, "fetch-conversation-history");
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchConversations().finally(() => setIsLoading(false));
  }, [fetchConversations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  const openTranscript = useCallback(async (convo: ConversationRecord) => {
    setSelectedConvo(convo);
    setLoadingMessages(true);
    setTranscriptSearch("");
    setActiveMatchIdx(0);
    messageLayoutMap.current.clear();

    try {
      const { data, error } = await supabase
        .from("conversation_messages")
        .select("id, role, content, corrections")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: true });

      if (error) {
        captureError(error, "fetch-conversation-messages");
      }

      setMessages((data ?? []) as ConversationMessage[]);
    } catch (err) {
      captureError(err, "fetch-conversation-messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const closeTranscript = useCallback(() => {
    setSelectedConvo(null);
    setTranscriptSearch("");
    setActiveMatchIdx(0);
  }, []);

  // ---------------------------------------------------------------------------
  // Filtered conversation list
  // ---------------------------------------------------------------------------

  const filteredConversations = useMemo(() => {
    if (debouncedSearch.trim().length === 0) return conversations;

    const query = debouncedSearch.toLowerCase().trim();

    return conversations.filter((convo) => {
      const topic = (convo.topic ?? "").toLowerCase();
      const dateTokens = dateSearchTokens(convo.completed_at ?? convo.created_at).toLowerCase();

      return topic.includes(query) || dateTokens.includes(query);
    });
  }, [conversations, debouncedSearch]);

  // ---------------------------------------------------------------------------
  // Transcript search matches
  // ---------------------------------------------------------------------------

  const transcriptMatches = useMemo(
    () => buildTranscriptMatches(messages, debouncedTranscriptSearch.trim()),
    [messages, debouncedTranscriptSearch]
  );

  // Reset active match index when matches change
  useEffect(() => {
    setActiveMatchIdx(0);
  }, [transcriptMatches]);

  /**
   * Build a per-message match mapping for efficient rendering:
   * messageIndex -> { matches: TranscriptMatch[], globalOffset: number }
   */
  const matchesByMessage = useMemo(() => {
    const map = new Map<number, { matches: TranscriptMatch[]; globalOffset: number }>();

    let offset = 0;
    let currentMsgIdx = -1;
    let currentMatches: TranscriptMatch[] = [];

    transcriptMatches.forEach((m) => {
      if (m.messageIndex !== currentMsgIdx) {
        if (currentMsgIdx >= 0 && currentMatches.length > 0) {
          map.set(currentMsgIdx, {
            matches: currentMatches,
            globalOffset: offset,
          });
          offset += currentMatches.length;
        }
        currentMsgIdx = m.messageIndex;
        currentMatches = [];
      }
      currentMatches.push(m);
    });

    // Flush last group
    if (currentMsgIdx >= 0 && currentMatches.length > 0) {
      map.set(currentMsgIdx, {
        matches: currentMatches,
        globalOffset: offset,
      });
    }

    return map;
  }, [transcriptMatches]);

  /** Scroll to the message containing the active match */
  const scrollToActiveMatch = useCallback(
    (matchIdx: number) => {
      if (transcriptMatches.length === 0) return;

      const safeIdx = Math.max(0, Math.min(matchIdx, transcriptMatches.length - 1));
      const match = transcriptMatches[safeIdx];
      if (!match) return;

      const y = messageLayoutMap.current.get(match.messageIndex);
      if (y !== undefined && transcriptScrollRef.current) {
        transcriptScrollRef.current.scrollTo({ y: Math.max(0, y - 80), animated: true });
      }
    },
    [transcriptMatches]
  );

  const goToNextMatch = useCallback(() => {
    if (transcriptMatches.length === 0) return;
    const nextIdx = (activeMatchIdx + 1) % transcriptMatches.length;
    setActiveMatchIdx(nextIdx);
    scrollToActiveMatch(nextIdx);
  }, [activeMatchIdx, transcriptMatches.length, scrollToActiveMatch]);

  const goToPrevMatch = useCallback(() => {
    if (transcriptMatches.length === 0) return;
    const prevIdx = (activeMatchIdx - 1 + transcriptMatches.length) % transcriptMatches.length;
    setActiveMatchIdx(prevIdx);
    scrollToActiveMatch(prevIdx);
  }, [activeMatchIdx, transcriptMatches.length, scrollToActiveMatch]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return <HistoryLoadingSkeleton />;
  }

  // ---------------------------------------------------------------------------
  // Empty state (no conversations at all)
  // ---------------------------------------------------------------------------

  if (conversations.length === 0) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">{"\uD83D\uDCAC"}</Text>
        <Text className="text-[22px] font-bold text-primary mb-2">No Conversations Yet</Text>
        <Text className="text-sm text-[#4A5568] text-center leading-5 mb-6">
          Start a conversation with Compagnon{"\n"}and your history will appear here.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-primary rounded-xl px-6 py-3.5"
        >
          <Text className="text-white text-[15px] font-bold">Start a Conversation</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderConversation = ({ item }: { item: ConversationRecord }) => {
    const levelColor = LEVEL_COLORS[item.cefr_level as CEFRLevel] ?? "#999";

    return (
      <TouchableOpacity
        onPress={() => openTranscript(item)}
        accessibilityRole="button"
        accessibilityLabel={`Conversation: ${item.topic || "Free conversation"}`}
        className="bg-white rounded-2xl p-4 mx-4 mb-2.5 border border-surface-300"
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-base font-bold text-primary" numberOfLines={1}>
              {item.topic}
            </Text>
            <Text className="text-xs text-[#94A3B8] mt-1">
              {formatDate(item.completed_at ?? item.created_at)} {"\u00B7"}{" "}
              {formatDuration(item.duration_seconds)}
            </Text>
          </View>
          <View className="rounded-lg px-2 py-1" style={{ backgroundColor: levelColor }}>
            <Text className="text-[11px] font-bold text-white">{item.cefr_level}</Text>
          </View>
        </View>

        {/* Feedback summary if available */}
        {item.ai_feedback?.summary && (
          <Text className="text-[13px] text-[#4A5568] mt-2 leading-[18px]" numberOfLines={2}>
            {item.ai_feedback.summary}
          </Text>
        )}

        {/* Ratings */}
        {item.ai_feedback?.fluencyRating && (
          <View className="flex-row gap-4 mt-2">
            <Text className="text-[11px] text-success">
              Fluency {item.ai_feedback.fluencyRating}/5
            </Text>
            <Text className="text-[11px] text-accent">
              Grammar {item.ai_feedback.grammarRating}/5
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <View className="flex-1 bg-surface">
      {/* Search bar for conversation list */}
      <View className="px-4 pt-3 pb-2">
        <View
          className="flex-row items-center bg-white rounded-xl border border-surface-300 px-3"
          style={{ height: 44 }}
        >
          <Text className="text-base text-[#94A3B8] mr-2">{"\uD83D\uDD0D"}</Text>
          <TextInput
            style={{
              flex: 1,
              fontSize: 15,
              color: Colors.textPrimary,
              paddingVertical: Platform.OS === "ios" ? 10 : 6,
            }}
            placeholder="Search conversations..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search conversations"
            accessibilityHint="Filter conversations by topic or date"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View
                className="w-5 h-5 rounded-full justify-center items-center"
                style={{ backgroundColor: Colors.gray400 }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: Colors.surfaceWhite,
                    fontWeight: "700",
                    lineHeight: 13,
                  }}
                >
                  {"\u2715"}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Conversation list or "No results" */}
      {filteredConversations.length === 0 ? (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-base text-[#94A3B8] mb-1">{"\uD83D\uDD0D"}</Text>
          <Text className="text-base font-semibold text-[#6B7C93] mb-1">No results</Text>
          <Text className="text-[13px] text-[#94A3B8] text-center">
            No conversations match &quot;{debouncedSearch}&quot;
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
        />
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Transcript Modal                                                     */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        visible={!!selectedConvo}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeTranscript}
      >
        <ModalSafeArea>
          {/* Modal header */}
          <View
            className="flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: Colors.border }}
          >
            <View className="flex-1">
              <Text className="text-[17px] font-bold text-primary" numberOfLines={1}>
                {selectedConvo?.topic}
              </Text>
              <Text className="text-xs text-[#94A3B8] mt-0.5">
                {selectedConvo?.completed_at ? formatDate(selectedConvo.completed_at) : ""}{" "}
                {"\u00B7"} {formatDuration(selectedConvo?.duration_seconds ?? null)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={closeTranscript}
              accessibilityRole="button"
              accessibilityLabel="Close transcript"
              className="bg-surface-300 w-11 h-11 rounded-full justify-center items-center"
            >
              <Text className="text-base text-[#4A5568] font-bold">{"\u2715"}</Text>
            </TouchableOpacity>
          </View>

          {/* Transcript search bar */}
          <View
            className="px-4 py-2"
            style={{ borderBottomWidth: 1, borderBottomColor: Colors.border }}
          >
            <View
              className="flex-row items-center bg-white rounded-[10px] border border-surface-300 px-2.5"
              style={{ height: 40 }}
            >
              <Text className="text-sm text-[#94A3B8] mr-1.5">{"\uD83D\uDD0D"}</Text>
              <TextInput
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: Colors.textPrimary,
                  paddingVertical: Platform.OS === "ios" ? 8 : 4,
                }}
                placeholder="Search in transcript..."
                placeholderTextColor={Colors.textTertiary}
                value={transcriptSearch}
                onChangeText={setTranscriptSearch}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search in transcript"
                accessibilityHint="Search through conversation messages"
              />

              {/* Match count + navigation (shown when there is a search query) */}
              {debouncedTranscriptSearch.trim().length > 0 && (
                <View className="flex-row items-center gap-1">
                  <Text
                    className="text-xs font-semibold mr-1"
                    style={{
                      color: transcriptMatches.length > 0 ? Colors.textSecondary : Colors.error,
                    }}
                    accessibilityLabel={`${transcriptMatches.length} matches found`}
                  >
                    {transcriptMatches.length > 0
                      ? `${activeMatchIdx + 1}/${transcriptMatches.length}`
                      : "0"}
                  </Text>

                  <TouchableOpacity
                    onPress={goToPrevMatch}
                    disabled={transcriptMatches.length === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Previous match"
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    className="w-7 h-7 rounded-md justify-center items-center"
                    style={{
                      backgroundColor:
                        transcriptMatches.length > 0 ? Colors.primary8 : Colors.gray200,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "700",
                        color: transcriptMatches.length > 0 ? Colors.primary : Colors.gray400,
                      }}
                    >
                      {"\u2303"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={goToNextMatch}
                    disabled={transcriptMatches.length === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Next match"
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    className="w-7 h-7 rounded-md justify-center items-center"
                    style={{
                      backgroundColor:
                        transcriptMatches.length > 0 ? Colors.primary8 : Colors.gray200,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "700",
                        color: transcriptMatches.length > 0 ? Colors.primary : Colors.gray400,
                        transform: [{ rotate: "180deg" }],
                      }}
                    >
                      {"\u2303"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Clear transcript search */}
              {transcriptSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => setTranscriptSearch("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear transcript search"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginLeft: 6 }}
                >
                  <View
                    className="w-[18px] h-[18px] rounded-full justify-center items-center"
                    style={{ backgroundColor: Colors.gray400 }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        color: Colors.surfaceWhite,
                        fontWeight: "700",
                        lineHeight: 12,
                      }}
                    >
                      {"\u2715"}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Messages */}
          {loadingMessages ? (
            <View className="flex-1 justify-center items-center">
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : (
            <ScrollView
              ref={transcriptScrollRef}
              className="flex-1"
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {messages.map((msg, msgIdx) => {
                const isUser = msg.role === "user";
                const msgMatches = matchesByMessage.get(msgIdx);

                return (
                  <View
                    key={msg.id}
                    onLayout={(e) => {
                      messageLayoutMap.current.set(msgIdx, e.nativeEvent.layout.y);
                    }}
                    className="mb-3"
                    style={{
                      alignSelf: isUser ? "flex-end" : "flex-start",
                      maxWidth: "82%",
                    }}
                  >
                    <View
                      className="rounded-2xl p-3"
                      style={{
                        backgroundColor: isUser ? Colors.primary : Colors.surfaceWhite,
                        borderTopRightRadius: isUser ? 4 : 16,
                        borderTopLeftRadius: isUser ? 16 : 4,
                        borderWidth: isUser ? 0 : 1,
                        borderColor: Colors.border,
                      }}
                    >
                      {msgMatches ? (
                        <HighlightedText
                          content={msg.content}
                          matches={msgMatches.matches}
                          activeMatchIndex={activeMatchIdx}
                          globalOffset={msgMatches.globalOffset}
                          textColor={isUser ? Colors.textOnDark : Colors.textPrimary}
                        />
                      ) : (
                        <Text
                          className="text-sm leading-5"
                          style={{ color: isUser ? Colors.textOnDark : Colors.textPrimary }}
                        >
                          {msg.content}
                        </Text>
                      )}
                    </View>
                    {/* Corrections */}
                    {msg.corrections && msg.corrections.length > 0 && (
                      <View
                        className="rounded-[10px] p-2.5 mt-1 border"
                        style={{
                          backgroundColor: "rgba(245,166,35,0.1)",
                          borderColor: "rgba(245,166,35,0.3)",
                        }}
                      >
                        {msg.corrections.map((c, i) => (
                          <Text key={i} className="text-xs text-[#4A5568] leading-[17px]">
                            &quot;{c.original}&quot; {"\u2192"} &quot;
                            {c.corrected}&quot;
                            {c.explanation ? ` (${c.explanation})` : ""}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              {messages.length === 0 && (
                <Text className="text-sm text-[#94A3B8] text-center mt-10">
                  No transcript available for this conversation.
                </Text>
              )}
            </ScrollView>
          )}
        </ModalSafeArea>
      </Modal>
    </View>
  );
}
