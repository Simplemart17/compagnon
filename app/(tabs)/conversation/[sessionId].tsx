/**
 * Active Voice Conversation Screen
 *
 * Full-screen voice conversation with:
 * - Expressive companion avatar (state-driven, audio-amplitude mouth — Story 18-4)
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
  ActivityIndicator,
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
import { AvatarStatusLabel, CompanionAvatar } from "@/src/components/conversation/CompanionAvatar";
import { deriveAvatarState } from "@/src/lib/avatar-state";
import { getLesson } from "@/src/lib/curriculum";
import { markLessonCompleted } from "@/src/lib/lesson-progress";
import { SessionGoalChip } from "@/src/components/conversation/SessionGoalChip";
import { TranscriptView } from "@/src/components/conversation/TranscriptView";
import { CorrectionBubble } from "@/src/components/conversation/CorrectionBubble";
import { Icon } from "@/src/components/common/Icon";
import { SessionComparison } from "@/src/components/feedback/SessionComparison";
import { MilestoneBanner } from "@/src/components/feedback/MilestoneBanner";
import { ErrorJourneyBar } from "@/src/components/home/ErrorJourneyBar";
import type { ConversationMode } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import { ANALYTICS_EVENTS, trackEvent } from "@/src/lib/analytics";
import { FEATURE_FLAGS, isFeatureEnabled } from "@/src/lib/feature-flags";
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
  const {
    sessionId,
    mode: modeParam,
    lessonId: lessonIdParam,
  } = useLocalSearchParams<{
    sessionId: string;
    mode: string;
    lessonId?: string;
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
  // Review R1 (pre-existing hardening, fixed while touching the file): a
  // malformed deep link with a dangling '%' makes decodeURIComponent throw
  // at render, crashing the screen to the error boundary. Fall back to the
  // raw segment — a percent-garbled topic beats a dead screen.
  const topic = (() => {
    const raw = rawSessionId ?? "Free conversation";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;
  // Story 18-2 review R1: the correction-explanation default must NOT see
  // the "A1" coercion above (it would invert the language policy for B1+
  // users while the profile hydrates). Pass the raw level — undefined means
  // "not yet known" and defaults to French per
  // defaultCorrectionExplanationLanguage's contract; the bubble re-derives
  // when the profile arrives.
  const correctionCefrLevel = profile?.current_cefr_level as CEFRLevel | undefined;
  const mode: ConversationMode =
    rawMode === "debate" || rawMode === "tcf_simulation" ? rawMode : "companion";
  // Story 19-2: when launched from the lesson player, the lesson's scenario
  // steers the session — promptSeed rides the existing topicDescription
  // channel into buildConversationPrompt's Context line, goalEn overrides
  // the SessionGoalChip, and finishing the session completes the lesson.
  const rawLessonId = Array.isArray(lessonIdParam) ? lessonIdParam[0] : lessonIdParam;
  const lesson = rawLessonId ? getLesson(rawLessonId) : undefined;
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

  // Story 18-4: AI output-audio level for the avatar mouth. Written by the
  // orchestrator at audio-delta cadence — a Reanimated SharedValue, NEVER
  // React state (Story 13-1 render-storm contract). The closure below is
  // captured once at orchestrator construction; the shared value's identity
  // is stable, so the first-render capture is safe.
  const aiAmplitude = useSharedValue(0);

  const conversation = useRealtimeVoice({
    cefrLevel,
    mode,
    topic,
    topicDescription: lesson?.conversationScenario.promptSeed,
    memories,
    errorPatterns,
    voice: "coral",
    onConversationEnd: () => {
      setFeedbackVisible(true);
    },
    onAudioAmplitude: (level) => {
      aiAmplitude.value = level;
    },
  });

  // Story 21-2 R1: session analytics keyed on ORCHESTRATOR STATUS
  // transitions — the single source of truth for the conversation
  // lifecycle:
  //   - started fires on the transition INTO "connected" (once per
  //     session) — NOT before start(), which overcounted by the connect-
  //     failure/retry rate and contradicted the taxonomy doc;
  //   - completed fires on EITHER terminal state: "ended" (user end) or
  //     "disconnected" (reconnect exhaustion — the orchestrator persists
  //     the full conversation on that path too, so analytics must match
  //     the DB boundary or the funnel diverges from ground truth for
  //     exactly the poor-network cohort).
  // Deps are status-only (13-4 P19 precedent): duration/corrections are
  // read at fire time; ticking deps would re-run the effect every second.
  const hasTrackedStartRef = useRef(false);
  const hasTrackedCompletionRef = useRef(false);
  useEffect(() => {
    if (conversation.status === "connected" && !hasTrackedStartRef.current) {
      hasTrackedStartRef.current = true;
      trackEvent(ANALYTICS_EVENTS.CONVERSATION_STARTED, {
        mode,
        cefr_level: cefrLevel,
      });
    }
    if (
      (conversation.status === "ended" || conversation.status === "disconnected") &&
      !hasTrackedCompletionRef.current
    ) {
      hasTrackedCompletionRef.current = true;
      // Story 19-2 (+R1 engagement gate): a lesson session completes its
      // lesson only when the learner ENDED it (a dropped connection must
      // not count) AND actually practiced — at least 2 user utterances in
      // the transcript. Without the gate, tapping Back → Leave 5 seconds in
      // marked the lesson complete with zero speaking (and slice-2 unlock
      // gating would grant unlocks on bogus completions). Fire-and-forget;
      // markLessonCompleted captures its own errors and is idempotent.
      const userTurns = conversation.transcript.filter((e) => e.role === "user").length;
      if (conversation.status === "ended" && lesson && user?.id && userTurns >= 2) {
        void markLessonCompleted(user.id, lesson.id);
      }
      trackEvent(ANALYTICS_EVENTS.CONVERSATION_COMPLETED, {
        mode,
        cefr_level: cefrLevel,
        duration_seconds: conversation.durationSeconds,
        corrections_count: conversation.allCorrections.length,
        terminated_by: conversation.status === "ended" ? "user" : "connection_lost",
      });
    }
    if (conversation.status === "connecting") {
      hasTrackedStartRef.current = false;
      hasTrackedCompletionRef.current = false;
    }
    // Status-only deps by design: duration/corrections are point-in-time
    // reads at the terminal transition; including them would re-run the
    // effect every second (13-4 P19 precedent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.status]);

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
    // Story 21-3: remote kill switch for the Realtime surface (fail-open —
    // only an affirmative PostHog "off" blocks; offline/unconfigured = on).
    if (!isFeatureEnabled(FEATURE_FLAGS.AI_CONVERSATIONS_ENABLED)) {
      Alert.alert(
        "Temporarily unavailable",
        "Voice conversations are briefly paused for maintenance. Please try again soon."
      );
      return;
    }
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
            <Icon name="chevron-left" size={22} color={Colors.textOnDark} />
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
            {/* Session goal chip (Story 18-6): what am I practicing right
                now? Epic 19's lesson engine will feed goalOverride. */}
            <SessionGoalChip
              mode={mode}
              topic={topic}
              cefrLevel={correctionCefrLevel}
              goalOverride={lesson?.conversationScenario.goalEn}
            />

            {/* Avatar-centered layout: condensed transcript caption strip */}
            <TranscriptView
              transcript={conversation.transcript}
              pendingAiText={conversation.pendingAiText}
              isAiSpeaking={conversation.isAiSpeaking}
              condensed
              cefrLevel={correctionCefrLevel}
            />

            <View className="flex-1 items-center justify-center">
              {/* CompanionAvatar (Story 18-4): the companion's face — the
                  state derivation lives in the pure `deriveAvatarState`
                  mapper (priority: connecting → speaking → listening →
                  thinking → idle) and the mouth is driven by real output
                  audio amplitude via the `aiAmplitude` shared value. */}
              {(() => {
                const avatarState = deriveAvatarState(conversation);
                return (
                  <>
                    <CompanionAvatar state={avatarState} amplitude={aiAmplitude} size={180} />
                    {/* Only surface the turn-state label once connected — during
                        connect/reconnect the header status line + the bottom
                        control already say so (was a triple "Connecting…"). */}
                    {conversation.status === "connected" && (
                      <AvatarStatusLabel state={avatarState} />
                    )}
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
              cefrLevel={correctionCefrLevel}
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
              <Icon name="send" size={20} color={Colors.textOnDark} />
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
                <Icon name="mic" size={32} color={Colors.textOnDark} />
              </TouchableOpacity>
            </View>
          )}

          {conversation.status === "connecting" && (
            <View
              className="w-20 h-20 rounded-full bg-white/10 justify-center items-center"
              accessibilityRole="progressbar"
              accessibilityLabel="Connecting"
            >
              <ActivityIndicator color={Colors.accent} />
            </View>
          )}

          {/* Reconnecting: transient auto-recovery window (Story 11-2, up to
              ~15.5s). Pre-fix this had NO controls branch — the header showed
              a misleading "Ready" and there was no End button (dead-end UX).
              Now surface the reconnect state + let the user bail out. */}
          {conversation.status === "reconnecting" && (
            <View className="items-center gap-3">
              <View className="flex-row items-center gap-2 rounded-full bg-white/10 px-5 py-3 justify-center">
                <ActivityIndicator color={Colors.accent} size="small" />
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
                <Icon
                  name="type"
                  size={22}
                  color={showTextInput ? Colors.accent : Colors.textOnDark}
                />
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
              <View style={{ marginBottom: 12 }}>
                <Icon name="wifi-off" size={40} color={Colors.accent} />
              </View>
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
                {/* MilestoneBanner (if earned) — Story 18-4: the companion
                    celebrates WITH the user (mini celebrating avatar above
                    the banner; bounce + happy-squint + blush). */}
                {milestone && (
                  <View className="mb-3">
                    <View className="items-center" style={{ marginBottom: -18 }}>
                      <CompanionAvatar state="celebrating" size={64} />
                    </View>
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

                    {/* Story 20-4 (Epic 20 speaking honesty): these numbers
                        are conversation-practice metrics (AI-rated fluency /
                        grammar from the transcript + corrections), NOT an
                        exam-grade speaking assessment — that lives in the
                        Expression Orale mock test. */}
                    <Text
                      style={{
                        ...Typography.caption,
                        color: Colors.whiteAlpha85,
                        marginTop: 12,
                      }}
                      accessibilityRole="text"
                    >
                      Practice metrics from this conversation — not an exam speaking score.
                    </Text>
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
                    <CorrectionBubble
                      corrections={conversation.allCorrections}
                      cefrLevel={correctionCefrLevel}
                    />
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
                  accessibilityHint="Double tap to close feedback and go back"
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
