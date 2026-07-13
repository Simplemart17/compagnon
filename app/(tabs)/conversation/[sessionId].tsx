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

import { useState, useCallback, useEffect, useRef } from "react";
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
import { useSessionFeedbackAggregate } from "@/src/hooks/use-session-feedback-aggregate";
import { useAuthStore } from "@/src/store/auth-store";
import { hapticLight, hapticMedium } from "@/src/lib/haptics";
import { retrieveMemories } from "@/src/lib/memory";
import { getTopErrors } from "@/src/lib/error-tracker";
import { MAX_PROMPT_ERROR_PATTERNS, MAX_PROMPT_MEMORIES } from "@/src/lib/prompts/conversation";
import { captureError } from "@/src/lib/sentry";
import { AIOrb, type AIOrbState } from "@/src/components/conversation/AIOrb";
import { AIOrbStatusLabel } from "@/src/components/conversation/AIOrbStatusLabel";
import { TranscriptView } from "@/src/components/conversation/TranscriptView";
import { CorrectionBubble } from "@/src/components/conversation/CorrectionBubble";
import { Icon } from "@/src/components/common/Icon";
import { SessionComparison } from "@/src/components/feedback/SessionComparison";
import { MilestoneBanner } from "@/src/components/feedback/MilestoneBanner";
import { ErrorJourneyBar } from "@/src/components/home/ErrorJourneyBar";
import type { ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors, Radii, Typography } from "@/src/lib/design";

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

/** Inline rating bar with animated fill */
function RatingBar({
  label,
  value,
  fillColor,
  isPersonalBest,
}: {
  label: string;
  value: number;
  fillColor: string;
  isPersonalBest: boolean;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming((clamped / 5) * 100, { duration: 600 });
  }, [clamped, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View
      accessible
      accessibilityRole="none"
      accessibilityLabel={`${label}: ${clamped} out of 5${isPersonalBest ? ", personal best" : ""}`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ ...Typography.caption, color: Colors.whiteAlpha85, fontWeight: "600" }}>
          {label}
        </Text>
        <Text style={{ ...Typography.caption, color: fillColor, fontWeight: "700" }}>
          {clamped}/5
        </Text>
      </View>
      <View
        style={{
          height: 8,
          backgroundColor: Colors.whiteAlpha08,
          borderRadius: Radii.chip,
          overflow: "hidden",
        }}
      >
        <Reanimated.View
          style={[
            {
              height: 8,
              backgroundColor: fillColor,
              borderRadius: Radii.chip,
            },
            fillStyle,
          ]}
        />
      </View>
      {isPersonalBest && (
        <Text
          style={{
            ...Typography.caption,
            color: Colors.success,
            marginTop: 4,
            fontWeight: "600",
          }}
        >
          Your best {label.toLowerCase()} score!
        </Text>
      )}
    </View>
  );
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
  const hasNavigatedDisconnect = useRef(false);
  // Story 13-3: the 4 pieces of feedback-aggregation state (comparisonMetrics,
  // milestone, errorJourney, nextAction) are now derived inside the
  // `useSessionFeedbackAggregate` hook below from a single RPC call instead
  // of 4 separate useEffect waterfalls / 6 round-trips. Closes audit P2-4.
  const [preConversationCefrLevel, setPreConversationCefrLevel] = useState<string | null>(null);
  const cefrCapturedRef = useRef(false);

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
        // Story 11-7: fetch caps mirror the prompt-injection caps in
        // `buildConversationPrompt`. Pulling more rows than the builder will
        // inject was wasted Supabase + pgvector work pre-11-7 (8+5 fetched →
        // 20-item-slice → 13 injected). Now 3+3 fetched → 3+3 injected.
        const [mems, errors] = await Promise.all([
          retrieveMemories(user.id, topic, MAX_PROMPT_MEMORIES).catch(() => []),
          getTopErrors(user.id, MAX_PROMPT_ERROR_PATTERNS).catch(() => []),
        ]);
        setMemories(mems);
        setErrorPatterns(errors.map((e) => `${e.error_type}: ${e.error_description}`));
      } catch (err) {
        captureError(err, "conversation-context-fetch");
      }
    })();
  }, [user?.id, topic]);

  // Capture CEFR level at conversation start for promotion detection
  useEffect(() => {
    if (profile?.current_cefr_level && !cefrCapturedRef.current) {
      setPreConversationCefrLevel(profile.current_cefr_level);
      cefrCapturedRef.current = true;
    }
  }, [profile?.current_cefr_level]);

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

  // Story 13-3: single chokepoint replacing the pre-13-3 4-effect waterfall
  // (~220 lines of inline session-comparison + milestone-detection + error-
  // journey + next-action logic). Closes audit P2-4. Server-side aggregate
  // returns max scalars instead of N JSONB rows; single COUNT(*) FILTER
  // atomic snapshot for error_counts (Story 13-2 P2 race-fix mirror);
  // server-side 21-day + 5-min cutoffs (pre-13-3 client-side filter-after-
  // fetch). Hook return shape byte-identical to the 4 pre-13-3 useState
  // pieces — the JSX consumer below doesn't change.
  const { comparisonMetrics, milestone, errorJourney, nextAction } = useSessionFeedbackAggregate({
    userId: user?.id,
    conversationId: conversation.conversationId,
    preConversationCefrLevel,
    currentFeedback: conversation.feedback,
    currentDurationSeconds: conversation.durationSeconds,
    allCorrections: conversation.allCorrections,
  });

  // Prevent accidental back navigation during active conversation
  useEffect(() => {
    if (
      conversation.status !== "connected" &&
      conversation.status !== "connecting" &&
      conversation.status !== "reconnecting"
    )
      return;

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
    conversation.status === "connected" ||
    conversation.status === "connecting" ||
    conversation.status === "reconnecting";

  // Extract first name for personalized header
  const firstName = profile?.full_name?.split(" ")[0] || "Learner";

  // Check if this session is a personal best for fluency or grammar
  const isFluencyBest =
    milestone?.type === "personal_best" && milestone.subtitle?.toLowerCase().includes("fluency");
  const isGrammarBest =
    milestone?.type === "personal_best" && milestone.subtitle?.toLowerCase().includes("grammar");

  // Auto-navigate to history on disconnection after 3 seconds
  useEffect(() => {
    if (conversation.status !== "disconnected") return;
    const timer = setTimeout(() => {
      if (!hasNavigatedDisconnect.current) {
        hasNavigatedDisconnect.current = true;
        router.replace({
          pathname: "/(tabs)/conversation/history",
          params: { highlight: conversation.conversationId ?? undefined },
        });
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [conversation.status, conversation.conversationId, router]);

  // Status dot color
  const statusDotColor =
    conversation.status === "connected"
      ? Colors.success
      : conversation.status === "connecting" || conversation.status === "reconnecting"
        ? Colors.accent
        : conversation.status === "error" || conversation.status === "disconnected"
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
                    : conversation.status === "reconnecting"
                      ? "Reconnecting..."
                      : conversation.status === "error"
                        ? "Error"
                        : conversation.status === "disconnected"
                          ? "Disconnected"
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
              {/* AIOrb: state-driven centerpiece. Compute the unified `orbState`
                  from the orchestrator's flags (connection → connecting,
                  AI-audio → ai-speaking, mic-VAD → listening, in-flight
                  AI request → processing, otherwise idle). Order matters —
                  connecting wins over everything, then ai-speaking (the
                  most user-visible AI moment), then listening, then
                  processing. */}
              {(() => {
                const orbState: AIOrbState =
                  conversation.status === "connecting" || conversation.status === "reconnecting"
                    ? "connecting"
                    : conversation.isAiSpeaking
                      ? "ai-speaking"
                      : conversation.isSpeaking
                        ? "listening"
                        : conversation.isProcessing
                          ? "processing"
                          : "idle";
                return (
                  <>
                    <AIOrb state={orbState} size={180} />
                    <AIOrbStatusLabel state={orbState} />
                  </>
                );
              })()}
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
          <View className="bg-white/[0.08] rounded-full px-4 py-2 mx-4 mb-3 flex-row items-center gap-2">
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
                  shadowOpacity: 0.5, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke start-conversation glow per Q6
                  shadowRadius: 20, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with start-conversation glow above
                  shadowOffset: { width: 0, height: 6 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
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

          {/* Reconnecting: transient auto-recovery window (Story 11-2, up to
              ~15.5s). Pre-fix this had NO controls branch — the header showed
              a misleading "Ready" and there was no End button (dead-end UX).
              Now surface the reconnect state + let the user bail out. */}
          {conversation.status === "reconnecting" && (
            <View className="items-center gap-3">
              <View className="rounded-full bg-accent/30 px-5 py-3 justify-center items-center">
                <Text className="text-accent text-sm font-semibold">Reconnecting…</Text>
              </View>
              <TouchableOpacity
                onPress={handleEnd}
                accessibilityRole="button"
                accessibilityLabel="End conversation"
                accessibilityHint="Double tap to end the current conversation"
                className="bg-error rounded-full px-6 py-3"
              >
                <Text className="text-white text-[15px] font-bold">End Conversation</Text>
              </TouchableOpacity>
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
                  shadowOpacity: 0.45, // eslint-disable-line no-restricted-syntax -- design-token-exempt: bespoke end-conversation glow per Q6
                  shadowRadius: 14, // eslint-disable-line no-restricted-syntax -- design-token-exempt: paired with end-conversation glow above
                  shadowOffset: { width: 0, height: 4 }, // design-token-exempt: paired with bespoke shadow above (Story 14-4 R1-P9)
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

          {conversation.status === "disconnected" && (
            <View className="items-center">
              <Text style={{ ...Typography.bigNumber, color: Colors.accent, marginBottom: 12 }}>
                !
              </Text>
              <Text
                style={{
                  ...Typography.body,
                  color: Colors.whiteAlpha85,
                  textAlign: "center",
                  marginBottom: 20,
                  marginHorizontal: 32,
                }}
              >
                Connection lost — your conversation has been saved
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (!hasNavigatedDisconnect.current) {
                    hasNavigatedDisconnect.current = true;
                    router.replace({
                      pathname: "/(tabs)/conversation/history",
                      params: { highlight: conversation.conversationId ?? undefined },
                    });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="View Transcript"
                accessibilityHint="Double tap to view your saved conversation"
                className="border-[1.5px] border-accent rounded-3xl px-7 py-3"
                style={{ backgroundColor: Colors.accent15, minWidth: 44, minHeight: 44 }}
              >
                <Text style={{ ...Typography.body, color: Colors.accent, fontWeight: "700" }}>
                  View Transcript
                </Text>
              </TouchableOpacity>
            </View>
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
                borderTopLeftRadius: Radii.heroBottom,
                borderTopRightRadius: Radii.heroBottom,
                maxHeight: "78%",
              }}
            >
              {/* Drag handle */}
              <View className="w-10 h-1 rounded-sm bg-white/20 self-center mb-5" />

              {/* Personalized header */}
              <Text style={{ ...Typography.subsectionHeader, color: Colors.textOnDark }}>
                Great Session, {firstName}!
              </Text>
              <Text
                style={{
                  ...Typography.caption,
                  color: Colors.whiteAlpha65,
                  marginTop: 4,
                  marginBottom: 16,
                }}
              >
                {formatDuration(conversation.durationSeconds)} • {conversation.transcript.length}{" "}
                exchanges
              </Text>

              {/* Stat tiles */}
              <View className="flex-row gap-3 mb-4">
                <View
                  accessible
                  accessibilityLabel={`Your turns: ${conversation.transcript.filter((t) => t.role === "user").length}`}
                  className="flex-1 p-4 items-center"
                  style={{
                    backgroundColor: Colors.whiteAlpha07,
                    borderRadius: Radii.card,
                  }}
                >
                  <Text style={{ ...Typography.statNumber, color: Colors.textOnDark }}>
                    {conversation.transcript.filter((t) => t.role === "user").length}
                  </Text>
                  <Text style={{ ...Typography.label, color: Colors.whiteAlpha65, marginTop: 4 }}>
                    Your turns
                  </Text>
                </View>
                <View
                  accessible
                  accessibilityLabel={`Corrections: ${conversation.allCorrections.length}`}
                  className="flex-1 p-4 items-center"
                  style={{
                    backgroundColor: Colors.whiteAlpha07,
                    borderRadius: Radii.card,
                  }}
                >
                  <Text style={{ ...Typography.statNumber, color: Colors.accent }}>
                    {conversation.allCorrections.length}
                  </Text>
                  <Text style={{ ...Typography.label, color: Colors.whiteAlpha65, marginTop: 4 }}>
                    Corrections
                  </Text>
                </View>
              </View>

              {/* AI feedback summary text */}
              {conversation.feedback && (
                <Text
                  style={{
                    ...Typography.bodySecondary,
                    color: Colors.whiteAlpha85,
                    marginBottom: 12,
                    lineHeight: 20,
                  }}
                >
                  {conversation.feedback.summary}
                </Text>
              )}

              <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
                {/* MilestoneBanner (if earned) */}
                {milestone && (
                  <View className="mb-3">
                    <MilestoneBanner {...milestone} />
                  </View>
                )}

                {/* Rating bars */}
                {conversation.feedback && (
                  <View
                    className="mb-3 p-4"
                    style={{
                      backgroundColor: Colors.whiteAlpha07,
                      borderRadius: Radii.card,
                    }}
                  >
                    {/* Fluency bar */}
                    <RatingBar
                      label="Fluency"
                      value={conversation.feedback.fluencyRating}
                      fillColor={Colors.success}
                      isPersonalBest={isFluencyBest}
                    />

                    {/* Grammar bar — Story 14-5 progress-cluster (data feedback, NOT a CTA) */}
                    <View style={{ marginTop: 12 }}>
                      <RatingBar
                        label="Grammar"
                        value={conversation.feedback.grammarRating}
                        fillColor={Colors.progress}
                        isPersonalBest={isGrammarBest}
                      />
                    </View>

                    {/* Vocabulary count */}
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 12,
                      }}
                    >
                      <Text
                        style={{
                          ...Typography.caption,
                          color: Colors.whiteAlpha85,
                          fontWeight: "600",
                        }}
                      >
                        Vocabulary
                      </Text>
                      <Text
                        style={{
                          ...Typography.caption,
                          color: Colors.skillListening,
                          fontWeight: "700",
                        }}
                      >
                        {conversation.feedback.vocabularyUsed} words
                      </Text>
                    </View>
                  </View>
                )}

                {/* SessionComparison (if applicable) */}
                {comparisonMetrics && (
                  <View className="mb-3">
                    <SessionComparison metrics={comparisonMetrics} />
                  </View>
                )}

                {/* "What We Noticed" observations */}
                {conversation.feedback &&
                  (conversation.feedback.strengths.length > 0 ||
                    conversation.feedback.improvements.length > 0 ||
                    milestone?.type === "error_resolved") && (
                    <View
                      className="mb-3"
                      style={{
                        backgroundColor: Colors.whiteAlpha07,
                        borderRadius: Radii.card,
                        padding: 16,
                      }}
                    >
                      <Text
                        style={{
                          ...Typography.label,
                          fontWeight: "700",
                          color: Colors.textOnDark,
                          marginBottom: 10,
                        }}
                      >
                        What We Noticed
                      </Text>

                      {/* Error resolution celebration */}
                      {milestone?.type === "error_resolved" && (
                        <Text
                          style={{
                            ...Typography.bodySecondary,
                            color: Colors.success,
                            marginBottom: 8,
                          }}
                        >
                          You used to struggle with {milestone.subtitle}. Not anymore!
                        </Text>
                      )}

                      {/* Strengths */}
                      {conversation.feedback.strengths.map((s, i) => (
                        <View key={`s-${i}`} style={{ flexDirection: "row", marginBottom: 4 }}>
                          <View style={{ marginRight: 6, marginTop: 2 }}>
                            <Icon name="check" size={14} color={Colors.success} />
                          </View>
                          <Text
                            style={{
                              ...Typography.bodySecondary,
                              color: Colors.whiteAlpha85,
                              flex: 1,
                            }}
                          >
                            {s}
                          </Text>
                        </View>
                      ))}

                      {/* Improvements */}
                      {conversation.feedback.improvements.map((s, i) => (
                        <View key={`i-${i}`} style={{ flexDirection: "row", marginBottom: 4 }}>
                          <Text style={{ color: Colors.accent, marginRight: 6 }}>→</Text>
                          <Text
                            style={{
                              ...Typography.bodySecondary,
                              color: Colors.whiteAlpha85,
                              flex: 1,
                            }}
                          >
                            {s}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                {/* Corrections or "Impeccable" message */}
                {conversation.allCorrections.length > 0 ? (
                  <View className="mb-3">
                    <CorrectionBubble corrections={conversation.allCorrections} />
                  </View>
                ) : (
                  <View
                    className="rounded-2xl border p-5 mb-3 items-center"
                    style={{
                      backgroundColor: Colors.success12,
                      borderColor: Colors.success30,
                    }}
                  >
                    <Text
                      style={{
                        ...Typography.cardTitle,
                        color: Colors.success,
                        textAlign: "center",
                      }}
                    >
                      Impeccable ! Aucune correction.
                    </Text>
                  </View>
                )}

                {/* ErrorJourneyBar */}
                {errorJourney != null && errorJourney.total > 0 && (
                  <View className="mb-3">
                    <ErrorJourneyBar
                      total={errorJourney.total}
                      resolved={errorJourney.resolved}
                      containerStyle={{
                        backgroundColor: Colors.whiteAlpha07,
                        borderRadius: Radii.card,
                      }}
                    />
                  </View>
                )}

                {/* Contextual next action button */}
                {nextAction && (
                  <TouchableOpacity
                    onPress={() => {
                      hapticLight();
                      router.push({
                        pathname: nextAction.route as "/(tabs)/practice/pronunciation",
                        params: nextAction.params,
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={nextAction.label}
                    accessibilityHint="Double tap to navigate to practice"
                    style={{
                      backgroundColor: Colors.accent,
                      borderRadius: Radii.button,
                      height: 52,
                      justifyContent: "center",
                      alignItems: "center",
                      marginTop: 8,
                    }}
                  >
                    <Text
                      style={{
                        ...Typography.cardTitle,
                        color: Colors.textOnDark,
                      }}
                    >
                      {nextAction.label}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Close text link */}
                <TouchableOpacity
                  onPress={() => {
                    setFeedbackVisible(false);
                    router.back();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Close feedback"
                  accessibilityHint="Double tap to close feedback and return to topics"
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 12,
                    minHeight: 44,
                  }}
                >
                  <Text style={{ ...Typography.bodySecondary, color: Colors.whiteAlpha65 }}>
                    Close
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
