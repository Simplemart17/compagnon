/**
 * Active TCF Mock Test Session
 *
 * Simulates a real TCF test with timer, progressive questions,
 * and section navigation. Supports full test (3 sections) or single section.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { chatCompletionJSON } from "@/src/lib/openai";
import { buildMockTestPrompt } from "@/src/lib/prompts/mock-test";
import { rawToTCFScore } from "@/src/lib/scoring";
import { levelFromScore } from "@/src/types/cefr";
import { useAuthStore } from "@/src/store/auth-store";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { updateStreak, incrementDailyActivity, checkCefrPromotion } from "@/src/lib/activity";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { hapticLight } from "@/src/lib/haptics";
import type { MCQContent } from "@/src/types/exercise";
import type { CEFRLevel } from "@/src/types/cefr";

type Section = "listening" | "reading" | "grammar";

interface TestState {
  sections: Section[];
  currentSectionIndex: number;
  questions: Record<Section, MCQContent[]>;
  answers: Record<string, string>; // `${section}_${index}` -> answerId
  timeRemaining: number;
  status: "loading" | "active" | "finished";
}

const SECTION_META: Record<
  Section,
  { name: string; nameFr: string; timeMinutes: number; questionCount: number }
> = {
  listening: {
    name: "Listening",
    nameFr: "Compréhension Orale",
    timeMinutes: 25,
    questionCount: 29,
  },
  reading: { name: "Reading", nameFr: "Compréhension Écrite", timeMinutes: 45, questionCount: 29 },
  grammar: {
    name: "Grammar",
    nameFr: "Structures de la Langue",
    timeMinutes: 15,
    questionCount: 18,
  },
};

export default function MockTestSessionScreen() {
  const { testId } = useLocalSearchParams<{ testId: string }>();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);

  const VALID_SECTIONS: Section[] = ["listening", "reading", "grammar"];

  const sections: Section[] =
    testId === "full" ? ["listening", "reading", "grammar"] : [testId as Section];

  const [state, setState] = useState<TestState>({
    sections,
    currentSectionIndex: 0,
    questions: { listening: [], reading: [], grammar: [] },
    answers: {},
    timeRemaining: 0,
    status: "loading",
  });

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set());
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number>(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cefrLevel = (profile?.target_cefr_level ??
    profile?.current_cefr_level ??
    "B1") as CEFRLevel;

  const isInvalidTestId = testId !== "full" && !VALID_SECTIONS.includes(testId as Section);

  useEffect(() => {
    if (isInvalidTestId) {
      router.replace("/(tabs)/mock-test");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvalidTestId]);

  const currentSection = state.sections[state.currentSectionIndex];
  const currentQuestions = state.questions[currentSection] ?? [];
  const currentQuestion = currentQuestions[currentQuestionIndex];

  // Save in-progress test state to DB (debounced)
  const saveTestProgress = useCallback(
    async (testState: TestState, answeredSet: Set<string>) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId || !activeTestId) return;

      try {
        await supabase
          .from("mock_tests")
          .update({
            questions: testState.questions,
            section_scores: {
              answers: testState.answers,
              currentSectionIndex: testState.currentSectionIndex,
              timeRemaining: testState.timeRemaining,
              answeredQuestions: [...answeredSet],
            },
          })
          .eq("id", activeTestId);
      } catch {
        // Non-critical -- silently fail
      }
    },
    [activeTestId]
  );

  // Generate test questions or resume from saved state
  useEffect(() => {
    async function initTest() {
      const userId = useAuthStore.getState().user?.id;

      // Check for an in-progress test to resume
      if (userId) {
        const { data: existing } = await supabase
          .from("mock_tests")
          .select("*")
          .eq("user_id", userId)
          .eq("test_type", testId === "full" ? "full" : testId)
          .eq("status", "in_progress")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (existing?.questions && existing?.section_scores?.answers) {
          // Resume from saved state
          const saved = existing.section_scores;
          setActiveTestId(existing.id);
          setAnsweredQuestions(new Set(saved.answeredQuestions ?? []));
          setState({
            sections,
            currentSectionIndex: saved.currentSectionIndex ?? 0,
            questions: existing.questions as Record<Section, MCQContent[]>,
            answers: saved.answers ?? {},
            timeRemaining: saved.timeRemaining ?? 0,
            status: "active",
          });
          return;
        }
      }

      // Generate new test
      const allQuestions: Record<Section, MCQContent[]> = {
        listening: [],
        reading: [],
        grammar: [],
      };

      let generationFailed = false;
      for (const section of sections) {
        try {
          const prompt = buildMockTestPrompt({
            section,
            targetLevel: cefrLevel,
            questionCount: SECTION_META[section].questionCount,
          });

          const result = await chatCompletionJSON<{
            passages?: { id: string; text: string }[];
            questions: {
              question: string;
              passage?: string;
              passageId?: string;
              options: { id: string; text: string; isCorrect: boolean }[];
              explanation: string;
            }[];
          }>([{ role: "system", content: prompt }], { temperature: 0.4, maxTokens: 4096 });

          // For listening/reading, attach passage text to questions that reference a passageId
          if (result.passages && result.passages.length > 0) {
            const passageMap = new Map(result.passages.map((p) => [p.id, p.text]));
            for (const q of result.questions) {
              if (q.passageId && !q.passage) {
                q.passage = passageMap.get(q.passageId) ?? undefined;
              }
            }
          }

          allQuestions[section] = result.questions;
        } catch (err) {
          captureError(err, `mock-test-generate-${section}`);
          allQuestions[section] = [];
          generationFailed = true;
        }
      }

      // Abort if all sections failed to generate
      const emptySections = sections.filter((s) => allQuestions[s].length === 0);
      if (generationFailed && emptySections.length === sections.length) {
        Alert.alert(
          "Generation Error",
          "Failed to generate test questions. Please check your connection and try again.",
          [{ text: "Go Back", onPress: () => router.back() }]
        );
        return;
      }

      const totalMinutes = sections.reduce((sum, s) => sum + SECTION_META[s].timeMinutes, 0);

      // Create in-progress record in DB
      if (userId) {
        const { data: newTest } = await supabase
          .from("mock_tests")
          .insert({
            user_id: userId,
            test_type: testId === "full" ? "full" : testId,
            questions: allQuestions,
            status: "in_progress",
          })
          .select("id")
          .single();
        if (newTest) setActiveTestId(newTest.id);
      }

      setState((s) => ({
        ...s,
        questions: allQuestions,
        timeRemaining: totalMinutes * 60,
        status: "active",
      }));
    }

    void initTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer countdown -- uses absolute endTime to avoid drift from setInterval
  useEffect(() => {
    if (state.status !== "active") return;

    // Compute the absolute end time once when the timer starts (or resumes).
    // On subsequent ticks we derive remaining from Date.now().
    if (endTimeRef.current === 0 && state.timeRemaining > 0) {
      endTimeRef.current = Date.now() + state.timeRemaining * 1000;
    }

    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setState((s) => {
        if (remaining <= 0) {
          return { ...s, timeRemaining: 0, status: "finished" };
        }
        return { ...s, timeRemaining: remaining };
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // BackHandler guard -- confirm before leaving during an active test (Android)
  useEffect(() => {
    if (state.status !== "active" || Platform.OS !== "android") return;

    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      Alert.alert("Leave Test?", "Your progress has been saved. You can resume this test later.", [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => router.back(),
        },
      ]);
      return true; // Prevent default back behavior
    });

    return () => handler.remove();
  }, [state.status, router]);

  // Navigate to results when finished -- persist to Supabase first
  useEffect(() => {
    if (state.status === "finished") {
      if (timerRef.current) clearInterval(timerRef.current);
      const results = calculateResults();

      // Save to Supabase (non-blocking)
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        void (async () => {
          try {
            if (activeTestId) {
              // Update existing in-progress record
              const { error: mockError } = await supabase
                .from("mock_tests")
                .update({
                  total_score: results.overallTcfScore,
                  section_scores: results.sections,
                  cefr_result: results.overallCefrLevel,
                  status: "completed",
                  completed_at: new Date().toISOString(),
                })
                .eq("id", activeTestId);
              if (mockError) captureError(mockError, "mock-test-save");
            } else {
              // Fallback: insert new record
              const { error: mockError } = await supabase.from("mock_tests").insert({
                user_id: userId,
                test_type: testId === "full" ? "full" : testId,
                total_score: results.overallTcfScore,
                section_scores: results.sections,
                cefr_result: results.overallCefrLevel,
                questions: state.questions,
                status: "completed",
                completed_at: new Date().toISOString(),
              });
              if (mockError) captureError(mockError, "mock-test-save");
            }

            await incrementDailyActivity(userId, { exercises: 1 });
            await updateStreak(userId);
            await checkCefrPromotion(userId);
          } catch (err) {
            captureError(err, "mock-test-persist");
          }
        })();
      }

      router.replace({
        pathname: "/(tabs)/mock-test/results",
        params: { data: JSON.stringify(results) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo Router typed routes don't cover dynamic params
      } as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const calculateResults = useCallback(() => {
    const sectionResults: Record<
      string,
      { score: number; correct: number; total: number; tcfScore: number; cefrLevel: string }
    > = {};

    for (const section of state.sections) {
      const questions = state.questions[section];
      let correct = 0;
      for (let i = 0; i < questions.length; i++) {
        const key = `${section}_${i}`;
        const answer = state.answers[key];
        const correctOption = questions[i]?.options.find((o) => o.isCorrect);
        if (answer === correctOption?.id) correct++;
      }
      const rawPercent = questions.length > 0 ? (correct / questions.length) * 100 : 0;
      const tcfScore = rawToTCFScore(rawPercent);

      sectionResults[section] = {
        score: Math.round(rawPercent),
        correct,
        total: questions.length,
        tcfScore,
        cefrLevel: levelFromScore(tcfScore) ?? "A1",
      };
    }

    const allScores = Object.values(sectionResults).map((s) => s.tcfScore);
    const overallTcfScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);

    return {
      sections: sectionResults,
      overallTcfScore,
      overallCefrLevel: levelFromScore(overallTcfScore) ?? "A1",
      testType: testId,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleAnswer = useCallback(
    (answerId: string) => {
      hapticLight();
      const key = `${currentSection}_${currentQuestionIndex}`;
      setState((s) => {
        const newState = { ...s, answers: { ...s.answers, [key]: answerId } };
        // Debounced save to DB
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          const newSet = new Set(answeredQuestions).add(key);
          void saveTestProgress(newState, newSet);
        }, 2000);
        return newState;
      });
      setAnsweredQuestions((prev) => new Set(prev).add(key));
    },
    [currentSection, currentQuestionIndex, answeredQuestions, saveTestProgress]
  );

  const handleNextSection = useCallback(() => {
    if (state.currentSectionIndex < state.sections.length - 1) {
      setState((s) => ({
        ...s,
        currentSectionIndex: s.currentSectionIndex + 1,
      }));
      setCurrentQuestionIndex(0);
    } else {
      setState((s) => ({ ...s, status: "finished" }));
    }
  }, [state.currentSectionIndex, state.sections.length]);

  const handleFinish = useCallback(() => {
    // Flush any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const totalQuestions = state.sections.reduce(
      (sum, s) => sum + (state.questions[s]?.length ?? 0),
      0
    );
    const answeredCount = Object.keys(state.answers).length;
    const unanswered = totalQuestions - answeredCount;

    const message =
      unanswered > 0
        ? `You have ${unanswered} unanswered question${unanswered > 1 ? "s" : ""}. Submit anyway? You cannot go back.`
        : "Are you sure you want to finish? You cannot go back.";

    Alert.alert("Submit Test", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Submit",
        style: "destructive",
        onPress: () => setState((s) => ({ ...s, status: "finished" })),
      },
    ]);
  }, [state.sections, state.questions, state.answers]);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (isInvalidTestId) return null;

  // Loading screen
  if (state.status === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color="#1E3A5F" />
        <Text className="text-[#666] mt-4 text-sm">Generating TCF test...</Text>
        <Text className="text-[#999] mt-1 text-xs">This may take a moment</Text>
      </SafeAreaView>
    );
  }

  const isLastQuestion = currentQuestionIndex >= currentQuestions.length - 1;
  const isLastSection = state.currentSectionIndex >= state.sections.length - 1;
  const answerKey = `${currentSection}_${currentQuestionIndex}`;
  const sectionMeta = SECTION_META[currentSection];
  const isTimeLow = state.timeRemaining < 300; // < 5 min

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header with timer */}
      <View className="flex-row items-center justify-between px-4 py-3 bg-primary">
        <View>
          <Text className="text-accent text-[11px] font-bold">{sectionMeta.nameFr}</Text>
          <Text className="text-white/[0.53] text-[11px]">
            Section {state.currentSectionIndex + 1}/{state.sections.length}
          </Text>
        </View>

        <View
          className="items-center"
          accessibilityLabel={`${formatTime(state.timeRemaining)} remaining`}
          accessibilityRole="timer"
        >
          <Text
            className="text-xl font-extrabold"
            style={{
              color: isTimeLow ? "#FF3B30" : "#FFFFFF",
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatTime(state.timeRemaining)}
          </Text>
          <Text className="text-white/[0.4] text-[10px]">remaining</Text>
        </View>

        <TouchableOpacity
          onPress={handleFinish}
          accessibilityRole="button"
          accessibilityLabel="End test"
          accessibilityHint="Double tap to submit the test"
        >
          <Text className="text-error text-[13px] font-semibold">End Test</Text>
        </TouchableOpacity>
      </View>

      {/* Question progress */}
      <View className="flex-row px-4 py-2 gap-[3px]">
        {currentQuestions.map((_, i) => {
          const key = `${currentSection}_${i}`;
          const answered = answeredQuestions.has(key);
          return (
            <TouchableOpacity
              key={i}
              onPress={() => setCurrentQuestionIndex(i)}
              className="flex-1 h-1 rounded-sm"
              style={{
                backgroundColor:
                  i === currentQuestionIndex ? "#1E3A5F" : answered ? "#34C759" : "#E0E0CE",
              }}
            />
          );
        })}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Question number */}
        <Text className="text-[13px] text-[#999] mb-3">
          Question {currentQuestionIndex + 1} of {currentQuestions.length}
        </Text>

        {/* MCQ card (no result reveal in test mode) */}
        {currentQuestion && (
          <MCQCard
            question={currentQuestion}
            selectedAnswer={state.answers[answerKey] ?? null}
            showResult={false}
            onSelect={handleAnswer}
          />
        )}
      </ScrollView>

      {/* Bottom navigation */}
      <View
        className="flex-row px-4 py-3 gap-3"
        style={{ borderTopWidth: 1, borderTopColor: "#E0E0CE" }}
      >
        <TouchableOpacity
          onPress={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
          disabled={currentQuestionIndex === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous question"
          accessibilityState={{ disabled: currentQuestionIndex === 0 }}
          className="flex-1 rounded-xl py-3.5 items-center"
          style={{
            backgroundColor: currentQuestionIndex === 0 ? "#E0E0CE" : "#F0F0E8",
          }}
        >
          <Text
            className="text-[15px] font-semibold"
            style={{
              color: currentQuestionIndex === 0 ? "#999" : "#1E3A5F",
            }}
          >
            Previous
          </Text>
        </TouchableOpacity>

        {!isLastQuestion ? (
          <TouchableOpacity
            onPress={() => setCurrentQuestionIndex(currentQuestionIndex + 1)}
            accessibilityRole="button"
            accessibilityLabel="Next question"
            className="flex-1 bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-semibold text-white">Next</Text>
          </TouchableOpacity>
        ) : isLastSection ? (
          <TouchableOpacity
            onPress={handleFinish}
            accessibilityRole="button"
            accessibilityLabel="Submit test"
            accessibilityHint="Double tap to finish and submit your test"
            className="flex-1 bg-accent rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-bold text-white">Submit Test</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleNextSection}
            accessibilityRole="button"
            accessibilityLabel="Go to next section"
            className="flex-1 bg-success rounded-xl py-3.5 items-center"
          >
            <Text className="text-[15px] font-bold text-white">Next Section</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
