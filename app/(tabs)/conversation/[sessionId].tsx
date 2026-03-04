/**
 * Active Voice Conversation Screen
 *
 * Full-screen voice conversation with:
 * - Animated waveform visualization
 * - Real-time transcript
 * - Correction bubbles
 * - Push-to-talk + hands-free (VAD) modes
 * - End conversation with feedback summary
 */

import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  BackHandler,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useRealtimeVoice } from "@/src/hooks/use-realtime-voice";
import { useAuthStore } from "@/src/store/auth-store";
import { retrieveMemories } from "@/src/lib/memory";
import { getTopErrors } from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import { AudioWaveform } from "@/src/components/conversation/AudioWaveform";
import { TranscriptView } from "@/src/components/conversation/TranscriptView";
import { CorrectionBubble } from "@/src/components/conversation/CorrectionBubble";
import type { ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";

type ViewMode = "waveform" | "transcript";

function PendingAiCard({ text }: { text: string }) {
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <View
      style={{
        backgroundColor: "rgba(255,255,255,0.08)",
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 12,
        marginHorizontal: 28,
        marginTop: 16,
      }}
    >
      <Text
        style={{
          fontSize: 15,
          lineHeight: 22,
          color: "rgba(255,255,255,0.85)",
          fontStyle: "italic",
        }}
        numberOfLines={3}
      >
        {text}
        <Text style={{ color: cursorVisible ? "#F5A623" : "transparent" }}>|</Text>
      </Text>
    </View>
  );
}

export default function ConversationSessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);

  const [viewMode, setViewMode] = useState<ViewMode>("waveform");
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  const topic = decodeURIComponent(sessionId ?? "Free conversation");
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const mode: ConversationMode = "companion";
  const user = useAuthStore((s) => s.user);

  // Fetch companion memories and known error patterns for personalized conversation
  const [memories, setMemories] = useState<string[]>([]);
  const [errorPatterns, setErrorPatterns] = useState<string[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    void (async () => {
      try {
        const [mems, errors] = await Promise.all([
          retrieveMemories(user.id, topic, 8).catch(() => []),
          getTopErrors(user.id, 5).catch(() => []),
        ]);
        setMemories(mems);
        setErrorPatterns(errors.map((e) => `${e.error_type}: ${e.error_description}`));
      } catch (err) {
        captureError(err, "conversation-context-fetch");
      }
    })();
  }, [user?.id, topic]);

  const conversation = useRealtimeVoice({
    cefrLevel,
    mode,
    topic,
    memories,
    errorPatterns,
    voice: "nova",
    onConversationEnd: () => {
      setFeedbackVisible(true);
    },
  });

  // Prevent accidental back navigation during active conversation
  useEffect(() => {
    if (conversation.status !== "connected") return;

    const onBackPress = () => {
      Alert.alert(
        "End Conversation?",
        "Your conversation is still active. End it before leaving?",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "End & Leave",
            style: "destructive",
            onPress: () => {
              conversation.end();
              router.back();
            },
          },
        ]
      );
      return true; // prevent default back behavior
    };

    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, [conversation.status, conversation, router]);

  const handleStart = useCallback(async () => {
    await conversation.start();
  }, [conversation]);

  const handleEnd = useCallback(() => {
    conversation.end();
  }, [conversation]);

  const handleSendText = useCallback(() => {
    if (textInput.trim()) {
      conversation.sendText(textInput.trim());
      setTextInput("");
    }
  }, [conversation, textInput]);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Start button ring pulse animation
  const startRingScale = useSharedValue(1);

  useEffect(() => {
    if (conversation.status === "idle") {
      startRingScale.value = withRepeat(
        withSequence(withTiming(1.08, { duration: 1000 }), withTiming(1.0, { duration: 1000 })),
        -1
      );
    } else {
      startRingScale.value = withTiming(1.0, { duration: 200 });
    }
  }, [conversation.status, startRingScale]);

  const startRingAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: startRingScale.value }],
  }));

  // Status dot color
  const statusDotColor =
    conversation.status === "connected"
      ? "#34C759"
      : conversation.status === "connecting"
        ? "#F5A623"
        : conversation.status === "error"
          ? "#FF3B30"
          : conversation.status === "ended"
            ? "rgba(255,255,255,0.3)"
            : "rgba(255,255,255,0.3)";

  // Status text / subtitle
  function getStatusContent(): { main: string; sub: string; dimMain: boolean } {
    if (conversation.status === "connecting") {
      return { main: "Un moment...", sub: "Preparing your session", dimMain: false };
    }
    if (conversation.status === "connected") {
      if (conversation.isSpeaking) {
        return { main: "Je vous écoute...", sub: "Speak naturally", dimMain: false };
      }
      if (conversation.isAiSpeaking) {
        return { main: "Compagnon répond...", sub: "", dimMain: false };
      }
      return { main: "À vous de parler", sub: "", dimMain: true };
    }
    if (conversation.status === "ended") {
      return { main: "Conversation terminée", sub: "", dimMain: false };
    }
    return { main: "", sub: "", dimMain: false };
  }

  const statusContent = getStatusContent();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0D2240" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Radial glow behind waveform area */}
        <View
          style={{
            position: "absolute",
            top: "20%",
            left: "50%",
            marginLeft: -130,
            width: 260,
            height: 260,
            borderRadius: 130,
            backgroundColor: "rgba(30,58,95,0.5)",
          }}
          pointerEvents="none"
        />

        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          {/* Back button */}
          <TouchableOpacity
            onPress={() => {
              if (conversation.status === "connected") {
                handleEnd();
              }
              router.back();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.1)",
              borderColor: "rgba(255,255,255,0.15)",
              borderWidth: 1,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 18, color: "#FFFFFF" }}>{"\u2190"}</Text>
          </TouchableOpacity>

          {/* Center: topic + status */}
          <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: "#FFFFFF",
              }}
              numberOfLines={1}
            >
              {topic}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginTop: 3,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: statusDotColor,
                }}
              />
              <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                {conversation.status === "connected"
                  ? formatDuration(conversation.durationSeconds)
                  : conversation.status === "connecting"
                    ? "Connecting..."
                    : conversation.status === "error"
                      ? "Error"
                      : conversation.status === "ended"
                        ? "Ended"
                        : "Ready"}
              </Text>
            </View>
          </View>

          {/* View toggle segmented pill */}
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              borderRadius: 20,
              padding: 3,
              flexDirection: "row",
            }}
          >
            {(["waveform", "transcript"] as ViewMode[]).map((segMode) => {
              const isActive = viewMode === segMode;
              return (
                <TouchableOpacity
                  key={segMode}
                  onPress={() => setViewMode(segMode)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 17,
                    backgroundColor: isActive ? "rgba(255,255,255,0.18)" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: isActive ? "700" : "400",
                      color: isActive ? "#FFFFFF" : "rgba(255,255,255,0.45)",
                    }}
                  >
                    {segMode === "waveform" ? "Wave" : "Text"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Topic banner */}
        <View style={{ alignItems: "center", marginBottom: 8 }}>
          <View
            style={{
              backgroundColor: "rgba(245,166,35,0.08)",
              borderRadius: 12,
              paddingVertical: 6,
              paddingHorizontal: 16,
              marginHorizontal: 32,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: "#F5A623",
                textAlign: "center",
              }}
            >
              {topic}
            </Text>
          </View>
        </View>

        {/* Main Content Area */}
        <View style={{ flex: 1 }}>
          {viewMode === "waveform" ? (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <AudioWaveform
                isActive={conversation.isSpeaking || conversation.isAiSpeaking}
                speaker={
                  conversation.isSpeaking ? "user" : conversation.isAiSpeaking ? "ai" : "idle"
                }
                isConnecting={conversation.status === "connecting"}
                size={220}
              />

              {/* Status text block */}
              {statusContent.main.length > 0 && (
                <View style={{ alignItems: "center", marginTop: 24 }}>
                  <Text
                    style={{
                      fontSize: 20,
                      fontWeight: "600",
                      fontStyle: "italic",
                      color: statusContent.dimMain ? "rgba(255,255,255,0.55)" : "#FFFFFF",
                      textAlign: "center",
                    }}
                  >
                    {statusContent.main}
                  </Text>
                  {statusContent.sub.length > 0 && (
                    <Text
                      style={{
                        fontSize: 13,
                        color: "rgba(255,255,255,0.45)",
                        marginTop: 4,
                        textAlign: "center",
                      }}
                    >
                      {statusContent.sub}
                    </Text>
                  )}
                </View>
              )}

              {/* Streaming AI text preview */}
              {conversation.pendingAiText.length > 0 && (
                <PendingAiCard text={conversation.pendingAiText} />
              )}

              {/* Recent corrections overlay — absolute above controls */}
              {conversation.allCorrections.length > 0 && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 100,
                    left: 16,
                    right: 16,
                  }}
                >
                  <CorrectionBubble
                    corrections={conversation.allCorrections.slice(-2)}
                    compact
                    theme="dark"
                  />
                </View>
              )}
            </View>
          ) : (
            <TranscriptView
              transcript={conversation.transcript}
              pendingAiText={conversation.pendingAiText}
              isAiSpeaking={conversation.isAiSpeaking}
            />
          )}
        </View>

        {/* Text Input */}
        {showTextInput && conversation.status === "connected" && (
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              borderRadius: 28,
              paddingHorizontal: 16,
              paddingVertical: 8,
              marginHorizontal: 16,
              marginBottom: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <TextInput
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Type in French..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={{
                flex: 1,
                color: "#FFFFFF",
                fontSize: 15,
                paddingVertical: 4,
              }}
              onSubmitEditing={handleSendText}
              returnKeyType="send"
            />
            <TouchableOpacity
              onPress={handleSendText}
              style={{
                backgroundColor: "#F5A623",
                width: 40,
                height: 40,
                borderRadius: 20,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700" }}>{"\u2191"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Controls */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: 20,
            paddingBottom: 24,
            paddingTop: 12,
            borderTopWidth: 0.5,
            borderTopColor: "rgba(255,255,255,0.08)",
          }}
        >
          {conversation.status === "idle" && (
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              {/* Glowing ring */}
              <Reanimated.View
                style={[
                  {
                    position: "absolute",
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    borderWidth: 2,
                    borderColor: "rgba(52,199,89,0.35)",
                  },
                  startRingAnimStyle,
                ]}
              />
              <TouchableOpacity
                onPress={handleStart}
                style={{
                  backgroundColor: "#34C759",
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  justifyContent: "center",
                  alignItems: "center",
                  shadowColor: "#34C759",
                  shadowOpacity: 0.5,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 10,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 32 }}>{"\u25B6"}</Text>
              </TouchableOpacity>
            </View>
          )}

          {conversation.status === "connecting" && (
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: "rgba(245, 166, 35, 0.3)",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#F5A623", fontSize: 14, fontWeight: "600" }}>Connecting</Text>
            </View>
          )}

          {conversation.status === "connected" && (
            <>
              {/* Keyboard toggle */}
              <TouchableOpacity
                onPress={() => setShowTextInput((v) => !v)}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: showTextInput ? "rgba(245,166,35,0.2)" : "rgba(255,255,255,0.1)",
                  borderWidth: 1,
                  borderColor: showTextInput ? "#F5A623" : "rgba(255,255,255,0.2)",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 22,
                    color: showTextInput ? "#F5A623" : "#FFFFFF",
                  }}
                >
                  {"\u2328"}
                </Text>
              </TouchableOpacity>

              {/* End button */}
              <TouchableOpacity
                onPress={handleEnd}
                style={{
                  backgroundColor: "#FF3B30",
                  width: 68,
                  height: 68,
                  borderRadius: 34,
                  justifyContent: "center",
                  alignItems: "center",
                  shadowColor: "#FF3B30",
                  shadowOpacity: 0.45,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 4 },
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "700" }}>
                  {"\u25A0"}
                </Text>
              </TouchableOpacity>

              {/* Transcript toggle */}
              <TouchableOpacity
                onPress={() => setViewMode((v) => (v === "transcript" ? "waveform" : "transcript"))}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor:
                    viewMode === "transcript" ? "rgba(245,166,35,0.2)" : "rgba(255,255,255,0.1)",
                  borderWidth: 1,
                  borderColor: viewMode === "transcript" ? "#F5A623" : "rgba(255,255,255,0.2)",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 22,
                    color: viewMode === "transcript" ? "#F5A623" : "#FFFFFF",
                  }}
                >
                  {"\u2261"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {conversation.status === "ended" && !feedbackVisible && (
            <TouchableOpacity
              onPress={() => router.back()}
              style={{
                backgroundColor: "#F5A623",
                borderRadius: 12,
                paddingHorizontal: 32,
                paddingVertical: 16,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>Done</Text>
            </TouchableOpacity>
          )}

          {conversation.status === "error" && (
            <View style={{ alignItems: "center" }}>
              <Text
                style={{
                  color: "#FF6B6B",
                  fontSize: 14,
                  textAlign: "center",
                  marginBottom: 12,
                  marginHorizontal: 32,
                }}
              >
                {conversation.error}
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={{
                    backgroundColor: "rgba(255,255,255,0.1)",
                    borderColor: "rgba(255,255,255,0.2)",
                    borderWidth: 1.5,
                    borderRadius: 24,
                    paddingHorizontal: 24,
                    paddingVertical: 12,
                  }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: "600" }}>
                    Back
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleStart}
                  style={{
                    backgroundColor: "rgba(245,166,35,0.15)",
                    borderColor: "#F5A623",
                    borderWidth: 1.5,
                    borderRadius: 24,
                    paddingHorizontal: 28,
                    paddingVertical: 12,
                  }}
                >
                  <Text style={{ color: "#F5A623", fontSize: 15, fontWeight: "700" }}>Retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Feedback Summary — bottom sheet style */}
        {feedbackVisible && conversation.status === "ended" && (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(8,18,35,0.92)",
              justifyContent: "flex-end",
            }}
          >
            <View
              style={{
                backgroundColor: "#122B4F",
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                paddingTop: 16,
                paddingHorizontal: 24,
                paddingBottom: 40,
                maxHeight: "78%",
              }}
            >
              {/* Drag handle */}
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "rgba(255,255,255,0.2)",
                  alignSelf: "center",
                  marginBottom: 20,
                }}
              />

              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "800",
                  color: "#FFFFFF",
                }}
              >
                Bilan de conversation
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: 16,
                  marginTop: 4,
                }}
              >
                {formatDuration(conversation.durationSeconds)} • {conversation.transcript.length}{" "}
                messages
              </Text>

              {/* Stat tiles */}
              <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
                <View
                  style={{
                    flex: 1,
                    backgroundColor: "rgba(255,255,255,0.07)",
                    borderRadius: 16,
                    padding: 16,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 28,
                      fontWeight: "800",
                      color: "#FFFFFF",
                    }}
                  >
                    {conversation.transcript.filter((t) => t.role === "user").length}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginTop: 4,
                    }}
                  >
                    Your turns
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    backgroundColor: "rgba(255,255,255,0.07)",
                    borderRadius: 16,
                    padding: 16,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 28,
                      fontWeight: "800",
                      color: "#F5A623",
                    }}
                  >
                    {conversation.allCorrections.length}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginTop: 4,
                    }}
                  >
                    Corrections
                  </Text>
                </View>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
                {/* AI Feedback Summary */}
                {conversation.feedback && (
                  <View
                    style={{
                      backgroundColor: "rgba(255,255,255,0.07)",
                      borderRadius: 16,
                      padding: 16,
                      marginBottom: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        color: "rgba(255,255,255,0.85)",
                        lineHeight: 20,
                        marginBottom: 12,
                      }}
                    >
                      {conversation.feedback.summary}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 16, marginBottom: 12 }}>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ fontSize: 22, fontWeight: "800", color: "#34C759" }}>
                          {conversation.feedback.fluencyRating}/5
                        </Text>
                        <Text
                          style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}
                        >
                          Fluency
                        </Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ fontSize: 22, fontWeight: "800", color: "#F5A623" }}>
                          {conversation.feedback.grammarRating}/5
                        </Text>
                        <Text
                          style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}
                        >
                          Grammar
                        </Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ fontSize: 22, fontWeight: "800", color: "#2196F3" }}>
                          {conversation.feedback.vocabularyUsed}
                        </Text>
                        <Text
                          style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}
                        >
                          Words
                        </Text>
                      </View>
                    </View>
                    {conversation.feedback.strengths.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: "#34C759",
                            marginBottom: 4,
                          }}
                        >
                          Strengths
                        </Text>
                        {conversation.feedback.strengths.map((s, i) => (
                          <Text
                            key={i}
                            style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 18 }}
                          >
                            + {s}
                          </Text>
                        ))}
                      </View>
                    )}
                    {conversation.feedback.improvements.length > 0 && (
                      <View>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: "#F5A623",
                            marginBottom: 4,
                          }}
                        >
                          Areas to improve
                        </Text>
                        {conversation.feedback.improvements.map((s, i) => (
                          <Text
                            key={i}
                            style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 18 }}
                          >
                            - {s}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {conversation.allCorrections.length > 0 ? (
                  <CorrectionBubble corrections={conversation.allCorrections} theme="dark" />
                ) : (
                  <View
                    style={{
                      backgroundColor: "rgba(52,199,89,0.12)",
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: "rgba(52,199,89,0.3)",
                      padding: 20,
                      marginVertical: 12,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: "700",
                        color: "#34C759",
                        textAlign: "center",
                      }}
                    >
                      Impeccable ! Aucune correction.
                    </Text>
                  </View>
                )}

                {/* Close button */}
                <TouchableOpacity
                  onPress={() => {
                    setFeedbackVisible(false);
                    router.back();
                  }}
                  style={{
                    backgroundColor: "#1E3A5F",
                    borderRadius: 16,
                    height: 52,
                    justifyContent: "center",
                    alignItems: "center",
                    marginTop: 20,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "700",
                      color: "#FFFFFF",
                    }}
                  >
                    Terminé
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
