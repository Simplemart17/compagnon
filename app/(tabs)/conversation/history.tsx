/**
 * Conversation History Screen
 *
 * Displays past conversations with topic, date, duration,
 * corrections count, and CEFR level. Tapping a conversation
 * shows the full transcript.
 */

import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { captureError } from "@/src/lib/sentry";
import { LEVEL_COLORS } from "@/src/lib/constants";
import type { CEFRLevel } from "@/src/types/cefr";

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

export default function ConversationHistoryScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Transcript modal
  const [selectedConvo, setSelectedConvo] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

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
      </View>
    );
  }

  if (conversations.length === 0) {
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
        <Text style={{ fontSize: 64, marginBottom: 16 }}>{"\uD83D\uDCAC"}</Text>
        <Text style={{ fontSize: 22, fontWeight: "700", color: "#1E3A5F", marginBottom: 8 }}>
          No Conversations Yet
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
          Start a conversation with Compagnon{"\n"}and your history will appear here.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            backgroundColor: "#1E3A5F",
            borderRadius: 12,
            paddingHorizontal: 24,
            paddingVertical: 14,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
            Start a Conversation
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderConversation = ({ item }: { item: ConversationRecord }) => {
    const levelColor = LEVEL_COLORS[item.cefr_level as CEFRLevel] ?? "#999";

    return (
      <TouchableOpacity
        onPress={() => openTranscript(item)}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          padding: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: "#E0E0CE",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#1E3A5F" }} numberOfLines={1}>
              {item.topic}
            </Text>
            <Text style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
              {formatDate(item.completed_at ?? item.created_at)} {"\u00B7"}{" "}
              {formatDuration(item.duration_seconds)}
            </Text>
          </View>
          <View
            style={{
              backgroundColor: levelColor,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>
              {item.cefr_level}
            </Text>
          </View>
        </View>

        {/* Feedback summary if available */}
        {item.ai_feedback?.summary && (
          <Text
            style={{ fontSize: 13, color: "#666", marginTop: 8, lineHeight: 18 }}
            numberOfLines={2}
          >
            {item.ai_feedback.summary}
          </Text>
        )}

        {/* Ratings */}
        {item.ai_feedback?.fluencyRating && (
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <Text style={{ fontSize: 11, color: "#34C759" }}>
              Fluency {item.ai_feedback.fluencyRating}/5
            </Text>
            <Text style={{ fontSize: 11, color: "#F5A623" }}>
              Grammar {item.ai_feedback.grammarRating}/5
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderConversation}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1E3A5F" />
        }
      />

      {/* Transcript Modal */}
      <Modal
        visible={!!selectedConvo}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedConvo(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
          {/* Modal header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: "#E0E0CE",
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: "#1E3A5F" }} numberOfLines={1}>
                {selectedConvo?.topic}
              </Text>
              <Text style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                {selectedConvo?.completed_at ? formatDate(selectedConvo.completed_at) : ""}{" "}
                {"\u00B7"} {formatDuration(selectedConvo?.duration_seconds ?? null)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedConvo(null)}
              style={{
                backgroundColor: "#E0E0CE",
                width: 32,
                height: 32,
                borderRadius: 16,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, color: "#666", fontWeight: "700" }}>{"\u2715"}</Text>
            </TouchableOpacity>
          </View>

          {/* Messages */}
          {loadingMessages ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color="#1E3A5F" />
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            >
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <View
                    key={msg.id}
                    style={{
                      alignSelf: isUser ? "flex-end" : "flex-start",
                      maxWidth: "82%",
                      marginBottom: 12,
                    }}
                  >
                    <View
                      style={{
                        backgroundColor: isUser ? "#1E3A5F" : "#FFFFFF",
                        borderRadius: 16,
                        borderTopRightRadius: isUser ? 4 : 16,
                        borderTopLeftRadius: isUser ? 16 : 4,
                        padding: 12,
                        borderWidth: isUser ? 0 : 1,
                        borderColor: "#E0E0CE",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          color: isUser ? "#FFFFFF" : "#333",
                          lineHeight: 20,
                        }}
                      >
                        {msg.content}
                      </Text>
                    </View>
                    {/* Corrections */}
                    {msg.corrections && msg.corrections.length > 0 && (
                      <View
                        style={{
                          backgroundColor: "rgba(245,166,35,0.1)",
                          borderRadius: 10,
                          padding: 10,
                          marginTop: 4,
                          borderWidth: 1,
                          borderColor: "rgba(245,166,35,0.3)",
                        }}
                      >
                        {msg.corrections.map((c, i) => (
                          <Text key={i} style={{ fontSize: 12, color: "#666", lineHeight: 17 }}>
                            &quot;{c.original}&quot; {"\u2192"} &quot;{c.corrected}&quot;
                            {c.explanation ? ` (${c.explanation})` : ""}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              {messages.length === 0 && (
                <Text style={{ fontSize: 14, color: "#999", textAlign: "center", marginTop: 40 }}>
                  No transcript available for this conversation.
                </Text>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
