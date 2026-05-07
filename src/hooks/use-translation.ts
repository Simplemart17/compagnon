/**
 * Translation Exercise Hook
 *
 * Manages a multi-step translation exercise: listen → record → evaluate.
 * Each sentence is scored on pronunciation (Azure) and translation accuracy/fluency/naturalness (AI).
 * Uses useAudioRecorder directly for dual-purpose audio (pronunciation + Whisper transcription).
 */

import { useState, useCallback, useRef, useMemo } from "react";

import { useAuthStore } from "@/src/store/auth-store";
import { useAudioPlayer } from "@/src/hooks/use-audio-player";
import { useAudioRecorder } from "@/src/hooks/use-audio-recorder";
import type { UseAudioRecorderReturn } from "@/src/hooks/use-audio-recorder";
import { generateTranslationExercise, evaluateTranslation } from "@/src/lib/translation-generation";
import type { TranslationExerciseResult } from "@/src/lib/translation-generation";
import { generateSpeech, transcribeAudio } from "@/src/lib/openai";
import { assessPronunciation } from "@/src/lib/pronunciation";
import type { PronunciationResult } from "@/src/lib/pronunciation";
import { supabase } from "@/src/lib/supabase";
import { updateStreak, updateSkillProgress, incrementDailyActivity } from "@/src/lib/activity";
import { extractErrorsFromCorrections } from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import { classifyError } from "@/src/lib/error-messages";
import { hapticLight, hapticSuccess, hapticError } from "@/src/lib/haptics";
import type { CEFRLevel } from "@/src/types/cefr";
import type { TranslationEvaluation, TranslationSentence } from "@/src/types/exercise";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranslationScreenState =
  | "idle"
  | "generating"
  | "listen"
  | "recording"
  | "evaluating"
  | "results";

export interface TranslationSentenceResult {
  sentenceIndex: number;
  pronunciationResult: PronunciationResult | null;
  evaluation: TranslationEvaluation | null;
  userTranscription: string;
  skipped: boolean;
}

export interface UseTranslationReturn {
  // State
  screenState: TranslationScreenState;
  exercise: TranslationExerciseResult | null;
  currentIndex: number;
  currentSentence: TranslationSentence | null;
  sentenceResults: TranslationSentenceResult[];
  currentPronunciationResult: PronunciationResult | null;
  currentEvaluation: TranslationEvaluation | null;
  generateError: string | null;
  offlineFallback: boolean;
  hasPlayed: boolean;
  isSavingResults: boolean;
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  recorder: UseAudioRecorderReturn;

  // Computed
  overallScore: number;
  sentenceCount: number;
  getElapsedMinutes: () => number;

  // Actions
  generateExercise: () => Promise<void>;
  playSource: (speed?: number) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  submitRecording: () => Promise<void>;
  nextSentence: () => void;
  skipSentence: () => void;
  tryAgain: () => void;
  clearOfflineFallback: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTranslation(): UseTranslationReturn {
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const audioPlayer = useAudioPlayer();
  const recorder = useAudioRecorder();

  // State
  const [screenState, setScreenState] = useState<TranslationScreenState>("idle");
  const [exercise, setExercise] = useState<TranslationExerciseResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sentenceResults, setSentenceResults] = useState<TranslationSentenceResult[]>([]);
  const [currentPronunciationResult, setCurrentPronunciationResult] =
    useState<PronunciationResult | null>(null);
  const [currentEvaluation, setCurrentEvaluation] = useState<TranslationEvaluation | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [isSavingResults, setIsSavingResults] = useState(false);

  // Refs
  const startTimeRef = useRef<number>(Date.now());
  const isGeneratingRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const exerciseIdRef = useRef<string | null>(null);
  const sentenceResultsRef = useRef<TranslationSentenceResult[]>([]);
  sentenceResultsRef.current = sentenceResults;
  const slowAudioCacheRef = useRef<Map<number, string>>(new Map());
  const recordedAudioRef = useRef<string | null>(null);
  const exerciseRef = useRef<TranslationExerciseResult | null>(null);
  exerciseRef.current = exercise;

  const currentSentence = exercise?.content.sentences[currentIndex] ?? null;

  // -------------------------------------------------------------------------
  // Internal: Save results when all sentences are done
  // -------------------------------------------------------------------------

  const saveResults = useCallback(
    async (allResults: TranslationSentenceResult[]) => {
      if (!user?.id) return;

      try {
        setIsSavingResults(true);

        const nonSkipped = allResults.filter((r) => !r.skipped && r.evaluation);
        const overallScore =
          nonSkipped.length > 0
            ? Math.round(
                nonSkipped.reduce((sum, r) => sum + (r.evaluation?.overallScore ?? 0), 0) /
                  nonSkipped.length
              )
            : 0;
        const now = Date.now();
        const elapsedMinutes = Math.max(1, Math.round((now - startTimeRef.current) / 60000));
        const timeSpentSeconds = Math.round((now - startTimeRef.current) / 1000);

        await Promise.all([
          updateSkillProgress(user.id, "speaking", overallScore, elapsedMinutes),
          incrementDailyActivity(user.id, { minutes: elapsedMinutes, exercises: 1 }),
          updateStreak(user.id),
        ]);

        if (exerciseIdRef.current) {
          await supabase
            .from("exercises")
            .update({
              completed: true,
              score: overallScore,
              time_spent_seconds: timeSpentSeconds,
              completed_at: new Date().toISOString(),
            })
            .eq("id", exerciseIdRef.current);
        }

        // Error tracking — best effort
        try {
          const corrections = nonSkipped
            .filter((r) => r.evaluation?.corrections)
            .map((r) => ({
              original: r.userTranscription,
              corrected: r.evaluation!.expectedTranslation ?? "",
              explanation: r.evaluation!.corrections!,
              category: "grammar",
            }));

          const pronCorrections = allResults
            .filter((r) => !r.skipped && r.pronunciationResult)
            .flatMap((r) =>
              r
                .pronunciationResult!.words.filter((w) => w.errorType !== "None")
                .map((w) => ({
                  original: w.errorType === "Omission" ? "(omitted)" : w.word,
                  corrected: w.word,
                  explanation: `Pronunciation ${w.errorType.toLowerCase()}: ${w.word}`,
                  category: "pronunciation",
                }))
            );

          const allCorrections = [...corrections, ...pronCorrections];
          if (allCorrections.length > 0) {
            await extractErrorsFromCorrections(user.id, allCorrections);
          }
        } catch (err) {
          captureError(err, "translation-error-tracking");
        }
      } catch (err) {
        captureError(err, "translation-save-results");
      } finally {
        setIsSavingResults(false);
      }
    },
    [user?.id]
  );

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const generateExercise = useCallback(async () => {
    if (isGeneratingRef.current || !user?.id) return;
    isGeneratingRef.current = true;

    setScreenState("generating");
    setGenerateError(null);
    setOfflineFallback(false);
    setExercise(null);
    setCurrentIndex(0);
    setSentenceResults([]);
    setCurrentPronunciationResult(null);
    setCurrentEvaluation(null);
    setHasPlayed(false);
    slowAudioCacheRef.current.clear();
    recordedAudioRef.current = null;
    startTimeRef.current = Date.now();

    try {
      const result = await generateTranslationExercise({ cefrLevel, userId: user.id });
      setExercise(result);
      exerciseIdRef.current = result.exerciseId;
      setScreenState("listen");
    } catch (err) {
      captureError(err, "translation-generate");
      const classified = classifyError(err, "Could not generate exercise. Please try again.");
      if (classified.category === "network") {
        setOfflineFallback(true);
        setGenerateError(null);
      } else {
        setGenerateError(classified.message);
      }
      setScreenState("idle");
      hapticError();
    } finally {
      isGeneratingRef.current = false;
    }
  }, [cefrLevel, user?.id]);

  const playSource = useCallback(
    async (speed: number = 1.0) => {
      if (!exerciseRef.current || currentIndex < 0) return;

      try {
        if (speed === 1.0) {
          const base64 = exerciseRef.current.audioData.get(currentIndex);
          if (base64) {
            await audioPlayer.playFromBase64(base64, "mp3");
          }
        } else {
          let slowBase64 = slowAudioCacheRef.current.get(currentIndex);
          if (!slowBase64) {
            const sentence = exerciseRef.current.content.sentences[currentIndex];
            if (sentence) {
              slowBase64 = await generateSpeech(sentence.source, {
                speed: 0.75,
              });
              slowAudioCacheRef.current.set(currentIndex, slowBase64);
            }
          }
          if (slowBase64) {
            await audioPlayer.playFromBase64(slowBase64, "mp3");
          }
        }
        setHasPlayed(true);
        hapticLight();
      } catch (err) {
        captureError(err, "translation-play-source");
        hapticError();
      }
    },
    [currentIndex, audioPlayer]
  );

  const startRecording = useCallback(async () => {
    try {
      setCurrentPronunciationResult(null);
      setCurrentEvaluation(null);
      recordedAudioRef.current = null;
      await recorder.startRecording();
      setScreenState("recording");
    } catch (err) {
      captureError(err, "translation-start-recording");
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      const base64 = await recorder.getBase64Audio();
      if (base64) {
        recordedAudioRef.current = base64;
      }
      // Stay in "recording" state — user can re-record or submit
    } catch (err) {
      captureError(err, "translation-stop-recording");
      hapticError();
    }
  }, [recorder]);

  const submitRecording = useCallback(async () => {
    if (!currentSentence || !recordedAudioRef.current || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setScreenState("evaluating");

    try {
      const audioBase64 = recordedAudioRef.current;
      const expectedTarget = currentSentence.target;

      // Run pronunciation assessment and Whisper transcription in parallel
      const [pronResult, transcribeResult] = await Promise.allSettled([
        assessPronunciation(audioBase64, expectedTarget),
        transcribeAudio(audioBase64, "fr"),
      ]);

      const pronunciationResult = pronResult.status === "fulfilled" ? pronResult.value : null;
      if (pronResult.status === "rejected") {
        captureError(pronResult.reason, "translation-pronunciation");
      }

      const userTranscription =
        transcribeResult.status === "fulfilled" ? transcribeResult.value : "";
      if (transcribeResult.status === "rejected") {
        captureError(transcribeResult.reason, "translation-transcription");
      }

      // P4: If both external calls failed, revert to recording with error
      if (!pronunciationResult && !userTranscription.trim()) {
        setScreenState("recording");
        hapticError();
        return;
      }

      if (pronunciationResult) {
        setCurrentPronunciationResult(pronunciationResult);
      }

      // Evaluate translation if we have transcription text
      let evaluation: TranslationEvaluation | null = null;
      if (userTranscription.trim()) {
        evaluation = await evaluateTranslation({
          source: currentSentence.source,
          expectedTarget,
          userTranscription,
          cefrLevel,
          mode: exerciseRef.current?.content.mode ?? "translation",
        });
        setCurrentEvaluation(evaluation);
      }

      const sentenceResult: TranslationSentenceResult = {
        sentenceIndex: currentIndex,
        pronunciationResult,
        evaluation,
        userTranscription,
        skipped: false,
      };

      const updatedResults = [...sentenceResultsRef.current, sentenceResult];
      setSentenceResults(updatedResults);

      const totalSentences = exerciseRef.current?.content.sentences.length ?? 0;
      if (currentIndex >= totalSentences - 1) {
        // Last sentence — transition to results
        setScreenState("results");
        hapticSuccess();
        await saveResults(updatedResults);
      }
      // else: stay showing per-sentence feedback, screen calls nextSentence()
    } catch (err) {
      captureError(err, "translation-evaluate");
      setScreenState("recording");
      hapticError();
    } finally {
      isSubmittingRef.current = false;
    }
  }, [currentSentence, currentIndex, cefrLevel, saveResults]);

  const nextSentence = useCallback(() => {
    const totalSentences = exerciseRef.current?.content.sentences.length ?? 0;
    if (currentIndex < totalSentences - 1) {
      setCurrentIndex((prev) => prev + 1);
      setHasPlayed(false);
      setCurrentPronunciationResult(null);
      setCurrentEvaluation(null);
      recordedAudioRef.current = null;
      setScreenState("listen");
      hapticLight();
    } else {
      // Already at last sentence — ensure results are saved
      setScreenState("results");
      hapticSuccess();
      void saveResults(sentenceResultsRef.current);
    }
  }, [currentIndex, saveResults]);

  const skipSentence = useCallback(() => {
    const skippedResult: TranslationSentenceResult = {
      sentenceIndex: currentIndex,
      pronunciationResult: null,
      evaluation: null,
      userTranscription: "",
      skipped: true,
    };

    const updatedResults = [...sentenceResultsRef.current, skippedResult];
    setSentenceResults(updatedResults);

    const totalSentences = exerciseRef.current?.content.sentences.length ?? 0;
    if (currentIndex >= totalSentences - 1) {
      setScreenState("results");
      hapticSuccess();
      void saveResults(updatedResults);
    } else {
      setCurrentIndex((prev) => prev + 1);
      setHasPlayed(false);
      setCurrentPronunciationResult(null);
      setCurrentEvaluation(null);
      recordedAudioRef.current = null;
      setScreenState("listen");
      hapticLight();
    }
  }, [currentIndex, saveResults]);

  const tryAgain = useCallback(() => {
    // Stop any active recording or audio playback
    void recorder.stopRecording();
    void audioPlayer.stop();
    setExercise(null);
    setSentenceResults([]);
    setCurrentIndex(0);
    setHasPlayed(false);
    setCurrentPronunciationResult(null);
    setCurrentEvaluation(null);
    setGenerateError(null);
    setOfflineFallback(false);
    slowAudioCacheRef.current.clear();
    recordedAudioRef.current = null;
    exerciseIdRef.current = null;
    isSubmittingRef.current = false;
    setScreenState("idle");
  }, [recorder, audioPlayer]);

  const clearOfflineFallback = useCallback(() => {
    setOfflineFallback(false);
  }, []);

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  const overallScore = useMemo(() => {
    const nonSkipped = sentenceResults.filter((r) => !r.skipped && r.evaluation);
    if (nonSkipped.length === 0) return 0;
    return Math.round(
      nonSkipped.reduce((sum, r) => sum + (r.evaluation?.overallScore ?? 0), 0) / nonSkipped.length
    );
  }, [sentenceResults]);

  const getElapsedMinutes = useCallback(() => {
    return Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000));
  }, []);

  return {
    screenState,
    exercise,
    currentIndex,
    currentSentence,
    sentenceResults,
    currentPronunciationResult,
    currentEvaluation,
    generateError,
    offlineFallback,
    hasPlayed,
    isSavingResults,
    audioPlayer,
    recorder,
    overallScore,
    sentenceCount: exercise?.content.sentences.length ?? 0,
    getElapsedMinutes,
    generateExercise,
    playSource,
    startRecording,
    stopRecording,
    submitRecording,
    nextSentence,
    skipSentence,
    tryAgain,
    clearOfflineFallback,
  };
}
