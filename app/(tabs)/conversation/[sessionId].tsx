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
import { useAuthStore } from "@/src/store/auth-store";
import { hapticLight, hapticMedium } from "@/src/lib/haptics";
import { retrieveMemories } from "@/src/lib/memory";
import { getTopErrors } from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";
import { AudioWaveform } from "@/src/components/conversation/AudioWaveform";
import { TranscriptView } from "@/src/components/conversation/TranscriptView";
import { CorrectionBubble } from "@/src/components/conversation/CorrectionBubble";
import { ProcessingIndicator } from "@/src/components/conversation/ProcessingIndicator";
import {
  SessionComparison,
  type SessionComparisonMetric,
} from "@/src/components/feedback/SessionComparison";
import {
  MilestoneBanner,
  type MilestoneBannerProps,
} from "@/src/components/feedback/MilestoneBanner";
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
  const [comparisonMetrics, setComparisonMetrics] = useState<SessionComparisonMetric[] | null>(
    null
  );
  const [milestone, setMilestone] = useState<MilestoneBannerProps | null>(null);
  const [errorJourney, setErrorJourney] = useState<{ total: number; resolved: number } | null>(
    null
  );
  const [nextAction, setNextAction] = useState<{
    label: string;
    route: string;
    params?: Record<string, string>;
  } | null>(null);
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

  // Fetch previous session for comparison when feedback becomes available
  useEffect(() => {
    if (!conversation.feedback || !conversation.conversationId || !user?.id) return;

    const currentConversationId = conversation.conversationId;
    const currentFeedback = conversation.feedback;

    void (async () => {
      try {
        const { data: prev } = await supabase
          .from("conversations")
          .select("ai_feedback, duration_seconds, completed_at")
          .eq("user_id", user.id)
          .eq("status", "completed")
          .neq("id", currentConversationId)
          .order("completed_at", { ascending: false })
          .limit(1)
          .single();

        if (!prev) {
          setComparisonMetrics(null);
          return;
        }

        // Hide comparison if previous session was > 21 days ago (3+ weeks absence)
        if (prev.completed_at) {
          const daysSince =
            (Date.now() - new Date(prev.completed_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince > 21) {
            setComparisonMetrics(null);
            return;
          }
        }

        const prevFeedback = prev.ai_feedback as {
          fluencyRating?: number;
          grammarRating?: number;
        } | null;

        if (prevFeedback?.fluencyRating == null || prevFeedback?.grammarRating == null) {
          setComparisonMetrics(null);
          return;
        }

        const direction = (current: number, previous: number): "up" | "down" | "same" =>
          current > previous ? "up" : current < previous ? "down" : "same";

        const formatMinutes = (seconds: number): string => {
          const m = Math.round(seconds / 60);
          return m < 1 ? "< 1m" : `${m}m`;
        };

        setComparisonMetrics([
          {
            label: "Fluency",
            previous: `${prevFeedback.fluencyRating}/5`,
            current: `${currentFeedback.fluencyRating}/5`,
            direction: direction(currentFeedback.fluencyRating, prevFeedback.fluencyRating),
          },
          {
            label: "Grammar",
            previous: `${prevFeedback.grammarRating}/5`,
            current: `${currentFeedback.grammarRating}/5`,
            direction: direction(currentFeedback.grammarRating, prevFeedback.grammarRating),
          },
          {
            label: "Duration",
            previous: formatMinutes(prev.duration_seconds ?? 0),
            current: formatMinutes(conversation.durationSeconds),
            direction: direction(conversation.durationSeconds, prev.duration_seconds ?? 0),
          },
        ]);
      } catch (err) {
        captureError(err, "session-comparison-fetch");
        setComparisonMetrics(null);
      }
    })();
  }, [conversation.feedback, conversation.conversationId, conversation.durationSeconds, user?.id]);

  // Detect milestones (personal best, error resolution, CEFR promotion) when feedback arrives
  useEffect(() => {
    if (!conversation.feedback || !conversation.conversationId || !user?.id) return;

    const currentConversationId = conversation.conversationId;
    const currentFeedback = conversation.feedback;

    void (async () => {
      try {
        // --- CEFR promotion detection (highest priority) ---
        if (preConversationCefrLevel) {
          const { data: updatedProfile } = await supabase
            .from("profiles")
            .select("current_cefr_level")
            .eq("id", user.id)
            .single();

          if (updatedProfile && updatedProfile.current_cefr_level !== preConversationCefrLevel) {
            setMilestone({
              icon: "\uD83C\uDF1F",
              title: "CEFR Promotion!",
              subtitle: `Welcome to ${updatedProfile.current_cefr_level}!`,
              type: "cefr_promotion",
            });
            return;
          }
        }

        // --- Personal best detection (second priority) ---
        const { data: allPrev } = await supabase
          .from("conversations")
          .select("ai_feedback")
          .eq("user_id", user.id)
          .eq("status", "completed")
          .neq("id", currentConversationId);

        if (allPrev && allPrev.length > 0) {
          let maxFluency = 0;
          let maxGrammar = 0;

          for (const row of allPrev) {
            const fb = row.ai_feedback as {
              fluencyRating?: number;
              grammarRating?: number;
            } | null;
            if (fb?.fluencyRating != null && fb.fluencyRating > maxFluency) {
              maxFluency = fb.fluencyRating;
            }
            if (fb?.grammarRating != null && fb.grammarRating > maxGrammar) {
              maxGrammar = fb.grammarRating;
            }
          }

          const fluencyBest = currentFeedback.fluencyRating > maxFluency && maxFluency > 0;
          const grammarBest = currentFeedback.grammarRating > maxGrammar && maxGrammar > 0;

          if (fluencyBest || grammarBest) {
            const subtitle =
              fluencyBest && grammarBest
                ? `Fluency ${currentFeedback.fluencyRating}/5 & Grammar ${currentFeedback.grammarRating}/5`
                : fluencyBest
                  ? `Your best fluency score: ${currentFeedback.fluencyRating}/5`
                  : `Your best grammar score: ${currentFeedback.grammarRating}/5`;
            setMilestone({
              icon: "\uD83C\uDFC6",
              title: "New Personal Best!",
              subtitle,
              type: "personal_best",
            });
            return;
          }
        }

        // --- Error resolution detection (third priority) ---
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: resolvedErrors } = await supabase
          .from("error_patterns")
          .select("error_description")
          .eq("user_id", user.id)
          .eq("resolved", true)
          .gte("last_occurred", fiveMinutesAgo)
          .order("last_occurred", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (resolvedErrors) {
          setMilestone({
            icon: "\uD83C\uDFAF",
            title: "Pattern Resolved!",
            subtitle: resolvedErrors.error_description,
            type: "error_resolved",
          });
          return;
        }

        setMilestone(null);
      } catch (err) {
        captureError(err, "milestone-detection");
        setMilestone(null);
      }
    })();
  }, [conversation.feedback, conversation.conversationId, user?.id, preConversationCefrLevel]);

  // Fetch error journey counts when feedback arrives
  useEffect(() => {
    if (!conversation.feedback || !user?.id) return;

    void (async () => {
      try {
        const { count: totalCount, error: totalError } = await supabase
          .from("error_patterns")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id);

        if (totalError) {
          captureError(totalError, "error-journey-total-query");
          setErrorJourney(null);
          return;
        }

        if (totalCount == null || totalCount === 0) {
          setErrorJourney(null);
          return;
        }

        const { count: resolvedCount, error: resolvedError } = await supabase
          .from("error_patterns")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("resolved", true);

        if (resolvedError) {
          captureError(resolvedError, "error-journey-resolved-query");
        }

        setErrorJourney({ total: totalCount, resolved: resolvedCount ?? 0 });
      } catch (err) {
        captureError(err, "error-journey-fetch");
        setErrorJourney(null);
      }
    })();
  }, [conversation.feedback, user?.id]);

  // Derive contextual next action from feedback
  useEffect(() => {
    if (!conversation.feedback) return;

    const corrections = conversation.allCorrections ?? [];

    // Count correction categories for structured matching
    const categoryCounts = { pronunciation: 0, grammar: 0, vocabulary: 0, register: 0 };
    for (const c of corrections) {
      if (typeof c !== "string" && c.category) {
        categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
      }
    }

    // Also check improvements text for keywords (covers cases without structured corrections)
    const improvementsText = (conversation.feedback.improvements ?? []).join(" ").toLowerCase();

    if (
      categoryCounts.pronunciation > 0 ||
      improvementsText.includes("prononciation") ||
      improvementsText.includes("pronunciation") ||
      improvementsText.includes("accent")
    ) {
      setNextAction({ label: "Practice Pronunciation", route: "/(tabs)/practice/pronunciation" });
    } else if (
      categoryCounts.grammar > 0 ||
      improvementsText.includes("grammar") ||
      improvementsText.includes("grammaire")
    ) {
      const firstGrammarError = corrections.find(
        (c) => typeof c !== "string" && c.category === "grammar"
      );
      setNextAction({
        label: "Review Grammar",
        route: "/(tabs)/practice/grammar",
        params:
          firstGrammarError && typeof firstGrammarError !== "string"
            ? { errorType: firstGrammarError.explanation }
            : undefined,
      });
    } else if (categoryCounts.vocabulary > 0 || improvementsText.includes("vocabul")) {
      setNextAction({ label: "Review Vocabulary", route: "/(tabs)/practice/vocabulary" });
    } else {
      setNextAction({ label: "Continue Practicing", route: "/(tabs)/practice" });
    }
  }, [conversation.feedback, conversation.allCorrections]);

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
      : conversation.status === "connecting"
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

                    {/* Grammar bar */}
                    <View style={{ marginTop: 12 }}>
                      <RatingBar
                        label="Grammar"
                        value={conversation.feedback.grammarRating}
                        fillColor={Colors.accent}
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
                          <Text style={{ color: Colors.success, marginRight: 6 }}>✓</Text>
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
