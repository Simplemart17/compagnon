/**
 * Active TCF Canada Mock Test Session
 *
 * Simulates a real TCF Canada exam (QCM portion) with timer, progressive
 * questions, and section navigation. Supports the full QCM run
 * (Listening + Reading) or a single section. Writing and Speaking are
 * mandatory in TCF Canada too but use separate non-MCQ pipelines:
 * Writing — Epic 10.6, Speaking — story 9-8.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ALL_QCM_SECTIONS, TCF_QCM_SECTIONS } from "@/src/lib/tcf";
import { rawPercentToListeningReadingScore } from "@/src/lib/scoring";
import { levelFromScore } from "@/src/types/cefr";
import { useAuthStore } from "@/src/store/auth-store";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { updateStreak, incrementDailyActivity, checkCefrPromotion } from "@/src/lib/activity";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { hapticLight } from "@/src/lib/haptics";
import { Colors, Shadows, Typography } from "@/src/lib/design";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import { useMockTestGeneration } from "@/src/hooks/use-mock-test-generation";
import type { MCQContent } from "@/src/types/exercise";
import type { CEFRLevel } from "@/src/types/cefr";

type Section = "listening" | "reading";

/**
 * SCHEMA NOTE — `mock_tests.test_type === "full"` semantic shift.
 *
 * Pre-2026-05-07 (TCF Tout Public): "full" meant 3 sections (listening,
 * reading, grammar) totalling 85 minutes.
 * Post-2026-05-07 (TCF Canada pivot): "full" means 2 sections (listening,
 * reading) totalling 95 minutes.
 *
 * Existing rows with `test_type = "full"` may have been recorded under
 * either semantic, but they are differentiated by the keys present in
 * their `questions` JSON. The resume path filters out unknown section keys
 * (see initTest below); analytics/aggregation jobs that consume historical
 * mock_tests data should treat pre-pivot rows as a separate cohort. A
 * migration that backfills a `variant` column (`tout_public`|`canada`) is
 * tracked as a follow-up in docs/tcf-spec-source.md.
 */

interface TestState {
  sections: Section[];
  currentSectionIndex: number;
  questions: Record<Section, MCQContent[]>;
  answers: Record<string, string>; // `${section}_${index}` -> answerId
  timeRemaining: number;
  status: "loading" | "active" | "finished";
  // Story 13-4 review-round-1 P4 — true when the user opted to "Skip to
  // Results" because a section permanently failed mid-test. Flows into
  // `calculateResultsFromState` so the results screen reports the test as
  // partial-due-to-failure rather than as a normal completion.
  skippedDueToFailure?: boolean;
}

// Per-section runtime metadata is provided by `TCF_QCM_SECTIONS` in
// `@/src/lib/tcf`, which derives every question count and minute value from
// the canonical `TCF` constant in `@/src/lib/constants`. Do NOT re-declare
// section metadata here.

/** Skeleton loading screen shown while generating TCF test */
function MockTestSkeleton({ isSlow }: { isSlow: boolean }) {
  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header skeleton */}
      <View className="bg-primary px-4 py-3 flex-row items-center justify-between">
        <SkeletonBar width={120} height={16} style={{ backgroundColor: Colors.whiteAlpha15 }} />
        <SkeletonBar width={60} height={24} style={{ backgroundColor: Colors.whiteAlpha15 }} />
        <SkeletonBar width={60} height={16} style={{ backgroundColor: Colors.whiteAlpha15 }} />
      </View>

      {/* Progress bar skeleton */}
      <View className="px-4 py-2">
        <SkeletonBar width="100%" height={4} />
      </View>

      {/* Content skeleton */}
      <View style={{ padding: 20 }}>
        <SkeletonBar width={140} height={14} style={{ marginBottom: 16 }} />

        {/* Question card skeleton */}
        <View className="bg-white rounded-2xl p-5" style={{ ...Shadows.card }}>
          <SkeletonBar width="90%" height={18} style={{ marginBottom: 12 }} />
          <SkeletonBar width="70%" height={18} style={{ marginBottom: 24 }} />

          {/* Options skeleton */}
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              className="rounded-xl p-4 mb-3"
              style={{
                backgroundColor: Colors.gray100,
                borderWidth: 1,
                borderColor: Colors.border,
              }}
            >
              <SkeletonBar width={`${70 - i * 10}%`} height={14} />
            </View>
          ))}
        </View>

        {/* Status message */}
        <View className="items-center mt-8">
          <Text className="text-sm font-medium" style={{ color: Colors.textSecondary }}>
            Generating TCF test...
          </Text>
          <Text className="text-xs mt-1" style={{ color: Colors.textTertiary }}>
            This may take a moment
          </Text>
          {isSlow && (
            <Text style={[Typography.caption, { textAlign: "center", marginTop: 8 }]}>
              Taking longer than usual...
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function MockTestSessionScreen() {
  const { testId } = useLocalSearchParams<{ testId: string }>();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);

  // Story 13-4: memoize the sections array so the hook's content-key
  // memoization (sectionsKey = sections.join(",")) sees a stable input
  // across re-renders. Without useMemo, every parent render produces a
  // fresh array reference; the hook would still de-dupe via sectionsKey
  // but useMemo is the standard React idiom.
  const sections = useMemo<Section[]>(
    () => (testId === "full" ? [...ALL_QCM_SECTIONS] : [testId as Section]),
    [testId]
  );

  const [state, setState] = useState<TestState>({
    sections,
    currentSectionIndex: 0,
    questions: { listening: [], reading: [] },
    answers: {},
    timeRemaining: 0,
    status: "loading",
  });

  const isSlow = useSlowLoading(state.status === "loading");

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number>(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Story 13-4 — guards against firing the all-failed / corrupt-resume
  // Alert more than once per (story 13-4 hook signal) transition.
  const allFailedAlertFiredRef = useRef(false);
  const corruptResumeAlertFiredRef = useRef(false);
  const stateInitializedRef = useRef(false);

  const cefrLevel = (profile?.target_cefr_level ??
    profile?.current_cefr_level ??
    "B1") as CEFRLevel;

  const isInvalidTestId = testId !== "full" && !ALL_QCM_SECTIONS.includes(testId as Section);

  useEffect(() => {
    if (isInvalidTestId) {
      router.replace("/(tabs)/mock-test");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvalidTestId]);

  // Story 13-4: parallel per-section AI generation via the dedicated hook.
  // Closes audit P2-6. The hook owns: parallel fan-out, resume detection,
  // DB INSERT on first-section-ready, DB UPDATE on subsequent-section-ready,
  // mountedRef guard, single-fire INSERT guard, retry(). The screen owns:
  // state transitions + Alert UX dispatch in response to hook signals.
  const generation = useMockTestGeneration({
    sections,
    cefrLevel,
    testIdParam: testId,
    enabled: !isInvalidTestId,
  });
  const activeTestId = generation.activeTestId;

  const currentSection = state.sections[state.currentSectionIndex];
  const currentQuestions = state.questions[currentSection] ?? [];
  const currentQuestion = currentQuestions[currentQuestionIndex];

  // Save in-progress test state to DB (debounced)
  const saveTestProgress = useCallback(
    async (testState: TestState, answeredSet: Set<string>, questionIndex: number) => {
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
              currentQuestionIndex: questionIndex,
              timeRemaining: testState.timeRemaining,
              savedAt: Date.now(),
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

  // Story 13-4: resume-data hydration. When the hook detects a saved in-
  // progress test, the screen consumes the resumeData payload to hydrate
  // local state (answers + answeredQuestions + currentQuestionIndex +
  // status). Pre-13-4 these setState calls lived inline in initTest;
  // post-13-4 they react to the resumeData signal.
  useEffect(() => {
    if (stateInitializedRef.current) return;
    const data = generation.resumeData;
    if (!data || data.corrupt) return;
    setAnsweredQuestions(new Set(data.savedAnsweredQuestions));
    setCurrentQuestionIndex(data.savedQuestionIndex);
    setState({
      sections,
      currentSectionIndex: data.savedSectionIndex,
      questions: data.resumedQuestions,
      answers: data.savedAnswers,
      timeRemaining: data.adjustedTimeRemaining,
      status: data.adjustedTimeRemaining <= 0 ? "finished" : "active",
    });
    stateInitializedRef.current = true;
    // Reactive on generation.resumeData ONLY. `sections` reference is
    // memoized via the useMemo above; adding it as a dep would not change
    // semantics but would clutter the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.resumeData]);

  // Story 13-4: first-section-ready signal — transitions status loading
  // → active as soon as the FIRST section's questions are available,
  // even while section 2 is still generating (audit P2-6 "first-section-
  // playable progressive UI"). Subsequent section settles merge into
  // state.questions via the next effect.
  //
  // Story 13-4 review-round-1 P6 — gate on `!generation.resumeData`. Pre-
  // patch: when resume + firstSectionReady fired in the same render (both
  // set true by the hook's resume branch), whichever effect ran first won.
  // If firstSectionReady ran first, it set `state.timeRemaining =
  // totalMinutes * 60` which CLOBBERED the resume's adjusted-time-
  // remaining. Post-patch resume always wins.
  useEffect(() => {
    if (stateInitializedRef.current) return;
    if (generation.resumeData) return; // P6: resume effect wins
    if (!generation.firstSectionReady) return;
    const totalMinutes = sections.reduce((sum, s) => sum + TCF_QCM_SECTIONS[s].minutes, 0);
    setState((s) => ({
      ...s,
      questions: generation.questions,
      timeRemaining: totalMinutes * 60,
      status: "active",
    }));
    stateInitializedRef.current = true;
    // Reactive on firstSectionReady + resumeData ONLY; full deps would re-
    // trigger on `generation.questions` shape change (covered by the next
    // effect) and `sections` reference change (memoized via useMemo above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.firstSectionReady, generation.resumeData]);

  // Story 13-4: merge late-arriving section questions into state once we're
  // already "active" (the user is answering section 1 while section 2 lands).
  useEffect(() => {
    if (state.status !== "active") return;
    setState((s) => ({ ...s, questions: generation.questions }));
    // Reactive on generation.questions ONLY; state.status read inside the
    // effect body (intentionally not in deps to avoid re-firing when state
    // transitions). The hook returns a fresh `questions` object only when
    // a section's questions actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.questions]);

  // Story 13-4: all-failed signal → render "Could not load test" Alert with
  // Retry + Go Back. Pre-13-4 this lived inside initTest's body; post-13-4
  // the hook surfaces `allFailed` and the screen owns the Alert dispatch.
  //
  // Story 13-4 review-round-1 P12 — fire the `mock-test-generation-aborted`
  // Sentry tag declared in the spec (AC #10 + "What the new hook owns"
  // item 7). Pre-patch only per-section `mock-test-generate-${section}`
  // tags fired; operators couldn't aggregate "% of mock-test sessions that
  // aborted entirely" without correlating multiple events. Post-patch one
  // categorical event fires per aborted test.
  useEffect(() => {
    if (!generation.allFailed) return;
    if (allFailedAlertFiredRef.current) return;
    allFailedAlertFiredRef.current = true;
    captureError(new Error("All mock-test sections failed"), "mock-test-generation-aborted");
    Alert.alert(
      "Could not load test",
      "We were unable to generate test questions. Please check your internet connection and try again.",
      [
        { text: "Go Back", onPress: () => router.back() },
        {
          text: "Retry",
          onPress: () => {
            allFailedAlertFiredRef.current = false;
            generation.retry();
          },
        },
      ]
    );
    // Reactive on generation.allFailed signal ONLY. `generation.retry` and
    // `router` are stable identity from their respective hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.allFailed]);

  // Story 13-4: corrupt-resume signal → render "Resume Failed" Alert
  // mirroring pre-13-4 lines 273-294. Retry calls generation.retry()
  // which clears the corrupt row + fires fresh generation.
  useEffect(() => {
    if (!generation.resumeData?.corrupt) return;
    if (corruptResumeAlertFiredRef.current) return;
    corruptResumeAlertFiredRef.current = true;
    const corruptRowId = generation.resumeData.activeTestId;
    Alert.alert(
      "Resume Failed",
      "Your saved test data appears to be corrupted. Would you like to start a new test?",
      [
        { text: "Go Back", style: "cancel", onPress: () => router.back() },
        {
          text: "Start New Test",
          onPress: async () => {
            try {
              await supabase.from("mock_tests").delete().eq("id", corruptRowId);
            } catch (deleteErr) {
              captureError(deleteErr, "mock-test-delete-corrupt");
            }
            corruptResumeAlertFiredRef.current = false;
            generation.retry();
          },
        },
      ]
    );
    // Reactive on generation.resumeData ONLY. `router` + `generation.retry`
    // identity-stable; supabase singleton always fresh-fetched at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.resumeData]);

  // Timer countdown -- uses absolute endTime to avoid drift from setInterval
  useEffect(() => {
    if (state.status !== "active") return;

    // Compute the absolute end time from the current timeRemaining.
    // Always recompute when effect re-runs (e.g. after resume) to stay accurate.
    if (state.timeRemaining > 0) {
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

  const navigation = useNavigation();
  const leaveConfirmedRef = useRef(false);

  // Cross-platform navigation guard — intercept back navigation on iOS and Android
  useEffect(() => {
    if (state.status !== "active") return;

    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (e.data.action.type !== "GO_BACK") return;
      if (leaveConfirmedRef.current) return; // Already confirmed, let it through

      e.preventDefault();
      Alert.alert("Leave Test?", "Your progress has been saved. You can resume this test later.", [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            leaveConfirmedRef.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });

    return () => {
      unsubscribe();
      leaveConfirmedRef.current = false;
    };
  }, [state.status, navigation]);

  // Navigate to results when finished -- persist to Supabase first
  useEffect(() => {
    if (state.status === "finished") {
      if (timerRef.current) clearInterval(timerRef.current);
      // Use state directly from the effect closure — it re-runs when state.status changes
      const results = calculateResultsFromState(state);

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

            // TODO(story-9-8): Wire per-skill score writes from `results.sections` into
            // updateSkillProgress(userId, "listening" | "reading" | "writing" | "speaking",
            //   currentLevel, sectionScore, sectionMinutes) once Story 9-8 lands the Speaking
            // pipeline and re-confirms section/skill mapping for TCF Canada.
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

  /** Calculate results from the given test state (pure function, no stale closures). */
  const calculateResultsFromState = useCallback(
    (testState: TestState) => {
      const sectionResults: Record<
        string,
        {
          score: number;
          correct: number;
          total: number;
          tcfScore: number;
          cefrLevel: string;
          isPartial: boolean;
        }
      > = {};

      for (const section of testState.sections) {
        const questions = testState.questions[section];
        let correct = 0;
        for (let i = 0; i < questions.length; i++) {
          const key = `${section}_${i}`;
          const answer = testState.answers[key];
          const correctOption = questions[i]?.options.find((o) => o.isCorrect);
          if (answer === correctOption?.id) correct++;
        }
        const rawPercent = questions.length > 0 ? (correct / questions.length) * 100 : 0;
        const tcfScore = rawPercentToListeningReadingScore(rawPercent, section);

        sectionResults[section] = {
          score: Math.round(rawPercent),
          correct,
          total: questions.length,
          tcfScore,
          cefrLevel: levelFromScore(tcfScore) ?? "Below A1",
          isPartial: testState.sections.length === 1,
        };
      }

      const allScores = Object.values(sectionResults).map((s) => s.tcfScore);
      const overallTcfScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);

      // Story 13-4 review-round-1 P4 — `isPartialTest` now flags ANY of:
      // (a) single-section run (pre-13-4 semantic), (b) full run where a
      // section was skipped due to permanent generation failure
      // (skippedDueToFailure), or (c) full run with a section's total === 0
      // (defense-in-depth — empty-section indicates either failure or an
      // unexpected zero-question generation). Pre-patch only (a) was
      // checked; the Skip-to-Results path produced a "normal" completion
      // record whose TCF score was computed on a single section masquerading
      // as a 2-section run.
      const anySectionEmpty = testState.sections.some(
        (s) => (testState.questions[s]?.length ?? 0) === 0
      );
      return {
        sections: sectionResults,
        overallTcfScore,
        overallCefrLevel: levelFromScore(overallTcfScore) ?? "Below A1",
        testType: testId,
        isPartialTest:
          testState.sections.length < ALL_QCM_SECTIONS.length ||
          testState.skippedDueToFailure === true ||
          anySectionEmpty,
        skippedDueToFailure: testState.skippedDueToFailure === true,
      };
    },
    [testId]
  );

  const handleAnswer = useCallback(
    (answerId: string) => {
      hapticLight();
      const key = `${currentSection}_${currentQuestionIndex}`;
      const qIdx = currentQuestionIndex;
      setState((s) => {
        const newState = { ...s, answers: { ...s.answers, [key]: answerId } };
        // Debounced save to DB
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          const newSet = new Set(answeredQuestions).add(key);
          void saveTestProgress(newState, newSet, qIdx);
        }, 2000);
        return newState;
      });
      setAnsweredQuestions((prev) => new Set(prev).add(key));
    },
    [currentSection, currentQuestionIndex, answeredQuestions, saveTestProgress]
  );

  const handleNextSection = useCallback(() => {
    if (state.currentSectionIndex < state.sections.length - 1) {
      const nextSection = state.sections[state.currentSectionIndex + 1];
      const nextStatus = generation.sectionStatus[nextSection];
      // Story 13-4: if the next section is still generating (pending) we
      // advance the section index optimistically so the
      // "Préparation de la section suivante..." overlay renders (it gates
      // on `currentSectionStatus !== "ready" && currentQuestions.length === 0`,
      // which is true post-advance because the pending section's
      // questions blob is still []). The merge effect will populate
      // state.questions[nextSection] when the AI call lands, dismissing
      // the overlay naturally. If it failed permanently, offer to skip
      // straight to results so the user isn't trapped.
      //
      // Story 13-4 review-round-1 P1 — pre-patch the pending branch
      // returned void WITHOUT advancing, which left the overlay condition
      // false (currentSection unchanged, currentQuestions non-empty), so
      // the user's tap appeared dead. Post-patch we advance unconditionally
      // (unless the section explicitly failed); the overlay handles the
      // pending case as the visual feedback.
      if (nextStatus === "failed") {
        Alert.alert(
          "Section Unavailable",
          "We couldn't load this section. Would you like to skip to your results?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Skip to Results",
              // Story 13-4 review-round-1 P4 — track skipped-due-to-fail so
              // the results screen can flag the test as partial. The
              // skippedDueToFailure flag flows through completion via
              // `calculateResultsFromState`.
              onPress: () =>
                setState((s) => ({ ...s, status: "finished", skippedDueToFailure: true })),
            },
          ]
        );
        return;
      }
      // P1: advance index even when pending — the overlay below renders
      // for that case (currentQuestions.length === 0 + currentSectionStatus
      // !== "ready"), giving the user explicit visual feedback.
      setState((s) => ({
        ...s,
        currentSectionIndex: s.currentSectionIndex + 1,
      }));
      setCurrentQuestionIndex(0);
    } else {
      setState((s) => ({ ...s, status: "finished" }));
    }
  }, [state.currentSectionIndex, state.sections, generation.sectionStatus]);

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

  // Loading screen — skeleton loader
  if (state.status === "loading") {
    return <MockTestSkeleton isSlow={isSlow} />;
  }

  // Story 13-4: "Preparing next section..." overlay. Architecturally rare
  // (under normal usage section 2 has been generating for ≥35 minutes while
  // the user works through section 1) but the correctness backstop matters
  // when a user races through section 1 faster than ~6-10s of section-2
  // generation. Empty `currentQuestions` while `state.status === "active"`
  // and the current section is not yet "ready" is the exact race condition.
  const currentSectionStatus = generation.sectionStatus[currentSection];
  if (
    state.status === "active" &&
    currentSectionStatus !== "ready" &&
    currentQuestions.length === 0
  ) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center px-6">
        <Text style={[Typography.cardTitle, { textAlign: "center", marginBottom: 8 }]}>
          Préparation de la section suivante...
        </Text>
        <Text style={[Typography.bodySecondary, { textAlign: "center" }]}>
          Preparing next section...
        </Text>
      </SafeAreaView>
    );
  }

  const isLastQuestion = currentQuestionIndex >= currentQuestions.length - 1;
  const isLastSection = state.currentSectionIndex >= state.sections.length - 1;
  const answerKey = `${currentSection}_${currentQuestionIndex}`;
  const sectionMeta = TCF_QCM_SECTIONS[currentSection];
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
              color: isTimeLow ? Colors.error : Colors.textOnDark,
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
          style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" }}
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
              accessibilityRole="button"
              accessibilityLabel={`Question ${i + 1}${answered ? ", answered" : ", unanswered"}${i === currentQuestionIndex ? ", current" : ""}`}
              accessibilityState={{ selected: i === currentQuestionIndex }}
              className="flex-1 rounded-sm justify-center"
              hitSlop={{ top: 20, bottom: 20, left: 4, right: 4 }}
              style={{
                height: 4,
                minHeight: 4,
                backgroundColor:
                  i === currentQuestionIndex
                    ? Colors.primary
                    : answered
                      ? Colors.success
                      : Colors.border,
              }}
            />
          );
        })}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Question number */}
        <Text className="text-[13px] mb-3" style={{ color: Colors.textTertiary }}>
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
        style={{ borderTopWidth: 1, borderTopColor: Colors.border }}
      >
        <TouchableOpacity
          onPress={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
          disabled={currentQuestionIndex === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous question"
          accessibilityState={{ disabled: currentQuestionIndex === 0 }}
          className="flex-1 rounded-xl py-3.5 items-center"
          style={{
            backgroundColor: currentQuestionIndex === 0 ? Colors.border : Colors.gray100,
          }}
        >
          <Text
            className="text-[15px] font-semibold"
            style={{
              color: currentQuestionIndex === 0 ? Colors.textTertiary : Colors.primary,
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
