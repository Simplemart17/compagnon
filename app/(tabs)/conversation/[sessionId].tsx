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
  StatusBar,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
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
import { hapticMedium } from "@/src/lib/haptics";
import { retrieveMemories } from "@/src/lib/memory";
import { getTopErrors } from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import { AudioWaveform } from "@/src/components/conversation/AudioWaveform";
import { TranscriptView } from "@/src/components/conversation/TranscriptView";
import { CorrectionBubble } from "@/src/components/conversation/CorrectionBubble";
import type { ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors } from "@/src/lib/design";

type ViewMode = "waveform" | "transcript";

/** Sanitize technical error messages into user-friendly strings. */
function sanitizeErrorMessage(error: string | null): string {
  if (!error) return "Something went wrong. Please try again.";

  const lower = error.toLowerCase();

  if (lower.includes("openai_api_key") || lower.includes("misconfiguration")) {
    return "Service temporarily unavailable. Please try again later.";
  }
  if (lower.includes("network") || lower.includes("offline")) {
    return "No internet connection. Please check your network.";
  }
  if (lower.includes("session expired") || lower.includes("sign in")) {
    return error;
  }
  if (lower.includes("timed out")) {
    return "Connection timed out. Please try again.";
  }
  if (error.trimStart().startsWith("{")) {
    return "Something went wrong. Please try again.";
  }

  return error;
}

function PendingAiCard({ text }: { text: string }) {
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <View className="bg-white/[0.08] rounded-2xl px-5 py-3 mx-7 mt-4">
      <Text
        className="text-[15px] leading-[22px] italic"
        style={{ color: "rgba(255,255,255,0.85)" }}
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
    voice: "coral",
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
    hapticMedium();
    await conversation.start();
  }, [conversation]);

  const handleEnd = useCallback(() => {
    hapticMedium();
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
    <SafeAreaView className="flex-1 bg-[#0D2240]">
      <StatusBar barStyle="light-content" />
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: conversation.status !== "connected",
        }}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Radial glow behind waveform area */}
        <View
          className="absolute rounded-full"
          style={{
            top: "20%",
            left: "50%",
            marginLeft: -130,
            width: 260,
            height: 260,
            backgroundColor: "rgba(30,58,95,0.5)",
          }}
          pointerEvents="none"
        />

        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3">
          {/* Back button */}
          <TouchableOpacity
            onPress={() => {
              if (conversation.status === "connected") {
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
                return;
              }
              router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="w-10 h-10 rounded-full bg-white/10 border border-white/15 justify-center items-center"
          >
            <Text className="text-lg text-white">{"\u2190"}</Text>
          </TouchableOpacity>

          {/* Center: topic + status */}
          <View className="flex-1 items-center px-2">
            <Text className="text-[15px] font-bold text-white" numberOfLines={1}>
              {topic}
            </Text>
            <View className="flex-row items-center gap-[5px] mt-[3px]">
              <View
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: statusDotColor }}
              />
              <Text className="text-[11px] text-white/[0.55]">
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
          <View className="bg-white/[0.08] rounded-[20px] p-[3px] flex-row">
            {(["waveform", "transcript"] as ViewMode[]).map((segMode) => {
              const isActive = viewMode === segMode;
              return (
                <TouchableOpacity
                  key={segMode}
                  onPress={() => setViewMode(segMode)}
                  className="px-2.5 py-[5px] rounded-[17px]"
                  style={{
                    backgroundColor: isActive ? "rgba(255,255,255,0.18)" : "transparent",
                  }}
                >
                  <Text
                    className="text-[11px]"
                    style={{
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
        <View className="items-center mb-2">
          <View className="bg-accent/[0.08] rounded-xl py-1.5 px-4 mx-8">
            <Text className="text-[13px] font-semibold text-accent text-center">{topic}</Text>
          </View>
        </View>

        {/* Main Content Area */}
        <View className="flex-1">
          {viewMode === "waveform" ? (
            <View className="flex-1 justify-center items-center">
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
                <View className="items-center mt-6">
                  <Text
                    className="text-xl font-semibold italic text-center"
                    style={{
                      color: statusContent.dimMain ? "rgba(255,255,255,0.55)" : "#FFFFFF",
                    }}
                  >
                    {statusContent.main}
                  </Text>
                  {statusContent.sub.length > 0 && (
                    <Text className="text-[13px] text-white/[0.45] mt-1 text-center">
                      {statusContent.sub}
                    </Text>
                  )}
                </View>
              )}

              {/* Streaming AI text preview */}
              {conversation.pendingAiText.length > 0 && (
                <PendingAiCard text={conversation.pendingAiText} />
              )}

              {/* Recent corrections overlay -- absolute above controls */}
              {conversation.allCorrections.length > 0 && (
                <View className="absolute bottom-[100px] left-4 right-4">
                  <CorrectionBubble corrections={conversation.allCorrections.slice(-2)} compact />
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
          <View className="bg-white/[0.08] rounded-[28px] px-4 py-2 mx-4 mb-3 flex-row items-center gap-2">
            <TextInput
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Type in French..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Type a message in French"
              accessibilityHint="Type your message and press send"
              style={{
                flex: 1,
                color: Colors.textOnDark,
                fontSize: 15,
                paddingVertical: 4,
              }}
              onSubmitEditing={handleSendText}
              returnKeyType="send"
            />
            <TouchableOpacity
              onPress={handleSendText}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              className="bg-accent w-10 h-10 rounded-full justify-center items-center"
            >
              <Text className="text-white text-lg font-bold">{"\u2191"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Controls */}
        <View
          className="flex-row justify-center items-center gap-5 pb-6 pt-3"
          style={{ borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.08)" }}
        >
          {conversation.status === "idle" && (
            <View className="items-center justify-center">
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
                accessibilityRole="button"
                accessibilityLabel="Start conversation"
                accessibilityHint="Double tap to begin voice conversation"
                className="bg-success w-20 h-20 rounded-full justify-center items-center"
                style={{
                  shadowColor: Colors.success,
                  shadowOpacity: 0.5,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 10,
                }}
              >
                <Text className="text-white text-[32px]">{"\u25B6"}</Text>
              </TouchableOpacity>
            </View>
          )}

          {conversation.status === "connecting" && (
            <View className="w-20 h-20 rounded-full bg-accent/30 justify-center items-center">
              <Text className="text-accent text-sm font-semibold">Connecting</Text>
            </View>
          )}

          {conversation.status === "connected" && (
            <>
              {/* Keyboard toggle */}
              <TouchableOpacity
                onPress={() => setShowTextInput((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showTextInput ? "Hide text input" : "Show text input"}
                accessibilityState={{ expanded: showTextInput }}
                className="w-[52px] h-[52px] rounded-full justify-center items-center"
                style={{
                  backgroundColor: showTextInput ? "rgba(245,166,35,0.2)" : "rgba(255,255,255,0.1)",
                  borderWidth: 1,
                  borderColor: showTextInput ? "#F5A623" : "rgba(255,255,255,0.2)",
                }}
              >
                <Text
                  className="text-[22px]"
                  style={{ color: showTextInput ? "#F5A623" : "#FFFFFF" }}
                >
                  {"\u2328"}
                </Text>
              </TouchableOpacity>

              {/* End button */}
              <TouchableOpacity
                onPress={handleEnd}
                accessibilityRole="button"
                accessibilityLabel="End conversation"
                className="bg-error w-[68px] h-[68px] rounded-full justify-center items-center"
                style={{
                  shadowColor: Colors.error,
                  shadowOpacity: 0.45,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 8,
                }}
              >
                <Text className="text-white text-2xl font-bold">{"\u25A0"}</Text>
              </TouchableOpacity>

              {/* Transcript toggle */}
              <TouchableOpacity
                onPress={() => setViewMode((v) => (v === "transcript" ? "waveform" : "transcript"))}
                className="w-[52px] h-[52px] rounded-full justify-center items-center"
                style={{
                  backgroundColor:
                    viewMode === "transcript" ? "rgba(245,166,35,0.2)" : "rgba(255,255,255,0.1)",
                  borderWidth: 1,
                  borderColor: viewMode === "transcript" ? "#F5A623" : "rgba(255,255,255,0.2)",
                }}
              >
                <Text
                  className="text-[22px]"
                  style={{ color: viewMode === "transcript" ? "#F5A623" : "#FFFFFF" }}
                >
                  {"\u2261"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {conversation.status === "ended" && !feedbackVisible && (
            <TouchableOpacity
              onPress={() => router.back()}
              className="bg-accent rounded-xl px-8 py-4"
            >
              <Text className="text-white text-base font-bold">Done</Text>
            </TouchableOpacity>
          )}

          {conversation.status === "error" && (
            <View className="items-center">
              <Text className="text-error text-sm text-center mb-3 mx-8">
                {sanitizeErrorMessage(conversation.error)}
              </Text>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => router.back()}
                  className="bg-white/10 border-[1.5px] border-white/20 rounded-3xl px-6 py-3"
                >
                  <Text className="text-white/80 text-[15px] font-semibold">Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleStart}
                  className="border-[1.5px] border-accent rounded-3xl px-7 py-3"
                  style={{ backgroundColor: "rgba(245,166,35,0.15)" }}
                >
                  <Text className="text-accent text-[15px] font-bold">Retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Feedback Summary -- bottom sheet style */}
        {feedbackVisible && conversation.status === "ended" && (
          <View
            className="absolute top-0 left-0 right-0 bottom-0 justify-end"
            style={{ backgroundColor: "rgba(8,18,35,0.92)" }}
          >
            <View
              className="bg-[#152B48] pt-4 px-6 pb-10"
              style={{
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                maxHeight: "78%",
              }}
            >
              {/* Drag handle */}
              <View className="w-10 h-1 rounded-sm bg-white/20 self-center mb-5" />

              <Text className="text-[22px] font-extrabold text-white">Bilan de conversation</Text>
              <Text className="text-[13px] text-white/[0.65] mb-4 mt-1">
                {formatDuration(conversation.durationSeconds)} • {conversation.transcript.length}{" "}
                messages
              </Text>

              {/* Stat tiles */}
              <View className="flex-row gap-3 mb-4">
                <View className="flex-1 bg-white/[0.07] rounded-2xl p-4 items-center">
                  <Text className="text-[28px] font-extrabold text-white">
                    {conversation.transcript.filter((t) => t.role === "user").length}
                  </Text>
                  <Text className="text-[11px] text-white/[0.65] mt-1">Your turns</Text>
                </View>
                <View className="flex-1 bg-white/[0.07] rounded-2xl p-4 items-center">
                  <Text className="text-[28px] font-extrabold text-accent">
                    {conversation.allCorrections.length}
                  </Text>
                  <Text className="text-[11px] text-white/[0.65] mt-1">Corrections</Text>
                </View>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
                {/* AI Feedback Summary */}
                {conversation.feedback && (
                  <View className="bg-white/[0.07] rounded-2xl p-4 mb-3">
                    <Text
                      className="text-sm leading-5 mb-3"
                      style={{ color: "rgba(255,255,255,0.85)" }}
                    >
                      {conversation.feedback.summary}
                    </Text>
                    <View className="flex-row gap-4 mb-3">
                      <View className="flex-1 items-center">
                        <Text className="text-[22px] font-extrabold text-success">
                          {conversation.feedback.fluencyRating}/5
                        </Text>
                        <Text className="text-[10px] text-white/[0.65] mt-0.5">Fluency</Text>
                      </View>
                      <View className="flex-1 items-center">
                        <Text className="text-[22px] font-extrabold text-accent">
                          {conversation.feedback.grammarRating}/5
                        </Text>
                        <Text className="text-[10px] text-white/[0.65] mt-0.5">Grammar</Text>
                      </View>
                      <View className="flex-1 items-center">
                        <Text className="text-[22px] font-extrabold text-[#3B82F6]">
                          {conversation.feedback.vocabularyUsed}
                        </Text>
                        <Text className="text-[10px] text-white/[0.65] mt-0.5">Words</Text>
                      </View>
                    </View>
                    {conversation.feedback.strengths.length > 0 && (
                      <View className="mb-2">
                        <Text className="text-xs font-bold text-success mb-1">Strengths</Text>
                        {conversation.feedback.strengths.map((s, i) => (
                          <Text key={i} className="text-xs text-white/70 leading-[18px]">
                            + {s}
                          </Text>
                        ))}
                      </View>
                    )}
                    {conversation.feedback.improvements.length > 0 && (
                      <View>
                        <Text className="text-xs font-bold text-accent mb-1">Areas to improve</Text>
                        {conversation.feedback.improvements.map((s, i) => (
                          <Text key={i} className="text-xs text-white/70 leading-[18px]">
                            - {s}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {conversation.allCorrections.length > 0 ? (
                  <CorrectionBubble corrections={conversation.allCorrections} />
                ) : (
                  <View
                    className="rounded-2xl border p-5 my-3 items-center"
                    style={{
                      backgroundColor: "rgba(52,199,89,0.12)",
                      borderColor: "rgba(52,199,89,0.3)",
                    }}
                  >
                    <Text className="text-[17px] font-bold text-success text-center">
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
                  className="bg-primary rounded-xl h-[52px] justify-center items-center mt-5"
                >
                  <Text className="text-base font-bold text-white">Terminé</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
