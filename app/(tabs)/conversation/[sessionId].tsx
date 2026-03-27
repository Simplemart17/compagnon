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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { ProcessingIndicator } from "@/src/components/conversation/ProcessingIndicator";
import type { ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors } from "@/src/lib/design";

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
  if (lower.includes("invalid_request_error") || lower.includes("session.audio")) {
    return "Service configuration error. Please try again.";
  }
  if (error.trimStart().startsWith("{")) {
    return "Something went wrong. Please try again.";
  }

  return error;
}

export default function ConversationSessionScreen() {
  const { sessionId, mode: modeParam } = useLocalSearchParams<{
    sessionId: string;
    mode: string;
  }>();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);

  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  const insets = useSafeAreaInsets();
  const rawSessionId = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const rawMode = Array.isArray(modeParam) ? modeParam[0] : modeParam;
  const topic = decodeURIComponent(rawSessionId ?? "Free conversation");
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  const mode: ConversationMode =
    rawMode === "debate" || rawMode === "tcf_simulation" ? rawMode : "companion";
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
    if (conversation.status !== "connected" && conversation.status !== "connecting") return;

    const onBackPress = () => {
      Alert.alert("Leave this conversation?", "Leave this conversation? It will be saved.", [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            hapticMedium();
            conversation.end();
            router.back();
          },
        },
      ]);
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
    if (conversation.durationSeconds < 60) {
      Alert.alert(
        "End conversation?",
        "You\u2019ve been speaking for less than a minute. Are you sure you want to end?",
        [
          { text: "Continue", style: "cancel" },
          {
            text: "End",
            style: "destructive",
            onPress: () => {
              hapticMedium();
              conversation.end();
            },
          },
        ]
      );
      return;
    }
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

  const isConversationActive =
    conversation.status === "connected" || conversation.status === "connecting";

  // Status dot color
  const statusDotColor =
    conversation.status === "connected"
      ? Colors.success
      : conversation.status === "connecting"
        ? Colors.accent
        : conversation.status === "error"
          ? Colors.error
          : Colors.whiteAlpha30;

  return (
    <View
      className="flex-1"
      style={{
        backgroundColor: Colors.bgDark,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <StatusBar barStyle="light-content" />
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: !isConversationActive,
        }}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3">
          {/* Back button */}
          <TouchableOpacity
            onPress={() => {
              if (isConversationActive) {
                Alert.alert(
                  "Leave this conversation?",
                  "Leave this conversation? It will be saved.",
                  [
                    { text: "Stay", style: "cancel" },
                    {
                      text: "Leave",
                      style: "destructive",
                      onPress: () => {
                        hapticMedium();
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
            accessibilityHint="Double tap to leave this conversation"
            className="w-11 h-11 rounded-full bg-white/10 border border-white/15 justify-center items-center"
          >
            <Text className="text-lg text-white">{"\u276E"}</Text>
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

          {/* Spacer to balance the back button */}
          <View className="w-11 h-11" />
        </View>

        {/* Main Content Area — layout depends on conversation state */}
        {isConversationActive ? (
          <>
            {/* Waveform-centered layout: condensed transcript + large waveform */}
            <TranscriptView
              transcript={conversation.transcript}
              pendingAiText={conversation.pendingAiText}
              isAiSpeaking={conversation.isAiSpeaking}
              condensed
            />

            <View className="flex-1 items-center justify-center">
              <AudioWaveform
                isActive={
                  conversation.isSpeaking || conversation.isAiSpeaking || conversation.isProcessing
                }
                speaker={
                  conversation.status === "connecting"
                    ? undefined
                    : conversation.isSpeaking
                      ? "user"
                      : conversation.isProcessing
                        ? "processing"
                        : conversation.isAiSpeaking
                          ? "ai"
                          : "idle"
                }
                isConnecting={conversation.status === "connecting"}
                size={140}
              />
              <ProcessingIndicator
                isVisible={conversation.isProcessing || conversation.status === "connecting"}
                label={
                  conversation.status === "connecting"
                    ? "Setting up your conversation..."
                    : undefined
                }
              />
            </View>
          </>
        ) : (
          /* Default layout: full transcript dominant */
          <View className="flex-1">
            <TranscriptView
              transcript={conversation.transcript}
              pendingAiText={conversation.pendingAiText}
              isAiSpeaking={conversation.isAiSpeaking}
            />
          </View>
        )}

        {/* Text Input — between waveform area and bottom controls */}
        {showTextInput && conversation.status === "connected" && (
          <View className="bg-white/[0.08] rounded-[28px] px-4 py-2 mx-4 mb-3 flex-row items-center gap-2">
            <TextInput
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Type in French..."
              placeholderTextColor={Colors.whiteAlpha35}
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
              accessibilityHint="Double tap to send your typed message"
              className="bg-accent w-11 h-11 rounded-full justify-center items-center"
            >
              <Text className="text-white text-lg font-bold">{"\u2191"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Controls */}
        <View
          className="flex-row justify-center items-center gap-5 pb-6 pt-3"
          style={{ borderTopWidth: 0.5, borderTopColor: Colors.whiteAlpha08 }}
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
                    borderColor: Colors.success35,
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
                accessibilityHint="Double tap to toggle the text input field"
                accessibilityState={{ expanded: showTextInput }}
                className="w-[52px] h-[52px] rounded-full justify-center items-center"
                style={{
                  backgroundColor: showTextInput ? Colors.accent20 : Colors.whiteAlpha10,
                  borderWidth: 1,
                  borderColor: showTextInput ? Colors.accent : Colors.whiteAlpha20,
                }}
              >
                <Text
                  className="text-[22px]"
                  style={{ color: showTextInput ? Colors.accent : Colors.textOnDark }}
                >
                  {"\u2328"}
                </Text>
              </TouchableOpacity>

              {/* End conversation pill button */}
              <TouchableOpacity
                onPress={handleEnd}
                accessibilityRole="button"
                accessibilityLabel="End conversation"
                accessibilityHint="Double tap to end the current conversation"
                className="bg-error rounded-full px-6 py-3"
                style={{
                  shadowColor: Colors.error,
                  shadowOpacity: 0.45,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 8,
                }}
              >
                <Text className="text-white text-[15px] font-bold">End Conversation</Text>
              </TouchableOpacity>
            </>
          )}

          {conversation.status === "ended" && !feedbackVisible && (
            <TouchableOpacity
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Done"
              accessibilityHint="Double tap to return to topics"
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
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  accessibilityHint="Double tap to return to topics"
                  className="bg-white/10 border-[1.5px] border-white/20 rounded-3xl px-6 py-3"
                >
                  <Text className="text-white/80 text-[15px] font-semibold">Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleStart}
                  accessibilityRole="button"
                  accessibilityLabel="Retry connection"
                  accessibilityHint="Double tap to try starting the conversation again"
                  className="border-[1.5px] border-accent rounded-3xl px-7 py-3"
                  style={{ backgroundColor: Colors.accent15 }}
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
            style={{ backgroundColor: Colors.bgDarkOverlay }}
          >
            <View
              className="pt-4 px-6 pb-10"
              style={{
                backgroundColor: Colors.bgDarkCard,
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
                    <Text className="text-sm leading-5 mb-3" style={{ color: Colors.whiteAlpha85 }}>
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
                        <Text
                          className="text-[22px] font-extrabold"
                          style={{ color: Colors.skillListening }}
                        >
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
                      backgroundColor: Colors.success12,
                      borderColor: Colors.success30,
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
                  accessibilityRole="button"
                  accessibilityLabel="Finished"
                  accessibilityHint="Double tap to close feedback and return to topics"
                  className="bg-primary rounded-xl h-[52px] justify-center items-center mt-5"
                >
                  <Text className="text-base font-bold text-white">Terminé</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
