/**
 * TCF Canada Expression Orale — Mock Test Screen
 *
 * Story 9-8.
 *
 * Record-and-grade flow for the 3 production tasks of TCF Canada Expression
 * Orale. Each task: present prompt → record audio (low-bitrate AAC so the
 * 5.5-min Task 2 fits the 5 MB ai-proxy cap) → transcribe via Whisper →
 * evaluate via gpt-4o against the official 4-criterion 0-20 rubric.
 *
 * Persists one `mock_tests` row (`test_type="speaking"`) and 3
 * `mock_test_answers` rows (one per task; `selected_option=transcript`,
 * `is_correct=NULL` since production tasks have no objective right answer).
 * Updates `skill_progress.speaking`, `daily_activity`, streak, and fires
 * CEFR promotion check — same persistence chain as the QCM runner.
 *
 * SCHEMA NOTE — `mock_test_answers.selected_option` carries the user's
 * transcribed French response (TEXT, no length cap). The column is named for
 * MCQ but is the only free-text column on the table; using it for transcripts
 * avoids a schema migration during the release-blocker scope. A future story
 * may consolidate to a dedicated `transcript` column.
 *
 * NOT RESUMABLE — speaking tests cannot survive a screen unmount cleanly
 * (audio recording lifecycle is non-trivial); back-press shows a destructive
 * leave dialog. Resume support is intentionally out of scope.
 *
 * URL: /(tabs)/mock-test/speaking — Expo Router resolves static-over-dynamic
 * so this file takes precedence over `[testId].tsx` for the URL above.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, AccessibilityInfo, Linking, Pressable, ScrollView, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useNavigation, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { OfflineFallback } from "@/src/components/common/OfflineFallback";
import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import { useAudioRecorder, RECORDING_OPTIONS_LOW_BITRATE } from "@/src/hooks/use-audio-recorder";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import { useAuthStore } from "@/src/store/auth-store";
import { ANALYTICS_EVENTS, scoreBand, trackEvent } from "@/src/lib/analytics";
import { Colors, Shadows, Typography } from "@/src/lib/design";
import { TCF } from "@/src/lib/constants";
import { hapticLight, hapticSuccess, hapticError } from "@/src/lib/haptics";
import { isOnline } from "@/src/lib/network";
import { transcribeAudio } from "@/src/lib/openai";
import { cefrLevelSchema, type SpeakingTaskEvaluation } from "@/src/lib/schemas/ai-responses";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";
import {
  buildSpeakingTaskPrompt,
  type SpeakingTaskNumber,
  type SpeakingTaskPromptResult,
} from "@/src/lib/prompts/speaking";
import { evaluateSpeakingTasks } from "@/src/lib/speaking-evaluator";
import { persistSpeakingMockTest } from "@/src/lib/speaking-mock-test-persist";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-stop fires this many seconds AFTER the expectedDurationSec budget. */
const RECORDING_GRACE_SEC = 30;

/** Pre-recording countdown so the user is ready when the mic goes hot. */
const PREP_COUNTDOWN_SEC = 3;

const TASK_NUMBERS: SpeakingTaskNumber[] = [1, 2, 3];

/**
 * Sentinel transcript inserted by the Skip Task path. The evaluator NEVER
 * sees this string — `handleSkipTask` synthesizes a deterministic zero
 * evaluation for the skipped task instead, per AC #4 ("zeros the per-task
 * scores"). Story 9-8 review patch P3.
 */
const SKIP_SENTINEL = "[no response recorded]";

/**
 * Build a deterministic zero evaluation for a skipped task. The model is
 * NOT called for skipped tasks — we cannot trust the LLM to score a stub
 * placeholder without hallucinating non-zero rubric points (especially on
 * `interactionScore` where "no response" might earn pity credit).
 *
 * Story 9-8 review patch P3.
 */
function synthesizeZeroEvaluation(): SpeakingTaskEvaluation {
  return {
    pronunciationFluencyScore: 0,
    vocabularyScore: 0,
    grammarScore: 0,
    interactionScore: 0,
    // Story 10-6: Sociolinguistique added as the 5th publisher category.
    // A skipped task gets 0 on every dimension including this one.
    sociolinguisticScore: 0,
    overallScore: 0,
    strengths: ["—"],
    improvements: ["No response was recorded for this task."],
  };
}

/**
 * Treat the sentinel and any empty/whitespace transcript as a non-response.
 * Story 9-8 review patch P15 — guards against Whisper returning `""` for a
 * silent recording (`??` would have kept the empty string).
 */
function isMissingTranscript(transcript: string | undefined): boolean {
  return !transcript || !transcript.trim() || transcript.trim() === SKIP_SENTINEL;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ScreenState =
  | { kind: "loading" }
  | { kind: "permission-denied" }
  | { kind: "offline" }
  | { kind: "intro"; prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult> }
  | {
      kind: "task-prep";
      taskNumber: SpeakingTaskNumber;
      secondsLeft: number;
      prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
      transcripts: Partial<Record<SpeakingTaskNumber, string>>;
    }
  | {
      kind: "task-recording";
      taskNumber: SpeakingTaskNumber;
      elapsedSec: number;
      prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
      transcripts: Partial<Record<SpeakingTaskNumber, string>>;
    }
  | {
      kind: "task-transcribing";
      taskNumber: SpeakingTaskNumber;
      prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
      transcripts: Partial<Record<SpeakingTaskNumber, string>>;
    }
  | {
      kind: "task-failed";
      taskNumber: SpeakingTaskNumber;
      error: string;
      phase: "transcribe" | "eval";
      prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
      transcripts: Partial<Record<SpeakingTaskNumber, string>>;
    }
  | {
      kind: "evaluating";
      prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
      transcripts: Record<SpeakingTaskNumber, string>;
      /** Per-task overrides (e.g. zero evaluations for skipped tasks). */
      evaluationOverrides: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>>;
    }
  | {
      // P2/P3/P4: evaluation completed for some tasks but failed for others.
      // The user can retry only the failing tasks (cost discipline) or cancel.
      kind: "evaluation-failed";
      prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
      transcripts: Record<SpeakingTaskNumber, string>;
      successes: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>>;
      failedTaskNumbers: SpeakingTaskNumber[];
      failureMessage: string;
    }
  | { kind: "persisting" }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SpeakingMockTestScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);

  const recorder = useAudioRecorder(RECORDING_OPTIONS_LOW_BITRATE);
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const isSlow = useSlowLoading(
    state.kind === "loading" || state.kind === "evaluating" || state.kind === "persisting"
  );

  // Refs for timers + active task durations so async recorder ops don't race state.
  const prepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartMsRef = useRef<number>(0);
  const startedAtMsRef = useRef<number>(0);
  const leaveConfirmedRef = useRef(false);
  /**
   * Per-recording idempotent finish guard. Set inside `beginRecording`;
   * called by both the auto-stop interval and `handleStopEarly` so a
   * concurrent fire only triggers `finishRecording` once. Story 9-8
   * review patch P11.
   */
  const finishGuardRef = useRef<(() => void) | null>(null);
  /**
   * Latest `recorder` reference, mirrored into a ref so the back-press
   * effect can stop the mic without depending on `recorder` (whose identity
   * changes every render and would otherwise trigger an effect re-subscribe
   * cascade). Story 9-8 review patch P26.
   */
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  // P19: validate via cefrLevelSchema rather than blind-cast. DB drift
  // (e.g. a stale enum value or a NULL target) would otherwise crash
  // `pick()` at TASK_X_QUESTIONS[invalid].length later in this file.
  const cefrLevel: CEFRLevel = (() => {
    const candidate = profile?.target_cefr_level ?? profile?.current_cefr_level ?? "B1";
    const parsed = cefrLevelSchema.safeParse(candidate);
    return parsed.success ? parsed.data : "B1";
  })();

  // -------------------------------------------------------------------------
  // Mount-time setup: offline check + mic permission + prompt generation
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    async function preflight() {
      try {
        const online = await isOnline();
        if (cancelled) return;
        if (!online) {
          setState({ kind: "offline" });
          return;
        }

        const granted = await recorder.requestPermission();
        if (cancelled) return;
        if (!granted) {
          setState({ kind: "permission-denied" });
          return;
        }

        if (!user?.id) {
          setState({ kind: "error", message: "Sign-in required to take a mock test." });
          return;
        }

        const prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult> = {
          1: buildSpeakingTaskPrompt({ cefrLevel, taskNumber: 1, userId: user.id }),
          2: buildSpeakingTaskPrompt({ cefrLevel, taskNumber: 2, userId: user.id }),
          3: buildSpeakingTaskPrompt({ cefrLevel, taskNumber: 3, userId: user.id }),
        };
        if (!cancelled) {
          startedAtMsRef.current = Date.now();
          setState({ kind: "intro", prompts });
        }
      } catch (err) {
        captureError(err, "speaking-mock-test-preflight");
        if (!cancelled) {
          setState({
            kind: "error",
            message: "Could not start the speaking test. Please try again.",
          });
        }
      }
    }
    void preflight();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Cleanup timers on unmount
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (prepTimerRef.current) clearInterval(prepTimerRef.current);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Back-press guard: warn before discarding an in-progress test
  // -------------------------------------------------------------------------

  useEffect(() => {
    const inFlight =
      state.kind === "task-prep" ||
      state.kind === "task-recording" ||
      state.kind === "task-transcribing" ||
      state.kind === "task-failed" ||
      state.kind === "evaluating" ||
      state.kind === "evaluation-failed" ||
      state.kind === "persisting";
    if (!inFlight) return;

    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      // P12: do NOT filter by action type. The previous `GO_BACK`-only check
      // let tab switches and programmatic NAVIGATE/REPLACE/POP_TO_TOP
      // dispatches tear the screen down silently — losing recordings without
      // the leave-confirmation dialog. Intercept ALL destructive transitions.
      if (leaveConfirmedRef.current) return;

      e.preventDefault();
      Alert.alert(
        "Leave Test?",
        "Your recordings will be lost. Speaking tests cannot be resumed.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              leaveConfirmedRef.current = true;
              // P26: read recorder from ref so this effect doesn't depend on
              // the recorder instance (which changes identity per render).
              const r = recorderRef.current;
              if (r.isRecording) void r.stopRecording();
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });

    // P26: do NOT reset `leaveConfirmedRef.current` on every effect cleanup.
    // The cleanup runs on every `state.kind` transition; resetting the flag
    // would let an in-flight `router.replace` race a re-engaging back guard
    // (deferred D1 in the review). The flag is per-mount, not per-state.
    return () => {
      unsubscribe();
    };
  }, [state.kind, navigation]);

  // -------------------------------------------------------------------------
  // Task transitions
  //
  // The task lifecycle (prep → record → transcribe → next-task | evaluate)
  // is mutually recursive. Wrapping the recursive functions in `useCallback`
  // would either require listing each in the others' deps array (which
  // produces a re-creation cascade on every state change) or break the
  // exhaustive-deps lint rule. Instead, the functions are declared as plain
  // function expressions inside the component and stored in `fnsRef` so each
  // can invoke the others without referring to the closure-time identity.
  //
  // Trade-off: the functions are recreated each render. They are NOT passed
  // to memoized children (only invoked from event handlers and timers), so
  // the cost is a closure allocation per render — negligible for a screen
  // that re-renders on user interaction (not on every animation frame).
  // -------------------------------------------------------------------------

  type TaskRunner = (
    taskNumber: SpeakingTaskNumber,
    prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>,
    transcripts: Partial<Record<SpeakingTaskNumber, string>>
  ) => void | Promise<void>;
  type EvalRunner = (
    prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>,
    transcripts: Record<SpeakingTaskNumber, string>,
    /**
     * Per-task evaluation overrides — supplied for skipped tasks (zero score)
     * or for prior successes during a retry. Tasks present here skip the LLM
     * call entirely and use the supplied evaluation directly. Story 9-8
     * review patches P2/P3.
     */
    evaluationOverrides?: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>>
  ) => Promise<void>;
  type PersistRunner = (
    prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>,
    transcripts: Record<SpeakingTaskNumber, string>,
    evaluations: Record<SpeakingTaskNumber, SpeakingTaskEvaluation>
  ) => Promise<void>;

  const fnsRef = useRef<{
    startTask: TaskRunner;
    beginRecording: TaskRunner;
    finishRecording: TaskRunner;
    runEvaluation: EvalRunner;
    persistResults: PersistRunner;
  } | null>(null);

  const startTask: TaskRunner = (taskNumber, prompts, transcripts) => {
    setState({
      kind: "task-prep",
      taskNumber,
      secondsLeft: PREP_COUNTDOWN_SEC,
      prompts,
      transcripts,
    });
    if (prepTimerRef.current) clearInterval(prepTimerRef.current);
    let n = PREP_COUNTDOWN_SEC;
    prepTimerRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (prepTimerRef.current) clearInterval(prepTimerRef.current);
        void fnsRef.current?.beginRecording(taskNumber, prompts, transcripts);
      } else {
        setState({ kind: "task-prep", taskNumber, secondsLeft: n, prompts, transcripts });
      }
    }, 1000);
  };

  const beginRecording: TaskRunner = async (taskNumber, prompts, transcripts) => {
    const maxSec = prompts[taskNumber].expectedDurationSec + RECORDING_GRACE_SEC;

    setState({ kind: "task-recording", taskNumber, elapsedSec: 0, prompts, transcripts });
    AccessibilityInfo.announceForAccessibility(`Recording task ${taskNumber}. Speak now.`);
    hapticLight();

    try {
      await recorder.startRecording();
    } catch (err) {
      captureError(err, `speaking-mock-test-record-task-${taskNumber}`, {
        phase: "step-record-start-throw",
      });
      hapticError();
      setState({
        kind: "task-failed",
        taskNumber,
        error: "Microphone error. Please retry.",
        phase: "transcribe",
        prompts,
        transcripts,
      });
      return;
    }

    // P10: `useAudioRecorder` swallows errors into `recorder.error` rather
    // than throwing, so a failure to actually start the mic would otherwise
    // leave the user staring at a fake countdown for up to 5.5 minutes
    // before auto-stop resolves and reveals the bug.
    if (recorder.error || !recorder.isRecording) {
      captureError(
        new Error(recorder.error ?? "Recorder did not enter the recording state"),
        `speaking-mock-test-record-task-${taskNumber}`,
        { phase: "step-record-not-active" }
      );
      hapticError();
      setState({
        kind: "task-failed",
        taskNumber,
        error: recorder.error ?? "Microphone failed to start. Please retry.",
        phase: "transcribe",
        prompts,
        transcripts,
      });
      return;
    }

    recordStartMsRef.current = Date.now();
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    // P11: idempotency guard — both this interval's auto-stop AND
    // `handleStopEarly` can call finishRecording. Without this flag, a
    // user tapping Stop Early at the same instant as the auto-stop fires
    // would invoke finishRecording twice (second call gets `null` URI and
    // shows a spurious task-failed).
    let finishCalled = false;
    const fireFinish = () => {
      if (finishCalled) return;
      finishCalled = true;
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      void fnsRef.current?.finishRecording(taskNumber, prompts, transcripts);
    };
    recordTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartMsRef.current) / 1000);
      if (elapsed >= maxSec) {
        AccessibilityInfo.announceForAccessibility(
          "Recording stopped. Transcribing your response."
        );
        fireFinish();
      } else {
        setState((prev) =>
          prev.kind === "task-recording" ? { ...prev, elapsedSec: elapsed } : prev
        );
      }
    }, 250);
    // Expose the idempotent finish to handleStopEarly via a ref so the
    // user-action path also routes through the single-shot guard.
    finishGuardRef.current = fireFinish;
  };

  const finishRecording: TaskRunner = async (taskNumber, prompts, transcripts) => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    setState({ kind: "task-transcribing", taskNumber, prompts, transcripts });

    let recordedUri: string | null = null;
    let transcript: string;
    try {
      recordedUri = await recorder.stopRecording();
      if (!recordedUri) {
        throw new Error("No audio was recorded.");
      }
      const base64 = await FileSystem.readAsStringAsync(recordedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      transcript = await transcribeAudio(base64, "fr");
      // P6: Whisper occasionally returns a near-empty / whitespace-only string
      // for sub-1-second recordings or pure-silence audio. Treat as a
      // recordable failure rather than letting it propagate to the evaluator.
      if (!transcript || !transcript.trim()) {
        throw new Error("Empty transcription — please re-record");
      }
    } catch (err) {
      // P8: include `phase` so Sentry triage distinguishes mic / file / API
      // failures from the same call site.
      captureError(err, `speaking-mock-test-transcribe-task-${taskNumber}`, {
        phase: "step-transcribe-task",
      });
      hapticError();
      const message = err instanceof Error ? err.message : "Could not transcribe your response.";
      setState({
        kind: "task-failed",
        taskNumber,
        error: message,
        phase: "transcribe",
        prompts,
        transcripts,
      });
      return;
    } finally {
      // P5: delete the temp audio file regardless of outcome — orphan audio
      // would otherwise pile up in the app sandbox forever (3 files per
      // mock-test attempt × N attempts).
      if (recordedUri) {
        try {
          await FileSystem.deleteAsync(recordedUri, { idempotent: true });
        } catch (cleanupErr) {
          // Cleanup failure is non-critical — record but do not user-surface.
          captureError(cleanupErr, `speaking-mock-test-record-task-${taskNumber}`, {
            phase: "step-audio-cleanup",
          });
        }
      }
    }

    const updatedTranscripts = { ...transcripts, [taskNumber]: transcript };

    if (taskNumber === 3) {
      const allTranscripts: Record<SpeakingTaskNumber, string> = {
        1: updatedTranscripts[1] ?? "",
        2: updatedTranscripts[2] ?? "",
        3: updatedTranscripts[3] ?? "",
      };
      await fnsRef.current?.runEvaluation(prompts, allTranscripts);
    } else {
      const next = (taskNumber + 1) as SpeakingTaskNumber;
      void fnsRef.current?.startTask(next, prompts, updatedTranscripts);
    }
  };

  // -------------------------------------------------------------------------
  // Evaluation — fires 3 chatCompletionJSON calls in parallel
  // -------------------------------------------------------------------------

  const runEvaluation: EvalRunner = async (prompts, transcripts, evaluationOverrides = {}) => {
    setState({ kind: "evaluating", prompts, transcripts, evaluationOverrides });
    addBreadcrumb({
      category: "ai",
      level: "info",
      message: "Speaking mock test evaluating",
      data: { feature: "speaking-mock-test-eval", phase: "start" },
    });

    // P2/P3/P4: per-task evaluation chain extracted to `speaking-evaluator.ts`
    // for unit-testability (cardinality contract from AC #9 is verified
    // there). The helper uses Promise.allSettled internally so a single task
    // failure does not discard the other 11+ minutes of recording.
    const { successes, failedTaskNumbers, failureMessage } = await evaluateSpeakingTasks({
      cefrLevel,
      prompts,
      transcripts,
      evaluationOverrides,
    });

    if (failedTaskNumbers.length > 0) {
      hapticError();
      setState({
        kind: "evaluation-failed",
        prompts,
        transcripts,
        successes,
        failedTaskNumbers,
        failureMessage,
      });
      return;
    }

    const evaluations: Record<SpeakingTaskNumber, SpeakingTaskEvaluation> = {
      1: successes[1]!,
      2: successes[2]!,
      3: successes[3]!,
    };

    await fnsRef.current?.persistResults(prompts, transcripts, evaluations);
  };

  // -------------------------------------------------------------------------
  // Persistence — mock_tests + 3 mock_test_answers + activity helpers
  // -------------------------------------------------------------------------

  const persistResults: PersistRunner = async (prompts, transcripts, evaluations) => {
    setState({ kind: "persisting" });

    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      setState({ kind: "error", message: "Sign-in expired. Please sign in again." });
      return;
    }

    // P25: `startedAtMsRef` captures the intro mount time. If a user retries
    // a task, the duration accumulates extra seconds; this skews the
    // `mock_tests.duration_seconds` column toward "wall clock during the
    // session" rather than "time actually spent recording." Acceptable for
    // the v1 telemetry contract (analytics / streak math don't read this
    // column); revisit if Epic 13 adds per-task timing analytics.
    const durationSeconds =
      startedAtMsRef.current > 0
        ? Math.floor((Date.now() - startedAtMsRef.current) / 1000)
        : TCF.SPEAKING_MINUTES * 60;

    const summary = await persistSpeakingMockTest({
      userId,
      cefrLevel,
      prompts,
      transcripts,
      evaluations,
      durationSeconds,
    });

    hapticSuccess();
    leaveConfirmedRef.current = true;

    // Story 21-2 R1: speaking runs in this static route, not [testId].tsx —
    // without this emission every Expression Orale completion is invisible
    // to analytics. Speaking composites are on the 0-20 PUBLISHER scale
    // (Story 10-2), so the band converts via /20, not /699.
    trackEvent(ANALYTICS_EVENTS.MOCK_TEST_COMPLETED, {
      test_type: "speaking",
      score_band: scoreBand(Math.round((summary.compositeOverall / 20) * 100)),
    });

    const navResults = {
      sections: {
        speaking: {
          score: summary.compositeOverall,
          correct: 0,
          total: 3,
          tcfScore: summary.totalScore,
          cefrLevel: summary.cefrResult,
          isPartial: true,
        },
      },
      overallTcfScore: summary.totalScore,
      overallCefrLevel: summary.cefrResult,
      testType: "speaking",
      isPartialTest: true,
    };

    router.replace({
      pathname: "/(tabs)/mock-test/results",
      params: { data: JSON.stringify(navResults) },
      // P27: matches the pre-existing pattern in `mock-test/[testId].tsx:529`.
      // Expo Router's typed-routes generic cannot widen `params` to accept a
      // freeform stringified payload; promoting to a route helper is the
      // right cleanup but is broader than 9-8 (touches both runners).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    } as any);
  };

  // P18: re-bind closures inside `useLayoutEffect` rather than in render
  // body. Direct ref mutation during render is a React anti-pattern that
  // executes twice in StrictMode (Expo SDK 55 default in dev) and may
  // mis-associate closures with rendered output. `useLayoutEffect` runs
  // after commit, before the browser/native paint, which is the correct
  // moment to wire callbacks into refs that get invoked from timers.
  useLayoutEffect(() => {
    fnsRef.current = {
      startTask,
      beginRecording,
      finishRecording,
      runEvaluation,
      persistResults,
    };
  });

  // -------------------------------------------------------------------------
  // User actions
  // -------------------------------------------------------------------------

  const handleStopEarly = () => {
    if (state.kind !== "task-recording") return;
    // P11: route through the idempotent guard set up by beginRecording so
    // an auto-stop firing concurrently does not invoke finishRecording twice.
    if (finishGuardRef.current) {
      finishGuardRef.current();
    } else {
      // Fallback for the rare case the guard was never wired (e.g. component
      // re-mounted mid-recording). Preserves prior behavior.
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      void finishRecording(state.taskNumber, state.prompts, state.transcripts);
    }
  };

  const handleRetryTask = () => {
    if (state.kind !== "task-failed") return;
    void startTask(state.taskNumber, state.prompts, state.transcripts);
  };

  const handleSkipTask = () => {
    if (state.kind !== "task-failed") return;
    // P3: skipped tasks store the sentinel transcript AND get a deterministic
    // zero evaluation injected as an override so the LLM is never asked to
    // grade a stub. The eval is baked into a parallel `skippedEvals` shape
    // attached to the running transcripts and resolved when runEvaluation
    // fires.
    const updatedTranscripts = {
      ...state.transcripts,
      [state.taskNumber]: SKIP_SENTINEL,
    };
    if (state.taskNumber === 3) {
      // P15: stricter "missing or empty" check — `??` previously kept "" as a
      // real transcript when Whisper returned empty for silent recording.
      const all: Record<SpeakingTaskNumber, string> = {
        1: isMissingTranscript(updatedTranscripts[1]) ? SKIP_SENTINEL : updatedTranscripts[1]!,
        2: isMissingTranscript(updatedTranscripts[2]) ? SKIP_SENTINEL : updatedTranscripts[2]!,
        3: isMissingTranscript(updatedTranscripts[3]) ? SKIP_SENTINEL : updatedTranscripts[3]!,
      };
      const overrides: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>> = {};
      for (const n of TASK_NUMBERS) {
        if (all[n] === SKIP_SENTINEL) overrides[n] = synthesizeZeroEvaluation();
      }
      void runEvaluation(state.prompts, all, overrides);
    } else {
      const next = (state.taskNumber + 1) as SpeakingTaskNumber;
      void startTask(next, state.prompts, updatedTranscripts);
    }
  };

  // P2: retry only the failing tasks (cost discipline) using cached
  // successes; cancel discards the test.
  const handleRetryFailedEvals = () => {
    if (state.kind !== "evaluation-failed") return;
    void runEvaluation(state.prompts, state.transcripts, state.successes);
  };

  const handleCancelEvalFailed = () => {
    if (state.kind !== "evaluation-failed") return;
    leaveConfirmedRef.current = true;
    router.back();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (state.kind === "loading") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-5 pt-5">
          <SkeletonBar width="60%" height={28} style={{ marginBottom: 16 }} />
          <SkeletonBar width="100%" height={120} style={{ marginBottom: 16 }} />
          <SkeletonBar width="100%" height={56} />
          {isSlow && (
            <Text
              style={[
                Typography.caption,
                { textAlign: "center", marginTop: 16, color: Colors.textTertiary },
              ]}
            >
              Taking longer than usual...
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "permission-denied") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center">
          <Text style={[Typography.screenTitle, { textAlign: "center", marginBottom: 12 }]}>
            Microphone Required
          </Text>
          <Text
            style={[
              Typography.body,
              { textAlign: "center", marginBottom: 24, color: Colors.textSecondary },
            ]}
          >
            Microphone access is required for the Speaking test. Open Settings to enable it.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open device settings"
            onPress={() => void Linking.openSettings()}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
              minHeight: 44,
            }}
          >
            <Text style={[Typography.body, { color: Colors.textOnDark, fontWeight: "700" }]}>
              Open Settings
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={{ marginTop: 12, paddingVertical: 14, alignItems: "center", minHeight: 44 }}
          >
            <Text style={[Typography.body, { color: Colors.textSecondary }]}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "offline") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 justify-center">
          <OfflineFallback onDismiss={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "error") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center">
          <Text style={[Typography.screenTitle, { textAlign: "center", marginBottom: 12 }]}>
            Something went wrong
          </Text>
          <Text
            style={[
              Typography.body,
              { textAlign: "center", marginBottom: 24, color: Colors.error },
            ]}
          >
            {state.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => {
              leaveConfirmedRef.current = true;
              router.back();
            }}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
              minHeight: 44,
            }}
          >
            <Text style={[Typography.body, { color: Colors.textOnDark, fontWeight: "700" }]}>
              Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "intro") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={[Typography.screenTitle, { marginBottom: 8 }]}>Expression Orale</Text>
          <Text style={[Typography.bodySecondary, { marginBottom: 24 }]}>
            TCF Canada Speaking — 3 production tasks · {TCF.SPEAKING_MINUTES} minutes
          </Text>
          {TASK_NUMBERS.map((n) => (
            <View
              key={n}
              style={{
                backgroundColor: Colors.surfaceWhite,
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
                ...Shadows.card,
              }}
            >
              <Text style={[Typography.cardTitle, { marginBottom: 6 }]}>Task {n}</Text>
              <Text style={[Typography.bodySecondary, { marginBottom: 8 }]}>
                {state.prompts[n].instruction}
              </Text>
              <Text style={[Typography.caption, { color: Colors.textTertiary }]}>
                Up to {Math.round(state.prompts[n].expectedDurationSec / 60)} min
              </Text>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Begin Task 1"
            accessibilityHint="Starts the speaking test. The microphone will activate after a short countdown."
            onPress={() => void startTask(1, state.prompts, {})}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: "center",
              marginTop: 16,
              minHeight: 44,
            }}
          >
            <Text style={[Typography.body, { color: Colors.textOnDark, fontWeight: "700" }]}>
              Begin Task 1
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel and return"
            onPress={() => router.back()}
            style={{ marginTop: 12, paddingVertical: 14, alignItems: "center", minHeight: 44 }}
          >
            <Text style={[Typography.body, { color: Colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state.kind === "task-prep") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center items-center">
          <Text style={[Typography.label, { color: Colors.accent, marginBottom: 8 }]}>
            Task {state.taskNumber} of 3
          </Text>
          <Text style={[Typography.bigNumber, { color: Colors.primary, marginBottom: 16 }]}>
            {state.secondsLeft}
          </Text>
          <Text style={[Typography.bodySecondary, { textAlign: "center" }]}>
            Get ready... the microphone will activate.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "task-recording") {
    const taskPrompt = state.prompts[state.taskNumber];
    const remaining = Math.max(0, taskPrompt.expectedDurationSec - state.elapsedSec);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View className="flex-row justify-between items-center mb-3">
            <Text style={[Typography.label, { color: Colors.accent }]}>
              Task {state.taskNumber} / 3
            </Text>
            <View
              accessibilityLabel={`Recording. ${mins} minutes ${secs} seconds left`}
              accessibilityRole="timer"
              accessibilityState={{ busy: true }}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <View
                style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.error }}
              />
              <Text
                style={[
                  Typography.body,
                  { color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
                ]}
              >
                {mins}:{secs.toString().padStart(2, "0")}
              </Text>
            </View>
          </View>
          <Text style={[Typography.cardTitle, { marginBottom: 8 }]}>{taskPrompt.instruction}</Text>
          <View
            style={{
              backgroundColor: Colors.surfaceWhite,
              borderRadius: 16,
              padding: 16,
              marginBottom: 24,
              ...Shadows.card,
            }}
          >
            <Text style={[Typography.body, { lineHeight: 22 }]}>{taskPrompt.promptFr}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop recording early and proceed"
            accessibilityHint="Cuts the recording short and moves to the next step"
            onPress={handleStopEarly}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: "center",
              minHeight: 44,
            }}
          >
            <Text style={[Typography.body, { color: Colors.textOnDark, fontWeight: "700" }]}>
              Stop Early
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state.kind === "task-transcribing") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center items-center">
          <SkeletonBar width="80%" height={20} style={{ marginBottom: 12 }} />
          <SkeletonBar width="60%" height={20} style={{ marginBottom: 16 }} />
          <Text style={[Typography.bodySecondary, { textAlign: "center" }]}>
            Transcribing your response for Task {state.taskNumber}...
          </Text>
          {isSlow && (
            <Text
              style={[
                Typography.caption,
                { textAlign: "center", marginTop: 12, color: Colors.textTertiary },
              ]}
            >
              Taking longer than usual...
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "task-failed") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center">
          <Text style={[Typography.screenTitle, { textAlign: "center", marginBottom: 12 }]}>
            Task {state.taskNumber} failed
          </Text>
          <Text
            style={[
              Typography.body,
              { textAlign: "center", marginBottom: 24, color: Colors.error },
            ]}
          >
            {state.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry task ${state.taskNumber}`}
            onPress={handleRetryTask}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: "center",
              marginBottom: 12,
              minHeight: 44,
            }}
          >
            <Text style={[Typography.body, { color: Colors.textOnDark, fontWeight: "700" }]}>
              Retry Task
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Skip task ${state.taskNumber} and continue`}
            accessibilityHint="Marks the task as no response and continues"
            onPress={handleSkipTask}
            style={{ paddingVertical: 14, alignItems: "center", minHeight: 44 }}
          >
            <Text style={[Typography.body, { color: Colors.textSecondary }]}>Skip Task</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "evaluation-failed") {
    const failedList = state.failedTaskNumbers.map((n) => `Task ${n}`).join(", ");
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center">
          <Text style={[Typography.screenTitle, { textAlign: "center", marginBottom: 12 }]}>
            Evaluation incomplete
          </Text>
          <Text
            style={[
              Typography.body,
              { textAlign: "center", marginBottom: 8, color: Colors.textSecondary },
            ]}
          >
            We couldn&apos;t score {failedList}. Your other tasks are saved.
          </Text>
          <Text
            style={[
              Typography.caption,
              { textAlign: "center", marginBottom: 24, color: Colors.textTertiary },
            ]}
          >
            {state.failureMessage}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry evaluation for ${failedList}`}
            accessibilityHint="Re-evaluates only the failing tasks"
            onPress={handleRetryFailedEvals}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: "center",
              marginBottom: 12,
              minHeight: 44,
            }}
          >
            <Text style={[Typography.body, { color: Colors.textOnDark, fontWeight: "700" }]}>
              Retry Failed Tasks
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel and discard the test"
            accessibilityHint="Discards the test and returns to the mock-test landing"
            onPress={handleCancelEvalFailed}
            style={{ paddingVertical: 14, alignItems: "center", minHeight: 44 }}
          >
            <Text style={[Typography.body, { color: Colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "evaluating" || state.kind === "persisting") {
    const message =
      state.kind === "evaluating" ? "Evaluating your responses..." : "Saving your results...";
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.surface }}>
        <View className="flex-1 px-6 justify-center items-center">
          <SkeletonBar width="80%" height={20} style={{ marginBottom: 12 }} />
          <SkeletonBar width="60%" height={20} style={{ marginBottom: 16 }} />
          <Text style={[Typography.bodySecondary, { textAlign: "center" }]}>{message}</Text>
          {isSlow && (
            <Text
              style={[
                Typography.caption,
                { textAlign: "center", marginTop: 12, color: Colors.textTertiary },
              ]}
            >
              Taking longer than usual...
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return null;
}
